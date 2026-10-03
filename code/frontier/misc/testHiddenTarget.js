/*  testHiddenTarget.js -- the server-level gate for the op and comment verbs
	on a hidden target: a script sets the target to a copy of a script
	(target.set (@partcopy), DW's releasePart) and walks it with
	op.firstSummit, op.go, script.isComment and op.getLineText while no
	window is open on it. Runs the script through /run?interactive=1 on a
	real trigger.js and plays the page's half: every window question is
	answered as "no window". Before 9/9/26 script.isComment went to the
	window whatever the target was.
	node misc/testHiddenTarget.js [path to the .db]
	by CC, 9/9/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const folderScratch = pathTool.join (require ("os").tmpdir (), "testHiddenTarget");
const thePort = 5396;
const thePassword = "target";

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


function runInteractive (theScript, callback) { //the value, with every window question answered as no window; the asks are collected
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
				theReply = {value: false};
				}
			request ("/dialoganswer?runid=" + encodeURIComponent (theAnswer.runId), "POST", JSON.stringify (theReply), step);
			}
		else {
			callback ((theAnswer.value !== undefined) ? theAnswer.value : theAnswer.message, asks);
			}
		}
	request ("/run?interactive=1", "POST", theScript, step);
	}

function runWithWindow (theScript, answerFor, callback) { //10/1/26 by CC -- like runInteractive, with a window on the other end: answerFor (theDialog) answers each window question the way a page would, or undefined for "no window"
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
			asks.push ({verb: theAnswer.dialog.verb, params: theAnswer.dialog.params});
			var theReply = answerFor (theAnswer.dialog);
			if (theReply === undefined) {
				theReply = {value: (theAnswer.dialog.verb === "window.isopen") ? false : ""};
				}
			request ("/dialoganswer?runid=" + encodeURIComponent (theAnswer.runId), "POST", JSON.stringify (theReply), step);
			}
		else {
			callback ((theAnswer.value !== undefined) ? theAnswer.value : theAnswer.message, asks);
			}
		}
	request ("/run?interactive=1", "POST", theScript, step);
	}

function checkSelectionVerbs (callback) {

	/*  10/1/26 by CC -- wp.getSelect, wp.getSelText, wp.setSelect and
		wp.setTextMode go to the window. They were the library's placeholders
		(no selection, nothing set), so the HTML menu's Add Link never saw
		what was selected: DW's 10/1 report, "it should turn the selected
		text into a link." wpverbs.c: getselectfunc assigns the selection's
		start and end through its two addresses. Here the page's half says
		the selection is characters 18 to 27, "this link".  */

	function thePage (theDialog) {
		switch (theDialog.verb) {
			case "wp.getselect":
				return ({value: {start: 18, end: 27}});
			case "wp.getseltext":
				return ({value: "this link"});
			case "wp.setselect": case "wp.settextmode": case "wp.insert":
				return ({value: true});
			}
		return (undefined);
		}
	const theScript = [
		"local (start, end, source = \"\")",
		"wp.setTextMode (true)",
		"wp.getSelect (@start, @end)",
		"if start != end",
		"\tsource = wp.getSelText ()",
		"wp.insert (\"<a href=\\\"http://x/\\\">\" + source + \"</a>\")",
		"wp.setSelect (start + 11 + 9, start + 11 + 9 + sizeOf (source))",
		"string (start) + \"|\" + string (end) + \"|\" + source"
		].join ("\n");
	runWithWindow (theScript, thePage, function (theValue, asks) {
		checkThat ("wp.getSelect assigns the window's selection through its two addresses, and wp.getSelText answers the selected text", theValue === "18|27|this link");
		if (theValue !== "18|27|this link") {
			console.log ("         got " + JSON.stringify (theValue));
			}
		var theInsert, theSetSelect, flTextMode = false;
		asks.forEach (function (theAsk) {
			if (theAsk.verb === "wp.insert") {
				theInsert = theAsk.params [0];
				}
			if (theAsk.verb === "wp.setselect") {
				theSetSelect = theAsk.params;
				}
			if ((theAsk.verb === "wp.settextmode") && (theAsk.params [0] === true)) {
				flTextMode = true;
				}
			});
		checkThat ("the insert the window is asked for wraps the selected text in the anchor", theInsert === "<a href=\"http://x/\">this link</a>");
		checkThat ("wp.setSelect reaches the window with its two numbers", Array.isArray (theSetSelect) && (theSetSelect [0] === 38) && (theSetSelect [1] === 47));
		checkThat ("and wp.setTextMode (true) reaches the window", flTextMode);
		callback ();
		});
	}

