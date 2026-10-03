/*  buildDesktopApp.js -- build ELECTRIC FRONTIER: the app with a whole
	Frontier inside it -- server, interpreter, odb browser, Concord -- so
	everything runs on the one machine it's sitting on. DW named it 8/15/26,
	in the family with Electric Drummer and Electric FeedLand: "we've already
	made the point that it has to BE frontier, not LIKE frontier."

	DW's architecture, 8/15/26: two full Frontiers. His desktop runs one
	(this build); marin keeps running one; webEdit moves objects between
	them. "we worked all this out many years ago, it works."

	What this stages: the electronApp files, plus a server/ folder holding
	trigger, usertalk, frontierodb, the odb browser pages and Concord, with
	node_modules built for ELECTRON's engine (the app launches the server
	with its own binary, ELECTRON_RUN_AS_NODE -- no system node needed).
	The database is NOT in the bundle: main.js makes one in the app's data
	folder at first launch, seeded from server/seed.db if the build carried
	one.

	node misc/buildDesktopApp.js [path-to-seed-db]

	by CC, 8/15/26  */

const fs = require ("fs");
const pathTool = require ("path");
const childProcess = require ("child_process");

const folderTrigger = pathTool.resolve (__dirname, "..");
const folderUsertalk = pathTool.resolve (folderTrigger, "../usertalk");
const folderConcord = pathTool.resolve (folderTrigger, "../concord");
const folderApp = pathTool.join (folderTrigger, "electronApp");
const folderStaging = pathTool.join (folderApp, "desktopStaging");
const pathSeed = process.argv [2];

const electronVersion = JSON.parse (fs.readFileSync (pathTool.join (folderApp, "package.json"), "utf8")).devDependencies.electron.replace ("^", "");
const theAppName = JSON.parse (fs.readFileSync (pathTool.join (folderApp, "package.json"), "utf8")).productName; //Electric Frontier -- DW named it 8/15/26

function shell (theCommand, theCwd) {
	return (childProcess.execSync (theCommand, {cwd: theCwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]}));
	}
function copyFile (pathSource, pathDestination) {
	fs.mkdirSync (pathTool.dirname (pathDestination), {recursive: true});
	fs.copyFileSync (pathSource, pathDestination);
	}
function copyFolder (folderSource, folderDestination) {
	childProcess.execSync ("cp -R " + JSON.stringify (folderSource) + "/. " + JSON.stringify (folderDestination) + "/");
	}

//stage the app files
	fs.rmSync (folderStaging, {recursive: true, force: true});
	fs.mkdirSync (folderStaging, {recursive: true});
	["main.js", "preload.js", "package.json"].forEach (function (theName) {
		copyFile (pathTool.join (folderApp, theName), pathTool.join (folderStaging, theName));
		});

