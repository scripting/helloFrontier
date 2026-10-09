/*  runnerWorker.js -- 8/7/26 by CC

	Runs one script on a worker thread so it can STOP AND WAIT for a person.

	The dialog verbs post their question to the main thread and block on
	Atomics.wait until the answer is written into shared memory. The server
	stays free to serve requests the whole time -- including the request
	that carries the answer.

	The parsing and serializing here (opmlToTree, textToTree, serializeValue,
	the trace cap) are copied from trigger.js, which can't be required
	because loading it starts the server. Change one, change both.  */

const {parentPort, workerData} = require ("worker_threads");
const pathTool = require ("path");
const fs = require ("fs"); //8/10/26 by CC -- View asks whether the page it names was rendered here

const folderUsertalk = workerData.folderUsertalk;
const hiddenTargetCursors = (workerData.hiddenTargetCursors === undefined) ? {} : workerData.hiddenTargetCursors; //address text -> cursor index, kept by the server across runs -- 8/14/26 by CC
const thePendingTitles = {}; //9/3/26 by CC -- address text -> the title window.setTitle gave an object before window.open opened it; the edit glue does it in that order
const parse = require (folderUsertalk + "/code/parse.js");
const evaluate = require (folderUsertalk + "/code/evaluate.js");
const verbsMaker = require (folderUsertalk + "/code/verbs.js");
const odbSql = require (folderUsertalk + "/code/odbSql.js");
const dates = require (folderUsertalk + "/code/dates.js"); //8/13/26 by CC -- jsonSafe renders a date crossing the window channel; the night review caught this require missing, a crash on any date
const charvalue = require (folderUsertalk + "/code/charvalue.js"); //8/26/26 by CC -- the char type

const theControl = new Int32Array (workerData.sharedControl); //[0] answer-ready flag, [1] answer byte count
const theAnswerBytes = new Uint8Array (workerData.sharedData);

//the script that came in -- copied from trigger.js
	function unescapeXml (theString) {

		/*  9/19/26 by CC -- the numbered references too, &#9; and &#x9;. A
			client that writes its OPML with a real XML serializer sends a
			tab inside a line as &#9;, and it was being stored as the five
			characters. They are read before &amp;, so text that really says
			&#9; -- sent as &amp;#9; -- stays text.  */

		return (theString
			.replace (/&#x([0-9a-fA-F]+);/g, function (theMatch, theDigits) {
				const theCode = parseInt (theDigits, 16);
				if (theCode > 0x10FFFF) { //no such character; the text stays as it came
					return (theMatch);
					}
				else {
					return (String.fromCodePoint (theCode));
					}
				})
			.replace (/&#([0-9]+);/g, function (theMatch, theDigits) {
				const theCode = parseInt (theDigits, 10);
				if (theCode > 0x10FFFF) { //no such character; the text stays as it came
					return (theMatch);
					}
				else {
					return (String.fromCodePoint (theCode));
					}
				})
			.replace (/&lt;/g, "<")
			.replace (/&gt;/g, ">")
			.replace (/&quot;/g, "\"")
			.replace (/&apos;/g, "'")
			.replace (/&amp;/g, "&"));
		}
	function opmlToTree (theXml) {
		const root = {text: "", subs: []};
		const stack = [root];
		var depthSkip = -1;
		var depth = 0;
		const tagPattern = /<outline\b([^>]*?)(\/?)>|<\/outline>/g;
		var match;
		while ((match = tagPattern.exec (theXml)) !== null) {
			if (match [0] === "</outline>") {
				depth--;
				if ((depthSkip >= 0) && (depth <= depthSkip)) {
					depthSkip = -1;
					}
				stack.length = depth + 1;
				}
			else {
				const attributes = match [1];
				const flSelfClosing = match [2] === "/";
				const flComment = /isComment="true"/.test (attributes);
				const textMatch = attributes.match (/text="([^"]*)"/);
				var text = "";
				if (textMatch !== null) {
					text = unescapeXml (textMatch [1]).replace (/[\r\n]+/g, " "); //an outline line can't contain a line break -- 8/14/26 by CC
					}
				if (depthSkip === -1) {
					if (flComment) {
						if (!flSelfClosing) {
							depthSkip = depth;
							}
						}
					else {
						const node = {text, subs: []};
						stack [depth].subs.push (node);
						if (!flSelfClosing) {
							stack [depth + 1] = node;
							}
						}
					}
				if (!flSelfClosing) {
					depth++;
					}
				}
			}
		return (root.subs);
		}
	function textToTree (theText) {
		const theLines = [];
		theText.split ("\n").forEach (function (line) {
			const withoutTabs = line.replace (/^\t+/, "");
			if (withoutTabs.trim ().length > 0) {
				theLines.push ({level: line.length - withoutTabs.length, text: withoutTabs, flComment: false});
				}
			});
		return (parse.linesToTree (theLines));
		}
	function scriptToStatements (theScript) {
		if (theScript.trim ().startsWith ("<")) { //an OPML document, from an outliner
			return (parse.parseOutline (opmlToTree (theScript)));
			}
		return (parse.parseOutline (textToTree (theScript)));
		}

//the value going back -- copied from trigger.js
	function serializeValue (theValue, level) {
		if (level === undefined) {
			level = 0;
			}
		if ((theValue === undefined) || (theValue === null)) {
			return ({valueType: "nothing", value: undefined});
			}
		if (typeof theValue === "string") {
			return ({valueType: "string", value: theValue});
			}
		if (typeof theValue === "number") {
			return ({valueType: "number", value: theValue});
			}
		if (theValue instanceof Number) { //8/19/26 by CC -- a double is a boxed Number; without this it went back as an empty table
			return ({valueType: "number", value: theValue.valueOf ()});
			}
		if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- a char reads as its character
			return ({valueType: "char", value: String (theValue)});
			}
		if (typeof theValue === "boolean") {
			return ({valueType: "boolean", value: theValue});
			}
		if (theValue instanceof Date) {
			return ({valueType: "date", value: theValue.toISOString ()});
			}
		if (theValue.flAddress === true) {
			return ({valueType: "address", value: theValue.pathText});
			}
		if (Array.isArray (theValue)) {
			const items = [];
			if (level < 3) {
				theValue.forEach (function (item) {
					items.push (serializeValue (item, level + 1).value);
					});
				}
			return ({valueType: "list", value: items, ctItems: theValue.length});
			}
		if (typeof theValue === "object") {
			const names = [];
			Reflect.ownKeys (theValue).forEach (function (name) {
				if (typeof name === "string") {
					if ((name !== "flOdbSqlTable") && (name !== "odbId")) {
						names.push (name);
						}
					}
				});
			return ({valueType: "table", value: names, ctEntries: names.length});
			}
		return ({valueType: typeof theValue, value: String (theValue)});
		}

