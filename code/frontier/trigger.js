const myProductName = "trigger", myVersion = "0.5.129"; //7/29/26 by CC -- ship a UserTalk script to a server, run it there, get the value back; named by DW

const http = require ("http");

const theSessionId = String (Date.now ()) + "-" + Math.floor (Math.random () * 1000000); //9/10/26 by CC -- this server run; the linked code of a script (odbSql.js, addTheLinkedColumn) is good for one session, since the kernel links nothing at launch
var theStartupStatus = ""; //9/10/26 by CC -- what the server is doing before it is ready: installing a Tool, running the startup script; /version says it and the app shows it
const https = require ("https"); //8/12/26 by CC -- a script reading a url reads most of them over https
const dnsTool = require ("dns"); //8/12/26 by CC -- every host a script asks for is resolved before it's fetched
const fs = require ("fs");
const pathTool = require ("path");
const {Worker} = require ("worker_threads"); //8/7/26 by CC -- interactive runs happen on a worker thread so dialog verbs can block
const xmlrpc = require ("davexmlrpc"); //8/1/26 by CC -- the webEdit endpoint speaks XML-RPC, using DW's implementation
const xml2jsTool = require ("xml2js"); //8/1/26 by CC -- gates /rpc2 bodies: davexmlrpc throws on malformed XML, so nothing malformed may reach it

var frontierodb; //assigned by requireFrontierOdb, on the first upload -- an installed package wins, else the copy beside this file

const pathConfig = ((process.env.ODB_CONFIG !== undefined) && (process.env.ODB_CONFIG.length > 0)) ? process.env.ODB_CONFIG : pathTool.join (__dirname, "config.json"); //8/15/26 by CC -- a packaged desktop Frontier keeps its config outside the read-only app bundle

const config = { //defaults -- config.json wins, and PORT from the environment wins over both
	port: 5339,
	password: "",
	pathUsertalk: "usertalk",
	pathDatabase: "data/odb.db",
	maxVerbCalls: 1000000,
	flLogRequests: true,
	webeditUsername: "dave", //8/1/26 by CC -- the webEdit upload endpoint; empty webeditPassword locks it
	webeditPassword: "",
	maxWebeditBytes: 10000000, //a guard the security review required; the biggest object in the suite is far under 1MB
	folderWebeditReceived: "webeditReceived",
	maxSavedBlobs: 100,
	pathConcord: "concord", //8/7/26 by CC -- the odb browser page loads the Concord outliner from this folder
	folderRenders: "files/renders", //8/10/26 by CC -- what a build renders lands here, and /renders serves it back so the View button has a page to open
	folderScriptTemp: "files/scriptTemp", //8/12/26 by CC -- a url a script read waits here, in a file, until the script's thread picks it up
	maxHttpBytes: 64 * 1024 * 1024 //no page a script reads should be bigger than this
	};

if (fs.existsSync (pathConfig)) {
	const configFromFile = JSON.parse (fs.readFileSync (pathConfig, "utf8"));
	Object.keys (configFromFile).forEach (function (name) {
		config [name] = configFromFile [name];
		});
	}

if (process.env.PORT !== undefined) { //PagePark hands the port to the app this way
	config.port = Number (process.env.PORT);
	}

const folderUsertalk = pathTool.resolve (__dirname, config.pathUsertalk);
const pathDatabase = pathTool.resolve (__dirname, config.pathDatabase);
const folderConcord = pathTool.resolve (__dirname, config.pathConcord);
const folderOdbBrowser = pathTool.join (__dirname, "odbBrowser");
const folderRenders = pathTool.resolve (__dirname, config.folderRenders);
const folderScriptTemp = pathTool.resolve (__dirname, config.folderScriptTemp);

const parse = require (folderUsertalk + "/code/parse.js");
const evaluate = require (folderUsertalk + "/code/evaluate.js");
const verbsMaker = require (folderUsertalk + "/code/verbs.js");
const odbSql = require (folderUsertalk + "/code/odbSql.js");
const langstartup = require (folderUsertalk + "/code/langstartup.js"); //8/27/26 by CC -- builds system.environment truthfully at startup, the kernel's way
const dates = require (folderUsertalk + "/code/dates.js"); //9/6/26 by CC -- a date cell edits as Frontier's own text, "9/6/2026; 4:13:27 PM"
const tableedit = require (folderUsertalk + "/code/tableedit.js"); //8/27/26 by CC -- the kernel's rules for editing a table cell, tableedit.c's
const odbHome = require (folderUsertalk + "/code/odbHome.js"); //8/22/26 by CC -- convertValue, so webEdit installs whatever the decoder hands back
const charvalue = require (folderUsertalk + "/code/charvalue.js"); //8/26/26 by CC -- the char type

/*  usertalk.js isn't required here on purpose -- it pulls in odbLoader,
	which reads roots off the local disk. Trigger only wants the version,
	so it reads it out of the package.  */
const versionUsertalk = JSON.parse (fs.readFileSync (folderUsertalk + "/package.json", "utf8")).version;

var theStore; //assigned by startup, holds the open database
var selectListerChildren, selectListerRow, countListerChildren, selectSearchChild, selectListerDataVersion; //assigned by startup -- read-only statements for the odb browser's listing endpoint and the Find command
var selectPathNamedTopLevel; //9/7/26 by CC -- the guests that live at the top under their file paths, for parseAddressString

