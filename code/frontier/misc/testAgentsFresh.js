/*  testAgentsFresh.js -- the server-level gate for DW's 9/9 report: an
	agent kept running the old code of a script it calls after he edited
	that script and pressed Compile. The kernel's rule: an agent's OWN code
	is replaced only at Compile (processreplacecode); a script it CALLS runs
	the code linked to it -- what was last compiled -- until it is compiled
	again (langgetnodecode, opverblinkcode); the text a window autosaves
	changes nothing until Compile, and a Compile that fails leaves the old
	code running. 9/10/26: DW's rule of 9/9 ("autosave is not the same
	thing as compile"); the 9/9 version of this test expected the opposite
	and was wrong.
	node misc/testAgentsFresh.js [path to the .db]
	Starts a real trigger.js on a copy of the database, installs a helper
	script and an agent that writes the helper's answer into scratchpad
	every beat, then changes the helper from outside the agent's process
	the way the script window's autosave does, and reads what the agent
	writes afterward. Then edits the agent's own script through the
	autosave path (must keep running the old code) and through Compile
	(must start the new code).
	by CC, 9/9/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const folderScratch = pathTool.join (require ("os").tmpdir (), "testAgentsFresh");
const thePort = 5397;
const thePassword = "fresh";

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
		request ("/version", "GET", undefined, function (theCode) {
			if (theCode === 200) {
				callback ();
				}
			else {
				ctPolls++;
				if ((ctPolls < 80) && (theServer.exitCode === null)) {
					setTimeout (poll, 250);
					}
				else {
					callback ();
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
	theRequest.setTimeout (5000, function () {
		theRequest.destroy ();
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function opmlForLines (theLines) { //tab-indented lines become a nested outline, the way the script window sends one
	var theText = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head><title>t</title></head><body>";
	var theDepth = 0;
	theLines.forEach (function (theLine) {
		const theLevel = theLine.length - theLine.replace (/^\t+/, "").length;
		const theEscaped = theLine.replace (/^\t+/, "").split ("&").join ("&amp;").split ("<").join ("&lt;").split ("\"").join ("&quot;");
		while (theDepth > theLevel) {
			theText += "</outline>";
			theDepth--;
			}
		theText += "<outline text=\"" + theEscaped + "\">";
		theDepth = theLevel + 1;
		});
	while (theDepth > 0) {
		theText += "</outline>";
		theDepth--;
		}
	return (theText + "</body></opml>");
	}

function installScript (theAddress, theLines, flAutosave, callback) {
	request ("/uploadobject?address=" + encodeURIComponent (theAddress) + "&type=script" + (flAutosave ? "&autosave=1" : ""), "POST", opmlForLines (theLines), function (theCode) {
		callback (theCode === 200);
		});
	}

function compileScript (theAddress, theLines, callback) { //what the Compile button sends
	request ("/compilescript?address=" + encodeURIComponent (theAddress), "POST", opmlForLines (theLines), function (theCode) {
		callback (theCode === 200);
		});
	}

function runText (theText, callback) { //the value a one-liner answers, as text
	request ("/run", "POST", theText, function (theCode, theAnswer) {
		var theValue;
		try {
			theValue = JSON.parse (theAnswer).value;
			}
		catch (err) {
			}
		callback (theValue);
		});
	}

function wait (ms, callback) {
	setTimeout (callback, ms);
	}

function runTheTests () {
	const pathConfig = buildInstallation ();
	console.log ("");
	console.log ("An agent calls the script as it is now, and its own code changes only at Compile");
	startServer (pathConfig, function () {
	waitForStartup (function () { //a fresh copy runs its first-launch step, which empties scratchpad; anything installed there before it finishes is gone
		installScript ("scratchpad.ccHelper", ["on ccHelper ()", "\treturn (\"one\")"], false, function (flHelper) {
			checkThat ("the helper script installs", flHelper);
			installScript ("system.agents.ccFresh", ["scratchpad.ccMark = scratchpad.ccHelper ()", "scratchpad.ccAgentVersion = \"a\"", "scratchpad.ccThis = string (this)"], false, function (flAgent) { //9/26/26 by CC -- this in an agent is the agent's address; DW's blueskyDriver died on it
				checkThat ("the agent installs", flAgent);
				wait (3500, function () {
					runText ("scratchpad.ccMark + \"|\" + scratchpad.ccAgentVersion", function (theValue) {
						checkThat ("the agent runs and writes the helper's answer (one|a)", theValue === "one|a");
						runText ("scratchpad.ccThis", function (theThis) {
							checkThat ("this in the agent is the agent's own address, system.agents.ccFresh (" + theThis + ")", String (theThis).toLowerCase () === "system.agents.ccfresh");
							});
						if (theValue !== "one|a") {
							console.log ("         got " + JSON.stringify (theValue));
							}
						installScript ("scratchpad.ccHelper", ["on ccHelper ()", "\treturn (\"two\")"], true, function () { //the script window's autosave of a script the agent CALLS
							wait (3500, function () {
								runText ("scratchpad.ccMark", function (theValue) {
									checkThat ("the agent keeps running the helper's compiled code after the autosave (still one)", theValue === "one");
									compileScript ("scratchpad.ccHelper", ["on ccHelper ()", "\treturn (\"two\"", "\tif not "], function () { //Compile with a syntax error: the old code stays
									wait (3500, function () {
									runText ("scratchpad.ccMark", function (theValue) {
									checkThat ("a Compile that fails leaves the old code running (still one)", theValue === "one");
									compileScript ("scratchpad.ccHelper", ["on ccHelper ()", "\treturn (\"two\")"], function () {
									wait (3500, function () {
									runText ("scratchpad.ccMark", function (theValue) {
									checkThat ("after a Compile that succeeds the agent runs the new helper (two)", theValue === "two");
									installScript ("system.agents.ccFresh", ["scratchpad.ccMark = scratchpad.ccHelper ()", "scratchpad.ccAgentVersion = \"b\""], true, function () { //the agent's OWN script, autosaved
										wait (3500, function () {
											runText ("scratchpad.ccAgentVersion", function (theValue) {
												checkThat ("the agent's own autosaved edit does NOT start it over (still a)", theValue === "a");
												compileScript ("system.agents.ccFresh", ["scratchpad.ccMark = scratchpad.ccHelper ()", "scratchpad.ccAgentVersion = \"b\""], function (flCompiled) {
													checkThat ("Compile answers", flCompiled);
													wait (4500, function () {
														runText ("scratchpad.ccAgentVersion", function (theValue) {
															checkThat ("after Compile the agent runs its new code (b)", theValue === "b");
															stopServer (function () {
																console.log ("");
																console.log (ctPassed + " passed, " + ctFailed + " failed.");
																if (ctFailed > 0) {
																	console.log (serverOutput.split ("\n").filter (function (l) { return (/agents:|ccFresh|ccHelper/.test (l)); }).slice (-12).join ("\n"));
																	}
																process.exit ((ctFailed === 0) ? 0 : 1);
																});
															});
														});
													}); }); }); }); }); });
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

function waitForStartup (callback) { //the server log says "startupScript finished"
	var ctPolls = 0;
	function poll () {
		if (/startupScript finished/.test (serverOutput) || (ctPolls > 120)) {
			callback ();
			}
		else {
			ctPolls++;
			setTimeout (poll, 250);
			}
		}
	poll ();
	}

runTheTests ();
