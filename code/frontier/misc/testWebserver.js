/*  testWebserver.js -- the server-level gate for serving websites: a real
	trigger.js, a real port, the whole chain from the startupScript's
	inetd.start to a page in a browser.

	node misc/testWebserver.js [path to the .db]

	Builds a scratch installation on a COPY of the database, points
	user.inetd.config at ONE daemon on a test port (the distribution's
	http entry, port changed; the other three entries taken out so the
	test owns nothing but its own port), enables the distribution's
	helloWorld responder and adds an echoing responder of its own, opens
	the config's network gate, and starts the server. The startupScript
	runs inetd.start, inetd.startOne calls tcp.listenStream with
	@inetd.supervisor, and every connection runs the supervisor as its own
	process: webserver.server reads the request, dispatches, and the answer
	comes back down the socket.

	Then it asks the test port for /helloworld, POSTs a body to /ccecho,
	asks for a method the responder doesn't have, and checks that the
	listener survives a bad request. DW's ask for this round, 9/3/26:
	"serving websites, the tcp stream verbs and the kernelized webserver."

	by CC, 9/3/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const folderUsertalk = "/Users/davewiner/Claude/usertalk/code/";
const odbSql = require (folderUsertalk + "odbSql.js");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const folderScratch = pathTool.join (require ("os").tmpdir (), "testWebserver");
const thePort = 5393; //trigger's own port in the scratch config
const theWebPort = 5392; //the port the database's daemon listens on
const thePassword = "web";

var ctPassed = 0, ctFailed = 0;
const theFailures = [];

function checkThat (theDescription, flPassed) {
	if (flPassed) {
		ctPassed++;
		console.log ("   ok    " + theDescription);
		}
	else {
		ctFailed++;
		theFailures.push (theDescription);
		console.log ("   FAIL  " + theDescription);
		}
	}

function buildInstallation () {
	fs.rmSync (folderScratch, {recursive: true, force: true});
	fs.mkdirSync (pathTool.join (folderScratch, "renders"), {recursive: true});
	fs.mkdirSync (pathTool.join (folderScratch, "scriptTemp"), {recursive: true});
	const pathDatabase = pathTool.join (folderScratch, "frontier.db");
	fs.copyFileSync (pathMaster, pathDatabase);

	//the database: one daemon on the test port, helloWorld on, an echoing responder of our own
	const theStore = odbSql.openDatabase (pathDatabase);
	const theConfig = theStore.odb.user.inetd.config;
	Object.keys (theConfig).forEach (function (theName) {
		if ((theName !== "http") && (theName !== "flOdbSqlTable") && (theName !== "odbId")) {
			delete theConfig [theName];
			}
		});
	theConfig.http.port = theWebPort;
	theStore.odb.user.inetd.listens = {}; //no stale refs from another life
	theStore.odb.user.webserver.responders.helloWorld.enabled = true;
	theStore.odb.user.webserver.responders.ccEcho = {
		enabled: true,
		condition: "path contains \"ccecho\"",
		methods: {
			any: {flOdbScript: true, scriptType: "script", lines: [
				{level: 0, text: "on any (pta)", flExpanded: true, flComment: false, flBreakpoint: false},
				{level: 1, text: "pta^.code = 201", flExpanded: true, flComment: false, flBreakpoint: false},
				{level: 1, text: "pta^.responseHeaders.[\"X-Echo\"] = pta^.method + \" from \" + pta^.client", flExpanded: true, flComment: false, flBreakpoint: false},
				{level: 1, text: "pta^.responseHeaders.[\"X-Thread\"] = string (thread.getCurrentID ())", flExpanded: true, flComment: false, flBreakpoint: false}, //9/21/26 by CC -- each connection is a thread with an id of its own
				{level: 1, text: "pta^.responseBody = \"you said: \" + pta^.requestBody", flExpanded: true, flComment: false, flBreakpoint: false},
				{level: 1, text: "return (true)", flExpanded: true, flComment: false, flBreakpoint: false}
				]}
			}
		};
	theStore.close ();

	const theServerConfig = JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "config.json"), "utf8"));
	theServerConfig.port = thePort;
	theServerConfig.password = thePassword;
	theServerConfig.webeditPassword = thePassword;
	theServerConfig.pathDatabase = pathDatabase;
	theServerConfig.folderRenders = pathTool.join (folderScratch, "renders");
	theServerConfig.folderScriptTemp = pathTool.join (folderScratch, "scriptTemp");
	theServerConfig.folderWebeditReceived = pathTool.join (folderScratch, "received");
	theServerConfig.flLogRequests = false;
	theServerConfig.pathMap = {helpers: {}, prefs: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: true, prefixes: {"": pathTool.join (folderScratch, "renders")}}; //the network gate open: a listener is network
	const pathConfig = pathTool.join (folderScratch, "config.json");
	fs.writeFileSync (pathConfig, JSON.stringify (theServerConfig, undefined, "\t"));
	return (pathConfig);
	}

var theServer, serverOutput;

function startServer (pathConfig, callback) {
	serverOutput = "";
	theServer = spawn ("node", [pathTool.join (folderTrigger, "trigger.js")], {
		cwd: folderTrigger,
		env: Object.assign ({}, process.env, {ODB_CONFIG: pathConfig})
		});
	theServer.stdout.on ("data", function (chunk) {
		serverOutput += chunk;
		});
	theServer.stderr.on ("data", function (chunk) {
		serverOutput += chunk;
		});
	var ctPolls = 0;
	function poll () { //up when the startupScript has finished -- that's when the listener is up
		if (serverOutput.indexOf ("startupScript finished") !== -1) {
			setTimeout (callback, 1500); //9/4/26 by CC -- a moment for the listener to settle; the 2012 root's inetd.startOne opens fourteen extra listeners on the same port (the old Mac hack) right after the first, and a request in that instant is refused
			return;
			}
		ctPolls++;
		if ((ctPolls < 160) && (theServer.exitCode === null)) {
			setTimeout (poll, 250);
			}
		else {
			callback (new Error ("the server didn't finish starting up"));
			}
		}
	setTimeout (poll, 500);
	}

function stopServer (callback) {
	if ((theServer === undefined) || (theServer.exitCode !== null)) {
		callback ();
		return;
		}
	theServer.on ("exit", function () {
		callback ();
		});
	theServer.kill ();
	}

function askTheWebserver (theMethod, thePath, theBody, callback, theHost) { //callback ({statusCode, headers, body} or {message}); theHost: 9/15/26 by CC -- "[::1]" to come in over IPv6 the way a browser asking for localhost does
	const theRequest = http.request ("http://" + ((theHost === undefined) ? "127.0.0.1" : theHost) + ":" + theWebPort + thePath, {method: theMethod, headers: (theBody === undefined) ? {} : {"Content-Type": "text/plain", "Content-Length": Buffer.byteLength (theBody)}}, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			callback ({statusCode: theResponse.statusCode, headers: theResponse.headers, body: theText});
			});
		});
	theRequest.setTimeout (15000, function () {
		theRequest.destroy ();
		callback ({message: "no answer within 15 seconds"});
		});
	theRequest.on ("error", function (err) {
		callback ({message: err.message});
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function finish () {
	console.log ("");
	console.log (ctPassed + " passed, " + ctFailed + " failed.");
	if (ctFailed > 0) {
		theFailures.forEach (function (theFailure) {
			console.log ("   " + theFailure);
			});
		console.log ("");
		console.log (serverOutput.slice (-3000));
		process.exit (1);
		}
	process.exit (0);
	}

function main () {
	console.log ("testWebserver -- " + pathMaster);
	const pathConfig = buildInstallation ();
	startServer (pathConfig, function (err) {
		checkThat ("the server comes up and the startupScript finishes", err === undefined);
		if (err !== undefined) {
			console.log (serverOutput);
			stopServer (finish);
			return;
			}
		var ctTries = 0;
		function firstAsk (callback) { //the listener is up before the startupScript finishes; a refused connection right then is retried a few times so the test measures the chain, not the instant
			askTheWebserver ("GET", "/helloworld", undefined, function (theAnswer) {
				ctTries++;
				if ((theAnswer.message !== undefined) && (ctTries < 10)) {
					console.log ("         try " + ctTries + ": " + theAnswer.message);
					setTimeout (function () {
						firstAsk (callback);
						}, 500);
					return;
					}
				callback (theAnswer);
				});
			}
		firstAsk (function (theAnswer) {
			checkThat ("GET /helloworld on the daemon's port answers", theAnswer.message === undefined);
			if (theAnswer.message !== undefined) {
				console.log ("         (" + theAnswer.message + ")");
				const theProbe = http.request ("http://localhost:" + thePort + "/run?password=" + thePassword, {method: "POST", headers: {"Content-Type": "text/plain"}}, function (theResponse) { //what the startup left behind, for the log
					var theText = "";
					theResponse.on ("data", function (chunk) {
						theText += chunk;
						});
					theResponse.on ("end", function () {
						console.log ("         state: " + theText.replace (/\s+/g, " ").slice (0, 300));
						});
					});
				theProbe.end ("local (s = \"listens: \", adr); for adr in @user.inetd.listens {s = s + nameOf (adr^) + \"=\" + adr^.ref + \" \"}; s + \" | startingUp: \" + string (system.temp.Frontier.startingUp) + \" | firstRootRun: \" + string (user.prefs.firstRootRun) + \" | count: \" + string (tcp.countConnections ())");
				}
			checkThat ("with 200", theAnswer.statusCode === 200);
			checkThat ("and the helloWorld responder's page", String (theAnswer.body).indexOf ("Hello World!") !== -1);
			checkThat ("and the Server header the kernel stamps", (theAnswer.headers !== undefined) && (theAnswer.headers.server !== undefined));
			askTheWebserver ("POST", "/ccecho?y=2", "the body of the request", function (theAnswer) {
				checkThat ("POST /ccecho answers 201 from the echoing responder", theAnswer.statusCode === 201);
				checkThat ("the body came through Content-Length and back", String (theAnswer.body) === "you said: the body of the request");
				checkThat ("the paramtable knew the method and the client", (theAnswer.headers !== undefined) && (String (theAnswer.headers ["x-echo"]).indexOf ("POST from 127.0.0.1") === 0));
				const theFirstThread = (theAnswer.headers === undefined) ? undefined : theAnswer.headers ["x-thread"];
				askTheWebserver ("POST", "/ccecho", "again", function (theSecondAnswer) {

					/*  9/21/26 by CC -- EVERY CONNECTION IS A THREAD WITH AN ID OF ITS OWN.
						html.setPageTableAddress keeps each request's page table in
						system.temp.pageTableAddresses under thread.getCurrentID (),
						the kernel's way. Every connection's worker answered 1, so two
						requests at once -- a browser's page and its favicon -- wrote
						over each other's entry, and the Manila page died on "Can't get
						the value of adrSiteRootTable." One request at a time, curl,
						never showed it.  */

					const theSecondThread = (theSecondAnswer.headers === undefined) ? undefined : theSecondAnswer.headers ["x-thread"];
					checkThat ("each connection runs as a thread with an id of its own, not 1", (theFirstThread !== undefined) && (theSecondThread !== undefined) && (theFirstThread !== theSecondThread) && (theFirstThread !== "1") && (theSecondThread !== "1"));
					if ((theFirstThread === theSecondThread) || (theFirstThread === "1")) {
						console.log ("         got " + theFirstThread + " and " + theSecondThread);
						}
				askTheWebserver ("DELETE", "/helloworld", undefined, function (theAnswer) {
					checkThat ("a method the responder doesn't have answers 405", theAnswer.statusCode === 405);
					checkThat ("naming what it allows", (theAnswer.headers !== undefined) && (String (theAnswer.headers.allow).indexOf ("GET") !== -1));
					askTheWebserver ("GET", "/helloworld", undefined, function (theAnswer) {
						checkThat ("and the listener is still up afterward", theAnswer.statusCode === 200);
						askTheWebserver ("GET", "/helloworld", undefined, function (theAnswer) { //9/15/26 by CC -- DW's report: Chrome asking localhost:8081/helloworld got an empty reply; it comes in over IPv6 and the peer address ::1 broke the paramtable
							checkThat ("a browser's IPv6 connection to localhost answers 200", theAnswer.statusCode === 200);
							checkThat ("with the page", String (theAnswer.body).indexOf ("Hello World!") !== -1);
							askTheWebserver ("POST", "/ccecho", "over six", function (theAnswer) {
								checkThat ("and the paramtable calls the IPv6 loopback 127.0.0.1, the kernel's four numbers", (theAnswer.headers !== undefined) && (String (theAnswer.headers ["x-echo"]) === "POST from 127.0.0.1"));
								checkThat ("the server log shows no supervisor failure", serverOutput.indexOf ("inetd:") === -1);
								stopServer (finish);
								}, "[::1]");
							}, "[::1]");
						});
					});
					});
				});
			});
		});
	}

main ();