function checkLogFilesMarked (callback) {

	/*  10/1/26 by CC -- /getdatabases marks the log's daily files, so the app
		can leave them out of the Window menu: DW's 9/19, 9/30 and 10/1 word,
		"i don't want the dated entries in this menu", "they aren't my
		windows." A database that isn't in user.log.prefs.folder -- a data
		file a script opened -- is listed without the mark.  */

	const theScript = [ //an open database is a table at the top of the root named by its file's path (fileMenu.open's shape); two are made that way, one in the log's folder, with no file written
		"user.log.prefs.folder = \"Macintosh HD:ccGate:logs:\"",
		"new (tableType, @root.[\"Macintosh HD:ccGate:logs:2026-10-01.root\"])",
		"new (tableType, @root.[\"Macintosh HD:ccGate:data:ccGateData.root\"])",
		"user.log.prefs.folder"
		].join ("\n");
	runText (theScript, function (theFolder) {
		request ("/getdatabases", "GET", undefined, function (theCode, theText) {
			var theDatabases = [];
			try {
				theDatabases = JSON.parse (theText).databases;
				}
			catch (err) {
				}
			var ctLogFiles = 0, ctLogFilesUnmarked = 0, flDataFileListed = false, flDataFileMarked = false;
			theDatabases.forEach (function (theDatabase) {
				if (theDatabase.flPathNamed === true) {
					if (String (theDatabase.topName).toLowerCase ().indexOf (String (theFolder).toLowerCase ()) === 0) {
						ctLogFiles++;
						if (theDatabase.flLogFile !== true) {
							ctLogFilesUnmarked++;
							}
						}
					if (theDatabase.name === "ccGateData.root") {
						flDataFileListed = true;
						flDataFileMarked = (theDatabase.flLogFile === true);
						}
					}
				});
			checkThat ("a database in user.log.prefs.folder is in the list of open databases", (typeof theFolder === "string") && (theFolder.length > 0) && (ctLogFiles > 0));
			checkThat ("/getdatabases marks every database in the log's folder as the log's (flLogFile), for the Window menu to leave out", (ctLogFiles > 0) && (ctLogFilesUnmarked === 0));
			checkThat ("and a database a script opened somewhere else is listed without the mark", flDataFileListed && !flDataFileMarked);
			callback ();
			});
		});
	}

function checkInsertOfReturnText (callback) {

	/*  9/21/26 by CC -- op.insert of a text with RETURNS in it deposits a
		structure: the kernel's opinserthandle asks isoutlinetext, and
		isoutlinetext looks for chreturn -- a carriage return, Frontier's
		line ending -- then optexttooutline builds the lines by their tabs.
		Here only a linefeed counted, so script.newScriptObject ("on x
		()\r\treturn (5)", adr) made ONE line with a return inside it, a
		script that doesn't parse. mainResponder.startup makes its webEdit
		and scheduler callbacks exactly that way; found the first hour of
		the Manila work.  */

	runInteractive ("script.newScriptObject (\"on ccFive ()\\r\\treturn (5)\", @scratchpad.ccFive); string (scratchpad.ccFive ()) + \"|\" + string (sizeOf (scratchpad.ccFive))", function (theValue) {
		checkThat ("script.newScriptObject with returns in the text makes a script of lines, and it runs", theValue === "5|2");
		if (theValue !== "5|2") {
			console.log ("         got " + JSON.stringify (theValue));
			}
		runInteractive ("script.newScriptObject (\"on ccSix ()\\r\\n\\treturn (6)\", @scratchpad.ccSix); string (scratchpad.ccSix ())", function (theValue2) {
			checkThat ("a return and a linefeed together are one line ending", theValue2 === "6");
			if (theValue2 !== "6") {
				console.log ("         got " + JSON.stringify (theValue2));
				}
			callback ();
			});
		});
	}

