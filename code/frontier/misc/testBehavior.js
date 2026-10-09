/*  testBehavior.js -- the behavior gate. Nothing ships unless this passes.

	node misc/testBehavior.js [path to the .db]

	misc/compileAll.js is the syntax gate: every script in the database
	parses. This is the other half -- it RUNS things and checks what
	happened. DW asked for it on 8/23/26, at the end of a day he lost to
	three separate failures none of which a parse could have caught:

		"come up with a set of stress tests and never release a version
		that does that."

	Everything here runs headless -- the language against a copy of the
	database, no app, no windows. A test that needs the user interface
	does not belong in this file; it belongs on the list until there is a
	way to drive the app.

	The rule for adding to it: every bug we fix gets a test here first,
	and the test fails before the fix and passes after. That is what keeps
	the file honest.

	by CC, 8/23/26  */

const fs = require ("fs");
const pathTool = require ("path");

const folderUsertalk = "/Users/davewiner/Claude/usertalk/code/";
const odbSql = require (folderUsertalk + "odbSql.js");
const verbsMaker = require (folderUsertalk + "verbs.js");
const evaluate = require (folderUsertalk + "evaluate.js");
const parse = require (folderUsertalk + "parse.js");
const pathmap = require (folderUsertalk + "pathmap.json");

const pathMaster = (process.argv [2] === undefined)
	? pathTool.join (__dirname, "..", "data", "seed.db")
	: process.argv [2];

const folderScratch = pathTool.join (require ("os").tmpdir (), "testBehavior"); //copies live outside the repo -- nothing this writes belongs in a checkout

var ctPassed = 0, ctFailed = 0; //counted by checkThat, read by the report at the bottom
const theFailures = [];

