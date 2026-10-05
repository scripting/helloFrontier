/*  tcpstreams.js -- the tcp stream verbs: sockets a UserTalk script opens,
	reads, writes and listens on, kernelized from MacSocketNetEvents.c and
	the tcp cases of langverbs.c (read 9/3/26).

	9/3/26 by CC, DW's ask for this round: "serving websites, the tcp stream
	verbs and the kernelized webserver."

	UserTalk is synchronous and a socket isn't, so the sockets live with an
	OWNER that has an event loop -- the server's main thread when a script
	runs on a worker, a helper thread of its own when a script runs
	headless -- and the verbs stop and wait for each answer over shared
	memory, the same channel a dialog uses. Two halves here:

		makeStreamOwner (options) -- holds the sockets, answers requests.
			options.flAllowNetwork: false refuses open and listen.
			options.onConnection (theListen, theStream): a listener
			accepted a connection; the caller runs the callback script
			(the kernel's runcallback: callback (stream, refcon) as a
			new process).
			options.folderTemp: where an answer too big for the channel
			is written; the verb reads the file.

		installStreamVerbs (verbs, askOwner) -- the verbs, given a blocking
			ask (theRequest) -> theAnswer.

	The stream ids, the status words (OPEN, DATA, CLOSED, INACTIVE,
	LISTENING, STOPPED), the reads that APPEND to the caller's buffer
	until a pattern shows up or a count is reached, the "closed
	prematurely" failure, the peer address as a long -- all the C's.  */

const net = require ("net");
const fs = require ("fs");
const pathTool = require ("path");

const maxChannelBytes = 60000; //an answer past this goes through a file; the shared window is 64K
const defaultReadTimeoutSecs = 60; //kDefaultReadTimeoutSecs
const defaultChunkSize = 8192; //kDefaultChunkSize

