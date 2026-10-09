/*  The object database in SQL.
	
	One row per object, identified by an integer id, with parentid
	pointing at the table it lives in. Names are opaque -- a Frontier name
	can contain dots, spaces and tabs, so nothing is built by gluing names
	together. An address like system.verbs.builtins.string.lower resolves
	by walking, one indexed lookup per component.
	
	Nothing is written back to the .root format: a database is built from
	roots once, and from then on the database is the truth.
	
	The reader hands the evaluator ordinary-looking tables that are really
	proxies -- a child materializes when something asks for it, the way
	the kernel loads a value when it's touched instead of holding the
	whole database in memory.
	
	by CC, 7/28/26 */

const fs = require ("fs");
const pathTool = require ("path");
const charvalue = require ("./charvalue.js"); //8/26/26 by CC -- the char type, stored as its own row type
const localAddresses = require ("./localAddresses.js"); //9/21/26 by CC -- the address of a local table, kept good while it sits in the database

const idRoot = 0; //the root table's children have parentid 0

function requireSqlite () {
	try {
		return (require ("better-sqlite3"));
		}
	catch (err) {
		const message = "Can't use the SQL object database because better-sqlite3 isn't installed.";
		throw new Error (message);
		}
	}

/*  8/17/26 by CC -- every object carries WHEN IT WAS MADE and WHEN IT LAST
	CHANGED, which is what Frontier does: the kernel's table format keeps
	timecreated and timelastsave on every table (tableformats.c), and
	timeCreated/timeModified are language verbs anyone can ask. DW asked for
	this by name -- outlines and tables have creation and modification dates
	-- and it's what makes a window able to say how old the thing in it is.
	The two columns are added to a database that predates them, so an
	existing odb keeps working and starts keeping dates from the first write.  */

const createScript = `
	create table if not exists odb (
		id integer primary key autoincrement,
		parentid integer not null,
		name text not null,
		lowername text not null,
		type text not null,
		value text,
		whencreated text,
		whenmodified text
		);
	create index if not exists odbparent on odb (parentid, lowername);
	`;

function addTheLinkedColumn (theDatabase) {

	/*  9/10/26 by CC -- THE LINKED CODE. The kernel keeps a script's compiled
		code linked to the script (opverblinkcode) apart from its text: editing
		the text in a window changes nothing that runs until the script is
		compiled again -- Compile, or Run -- and a Compile that fails leaves
		the old code linked (scriptcompiler returns before linking). DW, 9/9:
		"that's the rule. autosave is not the same thing as compile." Here
		the workers are separate processes, so the linked code lives in the
		row: this column holds the lines last compiled, stamped with the
		server session that compiled them, since the kernel links nothing
		at launch -- a relaunch compiles the text. The value column is the
		text, as always; every other reader of the row is untouched.  */

	const theColumns = {};
	theDatabase.prepare ("pragma table_info (odb)").all ().forEach (function (theRow) {
		theColumns [theRow.name] = true;
		});
	if (theColumns.linked === undefined) {
		theDatabase.exec ("alter table odb add column linked text;");
		}
	}

function addTheDateColumns (theDatabase) { //a database made before 8/17/26 has neither column
	const theColumns = {};
	theDatabase.prepare ("pragma table_info (odb)").all ().forEach (function (theRow) {
		theColumns [theRow.name] = true;
		});
	if (theColumns.whencreated === undefined) {
		theDatabase.exec ("alter table odb add column whencreated text;");
		}
	if (theColumns.whenmodified === undefined) {
		theDatabase.exec ("alter table odb add column whenmodified text;");
		}
	}

/*  8/20/26 by CC -- a marker is what frontierOdb hands back for a value it
	can't unpack: exactly a Frontier type name and a byte count. Asking only
	whether the object has a "type" property was not the same question, and
	the difference cost real data: DW's system.verbs.builtins.file has a verb
	in it named type, so the whole file table -- 112 verbs, fileFromPath and
	readWholeFile among them -- read as a marker and installed as an empty
	table. Nothing said so. A table with a child named type is a table.  */

function flMarkerValue (theValue) {
	return ((theValue.type !== undefined) && (typeof theValue.length === "number"));
	}

function valueType (theValue) { //the type name that goes in the row
	if ((theValue === undefined) || (theValue === null)) {
		return ("novalue");
		}
	if (typeof theValue === "string") {
		return ("string");
		}
	if (typeof theValue === "number") {
		return ("number");
		}
	if (typeof theValue === "boolean") {
		return ("boolean");
		}
	if (theValue instanceof Date) {
		return ("date");
		}
	if (theValue instanceof Number) { //8/19/26 by CC -- a double is a boxed Number; it stores as the number it is
		return ("number");
		}
	if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- a char keeps its type across the database
		return ("char");
		}
	if (Array.isArray (theValue)) {
		return ("list");
		}
	if (theValue.flOdbScript === true) {
		return (theValue.scriptType === "outline" ? "outline" : "script");
		}
	if (theValue.flOdbMenubar === true) { //8/8/26 by CC -- a decoded menubar: outline lines, each command carrying its script
		return ("menubar");
		}
	if (theValue.flWpText === true) {
		return ("wptext");
		}
	if ((theValue.flOdbAddressText === true) || (theValue.flAddress === true)) { /*  8/19/26 by CC -- the SECOND form was missing, and it
		corrupted data quietly: an address made at runtime (@x, parentOf, window.frontmost) carries flAddress, not flOdbAddressText, so
		writing one into the database stored it as a TABLE of the address object's own internals. DW hit it on
		nodeEditorSuite.data.adrparent = adrparent in nodeEditorSuite.uploadScripts, a line of his from 12/6/19.  */
		return ("address");
		}
	if (theValue.flOdbSqlTable === true) {
		return ("table");
		}
	if ((theValue.type === "binary") && (theValue.data !== undefined)) {
		/*  8/16/26 by CC -- a real binary VALUE, the kind binary () makes:
			people.setUserPassword stores every password as one. It was
			falling into the marker branch below, which keeps a type and a
			byte count and drops the bytes -- the password went in and
			nothing came back.  */
		return ("binary");
		}
	if (flMarkerValue (theValue)) {
		/*  An undecoded value -- frontierOdb kept it as a marker carrying
			its Frontier type and byte count. It gets its own row type, so a
			marker that says "string" is never mistaken for a string.  */
		return ("marker");
		}
	return ("table");
	}