//the harness

	function freshDatabase (theName) {

		/*  A copy, always. A test that writes must never touch the database
			it was pointed at -- DW's whole point about not creating messes
			we can't unwind.  */

		if (!fs.existsSync (folderScratch)) {
			fs.mkdirSync (folderScratch, {recursive: true});
			}
		const pathCopy = pathTool.join (folderScratch, theName + ".db");
		[pathCopy, pathCopy + "-wal", pathCopy + "-shm"].forEach (function (thePath) {
			if (fs.existsSync (thePath)) {
				fs.unlinkSync (thePath);
				}
			});
		fs.copyFileSync (pathMaster, pathCopy);
		return (pathCopy);
		}

	function openTheDatabase (pathDatabase, theMapOverrides) { //9/6/26 by CC -- the second parameter lets one section run the way the desktop does (the corral off); the default stays the server's way

		/*  The same wiring runnerWorker.js does, minus the app verbs. If
			this drifts from the worker the tests stop meaning anything, so
			any change to the worker's setup belongs here too.  */

		const theStore = odbSql.openDatabase (pathDatabase);
		const theTrace = [];

		/*  8/23/26 by CC -- the file verbs are corralled by the path map, so
			a test that reads or writes a file needs a prefix of its own. This
			one points a Frontier-style path at the scratch folder; nothing
			outside it is reachable, which is the point of the corral.  */

		const theMap = JSON.parse (JSON.stringify (pathmap));
		theMap.prefixes ["Macintosh HD:ccTest"] = pathTool.join (folderScratch, "files");
		theMap.prefixes ["codecasting"] = pathTool.join (folderScratch, "codecasting"); //8/24/26 by CC -- where the release loop's parts and feed land during the test
		theMap.flAllowDiskWrites = true;
		theMap.pathDatabase = pathDatabase; //9/6/26 by CC -- frontier.getProgramPath answers a path beside the database, the way the desktop does, so Frontier.getSubFolder and Frontier.openDataFile reach a real Guest Databases folder -- in the scratch folder, under the prefix below
		theMap.prefixes ["Macintosh HD:" + folderScratch.replace (/^\//, "").split ("/").join (":")] = folderScratch;
		if (theMapOverrides !== undefined) {
			Object.keys (theMapOverrides).forEach (function (theName) {
				theMap [theName] = theMapOverrides [theName];
				});
			}

		const theVerbs = verbsMaker.makeVerbs (theMap, theTrace).verbs;
		const environment = evaluate.makeEnvironment (theStore.odb, theVerbs, theTrace);
		environment.odbDates = theStore.datesForPath;
		environment.odbPathForId = theStore.pathForId;
		environment.setOdbDates = theStore.setDatesForPath;
		environment.refreshOdb = theStore.checkForOutsideChanges; //9/3/26 by CC -- what runnerWorker.js gives webserver.server
		environment.sessionId = (theMapOverrides !== undefined && theMapOverrides.sessionId !== undefined) ? theMapOverrides.sessionId : "test-session"; //9/10/26 by CC -- the linked code rule
		environment.setLinkedCode = theStore.setLinkedCode;
		environment.parseScript = function (theLines) {
			return (parse.parseOutline (parse.linesToTree (theLines)));
			};
		environment.frames.push ({vars: {}});
		return ({theStore, environment});
		}

	function statementsForText (theText) {
		const theLines = [];
		theText.split ("\n").forEach (function (theLine) {
			const withoutTabs = theLine.replace (/^\t+/, "");
			if (withoutTabs.trim ().length > 0) {
				theLines.push ({level: theLine.length - withoutTabs.length, text: withoutTabs, flComment: false});
				}
			});
		return (parse.parseOutline (parse.linesToTree (theLines)));
		}

	function runText (theOpen, theText) { //answers the value, or throws what the script threw
		return (evaluate.evaluate (statementsForText (theText), theOpen.environment));
		}

	function valueOf (theOpen, theText) { //answers the value, or the error's message as text -- for tests that just compare
		try {
			return (runText (theOpen, theText));
			}
		catch (err) {
			return ("ERROR: " + err.message);
			}
		}

//the reporting

	var theSection = "";

	function section (theTitle) {
		theSection = theTitle;
		console.log ("");
		console.log (theTitle);
		}

	function checkThat (theDescription, theAnswer, theWanted) {
		const flPassed = (JSON.stringify (theAnswer) === JSON.stringify (theWanted));
		if (flPassed) {
			ctPassed++;
			console.log ("   ok    " + theDescription);
			}
		else {
			ctFailed++;
			theFailures.push (theSection + " -- " + theDescription);
			console.log ("   FAIL  " + theDescription);
			console.log ("         wanted " + JSON.stringify (theWanted) + ", got " + JSON.stringify (theAnswer));
			}
		}

//the tests

	function testNewAndPersistence () {

		/*  DW, 8/23/26: he made workspace.importExport, made two scripts in
			it, typed code into one, quit, restarted -- and both scripts were
			gone. Then he could not make them at all. This is the floor: if a
			thing you make is not there when you come back, nothing else in
			the product matters.  */

		section ("New objects, and do they survive a restart");

		const pathDatabase = freshDatabase ("persistence");

		var theOpen = openTheDatabase (pathDatabase);
		checkThat ("new (tableType) answers the address", valueOf (theOpen, "string (new (tableType, @workspace.importExport))"), "workspace.importExport");
		checkThat ("the table is there", valueOf (theOpen, "typeOf (workspace.importExport)"), "tabl");
		checkThat ("new (scriptType) answers the address", valueOf (theOpen, "string (new (scriptType, @workspace.importExport.import))"), "workspace.importExport.import");
		checkThat ("the script is there", valueOf (theOpen, "typeOf (workspace.importExport.import)"), "scpt");
		checkThat ("and a second one", valueOf (theOpen, "string (new (scriptType, @workspace.importExport.export))"), "workspace.importExport.export");

		theOpen = openTheDatabase (pathDatabase); //the restart
		checkThat ("after a reopen, the table is still there", valueOf (theOpen, "typeOf (workspace.importExport)"), "tabl");
		checkThat ("after a reopen, import is still there", valueOf (theOpen, "typeOf (workspace.importExport.import)"), "scpt");
		checkThat ("after a reopen, export is still there", valueOf (theOpen, "typeOf (workspace.importExport.export)"), "scpt");
		}

	function testTwoConnections () {

		/*  8/23/26 by CC -- THE ONE THAT EXPLAINS 8/23. odbSql.js says in its
			own comment "One process owns this database, so nothing else can
			change a row behind the cache's back." The app runs two: the
			server opens the database at startup, and every Run spawns a
			worker that opens its own connection. So what a Run creates is
			invisible to the server for the rest of the session -- a cached
			miss is remembered forever -- which is what "nothing happens when
			i run the new verb" looks like from the outside.  */

		section ("Two connections, the way the app really runs");

		const pathDatabase = freshDatabase ("twoConnections");

		const theServer = openTheDatabase (pathDatabase); //trigger.js at startup
		checkThat ("the server looks first, and it isn't there", valueOf (theServer, "defined (workspace.importExport)"), false);

		const theWorker = openTheDatabase (pathDatabase); //the worker a Run spawns
		runText (theWorker, "new (tableType, @workspace.importExport)");
		runText (theWorker, "new (scriptType, @workspace.importExport.import)");
		checkThat ("the worker made it", valueOf (theWorker, "defined (workspace.importExport.import)"), true);

		checkThat ("the server notices another connection wrote", theServer.theStore.checkForOutsideChanges (), true);
		checkThat ("the server can see what the worker made", valueOf (theServer, "defined (workspace.importExport.import)"), true);
		checkThat ("and can read its type", valueOf (theServer, "typeOf (workspace.importExport.import)"), "scpt");
		checkThat ("and it doesn't cry wolf when nothing changed", theServer.theStore.checkForOutsideChanges (), false);
		}

	function testTwoConnectionsSameName () {

		/*  10/8/26 by CC -- COLIN'S DUPLICATE ROWS (helloFrontier issue 16), and
			DW's own user.scheduler.stats.log.overnight twice, made in the same
			millisecond on 9/17. Two threads (the worldOutline Tool's hourly
			task updating frontier.root twice at once, 10/7) each looked for a
			name, saw nothing, and inserted it; the odb table has no unique
			index on (parentid, lowername), so both rows went in, and from
			then on the table lists one name twice. The shape here: two
			connections, each with a cached miss for the name, each making it.
			The store has to end with ONE row, whichever connection made it,
			and the other connection's write has to land on that row.  */

		section ("Two connections make the same name at once");

		const pathDatabase = freshDatabase ("sameName");
		const theFirst = openTheDatabase (pathDatabase);
		const theSecond = openTheDatabase (pathDatabase);
		checkThat ("the first looks, and it isn't there", valueOf (theFirst, "defined (workspace.ccSameName)"), false);
		checkThat ("the second looks, and it isn't there", valueOf (theSecond, "defined (workspace.ccSameName)"), false);
		runText (theFirst, "new (tableType, @workspace.ccSameName); workspace.ccSameName.who = \"first\"");
		runText (theSecond, "new (tableType, @workspace.ccSameName); workspace.ccSameName.who = \"second\"");
		const sqlite3 = require (pathTool.join (__dirname, "..", "node_modules", "better-sqlite3"));
		const theDatabase = new sqlite3 (pathDatabase, {readonly: true});
		const idWorkspace = theDatabase.prepare ("select id from odb where parentid = 0 and lowername = 'workspace'").get ().id;
		checkThat ("one row named ccSameName under workspace", theDatabase.prepare ("select count (*) as ct from odb where parentid = ? and lowername = 'ccsamename'").get (idWorkspace).ct, 1);
		checkThat ("the second connection's write landed in that one table", theDatabase.prepare ("select count (*) as ct from odb where parentid = (select id from odb where parentid = ? and lowername = 'ccsamename') and lowername = 'who'").get (idWorkspace).ct, 1);
		checkThat ("a scalar made twice is one row too", (function () {
			runText (theFirst, "workspace.ccSameScalar = 1");
			runText (theSecond, "workspace.ccSameScalar = 2");
			return (theDatabase.prepare ("select count (*) as ct from odb where parentid = ? and lowername = 'ccsamescalar'").get (idWorkspace).ct);
			}) (), 1);
		checkThat ("and holds the last value written", valueOf (openTheDatabase (pathDatabase), "workspace.ccSameScalar"), 2);
		theDatabase.close ();
		}

	function testRootAddress () {

		/*  9/12/26 by CC -- two things found while DW ran rootUpdates.update.
			(1) @root^ didn't dereference: the kernel's langgetspecialtable
			translates the name root to the root table, so table.getRootAddress
			(@root) -- which asks defined (adr^) first -- works there and failed
			here with "no object with that name". (2) A launch had left two rows
			named temp under system -- NOT reproduced here in four tries (two
			connections, the server's own proxy lookup, the startup script
			headless, two real launches), so no fix rides with this test; the
			report stays on the list.  */

		section ("@root dereferences");

		const pathDatabase = freshDatabase ("rootAndRows");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("defined (@root^) is true", valueOf (theOpen, "local (a = @root); defined (a^)"), true);
		checkThat ("@root^ is a table", valueOf (theOpen, "local (a = @root); typeOf (a^)"), "tabl");
		checkThat ("and so is a stored @root read back", valueOf (theOpen, "scratchpad.ccRootAdr = @root; typeOf (scratchpad.ccRootAdr^)"), "tabl");
		const theDesktop = openTheDatabase (pathDatabase, {flCorralPaths: false}); //table.getRootAddress asks table.inGuestDatabase, which asks file.exists of the first name -- the corral refuses "root", the desktop answers false
		checkThat ("table.getRootAddress (@root) answers root", String (valueOf (theDesktop, "string (table.getRootAddress (@root))")), "root");
		checkThat ("string (@root) is root", valueOf (theOpen, "string (@root)"), "root");

		}

	function testWritingDoesNotWipe () {

		/*  8/23/26 by CC -- the second half, and the one that actually
			destroys data. installValueAtAddress in trigger.js walks the
			server's view and, for any segment it believes is missing,
			assigns an empty table over it. Standing on a stale view, that
			deletes every child the segment really has.

			The check is at the language level, where the same rule holds:
			assigning to a path must never silently empty a table that is
			already there.  */

		section ("A write must not empty a table that already has things in it");

		const pathDatabase = freshDatabase ("wipe");

		const theWorker = openTheDatabase (pathDatabase);
		runText (theWorker, "new (tableType, @workspace.importExport)");
		runText (theWorker, "new (scriptType, @workspace.importExport.import)");

		const theServer = openTheDatabase (pathDatabase);
		valueOf (theServer, "defined (workspace.importExport)"); //the server caches the miss, the way it does at startup

		/*  installValueAtAddress, copied out of trigger.js so the test runs
			the real rule: walk the server's view, and for any segment it
			believes is missing, put an empty table there.  */

		var current = theServer.theStore.odb;
		["workspace", "importExport"].forEach (function (segment) {
			if ((current [segment] === undefined) || (current [segment] === null) || (typeof current [segment] !== "object")) {
				current [segment] = {};
				}
			current = current [segment];
			});
		current ["export"] = {flOdbScript: true, scriptType: "script", lines: [{level: 0, text: "on export ()", flComment: false}]};

		const theCheck = openTheDatabase (pathDatabase); //a restart, reading the file as it now stands
		checkThat ("import survived a write next to it", valueOf (theCheck, "typeOf (workspace.importExport.import)"), "scpt");
		checkThat ("and the thing that was written is there", valueOf (theCheck, "typeOf (workspace.importExport.export)"), "scpt");
		}

	function testNamedParametersReachTheKernel () {

		/*  8/23/26 by CC -- the kernel thunk hands the JavaScript verb the
			caller's arguments in the order they were WRITTEN, names thrown
			away, and never the declared defaults. That is why
			tcp.httpReadUrl ("http://scripting.com/") went out as
			https://scripting.com:0/0 -- path landed in port, ctFollowRedirects
			landed in path -- and why all 27 scripts of system.verbs.apps.s3
			fail the same way.

			The test uses a kernel verb whose parameters are easy to read
			back, so a failure names which slot went wrong.  */

		section ("Named parameters reach a kernelized verb in declared order");

		const pathDatabase = freshDatabase ("namedParams");
		const theOpen = openTheDatabase (pathDatabase);

		/*  A kernel verb of our own, made for the test: it answers its
			arguments as a list, so the test can see exactly what arrived.  */

		theOpen.environment.verbs ["test.echoargs"] = function (args) {
			const theList = [];
			args.forEach (function (theArg) {
				theList.push ((theArg === undefined) ? "nothing" : theArg);
				});
			return (theList);
			};

		runText (theOpen, "new (tableType, @workspace.testKernel)");
		runText (theOpen, [
			"scripttext = \"on echoArgs (a=\\\"defaultA\\\", b=\\\"defaultB\\\", c=\\\"defaultC\\\")\"",
			].join ("\n"));

		const theScript = {
			flOdbScript: true,
			scriptType: "script",
			lines: [
				{level: 0, text: "on echoArgs (a=\"defaultA\", b=\"defaultB\", c=\"defaultC\")", flComment: false},
				{level: 1, text: "kernel (test.echoArgs)", flComment: false}
				]
			};
		theOpen.theStore.odb.workspace.testKernel.echoArgs = theScript;

		checkThat ("positional arguments arrive in order",
			valueOf (theOpen, "workspace.testKernel.echoArgs (\"one\", \"two\", \"three\")"),
			["one", "two", "three"]);
		checkThat ("a named argument lands in ITS parameter, not where it was written",
			valueOf (theOpen, "workspace.testKernel.echoArgs (c:\"three\")"),
			["defaultA", "defaultB", "three"]);
		checkThat ("declared defaults reach the kernel verb",
			valueOf (theOpen, "workspace.testKernel.echoArgs ()"),
			["defaultA", "defaultB", "defaultC"]);
		}

	function testAddressesUseTheSearchPath () {

		/*  8/23/26 by CC -- string.parseAddress walks from the ROOT and never
			the search path, so a name that lives in a paths table answers
			nothing when it arrives as text. Three separate failures on 8/23
			were this one defect:

			   the backup command   window.frontmost () handed op.outlineToXml
			                        an address that named nothing
			   the jump command     cmd2Click tests defined (name^), which
			                        coerces the typed text the same way
			   edit on a short name a window that saves back to the text it
			                        was opened on, which made a table called
			                        op at the root on 8/21

			@fatPages built by the language works. "fatPages" coerced from
			text does not. They have to answer the same.  */

		section ("A name in the search path resolves when it arrives as text");

		const pathDatabase = freshDatabase ("searchPath");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("the language finds it", valueOf (theOpen, "defined (fatPages.importFatFile)"), true);
		checkThat ("and so does the coerced text", valueOf (theOpen, "defined ((\"fatPages.importFatFile\")^)"), true);
		checkThat ("address () reaches it too", valueOf (theOpen, "typeOf (address (\"fatPages.importFatFile\")^)"), "scpt"); //9/8/26 by CC -- was string.parseAddress, which is the kernel's list verb now
		checkThat ("a root-level name still works", valueOf (theOpen, "defined ((\"workspace\")^)"), true);

		/*  8/29/26 by CC -- and the special table: root.suites names the top
			of the database (langgetdotparams translates root to roottable
			before anything else). The virgin startupScript's
			buildSuitesSubmenu does local (adr = @root.suites); sizeof (adr^)
			and it resolved nowhere here.  */

		checkThat ("root.suites names the top of the database", valueOf (theOpen, "local (adr = @root.suites); sizeof (adr^) > 0"), true);
		checkThat ("and reads there directly", valueOf (theOpen, "typeOf (root.system)"), "tabl");
		}

	function testOutlineToXmlOnASearchPathAddress () {

		/*  8/23/26 by CC -- the backup command, end to end, at the language
			level. His doBackup does exactly this: window.frontmost () for the
			address, then op.outlineToXml on it. With a full path it answers
			OPML; with a search-path name it said the value isn't an outline
			or a script, and he could not back anything up all morning.  */

		section ("The backup command's two lines");

		/*  8/23/26 by CC -- op.outlineToXml resolves to the UserTalk glue at
			system.verbs.builtins.op, which calls the op editor verbs, and
			those only exist inside the app. So the conversion itself cannot
			be checked here. What CAN be checked is the part that failed: the
			address window.frontmost () hands it. The rest of the backup
			command belongs in whatever drives the app, once there is one.  */

		const pathDatabase = freshDatabase ("backup");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("a full path reaches the script",
			valueOf (theOpen, "typeOf (address (\"system.verbs.builtins.tcp.httpReadUrl\")^)"), "scpt"); //9/8/26 by CC -- address (), not string.parseAddress
		checkThat ("the name a window really carries reaches the same script",
			valueOf (theOpen, "typeOf (address (\"tcp.httpReadUrl\")^)"), "scpt");

		/*  8/26/26 by CC -- DW's ruling: op.getRefCon answers the long 0 for
			a line that never had one, opgetrefconverb's own rule (opverbs.c:
			if hrefcon == nil, setlongvalue (0)). The glue's kernel branch is
			what runs, and its post-processing does line surgery on the
			kernel's output -- so the kernel half must answer the C's exact
			shape: the xml header line, then <opml version="1.1">, no
			comment, \r endings. The glue adds the comment and the 2.0
			substitutions afterward, in the app.  */

		checkThat ("op.getRefCon answers 0 through the glue",
			valueOf (theOpen, "system.verbs.builtins.op.getRefCon ()"), 0);
		checkThat ("the kernel half of outlineToXml starts with the xml header then the 1.1 opml element",
			valueOf (theOpen, "on kernelHalf (adrOutline)\n\tkernel (op.outlineToXml)\nstring.nthField (kernelHalf (@workspace.notepad), \"\\r\", 2)"), "<opml version=\"1.1\">");
		}

	function testAddressGlobalsAnswerTheAddress () {

		/*  DW, 8/23/26: "globals that deal with addresses, like edit, new,
			delete -- should return the address of the thing that was edited,
			created, deleted... esp useful if the value is a variable. also
			makes it possible when reading a sequence of one-liners to see
			that it worked."  */

		section ("Address globals answer the address");

		const pathDatabase = freshDatabase ("addressGlobals");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("new answers the address", valueOf (theOpen, "string (new (tableType, @workspace.answerTest))"), "workspace.answerTest");
		checkThat ("delete answers the address", valueOf (theOpen, "string (delete (@workspace.answerTest))"), "workspace.answerTest");
		}

	function testPackRoundTrip () {

		/*  8/23/26 by CC -- pack did not exist, so a fat page could be read
			and never written, and there was no export at all. The check that
			matters is against Frontier's OWN output: decode a fat page the
			kernel wrote, pack what came out, decode that, and the value has
			to be identical. Ours is smaller than the kernel's -- no display
			formats, no per-line refcons -- so the bytes are not compared,
			the VALUE is.  */

		section ("pack, against fat pages Frontier itself wrote");

		const frontierodb = require (pathTool.join (__dirname, "..", "frontierodb.js"));

		function plainValue (theNode) {
			if ((theNode === undefined) || (theNode === null)) {
				return (undefined);
				}
			if (theNode.type === "table") {
				const theTable = {};
				Object.keys (theNode.value).forEach (function (theName) {
					theTable [theName] = plainValue (theNode.value [theName]);
					});
				return (theTable);
				}
			if ((theNode.type === "script") || (theNode.type === "outline")) {
				return ({flOdbScript: true, scriptType: theNode.type, lines: theNode.lines});
				}
			if (theNode.type === "menubar") { //8/24/26 by CC -- menubars pack now
				return ({flOdbMenubar: true, lines: theNode.lines});
				}
			return (theNode);
			}

		function packedBytesOf (theName) {
			const theText = fs.readFileSync (pathTool.join (__dirname, theName), "latin1");
			var thePageData;
			theText.split ("\r").forEach (function (theLine) {
				if (theLine.indexOf ("#pageData ") === 0) {
					thePageData = theLine.slice ("#pageData ".length);
					}
				});
			return ((thePageData === undefined) ? undefined : Buffer.from (thePageData, "base64"));
			}

		["suites.console.fttb", "workspaceTests.fttb", "tcp.httpClient.ftsc", "scratchpad.theTable.fttb", "menus.customMenu.ftmb", "system.menus.fttb", "root.suites.fttb"].forEach (function (theName) { //8/24/26 by CC -- the menubar and the two suites the menubar refusal was blocking
			const theBytes = packedBytesOf (theName);
			if (theBytes === undefined) {
				checkThat (theName + " is here to check against", false, true);
				return;
				}
			const theFirst = plainValue (frontierodb.unpackMemoryValue (theBytes));
			const theSecond = plainValue (frontierodb.unpackMemoryValue (frontierodb.packMemoryValue (theFirst)));
			checkThat (theName + " packs and unpacks to the same value", JSON.stringify (theFirst) === JSON.stringify (theSecond), true);
			});

		/*  8/24/26 by CC -- a menubar PACKS now, the mergehandles pair the
			kernel's mepackmenustructure writes (menupack.c). Until tonight
			it was refused by name; the refusal was the right answer only
			while writing one meant losing every menu command. The check:
			a small menubar with a command key and a script survives the
			round trip with both intact.  */

		const theMenubarIn = {flOdbMenubar: true, lines: [
			{level: 0, text: "File", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "Do the thing", flExpanded: false, flComment: false, flBreakpoint: false, cmdkey: "T", script: {flOdbScript: true, scriptType: "script", lines: [
				{level: 0, text: "workspace.doTheThing ()", flExpanded: true, flComment: false, flBreakpoint: false}
				]}},
			{level: 1, text: "-", flExpanded: false, flComment: false, flBreakpoint: false}
			]};
		const theMenubarBack = frontierodb.unpackMemoryValue (frontierodb.packMemoryValue (theMenubarIn));
		checkThat ("a menubar packs and comes back a menubar", theMenubarBack.type, "menubar");
		checkThat ("the menubar keeps its lines", theMenubarBack.lines.length, 3);
		checkThat ("the command keeps its key", theMenubarBack.lines [1].cmdkey, "T");
		checkThat ("the command keeps its script", theMenubarBack.lines [1].script.lines [0].text, "workspace.doTheThing ()");
		checkThat ("the separator carries no script", theMenubarBack.lines [2].script === undefined, true);
		}

	function testStoredAddressIsStillAnAddress () {

		/*  8/23/26 by CC -- an address written into the database came back as
			{flOdbAddressText, path}, which nothing treated as an address:
			adr^ failed, typeOf said tabletype, string () said
			"[object Object]". fatPages.buildPageAtts keeps adrobject in a
			page table and dereferences it, so this is what stopped every
			export even after pack existed.  */

		section ("An address survives a trip through the database");

		const pathDatabase = freshDatabase ("storedAddress");

		var theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "scratchpad.ccStored = @workspace");

		theOpen = openTheDatabase (pathDatabase); //read it back from disk
		checkThat ("it is an address", valueOf (theOpen, "typeOf (scratchpad.ccStored)"), "addr");
		checkThat ("it reads as its path", valueOf (theOpen, "string (scratchpad.ccStored)"), "workspace");
		checkThat ("and it dereferences", valueOf (theOpen, "typeOf (scratchpad.ccStored^)"), "tabl");
		}

	function testFatPageRoundTrip () {

		/*  8/23/26 by CC -- DW's bar for the morning, end to end and through
			HIS OWN scripts: fatPages.buildPageAtts to write it and
			fatPages.importFatFile to read it back.  */

		section ("A table of scripts out to a fat page and back");

		const pathDatabase = freshDatabase ("fatPageLoop");
		const theOpen = openTheDatabase (pathDatabase);
		const pathFolder = pathTool.join (folderScratch, "files");
		if (!fs.existsSync (pathFolder)) {
			fs.mkdirSync (pathFolder, {recursive: true});
			}
		const pathPage = pathTool.join (pathFolder, "roundTrip.fttb");

		runText (theOpen, "new (tableType, @workspace.importExport)");
		theOpen.theStore.odb.workspace.importExport.import = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on import (f)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (fatPages.importFatFile (f))", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		theOpen.theStore.odb.workspace.importExport.export = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on export (adr, f)", flExpanded: true, flComment: false, flBreakpoint: false}
			]};

		/*  buildPageAtts is his; the file is written here rather than through
			file.writeWholeFile so the test doesn't need a path map.  */

		runText (theOpen, "workspace.importExport.aList = {1, \"two\", {3, 4}}"); //9/8/26 by CC -- a list rides in a fat page now
		runText (theOpen, [
			"new (tableType, @scratchpad.ccPageTable)",
			"scratchpad.ccPageTable.adrobject = @workspace.importExport",
			"scratchpad.ccPageTable.adrPageData = @workspace.importExport",
			"scratchpad.ccFatText = fatPages.buildPageAtts (@scratchpad.ccPageTable)"
			].join ("\n"));
		fs.writeFileSync (pathPage, String (runText (theOpen, "scratchpad.ccFatText")), "latin1");
		checkThat ("a fat page came out", fs.statSync (pathPage).size > 0, true);

		runText (theOpen, "delete (@workspace.importExport)");
		checkThat ("the original is gone", valueOf (theOpen, "defined (workspace.importExport)"), false);

		const theBack = openTheDatabase (pathDatabase);
		checkThat ("import answers where it landed", valueOf (theBack, "string (fatPages.importFatFile (\"Macintosh HD:ccTest:roundTrip.fttb\"))"), "workspace.importExport");

		const theCheck = openTheDatabase (pathDatabase); //a restart
		checkThat ("the table came home", valueOf (theCheck, "typeOf (workspace.importExport)"), "tabl");
		checkThat ("import came home", valueOf (theCheck, "typeOf (workspace.importExport.import)"), "scpt");
		checkThat ("export came home", valueOf (theCheck, "typeOf (workspace.importExport.export)"), "scpt");
		checkThat ("with its code intact", valueOf (theCheck, "string (workspace.importExport.import)"), "on import (f)\r\treturn (fatPages.importFatFile (f))");
		checkThat ("the list came home as a list", valueOf (theCheck, "typeOf (workspace.importExport.aList)"), "list"); //9/8/26 by CC
		checkThat ("with its items and the nested list", valueOf (theCheck, "workspace.importExport.aList [2] + string (workspace.importExport.aList [3] [2])"), "two4");
		}

	function testGlueScripts () {

		/*  8/24/26 by CC -- DW: "for things that should be in the kernel
			table, and are, and have no glue, write the glue." Every
			JavaScript verb has a script in the database now, so every name
			can be jumped to and read. This calls a few of them THROUGH the
			database scripts, so the whole chain -- name to glue to kernel
			-- stays proven.  */

		section ("Glue scripts stand in front of the kernel");

		const pathDatabase = freshDatabase ("glueChain");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("crypto.hashSHA1 answers through DW's 2009 extension and the kernel's crypt.SHA1", valueOf (theOpen, "crypto.hashSHA1 (\"abc\", true)"), "a9993e364706816aba3e25717850c26c9cd0d89d");
		checkThat ("crypto.isKernelized is true -- the extension sees system.compiler.kernel.crypt", valueOf (theOpen, "crypto.isKernelized ()"), true);
		checkThat ("crypto.hashSHA1 (s, false) answers the 20 raw bytes the S3 signer feeds its HMAC", valueOf (theOpen, "sizeOf (crypto.hashSHA1 (\"abc\", false))"), 20);
		checkThat ("crypto.hashMD5 answers through the extension too", valueOf (theOpen, "crypto.hashMD5 (\"abc\")"), "900150983cd24fb0d6963f7d28e17f72");
		checkThat ("crypto.hmac_MD5 answers the RFC 2104 vector", valueOf (theOpen, "crypto.hmac_MD5 (\"what do ya want for nothing?\", \"Jefe\")"), "750c783e6ab0b503eaa86e310a5db738");
		checkThat ("the 8/24 stand-in system.verbs.builtins.crypto is gone (his ruling: leave the extension, remove the stub)", valueOf (theOpen, "defined (system.verbs.builtins.crypto)"), false);
		checkThat ("s3.httpClient's signing line reaches the extension: crypto.hashSHA1 (data, false)", valueOf (theOpen, "typeOf (crypto.hashSHA1 (\"data\", false))"), "TEXT");
		checkThat ("sys.getUserName answers through its glue", valueOf (theOpen, "sizeOf (sys.getUserName ()) > 0"), true);
		checkThat ("clock.milliseconds answers through its glue", valueOf (theOpen, "clock.milliseconds () >= 0"), true);
		checkThat ("webserver.buildErrorPage answers through its glue", valueOf (theOpen, "webserver.buildErrorPage (\"x\", \"y\") contains \"<h1>x</h1>\""), true);
		checkThat ("a not-implemented verb still says so by name", valueOf (theOpen, "file.getLabelIndex (\"x\")").indexOf ("isn't implemented yet") >= 0, true);
		checkThat ("an invented no-op is really gone", valueOf (theOpen, "menu.installMenu (1)").indexOf ("hasn’t been defined") >= 0, true); //the message is the kernel's own now -- Lang Errors [9]
		}

	function testRootWriter () {

		/*  8/24/26 by CC -- DW's architecture ruling: the .root file is the
			disk truth and SQL is the invisible working copy. The writer
			builds the block file db.c describes; the check is the whole
			life cycle on a root Frontier itself wrote: read it, put it
			through SQL the way a guest database loads, write it back out,
			read the written file, and the values are identical.  */

		section ("The root writer -- a database Atlantis saves is a file Frontier opens");

		const frontierodb = require (pathTool.join (__dirname, "..", "frontierodb.js"));
		const odbHome = require (folderUsertalk + "odbHome.js");
		const pathDonor = pathTool.join (__dirname, "Inactive Tools", "rssCodeUpdate.root");
		if (!fs.existsSync (pathDonor)) {
			checkThat ("the donor root is here to test with", false, true);
			return;
			}
		const pathWritten = pathTool.join (folderScratch, "ccWritten.root");

		const theFirst = frontierodb.readRootFile (pathDonor);
		frontierodb.writeRootFile (pathWritten, {type: "table", value: theFirst});
		const theSecond = frontierodb.readRootFile (pathWritten);
		checkThat ("read, written, read again -- identical", JSON.stringify (theSecond) === JSON.stringify (theFirst), true);

		const pathWork = pathTool.join (folderScratch, "ccGuestWork.db");
		[pathWork, pathWork + "-wal", pathWork + "-shm"].forEach (function (thePath) {
			if (fs.existsSync (thePath)) {
				fs.unlinkSync (thePath);
				}
			});
		const theStore = odbSql.openDatabase (pathWork);
		Object.keys (theFirst).forEach (function (theName) {
			theStore.odb [theName] = odbHome.convertValue (theFirst [theName]);
			});
		function plain (theValue) {
			if ((theValue === null) || (typeof theValue !== "object")) {
				return (theValue);
				}
			if ((theValue.flOdbScript === true) || (theValue.flOdbMenubar === true) || (theValue.flWpText === true) || (theValue.flAddress === true) || (theValue.flOdbAddressText === true) || Array.isArray (theValue) || (theValue instanceof Date) || (theValue instanceof Number) || (theValue.type !== undefined)) {
				return (theValue);
				}
			const theCopy = {};
			Object.keys (theValue).forEach (function (theName) {
				if ((theName === "flOdbSqlTable") || (theName === "odbId")) {
					return;
					}
				theCopy [theName] = plain (theValue [theName]);
				});
			return (theCopy);
			}
		frontierodb.writeRootFile (pathWritten, plain (theStore.odb));
		const theThird = frontierodb.readRootFile (pathWritten);
		const shapesOf = function (theTable) {
			const theShapes = {};
			Object.keys (theTable).forEach (function (theName) {
				theShapes [theName] = odbHome.convertValue (theTable [theName]);
				});
			return (JSON.stringify (theShapes));
			};
		checkThat ("and through SQL, the whole guest life cycle, still identical", shapesOf (theThird) === shapesOf (theFirst), true);
		}

	/*  8/26/26 by CC -- testCodecastingRelease CAME OUT with the suite it
		tested. DW's ruling 8/26: the codecasting publisher is not a suite
		and does not ship with the product -- it runs on his machine as a
		guest database (rssCodeUpdate.root). suites.rssCodeUpdateSuite was
		removed from the shipping root on his "go ahead" the same day.  */

	function testParseAddress () {

		/*  9/8/26 by CC -- string.parseAddress IS THE KERNEL'S: a list of the
			address's names (stringverbs.c parseaddress, langbuildnamelist), a
			bracketed name as the string inside the brackets. DW's backup
			script used the root's own 2007 recipe -- x = string.parseAddress
			(adr); f = x [1]; file.fileFromPath (f) -- and got true where the
			Tool's file path belonged, because this name answered an address.
			And @["Macintosh HD:...:x.root"] alone read back as "(computed)".  */

		section ("string.parseAddress answers the kernel's list, and a computed name has its text");

		const pathDatabase = freshDatabase ("parseAddress");
		const theOpen = openTheDatabase (pathDatabase);
		const theToolText = "[\"Macintosh HD:Users:dave:Library:Tools:rssCodeUpdate.root\"]";

		checkThat ("a dotted path is its names", valueOf (theOpen, "string.parseAddress (\"system.verbs.builtins.tcp\")"), ["system", "verbs", "builtins", "tcp"]);
		checkThat ("an address arrives as its path", valueOf (theOpen, "string.parseAddress (@system.verbs.builtins.tcp) [4]"), "tcp");
		checkThat ("a Tool's address: the file path is the first name, the 2007 recipe", valueOf (theOpen, "local (x = string.parseAddress (address ('" + theToolText + ".a.b'))); file.fileFromPath (x [1]) + \"|\" + x [2] + \"|\" + sizeOf (x)"), "rssCodeUpdate.root|a|3");
		checkThat ("a bare bracketed name is one name", valueOf (theOpen, "sizeOf (string.parseAddress (address ('" + theToolText + "')))"), 1);
		checkThat ("an empty string is a syntax error, the kernel's words", valueOf (theOpen, "try {string.parseAddress (\"\"); \"no error\"} else {tryError}"), "Can't parse the address because of a syntax error.");
		checkThat ("a bracket that never closes is a syntax error, not a loop that never ends", valueOf (theOpen, "try {string.parseAddress (\"scratchpad.[abc\"); \"no error\"} else {tryError}"), "Can't parse the address because of a syntax error."); //9/21/26 by CC -- THE SERVER DIED ON THIS: the Manila site's RSS feed led here, the walk never moved past the bracket, the list of names grew until V8 gave up ("Fatal JavaScript invalid size error") and took the whole process with it
		checkThat ("a quoted name with a bracket inside it is one name", valueOf (theOpen, "local (l = string.parseAddress (\"scratchpad.[\\\"a]b\\\"].c\")); l [1] + \"|\" + l [2] + \"|\" + l [3] + \"|\" + sizeOf (l)"), "scratchpad|a]b|c|3");
		checkThat ("@[\"a file path\"] alone reads back as its bracketed, quoted text", valueOf (theOpen, "string (@[\"Macintosh HD:tmp:x.root\"])"), "[\"Macintosh HD:tmp:x.root\"]");
		checkThat ("and with names after it", valueOf (theOpen, "local (f = \"Macintosh HD:tmp:x.root\"); string (@[f].a.b)"), "[\"Macintosh HD:tmp:x.root\"].a.b");
		checkThat ("a computed name that is an identifier stands bare", valueOf (theOpen, "string (@[\"scratchpad\"])"), "scratchpad");
		checkThat ("the text round-trips through address ()", valueOf (theOpen, "string (address (string (@[\"Macintosh HD:tmp:x.root\"].a)))"), "[\"Macintosh HD:tmp:x.root\"].a");
		checkThat ("and parseAddress of it gives the path back whole", valueOf (theOpen, "string.parseAddress (@[\"Macintosh HD:tmp:x.root\"].a) [1]"), "Macintosh HD:tmp:x.root");
		}

	function testPlusEquals () {

		/*  9/8/26 by CC -- DW's ask, "i would like a += operator... i've wanted
			that for 30 years." The kernel has none (langscan.c takes ++ after
			a plus and nothing else), so this is UserTalk beyond Frontier, his
			go. x += y is x = x + y, the target an lvalue the way = takes one.  */

		section ("The += operator");

		const pathDatabase = freshDatabase ("plusEquals");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("a local number", valueOf (theOpen, "local (x = 1); x += 2; x"), 3);
		checkThat ("a string, the way + joins them", valueOf (theOpen, "local (s = \"ab\"); s += \"cd\"; s"), "abcd");
		checkThat ("a table entry", valueOf (theOpen, "scratchpad.ccCount = 5; scratchpad.ccCount += 10; scratchpad.ccCount"), 15);
		checkThat ("through an address", valueOf (theOpen, "local (adr = @scratchpad.ccCount); adr^ += 1; scratchpad.ccCount"), 16);
		checkThat ("in a loop, on its own line", valueOf (theOpen, "local (total = 0, i)\nfor i = 1 to 4\n\ttotal += i\ntotal"), 10);
		checkThat ("++ still works beside it", valueOf (theOpen, "local (n = 1); n++; n"), 2);
		}

	function testCompiledCodeRule () {

		section ("A script runs its last compiled code until Compile -- autosave is not Compile");

		/*  9/10/26 by CC -- DW's rule, 9/9: "a script runs its last COMPILED
			code until Compile; autosave is not the same thing as compile."
			The kernel: langgetnodecode runs the code linked to the script and
			compiles the text only when nothing is linked; a window's edits
			don't unlink. Here the script window's autosave keeps the row's
			linked code (trigger.js handleUploadObject), which this section
			plays by hand; any other write of the value unlinks (odbSql.js
			updateChild), a new object. The server session stamps the link:
			another session compiles the text, the kernel's launch.  */

		const pathDatabase = freshDatabase ("compiledCode");
		const theOpen = openTheDatabase (pathDatabase);
		const theStore = theOpen.theStore;

		function scriptLines (theBody) { //on answer () over one body line
			return ([{level: 0, text: "on answer ()", flExpanded: true, flComment: false, flBreakpoint: false}, {level: 1, text: theBody, flExpanded: true, flComment: false, flBreakpoint: false}]);
			}
		valueOf (theOpen, "new (tabletype, @scratchpad.ccRule)");
		theStore.odb.scratchpad.ccRule.answer = {flOdbScript: true, scriptType: "script", lines: scriptLines ("return (1)")}; //the way an import or a fat page installs a script
		checkThat ("the script answers 1 when first called -- compiled from its text", valueOf (theOpen, "scratchpad.ccRule.answer ()"), 1);
		const theId = theStore.idForPath (["scratchpad", "ccRule", "answer"]);
		const theLinked = theStore.linkedCodeForId (theId);
		checkThat ("and the call linked what it compiled, stamped with this session", (theLinked !== undefined) && (theLinked.session === "test-session") && Array.isArray (theLinked.lines), true);

		//the window's autosave: the text changes, the linked code stays
		const editedLines = [{level: 0, text: "on answer ()", flExpanded: true, flComment: false, flBreakpoint: false}, {level: 1, text: "return (2)", flExpanded: true, flComment: false, flBreakpoint: false}];
		theStore.odb.scratchpad.ccRule.answer = {flOdbScript: true, scriptType: "script", lines: editedLines};
		theStore.setLinkedCode (theStore.idForPath (["scratchpad", "ccRule", "answer"]), theLinked);
		theOpen.environment.compiledScripts.clear ();
		checkThat ("after the window's autosave saves return (2), a call still answers 1 -- the old code runs", valueOf (theOpen, "scratchpad.ccRule.answer ()"), 1);

		//Compile: the text becomes the code
		theStore.setLinkedCode (theStore.idForPath (["scratchpad", "ccRule", "answer"]), {lines: editedLines, session: "test-session", stamp: Date.now ()});
		theOpen.environment.compiledScripts.clear ();
		checkThat ("after Compile a call answers 2", valueOf (theOpen, "scratchpad.ccRule.answer ()"), 2);

		//a half-typed line saved, the case that killed his agent
		const brokenLines = [{level: 0, text: "on answer ()", flExpanded: true, flComment: false, flBreakpoint: false}, {level: 1, text: "if not ", flExpanded: true, flComment: false, flBreakpoint: false}, {level: 1, text: "return (3)", flExpanded: true, flComment: false, flBreakpoint: false}];
		const theLinkedNow = theStore.linkedCodeForId (theStore.idForPath (["scratchpad", "ccRule", "answer"]));
		theStore.odb.scratchpad.ccRule.answer = {flOdbScript: true, scriptType: "script", lines: brokenLines};
		theStore.setLinkedCode (theStore.idForPath (["scratchpad", "ccRule", "answer"]), theLinkedNow);
		theOpen.environment.compiledScripts.clear ();
		checkThat ("a half-typed line saved by the autosave changes nothing: still 2", valueOf (theOpen, "scratchpad.ccRule.answer ()"), 2);

		//any other write is a new object: nothing linked, the text compiles
		theStore.odb.scratchpad.ccRule.answer = {flOdbScript: true, scriptType: "script", lines: scriptLines ("return (4)")};
		theOpen.environment.compiledScripts.clear ();
		checkThat ("a script installed whole (an import, a fat page, a script assigning one) is a new object and runs as written: 4", valueOf (theOpen, "scratchpad.ccRule.answer ()"), 4);

		//another session: the text
		theStore.odb.scratchpad.ccRule.answer = {flOdbScript: true, scriptType: "script", lines: editedLines};
		theStore.setLinkedCode (theStore.idForPath (["scratchpad", "ccRule", "answer"]), {lines: brokenLines, session: "test-session", stamp: Date.now ()});
		theStore.close ();
		const theSecond = openTheDatabase (pathDatabase, {sessionId: "another-session"});
		checkThat ("a new session ignores the old session's link and compiles the text: 2", valueOf (theSecond, "scratchpad.ccRule.answer ()"), 2);
		theSecond.theStore.close ();
		}

	function testMountedGuestByPath () {

		section ("A bracketed path to config.root names the mounted guest, whose root has one entry: config");

		/*  9/10/26 by CC -- the part DW imported was addressed the way Frontier
			on Berkeley writes it, ["...:apps:config.root"].config.nodeEditor. The
			shipped config.root is the 2012 file's config table mounted at
			root.config (makeVirginRoot; system.compiler.files says adr config),
			so the guest's root is a table of that one entry, and the address
			reaches config.nodeEditor. It reached nothing, and the text-to-address
			coercion the import goes through made a stray top-level table named
			by the path. Both halves here.  */

		const pathDatabase = freshDatabase ("mountedGuest");
		const theOpen = openTheDatabase (pathDatabase);
		const thePath = "Macintosh HD:Users:davewiner:Desktop:OPML:Guest Databases:apps:config.root";
		checkThat ("[\"...config.root\"].config is the shipped config: its log table is there", valueOf (theOpen, "defined ([\"" + thePath + "\"].config.log)"), true);
		checkThat ("and the guest's root has nothing else: [\"...config.root\"].log is not defined", valueOf (theOpen, "defined ([\"" + thePath + "\"].log)"), false);
		checkThat ("a table made under the bracketed path lands in config", valueOf (theOpen, "new (tabletype, @[\"" + thePath + "\"].config.ccMount); defined (config.ccMount)"), true);
		checkThat ("table.surePath of the address as text (the import's way) makes the parent tables in config -- the last name is the caller's to make", valueOf (theOpen, "table.surePath (\"[\\\"" + thePath + "\\\"].config.ccByText.deeper\"); defined (config.ccByText)"), true);
		checkThat ("an address coerced from that text writes into config", valueOf (theOpen, "local (adr = address (\"[\\\"" + thePath + "\\\"].config.ccByText.value\")); adr^ = 12; config.ccByText.value"), 12);
		var flStray = false;
		Object.keys (theOpen.theStore.odb).forEach (function (theName) {
			if (theName.indexOf (":") !== -1) {
				flStray = true;
				}
			});
		checkThat ("and no top-level table named by the path was made", flStray, false);
		//9/10/26 by CC -- found on the way: nameOf (s^) of a text address naming nothing answered the text, so surePath (1997) thought every path already existed
		checkThat ("nameOf (s^) of a text address that names nothing is empty, the kernel's namefunc", valueOf (theOpen, "local (s = \"scratchpad.ccNotThere.x\"); nameOf (s^)"), "");
		checkThat ("and of one that names something, the name", valueOf (theOpen, "local (s = \"config.log\"); nameOf (s^)"), "log");
		checkThat ("so table.surePath of a plain text path makes the parent tables", valueOf (theOpen, "table.surePath (\"scratchpad.ccSure.deep\"); defined (scratchpad.ccSure)"), true);
		theOpen.theStore.close ();
		}

	function testSaveCopy () {

		/*  9/6/26 by CC -- fileMenu.saveCopy (path), his ask the morning
			rssCodeUpdate.root came in: "the verb is defined but not
			implemented." Headless there is no front window, so the copy is of
			the root, and the file it writes is one Frontier opens.  */

		section ("fileMenu.saveCopy writes the front window's database as a .root file");

		const pathDatabase = freshDatabase ("saveCopy");
		const theOpen = openTheDatabase (pathDatabase);
		const odbHome = require (folderUsertalk + "odbHome.js");
		const frontierodb = odbHome.requireFrontierOdb ();
		runText (theOpen, "scratchpad.ccList = {1, \"two\", true, {3, \"four\"}, @scratchpad.ccList}"); //9/8/26 by CC -- a list, full and nested, goes out to the .root file the kernel's way (oppacklist) and comes back as a list
		runText (theOpen, "scratchpad.ccEmptyList = {}");
		theOpen.theStore.odb.scratchpad.ccImages = {space: {type: "binary", data: "GIFabc"}}; //9/8/26 by CC -- a table holding a binary, assigned whole, the way a Tool installs: it was stored as a table of two strings (his rssCodeUpdateWebsite.#images.space)
		checkThat ("a binary inside a table assigned whole is a binary in the database", valueOf (theOpen, "typeOf (scratchpad.ccImages.space) + \"|\" + string (scratchpad.ccImages.space)"), "data|GIFabc"); //typeOf answers the kernel's four-character code
		checkThat ("the glue answers true", valueOf (theOpen, "fileMenu.saveCopy (\"Macintosh HD:ccTest:copy.root\")"), true);
		const pathCopy = pathTool.join (folderScratch, "files", "copy.root");
		checkThat ("and the file is there", fs.existsSync (pathCopy), true);
		const theCopy = frontierodb.readRootFile (pathCopy);
		checkThat ("it opens as a root with the database's own top-level names", (theCopy.system !== undefined) && (theCopy.workspace !== undefined) && (theCopy.user !== undefined), true);
		checkThat ("and nothing keyed by a path rode along", Object.keys (theCopy).some (function (theName) { return (theName.indexOf (":") !== -1); }), false);
		checkThat ("a script survived the trip", odbHome.convertValue (theCopy.system.value.verbs.value.builtins.value.tcp.value.httpReadUrl).flOdbScript, true);
		checkThat ("the copy carries Frontier's type and creator, TABL and LAND -- what table.inGuestDatabase asks for", valueOf (theOpen, "file.type (\"Macintosh HD:ccTest:copy.root\") + file.creator (\"Macintosh HD:ccTest:copy.root\")"), "TABLLAND"); //9/7/26 by CC -- file.type answered "" for every file before tonight
		const theListBack = odbHome.convertValue (theCopy.scratchpad.value.ccList); //9/8/26 by CC -- list packing
		checkThat ("a list survived the trip as a list, not a marker", Array.isArray (theListBack), true);
		checkThat ("with its items", Array.isArray (theListBack) && (theListBack.length === 5) && (theListBack [0] === 1) && (theListBack [1] === "two") && (theListBack [2] === true), true);
		checkThat ("a nested list too", Array.isArray (theListBack) && Array.isArray (theListBack [3]) && (theListBack [3] [1] === "four"), true);
		checkThat ("and an address in it is an address", Array.isArray (theListBack) && (theListBack [4].flOdbAddressText === true) && (theListBack [4].path === "scratchpad.ccList"), true);
		checkThat ("an empty list is an empty list", Array.isArray (odbHome.convertValue (theCopy.scratchpad.value.ccEmptyList)) && (odbHome.convertValue (theCopy.scratchpad.value.ccEmptyList).length === 0), true);
		checkThat ("and the binary went out to the .root file as a binary", (theCopy.scratchpad.value.ccImages.value.space.type === "binary") && (theCopy.scratchpad.value.ccImages.value.space.data === "GIFabc"), true); //9/8/26 by CC
		}

	function testWriteWholeFileCharacters () {

		/*  9/20/26 by CC -- HIS REPORT: an OPML file Atlantis wrote would not
			open in Electric Drummer, invalid XML. A string here is a run of
			bytes, the way Frontier's is, and file.writeWholeFile wrote one byte
			per character -- so a character that can't be a byte (a curly
			quote typed in an outline window, U+2019) lost its high half and
			went out as a control character, an ellipsis as a bare ampersand,
			a bullet as a straight quote. His ruling, the narrow safe step: a
			string holding such a character can only be text, and goes out as
			UTF-8; every other string goes out exactly as before, byte for
			byte, so a GIF or a fat page is untouched.  */

		section ("file.writeWholeFile -- a character that can't be a byte goes out as UTF-8; bytes go out as bytes");

		const pathDatabase = freshDatabase ("writeWholeFileCharacters");
		const theOpen = openTheDatabase (pathDatabase);
		const folderFiles = pathTool.join (folderScratch, "files");
		fs.mkdirSync (folderFiles, {recursive: true});

		checkThat ("text with a curly apostrophe writes", valueOf (theOpen, "file.writeWholeFile (\"Macintosh HD:ccTest:curly.txt\", \"can\u2019t \u201Cquoted\u201D dots\u2026 bullet\u2022 caf\u00E9\")"), true);
		const theCurlyBytes = fs.readFileSync (pathTool.join (folderFiles, "curly.txt"));
		checkThat ("and the file is the same text, read as UTF-8", theCurlyBytes.toString ("utf8"), "can\u2019t \u201Cquoted\u201D dots\u2026 bullet\u2022 caf\u00E9");
		var flControl = false;
		theCurlyBytes.forEach (function (theByte) {
			if ((theByte < 32) && (theByte !== 9) && (theByte !== 10) && (theByte !== 13)) {
				flControl = true;
				}
			});
		checkThat ("with no control character in it", flControl, false);

		checkThat ("a string of bytes writes", valueOf (theOpen, "file.writeWholeFile (\"Macintosh HD:ccTest:bytes.bin\", \"GIF\" + char (0x89) + char (0xE9) + char (0xFF) + char (0) + char (0x19))"), true);
		checkThat ("and goes out byte for byte, as before", fs.readFileSync (pathTool.join (folderFiles, "bytes.bin")).toString ("hex"), "474946" + "89e9ff0019");

		checkThat ("plain text writes", valueOf (theOpen, "file.writeWholeFile (\"Macintosh HD:ccTest:plain.txt\", \"hello, world\")"), true);
		checkThat ("and is the same bytes as ever", fs.readFileSync (pathTool.join (folderFiles, "plain.txt")).toString ("hex"), Buffer.from ("hello, world", "latin1").toString ("hex"));
		theOpen.theStore.close ();
		}

	function testCallScriptStoredAddress () {

		/*  9/21/26 by CC -- FOUND THE FIRST HOUR OF THE MANILA WORK.
			mainResponder.callbackLoop walks a callback table: adrscript =
			@adrcallbacktable^ [i]; while typeof (adrscript^) == addresstype
			{adrscript = adrscript^}; callScript (adrscript, {}, adrparamtable).
			When the entry is an address of a script (config.mainResponder.
			callbacks.pathEvaluation.frontierAdminSite is), the while loop
			leaves adrscript holding the address AS THE DATABASE STORES IT, and
			callScript knew only a running script's address: "Can't call the
			script because the first parameter doesn't lead to a script", a
			500 on every request. The kernel's callscriptverb takes the first
			parameter as a string (getstringvalue) -- any address is its path.
			The third parameter is a table whose names are in scope for the
			called script (langrunscript's hcontext).  */

		section ("callScript takes an address read out of the database, the way mainResponder.callbackLoop hands it over");

		const pathDatabase = freshDatabase ("callScriptStoredAddress");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.scratchpad.ccGreeter = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on ccGreeter ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"hello \" + who)", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		runText (theOpen, "new (tableType, @scratchpad.ccCallbacks); scratchpad.ccCallbacks.greeter = @scratchpad.ccGreeter; new (tableType, @scratchpad.ccParams); scratchpad.ccParams.who = \"dave\"");
		theOpen.theStore.close ();
		const theReopened = openTheDatabase (pathDatabase); //so the address comes back out of the database
		const theLoop = [
			"local (adrcallbacktable = @scratchpad.ccCallbacks, adrparamtable = @scratchpad.ccParams, theAnswer = \"\")",
			"local (adrscript = @adrcallbacktable^ [1])",
			"while typeof (adrscript^) == addresstype",
			"\tadrscript = adrscript^",
			"if typeof (adrscript^) == scriptType",
			"\ttheAnswer = callScript (adrscript, {}, adrparamtable)",
			"theAnswer"
			].join ("\n");
		checkThat ("the callback loop's own lines call the script, the table's names in scope", valueOf (theReopened, theLoop), "hello dave");
		theReopened.theStore.close ();
		}

	function testBuildPageTable () {

		/*  9/21/26 by CC -- html.buildPageTable's KERNEL HALF, the second wall
			of the Manila work: "Can't call the kernel verb html.buildpagetable
			because it isn't implemented." langhtml.c, buildpagetableverb and
			additemtopagetable, which carry their UserTalk original in the
			comments: from the object's table out to the root, every item
			whose name begins with # goes into the page table under the name
			without the #, the nearest one winning; a table named prefs is
			opened up and its items added one by one; a table or an outline
			goes in as its address, anything else as its string; #ftpSite
			marks the site's root (subdirectoryPath, adrSiteRootTable); each
			table's tools and glossary ride along; a template that is a wptext
			or an outline sets indirectTemplate false, and an outline template
			goes in as a copy.  */

		section ("html.buildPageTable's kernel half gathers the # directives from the object out to the root");

		const pathDatabase = freshDatabase ("buildPageTable");
		const theOpen = openTheDatabase (pathDatabase);
		const theSetup = [
			"new (tableType, @scratchpad.ccSite)",
			"new (tableType, @scratchpad.ccSite.[\"#ftpSite\"])",
			"scratchpad.ccSite.[\"#ftpSite\"].url = \"http://example.com/\"",
			"new (tableType, @scratchpad.ccSite.[\"#prefs\"])",
			"scratchpad.ccSite.[\"#prefs\"].bgcolor = \"FFFFFF\"",
			"scratchpad.ccSite.[\"#prefs\"].maxWidth = 640",
			"scratchpad.ccSite.[\"#title\"] = \"The Site\"",
			"scratchpad.ccSite.[\"#template\"] = \"<html>{bodytext}</html>\"",
			"new (tableType, @scratchpad.ccSite.tools)",
			"new (tableType, @scratchpad.ccSite.glossary)",
			"scratchpad.ccSite.notADirective = \"stays home\"",
			"new (tableType, @scratchpad.ccSite.sub)",
			"scratchpad.ccSite.sub.[\"#title\"] = \"The Sub\"",
			"scratchpad.ccSite.sub.page = \"hello\"",
			"new (tableType, @scratchpad.ccPageTable)",
			"on kernelcall (adrObject, adrPageTable)",
			"\tkernel (html.buildpagetable)",
			"kernelcall (@scratchpad.ccSite.sub.page, @scratchpad.ccPageTable)"
			].join ("\n");
		checkThat ("the kernel call answers true", valueOf (theOpen, theSetup), true);
		checkThat ("the nearest #title wins", valueOf (theOpen, "scratchpad.ccPageTable.title"), "The Sub");
		checkThat ("a #prefs table is opened up, its items added by name", valueOf (theOpen, "scratchpad.ccPageTable.bgcolor + \"|\" + scratchpad.ccPageTable.maxWidth + \"|\" + defined (scratchpad.ccPageTable.prefs)"), "FFFFFF|640|false");
		checkThat ("a scalar goes in as its string", valueOf (theOpen, "typeOf (scratchpad.ccPageTable.maxWidth) == stringType"), true);
		checkThat ("a table goes in as its address", valueOf (theOpen, "typeOf (scratchpad.ccPageTable.ftpSite) == addressType and scratchpad.ccPageTable.ftpSite^.url == \"http://example.com/\""), true);
		checkThat ("#ftpSite marks the site's root: the path down from it", valueOf (theOpen, "scratchpad.ccPageTable.subdirectoryPath"), "sub:");
		checkThat ("and the root table's address", valueOf (theOpen, "scratchpad.ccPageTable.adrSiteRootTable == @scratchpad.ccSite"), true);
		checkThat ("tools and glossary ride along as addresses", valueOf (theOpen, "scratchpad.ccPageTable.tools == @scratchpad.ccSite.tools and scratchpad.ccPageTable.glossary == @scratchpad.ccSite.glossary"), true);
		checkThat ("a string template goes in as text and leaves indirectTemplate alone", valueOf (theOpen, "scratchpad.ccPageTable.template + \"|\" + defined (scratchpad.ccPageTable.indirectTemplate)"), "<html>{bodytext}</html>|false");
		checkThat ("an item with no # stays home", valueOf (theOpen, "defined (scratchpad.ccPageTable.notADirective)"), false);
		theOpen.theStore.close ();
		}

	function testPageTableAddress () {

		/*  9/21/26 by CC -- html.getPageTableAddress answers the address
			html.setPageTableAddress stored for THIS thread (langhtml.c,
			getpagetableaddressverb: system.temp.pageTableAddresses, the entry
			named by the current thread's id, coerced to an address). Here
			the verb looked only at an entry named "1" and only for a running
			script's address, so on the server -- where a request runs in a
			worker with an id of its own, and the address comes back out of the
			database -- it answered a scratch table, and manilaSuite.
			getSiteAddress died: "Can't get the value of adrSiteRootTable."  */

		section ("html.getPageTableAddress answers what html.setPageTableAddress stored for this thread");

		const pathDatabase = freshDatabase ("pageTableAddress");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tableType, @scratchpad.ccPt); scratchpad.ccPt.marker = \"the real one\"; html.setPageTableAddress (@scratchpad.ccPt)");
		checkThat ("the address stored is the address answered", valueOf (theOpen, "html.getPageTableAddress ()^.marker"), "the real one");
		theOpen.environment.verbs ["thread.getcurrentid"] = function () { //a worker's id
			return (4242);
			};
		runText (theOpen, "new (tableType, @scratchpad.ccPtWorker); scratchpad.ccPtWorker.marker = \"the worker's\"; html.setPageTableAddress (@scratchpad.ccPtWorker)");
		checkThat ("and a thread with an id of its own gets its own", valueOf (theOpen, "html.getPageTableAddress ()^.marker"), "the worker's");
		/*  The page table mainResponder registers is the request's param
			table, a LOCAL of the server's frame, and html.buildObject's is
			often a local too. In the kernel the address of a local is a real
			address (a table handle and a name) and stays good in any table for
			as long as the local lives. Here an address went into the database
			as its text, "paramTable", and came back leading nowhere.  */
		const theLocalWalk = [
			"local (t)",
			"new (tableType, @t)",
			"t.marker = \"a local table\"",
			"scratchpad.ccAdrOfLocal = @t",
			"local (first = scratchpad.ccAdrOfLocal^.marker)",
			"html.setPageTableAddress (@t)",
			"first + \"|\" + html.getPageTableAddress ()^.marker"
			].join ("\n");
		checkThat ("the address of a local table, stored in the database, still leads to the local while it lives", valueOf (theOpen, theLocalWalk), "a local table|a local table");
		runText (theOpen, "html.deletePageTableAddress ()");
		checkThat ("deleting takes out this thread's entry and leaves the other", valueOf (theOpen, "defined (system.temp.pageTableAddresses.[\"4242\"]) + \"|\" + defined (system.temp.pageTableAddresses.[\"1\"])"), "false|true");
		theOpen.theStore.close ();
		}

	function testRunDirectives () {

		/*  9/21/26 by CC -- html.runDirective and html.runDirectives, the third
			wall of the Manila work. langhtml.c: rundirectivesverb takes the
			linefeeds out, then walks the text a line at a time -- a line that
			begins with # is pulled out and run (htmlrundirective: the first
			word is the field name, the rest is an expression, its value goes
			into the page table; "template" sets indirectTemplate true); a
			line that doesn't is left where it is, and ends the walk when the
			directivesOnlyAtBeginning pref is true. What is left of the text is
			the answer. A directive that doesn't evaluate is the kernel's
			"Error evaluating #name: reason."  */

		section ("html.runDirectives runs the # lines into the page table and answers the rest of the text");

		const pathDatabase = freshDatabase ("runDirectives");
		const theOpen = openTheDatabase (pathDatabase);
		const theGlue = "on runDirectives (wpstring, adrpagetable)\n\tkernel (html.rundirectives)\non runDirective (linetext, adrpagetable)\n\tkernel (html.rundirective)\n";
		runText (theOpen, "new (tableType, @scratchpad.ccPt); scratchpad.ccPt.directivesOnlyAtBeginning = false");
		checkThat ("the # lines come out of the text, the rest stays, linefeeds gone", valueOf (theOpen, theGlue + "runDirectives (\"#title \\\"Hello\\\"\\r\\nfirst line\\r#count 2 + 3\\rsecond line\", @scratchpad.ccPt)"), "first line\rsecond line");
		checkThat ("each directive's expression was evaluated into the page table", valueOf (theOpen, "scratchpad.ccPt.title + \"|\" + scratchpad.ccPt.count + \"|\" + typeOf (scratchpad.ccPt.count)"), "Hello|5|long");
		runText (theOpen, "scratchpad.ccPt.directivesOnlyAtBeginning = true");
		checkThat ("with directivesOnlyAtBeginning the walk ends at the first plain line", valueOf (theOpen, theGlue + "runDirectives (\"#early 1\\rbody\\r#late 2\", @scratchpad.ccPt) + \"|\" + defined (scratchpad.ccPt.early) + \"|\" + defined (scratchpad.ccPt.late)"), "body\r#late 2|true|false");
		checkThat ("runDirective answers the directive's name, and a comment is cut off first", valueOf (theOpen, theGlue + "runDirective (\"Flavor \\\"vanilla\\\" \u00ABnot this\", @scratchpad.ccPt) + \"|\" + scratchpad.ccPt.flavor"), "flavor|vanilla");
		checkThat ("a template directive sets indirectTemplate true", valueOf (theOpen, theGlue + "runDirective (\"template \\\"plain\\\"\", @scratchpad.ccPt); scratchpad.ccPt.indirectTemplate"), true);
		checkThat ("a directive that doesn't evaluate is the kernel's error", String (valueOf (theOpen, theGlue + "runDirective (\"broken noSuchThing.atAll\", @scratchpad.ccPt)")).indexOf ("Error evaluating #broken: ") !== -1, true);
		theOpen.theStore.close ();
		}

	function testGlossaryPatcher () {

		/*  9/21/26 by CC -- html.glossaryPatcher's kernel half, the fourth wall
			of the Manila work. langhtml.c, glossarypatcherverb: every
			[[#glossPatch linetext|path|]] in the page table's renderedtext
			becomes <a href="url">linetext</a>, or just the url when there is
			no linetext. The url is one ../ for each table between the object
			and the site's root (the table that holds #ftpSite), then the path,
			then the fileExtension pref when the path has no extension and
			doesn't end in a slash. Nothing happens when the useGlossPatcher
			pref is false.  */

		section ("html.glossaryPatcher's kernel half turns each glossPatch into a relative link");

		const pathDatabase = freshDatabase ("glossaryPatcher");
		const theOpen = openTheDatabase (pathDatabase);
		const theSetup = [
			"new (tableType, @scratchpad.ccSite)",
			"new (tableType, @scratchpad.ccSite.[\"#ftpSite\"])",
			"new (tableType, @scratchpad.ccSite.sub)",
			"new (tableType, @scratchpad.ccSite.sub.deeper)",
			"scratchpad.ccSite.sub.deeper.page = \"hello\"",
			"new (tableType, @scratchpad.ccPt)",
			"scratchpad.ccPt.adrObject = @scratchpad.ccSite.sub.deeper.page",
			"scratchpad.ccPt.ftpSite = @scratchpad.ccSite.[\"#ftpSite\"]",
			"scratchpad.ccPt.fileExtension = \".html\"",
			"scratchpad.ccPt.useGlossPatcher = true",
			"scratchpad.ccPt.renderedtext = \"See [[#glossPatch the docs|docs/intro|]] and [[#glossPatch |images/logo.gif|]] and [[#glossPatch a folder|stories/|]].\"",
			"on kernelcall (adrPageTable)",
			"\tkernel (html.glossarypatcher)",
			"kernelcall (@scratchpad.ccPt)"
			].join ("\n");
		checkThat ("the kernel call answers true", valueOf (theOpen, theSetup), true);
		checkThat ("a link two tables down climbs twice, takes the extension, keeps one it has, and leaves a folder alone", valueOf (theOpen, "scratchpad.ccPt.renderedtext"), "See <a href=\"../../docs/intro.html\">the docs</a> and ../../images/logo.gif and <a href=\"../../stories/\">a folder</a>.");
		runText (theOpen, "scratchpad.ccPt.useGlossPatcher = false; scratchpad.ccPt.renderedtext = \"[[#glossPatch x|y|]]\"");
		checkThat ("with useGlossPatcher false the text is left alone", valueOf (theOpen, "on kernelcall (adrPageTable)\n\tkernel (html.glossarypatcher)\nkernelcall (@scratchpad.ccPt); scratchpad.ccPt.renderedtext"), "[[#glossPatch x|y|]]");
		theOpen.theStore.close ();
		}

	function testParentOfDottedName () {

		/*  9/21/26 by CC -- parentOf of an object whose NAME HAS A DOT IN IT.
			parentOf trimmed the object's path at its last dot, and for
			xmlRpcManilaWebsite.xml.["rss.xml"] that is the dot inside the
			name: the parent came out as xmlRpcManilaWebsite.xml.["rss -- a
			bracket that never closes, which the address parser walked
			forever, and the server died (the test above this one in
			string.parseAddress). mainResponder.members.checkMembership asks
			parentOf (adrobject^) on every request. A Manila site is full of
			such names: rss.xml, a member's mail address.  */

		section ("parentOf an object whose name has a dot in it");

		const pathDatabase = freshDatabase ("parentOfDottedName");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tableType, @scratchpad.ccDots); scratchpad.ccDots.[\"rss.xml\"] = \"the feed\"; new (tableType, @scratchpad.ccDots.[\"dave@userland.com\"]); scratchpad.ccDots.[\"dave@userland.com\"].name = \"Dave\"");
		checkThat ("by address: the table that holds it", valueOf (theOpen, "local (adrobject = @scratchpad.ccDots.[\"rss.xml\"]); parentOf (adrobject^) == @scratchpad.ccDots"), true);
		checkThat ("and its names, the way checkMembership asks", valueOf (theOpen, "local (adrobject = @scratchpad.ccDots.[\"rss.xml\"]); local (l = string.parseAddress (parentOf (adrobject^))); l [1] + \"|\" + l [2] + \"|\" + sizeOf (l)"), "scratchpad|ccDots|2");
		checkThat ("a table named by a mail address: the parent of something inside it", valueOf (theOpen, "local (adr = @scratchpad.ccDots.[\"dave@userland.com\"].name); nameOf (parentOf (adr^)^)"), "dave@userland.com");
		checkThat ("and the parent of the table itself", valueOf (theOpen, "parentOf (scratchpad.ccDots.[\"dave@userland.com\"]) == @scratchpad.ccDots"), true);
		theOpen.theStore.close ();
		}

	function testTableAssignmentCopies () {

		/*  9/21/26 by CC -- ASSIGNING A TABLE COPIES IT. Found in the Manila
			work: mainResponder.respond starts every request with
			adrparamtable^.responderAttributes = config.mainresponder.globals
			and then gathers the site's # attributes into it. Here the local
			got the database table ITSELF, so every request wrote the site it
			served into config.mainResponder.globals for good -- after one
			page that needed a member, every page of every site did. In the
			kernel a table is a value: the assignment copies, and the copy is
			the local's own.  */

		section ("Assigning a database table to a local copies it; the database's table is not touched through the copy");

		const pathDatabase = freshDatabase ("tableAssignmentCopies");
		const theOpen = openTheDatabase (pathDatabase);

		/*  10/8/26 by CC -- A TABLE WITH AN ENTRY NAMED type IS STILL A TABLE.
			The evaluator's table test said a value with a type field isn't a
			table (a binary is {type: "binary", data}), so a params table built
			the way every http glue builds one -- params.type = "text/plain" --
			couldn't be assigned to a table local: feedland.call stopped on
			params = adrparams^ with "only another table can replace a table",
			found writing feedland.uploadUserDataFile.  */

		checkThat ("a local table with an entry named type assigns to a table local", valueOf (theOpen, "local (p); new (tableType, @p); p.type = \"text/plain\"; local (q); new (tableType, @q); q = p; sizeof (q)"), 1);
		checkThat ("through an address too", valueOf (theOpen, "local (p); new (tableType, @p); p.type = \"x\"; p.other = 2; local (q); new (tableType, @q); local (adr = @p); q = adr^; sizeof (q)"), 2);
		checkThat ("and into a database table", valueOf (theOpen, "local (p); new (tableType, @p); p.type = \"x\"; new (tableType, @scratchpad.ccTyped); scratchpad.ccTyped = p; typeOf (scratchpad.ccTyped)"), "tabl");
		checkThat ("a binary is still a value, not a table", valueOf (theOpen, "local (b = binary (\"abc\")); typeOf (b)"), "data");
		const theWalk = [
			"new (tableType, @scratchpad.ccGlobals)",
			"scratchpad.ccGlobals.bgcolor = \"FFFFFF\"",
			"new (tableType, @scratchpad.ccGlobals.inner)",
			"scratchpad.ccGlobals.inner.deep = 1",
			"local (paramTable)",
			"new (tableType, @paramTable)",
			"paramTable.responderAttributes = scratchpad.ccGlobals",
			"local (adratts = @paramTable.responderAttributes)",
			"adratts^.members = \"xmlRpc\"",
			"adratts^.inner.deep = 2",
			"local (another = scratchpad.ccGlobals)",
			"another.alsoMine = true",
			"defined (scratchpad.ccGlobals.members) + \"|\" + scratchpad.ccGlobals.inner.deep + \"|\" + defined (scratchpad.ccGlobals.alsoMine) + \"|\" + adratts^.members + \"|\" + adratts^.bgcolor + \"|\" + adratts^.inner.deep + \"|\" + another.alsoMine"
			].join ("\n");
		checkThat ("the copy takes the changes, the database's table keeps its own", valueOf (theOpen, theWalk), "false|1|false|xmlRpc|FFFFFF|2|true");
		checkThat ("and the database's table is as it was", valueOf (theOpen, "sizeOf (scratchpad.ccGlobals)"), 2);
		checkThat ("a table assigned onto itself is still left alone (8/17)", valueOf (theOpen, "scratchpad.ccGlobals = scratchpad.ccGlobals; sizeOf (scratchpad.ccGlobals) + \"|\" + scratchpad.ccGlobals.inner.deep"), "2|1");
		theOpen.theStore.close ();
		}

	function testDeleteThroughAnAddress () {

		/*  9/21/26 by CC -- delete (adr), WHERE adr HOLDS AN ADDRESS, DELETES WHAT
			THE ADDRESS POINTS TO. The kernel's delete takes its parameter with
			getvarparam (langvalue.c), whose own comment is the rule: "we check
			for a valid lhs expression... we check the value at that db
			location. if it exists and is an address, we use it. otherwise, we
			use the dotparam pair as the address." Here delete (adrItem)
			deleted the LOCAL adrItem and left the object where it was --
			manilaSuite.custody.checkOut clears a timed-out lock that way, and
			its next line died on "Can't get the value of adrItem." Found when
			Edit This Page was pressed for the first time.  */

		section ("delete (adr) deletes what the address in adr points to");

		const pathDatabase = freshDatabase ("deleteThroughAnAddress");
		const theOpen = openTheDatabase (pathDatabase);
		const theWalk = [
			"new (tableType, @scratchpad.ccLocks)",
			"scratchpad.ccLocks.msg1 = \"locked\"",
			"scratchpad.ccLocks.msg2 = \"locked\"",
			"local (adrItem = @scratchpad.ccLocks.msg1)",
			"delete (adrItem)",
			"local (ccPlainLocal = 5)",
			"delete (ccPlainLocal)",
			"delete (@scratchpad.ccLocks.msg2)",
			"defined (scratchpad.ccLocks.msg1) + \"|\" + defined (adrItem) + \"|\" + defined (ccPlainLocal) + \"|\" + defined (scratchpad.ccLocks.msg2)"
			].join ("\n");
		checkThat ("the object goes, the local holding its address stays; a plain local goes; @x still works", valueOf (theOpen, theWalk), "false|true|false|false");
		runText (theOpen, "scratchpad.ccLocks.target = 1; scratchpad.ccLocks.pointer = @scratchpad.ccLocks.target");
		const theReopened = openTheDatabase (pathDatabase); //an address as the database stores it
		checkThat ("a table entry that holds an address: what it points to goes, the entry stays", valueOf (theReopened, "delete (scratchpad.ccLocks.pointer); defined (scratchpad.ccLocks.target) + \"|\" + defined (scratchpad.ccLocks.pointer)"), "false|true");
		theReopened.theStore.close ();
		theOpen.theStore.close ();
		}

	function testAddressesOfOneObjectAreEqual () {

		/*  9/21/26 by CC -- TWO ADDRESSES OF ONE OBJECT ARE EQUAL, however each
			was reached. The kernel compares the table and the name. Here two
			addresses compared by the text they were made from, so the same
			member's table reached through the site (adrSite^.["#membershipGroup"]
			.users.[key]) and through members.root (an address kept there, then
			.users.[key]) were different, and manilaSuite.custody.
			isCheckedOutByUser told the member who had just pressed Edit This
			Page that the page was "currently being edited by someone else."  */

		section ("Two addresses of one object are equal, however each was reached");

		const pathDatabase = freshDatabase ("addressesOfOneObject");
		const theOpen = openTheDatabase (pathDatabase);
		const theWalk = [
			"new (tableType, @scratchpad.ccGroup)",
			"new (tableType, @scratchpad.ccGroup.users)",
			"new (tableType, @scratchpad.ccGroup.users.[\"dave@userland.com\"])",
			"scratchpad.ccViaAddress = @scratchpad.ccGroup",
			"local (adrDirect = @scratchpad.ccGroup.users.[\"dave@userland.com\"])",
			"local (adrGroup = scratchpad.ccViaAddress)",
			"local (adrViaAddress = @adrGroup^.users.[\"dave@userland.com\"])",
			"local (adrOther = @scratchpad.ccGroup.users)",
			"local (adrViaWith, mailaddress = \"dave@userland.com\")",
			"with adrGroup^", //the way mainResponder.members.checkMembership finds the member from the cookie
			"\tadrViaWith = @users.[mailaddress]",
			"(adrDirect == adrViaAddress) + \"|\" + (adrDirect != adrViaAddress) + \"|\" + (adrDirect == adrOther) + \"|\" + (adrDirect == adrViaWith) + \"|\" + (adrViaWith == adrViaAddress)"
			].join ("\n");
		checkThat ("the same table through three routes is equal; a different one is not", valueOf (theOpen, theWalk), "true|false|false|true|true");
		theOpen.theStore.close ();
		}

	function testNeuterTags () {

		/*  9/21/26 by CC -- html.neuterTags LETS THE LEGAL TAGS THROUGH. The
			kernel's neutertags (langhtml.c) takes the text and a table of
			legal tags -- each a boolean, or a table of flLegal and flClose.
			A tag in the table is left alone; any other has its < turned into
			&lt; and nothing else is touched -- not the >, not an ampersand,
			not a quote. A legal tag that must be closed is counted, open up
			and close down, and what is still open at the end is closed. Ours
			encoded every <, >, & and quote and never looked at the table, so
			a Manila editor who saved a page got every tag on it shown as
			text -- the first edit through Edit This Page.  */

		section ("html.neuterTags leaves the legal tags alone and closes what was left open");

		const pathDatabase = freshDatabase ("neuterTags");
		const theOpen = openTheDatabase (pathDatabase);
		const theSetup = [
			"new (tableType, @scratchpad.ccLegal)",
			"scratchpad.ccLegal.b = true",
			"scratchpad.ccLegal.i = true",
			"scratchpad.ccLegal.a = true",
			"scratchpad.ccLegal.script = false",
			"new (tableType, @scratchpad.ccLegal.br)",
			"scratchpad.ccLegal.br.flLegal = true",
			"scratchpad.ccLegal.br.flClose = false",
			"on neuterTags (s, adrTable)",
			"\tkernel (html.neutertags)"
			].join ("\n") + "\n";
		checkThat ("legal tags stay, with their attributes; an illegal one loses only its <", valueOf (theOpen, theSetup + "neuterTags (\"<b>bold</b> & <a href=\\\"x.html\\\">link</a><br><script>alert (1)</script> <blink>no</blink>\", @scratchpad.ccLegal)"), "<b>bold</b> & <a href=\"x.html\">link</a><br>&lt;script>alert (1)&lt;/script> &lt;blink>no&lt;/blink>");
		checkThat ("a legal tag left open is closed at the end; the case of the tag doesn't matter", valueOf (theOpen, theSetup + "neuterTags (\"<B>bold and <i>italic\", @scratchpad.ccLegal)"), "<B>bold and <i>italic</i></b>");
		checkThat ("a < with no > after it is just a character", valueOf (theOpen, theSetup + "neuterTags (\"3 < 5 and <b>so</b>\", @scratchpad.ccLegal)"), "3 &lt; 5 and <b>so</b>");
		theOpen.theStore.close ();
		}

	function testRunOutlineDirectives () {

		/*  9/21/26 by CC -- html.runOutlineDirectives, for Manila's control panel
			(runoutlinedirectivesverb in langhtml.c, its UserTalk in the
			comments). It works on the outline it is given the address of --
			"please send us a *COPY* of your outline" -- and walks the top
			level only: a line that begins with # is run as a directive and
			taken out, subs and all; #define name and #defineScript name take
			the line's subs as a new outline or script in the page table
			under that name; a top-level comment line is taken out; every
			other line stays.  */

		section ("html.runOutlineDirectives runs the top-level # lines of an outline and takes them out");

		const pathDatabase = freshDatabase ("runOutlineDirectives");
		const theOpen = openTheDatabase (pathDatabase);
		function line (theLevel, theText, flComment) {
			return ({level: theLevel, text: theText, flExpanded: true, flComment: (flComment === true), flBreakpoint: false});
			}
		theOpen.theStore.odb.scratchpad.ccPage = {flOdbScript: true, scriptType: "outline", lines: [
			line (0, "#title \"The Page\""),
			line (0, "#define \"sidebar\""),
			line (1, "first sidebar line"),
			line (2, "under it"),
			line (1, "second sidebar line"),
			line (0, "a note to myself", true),
			line (0, "The body starts here"),
			line (1, "#notADirective stays, it isn't at the top"),
			line (0, "and ends here")
			]};
		runText (theOpen, "new (tableType, @scratchpad.ccPt)");
		const theGlue = "on runOutlineDirectives (adroutline, adrpagetable)\n\tkernel (html.runoutlinedirectives)\n";
		checkThat ("the kernel call answers true", valueOf (theOpen, theGlue + "runOutlineDirectives (@scratchpad.ccPage, @scratchpad.ccPt)"), true);
		checkThat ("the directive went into the page table", valueOf (theOpen, "scratchpad.ccPt.title"), "The Page");
		checkThat ("#define made an outline of the line's subs, under the name given, and took its own entry out", valueOf (theOpen, "typeOf (scratchpad.ccPt.sidebar) == outlineType and not defined (scratchpad.ccPt.define)"), true);
		const theSidebar = theOpen.theStore.odb.scratchpad.ccPt.sidebar;
		checkThat ("with the subs' own structure, a level up", JSON.stringify (theSidebar.lines.map (function (l) { return ([l.level, l.text]); })), JSON.stringify ([[0, "first sidebar line"], [1, "under it"], [0, "second sidebar line"]]));
		const thePage = theOpen.theStore.odb.scratchpad.ccPage;
		checkThat ("the outline keeps only its body: directives and the top-level comment are gone, a # below the top stays", JSON.stringify (thePage.lines.map (function (l) { return ([l.level, l.text]); })), JSON.stringify ([[0, "The body starts here"], [1, "#notADirective stays, it isn't at the top"], [0, "and ends here"]]));
		theOpen.theStore.close ();
		}

	function testBinaryKeepsItsType () {

		/*  9/25/26 by CC -- a binary value in Frontier is a four-byte type
			and then the bytes (langvalue.c setbinarytypeid); coercing it to
			a string strips the type (coercetostring). The reader kept the
			type inside the bytes, so string (aGif) began with "GIFf", the
			file getImageData wrote for docserver.root's logo wasn't a GIF,
			and getBinaryType answered "????" for every image out of a .root.
			The type is apart from the bytes now, on the way in, out and
			through the database.  */

		section ("A binary out of a .root keeps its four-byte type apart from its bytes");

		const frontierodb = require (pathTool.join (__dirname, "..", "frontierodb.js"));
		const pathRoot = pathTool.join (__dirname, "..", "..", "frontierOdb", "misc", "OPML Editor distrib 12:21:2012", "opml.root");
		if (!fs.existsSync (pathRoot)) {
			checkThat ("the 2012 root is here to test with", false, true);
			return;
			}
		const theTop = frontierodb.readRootFile (pathRoot);
		function findFirstBinary (theTable, thePath, depth) { //the first binary value under the table, depth-first
			var found;
			Object.keys (theTable).forEach (function (theName) {
				if (found !== undefined) {
					return;
					}
				const theValue = theTable [theName];
				if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
					return;
					}
				if (theValue.type === "binary") {
					found = {path: thePath + "." + theName, value: theValue};
					}
				else if ((theValue.type === "table") && (depth < 8)) {
					found = findFirstBinary (theValue.value, thePath + "." + theName, depth + 1);
					}
				});
			return (found);
			}
		const theBinary = findFirstBinary (theTop, "", 0);
		checkThat ("the 2012 root has a binary value in it", theBinary !== undefined, true);
		if (theBinary === undefined) {
			return;
			}
		const theType = theBinary.value.binaryType;
		checkThat ("its type is four characters, read apart from the bytes (" + theBinary.path + ", " + theType + ")", (typeof theType === "string") && (theType.length === 4) && (theType !== "????"), true);
		checkThat ("and the bytes don't begin with the type", String (theBinary.value.data).slice (0, 4) !== theType, true);

		const pathWritten = pathTool.join (folderScratch, "ccBinary.root");
		frontierodb.writeRootFile (pathWritten, {type: "table", value: {ccBin: theBinary.value}});
		const theBack = frontierodb.readRootFile (pathWritten).ccBin;
		checkThat ("written to a .root and read again, the type and the bytes are the same", (theBack.binaryType === theType) && (theBack.data === theBinary.value.data), true);

		const pathDatabase = freshDatabase ("binaryType");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.scratchpad.ccBin = theBinary.value;
		checkThat ("through the database, getBinaryType answers the type", valueOf (theOpen, "getBinaryType (scratchpad.ccBin)"), theType);
		checkThat ("and string () answers the bytes without it", valueOf (theOpen, "string.mid (string (scratchpad.ccBin), 1, 4) == \"" + theType + "\""), false);
		checkThat ("a binary made here has the ???? type, the kernel's stringtobinary stamp, and its bytes", valueOf (theOpen, "local (b = binary (\"abc\")); getBinaryType (b) + \"|\" + string (b)"), "????|abc");
		theOpen.theStore.close ();
		}

	function testBinaryBytes () {

		/*  9/26/26 by CC -- b [i] on a binary is the i-th byte as a number
			(langvalue.c parsearrayreference: stringarrayvalue, then
			coercetoint), and string.hex answers "0x" and the hex digits
			(strings.c numbertohexstring, bytestohexstring). A binary fell
			through to the table branch here, and html.getGifHeightWidth's
			f^ [9] on docserver.root's logo said "Can't get item 9 of the
			table because there are only 4 items." at the top of 18 pages.  */

		section ("b [i] on a binary is the byte as a number, and string.hex has the 0x prefix");

		const pathDatabase = freshDatabase ("binaryBytes");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("binary (\"abc\") [2] is 98", valueOf (theOpen, "local (b = binary (\"abc\")); b [2]"), 98);
		checkThat ("and it is a long, not a char", valueOf (theOpen, "local (b = binary (\"abc\")); typeOf (b [2])"), "long");
		checkThat ("past the end is an error, the kernel's arrayindexerror", String (valueOf (theOpen, "local (b = binary (\"abc\")); b [4]")).indexOf ("Can't get byte 4 of the binary because it is 3 bytes long") !== -1, true);
		checkThat ("string.hex (100) is 0x0064", valueOf (theOpen, "string.hex (100)"), "0x0064");
		checkThat ("string.hex (100000) is 0x000186A0", valueOf (theOpen, "string.hex (100000)"), "0x000186A0");
		theOpen.theStore.odb.scratchpad.ccGif = {type: "binary", binaryType: "GIFf", data: "GIF89a" + String.fromCharCode (20, 1, 10, 0) + "rest"}; //width 276 (20 + 256), height 10, little-endian, the GIF header's own order
		checkThat ("html.getGifHeightWidth on a GIF binary in the database answers {height, width}", valueOf (theOpen, "local (hw = html.getGifHeightWidth (@scratchpad.ccGif)); string (hw [1]) + \"x\" + string (hw [2])"), "10x276");
		theOpen.theStore.close ();
		}

	function testParentOfStoredAddress () {

		/*  9/25/26 by CC -- parentOf (a^) where a is an address the database
			stores. html.buildObject keeps its page table in the database
			(websites.["#data"]), so adrObject comes back out as a stored
			address, and html.getImageData's walk up from it -- nomad =
			parentOf (nomad^) -- answered nil at the first step: every
			docserver page said "Can't locate an image object". The kernel has
			one address type; the stored form is made live first now.  */

		section ("parentOf works on an address that came out of the database");

		const pathDatabase = freshDatabase ("parentOfStored");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tableType, @scratchpad.ccPo); new (tableType, @scratchpad.ccPo.inner); scratchpad.ccPo.inner.leaf = 1; scratchpad.ccPoAdr = @scratchpad.ccPo.inner.leaf");
		checkThat ("parentOf (a^) on a stored address answers the holding table", valueOf (theOpen, "local (a = scratchpad.ccPoAdr); string (parentOf (a^))"), "scratchpad.ccPo.inner");
		checkThat ("and the parent of that", valueOf (theOpen, "local (a = scratchpad.ccPoAdr); string (parentOf (parentOf (a^)^))"), "scratchpad.ccPo");
		checkThat ("a live address answers the same", valueOf (theOpen, "string (parentOf (@scratchpad.ccPo.inner.leaf))"), "scratchpad.ccPo.inner");
		checkThat ("nameOf (a^) on a stored address answers the name, not the whole address", valueOf (theOpen, "local (a = scratchpad.ccPoAdr); nameOf (a^)"), "leaf"); //9/25/26 by CC -- html.addPageToGlossary's nameOf (adrPageTable^.adrObject^)
		checkThat ("nameOf of the stored address read straight from its table", valueOf (theOpen, "nameOf (scratchpad.ccPoAdr^)"), "leaf");
		checkThat ("nameOf of the entry holding the address is a path question, the kernel's namefunc: the entry's own name", valueOf (theOpen, "nameOf (scratchpad.ccPoAdr)"), "ccPoAdr");
		checkThat ("parentOf (s^) where s is the address as text answers the parent, the way the deref coerces text", valueOf (theOpen, "local (s = \"scratchpad.ccPo.inner.leaf\"); string (parentOf (s^))"), "scratchpad.ccPo.inner"); //9/26/26 by CC -- the fire alarm: buildFileAtts's parentOf (w^) == "" on the text address the release script hands it
		checkThat ("and so buildFileAtts's file-window test is false for an object named by text", valueOf (theOpen, "local (w = \"scratchpad.ccPo.inner.leaf\"); (defined (w) && (parentOf (w^) == \"\" || parentOf (w^) == \"system.compiler.files\") && w != @root)"), false); //the text string.popFileFromAddress answers, without the verb (the gate's path map has no disk)
		checkThat ("parentOf of text that names nothing answers nil, and nil == \"\"", valueOf (theOpen, "local (s = \"scratchpad.ccNoSuch.thing\"); parentOf (s^) == \"\""), true);
		theOpen.theStore.close ();
		}

	function testGuestNamesAfterThePaths () {

		/*  9/26/26 by CC -- a Tool's top-level names are found AFTER the
			tables system.paths names, the kernel's order (langsearchpathlookup:
			the local chain, the root, the paths, then the open files). Here
			they were found with the root, ahead of the paths: docserver.root
			open as a Tool has a table named clock, and clock.timeStamp became
			docserver's page for it -- DW's 9/26 report.  */

		section ("A guest database's top-level names come after the paths");

		const pathDatabase = freshDatabase ("guestAfterPaths");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.string = {upper: {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on upper (s)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"from the guest\")", flExpanded: false, flComment: false, flBreakpoint: false}
			]}, ccOnlyHere: "guest only"};
		checkThat ("with no record of a guest, the name at the top wins, as before", valueOf (theOpen, "string.upper (\"a\")"), "from the guest");
		runText (theOpen, "if not defined (system.compiler.files.[\"ccGuest.root\"]) {new (tableType, @system.compiler.files.[\"ccGuest.root\"])}; system.compiler.files.[\"ccGuest.root\"].path = \"Macintosh HD:ccGuest.root\"; system.compiler.files.[\"ccGuest.root\"].names = {\"string\"}");
		checkThat ("once the name is a guest's, string.upper is the kernel's, found through the paths", valueOf (theOpen, "string.upper (\"a\")"), "A");
		checkThat ("a name only the guest's string has is NOT found through the paths' string -- the search takes the first table named string and looks no further, the kernel's rule", valueOf (theOpen, "defined (string.ccOnlyHere)"), false);
		checkThat ("the guest's own table is still reachable by its whole address", valueOf (theOpen, "root.string.ccOnlyHere"), "guest only");
		theOpen.theStore.close ();
		}

	function testBlockLocalWithCommas () {

		/*  9/26/26 by CC -- the block form of local, a bare local with the
			declarations on the lines under it: each line is a NAME LIST
			(langparser.y, "localtoken '{' namelist '}'"), so one line may hold
			several names separated by commas. docserver.root's dsClassList
			writes "i, localPageTable, htmltext = """ that way, and every class
			page of the site rendered as "its script doesn't parse".  */

		section ("A block-form local takes several names on one line");

		const pathDatabase = freshDatabase ("blockLocal");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.scratchpad.ccBlockLocal = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on ccBlockLocal ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "local", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 2, text: "x, y = 5", flExpanded: false, flComment: false, flBreakpoint: false},
			{level: 2, text: "s = \"a\", t = s + \"b\"", flExpanded: false, flComment: false, flBreakpoint: false},
			{level: 2, text: "z", flExpanded: false, flComment: false, flBreakpoint: false},
			{level: 2, text: "w = \"« not a comment\" « a trailing comment, cmd2Click's way", flExpanded: false, flComment: false, flBreakpoint: false},
			{level: 1, text: "x = y + 1", flExpanded: false, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (string (x) + \"|\" + t + \"|\" + string (defined (z)) + \"|\" + w)", flExpanded: false, flComment: false, flBreakpoint: false}
			]};
		checkThat ("local / x, y = 5 on one indented line declares both, a later name sees an earlier one, and a trailing comment is left off", valueOf (theOpen, "scratchpad.ccBlockLocal ()"), "6|ab|false|« not a comment");
		checkThat ("the parenthesized form still works", valueOf (theOpen, "local (a, b = 2); a = b * 3; a"), 6);
		theOpen.theStore.close ();
		}

	function testEntityEncodeByCodePoint () {

		/*  9/26/26 by CC -- xml.entityEncode kernelized with the glue's rule:
			every character past 127 a numeric reference, always; with the
			second parameter true, & first and then < > " by name. A character
			that isn't one byte -- an emoji -- is two JavaScript characters,
			and the glue wrote a reference for each half (55357, 56911), which
			XML rejects: DW's 9/26 report on his Mastodon and Bluesky feeds.  */

		section ("xml.entityEncode writes one reference per character, by code point");

		const pathDatabase = freshDatabase ("entityEncode");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.system.verbs.builtins.xml.entityEncode = {flOdbScript: true, scriptType: "script", lines: [ //the kernelized glue, misc/system.verbs.builtins.xml.entityEncode.ftsc; frontier.root's is still the 2010 UserTalk until he releases the part
			{level: 0, text: "on entityEncode (s, flAlphaEntities = false)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "kernel (xml.entityEncode)", flExpanded: false, flComment: false, flBreakpoint: false}
			]};
		checkThat ("an emoji is one reference, its code point", valueOf (theOpen, "xml.entityEncode (\"party 🎉 time\", true)"), "party &#127881; time");
		checkThat ("an accented letter is its reference", valueOf (theOpen, "xml.entityEncode (\"café\", true)"), "caf&#233;");
		checkThat ("with the flag true, & < > and \" become their names, & first", valueOf (theOpen, "xml.entityEncode (\"a & b <c> \\\"d\\\"\", true)"), "a &amp; b &lt;c&gt; &quot;d&quot;");
		checkThat ("with the flag false, only the numeric references are made", valueOf (theOpen, "xml.entityEncode (\"a & b <c> café\", false)"), "a & b <c> caf&#233;");
		theOpen.theStore.close ();
		}

	function glueLines (theHeader, theKernelName) { //a two-line kernel glue script, the shape the database's own glue has
		return ({flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: theHeader, flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "kernel (" + theKernelName + ")", flExpanded: false, flComment: false, flBreakpoint: false}
			]});
		}

	function testNewStringVerbs () {

		/*  9/26/26 by CC -- DW's asks of 9/26: string.getRandomSnarkySlogan ()
			("it calls the utils.js function of the same name and returns the
			result", daveutils), and the Markdown verbs by his names,
			string.markdownToHtml and string.htmlToMarkdown, on the packages
			wpIdentity uses, marked and turndown. The glue is installed here
			the way the parts install it; frontier.root gets it when he
			releases them.  */

		section ("string.getRandomSnarkySlogan, string.markdownToHtml and string.htmlToMarkdown");

		const pathDatabase = freshDatabase ("newStringVerbs");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.system.verbs.builtins.string.getRandomSnarkySlogan = glueLines ("on getRandomSnarkySlogan (flReturnArray = false)", "string.getRandomSnarkySlogan");
		theOpen.theStore.odb.system.verbs.builtins.string.markdownToHtml = glueLines ("on markdownToHtml (s)", "string.markdownToHtml");
		theOpen.theStore.odb.system.verbs.builtins.string.htmlToMarkdown = glueLines ("on htmlToMarkdown (s)", "string.htmlToMarkdown");
		const theSlogans = require ("daveutils").getRandomSnarkySlogan (true);
		const oneSlogan = valueOf (theOpen, "string.getRandomSnarkySlogan ()");
		checkThat ("string.getRandomSnarkySlogan () answers one of daveutils' slogans (" + oneSlogan + ")", theSlogans.indexOf (oneSlogan) !== -1, true);
		checkThat ("with true it answers the whole list, " + theSlogans.length + " of them", valueOf (theOpen, "sizeOf (string.getRandomSnarkySlogan (true))"), theSlogans.length);
		checkThat ("string.markdownToHtml renders bold and a paragraph", valueOf (theOpen, "string.markdownToHtml (\"Hello **world**.\")"), "<p>Hello <strong>world</strong>.</p>\n");
		checkThat ("and a link", valueOf (theOpen, "string.markdownToHtml (\"[Scripting News](http://scripting.com/)\")"), "<p><a href=\"http://scripting.com/\">Scripting News</a></p>\n");
		checkThat ("string.htmlToMarkdown de-renders bold", valueOf (theOpen, "string.htmlToMarkdown (\"<p>Hello <b>world</b>.</p>\")"), "Hello **world**.");
		checkThat ("and a link", valueOf (theOpen, "string.htmlToMarkdown (\"<a href=\\\"http://scripting.com/\\\">Scripting News</a>\")"), "[Scripting News](http://scripting.com/)");
		checkThat ("there and back", valueOf (theOpen, "string.htmlToMarkdown (string.markdownToHtml (\"A *quiet* word.\"))"), "A _quiet_ word.");
		theOpen.theStore.close ();
		}

	function testMergeOptions () {

		/*  9/26/26 by CC -- table.mergeOptions (@userOptions, @options):
			daveutils.mergeOptions over two tables, every entry the caller set
			copied over the default of the same name, an entry the defaults
			don't have added. DW's direction for bluesky.newPost: "create a
			param that's userOptions, and merge it with an options object
			private to the function... we have a function in utils.js --
			mergeOptions, that came later, use it."  */

		section ("table.mergeOptions merges the caller's options over the defaults");

		const pathDatabase = freshDatabase ("mergeOptions");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.system.verbs.builtins.table.mergeOptions = glueLines ("on mergeOptions (adrUserOptions, adrOptions)", "table.mergeOptions");
		checkThat ("a set option replaces the default, an unset one keeps it, a new one is added", valueOf (theOpen, "local (o, u); new (tableType, @o); o.a = 1; o.b = 2; new (tableType, @u); u.b = 3; u.c = 4; table.mergeOptions (@u, @o); string (o.a) + \"|\" + string (o.b) + \"|\" + string (o.c)"), "1|3|4");
		checkThat ("nil for the caller's options leaves the defaults alone", valueOf (theOpen, "local (o); new (tableType, @o); o.a = 1; table.mergeOptions (nil, @o); string (o.a)"), "1");
		checkThat ("it works on tables in the database too", valueOf (theOpen, "new (tableType, @scratchpad.ccMoDefaults); scratchpad.ccMoDefaults.image = \"\"; new (tableType, @scratchpad.ccMoUser); scratchpad.ccMoUser.image = \"x.png\"; table.mergeOptions (@scratchpad.ccMoUser, @scratchpad.ccMoDefaults); scratchpad.ccMoDefaults.image"), "x.png");
		theOpen.theStore.close ();
		}

	function testBinaryBody () {

		/*  9/26/26 by CC -- a request body that is a binary goes out as its
			bytes. tcp.httpClient hands the transport the request as text, the
			binary's bytes one character each, and the fetch wrote it as UTF-8:
			every byte past 127 became two, so a png on its way to Bluesky's
			uploadBlob arrived as garbage. The Content-Type says: an image, a
			sound, a video or an octet-stream is bytes; the rest is text.  */

		section ("a binary body is sent as its bytes");

		/*  The server runs in a process of its own: the transport does its
			work in a child (httphelper.js) and waits, and a server in this
			process could never accept while the test waits. It writes each
			body it gets to a file, with the content type.  */

		const {spawn} = require ("child_process");
		const thePort = 5393;
		const folderBodies = pathTool.join (folderScratch, "binaryBody");
		fs.mkdirSync (folderBodies, {recursive: true});
		const theServerCode = "const http = require ('http'); const fs = require ('fs'); var ct = 0; http.createServer (function (q, r) { if (q.method === 'GET') { if (q.url === '/bytes') { const b = Buffer.alloc (256); for (var i = 0; i < 256; i++) { b [i] = i; } r.writeHead (200, {'Content-Type': 'image/png'}); r.end (b); } else { r.writeHead (200, {'Content-Type': 'text/plain; charset=utf-8'}); r.end (Buffer.from ('caf\\u00e9', 'utf8')); } return; } const chunks = []; q.on ('data', function (c) { chunks.push (c); }); q.on ('end', function () { ct++; const b = Buffer.concat (chunks); fs.writeFileSync (" + JSON.stringify (folderBodies) + " + '/body' + ct + '.bin', b); fs.writeFileSync (" + JSON.stringify (folderBodies) + " + '/type' + ct + '.txt', String (q.headers ['content-type'])); r.writeHead (200, {'Content-Type': 'text/plain'}); r.end ('got ' + b.length); }); }).listen (" + thePort + ", '127.0.0.1');";
		const theServer = spawn (process.execPath, ["-e", theServerCode], {stdio: "ignore"});
		Atomics.wait (new Int32Array (new SharedArrayBuffer (4)), 0, 0, 800); //the child's time to listen
		const pathDatabase = freshDatabase ("binaryBody");
		const theOpen = openTheDatabase (pathDatabase, {flAllowNetwork: true});
		const theAnswer = valueOf (theOpen, "local (s = \"\", i); for i = 0 to 255 {s = s + char (i)}; local (r = tcp.httpClient (method:\"POST\", server:\"127.0.0.1\", port:" + thePort + ", path:\"/\", data:binary (s), datatype:\"image/png\", flMessages:false)); string.httpResultSplit (r)");
		checkThat ("the post went through and the server counted the bytes (" + theAnswer + ")", theAnswer, "got 256");
		var theBytesReceived;
		try {
			theBytesReceived = fs.readFileSync (pathTool.join (folderBodies, "body1.bin"));
			}
		catch (err) {
			}
		var flSame = (theBytesReceived !== undefined) && (theBytesReceived.length === 256);
		if (flSame) {
			for (var i = 0; i < 256; i++) {
				if (theBytesReceived [i] !== i) {
					flSame = false;
					}
				}
			}
		checkThat ("every byte from 0 to 255 arrived as itself", flSame, true);
		var theTypeReceived;
		try {
			theTypeReceived = fs.readFileSync (pathTool.join (folderBodies, "type1.txt"), "utf8");
			}
		catch (err) {
			}
		checkThat ("with the content type it was sent with", theTypeReceived, "image/png");
		const theTextAnswer = valueOf (theOpen, "local (r = tcp.httpClient (method:\"POST\", server:\"127.0.0.1\", port:" + thePort + ", path:\"/\", data:\"caf\u00e9\", datatype:\"text/plain\", flMessages:false)); string.httpResultSplit (r)");
		checkThat ("a text body is still UTF-8: caf\u00e9 is five bytes", theTextAnswer, "got 5");

		/*  9/27/26 by CC -- and the answer coming back: a picture read with
			tcp.httpReadUrl is its bytes, one character each; text is UTF-8,
			decoded. The body was decoded as UTF-8 whatever it was, and the
			picture DW's sample read from the web posted as an empty box.  */

		checkThat ("tcp.httpReadUrl of an image answers its bytes, one character each: 256 of them, each itself", valueOf (theOpen, "local (s = tcp.httpReadUrl (\"http://127.0.0.1:" + thePort + "/bytes\", flMessages:false), i, total = 0); for i = 1 to sizeOf (s) {total = total + number (s [i])}; string (sizeOf (s)) + \" \" + total"), "256 32640"); //every byte itself: the sum of 0 through 255
		checkThat ("tcp.httpReadUrl of text answers the text, decoded: caf\u00e9 is four characters", valueOf (theOpen, "local (s = tcp.httpReadUrl (\"http://127.0.0.1:" + thePort + "/text\", flMessages:false)); string (sizeOf (s)) + \" \" + s"), "4 caf\u00e9");
		theServer.kill ();
		theOpen.theStore.close ();
		}

	function testNilCompares () {

		/*  9/25/26 by CC -- EQvalue coerces nil to the other side's type
			(langvalue.c), so nil == "" and nil == 0 are true in Frontier, and
			string (nil) is "" (coercetostring on novaluetype). Here nil == ""
			was false and string (nil) was the JavaScript word undefined.
			html.refGlossary's walk up the hierarchy leans on the first.  */

		section ("nil compares the way the kernel coerces it");

		const pathDatabase = freshDatabase ("nilCompares");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("nil == \"\" is true", valueOf (theOpen, "nil == \"\""), true);
		checkThat ("\"\" == nil is true", valueOf (theOpen, "\"\" == nil"), true);
		checkThat ("nil != \"\" is false", valueOf (theOpen, "nil != \"\""), false);
		checkThat ("nil == 0 is true", valueOf (theOpen, "nil == 0"), true);
		checkThat ("nil == \"x\" is false", valueOf (theOpen, "nil == \"x\""), false);
		checkThat ("string (nil) is the empty string", valueOf (theOpen, "sizeOf (string (nil))"), 0);
		checkThat ("parentOf at the top answers nil, and nil == \"\" is what ends html.refGlossary's walk", valueOf (theOpen, "local (nomad = @scratchpad); local (newNomad = parentOf (nomad^)); newNomad == \"\""), true);
		theOpen.theStore.close ();
		}

	function testQuotedGlossaryItems () {

		/*  9/25/26 by CC -- the kernel's processmacros looks up a run of text
			in double quotes as a glossary entry (langhtml.c, case '"') and
			puts what html.refGlossary answers in its place; an entry that
			isn't there leaves the quotes alone; inside an HTML tag nothing is
			looked up. docserver.root's See Also lines are "string.replace"
			and rendered as those words in quotes.  */

		section ("Quoted text in a page is looked up in the glossary");

		const pathDatabase = freshDatabase ("quotedGlossary");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tableType, @scratchpad.ccQg); scratchpad.ccQg.page = \"the page\"; new (tableType, @scratchpad.ccQg.gloss); scratchpad.ccQg.gloss.[\"Home Page\"] = \"<a href=\\\"home\\\">Home</a>\"; new (tableType, @scratchpad.ccQgPt); scratchpad.ccQgPt.title = \"T\"; scratchpad.ccQgPt.adrObject = @scratchpad.ccQg.page; scratchpad.ccQgPt.glossary = @scratchpad.ccQg.gloss; html.setPageTableAddress (@scratchpad.ccQgPt)");
		checkThat ("a quoted glossary term is replaced by the entry", valueOf (theOpen, "html.processMacros (\"see \\\"Home Page\\\" here\", false, @scratchpad.ccQgPt)"), "see <a href=\"home\">Home</a> here");
		checkThat ("a quoted term that isn't in the glossary stays as it was", valueOf (theOpen, "html.processMacros (\"say \\\"hello\\\" now\", false, @scratchpad.ccQgPt)"), "say \"hello\" now");
		checkThat ("inside an HTML tag, quotes are attribute quotes, not a lookup", valueOf (theOpen, "html.processMacros (\"<a title=\\\"Home Page\\\">x</a>\", false, @scratchpad.ccQgPt)"), "<a title=\"Home Page\">x</a>");
		checkThat ("a backslash before the quote stops the lookup and is dropped, the kernel's case '\\\\'", valueOf (theOpen, "html.processMacros (\"see \\\\\\\"Home Page\\\\\\\" here\", false, @scratchpad.ccQgPt)"), "see \"Home Page\" here");
		checkThat ("a backslash before a brace stops the macro too", valueOf (theOpen, "html.processMacros (\"a\\\\{b}c\", false, @scratchpad.ccQgPt)"), "a{b}c");
		checkThat ("with expandGlossaryItems false nothing is looked up", valueOf (theOpen, "scratchpad.ccQgPt.expandGlossaryItems = false; html.processMacros (\"see \\\"Home Page\\\" here\", false, @scratchpad.ccQgPt)"), "see \"Home Page\" here");
		theOpen.theStore.close ();
		}

	function testTraversalSkip () {

		/*  9/25/26 by CC -- html.traversalSkip, traversalskipverb in
			langhtml.c: a site walk leaves out a name beginning with #, and
			glossary, images and tools in any case. docserver.root's release
			script asks it for every entry; the glue was kernelized in
			Frontier 6.1 and the verb was not in the library.  */

		section ("html.traversalSkip says which objects a site walk leaves out");

		const pathDatabase = freshDatabase ("traversalSkip");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tableType, @scratchpad.ccTs); scratchpad.ccTs.[\"#tools\"] = 1; scratchpad.ccTs.Glossary = 2; scratchpad.ccTs.images = 3; scratchpad.ccTs.aPage = 4");
		checkThat ("a name beginning with # is skipped", valueOf (theOpen, "html.traversalSkip (@scratchpad.ccTs.[\"#tools\"])"), true);
		checkThat ("glossary is skipped, in any case", valueOf (theOpen, "html.traversalSkip (@scratchpad.ccTs.Glossary)"), true);
		checkThat ("images is skipped", valueOf (theOpen, "html.traversalSkip (@scratchpad.ccTs.images)"), true);
		checkThat ("an ordinary page is not", valueOf (theOpen, "html.traversalSkip (@scratchpad.ccTs.aPage)"), false);
		theOpen.theStore.close ();
		}

	function testMacrosFindTheSitesTools () {

		/*  9/21/26 by CC -- A MACRO FINDS THE SITE'S OWN TOOLS. The kernel's
			htmlbuildmacrocontext (langhtml.c) runs a macro "with
			html.data.adrPageTable^, html.data.standardMacros,
			user.html.macros, toolTableAdr^" -- the table the page table's
			tools entry is the address of, the site's #tools -- and with a
			local adrPageTable. Here the tools table was not in scope, so
			Manila's control panel came up with "[Macro error: Can't call the
			script because the name drawNavigator hasn't been defined.]" where
			its navigation belongs.  */

		section ("A macro finds the scripts in the site's #tools table");

		const pathDatabase = freshDatabase ("macrosFindTools");
		const theOpen = openTheDatabase (pathDatabase);
		theOpen.theStore.odb.scratchpad.ccSiteTools = {
			drawNavigator: {flOdbScript: true, scriptType: "script", lines: [
				{level: 0, text: "on drawNavigator (theTitle)", flExpanded: true, flComment: false, flBreakpoint: false},
				{level: 1, text: "return (\"[nav: \" + theTitle + \" on \" + adrPageTable^.title + \"]\")", flExpanded: true, flComment: false, flBreakpoint: false}
				]}
			};
		runText (theOpen, "new (tableType, @scratchpad.ccPt); scratchpad.ccPt.title = \"Home\"; scratchpad.ccPt.tools = @scratchpad.ccSiteTools");
		checkThat ("a macro calls a script in the tools table, and the script has adrPageTable", valueOf (theOpen, "html.processMacros (\"<p>{drawNavigator (\\\"Sites\\\")}</p> {title}\", false, @scratchpad.ccPt)"), "<p>[nav: Sites on Home]</p> Home");
		theOpen.theStore.close ();
		}

	function testTableCopy () {

		/*  9/21/26 by CC -- table.copy (adr, adrTable) COPIES THE ENTRY INTO THE
			TABLE, UNDER ITS OWN NAME (tablecopyverb in tableverbs.c: "copy the
			indicated table entry to the given table"; hashtableassign, so one
			already there is replaced; an entry that isn't there is an error;
			on success the address of the copy). Ours put a copy of the entry
			AT the second address -- the table itself became the string.
			table.copyContents is a loop of table.copy, and
			manilaSuite.news.setMessageAttributes uses it to fill a message's
			newsItem table: on a new Manila site the first news item's newsItem
			came out a string, and creating the site stopped on "Can't access
			title because the value before the dot isn't a table."  */

		section ("table.copy copies an entry into a table, under its own name");

		const pathDatabase = freshDatabase ("tableCopy");
		const theOpen = openTheDatabase (pathDatabase);
		const theWalk = [
			"new (tableType, @scratchpad.ccFrom)",
			"scratchpad.ccFrom.title = \"hello\"",
			"new (tableType, @scratchpad.ccFrom.inner)",
			"scratchpad.ccFrom.inner.deep = 7",
			"new (tableType, @scratchpad.ccTo)",
			"scratchpad.ccTo.title = \"replace me\"",
			"local (adrCopy = table.copy (@scratchpad.ccFrom.title, @scratchpad.ccTo))",
			"table.copy (@scratchpad.ccFrom.inner, @scratchpad.ccTo)",
			"scratchpad.ccTo.inner.deep = 8", //the copy is its own
			"typeOf (scratchpad.ccTo) + \"|\" + scratchpad.ccTo.title + \"|\" + scratchpad.ccTo.inner.deep + \"|\" + scratchpad.ccFrom.inner.deep + \"|\" + (adrCopy == @scratchpad.ccTo.title)"
			].join ("\n");
		checkThat ("the table keeps being a table and gains the entries; the copy is its own; the address of the copy is answered", valueOf (theOpen, theWalk), "tabl|hello|8|7|true");
		const theContents = [
			"local (t)",
			"new (tableType, @t)",
			"t.title = \"It Worked!\"",
			"t.url = \"\"",
			"new (tableType, @scratchpad.ccMsg)",
			"new (tableType, @scratchpad.ccMsg.newsItem)",
			"table.copyContents (@t, @scratchpad.ccMsg.newsItem)",
			"typeOf (scratchpad.ccMsg.newsItem) + \"|\" + scratchpad.ccMsg.newsItem.title + \"|\" + sizeOf (scratchpad.ccMsg.newsItem)"
			].join ("\n");
		checkThat ("table.copyContents fills a table from a local one, the way setMessageAttributes does", valueOf (theOpen, theContents), "tabl|It Worked!|2");
		checkThat ("copying an entry that isn't there is an error", String (valueOf (theOpen, "table.copy (@scratchpad.ccFrom.noSuchThing, @scratchpad.ccTo)")).indexOf ("ERROR: ") === 0, true);
		theOpen.theStore.close ();
		}

	function testNewDatabaseFileIsFrontiers () {

		/*  9/21/26 by CC -- A DATABASE fileMenu.new MAKES IS FRONTIER'S FILE: type
			TABL, creator LAND. table.inGuestDatabase (1998, and 2001 for
			Carbon) asks exactly that of a file on a Mac, and isCarbon is false
			here by DW's ruling, so the type and creator are the whole test.
			fileMenu.saveCopy has set them since 9/7; fileMenu.new did not, so
			the guest database Manila makes for a new site
			(www/manilaWebsites.root) was "not a guest database":
			string.popFileFromAddress left the file path on the site's address,
			and the site tree named a place mainResponder could not find.  */

		section ("A database made by fileMenu.new is Frontier's file, and what is in it is in a guest database");

		const pathDatabase = freshDatabase ("newDatabaseFile");
		const theOpen = openTheDatabase (pathDatabase);
		fs.mkdirSync (pathTool.join (folderScratch, "files"), {recursive: true});
		if (fs.existsSync (pathTool.join (folderScratch, "files", "ccNewSites.root"))) { //left by an earlier run of this test
			fs.unlinkSync (pathTool.join (folderScratch, "files", "ccNewSites.root"));
			}
		const theWalk = [
			"local (f = \"Macintosh HD:ccTest:ccNewSites.root\")",
			"fileMenu.new (f)",
			"new (tableType, @[f].ccSiteTable)",
			"local (adr = @[f].ccSiteTable)",
			"file.type (f) + file.creator (f) + \"|\" + file.exists (f) + \"|\" + system.environment.isMac + \"|\" + table.inGuestDatabase (adr) + \"|\" + string.popFileFromAddress (adr)"
			].join ("\n");
		runText (theOpen, "system.environment.isMac = true; system.environment.isWindows = false; system.environment.isCarbon = false"); //what langstartup sets at launch on a Mac (isCarbon false is DW's ruling)
		checkThat ("TABL and LAND; in a guest database; and the address without its file is the table's name", valueOf (theOpen, theWalk), "TABLLAND|true|true|true|ccSiteTable");
		theOpen.theStore.close ();
		}

	function testNamesInOpenGuestDatabases () {

		/*  9/21/26 by CC -- A NAME AT THE TOP OF ANY OPEN DATABASE IS FOUND. The
			kernel's langsearchpathvisit (langvalue.c), after the tables in
			system.paths: "5.1b21 dmb: handle guest databases via
			filewindowtable" -- it looks in the root table of every open
			database file. That is how a Manila site kept in a guest database
			answers to its bare name: the site tree mainResponder walks says
			address="benchSiteManilaWebsite" and nothing more. Here a Tool's
			names were found (they are at the top of the database) but a
			database opened or made while running was not searched, and the
			new site's home page came back as nothing at all.  */

		section ("A name at the top of an open guest database is found by itself, after the paths");

		const pathDatabase = freshDatabase ("namesInGuests");
		const theOpen = openTheDatabase (pathDatabase);
		fs.mkdirSync (pathTool.join (folderScratch, "files"), {recursive: true});
		const theWalk = [
			"local (f = \"Macintosh HD:ccTest:ccGuestSites.root\")",
			"fileMenu.new (f)",
			"new (tableType, @[f].ccGuestSiteTable)",
			"[f].ccGuestSiteTable.greeting = \"from the guest\"",
			"local (adr = address (\"ccGuestSiteTable\"))",
			"defined (ccGuestSiteTable) + \"|\" + ccGuestSiteTable.greeting + \"|\" + defined (adr^) + \"|\" + adr^.greeting"
			].join ("\n");
		checkThat ("by its bare name, and through address (text)", valueOf (theOpen, theWalk), "true|from the guest|true|from the guest");
		runText (theOpen, "new (tableType, @scratchpad.ccShadow); scratchpad.ccGuestSiteTableNot = 1");
		checkThat ("a name that is nowhere is still nowhere", valueOf (theOpen, "defined (ccNoSuchGuestTable)"), false);
		theOpen.theStore.close ();
		}

	function testXmlAttributesAsWritten () {

		/*  9/29/26 by CC -- AN ATTRIBUTE VALUE IS THE XML'S OWN TEXT, entities
			and all. The kernel's getnexttoken (langxml.c) reads an attribute
			value straight into the atts table and decodes only pcdata; the
			decompiler (decompilespecialtable) writes attribute values as
			stored; xml.getAttributeValue copies the stored value. The glue
			decodes attributes itself: html.directory.getRawHtml does
			xml.entitydecode (adratts^.text, flAlphaEntities:true), and the
			2012 op.xmlToOutline decodes &quot; &lt; &gt; &amp; in text
			attributes. Here the compiler decoded them too, so a value was
			decoded twice: DW's 9/28 report, a build of concord.js from
			Atlantis turned every '&lt;' in the source into '<' (seven lines,
			XML_CHAR_MAP and the tag regexps), and 157 &gt; in the project's
			opml files came back bare -- that last one is op.outlineToXml,
			whose text encoder must be opxmlencodetext's (& " < >), not the
			pcdata encoder that leaves > alone.  */

		section ("xml.compile keeps attribute values as written; decompile writes them as stored; outlineToXml encodes > in a line's text");

		const pathDatabase = freshDatabase ("xmlAttributesAsWritten");
		const theOpen = openTheDatabase (pathDatabase);
		const theWalk = [
			"local (x)",
			"xml.compile (\"<a text=\\\"x &amp;lt; y &amp; z &lt; w\\\">p &amp;lt; q</a>\", @x)",
			"local (adr = xml.getAddress (@x, \"a\"))",
			"adr^.[\"/atts\"].text + \"|\" + xml.getAttributeValue (adr, \"text\") + \"|\" + adr^.[\"/pcdata\"] + \"|\" + xml.entityDecode (adr^.[\"/atts\"].text, true)"
			].join ("\n");
		checkThat ("the attribute is the XML's text, getAttributeValue the same, pcdata decoded once, and the glue's decode is the one decode", valueOf (theOpen, theWalk), "x &amp;lt; y &amp; z &lt; w|x &amp;lt; y &amp; z &lt; w|p &lt; q|x &lt; y & z < w");
		const theRoundTrip = [
			"local (x)",
			"xml.compile (\"<a text=\\\"x &amp;lt; y &amp; z &lt; w &quot;q&quot;\\\">p</a>\", @x)",
			"string.nthField (xml.decompile (@x), \"\\r\\n\", 2)"
			].join ("\n");
		checkThat ("decompile writes the attribute back byte for byte", valueOf (theOpen, theRoundTrip), "<a text=\"x &amp;lt; y &amp; z &lt; w &quot;q&quot;\">p</a>");
		const theOutline = [
			"on toOutline (xmltext, adroutline)",
			"\tkernel (op.xmlToOutline)",
			"on toXml (adrOutline)",
			"\tkernel (op.outlineToXml)",
			"toOutline (\"<?xml version=\\\"1.0\\\"?><opml version=\\\"2.0\\\"><head><title>t</title></head><body><outline text=\\\"if (a &gt; b) { s = &quot;x&quot;; t = '&amp;lt;'; }\\\" /></body></opml>\", @scratchpad.ccEntityTest)",
			"local (s = toXml (@scratchpad.ccEntityTest))",
			"local (ix = string.patternMatch (\"<outline text=\", s))",
			"string.mid (s, ix, 69)"
			].join ("\n");
		checkThat ("outlineToXml encodes & \" < and > in a line's text, the C's opxmlencodetext", valueOf (theOpen, theOutline), "<outline text=\"if (a &gt; b) { s = &quot;x&quot;; t = '&amp;lt;'; }\">");
		theOpen.theStore.close ();
		}

	function testDottedNameSkipsANonTableLocal () {

		/*  9/29/26 by CC -- THE FIRST NAME OF A DOTTED ADDRESS MUST BE A
			TABLE, and a local of that name that isn't one is passed over.
			langgetdotparams (langvalue.c) resolves the first name with
			langexternalgettable -- langgetsymbolval, then tablevaltotable,
			which fails for anything but a table -- and only then searches
			system.paths. The Add Link item in the HTML menu (9/16/2000 by DW)
			declares local (source = "", html, start, end) and then calls
			html.menu.setTagCase: on Berkeley the empty local is skipped and
			the paths find system.verbs.builtins.html; here referenceForId
			took the local and the call failed "html.menu.setTagCase hasn't
			been defined" -- DW's 9/28 report. flNeedTable (8/20) already
			carried the rule for the paths; now it holds for the frames and
			for a with too.  */

		section ("a local that isn't a table is passed over as the first name of a dotted address, the way langgetdotparams does it");

		const pathDatabase = freshDatabase ("dottedNameSkipsLocal");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("Add Link's two lines: an empty local named html, then html.menu.setTagCase", valueOf (theOpen, "local (source = \"\", html, start, end)\nlocal (beginAnchor = html.menu.setTagCase (\"<a href=\\\"\"))\nbeginAnchor"), "<a href=\"");
		checkThat ("a local that IS a table still wins", valueOf (theOpen, "local (string)\nnew (tableType, @string)\nstring.x = 5\nstring.x"), 5);
		checkThat ("a bare name still finds its local, table or not", valueOf (theOpen, "local (html = \"h\")\nhtml"), "h");
		checkThat ("and inside a with", valueOf (theOpen, "local (t)\nnew (tableType, @t)\nt.html = 3\nwith t\n\thtml.menu.setTagCase (\"b\")"), "b");
		theOpen.theStore.close ();
		}

	function testLocalsLiveInTheirBlock () {

		/*  10/4/26 by CC -- A LOCAL DECLARED IN A BUNDLE LIVES IN THAT BUNDLE,
			and a with's tables are searched before the locals outside it.
			evaluatelist (langevaluate.c): "allocate a local table for every
			level" -- a statement list that declares a local gets a symbol
			table of its own, chained inside the enclosing one, and it goes
			away with the list. evaluatewith makes a local table holding the
			with's tables and hands it to evaluatelist as hmagictable, so
			langfindsymbol (langops.c) looks in each table's own symbols and
			then its with values before stepping outward. Here every local went
			into the handler's one frame, and every with table came after
			every local: the startupScript's "run the external startup script"
			bundle declares local (f = ...frontierStartupCommands.txt), and the
			later bundle's "with user.databases [i]" found that f instead of
			the table's -- colinf's report on helloFrontier issue 5, 10/4: no
			guest database opened at startup. Never worked in Atlantis.  */

		section ("a local declared in a bundle lives in that bundle, and a with's tables come before the locals outside it (evaluatelist, evaluatewith, langfindsymbol)");

		const pathDatabase = freshDatabase ("localsLiveInTheirBlock");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("Colin's shape: a bundle's local f, then with user.databases [i] reads the table's f", valueOf (theOpen, "bundle\n\tlocal (f = \"stale\")\nlocal (t)\nnew (tableType, @t)\nnew (tableType, @t.db1)\nt.db1.f = \"fresh\"\nwith t.db1\n\tf"), "fresh");
		checkThat ("a local declared in a bundle is gone after the bundle", valueOf (theOpen, "bundle\n\tlocal (x = 1)\ntry\n\tx\nelse\n\t\"gone\""), "gone");
		checkThat ("a with's table is searched before a local declared outside the with", valueOf (theOpen, "local (f = \"outer\")\nlocal (t)\nnew (tableType, @t)\nt.f = \"inner\"\nwith t\n\tf"), "inner");
		checkThat ("a local declared inside the with still comes first", valueOf (theOpen, "local (t)\nnew (tableType, @t)\nt.f = \"table\"\nwith t\n\tlocal (f = \"mine\")\n\tf"), "mine");
		checkThat ("an assignment inside a bundle to a local declared outside it changes that local", valueOf (theOpen, "local (a = 1)\nbundle\n\ta = a + 1\na"), 2);
		checkThat ("an undeclared name assigned in a bundle with no locals of its own is the handler's", valueOf (theOpen, "bundle\n\tx = 5\nx"), 5);
		checkThat ("an undeclared name assigned inside a with is a local of the with, not an entry in its table", valueOf (theOpen, "local (t)\nnew (tableType, @t)\nwith t\n\tzork = 7\ndefined (t.zork)"), false);
		checkThat ("a local declared in a loop's body is fresh every time around", valueOf (theOpen, "local (s = \"\")\nfor i = 1 to 3\n\tlocal (x = i)\n\ts = s + x\ns"), "123");
		checkThat ("a nested handler sees a local declared in the caller's bundle, the kernel's dynamic chain within one script (langfindsymbol's refcon rule) -- rootUpdates.update's rssUpdate and maxpubdate", valueOf (theOpen, "on test ()\n\ton inner ()\n\t\tx = x + 1\n\tbundle\n\t\tlocal (x = 1)\n\t\tinner ()\n\t\treturn (x)\ntest ()"), 2);
		checkThat ("the startupScript's own two bundles, in short: the stale f is not seen by the with", valueOf (theOpen, "on test ()\n\tbundle\n\t\tlocal (fname = \"startup.txt\")\n\t\tlocal (f = \"HD:\" + fname)\n\tbundle\n\t\tlocal (dbs)\n\t\tnew (tableType, @dbs)\n\t\tnew (tableType, @dbs.one)\n\t\tdbs.one.f = \"HD:one.root\"\n\t\tlocal (i)\n\t\tfor i = 1 to sizeof (dbs)\n\t\t\twith dbs [i]\n\t\t\t\treturn (f)\ntest ()"), "HD:one.root");
		theOpen.theStore.close ();
		}

	function testADatabasesFilePathNamesItsRoot () {

		/*  10/4/26 by CC -- A DATABASE'S FILE PATH, ALONE, NAMES ITS ROOT TABLE --
			THE ROOT'S OWN FILE TOO. The kernel files every open database in
			filewindowtable under its path (langexternalregisterwindow;
			cancoon.c and cancoonwindow.c register the main root's variable as
			well), and window.frontmost answers that bracketed path for a
			window that shows a database (setwinvalue). table.getCursorAddress,
			the first thing Add Bookmark calls, says address (window.frontmost
			()) and asks whether typeOf of what it points to is a table before
			it takes the cursor's row. Here the path of an installed Tool,
			alone, pointed to nothing, and the root's own path was not known
			at all, so Add Bookmark from a database's own window bookmarked the
			database's file instead of the row: DW's 9/30 report on
			nodeEditorSuite.background, and the workspace bookmark that fails
			with "Can't open the database ...frontier.root" (10/1). Proven on a
			copy 10/1, applied 10/4 on his ok (misc/addBookmarkFix.md).  */

		section ("a database's file path, alone, names its root table -- the root's own file too");

		const pathDatabase = freshDatabase ("filePathNamesRoot");
		const theOpen = openTheDatabase (pathDatabase);
		const getRootPath = "\"[\\\"\" + Frontier.getFilePath () + \"\\\"]\"";
		checkThat ("address of the root file's own path points to the root table", valueOf (theOpen, "typeOf (address (" + getRootPath + ")^) == tableType"), true);
		checkThat ("table.getCursorAddress's question about it is answered yes", valueOf (theOpen, "local (adrobject = address (" + getRootPath + ")); (adrobject != nil) and (typeOf (adrobject^) == tabletype)"), true);
		checkThat ("a name under the root file's path is the root's own", valueOf (theOpen, "local (f = Frontier.getFilePath ()); defined ([f].system.verbs)"), true);
		checkThat ("and a value written under it lands in the root", valueOf (theOpen, "local (f = Frontier.getFilePath ()); [f].scratchpad.ccViaRootPath = 5; scratchpad.ccViaRootPath"), 5);
		valueOf (theOpen, "new (tableType, @system.compiler.files.[\"ccTool.root\"]); system.compiler.files.[\"ccTool.root\"].path = \"/tmp/ccTool.root\"; new (tableType, @root.ccToolSuite); root.ccToolSuite.x = 1; true");
		checkThat ("address of an installed Tool's file path, alone, points to a table too", valueOf (theOpen, "typeOf (address (\"[\\\"Macintosh HD:tmp:ccTool.root\\\"]\")^) == tableType"), true);
		checkThat ("and what the Tool brought in is under it, as before", valueOf (theOpen, "defined ([\"Macintosh HD:tmp:ccTool.root\"].ccToolSuite.x)"), true);
		var flStray = false;
		Object.keys (theOpen.theStore.odb).forEach (function (theName) {
			if (theName.indexOf (":") !== -1) {
				flStray = true;
				}
			});
		checkThat ("and none of it made a top-level table named by a path", flStray, false);
		theOpen.theStore.close ();
		}

	function testPackagesAndInstances () {

		/*  10/5/26 by CC -- PACKAGES, DW's 10/5 design: one script is a
			package; it exports handlers the node way, exports.init = init;
			socketClient.init (url) runs the exported handler; a handler not
			exported can't be called from outside. new userlandSamples
			.socketClient () makes an instance, a table carrying the package's
			address; a call on the instance runs the package's handler with
			this set to the instance, so the package keeps its data there,
			in the odb when the instance is. "only the functions that are
			explicitly named can be called from outside. everything else is
			internal and private." An addition to the language: the kernel's
			langgetentrypoint runs only the handler named for the script.  */

		section ("packages: exported handlers called by dotted name, new makes an instance with its own data");

		const pathDatabase = freshDatabase ("packagesAndInstances");
		const theOpen = openTheDatabase (pathDatabase);
		valueOf (theOpen, "new (scriptType, @scratchpad.socketClient)");
		theOpen.theStore.odb.scratchpad.socketClient = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on init (url)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "this^.url = url", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "this^.ct = 0", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"init \" + url)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "on send (s)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "this^.ct = this^.ct + 1", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (secret () + \" \" + s + \" \" + this^.ct)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "on secret ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"sent\")", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "on version ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"0.1\")", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.init = init", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.send = send", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.version = version", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "bundle //test code", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "init (\"x\")", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		checkThat ("the package's exported handler runs by dotted name: scratchpad.socketClient.version ()", valueOf (theOpen, "scratchpad.socketClient.version ()"), "0.1");
		checkThat ("called on the package itself, this is the script, and a handler that writes this^.url gets the kernel's error (10/7/26: it used to write onto the script value in memory)", String (valueOf (theOpen, "scratchpad.socketClient.init (\"ws://a\")")).indexOf ("Can't find a sub-table named “socketClient”.") !== -1, true); //left double quotation mark, right double quotation mark
		checkThat ("a handler the package didn't export can't be called from outside, and the error says so", String (valueOf (theOpen, "scratchpad.socketClient.secret ()")).indexOf ("doesn't export secret") !== -1, true);
		checkThat ("an exported handler calls the private one from inside", valueOf (theOpen, "local (c = new scratchpad.socketClient ())\nc.init (\"ws://b\")\nc.send (\"hi\")"), "sent hi 1");
		checkThat ("new makes an instance in a local, and the package keeps its data in it: this^.url, this^.ct", valueOf (theOpen, "local (c = new scratchpad.socketClient ())\nc.init (\"ws://b\")\nc.send (\"hi\")\nc.send (\"again\") + \" | \" + c.url + \" \" + c.ct"), "sent again 2 | ws://b 2");
		checkThat ("an instance stored in the odb keeps its data there", valueOf (theOpen, "scratchpad.c = new scratchpad.socketClient ()\nscratchpad.c.init (\"ws://c\")\nscratchpad.c.send (\"one\")\nscratchpad.c.ct"), 1);
		checkThat ("and the stored instance still carries the package's address after a reopen", (function () {
			theOpen.theStore.close ();
			const theReopen = openTheDatabase (pathDatabase);
			const theAnswer = valueOf (theReopen, "scratchpad.c.send (\"two\")\nscratchpad.c.ct");
			theReopen.theStore.close ();
			return (theAnswer);
			}) (), 2);
		const theOpenAgain = openTheDatabase (pathDatabase);
		checkThat ("two instances keep two tables", valueOf (theOpenAgain, "local (a = new scratchpad.socketClient (), b = new scratchpad.socketClient ())\na.init (\"A\")\nb.init (\"B\")\na.send (\"x\")\na.url + b.url + string (a.ct) + string (b.ct)"), "AB10");
		checkThat ("new of something that isn't a package script says so", String (valueOf (theOpenAgain, "local (c = new scratchpad.nothingHere ())")).indexOf ("no package script") !== -1, true);
		checkThat ("the verb new (tableType, @adr) is untouched", valueOf (theOpenAgain, "new (tableType, @scratchpad.ccNewTable)\ntypeOf (scratchpad.ccNewTable) == tableType"), true);
		checkThat ("a plain script keeps the kernel's rule: the handler named for the script runs", valueOf (theOpenAgain, "string.lower (\"ABC\")"), "abc");

		/*  10/6/26 by CC -- his rulings after trying 0.4.104: new X (args) calls
			the package's exported init with the arguments, this set to the
			new instance ("scratchpad.feedland = new userlandSamples.socketClient
			(url)" -- "that's the way to do it"); exports exists whenever a
			script runs; a package called by its own name says it's a package
			and names its exports (his find: helloWorld ("Dave") answered "Can't
			get the value of exports").  */

		theOpenAgain.theStore.odb.scratchpad.counter = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on init (start)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "this^.ct = start", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "on bumpcount ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "this^.ct++", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (this^.ct)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.init = init", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.bumpcount = bumpcount", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		checkThat ("new with arguments calls the package's init, this the new instance in the odb: scratchpad.a = new counter (10), then bumpcount", valueOf (theOpenAgain, "scratchpad.a = new scratchpad.counter (10)\nscratchpad.a.bumpcount ()"), 11);
		checkThat ("and in a local: local (c = new counter (100))", valueOf (theOpenAgain, "local (c = new scratchpad.counter (100))\nc.bumpcount ()\nc.bumpcount ()"), 102);

		/*  10/7/26 by CC -- the package edge from 10/6: a package called by its
			own name has this = the script, and this^.ct wrote onto the script
			value in memory with no complaint. The kernel's langgetdotparams
			raises nosuchtableerror, "Can't find a sub-table named “counter”.",
			and so does the evaluator now (throwUnlessTableBeforeDot).  */

		checkThat ("a package called by its own name: this^.ct on the script is the kernel's error, Can't find a sub-table named “counter”.", String (valueOf (theOpenAgain, "scratchpad.counter.bumpcount ()")).indexOf ("Can't find a sub-table named “counter”.") !== -1, true); //left double quotation mark, right double quotation mark
		checkThat ("and so is a dot on any script: scratchpad.counter.ct = 1", String (valueOf (theOpenAgain, "scratchpad.counter.ct = 1")).indexOf ("Can't find a sub-table named “counter”.") !== -1, true);
		checkThat ("the script itself is untouched by the attempt: it still runs as a package", valueOf (theOpenAgain, "local (c = new scratchpad.counter (5))\nc.bumpcount ()"), 6);
		checkThat ("defined on such a path answers false, the kernel's way", valueOf (theOpenAgain, "defined (scratchpad.counter.ct)"), false);
		theOpenAgain.theStore.odb.scratchpad.greeter = {flOdbScript: true, scriptType: "script", lines: [ //a package with no init
			{level: 0, text: "on greet (name)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (\"Hello \" + name)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "exports.greet = greet", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		checkThat ("new with arguments on a package that exports no init says so", String (valueOf (theOpenAgain, "scratchpad.h = new scratchpad.greeter (\"x\")")).indexOf ("doesn't export init") !== -1, true);
		checkThat ("new with no arguments and no init is fine: the instance, with its package entry", valueOf (theOpenAgain, "scratchpad.h2 = new scratchpad.greeter ()\ndefined (scratchpad.h2.package)"), true);
		checkThat ("a package called by its own name says it's a package and names its exports", String (valueOf (theOpenAgain, "scratchpad.counter ()")).indexOf ("it's a package; call one of its exports: init, bumpcount") !== -1, true);
		checkThat ("exports is there at the top level of any run, node's empty exports object", valueOf (theOpenAgain, "exports.x = 5\nexports.x"), 5);
		theOpenAgain.theStore.close ();
		}

	function testSizeOfABinary () {

		/*  9/29/26 by CC -- sizeOf OF A BINARY IS ITS NUMBER OF BYTES.
			langgetvalsize (langops.c), binaryvaluetype: gethandlesize
			(v.data.binaryvalue) - sizeof (OSType), "don't count key" -- the
			bytes, without the four-byte type in front. Here a binary fell
			through to the table count and answered 3, its own three fields,
			for six bytes and for 44,891. Found building html.getImageInfo;
			on the list at DW's word, 9/29.  */

		section ("sizeOf of a binary is its number of bytes");

		const pathDatabase = freshDatabase ("sizeOfABinary");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("six bytes", valueOf (theOpen, "sizeOf (binary (\"abcdef\"))"), 6);
		checkThat ("none", valueOf (theOpen, "sizeOf (binary (\"\"))"), 0);
		checkThat ("kept in the database and read back", valueOf (theOpen, "scratchpad.ccBits = binary (\"0123456789\"); sizeOf (scratchpad.ccBits)"), 10);
		checkThat ("a string is still its characters and a table its items", valueOf (theOpen, "local (t); new (tableType, @t); t.a = 1; t.b = 2; string (sizeOf (\"abc\")) + \"|\" + sizeOf (t)"), "3|2");
		theOpen.theStore.close ();
		}

	function testFilespecAddsAsItsPath () {

		/*  10/3/26 by CC -- A FILESPEC PLUS A STRING IS THE JOINED PATH, THE
			KERNEL'S WAY. file.filteredCopy, which file.copy runs for a folder,
			does newfolder = filespec (newfolder) and then newfolder +
			file.fileFromPath (f); the 9/17 table-meets-string check in the
			evaluator's add case took the filespec object for a table, so every
			file.copy of a folder copied all the files and then ended with
			"Can't coerce a table to a string." -- DW's buildHelloFrontier,
			10/3, "put it on the list for tonight". And file.delete on a folder
			with files in it showed the raw "ENOTEMPTY: directory not empty,
			rmdir '/Volumes/...'" in a dialog ("node interference"); the
			kernel's FSDeleteObject refuses the same way, in Frontier's words.
			Also his 10/3 report that a line holding only "}" compiles: it
			never did -- the parser refuses it; the check keeps it that way.  */

		section ("a filespec plus a string is the path; file.copy of a folder ends clean; file.delete of a full folder says why; a lone } doesn't parse");

		const pathDatabase = freshDatabase ("filespecAdds");
		const theOpen = openTheDatabase (pathDatabase);
		const folderFiles = pathTool.join (folderScratch, "files");
		["copySource", "copyDest", "copyDest2"].forEach (function (theName) { //the files folder outlives a run; a wrong result from last time must not pass this time
			fs.rmSync (pathTool.join (folderFiles, theName), {recursive: true, force: true});
			});
		fs.mkdirSync (pathTool.join (folderFiles, "copySource", "sub"), {recursive: true});
		fs.writeFileSync (pathTool.join (folderFiles, "copySource", "a.txt"), "a");
		fs.writeFileSync (pathTool.join (folderFiles, "copySource", "sub", "b.txt"), "b");

		checkThat ("filespec + string", valueOf (theOpen, "filespec (\"Macintosh HD:ccTest:\") + \"x.txt\""), "Macintosh HD:ccTest:x.txt");
		checkThat ("string + filespec", valueOf (theOpen, "\"see \" + filespec (\"Macintosh HD:ccTest:\")"), "see Macintosh HD:ccTest:");
		checkThat ("a table meeting a string is still refused", valueOf (theOpen, "local (t); new (tableType, @t); t + \"x\""), "ERROR: Can't coerce a table to a string.");
		checkThat ("file.copy of a folder ends without an error (false: the kernel's evaluatelist leaves false when a handler's last statement is an if that wasn't taken, and foldercopy's is)", typeof valueOf (theOpen, "file.copy (\"Macintosh HD:ccTest:copySource:\", \"Macintosh HD:ccTest:copyDest:\")"), "boolean");
		checkThat ("and the files are there", fs.existsSync (pathTool.join (folderFiles, "copyDest", "a.txt")) && fs.existsSync (pathTool.join (folderFiles, "copyDest", "sub", "b.txt")), true);
		checkThat ("a folder's filespec ends with the path character (10/4/26: filteredCopy's newfolder = filespec (newfolder))", valueOf (theOpen, "string (filespec (\"Macintosh HD:ccTest:copySource\"))"), "Macintosh HD:ccTest:copySource:");
		checkThat ("a file's doesn't", valueOf (theOpen, "string (filespec (\"Macintosh HD:ccTest:copySource:a.txt\"))"), "Macintosh HD:ccTest:copySource:a.txt");
		checkThat ("file.fileFromPath of a folder path keeps the colon (filefrompathverb, 2.1b3)", valueOf (theOpen, "file.fileFromPath (\"Macintosh HD:ccTest:copySource:sub:\")"), "sub:");
		checkThat ("and of a file path is the file's name", valueOf (theOpen, "file.fileFromPath (\"Macintosh HD:ccTest:copySource:sub:b.txt\")"), "b.txt");
		fs.mkdirSync (pathTool.join (folderFiles, "copyDest2", "sub"), {recursive: true}); //the destination and its subfolder already there: filteredCopy's exists branch, where 0.4.100 and the first filespec fix both went wrong
		checkThat ("file.copy of a folder into a folder that exists ends without an error", typeof valueOf (theOpen, "file.copy (\"Macintosh HD:ccTest:copySource:\", \"Macintosh HD:ccTest:copyDest2:\")"), "boolean");
		checkThat ("and the file in the subfolder is in the subfolder", fs.existsSync (pathTool.join (folderFiles, "copyDest2", "sub", "b.txt")), true);
		checkThat ("not at the wrong name beside it (copyDest2:subb.txt, 0.4.100's result)", fs.existsSync (pathTool.join (folderFiles, "copyDest2", "subb.txt")), false);
		checkThat ("file.delete of a folder with files in it", valueOf (theOpen, "file.delete (\"Macintosh HD:ccTest:copyDest:\")"), "ERROR: Can't delete Macintosh HD:ccTest:copyDest: because the folder isn't empty.");
		checkThat ("file.deleteFolder empties and deletes it", valueOf (theOpen, "file.deleteFolder (\"Macintosh HD:ccTest:copyDest:\")"), true);
		checkThat ("and it is gone", fs.existsSync (pathTool.join (folderFiles, "copyDest")), false);
		checkThat ("a line of just } doesn't parse", valueOf (theOpen, "}").startsWith ("ERROR: Can't parse the line \"}\""), true);
		theOpen.theStore.close ();
		}

	function testXmlGetValueOfAnEmptyElement () {

		/*  9/21/26 by CC -- xml.getValue OF AN EMPTY ELEMENT IS THE EMPTY STRING.
			The kernel's xml.compile (langxml.c, assignemptytag) stores an
			empty element with no attributes AS the empty string, and one with
			attributes as a table whose /pcdata is the empty string; either
			way xml.getValue answers "". Here every element compiles to a
			table, and getValue answered the table itself when it found no
			/pcdata (right for an element that holds other elements -- the 9/7
			fix for betty.rpc.client). A new Manila site's first news item has
			<url></url> and <department></department>: manilaSuite.news.
			xmlToTable got tables for both, and the home page died on "Can't
			assign to t.url because it's a table."  */

		section ("xml.getValue of an empty element is the empty string; of one that holds elements, the table");

		const pathDatabase = freshDatabase ("xmlGetValueEmpty");
		const theOpen = openTheDatabase (pathDatabase);
		const theWalk = [
			"local (x)",
			"new (tableType, @x)",
			"xml.compile (\"<newsItem><url></url><department/><flag n=\\\"2\\\"/><title>It Worked!</title><value><string>inside</string></value></newsItem>\", @x)",
			"local (adr = xml.getAddress (@x, \"newsItem\"))",
			"typeOf (xml.getValue (adr, \"url\")) + \"[\" + xml.getValue (adr, \"url\") + \"]|\" + typeOf (xml.getValue (adr, \"department\")) + \"|\" + typeOf (xml.getValue (adr, \"flag\")) + \"|\" + xml.getValue (adr, \"title\") + \"|\" + typeOf (xml.getValue (adr, \"value\"))"
			].join ("\n");
		checkThat ("empty ones are empty strings; text is text; an element of elements is its table", valueOf (theOpen, theWalk), "TEXT[]|TEXT|TEXT|It Worked!|tabl");
		theOpen.theStore.close ();
		}

	function testSaveNamedRoot () {

		/*  9/20/26 by CC -- fileMenu.saveNamedRoot (rootFileName, fdest), his
			ask: "i need a function that makes a copy of a specified root, by
			its name, and says where i want to save it." His 2016
			backupNodeEditorRoot saved the root and copied the file; here save
			does nothing and the file is the suite as installed, and saveCopy
			goes by the front window -- overnight there is none. The glue is
			his to add, so the test brings its own.  */

		section ("fileMenu.saveNamedRoot writes the database named, whatever window is in front");

		const pathDatabase = freshDatabase ("saveNamedRoot");
		const theOpen = openTheDatabase (pathDatabase);
		const odbHome = require (folderUsertalk + "odbHome.js");
		const frontierodb = odbHome.requireFrontierOdb ();
		const theGlue = "on saveNamedRoot (rootFileName, fdest)\n\tkernel (fileMenu.saveNamedRoot)\n";

		runText (theOpen, "new (tableType, @root.ccToolSuite); root.ccToolSuite.hello = \"from the tool\""); //a Tool the scanner installed: its names at the top of the database, its record in system.compiler.files
		runText (theOpen, "new (tableType, @system.compiler.files.[\"ccTool.root\"]); system.compiler.files.[\"ccTool.root\"].names = {\"ccToolSuite\"}; system.compiler.files.[\"ccTool.root\"].path = \"Macintosh HD:ccTest:Tools:ccTool.root\"");

		checkThat ("a Tool by its file name answers true", valueOf (theOpen, theGlue + "saveNamedRoot (\"ccTool.root\", \"Macintosh HD:ccTest:named:ccTool.root\")"), true);
		const pathToolCopy = pathTool.join (folderScratch, "files", "named", "ccTool.root");
		checkThat ("and the file is there, its folder made", fs.existsSync (pathToolCopy), true);
		const theToolCopy = frontierodb.readRootFile (pathToolCopy);
		checkThat ("holding the Tool's own names and nothing else", Object.keys (theToolCopy).join (","), "ccToolSuite");
		checkThat ("with what is in the database now", odbHome.convertValue (theToolCopy.ccToolSuite.value.hello), "from the tool");

		checkThat ("the full path to the Tool's file names it too", valueOf (theOpen, theGlue + "saveNamedRoot (\"Macintosh HD:ccTest:Tools:ccTool.root\", \"Macintosh HD:ccTest:named:byPath.root\")"), true);
		checkThat ("and that file is there", fs.existsSync (pathTool.join (folderScratch, "files", "named", "byPath.root")), true);

		checkThat ("frontier.root is the main root", valueOf (theOpen, theGlue + "saveNamedRoot (\"frontier.root\", \"Macintosh HD:ccTest:named:frontier.root\")"), true);
		const theRootCopy = frontierodb.readRootFile (pathTool.join (folderScratch, "files", "named", "frontier.root"));
		checkThat ("with the root's names", (theRootCopy.system !== undefined) && (theRootCopy.user !== undefined), true);
		checkThat ("and without the Tool's", theRootCopy.ccToolSuite === undefined, true);

		checkThat ("the copy carries TABL and LAND", valueOf (theOpen, "file.type (\"Macintosh HD:ccTest:named:ccTool.root\") + file.creator (\"Macintosh HD:ccTest:named:ccTool.root\")"), "TABLLAND");
		checkThat ("a name nothing answers to is an error in words", valueOf (theOpen, theGlue + "saveNamedRoot (\"noSuch.root\", \"Macintosh HD:ccTest:named:noSuch.root\")"), "ERROR: Can't save a copy of noSuch.root because no database with that name is open.");
		checkThat ("and no file is written for it", fs.existsSync (pathTool.join (folderScratch, "files", "named", "noSuch.root")), false);
		theOpen.theStore.close ();

		/*  9/20/26 by CC -- HIS FIRST RUN OF IT, on his own root: "'ownKeys' on
			proxy: trap returned duplicate entries." His database has two
			tables named overnight in user.scheduler.stats.log, both made in
			the same millisecond of 9/17 -- two connections, one database. A
			lookup by name answers the first; the list of names gave both, and
			JavaScript refuses a list with the same name twice. The list
			gives a name once now, the one a lookup answers.  */

		const pathTwins = freshDatabase ("saveNamedRootTwins");
		const sqlite3 = require (pathTool.join (__dirname, "..", "node_modules", "better-sqlite3"));
		const theOpenFirst = openTheDatabase (pathTwins);
		runText (theOpenFirst, "new (tableType, @scratchpad.ccTwins); new (tableType, @scratchpad.ccTwins.overnight); scratchpad.ccTwins.overnight.which = \"the first\"");
		theOpenFirst.theStore.close ();
		const theRaw = new sqlite3 (pathTwins);
		const theTwin = theRaw.prepare ("select parentid, name, lowername, type, value, whencreated, whenmodified from odb where lowername = 'overnight' and parentid = (select id from odb where lowername = 'cctwins');").get ();
		theRaw.prepare ("insert into odb (parentid, name, lowername, type, value, whencreated, whenmodified) values (?, ?, ?, ?, ?, ?, ?);").run (theTwin.parentid, theTwin.name, theTwin.lowername, theTwin.type, theTwin.value, theTwin.whencreated, theTwin.whenmodified);
		theRaw.close ();
		const theOpenTwins = openTheDatabase (pathTwins);
		checkThat ("a table holding two entries of one name counts it once", valueOf (theOpenTwins, "sizeOf (scratchpad.ccTwins)"), 1);
		checkThat ("and the copy of a root holding it is written", valueOf (theOpenTwins, theGlue + "saveNamedRoot (\"frontier.root\", \"Macintosh HD:ccTest:named:twins.root\")"), true);
		const theTwinsCopy = frontierodb.readRootFile (pathTool.join (folderScratch, "files", "named", "twins.root"));
		checkThat ("carrying the one a lookup by name answers", odbHome.convertValue (theTwinsCopy.scratchpad.value.ccTwins.value.overnight.value.which), "the first");
		theOpenTwins.theStore.close ();
		}

	function testS3Signing () {

		/*  9/6/26 by CC -- THE S3 SIGNATURE, his deal-stopper the afternoon
			the first codecasting part was to go out: "The request signature we
			calculated does not match the signature you provided." The s3
			suite's HMAC is UserTalk: string.nthChar on the key, bit.logicalXor
			with 0x36 and 0x5c, crypto.hashSHA1 (data, false) for the raw
			digest, base64.encode at the end. string.nthChar answered a
			one-character STRING here and a char in the kernel (langverbs.c,
			nthcharfunc: setcharvalue), so the XOR saw zero. The known answers
			below are published ones: RFC 2202's HMAC-SHA1 test, and Amazon's
			own worked example for the signing method the suite uses.  */

		section ("The S3 signature -- the suite's HMAC against published answers");

		const pathDatabase = freshDatabase ("s3signing");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("string.nthChar answers a char (typeOf)", valueOf (theOpen, "typeOf (string.nthChar (\"abc\", 2))"), "char");
		checkThat ("and past the end, the empty string, the kernel's zerostring", valueOf (theOpen, "string.nthChar (\"abc\", 9)"), "");
		checkThat ("a high byte comes through as its own value", valueOf (theOpen, "number (string.nthChar (char (200) + \"a\", 1))"), 200);
		checkThat ("bit.logicalXor on the char the suite feeds it", valueOf (theOpen, "bit.logicalXor (string.nthChar (\"k\", 1), char (0x36))"), 0x6b ^ 0x36);

		const theHmac = [
			"on hmac (data, key)",
			"\tlocal (BLOCK_SIZE=64)",
			"\ton sha1 (data)",
			"\t\treturn (crypto.hashSHA1(data, false))",
			"\tlocal(k_ipad, k_opad, i)",
			"\tif string.length (key) > BLOCK_SIZE",
			"\t\tkey = sha1 (key)",
			"\tfor i = 0 to BLOCK_SIZE-1",
			"\t\tif i < string.length(key)",
			"\t\t\tk_char = string.nthChar(key, i+1)",
			"\t\t\tk_ipad = k_ipad + char(bit.logicalXor(k_char, char(0x36)))",
			"\t\t\tk_opad = k_opad + char(bit.logicalXor(k_char, char(0x5c)))",
			"\t\telse",
			"\t\t\tk_ipad = k_ipad + char(0x36)",
			"\t\t\tk_opad = k_opad + char(0x5c)",
			"\treturn (sha1 (k_opad + sha1 (k_ipad + data)))"
			].join ("\n"); //s3.httpClient's hmac, line for line
		checkThat ("the suite's hmac on the RFC 2202 test (key, the quick brown fox)",
			valueOf (theOpen, theHmac + "\nbase64.encode (hmac (\"The quick brown fox jumps over the lazy dog\", \"key\"), 0)"), "3nybhbi3iqa8ino29wqQcBydtNk=");
		checkThat ("Amazon's worked example: the GET of photos/puppy.jpg signs to qgk2+6Sv9/oM7G3qLEjTH1a1l1g=",
			valueOf (theOpen, theHmac + "\nlocal (s = \"GET\" + \"\\n\" + \"\" + \"\\n\" + \"\" + \"\\n\" + \"Tue, 27 Mar 2007 19:36:42 +0000\" + \"\\n\" + \"/awsexamplebucket1/photos/puppy.jpg\")\nbase64.encode (hmac (s, \"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\"), 0)"), "qgk2+6Sv9/oM7G3qLEjTH1a1l1g=");
		}

	function testDatesAreDates () {

		/*  9/6/26 by CC -- HIS DEAL-STOPPER OF 9/6: the watcher stopped after
			he exported and re-imported its table. frontierodb's convertMacDate
			answered an ISO string, so every date read out of a root file or a
			fat page was a string in the database -- frontier.root had 0 rows
			of type date -- and a date beside a string compared as nothing.
			The comparisons are the kernel's (coercetypes by coercionweight:
			string 10, date 4, long 3).  */

		section ("Dates are dates -- out of a root file, through a fat page, and in a comparison");

		const pathDatabase = freshDatabase ("dates");
		const theOpen = openTheDatabase (pathDatabase);
		const frontierodb = require (pathTool.join (__dirname, "..", "frontierodb.js"));
		const pathDonor = pathTool.join (__dirname, "Inactive Tools", "rssCodeUpdate.root");
		var ctDates = 0;
		function countDates (theValue) {
			if ((theValue === null) || (typeof theValue !== "object")) {
				return;
				}
			if (theValue instanceof Date) {
				ctDates++;
				return;
				}
			if (theValue.type === "table") {
				Object.keys (theValue.value).forEach (function (theName) {
					countDates (theValue.value [theName]);
					});
				}
			}
		countDates ({type: "table", value: frontierodb.readRootFile (pathDonor)});
		checkThat ("the root reader answers Date objects for the donor's dates (a 2017 root has some)", ctDates > 0, true);

		runText (theOpen, "system.environment.isMac = true");
		runText (theOpen, "new (tabletype, @scratchpad.ccDates); scratchpad.ccDates.when = date (\"1/5/2030; 3:04:05 PM\")");
		checkThat ("a date made by date () is a date", valueOf (theOpen, "typeOf (scratchpad.ccDates.when)"), "date");
		checkThat ("it exports as a fat page", valueOf (theOpen, "export.sendObject (@scratchpad.ccDates, \"Macintosh HD:ccTest:ccDates.fttb\")"), true);
		checkThat ("and comes back as a date, not text",
			valueOf (theOpen, "delete (@scratchpad.ccDates); fatPages.importFatFile (\"Macintosh HD:ccTest:ccDates.fttb\"); typeOf (scratchpad.ccDates.when)"), "date");
		checkThat ("with the same instant", valueOf (theOpen, "string (scratchpad.ccDates.when)"), "1/5/2030; 3:04:05 PM");

		checkThat ("date > date compares the instants", valueOf (theOpen, "date (\"1/5/2030\") > date (\"9/1/2000\")"), true);
		checkThat ("date == date, two objects made separately", valueOf (theOpen, "date (\"1/5/2030; 3:04:05 PM\") == date (\"1/5/2030; 3:04:05 PM\")"), true);
		checkThat ("a date beside a string becomes its text and they compare as strings -- the kernel's coercionweight", valueOf (theOpen, "date (\"1/5/2030\") > \"9/1/2000\""), false);
		checkThat ("so a date equals its own text", valueOf (theOpen, "date (\"1/5/2030; 3:04:05 PM\") == \"1/5/2030; 3:04:05 PM\""), true);
		checkThat ("a number beside a date becomes a date, seconds since 1904", valueOf (theOpen, "clock.now () > 0"), true);
		checkThat ("string.nthChar and the rest left alone: a date beside a number the other way", valueOf (theOpen, "0 < clock.now ()"), true);
		}

	function testMoveIntoAnotherTable () {

		/*  9/6/26 by CC -- the kernel's browser moves an object into another
			table when its row is dragged there (claymovefile); the table
			window does the same through /tableedit's move, and this is the
			store's half.  */

		section ("Moving an object into another table -- the browser's drag");

		const pathDatabase = freshDatabase ("move");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tabletype, @scratchpad.ccMoveA); new (tabletype, @scratchpad.ccMoveB); scratchpad.ccMoveA.x = 1; scratchpad.ccMoveA.y = 2; scratchpad.ccMoveB.x = 9");
		var theAnswer = theOpen.theStore.moveForPath (["scratchpad", "ccMoveA", "y"], ["scratchpad", "ccMoveB"]);
		checkThat ("a value moves into the other table", theAnswer.flMoved, true);
		checkThat ("and is there", valueOf (theOpen, "scratchpad.ccMoveB.y"), 2);
		checkThat ("and gone from where it was", valueOf (theOpen, "defined (scratchpad.ccMoveA.y)"), false);
		theAnswer = theOpen.theStore.moveForPath (["scratchpad", "ccMoveA", "x"], ["scratchpad", "ccMoveB"]);
		checkThat ("a name already there refuses", theAnswer.flMoved, false);
		theAnswer = theOpen.theStore.moveForPath (["scratchpad", "ccMoveA", "x"], ["scratchpad", "ccMoveB", "x"]);
		checkThat ("a scalar as the destination refuses, the kernel's 'destination must be a table'", theAnswer.flMoved, false);
		theAnswer = theOpen.theStore.moveForPath (["scratchpad", "ccMoveA"], ["scratchpad", "ccMoveA"]);
		checkThat ("a table can't move into itself", theAnswer.flMoved, false);
		theAnswer = theOpen.theStore.moveForPath (["scratchpad", "ccMoveB"], ["scratchpad", "ccMoveA"]);
		checkThat ("a table moves with its contents", theAnswer.flMoved && (valueOf (theOpen, "scratchpad.ccMoveA.ccMoveB.y") === 2), true);
		}

	function testDeleteTakesAnLvalue () {

		/*  9/7/26 by CC -- the kernel's delete (langvalue.c deletevalue, through
			assignordeletevalue, the same code as assignment) takes the THING,
			an lvalue; ours took only an address value, and
			rssCodeUpdateSuite.addPartToIndex's delete (adrindex^ [1]) stopped
			the first codecasting release.  */

		section ("delete takes an lvalue, the way assignment does");

		const pathDatabase = freshDatabase ("deleteLvalue");
		const theOpen = openTheDatabase (pathDatabase);
		runText (theOpen, "new (tabletype, @scratchpad.ccDel); scratchpad.ccDel.a = 1; scratchpad.ccDel.b = 2; scratchpad.ccDel.c = 3; scratchpad.ccDel.d = 4");
		checkThat ("delete (t.x) deletes the named cell", valueOf (theOpen, "delete (scratchpad.ccDel.a); defined (scratchpad.ccDel.a)"), false);
		checkThat ("delete (t [1]) deletes the first in sorted order", valueOf (theOpen, "delete (scratchpad.ccDel [1]); defined (scratchpad.ccDel.b)"), false);
		checkThat ("delete (adr^ [1]) through an address, his addPartToIndex line", valueOf (theOpen, "local (adrindex = @scratchpad.ccDel); delete (adrindex^ [1]); defined (scratchpad.ccDel.c)"), false);
		checkThat ("delete (@t.x) still works", valueOf (theOpen, "delete (@scratchpad.ccDel.d); sizeof (scratchpad.ccDel)"), 0);
		checkThat ("and the table itself", valueOf (theOpen, "delete (scratchpad.ccDel); defined (scratchpad.ccDel)"), false);
		checkThat ("delete of a local", valueOf (theOpen, "local (x = 5); delete (x); defined (x)"), false);
		}

	function testRemoteCall () {

		/*  9/7/26 by CC -- ["xmlrpc://host:port/RPC2"].a.b (params), the kernel's
			remote call (langxml.c): the handler at Frontier.protocols.xmlrpc
			gets {server, procedureName, params} and goes through
			betty.rpc.client over the wire. His rssCodeUpdate suite pings the
			cloud this way. A tiny XML-RPC server in a child process answers
			every call with "ECHO method (params)". Also the rule that made
			the answer readable: xml.getValue answers the element itself when
			it has no text (xmlgetvalueverb), which is how the client decodes
			a <value><string>.  */

		section ("The remote call, ['xmlrpc://...'].a.b (), the kernel's way");

		const pathDatabase = freshDatabase ("remoteCall");
		const theOpen = openTheDatabase (pathDatabase, {flAllowNetwork: true});
		const {spawnSync, spawn} = require ("child_process");
		const theEcho = spawn ("node", [pathTool.join (__dirname, "xmlrpcEcho.js"), "5394"], {stdio: "ignore"});
		spawnSync ("sleep", ["1"]);
		try {
			checkThat ("an unknown protocol is refused by name", valueOf (theOpen, "[\"bogus://x.y/RPC2\"].a.b (1)"), "ERROR: Can't call a.b because the protocol \"bogus\" isn't known -- there is no script at user.protocols.bogus or Frontier.protocols.bogus.");
			checkThat ("xml.getValue answers the element itself when it has no text -- the kernel's rule",
				valueOf (theOpen, "xml.compile (\"<a><b><string>hi</string></b></a>\", @scratchpad.ccXml); typeOf (xml.getValue (xml.getAddress (@scratchpad.ccXml, \"a\"), \"b\"))"), "tabl");
			checkThat ("and the text when it has some", valueOf (theOpen, "xml.getValue (xml.getAddress (xml.getAddress (@scratchpad.ccXml, \"a\"), \"b\"), \"string\")"), "hi");
			checkThat ("the call goes out and the answer comes back through Frontier.protocols.xmlrpc and betty.rpc.client",
				valueOf (theOpen, "[\"xmlrpc://127.0.0.1:5394/RPC2\"].rssCloud.ping (\"http://example.com/rss.xml\")"), "ECHO rssCloud.ping (http://example.com/rss.xml)");
			}
		finally {
			theEcho.kill ();
			}
		}

	function testMenuLineAddress () {

		/*  9/7/26 by CC -- "user.menus.customMenu line 6", the address a
			menu-script window gives its object; his cmd-4 time-stamp command
			found "no outline" behind it.  */

		section ("A menu command's script, addressed as 'menubar line N'");

		const pathDatabase = freshDatabase ("menuLine");
		const theOpen = openTheDatabase (pathDatabase);
		const aLine = function (level, text, extra) { return (Object.assign ({level, text, flExpanded: true, flComment: false, flBreakpoint: false}, extra || {})); };
		theOpen.theStore.odb.scratchpad.ccMenu = {flOdbMenubar: true, lines: [aLine (0, "Test"), aLine (1, "Hello", {script: {lines: [aLine (0, "dialog.alert (\"hi\")")]}}), aLine (1, "Empty")]};
		checkThat ("the address reads as the command's script", valueOf (theOpen, "typeOf (address (\"scratchpad.ccMenu line 1\")^)"), "scpt");
		checkThat ("with its lines", valueOf (theOpen, "sizeof (address (\"scratchpad.ccMenu line 1\")^)"), 1);
		checkThat ("a command with no script reads as a one-line empty script, the way the window opens it", valueOf (theOpen, "sizeof (address (\"scratchpad.ccMenu line 2\")^)"), 1);
		const adr = theOpen.environment.verbs ["lang.address"] (["scratchpad.ccMenu line 2"], theOpen.environment); //9/8/26 by CC -- lang.address is the text-to-address coercion; string.parseAddress is the kernel's list verb
		adr.reference.set ({flOdbScript: true, scriptType: "script", lines: [aLine (0, "msg (\"now\")"), aLine (0, "beep ()")]});
		checkThat ("writing through it puts the script on the line and saves the menubar", theOpen.theStore.odb.scratchpad.ccMenu.lines [2].script.lines.length, 2);
		checkThat ("and the other command's script is untouched", theOpen.theStore.odb.scratchpad.ccMenu.lines [1].script.lines [0].text, "dialog.alert (\"hi\")");
		checkThat ("a line that isn't there reads as nothing", valueOf (theOpen, "defined (address (\"scratchpad.ccMenu line 9\")^)"), false);
		}

	function testCharType () {

		/*  8/26/26 by CC -- DW's go-ahead: the char type, a real value in
			the language the way double became one 8/19. The rules are the
			kernel's, each read from the C: typeOf answers 'char' (typeinfo,
			langops.c); coercing to a number takes the code and to a string
			takes the character (coercetolong, coercetostring, langvalue.c);
			a single-quoted one-character literal is a char and a
			four-character one is the type-code text (parsepopcharconst,
			langscan.c); adding two chars makes a two-character string and
			a char plus a number stays a char (addvalue's special case);
			a string only coerces when it is one character long
			(stringtochar); the code must fit a byte (coercetochar).  */

		section ("The char type");

		const pathDatabase = freshDatabase ("charType");
		var theOpen = openTheDatabase (pathDatabase);

		checkThat ("typeOf answers the four-character code", valueOf (theOpen, "typeOf (char (65))"), "char");
		checkThat ("number of a char is its code", valueOf (theOpen, "number (char (65))"), 65);
		checkThat ("string of a char is its character", valueOf (theOpen, "string (char (65))"), "A");
		checkThat ("a single-quoted literal is a char", valueOf (theOpen, "typeOf ('a')"), "char");
		checkThat ("number of 'A' is 65", valueOf (theOpen, "number ('A')"), 65);
		checkThat ("a four-character literal is the type-code text", valueOf (theOpen, "typeOf ('tabl')"), "TEXT");
		checkThat ("a char equals its one-character string", valueOf (theOpen, "'a' == \"a\""), true);
		checkThat ("two chars compare by their codes", valueOf (theOpen, "'a' < 'b'"), true);
		checkThat ("adding two chars makes a two-character string", valueOf (theOpen, "'a' + 'b'"), "ab");
		checkThat ("a char plus a number is the next character", valueOf (theOpen, "string ('a' + 1)"), "b");
		checkThat ("and it is still a char", valueOf (theOpen, "typeOf ('a' + 1)"), "char");
		checkThat ("a for loop runs over a char range", valueOf (theOpen, "local (ct = 0)\nfor ch = 'a' to 'e'\n\tct++\nct"), 5);
		checkThat ("the bit verbs read a digit string as its number", valueOf (theOpen, "bit.logicalXor (\"6\", 3)"), 5);
		checkThat ("and a char as its code", valueOf (theOpen, "bit.logicalXor (char (0x36), 3)"), 53);
		checkThat ("char refuses a string longer than one character",
			String (valueOf (theOpen, "char (\"ab\")")).indexOf ("ERROR") === 0, true);
		checkThat ("char refuses a code that doesn't fit a byte",
			String (valueOf (theOpen, "char (300)")).indexOf ("ERROR") === 0, true);

		checkThat ("a char goes into the database as a char", valueOf (theOpen, "scratchpad.oneChar = 'q'\ntypeOf (scratchpad.oneChar)"), "char");
		theOpen = openTheDatabase (pathDatabase); //the restart
		checkThat ("and is still a char after a reopen", valueOf (theOpen, "typeOf (scratchpad.oneChar)"), "char");
		checkThat ("with its code intact", valueOf (theOpen, "number (scratchpad.oneChar)"), 113);
		}

	function testJsonCompileKernel () {

		/*  9/13/26 by CC, DW's go -- JSON.compile KERNELIZED, and the two
			interpreter caches that came with the study. His report: a script
			that calls JSON.compile on a 5K file takes seconds here, instant
			in Berkeley. Measured: 12,141 verb calls, 1.1 seconds, most of it
			the evaluator rebuilding the kernel verb tables and re-walking
			system.paths on every name lookup (both caches lived in a closure
			that evaluate re-creates for every handler call). The kernel verb
			builds the same table the 2010 script does, so the test runs the
			script first, installs the thunk, and compares.  */

		section ("JSON.compile kernelized -- the same table the 2010 script builds, and the paths cache stays honest");

		const pathDatabase = freshDatabase ("jsonKernel");
		const theOpen = openTheDatabase (pathDatabase);

		const theCases = {
			nested: "{\"a\": 1, \"b\": [1, 2, 3], \"c\": {\"d\": \"x\", \"e\": [ {\"f\": true}, {\"g\": null} ]}, \"h\": 2.5, \"i\": false}",
			emptyList: "{\"a\": [], \"b\": \"after\"}",
			emptyStruct: "{\"a\": {}, \"b\": 1}",
			topList: "[1, \"two\", 3.0]",
			quotes: "{\"q\": \"say \\\"hi\\\"\", \"bs\": \"a\\\\b\", \"slash\": \"a\\/b\"}",
			atts: "{\"guid\": {\"isPermaLink\": \"false\", \"#value\": \"http://x/y\"}}"
			};
		var bigText = "{\"theList\": {"; //about the size of his server list
		var ix;
		for (ix = 1; ix <= 60; ix++) {
			bigText += ((ix > 1) ? ", " : "") + "\"server" + ix + "\": {\"name\": \"server" + ix + ".example.com\", \"server\": \"box" + ix + "\", \"url\": \"https://server" + ix + ".example.com/now\"}";
			}
		bigText += "}}";
		theCases.big = bigText;
		theOpen.theStore.odb.scratchpad.ccJson = theCases;

		function compileAll () {
			const theAnswers = {};
			Object.keys (theCases).forEach (function (theName) {
				const flAtts = (theName === "atts") ? ", true" : "";
				theAnswers [theName] = valueOf (theOpen, "local (t); JSON.compile (scratchpad.ccJson." + theName + ", @t" + flAtts + "); t");
				});
			return (theAnswers);
			}

		const scriptAnswers = compileAll ();
		checkThat ("the 2010 script builds the numbered table", Object.keys (scriptAnswers.nested) [0], "00001\ta");
		checkThat ("and reads the array as repeated names", Object.keys (scriptAnswers.nested) [2], "00003\tb");

		theOpen.theStore.odb.system.verbs.builtins.json.compile = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on compile (s, adrtable, flParseAtts=false)", flComment: false},
			{level: 1, text: "kernel (json.compile)", flComment: false}]};
		const kernelAnswers = compileAll ();
		Object.keys (theCases).forEach (function (theName) {
			checkThat ("the kernel verb builds the same table: " + theName, kernelAnswers [theName], scriptAnswers [theName]);
			});
		checkThat ("flParseAtts made /atts and /pcdata", kernelAnswers.atts ["00001\tguid"] ["/pcdata"], "http://x/y");
		checkThat ("a scalar at the top is the whole answer (his 10/24/10 note)", valueOf (theOpen, "local (t); JSON.compile (\"42\", @t); t"), 42);
		checkThat ("escapes decode by the JSON rules -- the one deliberate difference", valueOf (theOpen, "local (t); JSON.compile (\"{\\\"s\\\": \\\"a\\\\nb\\\"}\", @t); t"), {"00001\ts": "a\nb"});
		checkThat ("a broken text says so in Frontier's words", valueOf (theOpen, "local (t); JSON.compile (\"{\\\"a\\\": \", @t)").indexOf ("Can't compile the JSON because") >= 0, true);
		const whenStart = Date.now ();
		for (ix = 0; ix < 20; ix++) {
			runText (theOpen, "local (t); JSON.compile (scratchpad.ccJson.big, @t)");
			}
		const msTwenty = Date.now () - whenStart;
		checkThat ("twenty compiles of a 5K text through the thunk take well under a second (" + msTwenty + "ms)", msTwenty < 1000, true);

		//the paths cache: built by now, and it has to see the database change shape

		theOpen.theStore.odb.system.verbs.builtins.ccNewGroup = {ccHello: {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on ccHello ()", flComment: false},
			{level: 1, text: "return (\"hi\")", flComment: false}]}};
		checkThat ("a group added to a paths table after the cache was built resolves", valueOf (theOpen, "ccNewGroup.ccHello ()"), "hi");
		theOpen.theStore.renameForPath (["system", "verbs", "builtins", "ccNewGroup"], "ccRenamedGroup");
		checkThat ("renamed, the new name resolves", valueOf (theOpen, "ccRenamedGroup.ccHello ()"), "hi");
		checkThat ("and the old name is gone", valueOf (theOpen, "ccNewGroup.ccHello ()").indexOf ("ERROR") === 0, true);
		runText (theOpen, "delete (@system.verbs.builtins.ccRenamedGroup)");
		checkThat ("deleted, the name is gone", valueOf (theOpen, "ccRenamedGroup.ccHello ()").indexOf ("ERROR") === 0, true);
		runText (theOpen, "new (tabletype, @scratchpad.ccPathsTable); scratchpad.ccPathsTable.ccDeep = \"deep\"; system.paths.[\"99cc\"] = @scratchpad.ccPathsTable");
		checkThat ("a table added to system.paths joins the search", valueOf (theOpen, "ccDeep"), "deep");
		runText (theOpen, "delete (@system.paths.[\"99cc\"])");
		checkThat ("and leaves it when removed", valueOf (theOpen, "ccDeep").indexOf ("ERROR") === 0, true);
		}

	function testTablePaste () {

		/*  9/13/26 by CC -- DW's report: he copied processMacros from one
			table window, pasted it into another, renamed it, and the row was
			there with no size; a cmd-click said it wasn't there; close and
			reopen and it was gone. The paste had drawn a line and made no
			object. The table window's paste copies the object now, through
			the store's copyForPath -- the kernel browser's paste into the
			cursor's parent, with its already-exists question.  */

		section ("Paste in a table window copies the object -- the kernel browser's paste");

		const pathDatabase = freshDatabase ("tablePaste");
		const theOpen = openTheDatabase (pathDatabase);
		const theStore = theOpen.theStore;

		runText (theOpen, "new (tabletype, @scratchpad.ccFrom); new (tabletype, @scratchpad.ccTo)");
		theStore.odb.scratchpad.ccFrom.ccScript = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on ccScript ()", flComment: false},
			{level: 1, text: "return (\"pasted\")", flComment: false}]};
		runText (theOpen, "new (tabletype, @scratchpad.ccFrom.ccTable); scratchpad.ccFrom.ccTable.a = 1; new (tabletype, @scratchpad.ccFrom.ccTable.deeper); scratchpad.ccFrom.ccTable.deeper.b = \"two\"");

		var theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccScript"], ["scratchpad", "ccTo"], false);
		checkThat ("a script pastes under its own name", theAnswer, {flCopied: true, name: "ccScript"});
		checkThat ("the copy runs", valueOf (theOpen, "scratchpad.ccTo.ccScript ()"), "pasted");
		checkThat ("the original is still where it was", valueOf (theOpen, "scratchpad.ccFrom.ccScript ()"), "pasted");
		theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccScript"], ["scratchpad", "ccTo"], false);
		checkThat ("a second paste asks the kernel's question", theAnswer.flExists, true);
		checkThat ("in the kernel's words", theAnswer.message, "Can't paste ccScript because an item named \u201cccScript\u201d already exists in scratchpad.ccTo.");
		theStore.odb.scratchpad.ccTo.ccScript = "not a script any more";
		theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccScript"], ["scratchpad", "ccTo"], true);
		checkThat ("answered Replace, it replaces", theAnswer.flCopied, true);
		checkThat ("and the script is back", valueOf (theOpen, "scratchpad.ccTo.ccScript ()"), "pasted");
		theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccTable"], ["scratchpad", "ccTo"], false);
		checkThat ("a table pastes whole", valueOf (theOpen, "scratchpad.ccTo.ccTable.deeper.b"), "two");
		checkThat ("and changing the copy leaves the original", valueOf (theOpen, "scratchpad.ccTo.ccTable.a = 5; scratchpad.ccFrom.ccTable.a"), 1);
		theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccTable"], ["scratchpad", "ccFrom", "ccTable", "deeper"], false);
		checkThat ("a table can't be pasted into itself", theAnswer.flCopied, false);
		theAnswer = theStore.copyForPath (["scratchpad", "ccNoSuch"], ["scratchpad", "ccTo"], false);
		checkThat ("a missing source says so", theAnswer.message, "Can't paste scratchpad.ccNoSuch because there is no object at that address.");
		theAnswer = theStore.copyForPath (["scratchpad", "ccFrom", "ccScript"], ["scratchpad", "ccFrom", "ccScript"], false);
		checkThat ("a destination that isn't a table says so", theAnswer.message, "Can't paste scratchpad.ccFrom.ccScript into scratchpad.ccFrom.ccScript because that isn't a table.");
		checkThat ("the pasted script resolves by its new address after the paths cache was built", valueOf (theOpen, "defined (scratchpad.ccTo.ccScript)"), true);
		}

	function testOutlineExpansionDefault () {

		/*  9/13/26 by CC -- DW's report: an outline never opened in Atlantis
			comes with every line expanded. His ask: if the expansion state
			can't be kept, the default is the View button's -- the whole
			outline collapsed and the first summit's subs showing. The state
			IS kept when the OPML carries one (Concord and the OPML Editor
			write expansionState); an OPML file without one, the way a
			source.opml from a repo arrives, gets his default.  */

		section ("An outline read from OPML: the expansion state when there is one, the View button's default when there isn't");

		const pathDatabase = freshDatabase ("outlineExpansion");
		const theOpen = openTheDatabase (pathDatabase);
		const theBody = "<outline text=\"one\"><outline text=\"one a\"><outline text=\"one a i\"/></outline><outline text=\"one b\"/></outline><outline text=\"two\"><outline text=\"two a\"/></outline>";
		const withoutState = "<?xml version=\"1.0\"?><opml version=\"2.0\"><head><title>x</title></head><body>" + theBody + "</body></opml>";
		const withState = "<?xml version=\"1.0\"?><opml version=\"2.0\"><head><title>x</title><expansionState>1,2,5</expansionState></head><body>" + theBody + "</body></opml>";
		theOpen.theStore.odb.scratchpad.ccOpmlWithout = withoutState;
		theOpen.theStore.odb.scratchpad.ccOpmlWith = withState;
		function flagsOf (theName) {
			const theLines = theOpen.theStore.odb.scratchpad [theName].lines;
			return (theLines.map (function (theLine) {
				return (theLine.text + ":" + (theLine.flExpanded ? "open" : "closed"));
				}).join (" "));
			}
		runText (theOpen, "op.xmlToOutline (scratchpad.ccOpmlWithout, @scratchpad.ccOutlineWithout)");
		checkThat ("no expansionState: the first summit open, everything else closed", flagsOf ("ccOutlineWithout"), "one:open one a:closed one a i:closed one b:closed two:closed two a:closed");
		runText (theOpen, "op.xmlToOutline (scratchpad.ccOpmlWith, @scratchpad.ccOutlineWith)");
		checkThat ("with one, the numbered visible lines are open: one (1), one a (2), two (5); one a i and one b stay closed", flagsOf ("ccOutlineWith"), "one:open one a:open one a i:closed one b:closed two:open two a:closed");
		}

	function testJsonDecompileKernel () {

		/*  9/13/26 by CC, DW's go -- JSON.decompile KERNELIZED, the other half
			of JSON.compile: the same text his 2010 script writes. The test
			builds tables with the 2010 JSON.compile, decompiles them with the
			2010 script, installs the thunk, and compares. Running the script
			here found indexOf missing from the language ("set comma" reads
			indexOf (adr^)), so indexOf is here too, the kernel's indexfunc.  */

		section ("JSON.decompile kernelized -- the same text the 2010 script writes, and indexOf");

		const pathDatabase = freshDatabase ("jsonDecompile");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("indexOf answers the one-based position in the table's order", valueOf (theOpen, "new (tabletype, @scratchpad.ccIx); scratchpad.ccIx.b = 1; scratchpad.ccIx.a = 2; scratchpad.ccIx.c = 3; local (adr, s = \"\"); for adr in @scratchpad.ccIx {s = s + nameof (adr^) + indexof (adr^)}; s"), "a1b2c3");
		checkThat ("and on a local table", valueOf (theOpen, "local (t, adr, s = \"\"); new (tabletype, @t); t.x = 1; t.y = 2; for adr in @t {s = s + nameof (adr^) + indexof (adr^)}; s"), "x1y2");
		checkThat ("a name that isn't there answers 0, the kernel's way", valueOf (theOpen, "indexof (scratchpad.ccIx.nope)"), 0);

		const theCases = {
			serverlist: "{\"theList\": {\"marin\": {\"name\": \"marin.scripting.com\", \"server\": \"marin\"}, \"rss.chat\": {\"name\": \"rss.chat\", \"server\": \"africa\"}}}",
			nested: "{\"a\": 1, \"b\": [1, 2, 3], \"c\": {\"d\": \"x\", \"e\": [ {\"f\": true}, {\"g\": null} ]}, \"h\": 2.5, \"i\": false}",
			emptyList: "{\"a\": [], \"b\": \"after\"}",
			emptyStruct: "{\"a\": {}, \"b\": 1}",
			topList: "[1, \"two\", 3.0]",
			listOfStructs: "[{\"x\": 1}, {\"x\": 2}]",
			quotes: "{\"q\": \"say \\\"hi\\\"\", \"bs\": \"a\\\\b\"}",
			atts: "{\"guid\": {\"isPermaLink\": \"false\", \"#value\": \"http://x/y\"}}",
			mixedCase: "{\"Name\": 1, \"name\": 2, \"other\": 3}"
			};
		theOpen.theStore.odb.scratchpad.ccJsonD = theCases;
		runText (theOpen, "new (tabletype, @scratchpad.ccTablesD)");
		Object.keys (theCases).forEach (function (theName) {
			runText (theOpen, "JSON.compile (scratchpad.ccJsonD." + theName + ", @scratchpad.ccTablesD." + theName + ((theName === "atts") ? ", true" : "") + ")");
			});
		function decompileAll () {
			const theAnswers = {};
			Object.keys (theCases).forEach (function (theName) {
				theAnswers [theName] = valueOf (theOpen, "JSON.decompile (@scratchpad.ccTablesD." + theName + ")");
				});
			return (theAnswers);
			}
		const scriptAnswers = decompileAll ();
		checkThat ("the 2010 script runs here now (it needed indexOf)", String (scriptAnswers.nested).indexOf ("ERROR") === -1, true);
		theOpen.theStore.odb.system.verbs.builtins.json.decompile = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on decompile (adrtable)", flComment: false},
			{level: 1, text: "kernel (json.decompile)", flComment: false}]};
		const kernelAnswers = decompileAll ();
		Object.keys (theCases).forEach (function (theName) {
			checkThat ("the kernel verb writes the same text: " + theName, kernelAnswers [theName], scriptAnswers [theName]);
			});
		var flParses = true;
		try {
			JSON.parse (String (kernelAnswers.nested).replace (/\r/g, "\n"));
			}
		catch (err) {
			flParses = false;
			}
		checkThat ("and the text is JSON", flParses, true);
		checkThat ("a scalar decompiles as itself", valueOf (theOpen, "scratchpad.ccScalar = 42; JSON.decompile (@scratchpad.ccScalar)"), "42\r");
		}

	function testMenuIsInstalled () {

		/*  9/15/26 by CC -- menu.isInstalled answered false for every
			menubar, and userland.trialVersionCheck read that as the UI
			needing to be restored: menu.noSuite (), then window.about ()
			because user.prefs.openAboutWindow is true -- the About window
			DW saw open on every root update (his 9/15 report). The app
			installs user.menus, system.menus.menubar and the bookmarks
			menu; those answer true now.  */

		section ("menu.isInstalled answers for the menubars the app installs");

		const pathDatabase = freshDatabase ("menuIsInstalled");
		const theOpen = openTheDatabase (pathDatabase);
		checkThat ("the Tools menu, reached through user.menus.tools's address", valueOf (theOpen, "menu.isInstalled (@Frontier.tools.menu)"), true);
		checkThat ("by its full path too", valueOf (theOpen, "menu.isInstalled (@system.verbs.builtins.Frontier.tools.menu)"), true);
		checkThat ("the user's custom menu", valueOf (theOpen, "menu.isInstalled (@user.menus.customMenu)"), true);
		checkThat ("system.menus.menubar", valueOf (theOpen, "menu.isInstalled (@system.menus.menubar)"), true);
		checkThat ("a table that isn't a menubar is not installed", valueOf (theOpen, "menu.isInstalled (@scratchpad)"), false);
		checkThat ("so trialVersionCheck's restore branch stays quiet: nothing to restore", valueOf (theOpen, "local (fl = false)\nif not userland.trialVersion.flTrialVersion\n\tif not menu.isInstalled (@Frontier.tools.menu)\n\t\tfl = true\nfl"), false);
		theOpen.theStore.close ();
		}

	function testExpandedBitMeansShowing () {

		/*  9/15/26 by CC -- DW's 9/12 and 9/15 reports: "most outlines open
			with every line expanded." The kernel's flexpanded bit says a
			headline is SHOWING (its list is open), not that its subs are:
			opexpand.c reads a parent's state off its first subhead, and
			oppack.c gives the bit to the first line of a list and lets the
			siblings inherit it. frontierodb read the bit as "subs open",
			so every visible line came back expanded. The writer puts the
			bit on a line when its parent is expanded (summits always), the
			reader takes a parent's flExpanded from its first child.  */

		section ("The packed outline's expanded bit is on the child, the kernel's way (oppack.c, opexpand.c)");

		const frontierodb = require (pathTool.join (__dirname, "..", "frontierodb.js"));
		const theLines = [{level: 0, text: "A", flExpanded: true}, {level: 1, text: "B", flExpanded: false}, {level: 0, text: "C", flExpanded: false}, {level: 1, text: "D", flExpanded: true}, {level: 2, text: "E", flExpanded: false}, {level: 0, text: "F", flExpanded: false}];
		const theBytes = frontierodb.packMemoryValue ({flOdbScript: true, scriptType: "script", lines: theLines});
		const theTable = theBytes.slice (theBytes.length - 6 * theLines.length); //no refcons: six bytes a line, flags first
		const theBits = [];
		theLines.forEach (function (theLine, ix) {
			theBits.push ((theTable.readUInt16BE (ix * 6) & 0x8000) ? 1 : 0);
			});
		checkThat ("the bit is set on every line whose parent is expanded, and on every summit", theBits, [1, 1, 1, 0, 1, 1]);
		const theBack = frontierodb.unpackMemoryValue (theBytes);
		checkThat ("read back, a parent is expanded when its first child's bit is set", theBack.lines.map (function (theLine) {return (theLine.flExpanded);}), [true, false, false, false, false, false]);
		checkThat ("and what was under a collapsed line is closed too, the kernel's unpack rule", theBack.lines [3].flExpanded, false);

		const pathOpmlRoot = pathTool.join (__dirname, "..", "..", "frontierOdb", "misc", "OPML Editor distrib 12:21:2012", "opml.root"); //what makeVirginRoot builds frontier.root from
		const theRoot = frontierodb.readRootFile (pathOpmlRoot);
		function get (theTable, theParts) {
			var current = theTable;
			theParts.forEach (function (thePart) {
				if ((current !== undefined) && (current !== null) && (typeof current === "object")) {
					var found;
					Object.keys (current).forEach (function (theKey) {
						if ((found === undefined) && (theKey.toLowerCase () === thePart.toLowerCase ())) {
							found = theKey;
							}
						});
					current = (found === undefined) ? undefined : current [found];
					if ((current !== undefined) && (current !== null) && (typeof current === "object") && (current.lines === undefined) && (current.value !== undefined) && (typeof current.value === "object")) {
						current = current.value; //the reader wraps some values as {type, value}
						}
					}
				});
			return (current);
			}
		function ctParentsOpen (theScriptLines) {
			var ctOpen = 0, ctParents = 0;
			theScriptLines.forEach (function (theLine, ix) {
				const theNext = theScriptLines [ix + 1];
				if ((theNext !== undefined) && (theNext.level > theLine.level)) {
					ctParents++;
					if (theLine.flExpanded === true) {
						ctOpen++;
						}
					}
				});
			return ({ctOpen, ctParents});
			}
		const theStartup = get (theRoot, ["system", "startup", "startupScript"]);
		const startupCounts = ctParentsOpen (theStartup.lines);
		checkThat ("the 2012 root's startupScript opens folded: six of its 133 parents open, not 47", startupCounts, {ctOpen: 6, ctParents: 133});
		const theUpdate = get (theRoot, ["system", "verbs", "builtins", "rootUpdates", "update"]);
		checkThat ("rootUpdates.update: four of 170", ctParentsOpen (theUpdate.lines), {ctOpen: 4, ctParents: 170});
		checkThat ("its Changes line is open and the newest change under it too, the rest closed", theUpdate.lines.slice (0, 4).map (function (theLine) {return (theLine.flExpanded);}), [true, true, true, false]);
		}

	function testTableRenameAndMove () {

		/*  9/14/26 by CC -- four of the unbuilt verbs, copied from the C
			(DW's 9/13 ask: finish the unbuilt verbs; 9/14: pick off a few
			easy ones). table.rename and table.move from tableverbs.c keep
			the node: the row keeps its id, so a renamed table's children
			are still its children. tcp.writeFileToStream and
			launch.appWithDocument are checked by name only -- the first
			needs a socket, the second opens an application.  */

		section ("table.rename and table.move keep the object, the way tablerenameverb and tablemoveverb do");

		const pathDatabase = freshDatabase ("tableRenameMove");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, "new (tableType, @scratchpad.renameTest); scratchpad.renameTest.first = 1; new (tableType, @scratchpad.renameTest.inner); scratchpad.renameTest.inner.deep = \"x\"; new (tableType, @scratchpad.renameTest.other)");
		checkThat ("table.rename answers the new address", valueOf (theOpen, "string (table.rename (@scratchpad.renameTest.inner, \"renamed\"))"), "scratchpad.renameTest.renamed");
		checkThat ("the old name is gone", valueOf (theOpen, "defined (scratchpad.renameTest.inner)"), false);
		checkThat ("the children came along", valueOf (theOpen, "scratchpad.renameTest.renamed.deep"), "x");
		checkThat ("a name already in use is the kernel's badrenameerror", valueOf (theOpen, "table.rename (@scratchpad.renameTest.renamed, \"other\")"), "ERROR: Can't rename scratchpad.renameTest.renamed as other because an item with that name already exists.");
		checkThat ("a missing entry is an error", valueOf (theOpen, "table.rename (@scratchpad.renameTest.nothere, \"x\")"), "ERROR: Can't rename scratchpad.renameTest.nothere because there is no object at that address.");
		checkThat ("a scalar renames too", valueOf (theOpen, "table.rename (@scratchpad.renameTest.first, \"uno\"); scratchpad.renameTest.uno"), 1);
		checkThat ("a local table renames its entry", valueOf (theOpen, "local (t); new (tableType, @t); t.a = 5; table.rename (@t.a, \"b\"); t.b + (not defined (t.a))"), 6);

		checkThat ("table.move answers the address in the new table", valueOf (theOpen, "string (table.move (@scratchpad.renameTest.renamed, @scratchpad.renameTest.other))"), "scratchpad.renameTest.other.renamed");
		checkThat ("it left the old table", valueOf (theOpen, "defined (scratchpad.renameTest.renamed)"), false);
		checkThat ("and its children are still under it", valueOf (theOpen, "scratchpad.renameTest.other.renamed.deep"), "x");
		checkThat ("moving onto an existing name overwrites it (hashassign, dmb 9/30/91)", valueOf (theOpen, "scratchpad.renameTest.other.uno = \"old\"; table.move (@scratchpad.renameTest.uno, @scratchpad.renameTest.other); scratchpad.renameTest.other.uno"), 1);
		checkThat ("the destination must be a table", valueOf (theOpen, "table.move (@scratchpad.renameTest.other.uno, @scratchpad.renameTest.other.deep)"), "ERROR: Can't move scratchpad.renameTest.other.uno into scratchpad.renameTest.other.deep because the destination must be a table.");
		checkThat ("a missing source is an error", valueOf (theOpen, "table.move (@scratchpad.renameTest.nothere, @scratchpad.renameTest.other)"), "ERROR: Can't move scratchpad.renameTest.nothere because there is no object at that address.");
		checkThat ("a local entry moves into a local table", valueOf (theOpen, "local (t, u); new (tableType, @t); new (tableType, @u); t.a = 5; table.move (@t.a, @u); u.a + (not defined (t.a))"), 6);

		theOpen.theStore.close ();
		const reopened = openTheDatabase (pathDatabase);
		checkThat ("the moves and renames survive a reopen", valueOf (reopened, "scratchpad.renameTest.other.renamed.deep + string (scratchpad.renameTest.other.uno)"), "x1");
		checkThat ("tcp.writeFileToStream is in the library (a bad file is its error, not an unbuilt verb)", valueOf (reopened, "tcp.writeFileToStream (999, \"NoSuchDisk:nothing.txt\")").indexOf ("isn't implemented") === -1, true);
		checkThat ("launch.appWithDocument reaches the library (a bad application is its error, not an unbuilt verb)", valueOf (reopened, "launch.appWithDocument (\"NoSuchApplicationHere9\", \"\")").indexOf ("isn't implemented") === -1, true);
		reopened.theStore.close ();
		}

	function testStringSubscriptIsAChar () {

		/*  9/14/26 by CC -- DW's codecasting feed came out with &#NaN; in a
			description: his xml.entityEncode does number (s [i]) for every
			character, and s [i] answered a one-character string, so the
			number was nothing. The kernel's stringarrayvalue (langvalue.c)
			answers a char. And a char here can carry a code above 255, so a
			curly quote encodes as &#8217; instead of a mangled byte.  */

		section ("A string subscript answers a char, the kernel's rule -- and xml.entityEncode writes real numbers");

		const pathDatabase = freshDatabase ("stringSubscript");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("typeOf (s [i]) is char", valueOf (theOpen, "local (s = \"abc\"); typeOf (s [2])"), "char");
		checkThat ("number (s [i]) is the code", valueOf (theOpen, "local (s = \"abc\"); number (s [2])"), 98);
		checkThat ("string (s [i]) is the character", valueOf (theOpen, "local (s = \"abc\"); string (s [2])"), "b");
		checkThat ("s [i] + \"\" reads as the character", valueOf (theOpen, "local (s = \"abc\"); s [1] + s [3]"), "ac");
		checkThat ("a curly quote keeps its code", valueOf (theOpen, "local (s = \"can\u2019t\"); number (s [4])"), 8217);
		checkThat ("and compares above char (128), the way entityEncode tests it", valueOf (theOpen, "local (s = \"can\u2019t\"); s [4] >= char (128)"), true);
		checkThat ("xml.entityEncode writes the numbered entity", valueOf (theOpen, "xml.entityEncode (\"can\u2019t\", true)"), "can&#8217;t");
		checkThat ("and leaves plain text alone", valueOf (theOpen, "xml.entityEncode (\"a <b> & c\", true)"), "a &lt;b&gt; &amp; c");
		checkThat ("string.nthChar keeps the whole code too", valueOf (theOpen, "number (string.nthChar (\"\u00e9\", 1))"), 233);

		//9/14/26 by CC -- and the short address, found the same night: @string.addressToString bound string to the script behind string ()
		checkThat ("a short dotted address dereferences through the paths (langgetdotparams wants a table for the base)", valueOf (theOpen, "local (a = @string.addressToString); typeOf (a^)"), "scpt");
		checkThat ("defined () agrees", valueOf (theOpen, "local (a = @string.addressToString); defined (a^)"), true);
		checkThat ("a bare @string still takes what the paths find first, the script", valueOf (theOpen, "local (c = @string); typeOf (c^)"), "scpt");
		checkThat ("target.set on the short address keeps the object", valueOf (theOpen, "local (old = target.set (@string.addressToString)); local (t = target.get ()); target.set (old); typeOf (t^)"), "scpt");
		}

	function testScratchpadGates () {

		/*  8/24/26 by CC -- DW, 8/23: "we're going to do more gates. we'll
			set up a table in scratchpad where i can put a script or the
			address of a script that you make sure keeps compiling and
			running." Every entry in scratchpad.gates is a script, or the
			address of one; each is called, headless, against the copy. A
			script that throws turns the gate red and the release stops.
			An empty table passes -- the table waiting for entries is the
			feature.  */

		section ("The gates table -- scratchpad.gates");

		const pathDatabase = freshDatabase ("gatesTable");
		const theOpen = openTheDatabase (pathDatabase);

		const theScratchpad = theOpen.theStore.odb.scratchpad;
		const theGates = ((theScratchpad === undefined) || (theScratchpad === null)) ? undefined : theScratchpad.gates;
		checkThat ("scratchpad.gates is in the database", (theGates !== undefined) && (theGates !== null), true);
		if ((theGates === undefined) || (theGates === null)) {
			return;
			}

		Object.keys (theGates).forEach (function (theName) {
			if ((theName === "flOdbSqlTable") || (theName === "odbId")) {
				return;
				}
			const theEntry = theGates [theName];
			var theCall;
			if ((theEntry !== undefined) && (theEntry !== null) && ((theEntry.flAddress === true) || (theEntry.flOdbAddressText === true))) {
				theCall = String ((theEntry.pathText !== undefined) ? theEntry.pathText : theEntry.path) + " ()"; //an address: call what it points at
				}
			else {
				theCall = "scratchpad.gates.[\"" + theName + "\"] ()"; //a script sitting in the table
				}
			var theProblem;
			try {
				runText (theOpen, theCall);
				}
			catch (err) {
				theProblem = err.message;
				}
			checkThat ("gates." + theName + " compiles and runs" + ((theProblem === undefined) ? "" : " -- " + theProblem), theProblem === undefined, true);
			});
		}

	function testMenuAddCommand () {

		/*  9/12/26 by CC -- DW's report: Add Bookmark did nothing, no error, no
			new item. The whole UserTalk chain ran -- bookmarksMenu.add, the
			dialog, bookmarksMenu.addBookmark -- and ended in menu.addMenuCommand,
			which was a stub answering true. The kernel's addmenucommandverb
			(menuverbs.c): find the menu by name (a summit, exact match) or add
			it at the end; find the item anywhere under it or add it as the
			menu's last item; the script text becomes the item's script, an
			existing item gets its script replaced. deleteMenuCommand is its
			sibling: the item and its subheads go; a name not found is true.  */

		section ("menu.addMenuCommand and deleteMenuCommand -- the Bookmarks menu's add");

		const odbHome = require (folderUsertalk + "odbHome.js");
		const pathDatabase = freshDatabase ("menuAdd");
		var theOpen = openTheDatabase (pathDatabase);

		function menuLines () {
			const theValue = odbHome.convertValue (theOpen.theStore.odb.user.bookmarksMenu.menu);
			return (theValue.lines);
			}
		function lineNamed (theText) {
			var found;
			menuLines ().forEach (function (theLine) {
				if ((found === undefined) && (theLine.text === theText)) {
					found = theLine;
					}
				});
			return (found);
			}
		function scriptTextOf (theLine) {
			return (((theLine === undefined) || (theLine.script === undefined)) ? undefined : theLine.script.lines.map (function (l) {return (l.text);}).join ("\n"));
			}

		const ctBefore = menuLines ().length;
		checkThat ("addMenuCommand answers true", valueOf (theOpen, "menu.addMenuCommand (@user.bookmarksMenu.menu, \"Bookmarks\", \"workspace\", \"edit (@workspace)\")"), true);
		checkThat ("the menu has one more line", menuLines ().length, ctBefore + 1);
		checkThat ("it is the menu's last item, at level 1", (menuLines () [menuLines ().length - 1].text === "workspace") && (menuLines () [menuLines ().length - 1].level === 1), true);
		checkThat ("carrying the script", scriptTextOf (lineNamed ("workspace")), "edit (@workspace)");
		checkThat ("adding the same item again replaces its script", valueOf (theOpen, "menu.addMenuCommand (@user.bookmarksMenu.menu, \"Bookmarks\", \"workspace\", \"edit (@workspace.notepad)\")"), true);
		checkThat ("no duplicate line", menuLines ().length, ctBefore + 1);
		checkThat ("the new script", scriptTextOf (lineNamed ("workspace")), "edit (@workspace.notepad)");
		checkThat ("a menu that isn't there is made at the end", valueOf (theOpen, "menu.addMenuCommand (@user.bookmarksMenu.menu, \"Extras\", \"Hello\", \"speaker.beep ()\")"), true);
		checkThat ("as a new summit followed by its item", (menuLines () [menuLines ().length - 2].text === "Extras") && (menuLines () [menuLines ().length - 2].level === 0) && (menuLines () [menuLines ().length - 1].text === "Hello") && (menuLines () [menuLines ().length - 1].level === 1), true);
		checkThat ("a two-line script keeps its levels", valueOf (theOpen, "menu.addMenuCommand (@user.bookmarksMenu.menu, \"Extras\", \"Two\", \"if true\\r\\tspeaker.beep ()\")"), true);
		checkThat ("second line at level 1", scriptTextOf (lineNamed ("Two")) === "if true\nspeaker.beep ()" && lineNamed ("Two").script.lines [1].level === 1, true);
		checkThat ("the menubar isn't a menubar: an error that says so", String (valueOf (theOpen, "menu.addMenuCommand (@workspace.notepad, \"Bookmarks\", \"x\", \"y\")")).indexOf ("isn't a menubar") !== -1, true);

		theOpen.theStore.close ();
		theOpen = openTheDatabase (pathDatabase);
		checkThat ("after a close and reopen the item is still there", scriptTextOf (lineNamed ("workspace")), "edit (@workspace.notepad)");

		checkThat ("deleteMenuCommand takes it out", valueOf (theOpen, "menu.deleteMenuCommand (@user.bookmarksMenu.menu, \"Bookmarks\", \"workspace\")"), true);
		checkThat ("gone", lineNamed ("workspace"), undefined);
		checkThat ("a name that isn't there answers true, nothing changes (the kernel's way)", valueOf (theOpen, "menu.deleteMenuCommand (@user.bookmarksMenu.menu, \"Bookmarks\", \"nope\")"), true);
		checkThat ("deleting with an empty item name deletes the whole menu", valueOf (theOpen, "menu.deleteMenuCommand (@user.bookmarksMenu.menu, \"Extras\", \"\")") === true && lineNamed ("Extras") === undefined && lineNamed ("Hello") === undefined, true);
		checkThat ("and the Bookmarks menu is what it was", menuLines ().length, ctBefore);

		//window.getFile the kernel's way: the root's window has the file, an object's window doesn't (getfileverb, windowgetfspec) -- what sends bookmarksMenu.add down its object branch
		checkThat ("window.getFile (@root) answers frontier.root", String (valueOf (theOpen, "window.getFile (@root)")).endsWith (":frontier.root"), true);
		checkThat ("and so does the name root, the way rootUpdates.update asks", String (valueOf (theOpen, "window.getFile (string.parseAddress (@root) [1])")).endsWith (":frontier.root"), true);
		checkThat ("an object inside the root answers the empty string", valueOf (theOpen, "window.getFile (@workspace.notepad)"), "");
		checkThat ("a guest database's root answers its file", valueOf (theOpen, "window.getFile (address (\"[\\\"Macintosh HD:x:tool.root\\\"]\"))"), "Macintosh HD:x:tool.root");
		theOpen.theStore.close ();
		theOpen = openTheDatabase (pathDatabase, {flCorralPaths: false}); //the desktop's setting -- table.inGuestDatabase asks file.exists of a bare name, which the corral refuses and the desktop answers false
		//9/12/26 by CC -- Copy Address (system.menus.scripts.copyAddressCommand) pops a system.paths prefix off the address: sizeof of an address is its path's length (langgetvalsize), and beginsWith coerces an address to its path (stringcomparevalue)
		checkThat ("sizeof of an address is the length of its path, the kernel's langgetvalsize", valueOf (theOpen, "sizeof (@system.verbs.builtins)"), "system.verbs.builtins".length);
		checkThat ("a string beginsWith an address compares against the address's path", valueOf (theOpen, "local (a = @system.verbs.builtins); \"system.verbs.builtins.x\" beginsWith a"), true);
		checkThat ("and contains, the same way", valueOf (theOpen, "local (a = @verbs.builtins); \"system.verbs.builtins.x\" contains a"), true);
		checkThat ("copyAddressCommand's loop pops the system.paths prefix", valueOf (theOpen, "local (s = \"system.verbs.builtins.xml.rss.getFeedItems\", adr)\nfor adr in @system.paths\n\tif s beginswith adr^\n\t\ts = string.delete (s, 1, sizeof (adr^) + 1)\n\t\tbreak\ns"), "xml.rss.getFeedItems");
		checkThat ("so bookmarksMenu.getLogic makes an object bookmark", valueOf (theOpen, "local (logic, title); bookmarksMenu.getLogic (@workspace.notepad, @logic, @title); logic"), "bookmarksMenu.openObject (\"workspace.notepad\", \"<<title>>\")");
		}

	function testMenubarRoundTrip () {

		/*  8/24/26 by CC -- DW was moving a menubar with export.sendObject
			and pack refused menubars. The loop through his own scripts: the
			real DW menu out through fatPages.buildPageAtts, deleted,
			brought back by fatPages.importFatFile, commands still carrying
			their keys and scripts after a restart.  */

		section ("A menubar out to a fat page and back");

		const pathDatabase = freshDatabase ("menubarLoop");
		const theOpen = openTheDatabase (pathDatabase);
		const pathFolder = pathTool.join (folderScratch, "files");
		if (!fs.existsSync (pathFolder)) {
			fs.mkdirSync (pathFolder, {recursive: true});
			}
		const pathPage = pathTool.join (pathFolder, "customMenu.ftmb");

		/*  9/4/26 by CC -- frontier.root is virgin now, DW's ruling: user.menus
			holds tools alone, the way the 2012 opml.root ships, and his DW
			menu is his. The test brings the menu in first from the model fat
			page misc/menus.customMenu.ftmb (his 8/24 export), the way a
			person would, and then round-trips it.  */

		fs.copyFileSync (pathTool.join (__dirname, "menus.customMenu.ftmb"), pathTool.join (pathFolder, "dwMenu.ftmb"));
		checkThat ("the DW menu imports from his fat page", valueOf (theOpen, "string (fatPages.importFatFile (\"Macintosh HD:ccTest:dwMenu.ftmb\"))"), "user.menus.customMenu");

		checkThat ("typeOf answers menubartype", valueOf (theOpen, "typeOf (user.menus.customMenu)"), "mbar");
		checkThat ("and Frontier.getFileType maps it", valueOf (theOpen, "Frontier.getFileType (typeOf (user.menus.customMenu))"), "FTmb");
		checkThat ("date () reads the product's own date text", valueOf (theOpen, "date.second (date (\"8/23/2026; 10:30:45 PM\"))"), 45); //8/24/26 by CC -- it quietly answered the current time before

		const ctLinesBefore = theOpen.theStore.odb.user.menus.customMenu.lines.length;
		checkThat ("the DW menu is here to test with", ctLinesBefore > 100, true);

		runText (theOpen, [
			"new (tableType, @scratchpad.ccMenuPage)",
			"scratchpad.ccMenuPage.adrobject = @user.menus.customMenu",
			"scratchpad.ccMenuPage.adrPageData = @user.menus.customMenu",
			"scratchpad.ccMenuText = fatPages.buildPageAtts (@scratchpad.ccMenuPage)"
			].join ("\n"));
		fs.writeFileSync (pathPage, String (runText (theOpen, "scratchpad.ccMenuText")), "latin1");
		checkThat ("a fat page came out", fs.statSync (pathPage).size > 0, true);

		runText (theOpen, "delete (@user.menus.customMenu)");

		const theBack = openTheDatabase (pathDatabase);
		checkThat ("import answers where it landed", valueOf (theBack, "string (fatPages.importFatFile (\"Macintosh HD:ccTest:customMenu.ftmb\"))"), "user.menus.customMenu");

		const theCheck = openTheDatabase (pathDatabase); //a restart
		checkThat ("it came home a menubar", valueOf (theCheck, "typeOf (user.menus.customMenu)"), "mbar");
		const theMenubar = theCheck.theStore.odb.user.menus.customMenu;
		checkThat ("with every line", theMenubar.lines.length, ctLinesBefore);
		var ctScripts = 0;
		theMenubar.lines.forEach (function (theLine) {
			if (theLine.script !== undefined) {
				ctScripts++;
				}
			});
		checkThat ("and the commands kept their scripts", ctScripts > 100, true);
		}

	function testEnvironmentTable () {

		/*  8/27/26 by CC -- DW's ruling 8/26: build system.environment
			truthfully at startup the way the kernel does (initenvironment in
			langstartup.c). The table had isMac false on his Mac, which is
			the bug under file.openFolder and getSpecialFolderPath, and no
			isCarbon at all, which stopped writingAFile. isCarbon is FALSE by
			his ruling, on Brent's answer -- Carbon is long gone -- overriding
			the 2011 kernel's true.  */

		section ("The environment table tells the truth about this machine");

		const langstartup = require (folderUsertalk + "langstartup.js");
		const pathDatabase = freshDatabase ("environment");
		const theOpen = openTheDatabase (pathDatabase);
		langstartup.initEnvironment (theOpen.theStore);

		const flMac = (process.platform === "darwin");
		const flWindows = (process.platform === "win32");
		checkThat ("isMac tells the truth", valueOf (theOpen, "system.environment.isMac"), flMac);
		checkThat ("isWindows tells the truth", valueOf (theOpen, "system.environment.isWindows"), flWindows);
		checkThat ("isCarbon is false, his ruling", valueOf (theOpen, "system.environment.isCarbon"), false);
		checkThat ("isMacOsClassic is false", valueOf (theOpen, "system.environment.isMacOsClassic"), false);
		checkThat ("isFrontier is true", valueOf (theOpen, "system.environment.isFrontier"), true);
		checkThat ("isPike is false", valueOf (theOpen, "system.environment.isPike"), false);
		checkThat ("isRadio is false", valueOf (theOpen, "system.environment.isRadio"), false);
		checkThat ("isOpmlEditor is false -- DW's 9/5 ruling, the app is Frontier", valueOf (theOpen, "system.environment.isOpmlEditor"), false);
		checkThat ("isAtlantis is true -- the flag that guides us, his 9/5 ruling", valueOf (theOpen, "system.environment.isAtlantis"), true);
		checkThat ("osMajorVersion is a real number", valueOf (theOpen, "system.environment.osMajorVersion > 0"), true);
		checkThat ("osVersionString has something in it", valueOf (theOpen, "sizeof (system.environment.osVersionString) > 0"), true);
		if (flMac) {
			checkThat ("osBuildNumber came from sw_vers", valueOf (theOpen, "sizeof (system.environment.osBuildNumber) > 0"), true);
			checkThat ("osFullNameForDisplay came from sw_vers", valueOf (theOpen, "sizeof (system.environment.osFullNameForDisplay) > 0"), true);
			}

		/*  writingAFile's exact stop: reading isCarbon threw because the
			name did not exist. It reads now.  */

		checkThat ("reading isCarbon does not throw", valueOf (theOpen, "defined (system.environment.isCarbon)"), true);

		/*  the second call writes nothing new -- the table is already
			truthful, so a launch on an up-to-date database costs no writes  */

		const ctBefore = Number (runText (theOpen, "sizeof (system.environment)"));
		langstartup.initEnvironment (theOpen.theStore);
		checkThat ("a second init adds nothing", valueOf (theOpen, "sizeof (system.environment)"), ctBefore);
		}

	function testTableEditing () {

		/*  8/27/26 by CC -- the table window learned to edit, DW's go-ahead.
			The value-cell rules come from tablegetwpedittext in tableedit.c:
			the typed text is run as a script, a failed run on a non-string
			cell is retried with quotes around it, and the result is coerced
			to the old value's type -- a cell that never had a value takes the
			new value's own type. Renaming keeps the row -- same id, same
			children -- and a collision is refused.  */

		section ("Table cells edit by the kernel's rules");

		const tableedit = require (folderUsertalk + "tableedit.js");
		const pathDatabase = freshDatabase ("tableEditing");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, [
			"new (tableType, @scratchpad.ccCells)",
			"scratchpad.ccCells.aNumber = 6",
			"scratchpad.ccCells.aString = \"hello\"",
			"scratchpad.ccCells.aBool = true",
			"scratchpad.ccCells.aDate = date (\"8/27/2026; 10:00:00 AM\")"
			].join ("\n"));

		function editOn (oldType, theText) {
			return (tableedit.editCellValue ({
				oldType,
				theText,
				evaluateText: function (theExpressionText) {
					return (runText (theOpen, theExpressionText));
					},
				coerceText: function (theExpressionText, theSeedValue) {
					theOpen.environment.frames.push ({vars: {ccCellValue: theSeedValue}});
					try {
						return (runText (theOpen, theExpressionText));
						}
					finally {
						theOpen.environment.frames.pop ();
						}
					}
				}));
			}

		checkThat ("2 + 2 into a number cell lands 4", editOn ("number", "2 + 2").theValue, 4);
		checkThat ("a bare word into a string cell is the text", editOn ("string", "abc").theValue, "abc");
		checkThat ("2 + 2 into a string cell is \"4\" -- the run wins, then the coercion", editOn ("string", "2 + 2").theValue, "4");
		checkThat ("a bare word into a boolean cell is true -- stringtoboolean's rule, any non-empty string that isn't false", editOn ("boolean", "certainly").theValue, true);
		checkThat ("and the word false is false", editOn ("boolean", "false").theValue, false);
		checkThat ("true into a boolean cell is the boolean", editOn ("boolean", "true").theValue, true);
		checkThat ("a fresh cell takes the run's own type", editOn ("novalue", "2 + 2").theValue, 4);
		checkThat ("a fresh cell takes a bare word as a string", editOn ("novalue", "so it begins").theValue, "so it begins");
		checkThat ("empty text on a number cell changes nothing", editOn ("number", "").flChanged, false);
		checkThat ("a word that can't be a number is refused", (function () {
			try {
				editOn ("number", "elephant");
				return ("no error");
				}
			catch (err) {
				return (err.message.indexOf ("Can't set the value") === 0);
				}
			}) (), true);
		checkThat ("a table cell isn't editable", tableedit.flCellEditable ("table"), false);
		checkThat ("a script cell isn't editable", tableedit.flCellEditable ("script"), false);
		checkThat ("a date cell takes the product's own date text", editOn ("date", "8/27/2026; 11:30:00 AM").theValue instanceof Date, true);

		section ("Renaming keeps the row; a collision is refused");

		const renameAnswer = theOpen.theStore.renameForPath (["scratchpad", "ccCells", "aNumber"], "theNumber");
		checkThat ("the rename went through", renameAnswer.flRenamed, true);
		checkThat ("the value followed the new name", valueOf (theOpen, "scratchpad.ccCells.theNumber"), 6);
		checkThat ("the old name is gone", valueOf (theOpen, "defined (scratchpad.ccCells.aNumber)"), false);
		const theCollision = theOpen.theStore.renameForPath (["scratchpad", "ccCells", "theNumber"], "aString");
		checkThat ("a collision is refused", theCollision.flRenamed, false);
		checkThat ("with the reason in the message", theCollision.message.indexOf ("an item with that name already exists") !== -1, true); //9/14/26 by CC -- the kernel's badrenameerror text, now that table.rename shares the code
		const caseCollision = theOpen.theStore.renameForPath (["scratchpad", "ccCells", "theNumber"], "ASTRING");
		checkThat ("unicase, the odb's way", caseCollision.flRenamed, false);
		const sameRow = theOpen.theStore.renameForPath (["scratchpad", "ccCells", "theNumber"], "TheNumber");
		checkThat ("recasing a name is allowed -- it's the same row", sameRow.flRenamed, true);

		runText (theOpen, "new (tableType, @scratchpad.ccCells.inner); scratchpad.ccCells.inner.deep = 99");
		theOpen.theStore.renameForPath (["scratchpad", "ccCells", "inner"], "renamedInner");
		checkThat ("a renamed table keeps its children", valueOf (theOpen, "scratchpad.ccCells.renamedInner.deep"), 99);

		section ("A table's column widths ride with the table");

		checkThat ("no formats yet", theOpen.theStore.formatsForPath (["scratchpad", "ccCells"]), undefined);
		checkThat ("setting them works", theOpen.theStore.setFormatsForPath (["scratchpad", "ccCells"], {colWidths: [220, 340]}), true);
		checkThat ("and they read back", theOpen.theStore.formatsForPath (["scratchpad", "ccCells"]), {colWidths: [220, 340]});
		checkThat ("a scalar refuses formats", theOpen.theStore.setFormatsForPath (["scratchpad", "ccCells", "aString"], {colWidths: [1, 2]}), false);

		const theReopen = openTheDatabase (pathDatabase); //a restart
		checkThat ("the widths survive a restart", theReopen.theStore.formatsForPath (["scratchpad", "ccCells"]), {colWidths: [220, 340]});
		checkThat ("and the table still reads as a table", valueOf (theReopen, "typeOf (scratchpad.ccCells)"), "tabl");
		checkThat ("with its values intact", valueOf (theReopen, "scratchpad.ccCells.aString"), "hello");

		runText (theReopen, "scratchpad.ccReplacement = \"x\""); //warm up, then replace the table wholesale
		runText (theReopen, "new (tableType, @scratchpad.ccFresh); scratchpad.ccFresh.one = 1; scratchpad.ccCells = scratchpad.ccFresh");
		checkThat ("replacing the table replaces the formats too -- the kernel's way", theReopen.theStore.formatsForPath (["scratchpad", "ccCells"]), undefined);
		}

	function testWebserverUtils () {

		/*  8/31/26 by CC -- DW's report: tcp.httpReadUrl stopped with "Can't
			call the kernel verb webserver.parseheaders because it isn't
			implemented in the verb library." The chain is httpReadUrl ->
			string.httpResultSplit -> webserver.util.parseHeaders -> the
			kernel. These call through the DATABASE GLUE so name-to-glue-to-
			kernel stays proven, the way the crypto test does.  */

		section ("The webserver utility verbs, from the C");

		const pathDatabase = freshDatabase ("webserverUtils");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, "scratchpad.ccResponse = \"HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nSet-Cookie: a=1\\r\\nSet-Cookie: b=2\\r\\nNoColonLine\\r\\n\\r\\nthe body\"");
		runText (theOpen, "new (tableType, @scratchpad.ccHeaders)");
		checkThat ("parseHeaders answers the first line",
			valueOf (theOpen, "webserver.util.parseHeaders (scratchpad.ccResponse, @scratchpad.ccHeaders)"), "HTTP/1.1 200 OK");
		checkThat ("a header landed in the table", valueOf (theOpen, "scratchpad.ccHeaders.[\"Content-Type\"]"), "text/html");
		checkThat ("a repeated header accumulates into a list", valueOf (theOpen, "sizeof (scratchpad.ccHeaders.[\"Set-Cookie\"])"), 2);
		checkThat ("with both values", valueOf (theOpen, "scratchpad.ccHeaders.[\"Set-Cookie\"] [2]"), "b=2");
		checkThat ("a line with no colon is a label with an empty value", valueOf (theOpen, "scratchpad.ccHeaders.NoColonLine"), "");
		checkThat ("the body stayed out of the table", valueOf (theOpen, "defined (scratchpad.ccHeaders.[\"the body\"])"), false);

		checkThat ("string.httpResultSplit answers the body -- the exact chain that stopped",
			valueOf (theOpen, "string.httpResultSplit (scratchpad.ccResponse, @scratchpad.ccSplitHeaders)"), "the body");
		checkThat ("and its header table filled in", valueOf (theOpen, "scratchpad.ccSplitHeaders.[\"Content-Type\"]"), "text/html");

		runText (theOpen, "new (tableType, @scratchpad.ccParams); new (tableType, @scratchpad.ccParams.requestHeaders)");
		runText (theOpen, "scratchpad.ccParams.requestHeaders.Cookie = \"name=dave; color=blue\"");
		checkThat ("parseCookies answers true when there's a Cookie header",
			valueOf (theOpen, "webserver.util.parseCookies (@scratchpad.ccParams)"), true);
		checkThat ("and unpacks the cookies", valueOf (theOpen, "scratchpad.ccParams.requestHeaders.cookies.name"), "dave");
		checkThat ("all of them", valueOf (theOpen, "scratchpad.ccParams.requestHeaders.cookies.color"), "blue");
		runText (theOpen, "new (tableType, @scratchpad.ccBare); new (tableType, @scratchpad.ccBare.requestHeaders)");
		checkThat ("no Cookie header answers false", valueOf (theOpen, "webserver.util.parseCookies (@scratchpad.ccBare)"), false);

		checkThat ("getServerString names the product", valueOf (theOpen, "webserver.util.getServerString () beginsWith \"Frontier/\""), true);

		runText (theOpen, "new (tableType, @scratchpad.ccRespHeaders); scratchpad.ccRespHeaders.[\"Content-Type\"] = \"text/plain\"");
		runText (theOpen, "scratchpad.ccBuilt = webserver.util.buildResponse (200, @scratchpad.ccRespHeaders, \"hello\")");
		checkThat ("buildResponse starts with the status line",
			valueOf (theOpen, "scratchpad.ccBuilt beginsWith \"HTTP/1.1 200 OK\\r\\n\""), true);
		checkThat ("the body rides after the blank line", valueOf (theOpen, "scratchpad.ccBuilt endsWith \"\\r\\n\\r\\nhello\""), true);
		checkThat ("Content-Length was counted", valueOf (theOpen, "scratchpad.ccBuilt contains \"Content-Length: 5\\r\\n\""), true);
		checkThat ("the caller's header rode along", valueOf (theOpen, "scratchpad.ccBuilt contains \"Content-Type: text/plain\\r\\n\""), true);
		checkThat ("and the kernel stamps the caller's table -- the side effect is part of the verb",
			valueOf (theOpen, "scratchpad.ccRespHeaders.Connection"), "close");
		checkThat ("an unknown code says so", valueOf (theOpen, "webserver.util.buildResponse (299) beginsWith \"HTTP/1.1 299 UNKNOWN\""), true);
		}

	function testBuiltinsSweep () {

		/*  8/31/26 by CC -- DW's instruction: "make a sweep of the entire
			builtins functionality and fill in all the functions you're
			missing." These are the verbs that sweep filled in, each behavior
			from the C: the date family, the clock waits, the string
			encodings, the XML-RPC coercions, lang.evaluate, file.readLine.
			Calls go through the database glue wherever glue exists.  */

		section ("The builtins sweep -- dates, clocks, strings, xml-rpc");

		const pathDatabase = freshDatabase ("builtinsSweep");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, "scratchpad.ccDate = date (\"8/31/2026; 1:30:45 PM\")");
		checkThat ("date.dayString answers the full weekday", valueOf (theOpen, "date.dayString (scratchpad.ccDate)"), "Monday");
		checkThat ("date.longString answers the long form", valueOf (theOpen, "date.longString (scratchpad.ccDate)"), "August 31, 2026");
		checkThat ("date.abbrevString answers the medium form", valueOf (theOpen, "date.abbrevString (scratchpad.ccDate)"), "Aug 31, 2026");
		checkThat ("date.monthToString answers the month name", valueOf (theOpen, "date.monthToString (8)"), "August");
		checkThat ("date.monthToString refuses 13 with the kernel's sentence",
			valueOf (theOpen, "date.monthToString (13)"), "ERROR: Can't convert 13 to a string because it is not between 1 and 12.");
		checkThat ("date.dayOfWeekToString answers the day name", valueOf (theOpen, "date.dayOfWeekToString (1)"), "Sunday");
		checkThat ("date.nextWeek is seven days on", valueOf (theOpen, "date.day (date.nextWeek (scratchpad.ccDate))"), 7);
		checkThat ("date.prevWeek is seven days back", valueOf (theOpen, "date.day (date.prevWeek (scratchpad.ccDate))"), 24);
		checkThat ("date.nextYear keeps the day and moves the year", valueOf (theOpen, "date.year (date.nextYear (scratchpad.ccDate))"), 2027);
		checkThat ("date.prevYear goes BACKWARD -- the 2011 port's prevyear goes forward, a port bug",
			valueOf (theOpen, "date.year (date.prevYear (scratchpad.ccDate))"), 2025);
		checkThat ("date.weeksInMonth counts the calendar rows", valueOf (theOpen, "date.weeksInMonth (scratchpad.ccDate)"), 6); //August 2026: the 1st is a Saturday, 31 days
		checkThat ("clock.waitSeconds answers true", valueOf (theOpen, "clock.waitSeconds (0)"), true);

		checkThat ("string.latinToMac converts an accented e", valueOf (theOpen, "string.latinToMac (string (char (233))) == string (char (142))"), true);
		checkThat ("string.macToLatin converts it back", valueOf (theOpen, "string.macToLatin (string (char (142))) == string (char (233))"), true);
		checkThat ("string.iso8859Encode makes an entity of a high character",
			valueOf (theOpen, "string.iso8859Encode (\"caf\" + string (char (142)), nil)"), "caf&eacute;");
		checkThat ("davenetMassager wraps by words", valueOf (theOpen, "string.davenetMassager (0, 200, \"one two\")"), "one two ");
		checkThat ("lang.evaluate runs the text and answers its value", valueOf (theOpen, "lang.evaluate (\"2 + 3\")"), 5);
		checkThat ("thread.getCount answers the one thread", valueOf (theOpen, "thread.getCount ()"), 1);
		checkThat ("sys.machine answers Macintosh", valueOf (theOpen, "sys.machine ()"), "Macintosh");
		checkThat ("a table meeting a string is an error, not [object Object] (langexternalcoercetostring)", valueOf (theOpen, "local (t); new (tableType, @t); \"code \" + t"), "ERROR: Can't coerce a table to a string."); //9/17/26 by CC -- betty.rpc.client's fault message read "returned error code [object Object]"

		section ("The XML-RPC coercion verbs");

		checkThat ("valToString tags an integer", valueOf (theOpen, "xml.valToString (41)"), "<i4>41</i4>");
		checkThat ("valToString tags a boolean as a bit", valueOf (theOpen, "xml.valToString (true)"), "<boolean>1</boolean>");
		checkThat ("valToString tags a double", valueOf (theOpen, "xml.valToString (3.25)"), "<double>3.25</double>");
		checkThat ("valToString escapes a string without tags", valueOf (theOpen, "xml.valToString (\"a < b & c\")"), "a &lt; b &amp; c");
		checkThat ("valToString tags a date the iso8601 way",
			valueOf (theOpen, "xml.valToString (scratchpad.ccDate)"), "<dateTime.iso8601>20260831T13:30:45</dateTime.iso8601>");

		runText (theOpen, "new (tableType, @scratchpad.ccStruct); scratchpad.ccStruct.ctBugs = 4; scratchpad.ccStruct.flReal = true; scratchpad.ccStruct.theName = \"dave\"");
		runText (theOpen, "scratchpad.ccTagged = xml.coercions.frontierValueToTaggedText (@scratchpad.ccStruct, 0)"); //the glue lives at xml.coercions, the kernel names underneath
		checkThat ("a table becomes a struct", valueOf (theOpen, "scratchpad.ccTagged beginsWith \"<struct>\""), true);
		checkThat ("with its members named", valueOf (theOpen, "scratchpad.ccTagged contains \"<name>ctBugs</name>\""), true);
		checkThat ("and its values tagged", valueOf (theOpen, "scratchpad.ccTagged contains \"<i4>4</i4>\""), true);
		checkThat ("a list becomes an array", valueOf (theOpen, "scratchpad.ccList = {1, 2}; xml.coercions.frontierValueToTaggedText (@scratchpad.ccList, 0) beginsWith \"<array>\""), true);

		runText (theOpen, "scratchpad.ccRpcText = \"<?xml version=\\\"1.0\\\"?><methodResponse><params><param><value><struct><member><name>state</name><value><string>Colorado</string></value></member><member><name>ctVotes</name><value><i4>10</i4></value></member></struct></value></param></params></methodResponse>\"");
		runText (theOpen, "xml.compile (scratchpad.ccRpcText, @scratchpad.ccCompiled)");
		runText (theOpen, "local (adrResponse = xml.getAddress (@scratchpad.ccCompiled, \"methodResponse\")); local (adrParams = xml.getAddress (adrResponse, \"params\")); local (adrParam = xml.getAddress (adrParams, \"param\")); local (adrValue = xml.getAddress (adrParam, \"value\")); local (adrStruct = xml.getAddress (adrValue, \"struct\")); xml.coercions.structToFrontierValue (adrStruct, @scratchpad.ccBack)");
		checkThat ("structToFrontierValue rebuilds the table", valueOf (theOpen, "typeOf (scratchpad.ccBack)"), "tabl");
		checkThat ("with the string member", valueOf (theOpen, "scratchpad.ccBack.state"), "Colorado");
		checkThat ("and the i4 member as a long", valueOf (theOpen, "typeOf (scratchpad.ccBack.ctVotes)"), "long");
		checkThat ("worth 10", valueOf (theOpen, "scratchpad.ccBack.ctVotes"), 10);
		}

	function testExportCursorPart () {

		/*  9/1/26 by CC -- DW's fire alarm: Export cursor part stopped with
			"Can't call file.settype because it isn't implemented yet." The
			command hadn't changed; the environment had -- isMac answers true
			since 8/27, so file.writeWholeFile's glue reaches its setType
			branch now. This runs his exact path headless: export.sendObject
			on an outline, through the glue, type and creator and all.  */

		section ("Export cursor part -- the whole path, type and creator included");

		const pathDatabase = freshDatabase ("exportPath");
		const theOpen = openTheDatabase (pathDatabase);

		checkThat ("file.setType writes the type", valueOf (theOpen, "file.writeWholeFile (\"Macintosh HD:ccTest:typed.txt\", \"hello\"); file.setType (\"Macintosh HD:ccTest:typed.txt\", 'TEXT')"), true);
		checkThat ("file.setCreator writes the creator", valueOf (theOpen, "file.setCreator (\"Macintosh HD:ccTest:typed.txt\", 'LAND')"), true);
		checkThat ("file.creator reads it back", valueOf (theOpen, "file.creator (\"Macintosh HD:ccTest:typed.txt\")"), "LAND");
		checkThat ("file.type reads it back", valueOf (theOpen, "file.type (\"Macintosh HD:ccTest:typed.txt\")"), "TEXT");

		runText (theOpen, "system.environment.isMac = true"); //the server rebuilds the environment at startup; the headless harness sets the one value the glue branches on
		checkThat ("export.sendObject exports an outline -- his exact fire path",
			valueOf (theOpen, "export.sendObject (@workspace.notepad, \"Macintosh HD:ccTest:notepad.ftop\")"), true);
		checkThat ("the exported fat page is on disk with its directives",
			valueOf (theOpen, "file.readWholeFile (\"Macintosh HD:ccTest:notepad.ftop\") contains \"#adrPageData\""), true);
		checkThat ("and it carries the creator Frontier stamps on exports", valueOf (theOpen, "file.creator (\"Macintosh HD:ccTest:notepad.ftop\")"), "LAND");
		checkThat ("a script exports too", valueOf (theOpen, "export.sendObject (@system.verbs.builtins.tcp.httpReadUrl, \"Macintosh HD:ccTest:script.ftsc\")"), true);
		}

	function testAddressesThroughADataFile () {

		/*  9/6/26 by CC -- THE AFTERNOON THE FIRST PART WAS TO GO OUT.
			rssCodeUpdateSuite.init does local (adrdata = Frontier.openDataFile
			("rssCodeUpdateData")), then @adrdata^.roots.[rootname] with
			rootname = "frontier.root". Two things broke it. Frontier.openDataFile
			keeps the data file's address in system.temp.frontier.datafiles and
			answers THAT from the second call on, and an address that came back
			out of the database was not accepted as the base of a new one --
			"Can't set the value at (deref).roots because one of the tables on
			the way doesn't exist." And the text of an address whose last name
			holds a dot was written without its brackets, so string (), nameOf
			and the window title all read roots.frontier.root, two names. The
			kernel writes roots.["frontier.root"].  */

		section ("An address through a data file, and a name with a dot in it");

		const pathDatabase = freshDatabase ("dataFile");
		const theOpen = openTheDatabase (pathDatabase, {flCorralPaths: false}); //the desktop's setting: file.sureFilePath walks up to the volume, and a colon path means what it says

		runText (theOpen, "new (tabletype, @system.temp.frontier)"); //emptied at every launch; the startupScript makes it before anything calls openDataFile
		checkThat ("Frontier.openDataFile makes the data file and answers its address",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\")); typeof (adrdata)"), "addr");
		checkThat ("the second call answers the address it kept in system.temp, and it is still an address",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\")); typeof (adrdata)"), "addr");
		checkThat ("a table comes into being through it -- his init's first new ()",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\")); new (tabletype, @adrdata^.roots); defined (adrdata^.roots)"), true);
		checkThat ("and a table named with a dot, through a bracketed computed name",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\"), rootname = \"frontier.root\"); local (adrroot = @adrdata^.roots.[rootname]); new (tabletype, adrroot); adrroot^.prefs = 1; sizeof (adrdata^.roots)"), 1);
		checkThat ("the entry's name is the whole dotted name",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\")); local (adr, names = {}); for adr in @adrdata^.roots {names = names + nameOf (adr^)}; names"), ["frontier.root"]);
		checkThat ("its address reads with the brackets the kernel writes",
			valueOf (theOpen, "string (@scratchpad.ccDots.[\"frontier.root\"])"), "scratchpad.ccDots.[\"frontier.root\"]");
		checkThat ("and a database's own path in the base keeps its brackets too",
			valueOf (theOpen, "local (adrdata = Frontier.openDataFile (\"ccDataFile\")); string (@adrdata^.roots) beginsWith \"[\\\"\""), true);
		checkThat ("an address stored in a table and read back is a base for a new address",
			valueOf (theOpen, "new (tabletype, @scratchpad.ccDots); scratchpad.ccAdr = @scratchpad.ccDots; local (a = scratchpad.ccAdr); new (tabletype, @a^.sub); defined (scratchpad.ccDots.sub)"), true);
		}

	function testStraightCodeScripts () {

		/*  9/4/26 by CC -- the 2012 opml.root's scheduler.init is straight
			code ending in three bundles, one of which makes
			user.scheduler.tasks; the startupScript reads that table right
			after. The trailing bundles were being skipped as test code, which
			is the convention for scripts WITH handlers, not for these -- the
			kernel's foundbody path runs the whole module. And the one-line
			try/else the 2012 op.xmlToOutline writes has to parse.  */

		section ("Straight-code scripts run whole, and the one-line try/else parses");

		const pathDatabase = freshDatabase ("straightCode");
		const theOpen = openTheDatabase (pathDatabase);

		theOpen.theStore.odb.scratchpad.ccStraight = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "scratchpad.ccMark = 1", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "bundle //the body's last part, not test code", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "scratchpad.ccMark = 2", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		runText (theOpen, "scratchpad.ccStraight ()");
		checkThat ("a straight-code script's trailing bundle runs when the script is called", valueOf (theOpen, "scratchpad.ccMark"), 2);

		theOpen.theStore.odb.scratchpad.ccWithHandler = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on ccWithHandler ()", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (7)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 0, text: "bundle //test code", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "scratchpad.ccMark = 99", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		checkThat ("a script with a matching handler runs the handler alone", valueOf (theOpen, "scratchpad.ccWithHandler ()"), 7);
		checkThat ("and its trailing test bundle never runs on a call", valueOf (theOpen, "scratchpad.ccMark"), 2);

		checkThat ("scheduler0.init makes user.scheduler0.tasks (the 2012 root's straight-code init, the 1999 suite renamed 9/5)", valueOf (theOpen, "delete (@user.scheduler0.tasks); scheduler0.init (); defined (user.scheduler0.tasks.everyMinute.taskTime)"), true);
		checkThat ("try {a; b} else {c} on one line parses and takes the else", valueOf (theOpen, "local (t = {}, text); try {text = t.nothing; text = \"had\"} else {text = \"none\"}; text"), "none");
		}

	function testRuledEdits () {

		/*  9/5/26 by CC -- DW's rulings on the 2012 root's own scripts, applied
			by misc/ruledEdits.js and checked here so a rebuilt root can't lose
			them: the schedulers renamed (his 2008 rewrite is scheduler, the
			1999 suite is scheduler0), the startupScript's user-info card
			skipped when isAtlantis is true, the bookmarks menu built when it
			is. And the whole rename has to hang together: every caller moved
			with the tables.  */

		section ("The ruled edits: the schedulers renamed, isAtlantis in the startup scripts");

		const pathDatabase = freshDatabase ("ruledEdits");
		const theOpen = openTheDatabase (pathDatabase);
		const langstartup = require (folderUsertalk + "langstartup.js");
		langstartup.initEnvironment (theOpen.theStore);

		checkThat ("system.verbs.builtins.scheduler is the 2008 suite (it has thread.script)", valueOf (theOpen, "defined (system.verbs.builtins.scheduler.thread.script)"), true);
		checkThat ("system.verbs.builtins.scheduler0 is the 1999 suite (it has doSubTasks)", valueOf (theOpen, "defined (system.verbs.builtins.scheduler0.doSubTasks)"), true);
		checkThat ("there is no scheduler2 any more", valueOf (theOpen, "defined (system.verbs.builtins.scheduler2)"), false);
		checkThat ("user.scheduler is the 2008 suite's table (everyMinute, hourly, overnight)", valueOf (theOpen, "defined (user.scheduler.everyMinute) and defined (user.scheduler.hourly) and defined (user.scheduler.overnight)"), true);
		checkThat ("user.scheduler0 is the 1999 suite's (threads)", valueOf (theOpen, "defined (user.scheduler0.threads)"), true);
		checkThat ("scheduler.init runs and makes system.temp.scheduler", valueOf (theOpen, "scheduler.init (); defined (system.temp.scheduler.threadIDs)"), true);
		checkThat ("the webserver prefilter address follows the rename", valueOf (theOpen, "string (user.webserver.preFilters.scheduler)"), "system.verbs.builtins.scheduler.webserverFilter");
		checkThat ("the startupScript calls both inits by their new names", valueOf (theOpen, "local (s = string (system.startup.startupScript)); (s contains \"scheduler0.init ()\") and (s contains \"scheduler.init ()\")"), true);
		checkThat ("no script in the root still calls scheduler2 by name", (function () {
			var ctCalls = 0;
			const sqlite3 = require (pathTool.join (__dirname, "..", "node_modules", "better-sqlite3"));
			const db = new sqlite3 (pathDatabase, {readonly: true});
			db.prepare ("select value from odb where type in ('script', 'outline', 'menubar') and lower (value) like '%scheduler2.%';").all ().forEach (function (theRow) {
				try {
					JSON.parse (theRow.value).forEach (function (theLine) {
						if ((theLine.flComment !== true) && (/(?<![\w])scheduler2\.\w/i.test (theLine.text))) {
							ctCalls++;
							}
						});
					}
				catch (err) {
					}
				});
			db.close ();
			return (ctCalls);
			}) (), 0);

		checkThat ("the startupScript skips the user-info card when isAtlantis is true", valueOf (theOpen, "string (system.startup.startupScript) contains \"(not system.environment.isAtlantis)\""), true);
		checkThat ("bookmarksMenu.init builds the bookmarks menu when isAtlantis is true", valueOf (theOpen, "string (system.verbs.builtins.bookmarksMenu.init) contains \"if system.environment.isAtlantis\""), true);
		checkThat ("and it does: user.bookmarksMenu.menu comes back after bookmarksMenu.init", valueOf (theOpen, "delete (@user.bookmarksMenu.menu); bookmarksMenu.init (); typeOf (user.bookmarksMenu.menu)"), "mbar");
		checkThat ("Frontier.getProgramName says Frontier now, not OPML Editor", valueOf (theOpen, "Frontier.getProgramName () beginsWith \"UserLand Frontier\""), true);
		checkThat ("Frontier.version answers 11.0, his 9/5 ruling", valueOf (theOpen, "Frontier.version ()"), "11.0");
		checkThat ("the 2012 root's dotOpml.root leftover is out of the top level, his 9/5 ruling", (function () {
			var ct = 0;
			Reflect.ownKeys (theOpen.theStore.odb).forEach (function (theName) {
				if ((typeof theName === "string") && (theName.toLowerCase ().indexOf ("dotopml.root") !== -1)) {
					ct++;
					}
				});
			return (ct);
			}) (), 0);
		}

	function testCallScriptByName () {

		/*  9/15/26 by CC -- callScript's first form takes the script's NAME
			as a string (callscriptverb, langverbs.c: bsscriptname, then
			langrunscript finds it on the search path). Only the address form
			worked here, so scheduler0.monitor's callScript (string
			(adrscript), {}, @logtable) failed on every task, inside its own
			try -- the 1999 scheduler's every-minute, hourly and overnight
			tables never ran, and the Tools' background scripts with them.
			The third parameter, the table in scope, has to reach the scripts
			the called script calls, the way the kernel's chained context
			does.  */

		section ("callScript by name, and the table in scope reaches nested calls");

		const pathDatabase = freshDatabase ("callscript");
		const theOpen = openTheDatabase (pathDatabase);

		function scriptOf (theLines) { //a script object the way the store holds one
			const lines = [];
			theLines.forEach (function (theLine) {
				const bare = theLine.replace (/^\t+/, "");
				lines.push ({level: theLine.length - bare.length, text: bare, flComment: false});
				});
			return ({flOdbScript: true, scriptType: "script", lines});
			}
		theOpen.theStore.odb.workspace.ccCalls = {};
		theOpen.theStore.odb.workspace.ccCalls.ccAdd = scriptOf (["on ccAdd (a, b)", "\treturn (a + b)"]);
		theOpen.theStore.odb.workspace.ccCalls.ccInner = scriptOf (["on ccInner ()", "\treturn (ccSeen)"]);
		theOpen.theStore.odb.workspace.ccCalls.ccOuter = scriptOf (["on ccOuter ()", "\treturn (workspace.ccCalls.ccInner ())"]);
		checkThat ("callScript with the name as a string runs the script with its parameters", valueOf (theOpen, "callScript (\"workspace.ccCalls.ccAdd\", {2, 3})"), 5);
		checkThat ("and with the address, as before", valueOf (theOpen, "callScript (@workspace.ccCalls.ccAdd, {4, 5})"), 9);
		checkThat ("the table in scope is visible to the script called by name", valueOf (theOpen, "local (t); new (tabletype, @t); t.ccSeen = \"yes\"; callScript (\"workspace.ccCalls.ccInner\", {}, @t)"), "yes");
		checkThat ("and to a script that one calls", valueOf (theOpen, "local (t); new (tabletype, @t); t.ccSeen = \"nested\"; callScript (\"workspace.ccCalls.ccOuter\", {}, @t)"), "nested");
		checkThat ("a name that leads nowhere says so", valueOf (theOpen, "callScript (\"workspace.ccCalls.nothing\", {})").indexOf ("Can") !== -1, true);
		}

	function testQueryTheRoot () {

		/*  9/19/26 by CC -- DW, on the object database being a SQLite file: "the
			last thing is kickass!!! i want that." sql.queryRoot (sqltext,
			adrresult) sends a query to Atlantis's own database and fills a
			table with what comes back: a sub-table for each row, 00001,
			00002, a cell for each column. It can only read -- the query runs
			on a connection of its own, opened read-only, so nothing a query
			says can change the odb. address (id) is a function the query can
			call: the Frontier address of a row.  */

		section ("sql.queryRoot -- a query to Atlantis's own database, read-only");

		const pathDatabase = freshDatabase ("queryTheRoot");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, "new (tabletype, @scratchpad.ccQuery); scratchpad.ccQuery.alpha = 1; scratchpad.ccQuery.beta = \"two\"");
		const theSelect = "select name, type, id from odb where parentid = (select id from odb where lowername = 'ccquery') order by lowername";
		checkThat ("the verb answers the number of rows", valueOf (theOpen, "sql.queryRoot (\"" + theSelect + "\", @scratchpad.ccRows)"), 2);
		checkThat ("each row is a sub-table named by its number", valueOf (theOpen, "nameOf (scratchpad.ccRows [1]) + \",\" + nameOf (scratchpad.ccRows [2]) + \",\" + typeOf (scratchpad.ccRows [1])"), "00001,00002,tabl");
		checkThat ("with a cell for each column, named for the column", valueOf (theOpen, "scratchpad.ccRows [\"00001\"].name + \",\" + scratchpad.ccRows [\"00002\"].name"), "alpha,beta");
		checkThat ("an integer column is a number", valueOf (theOpen, "typeOf (scratchpad.ccRows [1].id)"), "long");
		checkThat ("address (id) answers the row's Frontier address", valueOf (theOpen, "sql.queryRoot (\"select address (id) as adr from odb where lowername = 'ccquery'\", @scratchpad.ccRows); scratchpad.ccRows [1].adr"), "scratchpad.ccQuery");
		checkThat ("a null has no cell", valueOf (theOpen, "sql.queryRoot (\"select null as empty, 1 as one\", @scratchpad.ccRows); sizeOf (scratchpad.ccRows [1])"), 1);
		checkThat ("a query that would change the database is refused", String (valueOf (theOpen, "sql.queryRoot (\"delete from odb where lowername = 'ccquery'\", @scratchpad.ccRows)")).indexOf ("ERROR: Can't run the query because") === 0, true);
		checkThat ("and the table is still there", valueOf (theOpen, "defined (scratchpad.ccQuery.alpha)"), true);
		checkThat ("a query that doesn't parse says so in a sentence", String (valueOf (theOpen, "sql.queryRoot (\"selec nothing\", @scratchpad.ccRows)")).indexOf ("ERROR: Can't run the query because") === 0, true);
		checkThat ("more rows than the limit stops at the limit", valueOf (theOpen, "sql.queryRoot (\"select id from odb\", @scratchpad.ccRows, 5)"), 5);
		}

	function testWebserver () {

		/*  9/3/26 by CC -- DW's ask for this round: "serving websites, the tcp
			stream verbs and the kernelized webserver." webserver.server,
			webserver.dispatch and inetd.supervisor are kernel verbs now,
			from langhtml.c; the stream verbs from MacSocketNetEvents.c. Here
			the server half runs on request TEXT, the way tcp.httpClient can
			call it, against the distribution's own helloWorld responder;
			the stream half opens a real socket to a small server started
			as a child process (the gate's own thread is busy waiting).  */

		section ("The webserver -- webserver.server on a request, the responders, and the stream verbs");

		const pathDatabase = freshDatabase ("webserver");
		const theOpen = openTheDatabase (pathDatabase);

		runText (theOpen, "user.webserver.responders.helloWorld.enabled = true");
		runText (theOpen, "new (tableType, @scratchpad.ccPt); scratchpad.ccPt.client = \"127.0.0.1\""); //what inetd.supervisor fills in before the daemon runs; the distribution's pre-filters read it
		const theAnswer = valueOf (theOpen, "webserver.server (@scratchpad.ccPt, \"GET /helloworld?x=1 HTTP/1.1\\r\\nHost: localhost\\r\\nUser-Agent: gate\\r\\n\\r\\n\")");
		checkThat ("webserver.server answers a whole HTTP response", String (theAnswer).startsWith ("HTTP/1.1 200"), true);
		checkThat ("from the helloWorld responder, its condition on the path", String (theAnswer).indexOf ("<body>Hello World!</body>") !== -1, true);
		checkThat ("with the Content-Type the method set", String (theAnswer).indexOf ("Content-Type: text/html") !== -1, true);
		checkThat ("the paramtable carries the method", valueOf (theOpen, "scratchpad.ccPt.method"), "GET");
		checkThat ("the path without the search args", valueOf (theOpen, "scratchpad.ccPt.path"), "/helloworld");
		checkThat ("the search args", valueOf (theOpen, "scratchpad.ccPt.searchArgs"), "x=1");
		checkThat ("the responder's name", valueOf (theOpen, "scratchpad.ccPt.responder"), "helloWorld");
		checkThat ("and the headers as a table", valueOf (theOpen, "scratchpad.ccPt.requestHeaders.[\"User-Agent\"]"), "gate");

		const theRefusal = valueOf (theOpen, "webserver.server (@scratchpad.ccPt, \"POST /helloworld HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 3\\r\\n\\r\\nabc\")");
		checkThat ("a method the responder doesn't have answers 405 (webservermethodnotallowed)", String (theRefusal).startsWith ("HTTP/1.1 405"), true);
		checkThat ("naming what it does allow", String (theRefusal).indexOf ("Allow: GET") !== -1, true);
		checkThat ("and the body came through Content-Length", valueOf (theOpen, "scratchpad.ccPt.requestBody"), "abc");

		const noHost = valueOf (theOpen, "webserver.server (@scratchpad.ccPt, \"GET / HTTP/1.1\\r\\n\\r\\n\")");
		checkThat ("an HTTP/1.1 request without a Host header is a 400", String (noHost).startsWith ("HTTP/1.1 400"), true);

		//an echoing responder of the gate's own, on the 'any' method, to see the whole paramtable round trip
		runText (theOpen, "new (tableType, @user.webserver.responders.ccEcho); user.webserver.responders.ccEcho.enabled = true; user.webserver.responders.ccEcho.condition = \"path contains \\\"ccecho\\\"\"; new (tableType, @user.webserver.responders.ccEcho.methods)");
		theOpen.theStore.odb.user.webserver.responders.ccEcho.methods.any = {flOdbScript: true, scriptType: "script", lines: [
			{level: 0, text: "on any (pta)", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "pta^.code = 201", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "pta^.responseHeaders.[\"X-Echo\"] = pta^.method", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "pta^.responseBody = pta^.requestBody", flExpanded: true, flComment: false, flBreakpoint: false},
			{level: 1, text: "return (true)", flExpanded: true, flComment: false, flBreakpoint: false}
			]};
		const theEcho = valueOf (theOpen, "webserver.server (@scratchpad.ccPt, \"PUT /ccecho HTTP/1.0\\r\\nContent-Length: 5\\r\\n\\r\\nhello\")");
		checkThat ("a responder on the any method answers any method, with its code", String (theEcho).startsWith ("HTTP/1.1 201"), true);
		checkThat ("its header", String (theEcho).indexOf ("X-Echo: PUT") !== -1, true);
		checkThat ("and its body", String (theEcho).endsWith ("\r\n\r\nhello"), true);

		//the stream verbs, against a small server in a child process
		const {spawn} = require ("child_process");
		const thePort = 5395;
		const theChild = spawn (process.execPath, ["-e", "const net = require ('net'); net.createServer (function (s) { var got = ''; s.on ('data', function (d) { got += d; if (got.indexOf ('\\r\\n\\r\\n') !== -1) { const body = 'gate says hello'; s.end ('HTTP/1.1 200 OK\\r\\nContent-Length: ' + body.length + '\\r\\n\\r\\n' + body); } }); }).listen (" + thePort + ", '127.0.0.1');"], {stdio: "ignore"});
		const theSleeper = new Int32Array (new SharedArrayBuffer (4));
		Atomics.wait (theSleeper, 0, 0, 700); //the child's listen
		try {
			checkThat ("tcp.openStream answers a stream id", valueOf (theOpen, "scratchpad.ccStream = tcp.openStream (\"127.0.0.1\", " + thePort + "); scratchpad.ccStream > 0"), true);
			checkThat ("tcp.statusStream says OPEN", valueOf (theOpen, "local (ct); tcp.statusStream (scratchpad.ccStream, @ct)"), "OPEN");
			checkThat ("tcp.writeStream sends the request", valueOf (theOpen, "tcp.writeStream (scratchpad.ccStream, \"GET / HTTP/1.1\\r\\nHost: gate\\r\\n\\r\\n\")"), true);
			checkThat ("tcp.readStreamUntil reads through the blank line into the buffer", valueOf (theOpen, "scratchpad.ccBuffer = \"\"; tcp.readStreamUntil (scratchpad.ccStream, \"\\r\\n\\r\\n\", 10, @scratchpad.ccBuffer); scratchpad.ccBuffer beginsWith \"HTTP/1.1 200\""), true);
			checkThat ("tcp.readStreamUntilClosed appends the rest", valueOf (theOpen, "tcp.readStreamUntilClosed (scratchpad.ccStream, 10, @scratchpad.ccBuffer); scratchpad.ccBuffer endsWith \"gate says hello\""), true);
			checkThat ("tcp.closeStream", valueOf (theOpen, "tcp.closeStream (scratchpad.ccStream)"), true);
			checkThat ("and a stream nobody holds reads as INACTIVE (what inetd.isDaemonRunning leans on)", valueOf (theOpen, "local (ct); tcp.statusStream (999, @ct)"), "INACTIVE");
			checkThat ("a listen with nobody to run the callback refuses with the reason", String (valueOf (theOpen, "tcp.listenStream (5394, 30, @inetd.supervisor, 5394)")).indexOf ("needs the server") !== -1, true);
			}
		finally {
			theChild.kill ();
			}

		/*  9/12/26 by CC -- DW's report, a verb that worked: rssCodeUpdateSuite.uploadRss
			stopped at S3 with "A header you provided implies functionality that is
			not implemented." The 9/11 transport drops the glue's Content-Length and
			hands the body to Node's http.request, which, given a body and no
			Content-Length, sends it chunked -- and S3 refuses chunked uploads with
			exactly that message. Here a PUT through tcp.httpTransport lands on a
			server that echoes the raw request back: Content-Length must go out and
			chunked must not.  */

		const portEcho = 5393;
		const theEchoChild = spawn (process.execPath, ["-e", "const net = require ('net'); net.createServer (function (s) { var got = ''; var timer; s.on ('data', function (d) { got += d; clearTimeout (timer); timer = setTimeout (function () { s.end ('HTTP/1.1 200 OK\\r\\nContent-Length: ' + Buffer.byteLength (got) + '\\r\\n\\r\\n' + got); }, 300); }); }).listen (" + portEcho + ", '127.0.0.1');"], {stdio: "ignore"});
		Atomics.wait (theSleeper, 0, 0, 700);
		try {
			const theEchoed = String (valueOf (theOpen, "on transport (host, port, flSecure, requestText, timeoutSecs, flJustHeaders)\n\tkernel (tcp.httpTransport)\ntransport (\"127.0.0.1\", " + portEcho + ", false, \"PUT /x HTTP/1.0\\r\\nHost: gate\\r\\nContent-Type: text/xml\\r\\nContent-length: 5\\r\\n\\r\\nhello\", 10, false)"));
			const theRequestSeen = theEchoed.slice (theEchoed.indexOf ("\r\n\r\n") + 4).toLowerCase ();
			checkThat ("a PUT through tcp.httpTransport reaches the server with its body", theRequestSeen.endsWith ("hello"), true);
			checkThat ("with a Content-Length header (what S3 requires)", theRequestSeen.indexOf ("content-length: 5") !== -1, true);
			checkThat ("and not chunked (what S3 refuses as 'functionality that is not implemented')", theRequestSeen.indexOf ("chunked") === -1, true);
			}
		finally {
			theEchoChild.kill ();
			}
		}