//asking the person on the other side
	function noWindowAnswer (theQuestion) { //what a script with no window gets

		/*  8/29/26 by CC -- an agent or startup script runs with no
			window. A verb that only SHOWS something -- the about window,
			the status line, the beep -- succeeds quietly, so the virgin
			startupScript's window.about () doesn't kill the boot. A verb
			that needs an ANSWER has nobody to ask, and says so.

			9/15/26 by CC -- the same answers for a thread with no window
			(one an agent started, or one whose parent run has finished),
			so this is a function now.  */

		const oneWayVerbs = {"window.about": true, "window.quickscript": true, "window.msg": true, "speaker.beep": true, "console.log": true}; //9/5/26 by CC -- console.log too: DW's watcher agent logged its count and died on the first beat, "Can't ask a question because the script is running as an agent" -- the message had already gone to the worker's console, which is where an agent's console.log lands
		if ((theQuestion.kind === "editorverb") && (oneWayVerbs [theQuestion.verb] === true)) {
			return ({value: true});
			}

		/*  and the window READS answer what the kernel answers when no
			window is open at all -- frontmostverb and gettitleverb both
			say the empty string (shellwindowverbs.c)  */

		const noWindowAnswers = {"window.frontmost": "", "window.next": "", "window.gettitle": "", "window.getposition": {flOpen: false}, "window.setposition": true, "window.setsize": true, "window.hide": true, "window.show": true, "window.close": true, "window.bringtofront": true, "window.update": false, "window.zoom": false, "window.isreadonly": false, "window.ismodified": false, "window.setmodified": false}; //9/14/26 by CC -- the four answer false with no window, the kernel's way //9/13/26 by CC -- window.update with no window answers false, the kernel's updateverb //9/4/26 by CC -- the geometry setters and hide/show are quiet with no window, like about and beep: mainResponder.startup positions the config.root window at boot and there is none
		if ((theQuestion.kind === "editorverb") && (noWindowAnswers [theQuestion.verb] !== undefined)) {
			return ({value: noWindowAnswers [theQuestion.verb]});
			}
		if (theQuestion.kind === "alert") {
			return ({button: "ok"});
			}
		const message = "Can't ask a question because the script is running as " + ((workerData.flThread === true) ? "a thread with no window to ask." : "an agent, and an agent has no window to ask.");
		throw new Error (message);
		}

	function postMsg (theText) { //9/16/26 by CC -- msg: the About window's line. The kernel's ccmsg asks processisoneshot: a run, a startup script and a thread are one-shot, so theirs is a foreground message; an agent's is a background message filed under the agent's name (about.c)
		parentPort.postMessage ({type: "msg", text: theText, flBackground: ((workerData.flAgent === true) && (workerData.flOneShot !== true) && (workerData.flThread !== true)), agentName: workerData.agentName});
		}

	function askUser (theQuestion) { //post the question, sleep until the answer arrives

		if ((workerData.flAgent === true) && (workerData.flHasWindow !== true)) { //9/15/26 by CC -- flHasWindow: a thread started from a script that has a window keeps that window; its questions go to the server, which hands them to that window's page
			return (noWindowAnswer (theQuestion));
			}
		Atomics.store (theControl, 0, 0);
		parentPort.postMessage ({type: "dialog", question: theQuestion});
		Atomics.wait (theControl, 0, 0); //blocks this thread only -- the server keeps serving

		const ctBytes = Atomics.load (theControl, 1);
		const theText = Buffer.from (theAnswerBytes.slice (0, ctBytes)).toString ("utf8");
		var theAnswer;
		try {
			theAnswer = JSON.parse (theText);
			}
		catch (err) {
			return ({button: "cancel"});
			}
		if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.noWindow === true)) { //9/15/26 by CC -- the window this thread had is gone: its parent run finished
			return (noWindowAnswer (theQuestion));
			}
		return (theAnswer);
		}
	function askServer (theRequest) { //8/12/26 by CC -- same stop-and-wait as a dialog, but the server answers it itself
		Atomics.store (theControl, 0, 0);
		parentPort.postMessage ({type: "httprequest", request: theRequest});
		Atomics.wait (theControl, 0, 0);
		const ctBytes = Atomics.load (theControl, 1);
		const theText = Buffer.from (theAnswerBytes.slice (0, ctBytes)).toString ("utf8");
		try {
			return (JSON.parse (theText));
			}
		catch (err) {
			return ({message: "the answer from the server couldn't be read."});
			}
		}

	/*  9/4/26 by CC -- THE MISSING-VERB LOG. DW, on the fresh install, after
		an import stopped on editMenu.setFont: "it would be nice if you kept a
		log of this error message -- so i wouldn't have to report the missing
		verb." Every "isn't implemented in the verb library" lands here, one
		line per verb per launch, in missingVerbs.txt beside the database:
		when, the verb, and the script that called it.  */

	const theMissingVerbsSeen = {};
	function noteMissingVerb (kernelName, theScriptAddress) {
		const theKey = String (kernelName).toLowerCase ();
		if (theMissingVerbsSeen [theKey] === true) {
			return;
			}
		theMissingVerbsSeen [theKey] = true;
		var theCaller = "";
		if ((theScriptAddress !== undefined) && (theScriptAddress !== null)) {
			theCaller = (theScriptAddress.pathText !== undefined) ? String (theScriptAddress.pathText) : String (theScriptAddress);
			}
		const theLine = new Date ().toLocaleString () + "\t" + kernelName + "\t" + theCaller + "\n";
		try {
			fs.appendFileSync (pathTool.join (pathTool.dirname (pathTool.resolve (workerData.pathDatabase)), "missingVerbs.txt"), theLine);
			}
		catch (err) {
			}
		}

	function installTcpVerbs (verbs) { //9/3/26 by CC -- the stream verbs over the server's channel: the server owns the sockets (tcpstreams.js), the script stops and waits for each answer
		require (workerData.folderUsertalk + "/code/tcpstreams.js").installStreamVerbs (verbs, function (theRequest) {
			Atomics.store (theControl, 0, 0);
			parentPort.postMessage ({type: "tcp", request: theRequest});
			Atomics.wait (theControl, 0, 0);
			const ctBytes = Atomics.load (theControl, 1);
			const theText = Buffer.from (theAnswerBytes.slice (0, ctBytes)).toString ("utf8");
			try {
				return (JSON.parse (theText));
				}
			catch (err) {
				return ({message: "Can't finish " + theRequest.op + " on the stream because the answer from the server couldn't be read."});
				}
			});
		}

	function askServerFor (theType, theRequest) { //9/15/26 by CC -- askServer's stop-and-wait, for any kind of ask the server answers itself
		Atomics.store (theControl, 0, 0);
		parentPort.postMessage ({type: theType, request: theRequest});
		Atomics.wait (theControl, 0, 0);
		const ctBytes = Atomics.load (theControl, 1);
		const theText = Buffer.from (theAnswerBytes.slice (0, ctBytes)).toString ("utf8");
		try {
			return (JSON.parse (theText));
			}
		catch (err) {
			return ({message: "the answer from the server couldn't be read."});
			}
		}

	function installThreadVerbs (verbs) {

		/*  9/15/26 by CC -- THREADS, the kernel's way. thread.callScript
			(threadcallscriptverb, shellsysverbs.c) builds the call and hands
			it to addnewprocess: the script runs as a process of its own and
			the caller goes on at once, holding the thread's id. From 8/8 to
			9/15 the verb here ran the script in line and the caller waited;
			DW, 9/15: "that's a bug." Frontier.tools.install hung on its last
			line, scheduler0.monitorThreads, which starts the scheduler's
			loop this way.

			Here a thread is a worker of its own, started by the server the
			way an agent is (startThread in trigger.js), with its own
			connection to the database. The server keeps the registry, so
			thread.exists and thread.kill ask it. DW's rulings 9/15: a thread
			runs the agent way; a thread started from a script that has a
			window keeps that window (flHasWindow -- its dialogs and window
			verbs go to the page the parent run came from); one started with
			no window has none, and a dialog in it fails with a sentence.

			The call travels as one line of UserTalk -- the script's address
			and its parameters as literals -- so the parameters cross to the
			other worker the way they cross into the kernel's new process:
			by value. A parameter with no literal form is refused by name.  */

		function literalFor (theValue, theName) {
			if ((theValue === undefined) || (theValue === null)) {
				return ("nil");
				}
			if (typeof theValue === "string") {
				return ("\"" + theValue.split ("\\").join ("\\\\").split ("\"").join ("\\\"").split ("\r").join ("\\r").split ("\n").join ("\\n") + "\"");
				}
			if ((typeof theValue === "number") || (typeof theValue === "boolean")) {
				return (String (theValue));
				}
			if (theValue.flAddress === true) {
				return ("@" + String (theValue.pathText));
				}
			const message = "Can't start a thread for " + theName + " because a parameter of type " + ((typeof theValue === "object") ? "table" : typeof theValue) + " can't be passed to it.";
			throw new Error (message);
			}

		verbs ["thread.callscript"] = function (args) { //thread.callScript (@adrScript, {params}) -> the thread's id
			const theAddress = args [0];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't start a thread because the first parameter isn't the address of a script.";
				throw new Error (message);
				}
			const theName = String (theAddress.pathText);
			const theParams = Array.isArray (args [1]) ? args [1] : [];
			var theParamText = "";
			theParams.forEach (function (theParam) {
				if (theParamText.length > 0) {
					theParamText += ", ";
					}
				theParamText += literalFor (theParam, theName);
				});
			const theAnswer = askServerFor ("thread", {op: "callscript", name: theName, line: theName + " (" + theParamText + ")"});
			if ((theAnswer === undefined) || (theAnswer === null) || (theAnswer.message !== undefined)) {
				const message = ((theAnswer === undefined) || (theAnswer === null)) ? "Can't start a thread for " + theName + " because the server didn't answer." : theAnswer.message;
				throw new Error (message);
				}
			return (theAnswer.id);
			};

		verbs ["thread.evaluate"] = function (args) { //thread.evaluate (text) -> the thread's id; the text runs as a thread of its own -- scheduler0.monitorThreads starts every thread this way: thread.evaluate (string (adrscript) + "()")
			const theText = String (args [0]);
			const theLines = [];
			theText.split (/\r\n|\r|\n/).forEach (function (theLine) {
				const theBare = theLine.replace (/^\t+/, "");
				if (theBare.trim ().length > 0) {
					theLines.push ({level: theLine.length - theBare.length, text: theBare, flComment: false});
					}
				});
			if (theLines.length === 0) {
				const message = "Can't start a thread because there is no text to run.";
				throw new Error (message);
				}
			const theAnswer = askServerFor ("thread", {op: "callscript", name: "thread.evaluate: " + theLines [0].text.substring (0, 60), lines: theLines});
			if ((theAnswer === undefined) || (theAnswer === null) || (theAnswer.message !== undefined)) {
				const message = ((theAnswer === undefined) || (theAnswer === null)) ? "Can't start a thread because the server didn't answer." : theAnswer.message;
				throw new Error (message);
				}
			return (theAnswer.id);
			};

		verbs ["thread.exists"] = function (args) {
			return (askServerFor ("thread", {op: "exists", id: Number (args [0])}).value === true);
			};

		verbs ["thread.kill"] = function (args) {
			return (askServerFor ("thread", {op: "kill", id: Number (args [0])}).value === true);
			};

		verbs ["thread.getcount"] = function (args) {
			const theAnswer = askServerFor ("thread", {op: "count"});
			return ((typeof theAnswer.value === "number") ? theAnswer.value : 1);
			};

		verbs ["thread.getcurrentid"] = function (args) {
			return ((workerData.threadId === undefined) ? 1 : workerData.threadId);
			};
		}

	function installHttpVerbs (verbs) {

		/*  8/12/26 by CC -- reading a url, DW: "i don't think i can go very
			far without the http verbs."

			tcp.httpClient answers the way Frontier's does: the WHOLE
			response, status line and headers, a blank line, then the body --
			which is what its callers expect, since they hand the answer
			straight to webserver.util.parseHeaders. The parameters are
			Frontier's, in Frontier's order.

			Not here yet, and they'd be felt only by someone using them: the
			proxy parameters, and the cookie jar.

			The answer never comes back through the 64K window -- the server
			writes it to a file and this reads the file.  */

		function readTheAnswer (theAnswer, flBodyOnly) {
			if (theAnswer.message !== undefined) {
				throw new Error (theAnswer.message);
				}
			var theText;
			try {
				theText = fs.readFileSync (theAnswer.pathResponse, "utf8");
				}
			catch (err) {
				throw new Error ("Can't read " + theAnswer.theUrl + " because the answer couldn't be picked up -- " + err.message);
				}
			try {
				fs.unlinkSync (theAnswer.pathResponse);
				}
			catch (err) {
				}
			if (flBodyOnly !== true) {
				return (theText);
				}
			const ixBlankLine = theText.indexOf ("\r\n\r\n");
			return ((ixBlankLine === -1) ? theText : theText.slice (ixBlankLine + 4));
			}

		function ticksToMilliseconds (theTicks) { //a tick is a sixtieth of a second, the way the Mac counted
			if ((theTicks === undefined) || (theTicks === null) || (Number (theTicks) <= 0)) {
				return (30 * 1000);
				}
			return (Math.round (Number (theTicks) * 1000 / 60));
			}

		function headersFromAddress (theAddress) {
			const theHeaders = {};
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				return (theHeaders);
				}
			var theTable;
			try {
				theTable = theAddress.reference.get (); //8/16/26 by CC -- reads of missing entries throw now; a headers table that isn't there means no extra headers, same as before
				}
			catch (err) {
				return (theHeaders);
				}
			if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
				return (theHeaders);
				}
			Reflect.ownKeys (theTable).forEach (function (theName) {
				if ((typeof theName === "string") && (theName !== "flOdbSqlTable") && (theName !== "odbId")) {
					theHeaders [theName] = String (theTable [theName]);
					}
				});
			return (theHeaders);
			}

		verbs ["tcp.httpclient"] = function (args) {

			const theMethod = ((args [0] === undefined) || (args [0] === null) || (String (args [0]).length === 0)) ? "GET" : String (args [0]);
			const theServer = String ((args [1] === undefined) ? "" : args [1]);
			const thePort = args [2];
			var thePath = String ((args [3] === undefined) ? "" : args [3]);
			const theData = String ((args [8] === undefined) || (args [8] === null) ? "" : args [8]);
			const theDataType = String ((args [9] === undefined) || (args [9] === null) ? "" : args [9]);
			const theUsername = String ((args [10] === undefined) || (args [10] === null) ? "" : args [10]);
			const thePassword = String ((args [11] === undefined) || (args [11] === null) ? "" : args [11]);
			const theHeaders = headersFromAddress (args [12]);
			const theMilliseconds = ticksToMilliseconds (args [15]);
			const ctFollowRedirects = ((args [17] === undefined) || (args [17] === null)) ? 0 : Number (args [17]);
			const flJustHeaders = args [18] === true;
			const flAcceptOpml = args [19] === true;

			if (theServer.length === 0) {
				throw new Error ("Can't send the request because no server was named.");
				}
			if (thePath.charAt (0) !== "/") {
				thePath = "/" + thePath;
				}
			var theUrl = theServer;
			if (theUrl.indexOf ("://") === -1) {
				theUrl = (((thePort === undefined) || (thePort === null) || (Number (thePort) === 80)) ? "http://" : "https://") + theUrl;
				}
			if ((thePort !== undefined) && (thePort !== null) && (Number (thePort) !== 80) && (Number (thePort) !== 443)) {
				theUrl += ":" + Number (thePort);
				}
			theUrl += thePath;

			if (theHeaders ["User-Agent"] === undefined) {
				theHeaders ["User-Agent"] = "UserTalk";
				}
			if (flAcceptOpml && (theHeaders ["Accept"] === undefined)) {
				theHeaders ["Accept"] = "text/x-opml, */*";
				}
			if (theDataType.length > 0) {
				theHeaders ["Content-Type"] = theDataType;
				}
			if (theUsername.length > 0) {
				theHeaders ["Authorization"] = "Basic " + Buffer.from (theUsername + ":" + thePassword).toString ("base64");
				}

			return (readTheAnswer (askServer ({
				url: theUrl,
				method: theMethod,
				headers: theHeaders,
				data: theData,
				milliseconds: theMilliseconds,
				ctFollowRedirects,
				flJustHeaders
				}), false));
			};

		verbs ["tcp.httpreadurl"] = function (args) { //the convenient one: the page itself, redirects followed

			const theUrl = String ((args [0] === undefined) ? "" : args [0]);
			if (theUrl.length === 0) {
				throw new Error ("Can't read the url because none was named.");
				}
			const theSeconds = args [2];
			return (readTheAnswer (askServer ({
				url: (theUrl.indexOf ("://") === -1) ? ("http://" + theUrl) : theUrl,
				method: "GET",
				headers: {"User-Agent": "UserTalk"},
				data: "",
				milliseconds: ((theSeconds === undefined) || (theSeconds === null)) ? (30 * 1000) : Math.round (Number (theSeconds) * 1000),
				ctFollowRedirects: 5,
				flJustHeaders: false
				}), true));
			};

		verbs ["tcp.httptransport"] = function (args) {

			/*  9/11/26 by DW+CC -- the transport under tcp.httpClient's glue.
				tcp.httpClient opened a raw stream (tcp.openStream),
				plaintext, so it couldn't reach an https server -- DW's
				codecasting feed went https-only and httpReadUrl answered a
				zero-length string. DW's design: the glue keeps building the
				request and keeps the cookie handling around it, and hands
				the finished request text here, which does it over the wire
				and answers the raw response, TLS when flSecure. Reuses the
				server's own fetch, so TLS and chunked encoding are Node's
				job. DUPLICATES the verbs.js copy -- change one, change both.  */

			const theHost = String ((args [0] === undefined) ? "" : args [0]);
			const thePort = args [1];
			const flSecure = args [2] === true;
			const theRequestText = String ((args [3] === undefined) || (args [3] === null) ? "" : args [3]);
			const theSeconds = args [4];
			const flJustHeaders = args [5] === true;

			const theRequest = parseHttpCommand (theRequestText);
			var theUrl;
			if ((theRequest.uri.indexOf ("http://") === 0) || (theRequest.uri.indexOf ("https://") === 0)) {
				theUrl = theRequest.uri; //a proxy request carries the whole url on the request line
				}
			else {
				var theAuthority = theHost;
				if ((thePort !== undefined) && (thePort !== null) && (Number (thePort) !== 80) && (Number (thePort) !== 443)) {
					theAuthority += ":" + Number (thePort);
					}
				theUrl = (flSecure ? "https://" : "http://") + theAuthority + theRequest.uri;
				}

			return (readTheAnswer (askServer ({
				url: theUrl,
				method: theRequest.method,
				headers: theRequest.headers,
				data: theRequest.body,
				milliseconds: ((theSeconds === undefined) || (theSeconds === null) || (Number (theSeconds) <= 0)) ? (30 * 1000) : Math.round (Number (theSeconds) * 1000),
				ctFollowRedirects: 0,
				flJustHeaders
				}), false));
			};

		function parseHttpCommand (theRequestText) { //9/11/26 by DW+CC -- pull the method, uri, headers and body back out of the request tcp.httpClient's glue built. Content-Length dropped; the fetch sets it from the body. DUPLICATES the verbs.js copy -- change one, change both
			const ixBlank = theRequestText.indexOf ("\r\n\r\n");
			const theHead = (ixBlank === -1) ? theRequestText : theRequestText.slice (0, ixBlank);
			const theBody = (ixBlank === -1) ? "" : theRequestText.slice (ixBlank + 4);
			const theLines = theHead.split ("\r\n");
			const theTokens = ((theLines.length > 0) ? theLines [0] : "").split (" ");
			const theMethod = (theTokens.length > 0) && (theTokens [0].length > 0) ? theTokens [0] : "GET";
			const theUri = (theTokens.length > 1) ? theTokens [1] : "/";
			const theHeaders = {};
			var ixLine;
			for (ixLine = 1; ixLine < theLines.length; ixLine++) {
				const theLine = theLines [ixLine];
				const ixColon = theLine.indexOf (":");
				if (ixColon !== -1) {
					const theName = theLine.slice (0, ixColon).trim ();
					const theValue = theLine.slice (ixColon + 1).trim ();
					if ((theName.length > 0) && (theName.toLowerCase () !== "content-length")) {
						theHeaders [theName] = theValue;
						}
					}
				}
			return ({method: theMethod, uri: theUri, headers: theHeaders, body: theBody});
			}

		verbs ["sys.getupdatefromurl"] = function (args) {

			/*  8/15/26 by CC -- the engine behind "Get update from Marin", the
				DW-menu command DW specced 8/15: he chooses it, it confirms,
				reads a file, installs it. The file is a FAT PAGE -- his
				format, his ruling ("fatpages is right") -- which carries its
				own address in the #adrPageData directive, so the update says
				where it goes and nobody has to decide. The decode and the
				install are the same proven code misc/installFatPage.js runs:
				frontierodb.readFatPage, odbHome.convertValue, odbSql
				.installTree. Answers a sentence saying what was installed.  */

			const theUrl = String ((args [0] === undefined) ? "" : args [0]);
			if (theUrl.length === 0) {
				throw new Error ("Can't get the update because no url was named.");
				}
			const theWhole = readTheAnswer (askServer ({
				url: theUrl,
				method: "GET",
				headers: {"User-Agent": "UserTalk"},
				data: "",
				milliseconds: 60 * 1000,
				ctFollowRedirects: 5,
				flJustHeaders: false
				}), false);
			const theStatusLine = theWhole.split ("\r\n") [0];
			if (theStatusLine.indexOf (" 200") === -1) {
				throw new Error ("Can't get the update because the server answered \"" + theStatusLine.trim () + "\" -- there may be no update posted right now.");
				}
			const ixBlankLine = theWhole.indexOf ("\r\n\r\n");
			const theBody = (ixBlankLine === -1) ? theWhole : theWhole.slice (ixBlankLine + 4);

			const pathTemp = pathTool.join (require ("os").tmpdir (), "frontierUpdate" + process.pid + ".fttb");
			fs.writeFileSync (pathTemp, theBody);
			var thePage;
			try {
				thePage = require (pathTool.join (__dirname, "frontierodb.js")).readFatPage (pathTemp);
				}
			catch (err) {
				throw new Error ("Can't install the update because the file couldn't be read as a fat page -- " + err.message);
				}
			finally {
				try {
					fs.unlinkSync (pathTemp);
					}
				catch (err) {
					}
				}
			const theAddress = thePage.directives.adrPageData;
			if ((theAddress === undefined) || (theAddress.length === 0)) {
				throw new Error ("Can't install the update because the fat page doesn't say what address it belongs at.");
				}
			const theValue = require (pathTool.join (folderUsertalk, "code/odbHome.js")).convertValue (thePage.value);
			const ctRows = odbSql.installTree (workerData.pathDatabase, theAddress, theValue);
			return ("Installed " + theAddress + " -- " + ctRows + ((ctRows === 1) ? " row." : " rows."));
			};
		}

	const openWindowOnTarget = {}; //8/15/26 by CC -- per-address, per-run: is a window open on the target? Filled by the op routing, forgotten by the edit verb, so both scopes share it here

	/*  8/21/26 by CC -- where an object REALLY is. An address value carries the
		text the script wrote: @op.xmlToOutline stays "op.xmlToOutline", even
		though the name resolved through the search path to
		system.verbs.builtins.op.xmlToOutline. A window opened on the written
		text saves back to the written text, and the save creates it at the
		ROOT -- which is how a table named op appeared beside system and user
		on 8/21, shadowing every op verb in the app. The reference knows the
		table the name was found in, so the true path is asked for here.  */

	function trueAddressText (theAddress, environment) {
		const theFallback = theAddress.pathText;
		const theReference = theAddress.reference;
		if ((theReference === undefined) || (theReference === null)) {
			return (theFallback);
			}
		var thePlace = theReference;
		if (theReference.place !== undefined) { //a path-shaped address walks to its real parent on request
			thePlace = theReference.place ();
			if (thePlace === undefined) {
				return (theFallback);
				}
			}
		const theContainer = thePlace.container;
		if ((theContainer === undefined) || (theContainer === null) || (typeof theContainer !== "object")) {
			return (theFallback); //a local, or a reference that doesn't say where it came from
			}
		if ((environment === undefined) || (environment.odbPathForId === undefined) || (theContainer.odbId === undefined)) {
			return (theFallback); //not an object in the database
			}
		const theContainerPath = environment.odbPathForId (theContainer.odbId);
		if (theContainerPath.length === 0) {
			return (String (thePlace.key)); //the container is the root itself
			}
		return (theContainerPath + "." + thePlace.key);
		}

	function installDialogVerbs (verbs) {
		verbs ["dialog.alert"] = function (args) {
			askUser ({kind: "alert", prompt: String (args [0])});
			return (true);
			};
		verbs ["dialog.notify"] = verbs ["dialog.alert"];
		verbs ["dialog.confirm"] = function (args) {
			const theAnswer = askUser ({kind: "confirm", prompt: String (args [0])});
			return (theAnswer.button === "ok");
			};

		/*  8/24/26 by CC -- the kernel names the glue scripts actually call:
			dialog.confirm in the database is one line, dialog.twoWay
			(prompt, "OK", "Cancel"), whose own body is kernel
			(dialog.twoway) -- and that name was never installed, so
			dialog.confirm failed from any script since the database took
			the front of the lookup. twoway answers whether button 1 was
			hit (twowaydialog in the kernel); threeway answers WHICH button,
			1, 2 or 3, which is what its glue's buttonhit was.  */

		verbs ["dialog.twoway"] = function (args) {
			const theAnswer = askUser ({kind: "buttons", prompt: String (args [0]), buttons: [String ((args [1] === undefined) ? "OK" : args [1]), String ((args [2] === undefined) ? "Cancel" : args [2])]});
			return (theAnswer.button === 1);
			};
		verbs ["dialog.threeway"] = function (args) {
			const theAnswer = askUser ({kind: "buttons", prompt: String (args [0]), buttons: [String ((args [1] === undefined) ? "Yes" : args [1]), String ((args [2] === undefined) ? "No" : args [2]), String ((args [3] === undefined) ? "Cancel" : args [3])]});
			return (theAnswer.button);
			};
		verbs ["edit"] = function (args, environment) { //edit (@adr, title, flReadonly, @buttonsTable) -- opens a real window in the app

			/*  8/8/26 by CC -- Frontier's edit verb, the way nodeEditor uses it:
				the fourth parameter is the address of a TABLE OF SCRIPTS, one
				per button -- buttons are data, user-editable, not chrome. The
				window request rides the same channel as a dialog; the app
				answers as soon as the window is open, and the script moves on --
				edit doesn't wait for the window to close, same as Frontier.  */

			const theAddress = verbs ["lang.address"] ([args [0]], environment); //9/12/26 by CC -- a text address is an address, the kernel's getvarvalue coerces it: a bookmark's script reads bookmarksMenu.openObject ("workspace.notepad", ...) and its edit (adr) arrived here as text and was refused (DW's 9/12 Bookmarks report)
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't edit because the first parameter isn't the address of the object to open.";
				throw new Error (message);
				}
			const theQuestion = {kind: "edit", address: trueAddressText (theAddress, environment)};
			var theObject = theAddress.reference.get (); //a table opens a table window; scripts and outlines open the editor
			if ((theObject !== undefined) && (theObject !== null) && (typeof theObject === "object") &&
				(theObject.flOdbScript === undefined) && (theObject.flOdbMenubar === undefined) &&
				(theObject.flWpText === undefined) && (theObject.flOdbAddressText === undefined) &&
				(theObject.flAddress === undefined) && (theObject.type === undefined) && (!Array.isArray (theObject))) {
				theQuestion.objectType = "table";
				}
			if ((theObject !== undefined) && (theObject !== null) && (theObject.flOdbMenubar === true)) {
				theQuestion.objectType = "menubar"; //9/3/26 by CC -- a menubar opens in the menubar editor, its own window; it opened in the script editor, one of the places DW found it treated as something it isn't
				}
			if (args [1] !== undefined) {
				theQuestion.title = String (args [1]);
				}
			if (args [2] === true) {
				theQuestion.flReadonly = true;
				}
			const adrButtons = args [3];
			if ((adrButtons !== undefined) && (adrButtons !== null) && (adrButtons.flAddress === true)) {
				theQuestion.buttonsAddress = adrButtons.pathText;
				}
			askUser (theQuestion);
			delete openWindowOnTarget [theAddress.pathText.toLowerCase ()]; //8/15/26 by CC -- a window just opened on this address; the cached "is one open" answer is stale
			return (true);
			};
		/*  8/22/26 by CC -- window.open, AND IT IS THE ONE THAT MATTERS. DW,
			8/22: "i can't seem to open @workspace." The `edit` verb in his
			database is his own UserTalk -- system.verbs.globals.edit, found
			at path01, ahead of anything of ours -- and it ends at
			window.open (adr). We never implemented that, and window.* falls
			into the screen-verb no-op, so the script ran, claimed success and
			opened nothing.
			
			So window.open is what actually opens a window, and our own edit
			verb is a caller of it. That is Frontier's shape: edit is a script,
			window.open is the kernel.  */
		
		function openWindowOnAddress (theAddress, environment, theExtras) {
			const theQuestion = {kind: "edit", address: trueAddressText (theAddress, environment)};
			var theObject;
			try {
				theObject = theAddress.reference.get ();
				}
			catch (err) {
				theObject = undefined;
				}
			if ((theObject !== undefined) && (theObject !== null) && (typeof theObject === "object") &&
				(theObject.flOdbScript === undefined) && (theObject.flOdbMenubar === undefined) &&
				(theObject.flWpText === undefined) && (theObject.flOdbAddressText === undefined) &&
				(theObject.flAddress === undefined) && (theObject.type === undefined) && (!Array.isArray (theObject))) {
				theQuestion.objectType = "table";
				}
			if ((theObject !== undefined) && (theObject !== null) && (theObject.flOdbMenubar === true)) {
				theQuestion.objectType = "menubar"; //9/3/26 by CC -- a menubar opens in the menubar editor, its own window; it opened in the script editor, one of the places DW found it treated as something it isn't
				}
			if (theExtras !== undefined) {
				Object.keys (theExtras).forEach (function (theName) {
					if (theExtras [theName] !== undefined) {
						theQuestion [theName] = theExtras [theName];
						}
					});
				}
			askUser (theQuestion);
			delete openWindowOnTarget [theAddress.pathText.toLowerCase ()];
			return (true);
			}
		
		verbs ["window.open"] = function (args, environment) { //window.open (@adr, flReadonly, adrButtonTable) -- his edit script's last line
			const theAddress = verbs ["lang.address"] ([args [0]], environment); //9/12/26 by CC -- a text address is an address here too (see edit above)
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't open a window because the first parameter isn't the address of the object to open.";
				throw new Error (message);
				}

			/*  9/3/26 by CC -- THE THIRD PARAMETER AND THE TITLE. The edit glue
				(system.verbs.globals.edit, PBS 2000, BS 2001) does target.set
				(adr), window.setTitle (adr, windowTitle), then window.open
				(adr, flReadOnly, adrButtonTable). This verb took only the
				first parameter, so nodeEditorSuite.openProjectWindow's
				buttons table never reached the window -- DW's 9/3 report:
				"the buttons don't show up at the top of a project window.
				this used to work." (It worked while edit reached the
				JavaScript verb directly, before the 8/21 flip put his glue
				first.) The buttons ride along now, and so does the title
				window.setTitle gave the object before the window opened --
				in the kernel target.set had already opened a hidden window
				for setTitle to name.  */

			const theExtras = {flReadonly: (args [1] === true) ? true : undefined};
			const adrButtons = args [2];
			if ((adrButtons !== undefined) && (adrButtons !== null) && (adrButtons.flAddress === true)) {
				theExtras.buttonsAddress = adrButtons.pathText;
				}
			const thePendingTitle = thePendingTitles [theAddress.pathText.toLowerCase ()];
			if (thePendingTitle !== undefined) {
				theExtras.title = thePendingTitle;
				delete thePendingTitles [theAddress.pathText.toLowerCase ()];
				}
			return (openWindowOnAddress (theAddress, environment, theExtras));
			};
		
		/*  8/22/26 by CC -- LANG.EDIT, the last line of DW's own edit script.
			Nothing implemented it, so edit on anything its UserTalk half
			didn't handle answered "Can't call the kernel verb lang.edit" --
			which is what he saw when he asked for an object that wasn't
			there.
			
			editvalue in langverbs.c: an EXTERNAL value (a table, script,
			menubar, outline, wptext) gets its own window and becomes the
			target; anything else is a scalar, and the kernel calls
			tablezoomtoname -- the table holding it opens. Either way the
			verb answers TRUE, and so does ours -- an 8/24 change to answer
			the address was undone the same day, DW's ruling: "i don't have
			the power to change what edit returns."  */
		
		verbs ["lang.edit"] = function (args, environment) {
			const theAddress = verbs ["lang.address"] ([args [0]], environment);
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't edit the object because the parameter isn't an address.";
				throw new Error (message);
				}
			var theObject;
			try {
				theObject = theAddress.reference.get ();
				}
			catch (err) {
				theObject = undefined;
				}
			if (theObject === undefined) {
				const message = "Can't edit " + theAddress.pathText + " because there's no object at that address.";
				throw new Error (message);
				}
			
			const flWindowBased = ((theObject !== null) && (typeof theObject === "object") &&
				(theObject.flAddress !== true) && (theObject.flOdbAddressText !== true) && (!Array.isArray (theObject)) &&
				(!(theObject instanceof Date)));
			
			if (flWindowBased) {
				openWindowOnAddress (theAddress, environment);
				verbs ["target.set"] ([theAddress], environment); //editvalue sets the target too, "for future editing verbs"
				return (true);
				}

			const thePath = String (theAddress.pathText);
			const ixLastDot = thePath.lastIndexOf (".");
			if (ixLastDot === -1) {
				const message = "Can't edit " + thePath + " because it's a value with no table around it to open.";
				throw new Error (message);
				}
			const adrTable = verbs ["lang.address"] ([thePath.slice (0, ixLastDot)], environment);
			openWindowOnAddress (adrTable, environment);
			return (true);
			};
		
		verbs ["dialog.ask"] = function (args) { //dialog.ask (prompt, @answer) -- true on OK, the text lands at the address
			const thePrompt = String (args [0]);
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't ask because the second parameter isn't the address the answer goes to.";
				throw new Error (message);
				}
			var startValue;
			try {
				startValue = theAddress.reference.get (); //8/16/26 by CC -- an address nobody has answered yet has no value, and reading one throws now (the kernel's way); the first ask starts empty and OK writes the answer there
				}
			catch (err) {
				startValue = "";
				}
			if (typeof startValue !== "string") {

				/*  9/15/26 by CC -- THE START VALUE IS COERCED TO TEXT, the
					kernel's askverb (langdialog.c) reads the cell with
					getstringvalue. An address showed as an empty field: DW's
					9/15 report, the Bookmarks menu's "Add this item" dialog
					opened blank, where bookmarksMenu.getLogic had put the
					object's address in the title cell.  */

				if ((startValue !== undefined) && (startValue !== null) && (startValue.flAddress === true)) {
					startValue = (startValue.pathText === undefined) ? "" : String (startValue.pathText);
					}
				else {
					startValue = ((startValue === undefined) || (startValue === null)) ? "" : String (startValue);
					}
				}
			const theAnswer = askUser ({kind: "ask", prompt: thePrompt, startValue});
			if (theAnswer.button !== "ok") {
				return (false);
				}
			theAddress.reference.set (String (theAnswer.text));
			return (true);
			};
		}

	function installEditorVerbs (verbs) {

		/*  8/8/26 by CC -- the op verbs operate on the WINDOW the script ran
			from: a button click's script collapses that window's outline, a
			menu command reads the frontmost window's line. Each call rides
			the same channel as a dialog -- the window executes the verb on
			its own outline and answers. In a plain run, with no window on
			the other end, these aren't installed and the error says what's
			missing.  */

		function windowCall (verbName, params) {
			const theAnswer = askUser ({kind: "editorverb", verb: verbName, params});
			if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.message !== undefined)) {
				throw new Error (theAnswer.message);
				}
			return (((theAnswer === undefined) || (theAnswer === null)) ? undefined : theAnswer.value);
			}

		/*  9/6/26 by CC -- fileMenu.saveCopy (path) writes the FRONTMOST
			window's database (shellverbs.c, savecopyfunc: shellsaveas on
			shellwindow). The library verb (verbs.js) does the writing and asks
			environment.frontmostWindowText which window is in front; here,
			where the window channel is, the answer is window.frontmost's.  */

		/*  9/29/26 by CC -- AN IMPORT CLOSES THE WINDOWS ON WHAT IT REPLACED.
			fatPages.unpackOdbObject writes the imported object with unpack
			(@data, adrDest); the kernel disposes the old value, and its
			windows go with it (tableclosewindows). Here the old text stayed
			on screen, editable -- DW's 9/29 report -- so after a successful
			unpack to an address the page is told, and every window on that
			address or under it closes. His call: "i would just close the
			window if it was imported. what you were looking at is gone, no
			one will notice. an import is a big thing."  */

		const theLibraryUnpack = verbs ["lang.unpack"];
		verbs ["lang.unpack"] = function (args, environment) {
			const theAnswer = theLibraryUnpack (args, environment);
			const adrDest = args [1];
			if ((adrDest !== undefined) && (adrDest !== null) && (adrDest.flAddress === true) && (adrDest.pathText !== undefined)) {
				try {
					windowCall ("objectreplaced", [String (adrDest.pathText)]);
					}
				catch (err) { //no window on the other end: nothing to close
					}
				}
			return (theAnswer);
			};
		verbs ["unpack"] = verbs ["lang.unpack"];

		const theLibrarySaveCopy = verbs ["filemenu.savecopy"];
		verbs ["filemenu.savecopy"] = function (args, environment) {
			environment.frontmostWindowText = function () {
				const theAnswer = windowCall ("window.frontmost", []);
				return (((theAnswer === undefined) || (theAnswer === null)) ? "" : String (theAnswer));
				};
			return (theLibrarySaveCopy (args, environment));
			};

		function jsonSafe (theValue) { //what travels: scalars; anything else goes as its text
			if ((theValue === undefined) || (theValue === null)) {
				return (undefined);
				}
			if ((typeof theValue === "string") || (typeof theValue === "number") || (typeof theValue === "boolean")) {
				return (theValue);
				}
			if (theValue.flAddress === true) { //8/13/26 by CC -- an address reads as its path -- window.msg (adr) said "[object Object]" where Berkeley says "scratchpad.tmp"
				return (String (theValue.pathText));
				}
			if (theValue instanceof Date) { //8/13/26 by CC -- and a date reads the Frontier way
				return (dates.frontierDateToString (theValue));
				}
			if (Array.isArray (theValue)) { //9/2/26 by CC -- a list travels as a list: op.setExpansionState takes the list op.getExpansionState answered, and as text it was "1,2,3" and the verb stopped on theList.forEach -- the backup command's second failure of 9/2
				const theItems = [];
				theValue.forEach (function (theItem) {
					theItems.push (jsonSafe (theItem));
					});
				return (theItems);
				}
			return (String (theValue));
			}

		verbs ["file.getfiledialog"] = function (args) {

			/*  8/16/26 by CC -- the kernel verb, implemented to Berkeley's glue
				contract: on getFileDialog (prompt, adr, type). The app puts up a
				real Mac open-file dialog over the window the script ran from;
				OK writes the chosen file's colon path at adr and answers true,
				Cancel answers false. The dialog is seeded from adr's current
				value when there is one, the kernel's way. The type filter is
				accepted and not yet applied -- the dialog shows every file.

				8/26/26 by CC -- the type parameter is REQUIRED, the way the
				kernel requires it: gettypelistvalue (fileverbs.c) reads
				parameter 3 and fails without it, and 0 is the value that
				means every file. DW hit the difference running his
				importCommand on Berkeley -- Atlantis let the call through
				without the parameter, Berkeley stopped it. A script written
				against the liberal version breaks on real Frontier, so the
				liberal version is the bug.  */

			const thePrompt = (args [0] === undefined) ? "" : String (args [0]);
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't put up the file dialog because the second parameter isn't the address the answer goes to.";
				throw new Error (message);
				}
			if (args [2] === undefined) {
				const message = "Can’t call “getFileDialog” because there aren’t enough parameters."; //right single quote, left double quote, right double quote -- the kernel's own sentence
				throw new Error (message);
				}
			var startPath = "";
			try {
				const startValue = theAddress.reference.get ();
				if (typeof startValue === "string") {
					startPath = startValue;
					}
				}
			catch (err) {
				}
			const theAnswer = windowCall ("desktop.getfiledialog", [thePrompt, startPath]);
			if ((theAnswer === undefined) || (theAnswer === null) || (theAnswer.flOk !== true)) {
				return (false);
				}
			theAddress.reference.set (String (theAnswer.colonPath));
			return (true);
			};

		verbs ["file.putfiledialog"] = function (args) {

			/*  8/17/26 by CC -- on putFileDialog (prompt, adr, defaultName): the
				save dialog, the same shape as getFileDialog above. OK writes the
				chosen path at adr and answers true; Cancel answers false.  */

			const thePrompt = (args [0] === undefined) ? "" : String (args [0]);
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't put up the save dialog because the second parameter isn't the address the answer goes to.";
				throw new Error (message);
				}
			var startPath = "";
			try {
				const startValue = theAddress.reference.get ();
				if (typeof startValue === "string") {
					startPath = startValue;
					}
				}
			catch (err) {
				}
			const theDefaultName = (args [2] === undefined) ? "" : String (args [2]);
			const theAnswer = windowCall ("desktop.putfiledialog", [thePrompt, startPath, theDefaultName]);
			if ((theAnswer === undefined) || (theAnswer === null) || (theAnswer.flOk !== true)) {
				return (false);
				}
			theAddress.reference.set (String (theAnswer.colonPath));
			return (true);
			};

		verbs ["file.getfolderdialog"] = function (args) { //8/17/26 by CC -- on getFolderDialog (prompt, adr): pick a folder, path ends with a colon

			const thePrompt = (args [0] === undefined) ? "" : String (args [0]);
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't put up the folder dialog because the second parameter isn't the address the answer goes to.";
				throw new Error (message);
				}
			var startPath = "";
			try {
				const startValue = theAddress.reference.get ();
				if (typeof startValue === "string") {
					startPath = startValue;
					}
				}
			catch (err) {
				}
			const theAnswer = windowCall ("desktop.getfolderdialog", [thePrompt, startPath]);
			if ((theAnswer === undefined) || (theAnswer === null) || (theAnswer.flOk !== true)) {
				return (false);
				}
			theAddress.reference.set (String (theAnswer.colonPath));
			return (true);
			};

		function urlFromOpenCommand (theCommand) {
			/*  The one shell command that reaches the person's machine: the
				shape the View button's script writes, "open -a 'Google
				Chrome' 'http://...'". What comes back is the url, or
				nothing if the command is anything else.  */
			const theMatch = theCommand.match (/^\s*open\s+(?:-a\s+(?:'[^']*'|"[^"]*"|\S+)\s+)?(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/i);
			if (theMatch === null) {
				return (undefined);
				}
			const theUrl = ((theMatch [1] !== undefined) ? theMatch [1] : ((theMatch [2] !== undefined) ? theMatch [2] : theMatch [3]));
			if ((theUrl.toLowerCase ().startsWith ("http://") !== true) && (theUrl.toLowerCase ().startsWith ("https://") !== true)) {
				return (undefined);
				}
			return (theUrl);
			}

		function urlForViewing (theUrl) {

			/*  8/10/26 by CC -- what View shows. The outline names the page by
				the address it's published at -- http://scripting.com/code/
				sallyreader/worknotes.md -- and uploadScripts wrote its copy
				into a folder named for that address with the slashes turned
				into dashes, which is Frontier's staging convention and DW's
				line: myfolder = string.replaceall (s3path, "/", "-"). So the
				same address, spelled that way, finds the copy this server
				just built. Nothing there means this server didn't build it,
				and the published page opens exactly as it always has.  */

			if (workerData.folderRenders === undefined) {
				return (theUrl);
				}

			var theFolderName, theFileName;
			try {
				const theParsed = new URL (theUrl);
				var thePath = "/" + theParsed.host + theParsed.pathname;
				if (thePath.endsWith ("/")) {
					thePath += "index.html";
					}
				const ixLastSlash = thePath.lastIndexOf ("/");
				theFileName = thePath.slice (ixLastSlash + 1);
				theFolderName = thePath.slice (0, ixLastSlash).split ("/").join ("-");
				while (theFolderName.startsWith ("-")) {
					theFolderName = theFolderName.slice (1);
					}
				while (theFolderName.endsWith ("-")) {
					theFolderName = theFolderName.slice (0, theFolderName.length - 1);
					}
				}
			catch (err) {
				return (theUrl);
				}
			if ((theFolderName.length === 0) || (theFileName.length === 0)) {
				return (theUrl);
				}
			const thePathname = "/" + theFolderName + "/" + theFileName;

			const theFullPath = pathTool.normalize (pathTool.join (workerData.folderRenders, thePathname));
			if (!theFullPath.startsWith (workerData.folderRenders + pathTool.sep)) { //nothing outside the folder, however the path is spelled
				return (theUrl);
				}
			if (!fs.existsSync (theFullPath)) {
				return (theUrl);
				}
			return ("/renders" + thePathname); //relative -- the window resolves it against the server it's talking to
			}

		verbs ["sys.unixshellcommand"] = function (args) {
			/*  8/10/26 by CC -- the View button shells out to open a page in
				the browser. The command belongs on the person's machine, not
				on this server, so it rides the window channel -- and only
				when it names a url to open. Any other command would be a
				script here running whatever it likes over there.  */
			const theCommand = String (args [0]);
			const theUrl = urlFromOpenCommand (theCommand);
			if (theUrl === undefined) {
				const message = "Can't run \"" + theCommand + "\" because the only shell command that reaches your machine is one that opens a url.";
				throw new Error (message);
				}
			windowCall ("openurl", [urlForViewing (theUrl)]);
			return ("");
			};

		verbs ["webbrowser.openurl"] = function (args) { //8/10/26 by CC -- Frontier's own name for it, same channel
			return (windowCall ("openurl", [urlForViewing (String (args [0]))]));
			};

		/*  The hidden target -- 8/14/26 by CC. In Frontier, target.set opens
			the object in a window the user can't see (langsettargetfunc calls
			langzoomvalwindow with flmakevisible false; the window is real,
			flhidden true), and the op verbs act on it. Verified in the kernel
			source, DW's teaching: "behind the scenes the outline is opened in
			a window. the user just can't see it."

			Here the hidden window is an editing context in this worker: the
			lines live in the database (write-through, so a read-only viewer
			polling that object follows the edits live), the cursor lives
			here. An op verb goes to the context ONLY when the target is a
			real address naming something other than what the window that
			started the run is showing -- everything else takes the window
			channel it always took. runSelection's target is window.next's
			empty answer, so it stays on the window path untouched.

			DIVERGENCE, flagged for DW: if a regular editable window is open
			on the targeted object, Frontier's ops act on that window's live
			copy; ours act on the database copy, which that window doesn't
			watch. Read-only viewers follow; editable windows don't.  */

		/*  8/14/26 by CC, from the night review's top finding: each menu
			command is a fresh worker, so a cursor kept here alone resets
			between runs -- and DW's console.log depends on the cursor
			staying where console.start left it, the way Frontier's hidden
			window persists across script runs. The server keeps the map
			across runs: it arrives in workerData and rides home on the
			done and failed messages.  */

		function targetAddressTextForRouting (environment) {
			if ((environment.targetStack === undefined) || (environment.targetStack.length === 0)) {
				return (undefined);
				}
			const theTarget = environment.targetStack [environment.targetStack.length - 1];
			if ((theTarget === undefined) || (theTarget === null)) {
				return (undefined);
				}
			var theText = "";
			if (theTarget.flAddress === true) {
				theText = String (theTarget.pathText);
				}
			else {
				if (typeof theTarget === "string") {
					theText = theTarget;
					}
				}
			if (theText.length === 0) {
				return (undefined);
				}
			return (theText);
			}

		var theWindowAddressText; //the object the originating window shows, asked once
		const commentVerbNames = {"script.iscomment": true, "script.makecomment": true, "script.uncomment": true}; //9/9/26 by CC -- the cursor line's comment flag, on the target like the op verbs

		function flRouteToHiddenTarget (environment, verbName) {
			if (!verbName.startsWith ("op.") && (commentVerbNames [verbName] !== true)) { //window.msg, the wp verbs, the desktop -- always the real window

				/*  9/9/26 by CC -- script.isComment, makeComment and unComment
					used to go to the window whatever the target was. In the
					kernel they read and set the bar cursor's flcomment
					(opverbs.c, iscommentfunc and opcommentverb), and the bar
					cursor is the target's when a target is set. DW's
					releasePart walks a copy of the part under target.set and
					asks script.isComment to decide where the comment is; here
					the answer came from the FRONT window's cursor line, so the
					walk went right or not depending on what he was looking at
					-- "appears not to work in most circumstances."  */

				return (false);
				}
			const theText = targetAddressTextForRouting (environment);
			if (theText === undefined) {
				return (false);
				}
			if (theWindowAddressText === undefined) {
				const theAnswer = windowCall ("window.frontmost", []);
				theWindowAddressText = ((theAnswer === undefined) || (theAnswer === null)) ? "" : String (theAnswer);
				}
			return (theText.toLowerCase () !== theWindowAddressText.toLowerCase ());
			}

		/*  8/15/26 by CC -- DW's rule, answering the divergence flagged 8/14:
			"if you set the target to an already-open window you don't create
			another target window, you use the one that's already open." His
			sequence, which he says is all over his code: adr = @scratchpad
			.hello; edit (adr); target.set (adr). So before an op goes to the
			database context, the pages are asked whether a window is open on
			the target -- if one is, the op runs IN that window, live, the
			way Frontier acts on the open window's copy. The person watches
			it happen, and there's no second copy for a save to clobber.

			The question is asked once per address per run (the cache lives at
			module scope, shared with the edit verb, which forgets the answer
			for the address it opened, since the answer just changed).  */

		function flWindowOpenOnTarget (theAddressText) {
			const theKey = theAddressText.toLowerCase ();
			if (openWindowOnTarget [theKey] === undefined) {
				var theAnswer;
				try {
					theAnswer = windowCall ("window.isopen", [theAddressText]);
					}
				catch (err) {
					theAnswer = false; //a page from before this question existed -- the database path still works
					}
				openWindowOnTarget [theKey] = (theAnswer === true);
				}
			return (openWindowOnTarget [theKey]);
			}

		function windowCallTargeted (verbName, params, theTargetAddressText) { //the originating page forwards this to the window showing the target
			const theAnswer = askUser ({kind: "editorverb", verb: verbName, params, targetAddress: theTargetAddressText});
			if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.message !== undefined)) {
				throw new Error (theAnswer.message);
				}
			return (((theAnswer === undefined) || (theAnswer === null)) ? undefined : theAnswer.value);
			}

		function hiddenTargetCall (environment, verbName, rawArgs) {

			const args = []; //dates and addresses become their Frontier text, same as the window channel
			rawArgs.forEach (function (theArg) {
				args.push (jsonSafe (theArg));
				});

			const theAddressText = targetAddressTextForRouting (environment);

			/*  9/2/26 by CC -- THE TARGET'S OWN REFERENCE COMES FIRST. The
				target was looked up by its TEXT, in the database, which can't
				see a script's locals -- and op.outlineToXml's glue copies the
				outline into a local, target.set (@localoutline), and runs the
				op verbs on that. So the backup command died on "the target
				localoutline isn't an outline" (DW's 9/2 fire alarm). The
				address the script handed target.set already knows where its
				value lives, local or database; the text lookup is only for a
				target set as text.  */

			var theAddress;
			const theTarget = environment.targetStack [environment.targetStack.length - 1];
			if ((theTarget !== undefined) && (theTarget !== null) && (theTarget.flAddress === true) && (theTarget.reference !== undefined)) {
				theAddress = theTarget;
				}
			else {
				theAddress = verbs ["lang.address"] ([theAddressText], environment);
				}
			var theValue;
			try {
				theValue = theAddress.reference.get ();
				}
			catch (err) {
				theValue = undefined; //a name that reaches nothing reads as no target, and the sentence below says so
				}
			const flMenubar = (theValue !== undefined) && (theValue !== null) && (theValue.flOdbMenubar === true); //8/15/26 by CC -- a menubar is outline lines too; newProjectCommand aims ops at nodeEditorSuite.menu
			if ((theValue === undefined) || (theValue === null) || ((theValue.flOdbScript !== true) && !flMenubar) || (!Array.isArray (theValue.lines))) {
				const message = "Can't do " + verbName + " because the target " + theAddressText + " isn't an outline, a script or a menubar.";
				throw new Error (message);
				}
			const theLines = theValue.lines.slice ();
			if (theLines.length === 0) {
				theLines.push ({level: 0, text: "", flExpanded: true, flComment: false, flBreakpoint: false}); //there is no zero-line outline in Frontier -- night review, 8/14/26
				}
			var cursor = hiddenTargetCursors [theAddressText.toLowerCase ()];
			if ((cursor === undefined) || (cursor < 0) || (cursor >= theLines.length)) {
				cursor = 0; //a window opens with the cursor on the first summit
				}

			function save () {
				if (flMenubar) {
					theAddress.reference.set ({flOdbMenubar: true, lines: theLines});
					}
				else {
					theAddress.reference.set ({flOdbScript: true, scriptType: theValue.scriptType, lines: theLines});
					}
				}
			function cleanLineText (theText) {
				return (String (theText).replace (/[\r\n]+/g, " ")); //an outline line can't contain a line break -- this write path must not re-plant the bug the OPML boundary just fixed
				}
			function makeLine (theText, theLevel) {
				return ({level: theLevel, text: cleanLineText (theText), flExpanded: true, flComment: false, flBreakpoint: false});
				}
			function ixAfterSubtree (ix) { //the place just past a line and everything under it
				var ixNext = ix + 1;
				while ((ixNext < theLines.length) && (theLines [ixNext].level > theLines [ix].level)) {
					ixNext++;
					}
				return (ixNext);
				}

			function linesFromDepositText (theText) { //8/15/26 by CC -- a multi-line text is an outline to build; [{level, text}], shallowest at 0
				const theDeposit = [];
				var minLevel;
				String (theText).split ("\n").forEach (function (theLine) {
					const withoutTabs = theLine.replace (/^\t+/, "");
					const theLevel = theLine.length - withoutTabs.length;
					if (withoutTabs.trim ().length === 0) {
						return;
						}
					if ((minLevel === undefined) || (theLevel < minLevel)) {
						minLevel = theLevel;
						}
					theDeposit.push ({level: theLevel, text: withoutTabs});
					});
				theDeposit.forEach (function (theLine) {
					theLine.level -= minLevel;
					});
				return (theDeposit);
				}

			var theResult = true;
			switch (verbName) {
				case "op.getlinetext":
					theResult = theLines [cursor].text;
					break;
				case "script.iscomment": //9/9/26 by CC -- iscommentfunc: the bar cursor's own flag, not a parent's
					theResult = (theLines [cursor].flComment === true);
					break;
				case "script.makecomment": case "script.uncomment": { //opcommentverb
					theLines [cursor].flComment = (verbName === "script.makecomment");
					save ();
					theResult = true;
					break;
					}
				case "op.setlinetext": {
					const theText = String (args [0]);
					if (theText.indexOf ("\n") !== -1) { //smashing an old outline deposit: first line replaces the text, the rest replace the subtree
						const theDeposit = linesFromDepositText (theText);
						const theRootLevel = theLines [cursor].level;
						theLines [cursor] = Object.assign ({}, theLines [cursor], {text: cleanLineText (theDeposit [0].text), flExpanded: true});
						const ixNext = ixAfterSubtree (cursor);
						const theChildren = [];
						theDeposit.slice (1).forEach (function (theLine) {
							theChildren.push (makeLine (theLine.text, theRootLevel + 1 + theLine.level));
							});
						theLines.splice (cursor + 1, ixNext - cursor - 1);
						theChildren.forEach (function (theLine, ix) {
							theLines.splice (cursor + 1 + ix, 0, theLine);
							});
						}
					else {
						theLines [cursor] = Object.assign ({}, theLines [cursor], {text: cleanLineText (theText)});
						}
					save ();
					break;
					}
				case "op.insert": {
					const theText = String (args [0]).replace (/\r\n|\r/g, "\n"); //9/21/26 by CC -- a RETURN makes it outline text: the kernel's isoutlinetext looks for chreturn, Frontier's line ending, and opinserthandle then deposits a structure. Only a linefeed counted here, so script.newScriptObject ("on x ()\r\treturn (5)", adr) made one line with a return in it -- mainResponder.startup makes its callbacks that way
					const theDirection = String (args [1]).toLowerCase ();
					const theDeposit = (theText.indexOf ("\n") !== -1) ? linesFromDepositText (theText) : [{level: 0, text: theText}];
					var ixNew, theBaseLevel;
					switch (theDirection) {
						case "up":
							ixNew = cursor;
							theBaseLevel = theLines [cursor].level;
							break;
						case "right":
							ixNew = cursor + 1;
							theBaseLevel = theLines [cursor].level + 1;
							break;
						default: //down -- a sibling below the cursor line, past its subtree
							ixNew = ixAfterSubtree (cursor);
							theBaseLevel = theLines [cursor].level;
							break;
						}
					theDeposit.forEach (function (theLine, ix) {
						theLines.splice (ixNew + ix, 0, makeLine (theLine.text, theBaseLevel + theLine.level));
						});
					cursor = ixNew; //the cursor moves to the (first) new line, the way the editor does it
					save ();
					break;
					}
				case "script.iscomment": //9/4/26 by CC -- the comment flag on the cursor line, for a script running on a hidden target (Toggle Comment, clock.timeStamp, runSelection)
					theAnswer = (theLines [cursor].flComment === true);
					break;
				case "script.makecomment":
					theLines [cursor].flComment = true;
					save ();
					theAnswer = true;
					break;
				case "script.uncomment":
					theLines [cursor].flComment = false;
					save ();
					theAnswer = true;
					break;
				case "op.demote": { //9/4/26 by CC -- opdemote in opstructure.c: every head at the cursor's level below it moves to the end of the cursor's subs, its own subs along
					const theLevel = theLines [cursor].level;
					var ix = ixAfterSubtree (cursor);
					var flMoved = false;
					while ((ix < theLines.length) && (theLines [ix].level >= theLevel)) {
						theLines [ix].level = theLines [ix].level + 1;
						flMoved = true;
						ix++;
						}
					if (flMoved) {
						theLines [cursor].flExpanded = true; //opexpand (hcursor, 1): the subs are visible
						save ();
						}
					theAnswer = flMoved; //oplastinlist: nothing below at this level answers false
					break;
					}
				case "op.promote": { //oppromote: every sub of the cursor moves out one level, in its order
					const theLevel = theLines [cursor].level;
					const ixEnd = ixAfterSubtree (cursor);
					if (ixEnd === cursor + 1) {
						theAnswer = false; //ophassubheads: nothing to promote
						break;
						}
					var ixSub;
					for (ixSub = cursor + 1; ixSub < ixEnd; ixSub++) {
						theLines [ixSub].level = theLines [ixSub].level - 1;
						}
					save ();
					theAnswer = true;
					break;
					}
				case "op.deleteline": {
					const ixNext = ixAfterSubtree (cursor);
					theLines.splice (cursor, ixNext - cursor);
					if (theLines.length === 0) {
						theLines.push (makeLine ("", 0)); //an outline always has a line, the way opnewsummit leaves one
						}
					if (cursor >= theLines.length) {
						cursor = theLines.length - 1;
						}
					save ();
					break;
					}
				case "op.firstsummit":
					cursor = 0;
					break;
				case "op.fullcollapse":
					theLines.forEach (function (theLine) {
						theLine.flExpanded = false;
						});
					save ();
					break;
				case "op.fullexpand":
					theLines.forEach (function (theLine) {
						theLine.flExpanded = true;
						});
					save ();
					break;
				case "op.expand": { //9/24/26 by CC -- opexpand (hnode, ctlevels): the count says how many levels down open; infinity (here null) is all of them
					const theCount = ((args [0] === undefined) || (args [0] === null)) ? ((args [0] === null) ? Infinity : 1) : Number (args [0]);
					const theLevel = theLines [cursor].level;
					theLines [cursor] = Object.assign ({}, theLines [cursor], {flExpanded: true});
					if (theCount > 1) {
						var ixSub;
						for (ixSub = cursor + 1; (ixSub < theLines.length) && (theLines [ixSub].level > theLevel); ixSub++) {
							if (theLines [ixSub].level - theLevel < theCount) {
								theLines [ixSub] = Object.assign ({}, theLines [ixSub], {flExpanded: true});
								}
							}
						}
					save ();
					theAnswer = true;
					break;
					}
				case "op.collapse":
					theLines [cursor] = Object.assign ({}, theLines [cursor], {flExpanded: false});
					save ();
					break;
				case "op.go": {

					/*  8/15/26 by CC -- the kernel's semantics, DW's ruling
						8/15 ("on 3 the kernel is right"): down means the NEXT
						SIBLING, not the next flat line; the flat moves land
						only on VISIBLE lines, honoring expansion; and a move
						that gets partway there answers true -- false only
						when it couldn't move at all. Concord's go on the
						window side already behaves this way.  */

					const theDirection = String (args [0]).toLowerCase ();
					var ctMoves = (args [1] === undefined) ? 1 : Number (args [1]);
					function flVisible (ix) { //visible = every ancestor expanded
						var theLevel = theLines [ix].level;
						var ixUp = ix - 1;
						while ((ixUp >= 0) && (theLevel > 0)) {
							if (theLines [ixUp].level < theLevel) {
								if (theLines [ixUp].flExpanded !== true) {
									return (false);
									}
								theLevel = theLines [ixUp].level;
								}
							ixUp--;
							}
						return (true);
						}
					var ctMoved = 0;
					while (ctMoves > 0) {
						var ixTo = -1;
						switch (theDirection) {
							case "down": { //the next sibling -- same level, before anything shallower
								var ixDown = cursor + 1;
								while ((ixDown < theLines.length) && (theLines [ixDown].level > theLines [cursor].level)) {
									ixDown++;
									}
								if ((ixDown < theLines.length) && (theLines [ixDown].level === theLines [cursor].level)) {
									ixTo = ixDown;
									}
								break;
								}
							case "up": { //the previous sibling
								var ixPrev = cursor - 1;
								while ((ixPrev >= 0) && (theLines [ixPrev].level > theLines [cursor].level)) {
									ixPrev--;
									}
								if ((ixPrev >= 0) && (theLines [ixPrev].level === theLines [cursor].level)) {
									ixTo = ixPrev;
									}
								break;
								}
							case "flatdown": { //the next visible line
								var ixNext = cursor + 1;
								while ((ixNext < theLines.length) && !flVisible (ixNext)) {
									ixNext++;
									}
								if (ixNext < theLines.length) {
									ixTo = ixNext;
									}
								break;
								}
							case "flatup": { //the previous visible line
								var ixBack = cursor - 1;
								while ((ixBack >= 0) && !flVisible (ixBack)) {
									ixBack--;
									}
								if (ixBack >= 0) {
									ixTo = ixBack;
									}
								break;
								}
							case "left": { //to the parent -- the nearest line above with a shallower level
								var ixUp = cursor - 1;
								while ((ixUp >= 0) && (theLines [ixUp].level >= theLines [cursor].level)) {
									ixUp--;
									}
								ixTo = ixUp;
								break;
								}
							case "right": //to the first child, if there is one
								ixTo = ((cursor + 1 < theLines.length) && (theLines [cursor + 1].level > theLines [cursor].level)) ? cursor + 1 : -1;
								break;
							}
						if (ixTo === -1) {
							break;
							}
						cursor = ixTo;
						ctMoved++;
						ctMoves--;
						}
					theResult = ctMoved > 0;
					break;
					}
				case "op.getcursor":
					theResult = cursor;
					break;
				case "op.setcursor": {
					const theIndex = Number (args [0]);
					if ((theIndex >= 0) && (theIndex < theLines.length)) {
						cursor = theIndex;
						}
					break;
					}
				case "op.subsexpanded":
					theResult = ((cursor + 1 < theLines.length) && (theLines [cursor + 1].level > theLines [cursor].level) && (theLines [cursor].flExpanded === true));
					break;
				case "op.getdisplay": case "op.setdisplay":
					break; //politely, the way the window answers
				case "op.getscrollstate": //9/2/26 by CC -- a hidden target has no scroll bar; the first line is what shows (opgetscrollstateverb answers the line at the top of the window). op.outlineToXml's glue reads and restores it on its local copy of the outline -- the backup command's third stop of 9/2
					theResult = 1;
					break;
				case "op.setscrollstate":
					break; //nothing to scroll; true

				/*  8/20/26 by CC -- the expansion state of an outline that has
					no window on it. Same two rules as the window's side: the
					numbers count the VISIBLE lines, one-based, and a line
					counts when it has subheads and they're showing.  */

				case "op.getexpansionstate": case "op.setexpansionstate": {
					function flLineVisible (ix) { //every ancestor expanded
						var theLevel = theLines [ix].level;
						var ixUp = ix - 1;
						while ((ixUp >= 0) && (theLevel > 0)) {
							if (theLines [ixUp].level < theLevel) {
								if (theLines [ixUp].flExpanded !== true) {
									return (false);
									}
								theLevel = theLines [ixUp].level;
								}
							ixUp--;
							}
						return (true);
						}
					function flHasSubs (ix) {
						return ((ix + 1 < theLines.length) && (theLines [ix + 1].level > theLines [ix].level));
						}
					function visibleIndexes () {
						const theIndexes = [];
						theLines.forEach (function (theLine, ix) {
							if (flLineVisible (ix)) {
								theIndexes.push (ix);
								}
							});
						return (theIndexes);
						}
					if (verbName === "op.getexpansionstate") {
						const theState = [];
						visibleIndexes ().forEach (function (ix, ixVisible) {
							if (flHasSubs (ix) && (theLines [ix].flExpanded === true)) {
								theState.push (ixVisible + 1);
								}
							});
						theResult = theState;
						break;
						}
					const theNumbers = {};
					const theList = (args [0] === undefined) ? [] : args [0];
					theList.forEach (function (theNumber) {
						theNumbers [Number (theNumber)] = true;
						});
					var ixVisibleLine = 0;
					while (true) {
						const theIndexes = visibleIndexes ();
						if (ixVisibleLine >= theIndexes.length) {
							break;
							}
						const ixLine = theIndexes [ixVisibleLine];
						ixVisibleLine++;
						if (flHasSubs (ixLine)) {
							theLines [ixLine].flExpanded = (theNumbers [ixVisibleLine] === true);
							}
						}
					theResult = true;
					break;
					}
				case "op.level": //9/25/26 by CC -- oplevel: 1 for a summit, one more for each level in; docserver.root's renderer asks it while rendering a verb page on a hidden target
					theResult = theLines [cursor].level + 1;
					break;
				default: {
					const message = "Can't do " + verbName + " on a hidden target yet.";
					throw new Error (message);
					}
				}
			hiddenTargetCursors [theAddressText.toLowerCase ()] = cursor;
			return (theResult);
			}

		const windowVerbNames = [
			"op.fullcollapse", "op.fullexpand", "op.expand", "op.collapse",
			"op.firstsummit", "op.go", "op.getlinetext", "op.setlinetext",
			"speaker.beep",
			"op.getcursor", "op.setcursor", "op.insert", //8/11/26 by CC -- what runSelection needs to deposit a result under the line
			"op.deleteline", //8/14/26 by CC -- night review: the hidden-target case existed but the stub answered first; now both paths are real
			"op.subsexpanded", //8/12/26 by CC -- clock.timeStamp asks, to know whether the stamp goes below the line or under it
			"wp.intextmode", "wp.insert", //8/13/26 by CC -- cmd-4's real path: the stamp goes INTO the line, at the insertion point
			"op.sethtmlformatting", "op.gethtmlformatting", //10/3/26 by CC -- sethtmlformattingfunc and gethtmlformattingfunc (opverbs.c, 7.0b28): the outline window's HTML formatting flag, Concord's render mode here; the HTML menu's cmd-` toggles with them (=html.menu.formatText ())
			"op.attributes.edit", //10/3/26 by CC -- the attribute editor dialog on the cursor line, DW's 10/3 ask; cribbed from Drummer
			"op.attributes.setone", "op.attributes.makeempty", "op.attributes.deleteone", //10/8/26 by CC -- the cursor line's attributes, over Concord's own setOne/makeEmpty/addGroup; the 2000 glue packed them into the line's refcon with op.setRefcon, which has no home here. getOne and addGroup take an address and are below, beside getAll
			"script.iscomment", "script.makecomment", "script.uncomment",
			"op.promote", "op.demote", "op.reorg", "op.deletesubs", "op.level", //8/19/26 by CC -- the op family grows; each one checked against the kernel before it was written, see misc/theStringAndOpVerbs.md
			"op.countsubs", "op.countsummits", "op.getheadnumber", "op.setmodified", "op.getsuboutline",
			"op.getexpansionstate", "op.setexpansionstate", //8/20/26 by CC -- op.outlineToXml reads the state, writes the file and puts it back; op.xmlToOutline restores it
			"op.getscrollstate", "op.setscrollstate", //8/20/26 by CC -- the one-based line number of the first line showing
			"clipboard.putvalue", "clipboard.get", //8/20/26 by CC -- clipboard.put has its own verb below (9/12/26), the kernel's (type, adr) shape
			"op.getdisplay", "op.setdisplay", //the page's display is always on; they answer politely
			"window.next", //there is no window behind this one; runSelection tries and moves on
			"window.msg", //the little status line in the corner of the window
			"window.zoom", "window.isreadonly", "window.ismodified", "window.setmodified", //9/14/26 by CC -- from the unbuilt list: zoomverb, isreadonlyverb, ismodifiedverb, setmodifiedverb in shellwindowverbs.c -- true when a window is open on the address, false when none is; the page finds the window over the window channel
			"desktop.putfiledialog", "desktop.getfolderdialog" //8/17/26 by CC -- the save and folder dialogs, the app puts them up; desktop.writeWholeFile came OUT 8/24, DW's ruling -- he rewrote the backup command and "it was an attempt at security which would have made frontier something very different than what it is"
			];
		/*  8/20/26 by CC -- THE WINDOW GEOMETRY VERBS, which don't fit the
			forwarding above because of their shape. They name the object whose
			window it is -- window.getPosition (@system.verbs, @horiz, @vert) --
			and the reading ones ANSWER through the addresses they were handed
			rather than returning the numbers. getboundsverb in the kernel does
			exactly that: hashtableassign into each of the two variables, and a
			boolean saying whether a window was open at all.  */

		function addressTextOf (theArg) {
			if ((theArg === undefined) || (theArg === null)) {
				return ("");
				}
			if (theArg.flAddress === true) {
				return (String (theArg.pathText));
				}
			if (theArg.flOdbAddressText === true) {
				return (String (theArg.path));
				}
			return (String (theArg));
			}

		function assignThrough (theArg, theValue) {
			if ((theArg !== undefined) && (theArg !== null) && (theArg.reference !== undefined) && (theArg.reference.set !== undefined)) {
				theArg.reference.set (theValue);
				}
			}

		function geometryOf (theArg, theChange) {
			return (windowCall ("window.getposition", [addressTextOf (theArg), theChange]));
			}

		verbs ["window.getposition"] = function (args) {
			const theGeometry = geometryOf (args [0]);
			if ((theGeometry === undefined) || (theGeometry.flOpen !== true)) {
				return (false);
				}
			assignThrough (args [1], theGeometry.x);
			assignThrough (args [2], theGeometry.y);
			return (true);
			};

		verbs ["window.getsize"] = function (args) {
			const theGeometry = geometryOf (args [0]);
			if ((theGeometry === undefined) || (theGeometry.flOpen !== true)) {
				return (false);
				}
			assignThrough (args [1], theGeometry.width);
			assignThrough (args [2], theGeometry.height);
			return (true);
			};

		verbs ["window.setposition"] = function (args) {
			const theGeometry = geometryOf (args [0], {x: Number (args [1]), y: Number (args [2])});
			return ((theGeometry !== undefined) && (theGeometry.flOpen === true));
			};

		verbs ["window.setsize"] = function (args) {
			const theGeometry = geometryOf (args [0], {width: Number (args [1]), height: Number (args [2])});
			return ((theGeometry !== undefined) && (theGeometry.flOpen === true));
			};

		/*  8/23/26 by CC -- gettitleverb, Common/source/shellwindowverbs.c:
			"if it's not an external value or a window, always return the
			empty string". It ALWAYS answers a string. Ours answered a table
			-- the window channel hands back a geometry record, and the
			second of two definitions of this verb returned that record raw,
			so DW's backup wrote a file called [objectObject].DW0062.opml.
			The second definition is gone; this one is what the kernel does,
			and String () is here because a title that arrives as anything
			else is still a title.  */

		verbs ["window.gettitle"] = function (args) {
			const theGeometry = geometryOf (args [0]);
			if ((theGeometry === undefined) || (theGeometry.flOpen !== true)) {
				return ("");
				}
			return ((theGeometry.title === undefined) ? "" : String (theGeometry.title));
			};

		verbs ["window.settitle"] = function (args) {
			const theGeometry = geometryOf (args [0], {title: String (args [1])});
			const flOpen = ((theGeometry !== undefined) && (theGeometry.flOpen === true));
			if (!flOpen && (args [0] !== undefined) && (args [0] !== null) && (args [0].flAddress === true)) { //9/3/26 by CC -- no window yet: the title waits for window.open (the edit glue names the window before it opens it)
				thePendingTitles [args [0].pathText.toLowerCase ()] = String (args [1]);
				}
			return (flOpen);
			};

		verbs ["clipboard.put"] = function (args, environment) { //clipboard.put (type, adr) -- the kernel's shape, what the clipboard.putValue glue calls: local (x = binary (value)); clipboard.put (getBinaryType (x), @x)

			/*  9/12/26 by CC -- DW's 9/12 report on Copy Address: the clipboard
				got "????". The glue hands this verb the TYPE first and the
				ADDRESS of the binary second, and the page's handler read the
				first parameter as the text -- so the type code went to the
				clipboard, and for a binary made from a string that code is
				unknown, "????". The value at the address is what goes over;
				the page keeps taking the text as its first parameter.  */

			const adrValue = args [1];
			var theValue = adrValue;
			if ((adrValue !== undefined) && (adrValue !== null) && (adrValue.flAddress === true)) {
				theValue = adrValue.reference.get ();
				}
			const theText = ((theValue === undefined) || (theValue === null)) ? "" : String (theValue);
			return (windowCall ("clipboard.put", [theText]) === true);
			};

		verbs ["window.quickscript"] = function (args) { //9/16/26 by CC -- quickscriptfunc (shellwindowverbs.c): open the Quick Script window, startcmddialog; the app opens it the way it opens the About window
			return (windowCall ("window.quickscript", []) === true);
			};
		verbs ["window.setquickscript"] = function (args) { //9/16/26 by CC -- setquickscriptfunc: the text in the Quick Script window, cmdsetstring; kept with the database (hscriptstring in the root record), the page reads it when it opens
			const theText = ((args [0] === undefined) || (args [0] === null)) ? "" : String (args [0]); //9/26/26 by CC -- DW's report: the window opened saying "undefined"; a call with nothing to set stores the empty string, never the JavaScript word
			const theAnswer = askServerFor ("setting", {op: "set", name: "quickScript", value: theText});
			if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.message !== undefined)) {
				throw new Error (theAnswer.message);
				}
			return (true);
			};
		verbs ["window.about"] = function (args) {
			return (windowCall ("window.about", []) === true);
			};

		verbs ["window.update"] = function (args) { //9/13/26 by CC -- updateverb (shellwindowverbs.c): redraw the window on adr, true; false when no window is open on it. Here the window reloads its object from the database (common.js, "window.update"). DW's 9/13 decision for the reload command: this verb, not a new one.
			return (windowCall ("window.update", [addressTextOf (args [0])]) === true);
			};

		/*  10/1/26 by CC -- THE SELECTION VERBS ARE THE WINDOW'S. wp.getSelect,
			wp.getSelText, wp.setSelect and wp.setTextMode were the library's
			placeholders -- no selection, nothing set -- so the HTML menu's Add
			Link, which asks where the selection is and wraps its text in the
			anchor, never saw a selection: DW's 10/1 report, "it should turn
			the selected text into a link." wpverbs.c: getselectfunc assigns
			the start and end of the selection through its two addresses
			(langsetlongvarparam), getseltextfunc answers the selected text,
			setselectfunc sets the selection, settextmodefunc puts the window
			in or out of text mode. The window does each one in the line the
			cursor is on (common.js). A script with no window to ask -- an
			agent, a thread -- gets the library's answer, as it did.  */

		const theLibraryWpVerbs = {
			"wp.getselect": verbs ["wp.getselect"],
			"wp.getseltext": verbs ["wp.getseltext"],
			"wp.setselect": verbs ["wp.setselect"],
			"wp.settextmode": verbs ["wp.settextmode"]
			};

		verbs ["wp.getselect"] = function (args, environment) {
			var theSelection;
			try {
				theSelection = windowCall ("wp.getselect", []);
				}
			catch (err) {
				return (theLibraryWpVerbs ["wp.getselect"] (args, environment));
				}
			if ((theSelection === undefined) || (theSelection === null) || (typeof theSelection !== "object")) {
				return (theLibraryWpVerbs ["wp.getselect"] (args, environment));
				}
			assignThrough (args [0], Number (theSelection.start));
			assignThrough (args [1], Number (theSelection.end));
			return (true);
			};

		verbs ["wp.getseltext"] = function (args, environment) {
			try {
				const theText = windowCall ("wp.getseltext", []);
				return (((theText === undefined) || (theText === null)) ? "" : String (theText));
				}
			catch (err) {
				return (theLibraryWpVerbs ["wp.getseltext"] (args, environment));
				}
			};

		verbs ["wp.setselect"] = function (args, environment) {
			try {
				windowCall ("wp.setselect", [Number (args [0]), Number (args [1])]);
				return (true);
				}
			catch (err) {
				return (theLibraryWpVerbs ["wp.setselect"] (args, environment));
				}
			};

		verbs ["wp.settextmode"] = function (args, environment) {
			try {
				windowCall ("wp.settextmode", [args [0] === true]);
				return (true);
				}
			catch (err) {
				return (theLibraryWpVerbs ["wp.settextmode"] (args, environment));
				}
			};

		windowVerbNames.forEach (function (verbName) {
			verbs [verbName] = function (args, environment) {
				if (flRouteToHiddenTarget (environment, verbName)) {
					const theTargetText = targetAddressTextForRouting (environment);
					if (flWindowOpenOnTarget (theTargetText)) { //DW's rule: a window open on the target IS the target
						const params = [];
						args.forEach (function (theArg) {
							params.push (jsonSafe (theArg));
							});
						return (windowCallTargeted (verbName, params, theTargetText));
						}
					return (hiddenTargetCall (environment, verbName, args));
					}
				const params = [];
				args.forEach (function (theArg) {
					params.push (jsonSafe (theArg));
					});
				return (windowCall (verbName, params));
				};
			});

		/*  8/15/26 by CC -- menu.setScript and menu.getScript, the kernel half
			of the glue in system.verbs.builtins.menu. In Frontier a menubar
			carries its command scripts, and setScript attaches a script to
			the menubar line the cursor is on -- newProjectCommand's way of
			wiring the new project into the NodeEditor menu: target.set
			(@nodeEditorSuite.menu), cursor on the new line, menu.setScript
			(adrscript). The cursor is the hidden target's cursor, the same
			one the op verbs move.  */

		function menubarAtTarget (environment, verbName) { //the menubar the target names, with its address and cursor
			const theAddressText = targetAddressTextForRouting (environment);
			if (theAddressText === undefined) {
				const message = "Can't do " + verbName + " because no target is set.";
				throw new Error (message);
				}
			const theAddress = verbs ["lang.address"] ([theAddressText], environment);
			const theValue = theAddress.reference.get ();
			if ((theValue === undefined) || (theValue === null) || (theValue.flOdbMenubar !== true) || (!Array.isArray (theValue.lines))) {
				const message = "Can't do " + verbName + " because the target " + theAddressText + " isn't a menubar.";
				throw new Error (message);
				}
			var cursor = hiddenTargetCursors [theAddressText.toLowerCase ()];
			if ((cursor === undefined) || (cursor < 0) || (cursor >= theValue.lines.length)) {
				cursor = 0;
				}
			return ({theAddress, theAddressText, theValue, cursor});
			}

		verbs ["menu.setscript"] = function (args, environment) {
			const adrScript = args [0];
			if ((adrScript === undefined) || (adrScript === null) || (adrScript.flAddress !== true)) {
				const message = "Can't set the menu script because the parameter isn't the address of a script.";
				throw new Error (message);
				}
			const theScript = adrScript.reference.get ();
			if ((theScript === undefined) || (theScript === null) || (theScript.flOdbScript !== true) || (!Array.isArray (theScript.lines))) {
				const message = "Can't set the menu script because there is no script at " + adrScript.pathText + ".";
				throw new Error (message);
				}
			const theTarget = menubarAtTarget (environment, "menu.setScript");
			const theLines = theTarget.theValue.lines.slice ();
			theLines [theTarget.cursor] = Object.assign ({}, theLines [theTarget.cursor], {script: {lines: theScript.lines}});
			theTarget.theAddress.reference.set ({flOdbMenubar: true, lines: theLines});
			return (true);
			};

		verbs ["menu.getscript"] = function (args, environment) { //the cursor line's script, deposited at the address if one is given; false when the line has none -- a menu walker leans on that
			const theTarget = menubarAtTarget (environment, "menu.getScript");
			const theLine = theTarget.theValue.lines [theTarget.cursor];
			if ((theLine.script === undefined) || (!Array.isArray (theLine.script.lines))) {
				return (false);
				}
			const theScript = {flOdbScript: true, scriptType: "script", lines: theLine.script.lines};
			const adrDest = args [0];
			if ((adrDest !== undefined) && (adrDest !== null) && (adrDest.flAddress === true)) {
				adrDest.reference.set (theScript);
				return (true);
				}
			return (theScript);
			};

		verbs ["target.get"] = function (args, environment) {

			/*  8/12/26 by CC -- with nothing set, the target is the object the
				front window is showing. Frontier's editor commands lean on
				this: clock.timeStamp asks target.get () what it's looking at,
				and with nothing there it decides it isn't an outline and
				returns false -- which is why cmd-4 did nothing. DW's own
				runSelection is the other half of the evidence: it says
				target.set (window.next (window.frontmost ())) to reach the
				window BEHIND the front one, which only makes sense if the
				front one is where you start.

				Nothing is asked of the window unless a script really calls
				target.get with an empty stack.  */

			if ((environment.targetStack !== undefined) && (environment.targetStack.length > 0)) {
				return (environment.targetStack [environment.targetStack.length - 1]);
				}
			const theAddress = windowCall ("window.frontmost", []);
			if ((theAddress === undefined) || (theAddress === null) || (String (theAddress).length === 0)) {
				return (undefined);
				}
			return (verbs ["lang.address"] ([String (theAddress)], environment));
			};

		verbs ["op.attributes.getone"] = function (args) { //10/8/26 by CC -- op.attributes.getOne (attname, @val): the one attribute's value lands at the address; false when the line hasn't got it
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't get the attribute because the second parameter isn't the address its value goes to.";
				throw new Error (message);
				}
			const theValue = windowCall ("op.attributes.getone", [String (args [0])]);
			if ((theValue === undefined) || (theValue === null)) {
				return (false);
				}
			theAddress.reference.set (theValue);
			return (true);
			};

		verbs ["op.attributes.addgroup"] = function (args) { //10/8/26 by CC -- op.attributes.addGroup (@atts): every entry of the table at the address goes onto the cursor line, over what it had
			const theAddress = args [0];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't add the attributes because the parameter isn't the address of their table.";
				throw new Error (message);
				}
			const theTable = theAddress.reference.get ();
			if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
				const message = "Can't add the attributes because " + String (theAddress.pathText) + " isn't a table.";
				throw new Error (message);
				}
			const theGroup = {};
			Object.keys (theTable).forEach (function (theName) {
				if ((theName === "flOdbSqlTable") || (theName === "odbId")) {
					return;
					}
				theGroup [theName] = String (jsonSafe (theTable [theName]));
				});
			return (windowCall ("op.attributes.addgroup", [theGroup]));
			};

		verbs ["op.attributes.getall"] = function (args) { //op.attributes.getAll (@atts) -- the cursor line's attributes land at the address
			const theAddress = args [0];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't get the attributes because the parameter isn't the address they go to.";
				throw new Error (message);
				}
			var theAtts = windowCall ("op.attributes.getall", []);
			if ((theAtts === undefined) || (theAtts === null) || (typeof theAtts !== "object")) {
				theAtts = {};
				}
			theAddress.reference.set (theAtts);
			return (true);
			};

		/*  8/23/26 by CC -- frontmostverb -> setwinvalue, in
			Common/source/shellwindowverbs.c. Three answers, not one:

			   a database window   setaddressvalue (htable, bs, val) -- and
			                       htable is the table langexternalfindvariable
			                       ACTUALLY found the variable in, never the
			                       window's title
			   any other window    setstringvalue -- a file window's full path,
			                       otherwise the title
			   no window at all    setstringvalue (zerostring) -- the empty
			                       string, with the address form sitting right
			                       there commented out

			Ours did one thing: parse the window's title text from the root,
			and THROW when nothing answered. Parsing the title is what let a
			window opened on a short name save itself back to the root and
			make a table called op there on 8/21.  */

		verbs ["window.frontmost"] = function (args, environment) {
			const theAnswer = windowCall ("window.frontmost", []);
			if ((theAnswer === undefined) || (theAnswer === null) || (String (theAnswer).length === 0)) {
				return (""); //no window: the kernel answers the empty string, it does not fail
				}
			const theAddress = verbs ["lang.address"] ([String (theAnswer)], environment);
			var theValue;
			try {
				theValue = theAddress.reference.get ();
				}
			catch (err) {
				theValue = undefined;
				}
			if (theValue === undefined) {
				return (String (theAnswer)); //not a database object -- the kernel answers text
				}
			return (verbs ["lang.address"] ([trueAddressText (theAddress, environment)], environment));
			};

		/*  8/26/26 by CC -- getcursorfunc, Common/source/tableverbs.c: the
			address of the table line the cursor points at -- tablegetcursorinfo
			reads the bar cursor and the answer is setaddressvalue (htable, bs),
			or the empty string when there is no table cursor to read. The page
			answers the row's full dotted address as text; parsing that text
			gives the address the kernel builds.  */

		verbs ["table.getcursor"] = function (args, environment) {
			const theAnswer = windowCall ("table.getcursor", []);
			if ((theAnswer === undefined) || (theAnswer === null) || (String (theAnswer).length === 0)) {
				return (""); //no table window: the kernel answers the empty string, it does not fail
				}
			return (verbs ["lang.address"] ([String (theAnswer)], environment));
			};

		/*  8/26/26 by CC -- DW's ruling 8/26: the ACTUAL console.log, in place
			of his simulation. From a window's Run the message goes to the
			window's own JavaScript console -- the one Inspect opens -- and to
			the worker's console, which is the server log.  */

		verbs ["console.log"] = function (args) {
			var theText = "";
			args.forEach (function (theArg) {
				if (theText.length > 0) {
					theText += " ";
					}
				theText += verbs ["lang.displaystring"] ([theArg]);
				});
			console.log (theText);
			windowCall ("console.log", [theText]);
			return (true);
			};

		/*  8/13/26 by CC -- DW's ruling on the Misc commands that do nothing:
			"for each just put up a dialog that says 'Not implemented yet.'"
			He wants the reminders in his face until they're built. These
			names are the engines behind Quick Script, Close All Windows and
			the Common Styles items; without this they vanish into the
			screen-verb no-op rule and the commands fail in silence.  */

		/*  8/22/26 by CC -- menus.scripts.stylecommand CAME OUT OF THIS LIST.
			Every JavaScript verb is grouped by the name before its first dot
			and those groups are searched at system.compiler.kernel, which
			system.paths reaches at 04 and 06 -- ahead of root.system at 11.
			So one stub named menus.something invented a kernel table called
			menus and hid the whole of system.menus behind it: buildMenuBar,
			jumpCommand, findCommand, replaceCommand, twenty-six scripts. The
			real styleCommand is in the database, so the stub was standing in
			front of code that already works.  */

		["window.visit"].forEach (function (verbName) { //9/16/26 by CC -- window.quickscript came OUT of this list: the Quick Script window is real (installEditorVerbs above), and this stub, installed after it, was still answering "Not implemented yet." -- DW's 9/17 report on 0.4.79
			verbs [verbName] = function (args) {
				askUser ({kind: "alert", prompt: "Not implemented yet."});
				return (true);
				};
			});

		}

