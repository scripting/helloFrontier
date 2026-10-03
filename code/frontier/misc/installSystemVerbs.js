/*  Install DW's system.verbs export into an odb.
	
	His export is the truth for system.verbs. Anything under system.verbs
	in the database that his export doesn't carry is copied back afterward,
	row for row, so nothing he wrote is lost -- on 8/20 that was his
	console, menus and s3 tables.
	
	Rows are copied, never decoded and re-encoded, so a value that the
	reader doesn't understand survives untouched.
	
	node misc/installSystemVerbs.js path/to/frontier.db
	
	A new release seeds a NEW database with system.verbs already in it. A
	database that already exists -- the one with his work in it -- is not
	touched by installing a release, so this is how that one gets the
	table. Take a copy of the database first.
	
	by CC, 8/20/26 */

/*  8/21/26 by CC -- the pieces are looked for beside this script first, which
	is where they are inside a release, and in the source tree second, which is
	where they are on the machine this was written on.  */

function requireOne (theNames) {
	var theModule;
	theNames.forEach (function (theName) {
		if (theModule === undefined) {
			try {
				theModule = require (theName);
				}
			catch (err) {
				}
			}
		});
	if (theModule === undefined) {
		const message = "Can't run because none of these could be loaded: " + theNames.join (", ") + ".";
		throw new Error (message);
		}
	return (theModule);
	}

const pathTool = require ("path");
const folderHere = __dirname;

const frontierOdb = requireOne ([pathTool.join (folderHere, "frontierodb.js"), "/Users/davewiner/Claude/frontierOdb/frontierodb.js"]);
const odbHome = requireOne ([pathTool.join (folderHere, "usertalk/code/odbHome.js"), "/Users/davewiner/Claude/usertalk/code/odbHome.js"]);
const odbSql = requireOne ([pathTool.join (folderHere, "usertalk/code/odbSql.js"), "/Users/davewiner/Claude/usertalk/code/odbSql.js"]);
const sqlite3 = requireOne ([pathTool.join (folderHere, "node_modules/better-sqlite3"), "/Users/davewiner/Claude/trigger/node_modules/better-sqlite3"]);

const pathDatabase = process.argv [2];
const pathExport = pathTool.join (folderHere, "system.verbs.fttb"); //his export, beside this script

if (pathDatabase === undefined) {
	console.log ("Can't install because no database was named.");
	process.exit (1);
	}

const thePage = frontierOdb.readFatPage (pathExport);
const theExport = odbHome.convertValue (thePage.value);

/*  find what his export doesn't carry, and remember where it lives  */

function openIt (flReadonly) {
	const theDatabase = new sqlite3 (pathDatabase, {readonly: flReadonly});
	if (!flReadonly) { //a readonly connection can't change the journal mode
		theDatabase.pragma ("journal_mode = WAL");
		}
	return (theDatabase);
	}

var theDatabase = openIt (true);
var selectChild = theDatabase.prepare ("select id, name, type from odb where parentid = ? and lowername = ?;");
var selectChildren = theDatabase.prepare ("select id, name, lowername, type, value from odb where parentid = ?;");

function idForPath (theDb, thePath) {
	const theSelect = theDb.prepare ("select id from odb where parentid = ? and lowername = ?;");
	var theId = 0;
	var flFound = true;
	thePath.split (".").forEach (function (theName) {
		if (flFound) {
			const theRow = theSelect.get (theId, theName.toLowerCase ());
			if (theRow === undefined) {
				flFound = false;
				}
			else {
				theId = theRow.id;
				}
			}
		});
	return (flFound ? theId : undefined);
	}

const theOrphans = []; //{parentPath, row, subtree}

function readRows (theId) {
	const theRows = [];
	selectChildren.all (theId).forEach (function (theRow) {
		theRows.push ({row: theRow, subs: (theRow.type === "table") ? readRows (theRow.id) : []});
		});
	return (theRows);
	}

