var myProductName = "frontierOdb", myVersion = "0.4.4";

/*  Read a Frontier object database (.root file), or a fat page export
	(.fttb, .ftop, .ftsc), into a JavaScript structure.

	The format was learned from the Frontier kernel source, released under
	the GPL by UserLand Software: https://github.com/scripting/frontier

	Key source files: db.c and dbinternal.h (the block file), cancoon.c
	(the root record), langhash.c (packed tables), langexternal.c
	(externals, including the in-memory packing fat pages use),
	oppack.c (packed outlines), tablepack.c (fat page table wrapper).

	by CC, 7/26/26 */

const fs = require ("fs");

const valueTypeNames = {
	0: "novalue", 1: "char", 2: "int", 3: "long", 4: "oldstring", 5: "binary",
	6: "boolean", 7: "token", 8: "date", 9: "address", 10: "code", 11: "double",
	12: "string", 13: "external", 14: "direction", 15: "password", 16: "ostype",
	18: "point", 19: "rect", 20: "pattern", 21: "rgb", 22: "fixed", 23: "single",
	24: "olddouble", 25: "objspec", 26: "filespec", 27: "alias", 28: "enum",
	29: "list", 30: "record"
	};

const externalIdNames = {
	0: "outline", 1: "wptext", 2: "headrecord", 3: "table", 4: "script", 5: "menubar", 6: "pict", 7: "card"
	};

const macRomanHighChars =
	"ÄÅÇÉÑÖÜáàâäãåçéè" +
	"êëíìîïñóòôöõúùûü" +
	"†°¢£§•¶ß®©™´¨≠ÆØ" +
	"∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
	"¿¡¬√ƒ≈∆«»… ÀÃÕŒœ" + //nonbreaking space
	"–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ" +
	"‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ" +
	"ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"; //apple logo

function macRomanToString (theBuffer) {
	var result = "";
	theBuffer.forEach (function (theByte) {
		if (theByte < 0x80) {
			result += String.fromCharCode (theByte);
			}
		else {
			result += macRomanHighChars [theByte - 0x80];
			}
		});
	return (result);
	}

function unpackWpText (theBuffer) {

	/*  Word-processing text. The engine that wrote these was licensed and
		its source isn't in the kernel, but the packed form is mostly ASCII
		and the document's text is stored plainly: a length in hex, a
		comma, then that many bytes. The leading run (or runs, for a long
		document) is the text; what follows is the font table and the style
		records, which we don't keep.

		by CC, 7/28/26 */

	function flHexDigit (theByte) {
		return (((theByte >= 0x30) && (theByte <= 0x39)) || ((theByte >= 0x41) && (theByte <= 0x46)));
		}

	function flLooksLikeText (theBytes) { //a text run is printable; a font or style record isn't
		if (theBytes.length === 0) {
			return (false);
			}
		var ctPrintable = 0;
		theBytes.forEach (function (theByte) {
			if (((theByte >= 32) && (theByte < 127)) || (theByte === 13) || (theByte === 10) || (theByte === 9) || (theByte >= 0x80)) {
				ctPrintable++;
				}
			});
		return ((ctPrintable / theBytes.length) > 0.98);
		}

	const pieces = [];
	var ix = 0;
	var flStarted = false;

	while (ix < theBuffer.length) {

		var ixDigits = ix;
		while ((ixDigits < theBuffer.length) && flHexDigit (theBuffer [ixDigits])) {
			ixDigits++;
			}

		if ((ixDigits > ix) && (ixDigits < theBuffer.length) && (theBuffer [ixDigits] === 0x2c)) { //a comma closes the count
			const ctChars = parseInt (theBuffer.slice (ix, ixDigits).toString ("latin1"), 16);
			const ixText = ixDigits + 1;
			if ((ctChars > 0) && ((ixText + ctChars) <= theBuffer.length)) {
				const theRun = theBuffer.slice (ixText, ixText + ctChars);
				if (flLooksLikeText (theRun)) {
					pieces.push (macRomanToString (theRun));
					flStarted = true;
					ix = ixText + ctChars;
					continue;
					}
				if (flStarted) { //the text ended; the rest is fonts and styles
					break;
					}
				ix = ixText + ctChars;
				continue;
				}
			}

		ix++;
		}

	return (pieces.join (""));
	}

function convertMacDate (theSeconds) { //seconds since 1/1/1904, the Mac epoch
	if (theSeconds === 0) {
		return (undefined);
		}
	const macEpoch = Date.UTC (1904, 0, 1);
	return (new Date (macEpoch + theSeconds * 1000)); /*  9/6/26 by CC -- A DATE, NOT ITS TEXT. This answered an ISO string,
		so every date read out of a root file or a fat page landed in the database as a string: frontier.root had 0 rows of type
		date and 12 ISO-shaped strings (Frontier.shipdate among them), and DW's watcher stopped after he exported and re-imported
		its table -- whenLastUpdate came back as text and date > text answered false. His deal-stopper of 9/6.  */
	}

function flNameLooksSecret (theName) { //apiSecret, SecretAccessKey, google.key -- credentials hide under many names
	const lower = theName.toLowerCase ();
	if (lower === "key") {
		return (true);
		}
	var result = false;
	["password", "passwd", "secret", "token", "credential", "apikey", "accesskey", "privatekey"].forEach (function (part) {
		if (lower.indexOf (part) !== -1) {
			result = true;
			}
		});
	return (result);
	}