//run them

	function main () {
		console.log ("testBehavior -- " + pathMaster);

		[
			testNewAndPersistence,
			testTwoConnections,
			testTwoConnectionsSameName, //10/8/26 by CC
			testWritingDoesNotWipe,
			testRootAddress, //9/12/26 by CC
			testNamedParametersReachTheKernel,
			testAddressesUseTheSearchPath,
			testOutlineToXmlOnASearchPathAddress,
			testAddressGlobalsAnswerTheAddress,
			testPackRoundTrip,
			testStoredAddressIsStillAnAddress,
			testFatPageRoundTrip,
			testMenubarRoundTrip,
			testMenuAddCommand, //9/12/26 by CC
			testGlueScripts,
			testRootWriter,
			testSaveCopy,
		testCallScriptStoredAddress,
		testBuildPageTable,
		testPageTableAddress,
		testRunDirectives,
		testGlossaryPatcher,
		testParentOfDottedName,
		testTableAssignmentCopies,
		testDeleteThroughAnAddress,
		testAddressesOfOneObjectAreEqual,
		testNeuterTags,
		testRunOutlineDirectives,
		testMacrosFindTheSitesTools,
		testTraversalSkip,
		testQuotedGlossaryItems,
		testNilCompares,
		testGuestNamesAfterThePaths,
		testBlockLocalWithCommas,
		testEntityEncodeByCodePoint,
		testParentOfStoredAddress,
		testBinaryKeepsItsType,
		testBinaryBytes,
		testNewStringVerbs,
		testMergeOptions,
		testBinaryBody,
		testTableCopy,
		testNewDatabaseFileIsFrontiers,
		testNamesInOpenGuestDatabases,
		testXmlGetValueOfAnEmptyElement,
		testXmlAttributesAsWritten, //9/29/26 by CC
		testSizeOfABinary, //9/29/26 by CC
		testFilespecAddsAsItsPath, //10/3/26 by CC
		testDottedNameSkipsANonTableLocal, //9/29/26 by CC
		testLocalsLiveInTheirBlock, //10/4/26 by CC
		testADatabasesFilePathNamesItsRoot, //10/4/26 by CC
		testPackagesAndInstances, //10/5/26 by CC
		testSaveNamedRoot,
		testWriteWholeFileCharacters,
			testParseAddress,
			testPlusEquals,
			testCompiledCodeRule, //9/10/26 by CC
			testMountedGuestByPath, //9/10/26 by CC
			testS3Signing,
			testDatesAreDates,
			testMoveIntoAnotherTable,
			testDeleteTakesAnLvalue,
			testRemoteCall,
			testMenuLineAddress,
			testCharType,
			testEnvironmentTable,
			testTableEditing,
			testWebserverUtils,
			testBuiltinsSweep,
			testExportCursorPart,
			testAddressesThroughADataFile,
			testStraightCodeScripts,
			testRuledEdits,
			testWebserver,
			testJsonCompileKernel,
			testTablePaste,
			testOutlineExpansionDefault,
			testJsonDecompileKernel,
			testStringSubscriptIsAChar,
			testTableRenameAndMove,
			testExpandedBitMeansShowing,
			testMenuIsInstalled,
			testScratchpadGates,
			testCallScriptByName, //9/15/26 by CC
			testQueryTheRoot //9/19/26 by CC
			].forEach (function (theTest) {
			try {
				theTest ();
				}
			catch (err) {
				ctFailed++;
				theFailures.push (theSection + " -- the test itself blew up: " + err.message);
				console.log ("   FAIL  the test itself blew up: " + err.message);
				}
			});

		console.log ("");
		console.log (ctPassed + " passed, " + ctFailed + " failed.");
		if (ctFailed > 0) {
			console.log ("");
			theFailures.forEach (function (theFailure) {
				console.log ("   " + theFailure);
				});
			process.exit (1);
			}
		process.exit (0);
		}

	main ();