//the script that came in
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
	function opmlToTree (theXml) { //copied from usertalk's run.js -- the outline an editor saved becomes statements
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
					text = unescapeXml (textMatch [1]).replace (/[\r\n]+/g, " "); //same normalization as opmlToScript -- 8/14/26 by CC
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
	function textToTree (theText) { //tab-indented lines, the way a script looks pasted out of an outliner
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

//the value that comes back
	function serializeValue (theValue, level) {

		/*  A value the way the caller can read it over HTTP. Tables report
			their entry NAMES and nothing more -- Reflect.ownKeys asks the
			database for names only, where Object.keys would materialize
			every value under it.  */

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

//running one script
	function runScript (theScript) {

		/*  String in, value out. A fresh environment every time, so one
			request's locals can't reach the next one -- anything a script
			means to keep it writes into the database.  */

		const whenStart = new Date ();
		const theStatements = scriptToStatements (theScript);

		const theTrace = [];
		theTrace.push = function (entry) { //a loop with no bottom must not take the server down with it
			Array.prototype.push.call (this, entry);
			if (this.length >= config.maxVerbCalls) {
				const message = "Can't finish the script because it hit the cap of " + config.maxVerbCalls + " verb calls -- probably a loop that never ends.";
				throw new Error (message);
				}
			};

		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase}; /*  8/18/26 by CC -- the two write-gate switches (verbs.js) travel in
			the path map. Disk writes are on for a server or an app -- that's
			its operator running his own scripts, inside the folders his map
			names. The NETWORK is off unless a config turns it on by name; the
			s3 verbs sit behind it, and nothing in this repo turns it on. See
			misc/howWeGetPastThis.md.  */
		//8/4/26 by CC -- config.json supplies the map that lets file verbs reach real folders; 8/15/26 -- and says whether paths are corralled at all, true unless the config says otherwise
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const made = verbsMaker.makeVerbs (thePathMap, theTrace);
		const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
		environment.odbDates = theStore.datesForPath; //8/17/26 by CC -- timeCreated and timeModified ask the storage layer for the object's dates
		environment.setOdbDates = theStore.setDatesForPath; //8/20/26 by CC -- setTimeCreated and setTimeModified write through the same door
		environment.odbPathForId = theStore.pathForId; //9/19/26 by CC -- what the worker's runs and the behavior gate already have; sql.queryRoot's address (id) asks it, so a query run from an agent or the startup script can say where a row is
		environment.sessionId = theSessionId; //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
		environment.setLinkedCode = theStore.setLinkedCode;
		environment.msgCallback = function (theText) { //9/16/26 by CC -- msg from a run in this process is a foreground message on the About window
			aboutMsg (theText, false);
			};
		environment.parseScript = function (theLines) { //scripts stored in the database parse on first call
			return (parse.parseOutline (parse.linesToTree (theLines)));
			};
		environment.frames.push ({vars: {}});

		const theValue = evaluate.evaluate (theStatements, environment);

		const theResult = serializeValue (theValue);
		theResult.ctVerbCalls = theTrace.length;
		theResult.ctMilliseconds = new Date () - whenStart;
		theResult.theTrace = theTrace;
		return (theResult);
		}
	function evaluateInternal (theScript, theSeedVars) {

		/*  8/16/26 by CC -- run one script against the live odb and answer the
			RAW value, for the server's own questions. Same fresh-environment
			shape as runScript; the seed vars land in the script's frame as
			locals, so a credential never rides inside script text.  */

		const theStatements = scriptToStatements (theScript);
		const theTrace = [];
		theTrace.push = function (entry) {
			Array.prototype.push.call (this, entry);
			if (this.length >= config.maxVerbCalls) {
				const message = "Can't finish the script because it hit the cap of " + config.maxVerbCalls + " verb calls -- probably a loop that never ends.";
				throw new Error (message);
				}
			};
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const made = verbsMaker.makeVerbs (thePathMap, theTrace);
		const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
		environment.odbDates = theStore.datesForPath; //8/17/26 by CC -- timeCreated and timeModified ask the storage layer for the object's dates
		environment.setOdbDates = theStore.setDatesForPath; //8/20/26 by CC -- setTimeCreated and setTimeModified write through the same door
		environment.odbPathForId = theStore.pathForId; //9/19/26 by CC -- what the worker's runs and the behavior gate already have; sql.queryRoot's address (id) asks it, so a query run from an agent or the startup script can say where a row is
		environment.sessionId = theSessionId; //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
		environment.setLinkedCode = theStore.setLinkedCode;
		environment.msgCallback = function (theText) { //9/16/26 by CC -- msg from a run in this process is a foreground message on the About window
			aboutMsg (theText, false);
			};
		environment.parseScript = function (theLines) {
			return (parse.parseOutline (parse.linesToTree (theLines)));
			};
		const theFrame = {vars: {}};
		if (theSeedVars !== undefined) {
			Object.keys (theSeedVars).forEach (function (name) {
				theFrame.vars [name] = theSeedVars [name];
				});
			}
		environment.frames.push (theFrame);
		return (evaluate.evaluate (theStatements, environment));
		}

	function checkWebeditCredentials (userName, password) {

		/*  8/16/26 by CC -- webedit auth conforms to how webEdit does it, DW's
			ruling: per-user, through people.authenticateUser against
			user.people, service "WebEdit" -- the same call webEditServer's
			rpcHandlers have made since 1999, running here on DW's own people
			suite, harvested from his odb.

			While the people system has no WebEdit users yet -- a fresh
			database, or one from before this change -- the config's
			webeditUsername/webeditPassword pair keeps working, so nothing
			breaks the day the update lands. The moment a WebEdit user exists,
			people DECIDES: a wrong password refuses, and the config pair is
			no longer a way in. Setting up the account is the person's move,
			the instructions' way (people.newUser + attachServiceToUser).  */

		try {
			const ctServiceUsers = evaluateInternal ("people.countServiceUsers (\"WebEdit\")");
			if ((typeof ctServiceUsers === "number") && (ctServiceUsers > 0)) {
				const theAnswer = evaluateInternal ("people.authenticateUser (webeditAuthName, webeditAuthPassword, \"WebEdit\")", {
					webeditAuthName: String (userName),
					webeditAuthPassword: String (password)
					});
				return ((theAnswer !== false) && (theAnswer !== undefined) && (theAnswer !== null));
				}
			}
		catch (err) { //no people suite in this database -- the config pair is all there is
			}
		if ((config.webeditPassword.length === 0) || (userName !== config.webeditUsername) || (password !== config.webeditPassword)) {
			return (false);
			}
		return (true);
		}

	function traceText (theTrace) { //one line per verb call, the way run.js prints it
		const theLines = [];
		theTrace.forEach (function (entry) {
			var argsText = "";
			entry.args.forEach (function (arg) {
				if (argsText.length > 0) {
					argsText += ", ";
					}
				if (typeof arg === "string") {
					argsText += "\"" + arg + "\"";
					}
				else {
					argsText += String (arg);
					}
				});
			theLines.push (entry.verb + " (" + argsText + ")");
			});
		return (theLines);
		}

//the webEdit endpoint

	/*  POST /rpc2 answers two XML-RPC procedures. webEdit.sendToServer is the
		same call Frontier's webEdit suite has made since 1999 -- so a script
		on DW's desktop can upload an object and it lands in the database
		here. The wire format: the data param is a string holding base64 of
		pack() of the value, the identical bytes a fat page stores in its
		#pageData directive, which is how frontierodb decodes it.

		webEdit.getFromServer (8/3/26) flows the other way -- it answers with
		the script's source text, base64-encoded: tabs for structure, the
		chevron prefix for comment lines, the same rendering string (@adr^)
		produces in Frontier -- so script.newScriptObject can rebuild it on
		DW's desktop.

		Both procedures reach any address in the database -- DW, 8/3/26:
		"i don't know any part that can be untouchable." The password is the
		boundary. Scripts only, for now, in both directions. Installs write
		through the SQL-backed store, so they persist; every received blob is
		also saved to disk before decoding.  */
	
	/*  The four-character type codes ride in the fifth parameter and in a fat
		page's #type directive -- scpt a script, mbar a menubar, tabl a table,
		which is where misc/scratchpad.theTable.fttb says
		"application/x-frontier-tabl". Nothing here branches on them any more:
		the packed bytes say what they are, so the code is a label, not a
		gate.  */
	
	function requireFrontierOdb () {
		if (frontierodb === undefined) {
			try {
				frontierodb = require ("frontierodb");
				}
			catch (err) {
				frontierodb = require (pathTool.join (__dirname, "frontierodb.js"));
				}
			}
		}
	function splitAddressText (theText) {

		/*  9/9/26 by CC -- A NAME WITH A DOT IN IT STAYS ONE NAME. The kernel
			writes such a name in brackets, ["frontier.root"], and reads it
			back as one identifier (langexternalbracketname, langgetidentifier).
			Every split on dots here went straight through the brackets, so
			the table window's edit of rssCodeUpdateData.roots.["frontier.root"].
			prefs.baseurl read "frontier" then "root" and found nothing --
			DW's 9/9 report. Splits on the dots outside brackets; a bracketed
			segment comes back without its brackets and quotes.  */

		const segments = [];
		var current = "";
		var ix = 0;
		while (ix < theText.length) {
			const ch = theText.charAt (ix);
			if (ch === "[") {
				const ixClose = theText.indexOf ("]", ix);
				if (ixClose === -1) {
					current += theText.slice (ix);
					break;
					}
				var inner = theText.slice (ix + 1, ixClose).trim ();
				if ((inner.length >= 2) && (inner.charAt (0) === "\"") && (inner.charAt (inner.length - 1) === "\"")) {
					inner = inner.slice (1, inner.length - 1);
					}
				current += inner;
				ix = ixClose + 1;
				}
			else if (ch === ".") {
				segments.push (current);
				current = "";
				ix++;
				}
			else {
				current += ch;
				ix++;
				}
			}
		segments.push (current);
		return (segments);
		}

	function parseAddressString (theAddressString) { //"@system.tmp.examplescript" -> segments, or undefined if it's not a clean address
		var theText = String (theAddressString);
		if (theText.startsWith ("@")) {
			theText = theText.slice (1);
			}

		/*  9/7/26 by CC -- A BARE FILE PATH IN FRONT. A guest made by
			fileMenu.new (his rssCodeUpdate data file) is a top-level table
			named by its file path, and the window on it carries that path
			without brackets as its scope -- so every refresh asked /listtable
			for "Macintosh HD:...:rssCodeUpdateData.root.rssCodeUpdateData"
			and got 404 on the dot in ".root": the window never followed the
			database (DW's 9/7 fire alarm, the stale data-file window), and
			nothing in it could be deleted, renamed or moved. The top-level
			names that hold a colon are matched in front, longest first.  */

		if ((theText.indexOf (":") !== -1) && (theText.indexOf ("[") !== 0) && (selectPathNamedTopLevel !== undefined)) {
			const lower = theText.toLowerCase ();
			var theMatch;
			selectPathNamedTopLevel.all ().forEach (function (theRow) {
				const theName = String (theRow.name);
				const nameLower = theName.toLowerCase ();
				if (lower.startsWith (nameLower) && ((lower.length === nameLower.length) || (lower.charAt (nameLower.length) === "."))) {
					if ((theMatch === undefined) || (theName.length > theMatch.length)) {
						theMatch = theName;
						}
					}
				});
			if (theMatch !== undefined) {
				const theRest = theText.slice (theMatch.length + 1);
				return ((theRest.length === 0) ? [theMatch] : [theMatch].concat (splitAddressText (theRest))); //9/9/26 by CC -- brackets honored
				}
			}

		/*  9/10/26 by CC -- THE EXACT PATH WINS. This rule ran AFTER the two below,
			so a database opened from a file whose NAME matched an installed or
			mounted guest -- his own config.root beside the shipped config.root --
			was rewritten to the guest by name and nothing in it could be reached:
			"Can't download [\"...:config.root\"].config.nodeEditor.projects.rssChat.scripts
			because there is no object at that address" (DW's 9/10 report, the
			project scripts object). The kernel's filewindowtable is keyed by each
			file's PATH, so an open file named by its exact path comes first; the
			by-name rules below answer only when no such table exists. The
			language already looks the root up before the by-name rule
			(evaluate.js referenceForId); this is the server catching up.

			9/5/26 by CC -- a bracketed path with no installed root behind it,
			["C:\Program Files\OPML\...\dotOpml.root"] or ["..."].dotOpmlSuite,
			names a top-level table whose NAME is that path: the way
			fileMenu.open keeps an open guest in this world, and the way the
			2012 opml.root carries its own leftover. The path is one segment,
			dots and all; anything after the bracket is looked up under it.  */

		const bareMatch = theText.match (/^\[\s*"([^"]+)"\s*\](?:\.(.+))?$/);
		if ((bareMatch !== null) && (selectSearchChild !== undefined) && (selectSearchChild.get (theStore.odb.odbId, bareMatch [1].toLowerCase ()) !== undefined)) {
			const restSegments = (bareMatch [2] === undefined) ? [] : splitAddressText (bareMatch [2]); //9/9/26 by CC
			var flRestGood = true;
			restSegments.forEach (function (segment) {
				if ((segment.length === 0) || (segment === "__proto__") || (segment === "constructor") || (segment === "prototype")) {
					flRestGood = false;
					}
				});
			return (flRestGood ? [bareMatch [1]].concat (restSegments) : undefined);
			}

		/*  9/3/26 by CC -- an address that starts with a file path in
			brackets, ["Macintosh HD:...:Tools:nodeEditor.root"].nodeEditorSuite.menu,
			names an open guest database the kernel's way (filewindowtable).
			A Tools root's names live at the top of this database, so the
			path segment comes off when its file name is an installed root
			and the rest is looked up from the root. user.menus.nodeedit in
			DW's database is written this way.  */

		const wholeMatch = theText.match (/^\[\s*"([^"]+\.root)"\s*\]$/i); //9/7/26 by CC -- the Tool's window itself, no name after the path: its names are the top of the database, and the window's names list picks the Tool's out
		if (wholeMatch !== null) {
			const theFileName = wholeMatch [1].split (/[:\/]/).pop ();
			var theToolRecord;
			try {
				theToolRecord = theStore.odb.system.compiler.files [theFileName];
				}
			catch (err) {
				}
			if ((theToolRecord !== undefined) && (theToolRecord !== null) && (typeof theToolRecord === "object") && (theToolRecord.path !== undefined)) {
				return ([]);
				}
			}
		const pathMatch = theText.match (/^\[\s*"([^"]+\.root)"\s*\]\.(.+)$/i);
		if (pathMatch !== null) {
			const theFileName = pathMatch [1].split (/[:\/]/).pop ();
			var theRecord;
			try {
				theRecord = theStore.odb.system.compiler.files [theFileName];
				}
			catch (err) {
				}
			if ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object")) {
				if (theRecord.path !== undefined) {
					theText = pathMatch [2]; //a Tools root: its names live at the top of the database
					}
				else {
					if ((theRecord.adr !== undefined) && (String (theRecord.adr).length > 0)) {
						/*  9/10/26 by CC -- config.root's root table has one entry, config, and THAT
							is what the build mounted at root.config (makeVirginRoot). So
							["...:config.root"].config.nodeEditor is config.nodeEditor -- the way
							Frontier on Berkeley wrote the address of the part DW imported on 9/10.
							This read it as config.config.nodeEditor (the whole guest at root.config)
							and the import made a stray database named by the path. The mount's own
							name is the guest's one entry; the rest follows it.  */

						const mountName = String (theRecord.adr).split (".").pop ().toLowerCase ();
						const restSegments = splitAddressText (pathMatch [2]);
						if ((restSegments.length > 0) && (restSegments [0].toLowerCase () === mountName)) {
							theText = String (theRecord.adr) + ((restSegments.length > 1) ? "." + pathMatch [2].slice (restSegments [0].length + 1) : "");
							}
						else {
							theText = String (theRecord.adr) + "." + pathMatch [2]; //a name the guest's root doesn't have; nothing will be there
							}
						}
					}
				}
			}
		const segments = splitAddressText (theText); //9/9/26 by CC -- was a plain split on dots
		var flGood = segments.length > 0;
		segments.forEach (function (segment) {
			if (segment.length === 0) {
				flGood = false;
				}
			if ((segment === "__proto__") || (segment === "constructor") || (segment === "prototype")) {
				flGood = false;
				}
			});
		if (flGood) {
			return (segments);
			}
		return (undefined);
		}
	function saveReceivedBlob (theBuffer, segments) { //every upload is saved before decoding -- nothing is ever lost
		const folderReceived = pathTool.resolve (__dirname, config.folderWebeditReceived);
		if (!fs.existsSync (folderReceived)) {
			fs.mkdirSync (folderReceived);
			}
		const fname = new Date ().toISOString ().replace (/[:.]/g, "-") + "-" + segments.join (".") + ".bin";
		fs.writeFileSync (pathTool.join (folderReceived, fname), theBuffer);

		const theFiles = fs.readdirSync (folderReceived).filter (function (name) {
			return (name.endsWith (".bin"));
			}).sort ();
		while (theFiles.length > config.maxSavedBlobs) {
			const oldest = theFiles.shift ();
			fs.unlinkSync (pathTool.join (folderReceived, oldest));
			console.log (nowText () + " webedit: pruned saved blob " + oldest);
			}
		return (fname);
		}
	function decodePageData (theBase64) { //hand the blob to frontierodb through a one-directive fat page file
		requireFrontierOdb ();
		const pathTemp = pathTool.join (pathTool.resolve (__dirname, config.folderWebeditReceived), "decoding.ftsc");
		fs.writeFileSync (pathTemp, "#pageData " + theBase64 + "\r", "latin1");
		try {
			const thePage = frontierodb.readFatPage (pathTemp);
			return (thePage.value);
			}
		finally {
			fs.unlinkSync (pathTemp);
			}
		}
	/*  8/15/26 by CC -- reading an address used to walk down from the root
		and nothing else, so a name the LANGUAGE resolves through the paths
		table resolved nowhere here. That's what broke cmd-double-click: DW
		double-clicked console.start and file, both of which live under
		system.verbs.builtins, and got "there is no object at that address"
		-- he read code by navigating down from frontier.root all day.

		The walk answers the way the interpreter does now: the literal
		address first, then the paths tables in Frontier's own order (the
		same list evaluate.js uses). Names match case-insensitively, exact
		spelling preferred, because names in the odb are unicase.  */

	const addressesOfPathsTables = ["system.verbs.globals", "system.verbs.builtins", "system.verbs.apps", "system.verbs.suites", "suites"];

	function childOfTable (theTable, theName) { //undefined if there's nothing by that name
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (undefined);
			}
		if (theTable [theName] !== undefined) {
			return (theTable [theName]);
			}
		var found;
		const theLowerName = theName.toLowerCase ();
		Object.keys (theTable).forEach (function (theKey) {
			if ((found === undefined) && (theKey.toLowerCase () === theLowerName)) {
				found = theTable [theKey];
				}
			});
		return (found);
		}

	function walkFromTable (theTable, segments) { //undefined if anything on the way is missing
		var current = theTable;
		segments.forEach (function (segment) {
			current = childOfTable (current, segment);
			});
		return (current);
		}

	function getValueAtAddress (segments) { //the literal address, then the paths tables, the way the interpreter resolves a name
		const theLiteral = walkFromTable (theStore.odb, segments);
		if ((theLiteral !== undefined) && (theLiteral !== null)) {
			return (theLiteral);
			}
		var found;
		addressesOfPathsTables.forEach (function (theAddress) {
			if (found === undefined) {
				const theTable = walkFromTable (theStore.odb, theAddress.split ("."));
				if ((theTable !== undefined) && (theTable !== null) && (typeof theTable === "object") && (theTable.flOdbScript === undefined)) {
					const theValue = walkFromTable (theTable, segments);
					if ((theValue !== undefined) && (theValue !== null)) {
						found = theValue;
						}
					}
				}
			});
		return (found);
		}
	const chevron = "«"; //left guillemot, Frontier's comment character
	function scriptToText (theScript, lineEnd) { //the source text of a stored script, the way string (@adr^) renders it in Frontier
		if (lineEnd === undefined) {
			lineEnd = "\r"; //what Frontier's editor expects; the JSON endpoints ask for \n
			}
		var theText = "";
		theScript.lines.forEach (function (line) {
			if ((line !== null) && (typeof line === "object") && (typeof line.text === "string")) { //a malformed entry is skipped, never a crash
				var ctTabs = Math.min (Math.max (Number (line.level) || 0, 0), 100); //the deepest real script in the odb is 16 levels
				var lineText = "";
				while (ctTabs > 0) {
					lineText += "\t";
					ctTabs--;
					}
				if (line.flComment) {
					lineText += chevron;
					}
				lineText += line.text;
				theText += lineText + lineEnd;
				}
			});
		return (theText);
		}
	function wptextToLines (theText) { //9/24/26 by CC -- a wp text's paragraphs as outline lines, all at level 0; a return ends a paragraph (the wp engine's rule), a linefeed with it or alone counts the same
		const theLines = [];
		String (theText).split ("\r\n").join ("\r").split ("\n").join ("\r").split ("\r").forEach (function (theParagraph) {
			theLines.push ({level: 0, text: theParagraph, flExpanded: false, flComment: false, flBreakpoint: false});
			});
		return (theLines);
		}
	function linesToWptext (theLines) { //the inverse: the lines' texts, a return between each
		var theText = "";
		theLines.forEach (function (theLine, ix) {
			if (ix > 0) {
				theText += "\r";
				}
			theText += String (theLine.text);
			});
		return (theText);
		}
	function scriptToOpml (theScript, theTitle) { //8/4/26 by CC -- OPML is the currency between the server and Electric Drummer
		function encode (theString) {

			/*  8/17/26 by CC -- THE CHARACTERS XML CANNOT CARRY come out here.
				DW's daytona project opened on a blank window, and this was
				why: one line of CSS in it holds a control character (code 19),
				which XML 1.0 has no legal way to write -- not raw, and not as
				&#19; either. The document the window got was unparseable, so
				the outliner drew nothing at all. One stray character, 2,111
				lines invisible.

				Tab, return and linefeed are the three control characters XML
				allows and they stay; the rest are dropped, because a document
				that can't be read is worse than a character that can't be
				written.  */

			return (String (theString)
				.replace (/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
				.split ("&").join ("&amp;")
				.split ("<").join ("&lt;")
				.split (">").join ("&gt;")
				.split ("\"").join ("&quot;")
				.split ("\t").join ("&#9;") //9/19/26 by CC -- a raw tab, return or linefeed inside an attribute reaches the window as a space; the XML spec has every parser do that. Written as a numbered reference it gets through. DW's base64 lines, 9/19
				.split ("\n").join ("&#10;")
				.split ("\r").join ("&#13;"));
			}
		/*  8/24/26 by CC -- the expansion state goes out in the head, built
			from the per-line flags, counted the way Concord counts: only
			lines a walk can see get a number, and only an expanded line
			with children gets listed. Concord applies it as the window
			opens, so an outline comes back folded the way it was left.  */

		const expansionNumbers = [];
		(function () {
			var ctVisible = 0;
			const ancestorFlags = [];
			theScript.lines.forEach (function (line, ixLine) {
				if ((line === null) || (typeof line !== "object") || (typeof line.text !== "string")) {
					return;
					}
				const theLevel = Math.min (Math.max (Number (line.level) || 0, 0), 100);
				while (ancestorFlags.length > theLevel) {
					ancestorFlags.pop ();
					}
				var flVisible = true;
				ancestorFlags.forEach (function (flAncestorExpanded) {
					if (!flAncestorExpanded) {
						flVisible = false;
						}
					});
				const theNext = theScript.lines [ixLine + 1];
				const flHasSubs = (theNext !== undefined) && (theNext !== null) && (Number (theNext.level) > theLevel);
				if (flVisible) {
					ctVisible++;
					if ((line.flExpanded === true) && flHasSubs) {
						expansionNumbers.push (ctVisible);
						}
					}
				ancestorFlags.push (line.flExpanded === true);
				});
			}) ();

		var theText = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n\t<head>\n\t\t<title>" + encode (theTitle) + "</title>\n" + ((expansionNumbers.length > 0) ? "\t\t<expansionState>" + expansionNumbers.join (",") + "</expansionState>\n" : "") + "\t\t</head>\n\t<body>\n";

		/*  The lines are a flat list with a level on each one -- the same shape
			an outliner shows. The stack holds the level of every element that
			is open right now; a new line closes every open element at its own
			level or deeper, then opens itself inside whatever is left. That
			works no matter what the levels do -- a jump from 0 to 3, or a
			first line that isn't at 0, both of which an outliner can't make
			but the database can hold.  */

		const openLevels = [];
		function indent (ctTabs) {
			var theTabs = "";
			while (ctTabs > 0) {
				theTabs += "\t";
				ctTabs--;
				}
			return (theTabs);
			}
		function closeOne () {
			openLevels.pop ();
			theText += indent (openLevels.length + 2) + "</outline>\n";
			}
		theScript.lines.forEach (function (line) {
			if ((line !== null) && (typeof line === "object") && (typeof line.text === "string")) {
				const theLevel = Math.min (Math.max (Number (line.level) || 0, 0), 100);
				while ((openLevels.length > 0) && (openLevels [openLevels.length - 1] >= theLevel)) {
					closeOne ();
					}
				var theAttsText = ""; //10/3/26 by CC -- the line's own attributes ride along: type, url, created, whatever the outliner put there (see opmlToScript)
				if ((line.atts !== undefined) && (line.atts !== null) && (typeof line.atts === "object")) {
					Object.keys (line.atts).forEach (function (theName) {
						if (/^[A-Za-z_][\w:.-]*$/.test (theName) && (theName !== "text") && (theName.toLowerCase () !== "iscomment")) {
							theAttsText += " " + theName + "=\"" + encode (line.atts [theName]) + "\"";
							}
						});
					}
				theText += indent (openLevels.length + 2) + "<outline text=\"" + encode (line.text) + "\"" + ((line.flComment) ? " isComment=\"true\"" : "") + theAttsText + ">\n";
				openLevels.push (theLevel);
				}
			});
		while (openLevels.length > 0) {
			closeOne ();
			}
		theText += "\t\t</body>\n\t</opml>\n";
		return (theText);
		}
	function opmlToScript (theXml, scriptType) { //8/4/26 by CC -- the inverse; nesting becomes levels, isComment rides along
		const theLines = [];
		var depth = 0;
		const tagPattern = /<outline\b([^>]*?)(\/?)>|<\/outline>/g;
		var theMatch;
		while ((theMatch = tagPattern.exec (theXml)) !== null) {
			if (theMatch [0] === "</outline>") {
				depth--;
				}
			else {
				const attributes = theMatch [1];
				const flSelfClosing = theMatch [2] === "/";
				const flComment = /isComment="true"/i.test (attributes);
				const textMatch = attributes.match (/text="([^"]*)"/);
				var text = "";
				if (textMatch !== null) {
					text = unescapeXml (textMatch [1]).replace (/[\r\n]+/g, " "); //an outline line can't contain a line break; one embedded in a text attribute (legal XML) is invisible in every window and kills the tokenizer -- 8/14/26 by CC
					}
				const theLine = {level: depth, text, flExpanded: true, flComment, flBreakpoint: false};

				/*  10/3/26 by CC -- THE LINE'S ATTRIBUTES ARE KEPT. An outline's
					headline carries attributes in Frontier (op.attributes.*,
					packed with the line in oppack.c), and in OPML they are the
					element's other attributes: type and url on an include,
					created, anything a script or the editor puts there. Here they
					were dropped on the way in, so an include's url was gone the
					moment the window saved -- found 10/3 building includes, DW's
					ask. text, isComment and isBreakpoint are the line's own
					flags and stay out of the list.  */

				const attPattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
				var attMatch;
				const theAtts = {};
				var ctAtts = 0;
				while ((attMatch = attPattern.exec (attributes)) !== null) {
					const theName = attMatch [1];
					const theLower = theName.toLowerCase ();
					if ((theLower !== "text") && (theLower !== "iscomment") && (theLower !== "isbreakpoint")) {
						theAtts [theName] = unescapeXml (attMatch [2]);
						ctAtts++;
						}
					}
				if (ctAtts > 0) {
					theLine.atts = theAtts;
					}
				theLines.push (theLine);
				if (!flSelfClosing) {
					depth++;
					}
				}
			}

		/*  8/24/26 by CC -- the expansion state rides the OPML head, the
			standard way, and becomes the per-line flag Frontier keeps in
			the outline itself -- flexpanded in the kernel's oppack.c, so an
			outline remembers how it was folded wherever it goes. The
			numbering counts only the lines a walk can see: a collapsed
			line's children are skipped, which is how Concord writes it. A
			document with no expansionState keeps every line expanded, the
			way it always was.  */

		const theStateMatch = theXml.match (/<expansionState>([^<]*)<\/expansionState>/i);
		if (theStateMatch !== null) {
			const expandedNumbers = {};
			theStateMatch [1].split (",").forEach (function (theNumber) {
				if (theNumber.trim ().length > 0) {
					expandedNumbers [Number (theNumber.trim ())] = true;
					}
				});
			var ctVisible = 0;
			const ancestorFlags = []; //flExpanded of each open ancestor
			theLines.forEach (function (theLine) {
				while (ancestorFlags.length > theLine.level) {
					ancestorFlags.pop ();
					}
				var flVisible = true;
				ancestorFlags.forEach (function (flAncestorExpanded) {
					if (!flAncestorExpanded) {
						flVisible = false;
						}
					});
				if (flVisible) {
					ctVisible++;
					theLine.flExpanded = (expandedNumbers [ctVisible] === true);
					}
				else {
					theLine.flExpanded = false;
					}
				ancestorFlags.push (theLine.flExpanded);
				});
			}
		else {

			/*  9/13/26 by CC -- no expansionState: the first summit open and
				everything else closed, the way the View button shows an
				outline -- DW's 9/13 ask, after an outline never opened here
				came up with every line expanded. The same rule is in
				usertalk's op.xmlToOutline (applyExpansionState, verbs.js);
				change one, change the other. Until today every line was
				expanded, "the way it always was."  */

			theLines.forEach (function (theLine, ix) {
				theLine.flExpanded = ((ix === 0) && (theLine.level === 0));
				});
			}

		return ({flOdbScript: true, scriptType, lines: theLines});
		}
	var macRomanFromChar; //assigned by stringToMacRoman on first use
	function stringToMacRoman (theText) { //the bytes Frontier's editor expects -- the exact inverse of frontierodb's decoder
		requireFrontierOdb ();
		if (macRomanFromChar === undefined) {
			macRomanFromChar = {};
			var theByte;
			for (theByte = 0x80; theByte <= 0xFF; theByte++) {
				macRomanFromChar [frontierodb.macRomanToString (Buffer.from ([theByte]))] = theByte;
				}
			}
		const theBytes = Buffer.alloc (theText.length);
		var ix = 0;
		theText.split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode < 0x80) {
				theBytes [ix] = theCode;
				}
			else {
				const mapped = macRomanFromChar [theChar];
				theBytes [ix] = (mapped !== undefined) ? mapped : 0x3F; //question mark, when MacRoman has no such character
				}
			ix++;
			});
		return (theBytes);
		}
	function installValueAtAddress (segments, theValue) { //walk the database, creating missing tables on the way
		var current = theStore.odb;
		segments.slice (0, segments.length - 1).forEach (function (segment) {
			if ((current [segment] === undefined) || (current [segment] === null) || (typeof current [segment] !== "object")) {
				console.log (nowText () + " webedit: created table " + segment + " on the way to " + segments.join ("."));
				current [segment] = {};
				}
			current = current [segment];
			});
		current [segments [segments.length - 1]] = theValue;
		}
	function plainValueForRpc (theValue, depth) { //what goes back over the wire -- odb proxies become plain tables, bookkeeping stays home
		if ((theValue === undefined) || (theValue === null)) {
			return ("");
			}
		if ((typeof theValue === "object") && (theValue.flOdbSqlTable === true)) {
			if (depth > 8) {
				return ("");
				}
			const theCopy = {};
			Object.keys (theValue).forEach (function (theName) {
				if ((theName !== "flOdbSqlTable") && (theName !== "odbId")) {
					theCopy [theName] = plainValueForRpc (theValue [theName], depth + 1);
					}
				});
			return (theCopy);
			}
		if ((typeof theValue === "object") && ((theValue.flAddress === true) || (theValue.flOdbAddressText === true))) {
			return (String ((theValue.pathText !== undefined) ? theValue.pathText : theValue.path));
			}
		if (typeof theValue === "object" && (theValue instanceof Number)) {
			return (Number (theValue));
			}
		return (theValue);
		}
	function dispatchRpcHandler (verb, params) { //betty.rpc.server's walk, answering the script's value or throwing the reason
		const handlersRoot = getValueAtAddress (["user", "betty", "rpcHandlers"]);
		if ((handlersRoot === undefined) || (handlersRoot === null) || (handlersRoot.flOdbSqlTable !== true)) {
			const message = "Can't call " + verb + " because there is no user.betty.rpcHandlers table in this database.";
			throw new Error (message);
			}
		const securityScripts = [];
		var current = handlersRoot;
		var walkedPath = "user.betty.rpcHandlers";
		function noteSecurity () {
			if ((current !== undefined) && (current !== null) && (current.flOdbSqlTable === true) && (current ["#security"] !== undefined)) {
				const theLiteral = addressLiteralForSegments (theStore.namesForId (current.odbId)); //9/9/26 by CC -- the names as an array; pathForId brackets a dotted name now
				if (theLiteral !== undefined) {
					securityScripts.push (theLiteral + ".[\"#security\"]");
					}
				}
			}
		noteSecurity ();
		const segments = String (verb).split (".");
		segments.forEach (function (theSegment) {
			if ((current === undefined) || (current === null)) {
				return;
				}
			if (current.flOdbSqlTable !== true) {
				current = undefined;
				return;
				}
			var next = current [theSegment];
			if ((next !== undefined) && (next !== null) && ((next.flOdbAddressText === true) || (next.flAddress === true))) { //an address entry is followed, betty's rule
				const targetSegments = parseAddressString (String ((next.pathText !== undefined) ? next.pathText : next.path));
				next = (targetSegments === undefined) ? undefined : getValueAtAddress (targetSegments);
				}
			current = next;
			walkedPath += "." + theSegment;
			noteSecurity ();
			});
		if ((current === undefined) || (current === null) || (current.flOdbScript !== true)) {
			const message = "Can't call the script because the name " + verb + " hasn't been defined."; //the kernel's sentence, Lang Errors 9
			throw new Error (message);
			}
		const scriptPath = theStore.pathForId (current.odbId);
		const scriptLiteral = addressLiteralForSegments (theStore.namesForId (current.odbId)); //9/9/26 by CC
		if (scriptLiteral === undefined) {
			const message = "Can't call " + verb + " because the handler's address, " + scriptPath + ", can't be written as a call.";
			throw new Error (message);
			}
		const theSeedVars = {};
		const theArgNames = [];
		params.forEach (function (theParam, ix) {
			theSeedVars ["ccRpcParam" + ix] = theParam;
			theArgNames.push ("ccRpcParam" + ix);
			});
		securityScripts.forEach (function (theSecurityPath) { //a #security script that throws refuses the call
			evaluateInternal (theSecurityPath + " ()");
			});
		console.log (nowText () + " rpc2: " + verb + " -> " + scriptPath + " (" + params.length + ((params.length === 1) ? " param)" : " params)"));
		const theValue = evaluateInternal (scriptLiteral + " (" + theArgNames.join (", ") + ")", theSeedVars);
		return (plainValueForRpc (theValue, 0));
		}
	function handleWebeditCall (theResponse, verb, params, format) {
		function answer (theText) {
			theResponse.writeHead (200, {
				"Content-Type": "text/xml; charset=utf-8",
				"Content-Length": Buffer.byteLength (theText)
				});
			theResponse.end (theText);
			}
		function fault (theMessage, flDelay) { //failed auth answers slowly, everything else right away
			console.log (nowText () + " webedit: " + theMessage);
			const theText = xmlrpc.getFaultText ({message: theMessage}, format);
			if (flDelay) {
				setTimeout (function () {
					answer (theText);
					}, 2000);
				}
			else {
				answer (theText);
				}
			}
		function handleGetFromServer () {
			try {
				if (params.length < 3) {
					fault ("Can't answer the call because webEdit.getFromServer takes 3 parameters and this call has " + params.length + ".");
					return;
					}
				const userName = String (params [0]);
				const password = String (params [1]);
				const addressString = String (params [2]);
				if (!checkWebeditCredentials (userName, password)) { //8/16/26 by CC -- people.authenticateUser first, the webEdit way; config while no accounts exist
					fault ("Can't get " + addressString + " because an invalid username or password was supplied.", true);
					return;
					}
				const segments = parseAddressString (addressString);
				if (segments === undefined) {
					fault ("Can't get " + addressString + " because it isn't a clean dotted address.");
					return;
					}
				const theValue = getValueAtAddress (segments);
				if ((theValue === undefined) || (theValue === null)) {
					fault ("Can't get " + addressString + " because there is no object at that address.");
					return;
					}
				if ((theValue.flOdbScript !== true) || (theValue.scriptType !== "script") || (!Array.isArray (theValue.lines))) {
					fault ("Can't get " + addressString + " because it isn't a script, and this version only downloads scripts.");
					return;
					}
				const theText = scriptToText (theValue);
				const theB64 = stringToMacRoman (theText).toString ("base64");
				console.log (nowText () + " webedit: sent " + segments.join (".") + ", " + theText.length + " characters.");
				answer (xmlrpc.getReturnText (theB64, format));
				}
			catch (err) { //a throw from in here would take the whole server down with it -- see the note in handleWebeditRequest
				fault ("Can't answer the call because " + err.message);
				}
			}
		if (verb === "webEdit.getFromServer") {
			handleGetFromServer ();
			return;
			}
		if (verb !== "webEdit.sendToServer") {

			/*  8/28/26 by CC -- THE BETTY DISPATCH, DW's ruling: XML-RPC the
				way Frontier does it, on by default. Read from his opml.root
				(betty.rpc.server, betty.responders.RPC2): the methodName's
				dot-path is walked INTO user.betty.rpcHandlers -- an entry
				that's an address is followed, so a guest database can hang
				its handlers table there with one line -- any "#security"
				script found along the way runs first and can refuse, and
				the script at the end of the walk is called with the
				parameters. webEdit's two procedures keep their own doors
				above; everything else lands here.  */

			try {
				const theAnswer = dispatchRpcHandler (verb, params);
				answer (xmlrpc.getReturnText (theAnswer, format));
				}
			catch (err) {
				fault (err.message);
				}
			return;
			}
		if (params.length < 5) {
			fault ("Can't answer the call because webEdit.sendToServer takes at least 5 parameters and this call has " + params.length + ".");
			return;
			}
		const userName = String (params [0]);
		const password = String (params [1]);
		const addressString = String (params [2]);
		const dataB64 = String (params [3]);
		const objectType = String (params [4]);

		if (!checkWebeditCredentials (userName, password)) { //8/16/26 by CC -- people.authenticateUser first, the webEdit way; config while no accounts exist
			fault ("Can't replace " + addressString + " because an invalid username or password was supplied.", true);
			return;
			}
		const segments = parseAddressString (addressString);
		if (segments === undefined) {
			fault ("Can't replace " + addressString + " because it isn't a clean dotted address.");
			return;
			}
		/*  8/22/26 by CC -- NO TYPE GATE. It used to name the two types it
			would accept, so a table -- Frontier's own backup format, the
			thing fat pages exist for -- was refused by name. DW, 8/22:
			"i'm sure you could do it without the gates. fatpages were our
			backup format, we used it in everything." What arrives is
			decoded and installed, whatever it is; the password is the
			boundary, the same rule the two procedures already lived by.
			The type code the caller sends is now a label in the log.  */
		const theBuffer = Buffer.from (dataB64, "base64");
		const fname = saveReceivedBlob (theBuffer, segments);
		var theValue;
		try {
			theValue = decodePageData (dataB64);
			}
		catch (err) {
			fault ("Can't install " + addressString + " because the object couldn't be decoded: " + err.message + " Received " + theBuffer.length + " bytes, saved as " + fname + " for analysis.");
			return;
			}
		if ((theValue === undefined) || (theValue.type === undefined)) {
			fault ("Can't install " + addressString + " because the object couldn't be decoded: the bytes don't unpack as any known object type. Received " + theBuffer.length + " bytes, saved as " + fname + " for analysis.");
			return;
			}
		const theObject = odbHome.convertValue (theValue); //every type the decoder knows, tables and their contents included -- the converter misc/installFatPage.js has used since 8/12
		try {
			installValueAtAddress (segments, theObject);
			}
		catch (err) {
			fault ("Can't install " + addressString + " because the database write failed: " + err.message);
			return;
			}
		console.log (nowText () + " webedit: installed " + segments.join (".") + " as a " + theValue.type + ", " + theBuffer.length + " bytes, saved as " + fname);
		answer (xmlrpc.getReturnText (addressString + " installed in trigger's database; the received bytes were also saved as " + fname + ".", format)); //persistence across restarts verified 8/1/26
		}
	function handleWebeditRequest (theRequest, theResponse) {
		var theBody = "";
		var flTooBig = false;
		theRequest.on ("data", function (chunk) {
			theBody += chunk;
			if ((theBody.length > config.maxWebeditBytes) && !flTooBig) {
				flTooBig = true;
				returnError (theResponse, 413, "Can't accept the request because it's bigger than " + config.maxWebeditBytes + " bytes.");
				theRequest.destroy ();
				}
			});
		theRequest.on ("end", function () {
			if (flTooBig) {
				return;
				}

			/*  Two gates before davexmlrpc sees the body. It throws from inside
				its parser callback on malformed XML, which would take the whole
				server down -- an unauthenticated caller must never reach that.  */

			const lowerBody = theBody.toLowerCase ();
			if ((lowerBody.indexOf ("<!doctype") !== -1) || (lowerBody.indexOf ("<!entity") !== -1)) {
				returnError (theResponse, 400, "Can't answer the request because doctype and entity declarations aren't accepted here.");
				return;
				}
			xml2jsTool.parseString (theBody, {explicitArray: false}, function (err, jstruct) {
				if ((err !== undefined) && (err !== null)) {
					returnError (theResponse, 400, "Can't answer the request because the body isn't well-formed XML: " + err.message);
					return;
					}
				if ((jstruct === undefined) || (jstruct === null) || (jstruct.methodCall === undefined)) {
					returnError (theResponse, 400, "Can't answer the request because the body isn't an XML-RPC methodCall.");
					return;
					}
				xmlrpc.server (theBody, function (err, verb, params, format) {
					if (err !== undefined) {
						returnError (theResponse, 400, err.message);
						}
					else {
						handleWebeditCall (theResponse, verb, params, format);
						}
					});
				});
			});
		}