/*  8/29/26 by CC -- AGENTS, DW's go-ahead on the plan read from the C. The
	kernel compiles every script in system.agents at startup and adds each as
	its own process (scriptloadagents, addnewprocess); the scheduler wakes
	each agent about once a second -- sleepuntil = now + 1, set BEFORE the
	code runs (process.c, the 6.1b8 rescheduling) -- and runs the whole
	module. A process whose run FAILS is deleted, the kernel's rule, so an
	agent that errors stops until its script is edited.

	Here: the server spawns one of these workers per agent script, with
	flAgent and the script's lines in workerData. The loop below is the
	scheduler's beat: run the module, sleep out the rest of the second, run
	it again. The server terminates the worker when the script changes or
	leaves the table; a failed run posts home and exits, matching
	deleteprocess.  */

	/*  and flOneShot rides with flAgent for the STARTUP scripts -- the kernel
		runs every script in system.startup as a one-shot process at boot
		(scriptrunstartupscripts, newprocessvisit with floneshot true), then
		loads the agents. A one-shot runs the module once and goes home.  */

	function agentMain () {

		/*  9/2/26 by CC -- the parse and the database open happen INSIDE the
			guard now. They ran bare, so an agent script that didn't parse --
			a half-typed line the window's autosave had caught mid-word --
			threw out of the worker, and with nobody listening on the server
			side the whole server died, and died again at every launch. DW's
			day, 9/2: "i can't get any work done." A script that can't parse
			is a failed run: it posts home like any other failure and the
			agent stays stopped until the script is edited (deleteprocess).  */

		var theStore, theStatements;
		try {
			theStore = odbSql.openDatabase (workerData.pathDatabase);
			theStatements = parse.parseOutline (parse.linesToTree (workerData.agentLines));
			}
		catch (err) {
			parentPort.postMessage ({type: "agentfailed", message: err.message, ctBeats: 0, stack: []});
			return;
			}
		const theSleeper = new Int32Array (new SharedArrayBuffer (4));
		var ctBeats = 0;
		while (true) {
			const whenBeatStart = Date.now ();
			theStore.checkForOutsideChanges (); //another connection may have written since the last beat
			var theTrace; //read by the catch, for the stack crawl
			try {
				theTrace = [];
				theTrace.ctCalls = 0;
				theTrace.push = function (entry) {
					this.ctCalls++;
					if (this.length < 100000) {
						Array.prototype.push.call (this, entry);
						}
					};
				const made = verbsMaker.makeVerbs (workerData.pathMap, theTrace);
				installDialogVerbs (made.verbs);
				installEditorVerbs (made.verbs);
				installHttpVerbs (made.verbs);
				installTcpVerbs (made.verbs);
				installThreadVerbs (made.verbs); //9/15/26 by CC -- thread.callScript starts a worker through the server
				const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
				environment.refreshOdb = theStore.checkForOutsideChanges; //9/3/26 by CC -- webserver.server waits on system.temp.Frontier.startingUp, written by another connection
				environment.msgCallback = postMsg; //9/16/26 by CC -- msg goes to the About window through the server
				environment.sessionId = workerData.sessionId; //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
				environment.setLinkedCode = theStore.setLinkedCode;
			environment.noteMissingVerb = noteMissingVerb;
				environment.odbDates = theStore.datesForPath;
				environment.odbPathForId = theStore.pathForId;
				environment.setOdbDates = theStore.setDatesForPath;
				environment.parseScript = function (theLines) {
					return (parse.parseOutline (parse.linesToTree (theLines)));
					};
				environment.frames.push ({vars: {}});

				/*  9/26/26 by CC -- THE AGENT'S OWN ADDRESS, for this. An agent is
					the script at system.agents.name running as a process, and in
					Frontier this answers that address. Here the worker ran the
					lines with no address pushed, so DW's blueskyDriver died on
					"Hello from " + this every quarter hour and never posted --
					silently, an agent has no window. Same as the window run's
					scriptAddress below.  */

				if ((workerData.agentAddress !== undefined) && (String (workerData.agentAddress).length > 0)) {
					try {
						const theAddressValue = evaluate.evaluate (scriptToStatements ("@" + String (workerData.agentAddress)), environment);
						if ((theAddressValue !== undefined) && (theAddressValue !== null) && (theAddressValue.flAddress === true)) {
							environment.scriptAddresses.push (theAddressValue);
							}
						}
					catch (err) {
						}
					}
				evaluate.evaluate (theStatements, environment);
				ctBeats++;
				}
			catch (err) {
				parentPort.postMessage ({type: "agentfailed", message: err.message, ctBeats, stack: crawlForTrace (theTrace)});
				return; //deleteprocess -- a failed agent stops
				}
			if (workerData.flOneShot === true) { //a startup script: once, then home
				parentPort.postMessage ({type: "agentdone", ctBeats, traceTail: crawlForTrace (theTrace).slice (-25)}); //9/4/26 by CC -- the last verbs, so a startup that ends early can be read in the log (ODB_STARTUP_TRACE)
				return;
				}
			const elapsed = Date.now () - whenBeatStart;
			if (elapsed < 1000) { //the kernel's one-second beat, minus the time the run took
				Atomics.wait (theSleeper, 0, 0, 1000 - elapsed);
				}
			}
		}