function encodeValue (theValue, theType) {
	const theText = encodeValueText (theValue, theType);
	return ((theText === undefined) ? null : theText); //the column is never undefined
	}

function encodeValueText (theValue, theType) { //everything but a table becomes text
	switch (theType) {
		case "novalue": case "table":
			return (null);
		case "string":
			return (theValue);
		case "number": case "boolean":
			return (String (theValue));
		case "char": //8/26/26 by CC -- the code, one byte
			return (String (theValue.valueOf ()));
		case "date":
			return (theValue.toISOString ());
		case "list":
			return (JSON.stringify (theValue));
		case "script": case "outline": case "menubar":
			return (JSON.stringify (theValue.lines));
		case "wptext":
			/*  8/24/26 by CC -- the raw bytes Frontier wrote ride along when
				the value came from a .root, so saving the database back to a
				.root can put them back exactly -- the wp pack format belongs
				to the licensed engine and can't be rebuilt from the text. A
				wptext without raw stores the old way, plain text.  */
			if (theValue.raw !== undefined) {
				return (JSON.stringify ({text: theValue.text, raw: theValue.raw}));
				}
			return (theValue.text);
		case "binary": //8/16/26 by CC -- the bytes themselves; passwords ride this way
			if ((theValue.binaryType !== undefined) && (theValue.binaryType !== "????")) { //9/25/26 by CC -- a typed binary (a GIF out of a .root) keeps its four-byte type, the way wptext keeps raw; an untyped one stores the old way
				return (JSON.stringify ({binaryType: String (theValue.binaryType), data: theValue.data}));
				}
			return (theValue.data);
		case "address":
			if (localAddresses.flLocalTableAddress (theValue)) { //9/21/26 by CC -- the address of a local table stays good while the local lives, the kernel's way; see localAddresses.js
				return (localAddresses.register (theValue));
				}
			return ((theValue.path === undefined) ? theValue.pathText : theValue.path); //8/19/26 by CC -- a runtime address keeps its path in pathText
		default: //a marker: the Frontier type and how many bytes -- and, since 9/6/26, the bytes themselves when the reader kept them (raw, base64), so fileMenu.saveCopy can put back a filespec or a rect exactly as Frontier wrote it
			if (theValue.raw !== undefined) {
				return (JSON.stringify ({type: theValue.type, length: theValue.length, raw: theValue.raw}));
				}
			return (JSON.stringify ({type: theValue.type, length: theValue.length}));
		}
	}

function decodeValue (theText, theType) {
	switch (theType) {
		case "novalue":
			return (undefined);
		case "string":
			return (theText);
		case "number":
			return (Number (theText));
		case "char": //8/26/26 by CC
			return (charvalue.makeChar (Number (theText)));
		case "boolean":
			return (theText === "true");
		case "date":
			return (new Date (theText));
		case "list":
			return (JSON.parse (theText));
		case "script": case "outline":
			return ({flOdbScript: true, scriptType: theType, lines: JSON.parse (theText)});
		case "menubar":
			return ({flOdbMenubar: true, lines: JSON.parse (theText)});
		case "wptext": {
			var theParsed;
			if (theText.charAt (0) === "{") { //8/24/26 by CC -- the shape that carries the raw bytes; see encodeValue
				try {
					theParsed = JSON.parse (theText);
					}
				catch (err) {
					theParsed = undefined;
					}
				}
			if ((theParsed !== undefined) && (theParsed.text !== undefined)) {
				return ({
					flWpText: true,
					text: theParsed.text,
					raw: theParsed.raw,
					toString: function () {
						return (this.text);
						}
					});
				}
			return ({
				flWpText: true,
				text: theText,
				toString: function () {
					return (this.text);
					}
				});
			}
		case "binary": { //8/16/26 by CC -- comes back the shape binary () makes, so string () answers the bytes
			var theTyped;
			if (theText.charAt (0) === "{") { //9/25/26 by CC -- the shape that carries the type; see encodeValue
				try {
					theTyped = JSON.parse (theText);
					}
				catch (err) {
					theTyped = undefined;
					}
				}
			if ((theTyped !== undefined) && (theTyped !== null) && (theTyped.binaryType !== undefined) && (theTyped.data !== undefined)) {
				return ({
					type: "binary",
					binaryType: String (theTyped.binaryType),
					data: String (theTyped.data),
					toString: function () {
						return (this.data);
						}
					});
				}
			return ({
				type: "binary",
				data: theText,
				toString: function () {
					return (this.data);
					}
				});
			}
		case "address":
			/*  8/23/26 by CC -- and it reads as its path. Without the
				toString, string (adr) on an address that came back out of
				the database answered "[object Object]" -- the same thing
				that named his backup file [objectObject].DW0062.opml.  */
			return ({
				flOdbAddressText: true,
				path: theText,
				toString: function () {
					return (this.path);
					}
				});
		default: //a marker comes back the shape frontierOdb gave it
			return (JSON.parse (theText));
		}
	}

function flPlainTable (theValue) { //a table, as opposed to a value that happens to be an object
	if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
		return (false);
		}
	if (theValue instanceof Number) { //8/19/26 by CC -- a double is a value, not a table
		return (false);
		}
	if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- a char is a value too
		return (false);
		}
	if (theValue.flOdbSqlTable === true) { //already one of ours
		return (true);
		}
	if ((theValue.type === "binary") && (theValue.data !== undefined)) { //9/8/26 by CC -- a binary is a value: a Tool's #images.space, a GIF, came in through the Tools install as a table of two strings, type and data, and went out in DW's saveCopy that way
		return (false);
		}
	return ((theValue.flOdbScript === undefined) && (theValue.flOdbMenubar === undefined) && (theValue.flWpText === undefined) &&
		(theValue.flOdbAddressText === undefined) && (theValue.flAddress !== true) && (!flMarkerValue (theValue)) &&
		(!Array.isArray (theValue)) && (!(theValue instanceof Date)));
	}

