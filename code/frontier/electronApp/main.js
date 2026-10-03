const {app, BrowserWindow, Menu, shell, dialog, ipcMain, screen} = require ("electron"); //8/10/26 by CC -- shell opens a viewed page in the real browser
const http = require ("http");
const https = require ("https");
const childProcess = require ("child_process");
const fs = require ("fs");
const pathTool = require ("path");

/*  Which server -- 8/9/26 by CC. A packaged copy of the app is a window
	onto the sandbox on marin: nothing to install beside it, it just
	connects. Running from the repo (npm start) keeps the developer loop --
	find or spawn the local server. A serverUrl in appConfig.json in the
	app's data folder overrides either, so any copy can be pointed
	anywhere.  */

const urlSandbox = "https://sandbox0.usertalk.org";
var urlServer = "http://localhost:5339"; //assigned for real at ready
var urlBrowsePage; //assigned at ready, from urlServer
const folderTrigger = pathTool.resolve (__dirname, "..");

/*  The desktop Frontier -- 8/15/26 by CC. DW's architecture: two full
	Frontiers. This machine runs one -- server, interpreter, database, all
	here, on one CPU, which is the charm of Frontier -- and marin runs one,
	with webEdit moving objects between them.

	A build that carried a server/ folder (misc/buildDesktopApp.js) IS the
	desktop Frontier: the app launches that server with its own binary
	(ELECTRON_RUN_AS_NODE, no system node needed), the database and
	everything the server writes live in the app's data folder, and the
	config that ties them together is written there on first launch --
	seeded from server/seed.db when the build carried one.  */

const folderBundledServer = pathTool.join (__dirname, "server");
const flDesktopFrontier = fs.existsSync (pathTool.join (folderBundledServer, "trigger.js"));
var theDesktopPassword; //assigned by sureDesktopConfig, from the config it wrote or found
if ((process.env.ODB_TEST_PASSWORD !== undefined) && (process.env.ODB_TEST_PASSWORD.length > 0)) { //9/5/26 by CC -- for driving the app against a test server (with ODB_SERVER_URL): the pages get this password the way they get the desktop Frontier's, so nobody types anything
	theDesktopPassword = process.env.ODB_TEST_PASSWORD;
	}
var flFirstLaunch = false; //set by sureDesktopConfig when it seeds the database -- the launch that installs the Tools roots and runs the first startup
var theStatusWindow; //the first-launch status window, while the server sets up

/*  9/4/26 by CC -- THE FIRST-LAUNCH STATUS WINDOW. DW, after his fresh
	install: "it takes a very long time to launch the first time. we're going
	to need a status dialog saying 'Setting up the object database, this
	could take a minute or more.'" His words, on screen while the server
	installs the Tools roots and runs the first startup; gone when the
	server answers.  */

/*  9/5/26 by CC -- DW's asks after his fresh run of 0.4.52: "i'd like to
	have a rotating svg image here (prior art wordland) and leave the dialog
	up when it's done, but change the message to 'Initial setup completed,
	click OK to proceed.' and that would be followed by opening
	workspace.notepad." The spinner is wordland's spinningImage (misc.js,
	2/22/25 by DW): seven dots fading around a circle, turned a step every
	sixteenth of a second. When the server answers, the same window shows the
	completed message and an OK button; OK closes the window, and the app
	goes on to open its windows -- on a first launch, workspace.notepad.  */

const svgSpinner = "<svg fill=\"currentColor\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" style=\"width: 44px; height: 44px; color: #444; flex: none;\"><g><circle cx=\"12\" cy=\"2.5\" r=\"1.5\" opacity=\".14\"></circle><circle cx=\"16.75\" cy=\"3.77\" r=\"1.5\" opacity=\".29\"></circle><circle cx=\"20.23\" cy=\"7.25\" r=\"1.5\" opacity=\".43\"></circle><circle cx=\"21.50\" cy=\"12.00\" r=\"1.5\" opacity=\".57\"></circle><circle cx=\"20.23\" cy=\"16.75\" r=\"1.5\" opacity=\".71\"></circle><circle cx=\"16.75\" cy=\"20.23\" r=\"1.5\" opacity=\".86\"></circle><circle cx=\"12\" cy=\"21.5\" r=\"1.5\"></circle><animateTransform attributeName=\"transform\" type=\"rotate\" calcMode=\"discrete\" dur=\"0.75s\" values=\"0 12 12;30 12 12;60 12 12;90 12 12;120 12 12;150 12 12;180 12 12;210 12 12;240 12 12;270 12 12;300 12 12;330 12 12;360 12 12\" repeatCount=\"indefinite\"></animateTransform></g></svg>";

function statusWindowHtml (theText, flDone) {
	const theStyle = "font-family: -apple-system, Helvetica, sans-serif; font-size: 15px; color: #222; background: #f4f4f4; margin: 0; padding: 34px 30px; display: flex; align-items: center; gap: 22px;";
	var theBody = "<div style=\"" + theStyle + "\">";
	if (flDone) {
		theBody += "<div style=\"flex: 1;\">" + theText + "</div><button onclick=\"window.close ()\" style=\"font-size: 14px; padding: 5px 22px;\" autofocus>OK</button>";
		}
	else {
		theBody += svgSpinner + "<div style=\"flex: 1;\">" + theText + "</div>";
		}
	theBody += "</div>";
	return ("<html><body style=\"margin: 0; background: #f4f4f4;\">" + theBody + "</body></html>");
	}

function showStatusWindow (theText) {
	if (process.env.ODB_MENU_TRACE !== undefined) { //9/10/26 by CC -- for driving
		console.log ("statuswindow: " + theText);
		}
	try {
		theStatusWindow = new BrowserWindow ({width: 480, height: 140, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title: "Electric Frontier", show: true});
		theStatusWindow.setMenuBarVisibility (false);
		theStatusWindow.loadURL ("data:text/html;charset=utf-8," + encodeURIComponent (statusWindowHtml (theText, false)));
		theStatusWindow.on ("closed", function () {
			theStatusWindow = undefined;
			});
		}
	catch (err) {
		console.log ("Can't show the status window because " + err.message);
		}
	}

function finishStatusWindow (theText, callback) { //9/5/26 by CC -- the window stays up with the completed message and an OK button; OK (or closing it) calls back
	if ((theStatusWindow === undefined) || theStatusWindow.isDestroyed ()) {
		callback ();
		return;
		}
	var flCalledBack = false;
	function done () {
		if (!flCalledBack) {
			flCalledBack = true;
			callback ();
			}
		}
	theStatusWindow.on ("closed", done);
	theStatusWindow.loadURL ("data:text/html;charset=utf-8," + encodeURIComponent (statusWindowHtml (theText, true)));
	}

function closeStatusWindow () {
	if ((theStatusWindow !== undefined) && !theStatusWindow.isDestroyed ()) {
		theStatusWindow.close ();
		}
	theStatusWindow = undefined;
	}

function sureDesktopConfig () { //the config, data folder and database the local Frontier runs on; answers the config path

	const folderFrontier = pathTool.join (app.getPath ("userData"), "frontier");
	const pathConfig = pathTool.join (folderFrontier, "config.json");
	const pathDatabase = pathTool.join (folderFrontier, "data", "frontier.db");
	fs.mkdirSync (pathTool.join (folderFrontier, "data"), {recursive: true});

	if (fs.existsSync (pathConfig)) {
		const theConfig = JSON.parse (fs.readFileSync (pathConfig, "utf8"));
		theDesktopPassword = theConfig.webeditPassword; //the run-capable password -- menu commands run scripts

		/*  8/15/26 by CC -- a config written by an earlier version doesn't
			know about settings this one needs, and it is never overwritten,
			so the missing ones are filled in here. Anything already in the
			file is left exactly as it is -- it's the person's file.  */

		if ((theConfig.pathMap !== undefined) && (theConfig.pathMap.flCorralPaths === undefined)) {
			theConfig.pathMap.flCorralPaths = false;
			fs.writeFileSync (pathConfig, JSON.stringify (theConfig, undefined, "\t"));
			}

		/*  8/16/26 by CC -- the port is 5339 now, DW's ruling; 1680 was a
			number with no history behind it, made up here. Exactly 1680 is
			migrated -- it was never the person's choice, it was the app's --
			and any other value in the file is theirs and stays.  */

		if (theConfig.port === 1680) {
			theConfig.port = 5339;
			fs.writeFileSync (pathConfig, JSON.stringify (theConfig, undefined, "\t"));
			}

		/*  8/18/26 by CC -- the write gate (verbs.js) is closed unless a
			config opens it, so a config written before it existed is filled
			in the same way. A Frontier on the person's own machine, running
			the person's own scripts, gets what it has always had: it writes
			files and it reaches the network. What the gate stops is anything
			running WITHOUT a config that says so -- a test harness, a scratch
			script -- which is where the 8/17 damage came from.  */

		if ((theConfig.pathMap !== undefined) && (theConfig.pathMap.flAllowDiskWrites === undefined)) {
			theConfig.pathMap.flAllowDiskWrites = true;
			theConfig.pathMap.flAllowNetwork = true;
			fs.writeFileSync (pathConfig, JSON.stringify (theConfig, undefined, "\t"));
			}
		}
	else {
		theDesktopPassword = require ("crypto").randomBytes (12).toString ("hex"); //the run-capable password; the pages get this one
		const theConfig = {
			port: 5339,
			password: require ("crypto").randomBytes (12).toString ("hex"),
			webeditPassword: theDesktopPassword,
			pathUsertalk: pathTool.join (folderBundledServer, "usertalk"),
			pathConcord: pathTool.join (folderBundledServer, "concord"),
			pathDatabase: pathDatabase,
			folderRenders: pathTool.join (folderFrontier, "files", "renders"),
			folderScriptTemp: pathTool.join (folderFrontier, "files", "scriptTemp"),
			folderWebeditReceived: pathTool.join (folderFrontier, "webeditReceived"),
			maxVerbCalls: 1000000,
			flLogRequests: false,
			pathMap: {helpers: {}, prefs: {}, flCorralPaths: false, flAllowDiskWrites: true, flAllowNetwork: true, prefixes: {"": pathTool.join (folderFrontier, "files", "renders")}} //8/15/26 by CC -- this Frontier is on the person's own machine, so a file path means what it says; the server's config keeps the corral. 8/18/26 -- and the write gate is open here, because this one IS the person (see sureDesktopConfig's note above)
			};
		fs.writeFileSync (pathConfig, JSON.stringify (theConfig, undefined, "\t"));
		}

	if (!fs.existsSync (pathDatabase)) {
		flFirstLaunch = true; //9/4/26 by CC -- the status window below knows
		const pathSeed = pathTool.join (folderBundledServer, "seed.db");
		if (fs.existsSync (pathSeed)) {
			fs.copyFileSync (pathSeed, pathDatabase);
			console.log ("database seeded from the build, " + fs.statSync (pathDatabase).size + " bytes");
			}

		/*  9/3/26 by CC -- THE TOOLS COME WITH THE FRESH INSTALL, as files in
			Guest Databases/apps/Tools beside the database (Frontier's folder, 9/15/26), the way the 2011
			distribution shipped nodeEditor.root in its Tools folder. DW's
			ruling 9/3: nodeEditorSuite "must not be in the fresh root" -- it
			arrives through Tools, and the server installs what it finds
			there at every launch. Only a first launch does this, the same
			moment the database is seeded; a person's own Tools folder is
			never touched.  */

		const folderBundledOps = pathTool.join (folderBundledServer, "GuestOps"); //9/4/26 by CC -- the 2012 distribution's discuss.root and members.root, opened by mainResponder.startup at boot
		if (fs.existsSync (folderBundledOps)) {
			const folderOps = pathTool.join (folderFrontier, "data", "Guest Databases", "ops");
			fs.mkdirSync (folderOps, {recursive: true});
			fs.readdirSync (folderBundledOps).forEach (function (theName) {
				if (theName.toLowerCase ().endsWith (".root")) {
					fs.copyFileSync (pathTool.join (folderBundledOps, theName), pathTool.join (folderOps, theName));
					console.log ("Guest Databases/ops seeded with " + theName);
					}
				});
			}
		const folderBundledTools = pathTool.join (folderBundledServer, "Tools");
		if (fs.existsSync (folderBundledTools)) {
			const folderTools = pathTool.join (folderFrontier, "data", "Guest Databases", "apps", "Tools"); //9/15/26 by CC -- Frontier's folder, Guest Databases/apps/Tools; see trigger.js scanTheToolsFolder
			fs.mkdirSync (folderTools, {recursive: true});
			fs.readdirSync (folderBundledTools).forEach (function (theName) {
				if (theName.toLowerCase ().endsWith (".root")) {
					fs.copyFileSync (pathTool.join (folderBundledTools, theName), pathTool.join (folderTools, theName));
					console.log ("Tools folder seeded with " + theName);
					}
				});
			}
		}
	return (pathConfig);
	}