function makeUnpacker (getBlock, flMemory) {

	/*  The unpack functions, shared by the two readers. In a .root file,
		big values live in db blocks reached through getBlock; in a fat
		page (flMemory true) everything is inline and getBlock is never
		called.  */

	function getPascalString (theBuffer, ix) {
		const len = theBuffer [ix];
		return (macRomanToString (theBuffer.slice (ix + 1, ix + 1 + len)));
		}

	function unmergeHandles (theBuffer) { //[4-byte size of first part][first part][second part]
		const sizeFirst = theBuffer.readUInt32BE (0);
		return ({
			part1: theBuffer.slice (4, 4 + sizeFirst),
			part2: theBuffer.slice (4 + sizeFirst)
			});
		}

	function getScalarBytes (hstrings, ix) { //[4-byte len][bytes], or len == -1 then [dbaddress], .root files only
		const len = hstrings.readInt32BE (ix);
		if (len === -1) {
			const adr = hstrings.readUInt32BE (ix + 4);
			return (getBlock (adr));
			}
		return (hstrings.slice (ix + 4, ix + 4 + len));
		}

	function parseOutlineSections (textBytes, tableBytes, flKeepRefcons) {

		/*  The two data sections of a packed outline: tab-indented
			CR-separated text, then a line table with one entry per line.
			Shared by outlines, scripts and the menubar outline -- the
			menubar is the caller that wants the refcon bytes kept.  */

		const lines = [];
		var ixText = 0;
		while (ixText < textBytes.length) { //CR-separated lines, leading tabs are the depth
			var level = 0;
			while (textBytes [ixText] === 9) { //tab
				level++;
				ixText++;
				}
			const ixStart = ixText;
			while ((ixText < textBytes.length) && (textBytes [ixText] !== 13)) { //carriage return
				ixText++;
				}
			lines.push ({level, text: macRomanToString (textBytes.slice (ixStart, ixText))});
			ixText++;
			if (textBytes [ixText] === 10) { //linefeed
				ixText++;
				}
			}

		var ixTable = 0;
		lines.forEach (function (line) { //per line: flags short, refcon length long, refcon bytes
			if (ixTable + 6 <= tableBytes.length) {
				const flags = tableBytes.readUInt16BE (ixTable);
				const lenrefcon = tableBytes.readUInt32BE (ixTable + 2);
				if (flKeepRefcons && (lenrefcon > 0)) {
					line.refconBytes = tableBytes.slice (ixTable + 6, ixTable + 6 + lenrefcon);
					}
				ixTable += 6 + lenrefcon;
				line.flShowing = (flags & 0x8000) !== 0; //the kernel's flexpanded bit, see below
				line.flComment = (flags & 0x0400) !== 0;
				line.flBreakpoint = (flags & 0x0200) !== 0;
				}
			});

		/*  9/15/26 by CC -- THE EXPANDED BIT IS ON THE CHILD, NOT THE PARENT.
			In the kernel a headline's flexpanded says whether that headline
			is SHOWING -- its list is open -- not whether its own subs are.
			opexpand.c asks the first subhead: "if ((hright != hcursor) &&
			(**hright).flexpanded) -- first subhead is showing, collapse is
			called for"; and oppack.c's unpack gives the bit to the first
			line of each list and lets its siblings inherit it. This reader
			took the bit as "this line's subs are open", so every visible
			line came back expanded: DW's 9/12 and 9/15 reports, "most
			outlines open with every line expanded". A line's flExpanded
			here means its subs are showing, so it is read off its first
			child; a line with no subs gets false.  */

		const showingByLevel = []; //whether the list at each level is showing, for the open ancestors
		const bitByLevel = []; //the first line of the list's bit, which its siblings inherit (oppack.c)
		lines.forEach (function (line, ix) {
			const thePrevious = lines [ix - 1];
			const flFirstInList = (thePrevious === undefined) || (thePrevious.level < line.level);
			if (flFirstInList) {
				bitByLevel [line.level] = (line.flShowing === true);
				}
			const flParentShowing = (line.level === 0) ? true : (showingByLevel [line.level - 1] === true); //summits are always showing
			showingByLevel.length = line.level + 1;
			showingByLevel [line.level] = flParentShowing && (bitByLevel [line.level] === true);
			line.flShowing = showingByLevel [line.level];
			});
		lines.forEach (function (line, ix) {
			const theNext = lines [ix + 1];
			const flHasSubs = (theNext !== undefined) && (theNext.level > line.level);
			line.flExpanded = flHasSubs ? (theNext.flShowing === true) : false;
			});
		lines.forEach (function (line) {
			delete line.flShowing;
			});

		return ({lines, ctTableBytes: ixTable});
		}

	function unpackOutline (theBuffer) {

		const sizelinetable = theBuffer.readUInt32BE (2);
		const sizetext = theBuffer.readUInt32BE (6);
		const headerSize = theBuffer.length - sizetext - sizelinetable;
		const textBytes = theBuffer.slice (headerSize, headerSize + sizetext);
		const tableBytes = theBuffer.slice (headerSize + sizetext, headerSize + sizetext + sizelinetable);

		return (parseOutlineSections (textBytes, tableBytes, false).lines);
		}

	function unpackListItem (theBytes) {

		/*  9/8/26 by CC -- langunpackvalue: the four-character type id, then
			the value. Answers {value} so a novalue item and a form this reader
			doesn't decode are told apart -- undefined means keep the whole
			list as the bytes Frontier wrote.  */

		if ((theBytes === undefined) || (theBytes.length < 4)) {
			return (undefined);
			}
		const theId = theBytes.slice (0, 4).toString ("latin1");
		const theData = theBytes.slice (4);
		switch (theId) {
			case "????":
				return ({value: undefined});
			case "TEXT":
				return ({value: macRomanToString (theData)});
			case "bool":
				return ({value: theData [0] !== 0});
			case "shor":
				return ({value: theData.readInt16BE (0)});
			case "long":
				return ({value: theData.readInt32BE (0)});
			case "exte":
				if (theData.length !== 8) {
					return (undefined);
					}
				return ({value: new Number (theData.readDoubleBE (0))});
			case "date":
				return ({value: convertMacDate (theData.readUInt32BE (0))});
			case "char":
				return ({value: {type: "char", value: theData [0]}});
			case "addr":
				return ({value: {type: "address", path: macRomanToString (theData)}});
			case "list": {
				const theList = unpackList (theData);
				return ((theList === undefined) ? undefined : {value: theList});
				}
			}
		return (undefined);
		}

	function unpackList (theBytes) {

		/*  9/8/26 by CC -- opunpacklist: the 12-byte tydisklistrecord, then
			the packed outline whose summits are the items, each value in the
			line's refcon. A record (isrecord) and any item this reader can't
			decode answer undefined, and the caller keeps the bytes whole. No
			bytes at all is the empty-list scalar the 9/6 writer wrote.  */

		if (theBytes.length < 12) {
			return ([]);
			}
		const recordsize = theBytes.readInt16BE (0);
		const versionnumber = theBytes.readInt16BE (2);
		var ctitems = theBytes.readInt16BE (8);
		const isrecord = theBytes [11] !== 0;
		if ((versionnumber !== 1) || isrecord || (recordsize < 12)) {
			return (undefined);
			}
		const theOutline = theBytes.slice (recordsize);
		const sizelinetable = theOutline.readUInt32BE (2);
		const sizetext = theOutline.readUInt32BE (6);
		const headerSize = theOutline.length - sizetext - sizelinetable;
		const theLines = parseOutlineSections (theOutline.slice (headerSize, headerSize + sizetext), theOutline.slice (headerSize + sizetext, headerSize + sizetext + sizelinetable), true).lines;
		const theSummits = [];
		theLines.forEach (function (theLine) {
			if (theLine.level === 0) {
				theSummits.push (theLine);
				}
			});
		if (ctitems === -1) { //more than 32K items: the kernel counts the summits
			ctitems = theSummits.length;
			}
		const theItems = [];
		var flDecoded = true;
		theSummits.forEach (function (theLine) {
			if (theItems.length >= ctitems) {
				return;
				}
			const theItem = unpackListItem (theLine.refconBytes);
			if (theItem === undefined) {
				flDecoded = false;
				return;
				}
			theItems.push (theItem.value);
			});
		return (flDecoded ? theItems : undefined);
		}

	function interpretMenubarRefcons (lines) {

		/*  Each menubar line's refcon is a tymenuiteminfo: cmdkey byte,
			cmdmodifiers byte, then a dbaddress and an outline handle for
			the linked script -- either one nonzero means the line has a
			script (the kernel's meunpackscriptvisit makes the same test).
			Leaves flLinkedScript and adrlink on the line for the caller
			to consume and remove.  */

		lines.forEach (function (line) {
			if ((line.refconBytes !== undefined) && (line.refconBytes.length >= 10)) {
				const cmdkey = line.refconBytes [0];
				if (cmdkey !== 0) {
					line.cmdkey = macRomanToString (line.refconBytes.slice (0, 1));
					}
				line.adrlink = line.refconBytes.readUInt32BE (2);
				line.flLinkedScript = (line.adrlink !== 0) || (line.refconBytes.readUInt32BE (6) !== 0);
				}
			delete line.refconBytes;
			});
		}

	function unpackMenubarPacked (theBuffer) {

		/*  A menubar packed into memory by the kernel's mepackmenustructure
			(menupack.c) -- the form a fat page carries: a mergehandles pair.
			Part 1 is a tysavedmenuinfo record followed by the menubar
			outline packed by oppack -- a tyversion2diskheader, the
			tab-indented text, the line table. Part 2 is the linked scripts,
			one packed outline after another, in the order a pre-order walk
			of the menubar outline meets the lines that carry one.

			The struct sizes aren't hard-coded here: the savedmenuinfo
			starts with a short 1 and the version-2 outline header with a
			short 2, and the header's two size fields have to account for
			part 1 exactly -- the scan accepts the offset where everything
			adds up, then knows the header size for part 2's scripts too.

			by CC, 8/8/26 */

		const parts = unmergeHandles (theBuffer);
		const part1 = parts.part1;
		const part2 = parts.part2;

		var headerSize, menubarParse;
		var ixScan;
		for (ixScan = 2; ixScan + 10 <= part1.length; ixScan += 2) {
			if ((part1.readUInt16BE (ixScan) >= 2) && (part1.readUInt16BE (ixScan) <= 3)) {
				const sizelinetable = part1.readUInt32BE (ixScan + 2);
				const sizetext = part1.readUInt32BE (ixScan + 6);
				const candidateHeaderSize = part1.length - ixScan - sizetext - sizelinetable;
				if ((candidateHeaderSize >= 40) && (candidateHeaderSize <= 400)) {
					const textBytes = part1.slice (ixScan + candidateHeaderSize, ixScan + candidateHeaderSize + sizetext);
					if ((sizetext === 0) || (textBytes [textBytes.length - 1] === 13)) { //every line ends with a carriage return
						const tableBytes = part1.slice (ixScan + candidateHeaderSize + sizetext);
						const candidateParse = parseOutlineSections (textBytes, tableBytes, true);
						if (candidateParse.ctTableBytes === tableBytes.length) { //the line table accounts for every byte
							headerSize = candidateHeaderSize;
							menubarParse = candidateParse;
							break;
							}
						}
					}
				}
			}

		if (menubarParse === undefined) {
			const message = "Can't unpack the menubar because no offset makes the outline header's sizes account for the data.";
			throw new Error (message);
			}

		const lines = menubarParse.lines;
		interpretMenubarRefcons (lines);

		//the scripts, consumed in line order
			var ixScripts = 0;
			var ctScripts = 0;
			lines.forEach (function (line) {
				if (line.flLinkedScript === true) {
					if (ixScripts + 10 > part2.length) {
						const message = "Can't unpack the menubar because it ran out of packed scripts after " + ctScripts + ".";
						throw new Error (message);
						}
					const sizelinetable = part2.readUInt32BE (ixScripts + 2);
					const sizetext = part2.readUInt32BE (ixScripts + 6);
					const textBytes = part2.slice (ixScripts + headerSize, ixScripts + headerSize + sizetext);
					const tableBytes = part2.slice (ixScripts + headerSize + sizetext, ixScripts + headerSize + sizetext + sizelinetable);
					line.script = {lines: parseOutlineSections (textBytes, tableBytes, false).lines};
					ixScripts += headerSize + sizetext + sizelinetable;
					ctScripts++;
					}
				delete line.flLinkedScript;
				delete line.adrlink;
				});

		if (ixScripts !== part2.length) {
			const message = "Can't trust the unpacked menubar because " + (part2.length - ixScripts) + " bytes of packed scripts were left over after " + ctScripts + " scripts.";
			throw new Error (message);
			}

		return (lines);
		}

	function unpackMenubarFromDb (infoBytes) {

		/*  A menubar stored in a database -- the form the kernel's
			mesavemenurecord writes with flmemory false: the block is just
			the tysavedmenuinfo record, whose adroutline (a long at offset
			2) points at the menubar outline saved as its own block, and
			each line's refcon carries the dbaddress of its script's block.
			Mirrors meloadmenurecord.

			by CC, 8/8/26 */

		const adroutline = infoBytes.readUInt32BE (2);
		const outlineBlock = getBlock (adroutline);
		const sizelinetable = outlineBlock.readUInt32BE (2);
		const sizetext = outlineBlock.readUInt32BE (6);
		const headerSize = outlineBlock.length - sizetext - sizelinetable;
		const lines = parseOutlineSections (outlineBlock.slice (headerSize, headerSize + sizetext), outlineBlock.slice (headerSize + sizetext), true).lines;

		interpretMenubarRefcons (lines);

		lines.forEach (function (line) {
			if ((line.flLinkedScript === true) && (line.adrlink !== 0)) {
				line.script = {lines: unpackOutline (getBlock (line.adrlink))};
				}
			delete line.flLinkedScript;
			delete line.adrlink;
			});

		return (lines);
		}

	function unpackExternal (packed, depth) { //[version short][id byte][pad], then a dbaddress or the data inline

		const id = packed [2];
		const kind = externalIdNames [id];

		function getExternalData () {
			if (flMemory) {
				return (packed.slice (4));
				}
			return (getBlock (packed.readUInt32BE (4)));
			}

		if (kind === "table") {
			if (depth > 100) {
				const message = "Can't unpack the table because it's nested more than 100 levels deep.";
				throw new Error (message);
				}
			return ({type: "table", value: unpackTable (getExternalData (), depth + 1)});
			}
		else {
			if ((kind === "outline") || (kind === "script")) {
				return ({type: kind, lines: unpackOutline (getExternalData ())});
				}
			else {
				if (kind === "menubar") { //8/8/26 by CC -- the menu structure with each command's script attached; two storage forms
					if (flMemory) {
						return ({type: kind, lines: unpackMenubarPacked (packed.slice (4))});
						}
					return ({type: kind, lines: unpackMenubarFromDb (getExternalData ())});
					}
				const blockData = getExternalData ();
				var length = 0;
				if (blockData !== undefined) {
					length = blockData.length;
					}

				/*  8/24/26 by CC -- the raw bytes ride along, so the writer
					can put back exactly what Frontier wrote. A wptext's pack
					format belongs to the licensed engine and can't be
					rebuilt from its text; keeping the bytes is the honest
					way to round-trip a root that holds one.  */

				const theRaw = (blockData === undefined) ? "" : blockData.toString ("base64");
				if ((kind === "wptext") && (blockData !== undefined)) {
					return ({type: kind, length, text: unpackWpText (blockData), raw: theRaw});
					}
				return ({type: kind, length, raw: theRaw});
				}
			}
		}

	function unpackTable (theBuffer, depth) {

		const outer = unmergeHandles (theBuffer); //part1 is the packed hash table, part2 the display formats
		const inner = unmergeHandles (outer.part1); //part1 is the records, part2 the strings
		const hrecords = inner.part1;
		const hstrings = inner.part2;

		const table = {};
		var ix = 0;

		const headerVersion = hrecords.readUInt16BE (0);
		if (headerVersion > 0) { //a 16-byte table header: version, sortorder, timecreated, timelastsave, flags
			ix = 16;
			}

		while (ix + 10 <= hrecords.length) { //10-byte records: name index long, type byte, version byte, data 4 bytes

			const ixkey = hrecords.readUInt32BE (ix);
			const valuetype = hrecords [ix + 4];
			const name = getPascalString (hstrings, ixkey);
			const typeName = valueTypeNames [valuetype];
			var value;

			switch (typeName) {
				case "string":
					value = macRomanToString (getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6)));
					break;
				case "password": //never import passwords
					value = "xxx";
					break;
				case "oldstring":
					value = getPascalString (hstrings, hrecords.readUInt32BE (ix + 6));
					break;
				case "address":
					value = {type: "address", path: getPascalString (hstrings, hrecords.readUInt32BE (ix + 6))};
					break;
				case "boolean":
					value = hrecords [ix + 6] !== 0;
					break;
				case "char":
					value = {type: "char", value: hrecords [ix + 6]}; //8/26/26 by CC -- a real char now, carrying its byte; it used to flatten into a one-character string
					break;
				case "int": case "token": case "direction":
					value = hrecords.readInt16BE (ix + 6);
					break;
				case "long": case "fixed": case "enum":
					value = hrecords.readInt32BE (ix + 6);
					break;
				case "ostype":
					value = macRomanToString (hrecords.slice (ix + 6, ix + 10));
					break;
				case "date":
					value = convertMacDate (hrecords.readUInt32BE (ix + 6));
					break;
				case "point": //stored directly in the record, not in the strings block: v then h, two shorts
					value = {type: "point", v: hrecords.readInt16BE (ix + 6), h: hrecords.readInt16BE (ix + 8)};
					break;
				case "single": //also direct, a 4-byte float
					value = hrecords.readFloatBE (ix + 6);
					break;
				case "external":
					const ixval = hrecords.readUInt32BE (ix + 6);
					const len = hstrings.readInt32BE (ixval);
					value = unpackExternal (hstrings.slice (ixval + 4, ixval + 4 + len), depth);
					break;
				case "novalue":
					value = undefined;
					break;
				case "binary": { //8/24/26 by CC -- the bytes themselves, the shape binary () makes, so a root with images or packed data can round-trip
					const theBytes = getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6));
					value = binaryValueFromHandle (theBytes);
					break;
					}
				case "double": { //8/24/26 by CC -- 8-byte IEEE, boxed so the writer knows it was a double and not a long
					const theBytes = getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6));
					value = ((theBytes === undefined) || (theBytes.length < 8)) ? 0 : new Number (theBytes.readDoubleBE (0));
					break;
					}
				case "list": { //9/8/26 by CC -- a list reads as a list now (43 in frontier.root rode as markers); one this reader can't decode keeps its bytes, the default below
					const theListBytes = getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6));
					const theList = (theListBytes === undefined) ? [] : unpackList (theListBytes);
					if (theList !== undefined) {
						value = theList;
						break;
						}
					value = {type: typeName, length: theListBytes.length, raw: theListBytes.toString ("base64")};
					break;
					}
				default: //code, rect, pattern, the rest -- not decoded, but the raw bytes ride along so a save puts back what was there -- 8/24/26 by CC
					const bytes = getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6));
					var length = 0;
					if (bytes !== undefined) {
						length = bytes.length;
						}
					value = {type: typeName, length, raw: (bytes === undefined) ? "" : bytes.toString ("base64")};
					break;
				}

			const flStructure = (typeof value === "object") && (value !== null) && ((value.type === "table") || (value.lines !== undefined)); //a script named checkPassword is code, not a secret
			if (flNameLooksSecret (name) && !flStructure) { //never import credentials, whatever the type
				value = "xxx";
				}
			table [name] = value;
			ix += 10;
			}

		return (table);
		}

	return ({unpackTable, unpackExternal});
	}

