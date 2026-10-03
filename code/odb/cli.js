/*  Command-line interface for frontierOdb.

	node cli.js database.root -- list the structure, names and types
	node cli.js database.root dump nodeEditorSuite.data.glossary -- one entry as JSON
	node cli.js database.root json outfile.json -- the whole database as JSON

	Fat page exports work too: node cli.js nodeEditor.projects.fttb

	by CC, 7/26/26 */

const frontierOdb = require ("./frontierodb.js");
const fs = require ("fs");
const pathTool = require ("path");

const pathDatabase = process.argv [2];
const verb = process.argv [3];
const param = process.argv [4];

if (pathDatabase === undefined) {
	console.log ("usage: node cli.js database.root [dump path | json outfile]");
	process.exit (1);
	}

function readAnyFile (thePath) { //a .root file, or a fat page export like .fttb
	const extension = pathTool.extname (thePath).toLowerCase ();
	if (extension.indexOf (".ft") === 0) {
		const thePage = frontierOdb.readFatPage (thePath);
		if (thePage.value.type === "table") {
			return (thePage.value.value);
			}
		else { //an outline, script or other single value -- wrap it in a table of one
			var name = "value";
			if (typeof thePage.directives.adrPageData === "string") {
				const parts = thePage.directives.adrPageData.split (".");
				name = parts [parts.length - 1];
				}
			const wrapper = {};
			wrapper [name] = thePage.value;
			return (wrapper);
			}
		}
	else {
		return (frontierOdb.readRootFile (thePath));
		}
	}

const theDatabase = readAnyFile (pathDatabase);

function describe (theTable, indent) {
	Object.keys (theTable).forEach (function (name) {
		const value = theTable [name];
		if ((typeof value === "object") && (value !== null) && (value.type === "table")) {
			console.log (indent + name + " (table, " + Object.keys (value.value).length + " items)");
			describe (value.value, indent + "\t");
			}
		else {
			if ((typeof value === "object") && (value !== null) && (value.lines !== undefined)) {
				console.log (indent + name + " (" + value.type + ", " + value.lines.length + " lines)");
				}
			else {
				var desc = JSON.stringify (value);
				if ((desc !== undefined) && (desc.length > 80)) {
					desc = desc.slice (0, 80) + "...";
					}
				console.log (indent + name + ": " + desc);
				}
			}
		});
	}

if (verb === undefined) {
	describe (theDatabase, "");
	}
else {
	if (verb === "dump") {
		console.log (JSON.stringify (frontierOdb.getAddress (theDatabase, param), undefined, "\t"));
		}
	else {
		if (verb === "json") {
			fs.writeFileSync (param, JSON.stringify (theDatabase, undefined, "\t"));
			console.log ("wrote " + param);
			}
		else {
			console.log ("Can't do \"" + verb + "\" because the verbs are dump and json.");
			}
		}
	}