//run it
	function main () {
		if (workerData.flAgent === true) {
			agentMain ();
			return;
			}
		const whenStart = new Date ();
		var theTrace; //assigned below, and read again by the catch when the run fails -- 8/21/26 by CC
		try {
			const theStore = odbSql.openDatabase (workerData.pathDatabase);
			const theStatements = scriptToStatements (workerData.scriptText);

			/*  8/17/26 by CC -- no cap on verb calls, DW's ruling: Frontier's answer
				to a runaway script is the person's interrupt (the Kill button ends
				this worker), not a counter. The stored trace stays bounded so a
				long run can't eat the machine's memory; every call is counted.  */
			theTrace = [];
			theTrace.ctCalls = 0;
			theTrace.push = function (entry) {
				this.ctCalls++;
				if (this.length < 100000) {
					Array.prototype.push.call (this, entry);
					}
				};

			const made = verbsMaker.makeVerbs (workerData.pathMap, theTrace);
			installDialogVerbs (made.verbs);
			installEditorVerbs (made.verbs);
			installHttpVerbs (made.verbs); //8/12/26 by CC -- after the others, so these replace the stubs
			installTcpVerbs (made.verbs); //9/3/26 by CC -- the stream verbs, over the same channel
			installThreadVerbs (made.verbs); //9/15/26 by CC -- thread.callScript starts a worker through the server
			const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
			environment.refreshOdb = theStore.checkForOutsideChanges;
			environment.msgCallback = postMsg; //9/16/26 by CC -- msg goes to the About window through the server
			environment.sessionId = workerData.sessionId; //9/10/26 by CC -- the linked code rule
			environment.setLinkedCode = theStore.setLinkedCode;
			environment.noteMissingVerb = noteMissingVerb;
			environment.odbDates = theStore.datesForPath; //8/17/26 by CC -- the object's real dates, for timeCreated and timeModified
			environment.odbPathForId = theStore.pathForId; //8/21/26 by CC -- so the edit verb can open a window on where the object IS, not on the text the script wrote
			environment.setOdbDates = theStore.setDatesForPath; //8/20/26 by CC -- setTimeCreated and setTimeModified write through the same door
		environment.odbDates = theStore.datesForPath; //8/17/26 by CC -- timeCreated and timeModified ask the storage layer for the object's dates
			environment.parseScript = function (theLines) {
				return (parse.parseOutline (parse.linesToTree (theLines)));
				};
			environment.frames.push ({vars: {}});

			/*  9/5/26 by CC -- THE SCRIPT'S OWN ADDRESS, for this. A script run
				from its window is the module at that address, and in Frontier
				this answers it (the kernel knows the window's object). Ours
				pushed an address only when a script CALLED another, so DW's
				watcher, run from its window's Run button, died on its last
				line: "Can't use this because the running script has no address
				in the database." The window sends its address with the run;
				the address value is made the way the language makes one.  */

			if ((workerData.scriptAddress !== undefined) && (String (workerData.scriptAddress).length > 0)) {
				try {
					const theAddressValue = evaluate.evaluate (scriptToStatements ("@" + String (workerData.scriptAddress)), environment);
					if ((theAddressValue !== undefined) && (theAddressValue !== null) && (theAddressValue.flAddress === true)) {
						environment.scriptAddresses.push (theAddressValue);
						}
					}
				catch (err) { //a text that isn't an address: the run goes on without one, the way it always did
					}
				}

			const theValue = evaluate.evaluate (theStatements, environment);

			const theResult = serializeValue (theValue);
			theResult.ctVerbCalls = theTrace.ctCalls;
			theResult.ctMilliseconds = new Date () - whenStart;
			parentPort.postMessage ({type: "done", result: theResult, hiddenTargetCursors});
			}
		catch (err) {
			parentPort.postMessage ({type: "failed", message: err.message, stack: crawlForTrace (theTrace), hiddenTargetCursors});
			}
		}