function readRootFile (path) {

	const buf = fs.readFileSync (path);

	function getBlock (adr) { //the data bytes of the db block at adr
		if (adr === 0) {
			return (undefined);
			}
		const sizeword = buf.readUInt32BE (adr);
		const flFree = (sizeword & 0x80000000) !== 0;
		if (flFree) {
			const message = "Can't read the block at " + adr + " because it's on the free list.";
			throw new Error (message);
			}
		const nodebytes = sizeword & 0x7FFFFFFF;
		const variance = buf.readUInt32BE (adr + 4);
		return (buf.slice (adr + 8, adr + 8 + nodebytes - variance));
		}

	//the file header: system id byte, version byte, then the availlist; the root view address is at offset 10
	const versionnumber = buf [1];
	if ((versionnumber < 5) || (versionnumber > 6)) {
		const message = "Can't read " + path + " because its version is " + versionnumber + " and this package reads versions 5 and 6.";
		throw new Error (message);
		}
	const rootview = buf.readUInt32BE (10);

	//the root record: a version short, then the address of the root table
	const ccrec = getBlock (rootview);
	const adrroottable = ccrec.readUInt32BE (2);

	const unpacker = makeUnpacker (getBlock, false);
	return (unpacker.unpackTable (getBlock (adrroottable), 0));
	}

