/*  Evaluate a UserTalk AST from parse.js. Semantics from the kernel's
	langevaluate.c: an object-database tree is the global namespace,
	locals live in frames, handlers close over their defining frames,
	identifier lookup is case-insensitive everywhere.
	
	by CC, 7/27/26 */

const dates = require ("./dates.js"); //8/13/26 by CC -- Frontier's date-and-time text forms, shared with verbs.js

/*  8/19/26 by CC -- LONGS AND DOUBLES, because Frontier's `/` is not
	JavaScript's. dividevalue in the kernel's langvalue.c divides on the coerced
	common type, so two longs divide as C longs -- 2330 / 1024 is 2, not
	2.275390625. His own scripts are written for it and say so: string.kBytes
	bumps the result when the truncation lost something, and string.percent
	writes `100.0 * (double (numerator) / denominator)` because double () is how
	you ask for a fraction. DW found it: "string.megabyteString should be
	rounding the number of k or mb."
	
	A double is a boxed JavaScript Number -- new Number (x). Everything that
	coerces (Number (), String (), arithmetic in the verb library) keeps working
	without knowing, and the evaluator can tell the two apart when it matters.  */

function flDoubleValue (theValue) {
	return (theValue instanceof Number);
	}

/*  8/26/26 by CC -- a char is the other boxed scalar, built on DW's
	go-ahead. charvalue.js carries the box; the special cases below are the
	kernel's own (addvalue, coercionweight in langvalue.c): two chars add
	into a two-character string, a char with a number stays a char with
	byte arithmetic, and a char beside a string coerces to the string.  */

const charvalue = require ("./charvalue.js");
const flCharValue = charvalue.flCharValue;
const makeChar = charvalue.makeChar;

function makeDouble (theNumber) {
	return (new Number (theNumber));
	}

function plainNumber (theValue) { //a double or a long, as an ordinary JavaScript number
	return (flDoubleValue (theValue) ? theValue.valueOf () : theValue);
	}

function flWholeNumber (theValue) { //a long: an ordinary number with nothing after the decimal point
	return ((typeof theValue === "number") && Number.isInteger (theValue));
	}

function numberForArithmetic (theValue) { //8/19/26 by CC -- a date used as a number counts seconds since 1904, the way number () does
	if (theValue instanceof Date) {
		return (dates.frontierSecondsFromDate (theValue));
		}
	return (theValue);
	}

function flTableValue (theValue) { //8/18/26 by CC -- a table, as opposed to a scalar or an external (outline, script, menubar, wptext, address, binary)

	if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
		return (false);
		}
	if (theValue instanceof Number) { //8/19/26 by CC -- a double is a boxed Number, not a table
		return (false);
		}
	if (flCharValue (theValue)) { //8/26/26 by CC -- a char is a boxed scalar too
		return (false);
		}
	if (theValue.flOdbSqlTable === true) { //one of the database's own
		return (true);
		}
	return ((theValue.flOdbScript === undefined) && (theValue.flOdbMenubar === undefined) && (theValue.flWpText === undefined) &&
		(theValue.flOdbAddressText === undefined) && (theValue.flAddress !== true) && (theValue.type === undefined) &&
		(!Array.isArray (theValue)) && (!(theValue instanceof Date)));
	}

function addressPartText (theName) { //9/6/26 by CC -- the text of one name in an address: a plain identifier as is, anything else in brackets and quotes, the way the kernel writes roots.["frontier.root"]; a numeric part is already "[3]" and stays
	const theText = String (theName);
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test (theText) || (theText.indexOf ("[") === 0)) {
		return (theText);
		}
	return ("[\"" + theText + "\"]");
	}

function makeEnvironment (theOdb, theVerbs, theTrace) {
	
	const environment = {
		odb: theOdb, //a plain object tree standing in for the ODB
		verbs: theVerbs, //lowercase dotted verb name -> function (args, environment)
		trace: theTrace, //every verb call gets logged here
		frames: [], //the local-variable stack; each frame is {vars: {}}
		withPaths: [], //active with-statement prefixes, innermost last
		scriptAddresses: [], //8/10/26 by CC -- the address of each running script, innermost last; this reads the top
		compiledScripts: new Map () //8/17/26 by CC -- a script's compiled form, by the row it lives in; kept until the row's modified date moves
		};
	installEnvironmentTable (theOdb);
	return (environment);
	}

function installEnvironmentTable (theOdb) {
	/*  7/27/26 by CC -- system.environment is kernel-populated machine
		facts. We claim to be none of the classic platforms, so scripts
		skip Mac text conversion and Windows path fixups.  */
	if (theOdb.system === undefined) {
		theOdb.system = {};
		}
	if (findKey (theOdb.system, "environment") === undefined) {
		theOdb.system.environment = {
			isMac: false,
			isWindows: false,
			isUnix: true,
			isRadio: false,
			isFrontier: true,
			isPike: false
			};
		}
	if (findKey (theOdb.system, "temp") === undefined) {

		/*  9/4/26 by CC -- EMPTY, the way the kernel makes it. It was made with
			a Frontier table inside, and the 2012 startupScript's first
			test is "if defined (system.temp.Frontier) return" -- only run
			the startup once -- so on the FIRST boot of a root that has no
			system.temp (the 2012 opml.root has none) the startup returned
			five verbs in and nothing was initialized: no menus, no daemons,
			no first run. The second boot found the table emptied and ran.
			DW's fresh install of 9/4 was that first boot.  */

		theOdb.system.temp = {};
		}
	}

	/*  8/24/26 by CC -- THE TYPE CONSTANTS ARE THE KERNEL'S FOUR-CHARACTER
		CODES now, from the typeinfo table in langops.c: scriptType is
		'scpt', tableType is 'tabl'. They had been long names of our own
		("scripttype"), which leaked everywhere typeOf's answer was written
		down -- a fat page's objectType directive said
		application/x-frontier-menubartype where Frontier writes -mbar, and
		Berkeley refused the import because eleven characters can't be a
		string4. DW's teaching: scriptType is the NAME of a constant, and
		scpt is the TYPE of script objects. typeOf and the constants move
		together, so every case typeOf (x) in every script keeps comparing
		true. Note 'fss ' and 'obj ' really end in a space -- string4s pad.  */

const languageConstants = {
	nil: undefined,
	tabletype: "tabl", outlinetype: "optx", scripttype: "scpt",
	wptexttype: "wptx", binarytype: "data", stringtype: "TEXT",
	booleantype: "bool", datetype: "date", numbertype: "long",
	longtype: "long", inttype: "shor", doubletype: "doub",
	listtype: "list", recordtype: "reco", addresstype: "addr",
	unknowntype: "????",
	menubartype: "mbar", picttype: "pict", filespectype: "fss ",
	codetype: "code", rgbtype: "cRGB", pointtype: "QDpt",
	recttype: "qdrt", chartype: "char", patterntype: "tptn",
	fixedtype: "fixd", singletype: "sing", objspectype: "obj ",
	cr: "\r", lf: "\n", tab: "\t", space: " ", //the character constants
	up: "up", down: "down", left: "left", right: "right",
	flatup: "flatup", flatdown: "flatdown",
	pageup: "pageup", pagedown: "pagedown", firstlist: "firstlist", lastlist: "lastlist"
	};

function sortedTableKeys (theTable) {
	/*  7/27/26 by CC -- Frontier tables are always sorted by name,
		case-insensitive, so "#prefs" comes before "default" and nth-entry
		access sees that order. JS objects remember insertion order, so
		every positional walk sorts first.  */
	if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
		return ([]); //not a table: no entries to walk, the way an empty table behaves
		}
	const keys = Object.keys (theTable);
	keys.sort (function (a, b) {
		const lowerA = a.toLowerCase (), lowerB = b.toLowerCase ();
		if (lowerA < lowerB) {
			return (-1);
			}
		if (lowerA > lowerB) {
			return (1);
			}
		return (0);
		});
	return (keys);
	}

const lowercaseIndexes = new WeakMap (); //9/13/26 by CC -- plain object -> {ctKeys, byLower}; see the miss scan in findKey

function findKey (theTable, theName) { //case-insensitive key lookup, returns the real key or undefined
	if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
		return (undefined); //nothing to look in
		}
	if (theTable [theName] !== undefined) {
		return (theName);
		}
	
	/*  8/4/26 by CC -- a database table looks its children up by lowername, so
		the access above was ALREADY case-insensitive and there is nothing a
		scan could find that it missed. Asking "in" costs one query; enumerating
		cost one per entry, and it ran on every miss -- 7.2 million queries in a
		single sallysReader build, which was all of the build's 25 seconds.  */
	
	if (theTable.flOdbSqlTable === true) {
		if (theName in theTable) { //an entry that holds no value: present, but undefined on read
			return (theName);
			}
		return (undefined);
		}
	
	/*  9/13/26 by CC -- THE MISS SCAN IS INDEXED. A name not in a frame's
		locals was found by lowercasing every key in that frame -- and every
		name a handler uses that lives further out (the outer locals, a verb
		group, a table) missed in every frame on the way, which was 14% of a
		JSON.compile run after the afternoon's caches. A plain object keeps a
		lowercase-to-key index here, rebuilt when its key count changes; the
		exact-case hit above still costs nothing.  */

	const lower = theName.toLowerCase ();
	const theKeys = Object.keys (theTable);
	var theIndex = lowercaseIndexes.get (theTable);
	if ((theIndex === undefined) || (theIndex.ctKeys !== theKeys.length)) {
		theIndex = {ctKeys: theKeys.length, byLower: {}};
		theKeys.forEach (function (key) {
			if (theIndex.byLower [key.toLowerCase ()] === undefined) {
				theIndex.byLower [key.toLowerCase ()] = key;
				}
			});
		lowercaseIndexes.set (theTable, theIndex);
		}
	const indexed = theIndex.byLower [lower];
	if ((indexed !== undefined) && (theTable [indexed] !== undefined)) {
		return (indexed);
		}
	var found;
	Object.keys (theTable).forEach (function (key) {
		if ((found === undefined) && (key.toLowerCase () === lower)) {
			found = key;
			}
		});
	return (found);
	}

//control-flow signals travel as exceptions

function BreakSignal () {
	this.flBreakSignal = true;
	}

function ContinueSignal () {
	this.flContinueSignal = true;
	}

function ReturnSignal (theValue) {
	this.flReturnSignal = true;
	this.value = theValue;
	}

/*  9/13/26 by CC -- THE EVALUATOR IS BUILT ONCE PER ENVIRONMENT. Everything
	below -- some sixty functions: name lookup, the paths search, the call
	machinery, the statement loop -- used to be created afresh on every call
	of evaluate, and evaluate is re-entered for every handler body a script
	runs (runBody). The profile after the two caches of the afternoon still
	showed 8% of a JSON.compile run in that setup, plus the garbage it made.
	Now makeEvaluator builds the closures once and hangs the statement runner
	on the environment; evaluate below is the wrapper every caller still
	calls. Nothing in here kept per-call state except lastValue, which lives
	in the runner now.  */

