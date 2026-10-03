/*  testServerSurvives.js -- the server-level gate for the 9/2 fire: a script
	in system.agents that doesn't parse took the whole server down, and
	took it down again at every launch. DW: "the big problem in this
	version was that agents could cause such havoc."

	node misc/testServerSurvives.js [path to the .db]

	Builds a scratch installation on a COPY of the database, starts a real
	trigger.js on its own port, installs a half-typed agent script through
	/uploadobject the way the script window's autosave does, and asks
	/version afterward. Then stops the server, leaves the bad agent in the
	database, starts the server again, and asks /version again -- the
	relaunch half of the fire. A startup script that doesn't parse gets the
	same treatment. Fails before the fix, passes after.

	by CC, 9/2/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const folderScratch = pathTool.join (require ("os").tmpdir (), "testServerSurvives");
const thePort = 5398;
const thePassword = "survive";

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
	const theConfig = JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "config.json"), "utf8"));
	theConfig.port = thePort;
	theConfig.password = thePassword;
	theConfig.webeditPassword = thePassword;
	theConfig.pathDatabase = pathDatabase;
	theConfig.folderRenders = pathTool.join (folderScratch, "renders");
	theConfig.folderScriptTemp = pathTool.join (folderScratch, "scriptTemp");
	theConfig.folderWebeditReceived = pathTool.join (folderScratch, "received");
	theConfig.flLogRequests = false;
	theConfig.pathMap = {helpers: {}, prefs: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, prefixes: {"": pathTool.join (folderScratch, "renders")}};
	const pathConfig = pathTool.join (folderScratch, "config.json");
	fs.writeFileSync (pathConfig, JSON.stringify (theConfig, undefined, "\t"));
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
	function poll () {
		askVersion (function (flUp) {
			if (flUp) {
				callback ();
				}
			else {
				ctPolls++;
				if ((ctPolls < 80) && (theServer.exitCode === null)) {
					setTimeout (poll, 250);
					}
				else {
					callback (); //the caller's checks say what happened
					}
				}
			});
		}
	poll ();
	}

function stopServer (callback) {
	if ((theServer === undefined) || (theServer.exitCode !== null)) {
		callback ();
		return;
		}
	theServer.on ("exit", function () {
		callback ();
		});
	theServer.kill ("SIGKILL");
	}

function request (thePath, theMethod, theBody, callback) { //callback (statusCode or undefined, text)
	const theRequest = http.request ({host: "localhost", port: thePort, path: thePath, method: theMethod, headers: {"x-trigger-password": thePassword, "content-type": "text/xml"}}, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			callback (theResponse.statusCode, theText);
			});
		});
	theRequest.on ("error", function () {
		callback (undefined, "");
		});
	theRequest.setTimeout (3000, function () {
		theRequest.destroy ();
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function askVersion (callback) { //flUp
	request ("/version", "GET", undefined, function (theCode) {
		callback (theCode === 200);
		});
	}

function opmlForLines (theLines) { //flat lines, the way autosave sends a half-typed script
	var theText = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head><title>t</title></head><body>";
	theLines.forEach (function (theLine) {
		theText += "<outline text=\"" + theLine.split ("&").join ("&amp;").split ("<").join ("&lt;").split ("\"").join ("&quot;") + "\"/>";
		});
	return (theText + "</body></opml>");
	}

function installScript (theAddress, theLines, callback) {
	request ("/uploadobject?address=" + encodeURIComponent (theAddress) + "&type=script", "POST", opmlForLines (theLines), function (theCode, theText) {
		callback (theCode === 200);
		});
	}

function wait (ms, callback) {
	setTimeout (callback, ms);
	}

const halfTyped = ["scratchpad.now = clock.now ()", "if not "]; //exactly what DW's database held on 9/2

function runTheTests () {
	const pathConfig = buildInstallation ();
	console.log ("");
	console.log ("A half-typed agent script can't take the server down");
	startServer (pathConfig, function () {
		askVersion (function (flUp) {
			checkThat ("the server comes up on a clean copy", flUp);
			installScript ("system.agents.halfTyped", halfTyped, function (flInstalled) {
				checkThat ("the half-typed agent script installs (autosave's path)", flInstalled);
				wait (5000, function () { //the agent scanner runs every 3 seconds
					askVersion (function (flStillUp) {
						checkThat ("the server still answers /version 5 seconds later", flStillUp);
						checkThat ("the server process is still running", theServer.exitCode === null);
						checkThat ("the log says the agent was stopped, not the server", /halfTyped/.test (serverOutput) && /stopped/.test (serverOutput));
						stopServer (function () {
							console.log ("");
							console.log ("And it can't stop the server from coming up again");
							startServer (pathConfig, function () {
								wait (2000, function () {
									askVersion (function (flUpAgain) {
										checkThat ("the server comes up with the half-typed agent still in the database", flUpAgain);
										checkThat ("the server process is still running after the boot's agent scan", theServer.exitCode === null);
										installScript ("system.startup.halfTypedStartup", halfTyped, function (flInstalledStartup) {
											checkThat ("a half-typed startup script installs", flInstalledStartup);
											stopServer (function () {
												console.log ("");
												console.log ("A half-typed startup script can't stop the boot either");
												startServer (pathConfig, function () {
													wait (2000, function () {
														askVersion (function (flUpWithStartup) {
															checkThat ("the server comes up with a half-typed startup script in system.startup", flUpWithStartup);
															checkThat ("the server process is still running", theServer.exitCode === null);
															stopServer (report);
															});
														});
													});
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});
		});
	}

function report () {
	console.log ("");
	console.log (ctPassed + " passed, " + ctFailed + " failed.");
	theFailures.forEach (function (theFailure) {
		console.log ("   " + theFailure);
		});
	if (ctFailed > 0) {
		console.log ("");
		console.log ("server output:");
		console.log (serverOutput.split ("\n").filter (function (theLine) { return (!/^\s+at /.test (theLine)); }).slice (-25).join ("\n"));
		}
	process.exit ((ctFailed === 0) ? 0 : 1);
	}

runTheTests ();