/*  8/21/26 by CC -- THE STACK CRAWL, DW's ask on 8/21 while a whole morning went
	into finding who called op.getcursor: "it's ok to put the stack crawl in the
	js console. until we get the debugger running that will help a lot."

	The trace is a LOG of calls, not a stack -- nothing records a return -- so
	this is the last calls made before the failure, most recent last. That is
	still the thing that was missing: the failing verb's caller is on it.  */

function crawlForTrace (theTrace) {
	const ctWanted = 40;
	const theCrawl = [];
	if ((theTrace === undefined) || (theTrace === null)) {
		return (theCrawl);
		}
	var ixFrom = theTrace.length - ctWanted;
	if (ixFrom < 0) {
		ixFrom = 0;
		}
	var ix;
	for (ix = ixFrom; ix < theTrace.length; ix++) {
		const theEntry = theTrace [ix];
		if (theEntry === undefined) {
			continue;
			}
		var theKind = "script";
		if (theEntry.flKernel === true) {
			theKind = (theEntry.flScreenNoOp === true) ? "kernel (no screen)" : "kernel";
			}
		if (theEntry.flExternalScript === true) {
			theKind = "external script";
			}
		theCrawl.push ({verb: theEntry.verb, kind: theKind, args: argsForCrawl (theEntry.args)});
		}
	return (theCrawl);
	}