function makeStreamOwner (options) {

	const theStreams = {}; //id -> record
	var nextId = 1;

	function newRecord (theKind) {
		const theRecord = {id: nextId++, kind: theKind, status: "UNKNOWN", pending: Buffer.alloc (0), flClosed: false, theError: undefined, waiters: []};
		theStreams [theRecord.id] = theRecord;
		return (theRecord);
		}

	function wakeWaiters (theRecord) { //something changed on the stream: every pending read looks again
		const theWaiters = theRecord.waiters;
		theRecord.waiters = [];
		theWaiters.forEach (function (theWaiter) {
			theWaiter ();
			});
		}

	function attachSocket (theRecord, theSocket) {
		theRecord.socket = theSocket;
		theRecord.status = "OPEN";
		theSocket.on ("data", function (theChunk) {
			theRecord.pending = Buffer.concat ([theRecord.pending, theChunk]);
			wakeWaiters (theRecord);
			});
		theSocket.on ("end", function () {
			theRecord.flClosed = true;
			wakeWaiters (theRecord);
			});
		theSocket.on ("close", function () {
			theRecord.flClosed = true;
			if (theRecord.status === "OPEN") {
				theRecord.status = "CLOSED";
				}
			wakeWaiters (theRecord);
			});
		theSocket.on ("error", function (err) {
			theRecord.theError = err;
			theRecord.flClosed = true;
			theRecord.status = "INACTIVE";
			wakeWaiters (theRecord);
			});
		}

	function answerWithBytes (theBytes, callback) { //the channel is 64K; a bigger answer rides in a file
		const theText = theBytes.toString ("latin1"); //byte for byte, the way a Frontier string holds them
		if ((options.folderTemp !== undefined) && (Buffer.byteLength (theText, "utf8") > maxChannelBytes)) {
			try {
				fs.mkdirSync (options.folderTemp, {recursive: true});
				const pathData = pathTool.join (options.folderTemp, "stream" + Date.now () + Math.floor (Math.random () * 100000) + ".bin");
				fs.writeFileSync (pathData, theBytes);
				callback ({pathData});
				return;
				}
			catch (err) {
				}
			}
		callback ({value: theText});
		}

	function readWhen (theRecord, timeoutSecs, flReady, howMany, callback) { //readStreamUntilCondition's loop: wait until the condition holds, the stream closes, or the timeout

		/*  flReady () answers true when what's pending satisfies the read;
			howMany () answers how many pending bytes to hand back then. A
			stream that closes before the condition is met is "closed
			prematurely" for the pattern and count reads; for a
			read-until-closed the close IS the condition.  */

		if ((timeoutSecs === undefined) || (timeoutSecs < 1)) {
			timeoutSecs = defaultReadTimeoutSecs;
			}
		var flAnswered = false;
		const theTimer = setTimeout (function () {
			if (flAnswered) {
				return;
				}
			flAnswered = true;
			theRecord.status = "INACTIVE";
			callback ({message: "Can't read the stream because it didn't answer within " + timeoutSecs + " seconds."});
			}, timeoutSecs * 1000);
		function look () {
			if (flAnswered) {
				return;
				}
			if (theRecord.theError !== undefined) {
				flAnswered = true;
				clearTimeout (theTimer);
				callback ({message: "Can't read the stream because " + theRecord.theError.message + "."});
				return;
				}
			if (flReady ()) {
				flAnswered = true;
				clearTimeout (theTimer);
				const ct = howMany ();
				const theBytes = theRecord.pending.slice (0, ct);
				theRecord.pending = theRecord.pending.slice (ct);
				answerWithBytes (theBytes, callback);
				return;
				}
			if (theRecord.flClosed) {
				flAnswered = true;
				clearTimeout (theTimer);
				theRecord.status = "INACTIVE";
				callback ({message: "Can't read the stream because the connection was closed prematurely."}); //STR_P_ERROR_CLOSED_PREMATURELY
				return;
				}
			theRecord.waiters.push (look);
			}
		look ();
		}

	function findStream (theRequest, callback) {
		const theRecord = theStreams [Number (theRequest.id)];
		if (theRecord === undefined) {
			callback ({message: "Can't use stream " + theRequest.id + " because there is no open stream with that id."});
			return (undefined);
			}
		return (theRecord);
		}

	function handle (theRequest, callback) { //callback (theAnswer): {value} or {pathData} or {message}
		try {
			switch (theRequest.op) {

				case "open": { //fwsNetEventOpenNameStream / OpenAddrStream
					if (options.flAllowNetwork === false) {
						callback ({message: "Can't open a stream to " + theRequest.host + " because this Frontier's config doesn't allow network access."});
						return;
						}
					const theRecord = newRecord ("open");
					const theSocket = net.createConnection ({host: String (theRequest.host), port: Number (theRequest.port)});
					var flAnswered = false;
					theSocket.once ("connect", function () {
						if (!flAnswered) {
							flAnswered = true;
							callback ({value: theRecord.id});
							}
						});
					theSocket.once ("error", function (err) {
						if (!flAnswered) {
							flAnswered = true;
							delete theStreams [theRecord.id];
							callback ({message: "Can't open a stream to " + theRequest.host + " on port " + theRequest.port + " because " + err.message + "."});
							}
						});
					attachSocket (theRecord, theSocket);
					return;
					}

				case "write": { //fwsNetEventWriteStream, WriteHandleToStream -- chunking is the transport's business here
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					if ((theRecord.socket === undefined) || theRecord.flClosed) {
						callback ({message: "Can't write to stream " + theRequest.id + " because it isn't open."});
						return;
						}
					var theBytes;
					if (theRequest.pathData !== undefined) {
						theBytes = fs.readFileSync (theRequest.pathData);
						try {
							fs.unlinkSync (theRequest.pathData);
							}
						catch (err) {
							}
						}
					else {
						theBytes = Buffer.from (String (theRequest.data), "latin1");
						}
					theRecord.socket.write (theBytes, function (err) {
						if (err) {
							callback ({message: "Can't write to stream " + theRequest.id + " because " + err.message + "."});
							}
						else {
							callback ({value: true});
							}
						});
					return;
					}

				case "readUntil": { //fwsNetEventReadStreamUntil: everything that arrived, once the pattern is in it
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					const thePattern = Buffer.from (String (theRequest.pattern), "latin1");
					const alreadyHave = Buffer.from (String (theRequest.alreadyHave || ""), "latin1"); //the caller's buffer may hold the pattern already
					readWhen (theRecord, theRequest.timeout, function () {
						return (Buffer.concat ([alreadyHave, theRecord.pending]).indexOf (thePattern) !== -1);
						}, function () {
						return (theRecord.pending.length);
						}, callback);
					return;
					}

				case "readBytes": { //fwsNetEventReadStreamBytes: this many more bytes, exactly
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					const ctWanted = Math.max (0, Number (theRequest.ctBytes) || 0);
					readWhen (theRecord, theRequest.timeout, function () {
						return (theRecord.pending.length >= ctWanted);
						}, function () {
						return (ctWanted);
						}, callback);
					return;
					}

				case "readUntilClosed": { //fwsNetEventReadStreamUntilClosed
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					readWhen (theRecord, theRequest.timeout, function () {
						return (theRecord.flClosed);
						}, function () {
						return (theRecord.pending.length);
						}, callback);
					return;
					}

				case "read": { //fwsNetEventReadStream: up to len bytes of what's there now
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					const ct = Math.min (theRecord.pending.length, Math.max (0, Number (theRequest.len) || 0));
					const theBytes = theRecord.pending.slice (0, ct);
					theRecord.pending = theRecord.pending.slice (ct);
					answerWithBytes (theBytes, callback);
					return;
					}

				case "status": { //fwsNetEventStatusStream
					const theRecord = theStreams [Number (theRequest.id)];
					if (theRecord === undefined) {
						callback ({value: "INACTIVE", bytesPending: 0}); //a stream nobody holds -- a stale user.inetd.listens ref -- reads as inactive, so inetd.isDaemonRunning clears it
						return;
						}
					var theStatus = theRecord.status;
					if ((theStatus === "OPEN") && (theRecord.pending.length > 0)) {
						theStatus = "DATA";
						}
					if ((theStatus === "OPEN") && theRecord.flClosed) {
						theStatus = "INACTIVE";
						theRecord.status = "INACTIVE";
						}
					callback ({value: theStatus, bytesPending: theRecord.pending.length});
					return;
					}

				case "close": { //fwsNetEventCloseStream
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					if (theRecord.socket !== undefined) {
						theRecord.socket.end ();
						theRecord.socket.destroy ();
						}
					theRecord.status = "CLOSED";
					delete theStreams [theRecord.id];
					callback ({value: true});
					return;
					}

				case "abort": { //fwsNetEventAbortStream
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					if (theRecord.socket !== undefined) {
						theRecord.socket.destroy ();
						}
					theRecord.status = "INACTIVE";
					delete theStreams [theRecord.id];
					callback ({value: true});
					return;
					}

				case "peer": { //fwsNetEventGetPeerAddress
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					const theSocket = theRecord.socket;
					var theAddress = "0.0.0.0", thePort = 0;
					if (theSocket !== undefined) {
						theAddress = String (theSocket.remoteAddress || "0.0.0.0").replace (/^::ffff:/, "");
						thePort = Number (theSocket.remotePort) || 0;
						}
					/*  9/15/26 by CC -- the kernel's peer address is four numbers,
						always (fwsNetEventGetPeerAddress fills an IPv4 struct). A
						browser asking for localhost comes in over IPv6 as ::1, and
						tcp.addressencode can't make a long of that, so the
						supervisor died building the paramtable and the browser got
						an empty reply -- DW's 9/15 report on /helloworld. The
						loopback is the loopback; any other bare IPv6 address has no
						four-number form and answers as no address, the kernel's
						0.0.0.0.  */
					if (theAddress === "::1") {
						theAddress = "127.0.0.1";
						}
					else if (theAddress.indexOf (":") !== -1) {
						theAddress = "0.0.0.0";
						}
					callback ({value: theAddress, port: thePort});
					return;
					}

				case "listen": { //fwsNetEventListenStream
					if (options.flAllowNetwork === false) {
						callback ({message: "Can't listen on port " + theRequest.port + " because this Frontier's config doesn't allow network access."});
						return;
						}
					if (typeof options.onConnection !== "function") {
						callback ({message: "Can't listen on port " + theRequest.port + " because nothing here can run the callback script -- a listener needs the server."});
						return;
						}
					const theRecord = newRecord ("listen");
					theRecord.port = Number (theRequest.port);
					theRecord.callback = String (theRequest.callback);
					theRecord.refcon = Number (theRequest.refcon) || 0;
					theRecord.depth = Number (theRequest.depth) || 0;
					const theServer = net.createServer (function (theSocket) {
						const theStream = newRecord ("accepted");
						attachSocket (theStream, theSocket);
						try {
							options.onConnection (theRecord, theStream);
							}
						catch (err) {
							theSocket.destroy ();
							}
						});
					var flAnswered = false;
					theServer.once ("error", function (err) {
						if (!flAnswered) {
							flAnswered = true;
							delete theStreams [theRecord.id];
							callback ({message: "Can't listen on port " + theRequest.port + " because " + err.message + "."});
							}
						else {
							theRecord.status = "STOPPED";
							}
						});
					const theHost = ((theRequest.ip === undefined) || (String (theRequest.ip) === "0") || (String (theRequest.ip) === "0.0.0.0") || (String (theRequest.ip).length === 0)) ? undefined : String (theRequest.ip);
					theServer.listen ({port: theRecord.port, host: theHost}, function () {
						if (!flAnswered) {
							flAnswered = true;
							theRecord.server = theServer;
							theRecord.status = "LISTENING";
							callback ({value: theRecord.id});
							}
						});
					return;
					}

				case "closeListen": { //fwsNetEventCloseListen
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					if (theRecord.server !== undefined) {
						theRecord.server.close ();
						}
					theRecord.status = "STOPPED";
					delete theStreams [theRecord.id];
					callback ({value: true});
					return;
					}

				case "count": { //fwsNetEventGetConnectionCount
					var ct = 0;
					Object.keys (theStreams).forEach (function (theId) {
						if (theStreams [theId].kind !== "listen") {
							ct++;
							}
					});
					callback ({value: ct});
					return;
					}

				/*  10/4/26 by CC -- WEBSOCKETS, DW's 10/4 ask: "we need a client and
					server -- i need to be able to connect to feedland, and get back
					a stream of new and updated rss items." Not daveappserver (his
					word); the ws package, inside the server. The connections live
					with the owner like the streams above: a script opens one and
					goes on, and every message that comes in runs the script it
					named, as its own process, the way a listener's connection runs
					its callback -- callback (socket, message). The message is a
					string both ways, his ruling: "it has to be a string that's sent
					as the message because who knows what kinds of apps people will
					write. all my apps will be json as the payload." The client side
					keeps the connection up the way his feedlandSocket package does:
					a connection that drops is tried again every ten seconds. The
					server side accepts connections on a path of this server's own
					port (attachHttpServer below), one callback script per path.  */

				case "wsOpen": { //(url, callback) -> the socket's id, once the connection is open
					if (options.flAllowNetwork === false) {
						callback ({message: "Can't open a websocket to " + theRequest.url + " because this Frontier's config doesn't allow network access."});
						return;
						}
					const theRecord = newRecord ("websocket");
					theRecord.url = String (theRequest.url);
					theRecord.callback = ((theRequest.callback === undefined) || (theRequest.callback === null) || (String (theRequest.callback).length === 0)) ? undefined : String (theRequest.callback);
					theRecord.ctRetries = 0;
					var flAnswered = false;
					connectWebsocket (theRecord, function (err) {
						if (flAnswered) {
							return;
							}
						flAnswered = true;
						if (err !== undefined) {
							delete theStreams [theRecord.id];
							callback ({message: "Can't open a websocket to " + theRecord.url + " because " + err.message + "."});
							return;
							}
						callback ({value: theRecord.id});
						});
					return;
					}

				case "wsSend": { //(id, text) -> true
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					if ((theRecord.websocket === undefined) || (theRecord.websocket.readyState !== sureWs ().OPEN)) {
						callback ({message: "Can't send on websocket " + theRequest.id + " because it isn't open."});
						return;
						}
					theRecord.websocket.send (String (theRequest.text), function (err) {
						if (err) {
							callback ({message: "Can't send on websocket " + theRequest.id + " because " + err.message + "."});
							}
						else {
							callback ({value: true});
							}
						});
					return;
					}

				case "wsClose": { //(id) -> true; the script asked, so there is no reconnect
					const theRecord = findStream (theRequest, callback);
					if (theRecord === undefined) {
						return;
						}
					theRecord.flClosedByScript = true;
					if (theRecord.reconnectTimer !== undefined) {
						clearTimeout (theRecord.reconnectTimer);
						}
					try {
						if (theRecord.websocket !== undefined) {
							theRecord.websocket.close ();
							}
						}
					catch (err) {
						}
					theRecord.status = "CLOSED";
					delete theStreams [theRecord.id];
					callback ({value: true});
					return;
					}

				case "wsIsOpen": { //(id) -> whether the socket is open right now; an id nobody has is simply not open
					const theRecord = theStreams [Number (theRequest.id)];
					callback ({value: ((theRecord !== undefined) && (theRecord.websocket !== undefined) && (theRecord.websocket.readyState === sureWs ().OPEN))});
					return;
					}

				case "wsListen": { //(path, callback) -> true: connections to this path on the server's own port run the callback for every message
					if (typeof options.onWebsocketMessage !== "function") {
						callback ({message: "Can't listen for websockets at " + theRequest.path + " because nothing here can run the callback script -- a listener needs the server."});
						return;
						}
					if (theHttpServer === undefined) {
						callback ({message: "Can't listen for websockets at " + theRequest.path + " because this server has no web server to accept them on."});
						return;
						}
					const thePath = normalizeWsPath (theRequest.path);
					theWsListens [thePath] = {path: thePath, callback: String (theRequest.callback)};
					callback ({value: true});
					return;
					}

				case "wsBroadcast": { //(text, path) -> how many connections got it: every connection a client made to this server, or only the ones on the path when one is named
					const thePath = ((theRequest.path === undefined) || (theRequest.path === null) || (String (theRequest.path).length === 0)) ? undefined : normalizeWsPath (theRequest.path);
					var ct = 0;
					Object.keys (theStreams).forEach (function (theId) {
						const theRecord = theStreams [theId];
						if ((theRecord.kind === "websocketClient") && ((thePath === undefined) || (theRecord.path === thePath))) {
							try {
								if (theRecord.websocket.readyState === sureWs ().OPEN) {
									theRecord.websocket.send (String (theRequest.text));
									ct++;
									}
								}
							catch (err) {
								}
							}
						});
					callback ({value: ct});
					return;
					}

				default:
					callback ({message: "Can't do " + theRequest.op + " because it isn't a stream operation."});
				}
			}
		catch (err) {
			callback ({message: "Can't do " + theRequest.op + " on the stream because " + err.message + "."});
			}
		}

	//websockets -- 10/4/26 by CC

	const ctSecsBetweenWsRetries = 10; //feedlandsocket.js: ctSecsBetwRetries
	const maxWsRetries = 100; //feedlandsocket.js: maxRetries
	var theWsModule; //assigned by sureWs
	var theHttpServer; //assigned by attachHttpServer: the server whose upgrade requests this owner answers
	var theWsServer; //assigned by attachHttpServer
	const theWsListens = {}; //path -> {path, callback}

	function sureWs () {
		if (theWsModule === undefined) {
			theWsModule = require ("ws");
			}
		return (theWsModule);
		}

	function normalizeWsPath (thePath) {
		var s = String (thePath);
		if (s.charAt (0) !== "/") {
			s = "/" + s;
			}
		return (s.toLowerCase ());
		}

	function hearWebsocketMessages (theRecord) { //a message runs the record's callback script, when it has one
		theRecord.websocket.on ("message", function (theData) {
			if ((theRecord.callback !== undefined) && (typeof options.onWebsocketMessage === "function")) {
				options.onWebsocketMessage (theRecord, theData.toString ("utf8"));
				}
			});
		}

	function connectWebsocket (theRecord, callback) { //callback (err) once, for the first attempt; later attempts are the reconnect's
		const WebSocket = sureWs ();
		var theSocket;
		try {
			theSocket = new WebSocket (theRecord.url);
			}
		catch (err) {
			callback (err);
			return;
			}
		theRecord.websocket = theSocket;
		theRecord.status = "CONNECTING";
		var flOpened = false;
		theSocket.on ("open", function () {
			flOpened = true;
			theRecord.ctRetries = 0;
			theRecord.status = "OPEN";
			callback (undefined);
			});
		theSocket.on ("error", function (err) {
			theRecord.theError = err;
			if (!flOpened) {
				callback (err);
				}
			});
		theSocket.on ("close", function () {
			if (theRecord.flClosedByScript || (theStreams [theRecord.id] === undefined)) {
				return;
				}
			theRecord.status = "INACTIVE";
			if (theRecord.ctRetries >= maxWsRetries) { //feedlandsocket.js gives up at this count too
				delete theStreams [theRecord.id];
				return;
				}
			theRecord.ctRetries++;
			theRecord.reconnectTimer = setTimeout (function () { //the connection is kept up: tried again, the way feedlandSocket does it
				theRecord.reconnectTimer = undefined;
				if (theRecord.flClosedByScript || (theStreams [theRecord.id] === undefined)) {
					return;
					}
				connectWebsocket (theRecord, function () {});
				}, ctSecsBetweenWsRetries * 1000);
			if (theRecord.reconnectTimer.unref !== undefined) {
				theRecord.reconnectTimer.unref ();
				}
			});
		hearWebsocketMessages (theRecord);
		}

	function attachHttpServer (theServer) { //the server's own port answers websocket connections on the paths scripts listen at

		/*  An upgrade request for a path a script listens at becomes a
			connection record of its own (kind websocketClient), with the
			listen's callback; any other path is refused the way a web server
			refuses an upgrade it doesn't do.  */

		theHttpServer = theServer;
		theServer.on ("upgrade", function (theRequest, theSocket, theHead) {
			var thePath = "/";
			try {
				thePath = normalizeWsPath (new URL (theRequest.url, "http://localhost/").pathname);
				}
			catch (err) {
				}
			const theListen = theWsListens [thePath];
			if (theListen === undefined) {
				theSocket.write ("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
				theSocket.destroy ();
				return;
				}
			if (theWsServer === undefined) {
				const WebSocket = sureWs ();
				theWsServer = new WebSocket.Server ({noServer: true});
				}
			theWsServer.handleUpgrade (theRequest, theSocket, theHead, function (theWebsocket) {
				const theRecord = newRecord ("websocketClient");
				theRecord.websocket = theWebsocket;
				theRecord.path = thePath;
				theRecord.callback = theListen.callback;
				theRecord.status = "OPEN";
				theWebsocket.on ("close", function () {
					theRecord.status = "CLOSED";
					delete theStreams [theRecord.id];
					});
				theWebsocket.on ("error", function (err) {
					theRecord.theError = err;
					});
				hearWebsocketMessages (theRecord);
				});
			});
		}

	function closeEverything () {
		Object.keys (theStreams).forEach (function (theId) {
			const theRecord = theStreams [theId];
			try {
				theRecord.flClosedByScript = true; //10/4/26 by CC -- no reconnect for a websocket on the way out
				if (theRecord.reconnectTimer !== undefined) {
					clearTimeout (theRecord.reconnectTimer);
					}
				if (theRecord.websocket !== undefined) {
					theRecord.websocket.close ();
					}
				if (theRecord.server !== undefined) {
					theRecord.server.close ();
					}
				if (theRecord.socket !== undefined) {
					theRecord.socket.destroy ();
					}
				}
			catch (err) {
				}
			});
		}

	return ({handle, closeEverything, theStreams, attachHttpServer});
	}

/*  the verbs -- each one stops and waits on askOwner (theRequest), which
	answers {value} or {pathData} or {message}. The parameter shapes are
	langverbs.c's: readStreamUntil (stream, pattern, timeoutSecs, @buffer)
	APPENDS what arrived to the text at the address; readStreamBytes
	(stream, ctBytes, timeoutSecs, @buffer) reads until the buffer holds
	ctBytes in all; statusStream (stream, @bytesPending) answers the word
	and sets the count.  */

function installStreamVerbs (verbs, askOwner) {

	function ask (theRequest) {
		const theAnswer = askOwner (theRequest);
		if ((theAnswer === undefined) || (theAnswer === null)) {
			throw new Error ("Can't finish " + theRequest.op + " on the stream because no answer came back.");
			}
		if (theAnswer.message !== undefined) {
			throw new Error (theAnswer.message);
			}
		if (theAnswer.pathData !== undefined) { //too big for the channel: the bytes are in a file
			var theBytes;
			try {
				theBytes = fs.readFileSync (theAnswer.pathData);
				}
			catch (err) {
				throw new Error ("Can't read the stream because the answer couldn't be picked up -- " + err.message + ".");
				}
			try {
				fs.unlinkSync (theAnswer.pathData);
				}
			catch (err) {
				}
			theAnswer.value = theBytes.toString ("latin1");
			}
		return (theAnswer);
		}

	function textThroughAddress (theAddress, theVerbName) {
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			throw new Error ("Can't call " + theVerbName + " because the buffer parameter isn't an address.");
			}
		var theValue;
		try {
			theValue = theAddress.reference.get ();
			}
		catch (err) {
			theValue = undefined;
			}
		return (((theValue === undefined) || (theValue === null)) ? "" : String (theValue));
		}

	function toLong (theValue) {
		return (Math.trunc (Number (theValue)) || 0);
		}

	verbs ["tcp.opennamestream"] = function (args) { //(name, port) -> stream
		return (ask ({op: "open", host: String (args [0]), port: toLong (args [1])}).value);
		};

	verbs ["tcp.openaddrstream"] = function (args) { //(addr as long, port) -> stream
		return (ask ({op: "open", host: verbs ["tcp.addressdecode"] ([args [0]]), port: toLong (args [1])}).value);
		};

	verbs ["tcp.readstream"] = function (args) { //(stream, bytesToRead) -> what's there, up to that many
		return (ask ({op: "read", id: toLong (args [0]), len: toLong (args [1])}).value);
		};

	verbs ["tcp.writestream"] = function (args) { //(stream, data) -> true
		return (ask ({op: "write", id: toLong (args [0]), data: ((args [1] === undefined) || (args [1] === null)) ? "" : String (args [1])}).value);
		};

	verbs ["tcp.writestringtostream"] = function (args) { //(stream, text, chunksize, timeout) -> true
		return (ask ({op: "write", id: toLong (args [0]), data: ((args [1] === undefined) || (args [1] === null)) ? "" : String (args [1]), chunksize: toLong (args [2]) || defaultChunkSize, timeout: toLong (args [3])}).value);
		};

	verbs ["tcp.readstreamuntil"] = function (args) { //(stream, pattern, timeoutSecs, @buffer) -> true, the buffer grown
		const theAddress = args [3];
		const theText = textThroughAddress (theAddress, "tcp.readStreamUntil");
		const theAnswer = ask ({op: "readUntil", id: toLong (args [0]), pattern: String (args [1]), timeout: toLong (args [2]), alreadyHave: theText});
		theAddress.reference.set (theText + theAnswer.value);
		return (true);
		};

	verbs ["tcp.readstreambytes"] = function (args) { //(stream, ctBytes, timeoutSecs, @buffer) -> true, the buffer holds ctBytes in all
		const theAddress = args [3];
		const theText = textThroughAddress (theAddress, "tcp.readStreamBytes");
		const ctMore = toLong (args [1]) - Buffer.byteLength (theText, "latin1");
		if (ctMore > 0) {
			const theAnswer = ask ({op: "readBytes", id: toLong (args [0]), ctBytes: ctMore, timeout: toLong (args [2])});
			theAddress.reference.set (theText + theAnswer.value);
			}
		return (true);
		};

	verbs ["tcp.readstreamuntilclosed"] = function (args) { //(stream, timeoutSecs, @buffer) -> true
		const theAddress = args [2];
		const theText = textThroughAddress (theAddress, "tcp.readStreamUntilClosed");
		const theAnswer = ask ({op: "readUntilClosed", id: toLong (args [0]), timeout: toLong (args [1])});
		theAddress.reference.set (theText + theAnswer.value);
		return (true);
		};

	verbs ["tcp.statusstream"] = function (args) { //(stream, @bytesPending) -> the status word
		const theAnswer = ask ({op: "status", id: toLong (args [0])});
		const theAddress = args [1];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theAddress.reference.set (Number (theAnswer.bytesPending) || 0);
			}
		return (theAnswer.value);
		};

	verbs ["tcp.closestream"] = function (args) {
		return (ask ({op: "close", id: toLong (args [0])}).value);
		};

	verbs ["tcp.abortstream"] = function (args) {
		return (ask ({op: "abort", id: toLong (args [0])}).value);
		};

	verbs ["tcp.getpeeraddress"] = function (args) { //-> the address as a long, the way the kernel answers it
		return (verbs ["tcp.addressencode"] ([ask ({op: "peer", id: toLong (args [0])}).value]));
		};

	verbs ["tcp.getpeerport"] = function (args) {
		return (ask ({op: "peer", id: toLong (args [0])}).port);
		};

	verbs ["tcp.listenstream"] = function (args) { //(port, depth, @callback, refcon, addr) -> the listen stream

		/*  the callback rides as its address text; the owner starts the
			callback (stream, refcon) as its own process for every
			connection, runcallback's way. langexternalgetquotedpath gives
			the kernel the full path; the text the script wrote resolves
			through the same search path in the new process.  */

		const theCallback = args [2];
		var theCallbackText;
		if ((theCallback !== undefined) && (theCallback !== null) && (theCallback.flAddress === true)) {
			theCallbackText = String (theCallback.pathText);
			}
		else {
			theCallbackText = String (theCallback);
			}
		var theIp = args [4];
		if ((theIp !== undefined) && (theIp !== null) && (typeof theIp === "number") && (theIp !== 0)) {
			theIp = verbs ["tcp.addressdecode"] ([theIp]);
			}
		return (ask ({op: "listen", port: toLong (args [0]), depth: toLong (args [1]), callback: theCallbackText, refcon: toLong (args [3]), ip: theIp}).value);
		};

	verbs ["tcp.closelisten"] = function (args) {
		return (ask ({op: "closeListen", id: toLong (args [0])}).value);
		};

	verbs ["tcp.countconnections"] = function (args) {
		return (ask ({op: "count"}).value);
		};

	verbs ["tcp.getstats"] = function (args) {
		return ("");
		};

	/*  10/4/26 by CC -- tcp.websocket, DW's 10/4 design (the chat of 10/4):
		open (url, adrCallback) keeps the connection up and runs the script for
		every message; send, close, isOpen; the server side listens on a path
		of this server's own port, with a callback of its own, and broadcast
		reaches every connection a client made. The callback is called as
		callback (socket, message): the socket's id, so the script can send
		back on it, and the message as a string. Its address rides as text,
		the way tcp.listenStream's does.  */

	function callbackText (theCallback) {
		if ((theCallback === undefined) || (theCallback === null)) {
			return ("");
			}
		if (theCallback.flAddress === true) {
			return (String (theCallback.pathText));
			}
		return (String (theCallback));
		}

	verbs ["tcp.websocket.open"] = function (args) { //(url, adrCallback=nil) -> the socket's id
		return (ask ({op: "wsOpen", url: String (args [0]), callback: callbackText (args [1])}).value);
		};

	verbs ["tcp.websocket.send"] = function (args) { //(socket, text) -> true
		return (ask ({op: "wsSend", id: toLong (args [0]), text: String (args [1])}).value);
		};

	verbs ["tcp.websocket.close"] = function (args) { //(socket) -> true
		return (ask ({op: "wsClose", id: toLong (args [0])}).value);
		};

	verbs ["tcp.websocket.isopen"] = function (args) { //(socket) -> boolean
		return (ask ({op: "wsIsOpen", id: toLong (args [0])}).value);
		};

	verbs ["tcp.websocket.listen"] = function (args) { //(path, adrCallback) -> true
		return (ask ({op: "wsListen", path: String (args [0]), callback: callbackText (args [1])}).value);
		};

	verbs ["tcp.websocket.broadcast"] = function (args) { //(text, path="") -> how many connections got it
		return (ask ({op: "wsBroadcast", text: String (args [0]), path: ((args [1] === undefined) || (args [1] === null)) ? "" : String (args [1])}).value);
		};
	}

exports.makeStreamOwner = makeStreamOwner;
exports.installStreamVerbs = installStreamVerbs;
exports.maxChannelBytes = maxChannelBytes;