function chooseServer () {
	if ((process.env.ODB_SERVER_URL !== undefined) && (process.env.ODB_SERVER_URL.length > 0)) { //for testing a copy against any server
		return (process.env.ODB_SERVER_URL);
		}
	try {
		const theConfig = JSON.parse (fs.readFileSync (pathTool.join (app.getPath ("userData"), "appConfig.json"), "utf8"));
		if ((typeof theConfig.serverUrl === "string") && (theConfig.serverUrl.length > 0)) {
			return (theConfig.serverUrl);
			}
		}
	catch (err) {
		}
	if (flDesktopFrontier) { //a build carrying a whole Frontier runs it here, on this machine
		return ("http://localhost:5339");
		}
	if (app.isPackaged) {
		return (urlSandbox);
		}
	return ("http://localhost:5339");
	}

function flLocalServer () {
	return (urlServer.indexOf ("http://localhost") === 0);
	}

function webRequest (theUrl, theOptions, callback) { //http or https, whichever the url says
	const theModule = (theUrl.indexOf ("https:") === 0) ? https : http;
	return (theModule.request (theUrl, theOptions, callback));
	}

var theServerProcess; //assigned by startServer, only if no server was already answering
var pathWindowState; //assigned at ready -- userData isn't known before then
const openWindows = []; //every live window, so state can be saved as they move and close
const theFocusOrder = []; //9/8/26 by CC -- the windows most recently in front first, the app's copy of the kernel's window layer; see noteWindowInFront and desktop.windowBehind

function noteWindowInFront (theWindow) { //9/8/26 by CC -- a window opening, focused, or brought forward by the app goes to the head of the order
	const ix = theFocusOrder.indexOf (theWindow);
	if (ix !== -1) {
		theFocusOrder.splice (ix, 1);
		}
	theFocusOrder.unshift (theWindow);
	}
var flQuitting = false; //8/18/26 by CC -- once the quit snapshot is written, later closes must not shrink it
var theCustomMenus, theDatabaseList, theRebuildTimer; //8/12/26 by CC -- assigned as the menubar goes up; the Window menu is rebuilt from them
var thePathsPrefixes = []; //9/10/26 by CC -- system.paths, longest first; the Window menu strips them off a window's name

function stripPathsPrefix (theTitle) {

	/*  9/10/26 by CC -- DW, 9/10: "when building the windows menu, before
		displaying the items, if it begins with one of the items in the paths
		table, remove the path. i don't refer to op.console as
		system.verbs.op.console. the names require too much parsing and it
		groups them in non intuitive order." So system.verbs.builtins.op.console
		is op.console in the menu, the way he says it; the window's own title
		keeps the whole address.  */

	const theText = String (theTitle);
	const lower = theText.toLowerCase ();
	var theAnswer = theText;
	thePathsPrefixes.forEach (function (thePrefix) {
		if ((theAnswer === theText) && lower.startsWith (thePrefix.toLowerCase () + ".")) {
			theAnswer = theText.slice (thePrefix.length + 1);
			}
		});
	return (theAnswer);
	}

function fetchPathsPrefixes (callback) { //system.paths as the server lists it; an address entry's value is its path text
	serverJson ("/listtable?address=system.paths", undefined, function (err, data) {
		if ((err === undefined) && (data !== undefined) && Array.isArray (data.entries)) {
			const thePrefixes = [];
			data.entries.forEach (function (theEntry) {
				if ((theEntry.kind === "address") && (typeof theEntry.value === "string") && (theEntry.value.length > 0)) {
					thePrefixes.push (theEntry.value);
					}
				});
			thePrefixes.sort (function (a, b) {
				return (b.length - a.length);
				});
			thePathsPrefixes = thePrefixes;
			}
		callback ();
		});
	}
var theSaveTimer;
var thePassword; //assigned by borrowPassword -- the same saved value the browse page asked for

function checkServer (callback) { //flUp, theStatus -- 9/10/26 by CC: /version says what the server is still doing before it is ready (installing a Tool, running the startup script); empty when it is ready
	const theRequest = webRequest (urlServer + "/version", {method: "GET"}, function (theResponse) {
		var theBody = "";
		theResponse.on ("data", function (chunk) {
			theBody += chunk;
			});
		theResponse.on ("end", function () {
			var theStatus = "";
			try {
				const theAnswer = JSON.parse (theBody);
				if (typeof theAnswer.status === "string") {
					theStatus = theAnswer.status;
					}
				}
			catch (err) {
				}
			callback (theResponse.statusCode === 200, theStatus);
			});
		});
	theRequest.on ("error", function () {
		callback (false);
		});
	theRequest.setTimeout (2500, function () {
		theRequest.destroy ();
		callback (false);
		});
	theRequest.end ();
	}

function startServer (callback) { //a remote server just has to answer; a local one we find running or launch ourselves
	if (flDesktopFrontier) {
		sureDesktopConfig (); //9/4/26 by CC -- the app's own password comes from its config, whether or not a server is already up: DW's fresh install found a leftover server on the port, skipped this, and every window asked him for a password nobody has
		}

	function waitUntilReady () { //9/10/26 by CC -- polls until the server answers with nothing left to do; the status window shows what it is doing meanwhile
		var ctPolls = 0;
		var theStatusShown = "";
		function poll () {
			checkServer (function (flUpNow, theStatus) {
				if (flUpNow && (theStatus !== undefined) && (theStatus.length > 0)) {

					/*  9/10/26 by CC -- THE SERVER ANSWERS BUT ISN'T READY: it is
						installing a Tool from Guest Databases/Tools, or running the
						startup script. DW's 9/10 report: nodeEditor.root took a
						long time to come in "but there was no dialog with a spinner
						telling me what was happening." The status window says what
						the server says, until it says nothing.  */

					/*  10/1/26 by CC -- ONLY A TOOL INSTALLING GETS THE WINDOW. His
						9/10 ask was the spinner while a big root comes in through
						Tools; CC put the same window up for the startup scripts
						and the agents, which take no time, so every launch flashed
						a dialog and then waited for OK. DW, 10/1: "at startup, the
						dialog only comes up for starting the agents, and that is
						done very quickly, so as-is it's not helpful ... you should
						just take the dialog out for now." The app still waits for
						the server to say it is ready; it just says nothing while
						it does. A first launch's window, already up, keeps
						following the server the way it did.  */

					const flWindowUp = (theStatusWindow !== undefined) && !theStatusWindow.isDestroyed ();
					const flToolInstalling = /^(Installing|Reinstalling) /.test (theStatus);
					if ((theStatus !== theStatusShown) && (flToolInstalling || flWindowUp)) {
						theStatusShown = theStatus;
						if (flWindowUp) {
							theStatusWindow.loadURL ("data:text/html;charset=utf-8," + encodeURIComponent (statusWindowHtml (theStatus, false)));
							}
						else {
							showStatusWindow (theStatus);
							}
						}
					ctPolls++;
					if (ctPolls < 1200) { //ten minutes of a status, then on with it -- a server that never says it is ready must not hold the app forever
						setTimeout (poll, 500);
						return;
						}
					}
				if (flUpNow) {
					if (flFirstLaunch) { //9/5/26 by CC -- DW's ask: the dialog stays up when it's done, and OK is what opens workspace.notepad
						finishStatusWindow ("Initial setup completed, click OK to proceed.", callback);
						}
					else if (theStatusShown.length > 0) { //9/10/26 by CC -- a Tool came in: the window stays up and OK is what goes on -- DW's 9/10 report, "it didn't wait for me to click a button. bug"
						const theMatch = theStatusShown.match (/^Installing (.+?),/);
						finishStatusWindow (((theMatch === null) ? "Finished" : theMatch [1] + " is installed") + ", click OK to proceed.", callback);
						}
					else {
						closeStatusWindow ();
						callback ();
						}
					}
				else {
					ctPolls++;
					if (ctPolls < 480) { //9/4/26 by CC -- two minutes, not ten seconds: a first launch installs nodeEditor.root before the server answers (DW's 9/4 report: first launch, no windows, menubar unchanged)
						if ((ctPolls % 40) === 0) {
							console.log ("Still waiting for the odb server, " + (ctPolls / 4) + " seconds...");
							}
						setTimeout (poll, 250);
						}
					else {
						console.log ("Can't start because the odb server didn't come up.");
						app.quit ();
						}
					}
				});
			}
		poll ();
		}

	checkServer (function (flUp, theStatus) {
		if (flUp) {
			if ((theStatus !== undefined) && (theStatus.length > 0)) { //9/10/26 by CC -- up, but still installing a Tool or running the startup script: wait, and say so
				waitUntilReady ();
				}
			else {
				callback ();
				}
			}
		else {
			if (!flLocalServer ()) { //nothing to launch -- open the window anyway, the page says what's wrong
				callback ();
				return;
				}
			if (flDesktopFrontier) { //the bundled Frontier, run with the app's own engine -- no system node needed
				const pathConfig = sureDesktopConfig ();
				/*  8/15/26 by CC -- stdio inherit, so the Frontier's own output
					lands in the app's console where it can be read. The
					default is a pipe nobody reads, and a pipe nobody reads
					fills up and stops the writer -- with request logging on,
					the server would hang.  */

				theServerProcess = childProcess.spawn (process.execPath, [pathTool.join (folderBundledServer, "trigger.js")], {
					cwd: folderBundledServer,
					stdio: "inherit",
					env: Object.assign ({}, process.env, {ELECTRON_RUN_AS_NODE: "1", ODB_CONFIG: pathConfig})
					});
				}
			else {
				theServerProcess = childProcess.spawn ("node", ["trigger.js"], {
					cwd: folderTrigger,
					env: Object.assign ({}, process.env, {NODE_PATH: pathTool.join (folderTrigger, "node_modules")})
					});
				}
			if (flFirstLaunch) {
				showStatusWindow ("Setting up the object database, this could take a minute or more.");
				}
			waitUntilReady ();
			}
		});
	}