//the web service
	function urlParam (theUrl, theName) { //searchParams.get answers null for a missing param, and we don't traffic in nulls
		const theValue = theUrl.searchParams.get (theName);
		if (theValue === null) {
			return (undefined);
			}
		return (theValue);
		}
	function passwordFromRequest (theRequest, theUrl) {
		const fromHeader = theRequest.headers ["x-trigger-password"];
		if (fromHeader !== undefined) {
			return (fromHeader);
			}
		return (urlParam (theUrl, "password"));
		}
	function requestIsAuthorized (theRequest, theUrl, flNeedsWrite) {

		/*  8/7/26 by CC -- the two passwords have different permissions, per
			DW's 8/6 instruction. The webedit password (DW's -- the one
			Electric Drummer sends) opens everything. The run password (the
			one Claude holds) opens the read calls only: downloadobject and
			listtable. Run, upload and dialog answers refuse it. The point is
			a lock, not a promise: once DW rotates the values on the server,
			Claude's password cannot change the database, whatever Claude
			does. An empty password in config.json locks the server, it
			doesn't open it.  */

		const thePassword = passwordFromRequest (theRequest, theUrl);
		if (thePassword === undefined) {
			return (false);
			}
		if ((config.webeditPassword.length > 0) && (thePassword === config.webeditPassword)) {
			return (true);
			}
		if ((config.password.length > 0) && (thePassword === config.password)) {
			if (flNeedsWrite === true) {
				return (false);
				}
			return (true);
			}
		return (false);
		}
	const headersCors = { //8/4/26 by CC -- so Electric Drummer can call directly, without the password going through a proxy server
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, x-trigger-password"
		};
	function returnJson (theResponse, theCode, theObject) {
		const theText = JSON.stringify (theObject, undefined, 4);
		theResponse.writeHead (theCode, Object.assign ({
			"Content-Type": "application/json; charset=utf-8",
			"Content-Length": Buffer.byteLength (theText)
			}, headersCors));
		theResponse.end (theText);
		}
	function returnText (theResponse, theCode, theText) {
		theResponse.writeHead (theCode, Object.assign ({
			"Content-Type": "text/plain; charset=utf-8",
			"Content-Length": Buffer.byteLength (theText)
			}, headersCors));
		theResponse.end (theText);
		}
	function returnError (theResponse, theCode, theMessage) {
		returnJson (theResponse, theCode, {message: theMessage});
		}
	function handleRun (theRequest, theResponse, theUrl, theScript) {
		if (theScript === undefined) {
			returnError (theResponse, 400, "Can't run anything because the request carried no script.");
			}
		else {
			if (theScript.trim ().length === 0) {
				returnError (theResponse, 400, "Can't run anything because the script is empty.");
				}
			else {
				const flTrace = theUrl.searchParams.has ("trace");
				try {
					const theResult = runScript (theScript);
					const theTrace = theResult.theTrace;
					delete theResult.theTrace;
					if (flTrace) {
						theResult.trace = traceText (theTrace);
						}
					if (config.flLogRequests) {
						console.log (nowText () + " ran " + theResult.ctVerbCalls + " verb calls in " + theResult.ctMilliseconds + "ms -> " + theResult.valueType);
						}
					returnJson (theResponse, 200, theResult);
					}
				catch (err) {
					if (config.flLogRequests) {
						console.log (nowText () + " failed: " + err.message);
						}
					returnError (theResponse, 500, err.message);
					}
				}
			}
		}
	function handleDownloadObject (theResponse, theAddressString) { //8/4/26 by CC -- the object comes back as OPML, the currency Electric Drummer speaks
		try {
			if (theAddressString === undefined) {
				returnError (theResponse, 400, "Can't download anything because the request carried no address.");
				return;
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't download " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			const theValue = getValueAtAddress (segments);
			if ((theValue === undefined) || (theValue === null)) {
				returnError (theResponse, 404, "Can't download " + theAddressString + " because there is no object at that address.");
				return;
				}
			var theScriptValue = theValue;
			if (theValue.flWpText === true) { //9/24/26 by CC -- a wp text opens in the outline window, one line per paragraph; DW's 9/23 report: edit () of a wptext stopped with "isn't a script or an outline"
				theScriptValue = {flOdbScript: true, scriptType: "wptext", lines: wptextToLines (String (theValue.text))};
				}
			if ((theScriptValue.flOdbScript !== true) || (!Array.isArray (theScriptValue.lines))) {
				returnError (theResponse, 400, "Can't download " + theAddressString + " because it isn't a script, an outline or a wp text, and those are the three things this version moves.");
				return;
				}
			const theTitle = segments [segments.length - 1];
			const opmltext = scriptToOpml (theScriptValue, theTitle);
			if (config.flLogRequests) {
				console.log (nowText () + " downloadobject: sent " + segments.join (".") + ", " + theScriptValue.lines.length + " lines.");
				}

			/*  8/28/26 by CC -- the object's REAL address rides along. A window
				opened on a search-path name ("console.log") should title
				itself with the full path (system.verbs.builtins.console.log),
				the way Berkeley titles suites.console.log -- DW's report. The
				lookup resolved through the paths; pathForId walks back up
				from the row it landed on.  */

			var resolvedAddress = segments.join (".");
			if (theValue.odbId !== undefined) {
				const thePath = theStore.pathForId (theValue.odbId);
				if (thePath.length > 0) {
					resolvedAddress = thePath;
					}
				}
			returnJson (theResponse, 200, {
				address: segments.join ("."),
				resolvedAddress,
				scriptType: theScriptValue.scriptType, //9/24/26 by CC -- "wptext" for a wp text, so the window saves it back as one
				ctLines: theScriptValue.lines.length,
				opmltext
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't download " + theAddressString + " because " + err.message);
			}
		}
	function handleSearchSubtree (theResponse, theAddressString, theForText, theAfterAddressString, theAfterLineString, theAfterMenulineString) {

		/*  8/14/26 by CC -- the table half of the Find command, DW's spec:
			"if you start it in a table, it applies to the objects in the
			table at all levels. so for example, i can search my entire
			codebase by putting the table cursor on config.nodeeditor.projects
			and search." Frontier's tablefind walks the cells recursively; the
			same walk here is a depth-first sweep of the rows in table order.

			The match is against the row's name and its STORED text -- for a
			script that's the JSON of its lines, so what you can find is what
			the object says, with the small caveat that JSON escaping can in
			rare cases match where the window's find won't. The window the
			hit opens in owns the precise landing.

			after= makes Find Next work across objects: the walk skips
			everything up to and including that address before it starts
			looking.  */

		try {
			if ((theForText === undefined) || (theForText.length === 0)) {
				returnError (theResponse, 400, "Can't search because the request didn't say what to look for.");
				return;
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't search " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			var startId = 0; //the root table's children have parentid 0, odbSql's idRoot
			var flResolved = true;
			segments.forEach (function (segment) {
				if (flResolved) {
					const theRow = selectSearchChild.get (startId, segment.toLowerCase ());
					if (theRow === undefined) {
						flResolved = false;
						}
					else {
						startId = theRow.id;
						}
					}
				});
			if (!flResolved) {
				returnError (theResponse, 404, "Can't search " + theAddressString + " because there is no object at that address.");
				return;
				}

			const lookFor = theForText.toLowerCase ();
			const afterAddress = ((theAfterAddressString === undefined) ? "" : theAfterAddressString).toLowerCase ();
			const afterLine = ((theAfterLineString === undefined) || (theAfterLineString === "")) ? -1 : Number (theAfterLineString);
			const afterMenuline = ((theAfterMenulineString === undefined) || (theAfterMenulineString === "")) ? -1 : Number (theAfterMenulineString); //9/24/26 by CC -- a hit inside a menubar: which of its lines
			var flPastAfter = afterAddress.length === 0;
			var theHit;
			var ctVisited = 0;
			const maxVisited = 250000; //a runaway backstop, far past any real search

			/*  9/11/26 by CC -- DW's Find spec: search all the text at all
				levels, depth-first, stop on a match, open the window and
				highlight the line that matched; cmd-G goes to the next one.
				So the match is per LINE now, not per object: a script whose
				line reads xml.getValue (...) answers at that line, and cmd-G
				(after = the hit's address and line) steps to the next line,
				then on to the next object. A row with no lines -- a scalar, a
				table -- still matches on its name or its value, at line -1.  */

			function linesOfValue (theRow) { //the code lines of a script/outline, else undefined
				if ((theRow.type !== "script") && (theRow.type !== "outline") && (theRow.type !== "wptext")) {
					return (undefined);
					}
				if ((theRow.value === undefined) || (theRow.value === null)) {
					return (undefined);
					}
				try {
					const theParsed = JSON.parse (theRow.value);
					if (Array.isArray (theParsed) && (theParsed.length > 0) && (theParsed [0] !== null) && (typeof theParsed [0] === "object") && (theParsed [0].text !== undefined)) {
						return (theParsed);
						}
					}
				catch (err) {
					}
				return (undefined);
				}

			function linesOfMenubar (theRow) { //9/24/26 by CC -- a menubar's lines: each has text, and a command's line carries its script
				if (theRow.type !== "menubar") {
					return (undefined);
					}
				try {
					const theParsed = JSON.parse (theRow.value);
					if (Array.isArray (theParsed)) {
						return (theParsed);
						}
					}
				catch (err) {
					}
				return (undefined);
				}

			function firstHitInMenubar (theMenuLines, rowAddress, minMenuline, minLine) {

				/*  9/24/26 by CC -- the kernel's menufind: each menu line's text
					is searched, then the script linked to it (opflatfind on the
					script), in walk order. A hit is (menuline, line): line -1 is
					the menu line's own text, 0 and up a line of its script. The
					walk resumes strictly after (minMenuline, minLine).  */

				var ixMenu;
				for (ixMenu = Math.max (0, minMenuline); ixMenu < theMenuLines.length; ixMenu++) {
					const theMenuLine = theMenuLines [ixMenu];
					if ((ixMenu > minMenuline) && (String (theMenuLine.text).toLowerCase ().indexOf (lookFor) !== -1)) {
						return ({address: rowAddress, kind: "menubar", menuline: ixMenu, line: -1, lineText: String (theMenuLine.text)});
						}
					if ((theMenuLine.script !== undefined) && (theMenuLine.script !== null) && Array.isArray (theMenuLine.script.lines)) {
						const theScriptLines = theMenuLine.script.lines;
						var ixLine;
						for (ixLine = (ixMenu === minMenuline) ? (minLine + 1) : 0; ixLine < theScriptLines.length; ixLine++) {
							if (String (theScriptLines [ixLine].text).toLowerCase ().indexOf (lookFor) !== -1) {
								return ({address: rowAddress, kind: "menubar", menuline: ixMenu, line: ixLine, lineText: String (theScriptLines [ixLine].text)});
								}
							}
						}
					}
				return (undefined);
				}

			function firstHitInRow (theRow, rowAddress, minLine, minMenuline) {

				/*  The row's first match strictly after (minMenuline, minLine),
					in the kernel's order: the name, then the value -- a scalar's
					text, a script's or outline's lines, a menubar's lines and
					their scripts. A fresh row is asked with -2, -2: everything
					counts. The name hit is reported at line -1 (menuline -1), and
					a walk resuming after it (-1, -1) goes on to the value.

					9/24/26 by CC -- before today a name hit was reported at -1
					and the walk resumed "after -1", which found the same name
					again: cmd-G stuck on any object whose name matched. And a
					menubar was matched as one lump of JSON, with nowhere to land.  */

				if ((minLine < -1) && (minMenuline < -1) && (String (theRow.name).toLowerCase ().indexOf (lookFor) !== -1)) {
					return ({address: rowAddress, kind: theRow.type, line: -1, menuline: -1});
					}
				const theMenuLines = linesOfMenubar (theRow);
				if (theMenuLines !== undefined) {
					return (firstHitInMenubar (theMenuLines, rowAddress, minMenuline, minLine));
					}
				const theLines = linesOfValue (theRow);
				if (theLines !== undefined) {
					var ixLine;
					for (ixLine = Math.max (0, minLine + 1); ixLine < theLines.length; ixLine++) {
						if (String (theLines [ixLine].text).toLowerCase ().indexOf (lookFor) !== -1) {
							return ({address: rowAddress, kind: theRow.type, line: ixLine, lineText: String (theLines [ixLine].text)});
							}
						}
					return (undefined);
					}
				if ((minLine < -1) && (theRow.value !== undefined) && (theRow.value !== null) && (String (theRow.value).toLowerCase ().indexOf (lookFor) !== -1)) {
					return ({address: rowAddress, kind: theRow.type, line: -1}); //a scalar's value
					}
				return (undefined);
				}

			function visit (parentId, parentAddress) {
				if ((theHit !== undefined) || (ctVisited > maxVisited)) {
					return;
					}
				selectListerChildren.all (parentId).forEach (function (theRow) {
					if ((theHit !== undefined) || (ctVisited > maxVisited)) {
						return;
						}
					ctVisited++;
					const rowAddress = ((parentAddress.length === 0) ? "" : parentAddress + ".") + theRow.name;
					if (flPastAfter) {
						const theRowHit = firstHitInRow (theRow, rowAddress, -2, -2);
						if (theRowHit !== undefined) {
							theHit = theRowHit;
							return;
							}
						}
					else {
						if (rowAddress.toLowerCase () === afterAddress) {
							flPastAfter = true; //past this object now -- but its own later lines still count
							const theRowHit = firstHitInRow (theRow, rowAddress, afterLine, afterMenuline);
							if (theRowHit !== undefined) {
								theHit = theRowHit;
								return;
								}
							}
						}
					if (theRow.type === "table") {
						visit (theRow.id, rowAddress);
						}
					});
				}
			visit (startId, segments.join ("."));

			if (theHit === undefined) {
				returnJson (theResponse, 200, {found: false, ctVisited});
				}
			else {
				returnJson (theResponse, 200, {found: true, address: theHit.address, kind: theHit.kind, line: theHit.line, menuline: (theHit.menuline === undefined) ? -1 : theHit.menuline, lineText: theHit.lineText, ctVisited});
				}
			}
		catch (err) {
			returnError (theResponse, 500, "Can't search " + theAddressString + " because " + err.message);
			}
		}
	function handleGetMenubar (theResponse, theAddressString) { //8/8/26 by CC -- the app builds its menubar from this; a read call
		try {
			if (theAddressString === undefined) {
				theAddressString = "user.menus.customMenu"; //the menubar Frontier installs for the user
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't get the menubar at " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			var theValue = getValueAtAddress (segments);

			/*  9/3/26 by CC -- AN ADDRESS IS FOLLOWED, system.menus.buildMenuBar's
				own rule ("menus can be address": if typeOf (adrMenu^) ==
				addressType, adrMenu = adrMenu^). user.menus.tools is
				@Frontier.tools.menu in every Frontier since tools.init wrote
				it, and the Tools menu never went up here because this refused
				it as "not a menubar" -- DW's 9/3 report: "i don't see the
				Tools menu in the menubar."  */

			var ctHops = 0, theResolvedAddress = segments.join (".");
			while ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbAddressText === true) && (ctHops < 10)) {
				const targetSegments = parseAddressString (String (theValue.path));
				theValue = (targetSegments === undefined) ? undefined : getValueAtAddress (targetSegments);
				if (targetSegments !== undefined) {
					theResolvedAddress = targetSegments.join (".");
					}
				ctHops++;
				}
			if ((theValue === undefined) || (theValue === null)) {
				returnError (theResponse, 404, "Can't get the menubar at " + theAddressString + " because there is no object at that address.");
				return;
				}
			if ((theValue.flOdbMenubar !== true) || (!Array.isArray (theValue.lines))) {
				returnError (theResponse, 400, "Can't get the menubar at " + theAddressString + " because the object there isn't a menubar.");
				return;
				}
			/*  Each command's script goes out as OPML, rendered here with the
				same code downloadobject uses -- the app posts it straight back
				to /run, and isComment survives the trip, which plain text
				wouldn't manage. Copies, so the store's value is never touched.  */

			const menuLines = [];
			theValue.lines.forEach (function (theLine) {
				const lineCopy = Object.assign ({}, theLine);
				if ((lineCopy.script !== undefined) && (Array.isArray (lineCopy.script.lines))) {
					lineCopy.scriptOpml = scriptToOpml (lineCopy.script, lineCopy.text);
					}
				delete lineCopy.script;
				menuLines.push (lineCopy);
				});
			if (config.flLogRequests) {
				console.log (nowText () + " getmenubar: sent " + segments.join (".") + ", " + menuLines.length + " lines.");
				}
			returnJson (theResponse, 200, {
				address: segments.join ("."),
				resolvedAddress: theResolvedAddress, //9/3/26 by CC -- where the address led, so the app installs one menubar once however many entries point at it (meinstallmenubar on an installed menubar does nothing)
				ctLines: menuLines.length,
				lines: menuLines
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't get the menubar at " + theAddressString + " because " + err.message);
			}
		}
	function flPathNamed (theName) { //9/5/26 by CC -- a top-level name that is a file path: a colon (Mac) or a backslash (Windows) in it
		return ((String (theName).indexOf (":") !== -1) || (String (theName).indexOf ("\\") !== -1));
		}
	var theRootFilePathForScripts; //assigned by rootFilePathForScripts

	function rootFilePathForScripts () { //10/4/26 by CC -- the path Frontier.getFilePath () answers for the root, computed once with the same path map a run gets; "" if the verbs can't say
		if (theRootFilePathForScripts === undefined) {
			try {
				const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: false, flAllowNetwork: false, pathDatabase};
				if (config.pathMap !== undefined) {
					Object.keys (thePathMap).forEach (function (name) {
						if (config.pathMap [name] !== undefined) {
							thePathMap [name] = config.pathMap [name];
							}
						});
					}
				theRootFilePathForScripts = String (verbsMaker.makeVerbs (thePathMap, []).verbs ["frontier.getfilepath"] ([]));
				}
			catch (err) {
				theRootFilePathForScripts = "";
				}
			}
		return (theRootFilePathForScripts);
		}

	function handleGetDatabases (theResponse) { //8/8/26 by CC -- the logical databases, so windows can follow them

		/*  Reads system.compiler.files, written at build time: each entry is
			a database the browser can open as its own window -- a mount
			address (adr) or a list of top-level names it owns. One SQL file,
			many windows; the windows follow the databases, per DW's model.  */

		try {
			const databases = [];
			
			/*  8/21/26 by CC -- THE MAIN ROOT IS ALWAYS IN THE LIST. In Frontier
				every open database has a window and every one of them is in the
				Window menu; frontier.root is not in system.compiler.files
				because that table holds the GUEST databases, and the main root
				isn't a guest. DW, 8/21: "there's no choice but to put
				frontier.root in the menu. it's like saying you can't see the
				system folder on a mac."
				
				An empty address means the whole root, which is the view the
				browser page already knows how to show. Until 8/21 that view had
				no way in at all, so a table sitting at the root -- op, on his
				machine -- was invisible from every window in the app while it
				broke every op verb in the language.  */
			
			databases.push ({name: "frontier.root", address: "", filePath: rootFilePathForScripts ()}); //10/4/26 by CC -- filePath: what Frontier.getFilePath () answers; the root's window answers window.frontmost with it in brackets, so Add Bookmark there bookmarks the row under the cursor (misc/addBookmarkFix.md)

			var filesTable;
			try {
				filesTable = theStore.odb.system.compiler.files;
				}
			catch (err) {
				filesTable = undefined;
				}
			if ((filesTable !== undefined) && (filesTable !== null) && (typeof filesTable === "object")) {
				Reflect.ownKeys (filesTable).forEach (function (name) {
					if (typeof name !== "string") {
						return;
						}
					if ((name === "flOdbSqlTable") || (name === "odbId")) {
						return;
						}
					const theRecord = filesTable [name];
					if ((theRecord === undefined) || (theRecord === null) || (typeof theRecord !== "object")) {
						return;
						}
					
					/*  8/21/26 by CC -- sandbox0.root was never a guest database.
						It was our partial view of the MAIN root -- system, user,
						scratchpad, workspace -- under a name from the abandoned
						model where Frontier ran on a server. frontier.root above
						shows the whole root now, so listing this too would put a
						second, smaller view of the same database in the Window
						menu. DW, 8/21: "i don't want any duplicate views!"
						
						It's skipped rather than deleted because the row lives in
						the person's own database, which is theirs. Once no
						database in the wild carries it, this goes.  */
					
					if (name.toLowerCase () === "sandbox0.root") {
						return;
						}
					const theDatabase = {name};
					if (typeof theRecord.adr === "string") {
						theDatabase.address = theRecord.adr;
						}
					if (Array.isArray (theRecord.names)) {
						theDatabase.names = theRecord.names;
						if ((typeof theRecord.path === "string") && (theRecord.path.length > 0) && ((theDatabase.address === undefined) || (theDatabase.address.length === 0))) {

							/*  9/7/26 by CC -- A TOOL'S WINDOW IS ADDRESSED BY ITS FILE,
								the way the kernel addresses a guest: ["Macintosh
								HD:...:Tools:rssCodeUpdate.root"]. With no address the
								Tool's window answered window.frontmost with the empty
								string, and DW's backupFrontRoot (table.inGuestDatabase,
								fileMenu.saveCopy) had nothing to work from -- his 9/7
								report; on Berkeley the same script gets the bracketed
								path. The Tool's names still live at the top of the
								database; parseAddressString takes the path off.  */

							theDatabase.address = "[\"" + "Macintosh HD:" + String (theRecord.path).replace (/^\//, "").split ("/").join (":") + "\"]";
							}
						}
					databases.push (theDatabase);
					});
				}

			/*  9/5/26 by CC -- A TOP-LEVEL TABLE NAMED BY A FILE PATH IS AN OPEN
				GUEST DATABASE. That is how fileMenu.open keeps a guest here
				(environment.odb [thePath] = its top level) and how the 2012
				opml.root carries the Tool it had installed on Windows
				(C:\Program Files\OPML\...\dotOpml.root). In the kernel those
				live in the filewindowtable, keyed by path, and never show in
				the root's own window; they show in the Window menu by file
				name. DW's 9/5 ruling: guests "should appear in the list of
				open guest databases (which is what they are) as any other GDB
				would... the elements of the database should not be in the
				window for frontier.root." The address is the bracketed path,
				which parseAddressString takes. topName is the row's name, so
				the frontier.root window knows what to leave out.  */

			/*  10/1/26 by CC -- THE LOG'S OWN FILES ARE MARKED, so the app can
				leave them out of the Window menu. log.add keeps a database
				for each day in user.log.prefs.folder (log.getCurrentFile,
				1999, opened hidden), and each stays in this list for good:
				fileMenu.close does nothing here. DW, 9/19: "i don't want the
				dated roots in the list at all. i don't know what they are and
				they aren't in frontier." 9/30: "i don't want the dated
				entries in this menu." 10/1: "they aren't my windows." The
				kernel lists a hidden window in italics (shellwindowmenu.c),
				so this is his ruling, not the kernel's. Only the files in
				the log's folder are marked; a data file a script opened
				hidden (rssCodeUpdateData.root) is listed as before.  */

			var theLogFolder = "";
			try {
				const theFolderValue = theStore.odb.user.log.prefs.folder;
				if ((typeof theFolderValue === "string") && (theFolderValue.length > 0)) {
					theLogFolder = theFolderValue.toLowerCase ();
					}
				}
			catch (err) {
				}

			selectListerChildren.all (theStore.odb.odbId).forEach (function (theRow) {
				if ((theRow.type !== "table") || !flPathNamed (theRow.name)) {
					return;
					}
				const theDatabase = {name: String (theRow.name).split (/[:\\\/]/).pop (), address: "[\"" + theRow.name + "\"]", topName: theRow.name, flPathNamed: true};
				if ((theLogFolder.length > 0) && (String (theRow.name).toLowerCase ().indexOf (theLogFolder) === 0)) {
					theDatabase.flLogFile = true;
					}
				databases.push (theDatabase);
				});

			returnJson (theResponse, 200, {ctDatabases: databases.length, databases});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't list the databases because " + err.message);
			}
		}
	function handleUploadObject (theResponse, theAddressString, opmltext, scriptType, flAutosave) { //8/4/26 by CC; 9/3/26 -- flAutosave: the script window's autosave, which doesn't start an agent over
		try {
			if (theAddressString === undefined) {
				returnError (theResponse, 400, "Can't upload anything because the request carried no address.");
				return;
				}
			if ((opmltext === undefined) || (String (opmltext).trim ().length === 0)) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the request carried no OPML.");
				return;
				}
			if (scriptType === undefined) {
				scriptType = "script";
				}
			if ((scriptType !== "script") && (scriptType !== "outline") && (scriptType !== "wptext")) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the type must be script, outline or wptext, and the request says " + scriptType + ".");
				return;
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			var theValue = opmlToScript (opmltext, scriptType);
			if (theValue.lines.length === 0) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the OPML has no outline elements in it.");
				return;
				}
			const ctLines = theValue.lines.length;
			if (scriptType === "wptext") { //9/24/26 by CC -- the window's lines go back as the paragraphs of a wp text, the way they came out of /downloadobject
				theValue = {flWpText: true, text: linesToWptext (theValue.lines)};
				}
			/*  9/10/26 by CC -- THE WINDOW'S AUTOSAVE SAVES THE TEXT, NOT THE CODE. A
				script keeps running the code linked to it until Compile or Run
				compiles it again (DW's rule of 9/9; evaluate.js callOdbScript,
				odbSql.js addTheLinkedColumn). A write of the value unlinks, a
				new object -- right for an import, a webEdit, a script assigning
				a script -- so the autosave carries the link across.  */

			var theLinkedBefore;
			if (flAutosave === true) {
				const theIdBefore = theStore.idForPath (segments);
				if (theIdBefore !== undefined) {
					theLinkedBefore = theStore.linkedCodeForId (theIdBefore);
					}
				}
			installValueAtAddress (segments, theValue);
			if (theLinkedBefore !== undefined) {
				const theIdAfter = theStore.idForPath (segments);
				if (theIdAfter !== undefined) {
					theStore.setLinkedCode (theIdAfter, theLinkedBefore);
					}
				}
			if ((flAutosave === true) && (segments.length === 3) && (segments [0].toLowerCase () === "system") && (segments [1].toLowerCase () === "agents")) { //9/3/26 by CC -- an agent's autosaved version doesn't start the agent over; Compile does. See theAgentAutosaves.
				const theDates = theStore.datesForPath (segments);
				theAgentAutosaves [segments [2].toLowerCase ()] = (theDates === undefined) ? "" : String (theDates.whenModified);
				}
			if (config.flLogRequests) {
				console.log (nowText () + " uploadobject: installed " + segments.join (".") + ", " + ctLines + " lines.");
				}
			returnJson (theResponse, 200, {
				address: segments.join ("."),
				scriptType,
				ctLines,
				note: segments.join (".") + " installed in trigger's database, " + ctLines + " lines."
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't upload " + theAddressString + " because " + err.message);
			}
		}
	/*  Interactive runs -- 8/7/26 by CC. The script runs on a worker thread
		(runnerWorker.js). When it hits a dialog verb it posts the question
		here and blocks; the browser gets the question as the answer to
		whatever request it has open, shows it, and POSTs the person's answer
		to /dialoganswer -- which wakes the worker and waits for what happens
		next. One http exchange per question, however many it takes.  */

	const runsInFlight = {};
	var ctInteractiveRuns = 0;
	var theHiddenTargetCursors = {}; //8/14/26 by CC -- the hidden target's cursor per address, surviving across runs the way Frontier's hidden window does
	const maxDialogWaitMilliseconds = 10 * 60 * 1000; //an unanswered dialog can't hold a worker forever

	/*  9/16/26 by CC -- THE ABOUT WINDOW'S MESSAGE LINE, ccmsg in about.c.
		DW's ask 9/16, with his Berkeley screen shot: one line of text, a
		popup of the agents, and the choice says whose messages show. What the
		C does: a msg from a one-shot process (a run, a startup script, a
		thread -- threadcallscriptverb adds its process one-shot) is a
		FOREGROUND message: it takes the line and blocks background messages
		until the person clicks in the window, or a script says msg (""). A
		msg from an agent is a BACKGROUND message: it is kept in the agent's
		record (bsmsg), and shown only when that agent is the one chosen in
		the popup; while blocked it waits in the secondary slot and takes the
		line at the click. Choosing an agent shows its last message at once
		and unblocks (cancoonpopup.c ccagentselectvisit). The popup is
		system.agents in sorted order, the chosen one checked; with nothing
		chosen the first is (ccsetprimaryagent). The window itself is
		odbBrowser/about.html, polling /aboutstate once a second.  */

	const theAbout = {primary: "", secondary: undefined, flBackgroundBlocked: false, selectedAgent: undefined, agentMessages: {}, misc: ""};
	function aboutUnblock () { //ccunblockmsg; 9/17/26 -- and the held message lets go
		theAbout.flHeld = false;
		if (theAbout.flBackgroundBlocked) {
			theAbout.flBackgroundBlocked = false;
			if (theAbout.secondary !== undefined) {
				theAbout.primary = theAbout.secondary;
				theAbout.secondary = undefined;
				}
			}
		}
	function aboutMsg (theText, flBackground, agentName) { //ccmsg
		if (!flBackground && (theText.length === 0)) { //an empty foreground message unblocks
			aboutUnblock ();
			return;
			}
		if (theAbout.flHeld === true) { //9/17/26 by CC -- a held message keeps the line until a click in the window; see narrateStartup. An agent's message is still filed under its name
			if (flBackground && (agentName !== undefined) && (agentName !== null)) {
				theAbout.agentMessages [agentName] = theText;
				}
			return;
			}
		if (flBackground) {
			if ((agentName === undefined) || (agentName === null)) { //only agents send background messages
				return;
				}
			theAbout.agentMessages [agentName] = theText;
			if (theAbout.selectedAgent === undefined) {
				theAbout.selectedAgent = aboutAgentNames () [0];
				}
			if ((theAbout.selectedAgent === undefined) || (theAbout.selectedAgent.toLowerCase () !== String (agentName).toLowerCase ())) {
				return;
				}
			if (theAbout.flBackgroundBlocked) {
				theAbout.secondary = theText;
				return;
				}
			}
		theAbout.primary = theText;
		if (!flBackground) {
			theAbout.flBackgroundBlocked = true;
			}
		}
	function narrateStartup (theText, flHold) {

		/*  9/17/26 by CC -- STARTUP NARRATES IN THE ABOUT WINDOW. DW, 9/17, after
			a slow first launch on Vermont: "maybe use the About window with msg
			to narrate what's going on. Leave the all-done message in the about
			window until the user clicks to move past it." Each phase of the
			server's startup -- a Tool installing, the startup scripts, the
			agents -- goes to the About window's line as a foreground message,
			and the app's status window still shows it the way it did (theStartupStatus,
			/version). The all-done message is HELD: nothing replaces it, not
			the scheduler's every-second msg, until a click in the window
			(aboutUnblock). The hold is his ask, not the kernel's: Frontier's
			foreground messages replace one another freely.  */

		theStartupStatus = flHold ? "" : theText;
		aboutMsg (theText, false);
		if (flHold === true) {
			theAbout.flHeld = true;
			}
		console.log (nowText () + " startup: " + theText);
		}
	function aboutAgentNames () { //the popup: every script in system.agents, sorted the way the kernel's hashsortedinversesearch sorts
		const theNames = [];
		try {
			const agentsTable = theStore.odb.system.agents;
			if ((agentsTable !== undefined) && (agentsTable !== null)) {
				Object.keys (agentsTable).forEach (function (theName) {
					const theValue = agentsTable [theName];
					if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbScript === true)) {
						theNames.push (theName);
						}
					});
				}
			}
		catch (err) {
			}
		theNames.sort (function (a, b) {
			return (a.toLowerCase ().localeCompare (b.toLowerCase ()));
			});
		return (theNames);
		}
	function aboutSelectAgent (theName) { //ccagentselectvisit: the agent's last message takes the line, and background messages are unblocked
		theAbout.flHeld = false; //9/17/26 by CC -- choosing an agent is a click in the window
		theAbout.selectedAgent = theName;
		var theMessage = " ";
		Object.keys (theAbout.agentMessages).forEach (function (aName) {
			if (aName.toLowerCase () === String (theName).toLowerCase ()) {
				theMessage = theAbout.agentMessages [aName];
				}
			});
		theAbout.primary = theMessage;
		theAbout.secondary = undefined;
		theAbout.flBackgroundBlocked = false;
		}
	function aboutState () { //what the page asks for once a second
		const theNames = aboutAgentNames ();
		if ((theAbout.selectedAgent === undefined) && (theNames.length > 0)) {
			theAbout.selectedAgent = theNames [0];
			}
		var ctRuns = 0, theCurrent = "";
		Object.keys (runsInFlight).forEach (function (runId) {
			if (runsInFlight [runId].flFinishedForPage !== true) {
				ctRuns++;
				theCurrent = runId;
				}
			});
		Object.keys (theThreads).forEach (function (theId) {
			theCurrent = String (theId) + " [" + theThreads [theId].theName + "]"; //aboutsetthreadstring: the id, then the process's name in brackets
			});
		return ({
			message: theAbout.primary,
			agents: theNames,
			selectedAgent: theAbout.selectedAgent,
			ctScriptsRunning: Object.keys (theRunningAgents).length + Object.keys (theThreads).length + ctRuns + ctStartupScriptsRunning,
			currentThread: theCurrent,
			freeMemory: Math.round (require ("os").freemem () / (1024 * 1024) * 10) / 10 + "MB",
			misc: theAbout.misc,
			version: myVersion,
			usertalkVersion: versionUsertalk
			});
		}
	function respondToRun (theRun, theObject) {
		if (theRun.theResponse !== undefined) {
			returnJson (theRun.theResponse, 200, theObject);
			theRun.theResponse = undefined;
			}
		}
	function endRun (theRun, theObject) {

		/*  8/23/26 by CC -- A RUN JUST WROTE TO THE DATABASE ON ITS OWN
			CONNECTION. The worker opens the file itself, so everything it
			created or changed is invisible to the copy this process has been
			holding since startup -- and a name it looked for and didn't find
			stays not-found for the rest of the session. That is what DW hit
			on 8/23: he ran new (), the objects landed on disk, and nothing
			here could see them.

			Every way a run can end comes through here, so this is the one
			place it has to be asked. The check is a pragma, and it costs
			nothing unless something really changed.  */

		if (theStore !== undefined) {
			theStore.checkForOutsideChanges ();
			}

		/*  9/16/26 by CC -- THE WINDOW STAYS WITH THE THREAD. DW's report,
			9/16: nodeEditor's Save button runs thread.callScript
			(@nodeEditorSuite.saveButton, {}) and returns at once, and nothing
			happened -- the thread's window.frontmost got the no-window answer
			because the run that started it had ended (the 9/15 rule below).
			In Frontier the thread is a process and the window is a window;
			the one going has nothing to do with the other. So now a run whose
			threads still hold its window stays in runsInFlight after it
			finishes: the page hears the finish (with threadsWithWindow) and
			keeps listening on /dialoganswer for the threads' questions, and
			the run record goes when the last such thread lets go
			(threadLetGoOfTheWindow). Gate: misc/testThreads.js, a thread that
			outlives the run that started it.

			9/15/26 by CC -- (as it was) the run's threads may still be going;
			with no thread holding the window, any question of theirs waiting
			for this run's page gets the no-window answer now. One that is AT
			the page right now has the page's response; the finish waits for
			the page to come back with the thread's answer
			(handleDialogAnswer).  */

		const flThreadsWithWindow = ((theRun.ctWindowThreads !== undefined) && (theRun.ctWindowThreads > 0));
		if ((theRun.pendingQuestions !== undefined) && !flThreadsWithWindow) {
			theRun.pendingQuestions.forEach (function (theWaiting) {
				answerTheWorker (theWaiting.theAsker, {noWindow: true});
				});
			theRun.pendingQuestions = [];
			}
		clearTimeout (theRun.theTimer);
		if ((theRun.currentAsker !== undefined) && (theRun.currentAsker !== theRun)) {
			if (!flThreadsWithWindow) {
				answerTheWorker (theRun.currentAsker, {noWindow: true});
				theRun.currentAsker = undefined;
				}
			theRun.flFinished = theObject;
			return;
			}

		sendTheFinish (theRun, theObject);
		}
	function sendTheFinish (theRun, theObject) { //9/16/26 by CC -- the page gets the finish; the run record stays while its threads hold the window
		if ((theRun.ctWindowThreads !== undefined) && (theRun.ctWindowThreads > 0)) {
			theRun.flFinishedForPage = true;
			respondToRun (theRun, Object.assign ({threadsWithWindow: true, runId: theRun.runId}, theObject)); //the page listens on this run id
			}
		else {
			respondToRun (theRun, theObject);
			delete runsInFlight [theRun.runId];
			}
		}
	function threadLetGoOfTheWindow (theRun) { //9/16/26 by CC -- one fewer thread holds this run's window; the last one out tells the page it can stop listening
		theRun.ctWindowThreads = (theRun.ctWindowThreads === undefined) ? 0 : theRun.ctWindowThreads - 1;
		if ((theRun.ctWindowThreads <= 0) && (theRun.flFinishedForPage === true)) {
			theRun.flThreadsDone = true;
			if (theRun.theResponse !== undefined) { //the page is listening right now
				respondToRun (theRun, {finished: true, threadsDone: true});
				delete runsInFlight [theRun.runId];
				}
			else { //the page is between requests; its next one gets the word, and the record can't stay forever if the window closed
				setTimeout (function () {
					if (runsInFlight [theRun.runId] === theRun) {
						delete runsInFlight [theRun.runId];
						}
					}, maxDialogWaitMilliseconds);
				}
			}
		}
	function linkTheCompiledText (theAddressString, theOpmlText) { //9/10/26 by CC -- the text a window compiled becomes the script's linked code, for this session; see odbSql.js addTheLinkedColumn
		if ((theAddressString === undefined) || (theAddressString === null) || (String (theAddressString).length === 0)) {
			return;
			}
		try {
			const segments = parseAddressString (String (theAddressString));
			if (segments === undefined) {
				return;
				}
			const theId = theStore.idForPath (segments);
			if (theId === undefined) {
				return;
				}
			theStore.setLinkedCode (theId, {lines: opmlToScript (theOpmlText, "script").lines, session: theSessionId, stamp: Date.now ()});
			}
		catch (err) {
			}
		}

	function handleInteractiveRun (theResponse, theScript, pageRunId, theScriptAddress) { //9/5/26 by CC -- theScriptAddress: the address of the script a window is running, so this answers it (see runnerWorker.js)
		if ((theScript === undefined) || (theScript.trim ().length === 0)) {
			returnError (theResponse, 400, "Can't run anything because the request carried no script.");
			return;
			}
		ctInteractiveRuns++;
		/*  8/17/26 by CC -- the page may name the run itself, so its Kill
			button can call /killrun before the /run response comes back --
			the server's id would arrive too late to be any use.  */
		const runId = ((pageRunId !== undefined) && (pageRunId.length > 0)) ? pageRunId : "run" + ctInteractiveRuns + "-" + Math.floor (Math.random () * 1000000);
		if ((theScriptAddress !== undefined) && (String (theScriptAddress).length > 0)) { //9/10/26 by CC -- the Run button compiles the window's text and links it (scriptverifycompilation, then scriptcompiler); a text that doesn't parse links nothing, and the worker reports the error
			try {
				parse.parseOutline (opmlToTree (String (theScript)));
				linkTheCompiledText (theScriptAddress, String (theScript));
				}
			catch (err) {
				}
			}
		const sharedControl = new SharedArrayBuffer (8); //[0] answer-ready flag, [1] answer byte count
		const sharedData = new SharedArrayBuffer (65536);
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase}; //8/15/26 by CC -- the interactive runs on the worker thread get the same setting the in-process runs get
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
			workerData: {
				scriptText: theScript,
				folderUsertalk,
				pathDatabase,
				pathMap: thePathMap,
				folderRenders, //8/10/26 by CC -- so View can tell whether the page it names was rendered here
				sharedControl,
				sharedData,
				hiddenTargetCursors: theHiddenTargetCursors,
				scriptAddress: theScriptAddress, //9/5/26 by CC -- for this
				sessionId: theSessionId //9/10/26 by CC -- the linked code rule
				}
			});
		const theRun = {runId, theWorker, sharedControl, sharedData, theResponse};
		runsInFlight [runId] = theRun;
		theWorker.on ("message", function (theMessage) {
			switch (theMessage.type) {
				case "dialog":
					askThePage (theRun, theRun, theMessage.question); //9/15/26 by CC -- through the queue a thread of this run shares; see askThePage
					break;
				case "thread": //9/15/26 by CC -- thread.callScript and its family; the server starts and keeps the threads
				case "setting": //9/16/26 by CC -- window.setQuickScript
					answerWorkerAsk (theRun, theMessage);
					break;
				case "msg": //9/16/26 by CC -- the About window's line
					aboutMsg (theMessage.text, theMessage.flBackground, theMessage.agentName);
					break;
				case "httprequest": //8/12/26 by CC -- the script is reading a url; nobody has to answer this one
					if (config.flLogRequests) {
						console.log (nowText () + " " + runId + " reads: " + theMessage.request.url);
						}
					answerWorkerAsk (theRun, theMessage);
					break;
				case "tcp": //9/3/26 by CC -- a stream verb; the server owns the sockets
					answerWorkerAsk (theRun, theMessage);
					break;
				case "done":
					if (theMessage.hiddenTargetCursors !== undefined) {
						theHiddenTargetCursors = theMessage.hiddenTargetCursors;
						}
					endRun (theRun, Object.assign ({finished: true}, theMessage.result));
					break;
				case "failed":
					if (theMessage.hiddenTargetCursors !== undefined) {
						theHiddenTargetCursors = theMessage.hiddenTargetCursors;
						}
					endRun (theRun, {finished: true, message: theMessage.message, stack: theMessage.stack}); //8/21/26 by CC -- the crawl rides along; the page puts it in the JS console
					break;
				}
			});
		theWorker.on ("error", function (err) {
			endRun (theRun, {finished: true, message: "Can't finish the script because " + err.message});
			});
		}
	/*  9/3/26 by CC -- THE SOCKETS LIVE HERE. tcpstreams.js's owner runs on
		the server's main thread; a script's stream verbs -- on any worker:
		an interactive run, an agent, a startup script, a listener's
		callback -- post a "tcp" request over their channel and wait, and
		the owner answers into shared memory the way a dialog answer goes
		back. A listener's accepted connection starts the callback script as
		a process of its own (runcallback in MacSocketNetEvents.c): one
		worker, one line, callback (stream, refcon), the startup one-shot's
		shape. DW's ask for this round: "serving websites, the tcp stream
		verbs and the kernelized webserver."  */

	var theStreamOwner; //assigned by sureStreamOwner

	function sureStreamOwner () {
		if (theStreamOwner === undefined) {
			const tcpstreams = require (folderUsertalk + "/code/tcpstreams.js");
			theStreamOwner = tcpstreams.makeStreamOwner ({
				flAllowNetwork: ((config.pathMap !== undefined) && (config.pathMap.flAllowNetwork === true)),
				folderTemp: folderScriptTemp,
				onConnection: runListenCallback,
				onWebsocketMessage: runWebsocketCallback //10/4/26 by CC -- a message on a websocket runs the script the connection named, as a process of its own
				});
			}
		return (theStreamOwner);
		}

	/*  9/15/26 by CC -- THREADS, the kernel's way. thread.callScript
		(threadcallscriptverb, shellsysverbs.c) hands the call to
		addnewprocess: the script runs as a process of its own and the
		caller goes on at once. Here a thread is a worker of its own, started
		the way an agent is -- one shot, its own connection to the database
		-- and kept in a registry so thread.exists and thread.kill can find
		it. DW's rulings 9/15: a thread runs the agent way; one started from
		a script that has a window keeps that window -- its questions go to
		the page of the run it came from, one at a time, behind that run's
		own questions (askThePage); one started with no window has none.
		Until 9/15 thread.callScript ran the script in line and the caller
		waited: DW, "that's a bug"; Frontier.tools.install hung on its last
		line, scheduler0.monitorThreads, which starts the scheduler's loop
		this way.  */

	const theThreads = {}; //id -> {id, theWorker, theName, sharedControl, sharedData, pageRun}
	var nextThreadId = 2; //1 is the caller's own, thread.getCurrentId's answer

	function startThread (parentRun, theRequest, callback) { //callback ({id} or {message})
		const sharedControl = new SharedArrayBuffer (8);
		const sharedData = new SharedArrayBuffer (65536);
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		var pageRun; //the interactive run whose page this thread may ask: the parent itself, or the parent thread's page
		if ((parentRun !== undefined) && (parentRun !== null)) {
			pageRun = (parentRun.runId !== undefined) ? parentRun : parentRun.pageRun;
			}
		const theId = nextThreadId++;
		const theName = String (theRequest.name);
		const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
			workerData: {
				sessionId: theSessionId,
				flAgent: true,
				flOneShot: true,
				flThread: true,
				flHasWindow: (pageRun !== undefined),
				threadId: theId,
				agentLines: (Array.isArray (theRequest.lines) ? theRequest.lines : [{level: 0, text: String (theRequest.line), flComment: false}]), //thread.evaluate sends lines; thread.callScript one line
				scriptText: "",
				folderUsertalk,
				pathDatabase,
				pathMap: thePathMap,
				folderRenders,
				sharedControl,
				sharedData,
				hiddenTargetCursors: {}
				}
			});
		const theThread = {id: theId, theWorker, theName, sharedControl, sharedData, pageRun};
		theThreads [theId] = theThread;
		theThread.letGo = function () { //9/16/26 by CC -- thread.kill lets go the same way a stop does, so the window count comes back
			letGo ("killed");
			};
		if (pageRun !== undefined) { //9/16/26 by CC -- the run's page stays reachable while this thread holds its window; see endRun
			pageRun.ctWindowThreads = (pageRun.ctWindowThreads === undefined) ? 1 : pageRun.ctWindowThreads + 1;
			}
		console.log (nowText () + " threads: " + theName + " (" + theId + ") started" + ((pageRun === undefined) ? ", no window" : ", with the window of run " + pageRun.runId));
		var flLetGo = false;
		function letGo (theWhy) {
			if (flLetGo) {
				return;
				}
			flLetGo = true;
			delete theThreads [theId];
			if (pageRun !== undefined) {
				threadLetGoOfTheWindow (pageRun);
				}
			if (theWhy === "killed") { //9/16/26 by CC -- thread.kill: the log line is the same shape as a stop
				console.log (nowText () + " threads: " + theName + " (" + theId + ") killed");
				return;
				}
			if (theWhy !== undefined) {
				console.log (nowText () + " threads: " + theName + " (" + theId + ") stopped -- " + theWhy);
				}
			if (theStore !== undefined) {
				theStore.checkForOutsideChanges (); //whatever the thread wrote is real
				}
			}
		theWorker.on ("message", function (theMessage) {
			if (answerWorkerAsk (theThread, theMessage)) {
				return;
				}
			switch (theMessage.type) {
				case "dialog": {
					const thePage = (pageRun === undefined) ? undefined : runsInFlight [pageRun.runId];
					if (thePage === undefined) {
						if (config.flLogRequests) {
							console.log (nowText () + " threads: " + theName + " (" + theId + ") asked " + String (theMessage.question.verb || theMessage.question.kind) + " with no window");
							}
						answerTheWorker (theThread, {noWindow: true});
						}
					else {
						askThePage (thePage, theThread, theMessage.question);
						}
					break;
					}
				case "msg": //9/16/26 by CC -- a thread's msg is a foreground message, its process being one-shot
					aboutMsg (theMessage.text, false);
					break;
				case "agentdone":
					letGo ();
					break;
				case "agentfailed":
					letGo (theMessage.message);
					break;
				}
			});
		theWorker.on ("error", function (err) {
			letGo (err.message);
			});
		callback ({id: theId});
		}

	function handleThreadAsk (theRun, theRequest, callback) { //the thread family's asks
		switch (theRequest.op) {
			case "callscript":
				try {
					startThread (theRun, theRequest, callback);
					}
				catch (err) {
					console.log (nowText () + " threads: can't start " + theRequest.name + " -- " + err.message);
					callback ({message: "Can't start a thread for " + theRequest.name + " because " + err.message});
					}
				return;
			case "exists":
				callback ({value: theThreads [theRequest.id] !== undefined});
				return;
			case "kill": {
				const theThread = theThreads [theRequest.id];
				if (theThread !== undefined) {
					theThread.theWorker.terminate ();
					theThread.letGo (); //9/16/26 by CC -- the registry entry, the window count and the log line
					}
				callback ({value: true});
				return;
				}
			case "count":
				callback ({value: Object.keys (theThreads).length + 1});
				return;
			}
		callback ({message: "Can't do " + theRequest.op + " because the server doesn't know that thread operation."});
		}

	function askThePage (theRun, theAsker, theQuestion) { //9/15/26 by CC -- one question at a time reaches a run's page; a thread's question waits its turn behind the run's own
		if (theRun.pendingQuestions === undefined) {
			theRun.pendingQuestions = [];
			}
		theRun.pendingQuestions.push ({theAsker, theQuestion});
		deliverNextQuestion (theRun);
		}

	function deliverNextQuestion (theRun) {
		if ((theRun.currentAsker !== undefined) || (theRun.theResponse === undefined) || (theRun.pendingQuestions === undefined) || (theRun.pendingQuestions.length === 0)) {
			return;
			}
		const theNext = theRun.pendingQuestions.shift ();
		theRun.currentAsker = theNext.theAsker;
		if (config.flLogRequests) {
			console.log (nowText () + " " + theRun.runId + " asks: " + theNext.theQuestion.prompt);
			}
		theRun.theTimer = setTimeout (function () { //nobody answered
			if (theRun.currentAsker === theRun) { //the run's own question: let the worker go
				theRun.theWorker.terminate ();
				endRun (theRun, {finished: true, message: "Can't finish the script because the dialog went unanswered for " + (maxDialogWaitMilliseconds / 60000) + " minutes."});
				}
			else { //a thread's: it goes on as if there were no window
				answerTheWorker (theRun.currentAsker, {noWindow: true});
				theRun.currentAsker = undefined;
				}
			}, maxDialogWaitMilliseconds);
		respondToRun (theRun, {finished: false, runId: theRun.runId, dialog: theNext.theQuestion});
		}

	function answerWorkerAsk (theRun, theMessage) { //the asks every worker can make; true when this was one of them
		switch (theMessage.type) {
			case "httprequest":
				fetchForScript (theMessage.request, function (theAnswer) {
					answerTheWorker (theRun, theAnswer);
					});
				return (true);
			case "tcp":
				sureStreamOwner ().handle (theMessage.request, function (theAnswer) {
					answerTheWorker (theRun, theAnswer);
					});
				return (true);
			case "thread": //9/15/26 by CC
				handleThreadAsk (theRun, theMessage.request, function (theAnswer) {
					answerTheWorker (theRun, theAnswer);
					});
				return (true);
			case "setting": //9/16/26 by CC -- window.setQuickScript writes the Quick Script window's text; the server owns the settings table
				try {
					if (theMessage.request.op === "set") {
						theStore.setSetting (String (theMessage.request.name), String (theMessage.request.value));
						answerTheWorker (theRun, {value: true});
						}
					else {
						const theValue = theStore.getSetting (String (theMessage.request.name));
						answerTheWorker (theRun, {value: (theValue === undefined) ? "" : theValue});
						}
					}
				catch (err) {
					answerTheWorker (theRun, {message: "Can't " + theMessage.request.op + " the setting " + theMessage.request.name + " because " + err.message});
					}
				return (true);
			}
		return (false);
		}

	function runListenCallback (theListen, theStream) { //a connection came in: callback (stream, refcon) as its own process
		const sharedControl = new SharedArrayBuffer (8);
		const sharedData = new SharedArrayBuffer (65536);
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const theLine = theListen.callback + " (" + theStream.id + ", " + theListen.refcon + ")";
		const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
			workerData: {
				sessionId: theSessionId, //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
				flAgent: true,
				flOneShot: true,
				agentLines: [{level: 0, text: theLine, flComment: false}],
				threadId: nextThreadId++, //9/21/26 by CC -- every connection is a thread with an id of its own, the kernel's way. They all answered 1, and html.setPageTableAddress keeps each request's page table under thread.getCurrentID (): two requests at once -- a browser's page and its favicon -- wrote over each other, and a Manila page died on adrSiteRootTable
				scriptText: "",
				folderUsertalk,
				pathDatabase,
				pathMap: thePathMap,
				folderRenders,
				sharedControl,
				sharedData,
				hiddenTargetCursors: {}
				}
			});
		const theRun = {theName: theLine, sharedControl, sharedData};
		function letGo (theWhy) { //the callback is done, one way or another; a stream it left open goes with it
			try {
				if ((theStreamOwner !== undefined) && (theStreamOwner.theStreams [theStream.id] !== undefined)) {
					theStreamOwner.handle ({op: "abort", id: theStream.id}, function () {});
					}
				}
			catch (err) {
				}
			if (theWhy !== undefined) {
				console.log (nowText () + " tcp: " + theLine + " stopped -- " + theWhy);
				}
			}
		theWorker.on ("message", function (theMessage) {
			if (answerWorkerAsk (theRun, theMessage)) {
				return;
				}
			switch (theMessage.type) {
				case "agentdone":
					letGo ();
					if (theStore !== undefined) {
						theStore.checkForOutsideChanges ();
						}
					break;
				case "agentfailed":
					letGo (theMessage.message);
					if (theStore !== undefined) {
						theStore.checkForOutsideChanges ();
						}
					break;
				}
			});
		theWorker.on ("error", function (err) {
			letGo (err.message);
			});
		}

	function userTalkStringLiteral (theText) { //10/4/26 by CC -- the text as a UserTalk string literal, the escapes the scanner reads (parse.js): backslash, quote, return, newline, tab
		var theLiteral = "\"";
		String (theText).split ("").forEach (function (theChar) {
			switch (theChar) {
				case "\\": theLiteral += "\\\\"; break;
				case "\"": theLiteral += "\\\""; break;
				case "\r": theLiteral += "\\r"; break;
				case "\n": theLiteral += "\\n"; break;
				case "\t": theLiteral += "\\t"; break;
				default: theLiteral += theChar;
				}
			});
		return (theLiteral + "\"");
		}

	function runWebsocketCallback (theRecord, theText) { //10/4/26 by CC -- a message came in on a websocket: callback (socket, message) as its own process, the shape of runListenCallback above

		/*  The connection stays open when the callback is done -- it belongs
			to the script that opened it, or to the listener, and goes when they
			close it. Only the one-shot worker ends.  */

		const sharedControl = new SharedArrayBuffer (8);
		const sharedData = new SharedArrayBuffer (65536);
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const theLine = theRecord.callback + " (" + theRecord.id + ", " + userTalkStringLiteral (theText) + ")";
		const theLogName = theRecord.callback + " (" + theRecord.id + ", ...)";
		const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
			workerData: {
				sessionId: theSessionId,
				flAgent: true,
				flOneShot: true,
				agentLines: [{level: 0, text: theLine, flComment: false}],
				threadId: nextThreadId++,
				scriptText: "",
				folderUsertalk,
				pathDatabase,
				pathMap: thePathMap,
				folderRenders,
				sharedControl,
				sharedData,
				hiddenTargetCursors: {}
				}
			});
		const theRun = {theName: theLogName, sharedControl, sharedData};
		theWorker.on ("message", function (theMessage) {
			if (answerWorkerAsk (theRun, theMessage)) {
				return;
				}
			switch (theMessage.type) {
				case "agentdone":
					if (theStore !== undefined) {
						theStore.checkForOutsideChanges ();
						}
					break;
				case "agentfailed":
					console.log (nowText () + " websocket: " + theLogName + " stopped -- " + theMessage.message);
					if (theStore !== undefined) {
						theStore.checkForOutsideChanges ();
						}
					break;
				}
			});
		theWorker.on ("error", function (err) {
			console.log (nowText () + " websocket: " + theLogName + " stopped -- " + err.message);
			});
		}

	function answerTheWorker (theRun, theAnswer) { //8/12/26 by CC -- write it into shared memory and wake the thread that's waiting

		/*  8/13/26 by CC -- the night review found that an answer bigger than
			the shared window threw uncaught here and took the WHOLE SERVER
			down. An answer that doesn't fit becomes an error the script can
			hear; the server stays up. (Page bodies never come this way --
			the http verbs go through a file for exactly this reason.)  */

		var theBytes = Buffer.from (JSON.stringify (theAnswer), "utf8");
		const maxBytes = theRun.sharedData.byteLength;
		if (theBytes.length > maxBytes) {
			theBytes = Buffer.from (JSON.stringify ({message: "Can't deliver the answer because it's " + theBytes.length + " bytes and only " + maxBytes + " fit through this channel."}), "utf8");
			}
		new Uint8Array (theRun.sharedData).set (theBytes);
		const theControl = new Int32Array (theRun.sharedControl);
		Atomics.store (theControl, 1, theBytes.length);
		Atomics.store (theControl, 0, 1);
		Atomics.notify (theControl, 0);
		}

	/*  Reading a url for a script -- 8/12/26 by CC.

		The script's thread is stopped waiting, the same way it waits for a
		dialog, but nobody has to answer this one: the fetch happens right
		here on the main thread, without blocking it, and the answer goes
		back into shared memory when it arrives.

		The response never travels through that 64K window -- DW has plenty
		of OPML files bigger than that. It goes to a file, and the worker
		reads the file. Nothing about the size of a page is our business.

		DW's ruling on what it may reach: "refuse. if it's a problem deal
		with it separately." So every address is resolved first and anything
		that isn't on the public internet is refused -- the machine's own
		services, the private network, the cloud metadata address that hands
		out credentials. Each redirect is checked the same way, because a
		public name can send you to a private one.  */

	function flPrivateAddress (theAddress) {
		if (theAddress.indexOf (":") !== -1) { //IPv6 -- loopback, unique-local and link-local
			const lower = theAddress.toLowerCase ();
			return ((lower === "::1") || (lower === "::") || lower.startsWith ("fc") || lower.startsWith ("fd") || lower.startsWith ("fe8") || lower.startsWith ("fe9") || lower.startsWith ("fea") || lower.startsWith ("feb"));
			}
		const parts = theAddress.split (".");
		const first = Number (parts [0]), second = Number (parts [1]);
		if ((first === 127) || (first === 10) || (first === 0)) {
			return (true);
			}
		if ((first === 192) && (second === 168)) {
			return (true);
			}
		if ((first === 172) && (second >= 16) && (second <= 31)) {
			return (true);
			}
		if ((first === 169) && (second === 254)) { //link-local, which is where the cloud metadata service lives
			return (true);
			}
		if ((first === 100) && (second >= 64) && (second <= 127)) {
			return (true);
			}
		return (false);
		}

	function checkTheAddressIsPublic (theHostname, callback) { //callback (err)
		dnsTool.lookup (theHostname, {all: true}, function (err, theAddresses) {
			if (err !== null) {
				callback ({message: "the name " + theHostname + " didn't resolve."});
				return;
				}
			var flPrivate = false;
			theAddresses.forEach (function (theRecord) {
				if (flPrivateAddress (theRecord.address)) {
					flPrivate = true;
					}
				});
			if (flPrivate) {
				callback ({message: theHostname + " isn't on the public internet, and a script may only read from there."});
				return;
				}
			callback (undefined);
			});
		}


	/*  9/27/26 by CC -- AN ANSWER THAT IS BYTES STAYS BYTES. The response body
		was decoded as UTF-8 whatever it was, so a png read with tcp.httpReadUrl
		came back with every byte past 127 changed, and the picture DW's sample
		posted from the web was an empty box on Bluesky. The Content-Type of
		the answer says which it is: an image, a sound, a video or an
		octet-stream is bytes, one character per byte, the way file.readWholeFile
		answers; everything else is text, UTF-8 as before. The other half of
		bodyBufferFor, which does the same for a request going out.  */

	function textForResponseBody (theHeaders, theChunks) {
		var theType = "";
		Object.keys (theHeaders).forEach (function (theName) {
			if (theName.toLowerCase () === "content-type") {
				theType = String (theHeaders [theName]).toLowerCase ();
				}
			});
		const flBytes = (theType.indexOf ("image/") === 0) || (theType.indexOf ("audio/") === 0) || (theType.indexOf ("video/") === 0) || (theType.indexOf ("application/octet-stream") === 0);
		return (Buffer.concat (theChunks).toString (flBytes ? "latin1" : "utf8"));
		}

	/*  9/26/26 by CC -- A BINARY BODY GOES OUT AS ITS BYTES. A request body
	arrives here as a JavaScript string: text, or the bytes of a binary
	value one character per byte (a png read with file.readWholeFile,
	on its way to Bluesky's uploadBlob). Written as UTF-8, every byte past
	127 became two, and the image was garbage at the far end. The
	Content-Type says which it is: an image, a sound, a video or an
	octet-stream is bytes; everything else is text, UTF-8 as before.  */

	function bodyBufferFor (theHeaders, theData) {
	var theType = "";
	Object.keys (theHeaders).forEach (function (theName) {
		if (theName.toLowerCase () === "content-type") {
			theType = String (theHeaders [theName]).toLowerCase ();
			}
		});
	const flBytes = (theType.indexOf ("image/") === 0) || (theType.indexOf ("audio/") === 0) || (theType.indexOf ("video/") === 0) || (theType.indexOf ("application/octet-stream") === 0);
	return (Buffer.from (String (theData), flBytes ? "latin1" : "utf8"));
	}

	function fetchOneResponse (theRequest, callback) { //callback (err, {statusCode, headerText, theBody, theHeaders})
		var theUrl;
		try {
			theUrl = new URL (theRequest.url);
			}
		catch (err) {
			callback ({message: "\"" + theRequest.url + "\" isn't a url."});
			return;
			}
		if ((theUrl.protocol !== "http:") && (theUrl.protocol !== "https:")) {
			callback ({message: theUrl.protocol + " isn't a protocol a script can read."});
			return;
			}
		checkTheAddressIsPublic (theUrl.hostname, function (errAddress) {
			if (errAddress !== undefined) {
				callback (errAddress);
				return;
				}
			const theModule = (theUrl.protocol === "https:") ? https : http;
			const theHeaders = Object.assign ({}, theRequest.headers);
			const flBody = (theRequest.data !== undefined) && (theRequest.data.length > 0);
			if (flBody) { //9/12/26 by CC -- DW's report, a verb that worked: uploadRss stopped at S3 with "A header you provided implies functionality that is not implemented." A body written with no Content-Length goes out chunked, and S3 refuses chunked uploads. The transport under tcp.httpClient drops the glue's Content-Length (parseHttpCommand), so it's set here, from the bytes actually sent. Same change in usertalk/code/httphelper.js
				var flHasLength = false;
				Object.keys (theHeaders).forEach (function (theName) {
					if (theName.toLowerCase () === "content-length") {
						flHasLength = true;
						}
					});
				if (!flHasLength) {
					theHeaders ["Content-Length"] = bodyBufferFor (theHeaders, theRequest.data).length; //9/26/26 by CC -- the bytes actually sent, see bodyBufferFor
					}
				}
			const theOptions = {
				method: theRequest.method,
				headers: theHeaders
				};
			const theClientRequest = theModule.request (theUrl, theOptions, function (theClientResponse) {
				const theChunks = [];
				var ctBytes = 0;
				var flStopped = false;
				theClientResponse.on ("data", function (theChunk) {
					ctBytes += theChunk.length;
					if (ctBytes > config.maxHttpBytes) {
						flStopped = true;
						theClientRequest.destroy ();
						callback ({message: "the answer from " + theUrl.hostname + " is bigger than " + config.maxHttpBytes + " bytes."});
						return;
						}
					theChunks.push (theChunk);
					});
				theClientResponse.on ("end", function () {
					if (flStopped) {
						return;
						}
					var headerText = "HTTP/" + theClientResponse.httpVersion + " " + theClientResponse.statusCode + " " + theClientResponse.statusMessage + "\r\n";
					Object.keys (theClientResponse.headers).forEach (function (theName) {
						const theValue = theClientResponse.headers [theName];
						if (Array.isArray (theValue)) {
							theValue.forEach (function (oneValue) {
								headerText += theName + ": " + oneValue + "\r\n";
								});
							}
						else {
							headerText += theName + ": " + theValue + "\r\n";
							}
						});
					callback (undefined, {
						statusCode: theClientResponse.statusCode,
						theHeaders: theClientResponse.headers,
						headerText,
						theBody: textForResponseBody (theClientResponse.headers, theChunks) //9/27/26 by CC -- bytes stay bytes, see textForResponseBody
						});
					});
				});
			theClientRequest.setTimeout (theRequest.milliseconds, function () {
				theClientRequest.destroy ();
				callback ({message: theUrl.hostname + " didn't answer within " + Math.round (theRequest.milliseconds / 1000) + " seconds."});
				});
			theClientRequest.on ("error", function (err) {
				callback ({message: err.message + "."});
				});
			if (flBody) {
				theClientRequest.write (bodyBufferFor (theHeaders, theRequest.data)); //9/26/26 by CC -- a binary body as its bytes
				}
			theClientRequest.end ();
			});
		}

	function handleReadInclude (theResponse, theIncludeUrl) { //10/3/26 by CC -- see /readinclude
		if ((theIncludeUrl === undefined) || (theIncludeUrl === "undefined") || (theIncludeUrl.length === 0)) {
			returnError (theResponse, 400, "Can't read the include because no url was given.");
			return;
			}
		fetchForScript ({url: theIncludeUrl, method: "GET", headers: {"Accept": "text/x-opml", "User-Agent": "UserTalk"}, data: "", milliseconds: 30000, ctFollowRedirects: 5, flJustHeaders: false}, function (theAnswer) { //the shape a script's tcp.httpReadUrl sends (runnerWorker.js)
			if (theAnswer.message !== undefined) {
				returnError (theResponse, 502, theAnswer.message); //already "Can't read <url> because <reason>.
				return;
				}
			var theText = "";
			try {
				theText = fs.readFileSync (theAnswer.pathResponse, "utf8");
				fs.unlinkSync (theAnswer.pathResponse);
				}
			catch (err) {
				returnError (theResponse, 500, "Can't read the include at " + theIncludeUrl + " because " + err.message);
				return;
				}
			if ((theAnswer.statusCode === undefined) || (theAnswer.statusCode < 200) || (theAnswer.statusCode >= 300)) {
				returnError (theResponse, 502, "Can't read the include at " + theIncludeUrl + " because the server there answered " + theAnswer.statusCode + ".");
				return;
				}
			const ixBody = theText.indexOf ("\r\n\r\n"); //the headers come first in the response file, then a blank line, then the body
			const theBody = (ixBody === -1) ? theText : theText.substring (ixBody + 4);
			returnJson (theResponse, 200, {url: theIncludeUrl, opmltext: theBody});
			});
		}

	function fetchForScript (theRequest, callback) { //callback (theAnswer) -- {pathResponse, statusCode, theUrl} or {message}

		var ctRedirectsLeft = theRequest.ctFollowRedirects;
		const theUrlsVisited = [];

		function tryOne (theUrl) {
			theUrlsVisited.push (theUrl);
			fetchOneResponse (Object.assign ({}, theRequest, {url: theUrl}), function (err, theResult) {
				if (err !== undefined) {
					callback ({message: "Can't read " + theUrl + " because " + err.message});
					return;
					}
				const flRedirect = (theResult.statusCode >= 300) && (theResult.statusCode <= 308) && (theResult.theHeaders.location !== undefined);
				if (flRedirect && (ctRedirectsLeft > 0)) {
					ctRedirectsLeft--;
					tryOne (new URL (theResult.theHeaders.location, theUrl).toString ());
					return;
					}
				const theText = theRequest.flJustHeaders ? theResult.headerText : (theResult.headerText + "\r\n" + theResult.theBody);
				var pathResponse;
				try {
					fs.mkdirSync (folderScriptTemp, {recursive: true});
					pathResponse = pathTool.join (folderScriptTemp, "response" + Date.now () + Math.floor (Math.random () * 100000) + ".txt");
					fs.writeFileSync (pathResponse, theText);
					}
				catch (errWrite) {
					callback ({message: "Can't read " + theUrl + " because the answer couldn't be written down here -- " + errWrite.message});
					return;
					}
				callback ({
					pathResponse,
					statusCode: theResult.statusCode,
					theUrl,
					ctHeaderBytes: theResult.headerText.length
					});
				});
			}

		tryOne (theRequest.url);
		}

	function handleDialogAnswer (theResponse, theUrl, theBody) {
		const runId = urlParam (theUrl, "runid");
		const theRun = runsInFlight [runId];
		if (theRun === undefined) {
			returnError (theResponse, 404, "Can't deliver the answer because there is no script waiting on run " + runId + ".");
			return;
			}
		var theAnswer;
		try {
			theAnswer = JSON.parse (theBody);
			}
		catch (err) {
			returnError (theResponse, 400, "Can't deliver the answer because the body of the request isn't JSON.");
			return;
			}
		clearTimeout (theRun.theTimer);
		if (theRun.flFinished !== undefined) { //9/15/26 by CC -- the run ended while a thread's question was at the page; this is the page coming back, and the finish is what it gets
			theRun.theResponse = theResponse;
			if ((theRun.currentAsker !== undefined) && (theRun.currentAsker !== theRun)) { //9/16/26 by CC -- the thread's question was at the page and this is its answer; the thread keeps the window
				answerTheWorker (theRun.currentAsker, theAnswer);
				theRun.currentAsker = undefined;
				}
			const theFinish = theRun.flFinished;
			theRun.flFinished = undefined;
			sendTheFinish (theRun, theFinish);
			return;
			}
		if (theAnswer.listening === true) { //9/16/26 by CC -- the run is done and the page is here for its threads' questions; see endRun
			if (theRun.flThreadsDone === true) {
				returnJson (theResponse, 200, {finished: true, threadsDone: true});
				delete runsInFlight [runId];
				return;
				}
			theRun.theResponse = theResponse;
			deliverNextQuestion (theRun);
			return;
			}
		theRun.theResponse = theResponse; //the next dialog or the finish answers this request
		const theAsker = (theRun.currentAsker === undefined) ? theRun : theRun.currentAsker; //9/15/26 by CC -- the run itself, or one of its threads
		theRun.currentAsker = undefined;
		answerTheWorker (theAsker, theAnswer);
		deliverNextQuestion (theRun);
		}
	function summaryForRow (theRow) { //8/7/26 by CC -- one line of the odb browser: what goes in the value and kind columns

		/*  Works straight off the database row, so a table full of big values
			costs one query per entry, never a decode of the values themselves.
			The 8/4 performance lesson: never walk more of the database than
			the answer needs.  */

		function truncate (theText) {
			const oneLine = String (theText).replace (/\s+/g, " ");
			if (oneLine.length > 80) {
				return (oneLine.substring (0, 80) + "…"); //horizontal ellipsis
				}
			return (oneLine);
			}
		switch (theRow.type) {
			case "table": {
				const ctItems = countListerChildren.get (theRow.id).ct;
				return ({kind: "table", value: ctItems + ((ctItems === 1) ? " item" : " items"), flTable: true});
				}
			case "script": case "outline": {
				var ctLines = 0;
				try {
					ctLines = JSON.parse (theRow.value).length;
					}
				catch (err) {
					}
				return ({kind: theRow.type, value: ctLines + ((ctLines === 1) ? " line" : " lines")});
				}
			case "wptext":
				return ({kind: "wp text", value: truncate (theRow.value)});
			case "string":
				return ({kind: "string", value: truncate (theRow.value)});
			case "number": case "boolean":
				return ({kind: theRow.type, value: String (theRow.value)});
			case "char": //8/26/26 by CC -- the row keeps the code; the window shows the character
				return ({kind: "char", value: String.fromCharCode (Number (theRow.value))});
			case "date":
				return ({kind: "date", value: new Date (theRow.value).toLocaleString ()});
			case "list":
				return ({kind: "list", value: truncate (theRow.value)});
			case "address":
				return ({kind: "address", value: String (theRow.value)});
			case "novalue": //8/28/26 by CC -- the kernel's strings, lang.r via hashgetvaluestring and hashgettypestring
				return ({kind: "(none)", value: "(nil)"});
			case "marker": { //an undecoded value -- the row remembers its Frontier type and size, not the bytes
				var markerKind = "binary";
				try {
					markerKind = JSON.parse (theRow.value).type;
					}
				catch (err) {
					}
				return ({kind: markerKind, value: "on disk"});
				}
			default:
				return ({kind: theRow.type, value: ""});
			}
		}
	function handleListTable (theResponse, theUrl) { //8/7/26 by CC -- the odb browser asks what's in a table, one level, summaries only
		try {
			const theAddressString = urlParam (theUrl, "address");
			const theIdString = urlParam (theUrl, "id");
			var theId, addressForErrors;
			if (theIdString !== undefined) { //the browser expands by row id, so a name with a dot in it can't break the address

				addressForErrors = "id " + theIdString;
				theId = Number (theIdString);
				if (!Number.isInteger (theId)) {
					returnError (theResponse, 400, "Can't list " + addressForErrors + " because the id has to be a whole number.");
					return;
					}
				const theRow = selectListerRow.get (theId);
				if (theRow === undefined) {
					returnError (theResponse, 404, "Can't list " + addressForErrors + " because there is no object with that id.");
					return;
					}
				if (theRow.type !== "table") {
					returnError (theResponse, 400, "Can't list " + addressForErrors + " because it isn't a table.");
					return;
					}
				}
			else {
				if ((theAddressString === undefined) || (theAddressString.length === 0) || (theAddressString.toLowerCase () === "root")) { //no address means the top level of the database; 10/3/26 by CC -- and so does the name root, the kernel's special table (langgetspecialtable in langvalue.c)
					addressForErrors = "the top level";
					theId = theStore.odb.odbId;
					}
				else {
					addressForErrors = theAddressString;
					const segments = parseAddressString (theAddressString);
					if (segments === undefined) {
						returnError (theResponse, 400, "Can't list " + theAddressString + " because it isn't a clean dotted address.");
						return;
						}
					const theValue = getValueAtAddress (segments);
					if ((theValue === undefined) || (theValue === null)) {
						returnError (theResponse, 404, "Can't list " + theAddressString + " because there is no object at that address.");
						return;
						}
					if (theValue.flOdbSqlTable !== true) {
						returnError (theResponse, 400, "Can't list " + theAddressString + " because it isn't a table.");
						return;
						}
					theId = theValue.odbId;
					}
				}
			const entries = [];
			selectListerChildren.all (theId).forEach (function (theRow) {
				const summary = summaryForRow (theRow);
				const entry = {
					name: theRow.name,
					kind: summary.kind,
					value: summary.value
					};
				if (summary.flTable === true) {
					entry.flTable = true;
					entry.id = theRow.id;
					}
				entries.push (entry);
				});
			if (config.flLogRequests) {
				console.log (nowText () + " listtable: " + addressForErrors + ", " + entries.length + " entries.");
				}
			var theFormats; //8/27/26 by CC -- the table's display formats ride in its own row, the kernel's way; the window reads them here
			const scopeRow = selectListerRow.get (theId);
			if ((scopeRow !== undefined) && (scopeRow.type === "table") && (scopeRow.value !== null) && (scopeRow.value !== undefined)) {
				try {
					theFormats = JSON.parse (scopeRow.value);
					}
				catch (err) {
					}
				}
			const theAnswer = {
				address: (theAddressString === undefined) ? "" : theAddressString,
				ctEntries: entries.length,
				entries
				};
			if (theFormats !== undefined) {
				theAnswer.formats = theFormats;
				}
			if ((theAddressString !== undefined) && (theAddressString.length > 0)) { //8/28/26 by CC -- the table's real address, for the window title; see handleDownloadObject
				const thePath = theStore.pathForId (theId);
				if (thePath.length > 0) {
					theAnswer.resolvedAddress = thePath;
					}
				}
			returnJson (theResponse, 200, theAnswer);
			}
		catch (err) {
			returnError (theResponse, 500, "Can't list the table because " + err.message);
			}
		}
	/*  8/27/26 by CC -- THE TABLE WINDOW EDITS, DW's go-ahead. The rules are
		the kernel's: names are always editable and a rename keeps the row
		(tableedit.c); a value cell takes what you type by tablegetwpedittext's
		dance -- run it, retry it quoted, coerce it to the old type -- which
		lives in usertalk's tableedit.js so the behavior gate can hold it to
		the C; a new item lands below the cursor as a cell with no value
		(tablemakenewvalue); deleting takes the row and its subtree
		(tableclearroutine), after the object is saved to Guest
		Databases/ops/deleted as a fat page, because this Frontier has no Undo
		yet and the kernel's delete leans on Undo; column widths clamp to the
		kernel's 50..1000 (tableformats.c) and live with the table.  */

	function adoptGuestName (theDatabase, theNewName, theOldName) {

		/*  9/13/26 by CC -- A GUEST DATABASE'S WINDOW OWNS WHAT IS MADE IN IT.
			A Tools root is installed at the top of frontier.root, and the
			scanner's record in system.compiler.files says which top-level
			names are the guest's; its window lists those and frontier.root's
			window leaves them out. A new item made at the top of the guest's
			window landed at the top of frontier.root, unowned, and the window
			never showed it again -- DW's 9/13 report: a new item, given the
			type script, "and i get a blank window." Now a new, pasted, renamed
			or deleted top-level item in a guest's window changes the guest's
			list of names, so the item stays in the window it was made in.  */

		try {
			const filesTable = theStore.odb.system.compiler.files;
			const theRecord = filesTable [theDatabase];
			if ((theRecord === undefined) || (theRecord === null) || !Array.isArray (theRecord.names)) {
				return;
				}
			const theNames = [];
			theRecord.names.forEach (function (theName) {
				if ((theOldName === undefined) || (String (theName).toLowerCase () !== String (theOldName).toLowerCase ())) {
					theNames.push (theName);
					}
				});
			if (theNewName !== undefined) {
				var flThere = false;
				theNames.forEach (function (theName) {
					if (String (theName).toLowerCase () === String (theNewName).toLowerCase ()) {
						flThere = true;
						}
					});
				if (!flThere) {
					theNames.push (theNewName);
					}
				}
			theRecord.names = theNames;
			}
		catch (err) {
			console.log (nowText () + " tableedit: couldn't update the names of " + theDatabase + ": " + err.message);
			}
		}

	function segmentsForEditAddress (theAddressText) { //9/7/26 by CC -- the table window's edits: brackets and a bare guest path both read the way parseAddressString reads them; an empty address is the root
		var theText = String ((theAddressText === undefined) || (theAddressText === null) ? "" : theAddressText);
		if (theText.startsWith ("@")) {
			theText = theText.slice (1);
			}
		if (theText.length === 0) {
			return ([]);
			}
		const parsed = parseAddressString (theText);
		if (parsed !== undefined) {
			return (parsed);
			}
		return (splitAddressText (theText)); //9/9/26 by CC
		}

	function listerRowForSegments (segments) { //walk the rows by name; answers {id, parentId, name, type, value} or undefined
		var parentId = theStore.odb.odbId;
		var theFound;
		var flLost = false;
		segments.forEach (function (theSegment) {
			if (flLost) {
				return;
				}
			const theChild = selectSearchChild.get ((theFound === undefined) ? parentId : theFound.id, String (theSegment).toLowerCase ());
			if (theChild === undefined) {
				flLost = true;
				return;
				}
			if (theFound !== undefined) {
				parentId = theFound.id;
				}
			theFound = theChild;
			});
		if (flLost || (theFound === undefined)) {
			return (undefined);
			}
		const theRow = selectListerRow.get (theFound.id);
		return ({id: theFound.id, parentId, name: theRow.name, type: theRow.type, value: theRow.value});
		}
	function tableProxyForSegments (segments) { //the live table the runtime writes through; undefined when the walk fails
		var current = theStore.odb;
		var flLost = false;
		segments.forEach (function (theSegment) {
			if (flLost || (current === undefined) || (current === null) || (current.flOdbSqlTable !== true)) {
				flLost = true;
				return;
				}
			current = current [theSegment];
			});
		if (flLost || (current === undefined) || (current === null) || (current.flOdbSqlTable !== true)) {
			return (undefined);
			}
		return (current);
		}
	function flCleanIdentifier (theName) {
		return (/^[A-Za-z_][A-Za-z0-9_]*$/.test (String (theName)));
		}
	function addressLiteralForSegments (segments) { //the UserTalk text that names the object -- brackets around any name that isn't a clean identifier
		var theText = "";
		var flPossible = true;
		segments.forEach (function (theSegment, ix) {
			if (!flPossible) {
				return;
				}
			if (flCleanIdentifier (theSegment)) {
				theText += ((ix === 0) ? "" : ".") + theSegment;
				}
			else {
				if (ix === 0) {
					flPossible = false; //a bracketed FIRST segment isn't a name the grammar takes
					return;
					}
				theText += ".[\"" + String (theSegment).replace (/\\/g, "\\\\").replace (/"/g, "\\\"") + "\"]";
				}
			});
		return (flPossible ? theText : undefined);
		}
	function rescueBeforeDelete (segments, theRow) { //the object goes to ops/deleted before it's removed -- no Undo yet, so nothing is ever really lost
		try {
			const folderDeleted = pathTool.join (pathTool.dirname (pathTool.resolve (pathDatabase)), "Guest Databases", "ops", "deleted");
			if (!fs.existsSync (folderDeleted)) {
				fs.mkdirSync (folderDeleted, {recursive: true});
				}
			const theStamp = (new Date ()).toISOString ().replace (/[:.]/g, "-");
			const packables = {script: ".ftsc", table: ".fttb", outline: ".ftop", menubar: ".ftmb"};
			if (packables [theRow.type] !== undefined) { //a real fat page, importable with fatPages.importFatFile
				const theLiteral = addressLiteralForSegments (segments);
				if (theLiteral !== undefined) {
					const theText = evaluateInternal ("fatPages.buildFileAtts (@" + theLiteral + ", false)");
					if (typeof theText === "string") {
						const thePath = pathTool.join (folderDeleted, segments.join (".") + " " + theStamp + packables [theRow.type]);
						fs.writeFileSync (thePath, theText, "latin1");
						return (thePath);
						}
					}
				}
			//a scalar -- the row's own stored text, enough to put it back by hand
			const thePath = pathTool.join (folderDeleted, segments.join (".") + " " + theStamp + ".txt");
			fs.writeFileSync (thePath, theRow.type + "\n" + ((theRow.value === null) ? "" : String (theRow.value)) + "\n");
			return (thePath);
			}
		catch (err) {
			console.log (nowText () + " tableedit: couldn't save " + segments.join (".") + " before deleting it -- " + err.message);
			return (undefined);
			}
		}
	function handleMenubarEdit (theResponse, theBody) {

		/*  9/1/26 by CC -- THE MENUBAR EDITOR'S SERVER HALF, DW's go-ahead
			("you should just go ahead and do it"). Three actions: save takes
			the whole structure from the window -- levels, texts, command
			keys, each line's script riding as OPML -- and writes the menubar
			object back; getscript and setscript move one command's script in
			and out of its own script window. setscript validates the line's
			text still matches what the window opened on, so a script never
			lands on the wrong command after the structure was rearranged --
			it refuses instead.  */

		function fault (theMessage) {
			returnJson (theResponse, 200, {message: theMessage});
			}
		try {
			var theAsk;
			try {
				theAsk = JSON.parse (theBody);
				}
			catch (err) {
				returnError (theResponse, 400, "Can't edit the menubar because the body of the request isn't JSON.");
				return;
				}
			const segments = parseAddressString (String (theAsk.address));
			if (segments === undefined) {
				fault ("Can't edit the menubar at " + theAsk.address + " because it isn't a clean dotted address.");
				return;
				}
			const theValue = getValueAtAddress (segments);
			if ((theValue === undefined) || (theValue === null) || (theValue.flOdbMenubar !== true)) {
				fault ("Can't edit the menubar at " + theAsk.address + " because the object there isn't a menubar.");
				return;
				}
			switch (theAsk.action) {
				case "save": {

					/*  The window sends the structure -- levels, texts,
						command keys -- and each line that came FROM the
						menubar carries the index it was loaded at. The
						scripts and modifier flags are merged from the lines
						as they are in the database RIGHT NOW, by that index,
						so a script saved from its own window minutes ago is
						never overwritten with the editor's stale copy. A
						line typed fresh in the window has no index and no
						script yet.  */

					if (!Array.isArray (theAsk.lines)) {
						fault ("Can't save the menubar because the request carried no lines.");
						return;
						}
					const theLines = [];
					theAsk.lines.forEach (function (theLine) {
						const lineValue = {
							level: Number (theLine.level),
							text: String (theLine.text),
							flExpanded: theLine.flExpanded !== false,
							flComment: false,
							flBreakpoint: false
							};
						if ((theLine.cmdkey !== undefined) && (String (theLine.cmdkey).length > 0)) {
							lineValue.cmdkey = String (theLine.cmdkey);
							}
						const ixOriginal = Number (theLine.ixoriginal);
						if (!isNaN (ixOriginal) && (theValue.lines [ixOriginal] !== undefined)) {
							const originalLine = theValue.lines [ixOriginal];
							if (originalLine.script !== undefined) {
								lineValue.script = originalLine.script;
								}
							if (originalLine.cmdmodifiers !== undefined) {
								lineValue.cmdmodifiers = originalLine.cmdmodifiers;
								}
							}
						theLines.push (lineValue);
						});
					installValueAtAddress (segments, {flOdbMenubar: true, lines: theLines});
					if (config.flLogRequests) {
						console.log (nowText () + " menubaredit: saved " + segments.join (".") + ", " + theLines.length + " lines.");
						}
					returnJson (theResponse, 200, {address: segments.join ("."), ctLines: theLines.length});
					return;
					}
				case "getscript": {
					const ixLine = Number (theAsk.ixline);
					const theLine = theValue.lines [ixLine];
					if (theLine === undefined) {
						fault ("Can't get the script because the menubar has no line " + theAsk.ixline + ".");
						return;
						}
					var theOpml;
					if ((theLine.script !== undefined) && (Array.isArray (theLine.script.lines))) {
						theOpml = scriptToOpml (theLine.script, theLine.text);
						}
					else { //a command with no script yet opens on a line you can type in
						theOpml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head><title>" + theLine.text.split ("&").join ("&amp;").split ("<").join ("&lt;") + "</title></head><body><outline text=\"\"></outline></body></opml>";
						}
					returnJson (theResponse, 200, {address: segments.join ("."), ixLine, lineText: theLine.text, opmltext: theOpml});
					return;
					}
				case "setscript": {
					const ixLine = Number (theAsk.ixline);
					const theLine = theValue.lines [ixLine];
					if (theLine === undefined) {
						fault ("Can't save the script because the menubar has no line " + theAsk.ixline + ".");
						return;
						}
					if (theLine.text !== String (theAsk.linetext)) {
						fault ("Can't save the script because the menubar changed since the window opened -- the line says “" + theLine.text + "” now, not “" + theAsk.linetext + "”. Open the command again from the menubar window."); //left double quote, right double quote
						return;
						}
					const theLines = theValue.lines.slice ();
					theLines [ixLine] = Object.assign ({}, theLine, {script: opmlToScript (String (theAsk.opmltext), "script")});
					installValueAtAddress (segments, {flOdbMenubar: true, lines: theLines});
					if (config.flLogRequests) {
						console.log (nowText () + " menubaredit: saved the script on line " + ixLine + " of " + segments.join (".") + ".");
						}
					returnJson (theResponse, 200, {address: segments.join ("."), ixLine, ctLines: theLines [ixLine].script.lines.length});
					return;
					}
				default:
					fault ("Can't edit the menubar because \"" + theAsk.action + "\" isn't an action this endpoint answers.");
					return;
				}
			}
		catch (err) {
			returnError (theResponse, 500, "Can't edit the menubar because " + err.message);
			}
		}

	function handleTableEdit (theResponse, theBody) {
		function fault (theMessage) {
			returnJson (theResponse, 200, {message: theMessage});
			}
		try {
			var theAsk;
			try {
				theAsk = JSON.parse (theBody);
				}
			catch (err) {
				returnError (theResponse, 400, "Can't edit the table because the body of the request isn't JSON.");
				return;
				}
			switch (theAsk.action) {
				case "newitem": {

					/*  tablemakenewvalue: an empty cell goes in below the
						cursor and the person names it. Ours arrives named --
						the next free "item #N", the claybrowser way -- and
						holds no value, so what gets typed into it later keeps
						its own type.  */

					const parentSegments = ((theAsk.parentaddress === undefined) || (String (theAsk.parentaddress).length === 0)) ? [] : segmentsForEditAddress (theAsk.parentaddress);
					var parentId = theStore.odb.odbId;
					if (parentSegments.length > 0) {
						const parentRow = listerRowForSegments (parentSegments);
						if ((parentRow === undefined) || (parentRow.type !== "table")) {
							fault ("Can't make a new item because " + parentSegments.join (".") + " isn't a table.");
							return;
							}
						parentId = parentRow.id;
						}
					const theProxy = tableProxyForSegments (parentSegments);
					if (theProxy === undefined) {
						fault ("Can't make a new item because " + ((parentSegments.length === 0) ? "the top level" : parentSegments.join (".")) + " couldn't be reached.");
						return;
						}
					var theName;
					var ct = 1;
					while (theName === undefined) {
						const tryName = "item #" + ct;
						if (selectSearchChild.get (parentId, tryName.toLowerCase ()) === undefined) {
							theName = tryName;
							}
						ct++;
						}
					theProxy [theName] = undefined; //a row with no value -- novalue, the kernel's empty cell
					if ((parentSegments.length === 0) && (theAsk.database !== undefined)) { //9/13/26 by CC -- made at the top of a guest's window: the guest owns it
						adoptGuestName (String (theAsk.database), theName, undefined);
						}
					console.log (nowText () + " tableedit: new item " + theName + " in " + ((parentSegments.length === 0) ? "the top level" : parentSegments.join (".")));
					returnJson (theResponse, 200, {name: theName, value: "(nil)", kind: "(none)"}); //the kernel's empty-cell strings
					return;
					}
				case "rename": {
					const segments = segmentsForEditAddress (theAsk.address);
					const theAnswer = theStore.renameForPath (segments, String (theAsk.newname));
					if (theAnswer.flRenamed !== true) {
						fault (theAnswer.message);
						return;
						}
					if ((segments.length === 1) && (theAsk.database !== undefined)) { //9/13/26 by CC -- a guest's top-level name changed
						adoptGuestName (String (theAsk.database), String (theAsk.newname), segments [0]);
						}
					console.log (nowText () + " tableedit: renamed " + theAsk.address + " to " + theAsk.newname);
					returnJson (theResponse, 200, {flRenamed: true, name: String (theAsk.newname)});
					return;
					}
				case "move": { //9/6/26 by CC -- a row dragged into another table, the kernel browser's claymovefile
					const segments = segmentsForEditAddress (theAsk.address);
					const parentSegments = (String (theAsk.newparent).length === 0) ? [] : segmentsForEditAddress (theAsk.newparent);
					const theAnswer = theStore.moveForPath (segments, parentSegments);
					if (theAnswer.flMoved !== true) {
						fault (theAnswer.message);
						return;
						}
					console.log (nowText () + " tableedit: moved " + theAsk.address + " into " + ((parentSegments.length === 0) ? "the root" : theAsk.newparent));
					returnJson (theResponse, 200, {flMoved: true});
					return;
					}
				case "getvalue": {

					/*  getvalueedittext: the display truncates long values;
						the edit field gets the whole text.  */

					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						fault ("Can't get the value of " + theAsk.address + " because there is no object at that address.");
						return;
						}
					if (!tableedit.flCellEditable (theRow.type)) {
						fault ("Can't edit the value of " + theRow.name + " because it's a " + ((theRow.type === "wptext") ? "wp text" : theRow.type) + ", not a scalar.");
						return;
						}
					var editText = "";
					switch (theRow.type) {
						case "novalue":
							break;
						case "char":
							editText = String.fromCharCode (Number (theRow.value));
							break;
						case "date":
							editText = dates.frontierDateToString (new Date (theRow.value)); //9/6/26 by CC -- was toLocaleString, not a form date () reads back
							break;
						default:
							editText = (theRow.value === null) ? "" : String (theRow.value);
							break;
						}
					returnJson (theResponse, 200, {editText, kind: theRow.type});
					return;
					}
				case "possiblekinds": {

					/*  9/2/26 by CC -- DW's ask: "disable the items that would get
						an error dialog if you chose it." coercionpossible in
						tablepopup.c decides by brute force -- it tries the
						coercion and reports whether it worked -- so this does
						the same with the language's own coercion verbs, on a
						copy of the value, and the popup disables the rest.  */

					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						fault ("Can't say which kinds " + theAsk.address + " can become because there is no object at that address.");
						return;
						}
					const thePossible = {};
					if (theRow.type === "novalue") { //an empty cell can become anything the popup makes
						["boolean", "char", "number", "date", "string", "address", "table", "wptext", "outline", "script", "menubar", "list"].forEach (function (theType) {
							thePossible [theType] = true;
							});
						}
					else {
						if (tableedit.flCellEditable (theRow.type)) {
							const theProxy = tableProxyForSegments (segments.slice (0, segments.length - 1));
							const oldValue = (theProxy === undefined) ? undefined : theProxy [theRow.name];
							const scalarCoercions = {boolean: "boolean (ccCellValue)", char: "char (ccCellValue)", number: "number (ccCellValue)", date: "date (ccCellValue)", string: "string (ccCellValue)", address: "address (ccCellValue)"};
							Object.keys (scalarCoercions).forEach (function (theType) {
								try {
									const theCoerced = evaluateInternal (scalarCoercions [theType], {ccCellValue: oldValue});
									if ((theType === "number") && ((typeof theCoerced !== "number") || isNaN (theCoerced))) {
										return;
										}
									thePossible [theType] = true;
									}
								catch (err) {
									}
								});
							}
						thePossible [theRow.type] = true; //its own kind, "certainly possible"
						}
					returnJson (theResponse, 200, {address: theAsk.address, kind: theRow.type, possible: Object.keys (thePossible)});
					return;
					}
				case "settype": {

					/*  the Kind popup's answer (tablekindrecalc, tablepopup.c),
						and the wedge dialog's: a cell with no value becomes
						an empty object of the chosen type -- scalar kinds
						start from nil through the language's own coercion
						verbs; a scalar cell coerces IN PLACE, the kernel's
						"^0 = ^2 (^0)". An external stays what it is -- the
						kernel's popup disables those moves too
						(coercionpossible).  */

					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						fault ("Can't set the type of " + theAsk.address + " because there is no object at that address.");
						return;
						}
					const theProxy = tableProxyForSegments (segments.slice (0, segments.length - 1));
					if (theProxy === undefined) {
						fault ("Can't set the type of " + theAsk.address + " because its table couldn't be reached.");
						return;
						}
					if (!tableedit.flCellEditable (theRow.type)) { //an external doesn't change type here
						fault ("Can't change the type of " + theRow.name + " because it's a " + ((theRow.type === "wptext") ? "wp text" : theRow.type) + " -- open it in its own window instead.");
						return;
						}
					const externalTargets = {table: true, outline: true, script: true, wptext: true, menubar: true};
					const scalarCoercions = {boolean: "boolean (ccCellValue)", char: "char (ccCellValue)", number: "number (ccCellValue)", date: "date (ccCellValue)", string: "string (ccCellValue)", address: "address (ccCellValue)"};
					if (externalTargets [theAsk.type] === true) {
						if (theRow.type !== "novalue") {
							fault ("Can't make " + theRow.name + " a " + theAsk.type + " because it already has a value.");
							return;
							}
						const emptyLine = {level: 0, text: "", flExpanded: true, flComment: false, flBreakpoint: false};
						switch (theAsk.type) {
							case "table":
								theProxy [theRow.name] = {};
								break;
							case "outline":
								theProxy [theRow.name] = {flOdbScript: true, scriptType: "outline", lines: [emptyLine]};
								break;
							case "script":
								theProxy [theRow.name] = {flOdbScript: true, scriptType: "script", lines: [emptyLine]};
								break;
							case "wptext":
								theProxy [theRow.name] = {flWpText: true, text: ""};
								break;
							case "menubar":
								theProxy [theRow.name] = {flOdbMenubar: true, lines: [emptyLine]};
								break;
							}
						}
					else {
						if (theAsk.type === "list") { //no coercion verb -- nil becomes the empty list
							if (theRow.type !== "novalue") {
								fault ("Can't make " + theRow.name + " a list because it already has a value.");
								return;
								}
							theProxy [theRow.name] = [];
							}
						else {
							const theCoercion = scalarCoercions [theAsk.type];
							if (theCoercion === undefined) {
								fault ("Can't set the type of " + theRow.name + " because \"" + theAsk.type + "\" isn't a kind this popup can make yet.");
								return;
								}
							if (theRow.type === "novalue") {

								/*  a cell with no value takes the kernel's nil
									coercions (langvalue.c): 0, false, the
									empty string, the zero char, the 1904
									origin date  */

								switch (theAsk.type) {
									case "boolean":
										theProxy [theRow.name] = false;
										break;
									case "number":
										theProxy [theRow.name] = 0;
										break;
									case "string":
										theProxy [theRow.name] = "";
										break;
									case "char":
										theProxy [theRow.name] = evaluateInternal ("char (0x30)"); //zero -- stringtochar's nil answer
										break;
									case "date":
										theProxy [theRow.name] = evaluateInternal ("date (0)"); //the 1904 origin
										break;
									default:
										fault ("Can't make " + theRow.name + " an " + theAsk.type + " because an empty cell has nothing to point at.");
										return;
									}
								}
							else {
								const oldValue = theProxy [theRow.name];
								var theCoerced;
								try {
									theCoerced = evaluateInternal (theCoercion, {ccCellValue: oldValue});
									}
								catch (err) {
									fault ("Can't make " + theRow.name + " a " + theAsk.type + " because " + err.message);
									return;
									}
								if ((theAsk.type === "number") && ((typeof theCoerced !== "number") || isNaN (theCoerced))) {
									fault ("Can't make " + theRow.name + " a number because its value doesn't read as one.");
									return;
									}
								theProxy [theRow.name] = theCoerced;
								}
							}
						}
					console.log (nowText () + " tableedit: " + theAsk.address + " is a " + theAsk.type + " now");
					const theSummary = summaryForRow (selectListerRow.get (theRow.id));
					returnJson (theResponse, 200, {flSet: true, value: theSummary.value, kind: theSummary.kind});
					return;
					}
				case "setvalue": {
					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						fault ("Can't set the value of " + theAsk.address + " because there is no object at that address.");
						return;
						}
					if (!tableedit.flCellEditable (theRow.type)) {
						fault ("Can't edit the value of " + theRow.name + " because it's a " + ((theRow.type === "wptext") ? "wp text" : theRow.type) + ", not a scalar.");
						return;
						}
					const parentSegments = segments.slice (0, segments.length - 1);
					const theProxy = tableProxyForSegments (parentSegments);
					if (theProxy === undefined) {
						fault ("Can't set the value of " + theAsk.address + " because its table couldn't be reached.");
						return;
						}
					const parentLiteral = (parentSegments.length === 0) ? undefined : addressLiteralForSegments (parentSegments);
					const theAnswer = tableedit.editCellValue ({
						oldType: theRow.type,
						theText: String (theAsk.text),
						evaluateText: function (theText) {

							/*  tablepushcontext: the typed text runs with the
								table on the scope chain, so sibling names win.
								with yields its body's value -- verified.  */

							if (parentLiteral === undefined) {
								return (evaluateInternal (theText));
								}
							return (evaluateInternal ("with " + parentLiteral + " {" + theText + "}"));
							},
						coerceText: function (theExpressionText, theSeedValue) {
							return (evaluateInternal (theExpressionText, {ccCellValue: theSeedValue}));
							}
						});
					if (theAnswer.flChanged === true) {
						theProxy [theRow.name] = theAnswer.theValue;
						console.log (nowText () + " tableedit: set " + theAsk.address);
						}
					const theSummary = summaryForRow (selectListerRow.get (theRow.id));
					returnJson (theResponse, 200, {flChanged: theAnswer.flChanged === true, value: theSummary.value, kind: theSummary.kind});
					return;
					}
				case "delete": {
					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						fault ("Can't delete " + theAsk.address + " because there is no object at that address.");
						return;
						}
					const theProxy = tableProxyForSegments (segments.slice (0, segments.length - 1));
					if (theProxy === undefined) {
						fault ("Can't delete " + theAsk.address + " because its table couldn't be reached.");
						return;
						}
					const pathRescue = rescueBeforeDelete (segments, theRow);
					delete theProxy [theRow.name];
					if ((segments.length === 1) && (theAsk.database !== undefined)) { //9/13/26 by CC -- a guest's top-level name gone
						adoptGuestName (String (theAsk.database), undefined, theRow.name);
						}
					console.log (nowText () + " tableedit: deleted " + theAsk.address + ((pathRescue === undefined) ? "" : ", saved first as " + pathRescue));
					returnJson (theResponse, 200, {flDeleted: true});
					return;
					}
				case "deleteifempty": { //9/5/26 by CC -- the table window's auto-created "item #1" (browserdeletedummyvalues): gone when it leaves the display, but only while it still holds no value
					const segments = segmentsForEditAddress (theAsk.address);
					const theRow = listerRowForSegments (segments);
					if (theRow === undefined) {
						returnJson (theResponse, 200, {flDeleted: false});
						return;
						}
					if (theRow.type !== "novalue") {
						returnJson (theResponse, 200, {flDeleted: false}); //somebody gave it a value; it's real now
						return;
						}
					const theProxy = tableProxyForSegments (segments.slice (0, segments.length - 1));
					if (theProxy === undefined) {
						returnJson (theResponse, 200, {flDeleted: false});
						return;
						}
					delete theProxy [theRow.name];
					returnJson (theResponse, 200, {flDeleted: true});
					return;
					}
				case "setsortorder": { //8/29/26 by CC -- the Sort popup's answer, kept with the table beside the column widths

					const segments = segmentsForEditAddress (theAsk.address);
					const theOrder = String (theAsk.sortOrder);
					if ((String (theAsk.address).length === 0) || (["name", "value", "kind"].indexOf (theOrder) === -1)) {
						fault ("Can't set the sort order because the request is missing the table or names an order that isn't name, value or kind.");
						return;
						}
					const existingFormats = theStore.formatsForPath (segments);
					const theFormats = (existingFormats === undefined) ? {} : existingFormats;
					theFormats.sortOrder = theOrder;
					theFormats.flSortReversed = (theAsk.flReversed === true); //9/2/26 by CC -- DW's ask: a second click on the column title sorts in reverse; the direction rides with the order
					if (!theStore.setFormatsForPath (segments, theFormats)) {
						fault ("Can't set the sort order because " + theAsk.address + " isn't a table.");
						return;
						}
					returnJson (theResponse, 200, {flSet: true, sortOrder: theOrder, flReversed: theFormats.flSortReversed});
					return;
					}
			case "setcolwidths": {
					const segments = segmentsForEditAddress (theAsk.address);
					if ((String (theAsk.address).length === 0) || !Array.isArray (theAsk.colWidths)) {
						fault ("Can't set the column widths because the request is missing the table or the widths.");
						return;
						}
					const theWidths = [];
					theAsk.colWidths.forEach (function (theWidth) {
						theWidths.push (Math.min (1000, Math.max (50, Math.round (Number (theWidth) || 50)))); //the kernel's mincolwidth and maxcolwidth
						});
					const existingFormats = theStore.formatsForPath (segments);
					const theFormats = (existingFormats === undefined) ? {} : existingFormats;
					theFormats.colWidths = theWidths;
					if (!theStore.setFormatsForPath (segments, theFormats)) {
						fault ("Can't set the column widths because " + theAsk.address + " isn't a table.");
						return;
						}
					returnJson (theResponse, 200, {flSet: true, colWidths: theWidths});
					return;
					}
				case "paste": { //9/13/26 by CC -- a row copied in one table window and pasted in another: the object is copied, the kernel browser's paste (odbSql.js copyForPath)
					const sourceSegments = segmentsForEditAddress (theAsk.sourceaddress);
					const parentSegments = ((theAsk.parentaddress === undefined) || (String (theAsk.parentaddress).length === 0)) ? [] : segmentsForEditAddress (theAsk.parentaddress);
					const theAnswer = theStore.copyForPath (sourceSegments, parentSegments, theAsk.flReplace === true);
					if (theAnswer.flCopied !== true) {
						if (theAnswer.flExists === true) {
							returnJson (theResponse, 200, {flCopied: false, flExists: true, name: sourceSegments [sourceSegments.length - 1], question: theAnswer.message}); //the page asks the kernel's question and comes back with flReplace
							return;
							}
						fault (theAnswer.message);
						return;
						}
					if ((parentSegments.length === 0) && (theAsk.database !== undefined)) { //9/13/26 by CC -- pasted at the top of a guest's window: the guest owns it
						adoptGuestName (String (theAsk.database), theAnswer.name, undefined);
						}
					console.log (nowText () + " tableedit: pasted " + theAsk.sourceaddress + " into " + ((parentSegments.length === 0) ? "the top level" : parentSegments.join (".")));
					returnJson (theResponse, 200, {flCopied: true, name: theAnswer.name});
					return;
					}
				default:
					fault ("Can't edit the table because \"" + theAsk.action + "\" isn't an action this endpoint does.");
					return;
				}
			}
		catch (err) {
			fault ("Can't edit the table because " + err.message);
			}
		}

	const typesForExtensions = { //8/7/26 by CC -- the odb browser's static files
		".html": "text/html; charset=utf-8",
		".js": "text/javascript; charset=utf-8",
		".css": "text/css; charset=utf-8",
		".svg": "image/svg+xml",
		".png": "image/png",
		".gif": "image/gif",
		".woff": "font/woff",
		".woff2": "font/woff2",
		".ttf": "font/ttf",
		".eot": "application/vnd.ms-fontobject",
		".map": "application/json",
		".opml": "text/xml; charset=utf-8", //8/10/26 by CC -- from here down, what a build renders
		".xml": "text/xml; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".md": "text/markdown; charset=utf-8",
		".txt": "text/plain; charset=utf-8",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".ico": "image/x-icon",
		".fttb": "text/plain; charset=utf-8", //8/15/26 by CC -- fat pages: what "Get update from Marin" reads
		".ftmb": "text/plain; charset=utf-8"
		};
	function serveStaticFile (theResponse, folderBase, relativePath) {
		const fullPath = pathTool.normalize (pathTool.join (folderBase, relativePath));
		if (!fullPath.startsWith (folderBase + pathTool.sep)) { //nothing outside the folder, however the path is spelled
			returnError (theResponse, 403, "Can't serve " + relativePath + " because it reaches outside the folder.");
			return;
			}
		const theType = typesForExtensions [pathTool.extname (fullPath).toLowerCase ()];
		if (theType === undefined) {
			returnError (theResponse, 403, "Can't serve " + relativePath + " because files of that type aren't served here.");
			return;
			}
		fs.readFile (fullPath, function (err, theBuffer) {
			if (err) {
				returnError (theResponse, 404, "Can't serve " + relativePath + " because there is no file with that name.");
				}
			else {
				/*  8/10/26 by CC -- no-cache, and it earned its place: DW's
					window had yesterday's stylesheet with today's script, so
					the version landed at the bottom of the window instead of
					the corner and the page grew a second scrollbar. A ship
					has to arrive all at once. These files are small and one
					person reads them; revalidating costs nothing.  */
				theResponse.writeHead (200, Object.assign ({
					"Content-Type": theType,
					"Content-Length": theBuffer.length,
					"Cache-Control": "no-cache"
					}, headersCors));
				theResponse.end (theBuffer);
				}
			});
		}
	function handleOdbBrowserFile (theResponse, theUrl) { //8/7/26 by CC -- the browser app's page, and Concord out of its own folder

		var relativePath = theUrl.pathname.slice ("/odbbrowser".length); //the original casing -- fontAwesome's folder name has a capital in it

		if ((relativePath === "") || (relativePath === "/")) {
			relativePath = "/index.html";
			}
		if (relativePath.startsWith ("/concord/")) {
			serveStaticFile (theResponse, folderConcord, relativePath.slice ("/concord/".length));
			}
		else {
			serveStaticFile (theResponse, folderOdbBrowser, relativePath.slice (1));
			}
		}
	function handleRenderFile (theResponse, theUrl) {

		/*  8/10/26 by CC -- a build's output, served back. Everything a
			sandbox build writes lands in the renders folder, and until now
			nothing could look at it: the View button opened the address the
			outline names, which is the live site, not what was just built.
			No password, the way a web server serves a page -- what a build
			renders is a page meant to be read.  */

		var relativePath = theUrl.pathname.slice ("/renders".length);

		if (relativePath.endsWith ("/") || (relativePath === "")) {
			relativePath += "index.html";
			}
		serveStaticFile (theResponse, folderRenders, relativePath.slice (1));
		}

	function readBody (theRequest, callback, theResponseForRefusing) {

		/*  theResponseForRefusing is optional -- pass it and an oversized body is
			refused here instead of being read into memory. 8/4/26 by CC.  */

		var theBody = "";
		var flTooBig = false;
		theRequest.on ("data", function (chunk) {
			theBody += chunk;
			if ((theResponseForRefusing !== undefined) && (theBody.length > config.maxWebeditBytes) && !flTooBig) {
				flTooBig = true;
				returnError (theResponseForRefusing, 413, "Can't accept the request because it's bigger than " + config.maxWebeditBytes + " bytes.");
				theRequest.destroy ();
				}
			});
		theRequest.on ("end", function () {
			if (!flTooBig) {
				callback (theBody);
				}
			});
		}
	function nowText () {
		return (new Date ().toLocaleString ());
		}
	function handleHttpRequest (theRequest, theResponse) {

		const theUrl = new URL (theRequest.url, "http://localhost");
		const thePath = theUrl.pathname.toLowerCase ();

		/*  8/23/26 by CC -- the other place another connection could have
			gotten in. endRun covers a Run this server started; this covers
			everything else that opens the same file -- a misc script, a test
			harness installing fixtures, a second copy of the app. One pragma
			per request, and it drops the caches only when something really
			moved. See checkForOutsideChanges in odbSql.js.  */

		if (theStore !== undefined) {
			theStore.checkForOutsideChanges ();
			}

		if (theRequest.method === "OPTIONS") { //8/4/26 by CC -- the preflight a browser sends before a cross-origin POST
			theResponse.writeHead (204, headersCors);
			theResponse.end ();
			return;
			}

		switch (thePath) {
			case "/":
				returnText (theResponse, 200, myProductName + " v" + myVersion + "\n\nPOST a UserTalk script to /run?password=xxx and the value comes back as JSON.\nA one-liner can go in the URL: /run?password=xxx&script=string.lower%20(%22HELLO%22)\nAdd &trace=1 to see every verb the script called.\n\nObjects move as OPML:\n/downloadobject?password=xxx&address=system.temp.hello\nPOST the OPML to /uploadobject?password=xxx&address=system.temp.hello&type=script\n");
				break;
			case "/getsetting": //9/16/26 by CC -- a value kept with the database outside the odb table (odbSql.js settings): the Quick Script window's text, the kernel's hscriptstring
				if (!requestIsAuthorized (theRequest, theUrl, false)) {
					returnError (theResponse, 401, "Can't read the setting because the password is missing or wrong.");
					}
				else {
					const theValue = theStore.getSetting (String (urlParam (theUrl, "name")));
					returnJson (theResponse, 200, {name: String (urlParam (theUrl, "name")), value: (theValue === undefined) ? "" : theValue, flDefined: (theValue !== undefined)});
					}
				break;
			case "/readinclude": //10/3/26 by CC -- an outline window expanding an include asks for the OPML at its url; the server reads it the way a script's tcp.httpReadUrl does (fetchForScript), with Accept: text/x-opml, the OPML Editor's header for includes
				if (!requestIsAuthorized (theRequest, theUrl, false)) {
					returnError (theResponse, 401, "Can't read the include because the password is missing or wrong.");
					}
				else {
					handleReadInclude (theResponse, String (urlParam (theUrl, "url")));
					}
				break;
			case "/setsetting": //9/16/26 by CC -- the body is the value
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't write the setting because the password is missing, wrong, or doesn't have the power to write.");
					}
				else {
					readBody (theRequest, function (theBody) {
						theStore.setSetting (String (urlParam (theUrl, "name")), theBody);
						returnJson (theResponse, 200, {name: String (urlParam (theUrl, "name")), value: theBody});
						});
					}
				break;
			case "/aboutstate": //9/16/26 by CC -- the About window asks once a second
				if (!requestIsAuthorized (theRequest, theUrl, false)) {
					returnError (theResponse, 401, "Can't read the About window's state because the password is missing or wrong.");
					}
				else {
					returnJson (theResponse, 200, aboutState ());
					}
				break;
			case "/aboutselect": //9/16/26 by CC -- the popup: the agent whose messages show
				if (!requestIsAuthorized (theRequest, theUrl, false)) {
					returnError (theResponse, 401, "Can't choose the agent because the password is missing or wrong.");
					}
				else {
					aboutSelectAgent (String (urlParam (theUrl, "agent")));
					returnJson (theResponse, 200, aboutState ());
					}
				break;
			case "/aboutclick": //9/16/26 by CC -- any click in the About window re-enables background messages (aboutmousedown)
				if (!requestIsAuthorized (theRequest, theUrl, false)) {
					returnError (theResponse, 401, "Can't take the click because the password is missing or wrong.");
					}
				else {
					aboutUnblock ();
					returnJson (theResponse, 200, aboutState ());
					}
				break;
			case "/version":
				returnJson (theResponse, 200, {
					product: myProductName,
					version: myVersion,
					usertalkVersion: versionUsertalk,
					ctDatabaseRows: theStore.countRows (),
					status: theStartupStatus //9/10/26 by CC -- what the server is still doing before it is ready; empty when it is
					});
				break;
			case "/rpc2": case "/RPC2": //8/1/26 by CC -- XML-RPC; 8/28/26 -- Frontier writes /RPC2, so both spellings answer
				if (theRequest.method === "POST") {
					handleWebeditRequest (theRequest, theResponse);
					}
				else {
					returnText (theResponse, 405, "POST an XML-RPC call here.\n");
					}
				break;
			case "/compilescript": //8/14/26 by CC -- the Compile button: parse only, never run; the answer is clean or the error, which names the line
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't compile the script because the password is missing or wrong.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							try {
								const theStatements = parse.parseOutline (opmlToTree (String (theBody)));
								const compiledAddress = urlParam (theUrl, "address"); //9/3/26 by CC -- a compiled agent script is what starts the agent over; see theAgentAutosaves
								linkTheCompiledText (compiledAddress, String (theBody)); //9/10/26 by CC -- it compiled: this text is the code now, the kernel's scriptcompiler; a failure threw above and the old code stays linked
								if ((compiledAddress !== undefined) && (compiledAddress.toLowerCase ().indexOf ("system.agents.") === 0)) {
									delete theAgentAutosaves [compiledAddress.split (".").pop ().toLowerCase ()];
									}
								returnJson (theResponse, 200, {ok: true, ctStatements: theStatements.length});
								}
							catch (err) {
								returnJson (theResponse, 200, {ok: false, message: err.message});
								}
							});
						}
					else {
						returnText (theResponse, 405, "POST the script's OPML here and the answer says whether it compiles.\n");
						}
					}
				break;
			case "/run":
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't run the script because the password is missing, wrong, or doesn't have the power to run scripts.");
					}
				else {
					const flInteractive = theUrl.searchParams.has ("interactive"); //8/7/26 by CC -- dialogs allowed; the script runs on a worker thread
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							if (flInteractive) {
								handleInteractiveRun (theResponse, theBody, urlParam (theUrl, "runid"), urlParam (theUrl, "address"));
								}
							else {
								handleRun (theRequest, theResponse, theUrl, theBody);
								}
							});
						}
					else {
						if (flInteractive) {
							handleInteractiveRun (theResponse, urlParam (theUrl, "script"), urlParam (theUrl, "runid"), urlParam (theUrl, "address"));
							}
						else {
							handleRun (theRequest, theResponse, theUrl, urlParam (theUrl, "script"));
							}
						}
					}
				break;
			case "/killrun": //8/17/26 by CC -- the Kill button: today's cmd-period, DW's ruling replacing the verb-call cap
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't kill the run because the password is missing, wrong, or doesn't have the power to run scripts.");
					}
				else {
					const theRun = runsInFlight [urlParam (theUrl, "runid")];
					if (theRun === undefined) {
						returnJson (theResponse, 200, {killed: false, note: "The run had already finished."});
						}
					else {
						theRun.theWorker.terminate ();
						endRun (theRun, {finished: true, message: "The script was stopped."}); //8/24/26 by CC -- DW ruling 8/20: Stop, not Kill
						returnJson (theResponse, 200, {killed: true});
						}
					}
				break;
			case "/downloadobject": //8/4/26 by CC -- the three calls Electric Drummer makes
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't download the object because the password is missing or wrong.");
					}
				else {
					handleDownloadObject (theResponse, urlParam (theUrl, "address"));
					}
				break;
			case "/uploadobject":
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't upload the object because the password is missing, wrong, or doesn't have the power to write.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleUploadObject (theResponse, urlParam (theUrl, "address"), theBody, urlParam (theUrl, "type"), urlParam (theUrl, "autosave") === "1");
							}, theResponse);
						}
					else {
						returnError (theResponse, 405, "Can't upload the object because it has to be POSTed -- the OPML goes in the body of the request.");
						}
					}
				break;
			case "/dialoganswer": //8/7/26 by CC -- the person answered; wake the script that's waiting
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't deliver the answer because the password is missing, wrong, or doesn't have the power to run scripts.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleDialogAnswer (theResponse, theUrl, theBody);
							}, theResponse);
						}
					else {
						returnError (theResponse, 405, "Can't deliver the answer because it has to be POSTed -- the answer goes in the body of the request.");
						}
					}
				break;
			case "/listtable": //8/7/26 by CC -- the odb browser asks what's in a table
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't list the table because the password is missing or wrong.");
					}
				else {
					handleListTable (theResponse, theUrl);
					}
				break;
			case "/menubaredit": //9/1/26 by CC -- the menubar editor: save the structure, move a command's script in and out
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't edit the menubar because the password is missing, wrong, or doesn't have the power to write.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleMenubarEdit (theResponse, theBody);
							}, theResponse);
						}
					else {
						returnError (theResponse, 405, "Can't edit the menubar because the edit has to be POSTed -- the action goes in the body of the request.");
						}
					}
				break;
			case "/tableedit": //8/27/26 by CC -- the table window edits: new item, rename, set a value, delete, column widths
				if (!requestIsAuthorized (theRequest, theUrl, true)) {
					returnError (theResponse, 401, "Can't edit the table because the password is missing, wrong, or doesn't have the power to write.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleTableEdit (theResponse, theBody);
							}, theResponse);
						}
					else {
						returnError (theResponse, 405, "Can't edit the table because the edit has to be POSTed -- the action goes in the body of the request.");
						}
					}
				break;
			case "/dataversion": //8/27/26 by CC -- the table window's auto-update asks whether anything in the database changed
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't read the data version because the password is missing or wrong.");
					}
				else {
					returnJson (theResponse, 200, {version: selectListerDataVersion.get ().data_version});
					}
				break;
			case "/searchsubtree": //8/14/26 by CC -- the Find command's table walk
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't search because the password is missing or wrong.");
					}
				else {
					handleSearchSubtree (theResponse, urlParam (theUrl, "address"), urlParam (theUrl, "for"), urlParam (theUrl, "after"), urlParam (theUrl, "afterline"), urlParam (theUrl, "aftermenuline"));
					}
				break;
			case "/getmenubar": //8/8/26 by CC -- the app asks for the menu structure, scripts riding along
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't get the menubar because the password is missing or wrong.");
					}
				else {
					handleGetMenubar (theResponse, urlParam (theUrl, "address"));
					}
				break;
			case "/getdatabases": //8/8/26 by CC -- windows follow databases; this is the list
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't list the databases because the password is missing or wrong.");
					}
				else {
					handleGetDatabases (theResponse);
					}
				break;
			default:
				if ((thePath === "/odbbrowser") || (thePath.startsWith ("/odbbrowser/"))) { //8/7/26 by CC -- the browser app itself, no password -- the data calls carry it
					handleOdbBrowserFile (theResponse, theUrl);
					}
				else {
					if ((thePath === "/renders") || (thePath.startsWith ("/renders/"))) { //8/10/26 by CC -- what a build wrote, so there's something to view
						handleRenderFile (theResponse, theUrl);
						}
					else {
						returnError (theResponse, 404, "Can't answer the request because " + theUrl.pathname + " isn't something this server does.");
						}
					}
				break;
			}
		}