function makeEvaluator (environment) {
	
	/*  Run a statement list. Returns the value of the last expression
		statement, the way Frontier scripts return their last value.  */
	
	
	//references: a {get, set} pair for anything assignable
	
	/*  8/20/26 by CC -- flNeedTable is what the kernel does when a name is
		the first component of a dotted address. langgetdotparams resolves it
		with langgettableval, which takes a TABLE and nothing else, while a
		bare name goes through langtablelookup and takes whatever it finds.
		The two are not the same search, and the difference is load-bearing:
		system.verbs.globals.string is the script behind string (), and it
		comes before system.verbs.builtins.string on his paths table -- so
		without this, string.replaceAll asks a script for its replaceAll.  */
	
	function flNameOwnedByGuest (theName) { //9/26/26 by CC -- a top-level name some installed Tool brought in: system.compiler.files, each record's names; cached while the database's shape holds still
		try {
			const theGeneration = environment.odb.odbGeneration;
			if ((environment.guestNamesMemo === undefined) || (environment.guestNamesMemo.generation !== theGeneration) || (theGeneration === undefined)) {
				const theNames = {};
				const systemKey = findKey (environment.odb, "system");
				const systemTable = (systemKey === undefined) ? undefined : environment.odb [systemKey];
				const compilerKey = (systemTable === undefined) ? undefined : findKey (systemTable, "compiler");
				const compilerTable = (compilerKey === undefined) ? undefined : systemTable [compilerKey];
				const filesKey = (compilerTable === undefined) ? undefined : findKey (compilerTable, "files");
				const filesTable = (filesKey === undefined) ? undefined : compilerTable [filesKey];
				if ((filesTable !== undefined) && (filesTable !== null) && (typeof filesTable === "object")) {
					Reflect.ownKeys (filesTable).forEach (function (theKey) {
						if (typeof theKey !== "string") {
							return;
							}
						const theRecord = filesTable [theKey];
						if ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && Array.isArray (theRecord.names)) {
							theRecord.names.forEach (function (theOwnedName) {
								theNames [String (theOwnedName).toLowerCase ()] = true;
								});
							}
						});
					}
				environment.guestNamesMemo = {generation: theGeneration, names: theNames};
				}
			return (environment.guestNamesMemo.names [String (theName).toLowerCase ()] === true);
			}
		catch (err) {
			return (false);
			}
		}

	function guestRecordForFilePath (theName) { //a path ending in .root whose file name is a guest the scanner installed (a record with a path) or the build mounted (a record with an adr); the record, or undefined
		if ((typeof theName !== "string") || !theName.toLowerCase ().endsWith (".root") || ((theName.indexOf (":") === -1) && (theName.indexOf ("/") === -1))) {
			return (undefined);
			}
		const theFileName = theName.split (/[:\/]/).pop ();
		try {
			const systemTable = environment.odb [findKey (environment.odb, "system")];
			const compilerTable = systemTable [findKey (systemTable, "compiler")];
			const filesTable = compilerTable [findKey (compilerTable, "files")];
			const theKey = findKey (filesTable, theFileName);
			if (theKey === undefined) {
				return (undefined);
				}
			const theRecord = filesTable [theKey];
			if ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && ((theRecord.path !== undefined) || ((theRecord.adr !== undefined) && (String (theRecord.adr).length > 0)))) {
				return (theRecord);
				}
			return (undefined);
			}
		catch (err) {
			return (undefined);
			}
		}
	
	environment.guestRootForFilePath = function (theName) { //9/10/26 by CC -- for the text-to-address coercion (verbs.js addressFromText): a first name that is a database's file path answers that guest's root table -- a table named by the exact path if one is open, else the installed or mounted guest by file name (see guestRecordForFilePath); undefined when it is neither
		if ((typeof theName !== "string") || !theName.toLowerCase ().endsWith (".root") || ((theName.indexOf (":") === -1) && (theName.indexOf ("/") === -1))) {
			return (undefined);
			}
		const theReference = referenceForId (theName);
		if (theReference === undefined) {
			return (undefined);
			}
		try {
			return (theReference.get ());
			}
		catch (err) {
			return (undefined);
			}
		};

	function referenceForId (theName, flNeedTable) {
		
		function referenceInWithTable (withTable) { //the name in one of a with's tables, or undefined
			if ((withTable === undefined) || (withTable === null) || (typeof withTable !== "object")) {
				return (undefined); //a with over a missing table scopes nothing
				}
			const key = findKey (withTable, theName);
			if ((key !== undefined) && ((flNeedTable !== true) || flPlainTableValue (withTable [key]))) { //9/29/26 by CC -- the same rule inside a with
				return ({
					container: withTable,
					key: key,
					get: function () {
						return (withTable [key]);
						},
					set: function (theValue) {
						withTable [key] = theValue;
						}
					});
				}
			return (undefined);
			}

		/*  10/4/26 by CC -- THE CHAIN IS WALKED ONE LEVEL AT A TIME, the kernel's
			langfindsymbol (langops.c): a level's own symbols, then the with
			values that level carries, then the next level out. A with is a
			level of its own here (the "with" case below pushes a frame holding
			its tables), so a name inside a with finds the with's table before
			a local declared outside the with. Until tonight every frame came
			before every with table, which is half of colinf's report on
			helloFrontier issue 5 -- see testLocalsLiveInTheirBlock.  */

		var ixFrame;
		for (ixFrame = environment.frames.length - 1; ixFrame >= 0; ixFrame--) {
			const theFrame = environment.frames [ixFrame];
			const vars = theFrame.vars;
			const key = findKey (vars, theName);
			if ((key !== undefined) && ((flNeedTable !== true) || flPlainTableValue (vars [key]))) { //9/29/26 by CC -- the first name of a dotted address must be a TABLE here too: langgetdotparams resolves it with langexternalgettable, which is langgetsymbolval then tablevaltotable, so a local of that name holding anything else is passed over and the paths are searched. Add Link's script declares local (source = "", html, start, end) and then calls html.menu.setTagCase -- DW's 9/28 report
				return ({
					container: vars,
					key: key,
					get: function () {
						return (vars [key]);
						},
					set: function (theValue) {
						vars [key] = theValue;
						},
					remove: function () {
						delete vars [key];
						}
					});
				}
			if (theFrame.withTables !== undefined) {
				var ixTable, theWithReference;
				for (ixTable = 0; ixTable < theFrame.withTables.length; ixTable++) { //in the order written: "with a, b" searches a and then b
					theWithReference = referenceInWithTable (theFrame.withTables [ixTable]);
					if (theWithReference !== undefined) {
						return (theWithReference);
						}
					}
				}
			}

		var ixWith; //the tables pushed from outside the language -- the macro processor's scopes, callScript's table, a responder's -- come after every frame, as before
		for (ixWith = environment.withPaths.length - 1; ixWith >= 0; ixWith--) {
			const theOuterReference = referenceInWithTable (environment.withPaths [ixWith]);
			if (theOuterReference !== undefined) {
				return (theOuterReference);
				}
			}
		
		/*  10/6/26 by CC -- exports IS ALWAYS THERE, the way node hands every
			module an empty exports object. A script that says exports.greet =
			greet finds the table in its outermost frame -- the module's, the
			window's run, the one-liner's -- made on first use. DW's find on
			0.4.104: calling a package by its own name ran the module and
			"Can't get the value of exports because there is no object with
			that name."  */

		if ((theName.toLowerCase () === "exports") && (environment.frames.length > 0)) {
			const theModuleFrame = environment.frames [0];
			if (theModuleFrame.vars.exports === undefined) {
				theModuleFrame.vars.exports = {};
				}
			return ({
				container: theModuleFrame.vars,
				key: "exports",
				get: function () {
					return (theModuleFrame.vars.exports);
					},
				set: function (theValue) {
					theModuleFrame.vars.exports = theValue;
					}
				});
			}

		const odbKey = findKey (environment.odb, theName);
		var guestOwnedReference; //9/26/26 by CC -- a Tool's name at the top of the database: found only after the paths, see below
		if (odbKey !== undefined) {
			const theRootReference = {
				container: environment.odb,
				key: odbKey,
				get: function () {
					return (environment.odb [odbKey]);
					},
				set: function (theValue) {
					environment.odb [odbKey] = theValue;
					},
				remove: function () {
					delete environment.odb [odbKey];
					}
				};

			/*  9/26/26 by CC -- A GUEST DATABASE'S NAMES COME AFTER THE PATHS.
				langsearchpathlookup (langvalue.c): the local chain, the root,
				the tables system.paths names, and only then the open files
				(langsearchpathvisit's last stop, filewindowtable). In this
				world a Tool's top-level tables are installed at the top of the
				database, so they were found with the root, ahead of the paths:
				docserver.root open as a Tool has a table named clock, and
				clock.timeStamp became docserver's page for it -- DW's 9/26
				report, "Can't tokenize the line #title ...". A name a guest
				brought in (system.compiler.files, the record's names) is
				passed over here and answered after the paths miss.  */

			if (flNameOwnedByGuest (theName)) {
				guestOwnedReference = theRootReference;
				}
			else {
				return (theRootReference);
				}
			}
		
		/*  9/3/26 by CC -- A FILE PATH NAMES AN OPEN GUEST DATABASE, the
			kernel's last stop in langsearchpathlookup: langtablelookup
			(filewindowtable, bs) -- the table of open files, keyed by each
			file's path, holding each guest's root table. Scripts write it
			as ["Macintosh HD:...:Tools:nodeEditor.root"].nodeEditorSuite.menu
			(user.menus.nodeedit in DW's database is exactly that). In this
			world a Tools root's names are installed at the top of the
			database and system.compiler.files remembers the file by name
			(trigger.js, scanTheToolsFolder), so a path whose file name is
			an installed root answers the database's own root table; the
			rest of the address finds the guest's names there.  */
		
		const guestRecord = guestRecordForFilePath (theName);
		if (guestRecord !== undefined) {
			return ({
				container: undefined,
				key: theName,
				get: function () {
					if ((guestRecord.adr !== undefined) && (String (guestRecord.adr).length > 0)) {

						/*  9/10/26 by CC -- A GUEST MOUNTED AT AN ADDRESS (config.root at
							root.config since the 8/9 build): the guest's ROOT table has
							one entry, named by the mount's last name -- config.root's root
							holds config, and THAT is what makeVirginRoot put at
							root.config. So ["...:config.root"].config.nodeEditor is
							config.nodeEditor, the form Frontier on Berkeley wrote into the
							part DW imported on 9/10. Until tonight the path answered
							root.config itself, so .config under it was nothing, and the
							import made a stray database named by the path. The guest's
							root is a table of that one entry.  */

						var current = environment.odb;
						const theParts = String (guestRecord.adr).split (".");
						theParts.forEach (function (thePart) {
							const theKey = (current === undefined) ? undefined : findKey (current, thePart);
							current = (theKey === undefined) ? undefined : current [theKey];
							});
						if (current === undefined) {
							return (undefined);
							}
						const theGuestRoot = {};
						theGuestRoot [theParts [theParts.length - 1]] = current;
						return (theGuestRoot);
						}
					return (environment.odb);
					},
				set: function (theValue) {
					const message = "Can't set the value of " + theName + " because it names an open database.";
					throw new Error (message);
					}
				});
			}

		/*  10/4/26 by CC -- THE ROOT'S OWN FILE NAMES THE ROOT TABLE. The
			kernel files every open database in filewindowtable under its
			path, the main root too (cancoonwindow.c and cancoon.c call
			langexternalregisterwindow on the root variable), so
			["Macintosh HD:...:frontier.root"] is the root table and
			["...:frontier.root"].workspace is workspace. window.frontmost
			answers exactly that for the root's window (setwinvalue), and
			table.getCursorAddress asks typeOf of what it points to -- the
			first thing Add Bookmark does (misc/addBookmarkFix.md).  */

		if ((typeof theName === "string") && theName.toLowerCase ().endsWith (".root") && (theName.indexOf (":") !== -1)) {
			var theRootFilePath;
			try {
				theRootFilePath = String (environment.verbs ["frontier.getfilepath"] ([], environment));
				}
			catch (err) {
				}
			if ((theRootFilePath !== undefined) && (theRootFilePath.toLowerCase () === theName.toLowerCase ())) {
				return ({
					container: undefined,
					key: theName,
					get: function () {
						return (environment.odb);
						},
					set: function (theValue) {
						const message = "Can't set the value of " + theName + " because it names an open database.";
						throw new Error (message);
						}
					});
				}
			}

		/*  8/8/26 by CC -- temp means system.temp, the way the paths table
			says so in Frontier. Resolving it here instead of copying it into
			the root (which is what the old boot-time write did) keeps the two
			names on the SAME table -- through the SQL proxy the copy was a
			separate subtree, so temp.x and system.temp.x silently diverged.
			A real root entry named temp, in an already-built database, still
			wins above.  */
		
		if (theName.toLowerCase () === "temp") {
			const systemKey = findKey (environment.odb, "system");
			if (systemKey !== undefined) {
				const systemTable = environment.odb [systemKey];
				const tempKey = findKey (systemTable, "temp");
				if (tempKey !== undefined) {
					return ({
						container: systemTable,
						key: tempKey,
						get: function () {
							return (systemTable [tempKey]);
							},
						set: function (theValue) {
							systemTable [tempKey] = theValue;
							},
						remove: function () {
							delete systemTable [tempKey];
							}
						});
					}
				}
			}
		
		/*  8/8/26 by CC -- the language constants resolve here, after the
			database and before the paths fallback -- the same precedence they
			had when installConstants wrote them into the root. Resolving at
			lookup time keeps the ~50 constants out of every database the
			evaluator touches; they were persisting as real rows in any SQL
			odb the first time a script ran. Assigning to a constant's name
			creates a real root entry, which wins from then on.  */
		
		/*  8/10/26 by CC -- this is the address of the script that's running,
			the way Frontier answers it, so edit (this), parentOf (this^) and
			frontier.tools.updateMe (this) all reach the script's own place in
			the database. It was a constant answering nil until now.  */
		
		if (theName.toLowerCase () === "this") {
			return ({
				get: function () {
					const theAddresses = environment.scriptAddresses;
					const theAddress = (theAddresses.length === 0) ? undefined : theAddresses [theAddresses.length - 1];
					if (theAddress === undefined) {
						const message = "Can't use this because the running script has no address in the database.";
						throw new Error (message);
						}
					return (theAddress);
					},
				set: function (theValue) {
					const message = "Can't assign to this because it names the running script.";
					throw new Error (message);
					},
				remove: function () {
					}
				});
			}
		
		const constantKey = findKey (languageConstants, theName);
		if (constantKey !== undefined) {
			return ({
				get: function () {
					return (languageConstants [constantKey]);
					},
				set: function (theValue) {
					environment.odb [theName] = theValue;
					},
				remove: function () {
					}
				});
			}
		
		/*  7/27/26 by CC -- the system.paths fallback: a name that resolves
			nowhere else is looked up the way Frontier's paths table works,
			so string.upper finds system.verbs.builtins.string.upper and
			manilaSuite finds a suite wherever the loaded roots put it.  */
		
		/*  9/13/26 by CC -- WHICH TABLE ANSWERED IS REMEMBERED. A name that
			reaches the paths asked each of the fourteen tables in turn on
			every lookup -- string, xml, op, a thousand times a run. The
			answer (the table and the key, or a miss) is kept on the
			environment for as long as the database's shape holds still
			(odbGeneration, the same rule as the paths table list above): a
			row added, removed, renamed or moved starts the memo over, so a
			name that gains an earlier home in the search order is found
			there. A value written in place doesn't move a name.  */

		function pathsReferenceFor (pathsTable, key) {
			return ({
				get: function () {
					return (pathsTable [key]);
					},
				set: function (theValue) {
					pathsTable [key] = theValue;
					},
				remove: function () {
					delete pathsTable [key];
					}
				});
			}
		const theGeneration = environment.odb.odbGeneration;
		const memoKey = theName.toLowerCase () + ((flNeedTable === true) ? "\t1" : "\t0");
		if (theGeneration !== undefined) {
			if ((environment.pathsMemo === undefined) || (environment.pathsMemo.generation !== theGeneration)) {
				environment.pathsMemo = {generation: theGeneration, byKey: {}};
				}
			const remembered = environment.pathsMemo.byKey [memoKey];
			if (remembered === false) {
				return (undefined);
				}
			if (remembered !== undefined) {
				return (pathsReferenceFor (remembered.table, remembered.key));
				}
			}
		var found, foundTable, foundKey;
		pathsTablesForOdb (environment.odb).forEach (function (pathsTable) {
			if (found === undefined) {
				const key = findKey (pathsTable, theName);
				if ((key !== undefined) && ((flNeedTable !== true) || flPlainTableValue (pathsTable [key]))) {
					found = pathsReferenceFor (pathsTable, key);
					foundTable = pathsTable;
					foundKey = key;
					}
				}
			});

		/*  9/21/26 by CC -- AND THEN THE ROOT TABLE OF EVERY OPEN DATABASE FILE.
			langsearchpathvisit in langvalue.c, after the tables system.paths
			names: "5.1b21 dmb: handle guest databases via filewindowtable" --
			each open file's root table is visited the same way. It is how a
			Manila site kept in a guest database answers to its bare name: the
			site tree mainResponder walks holds address="benchSiteManilaWebsite"
			and nothing else. A Tool's names were found here already (they are
			at the top of this database); a database opened or made while
			running -- a table at the top named by its file path -- was never
			looked in, and a new site's home page came back as nothing. In
			name order, the way the kernel walks filewindowtable.  */

		if ((found === undefined) && (guestOwnedReference !== undefined)) { //9/26/26 by CC -- the Tool's name, now that the paths have missed
			if (theGeneration !== undefined) {
				environment.pathsMemo.byKey [memoKey] = {table: environment.odb, key: guestOwnedReference.key};
				}
			return (guestOwnedReference);
			}
		if (found === undefined) {
			const theGuestKeys = [];
			Reflect.ownKeys (environment.odb).forEach (function (theKey) {
				if ((typeof theKey === "string") && ((theKey.indexOf (":") !== -1) || (theKey.indexOf ("/") === 0))) {
					theGuestKeys.push (theKey);
					}
				});
			theGuestKeys.sort (function (keyA, keyB) {
				const lowerA = keyA.toLowerCase (), lowerB = keyB.toLowerCase ();
				return ((lowerA < lowerB) ? -1 : ((lowerA > lowerB) ? 1 : 0));
				});
			theGuestKeys.forEach (function (theGuestKey) {
				if (found !== undefined) {
					return;
					}
				const theGuestRoot = environment.odb [theGuestKey];
				if ((theGuestRoot === undefined) || (theGuestRoot === null) || (typeof theGuestRoot !== "object") || !flPlainTableValue (theGuestRoot)) {
					return;
					}
				const key = findKey (theGuestRoot, theName);
				if ((key !== undefined) && ((flNeedTable !== true) || flPlainTableValue (theGuestRoot [key]))) {
					found = pathsReferenceFor (theGuestRoot, key);
					foundTable = theGuestRoot;
					foundKey = key;
					}
				});
			}
		if (theGeneration !== undefined) {
			environment.pathsMemo.byKey [memoKey] = (found === undefined) ? false : {table: foundTable, key: foundKey};
			}
		if (found !== undefined) {
			return (found);
			}
		
		return (undefined);
		}
	
	/*  8/20/26 by CC -- the search path comes from system.paths, which is
		a table of addresses like any other, read in name order the way
		Frontier reads it. A database with no system.paths of its own falls
		back on the list written into the function, which is his.  */
	
	function addressTextsForPaths (theOdb) {
		const theTexts = [];
		const systemKey = findKey (theOdb, "system");
		if (systemKey !== undefined) {
			const systemTable = theOdb [systemKey];
			if ((systemTable !== undefined) && (systemTable !== null) && (typeof systemTable === "object")) {
				const pathsKey = findKey (systemTable, "paths");
				if (pathsKey !== undefined) {
					const pathsTable = systemTable [pathsKey];
					if ((pathsTable !== undefined) && (pathsTable !== null) && (typeof pathsTable === "object")) {
						const theNames = Object.keys (pathsTable);
						theNames.sort ();
						theNames.forEach (function (theName) {
							const theValue = pathsTable [theName];
							if ((theValue !== undefined) && (theValue !== null) && (typeof theValue === "object")) {
								const theText = (theValue.path === undefined) ? theValue.pathText : theValue.path;
								if (theText !== undefined) {
									theTexts.push (theText);
									}
								}
							});
						}
					}
				}
			}
		if (theTexts.length === 0) {
			
			/*  8/20/26 by CC -- DW's own paths table, in his order, read out
				of his database on 8/20 and written down here so a database
				that has no system.paths of its own still searches the way
				Frontier does.  */
			
			return ([
				"system.verbs.globals",
				"system.macintosh.globals",
				"system.verbs.builtins",
				"system.compiler.kernel.lang",
				"system.macintosh",
				"system.compiler.kernel",
				"system.verbs.constants",
				"system.macintosh.constants",
				"root.suites",
				"system.verbs.apps",
				"root.system",
				"system.extensions",
				"system.verbs.colors",
				"system.compiler.files"
				]);
			}
		return (theTexts);
		}
	
	/*  8/20/26 by CC -- an address in his paths table is written the way he
		writes any address: root.suites names the root, and a name that
		isn't a plain identifier wears brackets and quotes, as in
		system.compiler.["kernel"].lang. Both forms have to come apart into
		names before anything can be walked.  */
	
	function partsForAddressText (addressText) {
		const theParts = [];
		addressText.split (".").forEach (function (part) {
			var theName = part;
			if ((theName.indexOf ("[") === 0) && (theName.lastIndexOf ("]") === (theName.length - 1))) {
				theName = theName.substring (1, theName.length - 1);
				if (((theName.indexOf ("\"") === 0) || (theName.indexOf ("'") === 0)) && (theName.length > 1)) {
					theName = theName.substring (1, theName.length - 1);
					}
				}
			theParts.push (theName);
			});
		if ((theParts.length > 1) && (theParts [0].toLowerCase () === "root")) {
			theParts.shift ();
			}
		return (theParts);
		}
	
	/*  8/20/26 by CC -- the kernel's own tables, at system.compiler.kernel.
		Frontier builds these at startup and never writes them to disk:
		langstartup's newfunctionprocessor makes one table per verb group
		inside internaltable.kernel, and DW's paths table names
		system.compiler.["kernel"].lang at 04 and system.compiler.["kernel"]
		at 06. That is how a kernel verb with no glue script -- setTimeCreated,
		sizeOf, the whole lang group -- is found at all.
		
		They are built here from the verb library, the same way, and they are
		NOT written into the database. What is still missing is what a person
		sees on 2-clicking one: these are functions, not scripts, and there is
		no object to open. That question is DW's.  */
	
	/*  9/13/26 by CC -- built once PER ENVIRONMENT, not per evaluate call.
		The cache lived in this closure, and evaluate is re-entered for every
		handler body (runBody), so JSON.compile's 12,000 inner-handler calls
		each rebuilt the 467-verb table: a third of the run's time.  */

	function kernelTablesForVerbs () {
		if (environment.kernelTables !== undefined) {
			return (environment.kernelTables);
			}
		const kernelTables = {};
		environment.kernelTables = kernelTables;
		Object.keys (environment.verbs).forEach (function (verbName) {
			const ixDot = verbName.indexOf (".");
			const groupName = (ixDot === -1) ? "lang" : verbName.substring (0, ixDot);
			const shortName = (ixDot === -1) ? verbName : verbName.substring (ixDot + 1);
			if (kernelTables [groupName] === undefined) {
				kernelTables [groupName] = {};
				}
			kernelTables [groupName] [shortName] = environment.verbs [verbName];
			});
		return (kernelTables);
		}
	
	/*  9/5/26 by CC -- system.compiler.kernel IS AN ADDRESS A SCRIPT CAN READ.
		The tables above were reachable only through the paths search, so
		defined (system.compiler.["kernel"].crypt) -- how DW's 2009 crypto
		extension asks whether the kernel has crypto built in (isKernelized)
		-- answered false, and every hash went looking for a PowerPC DLL. In
		Frontier the kernel table is a real table in memory under
		system.compiler; here, reading the name kernel in the odb's
		system.compiler table, where no row of that name exists, answers the
		same tables the search uses. Read-only: nothing writes it.  */

	function kernelHomeFor (container, theName) {
		if (String (theName).toLowerCase () !== "kernel") {
			return (undefined);
			}
		var compilerTable;
		try {
			compilerTable = environment.odb.system.compiler;
			}
		catch (err) {
			return (undefined);
			}
		if ((compilerTable === undefined) || (compilerTable === null) || (typeof compilerTable !== "object") || (container === undefined) || (container === null)) {
			return (undefined);
			}
		if ((container === compilerTable) || ((container.odbId !== undefined) && (container.odbId === compilerTable.odbId))) {
			return (kernelTablesForVerbs ());
			}
		return (undefined);
		}

	function kernelTableForAddressText (addressText) { //the two forms his paths table uses
		const theText = partsForAddressText (addressText).join (".").toLowerCase ();
		if (theText === "system.compiler.kernel") {
			return (kernelTablesForVerbs ());
			}
		if (theText.indexOf ("system.compiler.kernel.") === 0) {
			return (kernelTablesForVerbs () [theText.substring ("system.compiler.kernel.".length)]);
			}
		return (undefined);
		}
	
	function flPlainTableValue (theValue) { //a table, as opposed to a script or a scalar that happens to be an object
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
			return (false);
			}
		return ((theValue.flOdbScript === undefined) && (theValue.flOdbMenubar === undefined) && (theValue.flWpText === undefined) &&
			(theValue.flOdbAddressText === undefined) && (theValue.flAddress !== true) && (theValue.type === undefined) &&
			(!Array.isArray (theValue)) && (!(theValue instanceof Date)));
		}
	
	/*  8/23/26 by CC -- string.parseAddress needs this too. It walks from the
		root and only the root, so a name that lives in a paths table answers
		nothing the moment it arrives as TEXT rather than as @name. Three
		failures on 8/23 were that one gap: the backup command, which converts
		whatever window.frontmost () names; the jump command, whose cmd2Click
		tests defined (name^); and a window opened on a short name, which on
		8/21 saved itself back to the root and made a table called op there.
		The verb library can't see into this closure, so the lookup is handed
		out on the environment.  */

	if (environment.pathsTablesForOdb === undefined) {
		environment.pathsTablesForOdb = pathsTablesForOdb;
		}

	function pathsTablesForOdb (theOdb) { //the tables system.paths searches, in Frontier's order

		/*  9/13/26 by CC -- the list is kept on the environment for as long
			as the database's shape holds still (odbGeneration, odbSql.js):
			a row added, removed, renamed or moved rebuilds it; a scalar
			written in place does not. Before this it was walked afresh on
			every name that reached the paths -- fourteen addresses, three
			names each -- which with the kernel-table rebuild above was most
			of JSON.compile's 1.1 seconds on a 5K file. An in-memory odb (no
			generation) is walked every time, as before.  */

		const theGeneration = theOdb.odbGeneration;
		if ((theGeneration !== undefined) && (environment.pathsTablesCache !== undefined) && (environment.pathsTablesCache.odb === theOdb) && (environment.pathsTablesCache.generation === theGeneration)) {
			return (environment.pathsTablesCache.tables);
			}

		const tables = [];
		const addressTexts = addressTextsForPaths (theOdb);
		addressTexts.forEach (function (addressText) {
			var current = theOdb;
			partsForAddressText (addressText).forEach (function (part) {
				if ((current !== undefined) && (current !== null) && (typeof current === "object")) {
					const key = findKey (current, part);
					current = (key === undefined) ? undefined : current [key];
					}
				else {
					current = undefined;
					}
				});
			if (current === undefined) { //nothing in the database -- the kernel's own tables live only in memory, the way Frontier builds them
				current = kernelTableForAddressText (addressText);
				}
			if ((current !== undefined) && (current !== null) && (typeof current === "object") && (current.flOdbScript === undefined)) {
				tables.push (current);
				}
			});
		if (theGeneration !== undefined) {
			environment.pathsTablesCache = {odb: theOdb, generation: theGeneration, tables: tables};
			}
		return (tables);
		}
	
	/*  8/20/26 by CC -- the value to the left of a dot has to be a table, so
		a bare name there is resolved asking for one.  */
	
	function containerForDotLeft (theNode) {
		if (theNode.op === "id") {
			if (theNode.name.toLowerCase () === "root") {

				/*  8/29/26 by CC -- the special table, langgetdotparams'
					FIRST check: "translate root to roottable". root.suites
					names the table at the top of the database, wherever the
					script runs -- the virgin startupScript's
					buildSuitesSubmenu reads @root.suites and it resolved
					nowhere here.  */

				return (environment.odb);
				}
			const reference = referenceForId (theNode.name, true);
			if (reference !== undefined) {
				return (reference.get ());
				}
			}
		return (evalExpr (theNode));
		}
	
	function nameForRecordKey (theNode) { //8/21/26 by CC -- a record's key is a name, not a value to look up
		if (theNode.op === "id") {
			return (theNode.name);
			}
		if (theNode.op === "const") {
			return (String (theNode.value));
			}
		return (String (evalExpr (theNode)));
		}
	
	function referenceForNode (theNode) {
		
		switch (theNode.op) {
			
			case "id": {
				const existing = referenceForId (theNode.name);
				if (existing !== undefined) {
					return (existing);
					}
				/*  8/21/26 by CC -- AN UNDECLARED NAME IS A LOCAL, not a new
					object at the root. The kernel's langsearchpathlookup ends
					"if (*htable == nil) *htable = currenthashtable" with the
					comment "undeclared variables assumed to be local" -- the
					innermost local table, which is the running script's frame.
					
					Writing them to the root instead is how DW's database came
					to hold s, t, filetext, opmltext, whenstart, origcursor and
					origwindow beside system and user. Two of those are our own
					runSelection's locals. Any one of them shadows a real name
					the moment it collides, which is the shape of the outage on
					8/21. His opml.root on Berkeley has seven entries after
					decades of use, which is the proof this is what Frontier
					does.  */
				
				const theFrame = environment.frames [environment.frames.length - 1];
				return ({
					container: theFrame.vars,
					key: theNode.name,
					get: function () {
						const message = "Can't get the value of " + theNode.name + " because there is no object with that name.";
						throw new Error (message);
						},
					set: function (theValue) {
						theFrame.vars [theNode.name] = theValue;
						},
					remove: function () {
						delete theFrame.vars [theNode.name];
						}
					});
				}
			
			case "computedid": {
				const name = evalExpr (theNode.expr);
				return (referenceForNode ({op: "id", name: String (name)}));
				}
			
			case "dot": {
				const container = containerForDotLeft (theNode.left);
				if ((container === undefined) || (container === null) || (typeof container !== "object")) {
					const message = "Can't access " + theNode.name + " because the value before the dot isn't a table.";
					throw new Error (message);
					}
				var key = findKey (container, theNode.name);
				if (key === undefined) {
					key = theNode.name;
					}
				const keyFinal = key;
				return ({
					container: container, //8/21/26 by CC -- so a caller can ask where the object really is, not where the script wrote it
					key: keyFinal,
					get: function () {
						
						/*  8/16/26 by CC -- reading a missing entry THROWS, the kernel's
							behavior. DW found the divergence: uploadScripts reads the
							project glossary's flS3Upload inside a try; the glossary is
							empty, the kernel throws, the try eats it and the local keeps
							its default -- here the read answered undefined, boolean made
							it false, and the S3 upload silently never ran.  */
						
						const liveKey = findKey (container, theNode.name);
						if (liveKey === undefined) {
							const kernelHome = kernelHomeFor (container, theNode.name); //9/5/26 by CC -- system.compiler.kernel, the kernel's own table
							if (kernelHome !== undefined) {
								return (kernelHome);
								}
							const message = "Can't get the value of " + theNode.name + " because there is no object with that name.";
							throw new Error (message);
							}
						return (container [liveKey]);
						},
					set: function (theValue) {
						container [keyFinal] = theValue;
						},
					remove: function () {
						delete container [keyFinal];
						}
					});
				}
			
			case "index": {
				const container = evalExpr (theNode.left);
				const index = evalExpr (theNode.index);
				
				/*  8/22/26 by CC -- .[name] IS A NAME IN A TABLE, NOT A
					SUBSCRIPT. The kernel keeps them apart: x [n] is arrayop,
					x.[name] is dotop over bracketop, and dotop resolves its
					left side to a hash table or raises nosuchtableerror --
					langgetdotparams in langvalue.c.
					
					Both forms parse to the same node here, and the string
					branch below ran without looking at which one it was, so
					DW's user.prefs.tmpfolder.["workspace.tests.fttb"] read
					character NaN of the folder path and answered "m". A wrong
					answer with no error is the worst kind.  */
				
				if ((theNode.flComputedName === true) && (typeof container === "string")) {
					const message = "Can't get \"" + String (index) + "\" because " + pathTextForNode (theNode.left) + " is a string, not a table.";
					throw new Error (message);
					}
				
				if (typeof container === "string") { //7/27/26 by CC -- s [3] is the third character, 1-based
					return ({
						get: function () {
							
							/*  8/19/26 by CC -- past the end is an ERROR, DW's
								ruling ("you have to match frontier"). The
								kernel's getvalidstringindex raises
								arrayindexerror below 1 or past the end; this
								answered the empty string, which is how a
								mistake stayed quiet.  */
							
							if ((index < 1) || (index > container.length)) {
								const message = "Can't get character " + index + " of \"" + container + "\" because the string is " + container.length + ((container.length === 1) ? " character long." : " characters long.");
								throw new Error (message);
								}
							return (makeChar (container.charCodeAt (index - 1))); //9/14/26 by CC -- a CHAR, the kernel's stringarrayvalue (langvalue.c: setcharvalue of the byte). It answered a one-character string, so number (s [i]) was nothing and DW's xml.entityEncode wrote &#NaN; into the codecasting feed for every curly quote.
							},
						set: function (theValue) {
							const message = "Can't assign into a character of a string this way because the string was copied when it was read.";
							throw new Error (message);
							}
						});
					}
				if ((container !== undefined) && (container !== null) && (container.type === "binary") && (typeof container.data === "string")) {

					/*  9/26/26 by CC -- b [i] ON A BINARY IS THE i-TH BYTE, AS A
						NUMBER. The kernel's parsearrayreference (langvalue.c) runs
						stringarrayvalue on a binary -- getvalidstringindex counts
						from the first byte after the four-byte type -- and then
						coercetoint, so the byte comes back as an int, not a char.
						Here a binary fell through to the table branch, and
						html.getGifHeightWidth's f^ [9] on docserver.root's logo said
						"Can't get item 9 of the table because there are only 4
						items." -- the macro error at the top of the page.  */

					const theBytes = container.data;
					return ({
						get: function () {
							if ((index < 1) || (index > theBytes.length)) {
								const message = "Can't get byte " + index + " of the binary because it is " + theBytes.length + ((theBytes.length === 1) ? " byte long." : " bytes long.");
								throw new Error (message);
								}
							return (theBytes.charCodeAt (index - 1) & 255);
							},
						set: function (theValue) {
							const message = "Can't assign into a byte of a binary this way because the binary was copied when it was read.";
							throw new Error (message);
							}
						});
					}
				if (Array.isArray (container)) {
					return ({
						get: function () {
							return (container [index - 1]); //Frontier lists are 1-based
							},
						set: function (theValue) {
							container [index - 1] = theValue;
							}
						});
					}
				if ((container !== undefined) && (typeof container === "object")) {
					if ((typeof index === "number") && (theNode.flComputedName !== true)) { //bare subscript: nth entry, in Frontier's sorted order
						const keys = sortedTableKeys (container);
						var keyAt = keys [index - 1];
						const flNthExists = (keyAt !== undefined); //8/16/26 by CC -- reading past the last entry throws, the kernel's behavior; the name fallback is for writes
						if (keyAt === undefined) {
							keyAt = String (index); //writing the nth entry of a table that doesn't have one yet: the number becomes the name
							}
						return ({
							get: function () {
								if (!flNthExists) {
									const message = "Can't get item " + index + " of the table because there are only " + keys.length + " items.";
									throw new Error (message);
									}
								return (container [keyAt]);
								},
							set: function (theValue) {
								container [keyAt] = theValue;
								},
							remove: function () {
								delete container [keyAt];
								}
							});
						}
					var key = findKey (container, String (index));
					if (key === undefined) {
						key = String (index);
						}
					const keyFinal = key;
					return ({
						get: function () {
							const liveKey = findKey (container, String (index)); //8/16/26 by CC -- missing entry throws, same as the dot path
							if (liveKey === undefined) {
								const kernelHome = kernelHomeFor (container, String (index)); //9/5/26 by CC -- system.compiler.["kernel"], the form his scripts write
								if (kernelHome !== undefined) {
									return (kernelHome);
									}
								const message = "Can't get the value of " + String (index) + " because there is no object with that name.";
								throw new Error (message);
								}
							return (container [liveKey]);
							},
						set: function (theValue) {
							container [keyFinal] = theValue;
							},
						remove: function () {
							delete container [keyFinal];
							}
						});
					}
				const message = "Can't subscript the value because it isn't a list or a table.";
				throw new Error (message);
				}
			
			case "deref": {
				const address = evalExpr (theNode.expr);
				return (referenceForAddress (address));
				}
			
			default: {
				const message = "Can't assign into a " + theNode.op + " expression.";
				throw new Error (message);
				}
			}
		}
	
	function addressFromValue (theValue) { //9/6/26 by CC -- the runtime address for a value that is one: a stored address ({flOdbAddressText, path}) is parsed back; anything else passes through untouched
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbAddressText === true)) {
			return (environment.verbs ["lang.address"] ([String (theValue.path)], environment));
			}
		return (theValue);
		}
	
	function referenceForAddress (theAddress) {
		if (typeof theAddress === "string") { //8/11/26 by CC -- Frontier coerces a string on deref: "user.prefs"^ walks the path. cmd2click leans on it: defined (name^) where name arrived as a string
			theAddress = environment.verbs ["lang.address"] ([theAddress], environment);
			}

		/*  8/23/26 by CC -- AN ADDRESS THAT WENT INTO THE DATABASE AND CAME
			BACK. Storage writes it as its path text and hands it back as
			{flOdbAddressText, path} -- a marker nothing treated as an
			address, so adr^ failed, typeOf said tabletype and string ()
			said [object Object]. That is what stops fatPages.buildPageAtts,
			which keeps adrobject in a page table and dereferences it, so
			nothing could be EXPORTED even once pack existed.  */

		theAddress = addressFromValue (theAddress);
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't dereference the value because it isn't an address.";
			throw new Error (message);
			}
		return (theAddress.reference);
		}
	
	function lazyAddressForNode (theNode) {
		
		/*  7/27/26 by CC -- build a path-shaped address without touching the
			database: a base plus name parts. Computed parts ([expr]) evaluate
			now; the walk to the value happens each time the address is used.
			Returns undefined when the expression isn't a path shape, and the
			caller falls back to an eager reference.  */
		
		const parts = [];
		var node = theNode;
		
		while ((node.op === "dot") || (node.op === "index")) {
			if (node.op === "dot") {
				parts.unshift (node.name);
				node = node.left;
				}
			else {
				const indexValue = evalExpr (node.index);
				if ((typeof indexValue === "number") && (node.flComputedName !== true)) {
					parts.unshift ({flNth: indexValue}); //bare subscript: nth entry, resolved against the sorted table when the walk reaches it
					}
				else {
					parts.unshift (String (indexValue));
					}
				node = node.left;
				}
			}
		
		var resolveBase;
		var baseText;
		if (node.op === "computedid") {
			/*  [f].site -- the base name computes now (usually a database's
				full path); the walk from it stays lazy. The path text keeps
				the bracket form so it can be parsed back.  */
			const computedName = String (evalExpr (node.expr));
			baseText = bracketedNameText (computedName); //9/8/26 by CC -- quoted the kernel's way; it was [name] with no quotes
			resolveBase = function () {
				const reference = referenceForId (computedName);
				if (reference === undefined) {
					return (undefined);
					}
				return (reference.get ());
				};
			}
		else {
			if (node.op === "id") {
				/*  The base binds to its CELL now, at address time -- an
					address handed to another script keeps pointing at the
					caller's local, the way an objspec does. Only a base that
					doesn't exist yet falls back to by-name lookup at use.  */
				const baseName = node.name;
				baseText = baseName;
				if (baseName.toLowerCase () === "root") { //8/29/26 by CC -- the special table, langgetspecialtable: @root.suites walks from the top of the database
					resolveBase = function () {
						return (environment.odb);
						};
					}
				else {
					/*  9/14/26 by CC -- THE BASE OF A DOTTED ADDRESS IS A TABLE. The
						kernel's langgetdotparams resolves the first name with
						langgettableval, which takes a table and nothing else (the
						8/20 note on flNeedTable). This lazy address took whatever
						the name found first, so @string.addressToString bound
						string to system.verbs.globals.string -- the SCRIPT behind
						string () -- and the walk to addressToString found nothing:
						defined (@string.addressToString^) was false, and a hidden
						target set to that address (DW's 9/14 report, the example
						macro on a short name) read as no target. A base with names
						after it wants a table now; a bare @name still takes what
						it finds.  */

					const boundReference = referenceForId (baseName, parts.length > 0);
					resolveBase = function (flCreate) {
						var reference = boundReference;
						if (reference === undefined) {
							reference = referenceForId (baseName, parts.length > 0); //9/14/26 by CC -- see above
							}
						if (reference === undefined) {
							return (undefined);
							}
						var value;
						try {
							value = reference.get ();
							}
						catch (err) { //8/17/26 by CC -- a base that doesn't exist is not created; the kernel doesn't
							return (undefined);
							}
						return (value);
						};
					}
				}
			else {
				if (node.op === "deref") {
					/*  @adr^.x -- chase the inner address now, walk from its
						target lazily. When the chain is broken (@pta^.newsSite^.y
						with no newsSite), the address still gets built -- it
						answers undefined on get, and errors on use, not on
						construction, the way Frontier objspecs behave.  */
					var innerAddress;
					try {
						innerAddress = evalExpr (node.expr);
						}
					catch (err) {
						innerAddress = undefined;
						}
					innerAddress = addressFromValue (innerAddress); /*  9/6/26 by CC -- AN ADDRESS THAT CAME BACK OUT OF THE
						DATABASE IS A BASE TOO. Frontier.openDataFile keeps the data file's address in
						system.temp.frontier.datafiles and answers THAT on every call after the first, so
						rssCodeUpdateSuite.init got {flOdbAddressText, path}, and @adrdata^.roots built
						an address with no base: "Can't set the value at (deref).roots because one of
						the tables on the way doesn't exist." DW, 9/6, the afternoon the first part was
						to go out. referenceForAddress already took the stored form on deref; this is
						the same conversion at the other place a deref is chased.  */
					baseText = "(deref)";
					if ((innerAddress !== undefined) && (innerAddress !== null) && (innerAddress.flAddress === true)) {
						baseText = innerAddress.pathText;
						}
					resolveBase = function () {
						if ((innerAddress === undefined) || (innerAddress === null) || (innerAddress.flAddress !== true)) {
							return (undefined);
							}
						return (innerAddress.reference.get ());
						};
					}
				else {
					return (undefined);
					}
				}
			}
		
		if (parts.length === 0) {
			return (undefined); //@name alone: the eager reference already has the right meaning
			}
		
		function keyForPart (theContainer, thePart, flCreate) {
			/*  A part is a name, or {flNth} for a numeric subscript, which
				resolves against the table in Frontier's sorted order.  */
			if ((thePart !== null) && (typeof thePart === "object") && (thePart.flNth !== undefined)) {
				const key = sortedTableKeys (theContainer) [thePart.flNth - 1];
				if (key === undefined) {
					return (flCreate ? String (thePart.flNth) : undefined);
					}
				return (key);
				}
			var key = findKey (theContainer, thePart);
			if ((key === undefined) && flCreate) {
				key = thePart;
				}
			return (key);
			}
		
		function partText (thePart) {
			if ((thePart !== null) && (typeof thePart === "object") && (thePart.flNth !== undefined)) {
				return ("[" + thePart.flNth + "]");
				}
			return (String (thePart));
			}
		
		function walkToParent (flCreate) { //the table holding the last part, or undefined
		
			/*  8/17/26 by CC -- ASSIGNING THROUGH AN ADDRESS NO LONGER BUILDS
				THE TABLES ON THE WAY. DW: "the new command does not create
				intermediate tables... you don't create tables automatically
				like that." His one-liner `new (tabletype,
				@config.worldOutline.macros)` only worked here because of this
				divergence, and a typo in the middle of a long address quietly
				made a table with the typo's name instead of failing.
				
				The last name still comes into being when you assign to it --
				that IS how you make an entry in Frontier. It's the PARENTS on
				the way that must already exist.  */
			
			var current = resolveBase (flCreate);
			var ixPart;
			for (ixPart = 0; ixPart < parts.length - 1; ixPart++) {
				if ((current === undefined) || (current === null) || (typeof current !== "object")) {
					return (undefined);
					}
				const key = keyForPart (current, parts [ixPart], false);
				if (key === undefined) {
					return (undefined);
					}
				if ((current [key] === undefined) || (current [key] === null) || (typeof current [key] !== "object")) {
					return (undefined);
					}
				current = current [key];
				}
			return (current);
			}
		
		const lastPart = parts [parts.length - 1];
		
		function lastKeyIn (theParent, flCreate) {
			return (keyForPart (theParent, lastPart, flCreate));
			}
		
		const reference = {
			get: function () {
				
				/*  8/16/26 by CC -- reading through an address whose path doesn't
					reach a value THROWS, the same as the dot path does now: one
					read, two spellings, one behavior. defined () catches this and
					answers false; assignment still builds the path.  */
				
				const parent = walkToParent (false);
				if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
					const message = "Can't get the value of " + partText (lastPart) + " because there is no object with that name.";
					throw new Error (message);
					}
				const key = lastKeyIn (parent, false);
				if (key === undefined) {
					const message = "Can't get the value of " + partText (lastPart) + " because there is no object with that name.";
					throw new Error (message);
					}
				return (parent [key]);
				},
			set: function (theValue) {
				const parent = walkToParent (true);
				if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
					const message = "Can't set the value at " + pathText + " because one of the tables on the way doesn't exist.";
					throw new Error (message);
					}
				parent [lastKeyIn (parent, true)] = theValue;
				},
			remove: function () {
				const parent = walkToParent (false);
				if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
					return;
					}
				const key = lastKeyIn (parent, false);
				if (key !== undefined) {
					delete parent [key];
					}
				},
			
			/*  8/21/26 by CC -- the table the last name actually lives in, and
				the name in it. The path TEXT is what the script wrote, which
				for @op.xmlToOutline is "op.xmlToOutline" even though the name
				was found in system.verbs.builtins.op. Anything that has to
				name the object's real place -- a window that will save back to
				it -- asks here instead of trusting the text. The walk is done
				on demand, not at construction, so building an address stays as
				cheap as it was.  */
			
			place: function () {
				const parent = walkToParent (false);
				if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
					return (undefined);
					}
				const key = lastKeyIn (parent, false);
				if (key === undefined) {
					return (undefined);
					}
				return ({container: parent, key});
				}
			};
		
		/*  The path as text: nth parts read their real entry name when the
			table is reachable now, so nameOf answers the name, not a number.  */
		const textParts = [];
		var probe = resolveBase ();
		parts.forEach (function (part) {
			var text = partText (part);
			if ((probe !== undefined) && (probe !== null) && (typeof probe === "object")) {
				const key = keyForPart (probe, part, false);
				if (key !== undefined) {
					text = key;
					probe = probe [key];
					}
				else {
					probe = undefined;
					}
				}
			else {
				probe = undefined;
				}
			textParts.push (text);
			});
		
		/*  9/6/26 by CC -- A NAME THAT ISN'T A PLAIN IDENTIFIER KEEPS ITS BRACKETS
			IN THE TEXT. @adrdata^.roots.["frontier.root"] read back as
			"...roots.frontier.root", so string () of the address, nameOf, and the
			window that opens on it all saw two names where there was one; the
			kernel writes roots.["frontier.root"], the form string.parseAddress
			reads. The bare name is kept for nameText below. A numeric part is
			already "[3]" and stays that way.  */
		
		const quotedParts = [];
		textParts.forEach (function (text) {
			quotedParts.push (addressPartText (text));
			});
		var pathText = baseText + "." + quotedParts.join (".");
		
		/*  8/5/26 by CC -- the address remembers its own last component. Splitting
			pathText on dots can't recover it: a computed part resolves to the real
			entry name, and Manila's membership tables are named by email address,
			so users.["dave@example.com"] would answer "com".  */
		var nameText = textParts [textParts.length - 1];
		
		return ({reference, pathText, nameText});
		}
	
	//expressions
	
	function flListsEqual (left, right) {
		/*  7/28/26 by CC -- lists compare by value, not by identity: the
			corpus is full of "if theList == {}" as an emptiness test, and
			comparing two JS arrays by reference makes that always false.  */
		if (!Array.isArray (left) || !Array.isArray (right)) {
			return (false); //a list is never equal to a non-list
			}
		if (left.length !== right.length) {
			return (false);
			}
		var flSame = true;
		left.forEach (function (item, ixItem) {
			if (!flSame) {
				return;
				}
			const other = right [ixItem];
			if (Array.isArray (item) || Array.isArray (other)) {
				flSame = flListsEqual (item, other);
				}
			else {
				const pair = coerceForCompare (item, other);
				if (pair.left != pair.right) {
					flSame = false;
					}
				}
			});
		return (flSame);
		}
	
	function addressPathText (theValue) { //8/5/26 by CC -- the path an address stands for, or undefined when it isn't one
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {

			/*  9/21/26 by CC -- THE PLACE, NOT THE TEXT IT WAS MADE FROM. The kernel
				compares two addresses by table and name, so one object reached two
				ways is one address. Here the text decided, and the text depends on
				the route: mainResponder.members.checkMembership finds the member
				inside "with adrMembers^" as @users.[mailaddress] -- the text is
				users.["dave@userland.com"] -- and manilaSuite.custody.
				isCheckedOutByUser reaches the same table by its whole path; they
				compared unequal, and the member who pressed Edit This Page was told
				someone else was editing. When the address leads to a table in the
				database, the table's own row says where it is.  */

			if (environment.odbPathForId !== undefined) {
				try {
					const theTarget = theValue.reference.get ();
					if ((theTarget !== undefined) && (theTarget !== null) && (typeof theTarget === "object") && (theTarget.odbId !== undefined)) {
						const theOwnPath = environment.odbPathForId (theTarget.odbId);
						if ((typeof theOwnPath === "string") && (theOwnPath.length > 0)) {
							return (theOwnPath);
							}
						}
					}
				catch (err) {
					}
				}
			return (String (theValue.pathText));
			}
		return (undefined);
		}
	
	function stringForCompare (theValue) { //9/12/26 by CC -- the string verb's coercion: an address is its path, a script its text; the rest as before
		if ((theValue !== undefined) && (theValue !== null) && (typeof theValue === "object") && ((theValue.flAddress === true) || (theValue.flOdbScript === true))) {
			return (String (environment.verbs ["string"] ([theValue], environment)));
			}
		return (String (theValue));
		}

	function coerceForCompare (left, right) {

		/*  8/26/26 by CC -- chars compare by their codes (equalvalues,
			langvalue.c), and a char beside a string coerces to the string
			(coercionweight: string 10, char 3). Unwrapped here because two
			boxes would otherwise compare as object references and never be
			equal.  */

		/*  9/25/26 by CC -- NIL COMPARES AS THE OTHER SIDE'S TYPE. EQvalue
			(langvalue.c) runs coercetypes first, and a nil coerces to
			anything: to the empty string, to 0, to false (coercetostring,
			coercetolong, coercetoboolean on novaluetype). So nil == "" is
			true in Frontier, and html.refGlossary's walk up the hierarchy --
			"newNomad = parentOf (nomad^); if newNomad == "" break" -- ends at
			the top, where parentOf answers nil. Here nil == "" was false, and
			every quoted glossary lookup that missed looped forever.  */

		const flLeftNil = (left === undefined) || (left === null);
		const flRightNil = (right === undefined) || (right === null);
		if (flLeftNil && flRightNil) {
			return ({left: 0, right: 0});
			}
		if (flLeftNil || flRightNil) {
			const other = flLeftNil ? right : left;
			var nilAs;
			if (typeof other === "string") {
				nilAs = "";
				}
			else if (typeof other === "number") {
				nilAs = 0;
				}
			else if (typeof other === "boolean") {
				nilAs = false;
				}
			else if (other instanceof Date) {
				return (flLeftNil ? {left: 0, right: other.getTime ()} : {left: other.getTime (), right: 0});
				}
			else if (flCharValue (other)) {
				nilAs = 0;
				return (flLeftNil ? {left: nilAs, right: Number (other)} : {left: Number (other), right: nilAs});
				}
			else {
				const otherPath = addressPathText (other);
				nilAs = "";
				if (otherPath !== undefined) {
					return (flLeftNil ? {left: "", right: otherPath.toLowerCase ()} : {left: otherPath.toLowerCase (), right: ""});
					}
				return (flLeftNil ? {left: "", right: String (other)} : {left: String (other), right: ""});
				}
			return (flLeftNil ? {left: nilAs, right: other} : {left: other, right: nilAs});
			}

		if (flCharValue (left) || flCharValue (right)) {
			if ((typeof left === "string") || (typeof right === "string")) {
				return ({left: String (left).toLowerCase (), right: String (right).toLowerCase ()});
				}
			return ({left: Number (left), right: Number (right)});
			}
		
		/*  An address compares by the path it names, the way Frontier compares
			objspecs -- two addresses built separately for the same place are
			equal. Comparing them as JS objects made every such test false, and
			Manila leans on it: getCanonicalSiteName asks whether an entry in
			config.manila.sites is this site, and answered no for the site it
			was standing in.  */
		const leftPath = addressPathText (left);
		const rightPath = addressPathText (right);
		if ((leftPath !== undefined) || (rightPath !== undefined)) {
			const leftText = (leftPath === undefined) ? String (left) : leftPath;
			const rightText = (rightPath === undefined) ? String (right) : rightPath;
			return ({left: leftText.toLowerCase (), right: rightText.toLowerCase ()});
			}
		
		/*  9/6/26 by CC -- DATES, the kernel's way (coercetypes, langvalue.c,
			by coercionweight: string 10, date 4, long 3). A date beside a
			string becomes its text and the two compare as strings; a number
			beside a date becomes a date (seconds since 1904); two dates
			compare by their instant -- two Date objects compared as objects
			were never equal. DW's watcher: whenLastUpdate > someText was
			false for the wrong reason (the reader's string bug, fixed
			tonight); this is what the kernel answers once the types are what
			they should be.  */

		if ((left instanceof Date) && (right instanceof Date)) {
			return ({left: left.getTime (), right: right.getTime ()});
			}
		if ((left instanceof Date) && (typeof right === "string")) {
			return ({left: dates.frontierDateToString (left).toLowerCase (), right: right.toLowerCase ()});
			}
		if ((typeof left === "string") && (right instanceof Date)) {
			return ({left: left.toLowerCase (), right: dates.frontierDateToString (right).toLowerCase ()});
			}
		if ((left instanceof Date) && (typeof right === "number")) {
			return ({left: left.getTime (), right: dates.dateFromFrontierSeconds (right).getTime ()});
			}
		if ((typeof left === "number") && (right instanceof Date)) {
			return ({left: dates.dateFromFrontierSeconds (left).getTime (), right: right.getTime ()});
			}
		
		if ((typeof left === "string") && (typeof right === "string")) { //Frontier string comparison is case-insensitive
			return ({left: left.toLowerCase (), right: right.toLowerCase ()});
			}
		return ({left, right});
		}
	
	function evalExpr (theNode) {
		
		switch (theNode.op) {
			
			case "const":
				return (theNode.value);
			
			case "list": {
				const items = [];
				theNode.items.forEach (function (item) {
					items.push (evalExpr (item));
					});
				return (items);
				}
			
			/*  8/21/26 by CC -- a record. Frontier's recordvaluetype, which its
				scripts use for named parameters:
				
					local (params = {"username":username, "password":string (password)})
				
				A bare name on the left of the colon IS the name -- it isn't
				looked up -- the way a quoted one is. Anything else is an
				expression that has to answer a name, which is how
				{methods.[method]:params} works in system.verbs.apps.amazon.call.
				The value is a table, so everything that walks a table walks
				this.  */
			
			case "record": {
				const theRecord = {};
				theNode.entries.forEach (function (theEntry) {
					theRecord [nameForRecordKey (theEntry.key)] = evalExpr (theEntry.value);
					});
				return (theRecord);
				}
			
			case "id": {
				/*  8/20/26 by CC -- the JavaScript verb table used to be
					consulted here when a name resolved nowhere. It isn't any
					more: the kernel's tables are on the paths table, where
					Frontier puts them, so a name either resolves or it
					doesn't exist.  */
				const reference = referenceForId (theNode.name);
				if (reference === undefined) {
					const message = "Can't get the value of " + theNode.name + " because there is no object with that name.";
					throw new Error (message);
					}
				return (reference.get ());
				}
			
			case "computedid":
				return (referenceForNode (theNode).get ());
			
			case "dot": {
				/*  8/20/26 by CC -- a dotted name is an address, and nothing
					else. It used to try the JavaScript verb table first, so
					file.copy answered a function that has no place in the
					database -- which is why string.replaceAll ran and could
					not be opened. The table is reached only through
					kernel (), from inside a glue script.  */
				return (referenceForNode (theNode).get ());
				}
			
			case "index":
				return (referenceForNode (theNode).get ());
			
			case "address": {
				/*  7/27/26 by CC -- an address is symbolic, the way Frontier
					treats it: taking @config.x.y never touches the database,
					and the path resolves each time the address is used. So
					@a.b.c is legal when b doesn't exist yet, defined (adr^)
					answers false, and assigning through the address creates
					the missing parent tables.  */
				const lazy = lazyAddressForNode (theNode.expr);
				if (lazy !== undefined) {
					return ({flAddress: true, reference: lazy.reference, pathText: lazy.pathText, nameText: lazy.nameText});
					}
				if ((theNode.expr.op === "id") && (theNode.expr.name.toLowerCase () === "root")) { //9/12/26 by CC -- @root alone: the special table (langgetspecialtable), so @root^ is the root and table.getRootAddress (@root) works; it looked root up as a name and found nothing (DW, 9/12, running rootUpdates.update (@root))
					return ({flAddress: true, pathText: "root", nameText: "root", reference: {
						get: function () {
							return (environment.odb);
							},
						set: function (theValue) {
							const message = "Can't set the value of root because the root table can't be replaced.";
							throw new Error (message);
							}
						}});
					}
				const reference = referenceForNode (theNode.expr);
				return ({flAddress: true, reference, pathText: pathTextForNode (theNode.expr)});
				}
			
			case "deref":
				return (referenceForAddress (evalExpr (theNode.expr)).get ());
			
			case "call":
				return (evalCall (theNode));

			case "new": //10/5/26 by CC -- new userlandSamples.socketClient (): an instance of a package
				return (evalNew (theNode));

			case "not":
				return (!flTrue (evalExpr (theNode.expr)));
			
			case "negate":
				return (-evalExpr (theNode.expr));
			
			case "preincrement": case "postincrement": {
				const reference = referenceForNode (theNode.expr);
				const oldValue = reference.get ();
				reference.set (oldValue + 1);
				return (theNode.op === "preincrement" ? oldValue + 1 : oldValue);
				}
			
			case "predecrement": case "postdecrement": {
				const reference = referenceForNode (theNode.expr);
				const oldValue = reference.get ();
				reference.set (oldValue - 1);
				return (theNode.op === "predecrement" ? oldValue - 1 : oldValue);
				}
			
			case "and":
				return (flTrue (evalExpr (theNode.left)) && flTrue (evalExpr (theNode.right)));
			
			case "or":
				return (flTrue (evalExpr (theNode.left)) || flTrue (evalExpr (theNode.right)));
			
			/*  8/19/26 by CC -- A DATE USED AS A NUMBER COUNTS SECONDS SINCE
				1904, wherever it happens. number (aDate) was corrected on
				8/17, but a date coerced by arithmetic still fell through to
				JavaScript, which counts milliseconds since 1970 -- so one
				expression could hold both. DW's own workspace.timing caught
				it: number (clock.now ()) - whenstart answered
				-1,783,287,083, which is exactly the distance between the two
				epochs. The pairs that Frontier defines on their own terms --
				date minus date answers seconds, date plus or minus a number
				shifts the date -- are untouched above; this is only for the
				cases that would otherwise coerce.  */
			
			case "add": {
				/*  8/13/26 by CC -- a date meeting a string becomes Frontier's
					date text, "8/13/2026; 11:14:22 AM", not JavaScript's --
					clock.timeStamp builds the short stamp exactly this way.  */
				/*  7/28/26 by CC -- an unset value adds as nothing: Frontier
					locals start empty, so s = s + "text" builds the string
					from the first line, and n = n + 1 counts from zero.  */
				var left = evalExpr (theNode.left), right = evalExpr (theNode.right);
				if (Array.isArray (left)) { //adding to a list appends: {1, 2} + 3 is {1, 2, 3}, and a list adds its items
					return (left.concat (Array.isArray (right) ? right : [right]));
					}
				if (Array.isArray (right)) {
					return ([left].concat (right));
					}
				if (flCharValue (left) || flCharValue (right)) { //8/26/26 by CC -- addvalue's char cases, langvalue.c
					if ((left === undefined) || (right === undefined)) { //an unset value adds as nothing, the novaluetype rule
						return (flCharValue (left) ? left : right);
						}
					if (flCharValue (left) && flCharValue (right)) { //"special case: adding two character together" -- a two-character string
						return (String (left) + String (right));
						}
					if ((typeof left === "string") || (typeof right === "string")) { //the string outweighs the char (coercionweight); concatenation
						return (String (left) + String (right));
						}
					if (flCharValue (left) && ((typeof right === "number") || (typeof right === "boolean"))) { //char plus number stays a char, byte arithmetic
						return (makeChar (left.valueOf () + Number (right)));
						}
					//a number on the left wins the tie the kernel's way: the char coerces to its code
					}
				if ((typeof left === "string") || (typeof right === "string")) { /*  9/6/26 by CC -- an address meeting a string
					coerces to its path (coercetostring, langvalue.c). table.getRootAddress's own error, "Can't get the root address of
					\"" + adr + "\"...", read [object Object] in place of the address, which hid what opmlEditor.init was
					failing on.  */
					if ((left !== undefined) && (left !== null) && ((left.flAddress === true) || (left.flOdbAddressText === true))) {
						left = (left.flAddress === true) ? String (left.pathText) : String (left.path);
						}
					if ((right !== undefined) && (right !== null) && ((right.flAddress === true) || (right.flOdbAddressText === true))) {
						right = (right.flAddress === true) ? String (right.pathText) : String (right.path);
						}
					}
				if ((left instanceof Date) && (typeof right === "number")) { //date arithmetic is in seconds
					return (new Date (left.getTime () + (right * 1000)));
					}
				if ((typeof left === "number") && (right instanceof Date)) {
					return (new Date (right.getTime () + (left * 1000)));
					}
				if ((left === undefined) || (right === undefined)) {
					const present = (left === undefined) ? right : left;
					if (typeof present === "string") {
						left = (left === undefined) ? "" : left;
						right = (right === undefined) ? "" : right;
						}
					else {
						if (typeof present === "number") {
							left = (left === undefined) ? 0 : left;
							right = (right === undefined) ? 0 : right;
							}
						}
					}
				if ((left instanceof Date) && (typeof right === "string")) {
					left = dates.frontierDateToString (left);
					}
				if ((typeof left === "string") && (right instanceof Date)) {
					right = dates.frontierDateToString (right);
					}
				if ((left !== undefined) && (left !== null) && (left.flFilespec === true)) { //10/3/26 by CC -- a filespec coerces to its path, the kernel's way; file.filteredCopy does newfolder = filespec (newfolder) and then newfolder + file.fileFromPath (f), which the 9/17 check below took for a table meeting a string, so every file.copy of a folder ended with "Can't coerce a table to a string." after the files were copied (DW's buildHelloFrontier, 10/3)
					left = left.path;
					}
				if ((right !== undefined) && (right !== null) && (right.flFilespec === true)) {
					right = right.path;
					}
				if (((typeof left === "string") && flTableValue (right)) || ((typeof right === "string") && flTableValue (left))) { //9/17/26 by CC -- a table meeting a string is an error in the kernel (langexternalcoercetostring: cantcoercetostringerror); ours wrote "[object Object]" into the string. Seen in betty.rpc.client's fault message, "returned error code [object Object]"
					const message = "Can't coerce a table to a string.";
					throw new Error (message);
					}
				return (left + right);
				}
			
			case "subtract": {
				var left = evalExpr (theNode.left), right = evalExpr (theNode.right);
				if (left instanceof Date) { //date arithmetic is in seconds: date - date answers seconds, date - seconds shifts
					if (right instanceof Date) {
						return ((left.getTime () - right.getTime ()) / 1000);
						}
					if (typeof right === "number") {
						return (new Date (left.getTime () - (right * 1000)));
						}
					}
				if ((typeof left === "number") && (right instanceof Date)) { //8/19/26 by CC -- a number minus a date: the date counts from 1904
					right = dates.frontierSecondsFromDate (right);
					}
				/*  8/22/26 by CC -- STRING MINUS STRING DELETES THE FIRST
					OCCURRENCE, wherever it is, and answers the left string
					unchanged when there is no match. It used to strip a
					suffix, which is not what Frontier does, so every one of
					DW's "s = s - firstField" idioms silently did nothing --
					fatPages.getPageAtts loops until the string empties, so
					the loop never ended and importing a fat file hung.
					
					subtractvalue in langvalue.c, the stringvaluetype case:
					searchhandle finds the bytes, pullfromhandle takes them
					out. searchhandle, not searchhandleunicase -- the match
					is case sensitive.  */
				
				if ((typeof left === "string") || (typeof right === "string")) {
					const leftString = String (left), rightString = String (right);
					const ixFound = leftString.indexOf (rightString);
					if (ixFound < 0) {
						return (leftString);
						}
					return (leftString.slice (0, ixFound) + leftString.slice (ixFound + rightString.length));
					}
				if (flCharValue (left) && ((flCharValue (right)) || (typeof right === "number") || (typeof right === "boolean"))) { //8/26/26 by CC -- the char keeps its type, byte arithmetic
					return (makeChar (left.valueOf () - Number (right)));
					}
				return (left - right);
				}
			
			case "multiply": {
				const leftValue = numberForArithmetic (evalExpr (theNode.left));
				const rightValue = numberForArithmetic (evalExpr (theNode.right));
				const theProduct = plainNumber (leftValue) * plainNumber (rightValue);
				if (flCharValue (leftValue)) { //8/26/26 by CC -- the first operand wins the coercion tie; a char stays a char
					return (makeChar (theProduct));
					}
				return ((flDoubleValue (leftValue) || flDoubleValue (rightValue)) ? makeDouble (theProduct) : theProduct);
				}
			
			case "divide": {
				
				/*  8/19/26 by CC -- the kernel's dividevalue: two longs divide
					as longs. A double on either side makes it a fraction, and
					the answer stays a double so it goes on behaving like one.  */
				
				var leftValue = numberForArithmetic (evalExpr (theNode.left));
				var rightValue = numberForArithmetic (evalExpr (theNode.right));
				const flCharAnswer = flCharValue (leftValue); //8/26/26 by CC -- the first operand wins the coercion tie
				if (flCharValue (leftValue)) { //chars divide as their codes, the way longs divide
					leftValue = leftValue.valueOf ();
					}
				if (flCharValue (rightValue)) {
					rightValue = rightValue.valueOf ();
					}
				if (flWholeNumber (leftValue) && flWholeNumber (rightValue)) {
					if (rightValue === 0) {
						const message = "Can't divide " + leftValue + " by zero.";
						throw new Error (message);
						}
					const theQuotient = Math.trunc (leftValue / rightValue);
					return (flCharAnswer ? makeChar (theQuotient) : theQuotient);
					}
				return (makeDouble (plainNumber (leftValue) / plainNumber (rightValue)));
				}
			
			case "mod":
				return (plainNumber (numberForArithmetic (evalExpr (theNode.left))) % plainNumber (numberForArithmetic (evalExpr (theNode.right))));
			
			case "eq": {
				const leftValue = evalExpr (theNode.left), rightValue = evalExpr (theNode.right);
				if (Array.isArray (leftValue) || Array.isArray (rightValue)) {
					return (flListsEqual (leftValue, rightValue));
					}
				const pair = coerceForCompare (leftValue, rightValue);
				return (pair.left == pair.right); //loose on purpose: Frontier coerces across types
				}
			
			case "ne": {
				const leftValue = evalExpr (theNode.left), rightValue = evalExpr (theNode.right);
				if (Array.isArray (leftValue) || Array.isArray (rightValue)) {
					return (!flListsEqual (leftValue, rightValue));
					}
				const pair = coerceForCompare (leftValue, rightValue);
				return (pair.left != pair.right);
				}
			
			case "lt": {
				const pair = coerceForCompare (evalExpr (theNode.left), evalExpr (theNode.right));
				return (pair.left < pair.right);
				}
			
			case "gt": {
				const pair = coerceForCompare (evalExpr (theNode.left), evalExpr (theNode.right));
				return (pair.left > pair.right);
				}
			
			case "le": {
				const pair = coerceForCompare (evalExpr (theNode.left), evalExpr (theNode.right));
				return (pair.left <= pair.right);
				}
			
			case "ge": {
				const pair = coerceForCompare (evalExpr (theNode.left), evalExpr (theNode.right));
				return (pair.left >= pair.right);
				}
			
			/*  9/12/26 by CC -- beginsWith, endsWith and contains coerce both sides
				to strings THE LANGUAGE'S WAY (stringcomparevalue in langvalue.c:
				coercetostring on each operand). String () in JavaScript turned an
				address into "[object Object]", so copyAddressCommand's test -- s
				beginsWith adr^, with adr^ a system.paths entry -- never matched
				(DW's 9/12 report on Copy Address).  */

			case "beginswith": {
				const pair = coerceForCompare (stringForCompare (evalExpr (theNode.left)), stringForCompare (evalExpr (theNode.right)));
				return (pair.left.startsWith (pair.right));
				}
			
			case "endswith": {
				const pair = coerceForCompare (stringForCompare (evalExpr (theNode.left)), stringForCompare (evalExpr (theNode.right)));
				return (pair.left.endsWith (pair.right));
				}
			
			case "contains": {
				const pair = coerceForCompare (stringForCompare (evalExpr (theNode.left)), stringForCompare (evalExpr (theNode.right)));
				return (pair.left.indexOf (pair.right) !== -1);
				}
			
			case "namedarg":
				return (evalExpr (theNode.value));
			
			default: {
				const message = "Can't evaluate the expression because the operator " + theNode.op + " isn't implemented.";
				throw new Error (message);
				}
			}
		}
	
	function flTrue (theValue) {
		if (flCharValue (theValue)) { //8/26/26 by CC -- coercetoboolean: a char is true unless its code is 0
			return (theValue.valueOf () !== 0);
			}
		return ((theValue !== false) && (theValue !== undefined) && (theValue !== 0) && (theValue !== ""));
		}
	
	function dottedNameForNode (theNode) { //x.y.z as a string, or undefined if it isn't a plain path
		if (theNode.op === "id") {
			return (theNode.name);
			}
		if (theNode.op === "dot") {
			const left = dottedNameForNode (theNode.left);
			if (left === undefined) {
				return (undefined);
				}
			return (left + "." + theNode.name);
			}
		return (undefined);
		}
	
	/*  9/21/26 by CC -- ASSIGNING A TABLE COPIES IT. In the kernel a table is a
		value like any other: x = aTable gives x a copy of its own. Here a table
		read out of the database is a live view of its rows, and a local that
		was assigned one WAS the database's table -- writing through the local
		wrote the database. mainResponder.respond opens every request with
		adrparamtable^.responderAttributes = config.mainresponder.globals and
		gathers the site's # attributes into it; each request left the site it
		served in config.mainResponder.globals for good, and after one page that
		needed a member every page of every site did. Found in the Manila work.
		An assignment INTO the database is left to the store, which reads the
		source out whole and knows a table being written onto itself.  */

	function tableValueForALocal (theValue) { //the value to keep in a local or a local table: a database table is copied, everything else is itself
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object") || (theValue.flOdbSqlTable !== true)) {
			return (theValue);
			}
		function copyTable (theTable) {
			const theCopy = {};
			Reflect.ownKeys (theTable).forEach (function (theKey) {
				if ((typeof theKey !== "string") || (theKey === "flOdbSqlTable") || (theKey === "odbId")) {
					return;
					}
				const theChild = theTable [theKey];
				if ((theChild !== undefined) && (theChild !== null) && (typeof theChild === "object") && (theChild.flOdbSqlTable === true)) {
					theCopy [theKey] = copyTable (theChild);
					}
				else {
					theCopy [theKey] = theChild;
					}
				});
			return (theCopy);
			}
		return (copyTable (theValue));
		}

	function flDatabaseReference (theReference) { //true when the place being assigned to is in the database
		try {
			var theContainer;
			if ((theReference !== undefined) && (theReference.place !== undefined)) {
				const thePlace = theReference.place ();
				theContainer = (thePlace === undefined) ? undefined : thePlace.container;
				}
			else if (theReference !== undefined) {
				theContainer = theReference.container;
				}
			return ((theContainer !== undefined) && (theContainer !== null) && (theContainer.flOdbSqlTable === true));
			}
		catch (err) {
			return (false);
			}
		}

	function parentPathText (thePathText) {

		/*  9/21/26 by CC -- the text of an address without its last name. Only a
			dot OUTSIDE brackets and quotes separates names: parentOf trimmed
			xmlRpcManilaWebsite.xml.["rss.xml"] at the dot inside the name and
			answered xmlRpcManilaWebsite.xml.["rss, a bracket that never
			closes -- which the address parser then walked forever, and the
			server died. A Manila site is full of such names.  */

		const theText = String (thePathText);
		var ixLastDot = -1, flInQuotes = false, depth = 0;
		for (var ixScan = 0; ixScan < theText.length; ixScan++) {
			const ch = theText.charAt (ixScan);
			if (flInQuotes) {
				if (ch === "\\") {
					ixScan++; //the escaped character
					}
				else if (ch === "\"") {
					flInQuotes = false;
					}
				}
			else if (ch === "\"") {
				flInQuotes = (depth > 0);
				}
			else if (ch === "[") {
				depth++;
				}
			else if (ch === "]") {
				depth--;
				}
			else if ((ch === ".") && (depth === 0)) {
				ixLastDot = ixScan;
				}
			}
		return ((ixLastDot === -1) ? "" : theText.slice (0, ixLastDot));
		}

	function bracketedNameText (theName) {

		/*  9/8/26 by CC -- a name in an address's text, the kernel's way
			(langexternalbracketname): an identifier stands as itself; anything
			else -- a file path, a name with a space or a dot -- goes in
			brackets, quoted, with backslashes and quotes escaped
			(langexternalquotename). So @["Macintosh HD:...:x.root"] reads
			back as ["Macintosh HD:...:x.root"], which string.parseAddress and
			address () both take. It answered "(computed)" before tonight.  */

		const theText = String (theName);
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test (theText)) {
			return (theText);
			}
		return ("[\"" + theText.replace (/\\/g, "\\\\").replace (/"/g, "\\\"") + "\"]");
		}
	
	function pathTextForNode (theNode) {
		if (theNode.op === "computedid") { //9/8/26 by CC -- @[expr] alone: its text is the bracketed name, not a placeholder
			return (bracketedNameText (evalExpr (theNode.expr)));
			}
		const dotted = dottedNameForNode (theNode);
		if (dotted !== undefined) {
			return (dotted);
			}
		return ("(computed)");
		}
	
	/*  8/18/26 by CC -- WHO WAS ASKING. When a verb is handed a table where it
		needs a scalar, the table names itself (the proxy in odbSql.js) and
		this adds the verb's name, so the whole sentence is ours. What used to
		land instead was JavaScript's own "Cannot convert object to primitive
		value" -- no verb named, no object named, and not our vocabulary: DW,
		8/18/26, "what you call primitive we call scalar." About a hundred
		places in the verb library coerce; they all come through here.  */
	
	function callTheVerb (theVerb, theName, theArgs) {
		try {
			return (theVerb (theArgs, environment));
			}
		catch (err) {
			if ((err.flTableAsScalar === true) && (err.flVerbNamed !== true)) {
				err.flVerbNamed = true;
				err.message = "Can't call " + theName + " because " + err.theTableName + " is a table, and " + theName + " needs a scalar there.";
				}
			throw err;
			}
		}
	
	function remoteCallFor (theNode) {

		/*  9/7/26 by CC -- THE REMOTE CALL, ["xmlrpc://host:port/RPC2"].a.b (params),
			the way the kernel does it (langxml.c, langisremotefunction and
			langremotefunctioncall): a dotted name led by a bracketed
			expression whose string value reads protocol://..., the procedure
			name rebuilt from the dots, the handler looked up at
			user.protocols.[protocol] and then Frontier.protocols.[protocol],
			and called with {server, procedureName, params} -- server being
			the whole url, which Frontier.protocols.xmlrpc splits itself. His
			rssCodeUpdate suite pings the cloud this way, and so does anything
			that ever called betty over the wire. Answers undefined when the
			call isn't this shape.  */

		const names = [];
		var node = theNode.fn;
		while (node.op === "dot") {
			names.unshift (node.name);
			node = node.left;
			}
		if ((node.op !== "computedid") || (names.length === 0)) {
			return (undefined);
			}
		var theUrl;
		try {
			theUrl = evalExpr (node.expr);
			}
		catch (err) {
			return (undefined);
			}
		if (typeof theUrl !== "string") {
			return (undefined);
			}
		const ixColon = theUrl.indexOf (":");
		if ((ixColon < 1) || (theUrl.slice (ixColon, ixColon + 3) !== "://") || (theUrl.length < ixColon + 6)) {
			return (undefined);
			}
		const theProtocol = theUrl.slice (0, ixColon);
		const procedureName = names.join (".");
		var theHandler;
		["user.protocols." + theProtocol, "Frontier.protocols." + theProtocol].forEach (function (thePath) {
			if (theHandler === undefined) {
				try {
					const theValue = environment.verbs ["lang.address"] ([thePath], environment).reference.get ();
					if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbScript === true)) {
						theHandler = {theValue, thePath};
						}
					}
				catch (err) {
					}
				}
			});
		if (theHandler === undefined) {
			const message = "Can't call " + procedureName + " because the protocol \"" + theProtocol + "\" isn't known -- there is no script at user.protocols." + theProtocol + " or Frontier.protocols." + theProtocol + ".";
			throw new Error (message);
			}
		const params = [];
		theNode.args.forEach (function (argNode) {
			params.push (evalExpr (argNode));
			});
		return ({theHandler, args: [theUrl, procedureName, params]});
		}

	function evalCall (theNode) {
		const theRemote = remoteCallFor (theNode); //9/7/26 by CC -- ["xmlrpc://..."].a.b (...), see remoteCallFor
		if (theRemote !== undefined) {
			return (callOdbScript (theRemote.theHandler.theValue, theRemote.args, theRemote.theHandler.thePath, [], environment.verbs ["lang.address"] ([theRemote.theHandler.thePath], environment)));
			}
		
		/*  7/27/26 by CC -- defined is a special form, the way the kernel
			treats it: if walking to the value fails because a parent table
			isn't there, the answer is false, not an error.  */
		
		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "defined") && (theNode.args.length === 1)) {
			var definedValue;
			try {
				definedValue = evalExpr (theNode.args [0]);
				}
			catch (err) {
				return (false);
				}
			return (definedValue !== undefined);
			}
		
		/*  8/4/26 by CC -- evaluate is a special form: the kernel compiles the
			string and runs it in the current scope, so the caller's locals are
			visible to the evaluated code. The build script at the end of
			uploadScripts is the customer. An empty or missing script answers
			nil, the way a project with no build script expects.  */
		
		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "evaluate") && (theNode.args.length === 1)) {
			const scriptValue = evalExpr (theNode.args [0]);
			if ((scriptValue === undefined) || (scriptValue === null)) {
				return (undefined);
				}
			var scriptText;
			if (scriptValue.flOdbScript === true) {
				scriptText = environment.verbs ["string"] ([scriptValue]);
				}
			else {
				if ((typeof scriptValue === "object") && (scriptValue.flWpText !== true)) {
					const message = "Can't evaluate the script because the value is a " + environment.verbs ["typeof"] ([scriptValue]) + ", not text.";
					throw new Error (message); //without this the object stringifies to "[object Object]" and the parser's complaint names neither the value nor the caller
					}
				scriptText = String (scriptValue);
				}
			if (scriptText.trim ().length === 0) {
				return (undefined);
				}
			if (environment.parseScript === undefined) {
				const message = "Can't evaluate the script because this environment has no script parser.";
				throw new Error (message);
				}
			const theLines = [];
			scriptText.split (/\r\n|\r|\n/).forEach (function (line) { //a stored script stringifies with returns, a rendered one with linefeeds
				const withoutTabs = line.replace (/^\t+/, "");
				if (withoutTabs.trim ().length > 0) {
					theLines.push ({level: line.length - withoutTabs.length, text: withoutTabs, flComment: false});
					}
				});
			const theStatements = environment.parseScript (theLines);
			environment.trace.push ({verb: "evaluate", args: [scriptText.slice (0, 80)]});
			return (evaluate (theStatements, environment));
			}
		
		/*  7/27/26 by CC -- nameOf is a path question, not a value question:
			nameOf (adr^) answers the name of the cell the address points to,
			nameOf (config.manila) answers "manila".  */
		
		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "parentof") && (theNode.args.length === 1)) {
			/*  parentOf (adr^) answers the address of the table holding the
				cell -- a path question, answered by trimming the path. Given
				a bare value, the kernel knew its cell; here an identity
				index over the odb answers instead.  */
			const argNode = theNode.args [0];
			var addressForParent;
			var argValue;
			if (argNode.op === "deref") {
				addressForParent = evalExpr (argNode.expr);
				if (typeof addressForParent === "string") {

					/*  9/26/26 by CC -- parentOf (s^) WHERE s IS THE ADDRESS AS TEXT.
						The deref coerces a string to an address ("user.prefs"^ walks
						the path, referenceForAddress), and so does the kernel; this
						branch didn't, so the parent of a text address was nil. DW's
						release script hands fatPages.buildFileAtts the address as
						text (string.popFileFromAddress), and buildFileAtts asks
						parentOf (w^) == "" to tell a file window from an object --
						once nil == "" was true (0.4.90, the kernel's rule) every
						release went to packWindow, which isn't here. Fire alarm,
						9/26, his mastodon table.  */

					try {
						addressForParent = environment.verbs ["lang.address"] ([addressForParent], environment);
						if ((addressForParent !== undefined) && (addressForParent.flAddress === true)) {
							const theObjectThere = addressForParent.reference.get (); //text that names nothing: the deref fails, and parentfunc "leaves it nil" -- errors are disabled there, "any error will result in a null return"
							if (theObjectThere === undefined) {
								addressForParent = undefined;
								}
							}
						}
					catch (err) {
						addressForParent = undefined;
						}
					if (addressForParent === undefined) {
						return (undefined);
						}
					}
				if ((addressForParent !== undefined) && (addressForParent !== null) && (addressForParent.flOdbAddressText === true)) { //9/25/26 by CC -- an address as the database stores it: parentOf (adrObject^) inside a page table kept in the database (websites.["#data"], html.buildObject's default) answered nil, so html.getImageData never found the site's #images and every docserver page said "Can't locate an image object". The kernel sees one address type; here the stored form is made live first
					addressForParent = environment.verbs ["lang.address"] ([String (addressForParent.path)], environment);
					}
				if ((addressForParent === undefined) || (addressForParent === null) || (addressForParent.flAddress !== true)) {

					/*  8/24/26 by CC -- parentOf (a.dotted.name^): evaluating
						the inner expression answers the VALUE, not an address,
						and this branch quietly treated it as an address that
						never matched, so the whole call answered nil. The
						value is the argument then, and the odbId path below
						knows its home exactly.  */

					argValue = addressForParent;
					addressForParent = undefined;
					}
				}
			else {
				if (argNode.op === "id") {
					/*  parentOf (host) -- the classic way to reach the table a
						cell lives in, usually the param table via with-scope.
						The resolved reference knows its container.  */
					const idReference = referenceForId (argNode.name);
					if ((idReference !== undefined) && (idReference.container !== undefined) && (idReference.container !== environment.odb)) {
						const homeTable = idReference.container;
						var flFrameVars = false;
						environment.frames.forEach (function (frame) {
							if (frame.vars === homeTable) {
								flFrameVars = true;
								}
							});
						if (!flFrameVars) { //locals have no odb parent; a with-scoped cell does
							const homeFound = findValueHome (homeTable);
							return ({
								flAddress: true,
								pathText: (homeFound === undefined) ? "(parent)" : homeFound.ownPath,
								reference: {
									get: function () {
										return (homeTable);
										},
									set: function (theValue) {
										const message = "Can't assign through a parent found by scope.";
										throw new Error (message);
										},
									remove: function () {
										}
									}
								});
							}
						}
					}
				argValue = evalExpr (argNode);
				if ((argValue !== undefined) && (argValue !== null) && (argValue.flOdbAddressText === true)) { //9/25/26 by CC -- the stored form, as above
					argValue = environment.verbs ["lang.address"] ([String (argValue.path)], environment);
					}
				if ((argValue !== undefined) && (argValue !== null) && (argValue.flAddress === true)) {
					addressForParent = argValue;
					}
				}
			if ((addressForParent === undefined) && (argValue !== undefined) && (argValue !== null) && (typeof argValue === "object") && (argValue.odbId !== undefined) && (environment.odbPathForId !== undefined)) {

				/*  8/24/26 by CC -- a database value knows its row, and the
					store knows the row's whole path, so the parent is exact
					and free: no identity walk, and the answer is the FULL
					address however short the name the caller typed. The
					codecasting release leans on this -- the part carries its
					address, and the receiving side installs at the address
					the part names, so a short one would plant a stray table
					at the root of somebody's database.  */

				const theOwnPath = environment.odbPathForId (argValue.odbId);
				if ((typeof theOwnPath === "string") && (theOwnPath.indexOf (".") > 0)) {
					return (environment.verbs ["lang.address"] ([parentPathText (theOwnPath)], environment)); //9/21/26 by CC -- trimmed at the last dot OUTSIDE brackets; see parentPathText
					}
				}
			if ((addressForParent === undefined) && (argValue !== null) && (typeof argValue === "object")) {
				const found = findValueHome (argValue);
				if (found !== undefined) {
					const homeContainer = found.container;
					return ({
						flAddress: true,
						pathText: found.containerPath,
						reference: {
							get: function () {
								return (homeContainer);
								},
							set: function (theValue) {
								const message = "Can't assign through a parent found by value.";
								throw new Error (message);
								},
							remove: function () {
								}
							}
						});
					}
				}
			if ((addressForParent !== undefined) && (addressForParent.flAddress === true)) {

				/*  8/24/26 by CC -- FIRST ask the store. The value the address
					leads to knows its row, and the row knows its whole path --
					so a short name resolved through the paths tables answers
					its TRUE parent, where trimming the typed text answered the
					short one. parentOf (@fatPages.importFatFile) is
					system.verbs.builtins.fatPages, not fatPages.  */

				var theLedValue;
				try {
					theLedValue = addressForParent.reference.get ();
					}
				catch (err) {
					theLedValue = undefined;
					}
				if ((theLedValue !== undefined) && (theLedValue !== null) && (typeof theLedValue === "object") && (theLedValue.odbId !== undefined) && (environment.odbPathForId !== undefined)) {
					const theOwnPath = environment.odbPathForId (theLedValue.odbId);
					if ((typeof theOwnPath === "string") && (theOwnPath.indexOf (".") > 0)) {
						return (environment.verbs ["lang.address"] ([parentPathText (theOwnPath)], environment)); //9/21/26 by CC -- trimmed at the last dot OUTSIDE brackets; see parentPathText
						}
					}

				/*  Identity is the careful answer -- the value the address leads
					to knows its home table, and that never trips over names with
					dots in them, the way trimming path text would. But it costs
					a full walk of the database, so it is the SECOND choice:
					8/4/26 by CC, when the address carries a real path, the
					trimming below is exact and free, and only a path we can't
					read (a bare deref, a parent found by scope) falls through to
					the walk.  */
				
				const thePathForParent = addressForParent.pathText;
				const flRealPath = (typeof thePathForParent === "string") && (thePathForParent.length > 0) && (thePathForParent.indexOf ("(") !== 0);
				
				const targetValue = (flRealPath) ? undefined : addressForParent.reference.get ();
				if ((targetValue !== undefined) && (targetValue !== null) && (typeof targetValue === "object")) {
					const targetFound = findValueHome (targetValue);
					if (targetFound !== undefined) {
						const targetContainer = targetFound.container;
						return ({
							flAddress: true,
							pathText: targetFound.containerPath,
							reference: {
								get: function () {
									return (targetContainer);
									},
								set: function (theValue) {
									const message = "Can't assign through a parent found by value.";
									throw new Error (message);
									},
								remove: function () {
									}
								}
							});
						}
					}
				/*  Fall back to trimming the last path component -- a database
					name in brackets can hold dots, so only a dot outside
					brackets separates components.  */
				const parentText = parentPathText (addressForParent.pathText);
				if ((parentText.length > 0) && (parentText.indexOf ("(") !== 0)) {
					return (environment.verbs ["lang.address"] ([parentText], environment)); //9/21/26 by CC -- an ADDRESS. This called string.parseAddress, which has answered the kernel's list of names since 9/8, so the parent of a scalar reached by a typed path came back as a list
					}
				}
			if ((process.env.USERTALK_ERROR_TRAIL !== undefined) && (process.env.USERTALK_ERROR_TRAIL.indexOf ("/") !== -1)) { //the bench aid: what it was asked about
				try {
					require ("fs").appendFileSync (process.env.USERTALK_ERROR_TRAIL, "parentOf answers nil for: " + JSON.stringify ((addressForParent === undefined) ? String (argValue).slice (0, 80) : addressForParent.pathText) + "\n");
					}
				catch (errWrite) {
					}
				}
			return (undefined); //no parent to be had: the top of the database answers nil, so pop-to-root loops terminate
			}
		
		if ((theNode.fn.op === "id") && ((theNode.fn.name.toLowerCase () === "delete") || (theNode.fn.name.toLowerCase () === "lang.delete")) && (theNode.args.length === 1)) {

			/*  9/7/26 by CC -- DELETE TAKES THE THING ITSELF, an lvalue, the way
				the kernel does (langvalue.c, deletevalue through
				assignordeletevalue -- the same code as assignment): delete (x),
				delete (t.[1]) and delete (adr^ [1]) all delete the cell the
				expression names, and delete (@x) still works. Ours took only an
				address value, and rssCodeUpdateSuite.addPartToIndex's
				`delete (adrindex^ [1])` stopped the first codecasting release
				on 9/7: "Can't delete the object because the parameter isn't an
				address."  */

			const argNode = theNode.args [0];
			if ((argNode.op === "dot") || (argNode.op === "index") || (argNode.op === "deref") || (argNode.op === "id")) {
				var theLvalue;
				if ((argNode.op === "dot") || (argNode.op === "index")) {
					const lazy = lazyAddressForNode (argNode);
					if (lazy !== undefined) {
						theLvalue = {flAddress: true, reference: lazy.reference, pathText: lazy.pathText, nameText: lazy.nameText};
						}
					}
				if ((theLvalue === undefined) && (argNode.op === "deref")) {
					const inner = addressFromValue (evalExpr (argNode.expr));
					if ((inner !== undefined) && (inner !== null) && (inner.flAddress === true)) {
						theLvalue = inner;
						}
					}
				if ((theLvalue === undefined) && (argNode.op === "id")) {
					const reference = referenceForId (argNode.name);
					if (reference !== undefined) {
						theLvalue = {flAddress: true, reference, pathText: argNode.name, nameText: argNode.name};
						}
					}
				if (theLvalue !== undefined) {

					/*  9/21/26 by CC -- AND WHEN THE CELL HOLDS AN ADDRESS, IT IS THE
						ADDRESS THAT IS USED. The delete verb (langverbs.c,
						disposevaluefunc) takes an array expression as an lvalue --
						the 9/7 case -- and everything else through getvarparam,
						whose comment is the rule: "we check the value at that db
						location. if it exists and is an address, we use it.
						otherwise, we use the dotparam pair as the address." The
						9/7 note here asked the question and answered it wrong:
						delete (adrItem) deleted the local adrItem and left the
						object. manilaSuite.custody.checkOut clears a timed-out
						lock with exactly that line.  */

					var theValue;
					try {
						theValue = theLvalue.reference.get ();
						}
					catch (err) {
						theValue = undefined;
						}
					if ((argNode.op !== "index") && (theValue !== undefined) && (theValue !== null) && ((theValue.flAddress === true) || (theValue.flOdbAddressText === true))) {
						return (environment.verbs ["delete"] ([addressFromValue (theValue)], environment));
						}
					return (environment.verbs ["delete"] ([theLvalue], environment));
					}
				}
			}

		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "indexof") && (theNode.args.length === 1)) {

			/*  9/13/26 by CC -- indexOf (adr^): the kernel's indexfunc
				(langvalue.c, "6.1d7 AR: Started implementation of indexOf
				verb"): the table and name the argument names, then a walk of
				the table's sorted entries counting up to that name -- the
				one-based position; 0 when it isn't found, and errors are
				disabled, so any failure answers 0. Found missing under DW's
				2010 JSON.decompile ("set comma" reads indexOf (adr^)) when it
				was run for the kernelized version's test. The argument's
				address is taken apart: the last name is the entry, the names
				before it the table -- a local table as well as one in the
				database.  */

			try {
				const argNode = theNode.args [0];
				var theAddress;
				if (argNode.op === "deref") {
					theAddress = evalExpr (argNode.expr);
					}
				else {
					if ((argNode.op === "dot") || (argNode.op === "index") || (argNode.op === "id")) {
						theAddress = lazyAddressForNode (argNode);
						}
					if ((theAddress === undefined) && (argNode.op === "id")) {
						theAddress = {flAddress: true, pathText: argNode.name};
						}
					}
				if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true) || (typeof theAddress.pathText !== "string")) {
					return (0);
					}
				const theParts = partsForAddressText (theAddress.pathText);
				if (theParts.length === 0) {
					return (0);
					}
				const lowerName = String (theParts [theParts.length - 1]).toLowerCase ();
				var theTable;
				if (theParts.length === 1) {
					theTable = environment.odb;
					}
				else {
					const baseReference = referenceForId (theParts [0]);
					if (baseReference === undefined) {
						return (0);
						}
					theTable = baseReference.get ();
					var ixPart;
					for (ixPart = 1; ixPart < theParts.length - 1; ixPart++) {
						const theKey = findKey (theTable, theParts [ixPart]);
						if (theKey === undefined) {
							return (0);
							}
						theTable = theTable [theKey];
						}
					}
				if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
					return (0);
					}
				var ixEntry = 0, ixFound = 0;
				Object.keys (theTable).forEach (function (theKey) {
					if ((theKey === "flOdbSqlTable") || (theKey === "odbId")) {
						return;
						}
					ixEntry++;
					if ((ixFound === 0) && (theKey.toLowerCase () === lowerName)) {
						ixFound = ixEntry;
						}
					});
				return (ixFound);
				}
			catch (err) {
				return (0);
				}
			}

		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "nameof") && (theNode.args.length === 1)) {
			const argNode = theNode.args [0];
			
			function lastPathComponent (thePathText) { //the part after the last dot outside brackets
				var ixLastDot = -1;
				var depth = 0;
				var ixScan;
				for (ixScan = 0; ixScan < thePathText.length; ixScan++) {
					const ch = thePathText.charAt (ixScan);
					if (ch === "[") {
						depth++;
						}
					if (ch === "]") {
						depth--;
						}
					if ((ch === ".") && (depth === 0)) {
						ixLastDot = ixScan;
						}
					}
				var theLastName = thePathText.slice (ixLastDot + 1);
				if ((theLastName.indexOf ("[") === 0) && (theLastName.lastIndexOf ("]") === theLastName.length - 1)) { //9/21/26 by CC -- the NAME, its brackets and quotes off: nameOf of an address ending in ["dave@userland.com"] answered the bracketed, quoted text
					theLastName = theLastName.slice (1, theLastName.length - 1);
					if ((theLastName.length >= 2) && (theLastName.indexOf ("\"") === 0) && (theLastName.lastIndexOf ("\"") === theLastName.length - 1)) {
						theLastName = theLastName.slice (1, theLastName.length - 1).split ("\\\"").join ("\"").split ("\\\\").join ("\\");
						}
					}
				return (theLastName);
				}
			
			var addressForName;
			if (argNode.op === "deref") {
				addressForName = evalExpr (argNode.expr);
				if ((addressForName !== undefined) && (addressForName !== null) && (addressForName.flOdbAddressText === true)) { //9/25/26 by CC -- an address as the database stores it: nameOf (adrPageTable^.adrObject^) answered the whole address text, and html.addPageToGlossary wrote that into every glossary entry it made, so the links between docserver's pages were the root's file path
					addressForName = addressFromValue (addressForName);
					}
				if (typeof addressForName === "string") {

					/*  9/10/26 by CC -- nameOf (s^) WHERE s IS THE ADDRESS AS TEXT. The
						kernel's namefunc (langvalue.c) reads the address without
						dereferencing, errors disabled -- "any error will result in a
						null return" -- so a text that names nothing answers the empty
						string, and table.surePath (1997) opens on exactly that test,
						nameOf (s^) != "". This answered the whole text, so surePath
						returned 0 without making a table, for any text path. Found
						under DW's 9/10 import of a part addressed by config.root's path.  */

					var theTextAddress;
					try {
						theTextAddress = environment.verbs ["lang.address"] ([addressForName], environment);
						}
					catch (err) {
						return ("");
						}
					var theObjectThere;
					try {
						theObjectThere = ((theTextAddress !== undefined) && (theTextAddress.flAddress === true)) ? theTextAddress.reference.get () : undefined;
						}
					catch (err) {
						theObjectThere = undefined;
						}
					if (theObjectThere === undefined) {
						return ("");
						}
					addressForName = theTextAddress;
					}
				}
			else {
				if ((argNode.op === "dot") || (argNode.op === "index")) {
					/*  nameOf (table [i]) and nameOf (a.b.c) are path questions:
						the lazy address resolves the real entry name, nth
						subscripts included.  */
					const lazy = lazyAddressForNode (argNode);
					if (lazy !== undefined) {
						if (lazy.nameText !== undefined) { //8/5/26 by CC -- the address knows its own name; the path text can't be split back apart when a name contains dots
							return (lazy.nameText);
							}
						return (lastPathComponent (lazy.pathText));
						}
					}
				var argValue = evalExpr (argNode);
				if ((argValue !== undefined) && (argValue !== null) && (argValue.flOdbAddressText === true)) { //9/25/26 by CC -- the stored form, as above
					argValue = addressFromValue (argValue);
					}
				if ((argValue !== undefined) && (argValue !== null) && (argValue.flAddress === true)) {
					addressForName = argValue;
					}
				else {
					if (argNode.op === "dot") {
						return (argNode.name);
						}
					if (argNode.op === "id") {
						return (argNode.name);
						}
					return (String (argValue));
					}
				}
			if ((addressForName !== undefined) && (addressForName.flAddress === true)) {
				if (addressForName.nameText !== undefined) { //8/5/26 by CC
					return (addressForName.nameText);
					}
				return (lastPathComponent (addressForName.pathText));
				}
			return (String (addressForName));
			}
		
		/*  7/27/26 by CC -- the kernel thunk: a builtin's script body is
			"on xxx (params)" over the single line "kernel (path.to.verb)".
			Dispatch to the JS verb table with the enclosing handler's
			arguments; a missing kernel verb fails loudly by name, so every
			gap in the verb library announces itself.  */
		
		if ((theNode.fn.op === "id") && (theNode.fn.name.toLowerCase () === "kernel") && (theNode.args.length === 1)) {
			const kernelName = dottedNameForNode (theNode.args [0]);
			if (kernelName !== undefined) {
				const kernelVerb = environment.verbs [kernelName.toLowerCase ()];
				var kernelArgs = [];
				var ixArgFrame; //10/4/26 by CC -- the enclosing HANDLER's arguments: a bundle that declares a local, or a with, is a frame of its own now (runBody), so the walk goes outward to the frame that carries them
				for (ixArgFrame = environment.frames.length - 1; ixArgFrame >= 0; ixArgFrame--) {
					if (environment.frames [ixArgFrame].callArgs !== undefined) {
						kernelArgs = environment.frames [ixArgFrame].callArgs;
						break;
						}
					}
				if (kernelVerb === undefined) {
					/*  Screen verbs are no-ops here -- there is no screen. An
						is-question answers false, everything else claims
						success. Every other missing kernel verb still fails
						loudly by name.  */
					const screenPrefixes = ["menu.", "window.", "speaker.", "mouse.", "kb.", "clipboard."];
					var flScreenVerb = false;
					screenPrefixes.forEach (function (prefix) {
						if (kernelName.toLowerCase ().indexOf (prefix) === 0) {
							flScreenVerb = true;
							}
						});
					if (flScreenVerb) {
						const shortName = kernelName.toLowerCase ().split (".").pop ();
						environment.trace.push ({verb: kernelName, args: kernelArgs, flKernel: true, flScreenNoOp: true});
						return (shortName.indexOf ("is") !== 0);
						}
					if (typeof environment.noteMissingVerb === "function") { //9/4/26 by CC -- DW's ask: a log of these, so he needn't report each missing verb
						try {
							environment.noteMissingVerb (kernelName, environment.scriptAddresses [environment.scriptAddresses.length - 1]);
							}
						catch (err) {
							}
						}
					const message = "Can't call the kernel verb " + kernelName + " because it isn't implemented in the verb library.";
					throw new Error (message);
					}
				environment.trace.push ({verb: kernelName, args: kernelArgs, flKernel: true});
				return (callTheVerb (kernelVerb, kernelName, kernelArgs));
				}
			}
		
		const args = [];
		const argNames = []; //7/27/26 by CC -- flEmptyBodyOk:true binds by name, not position
		theNode.args.forEach (function (argNode) {
			args.push (evalExpr (argNode));
			argNames.push ((argNode.op === "namedarg") ? argNode.name : undefined);
			});
		
		//a handler defined in scope?
		
		const dottedName = dottedNameForNode (theNode.fn);
		
		if (theNode.fn.op === "id") {
			const reference = referenceForId (theNode.fn.name);
			if (reference !== undefined) {
				const value = reference.get ();
				if ((value !== undefined) && (value.flHandler === true)) {
					return (callHandler (value, args, argNames));
					}
				if ((value !== undefined) && (value !== null) && (value.flOdbScript === true)) { //a macro table in scope holds the script
					environment.trace.push ({verb: theNode.fn.name, args, flOdbScript: true});
					return (callOdbScript (value, args, theNode.fn.name, argNames, addressForCallNode (theNode.fn)));
					}
				}
			}
		
		if (dottedName !== undefined) {
			/*  8/20/26 by CC -- resolution is the database's, in the database's
				order: what the name resolves to is what runs. The JavaScript
				verb table used to be consulted here first and win every time,
				so a verb with no object in the database still ran -- the
				arrangement DW hit on 8/20 when string.replaceAll worked and
				2-clicking it said the string table has nothing by that name.
				There is no fallback: a name that resolves to nothing is a
				name that doesn't exist.  */
			/*  8/22/26 by CC -- ONLY THE LOOKUP IS INSIDE THE TRY. The calls
				used to be in here too, so anything the called script threw --
				a missing kernel verb, a real failure deep inside it -- was
				caught here and reported as "isn't a verb, a handler or a
				script." The name had resolved perfectly well; the message
				said it hadn't, and pointed the reader at the wrong thing
				entirely. DW hit this on op.setExpansionState.  */

			var theFound;
			try {
				theFound = referenceForNode (theNode.fn).get ();
				}
			catch (err) {
				if (err.flRethrow === true) {
					throw err;
					}
				theFound = undefined; //nothing at that address -- fall through to the unknown-verb error below
				}

			if ((theFound !== undefined) && (theFound.flHandler === true)) {
				return (callHandler (theFound, args, argNames));
				}
			if ((theFound !== undefined) && (theFound.flOdbScript === true)) {
				environment.trace.push ({verb: dottedName, args, flOdbScript: true});
				return (callOdbScript (theFound, args, dottedName, argNames, addressForCallNode (theNode.fn)));
				}
			if (typeof theFound === "function") { //a kernel verb, found in one of the tables at system.compiler.kernel
				environment.trace.push ({verb: dottedName, args, flKernel: true});
				return (callTheVerb (theFound, dottedName, args));
				}
			if (environment.resolveExternalScript !== undefined) { //a sibling build script called by name
				const external = environment.resolveExternalScript (dottedName);
				if (external !== undefined) {
					environment.trace.push ({verb: dottedName, args, flExternalScript: true});
					return (callOdbScript (external, args, dottedName, argNames));
					}
				}
			const throughPackage = callThroughPackage (theNode, args, argNames, dottedName); //10/5/26 by CC -- socketClient.init (): an exported handler of a package, or of the package an instance was made from
			if (throughPackage !== undefined) {
				return (throughPackage.value);
				}
			const message = "Can’t call the script because the name “" + dottedName + "” hasn’t been defined."; //the kernel's own words -- Lang Errors [9] in lang.r; DW ruling 8/24: just say script
			throw new Error (message);
			}
		
		//calling through a computed value
		const fn = evalExpr (theNode.fn);
		if ((fn !== undefined) && (fn.flHandler === true)) {
			return (callHandler (fn, args, argNames));
			}
		if ((fn !== undefined) && (fn !== null) && (fn.flOdbScript === true)) { //a script reached through an address or table walk
			environment.trace.push ({verb: pathTextForNode (theNode.fn), args, flOdbScript: true});
			return (callOdbScript (fn, args, pathTextForNode (theNode.fn), argNames, addressForCallNode (theNode.fn)));
			}
		if (typeof fn === "function") {
			environment.trace.push ({verb: pathTextForNode (theNode.fn), args});
			return (callTheVerb (fn, pathTextForNode (theNode.fn), args));
			}
		const message = "Can’t call the script because the name “" + pathTextForNode (theNode.fn) + "” hasn’t been defined."; //the kernel's own words -- Lang Errors [9] in lang.r
		throw new Error (message);
		}
	
	/*  10/5/26 by CC -- PACKAGES, DW's 10/5 design, in his words: "a whole
		package of functionality... very much like a package in node.js. and
		it'll export names... it has an address, so it might be called
		socketClient, and inside of socketClient I have a verb called init, and
		I export it." And: "it would work the same way a node package works.
		only the functions that are explicitly named can be called from
		outside. everything else is internal and private."

		A package is one script. Its top level says what it exports the node
		way, exports.init = init, one line per handler; exports is a table
		the module gets when it runs. A call socketClient.init (url) runs the
		exported handler init inside the script socketClient; a handler the
		script didn't export can't be called from outside, and the error says
		so. The kernel has no such call -- langgetentrypoint runs the handler
		named for the script itself -- so this is an addition to the
		language, not a change to anything that worked.

		An instance: local (socketClient = new userlandSamples.socketClient ())
		makes a table holding the package's address under the name package;
		socketClient.init (url) on that table runs the package's exported
		init with this set to the instance, so the package keeps its data in
		the instance, this^.items, where he can watch it in the odb: "if you
		want to debug, you can walk through the data in the odb." Two
		instances keep two tables. Frontier can't hide a table entry, so
		private here means not exported and not advertised, the same as his
		JavaScript.  */

	function scriptFromAddressValue (theValue) { //the script an address value points at, or undefined; the value may be a live address or the stored form
		try {
			if ((theValue === undefined) || (theValue === null)) {
				return (undefined);
				}
			var theScript;
			if (theValue.flAddress === true) {
				theScript = theValue.reference.get ();
				}
			else {
				if (theValue.flOdbAddressText === true) {
					theScript = environment.verbs ["lang.address"] ([String (theValue.path)], environment).reference.get ();
					}
				}
			if ((theScript !== undefined) && (theScript !== null) && (theScript.flOdbScript === true)) {
				return (theScript);
				}
			}
		catch (err) {
			}
		return (undefined);
		}

	function callThroughPackage (theNode, args, argNames, dottedName) { //{value} when the call was a package's exported handler, else undefined
		const fnNode = theNode.fn;
		if ((fnNode === undefined) || (fnNode.op !== "dot")) {
			return (undefined);
			}
		var theOwner;
		try {
			theOwner = referenceForNode (fnNode.left).get ();
			}
		catch (err) {
			return (undefined);
			}
		if ((theOwner === undefined) || (theOwner === null) || (typeof theOwner !== "object")) {
			return (undefined);
			}
		const theExportName = String (fnNode.name);
		if (theOwner.flOdbScript === true) { //the package itself: socketClient.init ()
			environment.trace.push ({verb: dottedName, args, flOdbScript: true});
			return ({value: callOdbScript (theOwner, args, dottedName, argNames, addressForCallNode (fnNode.left), theExportName)});
			}
		if (flTableValue (theOwner)) { //an instance: a table carrying the package's address
			const packageKey = findKey (theOwner, "package");
			if (packageKey !== undefined) {
				const theScript = scriptFromAddressValue (theOwner [packageKey]);
				if (theScript !== undefined) {
					environment.trace.push ({verb: dottedName, args, flOdbScript: true});
					return ({value: callOdbScript (theScript, args, dottedName, argNames, addressForCallNode (fnNode.left), theExportName)});
					}
				}
			}
		return (undefined);
		}

	function evalNew (theNode) { //new userlandSamples.socketClient () -> a table holding the package's address, the instance
		const theName = pathTextForNode (theNode.target);
		var theScript;
		try {
			theScript = referenceForNode (theNode.target).get ();
			}
		catch (err) {
			theScript = undefined;
			}
		if ((theScript === undefined) || (theScript === null) || (theScript.flOdbScript !== true)) {
			const message = "Can't make a new " + theName + " because there is no package script at that address.";
			throw new Error (message);
			}
		const theAddress = addressForCallNode (theNode.target);
		if (theAddress === undefined) {
			const message = "Can't make a new " + theName + " because the package has no address in the database.";
			throw new Error (message);
			}
		const theInstance = {};
		theInstance.package = theAddress;
		return (theInstance);
		}

	function callPackageInit (theNewNode, theInstanceAddress) { //10/6/26 by CC -- the arguments of new go to the package's exported init, this set to the new instance: scratchpad.feedland = new userlandSamples.socketClient (url). DW, 10/6: "that's the way to do it."

		/*  The instance has to be somewhere first -- the assignment or the
			local declaration puts it there, then calls this with the place's
			address, so this inside init is the instance. A package with no
			exported init and no arguments is left alone; arguments with no
			init to take them is an error.  */

		const args = [];
		const argNames = [];
		theNewNode.args.forEach (function (argNode) { //the same gathering a call does: a named argument binds by name
			args.push (evalExpr (argNode));
			argNames.push ((argNode.op === "namedarg") ? argNode.name : undefined);
			});
		const theScript = referenceForNode (theNewNode.target).get ();
		const theName = pathTextForNode (theNewNode.target);
		const theAnswer = callOdbScript (theScript, args, theInstanceAddress.pathText + ".init", argNames, theInstanceAddress, "init", true); //true: no init exported is not an error here
		if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.flNoSuchExport === true) && (args.length > 0)) {
			const message = "Can't make a new " + theName + " with arguments because the package doesn't export init.";
			throw new Error (message);
			}
		}

	function callHandler (theHandler, theArgs, theArgNames) {

		const frame = {vars: {}, callArgs: theArgs}; //callArgs feed a kernel (x.y) thunk in the body
		
		const savedFrames = environment.frames;
		/*  10/4/26 by CC -- THE HANDLER'S FRAME GOES ON THE CALLER'S CHAIN, the
			kernel's way. langpushlocalchain chains a called handler's symbol
			table onto the chain as it stands at the call, and langfindsymbol
			(langops.c, 2/12/92 dmb) searches a local table only when its
			lexicalrefcon matches -- the refcon is the script OBJECT being run
			(langgetlexicalrefcon, the error stack's top), so a handler sees
			every local table in the chain that belongs to the same script, and
			none from another script object. Here a script object's frames are
			always the whole chain (callOdbScript starts a called script on its
			own chain), so the caller's frames ARE the same-script tables.

			Found tonight by rootUpdates.update: its nested handler rssUpdate
			assigns maxpubdate, a local declared in a bundle's try in the
			handler that calls it. With bundles getting frames of their own
			(runBody), a lexical chain taken at the handler's definition no
			longer held that local, and the update stopped after one part.  */

		environment.frames = environment.frames.concat ([frame]);
		
		/*  7/27/26 by CC -- split the arguments: named ones bind to the
			param with that name, the rest bind in order.  */
		const positional = [];
		const byName = {};
		theArgs.forEach (function (value, ixArg) {
			const argName = (theArgNames === undefined) ? undefined : theArgNames [ixArg];
			if (argName === undefined) {
				positional.push (value);
				}
			else {
				byName [argName.toLowerCase ()] = value;
				}
			});
		
		var ixPositional = 0;
		theHandler.params.forEach (function (param) {
			var value;
			if (byName [param.name.toLowerCase ()] !== undefined) {
				value = byName [param.name.toLowerCase ()];
				}
			else {
				if (ixPositional < positional.length) {
					value = positional [ixPositional];
					ixPositional++;
					}
				}
			if (value === undefined) {
				if (param.value !== undefined) {
					value = evalExpr (param.value); //defaults see the params already bound: on copyone (a, b=a)
					}
				}
			frame.vars [param.name] = value;
			});

		/*  8/23/26 by CC -- WHAT A KERNEL THUNK GETS. It used to get theArgs:
			the caller's arguments in the order they were WRITTEN, names
			thrown away, defaults never applied. So his httpReadUrl, calling
			tcp.httpClient (method, server:.., path:.., ctFollowRedirects:..),
			handed the JavaScript verb "GET", the server, then the PATH where
			port belongs and ctFollowRedirects where path belongs --
			http://scripting.com/ went out as https://scripting.com:0/0. The
			same thing broke all 27 scripts of system.verbs.apps.s3.

			The binding above already did the work; the thunk just wasn't
			using it. Now the kernel verb gets the declared parameters in
			declared order, defaults filled in, which is what its parameter
			list means and what Frontier's kernel verbs read. A handler that
			declares no parameters still passes the raw arguments along --
			there is nothing else it could mean.  */

		if (theHandler.params.length > 0) {
			const theParamValues = [];
			theHandler.params.forEach (function (param) {
				theParamValues.push (frame.vars [param.name]);
				});
			frame.callArgs = theParamValues;
			}

		try {
			const result = evaluate (theHandler.body, environment);
			return (result);
			}
		catch (signal) {
			if (signal.flReturnSignal) {
				return (signal.value);
				}
			throw signal;
			}
		finally {
			environment.frames = savedFrames;
			}
		}
	
	function addressForCallNode (theNode) {
		/*  8/10/26 by CC -- the address the called script was reached
			through, built the way @x builds one. A call that can't be named
			as a place in the database answers nothing, and this says so when
			the script asks.  */
		try {
			const lazy = lazyAddressForNode (theNode);
			if (lazy !== undefined) {
				return ({flAddress: true, reference: lazy.reference, pathText: lazy.pathText, nameText: lazy.nameText});
				}
			const reference = referenceForNode (theNode);
			if (reference === undefined) {
				return (undefined);
				}
			return ({flAddress: true, reference, pathText: pathTextForNode (theNode)});
			}
		catch (err) {
			return (undefined);
			}
		}
	
	function callOdbScript (theScript, theArgs, theName, theArgNames, theAddress, theExportName, flExportOptional) { //10/5/26 by CC -- theExportName: the call is to one of the package's exported handlers; see callThroughPackage. 10/6/26 -- flExportOptional: a missing export answers {flNoSuchExport: true} instead of throwing (new's call to init)
		
		/*  A script value from the odb, called like a verb: parse it once,
			evaluate its module (skipping test-code bundles), then call the
			handler named for it -- Frontier's script-call semantics.
			
			8/10/26 by CC -- theAddress is where the script lives, when the
			caller knew it; it's what this answers while the script runs.  */
		
		/*  8/17/26 by CC -- THE COMPILE IS KEPT. Frontier compiles a script
			once and holds on to it; ours re-parsed on every call, because a
			script read out of the database is a brand new object each time and
			the parse hung on the object that was about to be thrown away. DW
			measured what that cost: 89 microseconds to call a script whose
			whole body is `return (100 + 959)`, against half a microsecond for
			a kernel verb.
			
			The compiled form is kept per row, and thrown away when the row's
			modified date moves -- so editing a script recompiles it and
			nothing else does. Like the kernel's, the cache lives as long as
			the process does.  */
		
		/*  9/10/26 by CC -- THE LINKED CODE RUNS, NOT THE TEXT. The kernel calls
			a stored script through langgetnodecode (langvalue.c): the code
			linked to the script if there is any, and only when there is none
			does it compile the text (scriptcompilecallback). Editing the text
			in a window doesn't unlink anything -- only opverbdisposecode does,
			when the object is unloaded, disposed or uncompiled -- so a script
			being edited keeps running the code it had until Compile or Run
			compiles it again, and a Compile that fails leaves the old code in
			place (scriptcompiler returns before opverblinkcode). DW, 9/9-9/10:
			"a script runs its last compiled code until Compile; autosave is
			not the same thing as compile... the system would be unusable"
			otherwise -- a half-typed line reaching a running agent killed it.
			The linked code lives in the row (odbSql.js, addTheLinkedColumn)
			stamped with the server session that made it; another session's
			is ignored, since the kernel links nothing at launch. A fresh
			compile from the text links what it compiled, the kernel's way.  */

		var theLinked;
		if ((theScript.linked !== undefined) && (theScript.linked !== null) && (environment.sessionId !== undefined) && (theScript.linked.session === environment.sessionId) && Array.isArray (theScript.linked.lines)) {
			theLinked = theScript.linked;
			}
		const theCacheKey = String (theScript.whenModified) + "|" + ((theLinked === undefined) ? "" : String (theLinked.stamp));
		if (theScript.parsedStatements === undefined) {
			const theKey = theScript.odbId;
			if (theKey !== undefined) {
				const theEntry = environment.compiledScripts.get (theKey);
				if ((theEntry !== undefined) && (theEntry.cacheKey === theCacheKey)) {
					theScript.parsedStatements = theEntry.parsedStatements;
					}
				}
			}
		if (theScript.parsedStatements === undefined) {
			if (environment.parseScript === undefined) {
				const message = "Can't call " + theName + " because no script parser is installed.";
				throw new Error (message);
				}
			const theLinesToCompile = (theLinked === undefined) ? theScript.lines : theLinked.lines;
			try {
				theScript.parsedStatements = environment.parseScript (theLinesToCompile);
				}
			catch (err) {
				const message = "Can't call " + theName + " because its script doesn't parse: " + err.message;
				const parseError = new Error (message);
				parseError.flRethrow = true; //7/27/26 by CC -- a parse failure must surface, not read as verb-not-found
				throw parseError;
				}
			if ((theLinked === undefined) && (theScript.odbId !== undefined) && (environment.setLinkedCode !== undefined) && (environment.sessionId !== undefined)) { //compiled from the text: link it, the kernel's scriptcompilecallback
				try {
					environment.setLinkedCode (theScript.odbId, {lines: theScript.lines, session: environment.sessionId, stamp: Date.now ()});
					}
				catch (err) {
					}
				}
			if (theScript.odbId !== undefined) {
				environment.compiledScripts.set (theScript.odbId, {cacheKey: theCacheKey, parsedStatements: theScript.parsedStatements});
				}
			}
		
		const moduleFrame = {vars: {}};
		const savedFrames = environment.frames;
		environment.frames = [moduleFrame];
		environment.scriptAddresses.push (theAddress);
		
		try {
			const parts = theName.split (".");
			const shortName = parts [parts.length - 1];

			function moduleStatementsOf (theParsed) { //the module minus its trailing test bundles -- the 7/27 and 9/4 rules below

				/*  7/27/26 by CC -- only TRAILING bundles are the test-code
					convention; a bundle in the body of the script is working
					code and runs. manilaSuite.init is built entirely of them.  */
				/*  9/4/26 by CC -- AND A STRAIGHT-CODE SCRIPT RUNS WHOLE, its
					trailing bundles included. The trailing-bundle skip is the
					test-code convention for scripts that HAVE handlers; a script
					with no handler at all is the kernel's foundbody path and every
					statement is the body. scheduler.init in the 2012 opml.root
					ends in three bundles -- "initialize user.scheduler.tasks" among
					them -- and skipping them left the startupScript reading
					user.scheduler.tasks that was never made: "Can't get the value
					of tasks because there is no object with that name," found on
					the virgin root, DW's 9/4 baseline.  */

				var flHasHandler = false;
				theParsed.forEach (function (statement) {
					if (statement.op === "handler") {
						flHasHandler = true;
						}
					});
				var ixLastReal = -1;
				theParsed.forEach (function (statement, ixStatement) {
					if ((statement.op !== "bundle") || !flHasHandler) {
						ixLastReal = ixStatement;
						}
					});
				const statements = [];
				theParsed.forEach (function (statement, ixStatement) {
					if (ixStatement <= ixLastReal) {
						statements.push (statement);
						}
					});
				return (statements);
				}

			/*  10/5/26 by CC -- A PACKAGE'S EXPORTED HANDLER. The module runs with
				an exports table in its frame; its exports.init = init lines fill
				it; the handler named by the call runs if it is there. Not there:
				the package doesn't export it, and the error says so -- DW's
				rule, "only the functions that are explicitly named can be called
				from outside." See callThroughPackage.  */

			if (theExportName !== undefined) {
				moduleFrame.vars.exports = {};
				evaluate (moduleStatementsOf (theScript.parsedStatements), environment);
				const theExports = moduleFrame.vars.exports;
				const exportKey = ((theExports !== undefined) && (theExports !== null) && (typeof theExports === "object")) ? findKey (theExports, theExportName) : undefined;
				if ((exportKey === undefined) || (theExports [exportKey] === undefined) || (theExports [exportKey] === null) || (theExports [exportKey].flHandler !== true)) {
					if (flExportOptional === true) {
						return ({flNoSuchExport: true});
						}
					const message = "Can't call " + theName + " because the package " + parts.slice (0, -1).join (".") + " doesn't export " + theExportName + ".";
					throw new Error (message);
					}
				return (callHandler (theExports [exportKey], theArgs, theArgNames));
				}

			/*  8/24/26 by CC -- THE KERNEL'S ENTRY-POINT RULE, from
				langgetentrypoint in langvalue.c: when a top-level handler
				matches the name the script was called by, ONLY that handler
				runs. Loose code at the module's top level never executes on
				a call -- it is the naked test line, and it runs when the
				person runs the script, not when something calls it.
				dialog.threeWay carries dialog.alert (dialog.threeWay
				("Let's Have Fun!", ...)) at its top level, and running the
				whole module made every call to threeWay recurse into the
				test line until the run died. A script with no matching
				handler still runs whole -- the straight-code script, the
				kernel's foundbody path.  */

			var matchingStatement;
			theScript.parsedStatements.forEach (function (statement) {
				if ((matchingStatement === undefined) && (statement.op === "handler") && (String (statement.name).toLowerCase () === String (shortName).toLowerCase ())) {
					matchingStatement = statement;
					}
				});
			if (matchingStatement !== undefined) {
				evaluate ([matchingStatement], environment); //binds the one handler, runs nothing else
				return (callHandler (moduleFrame.vars [findKey (moduleFrame.vars, shortName)], theArgs, theArgNames));
				}

			const statements = moduleStatementsOf (theScript.parsedStatements); //the 7/27 and 9/4 rules, kept in moduleStatementsOf above
			const moduleValue = evaluate (statements, environment);

			var handlerKey = findKey (moduleFrame.vars, shortName);
			
			if (handlerKey === undefined) {
				const handlerNames = [];
				Object.keys (moduleFrame.vars).forEach (function (key) {
					const value = moduleFrame.vars [key];
					if ((value !== undefined) && (value.flHandler === true)) {
						handlerNames.push (key);
						}
					});
				const theExports = moduleFrame.vars.exports; //10/6/26 by CC -- a package called by its own name: say so, and name what it exports. DW's find on 0.4.104, helloWorld ("Dave") instead of helloWorld.greet ("Dave")
				if ((theExports !== undefined) && (theExports !== null) && (typeof theExports === "object")) {
					const exportNames = [];
					Object.keys (theExports).forEach (function (key) {
						if ((theExports [key] !== undefined) && (theExports [key] !== null) && (theExports [key].flHandler === true)) {
							exportNames.push (key);
							}
						});
					if (exportNames.length > 0) {
						const message = "Can't call " + theName + " because it's a package; call one of its exports: " + exportNames.join (", ") + ".";
						throw new Error (message);
						}
					}
				if (handlerNames.length === 1) {
					handlerKey = handlerNames [0];
					}
				else {
					if (handlerNames.length === 0) { //a straight-code script: the module run was the call
						return (moduleValue);
						}
					}
				}
			
			if (handlerKey === undefined) {
				const otherNames = [];
				Object.keys (moduleFrame.vars).forEach (function (key) {
					const value = moduleFrame.vars [key];
					if ((value !== undefined) && (value.flHandler === true)) {
						otherNames.push (key);
						}
					});
				const message = "Can’t call “" + theName + "” because the only script it contains is named “" + otherNames.join ("”, “") + "”"; //the kernel's own words -- Lang Errors [3] in lang.r
				throw new Error (message);
				}
			
			return (callHandler (moduleFrame.vars [handlerKey], theArgs, theArgNames));
			}
		catch (err) {
			if (err.flReturnSignal) { //a straight-code script returning at the top level
				return (err.value);
				}
			if ((process.env.USERTALK_ERROR_TRAIL !== undefined) && (err !== null) && (typeof err === "object") && (err.flBreakSignal !== true) && (err.flContinueSignal !== true)) { //9/21/26 by CC -- a bench aid for the Manila work, off unless the variable is set: the scripts an error passed through on its way out, innermost first. A 500 from the webserver says what went wrong and not where
				var theTrailText = "";
				if (err.flTrailStarted !== true) {
					err.flTrailStarted = true;
					theTrailText += "error trail: " + err.message + "\n";
					}
				theTrailText += "   in " + theName + "\n";
				if (process.env.USERTALK_ERROR_TRAIL.indexOf ("/") === -1) {
					process.stdout.write (theTrailText);
					}
				else { //a file path: the trail goes there, since most errors are caught by a try and the log fills with them
					try {
						require ("fs").appendFileSync (process.env.USERTALK_ERROR_TRAIL, theTrailText);
						}
					catch (errWrite) {
						}
					}
				}
			err.flRethrow = true;
			throw err;
			}
		finally {
			environment.frames = savedFrames;
			environment.scriptAddresses.pop ();
			}
		}
	
	function findValueHome (theValue) {
		/*  7/28/26 by CC -- find the table that holds this exact value, for
			parentOf on a bare value. One full walk builds an identity map;
			later calls answer from it, and a miss rebuilds once, since the
			odb keeps changing.  */
		function buildIndex () {
			const map = new WeakMap ();
			const visited = new Set ();
			function walk (theTable, thePath) {
				if (visited.has (theTable)) {
					return;
					}
				visited.add (theTable);
				Object.keys (theTable).forEach (function (key) {
					const child = theTable [key];
					const childPath = (thePath === "") ? key : thePath + "." + key;
					if ((child !== null) && (typeof child === "object")) {
						if (!map.has (child)) {
							map.set (child, {container: theTable, containerPath: thePath, ownPath: childPath});
							}
						if ((child.flOdbScript === undefined) && (child.flAddress === undefined) && (!Array.isArray (child)) && (child.type === undefined)) {
							walk (child, childPath);
							}
						}
					});
				}
			walk (environment.odb, "");
			return (map);
			}
		if (environment.parentIndex === undefined) {
			environment.parentIndex = buildIndex ();
			}
		var found = environment.parentIndex.get (theValue);
		if (found === undefined) {
			environment.parentIndex = buildIndex ();
			found = environment.parentIndex.get (theValue);
			}
		return (found);
		}
	
	/*  7/28/26 by CC -- the macro processor reaches the evaluator through
		the environment: run parsed statements with extra tables in scope,
		innermost last.  */
	environment.evaluateWithScopes = function (theStatements, theScopeTables) {
		theScopeTables.forEach (function (scopeTable) {
			environment.withPaths.push (scopeTable);
			});
		environment.frames.push ({vars: {}});
		try {
			return (evaluate (theStatements, environment));
			}
		catch (signal) {
			if (signal.flReturnSignal) {
				return (signal.value);
				}
			throw signal;
			}
		finally {
			environment.frames.pop ();
			theScopeTables.forEach (function () {
				environment.withPaths.pop ();
				});
			}
		};
	
	/*  7/27/26 by CC -- the kernel's callScript reaches the evaluator
		through the environment: run a script value with args, optionally
		with a table in scope the way callScript's third parameter works.  */
	environment.callScriptValue = function (theScript, theArgs, theScopeTable, theAddress) {
		if (theScopeTable !== undefined) {
			environment.withPaths.push (theScopeTable);
			}
		try {
			return (callOdbScript (theScript, theArgs, "callScript", undefined, theAddress));
			}
		finally {
			if (theScopeTable !== undefined) {
				environment.withPaths.pop ();
				}
			}
		};
	
	function currentFrame () {
		if (environment.frames.length === 0) {
			environment.frames.push ({vars: {}});
			}
		return (environment.frames [environment.frames.length - 1]);
		}
	
	function runBody (theBody) {

		/*  8/24/26 by CC -- every caller assigns the answer to lastValue,
			because in the kernel every statement generates a value and the
			list's value is the last one generated (evaluatelist's own
			comment in langevaluate.c). An if branch, a try, a case body all
			pass their last value up -- which is why the glue for date ()
			can end on "try kernelcall (val)" and the date comes out. Ours
			dropped those values, so date () of a string answered nothing,
			quietly, since the beginning.  */

		/*  10/4/26 by CC -- A STATEMENT LIST THAT DECLARES A LOCAL GETS A FRAME OF
			ITS OWN. evaluatelist (langevaluate.c, 7/10/90 DW: "allocate a
			local table for every level") pre-scans the list for localop and
			moduleop and pushes a symbol table when it finds one; the table is
			chained inside the enclosing one and released when the list ends.
			So a bundle's local lives in the bundle, a loop body's local is new
			every time around, and an undeclared name assigned there is the
			enclosing level's when the list declares nothing. Until tonight a
			bundle's local landed in the handler's one frame and stayed: the
			startupScript's local (f = ...frontierStartupCommands.txt) was the f
			that "with user.databases [i]" read later -- colinf, helloFrontier
			issue 5, 10/4. A list with no local or handler of its own runs in
			the enclosing frame, as the kernel does.  */

		if (flBodyDeclaresLocals (theBody)) {
			environment.frames.push ({vars: {}});
			try {
				return (evaluate (theBody, environment));
				}
			finally {
				environment.frames.pop ();
				}
			}
		return (evaluate (theBody, environment));
		}

	function flBodyDeclaresLocals (theBody) { //the kernel's pre-scan: a local or a handler at the list's own level; a line of statements joined by semicolons is the same level
		if (theBody.flDeclaresLocals === undefined) {
			var flFound = false;
			function look (theStatements) {
				theStatements.forEach (function (statement) {
					if ((statement.op === "local") || (statement.op === "handler")) {
						flFound = true;
						}
					else {
						if (statement.op === "sequence") {
							look (statement.statements);
							}
						}
					});
				}
			look (theBody);
			theBody.flDeclaresLocals = flFound; //kept on the parsed body, the way the kernel keeps its code
			}
		return (theBody.flDeclaresLocals);
		}

	//statements
	
	return (function evaluateStatements (theStatements) {
	
	var lastValue;
	
	theStatements.forEach (function (statement) {
		
		switch (statement.op) {
			
			case "noop":
				break;
			
			case "sequence":
				lastValue = evaluate (statement.statements, environment);
				break;
			
			case "handler": {
				const handlerRec = {
					flHandler: true,
					name: statement.name,
					params: statement.params,
					body: statement.body,
					closureFrames: environment.frames.slice ()
					};
				currentFrame ().vars [statement.name] = handlerRec;
				break;
				}
			
			case "local": case "global": {
				statement.inits.forEach (function (init) {
					var value;
					if (init.value !== undefined) {
						value = evalExpr (init.value);
						}
					if (statement.op === "local") {
						const theFrame = currentFrame ();
						theFrame.vars [init.name] = tableValueForALocal (value); //9/21/26 by CC -- a table is a value: the local gets its own copy
						if ((init.value !== undefined) && (init.value.op === "new")) { //10/6/26 by CC -- local (c = new X (args)): the instance is in the local now, so init runs with this = @c
							callPackageInit (init.value, {flAddress: true, pathText: init.name, reference: {
								get: function () {
									return (theFrame.vars [init.name]);
									},
								set: function (theValue) {
									theFrame.vars [init.name] = theValue;
									}
								}});
							}
						}
					else {
						if (findKey (environment.odb, init.name) === undefined) {
							environment.odb [init.name] = value;
							}
						}
					});
				break;
				}
			
			case "assign": {
				const theValue = evalExpr (statement.value);
				const theReference = referenceForNode (statement.target);
				
				/*  8/18/26 by CC -- DW's rule, in his words: "you've encountered
					an = operator. you look at the left. is it a table? if not
					continue. then look at the right, if it's a table do it, if
					it's scalar or an outline, error." The guard is on this
					operator and nothing else -- table.assign and new replace a
					table on purpose, "which is what you do when you know what
					you're doing," and they go through untouched.
					
					The bug it closes: a typo, or his own workspace = workspace,
					silently emptied a table and everything under it.  */
				
				var theExisting;
				try {
					theExisting = theReference.get ();
					}
				catch (err) {
					theExisting = undefined; //nothing there yet, so there is nothing to protect
					}
				/*  8/19/26 by CC -- and an ADDRESS goes through. His rule names
					what errors -- "if it's scalar or an outline, error" -- and
					an address is neither. His own nodeEditorSuite.uploadScripts
					has done exactly this since 12/6/19: nodeEditorSuite.data
					.adrparent = adrparent, where the slot already holds one.  */
				
				const flAddressValue = ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true));
				if (flTableValue (theExisting) && !flTableValue (theValue) && !flAddressValue) {
					const message = "Can't assign to " + pathTextForNode (statement.target) + " because it's a table, and only another table can replace a table.";
					throw new Error (message);
					}
				
				theReference.set (flDatabaseReference (theReference) ? theValue : tableValueForALocal (theValue)); //9/21/26 by CC -- a table is a value; see tableValueForALocal. Into the database the store copies on its own (and knows a table written onto itself, 8/17)
				lastValue = theValue; //8/14/26 by CC -- an assignment answers the value, DW: "it's reaffirming that something happened"
				if (statement.value.op === "new") { //10/6/26 by CC -- scratchpad.feedland = new X (args): the instance is at the address now, so init runs with this = @scratchpad.feedland
					callPackageInit (statement.value, {flAddress: true, pathText: pathTextForNode (statement.target), reference: theReference});
					}
				break;
				}
			
			case "expression":
				lastValue = evalExpr (statement.expr);
				break;
			
			case "if":
				if (flTrue (evalExpr (statement.test))) {
					lastValue = runBody (statement.body);
					}
				else {
					if (statement.elseBody !== undefined) {
						lastValue = runBody (statement.elseBody);
						}
					}
				break;
			
			case "loop": case "loop3": case "while": {
				
				/*  8/17/26 by CC -- no iteration cap, DW's ruling (the same one
					that removed the verb-call cap): a runaway loop is stopped by
					the person -- the Kill button in the app, cmd-period's heir --
					not by a counter. The dry-run harness is the one place a
					bound still makes sense (dry answers make some loops
					bottomless), so it asks for one through the environment;
					nothing else sets it.  */
				
				var guard = 0;
				
				if (statement.op === "loop3") {
					evaluate ([statement.init], environment);
					}
				
				var count;
				if ((statement.op === "loop") && (statement.count !== undefined)) {
					count = evalExpr (statement.count);
					}
				
				while (true) {
					guard++;
					if ((environment.maxLoopIterations !== undefined) && (guard > environment.maxLoopIterations)) {
						const message = "Can't finish the loop because it ran " + environment.maxLoopIterations + " times.";
						throw new Error (message);
						}
					if ((count !== undefined) && (guard > count)) {
						break;
						}
					if ((statement.op === "while") && !flTrue (evalExpr (statement.test))) {
						break;
						}
					if ((statement.op === "loop3") && !flTrue (evalExpr (statement.test))) {
						break;
						}
					try {
						lastValue = runBody (statement.body);
						}
					catch (signal) {
						if (signal.flBreakSignal) {
							break;
							}
						if (!signal.flContinueSignal) {
							throw signal;
							}
						}
					if (statement.op === "loop3") {
						evaluate ([statement.step], environment);
						}
					}
				break;
				}
			
			case "for": {
				const from = evalExpr (statement.from);
				const limit = evalExpr (statement.limit);
				const flCharCounter = flCharValue (from); //8/26/26 by CC -- for ch = 'a' to 'z': the counter keeps its type
				var counter = from;
				while (statement.flDown ? (counter >= limit) : (counter <= limit)) {
					currentFrame ().vars [statement.name] = counter;
					try {
						lastValue = runBody (statement.body);
						}
					catch (signal) {
						if (signal.flBreakSignal) {
							break;
							}
						if (!signal.flContinueSignal) {
							throw signal;
							}
						}
					counter = statement.flDown ? counter - 1 : counter + 1;
					if (flCharCounter) {
						counter = makeChar (counter);
						}
					}
				break;
				}
			
			case "forin": {
				const list = evalExpr (statement.list);
				var items = list;
				if ((list !== undefined) && (list.flAddress === true)) {
					/*  7/27/26 by CC -- for adr in @table yields the ADDRESS of
						each entry, the way Frontier does: the body says adr^
						for the value and nameOf (adr^) for the entry's name.  */
					items = [];
					const table = list.reference.get ();
					sortedTableKeys (table).forEach (function (key) { //Frontier tables walk in sorted order
						items.push ({
							flAddress: true,
							pathText: list.pathText + "." + addressPartText (key), //9/6/26 by CC -- for adr in @adrdata^.roots: nameOf (adr^) said "root" for the entry named frontier.root
							nameText: key,
							reference: {
								get: function () {
									return (table [key]);
									},
								set: function (theValue) {
									table [key] = theValue;
									},
								remove: function () {
									delete table [key];
									}
								}
							});
						});
					}
				var flBroke = false;
				items.forEach (function (item) {
					if (flBroke) {
						return;
						}
					currentFrame ().vars [statement.name] = item;
					try {
						lastValue = runBody (statement.body);
						}
					catch (signal) {
						if (signal.flBreakSignal) {
							flBroke = true;
							return;
							}
						if (!signal.flContinueSignal) {
							throw signal;
							}
						}
					});
				break;
				}
			
			case "fileloop": {
				const folder = evalExpr (statement.folder);
				var depth = 1;
				if (statement.depth !== undefined) {
					depth = evalExpr (statement.depth);
					}
				const fileloopVerb = environment.verbs ["fileloop.list"];
				if (fileloopVerb === undefined) {
					const message = "Can't run the fileloop because no fileloop.list verb is installed.";
					throw new Error (message);
					}
				const paths = fileloopVerb ([folder, depth], environment);
				var flBroke = false;
				paths.forEach (function (thePath) {
					if (flBroke) {
						return;
						}
					currentFrame ().vars [statement.name] = thePath;
					try {
						lastValue = runBody (statement.body);
						}
					catch (signal) {
						if (signal.flBreakSignal) {
							flBroke = true;
							return;
							}
						if (!signal.flContinueSignal) {
							throw signal;
							}
						}
					});
				break;
				}
			
			case "bundle":
				lastValue = runBody (statement.body);
				break;
			
			case "with": {
				
				/*  8/9/26 by CC -- with takes a LIST of tables: "with a, b"
					searches a first, then b. Found by
					worldOutlineSuite.processMacros, which scopes over the
					builtin macros and the user macros in one statement.

					10/4/26 by CC -- A WITH IS A LEVEL OF THE CHAIN. evaluatewith
					(langevaluate.c) makes a local table, puts the with's tables
					in it as with values and hands it to evaluatelist as the
					body's symbol table; langfindsymbol searches a level's own
					names, then its with values, then steps outward. Here the
					with pushes a frame carrying its tables (referenceForId walks
					it the same way) instead of pushing onto withPaths, which came
					after every frame -- so a local declared OUTSIDE the with no
					longer hides a name in the with's table. The frame is also
					where an undeclared name assigned inside the with lands, the
					kernel's "undeclared variables assumed to be local".  */

				const statementPaths = (statement.paths === undefined) ? [statement.path] : statement.paths;
				const theWithTables = []; //in the order written
				statementPaths.forEach (function (thePath) {
					const table = evalExpr (thePath);
					var withTable = table;
					if ((table !== undefined) && (table !== null) && (table.flAddress === true)) {
						withTable = table.reference.get ();
						}
					theWithTables.push (withTable);
					});
				environment.frames.push ({vars: {}, withTables: theWithTables});
				try {
					lastValue = runBody (statement.body);
					}
				finally {
					environment.frames.pop ();
					}
				break;
				}
			
			case "try":
				try {
					lastValue = runBody (statement.body);
					}
				catch (signal) {
					if (signal.flBreakSignal || signal.flContinueSignal || signal.flReturnSignal) {
						throw signal;
						}
					currentFrame ().vars ["tryerror"] = signal.message;
					if (statement.elseBody !== undefined) {
						lastValue = runBody (statement.elseBody);
						}
					}
				break;
			
			case "case": {
				const value = evalExpr (statement.value);
				var ixMatched = -1;
				statement.clauses.forEach (function (clause, ixClause) {
					if (ixMatched !== -1) {
						return;
						}
					const pair = coerceForCompare (value, evalExpr (clause.value));
					if (pair.left == pair.right) {
						ixMatched = ixClause;
						}
					});
				if (ixMatched === -1) {
					if (statement.elseBody !== undefined) {
						lastValue = runBody (statement.elseBody);
						}
					}
				else {
					/*  7/27/26 by CC -- consecutive clause values share the body
						below them: a matched clause with an empty body runs the
						next clause's body, the way "WinNT" and "Win95" share one
						branch all over the corpus.  */
					var ixBody = ixMatched;
					while ((ixBody < statement.clauses.length) && (statement.clauses [ixBody].body.length === 0)) {
						ixBody++;
						}
					if (ixBody < statement.clauses.length) {
						lastValue = runBody (statement.clauses [ixBody].body);
						}
					}
				break;
				}
			
			case "return":
				throw new ReturnSignal (statement.value === undefined ? undefined : evalExpr (statement.value));
			
			case "break":
				throw new BreakSignal ();
			
			case "continue":
				throw new ContinueSignal ();
			
			default: {
				const message = "Can't run the statement because the operator " + statement.op + " isn't implemented.";
				throw new Error (message);
				}
			}
		});
	
	return (lastValue);
	});
	}

function evaluate (theStatements, environment) {
	if (environment.evaluator === undefined) {
		environment.evaluator = makeEvaluator (environment);
		}
	return (environment.evaluator (theStatements));
	}

/*  8/17/26 by CC -- A `return` AT THE TOP LEVEL ANSWERS ITS VALUE. It threw a
	return signal that nothing above it caught, and the signal isn't an Error,
	so it came back to the person as a failure with no message at all -- an
	empty {} from the server. A script whose last act is `return (x)` is
	ordinary UserTalk; it answers x now. (Pre-existing; marin running the
	night-before's code fails the same way.)  */

function evaluateAndAnswer (theStatements, environment) {
	try {
		return (evaluate (theStatements, environment));
		}
	catch (theSignal) {
		if ((theSignal !== undefined) && (theSignal !== null) && (theSignal.flReturnSignal === true)) {
			return (theSignal.value);
			}
		throw theSignal;
		}
	}

exports.makeEnvironment = makeEnvironment;
exports.evaluate = evaluateAndAnswer;
exports.evaluateStatements = evaluate; //the raw form, for callers that handle the signals themselves
exports.findKey = findKey;