/*  The menubar -- 8/8/26 by CC. The app's menus come from the database:
	user.menus.customMenu, served by /getmenubar with each command's script
	riding along as OPML. A menu named "=expression" gets the expression's
	value as its name, evaluated on the server. Choosing a command sends its
	script to the frontmost window's page, which runs it with the same
	machinery as the Run button -- so dialogs appear over what the person is
	looking at.  */

function serverJson (thePath, theBody, callback) { //one transport primitive for the app's own calls
	const theOptions = {
		method: (theBody === undefined) ? "GET" : "POST",
		headers: {"x-trigger-password": thePassword}
		};
	const theRequest = webRequest (urlServer + thePath, theOptions, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			var jstruct;
			try {
				jstruct = JSON.parse (theText);
				}
			catch (err) {
				callback ({message: "Can't understand the server's answer to " + thePath + "."});
				return;
				}
			if (theResponse.statusCode !== 200) {
				callback (jstruct);
				return;
				}
			callback (undefined, jstruct);
			});
		});
	theRequest.on ("error", function (err) {
		callback (err);
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function borrowPassword (callback) { //the page asks the person once and saves it; the app reads the same saved value

	if (theDesktopPassword !== undefined) { //the desktop Frontier made its own password (or ODB_TEST_PASSWORD supplied one); nobody types anything
		callback (theDesktopPassword);
		return;
		}

	/*  8/9/26 by CC -- any live window will do, and the poll never gives
		up while the app runs: the first version watched only the first
		window, and if that one was closed before the person connected, the
		menubar silently never arrived.  */

	function poll () {
		var theWindow;
		openWindows.forEach (function (openWindow) {
			if ((theWindow === undefined) && !openWindow.isDestroyed ()) {
				theWindow = openWindow;
				}
			});
		if (theWindow === undefined) {
			setTimeout (poll, 1000);
			return;
			}
		theWindow.webContents.executeJavaScript ("localStorage.getItem (\"odbBrowserPassword\")").then (function (theValue) {
			if ((theValue !== null) && (theValue !== undefined) && (theValue.length > 0)) {
				callback (theValue);
				}
			else {
				setTimeout (poll, 1000);
				}
			}).catch (function () {
				setTimeout (poll, 1000);
				});
		}
	poll ();
	}

function bringWindowForward (theWindow) { //8/16/26 by CC -- focus () alone doesn't front a background window on the Mac; DW: re-creating an open project left its window where it was. Same treatment as choosing it in the Window menu.
	noteWindowInFront (theWindow); //9/8/26 by CC
	if (theWindow.isMinimized ()) {
		theWindow.restore ();
		}
	theWindow.show ();
	theWindow.focus ();
	}

function frontWindow () { //the focused window, or any live one
	var theWindow = BrowserWindow.getFocusedWindow ();
	if (theWindow === null) {
		theWindow = undefined;
		}
	if (theWindow === undefined) {
		openWindows.forEach (function (openWindow) {
			if ((theWindow === undefined) && !openWindow.isDestroyed ()) {
				theWindow = openWindow;
				}
			});
		}
	return (theWindow);
	}

function runMenuCommand (theLine) { //the command's script runs in the frontmost window, dialogs and all
	const theWindow = frontWindow ();
	if (theWindow === undefined) {

		/*  9/4/26 by CC -- NO WINDOW OPEN: the command used to do nothing,
			silently. DW, 9/4, with his only window closed: "it doesn't make
			any sense to me that jump doesn't work because there's no window
			open." A command needs a page to run in and to show its dialogs
			over; with none open, workspace.notepad opens -- the window a
			fresh start opens, his 9/4 direction for where a person begins --
			and the command runs there once the page is ready.  */

		const theNewWindow = createWindow (urlBrowsePage + "script.html?address=workspace.notepad");
		theNewWindow.webContents.once ("did-finish-load", function () {
			setTimeout (function () {
				runMenuCommand (theLine);
				}, 750); //the page connects and loads its outline first
			});
		return;
		}
	theWindow.webContents.executeJavaScript ("runMenuScript (" + JSON.stringify (theLine.scriptOpml) + ")").catch (function (err) {
		console.log ("Can't run the menu command " + theLine.text + " because " + err.message);
		});
	}

/*  One window per object -- 8/9/26 by CC. A window is keyed by what it
	shows (the address or database in its url, titles aside), so opening
	something already open brings its window to front instead of making a
	second one. That's Jump's contract, and double-clicked scripts get the
	same manners.  */

function windowKeyForUrl (theUrl) {

	/*  9/8/26 by CC -- NAMES ARE UNICASE. DW's Window menu showed
		workspace.importExport and workspace.importexport as two windows, and
		the same for two of their scripts: the key kept the address's case,
		so a window opened on the lowercase spelling was a second window on
		the same object. The database doesn't distinguish them, and neither
		does this now; the title still reads as the database spells it.  */

	try {
		const parsed = new URL (theUrl);
		const theAddress = parsed.searchParams.get ("address");
		if (theAddress !== null) {
			return (parsed.pathname + "?address=" + theAddress.toLowerCase ());
			}
		const theDatabase = parsed.searchParams.get ("database");
		if (theDatabase !== null) {
			return (parsed.pathname + "?database=" + theDatabase.toLowerCase ());
			}
		return (parsed.pathname + parsed.search);
		}
	catch (err) {
		return (theUrl);
		}
	}

/*  9/12/26 by CC -- RECENT PLACES. DW's 9/12 ask: "start keeping a list of
	recent places i've jumped to or cmd-clicked to. we'll have a ui for this
	next." Every window a page opens comes through setWindowOpenHandler --
	Jump (edit from the worker), a cmd-click on an address, a double-click on
	a row, a Find hit -- and each one is noted here: the address, newest
	first, one entry per address, the last hundred. It lives in
	recentPlaces.json in the app's data folder, beside windowState.json, so
	his database is untouched; where it should really live is his call.  */

var theRecentPlaces; //loaded on first use, assigned by loadRecentPlaces
const maxRecentPlaces = 100;

function pathRecentPlaces () {
	return (pathTool.join (app.getPath ("userData"), "recentPlaces.json"));
	}

function loadRecentPlaces () {
	if (theRecentPlaces !== undefined) {
		return;
		}
	theRecentPlaces = [];
	try {
		const theParsed = JSON.parse (fs.readFileSync (pathRecentPlaces (), "utf8"));
		if (Array.isArray (theParsed.places)) {
			theRecentPlaces = theParsed.places;
			}
		}
	catch (err) {
		}
	}

function noteRecentPlace (theUrl) {
	var theAddress;
	try {
		const parsed = new URL (theUrl);
		if (parsed.pathname.indexOf ("/odbbrowser") !== 0) {
			return;
			}
		theAddress = parsed.searchParams.get ("address");
		const theCursor = parsed.searchParams.get ("cursor");
		if ((theAddress !== null) && (theCursor !== null) && (theCursor.length > 0)) { //a scalar opens its table with the cursor on it -- the place is the scalar
			theAddress += "." + theCursor;
			}
		if ((theAddress === null) || (theAddress.length === 0)) {
			const theDatabase = parsed.searchParams.get ("database");
			if ((theDatabase === null) || (theDatabase.length === 0)) {
				return;
				}
			theAddress = theDatabase;
			}
		}
	catch (err) {
		return;
		}
	loadRecentPlaces ();
	const theKey = theAddress.toLowerCase ();
	const theKept = [];
	theRecentPlaces.forEach (function (thePlace) {
		if (String (thePlace.address).toLowerCase () !== theKey) {
			theKept.push (thePlace);
			}
		});
	theKept.unshift ({address: theAddress, when: new Date ().toISOString ()});
	theRecentPlaces = theKept.slice (0, maxRecentPlaces);
	try {
		fs.writeFileSync (pathRecentPlaces (), JSON.stringify ({places: theRecentPlaces}, undefined, "\t"));
		}
	catch (err) {
		console.log ("Can't save the recent places because " + err.message);
		}
	}

function findWindowShowing (theUrl) {
	const theKey = windowKeyForUrl (theUrl);
	var found;
	openWindows.forEach (function (openWindow) {
		if ((found === undefined) && !openWindow.isDestroyed ()) {

			/*  8/12/26 by CC -- the url it was asked to show counts as well as
				the one it has arrived at; a window restored a moment ago hasn't
				loaded yet and would otherwise look like nothing at all.  */

			const theLoaded = windowKeyForUrl (openWindow.webContents.getURL ());
			const theAsked = (openWindow.odbRequestedUrl === undefined) ? undefined : windowKeyForUrl (openWindow.odbRequestedUrl);
			if ((theLoaded === theKey) || (theAsked === theKey)) {
				found = openWindow;
				}
			}
		});
	return (found);
	}

function menuTemplateFromLines (theLines, theMenubarAddress) { //the flat lines with levels become nested menus; the address is where the lines came from, for the option-key open

	const summits = [];
	const stack = [];
	theLines.forEach (function (theLine, ixLine) {
		const theNode = {line: theLine, subs: [], ixLine};
		while ((stack.length > 0) && (stack [stack.length - 1].line.level >= theLine.level)) {
			stack.pop ();
			}
		if (stack.length === 0) {
			summits.push (theNode);
			}
		else {
			stack [stack.length - 1].subs.push (theNode);
			}
		stack.push (theNode);
		});

	function itemFromNode (theNode) {
		const theLine = theNode.line;
		if (theLine.flComment === true) { //a commented line is turned off, its whole branch with it
			return (undefined);
			}
		if (theLine.text === "-") {
			return ({type: "separator"});
			}
		const theItem = {label: theLine.text};
		if (theNode.subs.length > 0) {
			const submenu = [];
			theNode.subs.forEach (function (subNode) {
				const subItem = itemFromNode (subNode);
				if (subItem !== undefined) {
					submenu.push (subItem);
					}
				});
			theItem.submenu = submenu;
			}
		else {
			if (theLine.scriptOpml !== undefined) {
				if (theLine.cmdkey !== undefined) {
					theItem.accelerator = "CommandOrControl+" + theLine.cmdkey;
					}
				theItem.click = function (menuItem, browserWindow, theEvent) {

					/*  9/3/26 by CC -- the kernel's option-key: choosing a menu
						item with the Option key down opens the menubar in its
						editor with the cursor on that item, instead of running
						it (DW's 9/3 ask, "new behavior, from C kernel").  */

					if ((theEvent !== undefined) && (theEvent !== null) && (theEvent.altKey === true) && (theMenubarAddress !== undefined)) {
						createWindow (urlBrowsePage + "menubar.html?address=" + encodeURIComponent (theMenubarAddress) + "&line=" + theNode.ixLine);
						return;
						}
					runMenuCommand (theLine);
					};
				}
			}
		return (theItem);
		}

	const menus = [];
	summits.forEach (function (theNode) {
		const theItem = itemFromNode (theNode);
		if ((theItem !== undefined) && (theItem.submenu !== undefined)) { //a summit with no items isn't a menu
			menus.push (theItem);
			}
		});
	return (menus);
	}

function evaluateMenuTitles (customMenus, callback) { //a menu named "=expression" gets the expression's value as its name
	const pending = [];

	/*  8/12/26 by CC -- all the way down, not just the top level. Common
		Styles is a submenu whose four items are all named by expressions,
		and DW saw the script text sitting where the style names belong.  */

	function collect (theItems) {
		theItems.forEach (function (theItem) {
			if ((theItem.label !== undefined) && theItem.label.startsWith ("=")) {
				pending.push (theItem);
				}
			if (theItem.submenu !== undefined) {
				collect (theItem.submenu);
				}
			});
		}
	collect (customMenus);
	function doNext () {
		if (pending.length === 0) {
			callback ();
			return;
			}
		const theMenu = pending.shift ();
		serverJson ("/run", theMenu.label.slice (1), function (err, data) {
			if ((err === undefined) && (data.value !== undefined)) {
				theMenu.label = String (data.value);
				doNext ();
				return;
				}

			/*  8/13/26 by CC -- his menu expressions say "menus.scripts.x",
				the way they resolve inside his Frontier; here that table
				lives at system.menus.scripts. One retry with the system
				prefix, presentation only -- the language is not consulted
				about what "menus" means. Common Styles' four items were
				showing their expressions instead of their names.  */

			serverJson ("/run", "system." + theMenu.label.slice (1), function (retryErr, retryData) {
				if ((retryErr === undefined) && (retryData.value !== undefined)) {
					theMenu.label = String (retryData.value);
					}
				doNext (); //still failing leaves the "=expression" name showing, which at least says what it is
				});
			});
		}
	doNext ();
	}

function openOrFrontWindow (theUrl) { //the one-window-per-object contract, for windows the app opens itself
	const theExisting = findWindowShowing (theUrl);
	if (theExisting !== undefined) {
		bringWindowForward (theExisting);
		return;
		}
	createWindow (theUrl);
	}

function fileAndWindowMenuTemplates (callback) {

	/*  8/10/26 by CC -- DW sent his OPML Editor's two menus and said the open
		databases belong in Window, not File: his Window menu ends with the
		guest databases in italics under the open windows, and File is New /
		Open / Close / Save / Save As / Revert / View in Browser. So the
		databases move. File keeps Close, which is the one command on his
		File menu this app can really do today; the rest wait until they
		exist rather than sitting there dead.  */

	/*  8/12/26 by CC -- every open window is listed, above the databases,
		the way his OPML Editor's Window menu reads. DW: "i just lost one,
		and reached for it. must-have." The front one carries the check;
		choosing any of them brings it forward, unminimizing it first if it
		went down to the dock.

		The list of databases is asked for once and kept -- this menu is
		rebuilt every time a window opens, closes, is retitled or comes to
		the front, and none of that is a reason to ask the server again.  */

	function buildThem () {
		const windowItems = [
			{role: "minimize"},
			{role: "front"},
			{label: "Close All", click: function () { //9/12/26 by CC -- DW's 9/12 ask: "a command in the windows menu to close all open windows... when i come in in the morning i've usually left a lot of windows open." The name is CC's pick, his to change
				BrowserWindow.getAllWindows ().forEach (function (theWindow) {
					if (!theWindow.isDestroyed ()) {
						theWindow.close ();
						}
					});
				}}
			];
		const theFocused = BrowserWindow.getFocusedWindow ();
		const theLiveWindows = [];
		openWindows.forEach (function (theWindow) {
			if (!theWindow.isDestroyed ()) {
				theLiveWindows.push (theWindow);
				}
			});
		
		/*  8/21/26 by CC -- alphabetical, DW's ask: "i tend to have a lot of
			windows open, and this is the main way i find them." Both sections
			sort, the open windows and the databases under them.  */
		
		theLiveWindows.sort (function (a, b) {
			return (a.getTitle ().toLowerCase ().localeCompare (b.getTitle ().toLowerCase ()));
			});
		
		/*  8/22/26 by CC -- A DATABASE WINDOW BELONGS IN ONE PLACE. DW, 8/22:
			"frontier.root should only appear once, in the second list, and
			that's where the checkmark should be." It was in both, because the
			upper section lists every open window and the lower one lists the
			databases. Frontier pushes root windows as their own type, once.
			
			A window with no ?database= and no ?address= is the old merged-root
			view titled "the odb" -- the same thing frontier.root is now, so it
			is out of the menu too.  */
		
		function databaseNameForWindow (theWindow) { //the database a window shows, or undefined
			const theUrls = [theWindow.webContents.getURL (), theWindow.odbRequestedUrl];
			var theName;
			theUrls.forEach (function (theUrl) {
				if ((theName !== undefined) || (theUrl === undefined) || (theUrl === null) || (theUrl.length === 0)) {
					return;
					}
				try {
					const parsed = new URL (theUrl);
					if (parsed.pathname.indexOf ("/odbbrowser/") !== 0) {
						return;
						}
					const theDatabase = parsed.searchParams.get ("database");
					if (theDatabase !== null) {
						theName = theDatabase;
						return;
						}
					if (parsed.searchParams.get ("address") === null) {
						theName = "frontier.root"; //the paramless merged root IS frontier.root
						}
					}
				catch (err) {
					}
				});
			return (theName);
			}
		
		const theWindowsForDatabase = {}; //database name -> its window, for the checkmark and for choosing it
		const theOrdinaryWindows = [];
		theLiveWindows.forEach (function (theWindow) {
			const theName = databaseNameForWindow (theWindow);
			if (theName === undefined) {
				theOrdinaryWindows.push (theWindow);
				}
			else {
				if (theWindowsForDatabase [theName] === undefined) {
					theWindowsForDatabase [theName] = theWindow;
					}
				}
			});
		
		if (theOrdinaryWindows.length > 0) {
			windowItems.push ({type: "separator"});
			theOrdinaryWindows.forEach (function (theWindow) {
				windowItems.push ({
					label: stripPathsPrefix (theWindow.getTitle ()), //9/10/26 by CC -- op.console, not system.verbs.builtins.op.console
					type: "checkbox",
					checked: (theFocused !== null) && (theFocused.id === theWindow.id),
					click: function () {
						noteWindowInFront (theWindow); //9/8/26 by CC
						if (theWindow.isMinimized ()) {
							theWindow.restore ();
							}
						theWindow.show ();
						theWindow.focus ();
						}
					});
				});
			}
		if ((theDatabaseList !== undefined) && (theDatabaseList.length > 0)) {
			windowItems.push ({type: "separator"});
			const theSortedDatabases = [];
			theDatabaseList.forEach (function (theDatabase) {
				if (theDatabase.flLogFile !== true) { //10/1/26 by CC -- the log's daily files stay out of the menu, DW's 9/19, 9/30 and 10/1 word: "they aren't my windows"; the server marks them (trigger.js, handleGetDatabases)
					theSortedDatabases.push (theDatabase);
					}
				});
			theSortedDatabases.sort (function (a, b) {
				return (a.name.toLowerCase ().localeCompare (b.name.toLowerCase ()));
				});
			theSortedDatabases.forEach (function (theDatabase) {
				const theOpenWindow = theWindowsForDatabase [theDatabase.name];
				windowItems.push ({
					label: theDatabase.name,
					type: "checkbox",
					checked: (theOpenWindow !== undefined) && (theFocused !== null) && (theFocused.id === theOpenWindow.id),
					click: function () {
						if (theOpenWindow !== undefined) {
							bringWindowForward (theOpenWindow);
							return;
							}
						openOrFrontWindow (urlBrowsePage + "?database=" + encodeURIComponent (theDatabase.name));
						}
					});
				});
			}
		if (process.env.ODB_MENU_TRACE !== undefined) { //9/10/26 by CC -- the Window menu's labels, for driving
			console.log ("windowmenu: " + JSON.stringify (windowItems.filter (function (theItem) { return (theItem.label !== undefined); }).map (function (theItem) { return (theItem.label); })));
			}
		callback ({label: "File", submenu: [{role: "close"}]}, {label: "Window", submenu: windowItems});
		}

	if (theDatabaseList !== undefined) {
		buildThem ();
		return;
		}
	serverJson ("/getdatabases", undefined, function (err, data) {
		if ((err === undefined) && (data.databases !== undefined)) {
			theDatabaseList = data.databases;
			}
		fetchPathsPrefixes (buildThem); //9/10/26 by CC -- refreshed whenever the databases list is
		});
	}

var theLastMenuDataVersion; //what /dataversion said the last time the menubar poll looked
var theInstalledMenubarAddresses = {}; //9/8/26 by CC -- lowercased addresses of the menubars up in the menubar, assigned by installMenubar

function startMenubarFollowingTheDatabase () {

	/*  9/1/26 by CC -- THE MENUBAR FOLLOWS THE DATABASE. The menus were
		fetched once at launch and never again, so an edited menubar -- or a
		whole menubar imported from Berkeley -- changed nothing on screen
		until the app was relaunched. DW's 9/1 report: "i tried loading in
		the original menubar from berkeley, but nothing changed." Same
		machinery as the table window: poll the database's change counter,
		and when it moves, fetch the menus again. A poll where nothing
		changed touches nothing.  */

	setInterval (function () {
		serverJson ("/dataversion", undefined, function (err, data) {
			if (err !== undefined) {
				return; //a missed poll is nothing; the next one answers
				}
			if ((theLastMenuDataVersion !== undefined) && (data.version !== theLastMenuDataVersion)) {
				installMenubar ();
				}
			theLastMenuDataVersion = data.version;
			});
		}, 2000);
	}

function rebuildMenusSoon () { //8/12/26 by CC -- the windows changed, so the Window menu has to say so

	if (theCustomMenus === undefined) { //the menubar hasn't gone up for the first time yet
		return;
		}
	clearTimeout (theRebuildTimer);
	theRebuildTimer = setTimeout (function () {
		installTheMenus (theCustomMenus);
		}, 150);
	}

function installMenubar () {

	/*  8/9/26 by CC -- keeps trying until the menubar is really up: one
		failed fetch used to mean no menus for the whole session.  */

	/*  8/11/26 by CC -- two menubars, not one. system.menus.menubar is where
		DW's Outliner, HTML and Misc menus live; user.menus.customMenu is
		DW, Script and NodeEditor. They go up in that order, the way they sit
		in his Frontier. A database that has no system.menus.menubar just
		gets the custom menus, which is how it worked before.  */

	/*  9/4/26 by CC -- A VIRGIN ROOT HAS NO user.menus.customMenu (the 2012
		opml.root's user.menus holds tools alone; flCustomMenu is off on the
		OPML Editor), and the custom menu's absence used to be taken for the
		server not being up yet -- "trying again in 5 seconds", forever, no
		menubar at all. /version says whether the server is up; after that a
		missing custom menu is just a menubar with no custom menu in it.  */

	serverJson ("/version", undefined, function (versionErr) {
		if (versionErr !== undefined) {
			console.log ("Can't build the menubar yet (" + versionErr.message + ") -- trying again in 5 seconds.");
			setTimeout (installMenubar, 5000);
			return;
			}
	serverJson ("/getmenubar", undefined, function (customErr, data) {
		if (customErr !== undefined) {
			data = {lines: []}; //no custom menu in this database
			}
		serverJson ("/getmenubar?address=system.menus.menubar", undefined, function (systemErr, systemData) { //the address rides in the url -- serverJson's second parameter is a POST body
			var theMenus = new Array ();
			if (systemErr === undefined) {
				theMenus = menuTemplateFromLines (systemData.lines, "system.menus.menubar");
				}
			else {
				console.log ("No system menubar (" + systemErr.message + ") -- the custom menus go up alone.");
				}
			serverJson ("/getmenubar?address=user.bookmarksMenu.menu", undefined, function (bookmarksErr, bookmarksData) {

				/*  8/14/26 by CC -- the Bookmarks menu, a standard part of
					every release, DW: "i do include that in all my other
					software, feedland, wordland, drummer, etc. bookmarks
					make a big difference." Its address is the one Frontier's
					own bookmarksMenu.init uses. A database without one just
					doesn't get the menu.  */

				var theBookmarksMenus = new Array ();
				if (bookmarksErr === undefined) {
					theBookmarksMenus = menuTemplateFromLines (bookmarksData.lines, "user.bookmarksMenu.menu");
					}

				/*  9/2/26 by CC -- EVERY MENUBAR IN user.menus GOES UP, the way
					system.menus.buildMenuBar does it: the menubar, the
					bookmarks menu and customMenu first, then each remaining
					menubar in user.menus in the table's order (PBS 8/13/98:
					"add additional user menus"), skipping the three already
					installed. DW's 9/2 ask: he can't work on a menubar he
					can't see -- "i can't work with a menubar if i can't see
					the result of my editing" -- and user.menus only is fine
					by him. With the database poll above, a menubar he's
					editing there shows in the real menubar as he edits it.  */

				serverJson ("/listtable?address=user.menus", undefined, function (listErr, listData) {
					const theOtherAddresses = [];
					if ((listErr === undefined) && (listData !== undefined) && Array.isArray (listData.entries)) {
						listData.entries.forEach (function (theEntry) {
							const theName = String (theEntry.name).toLowerCase ();
							if (((theEntry.kind === "menubar") || (theEntry.kind === "address")) && (theName !== "custommenu") && (theName !== "menubar") && (theName !== "bookmarkmenu")) { //9/3/26 by CC -- an address entry too ("menus can be address", buildMenuBar): user.menus.tools is @Frontier.tools.menu, and /getmenubar follows it; DW's 9/3 report: "i don't see the Tools menu in the menubar"
								theOtherAddresses.push ("user.menus." + theEntry.name);
								}
							});
						}
					var theOtherMenus = new Array ();
					const theInstalledAlready = {"user.bookmarksmenu.menu": true, "user.menus.custommenu": true, "system.menus.menubar": true}; //9/3/26 by CC -- one menubar goes up once: user.menus.bookmark is an address to the bookmarks menu already up (meinstallmenubar on an installed menubar does nothing)
					theInstalledMenubarAddresses = Object.assign ({}, theInstalledAlready); //9/8/26 by CC -- kept for installTheMenus: the menubar whose window is in front is added only if it isn't one of these
					function fetchNext (ix) {
						if (ix >= theOtherAddresses.length) {
							installTheMenus (theMenus.concat (menuTemplateFromLines (data.lines, "user.menus.customMenu")).concat (theBookmarksMenus).concat (theOtherMenus));
							return;
							}
						serverJson ("/getmenubar?address=" + encodeURIComponent (theOtherAddresses [ix]), undefined, function (otherErr, otherData) {
							if (otherErr === undefined) {
								const theResolved = String ((otherData.resolvedAddress === undefined) ? theOtherAddresses [ix] : otherData.resolvedAddress).toLowerCase ();
								if (theInstalledAlready [theResolved] !== true) {
									theInstalledAlready [theResolved] = true;
									theInstalledMenubarAddresses [theResolved] = true; //9/8/26 by CC
									theInstalledMenubarAddresses [String (theOtherAddresses [ix]).toLowerCase ()] = true;
									theOtherMenus = theOtherMenus.concat (menuTemplateFromLines (otherData.lines, theOtherAddresses [ix]));
									}
								}
							fetchNext (ix + 1);
							});
						}
					fetchNext (0);
					});
				});
			});
		});
		});
	}
function menubarAddressOfFrontWindow () { //the menubar a menubar-editor window in front is editing, or undefined
	const theWindow = BrowserWindow.getFocusedWindow ();
	if ((theWindow === null) || (theWindow === undefined) || theWindow.isDestroyed ()) {
		return (undefined);
		}
	try {
		const parsed = new URL (theWindow.webContents.getURL ());
		if (parsed.pathname.indexOf ("menubar.html") === -1) {
			return (undefined);
			}
		const theAddress = parsed.searchParams.get ("address");
		return (((theAddress === null) || (theAddress.length === 0)) ? undefined : theAddress);
		}
	catch (err) {
		return (undefined);
		}
	}

function installTheMenus (customMenusFromDatabase) {
	theCustomMenus = customMenusFromDatabase; //8/12/26 by CC -- kept so the menubar can go back up when the windows change

	/*  9/3/26 by CC -- THE MENUBAR YOU'RE EDITING SHOWS WHILE ITS WINDOW IS IN
		FRONT. DW's design, 9/3: "suppose i have a menubar outline open. when
		i bring it to the front, its menus appear in the actual menubar. when
		i click on something else to bring it to the front, the previous
		menubar is removed from the actual menubar." That's meactivate in
		menueditor.c: a menubar that isn't installed is inserted while its
		window is active and removed when it isn't. The focus and blur
		events already rebuild the menus; this is where the front window's
		menubar joins them, fetched fresh so the edit just made is what
		shows.  */

	const theFrontAddress = menubarAddressOfFrontWindow ();
	if (theFrontAddress === undefined) {
		menuTrace ("no menubar window in front");
		installTheMenusWith (customMenusFromDatabase);
		return;
		}
	serverJson ("/getmenubar?address=" + encodeURIComponent (theFrontAddress), undefined, function (err, data) {
		if (err !== undefined) {
			menuTrace ("front window's menubar " + theFrontAddress + " couldn't be fetched: " + err.message);
			installTheMenusWith (customMenusFromDatabase);
			return;
			}
		const theFrontMenus = menuTemplateFromLines (data.lines, theFrontAddress);

		/*  9/8/26 by CC -- THE MENUBAR BEING EDITED GOES UP WHOLE. meactivate in
			menueditor.c: a menubar record that is not installed is inserted
			while its window is active, all of it; one that IS installed is
			left alone (flinstalled). This used to leave out any menu whose
			TITLE matched an installed menu's, so a menubar he was working on
			that shares a title with one already up -- a copy of the DW menu,
			say -- never showed while he edited it. DW, 9/8: "what if the menu
			i'm working on isn't in the menubar right now? how can i see what
			i'm doing?" Now the test is the menubar's address: installed, add
			nothing; not installed, add every menu it has.  */

		const theResolved = String ((data.resolvedAddress === undefined) ? theFrontAddress : data.resolvedAddress).toLowerCase ();
		const flInstalled = (theInstalledMenubarAddresses [theResolved] === true) || (theInstalledMenubarAddresses [String (theFrontAddress).toLowerCase ()] === true);
		const theExtraMenus = flInstalled ? [] : theFrontMenus;
		menuTrace ("front window's menubar " + theFrontAddress + ": " + data.lines.length + " lines, menus " + JSON.stringify (theFrontMenus.map (function (m) { return (m.label); })) + ", added " + JSON.stringify (theExtraMenus.map (function (m) { return (m.label); })));
		installTheMenusWith (customMenusFromDatabase.concat (theExtraMenus));
		});
	}

function menuTrace (theText) { //9/5/26 by CC -- ODB_MENU_TRACE in the environment logs what goes into the menubar, for driving the app headless
	if ((process.env.ODB_MENU_TRACE !== undefined) && (process.env.ODB_MENU_TRACE.length > 0)) {
		console.log ("menutrace: " + theText);
		}
	}

var theInstalledMenuKey, ctMenusOpen = 0, flMenuInstallDeferred = false; //9/8/26 by CC -- assigned by setApplicationMenuCarefully

function setApplicationMenuCarefully (theTemplate, customMenus) {

	/*  9/8/26 by CC -- THE WINDOW MENU CHOICE THAT DIDN'T TAKE. DW's 9/7
		report, on 0.4.59: "sometimes when i choose an item from the windows
		menu it doesn't bring it to front. second time it comes to the
		front." The menubar is rebuilt on every window focus, blur, close
		and retitle, and every time the database's change counter moves --
		which is every autosave of the script he's typing in. Replacing the
		application menu while a menu is open closes the menu, and the
		choice he was making goes with it.

		Two guards. A menubar identical to the one already up isn't
		installed again -- the key is the template with its functions
		flattened, plus the ids of the windows it lists, because a window
		closed and reopened has the same title and a different object, and
		the old menu's click would front a window that's gone. And while a
		menu is open (menu-will-show / menu-will-close on each top-level
		menu) the install waits; when the menu closes, the menubar is
		rebuilt fresh through rebuildMenusSoon, whose delay lets the click
		of the item just chosen run first.  */

	const theWindowIds = [];
	openWindows.forEach (function (theWindow) {
		if (!theWindow.isDestroyed ()) {
			theWindowIds.push (theWindow.id);
			}
		});
	const theKey = JSON.stringify (theTemplate, function (name, value) {
		return ((typeof value === "function") ? "function" : value);
		}) + JSON.stringify (theWindowIds);
	if (theKey === theInstalledMenuKey) {
		menuTrace ("unchanged -- not installed again");
		return;
		}
	if (ctMenusOpen > 0) {
		flMenuInstallDeferred = true;
		menuTrace ("a menu is open -- the install waits for it to close");
		return;
		}
	const theMenu = Menu.buildFromTemplate (theTemplate);
	theMenu.items.forEach (function (theItem) {
		if ((theItem.submenu !== undefined) && (theItem.submenu !== null)) {
			theItem.submenu.on ("menu-will-show", function () {
				ctMenusOpen++;
				});
			theItem.submenu.on ("menu-will-close", function () {
				ctMenusOpen = Math.max (0, ctMenusOpen - 1);
				if ((ctMenusOpen === 0) && flMenuInstallDeferred) {
					flMenuInstallDeferred = false;
					rebuildMenusSoon ();
					}
				});
			}
		});
	Menu.setApplicationMenu (theMenu);
	theInstalledMenuKey = theKey;
	console.log ("menubar installed -- " + customMenus.length + " custom menus");
	menuTrace ("installed " + JSON.stringify (customMenus.map (function (m) { return (m.label); })));
	}

function installTheMenusWith (customMenus) {
	evaluateMenuTitles (customMenus, function () {
		fileAndWindowMenuTemplates (function (theFileMenu, theWindowMenu) {
			try {
				/*  8/14/26 by CC -- the View menu is ours instead of the stock
					one for a single reason: Reload and Force Reload reload
					EVERY window, not just the front one. DW: "i expected it
					would force reload the electron app." Everything else in
					it matches the stock menu.  */

				const theViewMenu = {label: "View", submenu: [
					{label: "Reload", accelerator: "CmdOrCtrl+R", click: function () {
						BrowserWindow.getAllWindows ().forEach (function (theWindow) {
							theWindow.webContents.reload ();
							});
						}},
					{label: "Force Reload", accelerator: "Shift+CmdOrCtrl+R", click: function () {
						BrowserWindow.getAllWindows ().forEach (function (theWindow) {
							theWindow.webContents.reloadIgnoringCache ();
							});
						}},
					{role: "toggleDevTools"},
					{type: "separator"},
					{role: "resetZoom"},
					{role: "zoomIn"},
					{role: "zoomOut"},
					{type: "separator"},
					{role: "togglefullscreen"}
					]};

				const theTemplate = [
					{role: "appMenu"},
					theFileMenu,
					{role: "editMenu"},
					theViewMenu
					].concat (customMenus).concat ([
					theWindowMenu
					]);
				setApplicationMenuCarefully (theTemplate, customMenus);
				}
			catch (buildErr) {
				console.log ("Can't install the menubar because " + buildErr.message);
				}
			});
		});
	}

function readWindowState () {

	/*  8/8/26 by CC -- windows follow databases now, so a saved plain
		browse window (the merged-root view, a storage artifact) comes back
		as the nodeEditor.root window, and a fresh start opens that too.  */

	/*  9/4/26 by CC -- A FRESH START OPENS workspace.notepad. DW on his first
		fresh install, 9/4: "i don't know how to begin now. it would make sense
		for the virgin startup to create a workspace table, add
		workspace.notepad and open it. then at least i could do something."
		The 2012 opml.root ships workspace.notepad, and so does frontier.root
		now; this is the window a person is looking at when nothing else has
		been saved. (It had been nodeEditor.root's table since 8/8.)  */

	const urlDefaultWindow = urlBrowsePage + "script.html?address=workspace.notepad";
	try {
		const jstruct = JSON.parse (fs.readFileSync (pathWindowState, "utf8"));
		if (Array.isArray (jstruct.windows) && (jstruct.windows.length > 0)) {
			jstruct.windows.forEach (function (savedWindow) {
				const ixPath = savedWindow.url.indexOf ("/odbbrowser/");
				if (ixPath !== -1) { //windows follow the app to whatever server it talks to now
					savedWindow.url = urlServer + savedWindow.url.slice (ixPath);
					}
				if ((savedWindow.url === urlBrowsePage) || (savedWindow.url === urlBrowsePage + "index.html")) {
					savedWindow.url = urlDefaultWindow;
					}
				});
			return (jstruct);
			}
		}
	catch (err) {
		}
	return ({windows: [{url: urlDefaultWindow, bounds: {width: 1100, height: 750}}]});
	}

function saveWindowState () {

	/*  8/18/26 by CC -- DW, 8/18: "open windows are no longer remembered."
		Quitting closes the windows ONE AT A TIME, and every close saved the
		state again -- so the last write of a quit held whatever was left,
		which is one window. Next launch opened one window. The snapshot is
		taken once now, on before-quit, while every window is still standing,
		and nothing overwrites it after that.  */

	if (flQuitting) {
		return;
		}
	const theWindows = [];
	openWindows.forEach (function (theWindow) {
		if (!theWindow.isDestroyed ()) {
			theWindows.push ({
				url: theWindow.webContents.getURL (),
				bounds: theWindow.getBounds ()
				});
			}
		});
	if (theWindows.length > 0) { //quitting closes windows one by one -- never save the emptied-out end state
		fs.writeFileSync (pathWindowState, JSON.stringify ({windows: theWindows}, undefined, "\t"));
		}
	}

function saveSoon () {
	clearTimeout (theSaveTimer);
	theSaveTimer = setTimeout (saveWindowState, 500);
	}

function noteUserBounds (theWindow) { //9/10/26 by CC -- a move or resize by the person, not by the zoom; see zoomWindowToFit
	if ((theWindow === undefined) || theWindow.isDestroyed () || (theWindow.odbSettingBounds === true)) {
		return;
		}
	theWindow.odbLastUserBounds = theWindow.getBounds ();
	theWindow.odbZoomedFrom = undefined;
	theWindow.odbZoomedTo = undefined;
	}

function trackWindow (theWindow) {
	openWindows.push (theWindow);
	theWindow.on ("maximize", function () { //9/10/26 by CC -- the green button, for every window the app tracks (a window opened from a page too); see zoomWindowToFit
		zoomWindowToFit (theWindow);
		});
	theWindow.on ("move", saveSoon);
	theWindow.on ("resize", saveSoon);
	theWindow.on ("move", function () { //9/10/26 by CC -- the person's own placement, for the zoom to come back to
		noteUserBounds (theWindow);
		});
	theWindow.on ("resize", function () {
		noteUserBounds (theWindow);
		});
	theWindow.on ("close", saveWindowState); //synchronous -- a debounced save can lose the race against quit

	/*  8/12/26 by CC -- everything that changes what the Window menu should
		say: a window arriving, leaving, coming to the front, or being
		renamed as it loads what it opened on.  */

	theWindow.on ("focus", rebuildMenusSoon);
	theWindow.on ("focus", function () { //9/8/26 by CC -- the window coming to the front goes to the head of the order
		noteWindowInFront (theWindow);
		});
	noteWindowInFront (theWindow); //a new window opens in front
	theWindow.on ("blur", rebuildMenusSoon);
	theWindow.on ("closed", rebuildMenusSoon);
	theWindow.webContents.on ("page-title-updated", rebuildMenusSoon);
	rebuildMenusSoon ();
	theWindow.webContents.setWindowOpenHandler (function (details) { //a double-clicked script opens a real window -- unless it's already open, then it comes to front
		if (details.url.indexOf ("/odbbrowser") === -1) { //8/10/26 by CC -- anything that isn't one of our own pages is a page to READ: the View button's rendered file, a live site. The real browser gets it.
			shell.openExternal (details.url);
			return ({action: "deny"});
			}
		noteRecentPlace (details.url); //9/12/26 by CC -- every place a page sends the person to: Jump, cmd-click, a double-click, a Find hit
		const theExisting = findWindowShowing (details.url);
		if (theExisting !== undefined) {
			bringWindowForward (theExisting);
			return ({action: "deny"});
			}

		/*  8/13/26 by CC -- a window opened FROM another window gets the same
			bridge to the app that a launch-time window gets. Without this,
			desktop.writeWholeFile worked in restored windows and answered
			"this window isn't running in the Electric Frontier app" in a window that
			edit() opened -- which is where DW's backup script runs.

			8/24/26 by CC -- and it gets STAGGERED. This is the path edit and
			double-click open windows through, and it passed no position, so
			Electron put the new window exactly on top of the one that opened
			it -- DW: "hiding it completely." The kernel offsets a new window
			from the front one by the title bar height, 18 pixels down and
			right (shellwindow.c, doctitlebarheight); so do we now, from the
			window that did the opening.  */

		const theOptions = {webPreferences: {preload: pathTool.join (__dirname, "preload.js")}};
		if (details.url.indexOf ("about.html") === -1) { //9/10/26 by CC -- the same window as a launch-time one: the green button zooms, the page draws the title bar. Without these a window opened from a page kept the Mac's title bar under the page's strip -- DW's 9/10 report, two title bars on most windows
			theOptions.fullscreenable = false;
			theOptions.titleBarStyle = "hiddenInset";
			}
		if (!theWindow.isDestroyed ()) {
			const theOpenerBounds = theWindow.getBounds ();
			theOptions.x = theOpenerBounds.x + 30; //8/26/26 by CC -- DW's ruling 8/25: more than the kernel's 18, "you could move them a bit more"
			theOptions.y = theOpenerBounds.y + 30;
			theOptions.width = theOpenerBounds.width;
			theOptions.height = theOpenerBounds.height;
			}
		return ({action: "allow", overrideBrowserWindowOptions: theOptions});
		});
	theWindow.webContents.on ("did-create-window", function (childWindow) {
		trackWindow (childWindow);
		});

	/*  8/10/26 by CC -- DW: "it would be really nice to have an Inspect
		command for looking at CSS in debugger." Right-click anything in a
		window and Inspect opens the debugger on that exact element, with its
		styles showing. Same gesture as a browser, which is where this window
		really lives.  */

	theWindow.webContents.on ("context-menu", function (event, theParams) {
		Menu.buildFromTemplate ([
			{
				label: "Inspect",
				click: function () {
					theWindow.webContents.inspectElement (theParams.x, theParams.y);
					}
				}
			]).popup ({window: theWindow});
		});
	}

/*  8/12/26 by CC -- backing an object up to the machine DW is sitting at.

	The script on the server names a file and hands over the text; the
	folder belongs to the app. The first backup asks where, with a real
	folder dialog, and that answer is kept in appConfig.json -- so the
	question is asked once, ever.

	A name with a slash in it, or one that starts with a dot, is refused.
	The script names a FILE. If a path could travel from the server, a
	script up there could write anywhere on this machine.  */

function readAppConfig () {
	try {
		return (JSON.parse (fs.readFileSync (pathTool.join (app.getPath ("userData"), "appConfig.json"), "utf8")));
		}
	catch (err) {
		return ({});
		}
	}

function writeAppConfig (theConfig) {
	fs.writeFileSync (pathTool.join (app.getPath ("userData"), "appConfig.json"), JSON.stringify (theConfig, undefined, "\t"));
	}

function getBackupFolder (theWindow) { //undefined if the person closed the dialog without picking one
	const theConfig = readAppConfig ();
	if ((typeof theConfig.backupFolder === "string") && (theConfig.backupFolder.length > 0) && fs.existsSync (theConfig.backupFolder)) {
		return (theConfig.backupFolder);
		}
	const theAnswer = dialog.showOpenDialogSync (theWindow, {
		title: "Where should Electric Frontier put your backups?",
		properties: ["openDirectory", "createDirectory"],
		buttonLabel: "Back Up Here"
		});
	if ((theAnswer === undefined) || (theAnswer.length === 0)) {
		return (undefined);
		}
	theConfig.backupFolder = theAnswer [0];
	writeAppConfig (theConfig);
	return (theConfig.backupFolder);
	}

ipcMain.on ("desktop.moveWindowBy", function (event, dx, dy) { //9/13/26 by CC -- the page's own title-text drag: move this window by what the mouse moved (see installTitleStrip in common.js)
	try {
		const theWindow = BrowserWindow.fromWebContents (event.sender);
		if ((theWindow === null) || theWindow.isDestroyed ()) {
			return;
			}
		const thePosition = theWindow.getPosition ();
		theWindow.setPosition (Math.round (thePosition [0] + Number (dx)), Math.round (thePosition [1] + Number (dy)));
		}
	catch (err) {
		}
	});

ipcMain.on ("desktop.localPassword", function (event) { //8/15/26 by CC -- the desktop Frontier's pages never ask for a password; the app made one and hands it over
	event.returnValue = theDesktopPassword; //undefined outside the desktop Frontier, unless ODB_TEST_PASSWORD supplied one
	});

/*  8/15/26 by CC -- the version corner used to read the app's number out of
	the user agent, where Electron writes the app's name. The name changed to
	Electric Frontier, and a number that comes from parsing a name is a number
	that breaks every time the name moves. The app says what it is instead.  */

ipcMain.on ("desktop.appVersion", function (event) {
	event.returnValue = require ("./package.json").version;
	});

/*  file.getFileDialog -- 8/16/26 by CC. The kernel verb Atlantis was missing:
	a real Mac open-file dialog, put up by the app over the window the script
	ran from. The chosen file comes back as a Frontier colon path -- the first
	segment names the volume, the way the desktop's corral-off file verbs
	already read paths -- so what the dialog answers is what file.readWholeFile
	accepts. DW, 8/16: "it's not a new verb, it's one that hasn't been
	implemented yet."  */

function bootVolumeName () { //the /Volumes entry that is the boot disk -- "Macintosh HD" wherever the person kept the name
	var found;
	try {
		fs.readdirSync ("/Volumes").forEach (function (theName) {
			if (found === undefined) {
				try {
					if (fs.realpathSync (pathTool.join ("/Volumes", theName)) === "/") {
						found = theName;
						}
					}
				catch (err) {
					}
				}
			});
		}
	catch (err) {
		}
	return (found);
	}

function colonPathFromPosix (thePath) {
	if (thePath.indexOf ("/Volumes/") === 0) {
		return (thePath.slice ("/Volumes/".length).split ("/").join (":"));
		}
	const theVolume = bootVolumeName ();
	if (theVolume === undefined) {
		return (thePath); //no volume name to be found -- the posix path at least names the file
		}
	return (theVolume + thePath.split ("/").join (":"));
	}

function posixPathFromColon (theColonPath) {
	if (theColonPath.indexOf ("/") === 0) {
		return (theColonPath);
		}
	var theRest = theColonPath;
	if (theRest.endsWith (":")) {
		theRest = theRest.slice (0, theRest.length - 1);
		}
	const segments = theRest.split (":");
	const theVolume = segments.shift ();
	return (pathTool.join ("/Volumes", theVolume, segments.join ("/")));
	}

ipcMain.handle ("desktop.getFileDialog", function (event, thePrompt, theStartPath) {
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const theOptions = {
		message: (typeof thePrompt === "string") ? thePrompt : "",
		properties: ["openFile"]
		};
	if ((typeof theStartPath === "string") && (theStartPath.length > 0)) {
		try {
			const posixStart = posixPathFromColon (theStartPath);
			if (fs.existsSync (posixStart)) {
				theOptions.defaultPath = posixStart;
				}
			}
		catch (err) {
			}
		}
	const theAnswer = dialog.showOpenDialogSync (theWindow, theOptions);
	if ((theAnswer === undefined) || (theAnswer.length === 0)) {
		return ({flOk: false});
		}
	return ({flOk: true, colonPath: colonPathFromPosix (theAnswer [0])});
	});

/*  file.putFileDialog and file.getFolderDialog -- 8/17/26 by CC, the two
	other dialogs the kernel has (getDiskDialog is the fourth and answers a
	volume, which DW set aside). Same shape as getFileDialog above: the app
	puts the real dialog up over the window the script ran from, and the
	answer comes back as a colon path.  */

ipcMain.handle ("desktop.putFileDialog", function (event, thePrompt, theStartPath, theDefaultName) {
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const theOptions = {
		message: (typeof thePrompt === "string") ? thePrompt : "",
		properties: ["createDirectory"]
		};
	if ((typeof theDefaultName === "string") && (theDefaultName.length > 0)) {
		theOptions.defaultPath = theDefaultName;
		}
	if ((typeof theStartPath === "string") && (theStartPath.length > 0)) {
		try {
			const posixStart = posixPathFromColon (theStartPath);
			theOptions.defaultPath = posixStart;
			}
		catch (err) {
			}
		}
	const theAnswer = dialog.showSaveDialogSync (theWindow, theOptions);
	if ((theAnswer === undefined) || (theAnswer.length === 0)) {
		return ({flOk: false});
		}
	return ({flOk: true, colonPath: colonPathFromPosix (theAnswer)});
	});

ipcMain.handle ("desktop.getFolderDialog", function (event, thePrompt, theStartPath) {
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const theOptions = {
		message: (typeof thePrompt === "string") ? thePrompt : "",
		properties: ["openDirectory", "createDirectory"]
		};
	if ((typeof theStartPath === "string") && (theStartPath.length > 0)) {
		try {
			const posixStart = posixPathFromColon (theStartPath);
			if (fs.existsSync (posixStart)) {
				theOptions.defaultPath = posixStart;
				}
			}
		catch (err) {
			}
		}
	const theAnswer = dialog.showOpenDialogSync (theWindow, theOptions);
	if ((theAnswer === undefined) || (theAnswer.length === 0)) {
		return ({flOk: false});
		}
	const theColonPath = colonPathFromPosix (theAnswer [0]);
	return ({flOk: true, colonPath: theColonPath.endsWith (":") ? theColonPath : (theColonPath + ":")}); //a folder path ends with a colon, the way Frontier writes one
	});

/*  8/20/26 by CC -- window.getPosition and its family. The kernel's
	getboundsverb reads shellgetglobalwindowrect -- the window's place on the
	SCREEN -- so it's the app's windows these are about, not the page inside
	one. The window for an object is the one showing that address, which is
	how findWindowShowing already matches them.
	
	theChange is nothing for a read, or {x, y} / {width, height} / {title}
	for a write. It answers the window's whole geometry either way, and
	flOpen false when there's no window on that object -- which is what
	getboundsverb answers when hinfo is nil.  */

ipcMain.handle ("desktop.windowGeometry", function (event, theAddress, theChange) {
	var theWindow;
	openWindows.forEach (function (openWindow) {
		if ((theWindow === undefined) && !openWindow.isDestroyed ()) {
			const theUrls = [openWindow.webContents.getURL (), openWindow.odbRequestedUrl];
			theUrls.forEach (function (theUrl) {
				if ((theWindow === undefined) && (theUrl !== undefined)) {
					try {
						const theOne = new URL (theUrl).searchParams.get ("address");
						if ((theOne !== null) && (theOne.toLowerCase () === String (theAddress).toLowerCase ())) {
							theWindow = openWindow;
							}
						}
					catch (err) {
						}
					}
				});
			}
		});
	if (theWindow === undefined) {
		return ({flOpen: false});
		}
	if ((theChange !== undefined) && (theChange !== null)) {
		if (theChange.flFront === true) {
		
			/*  8/22/26 by CC -- edit on an object whose window is already
				open brings that window forward. DW reported it didn't. The
				page was calling window.focus (), which a background renderer
				cannot act on -- only the app can raise a native window.  */
			
			noteWindowInFront (theWindow); //9/8/26 by CC
			if (theWindow.isMinimized ()) {
				theWindow.restore ();
				}
			theWindow.show ();
			theWindow.focus ();
			}
		else if (theChange.title !== undefined) {
			theWindow.setTitle (String (theChange.title));
			}
		else {
			const theBounds = theWindow.getBounds ();
			if (theChange.x !== undefined) {
				theBounds.x = Number (theChange.x);
				theBounds.y = Number (theChange.y);
				}
			if (theChange.width !== undefined) {
				theBounds.width = Number (theChange.width);
				theBounds.height = Number (theChange.height);
				}
			theWindow.setBounds (theBounds);
			}
		}
	const theNow = theWindow.getBounds ();
	return ({flOpen: true, x: theNow.x, y: theNow.y, width: theNow.width, height: theNow.height, title: theWindow.getTitle ()});
	});

function zoomWindowToFit (theWindow) {

	/*  9/10/26 by CC -- THE ZOOM BOX, from shellzoomwindow (shellwindow.c): the
		zoomed-out state is the window grown by what the content needs beyond
		the content area (getcontentsizeroutine), never wider than the screen,
		at least wide enough for the title; a window already at that state
		zooms back in. The page says what its content needs (myContentSize in
		common.js); the app knows the frame and the screen. DW, 9/10: "zoom to
		the minimum height and width that displays all the text as seen on the
		screen. it's used to neaten things up."  */

	if ((theWindow === undefined) || theWindow.isDestroyed ()) {
		return;
		}
	if ((theWindow.odbZoomedFrom !== undefined) && (theWindow.odbZoomedTo !== undefined)) { //zoomed out and untouched since: back to where it was
		const theBack = theWindow.odbZoomedFrom;
		theWindow.odbZoomedFrom = undefined;
		theWindow.odbZoomedTo = undefined;
		theWindow.odbSettingBounds = true;
		theWindow.setBounds (theBack);
		theWindow.odbSettingBounds = false;
		return;
		}
	const theFrom = (theWindow.odbLastUserBounds !== undefined) ? theWindow.odbLastUserBounds : theWindow.getBounds ();
	theWindow.webContents.executeJavaScript ("(typeof myContentSize === \"function\") ? myContentSize () : undefined", true).then (function (theSize) {
		if ((theSize === undefined) || (theSize === null) || !(theSize.width > 0) || !(theSize.height > 0)) {
			return;
			}
		const theBounds = theWindow.getBounds ();
		const theContent = theWindow.getContentBounds ();
		const theChromeWidth = theBounds.width - theContent.width;
		const theChromeHeight = theBounds.height - theContent.height;
		const theWanted = {x: theFrom.x, y: theFrom.y, width: Math.ceil (theSize.width) + theChromeWidth, height: Math.ceil (theSize.height) + theChromeHeight};
		const theTitleWidth = Math.round (theWindow.getTitle ().length * 7.5) + 64; //the kernel's floor: the title plus 64
		theWanted.width = Math.max (theWanted.width, theTitleWidth, 200);
		theWanted.height = Math.max (theWanted.height, 120);
		const theArea = screen.getDisplayMatching (theFrom).workArea; //constraintoscreenbounds
		theWanted.width = Math.min (theWanted.width, theArea.width);
		theWanted.height = Math.min (theWanted.height, theArea.height);
		if (theWanted.x + theWanted.width > theArea.x + theArea.width) {
			theWanted.x = Math.max (theArea.x, theArea.x + theArea.width - theWanted.width);
			}
		if (theWanted.y + theWanted.height > theArea.y + theArea.height) {
			theWanted.y = Math.max (theArea.y, theArea.y + theArea.height - theWanted.height);
			}
		theWindow.odbZoomedFrom = theFrom;
		theWindow.odbZoomedTo = theWanted;
		theWindow.odbSettingBounds = true;
		theWindow.setBounds (theWanted);
		theWindow.odbSettingBounds = false;
		if (process.env.ODB_MENU_TRACE !== undefined) {
			console.log ("zoom: " + theWindow.getTitle () + " from " + JSON.stringify (theFrom) + " to " + JSON.stringify (theWanted) + " (content " + JSON.stringify (theSize) + ")");
			}
		}, function (err) {
		});
	}

ipcMain.handle ("desktop.zoomWindow", function (event) { //9/10/26 by CC -- a double-click on the page's title, the title bar's own gesture
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	if (theWindow !== null) {
		zoomWindowToFit (theWindow);
		}
	return (true);
	});

ipcMain.handle ("desktop.popupMenu", function (event, theItems) {

	/*  9/10/26 by CC -- a native popup menu at the mouse, for the title's
		path popup (tablepopup.c: the ancestors, leaf to root, choose one to
		go there). Answers the index chosen, or -1.  */

	const theWindow = BrowserWindow.fromWebContents (event.sender);
	return (new Promise (function (resolve) {
		var theChosen = -1;
		const theTemplate = [];
		(Array.isArray (theItems) ? theItems : []).forEach (function (theLabel, ix) {
			theTemplate.push ({label: String (theLabel), click: function () {
				theChosen = ix;
				}});
			});
		if (theTemplate.length === 0) {
			resolve (-1);
			return;
			}
		const theMenu = Menu.buildFromTemplate (theTemplate);
		theMenu.popup ({window: (theWindow === null) ? undefined : theWindow, callback: function () {
			setTimeout (function () { //the click lands after the close
				resolve (theChosen);
				}, 50);
			}});
		}));
	});

ipcMain.handle ("desktop.windowBehind", function (event) {

	/*  9/8/26 by CC -- THE WINDOW BEHIND THE ONE ASKING, and what it answers
		window.frontmost with. The kernel's shellfindtargetwindow walks the
		visible window layer front to back and a script window whose own
		Run-button process is running steps aside (scriptgettargetdata), so
		the target is the next window down. The order here is the focus
		history, newest first, with windows that were never focused after
		it, newest first, since a window opens in front; minimized and
		hidden windows are not in the layer. The answer is the page's own, asked for the way the
		page itself answers window.frontmost, or "" when nothing is behind.  */

	const theAsking = BrowserWindow.fromWebContents (event.sender);
	const theCandidates = theFocusOrder.slice ();
	openWindows.slice ().reverse ().forEach (function (theWindow) {
		if (theCandidates.indexOf (theWindow) === -1) {
			theCandidates.push (theWindow);
			}
		});
	var theBehind;
	theCandidates.forEach (function (theWindow) {
		if ((theBehind === undefined) && (theWindow !== theAsking) && !theWindow.isDestroyed () && theWindow.isVisible () && !theWindow.isMinimized ()) {
			theBehind = theWindow;
			}
		});
	if (theBehind === undefined) {
		return ("");
		}
	return (theBehind.webContents.executeJavaScript ("(typeof myFrontmostAnswer === \"function\") ? myFrontmostAnswer () : \"\"", true).then (function (theAnswer) {
		return (((theAnswer === undefined) || (theAnswer === null)) ? "" : String (theAnswer));
		}, function (err) {
		return ("");
		}));
	});

/*  8/20/26 by CC -- window.about opens the About window. What it says is
	TBD, DW's word on 8/20.  */

ipcMain.handle ("desktop.resizeSelf", function (event, theWidth, theHeight) { //9/16/26 by CC -- the About window's flag: the page asks for the height its form needs (about.c ccflagflip grows and shrinks the window)
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	if ((theWindow === null) || theWindow.isDestroyed ()) {
		return (false);
		}
	const theBounds = theWindow.getContentBounds ();
	theWindow.setContentSize (Math.round ((theWidth > 0) ? theWidth : theBounds.width), Math.round (theHeight), true);
	return (true);
	});

ipcMain.handle ("desktop.openQuickScriptWindow", function (event) { //9/16/26 by CC -- window.quickScript: one Quick Script window, the kernel's (command.c); opening it again brings it forward
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const theBase = (theWindow === null) ? undefined : theWindow.webContents.getURL ();
	if (theBase === undefined) {
		return (false);
		}
	openOrFrontWindow (new URL ("quickscript.html", theBase).toString ());
	return (true);
	});

ipcMain.handle ("desktop.openAboutWindow", function (event) {
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const theBase = (theWindow === null) ? undefined : theWindow.webContents.getURL ();
	if (theBase === undefined) {
		return (false);
		}
	openOrFrontWindow (new URL ("about.html", theBase).toString ());
	return (true);
	});

ipcMain.handle ("desktop.writeWholeFile", function (event, theFilename, theText) {
	if ((typeof theFilename !== "string") || (theFilename.length === 0)) {
		throw new Error ("the script didn't say what to name the file.");
		}
	if ((theFilename.indexOf ("/") !== -1) || (theFilename.indexOf ("\\") !== -1) || (theFilename.charAt (0) === ".")) {
		throw new Error ("\"" + theFilename + "\" isn't a file name -- a backup names a file, never a place to put it.");
		}
	const theWindow = BrowserWindow.fromWebContents (event.sender);
	const folderBackups = getBackupFolder (theWindow);
	if (folderBackups === undefined) {
		throw new Error ("no backup folder has been chosen on this machine.");
		}
	const thePath = pathTool.join (folderBackups, theFilename);
	fs.writeFileSync (thePath, (theText === undefined) ? "" : String (theText));
	return (thePath);
	});

function createWindow (theUrl, theBounds) {

	/*  8/12/26 by CC -- one window per object, wherever the open comes from.
		The rule was only enforced where the app opens a window itself; a
		restore of saved state, or a second copy in the state file, could put
		two windows on the same object -- which is what DW saw listed twice
		in the Window menu.  */

	const theExisting = findWindowShowing (theUrl);
	if (theExisting !== undefined) {
		bringWindowForward (theExisting);
		return (theExisting);
		}
	/*  8/19/26 by CC -- DW: "when opening a window its location must be a bit
		down and to the right of the frontmost window. right now it's opening
		behind it, it seems as if nothing happened." A new window with no
		bounds of its own is staggered from the front window the way the
		Finder and Frontier both do it, and it comes to the front. A window
		restored from saved state keeps the place it had.  */
	
	const theOptions = {
		width: 1100,
		height: 750,
		fullscreenable: false, //9/10/26 by CC -- the green button zooms, it doesn't go full screen: DW, 9/10, "instead of zooming full screen, have it zoom to the minimum height and width that displays all the text... it's used to neaten things up"; see zoomWindowToFit
		titleBarStyle: "hiddenInset", //9/10/26 by CC -- the page draws the title in the title bar, so a Cmd-click on it can show the path back to the root (tablepopup.c tableclienttitlepopuphit); Electron gives a page no clicks on the native title
		webPreferences: {
			preload: pathTool.join (__dirname, "preload.js")
			}
		};
	const flAboutWindow = (String (theUrl).indexOf ("about.html") !== -1);
	if (flAboutWindow) { //9/10/26 by CC -- the About page draws no title strip of its own; it keeps the Mac's title bar
		delete theOptions.titleBarStyle;
		}
	if (theBounds === undefined) {
		const theFront = frontWindow ();
		if ((theFront !== undefined) && !theFront.isDestroyed ()) {
			const theFrontBounds = theFront.getBounds ();
			theOptions.x = theFrontBounds.x + 30; //8/24/26 by CC -- the kernel's stagger is doctitlebarheight, 18 (standard.h); 30 as of 8/26, DW's ruling: "you could move them a bit more"
			theOptions.y = theFrontBounds.y + 30;
			theOptions.width = theFrontBounds.width;
			theOptions.height = theFrontBounds.height;
			}
		if (flAboutWindow) { //9/16/26 by CC -- the About window opens in its small form, one line of text (about.c's minimum: the message strip); the flag on the page grows it
			theOptions.width = 620;
			theOptions.height = 80;
			}
		if (String (theUrl).indexOf ("quickscript.html") !== -1) { //9/16/26 by CC -- the Quick Script window: a text box, the Run button, a line for the result; DW's Berkeley screen shot is about this shape
			theOptions.width = 720;
			theOptions.height = 260;
			}
		}
	const theWindow = new BrowserWindow (Object.assign (theOptions, theBounds));
	theWindow.odbRequestedUrl = theUrl;
	trackWindow (theWindow);
	theWindow.loadURL (theUrl);
	if (theBounds === undefined) { //8/19/26 by CC -- a window the person just asked for belongs in front, not behind what they were looking at
		theWindow.show ();
		theWindow.focus ();
		}
	return (theWindow);
	}

function installAboutBox () {

	/*  8/10/26 by CC -- DW: "let's get a version number in the usual place so
		i can quickly tell what i'm running." On a Mac the usual place is the
		About box, first item in the application menu. Three numbers matter,
		not one: this app, and the trigger and usertalk it's talking to --
		the app is packaged and copied around, the server updates on its own,
		so they drift apart and the question is always which of them you have.  */

	const versionApp = require ("./package.json").version;

	function showWhatWeKnow (versionServer, versionUsertalk, theNote) {
		app.setAboutPanelOptions ({
			applicationName: "Electric Frontier",
			applicationVersion: versionApp,
			version: "",
			credits: "trigger " + versionServer + ", usertalk " + versionUsertalk + "\n" + urlServer + theNote
			});
		}

	showWhatWeKnow ("?", "?", "\nasking the server...");

	/*  /version takes no password, and this runs before one has been
		borrowed, so it goes straight at the server rather than through
		serverJson.  */

	const theRequest = webRequest (urlServer + "/version", {method: "GET"}, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			try {
				const data = JSON.parse (theText);
				showWhatWeKnow (data.version, data.usertalkVersion, "\n" + data.ctDatabaseRows + " rows");
				}
			catch (err) {
				showWhatWeKnow ("?", "?", "\nthe server's answer wasn't readable.");
				}
			});
		});
	theRequest.on ("error", function (err) {
		showWhatWeKnow ("?", "?", "\nnot answering: " + err.message);
		});
	theRequest.end ();
	}