//startup
	function startup () {

		if (!fs.existsSync (pathDatabase)) {
			console.log ("Can't start because there's no database at " + pathDatabase + ".");
			process.exit (1);
			}

		theStore = odbSql.openDatabase (pathDatabase);

		const sqlite3 = require ("better-sqlite3"); //8/7/26 by CC -- a second, read-only connection for the odb browser's listings; WAL mode makes concurrent readers safe
		const listerDatabase = new sqlite3 (pathDatabase, {readonly: true});
		selectListerChildren = listerDatabase.prepare ("select id, name, type, value from odb where parentid = ? order by lowername;");
		selectListerRow = listerDatabase.prepare ("select id, name, type, value from odb where id = ?;");
		countListerChildren = listerDatabase.prepare ("select count (*) as ct from odb where parentid = ?;");
		selectSearchChild = listerDatabase.prepare ("select id, type from odb where parentid = ? and lowername = ?;"); //8/14/26 by CC -- for the Find command's table walk
		selectPathNamedTopLevel = listerDatabase.prepare ("select name from odb where parentid = " + theStore.odb.odbId + " and name like '%:%';"); //9/7/26 by CC -- the guests that live at the top under their file paths, for segmentsForEditAddress
		selectListerDataVersion = listerDatabase.prepare ("pragma data_version;"); //8/27/26 by CC -- moves when any OTHER connection commits; the table window's auto-update polls it

		console.log (myProductName + " v" + myVersion + " on port " + config.port + ", usertalk v" + versionUsertalk + ", " + theStore.countRows () + " rows in " + pathDatabase);
		if (config.password.length === 0) {
			console.log ("WARNING: config.json has no password, so every request will be refused.");
			}

		emptyTheTempTable ();

		requireFrontierOdb (); //10/4/26 by CC -- for its version number, below
		langstartup.initEnvironment (theStore, {triggerVersion: myVersion, usertalkVersion: versionUsertalk, odbVersion: String (frontierodb.myVersion)}); //8/27/26 by CC -- system.environment is a system table: rebuilt truthfully every launch, DW's 8/26 ruling (isMac true on a Mac, isCarbon false); 10/4/26 -- the parts' version numbers ride in, DW's ruling that users see one number

		/*  9/4/26 by CC -- THE PORT IS BOUND BEFORE THE TOOLS INSTALL. On the
			first launch of a fresh install the scanner reads nodeEditor.root
			and writes its 173,000 rows into the database, which takes longer
			than the ten seconds the app used to wait for the server before
			giving up -- DW's 9/4 report: first launch, no windows, the
			menubar unchanged; quit and relaunch, everything there. The scan
			is synchronous, so a connection that arrives during it waits in
			the listen backlog and is answered the moment the scan is done;
			nothing is served from a half-installed database.  */

		const theHttpServer = http.createServer (handleHttpRequest);
		sureStreamOwner ().attachHttpServer (theHttpServer); //10/4/26 by CC -- websocket connections come in on this port, at the paths scripts listen at (tcp.websocket.listen)
		theHttpServer.on ("error", function (err) { //9/4/26 by CC -- a port already in use used to be an unhandled event and a stack trace; it's a sentence and a clean exit
			console.log ("Can't start because " + ((err.code === "EADDRINUSE") ? ("port " + config.port + " is already in use.") : err.message));
			process.exit (1);
			});
		theHttpServer.listen (config.port);
		theWhenStartupBegan = Date.now (); //9/17/26 by CC -- the phases are timed in the log, for the slow-launch question

		scanTheToolsFolder ();
		console.log (nowText () + " startup: the Tools scan took " + (Date.now () - theWhenStartupBegan) + "ms"); //9/17/26 by CC -- the slow-launch question
		narrateStartup ("Running the startup scripts.");

		runTheStartupScripts (); //8/29/26 by CC -- loadsystemscripts' order: the startup table first...

		narrateStartup ("Starting the agents.");
		scanTheAgentsTable (); //...then scriptloadagents: every script in system.agents starts as an agent
		setInterval (scanTheAgentsTable, 3000); //and the lifecycle: added scripts start, edited ones start over, gone ones stop
		}

	/*  8/29/26 by CC -- AGENTS, DW's go-ahead. The kernel's model, read from
		scripts.c and process.c: every script in system.agents runs as its own
		long-lived process, woken about once a second; editing the script
		replaces its process, deleting it stops the agent, and a run that
		fails deletes the process -- the agent stops until the script is
		edited. Here each agent is a worker thread (runnerWorker.js with
		flAgent) looping on the kernel's one-second beat; this scanner is
		scriptloadagents plus the lifecycle: it watches system.agents and
		starts, replaces and stops workers to match. No system.agents table
		means no agents and nothing to do.  */

	var theRunningAgents = {}; //by row id: {theWorker, theName, whenModified, sharedControl, sharedData}

	/*  9/3/26 by CC -- AN EDITED AGENT WAITS FOR COMPILE. DW's 9/3 ruling: "it
		is not correct behavior for the script to be run automatically. it must
		wait until i click the Compile button... there could be lots of things
		wrong with a script as i'm typing it in." The kernel agrees:
		scriptcompiler (scripts.c) is where processreplacecode happens, and
		that runs when the script is COMPILED, not on every keystroke. So the
		script window's autosave says it's an autosave, the version it wrote
		is remembered here by name, and the scanner leaves the running agent
		alone while the saved script matches that version. Compile clears
		the entry and the agent starts over on the next scan. A change from
		any other path -- an import, a script assigning into system.agents --
		still starts the agent over at once, the way scriptinstallagent does.  */

	const theAgentAutosaves = {}; //lowercased script name -> the whenModified its window's autosave wrote
	var theFailedAgents = {}; //by row id: the whenModified that failed -- deleteprocess's rule: a failed agent stays stopped until the script is EDITED

	function stopAgent (theId, theReason) {
		const theAgent = theRunningAgents [theId];
		if (theAgent === undefined) {
			return;
			}
		theAgent.theWorker.terminate ();
		delete theRunningAgents [theId];
		console.log (nowText () + " agents: " + theAgent.theName + " stopped -- " + theReason);
		}

	function startAgent (theRow, whenModified) {
		var theLines;
		try {
			theLines = JSON.parse (theRow.value);
			}
		catch (err) {
			console.log (nowText () + " agents: can't start " + theRow.name + " because its lines couldn't be read.");
			return;
			}
		const sharedControl = new SharedArrayBuffer (8);
		const sharedData = new SharedArrayBuffer (65536);
		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
			workerData: {
				sessionId: theSessionId, //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
				flAgent: true,
				agentName: theRow.name, //9/16/26 by CC -- its msg is filed under this name on the About window
				agentAddress: "system.agents." + theRow.name, //9/26/26 by CC -- the script's own address, so this answers it (DW's blueskyDriver: "Can't use this because the running script has no address in the database.")
				agentLines: theLines,
				scriptText: "",
				folderUsertalk,
				pathDatabase,
				pathMap: thePathMap,
				folderRenders,
				sharedControl,
				sharedData,
				hiddenTargetCursors: {}
				}
			});
		const theAgent = {theWorker, theName: theRow.name, whenModified, sharedControl, sharedData};
		theRunningAgents [theRow.id] = theAgent;
		theWorker.on ("message", function (theMessage) {
			switch (theMessage.type) {
				case "httprequest": //agents read urls the way any run does; the server answers
				case "tcp":
				case "thread": //9/15/26 by CC -- an agent starts threads too (the scheduler's monitor does)
				case "setting": //9/16/26 by CC
					answerWorkerAsk (theAgent, theMessage);
					break;
				case "msg": //9/16/26 by CC -- an agent's msg is a background message, filed under its name
					aboutMsg (theMessage.text, true, theAgent.theName);
					break;
				case "agentfailed": //the kernel's deleteprocess: a failed agent stops, and the log says why
					console.log (nowText () + " agents: " + theAgent.theName + " stopped after " + theMessage.ctBeats + ((theMessage.ctBeats === 1) ? " beat" : " beats") + " -- " + theMessage.message);
					theFailedAgents [theRow.id] = theAgent.whenModified; //stopped until the script is edited
					stopAgent (theRow.id, "the run failed");
					if (theStore !== undefined) {
						theStore.checkForOutsideChanges (); //whatever the beats wrote is real
						}
					break;
				}
			});
		theWorker.on ("error", function (err) {

			/*  9/2/26 by CC -- a worker that throws with no error listener
				re-throws in the MAIN thread, and that killed the server on
				9/2: one half-typed agent line took every window down and
				kept the app from launching until the script was fixed by
				hand. Whatever escapes the worker is the agent's failure, not
				the server's -- the kernel's deleteprocess: log it, stop the
				agent, and leave it stopped until the script is edited.  */

			console.log (nowText () + " agents: " + theAgent.theName + " stopped -- " + err.message);
			theFailedAgents [theRow.id] = theAgent.whenModified;
			stopAgent (theRow.id, "the worker failed");
			});
		console.log (nowText () + " agents: " + theRow.name + " started");
		}

	/*  8/29/26 by CC -- THE STARTUP TABLE, DW's ruling with the virgin
		opml.root as the guide: "if system.startup is there, you have to have
		it." The kernel runs EVERY script in system.startup as a one-shot
		process at boot, then loads the agents (loadsystemscripts in
		scripts.c). Same order here: each startup script runs once on its own
		worker; a failure is logged the way systemscripterrorroutine shows it
		and the boot goes on; the agents scan starts right after, without
		waiting -- the kernel doesn't wait either.  */

	var ctStartupScriptsRunning = 0; //9/10/26 by CC -- see theStartupStatus

	var theWhenStartupBegan; //9/17/26 by CC -- set when the port is bound
	function noteStartupScriptDone () {
		ctStartupScriptsRunning--;
		if (ctStartupScriptsRunning <= 0) {
			ctStartupScriptsRunning = 0;
			theStartupStatus = "";
			const ctSeconds = (theWhenStartupBegan === undefined) ? undefined : Math.round ((Date.now () - theWhenStartupBegan) / 100) / 10;
			narrateStartup ("Frontier is ready" + ((ctSeconds === undefined) ? "." : ", " + ctSeconds + " seconds after the server started."), true); //held until a click in the About window
			}
		}

	function runTheStartupScripts () {
		try {
			const systemRow = selectSearchChild.get (theStore.odb.odbId, "system");
			var startupRow;
			if ((systemRow !== undefined) && (systemRow.type === "table")) {
				startupRow = selectSearchChild.get (systemRow.id, "startup");
				}
			if ((startupRow === undefined) || (startupRow.type !== "table")) {
				return; //no startup table, nothing to run -- findnamedtable's answer
				}
			selectListerChildren.all (startupRow.id).forEach (function (theRow) {
				if (theRow.type !== "script") {
					return;
					}
				var theLines;
				try {
					theLines = JSON.parse (theRow.value);
					}
				catch (err) {
					console.log (nowText () + " startup: can't run " + theRow.name + " because its lines couldn't be read.");
					return;
					}
				const sharedControl = new SharedArrayBuffer (8);
				const sharedData = new SharedArrayBuffer (65536);
				const thePathMap = {helpers: {}, prefs: {}, prefixes: {}, flCorralPaths: true, flAllowDiskWrites: true, flAllowNetwork: false, pathDatabase};
				if (config.pathMap !== undefined) {
					Object.keys (thePathMap).forEach (function (name) {
						if (config.pathMap [name] !== undefined) {
							thePathMap [name] = config.pathMap [name];
							}
						});
					}
				const theWorker = new Worker (pathTool.join (__dirname, "runnerWorker.js"), {
					workerData: {
						sessionId: theSessionId, //9/10/26 by CC -- the linked code rule, see evaluate.js callOdbScript
						flAgent: true,
						flOneShot: true,
						agentLines: theLines,
						scriptText: "",
						folderUsertalk,
						pathDatabase,
						pathMap: thePathMap,
						folderRenders,
						sharedControl,
						sharedData,
						hiddenTargetCursors: {}
						}
					});
				const theShot = {theName: theRow.name, sharedControl, sharedData};
				theWorker.on ("message", function (theMessage) {
					switch (theMessage.type) {
						case "httprequest":
						case "tcp":
						case "thread": //9/15/26 by CC -- a startup script may start threads
						case "setting": //9/16/26 by CC
							answerWorkerAsk (theShot, theMessage);
							break;
						case "msg": //9/16/26 by CC -- a startup script's msg is a foreground message
							aboutMsg (theMessage.text, false);
							break;
						case "agentdone":
							console.log (nowText () + " startup: " + theRow.name + " finished");
							if ((process.env.ODB_STARTUP_TRACE !== undefined) && Array.isArray (theMessage.traceTail)) { //9/4/26 by CC -- the last verbs before the script ended, for a boot that ends early without an error
								theMessage.traceTail.forEach (function (theEntry) {
									console.log (nowText () + " startup:    " + theEntry.verb + " (" + (Array.isArray (theEntry.args) ? theEntry.args.join (", ") : "") + ") -- " + theEntry.kind);
									});
								}
							if (theStore !== undefined) {
								theStore.checkForOutsideChanges ();
								}
							buildTheToolsMenu (); //9/3/26 by CC -- Frontier.tools.startup, run by the startupScript, resets Frontier.tools.menu to the virgin menu before it looks for Tools; the submenus go back on when it's done
							noteStartupScriptDone (); //9/10/26 by CC
							break;
						case "agentfailed":
							console.log (nowText () + " startup: " + theRow.name + " stopped -- " + theMessage.message);
							if (Array.isArray (theMessage.stack)) {
								theMessage.stack.slice (-6).forEach (function (theEntry) {
									console.log (nowText () + " startup:    " + theEntry.verb + " (" + (Array.isArray (theEntry.args) ? theEntry.args.join (", ") : "") + ") -- " + theEntry.kind);
									});
								}
							if (theStore !== undefined) {
								theStore.checkForOutsideChanges ();
								}
							buildTheToolsMenu ();
							noteStartupScriptDone (); //9/10/26 by CC
							break;
						}
					});
				theWorker.on ("error", function (err) { //9/2/26 by CC -- same as the agents: a startup script's failure is logged the way systemscripterrorroutine shows it, and the boot goes on
					console.log (nowText () + " startup: " + theRow.name + " stopped -- " + err.message);
					noteStartupScriptDone (); //9/10/26 by CC
					});
				console.log (nowText () + " startup: running " + theRow.name);
				ctStartupScriptsRunning++; //9/10/26 by CC -- the app waits for the last one; no status text for it: DW, 9/10 evening, "those scripts take no time to run so the flash is distracting for no reason"
				});
			}
		catch (err) {
			console.log (nowText () + " startup: the table couldn't be run -- " + err.message);
			}
		}

	function scanTheAgentsTable () {
		try {
			try { //8/29/26 by CC -- Frontier.enableAgents' switch, read from where the verb writes it
				const theTemp = theStore.odb.system.temp;
				if ((theTemp !== undefined) && (theTemp.Frontier !== undefined) && (theTemp.Frontier.agentsEnabled === false)) {
					Object.keys (theRunningAgents).forEach (function (theId) {
						stopAgent (theId, "agents are disabled -- Frontier.enableAgents (false)");
						});
					return;
					}
				}
			catch (err) {
				}
			const systemRow = selectSearchChild.get (theStore.odb.odbId, "system");
			var agentsRow;
			if ((systemRow !== undefined) && (systemRow.type === "table")) {
				agentsRow = selectSearchChild.get (systemRow.id, "agents");
				}
			const theWanted = {}; //row id -> {theRow, whenModified}
			if ((agentsRow !== undefined) && (agentsRow.type === "table")) {
				selectListerChildren.all (agentsRow.id).forEach (function (theRow) {
					if (theRow.type === "script") {
						const theDates = theStore.datesForPath (["system", "agents", theRow.name]);
						theWanted [theRow.id] = {theRow, whenModified: (theDates === undefined) ? "" : String (theDates.whenModified)};
						}
					});
				}
			Object.keys (theRunningAgents).forEach (function (theId) {
				const theEntry = theWanted [theId];
				if (theEntry === undefined) {
					stopAgent (theId, "the script left system.agents");
					return;
					}
				if (theAgentAutosaves [theEntry.theRow.name.toLowerCase ()] === theEntry.whenModified) { //9/3/26 by CC -- the script window's autosave wrote this version; the running agent keeps its code until Compile (DW's 9/3 ruling, scriptcompiler's rule)
					return;
					}
				if (theEntry.whenModified !== theRunningAgents [theId].whenModified) { //the kernel's processreplacecode: an edited agent starts over
					stopAgent (theId, "the script changed");
					}
				});
			Object.keys (theWanted).forEach (function (theId) {
				if (theRunningAgents [theId] === undefined) {
					if (theFailedAgents [theId] === theWanted [theId].whenModified) {
						return; //it failed with this exact script; editing the script is what brings it back
						}
					delete theFailedAgents [theId];
					startAgent (theWanted [theId].theRow, theWanted [theId].whenModified);
					}
				});
			}
		catch (err) {
			console.log (nowText () + " agents: the scan failed -- " + err.message);
			}
		}

	/*  8/26/26 by CC -- THE GUEST DATABASES FOLDERS, the base layer of DW's
		8/26 direction: every root's home is SQL, and a .root file in Tools
		gets INSTALLED -- read once into the database, its top-level names
		recorded in system.compiler.files the way the build-time guests are,
		so it shows up in the Window menu like any other database. Presence
		is the gesture: a file in Tools is installed at startup, a file that's
		gone is uninstalled. (Until 9/18/26 a file that got newer was
		reinstalled; that replaced DW's edits in the database with the older
		file on his move to Vermont, and it is out -- see the scanner.) No
		save-writes-back in this layer -- his method: "first get a base
		layer working, live with it for a while and then see where it goes
		next." Export is the writer (frontierodb.writeRootFile), on demand.

		The scanner only touches records it made -- the ones carrying a
		path. The build-time guests (manila.root, nodeEditor.root...) have
		no path and are never scanned. A root whose top-level names collide
		with names already in the database is refused by name, whole.  */

	function scanTheToolsFolder () {
		try {
			const folderGuests = pathTool.join (pathTool.dirname (pathTool.resolve (pathDatabase)), "Guest Databases");
			["apps", "Tools", "Inactive Tools", "ops", "www"].forEach (function (theName) {
				const theFolder = pathTool.join (folderGuests, theName);
				if (!fs.existsSync (theFolder)) {
					fs.mkdirSync (theFolder, {recursive: true});
					}
				});
			if (!fs.existsSync (pathTool.join (folderGuests, "apps", "Tools"))) { //9/18/26 by CC -- the loop above makes apps but not apps/Tools, and an install laid out before 9/15 doesn't have it: the read below threw, and the whole scan ended in "Can't scan the Tools folder because ENOENT" -- no move, no installs. Found reproducing DW's move on a copy of his 9/14 root; testTools checkTheOldLayout
				fs.mkdirSync (pathTool.join (folderGuests, "apps", "Tools"), {recursive: true});
				}
			const folderTools = pathTool.join (folderGuests, "apps", "Tools"); //9/15/26 by CC -- Frontier's Tools folder is Guest Databases/apps/Tools (the 2012 distribution's layout, and what Frontier.tools.getToolsFolderPath answers); it was Guest Databases/Tools here, so Frontier.tools.startup's own loop over the folder found nothing and no Tool was ever hooked up

			requireFrontierOdb ();

			if (theStore.odb.system.compiler === undefined) {
				theStore.odb.system.compiler = {};
				}
			if (theStore.odb.system.compiler.files === undefined) {
				theStore.odb.system.compiler.files = {};
				}
			const filesTable = theStore.odb.system.compiler.files;

			const theFiles = {}; //root file name -> the folder it is in
			fs.readdirSync (folderTools).forEach (function (theName) {
				if (theName.toLowerCase ().endsWith (".root")) {
					theFiles [theName] = folderTools;
					}
				});

			/*  9/15/26 by CC -- the Tools folder moved to Frontier's place,
				Guest Databases/apps/Tools, tonight. An install made before
				tonight has its Tools in Guest Databases/Tools, and a root left
				there is worse than unhooked: Frontier.tools.startup uninstalls
				a Tool whose file isn't in the Tools folder, and that closes the
				guest and takes its tables out of the database -- with DW's own
				edits to those suites, which live in the database and nowhere
				else. So a root found in the old folder is moved into apps/Tools
				before anything looks, the file otherwise untouched, and the log
				says so. Nothing is moved that already has a namesake in
				apps/Tools.  */

			const folderOldTools = pathTool.join (folderGuests, "Tools");
			if (fs.existsSync (folderOldTools)) {
				fs.readdirSync (folderOldTools).forEach (function (theName) {
					if (theName.toLowerCase ().endsWith (".root") && (theFiles [theName] === undefined)) {
						try {
							fs.renameSync (pathTool.join (folderOldTools, theName), pathTool.join (folderTools, theName));
							theFiles [theName] = folderTools;
							console.log (theName + " moved from Guest Databases/Tools to Guest Databases/apps/Tools, Frontier's Tools folder.");
							}
						catch (err) {
							console.log ("Can't move " + theName + " from Guest Databases/Tools to Guest Databases/apps/Tools because " + err.message);
							}
						}
					});
				}

			function namesOwnedBy (theRecord) {
				const theNames = [];
				if ((theRecord !== undefined) && (theRecord !== null) && (Array.isArray (theRecord.names))) {
					theRecord.names.forEach (function (theName) {
						theNames.push (String (theName));
						});
					}
				return (theNames);
				}

			function uninstall (theRootName) {
				const theRecord = filesTable [theRootName];
				namesOwnedBy (theRecord).forEach (function (theName) {
					delete theStore.odb [theName];
					});
				delete filesTable [theRootName];
				recordTheTool (theRootName, undefined, false); //Frontier.tools.uninstall: flInstalled = false, the record stays
				console.log ("uninstalled " + theRootName + " -- the file left the Tools folder");
				}

			//uninstall the ones whose file is gone -- only records this scanner made, the ones with a path
			Reflect.ownKeys (filesTable).forEach (function (theRootName) {
				if (typeof theRootName !== "string") {
					return;
					}
				const theRecord = filesTable [theRootName];
				if ((theRecord === undefined) || (theRecord === null) || (typeof theRecord !== "object") || (theRecord.path === undefined)) {
					return;
					}
				if (theFiles [theRootName] === undefined) {
					uninstall (theRootName);
					}
				});

			//install the new ones; an installed one is left alone, the database wins (9/18/26)
			Object.keys (theFiles).forEach (function (theRootName) {
				try {
					const thePath = pathTool.join (theFiles [theRootName], theRootName);
					const theModified = fs.statSync (thePath).mtimeMs;
					const theRecord = filesTable [theRootName];
					const flKnown = ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && (theRecord.path !== undefined));
					if (flKnown) {

						/*  9/18/26 by CC -- AN INSTALLED TOOL IS NEVER REINSTALLED AT
							LAUNCH; THE DATABASE WINS. Until today a file whose date
							wasn't exactly the one recorded at install was read in
							again, and a reinstall replaces the suite's tables. DW
							copied his Electric Frontier folder from Berkeley to
							Vermont on 9/17; the copy moved the dates, the first launch
							there reinstalled nodeEditor.root, and his nodeEditorSuite
							-- edited in the database for weeks, never written back to
							the file -- was replaced by the older one in the file: an
							old save script, utilities.buildHelloFrontier gone. His
							word 9/18: "go". A new file in the folder still installs
							and a file that's gone still uninstalls; a file whose date
							differs is left alone, and the log says so.  */

						if (theRecord.fileModified !== theModified) {
							console.log (theRootName + "'s file date differs from the one recorded at install -- the database's copy was kept, nothing was read from the file.");
							}
						return;
						}
					narrateStartup ((flKnown ? "Reinstalling " : "Installing ") + theRootName + ", this could take a minute or more."); //9/10/26 by CC -- the app shows it with a spinner; DW's 9/10 report, nodeEditor.root came in with nothing telling him what was happening. 9/17 -- and the About window says it
					const theRoot = frontierodb.readRootFile (thePath);
					const ownedAlready = flKnown ? namesOwnedBy (theRecord) : [];
					const theNames = [];
					var theCollision;
					Object.keys (theRoot).forEach (function (theName) {
						if (theName.charAt (0) === "#") { //9/4/26 by CC -- #installer, #startup, #webeditserver are the file's own bookkeeping, one per guest database; two Tools roots both carry #installer and the second was refused by name. They stay in the file; the guest's real names are what a Tool brings in
							return;
							}
						theNames.push (theName);
						if ((theCollision === undefined) && (ownedAlready.indexOf (theName) === -1) && (theStore.odb [theName] !== undefined)) {
							theCollision = theName;
							}
						});
					if (theCollision !== undefined) {
						console.log ("Can't install " + theRootName + " because the name " + theCollision + " is already in the database.");
						return;
						}
					ownedAlready.forEach (function (theName) { //a reinstall replaces what the old file brought
						delete theStore.odb [theName];
						});
					theNames.forEach (function (theName) {
						theStore.odb [theName] = odbHome.convertValue (theRoot [theName]);
						});
					filesTable [theRootName] = {adr: "", names: theNames, path: thePath, fileModified: theModified, whenInstalled: new Date ()};
					recordTheTool (theRootName, thePath, true);
					console.log ((flKnown ? "reinstalled " : "installed ") + theRootName + " -- " + theNames.length + ((theNames.length === 1) ? " name" : " names"));
					theStartupStatus = "";
					}
				catch (err) {
					console.log ("Can't install " + theRootName + " because " + err.message);
					}
				});
			buildTheToolsMenu ();
			}
		catch (err) {
			console.log ("Can't scan the Tools folder because " + err.message);
			}
		}

	/*  9/3/26 by CC -- THE TOOLS MENU, and the record of each installed Tool,
		the way Frontier.tools.startup and Frontier.tools.install do it in
		the distribution (both read tonight):

			1. Frontier.tools.menu starts over from Frontier.tools.data.
			   virginToolsMenu at every launch (Frontier.tools.startup).
			2. Each Tool's suite.menu goes in as a SUBMENU of the Tools menu,
			   in alphabetical order, ahead of the separator, an existing
			   entry of the same name replaced (Frontier.tools.installSubMenu
			   plus addmenucommandverb in menuverbs.c, flsubmenu true).
			3. user.menus.tools = @Frontier.tools.menu (Frontier.tools.init),
			   which is how the menu reaches the menubar.
			4. user.tools.databases.[name] remembers the Tool (path,
			   lastModified, flInstalled, flEnabled), Frontier.tools.install's
			   "save the fact that it's an installed tool"; uninstall sets
			   flInstalled false and leaves the record.

		The UserTalk of all four is in the database and is the spec; it runs
		on fileMenu.open and the op verbs on a hidden target, neither of
		which the startup worker can give it while the Tools folder is
		installed by the scanner above (the 8/26 base layer, DW's method:
		"first get a base layer working, live with it"). So the scanner does
		the same four things here. The tool name is cleanToolName's: the
		.root suffix dropped, spaces inner-cased away, non-alphas dropped.

		DW's 9/3 report that started this: "i don't see the Tools menu in
		the menubar."  */

	function cleanToolName (theFileName) { //Frontier.tools.cleanToolName
		var theName = String (theFileName);
		if (theName.toLowerCase ().endsWith (".root")) {
			theName = theName.slice (0, theName.length - 5);
			}
		if (theName.indexOf (" ") !== -1) { //string.innerCaseName: "Node Editor" -> "nodeEditor"
			var theResult = "";
			theName.split (" ").forEach (function (theWord, ix) {
				if (theWord.length === 0) {
					return;
					}
				theResult += (ix === 0) ? (theWord.charAt (0).toLowerCase () + theWord.slice (1)) : (theWord.charAt (0).toUpperCase () + theWord.slice (1));
				});
			theName = theResult;
			}
		return (theName.replace (/[^A-Za-z0-9]/g, "")); //string.dropNonAlphas keeps letters and digits
		}

	function recordTheTool (theRootName, thePath, flInstalled) { //user.tools.databases.[name], Frontier.tools.install's record
		try {
			const theUser = theStore.odb.user;
			if (theUser === undefined) {
				return;
				}
			if (theUser.tools === undefined) {
				theUser.tools = {};
				}
			if (theUser.tools.databases === undefined) {
				theUser.tools.databases = {};
				}
			const theName = cleanToolName (theRootName);
			var theRecord = theUser.tools.databases [theName];
			if ((theRecord === undefined) || (theRecord === null) || (typeof theRecord !== "object")) {
				if (!flInstalled) {
					return; //never installed, nothing to mark
					}
				theUser.tools.databases [theName] = {};
				theRecord = theUser.tools.databases [theName];
				}
			if (thePath !== undefined) {
				theRecord.path = thePath;
				}
			theRecord.lastModified = new Date ();
			theRecord.flInstalled = flInstalled;
			if (theRecord.flEnabled === undefined) {
				theRecord.flEnabled = true;
				}
			}
		catch (err) {
			console.log ("Can't record the tool " + theRootName + " because " + err.message);
			}
		}

	function buildTheToolsMenu () {
		try {
			const theBuiltins = theStore.odb.system.verbs.builtins;
			const theTools = (theBuiltins === undefined) ? undefined : theBuiltins.Frontier;
			const toolsTable = ((theTools === undefined) || (theTools === null)) ? undefined : theTools.tools;
			if ((toolsTable === undefined) || (toolsTable === null) || (toolsTable.data === undefined) || (toolsTable.data === null)) {
				return; //a database without Frontier.tools has no Tools menu to build -- the distribution always has it
				}
			const theVirgin = toolsTable.data.virginToolsMenu;
			if ((theVirgin === undefined) || (theVirgin === null) || (theVirgin.flOdbMenubar !== true) || !Array.isArray (theVirgin.lines)) {
				return;
				}
			const theLines = JSON.parse (JSON.stringify (theVirgin.lines)); //1. start over from the virgin menu

			function insertSubMenu (subLines) { //2. addmenucommandverb's deposit, at installSubMenu's alphabetical spot
				if (!Array.isArray (subLines) || (subLines.length === 0)) {
					return;
					}
				const menuName = String (subLines [0].text);
				function subtreeEnd (ix) { //the index after the line's subtree
					const theLevel = theLines [ix].level;
					var end = ix + 1;
					while ((end < theLines.length) && (theLines [end].level > theLevel)) {
						end++;
						}
					return (end);
					}
				var ix = 1, ixInsert;
				while (ix < theLines.length) { //the level-1 items, up to the separator
					const theLine = theLines [ix];
					if (theLine.level !== 1) {
						ix++;
						continue;
						}
					if (String (theLine.text) === "-") {
						break;
						}
					if (String (theLine.text).toLowerCase () === menuName.toLowerCase ()) { //an entry of the same name is replaced
						const end = subtreeEnd (ix);
						theLines.splice (ix, end - ix);
						continue;
						}
					if ((ixInsert === undefined) && (String (theLine.text).toLowerCase () > menuName.toLowerCase ())) {
						ixInsert = ix;
						}
					ix = subtreeEnd (ix);
					}
				if (ixInsert === undefined) {
					ixInsert = ix; //at the separator, or the end
					}
				const theDeposit = [];
				subLines.forEach (function (theLine) {
					const lineCopy = JSON.parse (JSON.stringify (theLine));
					lineCopy.level = (Number (lineCopy.level) || 0) + 1;
					theDeposit.push (lineCopy);
					});
				theDeposit [0].flExpanded = false; //opfastcollapse
				theLines.splice.apply (theLines, [ixInsert, 0].concat (theDeposit));
				}

			const filesTable = theStore.odb.system.compiler.files;
			const theRootNames = [];
			Reflect.ownKeys (filesTable).forEach (function (theRootName) {
				if (typeof theRootName !== "string") {
					return;
					}
				const theRecord = filesTable [theRootName];
				if ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && (theRecord.path !== undefined)) {
					theRootNames.push (theRootName);
					}
				});
			theRootNames.sort (function (a, b) {
				return (a.toLowerCase () < b.toLowerCase () ? -1 : 1);
				});
			theRootNames.forEach (function (theRootName) {
				const theSuite = theStore.odb [cleanToolName (theRootName) + "Suite"];
				if ((theSuite === undefined) || (theSuite === null) || (typeof theSuite !== "object")) {
					return;
					}
				const theMenu = theSuite.menu;
				if ((theMenu !== undefined) && (theMenu !== null) && (theMenu.flOdbMenubar === true) && Array.isArray (theMenu.lines)) {
					insertSubMenu (theMenu.lines);
					}
				});

			toolsTable.menu = {flOdbMenubar: true, lines: theLines};

			const theUser = theStore.odb.user; //3. user.menus.tools = @Frontier.tools.menu
			if ((theUser !== undefined) && (theUser !== null)) {
				if (theUser.menus === undefined) {
					theUser.menus = {};
					}
				if (theUser.menus.tools === undefined) {
					theUser.menus.tools = {flOdbAddressText: true, path: "system.verbs.builtins.Frontier.tools.menu"};
					}
				}
			}
		catch (err) {
			console.log ("Can't build the Tools menu because " + err.message);
			}
		}

	/*  8/21/26 by CC -- system.temp IS EMPTY AT STARTUP. DW, 8/21: "system.temp
		has things in it and should be empty -- the idea of temp is that
		everything is lost when frontier quits." Frontier's temp table doesn't
		survive a launch, and ours was accumulating because the database is one
		SQL file that just reopens. Emptied on the way up rather than on the way
		down, so a crash leaves nothing behind either.  */

	function emptyTheTempTable () {
		try {
			const sqlite3 = require ("better-sqlite3");
			const theDatabase = new sqlite3 (pathDatabase);
			const theRow = theDatabase.prepare ("select id from odb where lowername = 'temp' and parentid = (select id from odb where lowername = 'system' and parentid = 0);").get ();
			if (theRow === undefined) {
				theDatabase.close ();
				return;
				}
			const selectChildren = theDatabase.prepare ("select id from odb where parentid = ?;");
			const deleteById = theDatabase.prepare ("delete from odb where id = ?;");
			var ctDeleted = 0;
			function removeSubtree (theId) {
				selectChildren.all (theId).forEach (function (theChild) {
					removeSubtree (theChild.id);
					});
				deleteById.run (theId);
				ctDeleted++;
				}
			const theEmptying = theDatabase.transaction (function () {
				selectChildren.all (theRow.id).forEach (function (theChild) {
					removeSubtree (theChild.id);
					});
				});
			theEmptying ();
			theDatabase.close ();
			if (ctDeleted > 0) {
				console.log ("system.temp emptied, " + ctDeleted + ((ctDeleted === 1) ? " object." : " objects."));
				}
			}
		catch (err) {
			console.log ("Can't empty system.temp because " + err.message);
			}
		}

startup ();