function buildDatabase (folderOdb, pathDatabase, logCallback) {
	
	/*  Read a folder of roots the way odbHome does and write it into a
		database. This happens once; after it, the roots are history.  */
	
	const log = (logCallback === undefined) ? function () {} : logCallback;
	const sqlite3 = requireSqlite ();
	const odbHome = require ("./odbHome.js");
	
	if (fs.existsSync (pathDatabase)) {
		fs.unlinkSync (pathDatabase);
		}
	fs.mkdirSync (pathTool.dirname (pathDatabase), {recursive: true});
	
	const theDatabase = new sqlite3 (pathDatabase);
	theDatabase.pragma ("journal_mode = WAL");
	theDatabase.exec (createScript);
	
	const insert = theDatabase.prepare ("insert into odb (parentid, name, lowername, type, value) values (?, ?, ?, ?, ?);");
	
	log ("reading the roots");
	const theTree = odbHome.loadFolder (folderOdb, log);
	
	var ctRows = 0;
	
	const writeTree = theDatabase.transaction (function (theTable, parentId) {
		Object.keys (theTable).forEach (function (name) {
			const theValue = theTable [name];
			const theType = flPlainTable (theValue) ? "table" : valueType (theValue);
			const theId = insert.run (parentId, name, String (name).toLowerCase (), theType, encodeValue (theValue, theType)).lastInsertRowid;
			ctRows++;
			if (theType === "table") {
				writeTree (theValue, theId);
				}
			});
		});
	
	log ("writing rows");
	writeTree (theTree, idRoot);
	
	log (ctRows + " rows written to " + pathDatabase);
	theDatabase.close ();
	return (ctRows);
	}

function installTree (pathDatabase, theAddress, theTree, logCallback) {
	
	/*  8/11/26 by CC -- write one subtree into a database that already
		exists, at a dotted address, replacing whatever is there. This is
		how a fat-page export DW made in Frontier gets into a running
		sandbox without rebuilding the database around it -- a rebuild
		would throw away everything he's edited since.
		
		It answers how many rows it wrote. The tables above the address are
		made if they aren't there.  */
	
	const log = (logCallback === undefined) ? function () {} : logCallback;
	const sqlite3 = requireSqlite ();
	
	const theDatabase = new sqlite3 (pathDatabase);
	theDatabase.pragma ("journal_mode = WAL");
	
	const selectChild = theDatabase.prepare ("select id, name, type from odb where parentid = ? and lowername = ?;");
	const selectChildren = theDatabase.prepare ("select id from odb where parentid = ?;");
	const insert = theDatabase.prepare ("insert into odb (parentid, name, lowername, type, value) values (?, ?, ?, ?, ?);");
	const deleteById = theDatabase.prepare ("delete from odb where id = ?;");
	
	function removeSubtree (theId) { //a table's children go with it
		selectChildren.all (theId).forEach (function (theRow) {
			removeSubtree (theRow.id);
			});
		deleteById.run (theId);
		}
	function sureTable (parentId, theName) {
		const existing = selectChild.get (parentId, String (theName).toLowerCase ());
		if (existing !== undefined) {
			if (existing.type !== "table") {
				const message = "Can't install at " + theAddress + " because " + theName + " is a " + existing.type + ", not a table.";
				throw new Error (message);
				}
			return (existing.id);
			}
		log ("made the table " + theName);
		return (insert.run (parentId, theName, String (theName).toLowerCase (), "table", null).lastInsertRowid);
		}
	
	var ctRows = 0;
	
	const writeTree = theDatabase.transaction (function (theTable, parentId) {
		Object.keys (theTable).forEach (function (name) {
			const theValue = theTable [name];
			const theType = flPlainTable (theValue) ? "table" : valueType (theValue);
			const theId = insert.run (parentId, name, String (name).toLowerCase (), theType, encodeValue (theValue, theType)).lastInsertRowid;
			ctRows++;
			if (theType === "table") {
				writeTree (theValue, theId);
				}
			});
		});
	
	const theSegments = theAddress.split (".");
	const theName = theSegments.pop ();
	var parentId = idRoot;
	theSegments.forEach (function (theSegment) {
		parentId = sureTable (parentId, theSegment);
		});
	
	const existing = selectChild.get (parentId, String (theName).toLowerCase ());
	if (existing !== undefined) {
		removeSubtree (existing.id);
		log ("replaced what was at " + theAddress);
		}
	
	const theType = flPlainTable (theTree) ? "table" : valueType (theTree);
	const theId = insert.run (parentId, theName, String (theName).toLowerCase (), theType, encodeValue (theTree, theType)).lastInsertRowid;
	ctRows++;
	if (theType === "table") {
		writeTree (theTree, theId);
		}
	
	log (ctRows + " rows written at " + theAddress);
	theDatabase.close ();
	return (ctRows);
	}