app.whenReady ().then (function () {
	urlServer = chooseServer ();
	urlBrowsePage = urlServer + "/odbbrowser/";
	pathWindowState = pathTool.join (app.getPath ("userData"), "windowState.json");
	startServer (function () {
		installAboutBox ();
		const theState = readWindowState ();
		theState.windows.forEach (function (savedWindow) {
			createWindow (savedWindow.url, savedWindow.bounds);
			});
		borrowPassword (function (theValue) { //the menubar comes up as soon as the saved connection is readable
			thePassword = theValue;
			installMenubar ();
			startMenubarFollowingTheDatabase ();
			});
		});
	});

/*  8/21/26 by CC -- CLOSING THE LAST WINDOW DOES NOT QUIT. DW, 8/21, while
	trying to close every window to clear the app's state: "funny -- closing the
	last window exits the app." Frontier doesn't work that way and neither does
	any Mac app: the windows are views on a database that is still open, and
	closing the last one leaves you in the app with nothing on screen, which is
	a legitimate place to be. On Windows and Linux, where an app with no windows
	has no way back, quitting is still right.  */

app.on ("window-all-closed", function () {
	if (process.platform !== "darwin") {
		app.quit ();
		}
	});

/*  8/22/26 by CC -- REMOVED: with no windows open, clicking the dock icon
	opened frontier.root. Nobody asked for it and there is no prior art for
	it. DW, 8/22: "if you had suggested it, we would have discussed and i
	would have asked Why Frontier.root? ... you're opening the database where
	they can do the most damage by dicking around." What the right answer is
	-- workspace is the candidate -- is a conversation to have with other
	people in the room. Until then the dock icon just activates the app.  */

app.on ("before-quit", function () { //8/18/26 by CC -- the windows are all still open here, which is the only moment the whole set can be written down
	saveWindowState ();
	flQuitting = true;
	});

app.on ("will-quit", function () {
	if (theServerProcess !== undefined) {
		theServerProcess.kill ();
		}
	});