function argsForCrawl (theArgs) { //short enough to read in a console line, never the whole value
	const theTexts = [];
	if (!Array.isArray (theArgs)) {
		return (theTexts);
		}
	theArgs.forEach (function (theArg) {
		theTexts.push (oneArgForCrawl (theArg));
		});
	return (theTexts);
	}

function oneArgForCrawl (theArg) {
	if (theArg === undefined) {
		return ("nothing");
		}
	if (theArg === null) {
		return ("nil");
		}
	if (typeof theArg === "string") {
		return ((theArg.length > 40) ? ("\"" + theArg.substring (0, 40) + "…\"") : ("\"" + theArg + "\""));
		}
	if ((typeof theArg === "number") || (typeof theArg === "boolean")) {
		return (String (theArg));
		}
	if (typeof theArg === "object") {
		if (theArg.flAddress === true) {
			return ("@" + theArg.pathText);
			}
		if (theArg.flOdbScript === true) {
			return ("a script");
			}
		if (theArg instanceof Date) { //9/5/26 by CC -- DW's console showed file.writeWholeFile (..., a table) for a date; the crawl reads it the Frontier way now
			return (dates.frontierDateToString (theArg));
			}
		if (theArg.flOdbMenubar === true) {
			return ("a menubar");
			}
		if (theArg.flWpText === true) {
			return ("a wp text");
			}
		if (Array.isArray (theArg)) {
			return ("a list of " + theArg.length);
			}
		return ("a table");
		}
	return ("a value");
	}

main ();
