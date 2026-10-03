/*  testThreads.js -- the server-level gate for thread.callScript: a script
	started with it runs on its own thread and the caller goes on at once,
	the kernel's threadcallscriptverb (shellsysverbs.c: addnewprocess).
	Until 9/15/26 the verb ran the script in line and the caller waited --
	DW: "that's a bug" -- and Frontier.tools.install hung on its last line,
	scheduler0.monitorThreads, which starts the scheduler's loop that way.

	What a thread gets here, DW's rulings 9/15: it runs the agent way, on a
	worker of its own with its own connection to the database. A thread
	started from a script that has a window keeps that window -- its
	window verbs and dialogs go to the page the parent run came from; a
	thread started with no window (an agent's, a startup script's) has
	none, and a dialog that needs an answer fails with a sentence, as in
	an agent (an alert is answered quietly there, the 8/29 rule).

	node misc/testThreads.js [path to the .db]

	Starts a real trigger.js on a copy of the database and plays the
	page's half of an interactive run: every window question is answered
	as if one window were open, titled "the test window".

	by CC, 9/15/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const folderScratch = pathTool.join (require ("os").tmpdir (), "testThreads");
const thePort = 5394;
const thePassword = "threads";

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
	theConfig.flLogRequests = true; //the asks and the thread lines, for the dump on failure
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
	theRequest.setTimeout (20000, function () {
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

function installScript (theAddress, theLines, callback) {
	request ("/uploadobject?address=" + encodeURIComponent (theAddress) + "&type=script", "POST", opmlForLines (theLines), function (theCode) {
		callback (theCode === 200);
		});
	}

function compileScript (theAddress, theLines, callback) { //what the Compile button sends; for an agent, what starts it
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

function runInteractive (theScript, callback) { //the value; every window question answered as if one window, "the test window", were open; the asks are collected
	const asks = [];
	function step (theCode, theText) {
		var theAnswer;
		try {
			theAnswer = JSON.parse (theText);
			}
		catch (err) {
			callback (undefined, asks);
			return;
			}
		if (theAnswer.finished === false) {
			asks.push (theAnswer.dialog.verb);
			var theReply = {value: ""};
			if (theAnswer.dialog.verb === "window.isopen") {
				theReply = {value: true};
				}
			if (theAnswer.dialog.verb === "window.frontmost") {
				theReply = {value: "the test window"};
				}
			if (theAnswer.dialog.kind === "alert") {
				theReply = {button: "ok"};
				}
			request ("/dialoganswer?runid=" + encodeURIComponent (theAnswer.runId), "POST", JSON.stringify (theReply), step);
			}
		else {
			if (theAnswer.threadsDone === true) { //9/16/26 by CC -- the last thread with this window let go; nothing more to hear
				return;
				}
			callback ((theAnswer.value !== undefined) ? theAnswer.value : theAnswer.message, asks);
			if (theAnswer.threadsWithWindow === true) { //9/16/26 by CC -- the page keeps listening for its threads' questions after the run is done, the way the real page does
				request ("/dialoganswer?runid=" + encodeURIComponent (theAnswer.runId), "POST", JSON.stringify ({listening: true}), step);
				}
			}
		}
	request ("/run?interactive=1", "POST", theScript, step);
	}

function runTheTests () {
	const pathConfig = buildInstallation ();
	console.log ("");
	console.log ("thread.callScript starts the script on its own thread, the kernel's way");
	startServer (pathConfig, function () {
	waitForStartup (function () { //a fresh copy's first launch empties scratchpad (the startupScript's first-run step); anything put there before it finishes is gone
	installScript ("scratchpad.ccSlow", ["on ccSlow (s)", "\tthread.sleepFor (3)", "\tscratchpad.ccThreadWrote = s", "\treturn (true)"], function (flInstalled) {
		checkThat ("the slow script installs", flInstalled);
		const whenStart = Date.now ();
		runInteractive ("local (id = thread.callScript (@scratchpad.ccSlow, {\"hello from the thread\"})); string (id) + \" \" + string (thread.exists (id))", function (theValue) {
			const elapsed = Date.now () - whenStart;
			const theParts = String (theValue).split (" ");
			checkThat ("the caller comes back at once, not after the thread's three seconds", elapsed < 1500);
			if (elapsed >= 1500) {
				console.log ("         (" + elapsed + " ms; answered " + JSON.stringify (theValue) + ")");
				}
			checkThat ("with a thread id, not the script's value", Number (theParts [0]) > 1);
			checkThat ("and thread.exists says the thread is running", theParts [1] === "true");
			runText ("defined (scratchpad.ccThreadWrote)", function (theValue) {
				checkThat ("the thread hasn't written yet", theValue === false);
				wait (4500, function () {
					runText ("scratchpad.ccThreadWrote", function (theValue) {
						checkThat ("the thread's script ran, with its parameter", theValue === "hello from the thread");
						runInteractive ("string (thread.exists (" + theParts [0] + "))", function (theValue) {
							checkThat ("and thread.exists says it's gone", theValue === "false");
							testTheWindow ();
							});
						});
					});
				});
			});
		});

	function testTheWindow () {
		installScript ("scratchpad.ccAsk", ["on ccAsk ()", "\tscratchpad.ccThreadSaw = window.frontmost ()", "\treturn (true)"], function (flInstalled) {
			checkThat ("a script that asks the window installs", flInstalled);
			runInteractive ("thread.callScript (@scratchpad.ccAsk, {}); thread.sleepFor (2); scratchpad.ccThreadSaw", function (theValue, asks) {
				checkThat ("a thread started from a script with a window asks that window", asks.indexOf ("window.frontmost") !== -1);
				checkThat ("and gets its answer", theValue === "the test window");
				testTheWindowAfterTheRun ();
				});
			});
		}

	function testTheWindowAfterTheRun () { //9/16/26 by CC -- DW's report: nodeEditor's Save button runs thread.callScript and returns at once; the thread's window verbs then had no window (nothing happened). The window stays with the thread until the thread lets go.
		installScript ("scratchpad.ccAskLater", ["on ccAskLater ()", "\tthread.sleepFor (1)", "\tscratchpad.ccThreadSawLater = window.frontmost ()", "\treturn (true)"], function (flInstalled) {
			checkThat ("a script that asks the window after a pause installs", flInstalled);
			runInteractive ("thread.callScript (@scratchpad.ccAskLater, {})", function (theValue, asks) { //the run ends at once, the way a button's does
				checkThat ("the run that started the thread ends at once, with the thread's id", Number (theValue) > 1);
				wait (3000, function () {
					runText ("string (scratchpad.ccThreadSawLater)", function (theValue) {
						checkThat ("a thread that outlives the run that started it keeps that run's window", theValue === "the test window");
						checkThat ("and the question reached the page after the run had finished", asks.indexOf ("window.frontmost") !== -1);
						testKill ();
						});
					});
				});
			});
		}
	function testKill () {
		installScript ("scratchpad.ccForever", ["on ccForever ()", "\tloop", "\t\tthread.sleepFor (1)"], function (flInstalled) {
			checkThat ("a script that loops forever installs", flInstalled);
			runInteractive ("local (id = thread.callScript (@scratchpad.ccForever, {})); thread.sleepFor (1); local (s = string (thread.exists (id))); thread.kill (id); thread.sleepFor (1); s + \" \" + string (thread.exists (id))", function (theValue) {
				checkThat ("thread.kill stops a running thread", theValue === "true false");
				runInteractive ("local (id = thread.evaluate (\"scratchpad.ccForever ()\")); thread.sleepFor (1); local (s = string (thread.exists (id))); thread.kill (id); s", function (theValue) { //scheduler0.monitorThreads starts every thread this way
					checkThat ("thread.evaluate starts a thread too, the way scheduler0.monitorThreads does", theValue === "true");
					testTheAgent ();
					});
				});
			});
		}

	function testTheAgent () {
		installScript ("scratchpad.ccDialog", ["on ccDialog ()", "\tif dialog.confirm (\"nobody can answer this\")", "\t\tscratchpad.ccDialogDone = true", "\treturn (true)"], function (flInstalled) { //dialog.confirm needs an answer; an alert is answered quietly with no window, the agents' rule of 8/29
			checkThat ("a script with a dialog in it installs", flInstalled);
			installScript ("system.agents.ccThreader", ["if not defined (scratchpad.ccAgentBeats)", "\tscratchpad.ccAgentBeats = 0", "\tthread.callScript (@scratchpad.ccDialog, {})", "scratchpad.ccAgentBeats = scratchpad.ccAgentBeats + 1"], function (flCompiled) { //a new script in system.agents starts on the next scan
				checkThat ("an agent that starts a thread installs", flCompiled);
				wait (8000, function () { //the agents scan runs every three seconds; the agent starts on the next one, then beats once a second
					runText ("scratchpad.ccAgentBeats", function (theValue) {
						checkThat ("the agent keeps beating after starting the thread", Number (theValue) >= 3);
						runText ("defined (scratchpad.ccDialogDone)", function (theValue) {
							checkThat ("the thread it started had no window, so its dialog failed and it went no further", theValue === false);
							checkThat ("and the server log says why", serverOutput.indexOf ("stopped -- Can't ask a question because the script is running as a thread with no window to ask.") !== -1);
							testTheAboutWindow ();
							});
						});
					});
				});
			});
		}
		});
		});
	}

	function testTheAboutWindow () { //9/16/26 by CC -- msg and the About window's line, the rules of ccmsg in about.c: an agent's message is filed under its name and shows when it is the chosen agent; a run's message takes the line and blocks the agents' until a click
		function aboutState (callback) {
			request ("/aboutstate", "GET", undefined, function (theCode, theText) {
				var theState;
				try {
					theState = JSON.parse (theText);
					}
				catch (err) {
					theState = {};
					}
				callback (theState);
				});
			}
		installScript ("system.agents.ccMsgAgent", ["msg (\"ccMsgAgent says hello\")"], function (flInstalled) {
			checkThat ("an agent whose beat is a msg installs", flInstalled);
			wait (6000, function () { //the scan starts it within three seconds; it beats once a second
				aboutState (function (theState) {
					checkThat ("the About window's popup lists the agent", Array.isArray (theState.agents) && (theState.agents.indexOf ("ccMsgAgent") !== -1));
					request ("/aboutselect?agent=ccMsgAgent", "POST", "", function (theCode, theText) {
						var theState;
						try {
							theState = JSON.parse (theText);
							}
						catch (err) {
							theState = {};
							}
						checkThat ("choosing the agent shows its last message", theState.message === "ccMsgAgent says hello");
						runText ("msg (\"hello from a run\")", function () {
							aboutState (function (theState) {
								checkThat ("a run's msg takes the line", theState.message === "hello from a run");
								wait (2500, function () {
									aboutState (function (theState) {
										checkThat ("and holds it while the agent keeps sending", theState.message === "hello from a run");
										request ("/aboutclick", "POST", "", function () {
											wait (1500, function () {
												aboutState (function (theState) {
													checkThat ("a click in the window lets the agent's messages back", theState.message === "ccMsgAgent says hello");
													checkThat ("Scripts Running counts the agents", Number (theState.ctScriptsRunning) >= 1);
													testTheQuickScriptText ();
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

	function testTheQuickScriptText () { //9/16/26 by CC -- the Quick Script window's text is kept with the database (the root record's hscriptstring): /setsetting and /getsetting, and window.setQuickScript writes it
		runInteractive ("window.quickScript ()", function (theValue, asks) { //9/17/26 by CC -- DW's report: window.quickScript () put up "Not implemented yet." -- an 8/13 stub installed after the real verb
			checkThat ("window.quickScript asks the page to open the window, not a stub", asks.indexOf ("window.quickscript") !== -1);
			testTheQuickScriptText2 ();
			});
		}
	function testTheQuickScriptText2 () {
		request ("/setsetting?name=quickScript", "POST", "random (0, 1000)", function (theCode) {
			checkThat ("the Quick Script window's text can be saved", theCode === 200);
			request ("/getsetting?name=quickScript", "GET", undefined, function (theCode, theText) {
				var theSetting;
				try {
					theSetting = JSON.parse (theText);
					}
				catch (err) {
					theSetting = {};
					}
				checkThat ("and read back", theSetting.value === "random (0, 1000)");
				installScript ("scratchpad.ccSetQuickScript", ["on ccSetQuickScript (s)", "\tkernel (window.setquickscript)"], function (flInstalled) { //the glue's shape: the 2012 root has glue for window.quickScript and none for window.setQuickScript (a 2007 kernel verb), so the test carries its own
					checkThat ("a glue script for window.setQuickScript installs", flInstalled);
					runInteractive ("scratchpad.ccSetQuickScript (\"dialog.alert (\\\"hello\\\")\")", function (theValue) {
					checkThat ("window.setQuickScript, through the glue, answers true", theValue === true);
					request ("/getsetting?name=quickScript", "GET", undefined, function (theCode, theText) {
						var theSetting;
						try {
							theSetting = JSON.parse (theText);
							}
						catch (err) {
							theSetting = {};
							}
						checkThat ("and the window's text is what it set", theSetting.value === "dialog.alert (\"hello\")");
						runInteractive ("scratchpad.ccSetQuickScript (nil)", function (theValue2) { //9/26/26 by CC -- DW's report: the window opened saying "undefined"
							request ("/getsetting?name=quickScript", "GET", undefined, function (theCode2, theText2) {
								var theSetting2;
								try {
									theSetting2 = JSON.parse (theText2);
									}
								catch (err) {
									theSetting2 = {};
									}
								checkThat ("window.setQuickScript with nothing to set stores the empty string, not the word undefined", theSetting2.value === "");
								stopServer (finish);
								});
							});
						});
					});
					});
				});
			});
		}

function waitForStartup (callback) { //the startupScript runs on its own worker after the server answers; the other gates wait for it the same way
	var ctPolls = 0;
	function poll () {
		runText ("string (system.temp.Frontier.startingUp)", function (theValue) {
			if ((theValue === "false") || (ctPolls > 40)) {
				callback ();
				}
			else {
				ctPolls++;
				setTimeout (poll, 250);
				}
			});
		}
	poll ();
	}

function finish () {
	console.log ("");
	console.log (ctPassed + " passed, " + ctFailed + " failed.");
	if (ctFailed > 0) {
		console.log ("");
		console.log ("   the server's thread and agent lines:");
		String (serverOutput).split ("\n").forEach (function (theLine) {
			if ((theLine.toLowerCase ().indexOf ("thread") !== -1) || (theLine.indexOf ("agents:") !== -1) || (theLine.indexOf ("Error") !== -1) || (theLine.indexOf (" asks: ") !== -1)) {
				console.log ("      " + theLine);
				}
			});
		console.log ("");
		theFailures.forEach (function (theDescription) {
			console.log ("   " + theDescription);
			});
		process.exit (1);
		}
	}

runTheTests ();