function checkTabsInsideALine (callback) {

	/*  9/19/26 by CC -- a tab INSIDE a line's text survives the trip to a
		window and back. DW's libraries.scripts, 9/19: five lines of the
		base64 code ended in tabs, and after a window saved they ended in
		spaces. The server sent the tab raw inside the text attribute, and
		an XML parser reading an attribute turns a raw tab, return or
		linefeed into a space -- the rule is in the XML spec, and the page's
		parser follows it. Written as &#9; the tab gets through. And the
		other direction: a client that writes its OPML with a real XML
		serializer sends &#9; for the tab, and the server has to read it as
		one, not store the five characters.  */

	const theLine = "return uarray;\t", theSecondLine = "var s = \"a\tb\";";
	request ("/uploadobject?address=scratchpad.ccTabs&type=outline", "POST", opmlForLines ([theLine, theSecondLine]), function (theCode) {
		checkThat ("an outline whose lines have tabs inside them installs", theCode === 200);
		request ("/downloadobject?address=scratchpad.ccTabs", "GET", undefined, function (theCode2, theText) {
			var opmltext = "";
			try {
				opmltext = JSON.parse (theText).opmltext;
				}
			catch (err) {
				}
			checkThat ("the OPML a window gets carries each tab as &#9;", opmltext.split ("&#9;").length === 3);
			checkThat ("and no raw tab inside a text attribute, where an XML parser would make it a space", /text="[^"]*\t[^"]*"/.test (opmltext) === false);
			const theSerialized = opmlForLines ([theLine, theSecondLine]).split ("\t").join ("&#9;"); //what a real XML serializer sends
			request ("/uploadobject?address=scratchpad.ccTabsBack&type=outline", "POST", theSerialized, function (theCode3) {
				runText ("string.countFields (string (scratchpad.ccTabsBack), \"\\t\") + \"/\" + (string (scratchpad.ccTabsBack) contains \"&#9;\")", function (theValue) {
					checkThat ("an upload that writes the tab as &#9; is stored with a real tab", theValue === "3/false");
					if (theValue !== "3/false") {
						console.log ("         got " + JSON.stringify (theValue));
						}
					callback ();
					});
				});
			});
		});
	}

function checkWptextRoundTrip (callback) { //9/24/26 by CC -- DW's 9/23 report: edit () of a wptext stopped with "isn't a script or an outline"; a wp text moves through /downloadobject and /uploadobject as one line per paragraph

	runInteractive ("wp.newTextObject (\"Dear reader,\\r\\rSecond paragraph.\", @scratchpad.ccWp); typeOf (scratchpad.ccWp)", function (theValue) {
		checkThat ("a wp text was made for the round trip", theValue === "wptx");
		request ("/downloadobject?address=scratchpad.ccWp", "GET", undefined, function (theCode, theText) {
			var data = {};
			try {
				data = JSON.parse (theText);
				}
			catch (err) {
				}
			checkThat ("/downloadobject sends a wp text (before 9/24 it refused: not a script or an outline)", theCode === 200);
			checkThat ("as three lines, one per paragraph, typed wptext", (data.ctLines === 3) && (data.scriptType === "wptext") && (String (data.opmltext).indexOf ("Second paragraph.") !== -1));
			request ("/uploadobject?address=scratchpad.ccWp&type=wptext", "POST", opmlForLines (["Dear reader,", "", "Second paragraph, edited."]), function (theCode2) {
				checkThat ("/uploadobject takes the window's lines back as a wp text", theCode2 === 200);
				runText ("string (typeOf (scratchpad.ccWp)) + \"|\" + string.replaceAll (string (scratchpad.ccWp), \"\\r\", \"/\")", function (theValue2) {
					checkThat ("and the object is still a wp text whose paragraphs are the lines, a return between each", theValue2 === "wptx|Dear reader,//Second paragraph, edited.");
					callback ();
					});
				});
			});
		});
	}

