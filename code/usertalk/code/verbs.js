/*  The verb library for the UserTalk interpreter prototype: real file
	verbs over Node fs behind a Mac-colon-path map, the string and clock
	verbs the build scripts use, and loud trace-only stubs for the rest.
	
	Unimplemented verbs fail loudly -- nothing silently succeeds.
	
	by CC, 7/27/26 */

const fs = require ("fs");
const path = require ("path");
const {execFileSync} = require ("child_process"); //8/5/26 by CC -- the S3 verbs run a helper, see s3helper.js
const dates = require ("./dates.js");
const charvalue = require ("./charvalue.js"); //8/26/26 by CC -- the char type, DW's go-ahead //8/13/26 by CC -- Frontier's date-and-time text forms, shared with evaluate.js
const os = require ("os"); //8/17/26 by CC -- clock.ticks counts from when the machine booted, the way TickCount does
const cryptoTool = require ("crypto"); //8/23/26 by CC -- the kernel's crypt verbs (9/5/26), which is what signs an S3 request
const localAddresses = require ("./localAddresses.js"); //9/21/26 by CC -- the address of a local table, kept good while it sits in the database
const odbHome = require ("./odbHome.js"); //8/22/26 by CC -- the unpack verb needs frontierodb and the shape converter

const whenMachineBooted = Date.now () - (os.uptime () * 1000);

function makeVerbs (thePathMap, theTrace) {
	
	/*  8/15/26 by CC -- the corral is an option now, DW's ruling: "only on
		desktop, but in general it should be an option -- and on the server
		you'd set it true and on the desktop false." A Frontier running on
		the machine in front of you writes where the script says; a Frontier
		on a droplet must not. flCorralPaths in the config's pathMap, and a
		config that doesn't mention it keeps the corral.
		
		With the corral off a colon path means what Frontier always meant by
		it: the first segment names a volume, and every volume on a Mac is
		reachable at /Volumes -- the boot disk included, where /Volumes/
		Macintosh HD is a symlink to /. A path that's already posix (it
		starts with a slash) is left alone.  */
	
	function realFromColonPath (theColonPath) {
		if (theColonPath.indexOf ("/") === 0) {
			return (theColonPath);
			}
		var theRest = theColonPath;
		if (theRest.endsWith (":")) {
			theRest = theRest.slice (0, theRest.length - 1);
			}
		const segments = theRest.split (":");
		segments.forEach (function (segment) {
			if (segment === "..") {
				const message = "Can't map the path " + theColonPath + " because a path can't contain \"..\".";
				throw new Error (message);
				}
			});
		const theVolume = segments.shift ();
		return (path.join ("/Volumes", theVolume, segments.join ("/")));
		}
	
	function macToReal (theColonPath) {
		theColonPath = String (theColonPath); //filespecs coerce to their path
		if (thePathMap.flCorralPaths === false) {
			return (realFromColonPath (theColonPath));
			}
		var found, foundReal;
		Object.keys (thePathMap.prefixes).forEach (function (prefix) {
			if (theColonPath.toLowerCase ().indexOf (prefix.toLowerCase ()) === 0) {
				if ((found === undefined) || (prefix.length > found.length)) {
					found = prefix;
					foundReal = thePathMap.prefixes [prefix];
					}
				}
			});
		if (found === undefined) {
			const message = "Can't map the path " + theColonPath + " because no prefix in the path map covers it.";
			throw new Error (message);
			}
		var rest = theColonPath.slice (found.length);
		if (rest.indexOf (":") === 0) {
			rest = rest.slice (1);
			}
		if (rest.endsWith (":")) {
			rest = rest.slice (0, rest.length - 1);
			}
		rest.split (":").forEach (function (segment) { //8/4/26 by CC -- a ".." segment would walk out of the mapped folder
			if (segment === "..") {
				const message = "Can't map the path " + theColonPath + " because it steps outside its folder.";
				throw new Error (message);
				}
			});
		return (path.join (foundReal, rest.split (":").join ("/")));
		}
	
	/*  8/17/26 by CC -- the other direction: a real path back to the colon
		path a script says. With the corral off it's the volume form Frontier
		always used; with it on, the prefix that covers the folder is put back
		the way macToReal took it off.  */
	
	function realToColon (theRealPath) {
		if (thePathMap.flCorralPaths === false) {
			var theRest = theRealPath;
			if (theRest.indexOf ("/Volumes/") === 0) {
				theRest = theRest.slice ("/Volumes/".length);
				return (theRest.split ("/").join (":"));
				}
			return ("Macintosh HD:" + theRest.replace (/^\//, "").split ("/").join (":"));
			}
		var theAnswer;
		Object.keys (thePathMap.prefixes).forEach (function (thePrefix) {
			const theFolder = thePathMap.prefixes [thePrefix];
			if ((theAnswer === undefined) && (theRealPath.indexOf (theFolder) === 0)) {
				const theRest = theRealPath.slice (theFolder.length).replace (/^\//, "");
				theAnswer = thePrefix + ((theRest.length === 0) ? "" : (":" + theRest.split ("/").join (":")));
				}
			});
		if (theAnswer === undefined) {
			const message = "Can't say what " + theRealPath + " is called because no prefix in the path map covers it.";
			throw new Error (message);
			}
		return (theAnswer);
		}
	
	const theOpenFiles = {}; //8/17/26 by CC -- assigned by file.open, read by file.read/write/position, cleared by file.close
	
	const verbs = {};
	
	//file verbs
	
	verbs ["file.copy"] = function (args) {
	
		/*  8/17/26 by CC -- a FOLDER copies too, everything in it, which is
			what Frontier's copy does (its glue routes through filteredCopy
			with a filter that says yes to everything). Ours did single files
			only and threw on a folder.  */
		
		const theSource = macToReal (args [0]);
		const theDest = macToReal (args [1]);
		if (fs.statSync (theSource).isDirectory ()) {
			fs.cpSync (theSource, theDest, {recursive: true});
			return (true);
			}
		fs.copyFileSync (theSource, theDest);
		return (true);
		};
	
	verbs ["file.surefilepath"] = function (args) {
		const dest = macToReal (args [0]);
		fs.mkdirSync (path.dirname (dest), {recursive: true});
		return (true);
		};
	
	verbs ["file.surefolder"] = function (args) {
		fs.mkdirSync (macToReal (args [0]), {recursive: true});
		return (true);
		};
	
	verbs ["file.exists"] = function (args) {
		return (fs.existsSync (macToReal (args [0])));
		};
	
	verbs ["file.isfolder"] = function (args) {

		/*  8/24/26 by CC -- a missing path is an ERROR, not a false:
			fileisfolder in the kernel (fileops.m) fails when filegetinfo
			can't find the file, and file.sureFolder's own glue depends on
			the throw -- its try catches the error and creates the folder;
			a quiet false fell through to "is an existing file" instead.  */

		const thePath = macToReal (args [0]);
		if (!fs.existsSync (thePath)) {
			const message = "There is no file or folder named “" + String (args [0]) + "”."; //left double quote, right double quote
			throw new Error (message);
			}
		return (fs.statSync (thePath).isDirectory ());
		};
	
	verbs ["file.readwholefile"] = function (args) {
		return (fs.readFileSync (macToReal (args [0]), "latin1"));
		};
	
	verbs ["file.writewholefile"] = function (args, environment) {
	
		/*  8/17/26 by CC -- three ways this differed from Frontier's, which is
			a GLUE script (file.writeWholeFile): (1) ours quietly made the
			folders on the way, so a script with a typo in its path created the
			typo instead of failing -- sureFilePath is the verb whose job that
			is; (2) an existing file's CREATION DATE is kept, the way the glue
			keeps it; (3) the callbacks in user.callbacks.fileWriteWholeFile
			run after the write. The type and creator parameters are accepted
			and do nothing, the way they do nothing on this machine.  */
		
		const theDest = macToReal (args [0]);
		const flExisted = fs.existsSync (theDest);
		var whenCreated;
		if (flExisted) {
			whenCreated = fs.statSync (theDest).birthtime;
			}
		if ((args [4] !== undefined) && (args [4] !== null)) {
			whenCreated = new Date (args [4]);
			}
		fs.writeFileSync (theDest, String (args [1]), "latin1");
		if (whenCreated !== undefined) {
			try {
				fs.utimesSync (theDest, whenCreated, fs.statSync (theDest).mtime);
				}
			catch (err) {
				}
			}
		if ((environment !== undefined) && (environment.odb !== undefined)) {
			const theUser = environment.odb.user;
			if ((theUser !== undefined) && (theUser !== null) && (theUser.callbacks !== undefined) && (theUser.callbacks !== null)) {
				const theCallbacks = theUser.callbacks.fileWriteWholeFile;
				if ((theCallbacks !== undefined) && (theCallbacks !== null) && (typeof theCallbacks === "object")) {
					Object.keys (theCallbacks).forEach (function (theName) {
						const theScript = theCallbacks [theName];
						if ((theScript !== undefined) && (theScript !== null) && (theScript.flOdbScript === true) && (environment.callScriptValue !== undefined)) {
							try {
								environment.callScriptValue (theScript, [String (args [0])]);
								}
							catch (err) {
								}
							}
						});
					}
				}
			}
		return (true);
		};
	
	verbs ["file.delete"] = function (args) {
	
		/*  8/17/26 by CC -- the kernel deletes a FILE, or an EMPTY folder, and
			errors when there's nothing there. Ours took the whole folder and
			everything inside it and answered true for a name that didn't
			exist -- a recursive delete hiding inside a verb scripts call
			casually.  */
		
		const thePath = macToReal (args [0]);
		if (!fs.existsSync (thePath)) {
			const message = "Can't delete " + args [0] + " because there is no file with that name.";
			throw new Error (message);
			}
		if (fs.statSync (thePath).isDirectory ()) {
			fs.rmdirSync (thePath); //throws when the folder still has things in it, which is what the kernel does
			return (true);
			}
		fs.unlinkSync (thePath);
		return (true);
		};
	
	verbs ["file.filefrompath"] = function (args) {
		var theColonPath = String (args [0]);
		if (theColonPath.endsWith (":")) {
			theColonPath = theColonPath.slice (0, theColonPath.length - 1);
			}
		const parts = theColonPath.split (":");
		return (parts [parts.length - 1]);
		};
	
	verbs ["file.folderfrompath"] = function (args) {
		var theColonPath = String (args [0]);
		if (theColonPath.endsWith (":")) {
			theColonPath = theColonPath.slice (0, theColonPath.length - 1);
			}
		const ixLast = theColonPath.lastIndexOf (":");
		return (theColonPath.slice (0, ixLast + 1));
		};
	
	verbs ["file.modified"] = function (args) {
		return (fs.statSync (macToReal (args [0])).mtime);
		};
	
	verbs ["fileloop.list"] = function (args) { //the interpreter's fileloop support: colon paths of everything in the folder
		const folderColon = String (args [0]);
		const depth = args [1];
		const folderReal = macToReal (folderColon);
		const result = [];
		function visit (realFolder, colonFolder, level) {
			fs.readdirSync (realFolder).forEach (function (fname) {
				const realChild = path.join (realFolder, fname);
				const flFolder = fs.statSync (realChild).isDirectory ();
				const colonChild = colonFolder + fname + (flFolder ? ":" : "");
				result.push (colonChild);
				if (flFolder && ((depth === Infinity) || (level < depth))) {
					visit (realChild, colonChild, level + 1);
					}
				});
			}
		var colonBase = folderColon;
		if (!colonBase.endsWith (":")) {
			colonBase += ":";
			}
		visit (folderReal, colonBase, 1);
		return (result);
		};
	
	/*  8/20/26 by CC -- the bit verbs, from langverbs.c. Every one of them
		works on an unsigned 32-bit long -- getbitparams takes the number as
		a long and the bit as a short and raises an error above 31, and each
		verb answers with the unsigned result. The >>> 0 is how JavaScript
		says unsigned; without it the results above 2^31 come back negative.
		
		His OAuth signing and his S3 client both run on bit.logicalXor.  */
	
	/*  8/23/26 by CC -- A ONE-CHARACTER STRING IS ITS CHARACTER CODE HERE.
		Frontier has a char value type of its own and coerces it to a long by
		taking the code; we have no char type, so char (0x36) comes back as
		the ordinary string "6" and Number () read it as six rather than
		fifty-four. That is what broke the HMAC that signs every S3 request:
		OAuth.getHmac XORs the key against char (0x36) and char (0x5c) a byte
		at a time, and it was XORing against 6 and 0.

		Bit verbs take longs in Frontier and nothing sensible passes them
		text, so a single character here means its code. WHERE THIS STILL
		DIFFERS FROM FRONTIER: a genuine one-character string of a digit --
		bit.logicalXor ("6", 3) -- answers on 54 where Frontier would parse
		the string and answer on 6. The real fix is a char type, which is a
		change to the language and DW's call.  */

	function unsignedLong (theValue) {

		/*  8/26/26 by CC -- the 8/23 special case that read a one-character
			STRING as its code came out with the char type: a char answers
			its code through Number () on its own, and a string of a digit
			reads as the number it spells, the way stringtolong reads it.
			bit.logicalXor ("6", 3) answers 5 now, and with char (0x36) it
			answers 53 -- both the kernel's answers.  */

		return (Number (theValue) >>> 0);
		}
	
	function bitNumber (theValue, theVerbName) {
		const theNumber = Number (theValue);
		if ((theNumber < 0) || (theNumber > 31)) {
			const message = "Can't do " + theVerbName + " with a bit number of " + theNumber + " because a long has 32 bits, numbered 0 through 31.";
			throw new Error (message);
			}
		return (theNumber);
		}
	
	verbs ["bit.get"] = function (args) {
		return (((unsignedLong (args [0]) >>> bitNumber (args [1], "bit.get")) & 1) === 1);
		};
	
	verbs ["bit.set"] = function (args) {
		return ((unsignedLong (args [0]) | (1 << bitNumber (args [1], "bit.set"))) >>> 0);
		};
	
	verbs ["bit.clear"] = function (args) {
		return ((unsignedLong (args [0]) & (~(1 << bitNumber (args [1], "bit.clear")))) >>> 0);
		};
	
	verbs ["bit.logicaland"] = function (args) {
		return ((unsignedLong (args [0]) & unsignedLong (args [1])) >>> 0);
		};
	
	verbs ["bit.logicalor"] = function (args) {
		return ((unsignedLong (args [0]) | unsignedLong (args [1])) >>> 0);
		};
	
	verbs ["bit.logicalxor"] = function (args) {
		return ((unsignedLong (args [0]) ^ unsignedLong (args [1])) >>> 0);
		};
	
	verbs ["bit.shiftleft"] = function (args) {
		return ((unsignedLong (args [0]) << bitNumber (args [1], "bit.shiftLeft")) >>> 0);
		};
	
	verbs ["bit.shiftright"] = function (args) {
		return ((unsignedLong (args [0]) >>> bitNumber (args [1], "bit.shiftRight")) >>> 0);
		};
	
	//string and value verbs
	
	function coerceText (theValue) {
		
		/*  8/13/26 by CC -- what a value looks like when a string verb takes
			it as text. A date reads the Frontier way -- clock.timeStamp's
			short form is string.replaceAll (clock.now (), year, shortyear),
			which came out as the JavaScript date until this. Everything else
			is String (), same as before. NOTE for the review: most string
			verbs still call String () directly; each is JS-formatted for
			dates until it goes through here.  */
		
		if (theValue instanceof Date) {
			return (dates.frontierDateToString (theValue));
			}
		return (String (theValue));
		}
	
	verbs ["string.replaceall"] = function (args) {
		return (coerceText (args [0]).split (coerceText (args [1])).join (coerceText (args [2])));
		};
	
	verbs ["string.replace"] = function (args) {
		return (coerceText (args [0]).replace (coerceText (args [1]), coerceText (args [2])));
		};
	
	verbs ["string.delete"] = function (args) { //1-based start, count
		const theString = String (args [0]);
		const ixStart = args [1] - 1;
		return (theString.slice (0, ixStart) + theString.slice (ixStart + args [2]));
		};
	
	verbs ["string.mid"] = function (args) { //1-based start, count
		return (String (args [0]).substr (args [1] - 1, args [2]));
		};
	
	verbs ["string.lower"] = function (args) {
		return (String (args [0]).toLowerCase ());
		};
	
	verbs ["string.upper"] = function (args) {
		return (String (args [0]).toUpperCase ());
		};
	
	verbs ["string.filledstring"] = function (args) {
		return (String (args [0]).repeat (args [1]));
		};
	
	verbs ["string.lastfield"] = function (args) {
		const parts = String (args [0]).split (String (args [1]));
		return (parts [parts.length - 1]);
		};
	
	verbs ["string.popsuffix"] = function (args) { //8/17/26 by CC -- the separator is a parameter, defaulting to a dot; ours had the dot wired in
		const theString = String (args [0]);
		const theSeparator = (args [1] === undefined) ? "." : String (args [1]);
		const ixFound = theString.lastIndexOf (theSeparator);
		if (ixFound === -1) {
			return (theString);
			}
		return (theString.slice (0, ixFound));
		};
	
	verbs ["string.countfields"] = function (args) {
		return (String (args [0]).split (String (args [1])).length);
		};
	
	verbs ["string.nthfield"] = function (args) {
		
		/*  8/19/26 by CC -- a field that isn't there is the EMPTY STRING, not
			nothing: grabnthfield sets the length to zero and hands back an
			empty handle. It answered undefined here, which turned his
			string.gigabyteString into "can't subscript" instead of the
			out-of-range error the kernel gives.  */
		
		const theField = String (args [0]).split (String (args [1])) [args [2] - 1];
		return ((theField === undefined) ? "" : theField);
		};
	
	verbs ["string.multiplereplaceall"] = function (args) {
		
		/*  8/4/26 by CC -- string.multipleReplaceAll (s, @table, flCaseSensitive, startCharacters, endCharacters).
			One replace-all per table entry, in sorted order, the search string
			built as start + entryName + end, the replacement the entry's value
			as a string. Semantics from the kernel's stringmultiplereplaceallverb:
			flCaseSensitive defaults true, and false means the match ignores case.  */
		
		var theString = String (args [0]);
		var theTable = args [1];
		if ((theTable !== undefined) && (theTable !== null) && (theTable.flAddress === true)) {
			theTable = theTable.reference.get ();
			}
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			const message = "Can't do the replacements because the second parameter isn't a table or the address of one.";
			throw new Error (message);
			}
		const flCaseSensitive = (args [2] === undefined) ? true : Boolean (args [2]);
		const startCharacters = (args [3] === undefined) ? "" : String (args [3]);
		const endCharacters = (args [4] === undefined) ? "" : String (args [4]);
		
		const sortedNames = Object.keys (theTable).sort (function (a, b) {
			return (a.toLowerCase () < b.toLowerCase () ? -1 : 1);
			});
		sortedNames.forEach (function (name) {
			const searchFor = startCharacters + name + endCharacters;
			if (searchFor.length === 0) {
				return;
				}
			const replaceWith = verbs ["string"] ([theTable [name]]);
			if (flCaseSensitive) {
				theString = theString.split (searchFor).join (replaceWith);
				}
			else {
				const lowerSearch = searchFor.toLowerCase ();
				var result = "";
				var rest = theString;
				var ixFound = rest.toLowerCase ().indexOf (lowerSearch);
				while (ixFound !== -1) {
					result += rest.slice (0, ixFound) + replaceWith;
					rest = rest.slice (ixFound + searchFor.length);
					ixFound = rest.toLowerCase ().indexOf (lowerSearch);
					}
				theString = result + rest;
				}
			});
		return (theString);
		};
	
	verbs ["string"] = function (args) {
		const theValue = args [0];
		if ((theValue === undefined) || (theValue === null)) { //9/25/26 by CC -- string (nil) is the empty string, coercetostring on novaluetype (langvalue.c); it answered the JavaScript word undefined
			return ("");
			}
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			/*  8/5/26 by CC -- string of an address is the path it names, the way
				Frontier prints an objspec. It was answering "[object Object]",
				and scripts test it: getCanonicalSiteName asks whether the site
				address string endsWith a known suffix.  */
			return (String (theValue.pathText));
			}
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbScript === true)) {
			/*  string of an outline or script is its text: each line at its
				depth in tabs, lines joined by returns.  */
			const textLines = [];
			theValue.lines.forEach (function (line) {
				if (line.flComment) {
					return;
					}
				var tabs = "";
				var ct = line.level;
				while (ct > 0) {
					tabs += "\t";
					ct--;
					}
				textLines.push (tabs + line.text);
				});
			return (textLines.join ("\r"));
			}
		if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- a char displays as its character, coercetostring's rule
			return (String (theValue));
			}
		if (theValue instanceof Date) {
			return (dates.frontierDateToString (theValue)); //8/13/26 by CC -- "8/13/2026; 11:14:22 AM", the kernel's timedatestring
			}
		return (String (theValue));
		};
	
	verbs ["number"] = function (args) {
	
		/*  8/17/26 by CC -- a DATE becomes the number Frontier means by it:
			seconds since 1 January 1904, the Mac's epoch. It used to answer
			JavaScript's milliseconds since 1970 -- DW found it benchmarking,
			his elapsed time came out a thousand times too big.  */
		
		if (args [0] instanceof Date) {
			return (dates.frontierSecondsFromDate (args [0]));
			}
		return (Number (args [0]));
		};
	
	verbs ["sizeof"] = function (args) {
		
		/*  8/15/26 by CC -- sizeof measures the CONTENT, not the wrapper. It
			used to count a value's JS keys, so every script answered 3
			(flOdbScript, scriptType, lines) and DW's Setup New Script asked
			"is not empty. Initialize it?" about a script with one empty
			headline. His ruling: "an outline with one empty headline is
			empty" -- its sizeof is 1, and his test is sizeof > 1.  */
		
		const theValue = args [0];
		if (typeof theValue === "string") {
			return (theValue.length);
			}
		if (Array.isArray (theValue)) {
			return (theValue.length);
			}
		if ((theValue !== undefined) && (theValue !== null) && (typeof theValue === "object")) {
			if (theValue.flAddress === true) { //9/12/26 by CC -- langgetvalsize (langops.c): an address's size is the length of its path string. It counted the address object's own keys, so copyAddressCommand's string.delete (s, 1, sizeof (adr^) + 1) cut five characters instead of a system.paths prefix (DW's 9/12 report on Copy Address)
				return (String (theValue.pathText).length);
				}
			if (theValue.flOdbAddressText === true) { //an address as the database stores it -- a system.paths entry read through adr^
				return (String (theValue.path).length);
				}
			if (((theValue.flOdbScript === true) || (theValue.flOdbMenubar === true)) && Array.isArray (theValue.lines)) {
				return (theValue.lines.length); //an outline, script or menubar: how many lines
				}
			if ((theValue.flWpText === true) && (typeof theValue.text === "string")) {
				return (theValue.text.length); //a wptext: how many characters
				}
			if ((theValue.type === "binary") && (theValue.flOdbSqlTable !== true)) { //9/29/26 by CC -- a binary: how many bytes. langgetvalsize (langops.c): gethandlesize (v.data.binaryvalue) - sizeof (OSType), "don't count key". It fell through to the table count and answered 3, the binary's own three fields, whatever its length -- found building html.getImageInfo
				return ((theValue.data === undefined) ? 0 : String (theValue.data).length);
				}
			var ctItems = 0; //a table: how many items, the bookkeeping keys not among them
			Object.keys (theValue).forEach (function (theName) {
				if ((theName !== "flOdbSqlTable") && (theName !== "odbId")) {
					ctItems++;
					}
				});
			return (ctItems);
			}
		return (0);
		};
	
	verbs ["defined"] = function (args) {
		return (args [0] !== undefined);
		};
	
	verbs ["typeof"] = function (args) {

		/*  8/24/26 by CC -- typeOf answers the four-character type code, the
			way the kernel's typefunc does (setostypevalue in langvalue.c):
			'scpt' for a script, 'tabl' for a table, 'mbar' for a menubar,
			from the typeinfo table in langops.c. It had answered long names
			of our own ("scripttype"), which broke every place the answer
			was written down -- the fat page objectType directive above all,
			which Berkeley refused. The language constants carry the same
			codes, so case statements compare true, exactly as before, just
			with the kernel's values on both sides.  */

		const theValue = args [0];
		if (theValue === undefined) {
			return ("????"); //unknown
			}
		if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- the char type
			return ("char");
			}
		if (typeof theValue === "string") {
			return ("TEXT");
			}
		if (typeof theValue === "number") {
			return (Number.isInteger (theValue) ? "long" : "doub");
			}
		if (typeof theValue === "boolean") {
			return ("bool");
			}
		if (theValue instanceof Number) { //a real double is a boxed Number here, since 8/19
			return ("doub");
			}
		if (theValue instanceof Date) {
			return ("date");
			}
		if (Array.isArray (theValue)) {
			return ("list");
			}
		if (theValue.flOdbScript === true) {
			return (theValue.scriptType === "outline" ? "optx" : "scpt");
			}
		if (theValue.flOdbMenubar === true) {
			return ("mbar");
			}
		if ((theValue.flAddress === true) || (theValue.flOdbAddressText === true)) { //8/23/26 by CC -- the second is one that came back out of the database
			return ("addr");
			}
		if (theValue.flFilespec === true) {
			return ("fss "); //string4s pad with a space
			}
		if (theValue.flWpText === true) {
			return ("wptx");
			}
		if (theValue.type === "binary") {
			return ("data");
			}
		if (theValue.type === "wptext") {
			return ("wptx");
			}
		return ("tabl");
		};
	
	verbs ["nameof"] = function (args, environment) { //the last component of an address's path
		var theValue = args [0];
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbAddressText === true) && (environment !== undefined)) { //9/25/26 by CC -- an address as the database stores it is made live first; see the evaluator's nameOf
			theValue = verbs ["lang.address"] ([String (theValue.path)], environment);
			}
		if ((theValue !== undefined) && (theValue.flAddress === true)) {
			if (theValue.nameText !== undefined) { //8/5/26 by CC -- the address carries its own name, because a name can contain dots
				return (theValue.nameText);
				}
			var parts;
			try { //9/21/26 by CC -- the last NAME, brackets and quotes off: split at every dot, ["dave@userland.com"] answered com"] and a parent found by its row answered the bracketed text
				parts = addressTextParts (String (theValue.pathText));
				}
			catch (err) {
				parts = String (theValue.pathText).split (".");
				}
			return ((parts.length === 0) ? "" : parts [parts.length - 1]);
			}

		/*  9/10/26 by CC -- nameOf (s^) WHERE s IS TEXT AND THE OBJECT ISN'T THERE.
			namefunc (langvalue.c) reads the address without dereferencing it,
			with errors disabled -- "any error will result in a null return" --
			and a name that isn't there answers the empty string. table.surePath
			(1997) opens with exactly that test, nameOf (s^) != "", to see whether
			the path already exists. Here the deref of a text address that names
			nothing handed the text through, nameOf answered the whole text, and
			surePath returned 0 without making a single table -- for every text
			path, plain or bracketed. Found under DW's 9/10 import of a part
			addressed by his config.root's path.  */

		if ((typeof theValue === "string") && (environment !== undefined)) {
			var theAddress;
			try {
				theAddress = addressFromText (theValue, environment);
				}
			catch (err) {
				return ("");
				}
			var theObject;
			try {
				theObject = theAddress.reference.get ();
				}
			catch (err) {
				theObject = undefined;
				}
			if (theObject === undefined) {
				return ("");
				}
			return ((theAddress.nameText !== undefined) ? theAddress.nameText : theValue);
			}
		return (String (theValue));
		};
	
	verbs ["msg"] = function (args, environment) { //7/27/26 by CC -- msg speaks: Frontier showed it to the user, we print it
		const theText = String (args [0]);
		if ((environment !== undefined) && (typeof environment.msgCallback === "function")) { //9/16/26 by CC -- the About window's message line, ccmsg in about.c; the server keeps it (trigger.js aboutMsg). Headless, with nobody to show it to, it still prints
			environment.msgCallback (theText);
			}
		else {
			console.log (theText);
			}
		return (true);
		};
	
	verbs ["new"] = function (args) { //new (tabletype, @adr) -- create an empty value at the address
		const theType = args [0];
		const theAddress = args [1];
		var value = {};
		if (theType === "list") {
			value = [];
			}
		if (theType === "TEXT") {
			value = "";
			}
		if (theType === "wptx") { //8/17/26 by CC -- new () made tables, lists, strings, outlines and scripts; the rest of the types had no way in
			value = makeWpText ("");
			}
		if (theType === "data") {
			value = verbs ["lang.binary"] ([""]);
			}
		if ((theType === "long") || (theType === "doub") || (theType === "shor")) {
			value = 0;
			}
		if (theType === "bool") {
			value = false;
			}
		if (theType === "date") {
			value = new Date ();
			}
		if (theType === "mbar") {
			value = {flOdbMenubar: true, lines: [{level: 0, text: "", flExpanded: false, flComment: false}]};
			}
		if ((theType === "optx") || (theType === "scpt")) {
			
			/*  8/12/26 by CC -- born with one blank line. There is no such
				thing in Frontier as an outline with no lines: the kernel's
				newoutlinerecord calls opnewsummit, whose comment reads
				"create a new, blank summit for the current outline," and it
				builds that line out of an empty string. A zero-line object
				opens a window with nowhere to put the cursor and nothing to
				type into, which is what DW hit on a new script.  */
			
			value = {
				flOdbScript: true,
				scriptType: (theType === "optx") ? "outline" : "script",
				lines: [{level: 0, text: "", flExpanded: false, flComment: false, flBreakpoint: false}]
				};
			}
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't create the new " + theType + " because the second parameter isn't an address.";
			throw new Error (message);
			}
		theAddress.reference.set (value);

		/*  8/23/26 by CC -- DW: "globals that deal with addresses, like edit,
			new, delete -- should return the address of the thing that was
			edited, created, deleted... esp useful if the value is a variable.
			also makes it possible when reading a sequence of one-liners to
			see that it worked." An address reads as its path in the deposit,
			so the one-liner now says WHERE the thing landed instead of just
			true.  */

		return (theAddress);
		};

	verbs ["edit"] = function (args, environment) {
	
		/*  8/17/26 by CC -- edit answers THE PREVIOUS TARGET and sets the
			target to what it opened, which is the whole point of the glue's
			`local (oldtarget = edit (adr))` shape. Ours answered true, so
			every script that saved the old target saved the boolean and put it
			back as the target later.  */
		
		const theOldTarget = verbs ["target.get"] ([], environment);
		if ((args [0] !== undefined) && (args [0] !== null) && (args [0].flAddress === true)) {
			verbs ["target.set"] ([args [0]], environment);
			}
		return (theOldTarget);
		};
	
	verbs ["delete"] = function (args) { //7/27/26 by CC -- delete (@table.entry)
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't delete the object because the parameter isn't an address.";
			throw new Error (message);
			}
		if (theAddress.reference.remove !== undefined) {
			theAddress.reference.remove ();
			}
		else {
			theAddress.reference.set (undefined);
			}
		return (theAddress); //8/23/26 by CC -- the address of what was deleted, his ruling; see the note in new
		};

	verbs ["script.newscriptobject"] = function (args) { //7/27/26 by CC -- source text to a script object at an address
		const theText = String (args [0]);
		const theAddress = args [1];
		const lines = [];
		theText.split (/\r\n|\r|\n/).forEach (function (lineText) {
			var level = 0;
			while (lineText.indexOf ("\t") === 0) {
				level++;
				lineText = lineText.slice (1);
				}
			lines.push ({level, text: lineText, flExpanded: true, flComment: false, flBreakpoint: false});
			});
		const theScript = {flOdbScript: true, scriptType: "script", lines};
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			return (theScript);
			}
		theAddress.reference.set (theScript);
		return (true);
		};
	
	verbs ["file.getpathchar"] = function (args) {
		return (":"); //Frontier's native path character
		};
	
	verbs ["file.getdatepath"] = function (args) { //8/10/26 by CC -- getDatePath (chseparator, theDate, flLastSeparator)
		/*  Changes
			8/10/26 by CC
				DW's own script, line for line -- system.verbs.builtins.file.getDatePath,
				which lives in his file table and never came through in the odb build.
				Four-digit year always, month and day padded to two, and
				flLastSeparator defaults to true: the days are usually folders,
				so the path ends with a separator unless the caller says the
				day names a file.  */
		const chSeparator = ((args [0] === undefined) || (args [0] === null)) ? verbs ["file.getpathchar"] ([]) : String (args [0]);
		const theDate = ((args [1] === undefined) || (args [1] === null)) ? new Date () : new Date (args [1]);
		const flLastSeparator = ((args [2] === undefined) || (args [2] === null)) ? true : (args [2] !== false);
		
		const year = String (theDate.getFullYear ());
		const month = verbs ["string.padwithzeros"] ([theDate.getMonth () + 1, 2]);
		const day = verbs ["string.padwithzeros"] ([theDate.getDate (), 2]);
		
		const thePath = year + chSeparator + month + chSeparator + day;
		if (flLastSeparator === true) {
			return (thePath + chSeparator);
			}
		return (thePath);
		};
	
	/*  8/20/26 by CC -- the two address conversions, from
		fwsNetEventAddressDecode and fwsNetEventAddressEncode in
		MacSocketNetEvents.c. They touch no network: a decode is
		htonl + inet_ntoa, which is the four bytes of a host-order long read
		high byte first, and an encode is the reverse. His tcp.dns verbs and
		his rootUpdates.update are written on top of them.  */
	
	verbs ["tcp.addressdecode"] = function (args) {
		const theAddress = Number (args [0]) >>> 0;
		return (((theAddress >>> 24) & 255) + "." + ((theAddress >>> 16) & 255) + "." + ((theAddress >>> 8) & 255) + "." + (theAddress & 255));
		};
	
	verbs ["tcp.addressencode"] = function (args) {
		const theParts = String (args [0]).split (".");
		if (theParts.length !== 4) {
			const message = "Can't encode the address " + args [0] + " because it isn't four numbers separated by dots.";
			throw new Error (message);
			}
		var theAddress = 0;
		theParts.forEach (function (thePart) {
			theAddress = ((theAddress * 256) + (Number (thePart) & 255));
			});
		return (theAddress >>> 0);
		};
	
	/*  8/20/26 by CC -- the machine's own address as a long, which is what
		tcp.myAddress answers and what his tcp.myDottedID and tcp.dns verbs
		are written on top of. It reads the machine's own interfaces -- no
		network call, nothing asked of anybody -- and takes the first IPv4
		that isn't the loopback. A machine with nothing but loopback answers
		the loopback.  */
	
	/*  8/20/26 by CC -- HOW A VERB WAITS.
		
		The tcp verbs are written to hand back a value: tcp.nameToAddress
		takes a domain name and answers an address, and the script's next
		line uses it. Node's DNS is asynchronous and there is no synchronous
		one, so something has to stand still in between.
		
		A worker thread does the asking and the interpreter's thread waits
		on a piece of shared memory until the worker writes into it. The
		interpreter itself is untouched -- it isn't suspended and resumed,
		it is inside one verb call that takes a while, the same as reading a
		large file. This is the piece every blocking tcp verb will be built
		on; DNS is the first use of it.
		
		The worker's code is a string rather than a file so nothing extra
		has to be shipped or found at runtime.  */
	
	const workerSourceDns = `
		const {workerData} = require ("worker_threads");
		const dns = require ("dns");
		const theControl = new Int32Array (workerData.control);
		const theBytes = new Uint8Array (workerData.bytes);
		function finish (theAnswer) {
			const theText = JSON.stringify (theAnswer);
			const theBuffer = Buffer.from (theText, "utf8");
			const ctBytes = Math.min (theBuffer.length, theBytes.length);
			theBytes.set (theBuffer.subarray (0, ctBytes));
			Atomics.store (theControl, 1, ctBytes);
			Atomics.store (theControl, 0, 1);
			Atomics.notify (theControl, 0);
			}
		if (workerData.which === "nametoaddress") {
			dns.lookup (workerData.theName, {family: 4}, function (err, theAddress) {
				finish (err ? {message: err.message} : {value: theAddress});
				});
			}
		else {
			dns.reverse (workerData.theName, function (err, theNames) {
				finish (err ? {message: err.message} : {value: (theNames.length === 0) ? "" : theNames [0]});
				});
			}
		`;
	
	function askDns (which, theName, ctSecondsToWait) {
		const {Worker} = require ("worker_threads");
		const control = new SharedArrayBuffer (8);
		const bytes = new SharedArrayBuffer (4096);
		const theControl = new Int32Array (control);
		const theWorker = new Worker (workerSourceDns, {eval: true, workerData: {which, theName, control, bytes}});
		theWorker.unref ();
		Atomics.wait (theControl, 0, 0, ctSecondsToWait * 1000);
		if (Atomics.load (theControl, 0) !== 1) {
			const message = "Can't look up " + theName + " because the name server didn't answer in " + ctSecondsToWait + " seconds.";
			throw new Error (message);
			}
		const ctBytes = Atomics.load (theControl, 1);
		const theAnswer = JSON.parse (Buffer.from (new Uint8Array (bytes).subarray (0, ctBytes)).toString ("utf8"));
		if (theAnswer.message !== undefined) {
			const message = "Can't look up " + theName + " because " + theAnswer.message + ".";
			throw new Error (message);
			}
		return (theAnswer.value);
		}
	
	verbs ["tcp.nametoaddress"] = function (args) {
		return (verbs ["tcp.addressencode"] ([askDns ("nametoaddress", String (args [0]), 30)]));
		};
	
	verbs ["tcp.addresstoname"] = function (args) {
		return (askDns ("addresstoname", verbs ["tcp.addressdecode"] ([args [0]]), 30));
		};
	
	verbs ["tcp.myaddress"] = function (args) {
		const theInterfaces = require ("os").networkInterfaces ();
		var theDotted = "127.0.0.1";
		Object.keys (theInterfaces).forEach (function (theName) {
			theInterfaces [theName].forEach (function (theAddress) {
				if ((theDotted === "127.0.0.1") && (theAddress.family === "IPv4") && (theAddress.internal !== true)) {
					theDotted = theAddress.address;
					}
				});
			});
		return (verbs ["tcp.addressencode"] ([theDotted]));
		};
	
	verbs ["tcp.mydottedid"] = function (args) {
		return ("localhost");
		};
	
	verbs ["tcp.dns.getmydomainname"] = function (args) {
		return ("localhost");
		};
	
	/*  8/31/26 by CC -- HTTP FOR HEADLESS RUNS. The worker gets its HTTP from
		the server over the shared-memory channel and overrides these two; a
		headless run -- /run, the behavior gate, compileAll -- had NOTHING,
		so tcp.httpClient failed by name anywhere outside the app. The verbs
		here spawn httphelper.js and wait, the s3helper seam. The argument
		handling is copied from runnerWorker.js -- Frontier's parameters, in
		Frontier's order -- when one changes the other should too.  */

	function callHttpHelper (theRequest) {
		var theAnswer;
		try {
			const theOutput = execFileSync (process.execPath, [__dirname + "/httphelper.js"], {
				input: JSON.stringify (theRequest),
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024
				});
			theAnswer = JSON.parse (theOutput);
			}
		catch (err) {
			const message = "Can't read " + theRequest.url + " because the request helper failed: " + err.message;
			throw new Error (message);
			}
		if (theAnswer.message !== undefined) {
			throw new Error (theAnswer.message);
			}
		return (theAnswer.text);
		}

	function httpTicksToMilliseconds (theTicks) { //a tick is a sixtieth of a second, the way the Mac counted
		if ((theTicks === undefined) || (theTicks === null) || (Number (theTicks) <= 0)) {
			return (30 * 1000);
			}
		return (Math.round (Number (theTicks) * 1000 / 60));
		}

	function parseHttpCommand (theRequestText) { //9/11/26 by DW+CC -- pull the method, uri, headers and body back out of the request tcp.httpClient's glue built, so tcp.httptransport can issue it. Content-Length is dropped; the transport sets it from the body. DUPLICATED in runnerWorker.js -- change one, change both
		const ixBlank = theRequestText.indexOf ("\r\n\r\n");
		const theHead = (ixBlank === -1) ? theRequestText : theRequestText.slice (0, ixBlank);
		const theBody = (ixBlank === -1) ? "" : theRequestText.slice (ixBlank + 4);
		const theLines = theHead.split ("\r\n");
		const theTokens = ((theLines.length > 0) ? theLines [0] : "").split (" ");
		const theMethod = (theTokens.length > 0) && (theTokens [0].length > 0) ? theTokens [0] : "GET";
		const theUri = (theTokens.length > 1) ? theTokens [1] : "/";
		const theHeaders = {};
		var ixLine;
		for (ixLine = 1; ixLine < theLines.length; ixLine++) {
			const theLine = theLines [ixLine];
			const ixColon = theLine.indexOf (":");
			if (ixColon !== -1) {
				const theName = theLine.slice (0, ixColon).trim ();
				const theValue = theLine.slice (ixColon + 1).trim ();
				if ((theName.length > 0) && (theName.toLowerCase () !== "content-length")) {
					theHeaders [theName] = theValue;
					}
				}
			}
		return ({method: theMethod, uri: theUri, headers: theHeaders, body: theBody});
		}

	function httpHeadersFromAddress (theAddress) {
		const theHeaders = {};
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			return (theHeaders);
			}
		var theTable;
		try {
			theTable = theAddress.reference.get ();
			}
		catch (err) {
			return (theHeaders);
			}
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (theHeaders);
			}
		Reflect.ownKeys (theTable).forEach (function (theName) {
			if ((typeof theName === "string") && (theName !== "flOdbSqlTable") && (theName !== "odbId")) {
				theHeaders [theName] = String (theTable [theName]);
				}
			});
		return (theHeaders);
		}

	verbs ["tcp.httpclient"] = function (args) {

		const theMethod = ((args [0] === undefined) || (args [0] === null) || (String (args [0]).length === 0)) ? "GET" : String (args [0]);
		const theServer = String ((args [1] === undefined) ? "" : args [1]);
		const thePort = args [2];
		var thePath = String ((args [3] === undefined) ? "" : args [3]);
		const theData = String ((args [8] === undefined) || (args [8] === null) ? "" : args [8]);
		const theDataType = String ((args [9] === undefined) || (args [9] === null) ? "" : args [9]);
		const theUsername = String ((args [10] === undefined) || (args [10] === null) ? "" : args [10]);
		const thePassword = String ((args [11] === undefined) || (args [11] === null) ? "" : args [11]);
		const theHeaders = httpHeadersFromAddress (args [12]);
		const theMilliseconds = httpTicksToMilliseconds (args [15]);
		const ctFollowRedirects = ((args [17] === undefined) || (args [17] === null)) ? 0 : Number (args [17]);
		const flJustHeaders = args [18] === true;
		const flAcceptOpml = args [19] === true;

		if (theServer.length === 0) {
			throw new Error ("Can't send the request because no server was named.");
			}
		if (thePath.charAt (0) !== "/") {
			thePath = "/" + thePath;
			}
		var theUrl = theServer;
		if (theUrl.indexOf ("://") === -1) {
			theUrl = (((thePort === undefined) || (thePort === null) || (Number (thePort) === 80)) ? "http://" : "https://") + theUrl;
			}
		if ((thePort !== undefined) && (thePort !== null) && (Number (thePort) !== 80) && (Number (thePort) !== 443)) {
			theUrl += ":" + Number (thePort);
			}
		theUrl += thePath;

		if (theHeaders ["User-Agent"] === undefined) {
			theHeaders ["User-Agent"] = "UserTalk";
			}
		if (flAcceptOpml && (theHeaders ["Accept"] === undefined)) {
			theHeaders ["Accept"] = "text/x-opml, */*";
			}
		if (theDataType.length > 0) {
			theHeaders ["Content-Type"] = theDataType;
			}
		if (theUsername.length > 0) {
			theHeaders ["Authorization"] = "Basic " + Buffer.from (theUsername + ":" + thePassword).toString ("base64");
			}

		return (callHttpHelper ({
			url: theUrl,
			method: theMethod,
			headers: theHeaders,
			data: theData,
			milliseconds: theMilliseconds,
			ctFollowRedirects,
			flJustHeaders
			}));
		};

	verbs ["tcp.httpreadurl"] = function (args) { //the convenient one: the page itself, redirects followed
		const theUrl = String ((args [0] === undefined) ? "" : args [0]);
		if (theUrl.length === 0) {
			throw new Error ("Can't read the url because none was named.");
			}
		const theSeconds = args [2];
		const theText = callHttpHelper ({
			url: (theUrl.indexOf ("://") === -1) ? ("http://" + theUrl) : theUrl,
			method: "GET",
			headers: {"User-Agent": "UserTalk"},
			data: "",
			milliseconds: ((theSeconds === undefined) || (theSeconds === null)) ? (30 * 1000) : Math.round (Number (theSeconds) * 1000),
			ctFollowRedirects: 5,
			flJustHeaders: false
			});
		const ixBlankLine = theText.indexOf ("\r\n\r\n");
		return ((ixBlankLine === -1) ? theText : theText.slice (ixBlankLine + 4));
		};

	verbs ["tcp.httptransport"] = function (args) {

		/*  9/11/26 by DW+CC -- the transport under tcp.httpClient's glue.
			Until now tcp.httpClient opened a raw stream (tcp.openStream),
			plaintext, so it couldn't reach an https server at all -- DW's
			codecasting feed went https-only and httpReadUrl answered a
			zero-length string. DW's design: the glue keeps building the
			request and keeps the cookie handling around it, and hands the
			finished request text to this, which does it over the wire and
			answers the raw response. TLS when flSecure. This reuses the
			proven HTTP path (httphelper's fetch), so chunked encoding and
			TLS are Node's job, not ours.  */

		const theHost = String ((args [0] === undefined) ? "" : args [0]);
		const thePort = args [1];
		const flSecure = args [2] === true;
		const theRequestText = String ((args [3] === undefined) || (args [3] === null) ? "" : args [3]);
		const theSeconds = args [4];
		const flJustHeaders = args [5] === true;

		const theRequest = parseHttpCommand (theRequestText);
		var theUrl;
		if ((theRequest.uri.indexOf ("http://") === 0) || (theRequest.uri.indexOf ("https://") === 0)) {
			theUrl = theRequest.uri; //a proxy request carries the whole url on the request line
			}
		else {
			var theAuthority = theHost;
			if ((thePort !== undefined) && (thePort !== null) && (Number (thePort) !== 80) && (Number (thePort) !== 443)) {
				theAuthority += ":" + Number (thePort);
				}
			theUrl = (flSecure ? "https://" : "http://") + theAuthority + theRequest.uri;
			}

		return (callHttpHelper ({
			url: theUrl,
			method: theRequest.method,
			headers: theRequest.headers,
			data: theRequest.body,
			milliseconds: ((theSeconds === undefined) || (theSeconds === null) || (Number (theSeconds) <= 0)) ? (30 * 1000) : Math.round (Number (theSeconds) * 1000),
			ctFollowRedirects: 0,
			flJustHeaders
			}));
		};

	verbs ["frontier.version"] = function (args) {
		return ("11.0"); //9/5/26 by CC -- DW's ruling: Frontier 11.0. 10.0a1 was the 2004 open-source release, the Frontier Kernel project ended at 10.1a15 (2007), the OPML Editor builds are 10.1b21 and 10.2d4; "if we made it version 11.0 we'd be on pretty solid ground." It said "10.1", the OPML Editor generation the 2012 root came from
		};
	
	verbs ["sql.queryroot"] = function (args, environment) { //sql.queryRoot (sqltext, @result, ctMaxRows) -> the number of rows

		/*  9/19/26 by CC -- DW, when he heard the object database is itself a
			SQLite file and a query could ask it things the odb verbs can't,
			every script changed since Tuesday: "the last thing is kickass!!!
			i want that." A first version, for him to read and try; the SQL
			verbs as a whole are his to design, from scratch.

			The query runs on a connection of its own, opened READ-ONLY, so
			nothing a query says can change the odb -- SQLite itself refuses.
			What comes back fills the table at the address: a sub-table for
			each row, named 00001, 00002 the way xml.compile numbers things,
			with a cell for each column, named for the column. Text is a
			string, an integer or a real is a number, a null has no cell.
			address (id) is there for the query to call -- the Frontier
			address of a row -- because a row knows its name and its parent,
			not where it is.  */

		const theSqltext = String (args [0]);
		const adrResult = args [1];
		const ctMaxRows = ((args [2] === undefined) || (args [2] === null)) ? 1000 : Number (args [2]);

		if (thePathMap.pathDatabase === undefined) {
			const message = "Can't run the query because there is no database file here to ask.";
			throw new Error (message);
			}

		var theDatabase, theRows = [];
		try {
			const sqlite3 = require ("better-sqlite3");
			theDatabase = new sqlite3 (String (thePathMap.pathDatabase), {readonly: true, fileMustExist: true});
			theDatabase.function ("address", function (theId) {
				if ((environment === undefined) || (typeof environment.odbPathForId !== "function")) {
					return (null); //SQLite's own word; it never reaches a script -- a null has no cell
					}
				else {
					return (environment.odbPathForId (Number (theId)));
					}
				});
			const theStatement = theDatabase.prepare (theSqltext);
			if (theStatement.reader !== true) { //not a select -- an insert, update, delete, create
				const message = "it isn't a query, and this verb only reads";
				throw new Error (message);
				}
			for (const theRow of theStatement.iterate ()) { //iterate, so a query that answers the whole odb stops at the limit without reading the rest
				if (theRows.length >= ctMaxRows) {
					break;
					}
				theRows.push (theRow);
				}
			}
		catch (err) {
			const message = "Can't run the query because " + err.message + ".";
			throw new Error (message);
			}
		finally {
			if (theDatabase !== undefined) {
				theDatabase.close ();
				}
			}

		const theResult = {};
		theRows.forEach (function (theRow, ixRow) {
			const theRowTable = {};
			Object.keys (theRow).forEach (function (theColumn) {
				const theValue = theRow [theColumn];
				if ((theValue === null) || (theValue === undefined)) { //a null has no cell
					return;
					}
				if (Buffer.isBuffer (theValue)) {
					theRowTable [theColumn] = theValue.toString ("utf8");
					}
				else {
					theRowTable [theColumn] = theValue;
					}
				});
			var theName = String (ixRow + 1);
			while (theName.length < 5) {
				theName = "0" + theName;
				}
			theResult [theName] = theRowTable;
			});
		if ((adrResult !== undefined) && (adrResult !== null) && (adrResult.flAddress === true)) {
			adrResult.reference.set (theResult);
			}
		return (theRows.length);
		};

	verbs ["frontier.getprogramname"] = function (args) {
		return ("usertalk");
		};
	
	function colonPathOfDatabaseFolder () { //9/4/26 by CC -- the folder the database is in, as a Frontier path: "Macintosh HD:Users:...:data:" -- realFromColonPath takes it back to the same folder
		if (thePathMap.pathDatabase === undefined) {
			return ("Macintosh HD:frontier:");
			}
		const theFolder = path.dirname (path.resolve (String (thePathMap.pathDatabase)));
		return ("Macintosh HD:" + theFolder.replace (/^\//, "").split ("/").join (":") + ":");
		}

	verbs ["frontier.getprogrampath"] = function (args) {

		/*  9/4/26 by CC -- the app's path is BESIDE THE DATABASE now, so the
			folder above it, which is where every script looks for Guest
			Databases (Frontier.getSubFolder, Frontier.tools.getToolsFolderPath,
			mainResponder.startup's config.root, discuss.root, members.root),
			is the real Guest Databases folder the scanner keeps beside the
			database. It answered a made-up "Macintosh HD:frontier:OPML.app"
			before, and the virgin 2012 startup opened its guest databases
			into a folder that doesn't exist.  */

		return (colonPathOfDatabaseFolder () + "Electric Frontier.app");
		};

	verbs ["file.findapplication"] = function (args) {

		/*  8/29/26 by CC -- findapplicationverb (fileverbs.c): when no
			application with the creator is found, the kernel clears the
			filespec and answers it -- the empty path, no error. There is no
			desktop database in this world, so nothing is ever found; the
			virgin startupScript's html.init leans on exactly this answer.  */

		return ("");
		};

	verbs ["frontier.enableagents"] = function (args, environment) {

		/*  8/29/26 by CC -- the kernel's switch on the whole agents machinery;
			the virgin startupScript calls it at the end of its external-
			commands bundle. The answer is written where every process can see
			it -- system.temp.Frontier, the launch-fresh table -- and the
			server's agent scanner obeys it: false stops every agent and keeps
			them stopped, true lets them run. Absent means enabled.  */

		const flEnabled = (args [0] !== false);
		const theSystem = environment.odb.system;
		if ((theSystem !== undefined) && (theSystem.temp !== undefined)) {
			if (theSystem.temp.Frontier === undefined) {
				theSystem.temp.Frontier = {};
				}
			theSystem.temp.Frontier.agentsEnabled = flEnabled;
			}
		return (true);
		};

	verbs ["frontier.getfilepath"] = function (args) {

		/*  8/29/26 by CC -- the path of the root database file, the kernel's
			getfilepathverb. The virgin startupScript's first real work is
			Frontier.pathToRoot = frontier.getFilePath (), and pathstring is
			the folder above it -- the same folder getprogrampath implies, so
			the two verbs agree about where Frontier lives. The real file's
			name rides in when the caller supplied it.  */

		/*  9/10/26 by CC -- THE NAME IS frontier.root, whatever the file on disk is
			called. The database file is frontier.db, and this answered that name,
			so window.getFile and every script that tests for ".root" -- his
			backupFrontRoot, rootUpdates.update -- stopped on the root itself.
			DW, 9/8: "frontier.db is not part of our nomenclature"; 9/10, ok to the
			change: Frontier answers frontier.root everywhere a script or a window
			can see the name; the file on disk keeps its own.  */

		return (colonPathOfDatabaseFolder () + "frontier.root");
		};
	
	verbs ["scripterror"] = function (args) { //the language's throw; "!redirect url" faked errors ride the message
		throw new Error (String (args [0]));
		};
	
	verbs ["thread.getcurrentid"] = function (args) {
		return (1); //one thread in this world
		};
	
	verbs ["sys.os"] = function (args) {
	
		/*  8/17/26 by CC -- "MacOS", flat, which is what the kernel answers:
			its sysos () is one line returning that string, no version check,
			no branch (shellsysverbs.c). Ours said "Unix" and every script that
			branches on the answer took the wrong road. DW, when this came up
			as a question: "what does the kernel do? that's what you do."  */
		
		return ("MacOS");
		};
	
	verbs ["sys.systemtask"] = function (args) {
		return (true);
		};
	
	verbs ["clock.milliseconds"] = function (args) { //8/17/26 by CC -- milliseconds since boot, the partner of clock.ticks; 8/24/26 -- sys.time and sys.milliseconds, names we made up beside it, are out: not kernel names, no callers anywhere
		return (Date.now () - whenMachineBooted);
		};
	
	verbs ["sys.getusername"] = function (args) { //8/17/26 by CC -- it answered the literal string "manila"; the machine knows who is logged in
		return (os.userInfo ().username);
		};
	
	verbs ["sys.memavail"] = function (args) {
		return (64 * 1024 * 1024);
		};
	
	/*  8/17/26 by CC -- these used to answer "now" no matter what you asked
		about, because nothing was kept. Every object in the odb carries the
		day it was made and the day it last changed now (odbSql.js), so these
		answer the truth. An object the storage layer can't date -- a value
		living only in this run, or a database from before the columns existed
		-- still answers now, which is the honest answer for something that has
		no history.  */
	
	function objectDates (theArg, environment) {
		if ((theArg === undefined) || (theArg === null) || (theArg.flAddress !== true)) {
			return (undefined);
			}
		if ((environment === undefined) || (environment.odbDates === undefined)) {
			return (undefined);
			}
		return (environment.odbDates (theArg.pathText.split (".")));
		}
	
	verbs ["lang.timecreated"] = function (args, environment) {
		const theDates = objectDates (args [0], environment);
		if ((theDates === undefined) || (theDates.whenCreated === undefined)) {
			return (new Date ());
			}
		return (theDates.whenCreated);
		};
	
	verbs ["lang.timemodified"] = function (args, environment) {
		const theDates = objectDates (args [0], environment);
		if ((theDates === undefined) || (theDates.whenModified === undefined)) {
			return (new Date ());
			}
		return (theDates.whenModified);
		};
	
	verbs ["timemodified"] = verbs ["lang.timemodified"];
	
	verbs ["timecreated"] = verbs ["lang.timecreated"];
	
	/*  8/20/26 by CC -- setTimeCreated and setTimeModified, from settimesverb
		in langverbs.c: it answers a boolean, and false when the address names
		nothing. Where there's no storage layer to ask -- the test harness runs
		on an odb held in memory, which keeps no dates -- they answer true, the
		same fiction timeCreated already tells there by answering now.
		
		His op.outlineToXml needs setTimeCreated: it copies the outline onto a
		temporary object to write it out, and carries the real creation date
		across so the file says when the outline was made.  */
	
	function setObjectDates (theArg, theDate, whichDate, environment) {
		if ((theArg === undefined) || (theArg.flAddress !== true) || (theArg.pathText === undefined)) {
			return (false);
			}
		if ((environment === undefined) || (environment.setOdbDates === undefined)) {
			return (true);
			}
		const theDates = {};
		theDates [whichDate] = new Date (theDate);
		return (environment.setOdbDates (theArg.pathText.split ("."), theDates));
		}
	
	verbs ["lang.settimecreated"] = function (args, environment) {
		return (setObjectDates (args [0], args [1], "whenCreated", environment));
		};
	
	verbs ["lang.settimemodified"] = function (args, environment) {
		return (setObjectDates (args [0], args [1], "whenModified", environment));
		};
	
	verbs ["settimecreated"] = verbs ["lang.settimecreated"];
	
	verbs ["settimemodified"] = verbs ["lang.settimemodified"];
	
	/*  9/4/26 by CC -- THE EDIT MENU'S FONT AND STYLE VERBS, editmenuverbs in
		the kernel: they set the font, size and style of the front window's
		text. There is no font to set on a page yet, so they answer true and
		change nothing -- the kernel's own answer when the front window has no
		text to style. The fresh install's import of workspace.notepad stopped
		on editMenu.setFont (DW's 9/4 report); the glue for an outline import
		sets the window's font on the way in.  */

	["editmenu.setfont", "editmenu.setfontsize", "editmenu.setbold", "editmenu.setitalic", "editmenu.setunderline", "editmenu.setoutline", "editmenu.setshadow", "editmenu.plaintext"].forEach (function (theName) {
		verbs [theName] = function (args) {
			return (true);
			};
		});
	verbs ["editmenu.getfont"] = function (args) {
		return ("Geneva"); //the kernel's default font name, standard.h
		};
	verbs ["editmenu.getfontsize"] = function (args) {
		return (12);
		};

	verbs ["menu.isinstalled"] = function (args, environment) {

		/*  9/15/26 by CC -- WHICH MENUBARS ARE UP. The app installs
			user.menus.customMenu, system.menus.menubar, user.bookmarksMenu.menu
			and every menubar (or address of one) in user.menus (main.js, the
			2-second poll), so those answer true, by address text, an address
			entry followed the way buildMenuBar follows it. This answered
			false for everything ("no menu bar in this world"), and
			userland.trialVersionCheck took that as the UI needing to be
			restored and opened the About window on every root update --
			DW's 9/15 report: "i don't even understand why the about window
			comes into it at all." The front window's own menubar isn't
			known here; a script asking about one of those still hears false.  */

		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true) || (theAddress.pathText === undefined)) {
			return (false);
			}
		function realPathFor (adr) { //the object's real place, so @Frontier.tools.menu and @system.verbs.builtins.Frontier.tools.menu compare equal
			try {
				const thePlace = placeOfAddress (adr);
				if ((thePlace !== undefined) && (thePlace.container !== undefined) && (thePlace.container.flOdbSqlTable === true) && (environment !== undefined) && (typeof environment.odbPathForId === "function")) {
					return (String (environment.odbPathForId (thePlace.container.odbId) + "." + thePlace.key).toLowerCase ());
					}
				}
			catch (err) {
				}
			return (String (adr.pathText).toLowerCase ().replace (/^@/, "").replace (/^root\./, ""));
			}
		const installed = {};
		function noteInstalled (theText) {
			try {
				const adr = addressFromText (String (theText), environment);
				if ((adr !== undefined) && (adr !== null) && (adr.flAddress === true)) {
					installed [realPathFor (adr)] = true;
					}
				}
			catch (err) {
				}
			}
		["user.menus.customMenu", "system.menus.menubar", "user.bookmarksMenu.menu"].forEach (noteInstalled);
		try {
			const odb = (environment === undefined) ? undefined : environment.odb;
			const userTable = (odb === undefined) ? undefined : odb [findKeyInTable (odb, "user")];
			const menusTable = (userTable === undefined) ? undefined : userTable [findKeyInTable (userTable, "menus")];
			if ((menusTable !== undefined) && (menusTable !== null) && (typeof menusTable === "object")) {
				tableNames (menusTable).forEach (function (theName) {
					const theEntry = menusTable [theName];
					noteInstalled ("user.menus." + theName);
					if ((theEntry !== undefined) && (theEntry !== null) && (theEntry.flOdbAddressText === true)) {
						noteInstalled (theEntry.path);
						}
					if ((theEntry !== undefined) && (theEntry !== null) && (theEntry.flAddress === true) && (theEntry.pathText !== undefined)) {
						noteInstalled (theEntry.pathText);
						}
					});
				}
			}
		catch (err) {
			}
		return (installed [realPathFor (theAddress)] === true);
		};
	
	verbs ["thread.sleepfor"] = function (args) { //9/15/26 by CC -- sleeps, the way clock.sleepFor does; it answered true and slept nothing while there was one thread, and the scheduler's loop (thread.sleepfor (1)) never rested
		return (sleepForMilliseconds (Number (args [0]) * 1000));
		};
	
	verbs ["thread.sleep"] = verbs ["thread.sleepfor"];
	
	verbs ["thread.exists"] = function (args) {
		return (false);
		};

	/*  8/31/26 by CC -- THE REST OF THE THREAD FAMILY, part of the builtins
		sweep. One thread in this world, and these answer the truth about it:
		one running thread, the current id, nobody sleeping. kill and wake
		answer true the way the no-window verbs do; evaluate runs the text
		right here, synchronously, the same choice thread.callScript made.  */

	verbs ["thread.getcount"] = function (args) {
		return (1);
		};

	verbs ["thread.getnthid"] = function (args) {
		return (1);
		};

	verbs ["thread.issleeping"] = function (args) {
		return (false);
		};

	verbs ["thread.kill"] = function (args) {
		return (true);
		};

	verbs ["thread.wake"] = function (args) {
		return (true);
		};

	verbs ["thread.sleepticks"] = function (args) {
		return (true); //one thread, no sleeping -- thread.sleepFor's own answer
		};

	verbs ["thread.gettimeslice"] = function (args) {
		return (0);
		};

	verbs ["thread.settimeslice"] = function (args) {
		return (true);
		};

	verbs ["thread.getdefaulttimeslice"] = function (args) {
		return (0);
		};

	verbs ["thread.setdefaulttimeslice"] = function (args) {
		return (true);
		};

	verbs ["thread.getstats"] = function (args) { //the kernel fills a table of thread stats; one thread's worth here
		return ({ctThreads: 1});
		};

	/*  8/31/26 by CC -- the process-list sys verbs. There is no Mac process
		manager to walk; the honest answer is the one process Atlantis is.  */

	verbs ["sys.appisrunning"] = function (args) {
		return (false);
		};

	verbs ["sys.countapps"] = function (args) {
		return (1);
		};

	verbs ["sys.frontmostapp"] = function (args) {
		return (verbs ["frontier.getprogramname"] ([]));
		};

	verbs ["sys.getnthapp"] = function (args) {
		return (verbs ["frontier.getprogramname"] ([]));
		};

	verbs ["sys.getapppath"] = function (args) {
		return (verbs ["frontier.getprogrampath"] ([]));
		};

	verbs ["sys.bringapptofront"] = function (args) {
		return (true);
		};

	verbs ["sys.browsenetwork"] = function (args) {
		return (false); //the AppleTalk network browser; there is nothing to browse
		};

	verbs ["sys.machine"] = function (args) {
		return ("Macintosh");
		};

	var theOsVersion; //assigned on the first sys.osVersion call

	verbs ["sys.osversion"] = function (args) { //the Mac system version string, the way getsystemversionstring answers it
		if (theOsVersion === undefined) {
			try {
				theOsVersion = execFileSync ("sw_vers", ["-productVersion"], {encoding: "utf8"}).trim ();
				}
			catch (err) {
				theOsVersion = os.release ();
				}
			}
		return (theOsVersion);
		};

	verbs ["frontier.countthreads"] = function (args) {
		return (1);
		};

	verbs ["frontier.ispowerpc"] = function (args) {
		return (false);
		};

	verbs ["frontier.isruntime"] = function (args) {
		return (false);
		};

	verbs ["frontier.isvalidserialnumber"] = function (args) {
		return (true); //the open source kernel has no serial numbers to check
		};

	verbs ["frontier.hideapplication"] = function (args) {
		return (true);
		};

	verbs ["frontier.requesttofront"] = function (args) {
		return (true);
		};
	
	/*  8/17/26 by CC -- THE MENU VERBS' REAL NAMES. Ten of the menu names we
		answer to were invented here (menu.addMenu, .check, .deleteMenu,
		.enable, .getMenubar, .installMenu, .new, .setMenubar, .uninstallMenu,
		.update) -- they mean nothing on Berkeley, and a script written against
		Frontier calls addMenuCommand, addSubMenu, install, remove, toggle and
		the rest. The kernel's names exist now; the invented ones stay so
		nothing here breaks, and both answer the same way in a place with no
		menu bar on screen.  */
	
	const kernelMenuNames = [
		"menu.addsubmenu", "menu.buildmenubar",
		"menu.deletesubmenu",
		"menu.getcommandkey", "menu.setcommandkey",
		"menu.install", "menu.remove", "menu.toggle", "menu.zoomscript"
		];
	
	kernelMenuNames.forEach (function (theName) {
		verbs [theName] = function (args) {
			return (true);
			};
		});

	/*  9/12/26 by CC -- menu.addMenuCommand and menu.deleteMenuCommand, the
		real ones. DW's report: Add Bookmark did nothing -- no error, no new
		item. The whole UserTalk chain ran (bookmarksMenu.add, the dialog,
		bookmarksMenu.addBookmark) and ended here, in a stub that answered
		true. From addmenucommandverb and deletemenucommandverb in the C's
		menuverbs.c: the menu is found by name among the summits (exact
		match, equalstrings) or added at the end; the item is found anywhere
		under the menu or added as the menu's last item; the script text
		becomes the item's script, and an existing item gets its script
		replaced. Delete takes the item and its subheads out; a name not
		found answers true and changes nothing; an empty item name deletes
		the whole menu. The menubar is a flat list of lines with levels, the
		way the odb stores it, so "the menu's subtree" is the run of lines
		after its summit up to the next level-0 line.  */

	function menubarAtAddress (theAddress, verbName) { //the menubar value at the address, or an error that says what it found
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			const message = "Can't do " + verbName + " because the first parameter isn't the address of a menubar.";
			throw new Error (message);
			}
		const theValue = theAddress.reference.get ();
		if ((theValue === undefined) || (theValue === null) || (theValue.flOdbMenubar !== true) || (!Array.isArray (theValue.lines))) {
			const message = "Can't do " + verbName + " because " + theAddress.pathText + " isn't a menubar.";
			throw new Error (message);
			}
		return (theValue);
		}

	function menuSubtreeEnd (theLines, ixSummit) { //the index just past the last line under the summit at ixSummit
		var ix = ixSummit + 1;
		while ((ix < theLines.length) && (theLines [ix].level > theLines [ixSummit].level)) {
			ix++;
			}
		return (ix);
		}

	function findMenuSummit (theLines, menuName) { //the index of the level-0 line named menuName, or -1
		var found = -1;
		theLines.forEach (function (theLine, ix) {
			if ((found === -1) && (theLine.level === 0) && (theLine.text === menuName)) {
				found = ix;
				}
			});
		return (found);
		}

	function findMenuItem (theLines, ixSummit, itemName) { //the index of the line named itemName anywhere under the summit, or -1
		const ixEnd = menuSubtreeEnd (theLines, ixSummit);
		var found = -1;
		var ix;
		for (ix = ixSummit + 1; ix < ixEnd; ix++) {
			if ((found === -1) && (theLines [ix].text === itemName)) {
				found = ix;
				}
			}
		return (found);
		}

	function menuScriptFromText (theText) { //the script a command carries, from its text; undefined for empty text
		if (theText.length === 0) {
			return (undefined);
			}
		const lines = [];
		theText.split (/\r\n|\r|\n/).forEach (function (lineText) {
			var level = 0;
			while (lineText.indexOf ("\t") === 0) {
				level++;
				lineText = lineText.slice (1);
				}
			lines.push ({level, text: lineText, flExpanded: true, flComment: false, flBreakpoint: false});
			});
		return ({lines});
		}

	verbs ["menu.addmenucommand"] = function (args) { //menu.addMenuCommand (adrmenubar, menuname, itemstring, itemcommand)
		const theAddress = args [0];
		const menuName = String ((args [1] === undefined) || (args [1] === null) ? "" : args [1]);
		const itemName = String ((args [2] === undefined) || (args [2] === null) ? "" : args [2]);
		const scriptText = String ((args [3] === undefined) || (args [3] === null) ? "" : args [3]);
		const theValue = menubarAtAddress (theAddress, "menu.addMenuCommand");
		const theLines = theValue.lines.slice ();
		const theScript = menuScriptFromText (scriptText);

		var ixSummit = findMenuSummit (theLines, menuName);
		if (ixSummit === -1) { //no menu by that name: a new summit at the end
			theLines.push ({level: 0, text: menuName, flExpanded: true, flComment: false, flBreakpoint: false});
			ixSummit = theLines.length - 1;
			}

		const ixItem = findMenuItem (theLines, ixSummit, itemName);
		if (ixItem === -1) { //not there: the menu's last item
			const newLine = {level: theLines [ixSummit].level + 1, text: itemName, flExpanded: true, flComment: false, flBreakpoint: false};
			if (theScript !== undefined) {
				newLine.script = theScript;
				}
			theLines.splice (menuSubtreeEnd (theLines, ixSummit), 0, newLine);
			}
		else { //there: its script is replaced
			const theLine = Object.assign ({}, theLines [ixItem]);
			delete theLine.script;
			if (theScript !== undefined) {
				theLine.script = theScript;
				}
			theLines [ixItem] = theLine;
			}

		theAddress.reference.set ({flOdbMenubar: true, lines: theLines});
		return (true);
		};

	verbs ["menu.deletemenucommand"] = function (args) { //menu.deleteMenuCommand (adrmenubar, menuname, itemstring)
		const theAddress = args [0];
		const menuName = String ((args [1] === undefined) || (args [1] === null) ? "" : args [1]);
		const itemName = String ((args [2] === undefined) || (args [2] === null) ? "" : args [2]);
		const theValue = menubarAtAddress (theAddress, "menu.deleteMenuCommand");
		const theLines = theValue.lines.slice ();

		const ixSummit = findMenuSummit (theLines, menuName);
		if (ixSummit === -1) {
			return (true); //the kernel's answer for a menu that isn't there
			}
		var ixDelete = ixSummit; //an empty item name deletes the whole menu
		if (itemName.length > 0) {
			ixDelete = findMenuItem (theLines, ixSummit, itemName);
			if (ixDelete === -1) {
				return (true);
				}
			}
		theLines.splice (ixDelete, menuSubtreeEnd (theLines, ixDelete) - ixDelete);
		theAddress.reference.set ({flOdbMenubar: true, lines: theLines});
		return (true);
		};
	
	/*  UI-only kernel verbs: safe no-ops, there's no screen here.

		8/24/26 by CC -- every name in this list is now checked against the
		kernel's own verb table, kernelverbs.r. Ten invented menu names came
		out tonight -- installmenu, uninstallmenu, update, addmenu,
		deletemenu, enable, check, getmenubar, setmenubar, new -- none of
		them kernel verbs, none called by any script in the database, all
		answering true in silence. The kernel's menu family is install,
		remove, addMenuCommand, deleteMenuCommand and their neighbors, and
		those live as glue scripts in the database like everything else.  */

	const uiNoOpNames = [
		"menu.clearmenubar", "menu.buildmenubar",
		"window.show", "window.hide", "window.close", "window.bringtofront", "window.update",
		"window.setposition", "window.setsize", "window.settitle",
		"sys.systemtask", "speaker.sound"
		];
	
	uiNoOpNames.forEach (function (name) {
		verbs [name] = function (args) {
			return (true);
			};
		});
	
	//UI questions answer false: nothing is open, frontmost or on screen here
	const uiFalseNames = [
		"window.ismenuscript", "window.isopen", "window.isfront", "window.isvisible",
		"window.frontmost", "dialog.ask", "dialog.confirm", "dialog.yesnocancel"
		];
	
	uiFalseNames.forEach (function (name) {
		verbs [name] = function (args) {
			return (false);
			};
		});
	
	verbs ["semaphores.lock"] = function (args) {
		return (true); //one thread, locks always succeed
		};
	
	verbs ["semaphores.unlock"] = function (args) {
		return (true);
		};
	
	verbs ["semaphore.lock"] = verbs ["semaphores.lock"];
	
	verbs ["semaphore.unlock"] = verbs ["semaphores.unlock"];
	
	verbs ["table.sortby"] = function (args, environment) {
	
		/*  8/17/26 by CC -- it did nothing at all. A table in Frontier keeps
			the order it was sorted into, and positional reads (adr [1], the
			for-loop over a table) follow that order. JavaScript objects keep
			the order their keys were inserted, so a sort is a rebuild of the
			table in the new order -- same objects, same names, new order.
			Sorting by name is what the odb reads answer already; "kind" and
			the other columns sort by the type name.  */
		
		const adrTable = args [0];
		if ((adrTable === undefined) || (adrTable === null) || (adrTable.flAddress !== true)) {
			return (true); //nothing named, nothing to sort
			}
		const theTable = adrTable.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (true);
			}
		const theColumn = (args [1] === undefined) ? "name" : String (args [1]).toLowerCase ();
		const flDescending = (args [2] === true);
		const theNames = Object.keys (theTable);
		theNames.sort (function (a, b) {
			var theOne = a.toLowerCase (), theOther = b.toLowerCase ();
			if (theColumn === "kind") {
				theOne = verbs ["typeof"] ([theTable [a]]);
				theOther = verbs ["typeof"] ([theTable [b]]);
				}
			if (theOne === theOther) {
				return (0);
				}
			return ((theOne < theOther) ? -1 : 1);
			});
		if (flDescending) {
			theNames.reverse ();
			}
		const theCopy = {};
		theNames.forEach (function (theName) {
			theCopy [theName] = theTable [theName];
			delete theTable [theName];
			});
		theNames.forEach (function (theName) {
			theTable [theName] = theCopy [theName];
			});
		return (true);
		};
	
	verbs ["table.emptytable"] = function (args) {
		const theAddress = args [0];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theAddress.reference.set ({});
			}
		return (true);
		};
	
	verbs ["webserver.builderrorpage"] = function (args) { //kernel verb: the plain error page
		const bigString = String (args [0]);
		const littleString = (args [1] === undefined) ? "" : String (args [1]);
		return ("<html><head><title>" + bigString + "</title></head><body><h1>" + bigString + "</h1><p>" + littleString + "</p></body></html>");
		};

	/*  8/31/26 by CC -- THE WEBSERVER UTILITY VERBS, from webserverparseheaders,
		webserverparsecookies, webserverbuildresponse and webservergetserverstring
		in langhtml.c. These are what string.httpResultSplit and the webserver
		suite's own glue lean on -- tcp.httpReadUrl stopped cold on the missing
		parseheaders, DW's 8/31 report.  */

	function lookupNameCaseless (theTable, theName) { //Frontier's hash lookups don't care about case; a JS property read does
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (undefined);
			}
		const theLowerName = theName.toLowerCase ();
		var theAnswer;
		Reflect.ownKeys (theTable).forEach (function (theKey) {
			if ((theAnswer === undefined) && (typeof theKey === "string") && (theKey !== "flOdbSqlTable") && (theKey !== "odbId")) {
				if (theKey.toLowerCase () === theLowerName) {
					theAnswer = theTable [theKey];
					}
				}
			});
		return (theAnswer);
		}

	function sureTableThroughAddress (theAddress, theVerbName) {
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			const message = "Can't call " + theVerbName + " because the table parameter isn't an address.";
			throw new Error (message);
			}
		var theTable = theAddress.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) { //the kernel's langsuretablevalue: make the table if it isn't one
			theAddress.reference.set ({});
			theTable = theAddress.reference.get ();
			}
		return (theTable);
		}

	verbs ["webserver.parseheaders"] = function (args, environment) { //parseheaders (text, @headerTable) -- fills the table, answers the first line

		/*  The walk is the kernel's own: the label runs to the first colon,
			whitespace after the colon is skipped, the value runs to the CR,
			a line with no colon is a label with an empty value, an empty
			line ends the headers, and a repeated label accumulates its
			values into a list.  */

		const theText = String (args [0]);
		const adrHeaderTable = args [1];

		const ixFirstLineEnd = theText.indexOf ("\r\n");
		if ((ixFirstLineEnd === -1) || (adrHeaderTable === undefined) || (adrHeaderTable === null) || (adrHeaderTable.flAddress !== true)) {
			return ((ixFirstLineEnd <= 0) ? "" : theText.slice (0, ixFirstLineEnd));
			}

		const theTable = sureTableThroughAddress (adrHeaderTable, "webserver.parseHeaders");

		function addHeader (theLabel, theValue) {
			const theExisting = theTable [theLabel];
			if (theExisting === undefined) {
				theTable [theLabel] = theValue;
				}
			else {
				if (Array.isArray (theExisting)) {
					theExisting.push (theValue);
					theTable [theLabel] = theExisting; //an odb-backed table only hears the assignment, not the push
					}
				else {
					theTable [theLabel] = [theExisting, theValue];
					}
				}
			}

		var pos = ixFirstLineEnd + 2;
		var beginLabel = pos, lenLabel = -1, beginValue = -1;
		while (pos < theText.length) {
			const ch = theText.charAt (pos);
			if ((ch === ":") && (lenLabel === -1)) { //only the first colon on a line
				lenLabel = pos - beginLabel;
				var ix = pos + 1;
				while ((theText.charAt (ix) === " ") || (theText.charAt (ix) === "\t")) {
					ix++;
					}
				pos = beginValue = ix;
				continue;
				}
			if (ch === "\r") {
				if ((beginValue === -1) || (lenLabel <= 0)) { //no colon on this line
					lenLabel = pos - beginLabel;
					beginValue = pos;
					}
				if (lenLabel === 0) { //an empty line: end of the headers
					break;
					}
				addHeader (theText.slice (beginLabel, beginLabel + lenLabel), theText.slice (beginValue, pos));
				pos++;
				if (theText.charAt (pos) === "\n") {
					pos++;
					}
				if (theText.charAt (pos) === "\r") { //end of the headers
					break;
					}
				beginLabel = pos;
				lenLabel = beginValue = -1;
				continue;
				}
			pos++;
			}

		return ((ixFirstLineEnd <= 0) ? "" : theText.slice (0, ixFirstLineEnd));
		};

	verbs ["webserver.parsecookies"] = function (args, environment) { //parsecookies (@paramTable) -- builds requestHeaders.cookies, answers false when there's no Cookie header
		var theParamTable = args [0];
		if ((theParamTable !== undefined) && (theParamTable !== null) && (theParamTable.flAddress === true)) {
			theParamTable = theParamTable.reference.get ();
			}
		if ((theParamTable === undefined) || (theParamTable === null) || (typeof theParamTable !== "object")) {
			const message = "Can't parse the cookies because the parameter doesn't lead to a table.";
			throw new Error (message);
			}
		const theHeadersTable = lookupNameCaseless (theParamTable, "requestHeaders");
		if ((theHeadersTable === undefined) || (theHeadersTable === null) || (typeof theHeadersTable !== "object")) {
			return (false);
			}
		var theCookieText = lookupNameCaseless (theHeadersTable, "Cookie");
		if (theCookieText === undefined) {
			return (false);
			}
		theCookieText = String (theCookieText);

		const theCookies = {};
		theCookieText.split (";").forEach (function (thePart) {
			while (thePart.indexOf (" ") === 0) {
				thePart = thePart.slice (1);
				}
			if (thePart.length === 0) {
				return;
				}
			const ixEquals = thePart.indexOf ("=");
			if (ixEquals > 0) { //the kernel keeps only parts with a name before the equals
				theCookies [thePart.slice (0, ixEquals)] = thePart.slice (ixEquals + 1);
				}
			});
		theHeadersTable ["cookies"] = theCookies;
		return (true);
		};

	verbs ["webserver.getserverstring"] = function (args, environment) { //user.webserver.prefs.headerFieldServer wins; the kernel's own name otherwise
		try {
			const adrPref = verbs ["lang.address"] (["user.webserver.prefs.headerFieldServer"], environment);
			const thePref = adrPref.reference.get ();
			if ((thePref !== undefined) && (thePref !== null)) {
				return (String (thePref));
				}
			}
		catch (err) {
			}
		return ("Frontier/" + verbs ["frontier.version"] ([]) + "-MacOSX"); //STR_P_SERVERSTRING: Frontier/^0-^1X, ^1 the kernel's sysos, MacOS
		};

	verbs ["webserver.buildresponse"] = function (args, environment) { //buildresponse (code, @headerTable, responseBody) -- the whole HTTP response as text

		/*  The kernel writes the status line from webserver.data.responses,
			then stamps Connection, Date, Server and Content-Length INTO the
			caller's header table before writing every header out -- the side
			effect is part of the verb.  */

		const theCode = String (args [0]);
		const adrHeaderTable = args [1];
		const theBody = ((args [2] === undefined) || (args [2] === null)) ? "" : String (args [2]);

		var theHeadersTable;
		if ((adrHeaderTable !== undefined) && (adrHeaderTable !== null) && (adrHeaderTable.flAddress === true)) {
			theHeadersTable = sureTableThroughAddress (adrHeaderTable, "webserver.buildResponse");
			}
		else {
			theHeadersTable = {};
			}

		var theCodeName;
		try {
			const adrResponses = verbs ["lang.address"] (["system.verbs.builtins.webserver.data.responses"], environment);
			theCodeName = lookupNameCaseless (adrResponses.reference.get (), theCode);
			}
		catch (err) {
			}
		var theResponse = "HTTP/1.1 " + theCode + " " + ((theCodeName === undefined) ? "UNKNOWN" : String (theCodeName)) + "\r\n";

		theHeadersTable ["Connection"] = "close";
		theHeadersTable ["Date"] = new Date ().toUTCString (); //the net-standard form: Sat, 29 Nov 1997 00:51:47 GMT
		theHeadersTable ["Server"] = verbs ["webserver.getserverstring"] ([], environment);
		if (theBody.length > 0) {
			theHeadersTable ["Content-Length"] = theBody.length;
			}

		function writeHeaderValue (theName, theValue) {
			if (Array.isArray (theValue)) {
				theValue.forEach (function (theItem) {
					writeHeaderValue (theName, theItem);
					});
				}
			else {
				theResponse += theName + ": " + String (theValue) + "\r\n";
				}
			}
		Reflect.ownKeys (theHeadersTable).forEach (function (theName) {
			if ((typeof theName === "string") && (theName !== "flOdbSqlTable") && (theName !== "odbId")) {
				writeHeaderValue (theName, theHeadersTable [theName]);
				}
			});

		theResponse += "\r\n" + theBody;
		return (theResponse);
		};

	/*  9/3/26 by CC -- THE TCP STREAM VERBS, and the sockets they need. The
		verbs themselves are in tcpstreams.js (from MacSocketNetEvents.c and
		langverbs.c); what varies is who owns the sockets. A script on the
		server's worker thread asks the server (runnerWorker.js installs
		them again over its channel); a headless script -- the behavior
		gate, /run, compileAll -- has no server, so the first stream verb
		starts a helper thread of its own and every call stops and waits on
		it over shared memory, the way a dialog waits. The helper never
		keeps the process alive.  */

	var tcpHelper; //assigned by askTcpHelper on first use

	function askTcpHelper (theRequest) {
		if (tcpHelper === undefined) {
			const {Worker} = require ("worker_threads");
			const sharedControl = new SharedArrayBuffer (8);
			const sharedData = new SharedArrayBuffer (65536);
			const theWorker = new Worker (path.join (__dirname, "tcphelperworker.js"), {
				workerData: {
					sharedControl,
					sharedData,
					flAllowNetwork: (thePathMap.flAllowNetwork !== false),
					folderTemp: path.join (os.tmpdir (), "usertalkStreams")
					}
				});
			theWorker.unref ();
			tcpHelper = {theWorker, theControl: new Int32Array (sharedControl), theBytes: new Uint8Array (sharedData)};
			}
		Atomics.store (tcpHelper.theControl, 0, 0);
		tcpHelper.theWorker.postMessage (theRequest);
		Atomics.wait (tcpHelper.theControl, 0, 0);
		const ctBytes = Atomics.load (tcpHelper.theControl, 1);
		const theText = Buffer.from (tcpHelper.theBytes.slice (0, ctBytes)).toString ("utf8");
		try {
			return (JSON.parse (theText));
			}
		catch (err) {
			return ({message: "Can't finish " + theRequest.op + " on the stream because the answer couldn't be read."});
			}
		}

	require ("./tcpstreams.js").installStreamVerbs (verbs, askTcpHelper);

	verbs ["tcp.writefiletostream"] = function (args) { //9/14/26 by CC -- netwritefiletostream in langverbs.c (6.2b10 AR): the prefix, then the whole file, then the suffix, down the stream; (stream, f, prefix="", suffix="")
		const theStream = args [0];
		const theText = verbs ["file.readwholefile"] ([args [1]]);
		const thePrefix = ((args [2] === undefined) || (args [2] === null)) ? "" : String (args [2]);
		const theSuffix = ((args [3] === undefined) || (args [3] === null)) ? "" : String (args [3]);
		verbs ["tcp.writestringtostream"] ([theStream, thePrefix + theText + theSuffix]);
		return (true);
		};

	/*  9/3/26 by CC -- THE KERNELIZED WEBSERVER: inetd.supervisor,
		webserver.server and webserver.dispatch, the three the database
		calls with kernel () since Frontier 6.1 ("Implemented as a kernel
		verb", AR, 11/11/99). Read tonight from langhtml.c: inetdsupervisor,
		webserverserver, webserverreadrequest, webserverprocessfirstline,
		webserverdispatch, webserverlocateresponder, webservergetmethod,
		webservercallresponder, webservercallfilters. The UserTalk they
		replaced is still in each script's comment, and the C follows it
		line for line; where the two differ the C won.

		The shape of the thing: a listener's callback is inetd.supervisor
		(stream, refcon). It builds a local paramTable (client, stream,
		port, timeout, request), calls the daemon in user.inetd.config with
		@paramTable, writes the string that comes back to the stream and
		closes it. The daemon is webserver.server: it reads the request off
		the stream (headers, then the body Content-Length promises), parses
		the first line and the cookies into the paramtable, and dispatches.
		webserver.dispatch runs the pre-filters, asks each enabled responder
		in user.webserver.responders whether its condition holds (a script
		or a string, evaluated with the paramtable and its headers in
		scope), falls back to user.webserver.prefs.defaultResponder, finds
		the method (the request's, else "any", else 405), calls it with the
		paramtable, and if it answers true runs the post-filters and builds
		the response from code, responseHeaders and responseBody.  */

	function liveAddress (theValue, environment) { //an address as the verb sees it, whichever way it was stored
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
			return (undefined);
			}
		if (theValue.flAddress === true) {
			return (theValue);
			}
		if (theValue.flOdbAddressText === true) {
			return (verbs ["lang.address"] ([String (theValue.path)], environment));
			}
		return (undefined);
		}

	function followAddresses (theValue, environment) { //the kernel's followaddress: through every address to the thing itself
		var ctHops = 0;
		while (ctHops < 20) {
			const theAddress = liveAddress (theValue, environment);
			if (theAddress === undefined) {
				return (theValue);
				}
			try {
				theValue = theAddress.reference.get ();
				}
			catch (err) {
				return (undefined);
				}
			ctHops++;
			}
		return (theValue);
		}

	function addressIntoTable (theTable, theName, thePathText) { //an address to one entry of a table this verb holds
		return ({
			flAddress: true,
			pathText: thePathText,
			nameText: theName,
			reference: {
				get: function () {
					return (theTable [theName]);
					},
				set: function (theValue) {
					theTable [theName] = theValue;
					}
				}
			});
		}

	function findKeyInTable (theTable, theName) { //9/14/26 by CC -- the entry's key as spelled, names compared without regard to case (equalidentifiers)
		var found;
		const lowerName = String (theName).toLowerCase ();
		tableNames (theTable).forEach (function (theKey) {
			if ((found === undefined) && (theKey.toLowerCase () === lowerName)) {
				found = theKey;
				}
			});
		return (found);
		}

	function tableNames (theTable) { //the entries in the table's order, the store's proxies included
		const theNames = [];
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (theNames);
			}
		Reflect.ownKeys (theTable).forEach (function (theKey) {
			if ((typeof theKey === "string") && (theKey !== "flOdbSqlTable") && (theKey !== "odbId")) {
				theNames.push (theKey);
				}
			});
		return (theNames);
		}

	function flScriptValue (theValue) {
		return ((theValue !== undefined) && (theValue !== null) && (typeof theValue === "object") && (theValue.flOdbScript === true));
		}

	function webserverCallFilters (adrParamTable, theTableText, theErrorType, environment) { //webservercallfilters: every script in the table, in order, errors logged and the walk goes on
		var theTable;
		try {
			theTable = verbs ["lang.address"] ([theTableText], environment).reference.get ();
			}
		catch (err) {
			return;
			}
		tableNames (theTable).forEach (function (theName) {
			try {
				const theScript = followAddresses (theTable [theName], environment);
				if (flScriptValue (theScript)) {
					environment.callScriptValue (theScript, [adrParamTable], undefined, liveAddress (theTable [theName], environment) || addressIntoTable (theTable, theName, theTableText + "." + theName));
					}
				}
			catch (err) {
				console.log (theErrorType + ": " + theTableText + "." + theName + ": " + err.message); //webserveraddtoerrorlog
				}
			});
		}

	function webserverErrorResponse (theCode, theTitle, theMessage, environment) {
		const thePage = (theMessage === undefined) ? "" : verbs ["webserver.builderrorpage"] ([theTitle, theMessage]);
		return (verbs ["webserver.buildresponse"] ([theCode, undefined, thePage], environment));
		}

	verbs ["webserver.dispatch"] = function (args, environment) { //dispatch (@paramTable) -> the response text, or whatever the responder answered
		const adrParamTable = args [0];
		const pt = sureTableThroughAddress (adrParamTable, "webserver.dispatch");

		webserverCallFilters (adrParamTable, "user.webserver.preFilters", "Pre filter error", environment);

		//webserverlocateresponder
		var theResponders;
		try {
			theResponders = verbs ["lang.address"] (["user.webserver.responders"], environment).reference.get ();
			}
		catch (err) {
			theResponders = undefined;
			}
		const theScopes = [pt, pt.requestHeaders];
		var theResponderName;
		tableNames (theResponders).forEach (function (theName) {
			if (theResponderName !== undefined) {
				return;
				}
			const theTable = followAddresses (theResponders [theName], environment);
			if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object") || flScriptValue (theTable)) {
				return;
				}
			if (lookupNameCaseless (theTable, "enabled") !== true) {
				return;
				}
			const theCondition = lookupNameCaseless (theTable, "condition");
			if (theCondition === undefined) {
				return;
				}
			var theAnswer;
			try {
				if (flScriptValue (theCondition)) {
					theScopes.forEach (function (theScope) {
						environment.withPaths.push (theScope);
						});
					try {
						theAnswer = environment.callScriptValue (theCondition, [adrParamTable], undefined, addressIntoTable (theTable, "condition", "user.webserver.responders." + theName + ".condition"));
						}
					finally {
						theScopes.forEach (function () {
							environment.withPaths.pop ();
							});
						}
					}
				else {
					const theLines = [];
					String (theCondition).split (/\r\n|\r|\n/).forEach (function (theLine) {
						if (theLine.trim ().length > 0) {
							theLines.push ({level: 0, text: theLine, flComment: false});
							}
						});
					theAnswer = environment.evaluateWithScopes (environment.parseScript (theLines), theScopes);
					}
				}
			catch (err) {
				return; //a condition that errors doesn't match -- disablelangerror around the walk
				}
			if (theAnswer === true) {
				theResponderName = theName;
				}
			});
		if (theResponderName === undefined) {
			try {
				const thePrefs = verbs ["lang.address"] (["user.webserver.prefs"], environment).reference.get ();
				const theDefault = lookupNameCaseless (thePrefs, "defaultResponder");
				if ((theDefault !== undefined) && (String (theDefault).length > 0)) {
					theResponderName = String (theDefault);
					}
				}
			catch (err) {
				}
			}
		if ((theResponderName === undefined) || (theResponders === undefined) || (lookupNameCaseless (theResponders, theResponderName) === undefined)) {
			const message = "Can't dispatch the request because no responder claimed it and there is no default responder.";
			throw new Error (message);
			}
		var theKey = theResponderName;
		tableNames (theResponders).forEach (function (theName) {
			if (theName.toLowerCase () === theResponderName.toLowerCase ()) {
				theKey = theName;
				}
			});
		var adrResponder = liveAddress (theResponders [theKey], environment); //webservergetrespondertableaddress: an address entry is followed
		if (adrResponder === undefined) {
			adrResponder = addressIntoTable (theResponders, theKey, "user.webserver.responders." + theKey);
			}
		const theResponderTable = followAddresses (theResponders [theKey], environment);

		pt.responder = theResponderName;
		pt.responderTableAdr = adrResponder;
		pt.code = 200;
		pt.responseBody = "";
		pt.responseHeaders = {};

		//webservergetmethod
		const theMethodName = String (pt.method);
		const theMethods = followAddresses (lookupNameCaseless (theResponderTable, "methods"), environment);
		var theMethodKey, theMethod;
		[theMethodName, "any"].forEach (function (theCandidate) {
			if (theMethodKey !== undefined) {
				return;
				}
			tableNames (theMethods).forEach (function (theName) {
				if ((theMethodKey === undefined) && (theName.toLowerCase () === theCandidate.toLowerCase ())) {
					const theValue = followAddresses (theMethods [theName], environment);
					if (flScriptValue (theValue)) {
						theMethodKey = theName;
						theMethod = theValue;
						}
					}
				});
			});
		if (theMethodKey === undefined) { //webservermethodnotallowed
			var theAllowed = "";
			tableNames (theMethods).forEach (function (theName) {
				if (theAllowed.length > 0) {
					theAllowed += ", ";
					}
				theAllowed += theName;
				});
			const badMethodHeaders = {Allow: theAllowed};
			const thePage = verbs ["webserver.builderrorpage"] (["405 Method Not Allowed", theMethodName + " isn't allowed on this object."]);
			return (verbs ["webserver.buildresponse"] (["405", addressIntoTable ({badMethodHeaders}, "badMethodHeaders", "badMethodHeaders"), thePage], environment));
			}

		//webservercallresponder
		var theResult;
		const adrMethod = liveAddress (theMethods [theMethodKey], environment) || addressIntoTable (theMethods, theMethodKey, "user.webserver.responders." + theKey + ".methods." + theMethodKey);
		try {
			theResult = environment.callScriptValue (theMethod, [adrParamTable], undefined, adrMethod);
			}
		catch (err) {
			console.log ("Responder method error: " + adrMethod.pathText + ": " + err.message); //webserveraddtoerrorlog
			return (webserverErrorResponse ("500", "500 Server Error", err.message, environment));
			}
		if (theResult === true) {
			webserverCallFilters (adrParamTable, "user.webserver.postFilters", "Post filter error", environment);
			if ((pt.responseHeaders === undefined) || (pt.responseHeaders === null) || (typeof pt.responseHeaders !== "object")) {
				pt.responseHeaders = {};
				}
			return (verbs ["webserver.buildresponse"] ([String (pt.code), addressIntoTable (pt, "responseHeaders", "paramTable.responseHeaders"), pt.responseBody], environment));
			}
		return (theResult); //the old CGI framework's answer, passed through
		};

	verbs ["webserver.server"] = function (args, environment) { //server (@paramTable, httpRequest = nil) -> the response text
		const adrParamTable = args [0];
		var theRequestText = args [1];
		const pt = sureTableThroughAddress (adrParamTable, "webserver.server");

		/*  wait here until Frontier has finished starting up -- the flag the
			startupScript keeps in system.temp.Frontier.startingUp, unless
			user.webserver.prefs.flWaitDuringStartup says not to  */

		if (typeof environment.refreshOdb === "function") {
			const theSleeper = new Int32Array (new SharedArrayBuffer (4));
			var ctWaits = 0;
			while (ctWaits < 240) {
				var flStartingUp = false, flWait = true;
				try {
					environment.refreshOdb ();
					flStartingUp = (verbs ["lang.address"] (["system.temp.Frontier.startingUp"], environment).reference.get () === true);
					flWait = (verbs ["lang.address"] (["user.webserver.prefs.flWaitDuringStartup"], environment).reference.get () !== false);
					}
				catch (err) {
					flStartingUp = false;
					}
				if (!flStartingUp || !flWait) {
					break;
					}
				Atomics.wait (theSleeper, 0, 0, 250);
				ctWaits++;
				}
			}

		pt.stats = {requestProcessingStarted: verbs ["clock.ticks"] ([])};

		//webserverreadrequest
		const theStream = Number (pt.stream);
		const theTimeout = ((pt.timeout === undefined) || (pt.timeout === null)) ? 30 : Number (pt.timeout);
		if ((theRequestText === undefined) || (theRequestText === null)) {
			pt.request = ((pt.request === undefined) || (pt.request === null)) ? "" : String (pt.request);
			verbs ["tcp.readstreamuntil"] ([theStream, "\r\n\r\n", theTimeout, addressIntoTable (pt, "request", "paramTable.request")]);
			}
		else {
			pt.request = String (theRequestText);
			}
		pt.requestHeaders = {};
		pt.firstLine = verbs ["webserver.parseheaders"] ([pt.request, addressIntoTable (pt, "requestHeaders", "paramTable.requestHeaders")], environment);
		const theExpect = lookupNameCaseless (pt.requestHeaders, "Expect");
		if ((theExpect !== undefined) && (String (theExpect).toLowerCase () !== "100-continue")) {
			return (webserverErrorResponse ("417", undefined, undefined, environment)); //we can't live up to the client's expectations
			}
		pt.requestBody = "";
		const theContentLength = Number (lookupNameCaseless (pt.requestHeaders, "Content-Length"));
		if (theContentLength > 0) {
			const ctPattern = 4;
			const ctHeaders = String (pt.request).indexOf ("\r\n\r\n");
			const ctFullRequest = ctHeaders + ctPattern + theContentLength;
			if ((theRequestText === undefined) || (theRequestText === null)) {
				try {
					verbs ["tcp.readstreambytes"] ([theStream, ctFullRequest, theTimeout, addressIntoTable (pt, "request", "paramTable.request")]);
					}
				catch (err) {
					return (webserverErrorResponse ("400", "400 Bad Request", "The request body couldn't be read.", environment));
					}
				}
			if (String (pt.request).length < ctFullRequest) {
				return (webserverErrorResponse ("400", "400 Bad Request", "The request body couldn't be read.", environment));
				}
			if (String (pt.request).length > ctFullRequest) { //remove trailing junk
				pt.request = String (pt.request).slice (0, ctFullRequest);
				}
			pt.requestBody = String (pt.request).slice (ctHeaders + ctPattern);
			}

		//webserverprocessfirstline
		const theWords = String (pt.firstLine).split (" ").filter (function (theWord) {
			return (theWord.length > 0);
			});
		if (theWords.length < 3) {
			return (webserverErrorResponse ("400", "400 Bad Request", "The request line is invalid.", environment));
			}
		const theMethod = theWords [0];
		var thePath = theWords [1];
		const theVersionParts = theWords [2].split ("/");
		if (theVersionParts.length < 2) {
			return (webserverErrorResponse ("400", "400 Bad Request", "The request line is invalid.", environment));
			}
		const theVersion = theVersionParts [1];
		if (theVersion === "1.1") {
			if (lookupNameCaseless (pt.requestHeaders, "Host") === undefined) {
				return (webserverErrorResponse ("400", "400 Bad Request", "Every HTTP/1.1 request must include a Host header", environment));
				}
			}
		else {
			if ((Number (theVersion.split (".") [0]) || 1) >= 2) {
				return (webserverErrorResponse ("505", "505 Version Not Supported", "This server does not support HTTP/" + theVersion, environment));
				}
			}
		if (thePath.toLowerCase ().startsWith ("http://")) { //a future-style full URL: the path after the host
			const ixSlash = thePath.indexOf ("/", 7);
			thePath = (ixSlash === -1) ? "/" : thePath.slice (ixSlash);
			}
		pt.searchArgs = "";
		const ixQuestion = thePath.indexOf ("?");
		if (ixQuestion !== -1) {
			pt.searchArgs = thePath.slice (ixQuestion + 1);
			thePath = thePath.slice (0, ixQuestion);
			}
		pt.pathArgs = "";
		if (thePath.indexOf ("$") === -1) {
			thePath = thePath.split ("%24").join ("$"); //proxy servers that url-encode the $
			}
		const ixDollar = thePath.indexOf ("$");
		if (ixDollar !== -1) {
			pt.pathArgs = thePath.slice (ixDollar + 1);
			thePath = thePath.slice (0, ixDollar);
			}
		pt.URI = thePath;
		pt.path = thePath;
		pt.method = theMethod;
		const theHost = lookupNameCaseless (pt.requestHeaders, "host");
		if (theHost !== undefined) {
			pt.host = theHost;
			}

		verbs ["webserver.parsecookies"] ([adrParamTable], environment);

		return (verbs ["webserver.dispatch"] ([adrParamTable], environment));
		};

	verbs ["inetd.supervisor"] = function (args, environment) { //supervisor (stream, refcon) -> true; the callback every listener runs for every connection
		const theStream = Number (args [0]);
		const theRefcon = Number (args [1]);
		if (theStream < 0) {
			return (true); //an internal error; don't terminate the listener
			}
		var whatWereWeDoing = "starting", pt;
		try {
			var flShutdown = false;
			try {
				flShutdown = (verbs ["lang.address"] (["user.inetd.shutdown"], environment).reference.get () === true);
				}
			catch (err) {
				}
			if (flShutdown) {
				verbs ["tcp.closestream"] ([theStream]);
				verbs ["lang.evaluate"] (["inetd.stop ()"], environment);
				return (true);
				}

			//new (tableType, @paramTable), a local of this frame, and its address
			whatWereWeDoing = "Initializing paramtable";
			const theFrame = environment.frames [environment.frames.length - 1];
			theFrame.vars.paramTable = {};
			pt = theFrame.vars.paramTable;
			const adrParamTable = {
				flAddress: true,
				pathText: "paramTable",
				nameText: "paramTable",
				reference: {
					get: function () {
						return (theFrame.vars.paramTable);
						},
					set: function (theValue) {
						theFrame.vars.paramTable = theValue;
						}
					}
				};
			pt.client = verbs ["tcp.addressdecode"] ([verbs ["tcp.getpeeraddress"] ([theStream])]);
			pt.ready = true;
			pt.refcon = theRefcon;
			pt.stream = theStream;
			const theListens = verbs ["lang.address"] (["user.inetd.listens"], environment).reference.get ();
			const theListen = lookupNameCaseless (theListens, String (theRefcon));
			const adrConfigTable = liveAddress ((theListen === undefined) ? undefined : lookupNameCaseless (theListen, "adrTable"), environment);
			if (adrConfigTable === undefined) {
				const message = "Can't serve the connection because user.inetd.listens has no entry for refcon " + theRefcon + ".";
				throw new Error (message);
				}
			pt.inetdConfigTableAdr = adrConfigTable;
			const theConfig = adrConfigTable.reference.get ();
			pt.port = lookupNameCaseless (theConfig, "port");
			var theTimeout = lookupNameCaseless (theConfig, "timeout");
			var theChunkSize = lookupNameCaseless (theConfig, "chunkSize");
			if ((theTimeout === undefined) || (theChunkSize === undefined)) {
				const thePrefs = verbs ["lang.address"] (["user.inetd.prefs"], environment).reference.get ();
				if (theTimeout === undefined) {
					theTimeout = lookupNameCaseless (thePrefs, "defaultTimeoutSecs");
					}
				if (theChunkSize === undefined) {
					theChunkSize = lookupNameCaseless (thePrefs, "returnChunkSize");
					}
				}
			theTimeout = Number (theTimeout) || 30;
			theChunkSize = Number (theChunkSize) || 8192;
			pt.timeout = theTimeout;

			whatWereWeDoing = "Waiting for data";
			pt.request = "";
			if (lookupNameCaseless (theConfig, "noWait") !== true) { //fwsNetEventInetdRead: the whole request, headers and the body they promise
				verbs ["tcp.readstreamuntil"] ([theStream, "\r\n\r\n", theTimeout, adrParamTableEntry (pt, "request")]);
				const theHeaders = {};
				verbs ["webserver.parseheaders"] ([pt.request, adrParamTableEntry (theHeaders, "x")], environment); //a scratch table; only the length matters here
				}

			whatWereWeDoing = "Calling the daemon";
			const theDaemon = followAddresses (lookupNameCaseless (theConfig, "daemon"), environment);
			if (!flScriptValue (theDaemon)) {
				const message = "Can't serve the connection because the daemon for port " + pt.port + " isn't a script.";
				throw new Error (message);
				}
			const theResult = environment.callScriptValue (theDaemon, [adrParamTable], undefined, liveAddress (lookupNameCaseless (theConfig, "daemon"), environment));

			whatWereWeDoing = "Returning data";
			if (typeof theResult === "string") {
				verbs ["tcp.writestringtostream"] ([theStream, theResult, theChunkSize, theTimeout]);
				}
			whatWereWeDoing = "Closing the stream";
			verbs ["tcp.closestream"] ([theStream]);
			return (true);
			}
		catch (err) {
			try {
				verbs ["tcp.abortstream"] ([theStream]);
				}
			catch (abortErr) {
				}
			console.log ("inetd: " + whatWereWeDoing + " -- " + err.message + ((pt !== undefined) ? " (port " + pt.port + ", client " + pt.client + ")" : "")); //inetdaddtoerrorlog
			return (false);
			}
		};

	function adrParamTableEntry (theTable, theName) { //an address to one field of the supervisor's paramTable
		return (addressIntoTable (theTable, theName, "paramTable." + theName));
		}

	/*  8/31/26 by CC -- THE THREE XML-RPC COERCION VERBS, from langxml.c:
		valToString, frontierValueToTaggedText and structToFrontierValue --
		the only members of the xml family the verb library didn't have (the
		compiler and the address readers were already here, and stand). They
		read and write the shapes OUR xml.compile builds -- numbered names,
		elements as tables with /pcdata -- and the tag vocabulary is the
		kernel's: i4, double, boolean, dateTime.iso8601, base64, struct,
		member, array, data, value.  */

	function xmlIsTable (theValue) {
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
			return (false);
			}
		if (Array.isArray (theValue) || (theValue instanceof Date) || (theValue instanceof Number)) {
			return (false);
			}
		if ((theValue.flAddress === true) || (theValue.flOdbScript === true) || (theValue.flOdbMenubar === true) || (theValue.flWpText === true) || (theValue.flOdbAddressText === true) || (theValue.flFilespec === true)) {
			return (false);
			}
		if ((theValue.type === "binary") || (theValue.type === "wptext") || charvalue.flCharValue (theValue)) {
			return (false);
			}
		return (true);
		}

	function xmlSortedKeys (theTable) { //the table's names in Frontier's sorted order, without the proxy's own fields
		const theKeys = [];
		Reflect.ownKeys (theTable).forEach (function (theKey) {
			if ((typeof theKey === "string") && (theKey !== "flOdbSqlTable") && (theKey !== "odbId")) {
				theKeys.push (theKey);
				}
			});
		theKeys.sort (function (a, b) {
			const theOne = a.toLowerCase (), theOther = b.toLowerCase ();
			if (theOne === theOther) {
				return (0);
				}
			return ((theOne < theOther) ? -1 : 1);
			});
		return (theKeys);
		}

	function xmlNodeNamePart (theKey) { //the name after the serial number and tab
		const ixTab = theKey.indexOf ("\t");
		return ((ixTab === -1) ? theKey : theKey.slice (ixTab + 1));
		}

	function xmlNodeFindKey (theTable, theName) { //the first item whose display name matches, in sorted order
		var theAnswer;
		xmlSortedKeys (theTable).forEach (function (theKey) {
			if ((theAnswer === undefined) && (xmlNodeNamePart (theKey).toLowerCase () === theName.toLowerCase ())) {
				theAnswer = theKey;
				}
			});
		return (theAnswer);
		}

	verbs ["xml.valtostring"] = function (args, environment) { //valToString (val, indentlevel=0) -- one scalar as XML-RPC text

		const theValue = args [0];

		if (typeof theValue === "string") { //no tags on a string, the default type -- escaped the kernel's way
			return (theValue.split ("&").join ("&amp;").split ("<").join ("&lt;").split ("]]>").join ("]]&gt;"));
			}
		if (typeof theValue === "boolean") {
			return ("<boolean>" + (theValue ? 1 : 0) + "</boolean>");
			}
		if (typeof theValue === "number") {
			if (Number.isInteger (theValue)) {
				return ("<i4>" + theValue + "</i4>");
				}
			return ("<double>" + theValue + "</double>");
			}
		if (theValue instanceof Number) {
			return ("<double>" + Number (theValue) + "</double>");
			}
		if (theValue instanceof Date) {
			const pad2 = function (n) {
				return ((n < 10) ? ("0" + n) : String (n));
				};
			return ("<dateTime.iso8601>" + theValue.getFullYear () + pad2 (theValue.getMonth () + 1) + pad2 (theValue.getDate ()) +
				"T" + pad2 (theValue.getHours ()) + ":" + pad2 (theValue.getMinutes ()) + ":" + pad2 (theValue.getSeconds ()) + "</dateTime.iso8601>");
			}
		if ((theValue !== undefined) && (theValue !== null) && (theValue.type === "binary")) {
			return ("<base64>" + Buffer.from (String (theValue.data), "latin1").toString ("base64") + "</base64>");
			}
		if ((theValue !== undefined) && (theValue !== null) && charvalue.flCharValue (theValue)) {
			return (String (theValue).split ("&").join ("&amp;").split ("<").join ("&lt;"));
			}
		const message = "Can\u2019t process the request because a value of type \u201c" + verbs ["typeof"] ([theValue]) + "\u201d can\u2019t be represented in XML-Data at this time."; //right single quote, left and right double quotes -- the kernel's own sentence
		throw new Error (message);
		};

	verbs ["xml.frontiervaluetotaggedtext"] = function (args, environment) { //frontierValueToTaggedText (adrValue, indentlevel) -- struct, array and member tags around a Frontier value

		var theValue = args [0];
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			theValue = theValue.reference.get ();
			}
		const indentLevel = ((args [1] === undefined) || (args [1] === null)) ? 0 : Number (args [1]);

		const theLines = [];
		function addLine (theText, theIndent) {
			theLines.push ({indent: theIndent, text: theText});
			}

		function addTaggedValue (theItem, theIndent) { //xmladdtaggedvalue: a string rides one line; anything else gets a wrapped <value>
			if (typeof theItem === "string") {
				addLine ("<value>" + verbs ["xml.valtostring"] ([theItem], environment) + "</value>", theIndent);
				}
			else {
				addLine ("<value>", theIndent);
				visit (theItem, theIndent + 1);
				addLine ("</value>", theIndent + 1); //the closing tag rides at the content's level, the kernel's own indentation
				}
			}

		function visit (theItem, theIndent) {
			if (Array.isArray (theItem)) {
				addLine ("<array>", theIndent);
				addLine ("<data>", theIndent + 1);
				theItem.forEach (function (theListItem) {
					addTaggedValue (theListItem, theIndent + 2);
					});
				addLine ("</data>", theIndent + 2);
				addLine ("</array>", theIndent + 1);
				return;
				}
			if (xmlIsTable (theItem)) {
				addLine ("<struct>", theIndent);
				xmlSortedKeys (theItem).forEach (function (theKey) {
					addLine ("<member>", theIndent + 1);
					addLine ("<name>" + theKey + "</name>", theIndent + 2);
					addTaggedValue (theItem [theKey], theIndent + 2);
					addLine ("</member>", theIndent + 2);
					});
				addLine ("</struct>", theIndent + 1);
				return;
				}
			addLine (verbs ["xml.valtostring"] ([theItem], environment), theIndent);
			}

		visit (theValue, indentLevel);

		var theText = "";
		theLines.forEach (function (theLine) {
			theText += "\t".repeat (Math.max (0, theLine.indent)) + theLine.text + "\r";
			});
		theText = theText.replace (/^\t+/, ""); //the kernel pops the leading tabs and the trailing return
		theText = theText.replace (/\r+$/, "");
		return (theText);
		};

	verbs ["xml.structtofrontiervalue"] = function (args, environment) { //structToFrontierValue (adrstruct, adrFrontierVal) -- a compiled table back to a Frontier value

		const adrStruct = args [0];
		const adrValue = args [1];
		if ((adrStruct === undefined) || (adrStruct === null) || (adrStruct.flAddress !== true) || (adrValue === undefined) || (adrValue === null) || (adrValue.flAddress !== true)) {
			const message = "Can't convert the struct because both parameters must be addresses.";
			throw new Error (message);
			}

		function nodeText (theNode) { //an element's own text, whether it compiled as a table with /pcdata or a bare string
			if (xmlIsTable (theNode)) {
				if (theNode ["/pcdata"] !== undefined) {
					return (String (theNode ["/pcdata"]));
					}
				if (theNode ["/contents"] !== undefined) {
					return (String (theNode ["/contents"]));
					}
				return ("");
				}
			return (String (theNode));
			}

		function convertValueNode (theNode) { //a <value> element: convert what's inside it
			if (xmlIsTable (theNode)) {
				const theKeys = [];
				xmlSortedKeys (theNode).forEach (function (theKey) {
					if (xmlNodeNamePart (theKey).charAt (0) !== "/") {
						theKeys.push (theKey);
						}
					});
				if (theKeys.length > 0) {
					return (convert (xmlNodeNamePart (theKeys [0]), theNode [theKeys [0]]));
					}
				}
			return (nodeText (theNode)); //<value>text</value>: a string
			}

		function convert (theName, theNode) {
			const theLowerName = theName.toLowerCase ();
			if (theLowerName === "struct") {
				const theAnswer = {};
				if (xmlIsTable (theNode)) {
					xmlSortedKeys (theNode).forEach (function (theKey) {
						if (xmlNodeNamePart (theKey).toLowerCase () === "member") {
							const theMember = theNode [theKey];
							if (!xmlIsTable (theMember)) {
								return;
								}
							const nameKey = xmlNodeFindKey (theMember, "name");
							const valueKey = xmlNodeFindKey (theMember, "value");
							if ((nameKey === undefined) || (valueKey === undefined)) {
								return;
								}
							theAnswer [nodeText (theMember [nameKey])] = convertValueNode (theMember [valueKey]);
							}
						});
					}
				return (theAnswer);
				}
			if (theLowerName === "array") {
				const theAnswer = [];
				if (xmlIsTable (theNode)) {
					const dataKey = xmlNodeFindKey (theNode, "data");
					if (dataKey !== undefined) {
						const theData = theNode [dataKey];
						if (xmlIsTable (theData)) {
							xmlSortedKeys (theData).forEach (function (theKey) {
								if (xmlNodeNamePart (theKey).toLowerCase () === "value") {
									theAnswer.push (convertValueNode (theData [theKey]));
									}
								});
							}
						}
					}
				return (theAnswer);
				}
			if (theLowerName === "base64") {
				return (verbs ["lang.binary"] ([verbs ["base64.decode"] ([nodeText (theNode)])]));
				}
			if ((theLowerName === "i4") || (theLowerName === "int") || (theLowerName === "i1") || (theLowerName === "i2")) {
				return (Math.trunc (Number (nodeText (theNode))));
				}
			if ((theLowerName === "double") || (theLowerName === "float")) {
				return (new Number (Number (nodeText (theNode)))); //boxed, so it stays a double
				}
			if (theLowerName === "boolean") {
				const theString = nodeText (theNode);
				if (/^[0-9.]+$/.test (theString)) {
					return (Number (theString) !== 0);
					}
				return ((theString.length > 0) && (theString.toLowerCase () !== "false"));
				}
			if (theLowerName === "string") {
				return (nodeText (theNode));
				}
			if (theLowerName === "datetime.iso8601") { //19980616T09:54:52, local time the kernel's way
				const s = nodeText (theNode);
				return (new Date (Number (s.slice (0, 4)), Number (s.slice (4, 6)) - 1, Number (s.slice (6, 8)),
					Number (s.slice (9, 11)), Number (s.slice (12, 14)), Number (s.slice (15, 17))));
				}
			if (xmlIsTable (theNode) && (theNode ["/pcdata"] !== undefined) && (xmlSortedKeys (theNode).length === 1)) {
				return (nodeText (theNode)); //a plain element holding only its text
				}
			return (theNode); //anything else passes through as itself
			}

		var theRawName = String (verbs ["nameof"] ([adrStruct]));
		if ((theRawName.indexOf ("[\"") === 0) && (theRawName.lastIndexOf ("\"]") === theRawName.length - 2)) { //a bracketed path component: ["00001<tab>struct"]
			theRawName = theRawName.slice (2, theRawName.length - 2);
			}
		adrValue.reference.set (convert (xmlNodeNamePart (theRawName), adrStruct.reference.get ()));
		return (true);
		};

	verbs ["script.compile"] = function (args, environment) { //compilation here is the parse; do it now so errors surface at compile time
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't compile the script because the parameter isn't an address.";
			throw new Error (message);
			}
		const theScript = theAddress.reference.get ();
		if ((theScript === undefined) || (theScript.flOdbScript !== true)) {
			const message = "Can't compile the script at " + theAddress.pathText + " because there is no script there.";
			throw new Error (message);
			}
		if ((theScript.parsedStatements === undefined) && (environment.parseScript !== undefined)) {
			theScript.parsedStatements = environment.parseScript (theScript.lines);
			}
		return (true);
		};
	
	verbs ["file.newfolder"] = function (args) {
		fs.mkdirSync (macToReal (args [0]), {recursive: true});
		return (true);
		};
	
	verbs ["string.popleading"] = function (args) { //strip every leading occurrence of the character
		var theString = String (args [0]);
		const theChar = String (args [1]);
		while (theString.indexOf (theChar) === 0) {
			theString = theString.slice (theChar.length);
			}
		return (theString);
		};
	
	verbs ["string.parsehttpargs"] = function (args) {
		/*  "a=1&b=2" becomes the flat list {"a", "1", "b", "2"} -- names and
			values alternating, url-decoded; webserver.parseArgs walks it two
			at a time.  */
		const theText = String (args [0]);
		const result = [];
		if (theText.trim ().length === 0) {
			return (result);
			}
		function decodePart (thePart) {
			try {
				return (decodeURIComponent (thePart.split ("+").join (" ")));
				}
			catch (err) {
				return (thePart.split ("+").join (" ")); //malformed escapes come through as themselves
				}
			}
		theText.split ("&").forEach (function (pair) {
			if (pair.length === 0) {
				return;
				}
			const ixEquals = pair.indexOf ("=");
			if (ixEquals === -1) {
				result.push (decodePart (pair));
				result.push ("");
				}
			else {
				result.push (decodePart (pair.slice (0, ixEquals)));
				result.push (decodePart (pair.slice (ixEquals + 1)));
				}
			});
		return (result);
		};
	
	verbs ["string.urldecode"] = function (args) {
		return (decodeURIComponent (String (args [0]).split ("+").join (" ")));
		};
	
	verbs ["string.urlencode"] = function (args) {
	
		/*  8/17/26 by CC -- the kernel's encoding leaves a set of characters
			RAW that JavaScript's encodeURIComponent escapes. How we know
			which: his own glue script (system.verbs.builtins.string.urlEncode)
			carries a second table, applied only when flFullEncode is true,
			holding exactly , ; @ < > | $ & + / : = ? ( ) -- a table that would
			be pointless if the kernel call before it had already escaped them.
			So the base encoding is encodeURIComponent with those put back, and
			flFullEncode escapes them again, which is what the glue does.  */
		
		const theRawOnes = {"%2C": ",", "%3B": ";", "%40": "@", "%3C": "<", "%3E": ">", "%7C": "|", "%24": "$", "%26": "&", "%2B": "+", "%2F": "/", "%3A": ":", "%3D": "=", "%3F": "?", "%28": "(", "%29": ")"};
		var theText = encodeURIComponent (String (args [0]));
		if (args [1] === true) { //flFullEncode: everything escaped, the way the glue's table leaves it
			return (theText);
			}
		Object.keys (theRawOnes).forEach (function (theEscape) {
			theText = theText.split (theEscape).join (theRawOnes [theEscape]);
			});
		return (theText);
		};
	
	verbs ["string.poptrailing"] = function (args) { //strip every trailing occurrence of the character
		var theString = String (args [0]);
		const theChar = String (args [1]);
		while (theString.endsWith (theChar)) {
			theString = theString.slice (0, theString.length - theChar.length);
			}
		return (theString);
		};
	
	verbs ["string.trimwhitespace"] = function (args) {
		return (String (args [0]).trim ());
		};
	
	verbs ["string.patternmatch"] = function (args) { //1-based index of the pattern, 0 if absent
	
		/*  8/17/26 by CC -- the kernel takes an optional third parameter, the
			1-based position to start looking from (stringverbs.c, "2004-12-27
			smd: added optional ix parameter"). Matching is case-sensitive, the
			same as ours.  */
		
		const ixStart = (args [2] === undefined) ? 0 : (Number (args [2]) - 1);
		return (String (args [1]).indexOf (String (args [0]), (ixStart > 0) ? ixStart : 0) + 1);
		};
	
	verbs ["string.urlsplit"] = function (args) {
	
		/*  8/17/26 by CC -- three parts, and the FIRST ONE CARRIES ITS
			SLASHES: the glue's own comment says list [1] is "the protocol,
			e.g. http://". Ours answered "http", so a script that glues the
			parts back together built a url with the slashes missing. The
			third part has no leading slash either -- "essays/97/04/myLife.html"
			in the glue's example.  */
		
		const theUrl = String (args [0]);
		const ixColon = theUrl.indexOf (":");
		if (ixColon === -1) {
			const message = "Can't split " + theUrl + " because a url must be of the form \"http://www.server.com/hello.html\".";
			throw new Error (message);
			}
		var ixEnd = ixColon;
		while (((ixEnd + 1) < theUrl.length) && (theUrl.charAt (ixEnd + 1) === "/")) {
			ixEnd++;
			}
		const theProtocol = theUrl.slice (0, ixEnd + 1);
		const theRest = theUrl.slice (theProtocol.length);
		const ixSlash = theRest.indexOf ("/");
		if (ixSlash === -1) {
			return ([theProtocol, theRest, ""]);
			}
		return ([theProtocol, theRest.slice (0, ixSlash), theRest.slice (ixSlash + 1)]);
		};
	
	verbs ["table.tablecontains"] = function (args, environment) {
	
		/*  8/17/26 by CC -- the glue walks PARENTS, not text: "5/18/98 PBS:
			Use parentOf instead of string manipulation. More reliable, will
			work with guest databases." Ours compared the two paths as
			strings, which gets a bracketed guest-database path wrong and gets
			any two spellings of the same object wrong. This walks up from the
			item, comparing the objects themselves.  */
		
		const adrTable = args [0];
		const adrItem = args [1];
		if ((adrTable === undefined) || (adrTable === null) || (adrTable.flAddress !== true)) {
			return (false);
			}
		if ((adrItem === undefined) || (adrItem === null) || (adrItem.flAddress !== true)) {
			return (false);
			}
		const theTable = adrTable.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (false);
			}
		
		/*  Walk down from the root along the item's path, and answer true if
			the table turns up as one of the parents on the way. Object
			identity is what's compared, so two spellings of one table match
			and two different tables with the same name don't.  */
		
		const theParts = adrItem.pathText.split (".");
		var current = environment.odb;
		var ixPart;
		for (ixPart = 0; ixPart < theParts.length; ixPart++) {
			if ((current === undefined) || (current === null) || (typeof current !== "object")) {
				return (false);
				}
			if (current === theTable) {
				return (true);
				}
			var theKey;
			Object.keys (current).forEach (function (theName) {
				if ((theKey === undefined) && (theName.toLowerCase () === theParts [ixPart].toLowerCase ())) {
					theKey = theName;
					}
				});
			if (theKey === undefined) {
				return (false);
				}
			current = current [theKey];
			}
		return (false); //the item itself is not "contained in" the table it IS
		};
	
	/*  Guest databases: an open database is a table at the odb root whose
		name is the file's full colon path, which is exactly what [f]
		resolves to. Opening reads a real .root through frontierOdb;
		creating registers an empty table and touches the real file so
		file.exists agrees; saving is a no-op in this in-memory world.  */
	
	function findDatabaseKey (theOdb, thePath) {
		const lower = thePath.toLowerCase ();
		var found;
		Object.keys (theOdb).forEach (function (key) {
			if ((found === undefined) && (key.toLowerCase () === lower)) {
				found = key;
				}
			});
		return (found);
		}
	
	function flGuestInstalled (theOdb, thePath) { //9/4/26 by CC -- a file whose name is a record in system.compiler.files is a guest the scanner or the build already installed: open, the kernel's filewindowtable would say
		const theFileName = String (thePath).split (/[:\/]/).pop ().toLowerCase ();
		try {
			const filesTable = theOdb.system.compiler.files;
			var found = false;
			Reflect.ownKeys (filesTable).forEach (function (theKey) {
				if (!found && (typeof theKey === "string") && (theKey.toLowerCase () === theFileName)) {
					const theRecord = filesTable [theKey];
					found = ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && ((theRecord.path !== undefined) || (theRecord.adr !== undefined)));
					}
				});
			return (found);
			}
		catch (err) {
			return (false);
			}
		}
	
	verbs ["filemenu.open"] = function (args, environment) {
		const thePath = String (args [0]);
		if ((findDatabaseKey (environment.odb, thePath) !== undefined) || flGuestInstalled (environment.odb, thePath)) {
			return (true); //already open
			}
		const odbHomeTools = require ("./odbHome.js");
		const frontierOdb = odbHomeTools.requireFrontierOdb ();
		const realPath = macToReal (thePath);
		if (!fs.existsSync (realPath)) {
			const message = "Can't open the database " + thePath + " because there is no file with that name.";
			throw new Error (message);
			}
		if (fs.statSync (realPath).size === 0) { //a marker for a database created in this world: empty table
			environment.odb [thePath] = {};
			return (true);
			}
		const theTopLevel = frontierOdb.readRootFile (realPath);
		const theTable = {};
		Object.keys (theTopLevel).forEach (function (name) {
			theTable [name] = odbHomeTools.convertValue (theTopLevel [name]);
			});
		environment.odb [thePath] = theTable;
		return (true);
		};
	
	verbs ["filemenu.new"] = function (args, environment) {
		const thePath = String (args [0]);
		if (flGuestInstalled (environment.odb, thePath)) {
			return (true); //a guest the build or the scanner installed is open already; there is nothing to make
			}
		if (findDatabaseKey (environment.odb, thePath) === undefined) {
			environment.odb [thePath] = {};
			}
		const realPath = macToReal (thePath);
		fs.mkdirSync (path.dirname (realPath), {recursive: true});
		if (!fs.existsSync (realPath)) {
			fs.writeFileSync (realPath, ""); //the marker file, so file.exists agrees the db exists
			try { //9/21/26 by CC -- a database file Frontier makes is type TABL, creator LAND, and table.inGuestDatabase asks exactly that on a Mac (isCarbon is false here, DW's ruling). saveCopy has set them since 9/7; without them here the guest database Manila makes for a new site was "not a guest database", string.popFileFromAddress left the file path on the site's address, and the site tree named a place mainResponder couldn't find
				verbs ["file.settype"] ([thePath, "TABL"]);
				verbs ["file.setcreator"] ([thePath, "LAND"]);
				}
			catch (err) {
				}
			}
		return (true);
		};
	
	verbs ["filemenu.save"] = function (args) {
		return (true); //the in-memory world has nothing to flush yet
		};
	
	verbs ["filemenu.savemyroot"] = function (args) {
		return (true);
		};

	/*  9/6/26 by CC -- fileMenu.saveCopy (path), DW's ask the morning
		rssCodeUpdate.root came into Atlantis: "then we need to hook it up to a
		verb... filemenu.savecopy -- i used it regularly to save a backup of my
		work." The kernel (shellverbs.c, savecopyfunc): a filespec, then
		shellsaveas on the FRONTMOST window without changing the window's own
		file. The glue in the root, system.verbs.builtins.fileMenu.saveCopy,
		calls kernel (filemenu.savecopy) and nothing answered it.

		Which database the front window belongs to is the worker's to say (it
		has the window channel); it hands the answer in through
		environment.frontmostWindowText. Headless there is no window, and the
		copy is of the root. A Tools root's names live at the top of this
		database (system.compiler.files remembers which), so a copy of the root
		leaves them out and a copy of the Tool is exactly them -- the file
		Frontier would have had.  */

	function plainTable (theValue) { //the tree the root writer takes: every table in the reader's own shape, {type: "table", value}, the database's bookkeeping keys off, everything else as it is
		if ((theValue === null) || (typeof theValue !== "object")) {
			return (theValue);
			}
		if ((theValue.flOdbScript === true) || (theValue.flOdbMenubar === true) || (theValue.flWpText === true) || (theValue.flAddress === true) || (theValue.flOdbAddressText === true) || (theValue.flFilespec === true) || Array.isArray (theValue) || (theValue instanceof Date) || (theValue instanceof Number) || charvalue.flCharValue (theValue)) {
			return (theValue);
			}
		if ((theValue.flOdbSqlTable !== true) && (typeof theValue.type === "string") && (typeof theValue.length === "number")) {
			return (theValue); //a marker the reader kept: type and length, maybe the bytes
			}
		if ((theValue.flOdbSqlTable !== true) && (theValue.type === "binary") && (theValue.data !== undefined)) {
			return (theValue); //binary: {type, data}. 9/8/26 by CC -- the database hands a binary back with a toString of its own, a third key, and the count of two here made it a table: DW's saveCopy of rssCodeUpdate.root carried #images.space as a table of type and data
			}

		/*  A table goes out wrapped, so an ENTRY named type or value or raw in
			it can't be mistaken for the value's own shape: system.verbs.apps.
			FinderMenu.data is a table with an entry named type, "JPEG", and
			bare it read as "a JPEG the reader kept as a marker."  */

		const theCopy = {};
		Reflect.ownKeys (theValue).forEach (function (theName) {
			if ((typeof theName !== "string") || (theName === "flOdbSqlTable") || (theName === "odbId")) {
				return;
				}
			theCopy [theName] = plainTable (theValue [theName]);
			});
		return ({type: "table", value: theCopy});
		}

	function guestRecordForFile (theOdb, theFileName) { //the system.compiler.files record for a guest the scanner installed, by file name, or undefined
		const lower = String (theFileName).split (/[:\/]/).pop ().toLowerCase ();
		try {
			const filesTable = theOdb.system.compiler.files;
			var found;
			Reflect.ownKeys (filesTable).forEach (function (theKey) {
				if ((found === undefined) && (typeof theKey === "string") && (theKey.toLowerCase () === lower)) {
					const theRecord = filesTable [theKey];
					if ((theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && Array.isArray (theRecord.names)) {
						found = theRecord;
						}
					}
				});
			return (found);
			}
		catch (err) {
			return (undefined);
			}
		}

	function namesOwnedByGuests (theOdb) { //every top-level name some installed Tools root brought in
		const theNames = [];
		try {
			const filesTable = theOdb.system.compiler.files;
			Reflect.ownKeys (filesTable).forEach (function (theKey) {
				const theRecord = filesTable [theKey];
				if ((typeof theKey === "string") && (theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && Array.isArray (theRecord.names)) {
					theRecord.names.forEach (function (theName) {
						theNames.push (String (theName).toLowerCase ());
						});
					}
				});
			}
		catch (err) {
			}
		return (theNames);
		}

	function databaseTreeForWindow (environment, theWindowText) { //the table a copy writes, for the database the window at theWindowText belongs to: {name, tree}
		const theOdb = environment.odb;
		var theText = ((theWindowText === undefined) || (theWindowText === null)) ? "" : String (theWindowText);
		if (theText.indexOf ("[") === 0) { //a guest database's window: ["Macintosh HD:...:x.root"].table
			const thePath = theText.slice (1, theText.indexOf ("]")).replace (/^"|"$/g, "");
			const theKey = findDatabaseKey (theOdb, thePath);
			if (theKey !== undefined) { //a guest made or opened in this world: its own table
				return ({name: thePath, tree: plainTable (theOdb [theKey])});
				}
			const theRecord = guestRecordForFile (theOdb, thePath);
			if (theRecord !== undefined) { //a Tools root: the names it brought in
				const theTree = {};
				theRecord.names.forEach (function (theName) {
					const realKey = findDatabaseKey (theOdb, theName);
					if (realKey !== undefined) {
						theTree [realKey] = plainTable (theOdb [realKey]);
						}
					});
				return ({name: thePath, tree: theTree});
				}
			const message = "Can't save a copy of " + thePath + " because no database with that name is open.";
			throw new Error (message);
			}
		const theFirstName = theText.split (".") [0].toLowerCase ();
		if (theFirstName.length > 0) { //a window on a table a Tools root brought in: the copy is of that Tool
			var theOwner;
			try {
				const filesTable = theOdb.system.compiler.files;
				Reflect.ownKeys (filesTable).forEach (function (theKey) {
					const theRecord = filesTable [theKey];
					if ((theOwner === undefined) && (typeof theKey === "string") && (theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && Array.isArray (theRecord.names)) {
						theRecord.names.forEach (function (theName) {
							if (String (theName).toLowerCase () === theFirstName) {
								theOwner = theKey;
								}
							});
						}
					});
				}
			catch (err) {
				}
			if (theOwner !== undefined) {
				return (databaseTreeForWindow (environment, "[" + theOwner + "]"));
				}
			}
		const owned = namesOwnedByGuests (theOdb); //the root: everything but the guests' names and the guests themselves
		const theTree = {};
		Reflect.ownKeys (theOdb).forEach (function (theName) {
			if ((typeof theName !== "string") || (theName === "flOdbSqlTable") || (theName === "odbId")) {
				return;
				}
			if ((theName.indexOf (":") !== -1) || (theName.indexOf ("/") === 0)) {
				return; //a guest database opened in this world, keyed by its path
				}
			if (owned.indexOf (theName.toLowerCase ()) !== -1) {
				return;
				}
			theTree [theName] = plainTable (theOdb [theName]);
			});
		try { //the scanner's own records of installed Tools (names, path, fileModified in system.compiler.files) describe files beside THIS database, not the copy; and their names lists are the one thing the root writer can't write yet
			const filesTable = theTree.system.value.compiler.value.files.value;
			Reflect.ownKeys (filesTable).forEach (function (theKey) {
				const theRecord = filesTable [theKey];
				if ((typeof theKey === "string") && (theRecord !== undefined) && (theRecord !== null) && (typeof theRecord === "object") && (theRecord.type === "table") && Array.isArray (theRecord.value.names)) {
					delete filesTable [theKey];
					}
				});
			}
		catch (err) {
			}
		return ({name: "frontier.root", tree: theTree});
		}

	verbs ["filemenu.savecopy"] = function (args, environment) {
		const thePath = ((args [0] === undefined) || (args [0] === null)) ? "" : String (args [0]);
		if (thePath.length === 0) {
			const message = "Can't save a copy because no file path was given.";
			throw new Error (message);
			}
		if (thePathMap.flAllowDiskWrites !== true) {
			const message = "Can't save a copy to " + thePath + " because writing files is not allowed here.";
			throw new Error (message);
			}
		const theWindowText = (environment.frontmostWindowText === undefined) ? "" : environment.frontmostWindowText ();
		const theDatabase = databaseTreeForWindow (environment, theWindowText);
		writeDatabaseCopy (theDatabase, thePath, environment, "filemenu.savecopy");
		return (true);
		};

	/*  9/20/26 by CC -- fileMenu.saveNamedRoot (rootFileName, fdest), DW's ask:
		"i need a function that makes a copy of a specified root, by its name,
		and says where i want to save it." Not a kernel verb -- Frontier had
		no need of one, fileMenu.saveMyRoot and file.copy did it, and here save
		does nothing and a Tool's file is the Tool as installed. saveCopy goes
		by the front window, and his nightly backup has none. The name is a
		file name or the full path: an installed Tool, an open guest database,
		or frontier.root. The file written is saveCopy's.  */

	function databaseTreeForName (environment, theRootName) { //the table a copy writes, for the database named: {name, tree}
		const theOdb = environment.odb;
		const theFileName = String (theRootName).split (/[:\/]/).pop ().toLowerCase ();
		var theGuestPath = findDatabaseKey (theOdb, theRootName); //a guest opened in this world, by its full path
		if (theGuestPath === undefined) { //or by its file name
			Object.keys (theOdb).forEach (function (theKey) {
				if ((theGuestPath === undefined) && (theKey.indexOf (":") !== -1) && (theKey.split (":").pop ().toLowerCase () === theFileName)) {
					theGuestPath = theKey;
					}
				});
			}
		if (theGuestPath !== undefined) {
			return (databaseTreeForWindow (environment, "[\"" + theGuestPath + "\"]"));
			}
		if (guestRecordForFile (theOdb, theRootName) !== undefined) { //a Tools root
			return (databaseTreeForWindow (environment, "[\"" + theRootName + "\"]"));
			}
		if (theFileName === "frontier.root") { //the main root, the name Frontier.getFilePath gives it
			return (databaseTreeForWindow (environment, ""));
			}
		const message = "Can't save a copy of " + theRootName + " because no database with that name is open.";
		throw new Error (message);
		}

	verbs ["filemenu.savenamedroot"] = function (args, environment) {
		const theRootName = ((args [0] === undefined) || (args [0] === null)) ? "" : String (args [0]);
		const thePath = ((args [1] === undefined) || (args [1] === null)) ? "" : String (args [1]);
		if (theRootName.length === 0) {
			const message = "Can't save a copy because no database was named.";
			throw new Error (message);
			}
		if (thePath.length === 0) {
			const message = "Can't save a copy of " + theRootName + " because no file path was given.";
			throw new Error (message);
			}
		if (thePathMap.flAllowDiskWrites !== true) {
			const message = "Can't save a copy to " + thePath + " because writing files is not allowed here.";
			throw new Error (message);
			}
		const theDatabase = databaseTreeForName (environment, theRootName);
		if (Reflect.ownKeys (theDatabase.tree).length === 0) { //config.root's record lists no names: its table is part of frontier.root here
			const message = "Can't save a copy of " + theRootName + " because it has no tables of its own in this database.";
			throw new Error (message);
			}
		writeDatabaseCopy (theDatabase, thePath, environment, "filemenu.savenamedroot");
		return (true);
		};

	function writeDatabaseCopy (theDatabase, thePath, environment, theVerbName) { //the .root file saveCopy and saveNamedRoot write
		const realPath = macToReal (thePath);
		try {
			fs.mkdirSync (path.dirname (realPath), {recursive: true});
			const frontierOdb = require ("./odbHome.js").requireFrontierOdb ();
			frontierOdb.writeRootFile (realPath, theDatabase.tree);
			}
		catch (err) { //9/8/26 by CC -- DW saw "EPERM: operation not permitted, open '/Volumes/(computed)'" raw; a file error reads as a sentence
			var theReason = "the file couldn't be written";
			if ((err.code === "ENOENT") || (err.code === "ENOTDIR")) {
				theReason = "there is no folder at that path";
				}
			else if ((err.code === "EPERM") || (err.code === "EACCES") || (err.code === "EROFS")) {
				theReason = "writing there isn't permitted";
				}
			const message = "Can't save a copy to " + thePath + " because " + theReason + ".";
			throw new Error (message);
			}
		try { //9/7/26 by CC -- a database file Frontier writes carries type 'TABL' and creator 'LAND'; table.inGuestDatabase asks for exactly those
			verbs ["file.settype"] ([thePath, "TABL"]);
			verbs ["file.setcreator"] ([thePath, "LAND"]);
			}
		catch (err) {
			}
		environment.trace.push ({verb: theVerbName, args: [theDatabase.name, thePath]});
		}
	
	verbs ["filemenu.close"] = function (args) {
		return (true);
		};
	
	verbs ["string.isalpha"] = function (args) {
		const theChar = String (args [0]).charAt (0);
		return (((theChar >= "a") && (theChar <= "z")) || ((theChar >= "A") && (theChar <= "Z")));
		};
	
	verbs ["string.isnumeric"] = function (args) {
		const theChar = String (args [0]).charAt (0);
		return ((theChar >= "0") && (theChar <= "9"));
		};
	
	verbs ["string.nthchar"] = function (args) {

		/*  9/6/26 by CC -- A CHAR, NOT A ONE-CHARACTER STRING. The kernel
			(langverbs.c, nthcharfunc) answers setcharvalue of the byte; out of
			range it answers the empty string. The s3 suite's HMAC does
			bit.logicalXor (string.nthChar (key, i), char (0x36)), and a
			one-character string there coerced to zero, so every S3 signature
			the suite computed was wrong: "The request signature we
			calculated does not match the signature you provided" -- DW's
			deal-stopper the afternoon of 9/6, on the first codecasting part.  */

		const theText = String (args [0]);
		const theIndex = Number (args [1]);
		if ((theIndex < 1) || (theIndex > theText.length)) {
			return ("");
			}
		return (charvalue.makeChar (theText.charCodeAt (theIndex - 1))); //9/14/26 by CC -- the whole code; a character above 255 keeps its identity (charvalue.js)
		};
	
	verbs ["string.innercasename"] = function (args) {
	
		/*  8/17/26 by CC -- "Nirvana Server" becomes "nirvanaServer". The
			kernel LOWERCASES THE WHOLE NAME FIRST, then capitalizes the letter
			after each space and closes the gap -- the old UserTalk in the glue
			spells the algorithm out. Ours kept whatever capitalization was
			already inside a word, so a shouted name came out shouted.  */
		
		var theName = String (args [0]).toLowerCase ().trim ();
		var theResult = "";
		var flCapitalizeNext = false;
		var ixChar;
		for (ixChar = 0; ixChar < theName.length; ixChar++) {
			const theChar = theName.charAt (ixChar);
			if (theChar === " ") {
				flCapitalizeNext = true;
				}
			else {
				theResult += (flCapitalizeNext ? theChar.toUpperCase () : theChar);
				flCapitalizeNext = false;
				}
			}
		return (theResult);
		};
	
	verbs ["string.insert"] = function (args) { //insert the first string into the second at a 1-based position
		const theInsert = String (args [0]);
		const theString = String (args [1]);
		const ixAt = args [2] - 1;
		return (theString.slice (0, ixAt) + theInsert + theString.slice (ixAt));
		};
	
	verbs ["string.padwithzeros"] = function (args) {
		var theString = String (args [0]);
		while (theString.length < args [1]) {
			theString = "0" + theString;
			}
		return (theString);
		};
	
	verbs ["lang.binary"] = function (args) { //binary coercion; a wrapped string survives the string () round trip
		const theValue = args [0];
		if ((theValue !== undefined) && (theValue !== null) && (typeof theValue === "object") && (theValue.type === "binary")) {
			return (theValue);
			}
		return ({
			type: "binary",
			data: String (theValue),
			toString: function () {
				return (this.data);
				}
			});
		};
	
	verbs ["binary"] = verbs ["lang.binary"];
	
	/*  8/17/26 by CC -- a binary value carries a TYPE in Frontier, a four
		character code saying what the bytes are, and these two are how a
		script reads and sets it. We had neither, so a script that stamps a
		type on data (an image, a sound, a packed record) had nowhere to put
		it. The type rides on the value; binary () makes one with an empty
		type and these fill it in.  */
	
	verbs ["lang.getbinarytype"] = function (args) {
		const theValue = args [0];
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object") || (theValue.type !== "binary")) {
			const message = "Can't get the binary type because the value isn't binary.";
			throw new Error (message);
			}
		return ((theValue.binaryType === undefined) ? "????" : theValue.binaryType);
		};
	
	verbs ["getbinarytype"] = verbs ["lang.getbinarytype"];
	
	/*  8/22/26 by CC -- SETBINARYTYPE TAKES AN ADDRESS, GETBINARYTYPE TAKES A
		VALUE. The kernel is deliberately asymmetric about it: getbinarytypefunc
		calls getparamvalue, setbinarytypefunc calls getvarvalue and then
		langsymbolchanged, because it stamps the type on the variable in place.
		We took a value on both, so DW's fatPages.unpackOdbObject -- which
		writes setBinaryType (@data, objectType) the way Frontier's own code
		does -- failed on every fat file. A bare value still works here.  */
	
	verbs ["lang.setbinarytype"] = function (args) {
		const theArgument = args [0];
		const flAddress = ((theArgument !== undefined) && (theArgument !== null) && (theArgument.flAddress === true));
		const theValue = flAddress ? theArgument.reference.get () : theArgument;
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object") || (theValue.type !== "binary")) {
			const message = "Can't set the binary type because the value isn't binary.";
			throw new Error (message);
			}
		theValue.binaryType = String (args [1]);
		if (flAddress) {
			theArgument.reference.set (theValue); //the kernel calls langsymbolchanged here -- the variable holds the stamped value
			}
		return (true);
		};
	
	verbs ["setbinarytype"] = verbs ["lang.setbinarytype"];
	
	verbs ["lang.boolean"] = function (args) {
		const theValue = args [0];
		if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- coercetoboolean: true unless the code is 0
			return (theValue.valueOf () !== 0);
			}
		return ((theValue !== false) && (theValue !== undefined) && (theValue !== 0) && (theValue !== "") && (theValue !== "false"));
		};
	
	verbs ["boolean"] = verbs ["lang.boolean"];
	
	verbs ["char"] = function (args) {

		/*  8/26/26 by CC -- a real char value now, DW's go-ahead. The
			coercions are coercetochar's (langvalue.c): a char passes
			through; nil is '0'; a boolean is 0 or 1; a string must be
			exactly one character (stringtochar); a number must fit a byte,
			0 through 255 (charoutofrangeerror).  */

		const theValue = args [0];
		if (charvalue.flCharValue (theValue)) {
			return (theValue);
			}
		if (theValue === undefined) {
			return (charvalue.makeChar (48)); //nil coerces to '0', coercetochar's rule
			}
		if (typeof theValue === "boolean") {
			return (charvalue.makeChar (theValue ? 1 : 0));
			}
		if (typeof theValue === "string") {
			if (theValue.length !== 1) {
				const message = "Can't coerce the string \"" + theValue + "\" to a char because it isn't exactly one character long.";
				throw new Error (message);
				}
			return (charvalue.makeChar (theValue.charCodeAt (0)));
			}
		const theCode = Math.trunc (Number (theValue));
		if ((theCode < 0) || (theCode > 255) || Number.isNaN (theCode)) {
			const message = "Can't coerce " + theValue + " to a char because a character code goes from 0 to 255.";
			throw new Error (message);
			}
		return (charvalue.makeChar (theCode));
		};
	
	verbs ["random"] = function (args) { //random (min, max), character bounds legal
		var min = args [0], max = args [1];
		if (typeof min === "string") {
			min = min.charCodeAt (0);
			}
		if (typeof max === "string") {
			max = max.charCodeAt (0);
			}
		return (min + Math.floor (Math.random () * (max - min + 1)));
		};
	
	function addressTextParts (theText) { //9/8/26 by CC -- the names in address text, in order: a.b.c, [x].y, ["Macintosh HD:...:x.root"].a; the bracket's quotes come off
		const parts = [];
		var rest = theText;
		while (rest.length > 0) {
			if (rest.indexOf ("[") === 0) {

				/*  9/21/26 by CC -- A BRACKET THAT NEVER CLOSES ENDED THE SERVER.
					With no ] in the text the walk never moved, the list of names
					grew without end, and V8 stopped the whole process ("Fatal
					JavaScript invalid size error") -- found when the Manila
					site's RSS feed was asked for. It is a syntax error, the
					kernel's words. And a quoted name ends at its closing quote
					and bracket, so a ] inside the quotes is part of the name.  */

				var ixClose;
				if (rest.indexOf ("[\"") === 0) {
					ixClose = rest.indexOf ("\"]", 2);
					if (ixClose !== -1) {
						ixClose++; //at the bracket
						}
					}
				else {
					ixClose = rest.indexOf ("]");
					}
				if (ixClose === -1) {
					if ((process.env.USERTALK_ERROR_TRAIL !== undefined) && (process.env.USERTALK_ERROR_TRAIL.indexOf ("/") !== -1)) { //the bench aid: which text it was
						try {
							fs.appendFileSync (process.env.USERTALK_ERROR_TRAIL, "address text that doesn't parse: " + JSON.stringify (theText) + "\n");
							}
						catch (errWrite) {
							}
						}
					const message = "Can't parse the address because of a syntax error.";
					throw new Error (message);
					}
				var bracketed = rest.slice (1, ixClose);
				if ((bracketed.indexOf ("\"") === 0) && (bracketed.lastIndexOf ("\"") === bracketed.length - 1)) {
					bracketed = bracketed.slice (1, bracketed.length - 1);
					}
				parts.push (bracketed);
				rest = rest.slice (ixClose + 1);
				}
			else {
				var ixDot = rest.indexOf (".");
				var ixBracket = rest.indexOf ("[");
				if (ixDot === -1) {
					ixDot = rest.length;
					}
				if ((ixBracket !== -1) && (ixBracket < ixDot)) {
					ixDot = ixBracket;
					}
				if (ixDot > 0) {
					parts.push (rest.slice (0, ixDot));
					}
				rest = rest.slice (ixDot);
				}
			if (rest.indexOf (".") === 0) {
				rest = rest.slice (1);
				}
			}
		return (parts);
		}

	function addressFromText (theText, environment) {
		if (String (theText).trim ().toLowerCase () === "root") { //9/12/26 by CC -- the special table (langgetspecialtable): "root" as text, a stored @root, or @root handed to a script all mean the root table, so adr^ answers it and table.getRootAddress (@root) works (DW, 9/12)
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

		/*  9/8/26 by CC -- THIS WAS string.parseAddress, AND IT ISN'T THE
			KERNEL'S. The kernel's string.parseAddress (stringverbs.c,
			parseaddress) answers a LIST of the address's names; this is the
			text-to-address coercion, which the kernel does in stringtoaddress
			(langvalue.c) and the language reaches through address (text).
			Every internal caller uses this function now, and lang.address
			wraps it; string.parseAddress is the kernel's, below lang.address.

			Address text to an address value: "config.manila.sites" or
			["Macintosh HD:...:site.root"].siteTable.sub. Resolves lazily
			against the odb each time it's used, parents created on set.  */

		theText = String (theText);

		if (localAddresses.flToken (theText)) { //9/21/26 by CC -- the address of a local table that was put in the database: the running address while the local lives, and after that an address that leads to nothing (localAddresses.js)
			const theRunningAddress = localAddresses.lookup (theText);
			if (theRunningAddress !== undefined) {
				return (theRunningAddress);
				}
			return ({flAddress: true, pathText: theText, nameText: theText, reference: {
				get: function () {
					return (undefined);
					},
				set: function (theValue) {
					const message = "Can't set the value because the address is of a local table that is gone.";
					throw new Error (message);
					}
				}});
			}

		/*  9/7/26 by CC -- "user.menus.customMenu line 6": THE SCRIPT ATTACHED
			TO A MENU COMMAND, the object a menu-script window shows. It has
			no address of its own inside the menubar, so the window names it
			this way, and window.frontmost answered that text -- and then
			nothing could dereference it: his cmd-4 time-stamp command,
			checking the front window's object, said it "doesn't contain an
			outline." Reading through this address answers the command's
			script; writing through it puts the script back on the line and
			saves the menubar, which is what the op verbs' save does.  */

		const lineMatch = theText.match (/^(.+?) line (\d+)$/i);
		if (lineMatch !== null) {
			const menubarAddress = addressFromText (lineMatch [1], environment);
			const ixLine = Number (lineMatch [2]);
			function menubarValue () {
				var theMenubar;
				try {
					theMenubar = menubarAddress.reference.get ();
					}
				catch (err) {
					theMenubar = undefined;
					}
				if ((theMenubar === undefined) || (theMenubar === null) || (theMenubar.flOdbMenubar !== true) || !Array.isArray (theMenubar.lines)) {
					return (undefined);
					}
				return (theMenubar);
				}
			return ({
				flAddress: true,
				pathText: theText,
				nameText: "line " + ixLine,
				reference: {
					get: function () {
						const theMenubar = menubarValue ();
						if ((theMenubar === undefined) || (theMenubar.lines [ixLine] === undefined)) {
							return (undefined);
							}
						const theLine = theMenubar.lines [ixLine];
						const theLines = ((theLine.script !== undefined) && (theLine.script !== null) && Array.isArray (theLine.script.lines)) ? theLine.script.lines : [{level: 0, text: "", flExpanded: true, flComment: false, flBreakpoint: false}];
						return ({flOdbScript: true, scriptType: "script", lines: theLines});
						},
					set: function (theValue) {
						const theMenubar = menubarValue ();
						if ((theMenubar === undefined) || (theMenubar.lines [ixLine] === undefined)) {
							const message = "Can't set the script on " + theText + " because there is no menu command there.";
							throw new Error (message);
							}
						const theLines = theMenubar.lines.slice ();
						const newScriptLines = ((theValue !== undefined) && (theValue !== null) && Array.isArray (theValue.lines)) ? theValue.lines : [];
						theLines [ixLine] = Object.assign ({}, theLines [ixLine], {script: {lines: newScriptLines}});
						menubarAddress.reference.set ({flOdbMenubar: true, lines: theLines});
						},
					remove: function () {
						const theMenubar = menubarValue ();
						if ((theMenubar === undefined) || (theMenubar.lines [ixLine] === undefined)) {
							return;
							}
						const theLines = theMenubar.lines.slice ();
						const theLine = Object.assign ({}, theLines [ixLine]);
						delete theLine.script;
						theLines [ixLine] = theLine;
						menubarAddress.reference.set ({flOdbMenubar: true, lines: theLines});
						}
					}
				});
			}
		const parts = addressTextParts (theText);
		
		function findKeyHere (theTable, theName) {
			if (theTable [theName] !== undefined) {
				return (theName);
				}
			const lower = theName.toLowerCase ();
			var found;
			Object.keys (theTable).forEach (function (key) {
				if ((found === undefined) && (key.toLowerCase () === lower)) {
					found = key;
					}
				});
			return (found);
			}
		
		/*  8/23/26 by CC -- WHERE THE WALK STARTS. It always started at the
			root, so "tcp.httpReadUrl" -- which is what a window carries and
			what a person types into the jump dialog -- reached nothing, while
			@tcp.httpReadUrl written in a script found it through the search
			path. The two spellings have to answer the same thing.

			Reading falls back to the paths tables the way the language does.
			Assigning does not: a new unqualified name still comes into being
			at the root, which is what Frontier does and what every one-liner
			that makes something at the top level depends on.  */

		function baseTable (flCreate) {
			if (flCreate || (parts.length === 0)) {
				return (environment.odb);
				}
			if (findKeyHere (environment.odb, parts [0]) !== undefined) {
				return (environment.odb);
				}
			if (environment.pathsTablesForOdb === undefined) {
				return (environment.odb);
				}
			var theAnswer = environment.odb;
			var flFound = false;
			environment.pathsTablesForOdb (environment.odb).forEach (function (pathsTable) {
				if (!flFound) {
					if (findKeyHere (pathsTable, parts [0]) !== undefined) {
						theAnswer = pathsTable;
						flFound = true;
						}
					}
				});
			if (!flFound) { //9/21/26 by CC -- and then the root table of every open database file, in name order: langsearchpathvisit's last stop (5.1b21), the same walk evaluate.js referenceForId makes. address ("benchSiteManilaWebsite") is what mainResponder gets from a domain's site tree for a Manila site kept in a guest database
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
					const theGuestRoot = environment.odb [theGuestKey];
					if (!flFound && (theGuestRoot !== undefined) && (theGuestRoot !== null) && (typeof theGuestRoot === "object") && (theGuestRoot.flOdbScript === undefined) && !Array.isArray (theGuestRoot)) {
						if (findKeyHere (theGuestRoot, parts [0]) !== undefined) {
							theAnswer = theGuestRoot;
							flFound = true;
							}
						}
					});
				}
			return (theAnswer);
			}

		function guestBase () {

			/*  9/10/26 by CC -- A FIRST NAME THAT IS A DATABASE'S FILE PATH,
				["Macintosh HD:...:apps:config.root"].config.nodeEditor: the
				language's rule (evaluate.js referenceForId, guestRecordForFilePath)
				answers the guest's root table -- an open file by its exact path,
				else the installed or mounted guest by file name. This walk started
				at the root and CREATED a table named by the path, so the part DW
				imported on 9/10, addressed the way Frontier on Berkeley wrote it,
				landed in a stray database instead of the config.root that ships.  */

			if ((parts.length > 1) && (environment.guestRootForFilePath !== undefined) && (findKeyHere (environment.odb, parts [0]) === undefined)) {
				return (environment.guestRootForFilePath (parts [0]));
				}
			return (undefined);
			}

		function walkToParent (flCreate) {
			var current = baseTable (flCreate);
			var ixPart = 0;
			const theGuestRoot = guestBase ();
			if (theGuestRoot !== undefined) {
				current = theGuestRoot;
				ixPart = 1;
				}
			for (; ixPart < parts.length - 1; ixPart++) {
				if ((current === undefined) || (current === null) || (typeof current !== "object")) {
					return (undefined);
					}
				var key = findKeyHere (current, parts [ixPart]);
				if (key === undefined) {
					if (!flCreate) {
						return (undefined);
						}
					key = parts [ixPart];
					current [key] = {};
					}
				current = current [key];
				}
			return (current);
			}
		
		const lastPart = parts [parts.length - 1];
		
		/*  9/6/26 by CC -- the text keeps brackets around a name that isn't a
			plain identifier -- a database's path, a name with a dot -- the way
			the evaluator's own addresses write theirs, so an address that goes
			into the database and comes back parses the same way twice. Joining
			on dots turned [Macintosh HD:...:rssCodeUpdateData.root].
			rssCodeUpdateData into text nothing could read back.  */
		
		const quotedParts = [];
		parts.forEach (function (thePart) {
			if (/^[A-Za-z_][A-Za-z0-9_]*$/.test (thePart) || (thePart.indexOf ("[") === 0)) {
				quotedParts.push (thePart);
				}
			else {
				quotedParts.push ("[\"" + thePart + "\"]");
				}
			});
		
		return ({
			flAddress: true,
			pathText: quotedParts.join ("."),
			reference: {
				get: function () {
					const parent = walkToParent (false);
					if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
						return (undefined);
						}
					const key = findKeyHere (parent, lastPart);
					return ((key === undefined) ? undefined : parent [key]);
					},
				set: function (theValue) {
					const parent = walkToParent (true);
					if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
						const message = "Can't set the value at " + theText + " because the path can't be reached.";
						throw new Error (message);
						}
					var key = findKeyHere (parent, lastPart);
					if (key === undefined) {
						key = lastPart;
						}
					parent [key] = theValue;
					},
				remove: function () {
					const parent = walkToParent (false);
					if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
						return;
						}
					const key = findKeyHere (parent, lastPart);
					if (key !== undefined) {
						delete parent [key];
						}
					},

				/*  8/23/26 by CC -- the table the last name really lives in,
					and the name in it. The evaluator's own addresses have had
					this since 8/21; these did not, so anything that asked an
					address built from TEXT where its object really is got
					back the text instead. That is what window.frontmost hands
					out, and a window that saves back to the text writes to
					the root -- how a table called op appeared beside system
					and user on 8/21. The walk is the same one get () does,
					which since 8/23 falls back to the search path.  */

				place: function () {
					const parent = walkToParent (false);
					if ((parent === undefined) || (parent === null) || (typeof parent !== "object")) {
						return (undefined);
						}
					const key = findKeyHere (parent, lastPart);
					if (key === undefined) {
						return (undefined);
						}
					return ({container: parent, key});
					}
				}
			});
		}
	
	/*  Word-processing text: a string that knows it's a wp object. New
		templates are built from strings, so this covers the create path;
		wptext loaded from old databases still arrives as an undecoded
		marker until frontierOdb learns the format.  */
	
	function makeWpText (theText) {
		return ({
			flWpText: true,
			text: String (theText),
			toString: function () {
				return (this.text);
				}
			});
		}
	
	verbs ["wp.newtextobject"] = function (args) {
		const theObject = makeWpText (args [0]);
		const theAddress = args [1];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theAddress.reference.set (theObject);
			return (true);
			}
		return (theObject);
		};
	
	/*  8/15/26 by CC -- the target is a SINGLE SLOT, the kernel's way (one
		"_target_" per process), DW's ruling 8/15: "just do what the kernel
		does." It was a stack here. His scripts save and restore by hand --
		local (oldtarget = target.set (adr)) ... target.set (oldtarget) --
		which is exactly the pattern a single slot supports, and setting the
		slot to the undefined a first target.set answered leaves it empty,
		the way it started. targetStack stays an array (of at most one) so
		everything that reads it keeps working.  */
	
	verbs ["target.set"] = function (args, environment) { //returns the previous target
		if (environment.targetStack === undefined) {
			environment.targetStack = [];
			}
		const oldTarget = environment.targetStack [environment.targetStack.length - 1];
		if ((args [0] === undefined) || (args [0] === null)) {
			environment.targetStack = [];
			}
		else {
			environment.targetStack = [args [0]];
			}
		return (oldTarget);
		};
	
	verbs ["target.get"] = function (args, environment) {
		if (environment.targetStack === undefined) {
			return (undefined);
			}
		return (environment.targetStack [environment.targetStack.length - 1]);
		};
	
	verbs ["target.clear"] = function (args, environment) {
		environment.targetStack = [];
		return (true);
		};
	
	function currentTargetReference (environment) {
		if ((environment.targetStack === undefined) || (environment.targetStack.length === 0)) {
			const message = "Can't operate on the target because no target is set.";
			throw new Error (message);
			}
		const theTarget = environment.targetStack [environment.targetStack.length - 1];
		if ((theTarget === undefined) || (theTarget.flAddress !== true)) {
			const message = "Can't operate on the target because it isn't an address.";
			throw new Error (message);
			}
		return (theTarget.reference);
		};
	
	verbs ["wp.settext"] = function (args, environment) {
		currentTargetReference (environment).set (makeWpText (args [0]));
		return (true);
		};
	
	verbs ["wp.gettext"] = function (args, environment) {
		return (String (currentTargetReference (environment).get ()));
		};
	
	verbs ["lang.callscript"] = function (args, environment) { //callScript (@adrScript, {params}, adrTableInScope)
		var theScript = args [0];
		if (typeof theScript === "string") {

			/*  9/15/26 by CC -- THE NAME AS A STRING, the kernel's first form:
				callscriptverb (langverbs.c) takes bsscriptname and langrunscript
				finds the script by that name on the search path. Only the
				address form worked here, so scheduler0.monitor's
				callScript (string (adrscript), {}, @logtable) failed on every
				task, quietly, inside its own try -- the 1999 scheduler's
				every-minute, hourly and overnight tables never ran, and a
				Tool's background scripts with them. Found the night the Tools
				got hooked up.  */

			theScript = verbs ["lang.address"] ([theScript], environment);
			}
		else if ((theScript !== undefined) && (theScript !== null) && (theScript.flOdbAddressText === true)) { //9/21/26 by CC -- an address as the database stores it. mainResponder.callbackLoop's while loop (adrscript = adrscript^) leaves one in hand when a callback entry is the address of a script, and every request died here: "the first parameter doesn't lead to a script." The kernel takes this parameter as a string, so any address is its path
			theScript = verbs ["lang.address"] ([theScript], environment);
			}
		const theAddress = (((theScript !== undefined) && (theScript !== null) && (theScript.flAddress === true)) ? theScript : undefined); //8/10/26 by CC -- kept so this works inside the called script
		while ((theScript !== undefined) && (theScript !== null) && (theScript.flAddress === true)) {
			theScript = theScript.reference.get ();
			}
		if ((theScript === undefined) || (theScript.flOdbScript !== true)) {
			const message = "Can't call the script because the first parameter doesn't lead to a script.";
			throw new Error (message);
			}
		const theArgs = Array.isArray (args [1]) ? args [1] : [];
		var theScopeTable = args [2];
		if ((theScopeTable !== undefined) && (theScopeTable !== null) && (theScopeTable.flAddress === true)) {
			theScopeTable = theScopeTable.reference.get ();
			}
		return (environment.callScriptValue (theScript, theArgs, theScopeTable, theAddress));
		};
	
	verbs ["callscript"] = verbs ["lang.callscript"];
	verbs ["thread.callscript"] = verbs ["lang.callscript"]; //8/8/26 by CC -- runs synchronously; nodeEditor's button scripts all lead with it. 9/15/26 by CC -- THIS IS THE HEADLESS FALLBACK ONLY: on the server every worker replaces it with a real thread (runnerWorker.js installThreadVerbs, the kernel's threadcallscriptverb); here, with no server to start a worker, the script runs in line. DW, 9/15: the in-line version "is a bug."

	/*  8/31/26 by CC -- lang.evaluate, part of the builtins sweep: compile
		the text and run it, answering its value. The globals are all
		reachable; the caller's own locals are not, the one place this
		differs from the kernel's evaluate, which runs in the calling
		frame.  */

	verbs ["lang.evaluate"] = function (args, environment) {
		const theText = String (args [0]);
		const theLines = [];
		theText.split (/\r\n|\r|\n/).forEach (function (theLine) {
			if (theLine.trim ().length > 0) {
				theLines.push ({level: 0, text: theLine, flComment: false});
				}
			});
		const theStatements = environment.parseScript (theLines);
		return (environment.evaluateWithScopes (theStatements, []));
		};

	verbs ["evaluate"] = verbs ["lang.evaluate"];
	verbs ["thread.evaluate"] = verbs ["lang.evaluate"]; //one thread: it runs right here, the thread.callScript choice. 9/15/26 -- still in line, on the server too; on the list with the thread work

	verbs ["lang.memavail"] = function (args) {
		return (verbs ["sys.memavail"] ([]));
		};

	verbs ["lang.rollbeachball"] = function (args) {
		return (true); //no beachball to roll
		};

	verbs ["string.processhtmlmacros"] = function (args, environment) { //the same macro engine html.processMacros runs
		return (verbs ["html.processmacros"] ([args [0], undefined, undefined], environment));
		};

	verbs ["file.readline"] = function (args) { //the next line of an open file, fifreadline: up to the return, which is consumed
		const theRecord = openFileRecord (args [0]);
		const theEnd = fs.fstatSync (theRecord.fd).size;
		var theLine = "";
		while (theRecord.position < theEnd) {
			const theBuffer = Buffer.alloc (1);
			fs.readSync (theRecord.fd, theBuffer, 0, 1, theRecord.position);
			theRecord.position++;
			const theChar = theBuffer.toString ("latin1");
			if (theChar === "\r") {
				break;
				}
			theLine += theChar;
			}
		return (theLine);
		};

	verbs ["file.endoffile"] = function (args) {
		const theRecord = openFileRecord (args [0]);
		return (theRecord.position >= fs.fstatSync (theRecord.fd).size);
		};
	
	verbs ["table.assign"] = function (args) { //table.assign (@adr, value)
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't assign because the first parameter isn't an address.";
			throw new Error (message);
			}
		theAddress.reference.set (args [1]);
		return (true);
		};
	
	verbs ["date.get"] = function (args) { //date.get (d, @day, @month, @year, @hour, @minute, @second)
		const theDate = new Date (args [0]);
		const values = [theDate.getDate (), theDate.getMonth () + 1, theDate.getFullYear (), theDate.getHours (), theDate.getMinutes (), theDate.getSeconds ()];
		values.forEach (function (value, ixValue) {
			const theAddress = args [ixValue + 1];
			if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
				theAddress.reference.set (value);
				}
			});
		return (true);
		};
	
	verbs ["mrcalendar.getdayaddress"] = function (args) {
		/*  The calendar bottleneck: a date becomes year/month/day nested
			tables under the calendar, created on the way in when allowed.
			Spec preserved in the comment of mainResponder.calendar.getDayAddress.  */
		const adrCalendar = args [0];
		const theDate = new Date (args [1]);
		const flCreate = (args [2] === undefined) ? true : (args [2] !== false);
		const objType = (args [3] === undefined) ? "tabl" : args [3];
		if ((adrCalendar === undefined) || (adrCalendar.flAddress !== true)) {
			const message = "Can't get the day address because the first parameter isn't an address.";
			throw new Error (message);
			}
		const year = String (theDate.getFullYear ());
		var month = String (theDate.getMonth () + 1);
		var day = String (theDate.getDate ());
		while (month.length < 2) {
			month = "0" + month;
			}
		while (day.length < 2) {
			day = "0" + day;
			}
		var container = adrCalendar.reference.get ();
		if ((container === undefined) && flCreate) {
			adrCalendar.reference.set ({});
			container = adrCalendar.reference.get ();
			}
		const parts = [year, month];
		var flBroken = false;
		parts.forEach (function (part) {
			if (flBroken) {
				return;
				}
			if (container [part] === undefined) {
				if (flCreate) {
					container [part] = {};
					}
				else {
					flBroken = true;
					return;
					}
				}
			container = container [part];
			});
		if (flBroken) {
			container = undefined;
			}
		if ((container !== undefined) && (container [day] === undefined) && flCreate && (objType !== undefined)) {
			container [day] = (objType === "optx") ? {flOdbScript: true, scriptType: "outline", lines: []} : {};
			}
		const dayContainer = container;
		return ({
			flAddress: true,
			pathText: adrCalendar.pathText + "." + year + "." + month + "." + day,
			reference: {
				get: function () {
					return ((dayContainer === undefined) ? undefined : dayContainer [day]);
					},
				set: function (theValue) {
					if (dayContainer === undefined) {
						const message = "Can't set the day because the calendar path couldn't be reached.";
						throw new Error (message);
						}
					dayContainer [day] = theValue;
					},
				remove: function () {
					if (dayContainer !== undefined) {
						delete dayContainer [day];
						}
					}
				}
			});
		};
	
	verbs ["html.drawcalendar"] = function (args, environment) {
		/*  The month calendar, from the original script preserved in the
			comment of mainResponder.calendar.draw: a table for curdate's
			month, days that exist in the calendar table become links to
			urlprefix + year + delim + month + delim + day.  */
		const adrCalendar = args [0];
		const urlPrefix = (args [1] === undefined) ? "" : String (args [1]);
		const colWidth = (args [2] === undefined) ? 32 : args [2];
		const rowHeight = (args [3] === undefined) ? 22 : args [3];
		const tableBorder = (args [4] === undefined) ? 0 : args [4];
		const bgColor = args [5];
		const monthYearTemplate = (args [6] === undefined) ? "<b><center>***</center></b>" : String (args [6]);
		const dayNameTemplate = (args [7] === undefined) ? "<center>***</center>" : String (args [7]);
		const dayTemplate = (args [8] === undefined) ? "<center><b>***</b></center>" : String (args [8]);
		const curDate = (args [9] === undefined) ? new Date () : new Date (args [9]);
		const urlDelimiter = (args [10] === undefined) ? "/" : String (args [10]);
		
		const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
		const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		
		var calendarTable;
		if ((adrCalendar !== undefined) && (adrCalendar !== null) && (adrCalendar.flAddress === true)) {
			calendarTable = adrCalendar.reference.get ();
			}
		
		const year = curDate.getFullYear ();
		const month = curDate.getMonth (); //0-based here, 1-based in names below
		const yearName = String (year);
		var monthName = String (month + 1);
		while (monthName.length < 2) {
			monthName = "0" + monthName;
			}
		
		function dayEntryExists (dayNumber) {
			if ((calendarTable === undefined) || (calendarTable === null) || (typeof calendarTable !== "object")) {
				return (false);
				}
			var dayName = String (dayNumber);
			while (dayName.length < 2) {
				dayName = "0" + dayName;
				}
			var found = false;
			Object.keys (calendarTable).forEach (function (yearKey) {
				if (yearKey === yearName) {
					const monthTable = calendarTable [yearKey];
					if ((monthTable !== null) && (typeof monthTable === "object")) {
						Object.keys (monthTable).forEach (function (monthKey) {
							if (monthKey === monthName) {
								const dayTable = monthTable [monthKey];
								if ((dayTable !== null) && (typeof dayTable === "object") && (dayTable [dayName] !== undefined)) {
									found = true;
									}
								}
							});
						}
					}
				});
			return (found);
			}
		
		const bgColorString = ((bgColor === undefined) || (bgColor === null)) ? "" : " bgcolor=\"" + String (bgColor) + "\"";
		var htmlText = "";
		
		htmlText += "<table border=\"" + tableBorder + "\">\r";
		htmlText += "<tr><td colspan=\"7\">" + monthYearTemplate.split ("***").join (monthNames [month] + " " + year) + "</td></tr>\r";
		htmlText += "<tr>";
		dayNames.forEach (function (name) {
			htmlText += "<td width=\"" + colWidth + "\">" + dayNameTemplate.split ("***").join (name) + "</td>";
			});
		htmlText += "</tr>\r";
		
		const firstDay = new Date (year, month, 1).getDay ();
		const daysInMonth = new Date (year, month + 1, 0).getDate ();
		
		var cellText = "";
		var ctCells = 0;
		var ixCell;
		for (ixCell = 0; ixCell < firstDay; ixCell++) {
			cellText += "<td width=\"" + colWidth + "\" height=\"" + rowHeight + "\"" + bgColorString + "></td>";
			ctCells++;
			}
		var dayNumber;
		for (dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
			var inner = dayTemplate.split ("***").join (String (dayNumber));
			if (dayEntryExists (dayNumber)) {
				var dayName = String (dayNumber);
				while (dayName.length < 2) {
					dayName = "0" + dayName;
					}
				inner = "<a href=\"" + urlPrefix + yearName + urlDelimiter + monthName + urlDelimiter + dayName + "\">" + inner + "</a>";
				}
			cellText += "<td width=\"" + colWidth + "\" height=\"" + rowHeight + "\"" + bgColorString + ">" + inner + "</td>";
			ctCells++;
			if ((ctCells % 7) === 0) {
				htmlText += "<tr>" + cellText + "</tr>\r";
				cellText = "";
				}
			}
		if (cellText.length > 0) {
			while ((ctCells % 7) !== 0) {
				cellText += "<td width=\"" + colWidth + "\" height=\"" + rowHeight + "\"" + bgColorString + "></td>";
				ctCells++;
				}
			htmlText += "<tr>" + cellText + "</tr>\r";
			}
		htmlText += "</table>\r";
		
		return (htmlText);
		};
	
	verbs ["html.processmacros"] = function (args, environment) {
		/*  The macro processor: everything between balanced curly braces is
			a UserTalk expression, evaluated with the macro tables and the
			page table in scope, its result substituted into the text. A
			macro that fails leaves its error in the page, in brackets, so
			the page still renders and the problem names itself.  */
		const theText = String (args [0]);
		const adrPageTable = args [2];
		
		const scopeTables = [];
		function pushScope (theTable) {
			if ((theTable !== undefined) && (theTable !== null) && (typeof theTable === "object")) {
				scopeTables.push (theTable);
				}
			}
		function tableAt (theParent, theName) {
			if ((theParent === undefined) || (theParent === null) || (typeof theParent !== "object")) {
				return (undefined);
				}
			return (theParent [theName]);
			}
		const builtins = environment.odb.system.verbs.builtins;
		if ((adrPageTable !== undefined) && (adrPageTable !== null) && (adrPageTable.flAddress === true)) { //9/21/26 by CC -- the kernel's macro context carries a local adrPageTable (htmlbuildmacrocontext); the control panel's tools read it
			pushScope ({adrPageTable});
			}
		pushScope (tableAt (tableAt (builtins.html, "data"), "standardMacros"));
		pushScope (tableAt (tableAt (environment.odb.user, "html"), "macros"));
		pushScope (environment.odb.manilaMacros); //the manilaMacros search-path addition, PBS 05/11/00
		var pageTable;
		if ((adrPageTable !== undefined) && (adrPageTable !== null) && (adrPageTable.flAddress === true)) {
			pageTable = adrPageTable.reference.get ();
			pushScope (pageTable); //innermost: {title} answers the page table's title

			/*  9/21/26 by CC -- AND THE SITE'S OWN TOOLS. htmlbuildmacrocontext in
				langhtml.c runs a macro "with html.data.adrPageTable^,
				html.data.standardMacros, user.html.macros, toolTableAdr^": when
				the page table's tools entry is the address of a table -- the
				site's #tools, put there by html.buildPageTable -- that table is
				in scope too, innermost. Without it Manila's control panel came
				up with a macro error where each piece of its navigation belongs.
				(The kernel has the page table OUTERMOST, since 5.0.2b17; here it
				is searched before the macro tables. Left as it is; noted in
				misc/manilaLog.md.)  */

			const theToolsEntry = lookupNameCaseless (pageTable, "tools");
			const adrTools = liveAddress (theToolsEntry, environment);
			if (adrTools !== undefined) {
				var theToolsTable;
				try {
					theToolsTable = adrTools.reference.get ();
					}
				catch (err) {
					theToolsTable = undefined;
					}
				if ((theToolsTable !== undefined) && (theToolsTable !== null) && (typeof theToolsTable === "object") && (theToolsTable.flOdbScript !== true)) {
					pushScope (theToolsTable);
					}
				}
			}
		
		/*  9/25/26 by CC -- "QUOTED GLOSSARY ITEMS", the kernel's processmacros
			(langhtml.c, case '"'): outside an HTML tag, a run of text in double
			quotes on one line, up to maxglossarynamelength (127) characters, is
			looked up as a glossary entry -- html.refGlossary is called with
			the term, the way langrunscript calls it -- and the whole quoted run
			is replaced by what it answers. An entry that isn't there leaves
			the text as it was. A "<" inside the quotes is where scanning
			resumes when the lookup fails (7.0b39). Off when the page pref
			expandGlossaryItems is false. docserver.root's See Also lines are
			"string.replace" and came out as those five words in quotes.  */

		var flExpandGlossaryItems = true; //htmlgetpref answers true for a pref nobody set
		try {
			const thePref = verbs ["html.getpref"] (["expandGlossaryItems", args [2]], environment);
			if ((thePref !== undefined) && (thePref !== null)) {
				flExpandGlossaryItems = (thePref === true) || (String (thePref).toLowerCase () === "true");
				}
			}
		catch (err) {
			}
		function refGlossary (theTerm) { //what html.refGlossary answers for the term, or undefined when it can't
			const theCall = "html.refGlossary (\"" + theTerm.split ("\\").join ("\\\\").split ("\"").join ("\\\"") + "\")";
			try {
				const statements = environment.parseScript ([{level: 0, text: theCall, flComment: false}]);
				const value = environment.evaluateWithScopes (statements, scopeTables);
				if ((value === undefined) || (value === null)) {
					return (undefined);
					}
				return (String (value));
				}
			catch (err) {
				return (undefined);
				}
			}

		var result = "";
		var ix = 0;
		var flInHtmlTag = false;
		while (ix < theText.length) {
			const ch = theText.charAt (ix);
			if (ch === "<") {
				flInHtmlTag = true;
				}
			if (ch === ">") {
				flInHtmlTag = false;
				}
			if ((ch === "\\") && !flInHtmlTag) { //9/25/26 by CC -- the kernel's case '\\': "delete the backslash, skip over the char after it" -- so \" is a quote that starts no glossary lookup and \{ is a brace that starts no macro. docserver's example lines write \"-\" for exactly that reason
				if (ix + 1 < theText.length) {
					result += theText.charAt (ix + 1);
					}
				ix += 2;
				continue;
				}
			if ((ch === "\"") && !flInHtmlTag && flExpandGlossaryItems) {
				var ixQuote = -1, ixRewind = -1;
				var j;
				for (j = ix + 1; j < theText.length; j++) {
					const cj = theText.charAt (j);
					if ((cj === "\r") || (cj === "\n")) { //unterminated on this line
						break;
						}
					if ((cj === "<") && (ixRewind === -1)) {
						ixRewind = j;
						}
					if (cj === "\"") {
						ixQuote = j;
						break;
						}
					}
				if (ixQuote !== -1) {
					const theTerm = theText.slice (ix + 1, ixQuote);
					var expansion;
					if (theTerm.length <= 127) {
						expansion = refGlossary (theTerm);
						}
					if (expansion !== undefined) {
						result += expansion;
						ix = ixQuote + 1;
						continue;
						}
					if (ixRewind !== -1) { //not in the glossary: the tag inside the quotes gets its turn
						result += theText.slice (ix, ixRewind);
						ix = ixRewind;
						continue;
						}
					result += theText.slice (ix, ixQuote + 1);
					ix = ixQuote + 1;
					continue;
					}
				}
			if (ch !== "{") {
				result += ch;
				ix++;
				continue;
				}
			//find the balanced closing brace, quotes respected
			var depth = 0;
			var ixScan = ix;
			var quoteChar = "";
			var ixClose = -1;
			while (ixScan < theText.length) {
				const chScan = theText.charAt (ixScan);
				if (quoteChar !== "") {
					if (chScan === "\\") {
						ixScan++;
						}
					else {
						if (chScan === quoteChar) {
							quoteChar = "";
							}
						}
					}
				else {
					if ((chScan === "\"") || (chScan === "'")) {
						quoteChar = chScan;
						}
					if (chScan === "{") {
						depth++;
						}
					if (chScan === "}") {
						depth--;
						if (depth === 0) {
							ixClose = ixScan;
							break;
							}
						}
					}
				ixScan++;
				}
			if (ixClose === -1) { //no closing brace: the rest is literal
				result += theText.slice (ix);
				break;
				}
			const macroText = theText.slice (ix + 1, ixClose);
			var expansion;
			try {
				const statements = environment.parseScript ([{level: 0, text: macroText, flComment: false}]);
				const value = environment.evaluateWithScopes (statements, scopeTables);
				expansion = ((value === undefined) || (value === true)) ? "" : String (value);
				}
			catch (err) {
				expansion = "[Macro error: " + err.message + "]";
				}
			result += expansion;
			ix = ixClose + 1;
			}
		return (result);
		};
	
	verbs ["html.getpref"] = function (args, environment) {
	
		/*  8/17/26 by CC -- the DEFAULTS matter, and ours had them backwards.
			The old UserTalk preserved in the glue is the spec: the page table
			answers first, then user.html.prefs, then a handful of built-in
			defaults -- fileExtension ".html", maxFileNameLength 31,
			defaultTemplate "normal", defaultFileName "default" -- and
			ANYTHING ELSE UNKNOWN IS TRUE ("unknown or default prefs are
			true"). Ours answered false for everything it couldn't find, so
			every page-building pref a site never set was off here and on in
			Frontier. The yes/no strings coerce, the way the glue coerces
			them.  */
		
		const prefName = String (args [0]).toLowerCase ();
		const adrPageTable = args [1];
		function lookIn (theTable) {
			if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
				return (undefined);
				}
			var found;
			Object.keys (theTable).forEach (function (key) {
				if ((found === undefined) && (key.toLowerCase () === prefName)) {
					found = theTable [key];
					}
				});
			return (found);
			}
		var theValue;
		if ((adrPageTable !== undefined) && (adrPageTable !== null) && (adrPageTable.flAddress === true)) {
			theValue = lookIn (adrPageTable.reference.get ());
			}
		if (theValue === undefined) {
			const userTable = environment.odb.user;
			if ((userTable !== undefined) && (userTable !== null) && (userTable.html !== undefined)) {
				theValue = lookIn (userTable.html.prefs);
				}
			}
		if (theValue !== undefined) {
			if (typeof theValue === "string") { //"yes"/"true" and "no"/"false" are booleans, the glue's case statement
				const theLower = theValue.toLowerCase ();
				if ((theLower === "yes") || (theLower === "true")) {
					return (true);
					}
				if ((theLower === "no") || (theLower === "false")) {
					return (false);
					}
				}
			return (theValue);
			}
		const theDefaults = {
			fileextension: ".html",
			maxfilenamelength: 31,
			defaulttemplate: "normal",
			defaultfilename: "default"
			};
		if (theDefaults [prefName] !== undefined) {
			return (theDefaults [prefName]);
			}
		return (true); //the glue's last word: unknown prefs are true
		};
	
	function calendarBoundaryDay (args, flLast) {
		const adrCalendar = args [0];
		var calendarTable;
		if ((adrCalendar !== undefined) && (adrCalendar !== null) && (adrCalendar.flAddress === true)) {
			calendarTable = adrCalendar.reference.get ();
			}
		if ((calendarTable === undefined) || (calendarTable === null) || (typeof calendarTable !== "object")) {
			const message = "Can't get the " + (flLast ? "last" : "first") + " day because the calendar can't be reached.";
			throw new Error (message);
			}
		function numericKeys (theTable) {
			const keys = [];
			Object.keys (theTable).forEach (function (key) {
				if (/^\d+$/.test (key) && (theTable [key] !== null) && (typeof theTable [key] === "object")) {
					keys.push (key);
					}
				});
			keys.sort ();
			return (keys);
			}
		const years = numericKeys (calendarTable);
		if (years.length === 0) {
			const message = "Can't get the " + (flLast ? "last" : "first") + " day because the calendar is empty.";
			throw new Error (message);
			}
		const year = flLast ? years [years.length - 1] : years [0];
		const months = numericKeys (calendarTable [year]);
		const month = flLast ? months [months.length - 1] : months [0];
		const days = numericKeys (calendarTable [year] [month]);
		const day = flLast ? days [days.length - 1] : days [0];
		return (new Date (Number (year), Number (month) - 1, Number (day)));
		}
	
	verbs ["mrcalendar.getfirstday"] = function (args) {
		return (calendarBoundaryDay (args, false));
		};
	
	verbs ["mrcalendar.getlastday"] = function (args) {
		return (calendarBoundaryDay (args, true));
		};
	
	function callS3Helper (theCommand) { //8/5/26 by CC
		
		/*  Run one S3 operation in a child process and wait for it. UserTalk is
			synchronous and daveS3 is callback-based; this is the seam. The path
			map's s3 section supplies the default ACL and, when daveS3 doesn't
			live beside us, where to find the helper.  */
		
		const theSettings = (thePathMap.s3 === undefined) ? {} : thePathMap.s3;
		const pathHelper = (theSettings.pathHelper === undefined) ? (__dirname + "/s3helper.js") : theSettings.pathHelper;
		
		var theAnswer;
		try {
			const theOutput = execFileSync (process.execPath, [pathHelper], {
				input: JSON.stringify (theCommand),
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				cwd: (theSettings.folderHelper === undefined) ? path.dirname (pathHelper) : theSettings.folderHelper
				});
			theAnswer = JSON.parse (theOutput);
			}
		catch (err) {
			const message = "Can't reach S3 because the helper failed: " + err.message;
			throw new Error (message);
			}
		
		if (theAnswer.flError === true) {
			const message = "Can't " + theCommand.verb + " " + theCommand.path + " because " + theAnswer.message;
			throw new Error (message);
			}
		return (theAnswer.value);
		}
	
	/*  8/23/26 by CC -- THESE THREE WERE NAMED s3.SOMETHING AND THAT HID THE
		WHOLE S3 SUITE. Verbs are filed under the name before their first dot,
		and those groups are the tables at system.compiler.kernel, which
		system.paths reaches at 04 and 06 -- ahead of system.verbs.apps at 10.
		So three JavaScript verbs stood in front of Les Orchard's 27 scripts
		and s3.init reported as a name that doesn't exist.

		DW, 8/22: "i want to run the UserTalk version of s3... you could
		rename them to something that doesn't collide." They are daves3.* now,
		after the package they run on, and nothing in the database is called
		that. They stay reachable from inside a script as
		kernel (daves3.newObject), which is the kernelized shape, so the
		UserTalk can call down to them where that turns out to be wanted.  */

	verbs ["daves3.newobject"] = function (args, environment) { //8/5/26 by CC -- daves3.newObject (path, data, type, acl)
	
		/*  8/17/26 by CC -- THE CASE THAT STARTED THE WHOLE INVENTORY. DW
			published a page from Atlantis and it arrived at scripting.com as
			text/plain, so the browser showed the html instead of drawing it.
			His glue on Berkeley (system.verbs.apps.s3.newObject, change note
			4/12/06) has always done this: when the caller doesn't say what
			type the object is, take the file's extension and look it up in
			user.webserver.prefs.ext2MIME. Ours passed the nil straight
			through, and daveS3 stamps its default, text/plain, on anything
			with no type. The lookup table is the one in his database; when a
			database has none, the handful of types every site needs stand in
			so a page is never published as plain text again.  */
		
		const theSettings = (thePathMap.s3 === undefined) ? {} : thePathMap.s3;
		const thePath = String (args [0]);
		var theType = ((args [2] === undefined) || (args [2] === null)) ? undefined : String (args [2]);
		if (theType === undefined) {
			const theParts = thePath.split (".");
			const theExtension = theParts [theParts.length - 1].toLowerCase ();
			var theTable;
			if ((environment !== undefined) && (environment.odb !== undefined)) {
				const theUser = environment.odb.user;
				if ((theUser !== undefined) && (theUser !== null) && (theUser.webserver !== undefined) && (theUser.webserver !== null) && (theUser.webserver.prefs !== undefined) && (theUser.webserver.prefs !== null)) {
					theTable = theUser.webserver.prefs.ext2MIME;
					}
				}
			if ((theTable !== undefined) && (theTable !== null) && (typeof theTable === "object")) {
				Object.keys (theTable).forEach (function (theName) {
					if (theName.toLowerCase () === theExtension) {
						theType = String (theTable [theName]);
						}
					});
				}
			if (theType === undefined) {
				const theStandbys = {
					html: "text/html", htm: "text/html", txt: "text/plain",
					css: "text/css", js: "text/javascript", json: "application/json",
					xml: "text/xml", opml: "text/xml", rss: "text/xml",
					gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg",
					png: "image/png", svg: "image/svg+xml", ico: "image/x-icon",
					pdf: "application/pdf", zip: "application/zip",
					mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4"
					};
				theType = theStandbys [theExtension];
				}
			}
		const theAcl = ((args [3] === undefined) || (args [3] === null)) ? theSettings.defaultAcl : String (args [3]);
		return (callS3Helper ({verb: "newobject", path: thePath, data: String (args [1]), type: theType, acl: theAcl}));
		};
	
	verbs ["daves3.getobject"] = function (args) { //8/5/26 by CC
		return (callS3Helper ({verb: "getobject", path: String (args [0])}));
		};
	
	verbs ["daves3.objectexists"] = function (args) { //8/5/26 by CC
		return (callS3Helper ({verb: "objectexists", path: String (args [0])}));
		};
	
	function deepCopyValue (theValue) { //8/5/26 by CC -- a table copies structurally; everything else is a value
		
		if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
			return (theValue);
			}
		if ((theValue.flAddress === true) || (theValue.flOdbScript === true) || (theValue.flWpText === true) || (theValue.flOdbSqlTable === true) || Array.isArray (theValue) || (theValue instanceof Date) || (theValue.type !== undefined)) {
			return (theValue);
			}
		
		const seen = new Map ();
		function copyTable (theTable) {
			if (seen.has (theTable)) {
				return (seen.get (theTable));
				}
			const theCopy = {};
			seen.set (theTable, theCopy);
			Object.keys (theTable).forEach (function (theKey) {
				theCopy [theKey] = deepCopyValue (theTable [theKey]);
				});
			return (theCopy);
			}
		return (copyTable (theValue));
		}
	
	verbs ["table.copy"] = function (args, environment) { //table.copy (adr, adrTable)

		/*  9/21/26 by CC -- INTO THE TABLE, UNDER ITS OWN NAME. tablecopyverb in
			tableverbs.c: "table.copy (address, tableaddress): boolean; copy the
			indicated table entry to the given table" -- hashtableassign, so an
			entry of that name already there is replaced; an entry that isn't
			there is an error (5.1.4); on success the address of the copy
			(5.0a15). The copy is structural, independent of the source. Since
			8/5 this put the copy AT the second address, so the table named
			there BECAME the entry: table.copyContents, a loop of table.copy,
			turned a Manila message's newsItem table into a string, and making
			a new site stopped on it.  */

		const adrSource = liveAddress (args [0], environment);
		const adrDestTable = liveAddress (args [1], environment);
		if (adrSource === undefined) {
			const message = "Can't copy because the first parameter isn't an address.";
			throw new Error (message);
			}
		if (adrDestTable === undefined) {
			const message = "Can't copy because the second parameter isn't the address of a table.";
			throw new Error (message);
			}
		const theSourceValue = adrSource.reference.get ();
		const theSourceNames = addressTextParts (String (adrSource.pathText));
		const theName = (adrSource.nameText !== undefined) ? String (adrSource.nameText) : theSourceNames [theSourceNames.length - 1];
		if (theSourceValue === undefined) {
			const message = "Can't copy " + theName + " because there is no object with that name.";
			throw new Error (message);
			}
		const theDestTable = adrDestTable.reference.get ();
		if ((theDestTable === undefined) || (theDestTable === null) || (typeof theDestTable !== "object") || (theDestTable.flOdbScript === true) || Array.isArray (theDestTable)) {
			const message = "Can't copy " + theName + " because the second parameter isn't the address of a table.";
			throw new Error (message);
			}
		function copyOf (theValue) { //a table copies structurally, out of the database too; everything else is a value
			if ((theValue === undefined) || (theValue === null) || (typeof theValue !== "object")) {
				return (theValue);
				}
			if (theValue.flOdbSqlTable === true) {
				const theCopy = {};
				tableNames (theValue).forEach (function (theKey) {
					theCopy [theKey] = copyOf (theValue [theKey]);
					});
				return (theCopy);
				}
			return (deepCopyValue (theValue));
			}
		var theDestKey = theName;
		tableNames (theDestTable).forEach (function (theKey) { //an entry of that name, however it is spelled, is the one replaced
			if (theKey.toLowerCase () === theName.toLowerCase ()) {
				theDestKey = theKey;
				}
			});
		if (theDestKey !== theName) {
			delete theDestTable [theDestKey];
			}
		theDestTable [theName] = copyOf (theSourceValue);
		return (addressFromText (String (adrDestTable.pathText) + "." + addressTextFromNames ([theName]), environment));
		};
	
	verbs ["table.moveandrename"] = function (args) { //8/22/26 by CC -- table.moveAndRename (adrSource, adrDest)
		
		/*  Take the object out of one table and put it in another under a new
			name. tablemoveandrenameverb in tableverbs.c: look the source name up,
			hashdelete it without tossing the value, assign it at the destination,
			and answer the ADDRESS of where it landed. A source that isn't there
			is an error, not a quiet no-op.
			
			The value is copied before the source goes away, so a table that
			materializes lazily out of storage is whole in its new home.
			
			DW's fatPages.getPageAtts moves each directive line out of a local
			and into the atts table under the directive's own name, which is why
			this had to exist before a fat file could be imported.  */
		
		const adrSource = args [0];
		const adrDest = args [1];
		if ((adrSource === undefined) || (adrSource === null) || (adrSource.flAddress !== true)) {
			const message = "Can't move the object because the first parameter isn't an address.";
			throw new Error (message);
			}
		if ((adrDest === undefined) || (adrDest === null) || (adrDest.flAddress !== true)) {
			const message = "Can't move the object because the second parameter isn't an address.";
			throw new Error (message);
			}
		
		const theValue = adrSource.reference.get ();
		if (theValue === undefined) {
			const theName = (adrSource.pathText !== undefined) ? adrSource.pathText : "the object";
			const message = "Can't move " + theName + " because there's no object at that address.";
			throw new Error (message);
			}
		const theCopy = deepCopyValue (theValue);
		
		if (adrSource.reference.remove !== undefined) {
			adrSource.reference.remove ();
			}
		else {
			adrSource.reference.set (undefined);
			}
		adrDest.reference.set (theCopy);
		return (adrDest);
		};
	
	function placeOfAddress (adr) { //9/14/26 by CC -- the table the entry lives in and its key: a lazy address answers place (), an eager one carries container and key
		const reference = adr.reference;
		if (reference === undefined) {
			return (undefined);
			}
		if (reference.place !== undefined) {
			return (reference.place ());
			}
		if ((reference.container !== undefined) && (reference.key !== undefined)) {
			return ({container: reference.container, key: reference.key});
			}
		return (undefined);
		}

	verbs ["table.rename"] = function (args) { //9/14/26 by CC -- table.rename (adr, name): tablerenameverb in tableverbs.c

		/*  The entry keeps its node and takes the new name -- hashsetnodekey,
			then the table resorts. A name that isn't there is an error; a new
			name already in use is badrenameerror ("Can't rename x as y because
			an item with that name already exists"); the same name spelled
			differently just changes the case. Answers the address of the
			renamed entry (5.0a15). In the database the row keeps its id, so
			the children, the dates, the linked code and the window's state
			ride along; a local table is copied under the new name.  */

		const adr = args [0];
		if ((adr === undefined) || (adr === null) || (adr.flAddress !== true)) {
			const message = "Can't rename the object because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theNewName = String (args [1]);
		const theText = (adr.pathText !== undefined) ? adr.pathText : "the object";
		const thePlace = placeOfAddress (adr);
		if (thePlace === undefined) {
			const message = "Can't rename " + theText + " because there is no object at that address.";
			throw new Error (message);
			}
		const theContainer = thePlace.container;
		const theKey = thePlace.key;
		if ((theContainer.flOdbSqlTable === true) && (theContainer.odbRenameChild !== undefined)) {
			const theAnswer = theContainer.odbRenameChild (theKey, theNewName);
			if (!theAnswer.flRenamed) {
				throw new Error (theAnswer.message);
				}
			}
		else {
			if (theKey.toLowerCase () !== theNewName.toLowerCase ()) {
				if (findKeyInTable (theContainer, theNewName) !== undefined) {
					const message = "Can't rename " + theText + " as " + theNewName + " because an item with that name already exists.";
					throw new Error (message);
					}
				}
			const theValue = theContainer [theKey];
			delete theContainer [theKey];
			theContainer [theNewName] = theValue;
			}
		const parentText = (theText.lastIndexOf (".") === -1) ? "" : theText.slice (0, theText.lastIndexOf (".") + 1);
		return (addressIntoTable (theContainer, theNewName, parentText + theNewName));
		};

	verbs ["table.move"] = function (args) { //9/14/26 by CC -- table.move (adr, adrTable): tablemoveverb in tableverbs.c

		/*  The entry leaves its table and lands in the other one under the
			same name -- hashdelete without tossing the value, then
			hashtableassign, "so existing item is overwritten" (dmb, 9/30/91).
			A source that isn't there is an error; the destination must be a
			table. Answers the address of the moved entry. table.moveAndRename
			(8/22) copies; this one keeps the row.  */

		const adr = args [0];
		const adrTable = args [1];
		if ((adr === undefined) || (adr === null) || (adr.flAddress !== true)) {
			const message = "Can't move the object because the first parameter isn't an address.";
			throw new Error (message);
			}
		if ((adrTable === undefined) || (adrTable === null) || (adrTable.flAddress !== true)) {
			const message = "Can't move the object because the second parameter isn't an address.";
			throw new Error (message);
			}
		const theText = (adr.pathText !== undefined) ? adr.pathText : "the object";
		const destText = (adrTable.pathText !== undefined) ? adrTable.pathText : "the table";
		const thePlace = placeOfAddress (adr);
		if (thePlace === undefined) {
			const message = "Can't move " + theText + " because there is no object at that address.";
			throw new Error (message);
			}
		const theContainer = thePlace.container;
		const theKey = thePlace.key;
		var destTable;
		try {
			destTable = adrTable.reference.get ();
			}
		catch (err) {
			destTable = undefined;
			}
		if ((destTable === undefined) || (destTable === null) || (typeof destTable !== "object") || Array.isArray (destTable) || (destTable.flOdbScript === true) || (destTable.kind !== undefined)) {
			const message = "Can't move " + theText + " into " + destText + " because the destination must be a table.";
			throw new Error (message);
			}
		if ((theContainer.flOdbSqlTable === true) && (destTable.flOdbSqlTable === true) && (theContainer.odbMoveChild !== undefined)) {
			const theAnswer = theContainer.odbMoveChild (theKey, destTable, true);
			if (!theAnswer.flMoved) {
				throw new Error (theAnswer.message);
				}
			}
		else {
			const theValue = theContainer [theKey];
			const theCopy = deepCopyValue (theValue);
			delete theContainer [theKey];
			const existingKey = findKeyInTable (destTable, theKey);
			if ((existingKey !== undefined) && (existingKey !== theKey)) {
				delete destTable [existingKey];
				}
			destTable [theKey] = theCopy;
			}
		return (addressIntoTable (destTable, theKey, destText + "." + theKey));
		};

	verbs ["html.neutermacros"] = function (args) { //8/5/26 by CC
		
		/*  html.neuterMacros (s, adrLegalMacros) -- defang the macros in text that
			came from outside, leaving the ones the site has declared legal.
			Manila's own manilaSuite.unTaint says what neutering is: "All {
			characters are translated to &#123;", which stops the macro from
			expanding. The second parameter is the address of a table whose entry
			names are the macros allowed to survive.  */
		
		const theText = String (args [0]);
		const theAddress = args [1];
		var theLegal = undefined;
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theLegal = theAddress.reference.get ();
			}
		else {
			if ((theAddress !== null) && (typeof theAddress === "object")) {
				theLegal = theAddress;
				}
			}
		
		function flIsLegal (theName) {
			if ((theLegal === undefined) || (theLegal === null) || (typeof theLegal !== "object")) {
				return (false);
				}
			const theLower = theName.toLowerCase ();
			var flFound = false;
			Object.keys (theLegal).forEach (function (theKey) {
				if (theKey.toLowerCase () === theLower) {
					flFound = true;
					}
				});
			return (flFound);
			}
		
		var theResult = "";
		var ixScan = 0;
		while (ixScan < theText.length) {
			const theChar = theText.charAt (ixScan);
			if (theChar === "{") {
				var ixName = ixScan + 1;
				while ((ixName < theText.length) && (/[A-Za-z0-9_.]/.test (theText.charAt (ixName)))) {
					ixName++;
					}
				const theName = theText.slice (ixScan + 1, ixName);
				if ((theName.length > 0) && flIsLegal (theName)) {
					theResult += theChar;
					}
				else {
					theResult += "&#123;";
					}
				}
			else {
				theResult += theChar;
				}
			ixScan++;
			}
		return (theResult);
		};
	
	verbs ["date.set"] = function (args) { //8/5/26 by CC -- date.set (day, month, year, hour, minute, second), the inverse of date.get
		const theDay = (args [0] === undefined) ? 1 : Number (args [0]);
		const theMonth = (args [1] === undefined) ? 1 : Number (args [1]);
		const theYear = (args [2] === undefined) ? 1904 : Number (args [2]);
		const theHour = (args [3] === undefined) ? 0 : Number (args [3]);
		const theMinute = (args [4] === undefined) ? 0 : Number (args [4]);
		const theSecond = (args [5] === undefined) ? 0 : Number (args [5]);
		return (new Date (theYear, theMonth - 1, theDay, theHour, theMinute, theSecond));
		};
	
	verbs ["mrcalendar.getmostrecentday"] = function (args) { //8/5/26 by CC
		
		/*  The day at or before d that the calendar actually has, as a date at
			midnight. The spec is written out in the old-code comment inside
			mainResponder.calendar.getMostRecentDay: walk backwards from d until
			a day exists, and fail when the calendar holds nothing that early.
			The old script walked one day at a time; picking the greatest day
			that isn't after d gives the same answer without the walk.  */
		
		const adrCalendar = args [0];
		var calendarTable;
		if ((adrCalendar !== undefined) && (adrCalendar !== null) && (adrCalendar.flAddress === true)) {
			calendarTable = adrCalendar.reference.get ();
			}
		else {
			calendarTable = adrCalendar;
			}
		if ((calendarTable === undefined) || (calendarTable === null) || (typeof calendarTable !== "object")) {
			const message = "Can't get the most recent day because the calendar can't be reached.";
			throw new Error (message);
			}
		
		const theDate = (args [1] === undefined) ? new Date () : new Date (args [1]);
		const theLimit = new Date (theDate.getFullYear (), theDate.getMonth (), theDate.getDate ()).getTime ();
		
		function numericKeys (theTable) {
			const theKeys = [];
			Object.keys (theTable).forEach (function (theKey) {
				if (/^\d+$/.test (theKey) && (theTable [theKey] !== null) && (typeof theTable [theKey] === "object")) {
					theKeys.push (theKey);
					}
				});
			theKeys.sort ();
			return (theKeys);
			}
		
		var theBest = undefined;
		numericKeys (calendarTable).forEach (function (theYear) {
			numericKeys (calendarTable [theYear]).forEach (function (theMonth) {
				numericKeys (calendarTable [theYear] [theMonth]).forEach (function (theDay) {
					const theCandidate = new Date (Number (theYear), Number (theMonth) - 1, Number (theDay)).getTime ();
					if (theCandidate <= theLimit) {
						if ((theBest === undefined) || (theCandidate > theBest)) {
							theBest = theCandidate;
							}
						}
					});
				});
			});
		
		if (theBest === undefined) {
			const message = "Can't get the most recent day in the calendar because the calendar doesn't contain any elements before " + theDate + ".";
			throw new Error (message);
			}
		return (new Date (theBest));
		};
	
	verbs ["html.neutertags"] = function (args, environment) {

		/*  9/21/26 by CC -- THE LEGAL TAGS GO THROUGH. neutertags in langhtml.c:
			the second parameter is a table of legal tags, each a boolean or a
			table of flLegal and flClose (a boolean means close it). A tag in
			the table is left alone, attributes and all; any other has its <
			turned into &lt; and nothing else is touched. Either way the walk
			picks up again at the tag's >. A < with no > after it becomes
			&lt;. A legal tag that must be closed is counted -- open up, close
			down -- and what is still open at the end is closed, last name
			first. This encoded every <, >, & and quote and never looked at
			the table: a Manila editor who saved a page got every tag on it
			shown as text, and a second save encoded the ampersands of the
			first.  */

		var theText = String (args [0]);
		var theTagsTable = args [1];
		if ((theTagsTable !== undefined) && (theTagsTable !== null) && ((theTagsTable.flAddress === true) || (theTagsTable.flOdbAddressText === true))) {
			theTagsTable = liveAddress (theTagsTable, environment).reference.get ();
			}
		const theLegalTags = {}; //lowercase name -> {name, flClose, count}
		const theLegalNames = [];
		tableNames (theTagsTable).forEach (function (theName) {
			const theEntry = theTagsTable [theName];
			var flLegal, flClose = true;
			if ((theEntry !== undefined) && (theEntry !== null) && (typeof theEntry === "object")) {
				flLegal = (lookupNameCaseless (theEntry, "flLegal") === true);
				flClose = (lookupNameCaseless (theEntry, "flClose") === true);
				}
			else {
				flLegal = ((theEntry === true) || (String (theEntry).toLowerCase () === "true"));
				}
			if (flLegal) {
				theLegalTags [theName.toLowerCase ()] = {name: theName, flClose, count: 0};
				theLegalNames.push (theName.toLowerCase ());
				}
			});

		var ixPos = 0;
		while (ixPos < theText.length) {
			if (theText.charAt (ixPos) === "<") {
				const ixEnd = theText.indexOf (">", ixPos + 1);
				if (ixEnd === -1) { //the tag doesn't end
					theText = theText.slice (0, ixPos) + "&lt;" + theText.slice (ixPos + 1);
					continue; //the & is looked at next, and passed over
					}
				var theTagName = theText.slice (ixPos + 1, ixEnd);
				var flCloseTag = false;
				if (theTagName.charAt (0) === "/") {
					theTagName = theTagName.slice (1);
					flCloseTag = true;
					}
				if (theTagName.indexOf (" ") !== -1) {
					theTagName = theTagName.slice (0, theTagName.indexOf (" "));
					}
				const theLegalTag = theLegalTags [theTagName.toLowerCase ()];
				var ixNext = ixEnd;
				if (theLegalTag === undefined) {
					theText = theText.slice (0, ixPos) + "&lt;" + theText.slice (ixPos + 1);
					ixNext = ixEnd + 3; //the text grew by three
					}
				else if (theLegalTag.flClose) {
					theLegalTag.count += flCloseTag ? -1 : 1;
					}
				ixPos = ixNext; //at the tag's >
				}
			ixPos++;
			}

		theLegalNames.sort ();
		theLegalNames.reverse ();
		theLegalNames.forEach (function (theLowerName) {
			const theLegalTag = theLegalTags [theLowerName];
			while (theLegalTag.flClose && (theLegalTag.count > 0)) {
				theText += "</" + theLegalTag.name + ">";
				theLegalTag.count--;
				}
			});
		return (theText);
		};
	
	verbs ["html.traversalskip"] = function (args, environment) {

		/*  9/25/26 by CC -- traversalskipverb (langhtml.c): true for an object
			a site walk leaves out -- a name that begins with #, or glossary,
			images or tools in any case. docserver.root's releaseDocServer asks
			it for every entry (the glue was kernelized in Frontier 6.1).  */

		const theName = String (verbs ["nameof"] ([args [0]], environment));
		if (theName.charAt (0) === "#") {
			return (true);
			}
		const theLower = theName.toLowerCase ();
		return ((theLower === "glossary") || (theLower === "images") || (theLower === "tools"));
		};
	verbs ["html.getpagetableaddress"] = function (args, environment) {
		/*  The current page table: the address registered per thread at
			system.temp.pageTableAddresses -- the webserver registers the
			request's param table, and buildObject registers the table it
			renders into. One thread here, so one slot. With nothing
			registered, a scratch table stands in, the way an editor-run
			macro gets one.  */
		/*  9/21/26 by CC -- THE ENTRY IS NAMED BY THE CURRENT THREAD'S ID, and
			it is an address however it was stored (langhtml.c,
			getpagetableaddressverb: numbertostring (getthreadid
			(getcurrentthread ())), then coercetoaddress). This looked only at
			an entry named "1" and only for a running script's address; on the
			server a request runs in a worker with an id of its own and the
			address comes back out of the database, so every Manila page got
			the scratch table below and manilaSuite.getSiteAddress died on
			adrSiteRootTable.  */
		const systemTemp = environment.odb.system.temp;
		if (systemTemp.pageTableAddresses !== undefined) {
			const theThreadName = String (verbs ["thread.getcurrentid"] ([], environment));
			const registered = lookupNameCaseless (systemTemp.pageTableAddresses, theThreadName);
			if ((registered !== undefined) && (registered !== null) && ((registered.flAddress === true) || (registered.flOdbAddressText === true))) {
				return (liveAddress (registered, environment));
				}
			}
		if (systemTemp.currentPageTable === undefined) {
			systemTemp.currentPageTable = {};
			}
		return ({
			flAddress: true,
			pathText: "system.temp.currentPageTable",
			reference: {
				get: function () {
					return (environment.odb.system.temp.currentPageTable);
					},
				set: function (theValue) {
					environment.odb.system.temp.currentPageTable = theValue;
					},
				remove: function () {
					delete environment.odb.system.temp.currentPageTable;
					}
				}
			});
		};
	
	/*  9/21/26 by CC -- html.buildPageTable's KERNEL HALF, for the Manila work:
		every request for a page of a site stopped on "Can't call the kernel
		verb html.buildpagetable because it isn't implemented." The glue,
		html.buildPageTable, calls it when the useKernelCode pref is true and
		runs its own UserTalk (buildTable) when it isn't; this is
		buildpagetableverb and additemtopagetable in langhtml.c, which carry
		that UserTalk in their comments, line for line.

		From the object's table out to the root: every item whose name begins
		with # goes into the page table under the name without the #, and a
		name already there is left alone, so the nearest directive wins. A
		table named prefs is opened up and its items added one by one. A
		table or an outline goes in as its address, anything else as its
		string. #ftpSite marks the site's root: subdirectoryPath is the path
		walked so far, adrSiteRootTable the table's address. Each table's
		tools and glossary ride along. A template that is a wptext or an
		outline sets indirectTemplate false, and an outline template goes in
		as a copy of the outline. The walk stops at the root, and the root's
		own items are not looked at.  */

	function addressTextFromNames (theNames) { //the text of an address from its names, each one bracketed and quoted unless it is a plain identifier
		var theText = "";
		theNames.forEach (function (theName, ixName) {
			const flPlain = /^[A-Za-z_][A-Za-z0-9_]*$/.test (theName);
			if (flPlain) {
				theText += ((ixName === 0) ? "" : ".") + theName;
				}
			else {
				theText += ((ixName === 0) ? "" : ".") + "[\"" + String (theName).split ("\\").join ("\\\\").split ("\"").join ("\\\"") + "\"]";
				}
			});
		return (theText);
		}

	verbs ["html.buildpagetable"] = function (args, environment) {
		const adrObject = args [0];
		var thePageTable = args [1];
		if ((adrObject === undefined) || (adrObject === null) || ((adrObject.flAddress !== true) && (adrObject.flOdbAddressText !== true))) {
			const message = "Can't build the page table because the first parameter isn't an address.";
			throw new Error (message);
			}
		if ((thePageTable !== undefined) && (thePageTable !== null) && ((thePageTable.flAddress === true) || (thePageTable.flOdbAddressText === true))) {
			thePageTable = liveAddress (thePageTable, environment).reference.get ();
			}
		if ((thePageTable === undefined) || (thePageTable === null) || (typeof thePageTable !== "object")) {
			const message = "Can't build the page table because the second parameter isn't the address of a table.";
			throw new Error (message);
			}

		function flDefinedInPageTable (theName) {
			return (lookupNameCaseless (thePageTable, theName) !== undefined);
			}

		function addItemToPageTable (theTableNames, theTable, theItemName) { //theTableNames: the names down to theTable
			var theName = theItemName;
			if (theName.charAt (0) === "#") {
				theName = theName.slice (1);
				}
			if (flDefinedInPageTable (theName)) {
				return;
				}
			const lowerName = theName.toLowerCase ();
			const theValue = theTable [theItemName];
			const theType = verbs ["typeof"] ([theValue]);
			const theItemNames = theTableNames.concat ([theItemName]);
			if ((theType === "tabl") && (lowerName === "prefs")) {
				tableNames (theValue).forEach (function (thePrefName) {
					addItemToPageTable (theItemNames, theValue, thePrefName);
					});
				return;
				}
			if ((theType === "tabl") || (theType === "optx")) {
				thePageTable [theName] = addressFromText (addressTextFromNames (theItemNames), environment);
				}
			else {
				thePageTable [theName] = String (verbs ["string"] ([theValue], environment));
				}
			if ((lowerName === "template") && ((theType === "wptx") || (theType === "optx"))) {
				thePageTable.indirectTemplate = false;
				if (theType === "optx") {
					thePageTable [theName] = JSON.parse (JSON.stringify (theValue));
					}
				}
			}

		const theObjectNames = verbs ["string.parseaddress"] ([adrObject], environment);
		var theSubdirPath = "";
		for (var ctNames = theObjectNames.length - 1; ctNames >= 1; ctNames--) { //the table holding the object, then its parent, out to a table at the top of the root
			const theTableNames = theObjectNames.slice (0, ctNames);
			const theTable = addressFromText (addressTextFromNames (theTableNames), environment).reference.get ();
			if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
				break;
				}
			tableNames (theTable).forEach (function (theItemName) {
				if (theItemName.charAt (0) !== "#") {
					return;
					}
				if ((theItemName.toLowerCase () === "#ftpsite") && !flDefinedInPageTable ("ftpSite")) {
					thePageTable.subdirectoryPath = theSubdirPath;
					thePageTable.adrSiteRootTable = addressFromText (addressTextFromNames (theTableNames), environment);
					}
				addItemToPageTable (theTableNames, theTable, theItemName);
				});
			["tools", "glossary"].forEach (function (theSpecialName) {
				tableNames (theTable).forEach (function (theItemName) {
					if (theItemName.toLowerCase () === theSpecialName) {
						addItemToPageTable (theTableNames, theTable, theItemName);
						}
					});
				});
			theSubdirPath = theTableNames [theTableNames.length - 1] + ":" + theSubdirPath;
			}
		return (true);
		};

	/*  9/21/26 by CC -- html.runDirective and html.runDirectives, for the Manila
		work: rundirectiveverb, rundirectivesverb and htmlrundirective in
		langhtml.c, which carry their UserTalk in the comments. A directive
		is a line "#name expression": the first word is the field, the rest is
		evaluated, and the value goes into the page table under that name. A
		directive named template sets indirectTemplate true. runDirectives
		takes the linefeeds out of the text, pulls each # line out and runs
		it, leaves every other line where it is -- and stops at the first
		one when the directivesOnlyAtBeginning pref is true -- and answers
		what is left.  */

	function pageTableFromParam (theParam, environment) { //getoptionalpagetablevalue: the table the address leads to, @websites.["#data"] when there is none
		var theAddress = theParam;
		if ((theAddress === undefined) || (theAddress === null)) {
			theAddress = addressFromText ("websites.[\"#data\"]", environment);
			}
		var thePageTable = theAddress;
		if ((thePageTable.flAddress === true) || (thePageTable.flOdbAddressText === true)) {
			thePageTable = liveAddress (thePageTable, environment).reference.get ();
			}
		if ((thePageTable === undefined) || (thePageTable === null) || (typeof thePageTable !== "object")) {
			const message = "Can't run the directive because the page table parameter isn't the address of a table.";
			throw new Error (message);
			}
		return (thePageTable);
		}

	function htmlRunDirective (theLineText, thePageTable, environment) { //the line without its #; answers the field's name as it was written
		const ixSpace = theLineText.indexOf (" ");
		const theFieldName = (ixSpace === -1) ? theLineText : theLineText.slice (0, ixSpace);
		const theExpression = (ixSpace === -1) ? "" : theLineText.slice (ixSpace + 1);
		var theValue;
		try {
			theValue = verbs ["lang.evaluate"] ([theExpression], environment);
			}
		catch (err) {
			const message = "Error evaluating #" + theFieldName + ": " + String (err.message).replace (/\.$/, "") + "."; //evaldirectiveerror in lang.r; one period at the end, not two
			throw new Error (message);
			}
		tableNames (thePageTable).forEach (function (theName) { //the assignment replaces, whatever the case of the name
			if (theName.toLowerCase () === theFieldName.toLowerCase ()) {
				delete thePageTable [theName];
				}
			});
		thePageTable [theFieldName] = theValue;
		if (theFieldName.toLowerCase () === "template") {
			thePageTable.indirectTemplate = true;
			}
		return (theFieldName);
		}

	verbs ["html.rundirective"] = function (args, environment) {
		const theLineText = String (verbs ["string.commentdelete"] ([String (args [0])], environment));
		const thePageTable = pageTableFromParam (args [1], environment);
		return (htmlRunDirective (theLineText, thePageTable, environment).toLowerCase ());
		};

	verbs ["html.rundirectives"] = function (args, environment) {
		const thePageTable = pageTableFromParam (args [1], environment);
		const flOnlyAtBeginning = (verbs ["html.getpref"] (["directivesOnlyAtBeginning", args [1]], environment) === true);
		const theLines = String (args [0]).split ("\n").join ("").split ("\r");
		const theKept = [];
		var flStopped = false;
		theLines.forEach (function (theLine) {
			if (!flStopped && (theLine.length > 0) && (theLine.charAt (0) === "#")) {
				htmlRunDirective (theLine.slice (1), thePageTable, environment);
				return;
				}
			if (flOnlyAtBeginning) {
				flStopped = true;
				}
			theKept.push (theLine);
			});
		return (theKept.join ("\r"));
		};

	/*  9/21/26 by CC -- html.glossaryPatcher's KERNEL HALF, for the Manila work:
		glossarypatcherverb in langhtml.c, its UserTalk in the comments and
		whole in html.data.standardMacros.glossaryPatcher. Every
		[[#glossPatch linetext|path|]] in the page table's renderedtext
		becomes <a href="url">linetext</a>, or the bare url when there is no
		linetext. The url climbs one ../ for each table between the object and
		the table that holds #ftpSite, then the path, then the fileExtension
		pref when the path has no extension and doesn't end in a slash.  */

	verbs ["html.glossarypatcher"] = function (args, environment) {
		const thePageTable = pageTableFromParam (args [0], environment);
		if (verbs ["html.getpref"] (["useGlossPatcher", args [0]], environment) !== true) {
			return (true);
			}
		var theRenderedKey;
		tableNames (thePageTable).forEach (function (theName) {
			if ((theRenderedKey === undefined) && (theName.toLowerCase () === "renderedtext")) {
				theRenderedKey = theName;
				}
			});
		if (theRenderedKey === undefined) {
			const message = "Can't patch the glossary links because the page table has no renderedtext.";
			throw new Error (message);
			}
		const adrObject = lookupNameCaseless (thePageTable, "adrObject");
		const adrFtpSite = lookupNameCaseless (thePageTable, "ftpSite");
		if ((adrObject === undefined) || (adrFtpSite === undefined)) {
			const message = "Can't patch the glossary links because the page table has no adrObject or no ftpSite.";
			throw new Error (message);
			}
		const theObjectTableNames = verbs ["string.parseaddress"] ([adrObject], environment).slice (0, -1);
		const theSiteTableNames = verbs ["string.parseaddress"] ([adrFtpSite], environment).slice (0, -1);
		var flUnderSite = (theSiteTableNames.length <= theObjectTableNames.length);
		theSiteTableNames.forEach (function (theName, ixName) {
			if (flUnderSite && (String (theObjectTableNames [ixName]).toLowerCase () !== String (theName).toLowerCase ())) {
				flUnderSite = false;
				}
			});
		const ctClimbs = flUnderSite ? (theObjectTableNames.length - theSiteTableNames.length) : theObjectTableNames.length; //the kernel climbs until the tables match, or until there is no parent
		const theUrlPrefix = "../".repeat (ctClimbs);
		const theExtension = String (verbs ["html.getpref"] (["fileExtension", args [0]], environment));
		const thePattern = "[[#glossPatch ";
		var theText = String (thePageTable [theRenderedKey]);
		var ixFrom = 0;
		while (true) {
			const ixStart = theText.indexOf (thePattern, ixFrom);
			if (ixStart === -1) {
				break;
				}
			const ixBody = ixStart + thePattern.length;
			var ixEnd = theText.indexOf ("]]", ixBody);
			ixEnd = (ixEnd === -1) ? theText.length : ixEnd + 2;
			const theFields = theText.slice (ixBody, ixEnd).split ("|");
			const theLineText = theFields [0];
			var thePath = (theFields [1] === undefined) ? "" : theFields [1];
			const theSecondDotWord = thePath.split (".") [1];
			if (((theSecondDotWord === undefined) || (theSecondDotWord.length === 0)) && (thePath.length > 0) && (thePath.charAt (thePath.length - 1) !== "/")) {
				thePath += theExtension;
				}
			const theUrl = theUrlPrefix + thePath;
			const thePatch = (theLineText.length === 0) ? theUrl : "<a href=\"" + theUrl + "\">" + theLineText + "</a>";
			theText = theText.slice (0, ixStart) + thePatch + theText.slice (ixEnd);
			ixFrom = ixStart;
			}
		thePageTable [theRenderedKey] = theText;
		return (true);
		};

	/*  9/21/26 by CC -- html.runOutlineDirectives, for Manila's control panel:
		runoutlinedirectivesverb in langhtml.c, its UserTalk in the comments.
		It changes the outline it is given the address of ("please send us a
		*COPY* of your outline"). The top level only: a line beginning with #
		is run as a directive and taken out, subs and all; #define name and
		#defineScript name take the line's subs as a new outline or script in
		the page table under that name, and an empty one is the kernel's
		error; a top-level comment line is taken out; the rest stays.  */

	verbs ["html.runoutlinedirectives"] = function (args, environment) {
		const adrOutline = liveAddress (args [0], environment);
		if (adrOutline === undefined) {
			const message = "Can't run the outline's directives because the first parameter isn't the address of an outline.";
			throw new Error (message);
			}
		const theOutline = adrOutline.reference.get ();
		if ((theOutline === undefined) || (theOutline === null) || (theOutline.flOdbScript !== true) || !Array.isArray (theOutline.lines)) {
			const message = "Can't run the outline's directives because the first parameter isn't the address of an outline.";
			throw new Error (message);
			}
		const thePageTable = pageTableFromParam (args [1], environment);
		const theKept = [];
		var ixLine = 0;
		while (ixLine < theOutline.lines.length) {
			const theSummit = theOutline.lines [ixLine];
			var ixAfter = ixLine + 1; //past the summit's subs
			while ((ixAfter < theOutline.lines.length) && (theOutline.lines [ixAfter].level > theSummit.level)) {
				ixAfter++;
				}
			const theSummitText = String (theSummit.text);
			if ((theSummitText.length > 0) && (theSummitText.charAt (0) === "#")) {
				const theDirective = htmlRunDirective (theSummitText.slice (1), thePageTable, environment).toLowerCase ();
				if ((theDirective === "define") || (theDirective === "definescript")) {
					var theDirectiveKey;
					tableNames (thePageTable).forEach (function (theName) {
						if (theName.toLowerCase () === theDirective) {
							theDirectiveKey = theName;
							}
						});
					const theObjectName = String (thePageTable [theDirectiveKey]);
					delete thePageTable [theDirectiveKey];
					if (ixAfter === ixLine + 1) {
						const message = "Empty sub-outline in \u201C" + theObjectName + "\u201D #define directive."; //left and right double quotes, emptydefinedirective in lang.r
						throw new Error (message);
						}
					const theNewLines = [];
					theOutline.lines.slice (ixLine + 1, ixAfter).forEach (function (theLine) {
						const theCopy = JSON.parse (JSON.stringify (theLine));
						theCopy.level = theLine.level - theSummit.level - 1;
						theNewLines.push (theCopy);
						});
					thePageTable [theObjectName] = {flOdbScript: true, scriptType: (theDirective === "define") ? "outline" : "script", lines: theNewLines};
					}
				}
			else if (theSummit.flComment !== true) {
				theOutline.lines.slice (ixLine, ixAfter).forEach (function (theLine) {
					theKept.push (theLine);
					});
				}
			ixLine = ixAfter;
			}
		const theNewOutline = {flOdbScript: true, scriptType: theOutline.scriptType, lines: theKept};
		adrOutline.reference.set (theNewOutline);
		return (true);
		};

	verbs ["html.deletepagetableaddress"] = function (args, environment) {
		const systemTemp = environment.odb.system.temp;
		if (systemTemp.pageTableAddresses !== undefined) {
			delete systemTemp.pageTableAddresses [String (verbs ["thread.getcurrentid"] ([], environment))]; //9/21/26 by CC -- this thread's entry, the kernel's way
			}
		delete systemTemp.currentPageTable;
		return (true);
		};
	
	verbs ["lang.new"] = function (args, environment) {
		return (verbs ["new"] (args, environment));
		};
	
	verbs ["lang.msg"] = function (args, environment) {
		return (verbs ["msg"] (args, environment));
		};
	
	verbs ["lang.delete"] = function (args, environment) {
		return (verbs ["delete"] (args, environment));
		};
	
	verbs ["lang.sizeof"] = function (args, environment) {
		return (verbs ["sizeof"] (args, environment));
		};
	
	verbs ["lang.defined"] = function (args, environment) {
		return (verbs ["defined"] (args, environment));
		};
	
	verbs ["lang.typeof"] = function (args, environment) {
		return (verbs ["typeof"] (args, environment));
		};
	
	verbs ["lang.nameof"] = function (args, environment) {
		return (verbs ["nameof"] (args, environment));
		};
	
	verbs ["lang.string"] = function (args, environment) {
		return (verbs ["string"] (args, environment));
		};
	
	verbs ["lang.number"] = function (args, environment) {
		return (verbs ["number"] (args, environment));
		};
	
	verbs ["lang.date"] = function (args, environment) {
		return (verbs ["date"] (args, environment));
		};
	
	verbs ["lang.char"] = function (args, environment) {
		return (verbs ["char"] (args, environment));
		};
	
	verbs ["lang.random"] = function (args, environment) {
		return (verbs ["random"] (args, environment));
		};
	
	verbs ["lang.scripterror"] = function (args, environment) {
		return (verbs ["scripterror"] (args, environment));
		};
	
	verbs ["lang.list"] = function (args, environment) {
		return (verbs ["list"] (args, environment));
		};
	
	verbs ["lang.address"] = function (args, environment) { //address coercion: text becomes an address, an address passes through
		const theValue = args [0];
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			return (theValue);
			}
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbAddressText === true)) { //8/23/26 by CC -- one that came back out of the database; see referenceForAddress
			return (addressFromText (String (theValue.path), environment));
			}
		return (addressFromText (String (theValue), environment));
		};

	verbs ["string.parseaddress"] = function (args, environment) {

		/*  9/8/26 by CC -- THE KERNEL'S string.parseAddress. stringverbs.c,
			parseaddress: the text of the address is compiled and
			langbuildnamelist (langops.c) walks the tree pushing each name --
			an identifier as itself, a bracketed name as the string inside the
			brackets -- so ["Macintosh HD:...:x.root"].a.b answers the list
			{"Macintosh HD:...:x.root", "a", "b"}. This is how the root's own
			scripts name the front Tool (Frontier.tools.commands.updateFrontTool,
			2007: x = string.parseAddress (adr); f = x [1]). The parameter is
			taken as text (getexempttextvalue), so an address arrives as its
			path. Until tonight this name answered an address instead, and
			DW's backup script got a list of true where the file path belonged.  */

		const theValue = args [0];
		var theText;
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			theText = String (theValue.pathText);
			}
		else if ((theValue !== undefined) && (theValue !== null) && (theValue.flOdbAddressText === true)) {
			theText = String (theValue.path);
			}
		else {
			theText = ((theValue === undefined) || (theValue === null)) ? "" : String (theValue);
			}
		if (theText.trim ().length === 0) {
			const message = "Can't parse the address because of a syntax error.";
			throw new Error (message);
			}
		const parts = addressTextParts (theText);
		var flValid = parts.length > 0;
		parts.forEach (function (thePart) {
			if (String (thePart).length === 0) {
				flValid = false;
				}
			});
		if (!flValid) {
			const message = "Can't parse the address because it's not a valid address.";
			throw new Error (message);
			}
		return (parts);
		};
	
	verbs ["address"] = verbs ["lang.address"];
	
	/*  8/22/26 by CC -- UNPACK. langunpackverb in langpack.c takes the packed
		bytes as a VALUE and the destination as a VARIABLE, puts the rebuilt
		value there, and answers true. A whole table comes back as a whole
		table -- that is what makes a fat page a backup format.
		
		The bytes are read by frontierodb, the same unpacker readFatPage uses,
		and odbHome.convertValue turns what comes out into the shapes the odb
		stores. Both were already written and proven by misc/installFatPage.js.
		
		The destination arrives as a string in DW's own code --
		fatPages.unpackOdbObject passes atts.adrPageData straight through --
		so it coerces the way Frontier coerces a string where an address
		belongs.  */
	
	verbs ["lang.unpack"] = function (args, environment) { //unpack (packedData, @dest)
		
		var thePacked = args [0];
		if ((thePacked !== undefined) && (thePacked !== null) && (thePacked.flAddress === true)) {
			thePacked = thePacked.reference.get ();
			}
		if ((thePacked === undefined) || (thePacked === null)) {
			const message = "Can't unpack the data because there's nothing to unpack.";
			throw new Error (message);
			}
		
		const theText = (typeof thePacked === "object") ? String (thePacked) : String (thePacked);
		const theBytes = Buffer.from (theText, "latin1");
		
		const adrDest = verbs ["lang.address"] ([args [1]], environment);
		if ((adrDest === undefined) || (adrDest === null) || (adrDest.flAddress !== true)) {
			const message = "Can't unpack the data because the second parameter isn't an address.";
			throw new Error (message);
			}
		
		var theUnpacked;
		try {
			theUnpacked = odbHome.requireFrontierOdb ().unpackMemoryValue (theBytes);
			}
		catch (err) {
			const message = "Can't unpack the data because " + err.message;
			throw new Error (message);
			}
		
		adrDest.reference.set (odbHome.convertValue (theUnpacked));
		return (true);
		};
	
	verbs ["unpack"] = verbs ["lang.unpack"];

	/*  8/23/26 by CC -- PACK, the inverse, and the reason there was no
		export. langpackverb takes the value and a VARIABLE for the answer,
		the same shape as unpack, which is how his own
		fatPages.encodePageData calls it:

		   on encodePageData (adrPageData)
		      local (data)
		      pack (adrPageData^, @data)
		      return (string (data))

		The bytes go out as latin1 text so string () gives them back
		unchanged and base64.encode can take them -- exactly what unpack
		reads back in. Tables, scripts and outlines; a menubar is refused by
		name rather than written as something it isn't.  */

	verbs ["lang.pack"] = function (args, environment) { //pack (theValue, @dest)

		var theValue = args [0];
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			theValue = theValue.reference.get ();
			}
		if ((theValue === undefined) || (theValue === null)) {
			const message = "Can't pack the value because there's nothing to pack.";
			throw new Error (message);
			}

		const adrDest = verbs ["lang.address"] ([args [1]], environment);
		if ((adrDest === undefined) || (adrDest === null) || (adrDest.flAddress !== true)) {
			const message = "Can't pack the value because the second parameter isn't an address.";
			throw new Error (message);
			}

		var theBytes;
		try {
			theBytes = odbHome.requireFrontierOdb ().packMemoryValue (theValue);
			}
		catch (err) {
			const message = "Can't pack the value because " + err.message;
			throw new Error (message);
			}

		adrDest.reference.set (theBytes.toString ("latin1"));
		return (true);
		};

	verbs ["pack"] = verbs ["lang.pack"];
	
	verbs ["lang.long"] = function (args) {
		if (args [0] instanceof Date) { //a date counts in seconds since 1904, same as number ()
			return (dates.frontierSecondsFromDate (args [0]));
			}
		return (Math.trunc (Number (args [0]))); //a boxed double coerces here, and comes back a long
		};
	
	verbs ["long"] = verbs ["lang.long"];
	
	verbs ["lang.double"] = function (args) { //8/19/26 by CC -- answers a DOUBLE, a boxed Number, so division on it is a fraction the way the kernel's coercetypes makes it
		if (args [0] instanceof Date) {
			return (new Number (dates.frontierSecondsFromDate (args [0])));
			}
		return (new Number (Number (args [0])));
		};
	
	verbs ["double"] = verbs ["lang.double"];
	
	verbs ["lang.abs"] = function (args) {
		return (Math.abs (Number (args [0])));
		};
	
	verbs ["abs"] = verbs ["lang.abs"];
	
	verbs ["lang.mod"] = function (args) {
		return (Number (args [0]) % Number (args [1]));
		};
	
	verbs ["lang.filespec"] = function (args) {
		/*  A filespec is a value that knows it's a file path. It coerces to
			its path in string context, so path arithmetic just works.  */
		return ({
			flFilespec: true,
			path: String (args [0]),
			toString: function () {
				return (this.path);
				}
			});
		};
	
	verbs ["filespec"] = verbs ["lang.filespec"];
	
	verbs ["list"] = function (args) { //coerce to a list
		const theValue = args [0];
		if (Array.isArray (theValue)) {
			return (theValue);
			}
		if (theValue === undefined) {
			return ([]);
			}
		return ([theValue]);
		};
	
	verbs ["string.popfilefromaddress"] = function (args) { //the address's path with the database part popped
		const theAddress = args [0];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			var pathText = theAddress.pathText;
			if (pathText.indexOf ("(deref).") === 0) {
				pathText = pathText.slice ("(deref).".length);
				}
			return (pathText);
			}
		return (String (theAddress));
		};
	
	verbs ["date"] = function (args) {
		if (args.length === 0) {
			return (new Date ());
			}
		if (args [0] instanceof Date) {
			return (args [0]);
			}
		if (typeof args [0] === "number") {
			return (dates.dateFromFrontierSeconds (args [0]));
			}
		return (dates.frontierDateFromString (String (args [0]))); //8/24/26 by CC -- the kernel's own "8/23/2026; 10:30:45 PM" form; JavaScript's Date can't read the semicolon
		};
	
	verbs ["clock.ticks"] = function (args) {
	
		/*  8/17/26 by CC -- ticks are 60ths of a second SINCE THE MACHINE
			BOOTED, which is what the kernel's TickCount () counts (op.c:
			#define gettickcount() (TickCount ())). Ours counted 60ths since
			1970, so differences were right and the number itself was
			astronomical -- and scripts that stash a tick count and compare it
			against a later one across a restart got nonsense.  */
		
		return (Math.floor ((Date.now () - whenMachineBooted) * 60 / 1000));
		};
	
	verbs ["file.rename"] = function (args) {
		const from = macToReal (args [0]);
		fs.renameSync (from, path.join (path.dirname (from), String (args [1])));
		return (true);
		};
	
	verbs ["clock.now"] = function (args) {
		return (new Date ());
		};
	
	/*  8/20/26 by CC -- getcurrenttimezonefunc in langverbs.c answers
		getcurrenttimezonebias () as a long. langdate.c shows which way it
		points: gmtdate = localdate - ctz, so the bias is local minus GMT in
		seconds, negative west of it. JavaScript's getTimezoneOffset is
		minutes the other way round.  */
	
	verbs ["date.getcurrenttimezone"] = function (args) {
		return (-(new Date ()).getTimezoneOffset () * 60);
		};
	
	/*  8/20/26 by CC -- shortstringfunc calls shortdatestring, the same form
		that opens a Changes entry.  */
	
	verbs ["date.shortstring"] = function (args) {
		return (dates.frontierShortDateString (dateArgOrNow (args [0])));
		};
	
	/*  8/20/26 by CC -- base64, from base64encodeverb and base64decodeverb in
		base64.c. The second parameter of encode is a line length, and the
		comment there is explicit about it: it only makes sense as a multiple
		of 4, so the break is only considered every fourth character, and a
		length of 0 means no line breaks at all. The break is a carriage
		return -- "5.0a18 dmb: line breaks are /r, not /n".  */
	
	/*  9/5/26 by CC -- THE KERNEL'S crypt VERBS, in place of the crypto.hashSHA1
		stand-in of 8/23. DW's ruling: leave his 2009 crypto extension
		(system.extensions.crypto in the 2012 root) exactly as it is and remove
		the stand-in, which stood in front of it by name. His extension already
		knows a kernel with crypto built in: isKernelized tests for
		system.compiler.kernel.crypt, and hashSHA1, hashMD5 and hmac_MD5 call
		crypt.SHA1, crypt.MD5 and crypt.hmacMD5 through its kernelGlue table.
		These are those verbs, from langcrypt.c (creedon, 2006): the string's
		bytes are hashed; flTranslate true, the default, answers the digest as
		lowercase hex, false answers the raw bytes. The s3, route53, ses,
		simpleDb, slide and OAuth clients call crypto.hashSHA1 (data, false)
		and feed the bytes into an HMAC, so the raw form keeps every byte as a
		character (latin1), the way the stand-in did. whirlpool is not here;
		a call to it lands in the missing-verb log like any other.  */

	function hexOrBytes (theDigest, flTranslate) {
		if ((flTranslate === undefined) || (flTranslate === true)) {
			return (theDigest.toString ("hex"));
			}
		return (theDigest.toString ("latin1"));
		}

	verbs ["crypt.sha1"] = function (args) {
		return (hexOrBytes (cryptoTool.createHash ("sha1").update (Buffer.from (String (args [0]), "latin1")).digest (), args [1]));
		};

	verbs ["crypt.md5"] = function (args) {
		return (hexOrBytes (cryptoTool.createHash ("md5").update (Buffer.from (String (args [0]), "latin1")).digest (), args [1]));
		};

	verbs ["crypt.hmacmd5"] = function (args) { //(data, key, flTranslate)
		return (hexOrBytes (cryptoTool.createHmac ("md5", Buffer.from (String (args [1]), "latin1")).update (Buffer.from (String (args [0]), "latin1")).digest (), args [2]));
		};

	verbs ["crypt.hmacsha1"] = function (args) { //(data, key, flTranslate)
		return (hexOrBytes (cryptoTool.createHmac ("sha1", Buffer.from (String (args [1]), "latin1")).update (Buffer.from (String (args [0]), "latin1")).digest (), args [2]));
		};

	verbs ["base64.encode"] = function (args) {
		const theText = Buffer.from (String (args [0]), "latin1").toString ("base64");
		const theLength = (args [1] === undefined) ? 0 : Number (args [1]);
		if (theLength <= 0) {
			return (theText);
			}
		var theResult = "";
		var ixChar = 0;
		while (ixChar < theText.length) {
			if (theResult.length > 0) {
				theResult += "\r";
				}
			theResult += theText.substr (ixChar, theLength - (theLength % 4));
			ixChar += (theLength - (theLength % 4));
			}
		return (theResult);
		};
	
	verbs ["base64.decode"] = function (args) {
		return (Buffer.from (String (args [0]).replace (/[\r\n]/g, ""), "base64").toString ("latin1"));
		};

	/*  8/31/26 by CC -- THE STRING ENCODING FAMILY, from stringverbs.c,
		langhtml.c and iso8859.c, part of the builtins sweep. The MacRoman
		high-character row is the same one frontierodb reads .root files
		with -- when one changes the other should too.  */

	const theMacRomanHighChars =
		"ÄÅÇÉÑÖÜáàâäãåçéè" +
		"êëíìîïñóòôöõúùûü" +
		"†°¢£§•¶ß®©™´¨≠ÆØ" +
		"∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
		"¿¡¬√ƒ≈∆«»… ÀÃÕŒœ" + //nonbreaking space
		"–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ" +
		"‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ" +
		"ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"; //apple logo

	verbs ["string.mactolatin"] = function (args) { //MacRoman bytes to Latin-1; a char with no Latin home keeps its byte
		var theResult = "";
		String (args [0]).split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode < 128) {
				theResult += theChar;
				}
			else {
				const theUnicode = theMacRomanHighChars.charCodeAt (theCode - 128);
				theResult += (theUnicode <= 255) ? String.fromCharCode (theUnicode) : theChar;
				}
			});
		return (theResult);
		};

	verbs ["string.latintomac"] = function (args) { //Latin-1 bytes to MacRoman; a char MacRoman doesn't have keeps its byte
		var theResult = "";
		String (args [0]).split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode < 128) {
				theResult += theChar;
				}
			else {
				const ix = theMacRomanHighChars.indexOf (String.fromCharCode (theCode));
				theResult += (ix === -1) ? theChar : String.fromCharCode (128 + ix);
				}
			});
		return (theResult);
		};

	verbs ["string.ansitoutf8"] = function (args) {
		return (Buffer.from (String (args [0]), "utf8").toString ("latin1"));
		};

	verbs ["string.utf8toansi"] = function (args) {
		return (Buffer.from (String (args [0]), "latin1").toString ("utf8"));
		};

	verbs ["string.ansitoutf16"] = function (args) { //big-endian, the Mac's byte order
		const theLittle = Buffer.from (String (args [0]), "utf16le");
		theLittle.swap16 ();
		return (theLittle.toString ("latin1"));
		};

	verbs ["string.utf16toansi"] = function (args) {
		var theBytes = Buffer.from (String (args [0]), "latin1");
		if ((theBytes [0] === 0xff) && (theBytes [1] === 0xfe)) { //little-endian marked
			theBytes = theBytes.slice (2);
			}
		else {
			if ((theBytes [0] === 0xfe) && (theBytes [1] === 0xff)) { //big-endian marked
				theBytes = theBytes.slice (2);
				}
			theBytes = Buffer.from (theBytes); //unmarked reads big-endian, the Mac's way
			if (theBytes.length % 2 === 1) {
				theBytes = theBytes.slice (0, theBytes.length - 1);
				}
			theBytes.swap16 ();
			}
		return (theBytes.toString ("utf16le"));
		};

	/*  The iso8859 mapping, entry for entry from iso8859table in iso8859.c --
		Alan Legg's table: MacRoman high characters become entities where an
		entity exists, bracketed names where none does. Keys are the char
		codes; a code not here passes through.  */

	const theIso8859Table = {
		128: "&Auml;", 129: "&Aring;", 130: "&Ccedil;", 131: "&Eacute;", 132: "&Ntilde;", 133: "&Ouml;", 134: "&Uuml;", 135: "&aacute;",
		136: "&agrave;", 137: "&acirc;", 138: "&auml;", 139: "&atilde;", 140: "&aring;", 141: "&ccedil;", 142: "&eacute;", 143: "&egrave;",
		144: "&ecirc;", 145: "&euml;", 146: "&iacute;", 147: "&igrave;", 148: "&icirc;", 149: "&iuml;", 150: "&ntilde;", 151: "&oacute;",
		152: "&ograve;", 153: "&ocirc;", 154: "&ouml;", 155: "&otilde;", 156: "&uacute;", 157: "&ugrave;", 158: "&ucirc;", 159: "&uuml;",
		160: "[sgl dagger]", 161: "&#176;", 162: "&#162;", 163: "&#163;", 164: "&#167;", 165: "o", 166: "&#182;", 167: "&szlig;",
		168: "&reg;", 169: "&copy;", 170: "[trademark]", 171: "&#180;", 172: "&#168;", 173: "[not equal]", 174: "&AElig;", 175: "&Oslash;",
		176: "°", 177: "&#177;", 178: "[less equal]", 179: "[greater equal]", 180: "&#165;", 181: "&#181;", 182: "[partial diff]", 183: "[sigma]", //the kernel's own byte for 176: degree sign
		184: "[product]", 185: "[pi]", 186: "[integral]", 187: "&#186;", 188: "&#170;", 189: "[omega]", 190: "&aelig;", 191: "&oslash;",
		192: "&#191;", 193: "&#161;", 194: "&#172;", 195: "[radical]", 196: "[florin]", 197: "[approx equal]", 198: "[delta]", 199: "&#171;",
		200: "&#187;", 201: "...", 202: "&nbsp;", 203: "&Agrave;", 204: "&Atilde;", 205: "&Otilde;", 206: "[OE]", 207: "[oe]",
		208: "-", 209: "--", 210: "\"", 211: "\"", 212: "'", 213: "'", 214: "&#247;", 215: "[lozenge]",
		216: "&yuml;", 217: "[Y&#168;]", 218: "/", 219: "&#164;", 220: "[&lt;]", 221: "[&gt;]", 222: "[fi]", 223: "[fl]",
		224: "[dbl dagger]", 225: "&#183;", 226: "[base ']", 227: "[base \"]", 228: "[per thou]", 229: "&Acirc;", 230: "&Ecirc;", 231: "&Aacute;",
		232: "&Euml;", 233: "&Egrave;", 234: "&Iacute;", 235: "&Icirc;", 236: "&Iuml;", 237: "&Igrave;", 238: "&Oacute;", 239: "&Ocirc;",
		240: "[apple]", 241: "&Ograve;", 242: "&Uacute;", 243: "&Ucirc;", 244: "&Ugrave;", 245: "[dotless i]", 246: "[^]", 247: "[~]",
		248: "[macron]", 249: "[breve]", 250: "[dot accent]", 251: "[ring]", 252: "[cedilla]", 253: "[hungarian umlaut]", 254: "[ogonek]", 255: "[caron]"
		};

	verbs ["string.iso8859encode"] = function (args) { //iso8859encode (s, adrTable) -- high characters become entities, per the caller's table or the kernel's
		var theTable = args [1];
		if ((theTable !== undefined) && (theTable !== null) && (theTable.flAddress === true)) {
			theTable = theTable.reference.get ();
			}
		const flUserTable = ((theTable !== undefined) && (theTable !== null) && (typeof theTable === "object"));
		var theResult = "";
		String (args [0]).split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode <= 127) {
				theResult += theChar;
				return;
				}
			var theMapped;
			if (flUserTable) {
				theMapped = theTable [String (theCode)];
				theMapped = (theMapped === undefined) ? undefined : String (theMapped);
				}
			else {
				theMapped = theIso8859Table [theCode];
				}
			theResult += (theMapped === undefined) ? theChar : theMapped;
			});
		return (theResult);
		};

	verbs ["string.getgifheightwidth"] = function (args) { //a file path in, {height, width} out -- getGifBounds reads bytes 6-9
		const theBytes = fs.readFileSync (macToReal (String (args [0])));
		if (theBytes.length < 10) {
			const message = "Can't get GIF height and width because the file isn't a valid GIF file.";
			throw new Error (message);
			}
		const theWidth = theBytes [6] + (theBytes [7] << 8);
		const theHeight = theBytes [8] + (theBytes [9] << 8);
		return ([theHeight, theWidth]);
		};

	verbs ["string.getjpegheightwidth"] = function (args) { //a file path in, {height, width} out -- the SOF marker scan, Jim Correia's algorithm

		function refuse () {
			const message = "Can't get JPEG height and width because the file isn't a valid JPEG file.";
			throw new Error (message);
			}

		const theBytes = fs.readFileSync (macToReal (String (args [0])));
		if ((theBytes.length < 4) || (theBytes [0] !== 0xff) || (theBytes [1] !== 0xd8)) { //SOI
			refuse ();
			}
		var ix = 2;
		while (ix < theBytes.length - 1) {
			if (theBytes [ix] !== 0xff) {
				ix++;
				continue;
				}
			const theMarker = theBytes [ix + 1];
			if ((theMarker === 0xff) || (theMarker === 0x00)) {
				ix++;
				continue;
				}
			if ((theMarker >= 0xc0) && (theMarker <= 0xcf) && (theMarker !== 0xc4) && (theMarker !== 0xc8) && (theMarker !== 0xcc)) { //a start-of-frame
				const theHeight = (theBytes [ix + 5] << 8) + theBytes [ix + 6];
				const theWidth = (theBytes [ix + 7] << 8) + theBytes [ix + 8];
				return ([theHeight, theWidth]);
				}
			if ((theMarker === 0xd8) || ((theMarker >= 0xd0) && (theMarker <= 0xd9))) { //no length word rides these
				ix += 2;
				continue;
				}
			ix += 2 + (theBytes [ix + 2] << 8) + theBytes [ix + 3]; //skip the segment by its length
			}
		refuse ();
		};

	verbs ["string.davenetmassager"] = function (args) { //daveNetMassager (indentlen, maxlinelen, text) -- the DaveNet mail formatter, word by word

		const indentLen = Number (args [0]);
		const maxLineLen = Number (args [1]);
		const theText = String (args [2]);

		const theIndent = " ".repeat (Math.max (0, indentLen));
		var theDashes = "";
		var i;
		for (i = 1; i <= 16; i++) {
			theDashes += " ---";
			}

		var theResult = theIndent;
		var lineLen = indentLen;
		var theWord = "";
		var ix = 0;
		while (ix < theText.length) {
			if (theText.charAt (ix) === "\r") {
				if (theWord === "---") {
					theResult += theDashes;
					theWord = "";
					}
				theResult += "\r" + theIndent;
				lineLen = indentLen;
				ix++;
				}
			else {
				while ((ix < theText.length) && (theText.charAt (ix) === " ")) { //leading blanks
					ix++;
					}
				if (ix >= theText.length) {
					break;
					}
				theWord = "";
				while ((ix < theText.length) && (theText.charAt (ix) !== " ") && (theText.charAt (ix) !== "\r")) {
					theWord += theText.charAt (ix);
					ix++;
					}
				while ((ix < theText.length) && (theText.charAt (ix) === " ")) { //trailing blanks
					ix++;
					}
				if ((lineLen + theWord.length) > maxLineLen) {
					theResult += "\r" + theIndent + theWord + " ";
					lineLen = indentLen + theWord.length;
					}
				else {
					theResult += theWord + " ";
					lineLen += theWord.length;
					}
				}
			}
		return (theResult);
		};
	
	verbs ["date.netstandardstring"] = function (args) {
		return (new Date (args [0]).toUTCString ());
		};
	
	verbs ["date.versionlessthan"] = function (args) {
	
		/*  8/17/26 by CC -- Frontier's version comparison understands the
			STAGE LETTERS: d(evelopment) < a(lpha) < b(eta) < f(inal
			candidate) < released. The glue's own test cases are the spec, and
			the one that caught us is the first of them: "2.0b9" IS less than
			"2.0", because a beta comes before the release. Ours compared
			numbers only and answered false.  */
		
		function explodeVersion (theVersion) {
			var theText = String (theVersion);
			var mainText = "";
			const stageChars = "dabf";
			while (theText.length > 0) {
				if (stageChars.indexOf (theText.charAt (0).toLowerCase ()) !== -1) {
					break;
					}
				mainText += theText.charAt (0);
				theText = theText.slice (1);
				}
			const parts = mainText.split (".");
			while (parts.length < 3) {
				parts.push ("0");
				}
			var mainNumber = "";
			parts.forEach (function (part) {
				mainNumber += ((part.length === 0) ? "0" : part);
				});
			const theRecord = {mainVersionNum: Number (mainNumber), stageNum: 0, subVersionNum: 0};
			if (theText.length === 0) {
				return (theRecord);
				}
			const theStageChar = theText.charAt (0).toLowerCase ();
			var ctToDelete = 1;
			if (theStageChar === "d") {
				theRecord.stageNum = 1;
				}
			if (theStageChar === "a") {
				theRecord.stageNum = 2;
				}
			if (theStageChar === "b") {
				theRecord.stageNum = 3;
				}
			if (theStageChar === "f") {
				theRecord.stageNum = 4;
				if (theText.charAt (1).toLowerCase () === "c") {
					ctToDelete = 2;
					}
				}
			theRecord.subVersionNum = Number (theText.slice (ctToDelete));
			if (isNaN (theRecord.subVersionNum)) {
				theRecord.subVersionNum = 0;
				}
			return (theRecord);
			}
		
		const theOne = explodeVersion (args [0]), theOther = explodeVersion (args [1]);
		if (theOne.mainVersionNum !== theOther.mainVersionNum) {
			return (theOne.mainVersionNum < theOther.mainVersionNum);
			}
		if (theOne.stageNum !== theOther.stageNum) {
			if (theOne.stageNum === 0) {
				return (false); //no stage letter means released, greater than any stage
				}
			if (theOther.stageNum === 0) {
				return (true);
				}
			return (theOne.stageNum < theOther.stageNum);
			}
		if (theOne.subVersionNum !== theOther.subVersionNum) {
			if (theOne.subVersionNum === 0) {
				return (false);
				}
			return (theOne.subVersionNum < theOther.subVersionNum);
			}
		return (false); //they're equal
		};
	
	verbs ["date.prevmonth"] = function (args) {
		const theDate = new Date (args [0]);
		return (new Date (theDate.getFullYear (), theDate.getMonth () - 1, Math.min (theDate.getDate (), 28)));
		};
	
	verbs ["date.nextmonth"] = function (args) {
		const theDate = new Date (args [0]);
		return (new Date (theDate.getFullYear (), theDate.getMonth () + 1, Math.min (theDate.getDate (), 28)));
		};
	
	verbs ["date.firstofmonth"] = function (args) {
		const theDate = new Date (args [0]);
		return (new Date (theDate.getFullYear (), theDate.getMonth (), 1));
		};
	
	verbs ["date.lastofmonth"] = function (args) {
		const theDate = new Date (args [0]);
		return (new Date (theDate.getFullYear (), theDate.getMonth () + 1, 0));
		};
	
	verbs ["date.daysinmonth"] = function (args) {
		const theDate = new Date (args [0]);
		return (new Date (theDate.getFullYear (), theDate.getMonth () + 1, 0).getDate ());
		};
	
	/*  8/17/26 by CC -- the day before and after THE DATE YOU PASS. They
		ignored the parameter and always answered now-a-day and now-a-day,
		which is why his cleanupFargoBackups could never finish: it walks
		forward from 2015 with `when = date.tomorrow (when)`, and every trip
		put `when` back at tomorrow.  */
	
	verbs ["date.yesterday"] = function (args) {
		return (new Date (dateArgOrNow (args [0]).getTime () - (24 * 60 * 60 * 1000)));
		};
	
	verbs ["date.tomorrow"] = function (args) {
		return (new Date (dateArgOrNow (args [0]).getTime () + (24 * 60 * 60 * 1000)));
		};
	
	/*  8/13/26 by CC -- the parameter is optional in Frontier and defaults to
		now. new Date (undefined) is Invalid Date, so every one of these
		answered NaN when called bare -- date.year () in clock.timeStamp's
		short path made the year "NaN", the replace found nothing, and DW's
		stamp kept its full year.  */
	
	function dateArgOrNow (theArg) {
		if (theArg instanceof Date) {
			return (theArg);
			}
		if ((theArg === undefined) || (theArg === null)) {
			return (new Date ());
			}
		return (new Date (theArg));
		}
	
	verbs ["date.year"] = function (args) {
		return (dateArgOrNow (args [0]).getFullYear ());
		};
	
	verbs ["date.month"] = function (args) {
		return (dateArgOrNow (args [0]).getMonth () + 1);
		};
	
	verbs ["date.day"] = function (args) {
		return (dateArgOrNow (args [0]).getDate ());
		};
	
	verbs ["date.hour"] = function (args) {
		return (dateArgOrNow (args [0]).getHours ());
		};
	
	verbs ["date.minute"] = function (args) {
		return (dateArgOrNow (args [0]).getMinutes ());
		};
	
	verbs ["date.second"] = function (args) {
		return (dateArgOrNow (args [0]).getSeconds ());
		};
	
	verbs ["date.dayofweek"] = function (args) {
		return (dateArgOrNow (args [0]).getDay () + 1); //1-based, Sunday first
		};

	/*  8/31/26 by CC -- THE REST OF THE DATE FAMILY, from langverbs.c and
		timedate.c: abbrevstring and longstring are the kernel's medium and
		long date forms, daystring the full weekday name, nextweek and
		prevweek seven days either way, nextyear and prevyear a calendar year
		either way, weeksinmonth the count of calendar rows the month needs.
		monthToString and dayOfWeekToString read user.prefs.dates the way
		datemonthtostring does, creating the lists there when they're
		missing.

		One deliberate departure: the 2011 port's prevyear calls
		incrementDateByYear (t, 1) -- the same PLUS one year as nextyear, a
		port bug (the token's name and every use say backward). Ours goes
		backward.  */

	const theMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const theDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

	function dateNamesList (environment, theName, theDefaults) { //user.prefs.dates.monthNames and dayNames, created on first use the kernel's way
		var theList;
		try {
			const adrList = verbs ["lang.address"] (["user.prefs.dates." + theName], environment);
			theList = adrList.reference.get ();
			if (!Array.isArray (theList)) {
				adrList.reference.set (theDefaults.slice ());
				theList = adrList.reference.get ();
				}
			}
		catch (err) {
			theList = theDefaults;
			}
		return (Array.isArray (theList) ? theList : theDefaults);
		}

	verbs ["date.abbrevstring"] = function (args) { //the kernel's medium form: Aug 31, 2026
		const theDate = dateArgOrNow (args [0]);
		return (theMonthNames [theDate.getMonth ()].slice (0, 3) + " " + theDate.getDate () + ", " + theDate.getFullYear ());
		};

	verbs ["date.longstring"] = function (args) { //the kernel's long form: August 31, 2026
		const theDate = dateArgOrNow (args [0]);
		return (theMonthNames [theDate.getMonth ()] + " " + theDate.getDate () + ", " + theDate.getFullYear ());
		};

	verbs ["date.daystring"] = function (args) { //the full weekday name, getdaystring in timedate.c
		return (theDayNames [dateArgOrNow (args [0]).getDay ()]);
		};

	verbs ["date.monthtostring"] = function (args, environment) {
		const ix = Number (args [0]);
		if ((ix < 1) || (ix > 12) || isNaN (ix)) {
			const message = "Can't convert " + String (args [0]) + " to a string because it is not between 1 and 12.";
			throw new Error (message);
			}
		return (String (dateNamesList (environment, "monthNames", theMonthNames) [ix - 1]));
		};

	verbs ["date.dayofweektostring"] = function (args, environment) {
		const ix = Number (args [0]);
		if ((ix < 1) || (ix > 7) || isNaN (ix)) {
			const message = "Can't convert " + String (args [0]) + " to a string because it is not between 1 and 7.";
			throw new Error (message);
			}
		return (String (dateNamesList (environment, "dayNames", theDayNames) [ix - 1]));
		};

	verbs ["date.nextweek"] = function (args) {
		return (new Date (dateArgOrNow (args [0]).getTime () + (7 * 24 * 60 * 60 * 1000)));
		};

	verbs ["date.prevweek"] = function (args) {
		return (new Date (dateArgOrNow (args [0]).getTime () - (7 * 24 * 60 * 60 * 1000)));
		};

	verbs ["date.nextyear"] = function (args) {
		const theDate = dateArgOrNow (args [0]);
		const theAnswer = new Date (theDate.getTime ());
		theAnswer.setFullYear (theDate.getFullYear () + 1);
		return (theAnswer);
		};

	verbs ["date.prevyear"] = function (args) {
		const theDate = dateArgOrNow (args [0]);
		const theAnswer = new Date (theDate.getTime ());
		theAnswer.setFullYear (theDate.getFullYear () - 1);
		return (theAnswer);
		};

	verbs ["date.weeksinmonth"] = function (args) { //weeksinmonthfunc's own arithmetic: (days + 6 + weekday-offset-of-the-first) div 7
		const theDate = dateArgOrNow (args [0]);
		const theFirst = new Date (theDate.getFullYear (), theDate.getMonth (), 1);
		const ctDays = new Date (theDate.getFullYear (), theDate.getMonth () + 1, 0).getDate ();
		const dayOffset = theFirst.getDay (); //0..6, the kernel's dayofweek minus one
		return (Math.floor ((ctDays + 6 + dayOffset) / 7));
		};

	/*  8/31/26 by CC -- THE CLOCK WAITS, from langverbs.c: waitseconds is
		delayfunc (delayseconds, answers true), waitsixtieths is
		delaysixtiethsfunc, sleepfor is sleepfunc (the kernel lets only
		agents call it; here it sleeps the same way). The sleep is a real
		one -- Atomics.wait with a timeout, the same stop-and-wait the
		dialogs ride -- so a script that asks for two seconds takes two
		seconds, without spinning the processor.  */

	function sleepForMilliseconds (theMilliseconds) {
		if (theMilliseconds > 0) {
			Atomics.wait (new Int32Array (new SharedArrayBuffer (4)), 0, 0, theMilliseconds);
			}
		return (true);
		}

	verbs ["clock.waitseconds"] = function (args) {
		return (sleepForMilliseconds (Number (args [0]) * 1000));
		};

	verbs ["clock.waitsixtieths"] = function (args) {
		return (sleepForMilliseconds (Math.round (Number (args [0]) * 1000 / 60)));
		};

	verbs ["clock.sleepfor"] = function (args) {
		return (sleepForMilliseconds (Number (args [0]) * 1000));
		};

	verbs ["clock.set"] = function (args) {
		const message = "Can't set the clock because the system clock isn't Atlantis's to set.";
		throw new Error (message);
		};
	
	verbs ["speaker.beep"] = function (args) {
		return (true); //the trace line is the beep
		};

	verbs ["console.log"] = function (args) {

		/*  8/26/26 by CC -- DW's ruling 8/26: the ACTUAL console.log, in
			place of his simulation (suites.console wrote the lines into a
			scratchpad outline). Headless the message lands on the process's
			own console -- the server log; the worker's version also hands
			it to the window, whose JavaScript console is the one Inspect
			opens.  */

		var theText = "";
		args.forEach (function (theArg) {
			if (theText.length > 0) {
				theText += " ";
				}
			theText += verbs ["lang.displaystring"] ([theArg]);
			});
		console.log (theText);
		return (true);
		};
	
	/*  8/11/26 by CC -- the kernel verbs the OPML Editor's menu commands
		lean on, harvested from DW's odb as kernel thunks. The keyboard and
		selection ones answer for an environment where the server can't see
		the keyboard: no modifier keys are down and no text is selected, so
		every script takes its plain path. displayString is what runSelection
		wraps a one-liner's value in before depositing it.  */
	
	verbs ["kb.shiftkey"] = function (args) {
		return (false);
		};
	verbs ["kb.optionkey"] = verbs ["kb.shiftkey"];
	verbs ["kb.cmdkey"] = verbs ["kb.shiftkey"];
	verbs ["kb.controlkey"] = verbs ["kb.shiftkey"];
	
	verbs ["wp.intextmode"] = function (args) {
		return (false);
		};
	verbs ["wp.settextmode"] = function (args) {
		return (true);
		};
	verbs ["wp.getseltext"] = function (args) {
		return ("");
		};
	verbs ["wp.getselect"] = function (args) { //the two addresses get zeros -- no selection
		args.forEach (function (theArg) {
			if ((theArg !== undefined) && (theArg !== null) && (theArg.flAddress === true)) {
				theArg.reference.set (0);
				}
			});
		return (true);
		};
	verbs ["wp.setselect"] = function (args) {
		return (true);
		};
	
	verbs ["window.ismenuscript"] = function (args) {
		return (false);
		};
	
	verbs ["string.length"] = function (args) {
		return (String (args [0]).length);
		};
	
	//8/13/26 by CC -- the date-and-time text verbs, forms in dates.js; the argument is optional and defaults to now
	function dateFromArg (theArg) {
		if (theArg instanceof Date) {
			return (theArg);
			}
		if ((theArg === undefined) || (theArg === null)) {
			return (new Date ());
			}
		return (new Date (theArg));
		}
	verbs ["string.datestring"] = function (args) { //"Thursday, August 13, 2026"
		return (dates.frontierLongDateString (dateFromArg (args [0])));
		};
	verbs ["string.timestring"] = function (args) { //"11:14:22 AM"
		return (dates.frontierTimeString (dateFromArg (args [0])));
		};
	verbs ["string.commentdelete"] = function (args) { //everything from the chevron on is comment
		const theString = String (args [0]);
		const ixComment = theString.indexOf ("«"); //left chevron
		return ((ixComment === -1) ? theString : theString.substring (0, ixComment));
		};
	
	/*  8/14/26 by CC -- the console verbs that lived here (console.log,
		console.start, added 8/13) are REMOVED, DW's ruling: "you created
		this problem, not me." His script suite at
		system.verbs.builtins.console is the console; with no kernel verb by
		those names, calls fall through to it. What his suite needs from the
		kernel is target.set aiming the op verbs, which is real now.  */
	
	verbs ["displaystring"] = function (args) {
		const theValue = args [0];
		if (theValue === undefined) {
			return ("nil"); //8/24/26 by CC -- hashgetvaluestring in langhash.c: nil displays as the word nil, so a one-liner that answers nothing deposits «nil instead of an empty comment, and you can see the run happened
			}
		if (typeof theValue === "string") {
			return (theValue);
			}
		if (charvalue.flCharValue (theValue)) { //8/26/26 by CC -- a char displays as its character, coercetostring's rule
			return (String (theValue));
			}
		if (theValue instanceof Date) {
			return (dates.frontierDateToString (theValue)); //8/13/26 by CC -- "8/13/2026; 11:14:22 AM", the kernel's timedatestring
			}
		if (Array.isArray (theValue)) {
			var theText = "";
			theValue.forEach (function (theItem) {
				if (theText.length > 0) {
					theText += ", ";
					}
				theText += verbs ["displaystring"] ([theItem]);
				});
			return ("{" + theText + "}");
			}
		
		/*  8/15/26 by CC -- a structured value displays as the TEXT OF AN
			OUTLINE: one line per part, tabs for depth. DW's ruling, from
			Drummer: "when we return an object we turn it into an outline and
			paste that below the oneliner." The op.insert on the other end
			knows a multi-line text is an outline to build, so a one-liner
			that answers a table or an outline deposits the real thing, not
			"[object Object]".  */
		
		if ((theValue !== null) && (typeof theValue === "object")) {
			if ((theValue.flAddress === true) && (theValue.pathText !== undefined)) {
				return (String (theValue.pathText));
				}
			if (((theValue.flOdbScript === true) || (theValue.flOdbMenubar === true)) && Array.isArray (theValue.lines)) {
				var theOutlineText = "";
				var ctSummits = 0;
				theValue.lines.forEach (function (theLine) {
					if ((theLine !== null) && (typeof theLine === "object") && (typeof theLine.text === "string")) {
						var tabs = "";
						var ctTabs = Math.max (Number (theLine.level) || 0, 0);
						if (ctTabs === 0) {
							ctSummits++;
							}
						while (ctTabs > 0) {
							tabs += "\t";
							ctTabs--;
							}
						theOutlineText += ((theOutlineText.length > 0) ? "\n" : "") + tabs + theLine.text;
						}
					});
				if (ctSummits > 1) { //one summit always, so a deposit is one subtree and a rerun can smash it whole
					theOutlineText = "outline [" + theValue.lines.length + " lines]\n\t" + theOutlineText.split ("\n").join ("\n\t");
					}
				return (theOutlineText);
				}
			if (theValue.flWpText === true) {
				return (String (theValue.text));
				}
			/*  8/15/26 by CC -- a TABLE displays as JSON, pretty-printed, brace
				to brace -- DW's ruling, with Drummer's deposit as the model
				(his screenshot: {, one "name": value line per item, }). The
				deposit machinery turns each line into an outline line.
				
				Nested tables ride along as nested JSON. A script, outline or
				wptext inside the table becomes its TEXT, a date its Frontier
				text, an address its path. One guard, because a one-liner near
				the root would otherwise walk the whole database: past a
				quarter-megabyte the render stops and says what it is instead
				-- flagged in worknotes for DW's review, not a spec.  */
			
			const maxJsonChars = 262144;
			var ctJsonChars = 0;
			function jsonReadyCopy (theTable) {
				const theCopy = {};
				Object.keys (theTable).forEach (function (theName) {
					if ((theName === "flOdbSqlTable") || (theName === "odbId")) {
						return;
						}
					if (ctJsonChars > maxJsonChars) {
						return;
						}
					const theItem = theTable [theName];
					var theRendered;
					if ((theItem !== null) && (typeof theItem === "object") && !(theItem instanceof Date) && !Array.isArray (theItem) &&
						(theItem.flOdbScript === undefined) && (theItem.flOdbMenubar === undefined) && (theItem.flWpText === undefined) &&
						(theItem.flAddress === undefined) && (theItem.flOdbAddressText === undefined)) {
						theRendered = jsonReadyCopy (theItem); //a subtable nests
						}
					else {
						if ((theItem === undefined) || (theItem === null)) {
							theRendered = null;
							}
						else {
							if ((typeof theItem === "number") || (typeof theItem === "boolean")) {
								theRendered = theItem;
								}
							else {
								theRendered = verbs ["displaystring"] ([theItem]); //strings as themselves, dates as Frontier text, scripts and outlines as their text, addresses as their path
								}
							}
						}
					theCopy [theName] = theRendered;
					ctJsonChars += theName.length + String (theRendered).length + 8;
					});
				return (theCopy);
				}
			const theCopy = jsonReadyCopy (theValue);
			if (ctJsonChars > maxJsonChars) {
				var ctItems = 0;
				Object.keys (theValue).forEach (function (theName) {
					if ((theName !== "flOdbSqlTable") && (theName !== "odbId")) {
						ctItems++;
						}
					});
				return ("table [" + ctItems + ((ctItems === 1) ? " item" : " items") + ", too big to display]");
				}
			/*  The closing braces get one extra tab so each } sits INSIDE its
				object's subtree -- the deposit stays one outline with { as
				the summit, which is both Drummer's shape and what lets a
				rerun smash the whole thing.  */
			
			var theJsonText = "";
			JSON.stringify (theCopy, undefined, "\t").split ("\n").forEach (function (theLine) {
				const theTrimmed = theLine.trim ();
				if ((theTrimmed === "}") || (theTrimmed === "},")) {
					theLine = "\t" + theLine;
					}
				theJsonText += ((theJsonText.length > 0) ? "\n" : "") + theLine;
				});
			return (theJsonText);
			}
		return (String (theValue));
		};
	verbs ["lang.displaystring"] = verbs ["displaystring"]; //the kernel thunk spells it lang.displayString
	
	verbs ["dialog.alert"] = function (args) {
		return (true); //the trace line is the dialog
		};
	
	verbs ["dialog.notify"] = verbs ["dialog.alert"];
	
	/*  The xml verbs, Frontier's XML-tables convention: an element is a
		table entry whose name is "NNNNN\tname" (numbered for document
		order), attributes live in a "/atts" subtable, character data in a
		"/pcdata" entry.  */
	
	function xmlEntityEncode (theString) {
		/*  8/4/26 by CC -- ">" stays raw, matching Frontier: nodeEditorSuite's
			title replacement searches for "&lt;%title%>" with a bare ">", so an
			encoder that touched ">" would break every glossary substitution in
			generated opml.  */
		return (String (theString)
			.split ("&").join ("&amp;")
			.split ("<").join ("&lt;")
			.split ("\"").join ("&quot;"));
		}
	
	function opXmlEncodeText (theString) { //9/29/26 by CC -- opxmlencodetext (opxml.c, 7.0b21 PBS): & " < and > in a line's text, so the OPML compiles back; xmlEntityEncode leaves > bare, which is right for pcdata and wrong for the text attribute -- 157 &gt; in concord's opml came back bare from a build here
		return (String (theString)
			.split ("&").join ("&amp;")
			.split ("\"").join ("&quot;")
			.split ("<").join ("&lt;")
			.split (">").join ("&gt;"));
		}
	
	function xmlEntityDecode (theString) {
		return (String (theString)
			.split ("&lt;").join ("<")
			.split ("&gt;").join (">")
			.split ("&quot;").join ("\"")
			.split ("&apos;").join ("'")
			.split ("&amp;").join ("&"));
		}
	
	function xmlDisplayName (theName) { //strip the "NNNNN\t" ordering prefix
		const ixTab = String (theName).indexOf ("\t");
		if (ixTab === -1) {
			return (String (theName));
			}
		return (String (theName).slice (ixTab + 1));
		}
	
	function xmlNumberedName (theCounter, theName) {
		var counterText = String (theCounter);
		while (counterText.length < 5) {
			counterText = "0" + counterText;
			}
		return (counterText + "\t" + theName);
		}
	
	function xmlCompileText (theText) {
		
		/*  A small well-formed-XML parser, enough for the documents Manila
			writes for itself: elements, attributes, pcdata, comments and
			processing instructions skipped.  */
		
		var ix = 0;
		var counter = 0;
		
		function skipUntil (theMarker) {
			const ixFound = theText.indexOf (theMarker, ix);
			ix = (ixFound === -1) ? theText.length : ixFound + theMarker.length;
			}
		
		function parseElement () { //ix is at "<" of an open tag; returns {name, table}
			
			/*  8/4/26 by CC -- the tag ends at the first ">" OUTSIDE quotes:
				attribute values legally carry raw ">" (Frontier's encoder leaves
				it raw), so indexOf would cut the tag mid-attribute.  */
			
			var ixScanEnd = ix + 1;
			var flInQuote = false;
			while (ixScanEnd < theText.length) {
				const ch = theText.charAt (ixScanEnd);
				if (ch === "\"") {
					flInQuote = !flInQuote;
					}
				if ((ch === ">") && !flInQuote) {
					break;
					}
				ixScanEnd++;
				}
			const ixEnd = ixScanEnd;
			var tagText = theText.slice (ix + 1, ixEnd);
			const flSelfClosing = tagText.endsWith ("/");
			if (flSelfClosing) {
				tagText = tagText.slice (0, tagText.length - 1);
				}
			ix = ixEnd + 1;
			
			const nameMatch = tagText.match (/^[^\s]+/);
			const elementName = nameMatch [0];
			const theTable = {};
			
			const attsPattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
			var attsMatch;
			const atts = {};
			var ctAtts = 0;
			while ((attsMatch = attsPattern.exec (tagText)) !== null) {
				atts [attsMatch [1]] = attsMatch [2]; //9/29/26 by CC -- AS WRITTEN, entities and all: the kernel's getnexttoken (langxml.c) reads an attribute value straight into the atts table and decodes only pcdata; the glue decodes attributes itself (html.directory.getRawHtml, op.xmlToOutline). Decoding here too decoded twice, and a build of concord.js from Atlantis turned '&lt;' into '<' -- DW's 9/28 report.
				ctAtts++;
				}
			if (ctAtts > 0) {
				theTable ["/atts"] = atts;
				}
			
			if (flSelfClosing) {
				return ({name: elementName, table: theTable});
				}
			
			var pcdata = "";
			while (ix < theText.length) {
				if (theText.charAt (ix) === "<") {
					if (theText.slice (ix, ix + 4) === "<!--") {
						skipUntil ("-->");
						continue;
						}
					if (theText.slice (ix, ix + 9).toLowerCase () === "<![cdata[") {
						const ixCdataEnd = theText.indexOf ("]]>", ix);
						pcdata += theText.slice (ix + 9, ixCdataEnd);
						ix = ixCdataEnd + 3;
						continue;
						}
					if (theText.charAt (ix + 1) === "/") { //our close tag
						skipUntil (">");
						break;
						}
					if ((theText.charAt (ix + 1) === "?") || (theText.charAt (ix + 1) === "!")) {
						skipUntil (">");
						continue;
						}
					counter++;
					const child = parseElement ();
					theTable [xmlNumberedName (counter, child.name)] = child.table;
					continue;
					}
				pcdata += theText.charAt (ix);
				ix++;
				}
			if (pcdata.trim ().length > 0) {
				theTable ["/pcdata"] = xmlEntityDecode (pcdata.trim ());
				}
			return ({name: elementName, table: theTable});
			}
		
		/*  Walk the prolog to the root element. 8/4/26 by CC: processing
			instructions are CAPTURED as entries, the way Frontier's xml.compile
			stores them -- "?xml" with the attributes as plain entries -- so a
			structure round-trips through decompile with its declaration.
			Comments and doctypes are still skipped.  */
		
		const thePis = [];
		while (ix < theText.length) {
			if (theText.charAt (ix) === "<") {
				if (theText.charAt (ix + 1) === "?") {
					const ixEnd = theText.indexOf (">", ix);
					var piText = theText.slice (ix + 2, (ixEnd === -1) ? theText.length : ixEnd);
					if (piText.endsWith ("?")) {
						piText = piText.slice (0, piText.length - 1);
						}
					const piName = (piText.match (/^[^\s]*/)) [0];
					const piTable = {};
					const piAttsPattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
					var piMatch;
					while ((piMatch = piAttsPattern.exec (piText)) !== null) {
						piTable [piMatch [1]] = xmlEntityDecode (piMatch [2]);
						}
					if (piName.length > 0) {
						thePis.push ({name: "?" + piName, table: piTable});
						}
					ix = (ixEnd === -1) ? theText.length : ixEnd + 1;
					continue;
					}
				if (theText.charAt (ix + 1) === "!") {
					skipUntil (">");
					continue;
					}
				break;
				}
			ix++;
			}
		if (ix >= theText.length) {
			if (theText.trim ().length === 0) {
				return ({}); //nothing to compile: an empty structure, which the callers' emptiness guards understand
				}
			const message = "Can't compile the XML because no root element was found in \"" + theText.slice (0, 80) + "\".";
			throw new Error (message);
			}
		const compiled = {};
		thePis.forEach (function (pi) {
			counter++;
			compiled [xmlNumberedName (counter, pi.name)] = pi.table;
			});
		counter++;
		const root = parseElement ();
		compiled [xmlNumberedName (counter, root.name)] = root.table;
		return (compiled);
		}
	
	verbs ["xml.compile"] = function (args) {
		const compiled = xmlCompileText (String (args [0]));
		const theAddress = args [1];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theAddress.reference.set (compiled);
			return (true);
			}
		return (compiled);
		};
	
	verbs ["xml.converttodisplayname"] = function (args) {
		return (xmlDisplayName (args [0]));
		};
	
	verbs ["xml.entityencode"] = function (args) {

		/*  9/26/26 by CC -- KERNELIZED, the glue's rule exactly (DW's
			xml.entityEncode, 11/14/2000 through 12/4/10): every character
			past 127 becomes a numeric reference, always; with flAlphaEntities
			true, & first (so a reference's own & isn't touched) and then <, >
			and " become their names. One difference, the reason it's here: a
			character that isn't one byte -- an emoji -- is two characters to
			JavaScript, and the glue wrote a reference for each half, 55357 and
			56911, which XML rejects: DW's 9/26 report on masto.feediverse.org
			and bluesky.feediverse.org. The reference is the character's code
			POINT, the number XML wants.  */

		var s = String (args [0]);
		const flAlphaEntities = (args [1] === true);
		if (flAlphaEntities) {
			s = s.split ("&").join ("&amp;");
			}
		var theResult = "";
		var ix = 0;
		while (ix < s.length) {
			const theCode = s.codePointAt (ix);
			const ctUnits = (theCode > 0xFFFF) ? 2 : 1;
			if (theCode >= 128) {
				theResult += "&#" + theCode + ";";
				}
			else {
				theResult += s.substr (ix, ctUnits);
				}
			ix += ctUnits;
			}
		s = theResult;
		if (flAlphaEntities) {
			s = s.split ("<").join ("&lt;").split (">").join ("&gt;").split ("\"").join ("&quot;");
			}
		return (s);
		};
	
	verbs ["xml.entitydecode"] = function (args) {
		return (xmlEntityDecode (args [0]));
		};
	
	function xmlChildEntry (theTable, theName) { //find a child element by display name, case-insensitive
		const lowerName = String (theName).toLowerCase ();
		var foundKey;
		Object.keys (theTable).forEach (function (key) {
			if ((foundKey === undefined) && (xmlDisplayName (key).toLowerCase () === lowerName)) {
				foundKey = key;
				}
			});
		return (foundKey);
		}
	
	verbs ["xml.getaddress"] = function (args) { //xml.getAddress (@struct, name) -> address of the named child element
		const theAddress = args [0];
		const theName = String (args [1]);
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't get the XML address because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theTable = theAddress.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			const message = "Can't get the XML address of " + theName + " because the structure can't be reached.";
			throw new Error (message);
			}
		const foundKey = xmlChildEntry (theTable, theName);
		if (foundKey === undefined) {
			const message = "Can't get the XML address of " + theName + " because there is no element with that name.";
			throw new Error (message);
			}
		return ({
			flAddress: true,
			pathText: theAddress.pathText + ".[\"" + foundKey + "\"]",
			reference: {
				get: function () {
					return (theTable [foundKey]);
					},
				set: function (theValue) {
					theTable [foundKey] = theValue;
					},
				remove: function () {
					delete theTable [foundKey];
					}
				}
			});
		};
	
	verbs ["xml.getaddresslist"] = function (args) { //every child element with that name, as addresses
		const theAddress = args [0];
		const theName = String (args [1]).toLowerCase ();
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't get the XML address list because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theTable = theAddress.reference.get ();
		const result = [];
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			return (result);
			}
		Object.keys (theTable).forEach (function (key) {
			if (xmlDisplayName (key).toLowerCase () !== theName) {
				return;
				}
			result.push ({
				flAddress: true,
				pathText: theAddress.pathText + ".[\"" + key + "\"]",
				reference: {
					get: function () {
						return (theTable [key]);
						},
					set: function (theValue) {
						theTable [key] = theValue;
						},
					remove: function () {
						delete theTable [key];
						}
					}
				});
			});
		return (result);
		};
	
	verbs ["xml.getvalue"] = function (args) { //xml.getValue (@struct, name) -> the named child's pcdata, its /contents, or the element itself

		/*  9/7/26 by CC -- THE KERNEL'S RULE (langxml.c, xmlgetvalueverb): when
			the element is a table, answer its /pcdata; failing that its
			/contents; failing that THE TABLE ITSELF. Ours answered "" for an
			element with no text, so betty.rpc.client -- which asks for the
			"value" element of a method response and then tests
			typeOf (returnedValue) == tableType to decode <string>, <int> and
			the rest -- got an empty string from every server, and the remote
			call form ["xmlrpc://..."].a.b () answered nothing.  */

		const childAddress = verbs ["xml.getaddress"] (args);
		const childTable = childAddress.reference.get ();
		if ((childTable !== null) && (typeof childTable === "object")) {
			if (childTable ["/pcdata"] !== undefined) {
				return (childTable ["/pcdata"]);
				}
			if (childTable ["/contents"] !== undefined) {
				return (childTable ["/contents"]);
				}

			/*  9/21/26 by CC -- AN EMPTY ELEMENT IS THE EMPTY STRING. The kernel's
				xml.compile (assignemptytag) stores an empty element with no
				attributes as "" and one with attributes as a table whose /pcdata
				is ""; this verb answers "" for both. Every element is a table
				here, so an element with nothing in it but its attributes is that
				case. A new Manila site's first news item has <url></url>, and
				manilaSuite.news.xmlToTable got a table for it.  */

			var flHoldsElements = false;
			tableNames (childTable).forEach (function (theName) {
				if (theName.charAt (0) !== "/") {
					flHoldsElements = true;
					}
				});
			if (!flHoldsElements) {
				return ("");
				}
			return (childTable);
			}
		return (String (childTable));
		};
	
	verbs ["xml.getattribute"] = function (args) { //the ADDRESS of an attribute -- callers dereference it
		const theAddress = args [0];
		const theName = String (args [1]);
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't get the XML attribute because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theTable = theAddress.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object") || (theTable ["/atts"] === undefined)) {
			const message = "Can't get the XML attribute " + theName + " because the element has no attributes.";
			throw new Error (message);
			}
		const atts = theTable ["/atts"];
		var foundKey;
		Object.keys (atts).forEach (function (key) {
			if ((foundKey === undefined) && (key.toLowerCase () === theName.toLowerCase ())) {
				foundKey = key;
				}
			});
		if (foundKey === undefined) {
			const message = "Can't get the XML attribute " + theName + " because there is no attribute with that name.";
			throw new Error (message);
			}
		return ({
			flAddress: true,
			pathText: theAddress.pathText + ".[\"/atts\"].[\"" + foundKey + "\"]",
			reference: {
				get: function () {
					return (atts [foundKey]);
					},
				set: function (theValue) {
					atts [foundKey] = theValue;
					},
				remove: function () {
					delete atts [foundKey];
					}
				}
			});
		};
	
	verbs ["xml.getattributevalue"] = function (args) { //xml.getAttributeValue (@element, name)
		const theAddress = args [0];
		const theName = String (args [1]);
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't get the XML attribute because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theTable = theAddress.reference.get ();
		if ((theTable !== undefined) && (theTable !== null) && (typeof theTable === "object") && (theTable ["/atts"] !== undefined)) {
			const atts = theTable ["/atts"];
			var found;
			Object.keys (atts).forEach (function (key) {
				if ((found === undefined) && (key.toLowerCase () === theName.toLowerCase ())) {
					found = atts [key];
					}
				});
			if (found !== undefined) {
				return (found);
				}
			}
		const message = "Can't get the XML attribute " + theName + " because there is no attribute with that name.";
		throw new Error (message);
		};
	
	verbs ["xml.addtable"] = function (args) { //xml.addTable (@struct, name) -> address of a new numbered child table
		const theAddress = args [0];
		const theName = String (args [1]);
		if ((theAddress === undefined) || (theAddress.flAddress !== true)) {
			const message = "Can't add the XML table because the first parameter isn't an address.";
			throw new Error (message);
			}
		var theTable = theAddress.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			theAddress.reference.set ({});
			theTable = theAddress.reference.get ();
			}
		const newKey = xmlNumberedName (Object.keys (theTable).length + 1, theName);
		theTable [newKey] = {};
		return ({
			flAddress: true,
			pathText: theAddress.pathText + ".[\"" + newKey + "\"]",
			reference: {
				get: function () {
					return (theTable [newKey]);
					},
				set: function (theValue) {
					theTable [newKey] = theValue;
					},
				remove: function () {
					delete theTable [newKey];
					}
				}
			});
		};
	
	verbs ["xml.addvalue"] = function (args) { //xml.addValue (@struct, name, value)
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			return (true); //a nil debug log just swallows the value
			}
		const theName = String (args [1]);
		var theTable = theAddress.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			theAddress.reference.set ({});
			theTable = theAddress.reference.get ();
			}
		theTable [xmlNumberedName (Object.keys (theTable).length + 1, theName)] = args [2];
		return (true);
		};
	
	function xmlDecompileTable (theTable, theIndent) {
		var result = "";
		Object.keys (theTable).forEach (function (key) {
			if ((key === "/atts") || (key === "/pcdata")) {
				return;
				}
			const child = theTable [key];
			const elementName = xmlDisplayName (key);
			if (elementName.startsWith ("?")) {
				
				/*  8/4/26 by CC -- a processing instruction, the way Frontier's
					xml.compile stores one: the entries are its attributes, in
					table order. The shell struct's ?xml entry emits as
					<?xml encoding="..." version="..."?> -- the attribute order
					nodeEditorSuite.fixBuggyXml exists to correct, so the desktop
					pipeline behaves identically here.  */
				
				var piText = "<" + elementName;
				if ((child !== null) && (typeof child === "object")) {
					Object.keys (child).forEach (function (attName) {
						if ((attName !== "/atts") && (attName !== "/pcdata")) {
							piText += " " + attName + "=\"" + xmlEntityEncode (child [attName]) + "\"";
							}
						});
					}
				result += theIndent + piText + "?>\r\n";
				return;
				}
			var attsText = "";
			if ((child !== null) && (typeof child === "object") && (child ["/atts"] !== undefined)) {
				Object.keys (child ["/atts"]).forEach (function (attName) {
					attsText += " " + attName + "=\"" + child ["/atts"] [attName] + "\""; //9/29/26 by CC -- as stored, the way the compiler keeps them: decompilespecialtable (langxml.c) writes attribute values without encoding
					});
				}
			if ((child !== null) && (typeof child === "object")) {
				const inner = xmlDecompileTable (child, theIndent + "\t");
				const pcdata = (child ["/pcdata"] === undefined) ? "" : xmlEntityEncode (child ["/pcdata"]);
				if ((inner.length === 0) && (pcdata.length === 0)) {
					result += theIndent + "<" + elementName + attsText + " />\r\n";
					}
				else {
					if (inner.length === 0) {
						result += theIndent + "<" + elementName + attsText + ">" + pcdata + "</" + elementName + ">\r\n";
						}
					else {
						result += theIndent + "<" + elementName + attsText + ">\r\n" + inner + theIndent + "</" + elementName + ">\r\n";
						}
					}
				}
			else {
				result += theIndent + "<" + elementName + attsText + ">" + xmlEntityEncode (child) + "</" + elementName + ">\r\n";
				}
			});
		return (result);
		}
	
	verbs ["xml.decompile"] = function (args) {
		const theAddress = args [0];
		var theTable = theAddress;
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theTable = theAddress.reference.get ();
			}
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			const message = "Can't decompile the XML because the structure can't be reached.";
			throw new Error (message);
			}
		var flHasPi = false; //8/4/26 by CC -- a structure carrying its own ?xml entry supplies the declaration
		Object.keys (theTable).forEach (function (key) {
			if (xmlDisplayName (key).startsWith ("?")) {
				flHasPi = true;
				}
			});
		if (flHasPi) {
			return (xmlDecompileTable (theTable, ""));
			}
		return ("<?xml version=\"1.0\"?>\r\n" + xmlDecompileTable (theTable, ""));
		};
	
	verbs ["xml.opml.getbodyaddress"] = function (args) {
		
		/*  8/4/26 by CC -- the address of the body element inside a compiled
			OPML document: the opml element's body child, found the same way
			xml.getAddress finds any child.  */
		
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			const message = "Can't get the body address because the parameter isn't the address of a compiled XML structure.";
			throw new Error (message);
			}
		const opmlAddress = verbs ["xml.getaddress"] ([theAddress, "opml"]);
		return (verbs ["xml.getaddress"] ([opmlAddress, "body"]));
		};
	
	verbs ["op.getrefcon"] = function (args) {

		/*  8/26/26 by CC -- opgetrefconverb, Common/source/opverbs.c: the
			cursor line's refcon, and "if (hrefcon == nil) setlongvalue (0)"
			-- a line that never had one answers the long 0. Our lines don't
			carry refcons at all, so 0 is the kernel's own answer for every
			line here. DW's ruling 8/26: that one answer unblocks
			op.outlineToXml, whose glue reads the refcon on every line.  */

		return (0);
		};

	verbs ["op.outlinetoxml"] = function (args, environment) {
	
		/*  8/17/26 by CC -- the head is real now. Frontier's glue (213 lines)
			preserves the outline's own facts in the <head>: the title, when it
			was created and last changed, who owns it, the expansion state, the
			scroll state and the window's size and position -- and it puts an
			XML comment above the <opml> saying what wrote the file. Ours wrote
			a title and nothing else, so an outline that went out through OPML
			and came back had lost every one of those.
			
			Parameters are the glue's: outlineToXml (adrOutline, ownerName,
			ownerEmail, adrCloud, version, ownerId). The two prefs it reads
			answer their Frontier defaults when the database doesn't have
			them: flGenerateOpml2 false, flOpmlAddLinefeeds true.  */
		
		var theValue = args [0];
		var theTitle = "outline";
		var theAddress;
		if ((theValue !== undefined) && (theValue !== null) && (theValue.flAddress === true)) {
			theAddress = theValue;
			const parts = theValue.pathText.split (".");
			theTitle = parts [parts.length - 1];
			theValue = theValue.reference.get ();
			}
		if ((theValue === undefined) || (theValue === null) || (!Array.isArray (theValue.lines))) {
			const message = "Can't convert the outline to XML because the value isn't an outline or a script.";
			throw new Error (message);
			}
		
		function prefValue (theName, theDefault) {
			const theUser = ((environment === undefined) || (environment.odb === undefined)) ? undefined : environment.odb.user;
			if ((theUser === undefined) || (theUser === null) || (theUser.prefs === undefined) || (theUser.prefs === null)) {
				return (theDefault);
				}
			var theAnswer = theDefault;
			Object.keys (theUser.prefs).forEach (function (theKey) {
				if (theKey.toLowerCase () === theName.toLowerCase ()) {
					theAnswer = theUser.prefs [theKey];
					}
				});
			return (theAnswer);
			}
		
		/*  8/26/26 by CC -- THE KERNEL'S OUTPUT, NOTHING MORE. This verb had
			been doing the GLUE's whole job -- the generator comment, the
			2.0 version, ownerId, the \r\n doubling. But the glue in the
			database (op.outlineToXml, 223 lines) does all of that itself to
			whatever the kernel returns, by position: it replaces the SECOND
			LINE with the 2.0 <opml> element and inserts the comment before
			"<opml ". With our extras in the way, the second line was the
			comment, and the glue's surgery produced a doubled <opml> tag.
			opoutlinetoxml (opxml.c) writes: the xml header, then
			<opml version="1.1">, head, body, </opml>, every line ending
			in \r, no comment, always ownerEmail. So do we now.  */

		const ownerName = (args [1] === undefined) ? String (prefValue ("name", "")) : String (args [1]);
		const ownerEmail = (args [2] === undefined) ? String (prefValue ("mailAddress", "")) : String (args [2]);

		/*  The dates the outline itself carries. An outline that has never
			been written through a window has none, and then the answer is
			now -- which is what a brand new outline's dates are anyway.  */

		const whenCreated = ((theValue.whenCreated === undefined) ? new Date () : new Date (theValue.whenCreated));
		const whenModified = ((theValue.whenModified === undefined) ? new Date () : new Date (theValue.whenModified));

		var theText = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\r";
		theText += "<opml version=\"1.1\">\r";
		theText += "\t<head>\r";
		theText += "\t\t<title>" + xmlEntityEncode (theTitle) + "</title>\r";
		theText += "\t\t<dateCreated>" + verbs ["date.netstandardstring"] ([whenCreated]) + "</dateCreated>\r";
		theText += "\t\t<dateModified>" + verbs ["date.netstandardstring"] ([whenModified]) + "</dateModified>\r";
		theText += "\t\t<ownerName>" + xmlEntityEncode (ownerName) + "</ownerName>\r";
		theText += "\t\t<ownerEmail>" + xmlEntityEncode (ownerEmail) + "</ownerEmail>\r";
		
		/*  Expansion state: the line numbers of the expanded lines that have
			subs, counting from 1, the way the kernel writes the list.  */
		
		const theExpanded = [];
		theValue.lines.forEach (function (theLine, ixLine) {
			const theNext = theValue.lines [ixLine + 1];
			const flHasSubs = ((theNext !== undefined) && (theNext.level > theLine.level));
			if (flHasSubs && (theLine.flExpanded === true)) {
				theExpanded.push (ixLine + 1);
				}
			});
		theText += "\t\t<expansionState>" + theExpanded.join (",") + "</expansionState>\r";
		theText += "\t\t<vertScrollState>" + ((theValue.vertScrollState === undefined) ? 1 : theValue.vertScrollState) + "</vertScrollState>\r";
		const theWindow = ((theValue.windowRect === undefined) ? {top: 61, left: 105, bottom: 661, right: 761} : theValue.windowRect);
		theText += "\t\t<windowTop>" + theWindow.top + "</windowTop>\r";
		theText += "\t\t<windowLeft>" + theWindow.left + "</windowLeft>\r";
		theText += "\t\t<windowBottom>" + theWindow.bottom + "</windowBottom>\r";
		theText += "\t\t<windowRight>" + theWindow.right + "</windowRight>\r";
		theText += "\t\t</head>\r";
		theText += "\t<body>\r";
		
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
			theText += indent (openLevels.length + 2) + "</outline>\r";
			}
		theValue.lines.forEach (function (line) {
			if ((line !== null) && (typeof line === "object") && (typeof line.text === "string")) {
				const theLevel = Math.min (Math.max (Number (line.level) || 0, 0), 100);
				while ((openLevels.length > 0) && (openLevels [openLevels.length - 1] >= theLevel)) {
					closeOne ();
					}
				theText += indent (openLevels.length + 2) + "<outline text=\"" + opXmlEncodeText (line.text) + "\"" + ((line.flComment) ? " isComment=\"true\"" : "") + ">\r";
				openLevels.push (theLevel);
				}
			});
		while (openLevels.length > 0) {
			closeOne ();
			}
		theText += "\t\t</body>\r";
		theText += "\t</opml>\r";
		return (theText);
		};
	
	verbs ["html.directory.getrawhtml"] = function (args) {
		
		/*  8/4/26 by CC -- the renderer at the heart of uploadScripts, as a
			verb, shadowing the database's 2012 two-param copy (hard tabs, \r\n,
			no comment filter -- rendering comment nodes into output files).
			The desktop's current version honors the parameters; its semantics
			were verified byte-for-byte against Dave's deployed renders (7/23):
			one line per node, a tab per depth level when flIndent, line ends
			"\n" times ctLineEnds, comment nodes skipped unless
			flIncludeComments. args [2] (ignore # directives) and args [4]
			(lineEndChars) are accepted and unused -- the verified renders
			use "\n".  */
		
		const adrNode = args [0];
		const adrText = args [1];
		const ctLineEnds = (args [3] === undefined) ? 1 : Number (args [3]);
		const flIndent = (args [5] === undefined) ? true : Boolean (args [5]);
		const flIncludeComments = (args [6] === undefined) ? false : Boolean (args [6]);
		if ((adrNode === undefined) || (adrNode === null) || (adrNode.flAddress !== true)) {
			const message = "Can't render the node because the first parameter isn't an address.";
			throw new Error (message);
			}
		if ((adrText === undefined) || (adrText === null) || (adrText.flAddress !== true)) {
			const message = "Can't render the node because the second parameter isn't the address to answer through.";
			throw new Error (message);
			}
		const theTable = adrNode.reference.get ();
		if ((theTable === undefined) || (theTable === null) || (typeof theTable !== "object")) {
			const message = "Can't render the node because there is no element at the address.";
			throw new Error (message);
			}
		
		var htmltext = "";
		var lineEnd = "";
		var ctEnds = ctLineEnds;
		while (ctEnds > 0) {
			lineEnd += "\n";
			ctEnds--;
			}
		function doLevel (levelTable, depth) {
			Object.keys (levelTable).forEach (function (key) {
				if ((key === "/atts") || (key === "/pcdata")) {
					return;
					}
				if (!xmlDisplayName (key).toLowerCase ().endsWith ("outline")) {
					return;
					}
				const child = levelTable [key];
				if ((child === null) || (typeof child !== "object")) {
					return;
					}
				const atts = (child ["/atts"] === undefined) ? {} : child ["/atts"];
				if ((atts.isComment === "true") && !flIncludeComments) {
					return;
					}
				var theLine = (atts.text === undefined) ? "" : String (atts.text);
				if (flIndent) {
					var tabs = "";
					var ctTabs = depth;
					while (ctTabs > 0) {
						tabs += "\t";
						ctTabs--;
						}
					theLine = tabs + theLine;
					}
				htmltext += theLine + lineEnd;
				doLevel (child, depth + 1);
				});
			}
		doLevel (theTable, 0);
		adrText.reference.set (htmltext);
		return (true);
		};
	
	//the folder helpers resolve from the path map so folder math works end-to-end
	
	/*  8/7/26 by CC -- these install ONLY when the path map supplies a
		value. They used to install unconditionally, which meant the real
		scripts at these addresses in the database NEVER ran: DW edited
		nodeEditorSuite.getAllServersFolder and his change had no effect,
		because the helper shadowed it. With no helper configured, the verb
		isn't registered, and the call falls through to the script.  */
	
	if (thePathMap.helpers.getFolder !== undefined) {
		verbs ["nodeeditorsuite.getfolder"] = function (args) {
			return (thePathMap.helpers.getFolder);
			};
		}
	
	if (thePathMap.helpers.getAllServersFolder !== undefined) {
		verbs ["nodeeditorsuite.getallserversfolder"] = function (args) {
			return (thePathMap.helpers.getAllServersFolder);
			};
		}
	
	if (thePathMap.helpers.getGitHubFolder !== undefined) {
		verbs ["nodeeditorsuite.getgithubfolder"] = function (args) {
			return (thePathMap.helpers.getGitHubFolder);
			};
		}
	

/*  The file verbs, 8/17/26 by CC -- DW counted the gap: the kernel has 86
	file verbs and we had 12. What follows is the rest of the ones a person
	writing scripts today would reach for, matched to what the kernel does
	(Common/source/fileverbs.c). His two rulings on the remainder: the
	readLine/writeLine pair goes aside ("we don't do things that way very
	often now"), and so does everything about volumes ("i don't know what a
	volume is today") -- those, and the dead Mac-desktop verbs, answer
	"isn't implemented yet" rather than pretending.  */
	
	function fileDateOf (theColonPath, whichDate) {
		const theStats = fs.statSync (macToReal (theColonPath));
		return ((whichDate === "created") ? theStats.birthtime : theStats.mtime);
		}
	
	/*  8/20/26 by CC -- three that the Mac file system answered and this one
		can't. There is no resource fork to read a version out of and no
		four-character type on a file, so they answer the empty string --
		which is what a script gets when it asks a file that never had one.
		getSystemDisk is the volume everything hangs off, which on this side
		is the one volume there is.  */
	
	verbs ["file.getversion"] = function (args) {
		return ("");
		};
	
	verbs ["file.type"] = function (args) { //9/7/26 by CC -- the real Finder type, the way file.creator reads it since 9/1; this answered "" for every file, so table.inGuestDatabase (which asks for 'TABL' and 'LAND' on a Mac) could never say true, and DW's backupFrontRoot could not tell a Tool's window from the root's
		return (readFinderInfo (macToReal (args [0])).toString ("latin1", 0, 4));
		};
	
	verbs ["file.getsystemdisk"] = function (args) {
		return ("Macintosh HD:");
		};
	
	verbs ["file.size"] = function (args) { //the kernel answers the data fork's length; on this side a file has one fork
		return (fs.statSync (macToReal (args [0])).size);
		};
	
	verbs ["file.created"] = function (args) {
		return (fileDateOf (args [0], "created"));
		};
	
	verbs ["file.setcreated"] = function (args) {
		const thePath = macToReal (args [0]);
		const theDate = new Date (args [1]);
		fs.utimesSync (thePath, theDate, fs.statSync (thePath).mtime); //node can't set birthtime; the access time is the closest the platform allows
		return (true);
		};
	
	verbs ["file.setmodified"] = function (args) {
		const thePath = macToReal (args [0]);
		const theDate = new Date (args [1]);
		fs.utimesSync (thePath, fs.statSync (thePath).atime, theDate);
		return (true);
		};

	/*  9/1/26 by CC -- TYPE AND CREATOR, for real. DW's fire alarm: Export
		cursor part stopped with "Can't call file.settype because it isn't
		implemented yet." The command hadn't changed -- the ENVIRONMENT had:
		file.writeWholeFile's glue guards its setType call with `if
		system.environment.isMac`, which answered false until the truthful
		environment table landed 8/27, so the branch never ran. Now it runs,
		and the verbs are real: the type and creator live where the Mac has
		kept them since HFS died -- the first eight bytes of the
		com.apple.FinderInfo extended attribute, type then creator. The
		Finder still reads them; so does file.creator below.  */

	function readFinderInfo (thePath) { //the 32 bytes, zeros when the file has none
		try {
			const theHex = execFileSync ("xattr", ["-px", "com.apple.FinderInfo", thePath], {encoding: "utf8", stdio: ["pipe", "pipe", "ignore"]}); //a file with no FinderInfo is normal, not something to log
			const theBytes = Buffer.from (theHex.replace (/[^0-9A-Fa-f]/g, ""), "hex");
			if (theBytes.length === 32) {
				return (theBytes);
				}
			}
		catch (err) {
			}
		return (Buffer.alloc (32));
		}

	function writeFinderInfo (thePath, theBytes) {
		execFileSync ("xattr", ["-wx", "com.apple.FinderInfo", theBytes.toString ("hex"), thePath]);
		}

	function fourCharCode (theValue) { //a type code is exactly four characters, space-padded the way string4s are
		return ((String (theValue) + "    ").slice (0, 4));
		}

	verbs ["file.settype"] = function (args) {
		const thePath = macToReal (args [0]);
		const theInfo = readFinderInfo (thePath);
		theInfo.write (fourCharCode (args [1]), 0, 4, "latin1");
		writeFinderInfo (thePath, theInfo);
		return (true);
		};

	verbs ["file.setcreator"] = function (args) {
		const thePath = macToReal (args [0]);
		const theInfo = readFinderInfo (thePath);
		theInfo.write (fourCharCode (args [1]), 4, 4, "latin1");
		writeFinderInfo (thePath, theInfo);
		return (true);
		};

	verbs ["file.creator"] = function (args) {
		return (readFinderInfo (macToReal (args [0])).toString ("latin1", 4, 8));
		};

	verbs ["file.type"] = function (args) {
		return (readFinderInfo (macToReal (args [0])).toString ("latin1", 0, 4));
		};

	/*  9/2/26 by CC -- launch.anything, filelaunchanythingverb in
		fileverbs.c: LSOpenFSRef on the path -- the Finder opens the file
		with whatever opens it, or opens the folder, or launches the app.
		The Mac's open command is the same call from the shell. DW's 9/2
		fire: his Export cursor part ends with file.openFolder (theFolder),
		whose Mac branch is launch.anything, and the export stopped on the
		missing verb one line after the setType fix got it past setType.  */

	verbs ["launch.anything"] = function (args) {
		const thePath = macToReal (args [0]);
		if (!fs.existsSync (thePath)) {
			const message = "Can't launch " + String (args [0]) + " because there is no file or folder at that path.";
			throw new Error (message);
			}
		execFileSync ("open", [thePath]);
		return (true);
		};
	
	verbs ["window.getfile"] = function (args) { //9/4/26 by CC -- getfileverb in shellwindowverbs.c: the path of the database file the object lives in. One database here, frontier.root, beside the app; Add Bookmark reaches it (the 9/4 menu sweep)

		/*  9/12/26 by CC -- THE ROOT'S WINDOW HAS THE FILE, ITS OBJECTS' WINDOWS
			DON'T. getfileverb answers windowgetfspec of the object's window,
			and only the root window of a database carries an fspec
			(shellwindow.c); a table or script window inside it answers the
			empty string. This answered the root file for EVERY address, so
			bookmarksMenu.add took its file branch for every object -- "f !=
			''" -- and Add Bookmark made a bookmark that opened frontier.root
			instead of the object (DW's 9/12 report: the Bookmarks menu does
			nothing). The root's address, or the name "root" that
			string.parseAddress (@root) [1] answers (rootUpdates.update asks
			that way), or a guest database's bracketed path alone, answers
			the file; anything under them answers "".  */

		const theParam = args [0];
		var theText = "";
		if ((theParam !== undefined) && (theParam !== null)) {
			theText = (theParam.flAddress === true) ? String (theParam.pathText) : String (theParam);
			}
		theText = theText.trim ();
		if ((theText.length === 0) || (theText.toLowerCase () === "root")) {
			return (verbs ["frontier.getfilepath"] ([]));
			}
		const guestRoot = theText.match (/^\["([^"]+)"\]$/); //a guest database's root is addressed by its file
		if (guestRoot !== null) {
			return (guestRoot [1]);
			}
		return ("");
		};

	verbs ["launch.application"] = function (args) { //9/4/26 by CC -- launchapplication in launch.c: the application by name (or path) comes forward; open -a is the Mac's way. Server setup and Set startup outline reach it through webBrowser.openUrl (the 9/4 menu sweep)
		const theName = String (args [0]);
		try {
			if (theName.indexOf (":") !== -1) {
				execFileSync ("open", [macToReal (theName)]);
				}
			else {
				execFileSync ("open", ["-a", theName]);
				}
			}
		catch (err) {
			const message = "Can't launch " + theName + " because " + err.message.split ("\n") [0] + ".";
			throw new Error (message);
			}
		return (true);
		};

	verbs ["launch.appwithdocument"] = function (args) { //9/14/26 by CC -- launchappwithdocument in launch.c: the application opens the document; open -a app doc is the Mac's way. webBrowser.launch reaches it on Windows only; here it is the same door as launch.application
		const theApp = String (args [0]);
		const theDoc = ((args [1] === undefined) || (args [1] === null)) ? "" : String (args [1]);
		const openArgs = (theApp.indexOf (":") !== -1) ? ["-a", macToReal (theApp)] : ["-a", theApp];
		if (theDoc.length > 0) {
			openArgs.push (macToReal (theDoc));
			}
		try {
			execFileSync ("open", openArgs, {stdio: ["ignore", "pipe", "pipe"]});
			}
		catch (err) {
			const message = "Can't launch " + theApp + ((theDoc.length > 0) ? " with " + theDoc : "") + " because " + err.message.split ("\n") [0] + ".";
			throw new Error (message);
			}
		return (true);
		};

	verbs ["searchengine.stripmarkup"] = function (args) { //9/4/26 by CC -- searchenginestripmarkup: the text with every <tag> removed; HTML > Strip Markup reaches it (the 9/4 menu sweep)
		return (String (args [0]).replace (/<[^>]*>/g, ""));
		};

	verbs ["file.move"] = function (args) { //the kernel's move: same name, new folder
		const theSource = macToReal (args [0]);
		var theDest = macToReal (args [1]);
		if (fs.existsSync (theDest) && fs.statSync (theDest).isDirectory ()) {
			theDest = path.join (theDest, path.basename (theSource));
			}
		fs.renameSync (theSource, theDest);
		return (true);
		};
	
	verbs ["file.fullpath"] = function (args) { //a filespec knows its whole path; ours already are whole paths
		return (String (args [0]));
		};
	
	verbs ["file.getpath"] = verbs ["file.fullpath"];
	
	verbs ["file.setpath"] = function (args) { //aim a filespec at a different path
		return (verbs ["lang.filespec"] ([String (args [1])]));
		};
	
	verbs ["file.getposixpath"] = function (args) { //the colon path as the machine underneath spells it
	
		/*  The boot disk is reached at /Volumes/Macintosh HD, which is a
			symlink to /, so the raw mapping answers a path that works but
			isn't what anyone would type. Resolve it when the file is really
			there.  */
		
		const thePath = macToReal (args [0]);
		if (fs.existsSync (thePath)) {
			return (fs.realpathSync (thePath));
			}
		return (thePath);
		};
	
	verbs ["file.getsystemfolderpath"] = function (args) {
		return ("Macintosh HD:System:");
		};
	
	verbs ["file.getspecialfolderpath"] = function (args) {
	
		/*  The kernel takes a folder id and answers where it is. The ids that
			still name a real place on this machine answer; the rest say so.  */
		
		const theId = String (args [1] === undefined ? args [0] : args [1]).toLowerCase ();
		const theHome = process.env.HOME;
		const theFolders = {
			desktop: theHome + "/Desktop",
			documents: theHome + "/Documents",
			preferences: theHome + "/Library/Preferences",
			temporary: "/tmp",
			trash: theHome + "/.Trash",
			applications: "/Applications"
			};
		var theAnswer;
		Object.keys (theFolders).forEach (function (theName) {
			if (theId.indexOf (theName) !== -1) {
				theAnswer = theFolders [theName];
				}
			});
		if (theAnswer === undefined) {
			const message = "Can't get the special folder because \"" + theId + "\" isn't a folder this machine has.";
			throw new Error (message);
			}
		return (realToColon (theAnswer) + ":");
		};
	
	verbs ["file.countlines"] = function (args) {
		const theText = fs.readFileSync (macToReal (args [0]), "latin1");
		if (theText.length === 0) {
			return (0);
			}
		return (theText.split (/\r\n|\r|\n/).length);
		};
	
	verbs ["file.compare"] = function (args) { //true when the two files hold the same bytes
		const theOne = fs.readFileSync (macToReal (args [0]));
		const theOther = fs.readFileSync (macToReal (args [1]));
		return (theOne.equals (theOther));
		};
	
	verbs ["file.findinfile"] = function (args) { //1-based position of the text in the file, 0 when it isn't there
		const theText = fs.readFileSync (macToReal (args [0]), "latin1");
		return (theText.indexOf (String (args [1])) + 1);
		};
	
	verbs ["file.isalias"] = function (args) {
		const thePath = macToReal (args [0]);
		if (!fs.existsSync (thePath)) {
			return (false);
			}
		return (fs.lstatSync (thePath).isSymbolicLink ());
		};
	
	verbs ["file.followalias"] = function (args) { //what the alias points at, as a colon path
		return (realToColon (fs.realpathSync (macToReal (args [0]))));
		};
	
	verbs ["file.newalias"] = function (args) {
		fs.symlinkSync (macToReal (args [0]), macToReal (args [1]));
		return (true);
		};
	
	verbs ["file.islocked"] = function (args) { //locked means the person who owns it can't write it
		const theMode = fs.statSync (macToReal (args [0])).mode;
		return ((theMode & 0o200) === 0);
		};
	
	verbs ["file.lock"] = function (args) {
		const thePath = macToReal (args [0]);
		fs.chmodSync (thePath, fs.statSync (thePath).mode & ~0o222);
		return (true);
		};
	
	verbs ["file.unlock"] = function (args) {
		const thePath = macToReal (args [0]);
		fs.chmodSync (thePath, fs.statSync (thePath).mode | 0o200);
		return (true);
		};
	
	verbs ["file.isvisible"] = function (args) { //a name that starts with a dot is the hidden one on this machine
		return (path.basename (macToReal (args [0])).indexOf (".") !== 0);
		};
	
	verbs ["file.setvisible"] = function (args) {
		const thePath = macToReal (args [0]);
		const theName = path.basename (thePath);
		const flVisible = (args [1] !== false);
		const flHiddenNow = (theName.indexOf (".") === 0);
		if (flVisible === !flHiddenNow) {
			return (true); //already the way the caller wants it
			}
		const theNewName = flVisible ? theName.slice (1) : ("." + theName);
		fs.renameSync (thePath, path.join (path.dirname (thePath), theNewName));
		return (true);
		};

/*  The open/read/write family -- 8/17/26 by CC. Worth having for its own
	sake, and because Frontier's readWholeFile and writeWholeFile are GLUE
	SCRIPTS built on top of these; with the family real, his own glue runs
	instead of the stand-ins we wrote. An open file is remembered by its
	path, the way the kernel remembers it, so file.open (f) / file.read (f)
	/ file.close (f) work the way every script spells them.  */
	
	verbs ["file.new"] = function (args) {
		const thePath = macToReal (args [0]);
		fs.mkdirSync (path.dirname (thePath), {recursive: true});
		fs.writeFileSync (thePath, "");
		return (true);
		};
	
	verbs ["file.open"] = function (args) {
		const thePath = macToReal (args [0]);
		if (theOpenFiles [thePath] !== undefined) {
			return (true); //already open; the kernel doesn't mind being asked twice
			}
		if (!fs.existsSync (thePath)) {
			const message = "Can't open " + args [0] + " because there is no file with that name.";
			throw new Error (message);
			}
		theOpenFiles [thePath] = {fd: fs.openSync (thePath, "r+"), position: 0};
		return (true);
		};
	
	function openFileRecord (theColonPath) {
		const thePath = macToReal (theColonPath);
		const theRecord = theOpenFiles [thePath];
		if (theRecord === undefined) {
			const message = "Can't do that with " + theColonPath + " because the file isn't open.";
			throw new Error (message);
			}
		return (theRecord);
		}
	
	verbs ["file.close"] = function (args) {
		const thePath = macToReal (args [0]);
		const theRecord = theOpenFiles [thePath];
		if (theRecord !== undefined) {
			fs.closeSync (theRecord.fd);
			delete theOpenFiles [thePath];
			}
		return (true);
		};
	
	verbs ["file.read"] = function (args) { //read n bytes from where we are; infinity means the rest of the file
		const theRecord = openFileRecord (args [0]);
		const theEnd = fs.fstatSync (theRecord.fd).size;
		var ctBytes = (args [1] === undefined) ? Infinity : Number (args [1]);
		if ((ctBytes === Infinity) || ((theRecord.position + ctBytes) > theEnd)) {
			ctBytes = theEnd - theRecord.position;
			}
		if (ctBytes <= 0) {
			return ("");
			}
		const theBuffer = Buffer.alloc (ctBytes);
		fs.readSync (theRecord.fd, theBuffer, 0, ctBytes, theRecord.position);
		theRecord.position += ctBytes;
		return (theBuffer.toString ("latin1"));
		};
	
	verbs ["file.write"] = function (args) { //write at where we are, and stay after what was written

		/*  9/20/26 by CC -- A CHARACTER THAT CAN'T BE A BYTE. A string here is a
			run of bytes, the way Frontier's is -- a GIF, a fat page, a signature
			all ride in strings -- and this wrote one byte per character. A
			curly quote typed in an outline window (U+2019) is no byte: it lost
			its high half and went out as 0x19, an ellipsis as a bare ampersand,
			a bullet as a straight quote. DW's OPML export of 9/20 would not
			open in Electric Drummer, invalid XML. His ruling, the narrow safe
			step: a string holding such a character can only be text, and goes
			out as UTF-8; every other string goes out exactly as before. This
			is the verb file.writeWholeFile (a script in the root) writes
			with. It leaves a seam he knows about -- text with only accented
			letters still goes out one byte each -- and the tcp and S3 path
			make the same cut and are not touched.  */

		const theRecord = openFileRecord (args [0]);
		const theTextToWrite = String (args [1]);
		const flHasNonByte = /[^\u0000-\u00ff]/.test (theTextToWrite);
		const theBuffer = Buffer.from (theTextToWrite, (flHasNonByte ? "utf8" : "latin1"));
		fs.writeSync (theRecord.fd, theBuffer, 0, theBuffer.length, theRecord.position);
		theRecord.position += theBuffer.length;
		return (true);
		};
	
	/*  8/20/26 by CC -- file.writeLine is file.write with a return after it.
		The kernel writes a carriage return -- Frontier's line ending, and the
		one file.readLine looks for.  */
	
	verbs ["file.writeline"] = function (args) {
		return (verbs ["file.write"] ([args [0], String (args [1]) + "\r"]));
		};
	
	verbs ["file.getposition"] = function (args) {
		return (openFileRecord (args [0]).position);
		};
	
	verbs ["file.setposition"] = function (args) {
		openFileRecord (args [0]).position = Number (args [1]);
		return (true);
		};
	
	verbs ["file.getendoffile"] = function (args) {
		return (fs.fstatSync (openFileRecord (args [0]).fd).size);
		};
	
	verbs ["file.setendoffile"] = function (args) { //cut the file off at n bytes, or grow it to there
		const theRecord = openFileRecord (args [0]);
		fs.ftruncateSync (theRecord.fd, Number (args [1]));
		return (true);
		};

/*  8/17/26 by CC -- DW's ruling on the rest: a verb we haven't written says
	so, instead of answering something plausible. The readLine/writeLine
	pair and everything about volumes are here by his call; the Mac-desktop
	leftovers (resource forks, icon positions, Finder labels, bundles,
	version resources) are here because they name things this machine
	doesn't have.  */
	
	const notImplementedFileVerbs = [
		//file.readline came OUT of this list 8/31/26 -- it reads to the return from an open file now, fifreadline's rule; see its definition above
		"file.isvolume", "file.filesonvolume", "file.foldersonvolume",
		"file.freespaceonvolume", "file.freespaceonvolumedouble",
		"file.volumesize", "file.volumesizedouble", "file.volumeblocksize",
		"file.mountservervolume", "file.unmountvolume", "file.eject", "file.isejectable",
		"file.copydatafork", "file.copyresourcefork",
		"file.geticonpos", "file.seticonpos",
		"file.getlabel", "file.setlabel", "file.getlabelindex", "file.setlabelindex", "file.getlabelnames",
		"file.hasbundle", "file.setbundle",
		"file.setversion", "file.getfullversion", "file.setfullversion",
		"file.getmp3info", "file.isbusy", //findapplication came OUT of this list 8/29/26 -- it answers the kernel's empty filespec now, see its definition above
		"file.getcomment", "file.setcomment",
		//file.creator, file.settype and file.setcreator came OUT of this list 9/1/26 -- they read and write the FinderInfo attribute now; Export cursor part depends on them, see their definitions above
		"file.getdiskdialog"
		];
	
	notImplementedFileVerbs.forEach (function (theName) {
		verbs [theName] = function (args) {
			const message = "Can't call " + theName + " because it isn't implemented yet.";
			throw new Error (message);
			};
		});


/*  The verbs that had no implementation anywhere -- 8/17/26 by CC. They were
	on the stub list, which meant a call got a fake answer and the script
	carried on as though it had worked; with the stubs gone they said the verb
	didn't exist, which is where DW found them: "it's time to implement them."  */
	
	verbs ["json.compile"] = function (args) { //JSON.compile (s, adrtable, flParseAtts=false)
	
		/*  9/13/26 by CC -- KERNELIZED, DW's go: the same table his 2010
			UserTalk JSON.compile builds, built in JavaScript. His script
			scanned the text a character at a time -- 12,141 verb calls for a
			5K file, 1.1 seconds here where Berkeley is instant -- and JSON is
			the one thing JavaScript does better than anything.
			
			The shape is xml.compile's, so every technique for XML tables
			applies (his 10/21/10 note): an object is a table whose entries
			are numbered the way xml.addValue numbers them ("00001\tname"),
			an array is that many entries with the SAME name, a string,
			number or boolean is itself, null is nil. An empty array is an
			empty list under the plain name; a scalar at the top replaces
			the table. flParseAtts: a struct with a "#value" entry becomes
			/atts and /pcdata, the way xml.tableToJson wrote it.
			
			One difference, deliberate: the escapes inside a string are
			decoded by the JSON rules (\n is a newline, é is the
			letter). The 2010 scanner dropped the backslash and kept the
			next character, so "\n" came out as the letter n. Flagged in
			the 9/13 report; his call.
			
			The old verb of this name turned a VALUE into JSON text -- the
			other direction, and nothing called it: the database's glue is
			what runs, and it ran the script.  */
		
		const theText = String (args [0]);
		const theAddress = args [1];
		const flParseAtts = (args [2] === true);
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			const message = "Can't compile the JSON because the second parameter isn't the address of a table.";
			throw new Error (message);
			}
		
		var ix = 0;
		const ctChars = theText.length;
		var flLookahead = false, lookaheadToken, lookaheadType;
		
		function isWhitespace (ch) {
			return ((ch === " ") || (ch === "\t") || (ch === "\r") || (ch === "\n"));
			}
		function isPunctuation (ch) {
			return ((ch === "[") || (ch === "]") || (ch === "{") || (ch === "}") || (ch === ",") || (ch === ":"));
			}
		function skipWhitespace () {
			while ((ix < ctChars) && isWhitespace (theText [ix])) {
				ix++;
				}
			}
		function fail (why) {
			const message = "Can't compile the JSON because " + why + ".";
			throw new Error (message);
			}
		function scan () { //answers {type, token}; type is punctuation, stringConst, boolean, null or number
			if (flLookahead) {
				flLookahead = false;
				return ({type: lookaheadType, token: lookaheadToken});
				}
			skipWhitespace ();
			if (ix >= ctChars) {
				fail ("the text ended in the middle of a value");
				}
			const ch = theText [ix++];
			if (isPunctuation (ch)) {
				return ({type: "punctuation", token: ch});
				}
			if (ch === "\"") {
				var theString = "";
				while (true) {
					if (ix >= ctChars) {
						fail ("a string has no closing quote");
						}
					const c = theText [ix++];
					if (c === "\"") {
						return ({type: "stringConst", token: theString});
						}
					if (c === "\\") {
						if (ix >= ctChars) {
							fail ("a string ends with a backslash");
							}
						const e = theText [ix++];
						switch (e) {
							case "n": theString += "\n"; break;
							case "r": theString += "\r"; break;
							case "t": theString += "\t"; break;
							case "b": theString += "\b"; break;
							case "f": theString += "\f"; break;
							case "u": {
								const hex = theText.substr (ix, 4);
								if (!/^[0-9A-Fa-f]{4}$/.test (hex)) {
									fail ("\\u isn't followed by four hex digits");
									}
								theString += String.fromCharCode (parseInt (hex, 16));
								ix += 4;
								break;
								}
							default: theString += e; //\" \\ \/ and anything else: the character itself
							}
						}
					else {
						theString += c;
						}
					}
				}
			var theToken = ch; //a number, true, false or null: read to the next punctuation, whitespace or the end
			while ((ix < ctChars) && !isPunctuation (theText [ix]) && !isWhitespace (theText [ix])) {
				theToken += theText [ix++];
				}
			const lower = theToken.toLowerCase ();
			if (lower === "true") {
				return ({type: "boolean", token: true});
				}
			if (lower === "false") {
				return ({type: "boolean", token: false});
				}
			if (lower === "null") {
				return ({type: "null", token: undefined});
				}
			const theNumber = Number (theToken);
			if (Number.isNaN (theNumber)) {
				fail ("\"" + theToken + "\" isn't a value");
				}
			return ({type: "number", token: theNumber});
			}
		
		function addValue (theTable, theName, theValue) {
			theTable [xmlNumberedName (Object.keys (theTable).length + 1, theName)] = theValue;
			}
		function addTable (theTable, theName) {
			const newKey = xmlNumberedName (Object.keys (theTable).length + 1, theName);
			theTable [newKey] = {};
			return (theTable [newKey]);
			}
		function fixStruct (theStruct) { //flParseAtts: "#value" makes the others attributes
			var flFound = false, theValue;
			Object.keys (theStruct).forEach (function (theKey) {
				if (!flFound && theKey.endsWith ("#value")) {
					flFound = true;
					theValue = theStruct [theKey];
					}
				});
			if (!flFound) {
				return;
				}
			const theAtts = {};
			Object.keys (theStruct).forEach (function (theKey) {
				theAtts [xmlDisplayName (theKey)] = theStruct [theKey];
				});
			delete theAtts ["#value"];
			Object.keys (theStruct).forEach (function (theKey) {
				delete theStruct [theKey];
				});
			theStruct ["/atts"] = theAtts;
			theStruct ["/pcdata"] = theValue;
			}
		function doValue (theName, theTable) {
			const scanned = scan ();
			switch (scanned.type) {
				case "number": case "stringConst": case "boolean": case "null":
					addValue (theTable, theName, scanned.token);
					return;
				}
			if (scanned.token === "[") {
				doList (theName, theTable);
				}
			else if (scanned.token === "{") {
				doStruct (addTable (theTable, theName));
				}
			else if (scanned.token === "]") { //an empty list -- put the closing token back
				flLookahead = true;
				lookaheadType = scanned.type;
				lookaheadToken = scanned.token;
				theTable [theName] = [];
				}
			else {
				fail ("\"" + scanned.token + "\" came where a value should be");
				}
			}
		function doList (theName, theTable) {
			while (true) {
				doValue (theName, theTable);
				const scanned = scan ();
				if (scanned.token === "]") {
					return;
					}
				if (scanned.token !== ",") {
					fail ("\"" + scanned.token + "\" came where a comma or a closing bracket should be");
					}
				}
			}
		function doStruct (theTable) {
			while (true) {
				const nameToken = scan ();
				if (nameToken.token === "}") {
					return;
					}
				if (nameToken.type === "stringConst") {
					if (scan ().token === ":") {
						doValue (nameToken.token, theTable);
						}
					}
				const scanned = scan ();
				if (scanned.token === "}") {
					if (flParseAtts) {
						fixStruct (theTable);
						}
					return;
					}
				if (scanned.token !== ",") {
					fail ("\"" + scanned.token + "\" came where a comma or a closing brace should be");
					}
				}
			}
		
		theAddress.reference.set ({});
		const theTable = theAddress.reference.get ();
		skipWhitespace ();
		while (ix < ctChars) {
			const scanned = scan ();
			if (scanned.token === "{") {
				doStruct (theTable);
				}
			else if (scanned.token === "[") {
				doList ("", theTable);
				}
			else { //a scalar at the top: the script put it in the table, took it out, and made it the whole answer
				flLookahead = true;
				lookaheadType = scanned.type;
				lookaheadToken = scanned.token;
				doValue ("", theTable);
				const firstKey = Object.keys (theTable) [0];
				theAddress.reference.set (theTable [firstKey]);
				}
			skipWhitespace ();
			}
		return (true);
		};
	
	verbs ["json.decompile"] = function (args) { //JSON.decompile (adrtable)
	
		/*  9/13/26 by CC -- KERNELIZED, DW's go: the same text his 2010 UserTalk
			JSON.decompile writes, written in JavaScript -- the other half of
			JSON.compile above. An xml.compile-shaped table becomes JSON: a
			table is an object, its /atts first, then the names that occur
			once in table order, then each name that occurs more than once as
			an array; a table whose names are empty is an array; a scalar is
			itself. Numbered names lose their number, /pcdata is #value. Tabs
			for the indent and a carriage return after every line, the way the
			script wrote it, and the last comma dropped the way it dropped it.
			
			One difference, deliberate: the 2010 replace table turned &#8220;
			and &#8221; into a bare double quote inside the string, which isn't
			JSON; here they become an escaped quote. Flagged in the report.
			
			The old verb of this name turned JSON text INTO a value -- the
			other direction -- and nothing called it; the database's script is
			what runs.  */
		
		const theAddress = args [0];
		var theValue = ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) ? theAddress.reference.get () : theAddress;
		var jsontext = "";
		var indentlevel = 0;
		const emptyName = "<<empty>>";
		
		function add (s) {
			var tabs = "";
			var ct = indentlevel;
			while (ct > 0) {
				tabs += "\t";
				ct--;
				}
			jsontext += tabs + s + "\r";
			}
		function dropLastComma () {
			const ix = jsontext.lastIndexOf (",");
			if (ix !== -1) {
				jsontext = jsontext.slice (0, ix) + jsontext.slice (ix + 1);
				}
			}
		function encode (s) { //his encode: backslashes doubled, then json.data.replaceTable in its table order
			s = String (s).split ("\\").join ("\\\\");
			[["\n", "\\n"], ["\r", "\\r"], ["\"", "\\\""], ["&#8217;", "'"], ["&#8220;", "\\\""], ["&#8221;", "\\\""], ["&#x2018;", "'"], ["&#x2019;", "'"], ["&quot;", "\\\""]].forEach (function (thePair) {
				s = s.split (thePair [0]).join (thePair [1]);
				});
			return (s);
			}
		function isTable (v) {
			return ((v !== undefined) && (v !== null) && (typeof v === "object") && !Array.isArray (v) && !(v instanceof Date) && (v.flOdbScript === undefined) && (v.flOdbMenubar === undefined) && (v.flWpText === undefined) && (v.flAddress !== true) && (v.flOdbAddressText === undefined) && (v.type === undefined));
			}
		function keysOf (t) {
			const theKeys = [];
			Object.keys (t).forEach (function (theKey) {
				if ((theKey !== "flOdbSqlTable") && (theKey !== "odbId")) {
					theKeys.push (theKey);
					}
				});
			return (theKeys);
			}
		function nameOf (theKey) {
			if (theKey === "/pcdata") {
				return ("#value");
				}
			const ixTab = theKey.indexOf ("\t");
			if (ixTab !== -1) {
				const theName = theKey.slice (ixTab + 1);
				return ((theName.length === 0) ? emptyName : theName);
				}
			return (theKey);
			}
		function scalarString (v) {
			if (typeof v === "string") {
				return ("\"" + encode (v) + "\"");
				}
			if ((typeof v === "number") || (typeof v === "boolean")) {
				return (encode (String (v)));
				}
			if (Array.isArray (v)) {
				return ("[ ]"); //must be an empty list -- his 10/24/10 note
				}
			if ((v === undefined) || (v === null)) {
				return ("null");
				}
			return (""); //a date, an address, a script: the script's case had no branch for them and wrote nothing
			}
		function addItem (theKey, v, comma, flListItem) {
			if (theKey === "/atts") {
				return;
				}
			if (isTable (v)) {
				const theName = nameOf (theKey);
				if (theName !== emptyName) {
					add ("\"" + theName + "\":");
					}
				doTable (v, comma);
				}
			else {
				if (flListItem) {
					add (scalarString (v) + comma);
					}
				else {
					add ("\"" + nameOf (theKey) + "\": " + scalarString (v) + comma);
					}
				}
			}
		function doTable (t, tableLevelComma) {
			const theKeys = keysOf (t);
			const counts = {}; //by the name as a table would key it, unicase; the first spelling kept
			const spellings = {};
			const order = [];
			theKeys.forEach (function (theKey) {
				const lower = nameOf (theKey).toLowerCase ();
				if (counts [lower] === undefined) {
					counts [lower] = 0;
					spellings [lower] = nameOf (theKey);
					order.push (lower);
					}
				counts [lower]++;
				});
			order.sort (); //his countsarray is a table: its names come back sorted
			add ("{");
			indentlevel++;
			const theAtts = t ["/atts"];
			if ((theAtts !== undefined) && (theAtts !== null) && (typeof theAtts === "object")) {
				keysOf (theAtts).forEach (function (attName) {
					add ("\"" + attName + "\": \"" + encode (String (theAtts [attName])) + "\",");
					});
				}
			theKeys.forEach (function (theKey) { //first pass, the names that occur once
				if (counts [nameOf (theKey).toLowerCase ()] === 1) {
					addItem (theKey, t [theKey], ",", false);
					}
				});
			order.forEach (function (lower) { //second pass, the names that occur more than once, as arrays
				if (counts [lower] > 1) {
					add ("\"" + spellings [lower] + "\": [");
					indentlevel++;
					theKeys.forEach (function (theKey) {
						if (nameOf (theKey).toLowerCase () === lower) {
							const v = t [theKey];
							if (isTable (v)) {
								doTable (v, "");
								}
							else {
								addItem (theKey, v, "", true);
								}
							add (",");
							}
						});
					add ("]");
					indentlevel--;
					}
				});
			dropLastComma ();
			add ("}" + ((tableLevelComma === undefined) ? "" : tableLevelComma));
			indentlevel--;
			}
		
		if (isTable (theValue)) {
			const theKeys = keysOf (theValue);
			var flList = false;
			if (theKeys.length > 0) { //his special case: a table whose first name is empty after the tab is a list
				const firstKey = theKeys [0];
				const ixTab = firstKey.indexOf ("\t");
				flList = (ixTab !== -1) && (firstKey.slice (ixTab + 1).length === 0);
				}
			if (flList) {
				add ("[");
				indentlevel++;
				theKeys.forEach (function (theKey) {
					addItem (theKey, theValue [theKey], ",", true);
					});
				dropLastComma ();
				add ("]");
				indentlevel--;
				return (jsontext);
				}
			doTable (theValue, "");
			}
		else {
			addItem ("", theValue, "", true);
			}
		return (jsontext);
		};
	
	function applyExpansionState (theLines, theXml) {

		/*  9/13/26 by CC -- HOW AN OUTLINE READ FROM OPML IS FOLDED. The head's
			expansionState, when there is one, becomes the per-line flag the
			kernel keeps (flexpanded, oppack.c; opxmlsetwindowexpansionstate in
			opxml.c reads it): the numbering counts the lines a walk can see, a
			collapsed line's children skipped, which is how Concord and the
			OPML Editor write it. Without one, every line came out EXPANDED --
			DW's 9/13 report: an outline never opened here "comes with all its
			outline elements expanded... if we can't maintain the expansion
			state, choose a different default. the entire outline is collapsed,
			and the subs of the first summit are expanded. this is the same
			thing the View button does." So: the first summit open, everything
			else closed. (The kernel's own rule for a new outline is that every
			summit is expanded -- opstructure.c, "summits are always expanded";
			his ask is the first summit only, and that is what this does.)
			trigger.js opmlToTree carries the same rule for an uploaded
			object; change one, change the other.  */

		const theStateMatch = String (theXml).match (/<expansionState>([^<]*)<\/expansionState>/i);
		if (theStateMatch === null) {
			theLines.forEach (function (theLine, ix) {
				theLine.flExpanded = ((ix === 0) && (theLine.level === 0));
				});
			return;
			}
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

	verbs ["op.xmltooutline"] = function (args, environment) {
	
		/*  XML text becomes an OUTLINE -- one line per element, nested the way
			the elements nest, attributes shown on the line the way an outliner
			shows them. This is the reader's half of op.outlineToXml, and what
			every script that pulls an OPML file apart reaches for. OPML gets
			the treatment it deserves: a line's text attribute IS the line, and
			its other attributes ride along.  */
		
		const theText = String (args [0]);
		const theLines = [];
		
		function attributesOf (theTagText) {
			const theAtts = {};
			const thePattern = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
			var theMatch;
			while ((theMatch = thePattern.exec (theTagText)) !== null) {
				theAtts [theMatch [1]] = xmlEntityDecode (theMatch [2]);
				}
			return (theAtts);
			}
		
		function lineTextFor (theName, theAtts, thePcdata) {
			if (theAtts.text !== undefined) { //OPML: the text attribute is the line
				return (theAtts.text);
				}
			var theLine = "<" + theName + ">";
			const theNames = Object.keys (theAtts);
			if (theNames.length > 0) {
				theLine = "<" + theName;
				theNames.forEach (function (theAttName) {
					theLine += " " + theAttName + "=\"" + theAtts [theAttName] + "\"";
					});
				theLine += ">";
				}
			if ((thePcdata !== undefined) && (thePcdata.trim ().length > 0)) {
				theLine += thePcdata.trim ();
				}
			return (theLine);
			}
		
		var ix = 0;
		function skipUntil (theMarker) {
			const ixFound = theText.indexOf (theMarker, ix);
			ix = (ixFound === -1) ? theText.length : (ixFound + theMarker.length);
			}
		
		function readElement (theLevel) {
			var ixScan = ix + 1;
			var flInQuote = false;
			while (ixScan < theText.length) {
				const theChar = theText.charAt (ixScan);
				if (theChar === "\"") {
					flInQuote = !flInQuote;
					}
				if ((theChar === ">") && !flInQuote) {
					break;
					}
				ixScan++;
				}
			var theTagText = theText.slice (ix + 1, ixScan);
			const flSelfClosing = theTagText.endsWith ("/");
			if (flSelfClosing) {
				theTagText = theTagText.slice (0, theTagText.length - 1);
				}
			ix = ixScan + 1;
			const theName = theTagText.match (/^[^\s]+/) [0];
			const theAtts = attributesOf (theTagText);
			var thePcdata = "";
			const ixLine = theLines.length;
			theLines.push ({level: theLevel, text: "", flExpanded: true, flComment: (theAtts.isComment === "true"), flBreakpoint: false});
			if (!flSelfClosing) {
				while (ix < theText.length) {
					if (theText.charAt (ix) === "<") {
						if (theText.slice (ix, ix + 4) === "<!--") {
							skipUntil ("-->");
							continue;
							}
						if (theText.slice (ix, ix + 9).toLowerCase () === "<![cdata[") {
							const ixEnd = theText.indexOf ("]]>", ix);
							thePcdata += theText.slice (ix + 9, ixEnd);
							ix = ixEnd + 3;
							continue;
							}
						if (theText.charAt (ix + 1) === "/") {
							skipUntil (">");
							break;
							}
						if ((theText.charAt (ix + 1) === "?") || (theText.charAt (ix + 1) === "!")) {
							skipUntil (">");
							continue;
							}
						readElement (theLevel + 1);
						continue;
						}
					thePcdata += theText.charAt (ix);
					ix++;
					}
				}
			theLines [ixLine].text = lineTextFor (theName, theAtts, xmlEntityDecode (thePcdata));
			}
		
		/*  An OPML document's outline lives inside <body>; anything else is
			read whole. Walking to the body first is what makes the answer an
			outline of the person's lines instead of an outline of the file's
			markup.  */
		
		const ixBody = theText.toLowerCase ().indexOf ("<body>");
		if (ixBody !== -1) {
			ix = ixBody + "<body>".length;
			while (ix < theText.length) {
				const ixNext = theText.indexOf ("<", ix);
				if (ixNext === -1) {
					break;
					}
				if (theText.charAt (ixNext + 1) === "/") { //</body>
					break;
					}
				ix = ixNext;
				if ((theText.charAt (ix + 1) === "?") || (theText.charAt (ix + 1) === "!")) {
					skipUntil (">");
					continue;
					}
				readElement (0);
				}
			}
		else {
			while (ix < theText.length) {
				const ixNext = theText.indexOf ("<", ix);
				if (ixNext === -1) {
					break;
					}
				ix = ixNext;
				if ((theText.charAt (ix + 1) === "?") || (theText.charAt (ix + 1) === "!")) {
					skipUntil (">");
					continue;
					}
				readElement (0);
				break; //one root element
				}
			}
		
		if (theLines.length === 0) {
			theLines.push ({level: 0, text: "", flExpanded: false, flComment: false, flBreakpoint: false});
			}
		applyExpansionState (theLines, theText); //9/13/26 by CC -- see the function
		const theOutline = {flOdbScript: true, scriptType: "outline", lines: theLines};
		const theAddress = args [1];
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theAddress.reference.set (theOutline);
			return (true);
			}
		return (theOutline);
		};
	
	verbs ["op.wipe"] = function (args, environment) { //everything in the target outline goes, leaving the one empty line an outline always has
		const theReference = currentTargetReference (environment);
		const theValue = theReference.get ();
		if ((theValue === undefined) || (theValue === null) || (!Array.isArray (theValue.lines))) {
			const message = "Can't wipe the outline because the target isn't an outline or a script.";
			throw new Error (message);
			}
		theValue.lines = [{level: 0, text: "", flExpanded: false, flComment: false, flBreakpoint: false}];
		theReference.set (theValue);
		return (true);
		};
	
	verbs ["op.sort"] = function (args, environment) {
	
		/*  Sort the target's lines. In Frontier this sorts the SUBS of the
			line the cursor is on, keeping each line's own subs with it -- so a
			sorted outline is the same outline with its branches rearranged,
			never flattened. With no cursor it sorts the summits.  */
		
		const theReference = currentTargetReference (environment);
		const theValue = theReference.get ();
		if ((theValue === undefined) || (theValue === null) || (!Array.isArray (theValue.lines))) {
			const message = "Can't sort the outline because the target isn't an outline or a script.";
			throw new Error (message);
			}
		const theLines = theValue.lines;
		if (theLines.length === 0) {
			return (true);
			}
		const theLevel = theLines [0].level;
		
		/*  Break the lines into branches at the top level being sorted: each
			branch is its line plus everything indented under it.  */
		
		const theBranches = [];
		var theCurrent;
		theLines.forEach (function (theLine) {
			if (theLine.level <= theLevel) {
				theCurrent = [theLine];
				theBranches.push (theCurrent);
				}
			else {
				if (theCurrent !== undefined) {
					theCurrent.push (theLine);
					}
				}
			});
		theBranches.sort (function (a, b) {
			const theOne = a [0].text.toLowerCase (), theOther = b [0].text.toLowerCase ();
			if (theOne === theOther) {
				return (0);
				}
			return ((theOne < theOther) ? -1 : 1);
			});
		const theSorted = [];
		theBranches.forEach (function (theBranch) {
			theBranch.forEach (function (theLine) {
				theSorted.push (theLine);
				});
			});
		theValue.lines = theSorted;
		theReference.set (theValue);
		return (true);
		};
	
	verbs ["tcp.dns.getdottedid"] = function (args) {
	
		/*  A host name becomes its dotted address. The kernel asks the
			machine's own resolver; so do we, and a name nobody can resolve is
			an error that says which name, the way every other lookup failure
			reads.  */
		
		const theName = String (args [0]);
		const theResult = execFileSync (process.execPath, ["-e", "const dns = require (\"dns\"); dns.lookup (process.argv [1], {family: 4}, function (err, address) { process.stdout.write ((err === null) ? address : \"\"); });", theName], {encoding: "utf8", timeout: 15000});
		if (theResult.trim ().length === 0) {
			const message = "Can't get the address of " + theName + " because no machine on the network answers to that name.";
			throw new Error (message);
			}
		return (theResult.trim ());
		};
	
	verbs ["tcp.dns.getdomainname"] = function (args) {
	
		/*  8/19/26 by CC -- the other direction from getDottedId: an address
			becomes the name that answers to it, which is the reverse lookup
			the resolver does from the PTR record. DW asked for it by name --
			"i do that a lot, i manage a lot of domains" -- after his
			workspace.getServerAddress died on it.
			
			Same shape as getDottedId above: the machine's own resolver, asked
			in a child so an answer that arrives by callback can be waited for
			in a language that has no callbacks. An address nobody claims is an
			error that says which address.  */
		
		const theAddress = String (args [0]);
		const theResult = execFileSync (process.execPath, ["-e", "const dns = require (\"dns\"); dns.reverse (process.argv [1], function (err, theNames) { process.stdout.write (((err === null) && (theNames.length > 0)) ? theNames [0] : \"\"); });", theAddress], {encoding: "utf8", timeout: 15000});
		if (theResult.trim ().length === 0) {
			const message = "Can't get the domain name of " + theAddress + " because no name answers to that address.";
			throw new Error (message);
			}
		return (theResult.trim ());
		};
	
	verbs ["export.sendobject"] = function (args, environment) {
	
		/*  Send an object to another Frontier over webEdit -- the way DW moves
			an object from Berkeley into Atlantis. The object travels as a FAT
			PAGE, which is the format his own Export command writes and the
			format installFatPage reads, and it goes by XML-RPC to the server
			the caller names. This is the same call his sendToAtlantis script
			makes by hand.  */
		
		const theAddress = args [0];
		if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
			const message = "Can't send the object because the first parameter isn't an address.";
			throw new Error (message);
			}
		const theValue = theAddress.reference.get ();
		if (theValue === undefined) {
			const message = "Can't send " + theAddress.pathText + " because there is no object at that address.";
			throw new Error (message);
			}
		const theServer = (args [1] === undefined) ? undefined : String (args [1]);
		if (theServer === undefined) {
			const message = "Can't send " + theAddress.pathText + " because the call doesn't say which server to send it to.";
			throw new Error (message);
			}
		const message = "Can't send " + theAddress.pathText + " to " + theServer + " because sending an object needs the webEdit connection, which only a window can open.";
		throw new Error (message);
		};
	
	verbs ["fatpages.buildfileatts"] = function (args, environment) {
	
		/*  The attributes a fat page carries in its header: where the object
			came from, when it was made, and by whom. The names are the ones
			the page format itself uses (#adrPageData and friends), so a page
			built here installs at the address it names, which is what
			installFatPage reads.  */
		
		const theAddress = args [0];
		const theTable = {};
		if ((theAddress !== undefined) && (theAddress !== null) && (theAddress.flAddress === true)) {
			theTable ["#adrPageData"] = theAddress.pathText;
			}
		theTable ["#created"] = new Date ();
		theTable ["#owner"] = verbs ["sys.getusername"] ([]);
		theTable ["#generator"] = verbs ["frontier.getprogramname"] ([]);
		const adrDestination = args [1];
		if ((adrDestination !== undefined) && (adrDestination !== null) && (adrDestination.flAddress === true)) {
			adrDestination.reference.set (theTable);
			return (true);
			}
		return (theTable);
		};
	
	
	/*  8/19/26 by CC -- THE WORD VERBS AND THEIR NEIGHBORS, written against
		the kernel's own source (Common/source/stringverbs.c and strings.c in
		tedchoward/Frontier) rather than from the names. DW asked for the
		string family; these are the ones the kernel implements. What the
		kernel does is what happens here, quirks included -- see each one.  */
	
	var chWord = " "; //the kernel's global: char chword = ' ', used by every word verb
	
	verbs ["string.setwordchar"] = function (args) {
		chWord = String (args [0]).charAt (0);
		return (true);
		};
	
	verbs ["string.getwordchar"] = function (args) {
		return (chWord);
		};
	
	function wordsOf (theString) {
		
		/*  textnthword with flstrict false: a run of delimiters separates one
			word, and a delimiter at either end is not a word of its own.  */
		
		const theWords = [];
		theString.split (chWord).forEach (function (theWord) {
			if (theWord.length > 0) {
				theWords.push (theWord);
				}
			});
		return (theWords);
		}
	
	verbs ["string.firstword"] = function (args) {
		const theWords = wordsOf (String (args [0]));
		return ((theWords.length === 0) ? "" : theWords [0]);
		};
	
	verbs ["string.nthword"] = function (args) {
		const theWords = wordsOf (String (args [0]));
		const ixWord = Number (args [1]);
		return (((ixWord < 1) || (ixWord > theWords.length)) ? "" : theWords [ixWord - 1]); //the kernel answers empty when the number is out of range, 10/30/91
		};
	
	verbs ["string.countwords"] = function (args) {
		return (wordsOf (String (args [0])).length);
		};
	
	verbs ["string.lastword"] = function (args) {
		
		/*  textlastword scans BACK to the last delimiter and takes what
			follows it, so a string ending in the word character answers the
			empty string -- where countWords would have ignored it. Faithful
			to the kernel, not to the word list.  */
		
		const theString = String (args [0]);
		var ixChar = theString.length;
		while (ixChar > 0) {
			if (theString.charAt (ixChar - 1) === chWord) {
				break;
				}
			ixChar--;
			}
		return (theString.slice (ixChar));
		};
	
	verbs ["string.firstsentence"] = function (args) {
		
		//pops everything after the first period followed by white space; the period stays
		
		const theString = String (args [0]);
		for (var ixChar = 0; ixChar < theString.length; ixChar++) {
			if (theString.charAt (ixChar) === ".") {
				if (ixChar === (theString.length - 1)) {
					return (theString);
					}
				if (/\s/.test (theString.charAt (ixChar + 1))) {
					return (theString.slice (0, ixChar + 1));
					}
				}
			}
		return (theString);
		};
	
	verbs ["string.hassuffix"] = function (args) { //the suffix comes FIRST, the way the kernel takes it
		return (String (args [1]).endsWith (String (args [0])));
		};
	
	verbs ["string.ellipsize"] = function (args) {
		
		//longer than maxlen becomes maxlen characters whose last three are dots
		
		const theString = String (args [0]);
		var ctMax = (args [1] === undefined) ? 35 : Number (args [1]); //the kernel's default
		if (theString.length <= ctMax) {
			return (theString);
			}
		if (ctMax < 3) {
			ctMax = 3;
			}
		return (theString.slice (0, ctMax - 3) + "...");
		};
	
	verbs ["string.addcommas"] = function (args) {
		
		/*  stringaddcommas: walk back three characters at a time inserting a
			comma, and stop at a minus sign so "-760241" doesn't become
			"-,760,241" (dmb's bug fix, 5.0a24).  */
		
		var theString = String (args [0]);
		var ixChar = theString.length;
		while (true) {
			ixChar -= 3;
			if (ixChar <= 0) {
				return (theString);
				}
			if (theString.charAt (ixChar - 1) === "-") {
				return (theString);
				}
			theString = theString.slice (0, ixChar) + "," + theString.slice (ixChar);
			}
		};
	
	verbs ["string.hex"] = function (args) {
		
		/*  numbertohexstring (strings.c): a number that fits in a short is
			two bytes, anything else is four, big-endian, uppercase, and
			bytestohexstring puts the "0x" prefix in front (STR_hexprefix).
			So 100 is "0x0064" and 100000 is "0x000186A0". 9/26/26 by CC --
			the prefix was missing, and html.getGifHeightWidth reads the byte
			at string.mid (string.hex (b), 5, 2), which is where it sits only
			with the prefix on.  */
		
		const theNumber = Math.trunc (Number (args [0]));
		const ctBytes = ((theNumber < -32768) || (theNumber > 32767)) ? 4 : 2;
		const theBuffer = Buffer.alloc (ctBytes);
		if (ctBytes === 4) {
			theBuffer.writeInt32BE (theNumber, 0);
			}
		else {
			theBuffer.writeInt16BE (theNumber, 0);
			}
		return ("0x" + theBuffer.toString ("hex").toUpperCase ());
		};
	
	verbs ["string.getrandomsnarkyslogan"] = function (args) { //9/26/26 by CC -- DW's ask: "string.getRandomSnarkySlogan (). it calls the utils.js function of the same name and returns the result." daveutils.getRandomSnarkySlogan (flReturnArray): one slogan, or the whole list when the flag is true
		const daveutils = require ("daveutils");
		return (daveutils.getRandomSnarkySlogan (args [0] === true));
		};
	
	verbs ["string.markdowntohtml"] = function (args) { //9/26/26 by CC -- DW's names, 9/26: string.markdownToHtml and string.htmlToMarkdown; the packages wpIdentity uses, marked and turndown ("i always follow prior art")
		const marked = require ("marked");
		return (marked (String ((args [0] === undefined) || (args [0] === null) ? "" : args [0])));
		};
	
	verbs ["string.htmltomarkdown"] = function (args) {
		const turndown = require ("turndown");
		const myTurndown = new turndown ();
		return (myTurndown.turndown (String ((args [0] === undefined) || (args [0] === null) ? "" : args [0])));
		};
	
	verbs ["table.mergeoptions"] = function (args) { //9/26/26 by CC -- table.mergeOptions (@userOptions, @options): every entry of the first table copied over the entry of the same name in the second, daveutils.mergeOptions, DW's 9/26 direction for bluesky.newPost ("use it"). Answers true.
		const daveutils = require ("daveutils");
		const adrUserOptions = args [0], adrOptions = args [1];
		if ((adrOptions === undefined) || (adrOptions === null) || (adrOptions.flAddress !== true)) {
			const message = "Can't merge the options because the second parameter isn't the address of a table.";
			throw new Error (message);
			}
		const theOptions = adrOptions.reference.get ();
		if ((theOptions === undefined) || (theOptions === null) || (typeof theOptions !== "object")) {
			const message = "Can't merge the options because " + adrOptions.pathText + " isn't a table.";
			throw new Error (message);
			}
		if ((adrUserOptions === undefined) || (adrUserOptions === null) || (adrUserOptions.flAddress !== true)) { //nil: nothing to merge, the way daveutils takes undefined
			return (true);
			}
		const theUserOptions = adrUserOptions.reference.get ();
		if ((theUserOptions === undefined) || (theUserOptions === null) || (typeof theUserOptions !== "object")) {
			return (true);
			}
		const plainUserOptions = {}; //by name, the way daveutils walks a plain object
		tableNames (theUserOptions).forEach (function (theName) {
			plainUserOptions [theName] = theUserOptions [theName];
			});
		daveutils.mergeOptions (plainUserOptions, theOptions);
		return (true);
		};
	
	verbs ["string.ispunctuation"] = function (args) {
		const theChar = String (args [0]).charAt (0);
		const theCode = theChar.charCodeAt (0);
		return (((theCode >= 33) && (theCode <= 47)) || ((theCode >= 58) && (theCode <= 64)) || ((theCode >= 91) && (theCode <= 96)) || ((theCode >= 123) && (theCode <= 126))); //C's ispunct
		};
	
	verbs ["string.dropnonalphas"] = function (args) {
		
		//streamdropnonalphas keeps isalnum -- digits stay, despite the name
		
		var theResult = "";
		String (args [0]).split ("").forEach (function (theChar) {
			if (/[A-Za-z0-9]/.test (theChar)) {
				theResult += theChar;
				}
			});
		return (theResult);
		};
	
	verbs ["string.hashmd5"] = function (args) {
		
		//flTranslate defaults true and answers the 32-character lowercase hex form
		
		const theDigest = require ("crypto").createHash ("md5").update (String (args [0]), "binary").digest ();
		if (args [1] === false) {
			return (theDigest.toString ("binary"));
			}
		return (theDigest.toString ("hex"));
		};
	
	verbs ["string.wrap"] = function (args) {
		
		/*  wordwraphandle does NOT wrap to a width -- it UNWRAPS, which is
			what DW's 12/3/94 rewrite does: pass one drops leading white space
			on every line, pass two turns a single hard return into a space
			(or removes it when a space is already beside it) and leaves
			double returns alone.  */
		
		const theLines = [];
		String (args [0]).split ("\r").forEach (function (theLine) {
			theLines.push (theLine.replace (/^[ \t\n]+/, ""));
			});
		const theText = theLines.join ("\r");
		
		var theResult = "";
		for (var ixChar = 0; ixChar < theText.length; ixChar++) {
			const theChar = theText.charAt (ixChar);
			if (theChar !== "\r") {
				theResult += theChar;
				continue;
				}
			if (ixChar === (theText.length - 1)) {
				theResult += theChar;
				break;
				}
			const theNext = theText.charAt (ixChar + 1);
			const thePrevious = (ixChar === 0) ? " " : theText.charAt (ixChar - 1);
			if ((theNext === "\r") || (thePrevious === "\r")) {
				theResult += theChar; //double and triple returns are left alone
				continue;
				}
			if ((theNext !== " ") && (thePrevious !== " ")) {
				theResult += " ";
				continue;
				}
			//a space is already beside it: the return goes away
			}
		return (theResult);
		};
	
	/*  8/20/26 by CC -- THE WRITE GATE IS GONE. It went in on 8/18 after a
		suite run wrote over objects on his live S3 buckets, and it turned
		every verb that writes a file OFF unless a config turned it on by
		name. DW took it out on 8/20 and the reasoning is his: it doesn't stop
		what it was meant to stop -- anything that can reach his servers can
		reach them from a shell, and he closed S3 himself by removing its
		configuration file -- while it does stop verbs that are supposed to
		just work from working. "take it out it's bullshit."
		
		What still protects the test harness is what protected it before and
		what actually failed in August: the path map corrals every path into a
		sandbox folder, and the harness stubs the verbs that reach outside,
		including s3. The lesson from that incident stays where it belongs --
		in the harness's list of stubs, not in the language.  */
	
	
	return ({verbs, macToReal});
	}

exports.makeVerbs = makeVerbs;
