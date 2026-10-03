/*  testTools.js -- the gate for DW's 9/3 ruling: nodeEditorSuite MUST NOT
	be in frontier.root; it comes in through the Tools folder as
	nodeEditor.root, and our work depends on that continuing to work.

	node misc/testTools.js [path to the .db] [path to nodeEditor.root]

	Builds a scratch installation on a COPY of the database with a Guest
	Databases/Tools folder beside it, the way a fresh install lays it out,
	and starts a real trigger.js on its own port -- the Tools scanner runs
	at startup, so the check has to be server-level. Then:

		1. the database itself has no nodeEditorSuite (the ruling);
		2. with nodeEditor.root in Tools, the suite is there after launch,
		   the whole thing (444 utilities), and user.tools.databases
		   remembers it (Frontier.tools.install's record);
		3. the Tools menu carries NodeEditor as a submenu, ahead of the
		   separator, and user.menus.tools reaches it as an address (the
		   9/3 report: "i don't see the Tools menu in the menubar");
		4. an address written with the file path in brackets, the way
		   DW's user.menus.nodeedit is, finds the installed root;
		5. the file taken out of Tools and the server relaunched: the suite
		   is gone again, the record says not installed.

	by CC, 9/3/26  */

const fs = require ("fs");
const pathTool = require ("path");
const http = require ("http");
const {spawn} = require ("child_process");

const folderTrigger = pathTool.join (__dirname, "..");
const pathMaster = (process.argv [2] === undefined) ? pathTool.join (folderTrigger, "data", "seed.db") : process.argv [2];
const pathToolRoot = (process.argv [3] === undefined) ? pathTool.join (folderTrigger, "misc", "nodeEditor.root") : process.argv [3]; //9/4/26 by CC -- nodeEditor.root left the distribution (DW: "i wrote it only for myself"); the file lives in misc for this test and for him
const folderScratch = pathTool.join (require ("os").tmpdir (), "testTools");
const thePort = 5397;
const thePassword = "tools";

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

const folderTools = pathTool.join (folderScratch, "data", "Guest Databases", "apps", "Tools"); //9/15/26 by CC -- Frontier's folder
const pathHisConfigRoot = "Macintosh HD:Users:davewiner:Desktop:OPML:Guest Databases:apps:config.root"; //9/10/26 by CC -- a second config.root, opened as a file

function buildInstallation () {
	fs.rmSync (folderScratch, {recursive: true, force: true});
	fs.mkdirSync (folderTools, {recursive: true});
	fs.mkdirSync (pathTool.join (folderScratch, "renders"), {recursive: true});
	fs.mkdirSync (pathTool.join (folderScratch, "scriptTemp"), {recursive: true});
	const pathDatabase = pathTool.join (folderScratch, "data", "frontier.db");
	fs.copyFileSync (pathMaster, pathDatabase);
	fs.copyFileSync (pathToolRoot, pathTool.join (folderTools, "nodeEditor.root"));

	/*  9/10/26 by CC -- a database opened from a file named config.root, beside
		the shipped config.root: a top-level table named by the file's path, the
		way fileMenu.open keeps a guest, holding his projects. DW's 9/10 report:
		the project scripts object couldn't be opened from its window.  */
	const odbSql = require (pathTool.join (folderTrigger, "..", "usertalk", "code", "odbSql.js"));
	const theStore = odbSql.openDatabase (pathDatabase);
	const odbHome = require (pathTool.join (folderTrigger, "..", "usertalk", "code", "odbHome.js"));
	const t = function (theValue) { return ({type: "table", value: theValue}); }; //the reader's shape, converted the way a root file is installed
	theStore.odb [pathHisConfigRoot] = odbHome.convertValue (t ({config: t ({nodeEditor: t ({projects: t ({rssChat: t ({callbacks: t ({}), glossary: t ({}), scripts: {type: "outline", lines: [{level: 0, text: "line one", flExpanded: true, flComment: false, flBreakpoint: false}]}})})})})}));
	theStore.close ();
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
				if ((ctPolls < 120) && (theServer.exitCode === null)) {
					setTimeout (poll, 250);
					}
				else {
					callback (new Error ("the server didn't come up"));
					}
				}
			});
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

function askVersion (callback) {
	http.get ("http://localhost:" + thePort + "/version", function (theResponse) {
		theResponse.resume ();
		callback (theResponse.statusCode === 200);
		}).on ("error", function () {
			callback (false);
			});
	}