//stage the server -- a whole Frontier
	const folderServer = pathTool.join (folderStaging, "server");
	["trigger.js", "runnerWorker.js", "frontierodb.js"].forEach (function (theName) {
		copyFile (pathTool.join (folderTrigger, theName), pathTool.join (folderServer, theName));
		});
	fs.mkdirSync (pathTool.join (folderServer, "odbBrowser"), {recursive: true});
	copyFolder (pathTool.join (folderTrigger, "odbBrowser"), pathTool.join (folderServer, "odbBrowser"));
	fs.mkdirSync (pathTool.join (folderServer, "concord"), {recursive: true});
	copyFolder (folderConcord, pathTool.join (folderServer, "concord"));
	fs.mkdirSync (pathTool.join (folderServer, "usertalk/code"), {recursive: true});
	copyFile (pathTool.join (folderUsertalk, "package.json"), pathTool.join (folderServer, "usertalk/package.json"));
	fs.readdirSync (pathTool.join (folderUsertalk, "code")).forEach (function (theName) {
		if (theName.endsWith (".js") || theName.endsWith (".json")) {
			copyFile (pathTool.join (folderUsertalk, "code", theName), pathTool.join (folderServer, "usertalk/code", theName));
			}
		});
	/*  8/21/26 by CC -- the upgrade tool travels INSIDE the release. A new
		release seeds a NEW database; the one a person already has is never
		touched by installing one, so system.verbs has to be put there by
		hand. Everything that takes needs to be in one place on the machine
		they are sitting at: the script, DW's export, and the node that runs
		them, which the app already carries.  */
	
	copyFile (pathTool.join (folderTrigger, "misc", "installSystemVerbs.js"), pathTool.join (folderServer, "installSystemVerbs.js"));
	copyFile (pathTool.join (folderTrigger, "misc", "system.verbs.fttb"), pathTool.join (folderServer, "system.verbs.fttb"));
	copyFile (pathTool.join (folderTrigger, "misc", "workspaceTests.opml"), pathTool.join (folderServer, "workspaceTests.opml"));
	
	/*  8/21/26 by CC -- A RELEASE WITHOUT A SEED IS NOT A RELEASE. The staging
		folder is wiped at the top of every build, so the seed only survives if
		it is named on the command line. Forgetting the argument used to build
		a complete, packaged, shippable app whose database was empty -- it said
		nothing and the zip looked fine. It stops now.  */
	
	if (pathSeed === undefined) {
		console.log ("Can't build because no seed database was named. node misc/buildDesktopApp.js <path to the seed .db>");
		process.exit (1);
		}
	if (!fs.existsSync (pathSeed)) {
		console.log ("Can't build because there's no seed database at " + pathSeed + ".");
		process.exit (1);
		}
	if (fs.statSync (pathSeed).size === 0) {
		console.log ("Can't build because the seed database at " + pathSeed + " is empty.");
		process.exit (1);
		}
	copyFile (pathSeed, pathTool.join (folderServer, "seed.db"));
	console.log ("seed database staged, " + fs.statSync (pathSeed).size + " bytes");

	/*  9/3/26 by CC -- THE TOOLS SHIP AS FILES. Every .root in the Tools
		folder beside the seed database (data/Tools) rides in server/Tools,
		and main.js copies them into Guest Databases/apps/Tools at first launch (Frontier's folder, 9/15/26).
		nodeEditor.root is the first; DW's 9/3 ruling took nodeEditorSuite
		out of frontier.root for good.  */

	/*  9/4/26 by CC -- and the 2012 distribution's Guest Databases/ops roots,
		discuss.root and members.root, which mainResponder.startup opens at
		boot: data/Guest Databases/ops beside the seed rides in
		server/GuestOps and main.js seeds Guest Databases/ops from it.  */

	const folderSeedOps = pathTool.join (pathTool.dirname (pathTool.resolve (pathSeed)), "Guest Databases", "ops");
	if (fs.existsSync (folderSeedOps)) {
		fs.mkdirSync (pathTool.join (folderServer, "GuestOps"), {recursive: true});
		fs.readdirSync (folderSeedOps).forEach (function (theName) {
			if (theName.toLowerCase ().endsWith (".root")) {
				copyFile (pathTool.join (folderSeedOps, theName), pathTool.join (folderServer, "GuestOps", theName));
				console.log ("Guest Databases/ops staged with " + theName);
				}
			});
		}

	const folderSeedTools = pathTool.join (pathTool.dirname (pathTool.resolve (pathSeed)), "Tools");
	if (fs.existsSync (folderSeedTools)) {
		fs.mkdirSync (pathTool.join (folderServer, "Tools"), {recursive: true});
		fs.readdirSync (folderSeedTools).forEach (function (theName) {
			if (theName.toLowerCase ().endsWith (".root")) {
				copyFile (pathTool.join (folderSeedTools, theName), pathTool.join (folderServer, "Tools", theName));
				console.log ("Tools folder staged with " + theName + ", " + fs.statSync (pathTool.join (folderSeedTools, theName)).size + " bytes");
				}
			});
		}

//the server's dependencies, built for Electron's engine
	fs.writeFileSync (pathTool.join (folderServer, "package.json"), JSON.stringify ({
		name: "frontier-server",
		version: JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "package.json"), "utf8")).version,
		private: true,
		dependencies: JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "package.json"), "utf8")).dependencies
		}, undefined, "\t"));
	console.log ("installing server dependencies...");
	shell ("npm install --omit=dev --no-audit --no-fund", folderServer);
	console.log ("rebuilding better-sqlite3 for Electron " + electronVersion + " on x64...");
	shell ("npm rebuild better-sqlite3 --runtime=electron --target=" + electronVersion + " --arch=x64 --disturl=https://electronjs.org/headers", folderServer); //x64 to match the packaged app -- Berkeley is an Intel iMac Pro

//package
	console.log ("packaging...");
	shell ("npx electron-packager " + JSON.stringify (folderStaging) + " " + JSON.stringify (theAppName) + " --platform=darwin --arch=x64 --icon=" + JSON.stringify (pathTool.join (folderApp, "electricFrontier.icns")) + " --out=" + JSON.stringify (pathTool.join (folderApp, "dist/electricFrontier")) + " --overwrite", folderApp);

//zip
	const folderPackaged = pathTool.join (folderApp, "dist/electricFrontier", theAppName + "-darwin-x64");
	const pathZip = pathTool.join (folderApp, "dist/electricFrontier.zip");
	fs.rmSync (pathZip, {force: true});
	shell ("zip -qry " + JSON.stringify (pathZip) + " " + JSON.stringify (theAppName + ".app"), folderPackaged);
	console.log ("built " + pathZip + ", " + fs.statSync (pathZip).size + " bytes");