function findOrphans (theId, theExportTable, thePath) {
	selectChildren.all (theId).forEach (function (theRow) {
		var theName;
		Object.keys (theExportTable).forEach (function (aName) {
			if (aName.toLowerCase () === theRow.lowername) {
				theName = aName;
				}
			});
		if (theName === undefined) {
			theOrphans.push ({parentPath: thePath, row: theRow, subs: (theRow.type === "table") ? readRows (theRow.id) : []});
			}
		else {
			if ((theRow.type === "table") && (typeof theExportTable [theName] === "object")) {
				findOrphans (theRow.id, theExportTable [theName], thePath + "." + theRow.name);
				}
			}
		});
	}

const idVerbs = idForPath (theDatabase, "system.verbs");
if (idVerbs !== undefined) {
	findOrphans (idVerbs, theExport, "system.verbs");
	}
theDatabase.close ();

console.log ("in the database, not in his export -- " + theOrphans.length + " to carry over:");
theOrphans.forEach (function (theOrphan) {
	console.log ("\t" + theOrphan.parentPath + "." + theOrphan.row.name + " (" + theOrphan.row.type + ")");
	});

/*  install his export, replacing system.verbs  */

const ctRows = odbSql.installTree (pathDatabase, "system.verbs", theExport, function (theMessage) {
	console.log (theMessage);
	});
console.log (ctRows + " rows written at system.verbs");

/*  put the orphans back, row for row  */

theDatabase = openIt (false);
const insert = theDatabase.prepare ("insert into odb (parentid, name, lowername, type, value) values (?, ?, ?, ?, ?);");

function writeRows (theRows, parentId) {
	theRows.forEach (function (theItem) {
		const theId = insert.run (parentId, theItem.row.name, theItem.row.lowername, theItem.row.type, theItem.row.value).lastInsertRowid;
		writeRows (theItem.subs, theId);
		});
	}

var ctCarried = 0;
const carryThem = theDatabase.transaction (function () {
	theOrphans.forEach (function (theOrphan) {
		const parentId = idForPath (theDatabase, theOrphan.parentPath);
		if (parentId === undefined) {
			console.log ("Can't carry over " + theOrphan.parentPath + "." + theOrphan.row.name + " because " + theOrphan.parentPath + " isn't in the database.");
			}
		else {
			const theId = insert.run (parentId, theOrphan.row.name, theOrphan.row.lowername, theOrphan.row.type, theOrphan.row.value).lastInsertRowid;
			writeRows (theOrphan.subs, theId);
			ctCarried++;
			}
		});
	});
carryThem ();
theDatabase.close ();

console.log (ctCarried + " carried back");

/*  8/21/26 by CC -- and run his webBrowser.init, which is what creates
	user.webBrowser.proxy.domain and the four beside it. tcp.httpClient reads
	them in its parameter defaults, so without them the verb dies before its
	first line. His script decides what goes there, not this one.  */

const parse = requireOne ([pathTool.join (folderHere, "usertalk/code/parse.js"), "/Users/davewiner/Claude/usertalk/code/parse.js"]);
const evaluate = requireOne ([pathTool.join (folderHere, "usertalk/code/evaluate.js"), "/Users/davewiner/Claude/usertalk/code/evaluate.js"]);
const verbsMaker = requireOne ([pathTool.join (folderHere, "usertalk/code/verbs.js"), "/Users/davewiner/Claude/usertalk/code/verbs.js"]);

try {
	const theStore = odbSql.openDatabase (pathDatabase);
	const theTrace = [];
	const made = verbsMaker.makeVerbs ({helpers: {}, prefs: {}, prefixes: {"": folderHere}}, theTrace);
	const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
	environment.odbDates = theStore.datesForPath;
	environment.setOdbDates = theStore.setDatesForPath;
	environment.parseScript = function (theLines) {
		return (parse.parseOutline (parse.linesToTree (theLines)));
		};
	environment.frames.push ({vars: {}});
	evaluate.evaluate (parse.parseOutline (parse.linesToTree ([{level: 0, text: "webBrowser.init ()"}])), environment);
	theStore.close ();
	console.log ("ran webBrowser.init -- the proxy settings tcp.httpClient reads are there now");
	}
catch (err) {
	console.log ("Couldn't run webBrowser.init because " + err.message);
	console.log ("Run it by hand in a script window: webBrowser.init ()");
	}

console.log ("");
console.log ("Done. " + pathDatabase + " is ready for this release.");