function readFatPage (path) {

	/*  A fat page is a text file: CR-separated #directive lines, with the
		value packed into a base64 #pageData directive. Frontier exported
		them as .fttb (table), .ftop (outline), .ftsc (script).  */

	const theText = fs.readFileSync (path, "latin1");

	const directives = {};
	theText.split ("\r").forEach (function (line) {
		if (line.charAt (0) === "#") {
			const ixSpace = line.indexOf (" ");
			if (ixSpace === -1) {
				directives [line.slice (1)] = true;
				}
			else {
				directives [line.slice (1, ixSpace)] = line.slice (ixSpace + 1);
				}
			}
		});

	if (directives.pageData === undefined) {
		const message = "Can't read " + path + " because it doesn't have a #pageData directive.";
		throw new Error (message);
		}

	const packed = Buffer.from (directives.pageData, "base64");
	delete directives.pageData;

	const unpacker = makeUnpacker (undefined, true);
	return ({directives, value: unpacker.unpackExternal (packed, 0)});
	}

function getAddress (theDatabase, thePath) { //"nodeEditorSuite.data.glossary" -> the value at that path
	var current = theDatabase;
	thePath.split (".").forEach (function (part) {
		if (current === undefined) {
			return;
			}
		var next = current [part];
		if ((next !== undefined) && (next.type === "table")) {
			next = next.value;
			}
		current = next;
		});
	return (current);
	}

/*  8/22/26 by CC -- the same door readFatPage goes through, opened for
	callers who already have the bytes. UserTalk's unpack verb hands over
	what base64.decode gave it; there was no way in without writing a
	temporary #pageData file first, which is what trigger was doing.  */

function unpackMemoryValue (theBytes) {
	const unpacker = makeUnpacker (undefined, true);
	return (unpacker.unpackExternal (Buffer.isBuffer (theBytes) ? theBytes : Buffer.from (theBytes, "latin1"), 0));
	}


/*  THE PACKER -- 8/23/26 by CC. The inverse of the unpacker above, mirrored
	function for function; when one changes the other has to.

	unpack shipped 8/22 and pack never did, so a fat page could be READ and
	never WRITTEN. That is why fatPages.encodePageData stopped and there was
	no way to export anything -- DW, 8/23, having lost a day to it: "without
	strong backup confidence... that's the end of today's work for me."

	Tables, scripts, outlines -- and, since 8/24, MENUBARS: packMenubar
	writes the mergehandles pair the kernel's mepackmenustructure writes,
	each command's script packed behind the outline, read from menupack.c
	in the 2011 kernel source. Packed outlines carry the kernel's own
	120-byte version-2 header now (oppack.c), for the day Frontier reads
	our bytes.

	What is proven: a real Frontier-written fat page decoded, repacked here
	and decoded again gives back an identical value -- checked against
	suites.console.fttb, workspaceTests.fttb, tcp.httpClient.ftsc,
	scratchpad.theTable.fttb, and the menubar menus.customMenu.ftmb. What
	is NOT proven is that Frontier itself reads what we write; ours still
	carries no display formats on tables.  */

const memoryExternalIdForName = {outline: 0, wptext: 1, headrecord: 2, script: 4, pict: 6, card: 7}; //8/24/26 by CC -- raw pass-through only; tables and menubars always pack structurally
const scalarCodeForRawName = {char: 1, int: 2, oldstring: 4, token: 7, code: 10, direction: 14, password: 15, ostype: 16, rect: 19, pattern: 20, rgb: 21, fixed: 22, single: 23, olddouble: 24, objspec: 25, filespec: 26, alias: 27, enum: 28, list: 29, record: 30};

function bytesForString (theText) { //the inverse of macRomanToString
	const theBytes = Buffer.alloc (theText.length);
	var ix;
	for (ix = 0; ix < theText.length; ix++) {
		const theCode = theText.charCodeAt (ix);
		if (theCode < 0x80) {
			theBytes [ix] = theCode;
			}
		else {
			const ixHigh = macRomanHighChars.indexOf (theText.charAt (ix));
			theBytes [ix] = (ixHigh === -1) ? 0x3f : (0x80 + ixHigh); //a question mark for anything MacRoman has no room for
			}
		}
	return (theBytes);
	}

function mergeHandles (part1, part2) { //[4-byte size of first part][first part][second part]
	const theSize = Buffer.alloc (4);
	theSize.writeUInt32BE (part1.length, 0);
	return (Buffer.concat ([theSize, part1, part2]));
	}

const ctSecondsFrom1904To1970 = 2082844800;

function macSecondsForDate (theDate) {
	return (Math.round (theDate.getTime () / 1000) + ctSecondsFrom1904To1970);
	}

function packKernelOutlineHeader (sizeText, sizeTable) {

	/*  The kernel's tyversion2diskheader (oppack.c) -- 120 bytes with
		2-byte alignment, the size checked against menubars Frontier itself
		wrote. Our unpacker finds the sections by subtracting the two sizes
		from the length, so it never cared what the header was; writing the
		kernel's header, version 2 the way oppack writes it, is for the day
		Frontier reads our bytes.

		by CC, 8/24/26 -- read from oppack.c in the 2011 kernel source  */

	const theHeader = Buffer.alloc (120);
	theHeader.writeUInt16BE (2, 0); //versionnumber -- opversionnumber in oppack.c
	theHeader.writeUInt32BE (sizeTable, 2); //sizelinetable
	theHeader.writeUInt32BE (sizeText, 6); //sizetext
	const theNow = macSecondsForDate (new Date ());
	theHeader.writeUInt32BE (theNow, 66); //timecreated
	theHeader.writeUInt32BE (theNow, 70); //timelastsave
	theHeader.writeUInt32BE (1, 74); //ctsaves
	theHeader.writeUInt16BE (0xFFFF, 92); //backcolor white, the kernel's default
	theHeader.writeUInt16BE (0xFFFF, 94);
	theHeader.writeUInt16BE (0xFFFF, 96);
	theHeader.write ("mac ", 104, "latin1"); //platform
	return (theHeader);
	}