function runScript (theText, callback) { //callback (theValue or undefined, theAnswer)
	const theRequest = http.request ("http://localhost:" + thePort + "/run?password=" + thePassword, {method: "POST", headers: {"Content-Type": "text/plain"}}, function (theResponse) {
		var theBody = "";
		theResponse.on ("data", function (chunk) {
			theBody += chunk;
			});
		theResponse.on ("end", function () {
			var theAnswer;
			try {
				theAnswer = JSON.parse (theBody);
				}
			catch (err) {
				theAnswer = {message: theBody};
				}
			callback (theAnswer.value, theAnswer);
			});
		});
	theRequest.on ("error", function (err) {
		callback (undefined, {message: err.message});
		});
	theRequest.end (theText);
	}

function getJson (thePath, callback) {
	http.get ("http://localhost:" + thePort + thePath + (thePath.indexOf ("?") === -1 ? "?" : "&") + "password=" + thePassword, function (theResponse) {
		var theBody = "";
		theResponse.on ("data", function (chunk) {
			theBody += chunk;
			});
		theResponse.on ("end", function () {
			try {
				callback (JSON.parse (theBody));
				}
			catch (err) {
				callback ({message: theBody});
				}
			});
		}).on ("error", function (err) {
			callback ({message: err.message});
			});
	}

function finish () {
	console.log ("");
	console.log (ctPassed + " passed, " + ctFailed + " failed.");
	if (ctFailed > 0) {
		theFailures.forEach (function (theFailure) {
			console.log ("   " + theFailure);
			});
		process.exit (1);
		}
	process.exit (0);
	}

