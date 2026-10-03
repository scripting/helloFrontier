/*  compileAll.js -- parse EVERY script in a database and report what doesn't.

	node misc/compileAll.js [path to the .db]

	The gate before a release goes out. DW, 8/21/26, after a morning lost to
	op.xmlToOutline not parsing in the release he had just installed: "the fact
	that there was at least one syntax error in the code you shipped says you
	need to work on your process. that's not allowed. you can't ship something
	that fails that test."

	It answers 0 when every script parses and 1 when any script doesn't, so a
	build script can stop on it. The suite (usertalk/code/runAll.js) is a
	different question -- it asks whether scripts RUN. This asks only whether
	they parse, and the two fail independently.

	by CC, 8/21/26  */

const pathTool = require ("path");
const parse = require ("/Users/davewiner/Claude/usertalk/code/parse.js");
const sqlite3 = require (pathTool.join (__dirname, "..", "node_modules", "better-sqlite3"));

const pathDatabase = (process.argv [2] === undefined)
	? pathTool.join (__dirname, "..", "electronApp", "desktopStaging", "server", "seed.db")
	: process.argv [2];

const theDatabase = new sqlite3 (pathDatabase, {readonly: true});

const selectRow = theDatabase.prepare ("select id, name, parentid from odb where id = ?");

function pathForId (theId) {
	const theNames = [];
	var theWalkingId = theId;
	while ((theWalkingId !== 0) && (theNames.length < 30)) {
		const theRow = selectRow.get (theWalkingId);
		if (theRow === undefined) {
			break;
			}
		theNames.unshift (theRow.name);
		theWalkingId = theRow.parentid;
		}
	return (theNames.join ("."));
	}

const theScripts = theDatabase.prepare ("select id, name, type, value from odb where type = 'script' and value is not null").all ();

const theFailures = [];
var ctParsed = 0, ctUnreadable = 0;

theScripts.forEach (function (theRow) {
	var theLines;
	try {
		theLines = JSON.parse (theRow.value);
		}
	catch (err) {
		ctUnreadable++;
		theFailures.push ({path: pathForId (theRow.id), message: "the stored value isn't readable as lines"});
		return;
		}
	try {
		parse.parseOutline (parse.linesToTree (theLines));
		ctParsed++;
		}
	catch (err) {
		theFailures.push ({path: pathForId (theRow.id), message: err.message});
		}
	});

console.log (pathTool.basename (pathDatabase) + ": " + ctParsed + " of " + theScripts.length + " scripts parse.");

if (theFailures.length === 0) {
	process.exit (0);
	}

console.log ("");
theFailures.forEach (function (theFailure) {
	console.log ("   " + theFailure.path);
	console.log ("      " + theFailure.message);
	});
console.log ("");
console.log (theFailures.length + ((theFailures.length === 1) ? " script does not parse. It does not ship." : " scripts do not parse. It does not ship."));
process.exit (1);