function packOutline (theLines, refconForLine) {

	/*  Two sections after the header: tab-indented CR-separated text, then
		a line table -- flags short, refcon length long, then the refcon
		bytes when a caller supplies them. Only the menubar packer does;
		everything else writes zero-length refcons, the way the kernel does
		for a plain outline whose lines carry nothing.  */

	const theTextParts = [], theTableParts = [];
	const theParentsExpanded = []; //9/15/26 by CC -- flExpanded of the open ancestors, by level; see parseOutlineSections for the bit's meaning
	theLines.forEach (function (theLine) {
		const theLevel = (theLine.level === undefined) ? 0 : theLine.level;
		theTextParts.push (Buffer.alloc (theLevel, 9)); //tabs
		theTextParts.push (bytesForString (String ((theLine.text === undefined) ? "" : theLine.text)));
		theTextParts.push (Buffer.from ([13])); //carriage return

		var theFlags = 0;
		theParentsExpanded.length = theLevel;
		const flShowing = (theLevel === 0) ? true : (theParentsExpanded [theLevel - 1] === true); //summits are always showing (opstructure.c); a sub shows when its parent is expanded
		theParentsExpanded [theLevel] = (theLine.flExpanded === true);
		if (flShowing) {
			theFlags = theFlags | 0x8000;
			}
		if (theLine.flComment === true) {
			theFlags = theFlags | 0x0400;
			}
		if (theLine.flBreakpoint === true) {
			theFlags = theFlags | 0x0200;
			}
		const theRefcon = (refconForLine === undefined) ? undefined : refconForLine (theLine);
		const theEntry = Buffer.alloc (6);
		theEntry.writeUInt16BE (theFlags, 0);
		theEntry.writeUInt32BE ((theRefcon === undefined) ? 0 : theRefcon.length, 2);
		theTableParts.push (theEntry);
		if (theRefcon !== undefined) {
			theTableParts.push (theRefcon);
			}
		});

	const theText = Buffer.concat (theTextParts);
	const theTable = Buffer.concat (theTableParts);

	return (Buffer.concat ([packKernelOutlineHeader (theText.length, theTable.length), theText, theTable]));
	}

function packListItem (theItem, thePath) {

	/*  9/8/26 by CC -- langpackvalue (langpack.c): a four-character type
		id, then the bytes of the value and nothing else -- the size of the
		refcon says where the value ends. The ids are typeinfo in langops.c:
		TEXT, bool, long, exte (a double, 8 bytes on the Mac), date, char,
		addr (the path, no length byte), list (a packed list, below).  */

	function withId (theId, theBytes) {
		return (Buffer.concat ([Buffer.from (theId, "latin1"), theBytes]));
		}
	if ((theItem === undefined) || (theItem === null)) {
		return (withId ("????", Buffer.alloc (0)));
		}
	if (typeof theItem === "string") {
		return (withId ("TEXT", bytesForString (theItem)));
		}
	if (typeof theItem === "boolean") {
		return (withId ("bool", Buffer.from ([theItem ? 1 : 0])));
		}
	if ((typeof theItem === "number") && Number.isInteger (theItem) && (theItem >= -2147483648) && (theItem <= 2147483647)) {
		const theBytes = Buffer.alloc (4);
		theBytes.writeInt32BE (theItem, 0);
		return (withId ("long", theBytes));
		}
	if ((typeof theItem === "number") || (theItem instanceof Number)) {
		const theBytes = Buffer.alloc (8);
		theBytes.writeDoubleBE (Number (theItem), 0);
		return (withId ("exte", theBytes));
		}
	if (theItem instanceof Date) {
		const theBytes = Buffer.alloc (4);
		theBytes.writeUInt32BE (macSecondsForDate (theItem), 0);
		return (withId ("date", theBytes));
		}
	if (Array.isArray (theItem)) {
		return (withId ("list", packList (theItem, thePath)));
		}
	if ((theItem.flOdbChar === true) || ((theItem.type === "char") && (typeof theItem.value === "number"))) {
		return (withId ("char", Buffer.from ([((theItem.flOdbChar === true) ? theItem.valueOf () : theItem.value) & 255])));
		}
	if ((theItem.flAddress === true) || (theItem.flOdbAddressText === true) || (theItem.type === "address")) {
		return (withId ("addr", bytesForString (String ((theItem.pathText !== undefined) ? theItem.pathText : theItem.path))));
		}
	const message = "Can't write the list at " + thePath + " because one of its items is a " + ((theItem.type === undefined) ? typeof theItem : theItem.type) + ", and a list can hold only scalars here.";
	throw new Error (message);
	}

function packList (theArray, thePath) {

	/*  9/8/26 by CC -- oppacklist (oplist.c): the 12-byte tydisklistrecord
		-- recordsize, versionnumber 1, ctoutlinebytes, ctitems, an unused
		byte, isrecord -- then the items as a packed outline, one summit per
		item with the item's packed value in the line's refcon (oppushhandle).
		An empty list keeps its one empty summit, the line the first item
		reuses. DW's 9/6 list: the writer used to refuse a full list by name.  */

	const theLines = [];
	theArray.forEach (function (theItem, ix) {
		theLines.push ({level: 0, text: "", flExpanded: true, refconBytes: packListItem (theItem, thePath + " [" + (ix + 1) + "]")});
		});
	if (theLines.length === 0) {
		theLines.push ({level: 0, text: "", flExpanded: true});
		}
	const theOutline = packOutline (theLines, function (theLine) {
		return (theLine.refconBytes);
		});
	const theHeader = Buffer.alloc (12);
	theHeader.writeInt16BE (12, 0); //recordsize
	theHeader.writeInt16BE (1, 2); //versionnumber
	theHeader.writeUInt32BE (theOutline.length, 4); //ctoutlinebytes
	theHeader.writeInt16BE ((theArray.length > 0x7fff) ? -1 : theArray.length, 8); //ctitems, -1 when it doesn't fit
	theHeader [10] = 0; //flunused
	theHeader [11] = 0; //isrecord
	return (Buffer.concat ([theHeader, theOutline]));
	}

function packMenubar (theLines) {

	/*  The kernel's mepackmenustructure (menupack.c): a mergehandles pair.
		Part 1 is a tysavedmenuinfo record -- 112 bytes, version 1, the
		size checked against menubars Frontier itself wrote -- followed by
		the menubar outline, each line's refcon a tymenuiteminfo: cmdkey
		byte, cmdmodifiers byte, adrlink long, houtline long. Part 2 is the
		linked scripts, one packed outline after another, in the order a
		walk of the outline meets the lines that carry one --
		meunpackscriptvisit matches script to line by either link long
		being nonzero, so houtline is written 1 for a line with a script.

		by CC, 8/24/26 -- read from menupack.c and menueditor.h in the 2011
		kernel source  */

	const theScriptParts = [];
	function refconForLine (theLine) {
		const flScript = (theLine.script !== undefined) && (theLine.script !== null);
		if ((theLine.cmdkey === undefined) && (!flScript)) {
			return (undefined);
			}
		const theRefcon = Buffer.alloc (10);
		if (theLine.cmdkey !== undefined) {
			theRefcon [0] = bytesForString (String (theLine.cmdkey)) [0];
			}
		if (flScript) {
			theRefcon.writeUInt32BE (1, 6); //houtline nonzero says a script follows in part 2
			theScriptParts.push (packOutline (theLine.script.lines));
			}
		return (theRefcon);
		}

	const theOutline = packOutline (theLines, refconForLine);

	const theInfo = Buffer.alloc (112); //tysavedmenuinfo (menueditor.h), 2-byte alignment
	theInfo.writeUInt16BE (1, 0); //versionnumber -- mesavemenurecord writes 1
	//adroutline stays 0 -- the unpacker's meunpackmenustructure resets it to nildbaddress anyway

	return (mergeHandles (Buffer.concat ([theInfo, theOutline]), Buffer.concat (theScriptParts)));
	}