function main () {
	console.log ("testTools -- " + pathMaster + " with " + pathToolRoot);
	if (!fs.existsSync (pathToolRoot)) {
		checkThat ("nodeEditor.root is here to test with (" + pathToolRoot + ")", false);
		finish ();
		return;
		}

	//1. the ruling, checked in the database itself before any server runs
	const sqlite3 = require (pathTool.join (folderTrigger, "node_modules", "better-sqlite3"));
	const theDatabase = new sqlite3 (pathMaster, {readonly: true});
	const theRow = theDatabase.prepare ("select count (*) as ct from odb where parentid = 0 and lowername like 'nodeeditor%';").get ();
	const theRecord = theDatabase.prepare ("select count (*) as ct from odb where lowername = 'nodeeditor.root' and parentid in (select id from odb where lowername = 'files');").get ();
	theDatabase.close ();
	checkThat ("frontier.root has no nodeEditor tables at its top level (DW's 9/3 ruling)", theRow.ct === 0);
	checkThat ("and no build-time record for nodeEditor.root in system.compiler.files", theRecord.ct === 0);

	const pathConfig = buildInstallation ();
	startServer (pathConfig, function (err) {
		checkThat ("the server comes up with nodeEditor.root in Guest Databases/apps/Tools", err === undefined);
		if (err !== undefined) {
			console.log (serverOutput);
			finish ();
			return;
			}
		checkThat ("the log says nodeEditor.root was installed", serverOutput.indexOf ("installed nodeEditor.root -- 10 names") !== -1);
		checkGuestNames (function () { //9/13/26 by CC -- a guest's window owns what is made in it
		checkTheDatabaseWins (pathConfig, function () { //9/18/26 by CC -- an installed Tool is never reinstalled at launch
		runScript ("defined (nodeEditorSuite)", function (theValue) {
			checkThat ("nodeEditorSuite is defined after launch", theValue === true);
			runScript ("sizeOf (nodeEditorSuite.utilities)", function (theValue) {
				checkThat ("the whole suite came in -- 444 utilities", theValue === 444);
				runScript ("user.tools.databases.nodeEditor.flInstalled", function (theValue) {
					checkThat ("user.tools.databases.nodeEditor says installed (Frontier.tools.install's record)", theValue === true);
					runScript ("typeOf (user.menus.tools)", function (theValue) {
						checkThat ("user.menus.tools is an address (tools.init's line)", theValue === "addr");
						getJson ("/getmenubar?address=user.menus.tools", function (theAnswer) {
							const theItems = [];
							if (Array.isArray (theAnswer.lines)) {
								theAnswer.lines.forEach (function (theLine) {
									if (theLine.level === 1) {
										theItems.push (theLine.text);
										}
									});
								}
							const flToolsMenu = (theAnswer.resolvedAddress === "system.verbs.builtins.Frontier.tools.menu") || (theAnswer.resolvedAddress === "Frontier.tools.menu"); //9/18/26 by CC -- after a relaunch the startupScript's own line writes the address in its short form, Frontier.tools.menu; the same menubar either way. The relaunch came in with checkTheDatabaseWins
							checkThat ("/getmenubar follows the address to Frontier.tools.menu" + (flToolsMenu ? "" : " -- it answered " + JSON.stringify (theAnswer.resolvedAddress)), flToolsMenu);
							checkThat ("the Tools menu's first item is the NodeEditor submenu, ahead of the separator", (theItems [0] === "NodeEditor") && (theItems [1] === "-"));
							checkThat ("and the virgin items follow (Update Front Tool...)", theItems.indexOf ("Update Front Tool...") !== -1);
							const theBracketed = "[\"Macintosh HD:Users:davewiner:Desktop:OPML:Guest Databases:apps:Tools:nodeEditor.root\"].nodeEditorSuite.menu";
							getJson ("/getmenubar?address=" + encodeURIComponent (theBracketed), function (theAnswer) {
								checkThat ("an address with the file path in brackets (user.menus.nodeedit's form) finds the installed root's menu", Array.isArray (theAnswer.lines) && (theAnswer.lines [0].text === "NodeEditor"));
								runScript ("typeOf ([\"Macintosh HD:Users:davewiner:Desktop:OPML:Guest Databases:apps:Tools:nodeEditor.root\"].nodeEditorSuite.menu)", function (theValue) {
									checkThat ("and a script reading the same address gets the menubar (the kernel's filewindowtable rule)", theValue === "mbar");
									//5. the file leaves, the server relaunches
									stopServer (function () {
										fs.unlinkSync (pathTool.join (folderTools, "nodeEditor.root"));
										startServer (pathConfig, function (err) {
											checkThat ("the server comes up again with the file gone", err === undefined);
											checkThat ("the log says nodeEditor.root was uninstalled", serverOutput.indexOf ("uninstalled nodeEditor.root") !== -1);
											runScript ("defined (nodeEditorSuite)", function (theValue) {
												checkThat ("nodeEditorSuite is gone again", theValue === false);
												runScript ("user.tools.databases.nodeEditor.flInstalled", function (theValue) {
													checkThat ("the record says not installed", theValue === false);
													getJson ("/getmenubar?address=user.menus.tools", function (theAnswer) {
														var flSubmenu = false;
														if (Array.isArray (theAnswer.lines)) {
															theAnswer.lines.forEach (function (theLine) {
																if ((theLine.level === 1) && (theLine.text === "NodeEditor")) {
																	flSubmenu = true;
																	}
																});
															}
														checkThat ("and the NodeEditor submenu left the Tools menu", !flSubmenu);
														checkTheExactPathRule (function () {
															checkTheOldLayout (pathConfig, function () {
																stopServer (finish);
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
		});
		});
		});
	}

function postJson (thePath, theBody, callback) { //9/13/26 by CC -- the table window's POSTs, the way the page sends them
	const theText = JSON.stringify (theBody);
	const theRequest = http.request ("http://localhost:" + thePort + thePath + "?password=" + thePassword, {method: "POST", headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength (theText), "x-trigger-password": thePassword}}, function (theResponse) {
		var theAnswer = "";
		theResponse.on ("data", function (chunk) {
			theAnswer += chunk;
			});
		theResponse.on ("end", function () {
			try {
				callback (JSON.parse (theAnswer));
				}
			catch (err) {
				callback ({message: "not JSON: " + theAnswer.slice (0, 200)});
				}
			});
		});
	theRequest.on ("error", function (err) {
		callback ({message: err.message});
		});
	theRequest.end (theText);
	}

function checkTheOldLayout (pathConfig, callback) {

	/*  9/18/26 by CC -- A FOLDER FROM BEFORE 9/15 HAS NO apps/Tools, AND THE
		SCAN DIED ON IT. Found reproducing DW's move on a copy of his 9/14
		root: the scanner makes apps, Tools, Inactive Tools, ops and www but
		never Guest Databases/apps/Tools, then reads that folder, so on an
		install laid out the old way the whole scan ended in "Can't scan the
		Tools folder because ENOENT" -- nothing moved, nothing installed, and
		the 9/15 note that the first launch moves the Tools was only true
		where something else had made the folder. Here the folder is taken
		away, a Tool is put in the old Guest Databases/Tools, and the launch
		has to make the folder, move the file and install it.  */

	stopServer (function () {
		const folderOldTools = pathTool.join (folderScratch, "data", "Guest Databases", "Tools");
		fs.rmSync (folderTools, {recursive: true, force: true});
		fs.mkdirSync (folderOldTools, {recursive: true});
		fs.copyFileSync (pathToolRoot, pathTool.join (folderOldTools, "nodeEditor.root"));
		startServer (pathConfig, function (err) {
			checkThat ("the server comes up on a folder with no apps/Tools", err === undefined);
			checkThat ("the scan doesn't fail for want of the folder", serverOutput.indexOf ("Can't scan the Tools folder") === -1);
			checkThat ("the Tool left in the old Guest Databases/Tools is moved to apps/Tools", (serverOutput.indexOf ("nodeEditor.root moved from Guest Databases/Tools") !== -1) && fs.existsSync (pathTool.join (folderTools, "nodeEditor.root")));
			checkThat ("and installed from there", serverOutput.indexOf ("installed nodeEditor.root") !== -1);
			callback ();
			});
		});
	}

function checkTheDatabaseWins (pathConfig, callback) {

	/*  9/18/26 by CC -- THE DATABASE WINS. DW's report, 9/18: he copied his
		Electric Frontier folder from Berkeley to Vermont, and the first
		launch there put an older nodeEditor back -- the save script was an
		old one and utilities.buildHelloFrontier was gone. The scanner
		reinstalled the Tool because the file's date wasn't exactly the one
		it recorded at install (a copy between machines moved it), and a
		reinstall replaces the suite's tables. His edits live in the
		database; nothing is ever written back to the .root file, so the file
		is always the older of the two. Now an installed Tool is left alone
		at launch whatever its file's date says, and the log says so.  */

	runScript ("nodeEditorSuite.ccEditedInTheDatabase = true; defined (nodeEditorSuite.ccEditedInTheDatabase)", function (theValue) {
		checkThat ("an edit made to the Tool inside the database is there", theValue === true);
		stopServer (function () {
			const pathFile = pathTool.join (folderTools, "nodeEditor.root");
			const whenNew = new Date (Date.now () + 5000);
			fs.utimesSync (pathFile, whenNew, whenNew); //the file's date moves, the way a copy to another machine leaves it
			startServer (pathConfig, function (err) {
				checkThat ("the server comes up with the Tool's file date changed", err === undefined);
				checkThat ("the log does not say nodeEditor.root was reinstalled", serverOutput.indexOf ("reinstalled nodeEditor.root") === -1);
				checkThat ("the log says the file's date differs and the database's copy was kept", serverOutput.indexOf ("nodeEditor.root's file date differs") !== -1);
				runScript ("defined (nodeEditorSuite.ccEditedInTheDatabase)", function (theValue) {
					checkThat ("the edit made in the database survived the launch", theValue === true);
					runScript ("delete (@nodeEditorSuite.ccEditedInTheDatabase)", function () {
						var ctPolls = 0;
						function poll () { //the startupScript runs again after this relaunch, and Frontier.tools.startup takes the Tools menu down and puts it back; the checks that follow wait for it, the way testThreads does
							runScript ("string (system.temp.Frontier.startingUp)", function (theValue) {
								if ((theValue === "false") || (ctPolls > 80)) {
									callback ();
									}
								else {
									ctPolls++;
									setTimeout (poll, 250);
									}
								});
							}
						poll ();
						});
					});
				});
			});
		});
	}

function checkGuestNames (callback) {

	/*  9/13/26 by CC -- A GUEST DATABASE'S WINDOW OWNS WHAT IS MADE IN IT.
		nodeEditor.root's names live at the top of frontier.root, listed in
		the scanner's record; a new item made at the top of that guest's
		window landed at the top of frontier.root unowned and the window
		never showed it again (DW's 9/13 report, "i get a blank window").
		The table window's edits say whose window they came from, and the
		server keeps the guest's list of names in step: new, renamed,
		deleted.  */

	function namesOfNodeEditor (whenDone) {
		getJson ("/getdatabases", function (theAnswer) {
			var theNames = [];
			(theAnswer.databases || []).forEach (function (theRecord) {
				if (theRecord.name === "nodeEditor.root") {
					theNames = theRecord.names || [];
					}
				});
			whenDone (theNames.map (function (theName) {
				return (String (theName).toLowerCase ());
				}));
			});
		}
	postJson ("/tableedit", {action: "newitem", parentaddress: "", database: "nodeEditor.root"}, function (theAnswer) {
		checkThat ("a new item at the top of nodeEditor.root's window is made (" + theAnswer.name + ")", typeof theAnswer.name === "string");
		const theName = String (theAnswer.name || "");
		namesOfNodeEditor (function (theNames) {
			checkThat ("and nodeEditor.root owns it -- it's on the guest's list of names", theNames.indexOf (theName.toLowerCase ()) !== -1);
			postJson ("/tableedit", {action: "rename", address: theName, newname: "ccGuestItem", database: "nodeEditor.root"}, function (theAnswer) {
				checkThat ("renamed at the top of the guest's window", theAnswer.flRenamed === true);
				namesOfNodeEditor (function (theNames) {
					checkThat ("the list carries the new name and not the old", (theNames.indexOf ("ccguestitem") !== -1) && (theNames.indexOf (theName.toLowerCase ()) === -1));
					postJson ("/tableedit", {action: "delete", address: "ccGuestItem", database: "nodeEditor.root"}, function (theAnswer) {
						checkThat ("deleted from the guest's window", theAnswer.flDeleted === true);
						namesOfNodeEditor (function (theNames) {
							checkThat ("and off the list", theNames.indexOf ("ccguestitem") === -1);
							callback ();
							});
						});
					});
				});
			});
		});
	}

function checkTheExactPathRule (callback) {

	/*  9/10/26 by CC -- THE EXACT PATH WINS OVER THE FILE NAME. A database
		opened from his own config.root is a top-level table named by that
		path; the shipped config.root is mounted at root.config under the
		same file name. The server's parser took the by-name rule first and
		rewrote ["...:apps:config.root"].config.nodeEditor... to the mount,
		where there is no nodeEditor -- DW's 9/10 report, "Can't edit
		config.nodeEditor.projects.rssChat.scripts because there's no object
		at that address" from the window on his file. The kernel keys open
		files by path (filewindowtable).  */

	const theAddress = "[\"" + pathHisConfigRoot + "\"].config.nodeEditor.projects.rssChat.scripts";
	getJson ("/downloadobject?address=" + encodeURIComponent (theAddress), function (theAnswer) {
		checkThat ("a window on a database opened from his own config.root reaches its scripts object by the file's exact path", theAnswer.ctLines === 1);
		getJson ("/listtable?address=" + encodeURIComponent ("[\"" + pathHisConfigRoot + "\"].config.nodeEditor.projects.rssChat"), function (theAnswer) {
			checkThat ("and the table window lists the project's three items there", Array.isArray (theAnswer.entries) && (theAnswer.entries.length === 3));
			runScript ("defined (config.nodeEditor)", function (theValue) {
				checkThat ("the shipped config.root, mounted at root.config, is untouched (no nodeEditor there)", theValue === false);
				//9/10/26 by CC -- the mounted guest by its own file name: ["...:config.root"].config is root.config (the guest's root has that one entry), so a part addressed the Berkeley way lands in the shipped config.root
				runScript ("new (tabletype, @[\"Macintosh HD:Users:davewiner:Documents:OPML:Guest Databases:apps:config.root\"].config.ccMounted); config.ccMounted.hello = \"world\"; defined (config.ccMounted.hello)", function (theValue) {
					checkThat ("a script writing under the bracketed path to config.root writes into the shipped config (config.ccMounted)", theValue === true);
					runScript ("table.surePath (\"[\\\"Macintosh HD:Users:davewiner:Documents:OPML:Guest Databases:apps:config.root\\\"].config.ccByText.deeper\"); defined (config.ccByText)", function (theValue) {
						checkThat ("and table.surePath of the same address as TEXT (the import's way) makes the parent tables there too", theValue === true);
						getJson ("/listtable?address=" + encodeURIComponent ("[\"Macintosh HD:Users:davewiner:Documents:OPML:Guest Databases:apps:config.root\"].config"), function (theAnswer) {
							var flHasLog = false;
							if (Array.isArray (theAnswer.entries)) {
								theAnswer.entries.forEach (function (theEntry) {
									if (theEntry.name === "log") {
										flHasLog = true;
										}
									});
								}
							checkThat ("the server lists the shipped config under the bracketed path to config.root", flHasLog);
							getJson ("/getdatabases", function (theAnswer) {
								var ct = 0;
								(theAnswer.databases || []).forEach (function (theDatabase) {
									if (theDatabase.name === "config.root") {
										ct++;
										}
									});
								checkThat ("and there is still one config.root in the databases list besides the opened file: two entries", ct === 2);
				runScript ("typeOf ([\"" + pathHisConfigRoot + "\"].config.nodeEditor.projects.rssChat.scripts)", function (theValue) {
					checkThat ("a script reading the exact path gets the outline too", theValue === "optx");
					callback ();
					});
				}); }); }); });
				});
			});
		});
	}

main ();