function openDatabase (pathDatabase) {
	
	/*  Open a built database and hand back a root table. Children
		materialize on access -- a table is a proxy over the rows whose
		parentid is its own, so the database is never all in memory.  */
	
	const sqlite3 = requireSqlite ();
	const theDatabase = new sqlite3 (pathDatabase);
	theDatabase.pragma ("journal_mode = WAL");
	theDatabase.exec (createScript);
	
	addTheDateColumns (theDatabase);
	addTheLinkedColumn (theDatabase); //9/10/26 by CC
	theDatabase.exec ("create table if not exists settings (name text primary key, value text);"); //9/16/26 by CC -- what the kernel kept in the root record beside the tables (cancoon.h): the Quick Script window's text (hscriptstring) for one. Not an object, not addressable, saved with the database
	const selectSetting = theDatabase.prepare ("select value from settings where name = ?;");
	const upsertSetting = theDatabase.prepare ("insert into settings (name, value) values (?, ?) on conflict (name) do update set value = excluded.value;");
	
	const selectChildren = theDatabase.prepare ("select name from odb where parentid = ? order by lowername;");
	const selectChild = theDatabase.prepare ("select id, name, type, value, whencreated, whenmodified, linked from odb where parentid = ? and lowername = ?;");
	const updateLinked = theDatabase.prepare ("update odb set linked = ? where id = ?;"); //9/10/26 by CC -- the linked code alone; the modified date is the text's
	const selectLinked = theDatabase.prepare ("select linked from odb where id = ?;");
	const insertChild = theDatabase.prepare ("insert into odb (parentid, name, lowername, type, value, whencreated, whenmodified) values (?, ?, ?, ?, ?, ?, ?);");
	const insertChildIfMissing = theDatabase.prepare ("insert into odb (parentid, name, lowername, type, value, whencreated, whenmodified) select ?, ?, ?, ?, ?, ?, ? where not exists (select 1 from odb where parentid = ? and lowername = ?);"); /*  10/8/26 by CC -- A NAME GOES INTO A TABLE ONCE, whichever
		connection gets there first. Colin's duplicate rows (helloFrontier
		issue 16) and DW's own user.scheduler.stats.log.overnight twice, made
		in the same millisecond on 9/17: two threads each looked for the name,
		saw nothing (a cached miss, or a real one), and inserted it, and the
		odb table has no unique index on (parentid, lowername) -- a unique
		index can't be added to a database that already holds doubles. So the
		insert itself checks, inside SQLite's write lock, where no other
		connection can slip in between the look and the write; when it
		inserts nothing, the row is there now and the write goes onto it.
		See writeValue.  */
	const updateChild = theDatabase.prepare ("update odb set type = ?, value = ?, whenmodified = ?, linked = null where id = ?;"); //9/10/26 by CC -- a new value is a new object: nothing linked, until it compiles
	const selectDates = theDatabase.prepare ("select whencreated, whenmodified from odb where id = ?;");
	const deleteById = theDatabase.prepare ("delete from odb where id = ?;");
	const selectRowById = theDatabase.prepare ("select parentid, name from odb where id = ?;"); //8/18/26 by CC -- for naming a table in an error message, see theScalarError below
	
	const proxyCache = new Map (); //one proxy per id, so identity holds across reads
	
	/*  8/17/26 by CC -- and one decoded SCRIPT per id, for as long as the row
		hasn't changed. A script's lines arrive as text and have to be taken
		apart on every read, which for a script called in a loop is the same
		work over and over -- and DW's benchmark is exactly that loop. The
		entry goes when the row is written or deleted, and the whole thing
		goes when the process does, the way Frontier's caches did.  */
	
	const scriptCache = new Map ();
	
	/*  8/17/26 by CC -- AND THE REFERENCES ARE CACHED, which is the other half
		of what DW measured. Resolving `workspace.doVeryLittle` asks the
		database where each name lives, and it asked every single time: nine
		queries to call a script whose body is one line of arithmetic. Frontier
		cached its references too -- and, as DW remembers it, the only way to
		clear that cache was to restart. This one clears itself whenever we
		write or delete the entry in question, so it can't go stale behind an
		edit; a name that isn't there is remembered as not-there, which is what
		makes a miss cheap.
		
		One process owns this database, so nothing else can change a row behind
		the cache's back.  */
	
	const rowCache = new Map ();

	/*  8/23/26 by CC -- what the staleness check reads. See
		checkForOutsideChanges at the bottom for why it exists.  */

	const selectDataVersion = theDatabase.prepare ("pragma data_version;");

	function readDataVersion () {
		const theRow = selectDataVersion.get ();
		return ((theRow === undefined) ? 0 : theRow.data_version);
		}

	var lastDataVersion = readDataVersion (); //moved by checkForOutsideChanges

	/*  9/13/26 by CC -- THE STRUCTURE GENERATION. A number that moves whenever
		the SHAPE of the database changes -- a row added, removed, renamed or
		moved, a table replaced, or the caches dropped for another
		connection's commit -- and stays put when a scalar is written in
		place. The evaluator reads it as odbGeneration on any table proxy and
		keeps its system.paths table list for as long as it holds still:
		until today that list was rebuilt on every name lookup that reached
		the paths (JSON.compile on a 5K file, 12,141 verb calls, 1.1 seconds
		-- DW's report 9/13, instant in Berkeley).  */

	var structureGeneration = 0;

	function cacheKeyFor (parentId, lowerName) {
		return (parentId + "\t" + lowerName);
		}
	
	function childRow (parentId, theName) {
		const lowerName = String (theName).toLowerCase ();
		const theKey = cacheKeyFor (parentId, lowerName);
		if (rowCache.has (theKey)) {
			return (rowCache.get (theKey));
			}
		const theRow = selectChild.get (parentId, lowerName);
		rowCache.set (theKey, theRow);
		return (theRow);
		}
	
	function forgetRow (parentId, theName) {
		rowCache.delete (cacheKeyFor (parentId, String (theName).toLowerCase ()));
		}
	
	function removeSubtree (theId) { //a table's children go with it
		structureGeneration++; //9/13/26 by CC
		selectChildren.all (theId).forEach (function (row) {
			const child = childRow (theId, row.name);
			forgetRow (theId, row.name); //8/17/26 by CC -- the cache can't be left holding a row that no longer exists
			if (child !== undefined) {
				removeSubtree (child.id);
				}
			});
		deleteById.run (theId);
		proxyCache.delete (theId);
		scriptCache.delete (theId);
		}
	
	function writeValue (parentId, name, theValue) { //set an entry, replacing whatever was there
	
		/*  8/17/26 by CC -- WRITING A TABLE THAT IS ALREADY IN THE DATABASE.
			Found with DW's own benchmark: `workspace = workspace` emptied
			workspace. Replacing a table drops everything under it first, and
			when the value being written IS that table, the copy that follows
			had nothing left to copy from. Writing a table onto itself is
			nothing at all, and writing one odb table into another reads the
			source out whole before the destination is touched.  */
		
		const existing = childRow (parentId, name);
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbSqlTable === true)) {
			if ((existing !== undefined) && (existing.id === theValue.odbId)) {
				return (existing.id); //itself; nothing to do
				}
			const theSnapshot = {};
			Object.keys (theValue).forEach (function (theChildName) {
				theSnapshot [theChildName] = theValue [theChildName];
				});
			theValue = theSnapshot;
			}
		const theType = flPlainTable (theValue) ? "table" : valueType (theValue);
		const theColumn = encodeValue (theValue, theType);
		const nowText = (new Date ()).toISOString (); //8/17/26 by CC -- when it was made, when it last changed
		forgetRow (parentId, name); //8/17/26 by CC -- whatever the cache remembers about this name is about to be wrong
		if ((existing === undefined) || (existing.type === "table") || (theType === "table")) { //9/13/26 by CC -- a new row, or a table coming or going: the shape changed
			structureGeneration++;
			}
		var theId;
		var theRowNow = existing; //10/8/26 by CC -- the row as it is at the moment of the write, which another connection may have made since we looked
		if (existing === undefined) {
			const theInsert = insertChildIfMissing.run (parentId, name, String (name).toLowerCase (), theType, theColumn, nowText, nowText, parentId, String (name).toLowerCase ());
			if (theInsert.changes === 1) {
				theId = theInsert.lastInsertRowid;
				}
			else { //another connection made this name between our look and our write: the value goes onto its row
				theRowNow = selectChild.get (parentId, String (name).toLowerCase ());
				}
			}
		if (theRowNow !== undefined) {
			theId = theRowNow.id;
			if (theRowNow.type === "table") { //replacing a table drops what was under it
				selectChildren.all (theId).forEach (function (row) {
					const child = childRow (theId, row.name);
					forgetRow (theId, row.name); /*  8/18/26 by CC -- found in the
						nightly review of last night's caching: the rows under
						a replaced table were deleted from the database and
						left in the cache, so a name the old table had and the
						new one doesn't kept answering the old value for as
						long as the process lived -- and answered "no object
						with that name" after a restart. removeSubtree's own
						loop forgets as it goes; this one didn't.  */
					if (child !== undefined) {
						removeSubtree (child.id);
						}
					});
				proxyCache.delete (theId);
				}
			updateChild.run (theType, theColumn, nowText, theId);
			scriptCache.delete (theId); //what was cached is what the row used to be
			}
		if (theType === "table") {
			const source = theValue;
			Object.keys (source).forEach (function (childName) {
				writeValue (theId, childName, source [childName]);
				});
			}
		return (theId);
		}
	
	function readChild (parentId, name) {
		const row = childRow (parentId, name);
		if (row === undefined) {
			return (undefined);
			}
		if (row.type === "table") {
			return (tableForId (row.id));
			}
		if ((row.type === "script") || (row.type === "outline") || (row.type === "menubar")) {
			const theCached = scriptCache.get (row.id);
			if ((theCached !== undefined) && (theCached.whenModified === row.whenmodified)) {
				return (theCached.theValue);
				}
			}
		const theValue = decodeValue (row.value, row.type);
		
		/*  8/17/26 by CC -- a script carries WHICH ROW IT IS and WHEN IT LAST
			CHANGED. Every read of a value builds a fresh object, so anything
			hung on one (a parse, say) is thrown away the moment the read
			ends -- which is why calling a script in a loop re-parsed it every
			single time. These two let the caller keep the compiled form
			somewhere that survives, and know when it has gone stale.  */
		
		if ((theValue !== undefined) && (theValue !== null) && ((theValue.flOdbScript === true) || (theValue.flOdbMenubar === true))) {
			theValue.odbId = row.id;
			theValue.whenModified = row.whenmodified;
			if ((row.linked !== undefined) && (row.linked !== null)) { //9/10/26 by CC -- the code last compiled, if any; see addTheLinkedColumn
				try {
					theValue.linked = JSON.parse (row.linked);
					}
				catch (err) {
					}
				}
			scriptCache.set (row.id, {whenModified: row.whenmodified, theValue});
			}
		return (theValue);
		}
	
	/*  8/18/26 by CC -- WHAT HAPPENS WHEN A TABLE IS HANDED TO SOMETHING THAT
		WANTS A SCALAR. It used to be JavaScript's own "Cannot convert object
		to primitive value", deposited on DW's one-liner with no verb named
		and no object named -- and, his point when he hit it on 8/18: "it's
		not using our vocabulary. what you call primitive we call scalar."
		
		A table is a proxy, and a proxy with no toString and no valueOf is
		exactly what raises that message. So the proxy answers the coercion
		itself and throws OUR error, which names the table by its address.
		Every place in the verb library that coerces -- about a hundred of
		them -- says the same thing now, and the verb's name gets added by
		the caller in evaluate.js.  */
	
	function namesForId (theId) { //9/9/26 by CC -- the names from the top down to the row, as an array
		const theNames = [];
		var theWalkingId = theId;
		while ((theWalkingId !== idRoot) && (theNames.length < 20)) {
			const theRow = selectRowById.get (theWalkingId);
			if (theRow === undefined) {
				break;
				}
			theNames.unshift (theRow.name);
			theWalkingId = theRow.parentid;
			}
		return (theNames);
		}
	
	function pathForId (theId) {

		/*  9/9/26 by CC -- A NAME WITH A DOT GOES IN BRACKETS, the kernel's
			getaddresspath (langexternalgetquotedpath, langexternalbracketname):
			an identifier stands bare, any other name is ["the name"]. Joined
			bare, a table named frontier.root gave a window an address the
			server read as frontier then root -- DW's 9/9 report.  */

		const theParts = [];
		namesForId (theId).forEach (function (theName) {
			const theText = String (theName);
			if (/^[A-Za-z_][A-Za-z0-9_]*$/.test (theText)) {
				theParts.push (theText);
				}
			else {
				theParts.push ("[\"" + theText.replace (/\\/g, "\\\\").replace (/"/g, "\\\"") + "\"]");
				}
			});
		return (theParts.join ("."));
		}
	
	function theScalarError (theId) {
		var theName = pathForId (theId);
		if (theName.length === 0) {
			theName = "that object";
			}
		const theError = new Error ("Can't use " + theName + " because it's a table, and a scalar is what's needed here.");
		theError.flTableAsScalar = true;
		theError.theTableName = theName;
		return (theError);
		}
	
	/*  9/14/26 by CC -- RENAME AND MOVE BY ID, for the verbs. table.rename
		and table.move (tableverbs.c: tablerenameverb, tablemoveverb) keep
		the node and change its key or its table -- hashsetnodekey, hashdelete
		without tossing the value then hashtableassign. Here the row keeps its
		id, so its children, its dates, its linked code and any window's
		remembered state go with it. renameForPath and moveForPath below (the
		table window's rename and drag, 9/6) resolve their parts and land
		here. Any table proxy answers odbRenameChild and odbMoveChild.  */

	function renameChild (parentId, theName, theNewName) {
		const theRow = childRow (parentId, theName);
		const theText = pathForId (parentId) + "." + theName;
		if (theRow === undefined) {
			return ({flRenamed: false, message: "Can't rename " + theText + " because there is no object at that address."});
			}
		const theNewText = String (theNewName);
		if (theNewText.length === 0) {
			return ({flRenamed: false, message: "Can't rename " + theText + " because the new name is empty."});
			}
		const existing = childRow (parentId, theNewText);
		if ((existing !== undefined) && (existing.id !== theRow.id)) {
			return ({flRenamed: false, message: "Can't rename " + theText + " as " + theNewText + " because an item with that name already exists."}); //the kernel's badrenameerror
			}
		theDatabase.prepare ("update odb set name = ?, lowername = ?, whenmodified = ? where id = ?;").run (theNewText, theNewText.toLowerCase (), (new Date ()).toISOString (), theRow.id);
		structureGeneration++; //9/13/26 by CC
		forgetRow (parentId, theRow.name);
		forgetRow (parentId, theNewText);
		proxyCache.delete (parentId);
		return ({flRenamed: true});
		}

	function moveChild (oldParentId, theName, destId, flReplace) { //flReplace: the verb's way (hashtableassign overwrites); the window's drag refuses instead
		const theRow = childRow (oldParentId, theName);
		const theText = pathForId (oldParentId) + "." + theName;
		if (theRow === undefined) {
			return ({flMoved: false, message: "Can't move " + theText + " because there is no object at that address."});
			}
		const destText = (destId === idRoot) ? "root" : pathForId (destId);
		if (destId === oldParentId) {
			return ({flMoved: true}); //already there
			}
		var walkId = destId; //not into itself or its own descendants
		while (walkId !== idRoot) {
			if (walkId === theRow.id) {
				return ({flMoved: false, message: "Can't move " + theText + " into " + destText + " because that is inside the object being moved."});
				}
			const walkRow = theDatabase.prepare ("select parentid from odb where id = ?;").get (walkId);
			if (walkRow === undefined) {
				break;
				}
			walkId = walkRow.parentid;
			}
		const existing = childRow (destId, theRow.name);
		if (existing !== undefined) {
			if (flReplace === true) {
				removeSubtree (existing.id);
				forgetRow (destId, theRow.name);
				}
			else {
				return ({flMoved: false, message: "Can't move " + theText + " into " + destText + " because there is already an object named " + theRow.name + " there."});
				}
			}
		theDatabase.prepare ("update odb set parentid = ?, whenmodified = ? where id = ?;").run (destId, (new Date ()).toISOString (), theRow.id);
		structureGeneration++; //9/13/26 by CC
		forgetRow (oldParentId, theRow.name);
		forgetRow (destId, theRow.name);
		proxyCache.delete (oldParentId);
		proxyCache.delete (destId);
		return ({flMoved: true});
		}

	function tableForId (theId) {
		
		if (proxyCache.has (theId)) {
			return (proxyCache.get (theId));
			}
		
		const target = {flOdbSqlTable: true, odbId: theId};
		
		const handler = {
			
			ownKeys: function () {
				const keys = [], theNamesSeen = new Set (); //9/20/26 by CC -- a name is listed once. DW's root has two tables named overnight in user.scheduler.stats.log, made in the same millisecond by two connections; a lookup by name answers the first, and JavaScript refuses a list with a name in it twice: "'ownKeys' on proxy: trap returned duplicate entries" reached him raw from fileMenu.saveNamedRoot
				selectChildren.all (theId).forEach (function (row) {
					const lowerName = String (row.name).toLowerCase ();
					if (theNamesSeen.has (lowerName)) {
						return;
						}
					theNamesSeen.add (lowerName);
					keys.push (row.name);
					});
				return (keys);
				},
			
			getOwnPropertyDescriptor: function (theTarget, name) {
				if (typeof name !== "string") {
					return (undefined);
					}
				const row = childRow (theId, name);
				if (row === undefined) {
					return (undefined);
					}
				return ({enumerable: true, configurable: true, writable: true, value: readChild (theId, name)});
				},
			
			has: function (theTarget, name) {
				if ((name === "flOdbSqlTable") || (name === "odbId")) {
					return (true);
					}
				if (typeof name !== "string") {
					return (false);
					}
				return (childRow (theId, name) !== undefined);
				},
			
			get: function (theTarget, name) {
				if ((name === "flOdbSqlTable") || (name === "odbId")) {
					return (theTarget [name]);
					}
				if (name === "odbGeneration") { //9/13/26 by CC -- see structureGeneration
					return (structureGeneration);
					}
				if (name === "odbRenameChild") { //9/14/26 by CC -- see renameChild
					return (function (theName, theNewName) {
						return (renameChild (theId, theName, theNewName));
						});
					}
				if (name === "odbMoveChild") { //9/14/26 by CC -- see moveChild
					return (function (theName, destProxy, flReplace) {
						return (moveChild (theId, theName, destProxy.odbId, flReplace));
						});
					}
				if (name === Symbol.toPrimitive) { //8/18/26 by CC -- see theScalarError above
					return (function () {
						throw (theScalarError (theId));
						});
					}
				if (typeof name !== "string") { //the other symbols
					return (undefined);
					}
				return (readChild (theId, name));
				},
			
			set: function (theTarget, name, theValue) {
				writeValue (theId, String (name), theValue);
				return (true);
				},
			
			deleteProperty: function (theTarget, name) {
				const row = childRow (theId, name);
				if (row !== undefined) {
					removeSubtree (row.id);
					}
				forgetRow (theId, name);
				return (true);
				}
			};
		
		const theProxy = new Proxy (target, handler);
		proxyCache.set (theId, theProxy);
		return (theProxy);
		}
	
	return ({
		odb: tableForId (idRoot),
		
		/*  8/21/26 by CC -- the real path of an object, walked from its id up
			to the root. An address value carries the text the script WROTE --
			@op.xmlToOutline stays "op.xmlToOutline" -- so anything that saves
			back to that text writes to the root instead of to the object the
			address actually found. Callers that need the true path ask here.  */
		
		pathForId: pathForId,
		namesForId: namesForId, //9/9/26 by CC -- the array, for callers that used to split pathForId's text on dots
		
		/*  8/17/26 by CC -- the dates on one object, by its path. This is what
			timeCreated and timeModified answer, and what a window asks when it
			wants to say how old the thing in it is.  */
		
		datesForPath: function (theParts) {
			var theId = idRoot;
			var theRow;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined)) {
				return (undefined);
				}
			return ({
				whenCreated: ((theRow.whencreated === undefined) || (theRow.whencreated === null)) ? undefined : new Date (theRow.whencreated),
				whenModified: ((theRow.whenmodified === undefined) || (theRow.whenmodified === null)) ? undefined : new Date (theRow.whenmodified)
				});
			},
		/*  8/20/26 by CC -- the other half of datesForPath. settimesverb in
			langverbs.c reads both times, replaces the one being set and
			writes the pair back, answering false when there's no object
			there. His op.outlineToXml does it to carry an outline's real
			creation date onto the temporary copy it writes out.  */
		
		setDatesForPath: function (theParts, theDates) {
			var theId = idRoot;
			var theRow;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined)) {
				return (false);
				}
			if (theDates.whenCreated !== undefined) {
				theDatabase.prepare ("update odb set whencreated = ? where id = ?;").run (theDates.whenCreated.toISOString (), theId);
				}
			if (theDates.whenModified !== undefined) {
				theDatabase.prepare ("update odb set whenmodified = ? where id = ?;").run (theDates.whenModified.toISOString (), theId);
				}
			return (true);
			},
		/*  8/27/26 by CC -- RENAME, KEEPING THE ROW. The table window's
			name-editing (tableedit.c: names are always editable) renames the
			row in place -- same id, same children, same creation date -- so
			everything hung on the id (a table's saved column widths, the
			window's remembered expansions) survives the rename. A name that
			would collide with a sibling, unicase, is refused with the reason.  */

		moveForPath: function (theParts, theParentParts) {

			/*  9/6/26 by CC -- AN OBJECT MOVES INTO ANOTHER TABLE, the way the
				kernel's browser does it when a row is dragged (claycallbacks.c,
				claymovefile: hashdelete from the old table, hashtableassign
				into the new; "destination must be a table"). DW's 9/6 report:
				he made a new value in workspace, moved it under
				userlandSamples in the window, and then could neither edit nor
				delete it -- the window had moved the row and nothing had told
				the database.  */

			var theId = idRoot;
			var theRow;
			var oldParentId;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				oldParentId = theId;
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined)) {
				return ({flMoved: false, message: "Can't move " + theParts.join (".") + " because there is no object at that address."});
				}
			var destId = idRoot;
			var destRow;
			var flDestFound = true;
			theParentParts.forEach (function (thePart) {
				if (!flDestFound) {
					return;
					}
				destRow = childRow (destId, thePart);
				if (destRow === undefined) {
					flDestFound = false;
					return;
					}
				destId = destRow.id;
				});
			if (!flDestFound) {
				return ({flMoved: false, message: "Can't move " + theParts.join (".") + " into " + theParentParts.join (".") + " because there is no table at that address."});
				}
			if ((destRow !== undefined) && (destRow.type !== "table")) {
				return ({flMoved: false, message: "Can't move " + theParts.join (".") + " into " + theParentParts.join (".") + " because the destination must be a table."});
				}
			return (moveChild (oldParentId, theRow.name, destId, false)); //9/14/26 by CC
			},

		renameForPath: function (theParts, theNewName) {
			var theId = idRoot;
			var theRow;
			var parentId;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				parentId = theId;
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined)) {
				return ({flRenamed: false, message: "Can't rename " + theParts.join (".") + " because there is no object at that address."});
				}
			return (renameChild (parentId, theRow.name, theNewName)); //9/14/26 by CC
			},

		/*  9/13/26 by CC -- PASTE IN A TABLE WINDOW COPIES THE OBJECT. The
			kernel's browser pastes the scrap into the list of the cursor's
			parent (browservalidatepaste, claybrowservalidate.c), and when an
			item of that name is already there it asks: "An item named "x"
			already exists in this location." DW's 9/13 report: he copied
			processMacros from one table window, pasted it into another, and
			the row was there on screen with no object behind it -- the
			paste had only put a line in the outline. This is the copy the
			row needs: the object at one address, written under its own name
			into another table. flReplace says the person answered the
			question. The answer says flExists when the question has to be
			asked.  */

		copyForPath: function (theSourceParts, theDestParentParts, flReplace) {
			var theId = idRoot;
			var sourceRow, sourceParentId;
			var flFound = true;
			theSourceParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				sourceParentId = theId;
				sourceRow = childRow (theId, thePart);
				if (sourceRow === undefined) {
					flFound = false;
					return;
					}
				theId = sourceRow.id;
				});
			const sourceText = theSourceParts.join (".");
			if (!flFound || (sourceRow === undefined)) {
				return ({flCopied: false, message: "Can't paste " + sourceText + " because there is no object at that address."});
				}
			var destId = idRoot;
			flFound = true;
			theDestParentParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				const theRow = childRow (destId, thePart);
				if ((theRow === undefined) || (theRow.type !== "table")) {
					flFound = false;
					return;
					}
				destId = theRow.id;
				});
			const destText = (theDestParentParts.length === 0) ? "the top level" : theDestParentParts.join (".");
			if (!flFound) {
				return ({flCopied: false, message: "Can't paste " + sourceText + " into " + destText + " because that isn't a table."});
				}
			var walkId = destId; //not into itself or its own descendants
			while (walkId !== idRoot) {
				if (walkId === sourceRow.id) {
					return ({flCopied: false, message: "Can't paste " + sourceText + " into " + destText + " because that is inside the object being pasted."});
					}
				const walkRow = theDatabase.prepare ("select parentid from odb where id = ?;").get (walkId);
				if (walkRow === undefined) {
					break;
					}
				walkId = walkRow.parentid;
				}
			const existing = childRow (destId, sourceRow.name);
			if ((existing !== undefined) && (flReplace !== true)) {
				return ({flCopied: false, flExists: true, message: "Can't paste " + sourceRow.name + " because an item named \u201c" + sourceRow.name + "\u201d already exists in " + destText + "."}); //left and right double quotes, the kernel's dialog
				}
			if ((existing !== undefined) && (existing.id === sourceRow.id)) {
				return ({flCopied: true, name: sourceRow.name}); //pasted over itself: nothing to do
				}
			const theValue = readChild (sourceParentId, sourceRow.name);
			writeValue (destId, sourceRow.name, theValue);
			return ({flCopied: true, name: sourceRow.name});
			},

		/*  8/27/26 by CC -- A TABLE'S DISPLAY FORMATS live in the table's own
			row, the way the kernel keeps them in the table's disk record
			(tablepackformats, tableformats.c) -- so the column widths DW
			drags travel WITH the table, his ruling. The value column of a
			table row was always null; it holds the formats JSON now. Nothing
			in the runtime reads a table row's value, so the runtime can't
			trip on it -- and replacing the table replaces the formats, which
			is exactly what happens in Frontier.  */

		formatsForPath: function (theParts) {
			var theId = idRoot;
			var theRow;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined) || (theRow.type !== "table") || (theRow.value === null) || (theRow.value === undefined)) {
				return (undefined);
				}
			try {
				return (JSON.parse (theRow.value));
				}
			catch (err) {
				return (undefined);
				}
			},

		setFormatsForPath: function (theParts, theFormats) {
			var theId = idRoot;
			var theRow;
			var parentId;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				parentId = theId;
				theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			if (!flFound || (theRow === undefined) || (theRow.type !== "table")) {
				return (false);
				}
			theDatabase.prepare ("update odb set value = ? where id = ?;").run (JSON.stringify (theFormats), theRow.id);
			forgetRow (parentId, theRow.name);
			return (true);
			},

		/*  8/23/26 by CC -- ANOTHER CONNECTION MAY HAVE WRITTEN. The caches
			above were built on "One process owns this database, so nothing
			else can change a row behind the cache's back." The app has never
			worked that way: trigger.js opens the database at startup and
			every Run spawns a worker that opens its own connection. So what a
			Run created was invisible to the server for the rest of the
			session -- a cached miss is remembered forever -- which is what
			DW saw on 8/23 as "nothing happens when i run the new verb", and
			what let trigger.js's installValueAtAddress put an empty table
			over a table that really had children in it.

			pragma data_version moves whenever another CONNECTION commits, and
			never for our own writes. Checking it costs about as much as the
			query a cache hit saves -- measured 8/23, 1.7us against 2.6us --
			so it is not something to do on every name. Call it where another
			process could have gotten in: when a worker finishes, and at the
			top of a request. Answers true when the caches were dropped.  */

		getSetting: function (theName) { //9/16/26 by CC -- a value kept with the database but outside the odb table; undefined when there is none
			const theRow = selectSetting.get (String (theName));
			return ((theRow === undefined) ? undefined : theRow.value);
			},
		setSetting: function (theName, theValue) {
			upsertSetting.run (String (theName), String (theValue));
			},
		setLinkedCode: function (theId, theLinked) { //9/10/26 by CC -- {lines, session, stamp}, or undefined to unlink; see addTheLinkedColumn
			updateLinked.run ((theLinked === undefined) ? null : JSON.stringify (theLinked), theId);
			scriptCache.delete (theId);
			rowCache.clear (); //the cached row carries the linked column too
			},
		linkedCodeForId: function (theId) {
			const theRow = selectLinked.get (theId);
			if ((theRow === undefined) || (theRow.linked === undefined) || (theRow.linked === null)) {
				return (undefined);
				}
			try {
				return (JSON.parse (theRow.linked));
				}
			catch (err) {
				return (undefined);
				}
			},
		idForPath: function (theParts) { //9/10/26 by CC -- the row id under the names, or undefined
			var theId = idRoot;
			var flFound = true;
			theParts.forEach (function (thePart) {
				if (!flFound) {
					return;
					}
				const theRow = childRow (theId, thePart);
				if (theRow === undefined) {
					flFound = false;
					return;
					}
				theId = theRow.id;
				});
			return (flFound ? theId : undefined);
			},
		checkForOutsideChanges: function () {
			const theVersion = readDataVersion ();
			if (theVersion === lastDataVersion) {
				return (false);
				}
			lastDataVersion = theVersion;
			structureGeneration++; //9/13/26 by CC -- another connection may have changed the shape
			rowCache.clear ();
			proxyCache.clear ();
			scriptCache.clear ();
			return (true);
			},
		close: function () {
			theDatabase.close ();
			},
		countRows: function () {
			return (theDatabase.prepare ("select count (*) as ct from odb;").get ().ct);
			}
		});
	}

exports.buildDatabase = buildDatabase;
exports.installTree = installTree; //8/11/26 by CC -- one subtree into a database that already exists
exports.openDatabase = openDatabase;