function packTable (theTable, theDepth) {

	if (theDepth > 100) {
		const message = "Can't pack the table because it's nested more than 100 levels deep.";
		throw new Error (message);
		}

	const theStringParts = []; //the strings block, built as we go
	var ctStringBytes = 0;

	function addPascalString (theName) { //answers the offset the record points at
		const theBytes = bytesForString (theName);
		if (theBytes.length > 255) {
			const message = "Can't pack the table because the name " + theName + " is longer than 255 characters.";
			throw new Error (message);
			}
		const theEntry = Buffer.concat ([Buffer.from ([theBytes.length]), theBytes]);
		const ixEntry = ctStringBytes;
		theStringParts.push (theEntry);
		ctStringBytes += theEntry.length;
		return (ixEntry);
		}

	function addScalarBytes (theBytes) { //[4-byte length][bytes]; the -1 form is .root files only
		const theLength = Buffer.alloc (4);
		theLength.writeInt32BE (theBytes.length, 0);
		const theEntry = Buffer.concat ([theLength, theBytes]);
		const ixEntry = ctStringBytes;
		theStringParts.push (theEntry);
		ctStringBytes += theEntry.length;
		return (ixEntry);
		}

	const theRecordParts = [];

	const theHeader = Buffer.alloc (16); //version, sortorder, timecreated, timelastsave, flags
	theHeader.writeUInt16BE (3, 0);
	theHeader.writeUInt16BE (0, 2);
	const theNow = macSecondsForDate (new Date ());
	theHeader.writeUInt32BE (theNow, 4);
	theHeader.writeUInt32BE (theNow, 8);
	theHeader.writeUInt32BE (0, 12);
	theRecordParts.push (theHeader);

	Object.keys (theTable).forEach (function (theName) {
		if ((theName === "flOdbSqlTable") || (theName === "odbId")) { //storage bookkeeping, not part of the value
			return;
			}
		const theValue = theTable [theName];
		const ixName = addPascalString (theName);

		const theRecord = Buffer.alloc (10);
		theRecord.writeUInt32BE (ixName, 0);
		theRecord [5] = 0; //version

		function setType (theCode) {
			theRecord [4] = theCode;
			}

		if (theValue === undefined) {
			setType (0); //novalue
			}
		else {
			if (typeof theValue === "string") {
				setType (12); //string
				theRecord.writeUInt32BE (addScalarBytes (bytesForString (theValue)), 6);
				}
			else {
				if (typeof theValue === "boolean") {
					setType (6);
					theRecord [6] = theValue ? 1 : 0;
					}
				else {
					if (typeof theValue === "number") {
						if (Number.isInteger (theValue) && (theValue >= -2147483648) && (theValue <= 2147483647)) {
							setType (3); //long
							theRecord.writeInt32BE (theValue, 6);
							}
						else {
							setType (23); //single -- a 4-byte float, which the unpacker reads directly
							theRecord.writeFloatBE (theValue, 6);
							}
						}
					else {
						if (theValue instanceof Date) {
							setType (8);
							theRecord.writeUInt32BE (macSecondsForDate (theValue), 6);
							}
						else if (theValue instanceof Number) { //8/24/26 by CC -- a real double, 8 bytes
							setType (11);
							const theBytes = Buffer.alloc (8);
							theBytes.writeDoubleBE (Number (theValue), 0);
							theRecord.writeUInt32BE (addScalarBytes (theBytes), 6);
							}
						else if ((theValue.flOdbChar === true) || ((theValue.type === "char") && (typeof theValue.value === "number"))) { //8/26/26 by CC -- a char is one byte in the record, the way the reader takes it out
							setType (1);
							theRecord [6] = ((theValue.flOdbChar === true) ? theValue.valueOf () : theValue.value) & 255;
							}
						else if ((theValue.flAddress === true) || (theValue.flOdbAddressText === true) || (theValue.type === "address")) { //8/24/26 by CC -- an address is its path, a pascal string
							setType (9);
							const theBytes = bytesForString (String ((theValue.pathText !== undefined) ? theValue.pathText : theValue.path));
							theRecord.writeUInt32BE (addPascalString (theBytes.length > 255 ? "" : macRomanToString (theBytes)), 6);
							}
						else if ((theValue.type === "point") && (theValue.v !== undefined)) { //8/24/26 by CC
							setType (18);
							theRecord.writeInt16BE (theValue.v, 6);
							theRecord.writeInt16BE (theValue.h, 8);
							}
						else if ((theValue.type === "binary") && (theValue.data !== undefined)) { //8/24/26 by CC -- the bytes themselves
							setType (5);
							theRecord.writeUInt32BE (addScalarBytes (handleFromBinaryValue (theValue)), 6);
							}
						else if (Array.isArray (theValue)) { //9/8/26 by CC -- a list, packed the kernel's way
							setType (29);
							theRecord.writeUInt32BE (addScalarBytes (packList (theValue, theName)), 6);
							}
						else if ((theValue.raw !== undefined) && (scalarCodeForRawName [theValue.type] !== undefined)) { //8/24/26 by CC -- a scalar the reader kept whole goes back byte for byte
							setType (scalarCodeForRawName [theValue.type]);
							theRecord.writeUInt32BE (addScalarBytes (Buffer.from (String (theValue.raw), "base64")), 6);
							}
						else {
							setType (13); //external: the packed object goes in the strings block, length-prefixed
							theRecord.writeUInt32BE (addScalarBytes (packExternal (theValue, theDepth + 1)), 6);
							}
						}
					}
				}
			}
		theRecordParts.push (theRecord);
		});

	const theRecords = Buffer.concat (theRecordParts);
	const theStrings = Buffer.concat (theStringParts);

	const theInner = mergeHandles (theRecords, theStrings);
	return (mergeHandles (theInner, Buffer.alloc (0))); //part2 is the display formats; none of ours carry any
	}

function packExternal (theValue, theDepth) { //[version short][id byte][pad], then the data inline

	var theId, theData;

	if ((theValue !== null) && (typeof theValue === "object") && (theValue.raw !== undefined) && (memoryExternalIdForName [theValue.type] !== undefined) && (theValue.lines === undefined) && (theValue.value === undefined)) {
		theId = memoryExternalIdForName [theValue.type]; //8/24/26 by CC -- bytes the reader kept whole -- a wptext above all -- go back exactly as Frontier wrote them
		theData = Buffer.from (String (theValue.raw), "base64");
		}
	else if ((theValue !== null) && (typeof theValue === "object") && (theValue.flWpText === true) && (theValue.raw !== undefined)) {
		theId = 1; //wptext from the working copy, its original bytes intact
		theData = Buffer.from (String (theValue.raw), "base64");
		}
	else if ((theValue !== null) && (typeof theValue === "object") && ((theValue.flOdbMenubar === true) || (theValue.type === "menubar"))) {
		theId = 5; //menubar -- packMenubar writes the mergehandles pair mepackmenustructure writes
		theData = packMenubar (theValue.lines);
		}
	else {
		if ((theValue !== null) && (typeof theValue === "object") && Array.isArray (theValue.lines)) {
			theId = (theValue.scriptType === "outline") ? 0 : 4;
			theData = packOutline (theValue.lines);
			}
		else {
			if ((theValue !== null) && (typeof theValue === "object")) {
				theId = 3;
				theData = packTable (theValue, (theDepth === undefined) ? 0 : theDepth);
				}
			else {
				const message = "Can't pack the value because only tables, scripts and outlines can be packed as an object.";
				throw new Error (message);
				}
			}
		}

	const theHeader = Buffer.alloc (4);
	theHeader.writeUInt16BE (1, 0); //version
	theHeader [2] = theId;
	theHeader [3] = 0;
	return (Buffer.concat ([theHeader, theData]));
	}


function packMemoryValue (theValue) {
	return (packExternal (theValue, 0));
	}

/*  THE ROOT WRITER -- 8/24/26 by CC. Write a real Frontier .root file, the
	block file db.c describes, so a database Atlantis saves is a file
	Frontier itself opens. DW's ruling: the .root file is the disk truth
	and SQL is the invisible working copy -- "that's the answer, it's the
	best we can do, and it's pretty good."

	The format, from db.c and dbinternal.h in the 2011 source: the file
	opens with an 88-byte tydatabaserecord -- system id, version, the
	avail list, three view addresses. Blocks follow, each an 8-byte header
	(a size long whose high bit means free, then the variance -- allocated
	minus used), the data, and a 4-byte trailer repeating the size. Blocks
	are never smaller than 32 data bytes (minblocksize in dballocate).
	views [0] is the cancoon record, 442 bytes (tyversion2cancoonrecord,
	asserted in cancoon.c), whose adrroottable points at the packed root
	table. A table's externals carry a version, an id and a block address;
	scalars ride inline in the strings block.

	A save writes the whole file fresh, every block in dependency order,
	the avail list empty -- the shape dballocate's append path makes, with
	none of the in-place block juggling that made roots fragile. The
	header and cancoon record are cloned from a file Frontier wrote
	(templates below) and patched, so every field this code doesn't
	understand carries bytes the kernel put there.

	What it writes: tables, scripts, outlines, menubars, strings, numbers,
	doubles, booleans, dates, addresses, binaries, and since 9/8/26 lists,
	packed the way oppacklist and langpackvalue pack them. A marker (a
	value the reader couldn't decode) is refused rather than written as
	garbage.  */