function checkExpandLevels (callback) { //9/24/26 by CC -- op.expand (infinity) on a hidden target opens every level under the cursor, opexpand's ctlevels; before today only the cursor line opened

	installScript ("scratchpad.ccDeep", ["top", "\tmiddle", "\t\tbottom", "\t\t\tleaf"], false, function () {
		request ("/run", "POST", "scratchpad.ccDeep.lines; true", function () { //9/21/26 -- a read so the store knows the object
			runInteractive ("local (partcopy = scratchpad.ccDeep); local (oldtarget = target.set (@partcopy)); op.firstSummit (); op.fullCollapse (); op.expand (infinity); op.go (right, 1); op.go (right, 1); local (s = string (op.subsExpanded ())); target.set (oldtarget); s", function (theValue) {
				checkThat ("op.expand (infinity) on a hidden target opens the levels below the cursor, not just the cursor line (bottom's subs are showing)", theValue === "true");
				runInteractive ("local (partcopy = scratchpad.ccDeep); local (oldtarget = target.set (@partcopy)); op.firstSummit (); op.fullCollapse (); op.expand (2); op.go (right, 1); local (s1 = string (op.subsExpanded ())); op.go (right, 1); local (s2 = string (op.subsExpanded ())); target.set (oldtarget); s1 + \"|\" + s2", function (theValue2) {
					checkThat ("op.expand (2) opens two levels and no more (middle's subs showing, bottom's not)", theValue2 === "true|false");
					runInteractive ("local (partcopy = scratchpad.ccDeep); local (oldtarget = target.set (@partcopy)); op.firstSummit (); local (l1 = op.level ()); op.expand (infinity); op.go (right, 1); op.go (right, 1); local (l3 = op.level ()); target.set (oldtarget); string (l1) + \"|\" + string (l3)", function (theValue3) { //9/25/26 by CC -- op.level on a hidden target, oplevel: 1 for a summit
						checkThat ("op.level on a hidden target answers 1 for a summit and 3 two levels in", theValue3 === "1|3");
						callback ();
						});
					});
				});
			});
		});
	}