/*  The cancoon record template: the real 442 bytes from the record inside
	misc/Inactive Tools/rssCodeUpdate.root, written by Frontier itself, so
	the window rects and fonts carry values the kernel put there. The
	writer patches adrroottable and zeroes adrscriptstring -- the only two
	fields holding block addresses (tycancoonwindowinfo is geometry and
	font names, checked in cancoon.h).  */

const cancoonTemplate = Buffer.from (
	"AAMADKRQAhgC+AKuBIgNTHVjaWRhIEdyYW5kZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAQADAAAAAAAAAAAAAAAAAAAAAD//////////w1MdWNpZGEgR3JhbmRlAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAMAAAAAAAAAAAAAAAAAAAAAADYALABpwNzBkdlbmV2YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAkAAAAAAAAAAAAAAAAAAAAAAjYC/QKQBIMNTHVjaWRhIEdyYW5kZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAQADAAAAAAAAAAAAAAAAAAAAAACRQLuAoEEkg1MdWNpZGEgR3JhbmRlAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAMAAAAAAAAAAAAAAAAAAAAAP//////////DUx1Y2lkYSBHcmFuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==", "base64");

function packDbScalarString (theStringsParts, theState, theBytes) { //[4-byte length][bytes] in the strings block; answers the offset
	const theLength = Buffer.alloc (4);
	theLength.writeInt32BE (theBytes.length, 0);
	const ixEntry = theState.ctStringBytes;
	theStringsParts.push (theLength, theBytes);
	theState.ctStringBytes += 4 + theBytes.length;
	return (ixEntry);
	}

function writeRootFile (path, theRootTable, theProgress) {

	const theBlocks = [];
	var nextAddress = 88; //firstphysicaladdress -- sizeof (tydatabaserecord)

	function writeBlock (dataBuffer) {
		const databytes = dataBuffer.length;
		const nodebytes = Math.max (databytes, 32); //minblocksize
		const theBlock = Buffer.alloc (8 + nodebytes + 4);
		theBlock.writeUInt32BE (nodebytes, 0); //in use -- high bit clear
		theBlock.writeUInt32BE (nodebytes - databytes, 4); //variance
		dataBuffer.copy (theBlock, 8);
		theBlock.writeUInt32BE (nodebytes, 8 + nodebytes); //the trailer
		const theAddress = nextAddress;
		theBlocks.push (theBlock);
		nextAddress += theBlock.length;
		return (theAddress);
		}

	function packDbOutlineBlock (theLines, refconForLine) {
		return (writeBlock (packOutline (theLines, refconForLine)));
		}

	function packDbMenubarBlock (theLines) {

		/*  The in-database form meloadmenurecord reads: each command's
			script in its own block, the menubar outline with each line's
			refcon carrying its script's block address, and a 112-byte
			savedmenuinfo whose adroutline points at the outline.  */

		function refconForLine (theLine) {
			const flScript = (theLine.script !== undefined) && (theLine.script !== null);
			if ((theLine.cmdkey === undefined) && (!flScript)) {
				return (undefined);
				}
			const theRefcon = Buffer.alloc (10);
			if (theLine.cmdkey !== undefined) {
				theRefcon [0] = bytesForString (String (theLine.cmdkey)) [0];
				}
			if (flScript) {
				theRefcon.writeUInt32BE (writeBlock (packOutline (theLine.script.lines)), 2); //adrlink
				}
			return (theRefcon);
			}
		const adrOutline = packDbOutlineBlock (theLines, refconForLine);
		const theInfo = Buffer.alloc (112); //tysavedmenuinfo
		theInfo.writeUInt16BE (1, 0); //versionnumber
		theInfo.writeUInt32BE (adrOutline, 2); //adroutline
		return (writeBlock (theInfo));
		}

	const externalIdForName = {outline: 0, wptext: 1, headrecord: 2, table: 3, script: 4, menubar: 5, pict: 6, card: 7};
	const scalarCodeForName = {char: 1, int: 2, oldstring: 4, token: 7, code: 10, direction: 14, password: 15, ostype: 16, point: 18, rect: 19, pattern: 20, rgb: 21, fixed: 22, single: 23, olddouble: 24, objspec: 25, filespec: 26, alias: 27, enum: 28, list: 29, record: 30};

	function packDbExternalRecord (theValue, thePath) { //[version][id][pad][block address] -- the 8 bytes a table's strings block carries
		var theId, theAddress;
		if ((externalIdForName [theValue.type] !== undefined) && (theValue.lines === undefined) && (theValue.value === undefined)) {
			theId = externalIdForName [theValue.type]; //8/24/26 by CC -- bytes the reader kept whole go back exactly as Frontier wrote them; a wptext keeps its fonts and styles this way. 9/6/26 -- a marker without bytes goes out as an empty block
			theAddress = writeBlock (Buffer.from ((theValue.raw === undefined) ? "" : String (theValue.raw), "base64"));
			}
		else if ((theValue.flOdbMenubar === true) || (theValue.type === "menubar")) {
			theId = 5;
			theAddress = packDbMenubarBlock (theValue.lines);
			}
		else if (Array.isArray (theValue.lines)) {
			theId = ((theValue.scriptType === "outline") || (theValue.type === "outline")) ? 0 : 4;
			theAddress = packDbOutlineBlock (theValue.lines);
			}
		else {
			theId = 3;
			theAddress = packDbTable (theValue, thePath);
			}
		const theRecord = Buffer.alloc (8);
		theRecord.writeUInt16BE (1, 0); //version
		theRecord [2] = theId;
		theRecord [3] = 0;
		theRecord.writeUInt32BE (theAddress, 4);
		return (theRecord);
		}

	function packDbTable (theTable, thePath) {

		const theValue = (theTable.type === "table") ? theTable.value : theTable; //takes the decoder's shape and the odb shape both

		const theStringsParts = [];
		const theState = {ctStringBytes: 0};
		const theRecordParts = [];

		const theHeader = Buffer.alloc (16); //version, sortorder, timecreated, timelastsave, flags
		theHeader.writeUInt16BE (3, 0);
		const theNow = macSecondsForDate (new Date ());
		theHeader.writeUInt32BE (theNow, 4);
		theHeader.writeUInt32BE (theNow, 8);
		theRecordParts.push (theHeader);

		Object.keys (theValue).forEach (function (theName) {
			if ((theName === "flOdbSqlTable") || (theName === "odbId")) {
				return;
				}
			const childPath = (thePath === "") ? theName : thePath + "." + theName;
			const child = theValue [theName];
			const theNameBytes = bytesForString (theName);
			if (theNameBytes.length > 255) {
				const message = "Can't write the root because the name " + childPath + " is longer than 255 characters.";
				throw new Error (message);
				}
			const ixName = theState.ctStringBytes;
			theStringsParts.push (Buffer.from ([theNameBytes.length]), theNameBytes);
			theState.ctStringBytes += 1 + theNameBytes.length;

			const theRecord = Buffer.alloc (10);
			theRecord.writeUInt32BE (ixName, 0);
			theRecord [5] = 0; //version byte

			function setType (theCode) {
				theRecord [4] = theCode;
				}

			if (child === undefined) {
				setType (0); //novalue
				}
			else if (typeof child === "string") {
				setType (12);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, bytesForString (child)), 6);
				}
			else if (typeof child === "boolean") {
				setType (6);
				theRecord [6] = child ? 1 : 0;
				}
			else if (typeof child === "number") {
				if (Number.isInteger (child) && (child >= -2147483648) && (child <= 2147483647)) {
					setType (3); //long
					theRecord.writeInt32BE (child, 6);
					}
				else {
					setType (11); //double, 8 bytes in the strings block
					const theBytes = Buffer.alloc (8);
					theBytes.writeDoubleBE (child, 0);
					theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, theBytes), 6);
					}
				}
			else if (child instanceof Number) {
				setType (11);
				const theBytes = Buffer.alloc (8);
				theBytes.writeDoubleBE (Number (child), 0);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, theBytes), 6);
				}
			else if (child instanceof Date) {
				setType (8);
				theRecord.writeUInt32BE (macSecondsForDate (child), 6);
				}
			else if (child === null) {
				setType (0);
				}
			else if (Array.isArray (child)) { //9/8/26 by CC -- a list, full or empty, packed the way oppacklist does it; the writer used to refuse a full one by name
				setType (29);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, packList (child, childPath)), 6);
				}
			else if ((child.flOdbChar === true) || ((child.type === "char") && (typeof child.value === "number"))) { //8/26/26 by CC -- a char is one byte in the record
				setType (1);
				theRecord [6] = ((child.flOdbChar === true) ? child.valueOf () : child.value) & 255;
				}
			else if ((child.flAddress === true) || (child.flOdbAddressText === true) || (child.type === "address")) {
				setType (9);
				const thePathText = String ((child.pathText !== undefined) ? child.pathText : child.path);
				const theBytes = bytesForString (thePathText);
				if (theBytes.length > 255) {
					const message = "Can't write the root because the address at " + childPath + " is longer than 255 characters.";
					throw new Error (message);
					}
				const ixAddress = theState.ctStringBytes;
				theStringsParts.push (Buffer.from ([theBytes.length]), theBytes);
				theState.ctStringBytes += 1 + theBytes.length;
				theRecord.writeUInt32BE (ixAddress, 6);
				}
			else if ((child.type === "point") && (child.v !== undefined)) {
				setType (18); //v then h, two shorts, right in the record -- the way the reader takes them out
				theRecord.writeInt16BE (child.v, 6);
				theRecord.writeInt16BE (child.h, 8);
				}
			else if ((child.type === "binary") && (child.data !== undefined)) {
				setType (5);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, handleFromBinaryValue (child)), 6);
				}
			else if ((child.flWpText === true) && (child.raw !== undefined)) {
				setType (13); //a wptext from the working copy, its original bytes intact
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, packDbExternalRecord ({type: "wptext", raw: child.raw}, childPath)), 6);
				}
			else if ((child.flWpText === true)) {

				/*  9/6/26 by CC -- A WORD-PROCESSING TEXT WITHOUT ITS BYTES
					GOES OUT AS A STRING. The packed form is the licensed Paige
					engine's (wpengine.c, wppacktext), not something to write
					fresh. frontier.root has 19 of these, all in
					suites.people.webAdmin; the copy carries their text as a
					string, and the report says so. Refusing meant
					fileMenu.saveCopy of the root could never finish.  */

				setType (12);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, bytesForString (String (child.text))), 6);
				}
			else if ((externalIdForName [child.type] !== undefined) && (child.lines === undefined) && (child.value === undefined)) {
				setType (13); //an external the reader kept whole -- wptext above all; the bytes go back exactly. 9/6/26: one kept without its bytes (a pict marker from before tonight) goes out as an empty block, see the scalar case below
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, packDbExternalRecord (child, childPath)), 6);
				}
			else if ((child.type === "binary") && (child.data === undefined)) { //9/6/26 by CC -- a binary kept as a marker without its bytes: empty
				setType (5);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, Buffer.alloc (0)), 6);
				}
			else if ((child.raw !== undefined) && (scalarCodeForName [child.type] !== undefined)) {
				setType (scalarCodeForName [child.type]); //a scalar the reader didn't decode -- code, rect, pattern -- goes back byte for byte
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, Buffer.from (String (child.raw), "base64")), 6);
				}
			else if ((child.flFilespec === true) || ((child.type !== undefined) && (scalarCodeForName [child.type] !== undefined) && (child.lines === undefined) && (child.value === undefined))) {

				/*  9/6/26 by CC -- A SCALAR WITH NO BYTES GOES OUT EMPTY, NOT
					REFUSED. Databases made before tonight kept a marker's type
					and length but not its bytes (57 of them in frontier.root,
					filespecs and rects), and a filespec made at runtime never
					had alias bytes at all. fileMenu.saveCopy of the root
					stopped on the first one: "Can't write the root because
					config.mainresponder.domains.default is a filespec the
					reader kept as a marker." The value goes out as its own
					type with zero bytes; Atlantis reads that back as a marker
					of length 0, and Frontier sees an empty scalar of the type.
					The one that still can't be written is an external without
					its bytes, below.  */

				setType ((child.flFilespec === true) ? 26 : scalarCodeForName [child.type]);
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, Buffer.alloc (0)), 6);
				}
			else if ((child.type !== undefined) && (child.lines === undefined) && (child.value === undefined)) {
				const message = "Can't write the root because " + childPath + " is a " + child.type + " the reader kept as a marker, and there are no bytes to write for it.";
				throw new Error (message);
				}
			else {
				setType (13); //external -- the record goes inline, the data in its own block
				theRecord.writeUInt32BE (packDbScalarString (theStringsParts, theState, packDbExternalRecord (child, childPath)), 6);
				}
			theRecordParts.push (theRecord);
			if (theProgress !== undefined) {
				theProgress (childPath);
				}
			});

		const theRecords = Buffer.concat (theRecordParts);
		const theStrings = Buffer.concat (theStringsParts);
		const theInner = mergeHandles (theRecords, theStrings);
		return (writeBlock (mergeHandles (theInner, Buffer.alloc (0)))); //part2 is the display formats; none yet
		}

	const adrRootTable = packDbTable (theRootTable, "");

	const ccBytes = Buffer.alloc (442); //tyversion2cancoonrecord, sizes asserted in cancoon.c
	cancoonTemplate.copy (ccBytes, 0);
	ccBytes.writeUInt16BE (3, 0); //cancoonversionnumber
	ccBytes.writeUInt32BE (adrRootTable, 2); //adrroottable
	ccBytes.writeUInt32BE (0, 378); //adrscriptstring -- the donor's would point at a block this file doesn't have
	const adrCancoon = writeBlock (ccBytes);

	const theFileHeader = Buffer.alloc (88); //tydatabaserecord, every field patched below; zeros everywhere the kernel keeps in-memory state
	theFileHeader [0] = 0; //systemid Mac
	theFileHeader [1] = 5; //version 5 -- readable by every 5-and-6 reader, no cached avail list to carry
	theFileHeader.writeUInt32BE (0, 2); //availlist empty: a fresh write has no free blocks
	theFileHeader.writeUInt16BE (0, 6); //oldfnumdatabase
	theFileHeader.writeUInt16BE (0, 8); //flags
	theFileHeader.writeUInt32BE (adrCancoon, 10); //views [0]
	theFileHeader.writeUInt32BE (0, 14);
	theFileHeader.writeUInt32BE (0, 18);
	theFileHeader.fill (0, 22); //every in-memory field and the growth space

	fs.writeFileSync (path, Buffer.concat ([theFileHeader].concat (theBlocks)));
	return (path);
	}

function binaryValueFromHandle (theBytes) { //9/25/26 by CC -- a binary handle in Frontier is its four-byte type followed by the bytes (langvalue.c, setbinarytypeid, getbinarytypeid); the value here keeps them apart, binaryType and data, the shape binary () and setBinaryType make. Before today the type rode inside data, so string (aGif) began with "GIFf" and the file getImageData wrote wasn't a GIF, and getBinaryType answered "????" for every image out of a .root
	if ((theBytes === undefined) || (theBytes.length < 4)) {
		return ({type: "binary", binaryType: "????", data: (theBytes === undefined) ? "" : theBytes.toString ("latin1")});
		}
	return ({type: "binary", binaryType: theBytes.slice (0, 4).toString ("latin1"), data: theBytes.slice (4).toString ("latin1")});
	}

function handleFromBinaryValue (theValue) { //the inverse: the type in front of the bytes, the way the kernel keeps them; a value made here with no type gets "????", the kernel's stringtobinary stamp
	const theType = ((theValue.binaryType === undefined) || (String (theValue.binaryType).length !== 4)) ? "????" : String (theValue.binaryType);
	return (Buffer.concat ([Buffer.from (theType, "latin1"), Buffer.from (String (theValue.data), "latin1")]));
	}

exports.readRootFile = readRootFile;
exports.readFatPage = readFatPage;
exports.unpackMemoryValue = unpackMemoryValue;
exports.packMemoryValue = packMemoryValue; //8/23/26 by CC -- the inverse; fatPages.encodePageData is the customer
exports.writeRootFile = writeRootFile; //8/24/26 by CC -- a database Atlantis saves is a file Frontier opens
exports.getAddress = getAddress;
exports.macRomanToString = macRomanToString; //8/3/26 by CC -- so callers can build the exact inverse encoding
exports.myVersion = myVersion;