function runTheTests () {
	const pathConfig = buildInstallation ();
	console.log ("");
	console.log ("The op and comment verbs act on a hidden target, no window open");
	startServer (pathConfig, function () {
	waitForStartup (function () {
		installScript ("scratchpad.ccHello", ["on helloFrontier ()", "\tChanges", "\t\t9/6/26; 12:36:15 PM by DW", "\t\t\tCreated. Helps test the rootUpdates mechanism.", "\tdialog.alert (\"Hello World\")", "bundle //test code", "\thelloFrontier ()"], false, function (flInstalled) {
			checkThat ("the part-shaped script installs", flInstalled);
			request ("/run", "POST", "scratchpad.ccHello.lines; local (l = scratchpad.ccHello); true", function () {
				runInteractive ("local (partcopy = scratchpad.ccHello); local (oldtarget = target.set (@partcopy)); op.firstsummit (); op.go (right, 1); script.makecomment (); local (s = string (script.iscomment ())); target.set (oldtarget); s", function (theValue, asks) {
					checkThat ("script.makeComment and isComment work on the target's cursor line", theValue === "true");
					checkThat ("and neither asked the window", asks.indexOf ("script.iscomment") === -1 && asks.indexOf ("script.makecomment") === -1);
					const theWalk = [
						"local (adrpart = @scratchpad.ccHello, comment = \"\")",
						"local (partcopy = adrpart^)",
						"local (oldtarget = target.set (@partcopy))",
						"op.firstsummit (); op.expand (1)",
						"if not script.iscomment ()",
						"\top.go (right, 1)",
						"op.expand (1)",
						"if op.go (right, 1)",
						"\top.expand (1)",
						"\tif op.go (right, 1)",
						"\t\tcomment = op.getlinetext ()",
						"target.set (oldtarget)",
						"comment"
						].join ("\n");
					runInteractive (theWalk, function (theComment, asks2) {
						checkThat ("DW's releasePart walk finds the Changes comment on the hidden copy", theComment === "Created. Helps test the rootUpdates mechanism.");
						checkThat ("with only window.frontmost and window.isopen asked of the page", asks2.filter (function (a) { return (a !== "window.frontmost" && a !== "window.isopen"); }).length === 0);
						//9/10/26 by CC -- DW's 9/10 ask: the same walk on a part whose Changes has more than one day of comments
						installScript ("scratchpad.ccTwoDays", ["on releasePart ()", "\tChanges", "\t\t9/6/26; 1:39:59 PM by DW", "\t\t\tInit everything when the rootname is known.", "\t\t8/28/26; 11:04:08 AM by DW", "\t\t\tUpdating for use in Atlantis.", "\tlocal (flRemoteCall = false)", "\treturn (true)", "bundle //test code", "\treleasePart ()"], false, function () {
							runInteractive (theWalk.split ("scratchpad.ccHello").join ("scratchpad.ccTwoDays"), function (theComment2, asks3) {
								checkThat ("with two days of comments the walk answers the newest day's note (the first under Changes)", theComment2 === "Init everything when the rootname is known.");
								if (theComment2 !== "Init everything when the rootname is known.") {
									console.log ("         got " + JSON.stringify (theComment2));
									}
								//and the same part with the Changes lines COLLAPSED, the way a stored script usually has them
								request ("/uploadobject?address=scratchpad.ccCollapsed&type=script", "POST", opmlForLines (["on releasePart ()", "\tChanges", "\t\t9/6/26; 1:39:59 PM by DW", "\t\t\tInit everything when the rootname is known.", "\t\t8/28/26; 11:04:08 AM by DW", "\t\t\tUpdating for use in Atlantis.", "\tlocal (flRemoteCall = false)", "\treturn (true)", "bundle //test code", "\treleasePart ()"]).replace ("<head>", "<head><expansionState>1</expansionState>"), function () {
									runInteractive (theWalk.split ("scratchpad.ccHello").join ("scratchpad.ccCollapsed"), function (theComment3) {
										checkThat ("with the Changes lines collapsed the walk still answers the newest day's note", theComment3 === "Init everything when the rootname is known.");
										if (theComment3 !== "Init everything when the rootname is known.") {
											console.log ("         got " + JSON.stringify (theComment3));
											}
								checkTabsInsideALine (function () { //9/19/26 by CC
								checkInsertOfReturnText (function () { //9/21/26 by CC
								checkWptextRoundTrip (function () { //9/24/26 by CC
								checkExpandLevels (function () { //9/24/26 by CC
								checkSelectionVerbs (function () { //10/1/26 by CC
								checkLogFilesMarked (function () { //10/1/26 by CC
								stopServer (function () {
									console.log ("");
									console.log (ctPassed + " passed, " + ctFailed + " failed.");
									process.exit ((ctFailed === 0) ? 0 : 1);
									});
								});
								});
								});
								});
								});
								});
								}); });
								});
							});
						return;
						stopServer (function () {
							console.log ("");
							console.log (ctPassed + " passed, " + ctFailed + " failed.");
							process.exit ((ctFailed === 0) ? 0 : 1);
							});
						});
					});
				});
			});
		});
		});
	}

function waitForStartup (callback) {
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
