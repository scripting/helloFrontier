/*  Windows follow databases -- 8/8/26 by CC, DW's model. One SQL file
	holds everything, but a window never shows the merged root: it opens on
	ONE logical database (?database=nodeEditor.root, resolved through
	/getdatabases into a mount address or a list of top-level names), or
	rooted at a table address (?address=config, how the edit verb opens a
	table). With neither param the page shows the merged root -- a storage
	artifact, kept reachable for plumbing work but never the default.  */

var theScope; //assigned at startup: {title, address, names} -- what this window shows

function scopeStateKey () { //each window remembers its own expansions and scroll
	var theKey = "odbBrowserState";
	if (theScope.title !== "frontier.root") {
		theKey += ":" + theScope.title;
		}
	return (theKey);
	}

function resolveScope (callback) {
	const theParams = new URLSearchParams (window.location.search);
	const theDatabase = theParams.get ("database");
	const theAddress = theParams.get ("address");
	const theTitle = theParams.get ("title");
	if ((theDatabase !== null) && (theDatabase.length > 0)) {
		serverCall ("/getdatabases", {}, "GET", function (err, data) {
			if (err !== undefined) {
				callback (err);
				return;
				}
			var found;
			data.databases.forEach (function (theRecord) {
				if (theRecord.name === theDatabase) {
					found = theRecord;
					}
				});
			if (found === undefined) {
				callback ({message: "Can't open " + theDatabase + " because it isn't in the list of databases."});
				return;
				}
			const theNames = ((found.names !== undefined) && (found.names.length > 0)) ? found.names : undefined; //an empty list means the address IS the scope
			callback (undefined, {title: theDatabase, address: found.address, names: theNames});
			});
		return;
		}
	if ((theAddress !== null) && (theAddress.length > 0)) {
		const theCursorName = theParams.get ("cursor"); //8/12/26 by CC -- a window opened on a value lands on its line
		callback (undefined, {
			title: ((theTitle !== null) && (theTitle.length > 0)) ? theTitle : theAddress,
			address: theAddress,
			cursorName: ((theCursorName === null) || (theCursorName.length === 0)) ? undefined : theCursorName
			});
		return;
		}
	/*  9/5/26 by CC -- THE GUESTS STAY OUT OF frontier.root's WINDOW. The
		Tools roots' names, config.root's mount, and any table named by a
		file path (fileMenu.open's shape, and the 2012 root's own leftover)
		are open guest databases; in the kernel they live in the
		filewindowtable and the root window never lists them. DW's 9/5
		report: frontier.root "still has a lot of non-frontier.root objects
		listed" -- manilaSuite, worldOutlineSuite, the C:\Program Files table
		-- and his ruling: "the elements of the database should not be in the
		window for frontier.root." The list of databases says whose names
		they are; this window leaves those names out.  */

	fetchGuestNames (function (hiddenNames) {
		callback (undefined, {title: "frontier.root", address: "", hiddenNames: (hiddenNames === undefined) ? {} : hiddenNames}); //the root, frontier.root itself -- DW's 8/22 ruling: the paramless view IS frontier.root; it said "the odb" until 9/4, a name of ours that meant nothing to him
		});
	}

function fetchGuestNames (callback) { //the top-level names that belong to open guest databases, lowercased, as the server lists them now; undefined when the server couldn't be asked

	/*  10/1/26 by CC -- ASKED EVERY TIME THE WINDOW LISTS ITS TOP LEVEL, not
		once when it opens. The list was taken at open and kept, so a database
		opened after that -- each day's log file the first time something is
		logged, a data file a script opens -- was a table named by its file
		path in frontier.root's window until the window was closed and opened
		again: DW's 9/29 report, eleven tables named "Macintosh
		HD:Users:...", and 9/30, "its a display bug of a sort. the data isn't
		actually there." The 9/5 ruling this serves: "the elements of the
		database should not be in the window for frontier.root."  */

	serverCall ("/getdatabases", {}, "GET", function (err, data) {
		if ((err !== undefined) || (data === undefined) || !Array.isArray (data.databases)) {
			callback (undefined);
			return;
			}
		const hiddenNames = {};
		data.databases.forEach (function (theRecord) {
			if (theRecord.name === "frontier.root") {
				return;
				}
			if (Array.isArray (theRecord.names) && (theRecord.names.length > 0)) {
				theRecord.names.forEach (function (theName) {
					hiddenNames [String (theName).toLowerCase ()] = true;
					});
				return;
				}
			if (theRecord.topName !== undefined) { //a path-named table: an open guest kept the kernel's way
				hiddenNames [String (theRecord.topName).toLowerCase ()] = true;
				return;
				}
			if ((typeof theRecord.address === "string") && (theRecord.address.length > 0)) { //a guest mounted at an address of its own: config.root at root.config
				hiddenNames [theRecord.address.split (".") [0].toLowerCase ()] = true;
				}
			});
		callback (hiddenNames);
		});
	}

$(document).ready (function () {
	if (!getPassword ()) { //the password form is on screen -- the page starts over after Connect
		return;
		}
	showVersion ();
	letTheRightClickThrough ();
	resolveScope (function (err, scope) {
		if (err !== undefined) {
			$(".divWindowTitle").text (err.message);
			return;
			}
		theScope = scope;
		document.title = theScope.title;
		$(".divWindowTitle").text (theScope.title);
		theState = readState ();
		if (((theScope.address === undefined) || (theScope.address.length === 0)) && (Array.isArray (theState.colWidths))) { //8/27/26 by CC -- a window with no single table remembers its own widths
			theColumnWidths = theState.colWidths;
			}
		if (((theScope.address === undefined) || (theScope.address.length === 0)) && (typeof theState.sortOrder === "string")) { //8/29/26 by CC -- and its sort order
			theSortOrder = theState.sortOrder;
			}
		startOutliner ();
		});
	});

function startOutliner () {
	$("#divOutliner").concord ({
		prefs: {
			outlineFont: "Lucida Grande",
			outlineFontSize: 14,
			outlineLineHeight: 24,
			renderMode: false,
			readonly: true
			},
		callbacks: {
			opExpand: expandCallback,
			opCollapse: collapseCallback,
			opCursorMoved: cursorMovedCallback, //8/16/26 by CC -- the cursor is part of what the window remembers, DW: "that goes for all outlines, including tables"
			opReorg: reorgCallback //9/6/26 by CC -- a row moved into another table moves the object
			}
		});
	nudgeOutlineText (); //9/9/26 by CC -- two pixels up, DW's ask
	applyCustomCss (); //9/10/26 by CC -- his own CSS, from user.prefs.outliner.css
	$(".divOutlinerContainer").scroll (function () {
		if (flRestoringTableWindow) { //8/16/26 by CC -- the restore's own scrolls aren't the person's; recording one polluted the saved position
			return;
			}
		clearTimeout (theScrollTimer);
		theScrollTimer = setTimeout (function () {
			theState.scrollTop = $(".divOutlinerContainer").scrollTop ();
			writeState ();
			}, 400);
		});
	$(window).on ("pagehide", function () { //8/16/26 by CC -- a scroll inside the debounce's 400ms was lost when the window closed
		theState.scrollTop = $(".divOutlinerContainer").scrollTop ();
		writeState ();
		Object.keys (theDummyAddresses).forEach (function (theAddress) { //9/5/26 by CC -- tabledisposeoutline: the window's auto-created items go with it, if untouched
			const ixLastDot = theAddress.lastIndexOf (".");
			dropDummyRowsUnder ((ixLastDot === -1) ? "" : theAddress.slice (0, ixLastDot), true);
			});
		});
	/*  The open-a-script double-click listens in the capture phase, because
		Concord's own read-only handler stops double-clicks on the name text
		before they bubble -- so a bubble-phase handler only ever heard
		clicks that landed beside the name, not on it.  */

	document.getElementById ("divOutliner").addEventListener ("dblclick", function (event) {
		const theNode = $(event.target).closest (".concord-node");
		if (theNode.length === 0) {
			return;
			}
		const attributes = theNode.data ("attributes");
		if ((attributes !== undefined) && ((attributes.kind === "script") || (attributes.kind === "outline"))) {
			event.preventDefault ();
			event.stopPropagation ();
			const theUrl = "script.html?address=" + encodeURIComponent (windowAddressForNode (theNode)); //9/13/26 by CC -- the plain address, one window per object
			window.open (theUrl, "_blank"); //null just means it didn't open HERE -- in the app that's the deny that fronts the already-open window; never navigate this one away (8/15/26 by CC)
			return;
			}

		if ((attributes !== undefined) && (attributes.kind === "menubar")) { //9/1/26 by CC -- the menubar editor
			event.preventDefault ();
			event.stopPropagation ();
			window.open ("menubar.html?address=" + encodeURIComponent (windowAddressForNode (theNode)), "_blank");
			return;
			}

		/*  9/11/26 by CC -- DW's report: in Berkeley, double-clicking the
			value column of a table row (its "N items") opens that table in
			its own window, like Jump. A double-click on the NAME belongs to
			the outliner (expand/collapse), so this fires only on the value.  */

		if ((attributes !== undefined) && (attributes.kind === "table") && ($(event.target).closest (".spanValue").length > 0)) {
			event.preventDefault ();
			event.stopPropagation ();
			window.open ("index.html?address=" + encodeURIComponent (windowAddressForNode (theNode)), "_blank");
			return;
			}

		/*  8/31/26 by CC -- DW's 8/29 ask, reported before: double-clicking
			an address opens the window of the table that CONTAINS what it
			points to, with the cursor on that item -- the way to follow an
			address to a scalar, which has no window of its own.  */

		if ((attributes !== undefined) && (attributes.kind === "address")) {
			event.preventDefault ();
			event.stopPropagation ();
			const theTarget = String (attributes.value || "");
			const ixLastDot = theTarget.lastIndexOf (".");
			if (ixLastDot > 0) {
				const theUrl = "index.html?address=" + encodeURIComponent (theTarget.slice (0, ixLastDot)) + "&cursor=" + encodeURIComponent (theTarget.slice (ixLastDot + 1));

				/*  9/3/26 by CC -- a window already open on that table comes
					to the front instead of opening again, and the url's cursor
					never reaches it -- DW's 9/3 report: "the bar cursor doesn't
					move. it should move to the scalar value, scrolling if
					necessary." So the window is told over the window channel;
					a new window lands by the url as before.  */

				if (theWindowChannel !== undefined) {
					theWindowChannel.postMessage ({kind: "cursorTo", address: theTarget.slice (0, ixLastDot).toLowerCase (), name: theTarget.slice (ixLastDot + 1)});
					}
				window.open (theUrl, "_blank");
				}
			}
		}, true);
	captureFindKeystrokes (); //8/14/26 by CC -- cmd-F in a table window searches everything under the table
	wireTableEditing (); //8/27/26 by CC -- Return creates, clicks edit, backspace deletes, the wedge dialog types
	wireColumnRuleDragging (); //8/28/26 by CC -- the kernel's gesture: grab the rule between columns
	buildKindPopup (); //8/28/26 by CC -- the kernel's Kind popup, the bottom band
	buildSortPopup (); //8/29/26 by CC -- and the Sort popup beside it
	wireColumnTitleClicks (); //8/31/26 by CC -- DW's 8/29 ask: clicking a column title sorts by it, the same machinery as the Sort popup
	loadTopLevel ();
	startAutoUpdate (); //8/27/26 by CC -- the window follows the database
	}

function getTableEntries (theId, callback) { //theId undefined means this window's top level
	if (theId !== undefined) {
		serverCall ("/listtable", {id: theId}, "GET", function (err, data) {
			if (err === undefined) {
				data.entries = sortEntriesForDisplay (data.entries); //every level draws in the window's sort order
				}
			callback (err, data);
			});
		return;
		}
	if ((theScope.hiddenNames !== undefined) && (theScope.address === "")) { //10/1/26 by CC -- frontier.root's window asks which names are the guests' each time it lists its top level; see fetchGuestNames
		fetchGuestNames (function (hiddenNames) {
			if (hiddenNames !== undefined) { //the server couldn't be asked: the names it had stand
				theScope.hiddenNames = hiddenNames;
				}
			listTopLevel (callback);
			});
		}
	else {
		listTopLevel (callback);
		}
	}

function listTopLevel (callback) { //the window's own top level, with the names that aren't this window's left out
	serverCall ("/listtable", {address: theScope.address}, "GET", function (err, data) {
		if (err !== undefined) {
			callback (err);
			return;
			}
		if (theScope.names !== undefined) { //a database that owns some of the root's names, not all of them
			const entries = [];
			data.entries.forEach (function (theEntry) {
				if (theScope.names.indexOf (theEntry.name) !== -1) {
					entries.push (theEntry);
					}
				});
			data.entries = entries;
			data.ctEntries = entries.length;
			}
		if ((theScope.hiddenNames !== undefined) && (theScope.address === "")) { //9/5/26 by CC -- frontier.root's window: the guests' names stay out (see the scope above)
			const entries = [];
			data.entries.forEach (function (theEntry) {
				if (theScope.hiddenNames [String (theEntry.name).toLowerCase ()] !== true) {
					entries.push (theEntry);
					}
				});
			data.entries = entries;
			data.ctEntries = entries.length;
			}
		if ((data.formats !== undefined) && (Array.isArray (data.formats.colWidths))) { //8/27/26 by CC -- the widths ride with the table
			theColumnWidths = data.formats.colWidths;
			}
		if ((data.formats !== undefined) && (typeof data.formats.sortOrder === "string")) { //8/29/26 by CC -- and so does the sort order
			theSortOrder = data.formats.sortOrder;
			$(".selectSortPopup").val (theSortOrder);
			}
		data.entries = sortEntriesForDisplay (data.entries);
		if ((data.resolvedAddress !== undefined) && (data.resolvedAddress.length > 0) && (theScope.address !== undefined) && (data.resolvedAddress.toLowerCase () !== theScope.address.toLowerCase ())) {

			/*  8/28/26 by CC -- opened on a search-path name; the title says
				the full path, Berkeley's way, and the rows address through it  */

			if (theScope.title === theScope.address) {
				theScope.title = data.resolvedAddress;
				document.title = theScope.title;
				$(".divWindowTitle").text (theScope.title);
				}
			theScope.address = data.resolvedAddress;
			}
		callback (undefined, data);
		});
	}

function valueTextFor (attributes) { //9/6/26 by CC -- a date shows as Frontier's own text, "9/6/2026; 4:13:27 PM" (timedatestring, strings.c), not the ISO form the wire carries. DW's 9/6 ask: "dates display human-readable in the table window"
	if ((attributes !== undefined) && (attributes.kind === "date") && (attributes.value !== undefined) && (String (attributes.value).length > 0)) {
		const theDate = new Date (attributes.value);
		if (!isNaN (theDate.getTime ())) {
			var hours = theDate.getHours ();
			const ampm = (hours < 12) ? "AM" : "PM";
			hours = hours % 12;
			if (hours === 0) {
				hours = 12;
				}
			function padTwo (theNumber) {
				return ((theNumber < 10) ? "0" + theNumber : String (theNumber));
				}
			return ((theDate.getMonth () + 1) + "/" + theDate.getDate () + "/" + theDate.getFullYear () + "; " + hours + ":" + padTwo (theDate.getMinutes ()) + ":" + padTwo (theDate.getSeconds ()) + " " + ampm);
			}
		}
	return ((attributes === undefined) ? "" : attributes.value);
	}

function refreshRowAddresses () { //9/6/26 by CC -- every row remembers where it is, so a move can say where it came from
	$("#divOutliner .concord-node").each (function () {
		$(this).data ("lastAddress", addressForNode ($(this)));
		});
	}

function reorgCallback (theOp) {

	/*  9/6/26 by CC -- A ROW MOVED INTO ANOTHER TABLE MOVES THE OBJECT. The
		kernel's browser does this when a row is dragged (claycallbacks.c,
		claymovefile: out of the old table, into the new, "destination must
		be a table"). DW's 9/6 report: he made a new value, moved it under
		userlandSamples, and could neither edit nor delete it -- the window
		had moved the row and the database knew nothing. A move up or down
		inside the same table means nothing here: the kernel's table is
		sorted, and the next refresh puts the row back where the sort says.  */

	const theNode = theOp.getCursor ();
	if (theNode.length === 0) {
		return;
		}
	const theOldAddress = theNode.data ("lastAddress");
	if (theOldAddress === undefined) {
		refreshRowAddresses ();
		return;
		}
	const theParentNode = theNode.parent ().closest (".concord-node");
	const theNewParent = (theParentNode.length > 0) ? addressForNode (theParentNode) : theScope.address;
	const ixDot = theOldAddress.lastIndexOf (".");
	const theOldParent = (ixDot === -1) ? "" : theOldAddress.slice (0, ixDot);
	if (theOldParent.toLowerCase () === theNewParent.toLowerCase ()) {
		refreshLevels ();
		return;
		}
	tableEditCall ({action: "move", address: theOldAddress, newparent: theNewParent}, function (err) {
		if (err !== undefined) {
			showError (err);
			refreshLevels (); //the outline goes back to what the database has
			return;
			}
		refreshRowAddresses ();
		theState.cursorAddress = addressForNode (theNode);
		writeState ();
		});
	}

function addressPartForName (theName) {

	/*  9/9/26 by CC -- A NAME WITH A DOT GOES IN BRACKETS, the kernel's way
		(langexternalbracketname): an identifier stands bare, anything else
		is ["the name"]. The window joined names with dots, so a table named
		frontier.root inside a data file made an address the server read as
		frontier then root, and DW couldn't edit a value under it.  */

	const theText = String (theName);
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test (theText)) {
		return (theText);
		}
	return ("[\"" + theText.replace (/\\/g, "\\\\").replace (/"/g, "\\\"") + "\"]");
	}

function joinAddress (theParent, theName) { //the parent's address plus one name, bracketed when it needs to be
	return (((theParent.length > 0) ? theParent + "." : "") + addressPartForName (theName));
	}

function addressForNode (theNode) { //walk up the outline collecting names -- the dotted address of the row
	const segments = [];
	var current = theNode;
	while (current.length > 0) {
		const attributes = current.data ("attributes");
		if ((attributes === undefined) || (attributes.name === undefined)) {
			break;
			}
		segments.unshift (addressPartForName (attributes.name));
		current = current.parent ().closest (".concord-node");
		}
	if (theScope.address.length > 0) { //rows in a mounted window live under the mount address
		segments.unshift (theScope.address);
		}
	return (segments.join ("."));
	}

function opmlForEntries (entries) { //each entry becomes one line; a table gets a placeholder child so it shows a wedge
	var theBody = "";
	entries.forEach (function (entry) {
		var attributes = "text=\"" + xmlEscape (entry.name) + "\" name=\"" + xmlEscape (entry.name) + "\" value=\"" + xmlEscape (entry.value) + "\" kind=\"" + xmlEscape (entry.kind) + "\"";
		if (entry.flTable === true) {
			attributes += " tableid=\"" + entry.id + "\" loaded=\"false\"";
			theBody += "<outline " + attributes + "><outline text=\"loading…\"/></outline>"; //horizontal ellipsis
			}
		else {
			theBody += "<outline " + attributes + "/>";
			}
		});
	return ("<?xml version=\"1.0\"?><opml version=\"2.0\"><head><title>odb</title></head><body>" + theBody + "</body></opml>");
	}

function concordOp () {
	return ($("#divOutliner").concord ().op);
	}

function columnGeometry () { //where the columns sit -- dragged widths when the table has them, else a share of the window

	/*  8/27/26 by CC -- the widths live with the table, DW's ruling, the way
		the kernel keeps colwidths in the table's own record (tableformats.c).
		theColumnWidths is [name, value] in pixels; the kind column takes
		whatever is left.  */

	const widthOutliner = $("#divOutliner").width ();
	if ((theColumnWidths !== undefined) && (theColumnWidths.length >= 2)) {
		return ({
			leftValue: theColumnWidths [0],
			leftKind: theColumnWidths [0] + theColumnWidths [1],
			widthOutliner
			});
		}
	return ({
		leftValue: Math.round (widthOutliner * 0.44),
		leftKind: Math.round (widthOutliner * 0.76),
		widthOutliner
		});
	}

function decorateRows () { //the value and kind columns -- each row gets two spans, from the attributes its OPML carried
	setTimeout (refreshRowAddresses, 0); //9/6/26 by CC -- once the rows are in place, each remembers its address, for a move

	/*  The spans live inside each row's wrapper, which moves right as the
		outline indents -- so each one remembers its own row's indent, and
		applyColumnGeometry subtracts it, keeping the columns straight at
		any depth and any window width.  */

	const leftOutliner = $("#divOutliner").offset ().left;
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const theWrapper = theNode.children (".concord-wrapper");
		if (theWrapper.find (".spanValue").length === 0) {
			if (theNode.offsetParent === null) { //a hidden row can't be measured -- it gets decorated when its table is expanded
				return;
				}
			const attributes = theNode.data ("attributes");
			if ((attributes !== undefined) && (attributes.kind !== undefined)) {
				theNode.data ("colIndent", theWrapper.offset ().left - leftOutliner);
				theWrapper.append ($("<span class=\"spanValue\"></span>").text (valueTextFor (attributes)));
				theWrapper.append ($("<span class=\"spanKind\"></span>").text (attributes.kind));
				}
			}
		});
	applyColumnGeometry ();
	}

function applyColumnGeometry () { //position every row's spans for the current window width
	const geometry = columnGeometry ();
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const indent = theNode.data ("colIndent");
		if (indent !== undefined) {
			const theWrapper = theNode.children (".concord-wrapper");
			theWrapper.children (".spanValue").css ({
				left: (geometry.leftValue - indent) + "px",
				width: (geometry.leftKind - geometry.leftValue - 24) + "px"
				});
			theWrapper.children (".spanKind").css ({
				left: (geometry.leftKind - indent) + "px",
				width: (geometry.widthOutliner - geometry.leftKind - 28) + "px" //9/14/26 by CC -- was 20: the kind column ran three pixels past the container and every table window had a horizontal scrollbar for it
				});
			}
		});
	$("#styleColumns").text ("#divOutliner .concord-text { max-width: " + (geometry.leftValue - 60) + "px; }");
	alignColumnHeads ();
	}

$(window).resize (function () {
	applyColumnGeometry ();
	});

function alignColumnHeads () { //every title lines up over where its column actually landed, Name included
	const leftHeads = $(".divColumnHeads").offset ().left;
	const firstText = $("#divOutliner .concord-text:first");
	if (firstText.length > 0) {
		$(".spanHeadName").css ("left", (firstText.offset ().left - leftHeads) + "px");
		}
	const firstValue = $("#divOutliner .spanValue:first");
	if (firstValue.length > 0) {
		$(".spanHeadValue").css ("left", (firstValue.offset ().left - leftHeads + 10) + "px"); //past the column's dotted rule
		$(".spanHeadKind").css ("left", ($("#divOutliner .spanKind:first").offset ().left - leftHeads + 10) + "px");
		}
	placeColumnHandles (); //8/27/26 by CC -- the drag handles follow the columns
	}

function showError (err) {
	alert (err.message);
	}

//window state -- what was expanded and where the scroll was, so the window comes back the way it was left
	var theScrollTimer; //assigned by the scroll handler
	var theState; //assigned at startup, once the scope is known -- each window keeps its own
	function readState () {
		try {
			const jstruct = JSON.parse (localStorage.getItem (scopeStateKey ()));
			if ((jstruct !== null) && (Array.isArray (jstruct.expandedIds))) {
				return (jstruct);
				}
			}
		catch (err) {
			}
		return ({expandedIds: [], scrollTop: 0});
		}
	function writeState () {
		localStorage.setItem (scopeStateKey (), JSON.stringify (theState));
		}
	function recordExpanded (theId) {
		if (theState.expandedIds.indexOf (theId) === -1) {
			theState.expandedIds.push (theId);
			writeState ();
			}
		}
	function recordCollapsed (theId) {
		const ix = theState.expandedIds.indexOf (theId);
		if (ix !== -1) {
			theState.expandedIds.splice (ix, 1);
			writeState ();
			}
		}
	function findNodeByTableId (theId) {
		const theNodes = $("#divOutliner .concord-node").filter (function () {
			const attributes = $(this).data ("attributes");
			return ((attributes !== undefined) && (attributes.tableid === theId));
			});
		return ((theNodes.length > 0) ? theNodes.first () : undefined);
		}
	function restoreExpansions (ix, missingIds) {
		if (ix >= theState.expandedIds.length) {
			missingIds.forEach (recordCollapsed); //tables that no longer exist fall out of the state
			$(".divOutlinerContainer").scrollTop (theState.scrollTop);
			restoreCursor (); //8/16/26 by CC -- here, at the real end: the walk above is asynchronous, and the cursor's row may only exist once the expanded tables have loaded
			setTimeout (function () { //the flag outlives the restore's scroll events, which arrive after this code runs
				flRestoringTableWindow = false;
				}, 700);
			return;
			}
		const theId = theState.expandedIds [ix];
		const theNode = findNodeByTableId (theId);
		if (theNode === undefined) {
			missingIds.push (theId);
			restoreExpansions (ix + 1, missingIds);
			}
		else {
			if (theNode.data ("attributes").loaded === "true") {
				theNode.removeClass ("collapsed");
				restoreExpansions (ix + 1, missingIds);
				}
			else {
				loadTableChildren (theNode, function () {
					restoreExpansions (ix + 1, missingIds);
					});
				}
			}
		}

function loadTopLevel () {
	getTableEntries (undefined, function (err, data) {
		if (err !== undefined) {
			showError (err);
			}
		else {
			withTheOutlineHidden (function () { //9/13/26 by CC -- a big top level goes in the same way; the rows are decorated once the outline shows again
				concordOp ().xmlToOutline (opmlForEntries (data.entries), false);
				});
			if ((data.entries.length === 0) && (theScope.address !== "") && (theScope.names === undefined)) { //9/5/26 by CC -- a window opened on an empty table shows item #1, the claybrowser's way
				makeDummyRow (undefined, theScope.address);
				}
			flRestoringTableWindow = true; //8/16/26 by CC -- the restore's own cursor moves aren't the person's; restoreCursor runs when the walk really finishes, which also fixes opening-to-a-row racing the async expansions
			restoreExpansions (0, []);
			markWindowReadyForTarget (true); //8/15/26 by CC -- ready for the edit handshake; true = a table window never answers for a target, its rows aren't op lines
			}
		});
	}

function putCursorOnRow (theName) { //8/12/26 by CC -- the row this window was opened to show

	var theFound;
	$("#divOutliner .concord-node").each (function () {
		const attributes = $(this).data ("attributes");
		if ((theFound === undefined) && (attributes !== undefined) && (attributes.name !== undefined) && (attributes.name.toLowerCase () === theName.toLowerCase ())) { //8/15/26 by CC -- unicase, like every name in the odb
			theFound = $(this);
			}
		});
	if (theFound !== undefined) {
		concordOp ().setCursor (theFound);
		theFound [0].scrollIntoView ({block: "center"});
		}
	}

function withTheOutlineHidden (theWork) {

	/*  9/13/26 by CC -- BIG TABLES EXPAND WITH THE OUTLINE HIDDEN. DW's 9/13
		report: expanding a table with hundreds of items has always seemed
		slow here, instantaneous in Berkeley. Measured on nodeEditorSuite.
		utilities, 444 rows: the server's listing takes 16ms, building the
		rows 731ms -- nearly all of it the browser laying the page out again
		for every row Concord appends. With the outline out of the layout
		while the rows go in, the same work takes 129ms. The still copy the
		op.setDisplay machinery makes (holdTheDisplay, common.js) covers the
		gap so nothing flashes, and the scroll position is put back, since a
		hidden outline has no height to be scrolled in.  */

	const theOutliner = $("#divOutliner");
	const theContainer = $(".divOutlinerContainer");
	const savedScroll = theContainer.scrollTop ();
	const flIHold = !flDisplayHeld; //a script holding the display keeps its hold
	if (flIHold) {
		holdTheDisplay (true);
		}
	theOutliner.css ("display", "none");
	try {
		theWork ();
		}
	finally {
		theOutliner.css ("display", "");

		/*  9/14/26 by CC -- THE COLUMNS ARE MEASURED WITH THE OUTLINE SHOWING.
			decorateRows remembers each row's indent from its wrapper's
			position, and a hidden element has no position -- so rows
			decorated inside the hidden work got the wrong indent, and their
			Value and Kind columns drifted right with every level, the
			dotted rules with them, and the rows ran past the window's edge
			and put up a horizontal scrollbar (found in tonight's hunt for
			display bugs in the table window; 0.4.74 had it). The rows are
			decorated here, after the outline is back in the layout.  */

		decorateRows ();
		theContainer.scrollTop (savedScroll);
		if (flIHold) {
			holdTheDisplay (false);
			}
		}
	}

function loadTableChildren (theNode, callback) { //fetch a table's entries and swap out the placeholder
	const attributes = theNode.data ("attributes");
	attributes.loaded = "true";
	getTableEntries (attributes.tableid, function (err, data) {
		const theOp = concordOp ();
		try {
			withTheOutlineHidden (function () { //9/13/26 by CC -- the rows go in with the page out of the layout
				theOp.setCursor (theNode);
				theOp.deleteSubs ();
				if (err !== undefined) {
					attributes.loaded = "false"; //so the next expand tries again
					}
				else {
					if (data.entries.length > 0) {
						theOp.insertXml (opmlForEntries (data.entries), "right");
						theNode.removeClass ("collapsed"); //the rows are decorated once the outline shows again (withTheOutlineHidden)
						}
					}
				});
			}
		catch (buildErr) { //9/24/26 by CC -- a row that can't be built (see xmlEscape) is an error like any other, not a load that never answers
			attributes.loaded = "false";
			if (err === undefined) {
				err = {message: "Can't show the rows of " + attributes.name + " because " + buildErr.message};
				}
			}
		if (err !== undefined) {
			if (callback === undefined) {
				showError (err);
				}
			}
		else {
			if (data.entries.length === 0) {
				makeDummyRow (theNode, addressForNode (theNode)); //9/5/26 by CC -- an empty table opens with item #1 in it, the claybrowser's way
				}
			}
		if (callback !== undefined) {
			callback (err);
			}
		});
	}

/*  9/5/26 by CC -- AN EMPTY TABLE SHOWS "item #1", AND IT GOES AWAY UNTOUCHED.
	DW's 9/5 report: he made workspace.xxx and had no way to put anything in
	it -- "in frontier, i can expand a table and a window opens with an item
	#1 visible that i can then edit. pretty sure if you close the window
	without having edited item #1, it is cleared." The C agrees: the
	claybrowser inserts a node into an empty table when it's shown, marks it
	auto-created (tmpbit2 in browsermoveto, claybrowserstruc.c), and
	browserdeletedummyvalues drops it when the table collapses or the window
	closes if it still holds no value (browserpostcollapse in
	claybrowserexpand.c, tabledisposeoutline in tableformats.c). His own
	7/20/11 note in Frontier.openDataFile says the same: "automatically
	created for empty tables, but doesn't go away when it's at the top level
	of a database." So: a real row, named the next free item #N, no value;
	remembered here by address; deleted on collapse and on close by
	deleteifempty, which refuses once the row has a value. A renamed row
	isn't at the remembered address any more, so it stays too.  */

const theDummyAddresses = {}; //lowercased full address -> true, the auto-created rows this window made

function makeDummyRow (parentNode, parentAddress) {
	tableEditCall ({action: "newitem", parentaddress: parentAddress}, function (err, data) {
		if (err !== undefined) {
			return; //nothing to show; the table stays empty on screen
			}
		const theFullAddress = joinAddress (parentAddress, data.name); //9/9/26 by CC
		theDummyAddresses [theFullAddress.toLowerCase ()] = true;
		const theEntry = {name: data.name, value: data.value, kind: data.kind};
		if (parentNode === undefined) { //the window's own top level
			concordOp ().xmlToOutline (opmlForEntries ([theEntry]), false);
			decorateRows ();
			return;
			}
		const theOp = concordOp ();
		theOp.setCursor (parentNode);
		theOp.insertXml (opmlForEntries ([theEntry]), "right");
		parentNode.removeClass ("collapsed");
		decorateRows ();
		theOp.setCursor (parentNode);
		});
	}

function dropDummyRowsUnder (parentAddress, flClosing) { //the auto-created rows directly under a table, if untouched
	const thePrefix = ((parentAddress.length > 0) ? parentAddress + "." : "").toLowerCase ();
	Object.keys (theDummyAddresses).forEach (function (theAddress) {
		if (!theAddress.startsWith (thePrefix) || (theAddress.slice (thePrefix.length).indexOf (".") !== -1)) {
			return;
			}
		delete theDummyAddresses [theAddress];
		if (flClosing === true) { //the window is going away: a request that outlives the page
			try {
				fetch ("/tableedit", {method: "POST", keepalive: true, headers: {"x-trigger-password": thePassword, "Content-Type": "application/json"}, body: JSON.stringify ({action: "deleteifempty", address: theAddress})}); //the same header serverCall sends; keepalive so the request outlives the page
				}
			catch (err) {
				}
			}
		else {
			tableEditCall ({action: "deleteifempty", address: theAddress}, function (err) {
				});
			}
		});
	}

function expandCallback (op) {
	const theNode = op.getCursor ();
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.kind !== "table")) {
		return;
		}
	recordExpanded (attributes.tableid);
	if (attributes.loaded !== "true") {
		loadTableChildren (theNode, function () {
			scrollExpandedIntoView (theNode); //9/29/26 by CC -- once the rows are in, the way the kernel shows the subheads after an expand
			});
		}
	else {
		scrollExpandedIntoView (theNode);
		}
	}

function fullExpandTableWindow (theCallback) { //9/24/26 by CC -- op.fullExpand in a table window: every subtable at every level, loaded and open

	ctExpandsInFlight++;
	function callback () {
		expandFinished ();
		if (theCallback !== undefined) {
			theCallback ();
			}
		}

	/*  DW's 9/24 report: "Expand Everything in the Outliner menu doesn't
		expand anything. the screen flashes, no new stuff is revealed."
		Concord's fullExpand took the collapsed class off every row, but a
		table's rows come from the server when it is first expanded, so a
		subtable that had never been opened showed nothing under it, and
		the tables inside it were never asked for at all. The kernel's
		tableexpand goes all the way down; so does this: every unloaded table
		row is loaded, then the rows that arrived are looked at, until no
		collapsed table is left.  */

	const theOp = concordOp ();
	var ctRounds = 0;
	function oneRound () {
		const theWaiting = [];
		var ctUndecorated = 0;
		$("#divOutliner .concord-node").each (function () {
			const theNode = $(this);
			const attributes = theNode.data ("attributes");
			if (attributes === undefined) { //rows that just arrived and haven't been decorated yet -- look again in a moment
				ctUndecorated++;
				return;
				}
			if (attributes.kind === "table") {
				if (theNode.hasClass ("collapsed")) {
					theNode.removeClass ("collapsed");
					}
				recordExpanded (attributes.tableid); //remembered either way: a refresh rebuilds the rows from this record
				if (attributes.loaded !== "true") {
					theWaiting.push (theNode);
					}
				}
			});
		ctRounds++;
		if ((theWaiting.length === 0) && (ctUndecorated > 0) && (ctRounds <= 50)) {
			setTimeout (oneRound, 50);
			return;
			}
		if ((theWaiting.length === 0) || (ctRounds > 50)) {
			callback ();
			return;
			}
		var ixNext = 0;
		function loadNext () { //one table at a time -- the loader hides the outline while rows go in, and two at once trip over each other
			if (ixNext >= theWaiting.length) {
				oneRound (); //the rows that just arrived may hold tables of their own
				return;
				}
			const theNode = theWaiting [ixNext];
			ixNext++;
			loadTableChildren (theNode, function () {
				loadNext ();
				});
			}
		loadNext ();
		}
	oneRound ();
	}

var ctExpandsInFlight = 0; //9/24/26 by CC -- expand-alls loading subtables; the poll's refresh waits for zero

function expandFinished () { //one expand-all done; a refresh the poll held back runs now, unless a script still holds the display
	ctExpandsInFlight--;
	if (ctExpandsInFlight <= 0) {
		ctExpandsInFlight = 0;
		if (flRefreshQueued && !flDisplayHeld) {
			flRefreshQueued = false;
			refreshQuietly ();
			}
		}
	}

function afterDisplayReleased () { //9/24/26 by CC -- op.setDisplay (true) at the end of a script: the refresh that waited runs now (holdTheDisplay, common.js)
	if (flRefreshQueued && (ctExpandsInFlight <= 0) && !flCellEditing && !flDraggingColumn && !flRestoringTableWindow) {
		flRefreshQueued = false;
		refreshQuietly ();
		}
	}

function expandNodeInTableWindow (theNode, ctLevels, theCallback) { //9/24/26 by CC -- op.expand (ctLevels) on a table row: its rows load and open, and their subtables down ctLevels - 1 more levels; callback (flExpandedAny)

	ctExpandsInFlight++;
	function callback (flExpandedAny) {
		expandFinished ();
		theCallback (flExpandedAny);
		}
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.kind !== "table")) { //not a table: nothing under it to open
		callback (false);
		return;
		}
	var flExpandedAny = false;
	function openThisOne (thenDo) {
		if (theNode.hasClass ("collapsed")) {
			theNode.removeClass ("collapsed");
			flExpandedAny = true;
			}
		recordExpanded (attributes.tableid); //remembered whether or not it was showing collapsed: a refresh rebuilds the rows from this record
		if (attributes.loaded !== "true") {
			loadTableChildren (theNode, function () {
				flExpandedAny = true;
				setTimeout (thenDo, 50); //the rows that arrived get decorated once the outline shows again
				});
			}
		else {
			thenDo ();
			}
		}
	openThisOne (function () {
		if (ctLevels <= 1) {
			callback (flExpandedAny);
			return;
			}
		const theSubtables = [];
		theNode.children ("ol").children (".concord-node").each (function () {
			const subAttributes = $(this).data ("attributes");
			if ((subAttributes !== undefined) && (subAttributes.kind === "table")) {
				theSubtables.push ($(this));
				}
			});
		if (theSubtables.length === 0) {
			callback (flExpandedAny);
			return;
			}
		var ixNext = 0;
		function expandNext () { //one subtable at a time, in order; see fullExpandTableWindow
			if (ixNext >= theSubtables.length) {
				callback (flExpandedAny);
				return;
				}
			const theSubtable = theSubtables [ixNext];
			ixNext++;
			expandNodeInTableWindow (theSubtable, ctLevels - 1, function (flSubExpanded) {
				if (flSubExpanded) {
					flExpandedAny = true;
					}
				expandNext ();
				});
			}
		expandNext ();
		});
	}

function collapseCallback (op) {
	const theNode = op.getCursor ();
	const attributes = theNode.data ("attributes");
	if ((attributes !== undefined) && (attributes.kind === "table")) {
		recordCollapsed (attributes.tableid);
		const theAddress = addressForNode (theNode);
		const thePrefix = theAddress.toLowerCase () + ".";
		var flHadDummy = false;
		Object.keys (theDummyAddresses).forEach (function (theDummy) {
			if (theDummy.startsWith (thePrefix)) {
				flHadDummy = true;
				}
			});
		if (flHadDummy) { //9/5/26 by CC -- browserpostcollapse: the auto-created item goes if it's still empty, and the table's rows reload on the next expand
			dropDummyRowsUnder (theAddress, false);
			attributes.loaded = "false";
			}
		}
	}

/*  The cursor comes back too -- 8/16/26 by CC, DW's directive: "i really want
	outlines to remember the cursor location and expansion state... that goes
	for all outlines, including tables."

	The cursor is remembered by the row's dotted address, not its position --
	rows come and go in a table, and the address still names the same row.
	While the window is being put back, cursor moves are the restore's own,
	not the person's, so they aren't recorded.  */

var flRestoringTableWindow = false; //assigned by loadTopLevel around the restore

function cursorMovedCallback (op) {
	updateKindPopup (); //8/28/26 by CC -- the popup follows the cursor, the kernel's checked item
	if (flRestoringTableWindow) {
		return;
		}
	const theNode = op.getCursor ();
	if ((theNode === undefined) || (theNode.length === 0)) {
		return;
		}
	theState.cursorAddress = addressForNode (theNode);
	writeState ();
	}

function findNodeByAddress (theAddress) {
	const lowerAddress = theAddress.toLowerCase ();
	var theFound;
	$("#divOutliner .concord-node").each (function () {
		if ((theFound === undefined) && (addressForNode ($(this)).toLowerCase () === lowerAddress)) {
			theFound = $(this);
			}
		});
	return (theFound);
	}

/*  THE TABLE WINDOW EDITS -- 8/27/26 by CC, DW's go-ahead, his 8/9 design.

	Creating: press Return, a new item appears below the cursor, named the
	next free "item #N", and the name is ready to type over. A scalar gets
	its value typed in the second column. For anything else, double-click
	the WEDGE -- anywhere else is a text action -- and a dialog asks which
	type: Table, Outline, WP-Text, Script, MenuBar. (No Picture -- his
	ruling 8/27.)

	Editing: names are always editable (tableedit.c); a value is editable
	only when it's a scalar. What's typed into a value cell is run as a
	script by the kernel's rules -- the server holds them.

	Deleting: backspace or delete takes the cursor's row, the cursor moves
	up, and windows open on the deleted object close -- tableclearroutine's
	shape. The server saves the object to ops/deleted first, because this
	Frontier has no Undo yet.

	Column widths: drag the handles in the head band; the widths live with
	the table, the kernel's way. And the window follows the database -- a
	script that changes a value shows up here without a reopen.  */

var theColumnWidths; //[name, value] in pixels; assigned from the table's formats, or from the window's own state when there's no table to keep them
var flCellEditing = false; //an edit field is up -- keystrokes belong to it, and the auto-update waits
var flDraggingColumn = false;
var theNameClickTimer; //a click on the cursor row's name starts a rename after a beat, unless a double-click wins
var theLastDataVersion; //what /dataversion said last time
var flRefreshQueued = false; //a change arrived while editing -- refresh when the edit ends

const editableKinds = {string: true, number: true, boolean: true, date: true, char: true, list: true, address: true, "(none)": true};

const kindsADoubleClickOpens = {table: true, script: true, outline: true, menubar: true}; //10/1/26 by CC -- the kinds whose value column opens a window on a double-click (the dblclick handler in startOutliner); the mouse shows the pointer over them

function kindIsEditable (theKind) {
	return (editableKinds [theKind] === true);
	}

function keyNameForEvent (event) { //some senders fill event.key, some only the keyCode -- concord itself reads event.which
	if ((event.key !== undefined) && (event.key.length > 0)) {
		return (event.key);
		}
	switch (event.which || event.keyCode) {
		case 13:
			return ("Enter");
		case 27:
			return ("Escape");
		case 9:
			return ("Tab");
		case 8:
			return ("Backspace");
		case 46:
			return ("Delete");
		}
	return ("");
	}

function noteGuestName (theNewName, theOldName, theParentAddress) { //9/13/26 by CC -- a guest database's window lists the names it owns (theScope.names); a top-level item made, pasted, renamed or deleted here changes that list, here and on the server (trigger.js adoptGuestName)
	if ((theScope === undefined) || (theScope.names === undefined) || (theParentAddress !== theScope.address)) {
		return;
		}
	const theNames = [];
	theScope.names.forEach (function (theName) {
		if ((theOldName === undefined) || (String (theName).toLowerCase () !== String (theOldName).toLowerCase ())) {
			theNames.push (theName);
			}
		});
	if ((theNewName !== undefined) && (theNames.map (function (theName) {return (String (theName).toLowerCase ());}).indexOf (String (theNewName).toLowerCase ()) === -1)) {
		theNames.push (theNewName);
		}
	theScope.names = theNames;
	}

function windowAddressForNode (theNode) {

	/*  9/13/26 by CC -- THE ADDRESS A WINDOW OPENS ON. A Tools root's names
		live at the top of the database, so a row in that guest's window is
		addressed here through the guest's bracketed file path, and the
		server accepts that form for edits. But a window opened on it was
		keyed by that spelling, while a cmd-click on the same name in the
		notepad opened on the plain address the search path resolves to --
		two windows on one object, DW's 9/13 report (nodeEditorSuite.
		macroProcess, twice). Windows open on the plain address now.  */

	if ((theScope === undefined) || (theScope.names === undefined)) {
		return (addressForNode (theNode));
		}
	const segments = [];
	var current = theNode;
	while (current.length > 0) {
		const attributes = current.data ("attributes");
		if ((attributes === undefined) || (attributes.name === undefined)) {
			break;
			}
		segments.unshift (addressPartForName (attributes.name));
		current = current.parent ().closest (".concord-node");
		}
	return (segments.join ("."));
	}

function tableEditCall (theAsk, callback) {
	if ((theScope !== undefined) && (theScope.names !== undefined)) { //9/13/26 by CC -- a guest database's window says whose window it is, so a top-level edit changes the guest's list of names (trigger.js adoptGuestName)
		theAsk.database = theScope.title;
		}
	serverCall ("/tableedit", {jsontext: JSON.stringify (theAsk)}, "POST", function (err, data) {
		if (err !== undefined) {
			callback (err);
			return;
			}
		if (data.message !== undefined) {
			callback (data);
			return;
			}
		callback (undefined, data);
		});
	}

function cursorRowNode () {
	const theNode = concordOp ().getCursor ();
	if ((theNode === undefined) || (theNode.length === 0)) {
		return (undefined);
		}
	return (theNode);
	}

function rowIsExpandedTable (theNode) { //9/8/26 by CC -- opsubheadsexpanded for a table row: it has subs and they show
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes === null) || (String (attributes.kind).toLowerCase () !== "table")) {
		return (false);
		}
	if (theNode.hasClass ("collapsed")) {
		return (false);
		}
	return (theNode.children ("ol").children (".concord-node").length > 0); //the shape childRowsOf reads
	}

function parentAddressForNode (theNode) { //the table the row lives in -- the scope when it's a top-level row
	const theParent = theNode.parent ().closest (".concord-node");
	if (theParent.length === 0) {
		return (theScope.address);
		}
	return (addressForNode (theParent));
	}

function reloadThisWindow () { //9/13/26 by CC -- window.update (adr) on this table: the full reload from the database (common.js, "window.update")
	refreshLevels ();
	}

/*  9/13/26 by CC -- TYPE-AHEAD, the kernel's opstructuretextkey (op.c): in a
	table window, a printable key with the cursor on a row goes into a typing
	buffer -- emptied when the gap since the last key is longer than twice the
	keyboard's start-repeat time -- and the cursor moves to the row among the
	cursor's siblings whose name starts with a string equal to or greater
	than what was typed, "much like typing in standard file". DW's 9/13 ask:
	type T, the cursor goes to the first name beginning with T; then H, TH;
	then O, THO. A Frontier standard feature.  */

var theTypeAheadText = "";
var whenLastTypeAhead = 0;

function typeAheadKey (theChar) {
	const now = Date.now ();
	if ((now - whenLastTypeAhead) > 1000) { //twice the Mac's default start-repeat time, near enough
		theTypeAheadText = "";
		}
	whenLastTypeAhead = now;
	theTypeAheadText += theChar.toLowerCase ();
	const theCursor = cursorRowNode ();
	const theSiblings = (theCursor === undefined) ? levelChildNodes (undefined) : theCursor.parent ().children (".concord-node");
	var theTarget;
	theSiblings.each (function () {
		const attributes = $(this).data ("attributes");
		if ((theTarget === undefined) && (attributes !== undefined) && (attributes.name !== undefined) && (String (attributes.name).toLowerCase () >= theTypeAheadText)) {
			theTarget = $(this);
			}
		});
	if ((theTarget === undefined) && (theSiblings.length > 0)) {
		theTarget = theSiblings.last (); //nothing at or after what was typed: the last row, the sorted search's end
		}
	if (theTarget !== undefined) {
		concordOp ().setCursor (theTarget);
		theTarget [0].scrollIntoView ({block: "nearest"});
		theState.cursorAddress = addressForNode (theTarget);
		writeState ();
		}
	}

function refreshLevels () { //the full reload -- for after a rename resorts the table; expansions, cursor and scroll come back through the window's own restore
	if (flCellEditing || flDraggingColumn) {
		flRefreshQueued = true;
		return;
		}
	flRefreshQueued = false;
	theState.scrollTop = $(".divOutlinerContainer").scrollTop ();
	loadTopLevel ();
	}

/*  THE QUIET REFRESH -- 8/28/26 by CC, DW's report: the poll used to reload
	the whole window, which paraded a cursor through it and repainted every
	row while he typed in another window. In Frontier nothing moves -- the
	only thing that changes is the text of the value column, and you don't
	notice unless you look. So the poll DIFFS now: it fetches each visible
	level and touches only what really differs -- a changed value or kind
	updates that span's text in place, a new row slips in at its sorted
	spot, a gone row leaves. No cursor moves, no scroll, no rebuild.  */

function levelChildNodes (parentNode) { //the row nodes of one level; parentNode undefined means the window's top
	if (parentNode === undefined) {
		return ($("#divOutliner > .concord-root").children (".concord-node"));
		}
	return (parentNode.children ("ol").children (".concord-node"));
	}

function displayNameForRow (theName) {

	/*  9/3/26 by CC -- the kernel's name column (tablegetstringvalue,
		tabledisplay.c, "omit xml prefix"): a name whose fifth character is
		a tab loses its first five characters on screen, and one whose
		ninth character is a tab loses its first nine -- the number-and-tab
		prefix that gave XML's repeated element names unique names in the
		odb. DW, 9/3: "do what the kernel does -- it hides everything up to
		and including the tab. when you click on the text to edit, you see
		the full name." The rename editor shows attributes.name, the whole
		thing; only the display is trimmed. Reproduce on
		nodeEditorSuite.data.buttons.  */

	const theText = String (theName);
	if ((theText.length > 5) && (theText.charAt (4) === "\t")) {
		return (theText.substring (5));
		}
	if ((theText.length > 9) && (theText.charAt (8) === "\t")) {
		return (theText.substring (9));
		}
	return (theText);
	}

function buildRowNode (entry) { //one row, the same shape concord builds -- li, wrapper, icon, text, children
	const theNode = $("<li class=\"concord-node\"></li>");
	const theWrapper = $("<div class=\"concord-wrapper type-icon\"></div>");
	theWrapper.append ($(ConcordUtil.getIconHtml ("caret-right")));
	const theText = $("<div class=\"concord-text\" contenteditable=\"true\"></div>").text (displayNameForRow (entry.name));
	theWrapper.append (theText);
	theNode.append (theWrapper);
	const theChildren = $("<ol></ol>");
	const attributes = {name: entry.name, value: entry.value, kind: entry.kind};
	if (entry.flTable === true) {
		attributes.tableid = entry.id;
		attributes.loaded = "false";
		theChildren.append ($("<li class=\"concord-node\"><div class=\"concord-wrapper type-icon\"><div class=\"concord-text\">loading…</div></div><ol></ol></li>")); //horizontal ellipsis
		theNode.addClass ("collapsed");
		}
	theNode.append (theChildren);
	theNode.data ("attributes", attributes);
	return (theNode);
	}

function updateRowNode (theNode, entry) { //touch only what differs -- the quiet part
	const attributes = theNode.data ("attributes");
	const theWrapper = theNode.children (".concord-wrapper");
	if (attributes.value !== entry.value) {
		attributes.value = entry.value;
		theWrapper.children (".spanValue").text (valueTextFor (attributes));
		}
	if (attributes.kind !== entry.kind) {
		attributes.kind = entry.kind;
		theWrapper.children (".spanKind").text (entry.kind);
		}
	if (attributes.name !== entry.name) { //same name unicase, different spelling
		attributes.name = entry.name;
		theWrapper.find (".concord-text").first ().text (displayNameForRow (entry.name));
		}
	if ((entry.flTable === true) && (attributes.tableid !== entry.id)) { //the table was replaced; its rows reload on the next expand
		attributes.tableid = entry.id;
		attributes.loaded = "false";
		}
	}

/*  10/1/26 by CC -- moveRowNodeToSortedPlace IS GONE. It moved a renamed row
	to its alphabetical spot (8/28); the rename stopped calling it on 9/3, at
	DW's ruling, and nothing has called it since -- so the line CC added to
	it on 9/29 (0.4.98, "the window follows the row") changed nothing, which
	is what he reported on 9/30. His ruling of 10/1, the same as 9/3: "it
	should stay where it is, and be out of sort. you can always get it
	sorted by click on the name tab or the others. this is how frontier does
	it." A new or renamed row stays where it is; startNameEdit and
	makeNewItem never move it, and the quiet refresh below never reorders
	the rows that are already there.  */

function diffOneLevel (parentNode, entries) {
	const existingByName = {};
	levelChildNodes (parentNode).each (function () {
		const attributes = $(this).data ("attributes");
		if ((attributes !== undefined) && (attributes.name !== undefined)) {
			existingByName [attributes.name.toLowerCase ()] = $(this);
			}
		});
	const wantedNames = {};
	entries.forEach (function (entry) {
		wantedNames [entry.name.toLowerCase ()] = true;
		});

	Object.keys (existingByName).forEach (function (lowerName) { //rows that left
		if (wantedNames [lowerName] !== true) {
			const theNode = existingByName [lowerName];
			if (theNode.hasClass ("concord-cursor") || (theNode.find (".concord-cursor").length > 0)) {
				return; //never yank the row the person is on -- the full reload after their next action squares it
				}
			theNode.remove ();
			delete existingByName [lowerName];
			}
		});

	var previousNode; //entries arrive sorted; each row lands after the one before it
	entries.forEach (function (entry) {
		const lowerName = entry.name.toLowerCase ();
		var theNode = existingByName [lowerName];
		if (theNode !== undefined) {
			const flKindChanged = (theNode.data ("attributes").kind !== entry.kind);
			const flBecameTable = (entry.flTable === true) !== (theNode.data ("attributes").tableid !== undefined);
			if (flKindChanged && flBecameTable) { //a scalar became a table or the reverse -- rebuild the one row
				const theFresh = buildRowNode (entry);
				theNode.replaceWith (theFresh);
				theNode = theFresh;
				}
			else {
				updateRowNode (theNode, entry);
				}
			}
		else {
			theNode = buildRowNode (entry);
			if (previousNode !== undefined) {
				theNode.insertAfter (previousNode);
				}
			else {
				if (parentNode === undefined) {
					$("#divOutliner > .concord-root").prepend (theNode);
					}
				else {
					parentNode.children ("ol").prepend (theNode);
					}
				}
			}
		previousNode = theNode;
		});
	}

function refreshQuietly () {
	function refreshChildLevels (parentNode, whenDone) { //walk the loaded, expanded tables under one level
		const theTables = [];
		levelChildNodes (parentNode).each (function () {
			const attributes = $(this).data ("attributes");
			if ((attributes !== undefined) && (attributes.loaded === "true") && (attributes.tableid !== undefined)) {
				theTables.push ($(this));
				}
			});
		var ix = 0;
		function nextTable () {
			if (ix >= theTables.length) {
				whenDone ();
				return;
				}
			const theNode = theTables [ix];
			ix++;
			getTableEntries (theNode.data ("attributes").tableid, function (err, data) {
				if (err === undefined) {
					diffOneLevel (theNode, data.entries);
					refreshChildLevels (theNode, nextTable);
					}
				else {
					nextTable ();
					}
				});
			}
		nextTable ();
		}
	getTableEntries (undefined, function (err, data) {
		if (err !== undefined) {
			return;
			}
		diffOneLevel (undefined, data.entries);
		refreshChildLevels (undefined, function () {
			decorateRows (); //new rows get their value and kind spans
			});
		});
	}

function startAutoUpdate () { //the window follows the database -- DW: very important
	function askTheVersion () {
		serverCall ("/dataversion", {}, "GET", function (err, data) {
			if (err !== undefined) {
				return; //a missed poll is nothing; the next one answers
				}
			if ((theLastDataVersion !== undefined) && (data.version !== theLastDataVersion)) {
				if (flCellEditing || flDraggingColumn || flRestoringTableWindow || (ctExpandsInFlight > 0) || flDisplayHeld) { //9/24/26 by CC -- a refresh while an expand-all is loading subtables rebuilt the rows under it, and a refresh while a script holds the display (op.setDisplay (false), the way op.fullExpand's glue walks the summits) rebuilt the rows out from under the script's cursor, so its op.go answered false and the walk ended early; both wait
					flRefreshQueued = true;
					}
				else {
					refreshQuietly ();
					}
				}
			theLastDataVersion = data.version;
			});
		}
	askTheVersion ();
	setInterval (askTheVersion, 250); //8/31/26 by CC -- was 2000; DW's 8/29 report: his agent's value moved every ~2 seconds in the window, "should be a lot faster." The poll is one pragma on the server; four a second is nothing.
	}

//cell editing -- one input element, sitting exactly where the cell's text sits

var theOpenEdit; //assigned by placeEditInput while an edit is up: {commit} -- so a click elsewhere can finish this edit and then do its own work

function placeEditInput (theNode, theSpec) {

	/*  theSpec: {overElement, minWidth, text, onCommit (theText, whenDone), onTab}
		The input is placed directly OVER the element whose text is being
		edited -- same spot, same type size -- the kernel's in-place editing,
		not a box floating near the row. Commit on Return or on leaving the
		field; Escape walks away; Tab commits and moves to the other column,
		the kernel's tableedittabkey.  */

	const theWrapper = theNode.children (".concord-wrapper");
	const theInput = $("<input type=\"text\" class=\"inputCellEdit\">");

	/*  measure the real element -- the input lands on its exact spot, so
		the text doesn't move when editing starts  */

	const wrapperOffset = theWrapper.offset ();
	const targetOffset = theSpec.overElement.offset ();
	const theLeft = targetOffset.left - wrapperOffset.left;
	const theTop = targetOffset.top - wrapperOffset.top;
	theInput.css ({
		left: theLeft + "px",
		top: theTop + "px",
		height: theSpec.overElement.outerHeight () + "px",
		width: Math.max (theSpec.minWidth, theSpec.overElement.outerWidth ()) + "px"
		});
	theInput.val (theSpec.text);
	var flDone = false;
	flCellEditing = true;

	function endEditing () {
		if (flDone) {
			return;
			}
		flDone = true;
		theOpenEdit = undefined;
		theInput.remove ();
		flCellEditing = false;
		if (flRefreshQueued) {
			flRefreshQueued = false;
			refreshQuietly (); //what the poll held back while the edit was up
			}
		}
	function commit (flThenTab, afterward) {
		if (flDone) {
			if (afterward !== undefined) {
				afterward ();
				}
			return;
			}
		const theText = String (theInput.val ());
		theSpec.onCommit (theText, function () {
			endEditing ();
			if (flThenTab && (theSpec.onTab !== undefined)) {
				theSpec.onTab ();
				}
			if (afterward !== undefined) {
				afterward ();
				}
			});
		}
	theOpenEdit = {commit: function (afterward) {
		commit (false, afterward);
		}};
	theInput.on ("keydown", function (event) {
		switch (keyNameForEvent (event)) {
			case "Enter":
				event.preventDefault ();
				commit (false);
				break;
			case "Escape":
				event.preventDefault ();
				endEditing ();
				break;
			case "Tab":
				event.preventDefault ();
				commit (true);
				break;
			}
		event.stopPropagation ();
		});
	theInput.on ("blur", function () {
		commit (false);
		});
	theInput.on ("mousedown mouseup click dblclick", function (event) {

		/*  9/9/26 by CC -- A CLICK IN THE FIELD PLACES THE INSERTION POINT.
			Concord's own mousedown handler on the outline, for any click that
			isn't on a line's text, calls preventDefault and notes a drag --
			and this field sits beside the line's text, so every click in it
			was cancelled before the browser could move the caret: DW's 9/9
			report, "when i click to select text, nothing happens, the full
			text stays selected." The field's own mouse events stop here.  */

		event.stopPropagation ();
		});
	theWrapper.append (theInput);
	theInput.focus ();
	theInput.select ();
	}

function finishOpenEditThen (whatNext) { //a click on another cell finishes the open edit first -- the kernel's leave-cell-then-go

	if (theOpenEdit === undefined) {
		whatNext ();
		return;
		}
	theOpenEdit.commit (function () {
		setTimeout (whatNext, 0); //after the input is gone, so the next edit's measurements are clean
		});
	}

function startNameEdit (theNode) {
	if (flCellEditing) {
		return;
		}
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.name === undefined)) {
		return;
		}
	const theAddress = addressForNode (theNode);
	const geometry = columnGeometry ();
	const indent = theNode.data ("colIndent") || 0;
	placeEditInput (theNode, {
		overElement: theNode.children (".concord-wrapper").find (".concord-text").first (),
		minWidth: Math.max (80, geometry.leftValue - indent - 30),
		text: attributes.name,
		onCommit: function (theText, whenDone) {
			if ((theText.length === 0) || (theText === attributes.name)) { //the kernel's rule: empty means the name wasn't changed
				whenDone ();
				return;
				}
			const theOldName = attributes.name;
			tableEditCall ({action: "rename", address: theAddress, newname: theText}, function (err) {
				if (err !== undefined) {
					showError (err);
					whenDone ();
					return;
					}
				noteGuestName (theText, theOldName, parentAddressForNode (theNode)); //9/13/26 by CC
				attributes.name = theText;
				theNode.children (".concord-wrapper").find (".concord-text").first ().text (displayNameForRow (theText));
				refreshRowAddresses (); //9/6/26 by CC -- the rows under it are at new addresses now

				/*  9/3/26 by CC -- the row STAYS where it is. It moved to its
					sorted place on rename (8/28), and DW's 9/3 ruling is the
					kernel's: "this isn't what we did in the kernel because
					it's so confusing... we left it where it was, where I
					pressed Return to start editing the title. later when i
					want everything properly sorted, i can click on one of the
					column titles." The next full refresh sorts it.  */

				theState.cursorAddress = addressForNode (theNode);
				writeState ();
				whenDone ();
				});
			},
		onTab: function () {
			startValueEdit (theNode);
			}
		});
	}

function startValueEdit (theNode) {
	if (flCellEditing) {
		return;
		}
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.kind === undefined)) {
		return;
		}
	if (!kindIsEditable (attributes.kind)) {
		speakerBeep (); //tablecelliseditable: an external edits in its own window, not in the cell
		return;
		}
	const theAddress = addressForNode (theNode);
	tableEditCall ({action: "getvalue", address: theAddress}, function (err, data) { //the display truncates; editing needs the whole text
		if (err !== undefined) {
			showError (err);
			return;
			}
		const geometry = columnGeometry ();
		placeEditInput (theNode, {
			overElement: theNode.children (".concord-wrapper").children (".spanValue"),
			minWidth: Math.max (80, geometry.leftKind - geometry.leftValue - 34),
			text: data.editText,
			onCommit: function (theText, whenDone) {
				if (theText === data.editText) { //no change -- the kernel's equalhandles check
					whenDone ();
					return;
					}
				tableEditCall ({action: "setvalue", address: theAddress, text: theText}, function (setErr, setData) {
					if (setErr !== undefined) {
						speakerBeep (); //the kernel beeps when the value can't be made to fit; no dialog
						whenDone ();
						return;
						}
					attributes.value = setData.value;
					attributes.kind = setData.kind;
					const theWrapper = theNode.children (".concord-wrapper");
					theWrapper.children (".spanValue").text (valueTextFor (attributes));
					theWrapper.children (".spanKind").text (setData.kind);
					updateKindPopup (); //a fresh cell just took a type; the popup says so
					whenDone ();
					});
				},
			onTab: function () {
				startNameEdit (theNode);
				}
			});
		});
	}

//creating -- Return makes an item below the cursor; the wedge dialog gives it a non-scalar type

function makeNewItem () {

	/*  9/8/26 by CC -- RETURN ON AN EXPANDED TABLE MAKES ITS FIRST ITEM.
		opreturnkey in op.c: the new headline goes RIGHT when the cursor's
		subheads are expanded, DOWN otherwise -- and the table window runs
		the outliner's keystroke (tableverbkeystroke -> opkeystroke). DW's
		9/8 report: "i want to add a first item in an expanded table, so i
		press return. instead of going in as the first sub, which is standard
		outline behavior, it puts it in as a sibling." An expanded empty
		table holds its auto-created item #1, so the new item lands above it
		and the untouched item #1 goes away on collapse, as before.  */

	const theNode = cursorRowNode ();
	const flIntoTheCursor = (theNode !== undefined) && rowIsExpandedTable (theNode);
	const parentAddress = (theNode === undefined) ? theScope.address : (flIntoTheCursor ? addressForNode (theNode) : parentAddressForNode (theNode));
	tableEditCall ({action: "newitem", parentaddress: parentAddress}, function (err, data) {
		if (err !== undefined) {
			showError (err);
			return;
			}
		noteGuestName (data.name, undefined, parentAddress); //9/13/26 by CC
		if (theNode === undefined) { //an empty window -- reload, then pick the new row up
			refreshLevels ();
			setTimeout (function () {
				const theFresh = findNodeByAddress (joinAddress (parentAddress, data.name)); //9/9/26 by CC
				if (theFresh !== undefined) {
					concordOp ().setCursor (theFresh);
					startNameEdit (theFresh);
					}
				}, 800);
			return;
			}
		const theOp = concordOp ();
		theOp.setCursor (theNode);
		theOp.insert (data.name, flIntoTheCursor ? "right" : "down"); //opreturnkey's direction: into an expanded table, else below the cursor
		const theFresh = theOp.getCursor ();
		theFresh.data ("attributes", {name: data.name, value: data.value, kind: data.kind}); //the kernel's (nil) and (none)
		decorateRows ();
		theState.cursorAddress = addressForNode (theFresh);
		writeState ();
		startNameEdit (theFresh);
		});
	}

const typeChoices = [ //DW's 8/9 list, minus Picture -- his ruling 8/27
	{label: "Table", type: "table"},
	{label: "Outline", type: "outline"},
	{label: "WP-Text", type: "wptext"},
	{label: "Script", type: "script"},
	{label: "MenuBar", type: "menubar"}
	];

function showTypeDialog (theNode) {
	const attributes = theNode.data ("attributes");
	const theAddress = addressForNode (theNode);
	const theMask = $("<div class=\"divDialogMask\"></div>");
	const theDialog = $("<div class=\"divDialog divTypeDialog\"></div>");
	theDialog.append ($("<div class=\"divDialogPrompt\"></div>").text ("What type of object should " + attributes.name + " be?"));
	const theList = $("<div class=\"divTypeChoices\"></div>");
	typeChoices.forEach (function (theChoice, ix) {
		const theLabel = $("<label class=\"labelTypeChoice\"></label>");
		const theRadio = $("<input type=\"radio\" name=\"radioTypeChoice\">").val (theChoice.type);
		if (ix === 0) {
			theRadio.prop ("checked", true);
			}
		theLabel.append (theRadio).append ($("<span></span>").text (" " + theChoice.label));
		theList.append (theLabel);
		});
	theDialog.append (theList);
	const theButtons = $("<div class=\"divDialogButtons\"></div>");
	const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>");
	const buttonOk = $("<button class=\"buttonBar\">OK</button>");
	function closeDialog () {
		theMask.remove ();
		flCellEditing = false;
		if (flRefreshQueued) {
			flRefreshQueued = false;
			refreshQuietly ();
			}
		}
	buttonCancel.on ("click", closeDialog);
	buttonOk.on ("click", function () {
		const theType = String (theDialog.find ("input[name=radioTypeChoice]:checked").val ());
		tableEditCall ({action: "settype", address: theAddress, type: theType}, function (err) {
			closeDialog ();
			if (err !== undefined) {
				showError (err);
				return;
				}
			refreshLevels ();
			const theName = theAddress.slice (theAddress.lastIndexOf (".") + 1); //9/11/26 by CC -- DW's report: the object is made and the cursor is on it, but the window didn't scroll to show it. Reveal it once the reload settles.
			setTimeout (function () {
				putCursorOnRow (theName);
				}, 500);

			/*  9/24/26 by CC -- DW's 9/15 ask: "when he clicks OK, the window
				for the new object should open." A script, outline or wp text
				opens in the script window, a menubar in the menubar editor, a
				table in its own table window; a scalar has no window and is
				edited in place.  */

			const theWindowAddress = windowAddressForNode (theNode);
			if ((theType === "script") || (theType === "outline") || (theType === "wptext")) {
				window.open ("script.html?address=" + encodeURIComponent (theWindowAddress), "_blank");
				}
			else if (theType === "menubar") {
				window.open ("menubar.html?address=" + encodeURIComponent (theWindowAddress), "_blank");
				}
			else if (theType === "table") {
				window.open ("./?address=" + encodeURIComponent (theWindowAddress), "_blank");
				}
			});
		});
	theButtons.append (buttonCancel).append (buttonOk);
	theDialog.append (theButtons);
	theMask.append (theDialog);
	$("body").append (theMask);
	flCellEditing = true; //keystrokes belong to the dialog while it's up
	buttonOk.focus ();
	}

/*  9/13/26 by CC -- PASTE COPIES THE OBJECT, the kernel's browser paste. The
	clipboard from a table window carries the rows' addresses (common.js,
	shareTheClipboard); a paste here asks the server to copy each object
	into the table the cursor's row lives in -- "paste always happens in the
	list of the cursor's parent" (browservalidatepaste). When an item of the
	name is already there the kernel asks, and so does this: "An item named
	"x" already exists in this location." Replace, or Cancel. Then the level
	reloads and the cursor lands on the pasted row (DW, 8/25: the cursor
	lands on the pasted thing). DW's 9/13 report: he copied a script from
	one table window into another, renamed it, and the row was there with no
	size and nothing behind it -- the paste had only drawn a line.  */

function askToReplace (theQuestion, callback) { //callback (flReplace)
	const theMask = $("<div class=\"divDialogMask\"></div>");
	const theDialog = $("<div class=\"divDialog divReplaceDialog\"></div>");
	theDialog.append ($("<div class=\"divDialogPrompt\"></div>").text (theQuestion));
	const theButtons = $("<div class=\"divDialogButtons\"></div>");
	const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>");
	const buttonReplace = $("<button class=\"buttonBar\">Replace</button>");
	function closeDialog (flReplace) {
		theMask.remove ();
		flCellEditing = false;
		callback (flReplace);
		}
	buttonCancel.on ("click", function () {
		closeDialog (false);
		});
	buttonReplace.on ("click", function () {
		closeDialog (true);
		});
	theButtons.append (buttonCancel).append (buttonReplace);
	theDialog.append (theButtons);
	theMask.append (theDialog);
	$("body").append (theMask);
	flCellEditing = true; //keystrokes belong to the dialog while it's up
	buttonReplace.focus ();
	}

function pasteObjectsIntoTable (theAddresses) {
	const theCursor = cursorRowNode ();
	const theParentAddress = (theCursor === undefined) ? theScope.address : parentAddressForNode (theCursor);
	var ix = 0;
	var theLastName;
	function pasteNext () {
		if (ix >= theAddresses.length) {
			if (theLastName !== undefined) {
				refreshLevels ();
				setTimeout (function () { //once the reload settles, the cursor lands on the pasted row
					const theNode = findNodeByAddress (joinAddress (theParentAddress, theLastName));
					if (theNode !== undefined) {
						concordOp ().setCursor (theNode);
						theNode [0].scrollIntoView ({block: "nearest"});
						}
					}, 500);
				}
			return;
			}
		const theSource = theAddresses [ix];
		ix++;
		function pasteOne (flReplace) {
			tableEditCall ({action: "paste", sourceaddress: theSource, parentaddress: theParentAddress, flReplace: flReplace}, function (err, data) {
				if (err !== undefined) {
					showError (err);
					pasteNext ();
					return;
					}
				if (data.flExists === true) {
					askToReplace ("An item named \u201c" + data.name + "\u201d already exists in this location.", function (flYes) { //left and right double quotes, the kernel's words
						if (flYes) {
							pasteOne (true);
							}
						else {
							pasteNext ();
							}
						});
					return;
					}
				theLastName = data.name;
				noteGuestName (data.name, undefined, theParentAddress); //9/13/26 by CC
				pasteNext ();
				});
			}
		pasteOne (false);
		}
	pasteNext ();
	}

//deleting -- the cursor's row goes, the cursor moves up, windows on the object close

function deleteCursorRow () {
	const theNode = cursorRowNode ();
	if (theNode === undefined) {
		speakerBeep ();
		return;
		}
	const theAddress = addressForNode (theNode);
	tableEditCall ({action: "delete", address: theAddress}, function (err) {
		if (err !== undefined) {
			showError (err);
			return;
			}
		if (theWindowChannel !== undefined) { //tableclosewindows: windows on the deleted object, and on everything under it
			theWindowChannel.postMessage ({kind: "objectDeleted", address: theAddress.toLowerCase ()});
			}
		noteGuestName (undefined, theNode.data ("attributes").name, parentAddressForNode (theNode)); //9/13/26 by CC
		const theOp = concordOp ();
		theOp.setCursor (theNode);
		theOp.deleteLine (); //concord moves the cursor up before deleting, the kernel's max (0, row - 1)
		const theCursor = cursorRowNode ();
		if (theCursor !== undefined) {
			theState.cursorAddress = addressForNode (theCursor);
			writeState ();
			}
		});
	}

//column dragging -- two handles in the head band; the widths follow the drag and stick where they land

function currentPixelWidths () { //what the geometry works out to right now, as real numbers to start a drag from
	const geometry = columnGeometry ();
	return ([geometry.leftValue, geometry.leftKind - geometry.leftValue]);
	}

function persistColumnWidths () {
	if ((theScope.address !== undefined) && (theScope.address.length > 0)) {
		tableEditCall ({action: "setcolwidths", address: theScope.address, colWidths: theColumnWidths}, function (err) {
			if (err !== undefined) {
				console.log ("Can't save the column widths -- " + err.message);
				}
			});
		}
	else { //the merged root and database windows have no single table to keep them; the window remembers
		theState.colWidths = theColumnWidths;
		writeState ();
		}
	}

function placeColumnHandles () { //called from alignColumnHeads, so the handles follow the columns
	const theHeads = $(".divColumnHeads");
	if (theHeads.find (".divColDragHandle").length === 0) {
		[0, 1].forEach (function (ix) {
			const theHandle = $("<div class=\"divColDragHandle\"></div>").data ("colIx", ix);
			theHandle.on ("mousedown", function (event) {
				event.preventDefault ();
				startColumnDrag (ix, event.pageX);
				});
			theHeads.append (theHandle);
			});
		}
	const geometry = columnGeometry ();
	const leftOutliner = $("#divOutliner").offset ().left - theHeads.offset ().left;
	theHeads.find (".divColDragHandle").each (function () {
		const ix = $(this).data ("colIx");
		const theLeft = (ix === 0) ? geometry.leftValue : geometry.leftKind;
		$(this).css ("left", (leftOutliner + theLeft - 3) + "px"); //centered on the rule itself
		});
	}

//the Kind popup -- the kernel's way of changing a cell's type (tablepopup.c, string list 157)

const kindPopupChoices = [ //the kernel's list, in its order, minus Picture (DW's 8/27 ruling); type undefined means Atlantis can't make that kind yet, so the item stays disabled the way coercionpossible disables items there
	{label: "Boolean", type: "boolean", flScalar: true},
	{label: "Character", type: "char", flScalar: true},
	{label: "Number", type: "number", flScalar: true},
	{label: "Float"},
	{label: "Date", type: "date", flScalar: true},
	{label: "Direction"},
	{label: "String", type: "string", flScalar: true},
	{flSeparator: true},
	{label: "String4"},
	{label: "Enumerator"},
	{label: "File Specifier"},
	{label: "Alias"},
	{label: "Object Specifier"},
	{label: "Address", type: "address", flScalar: true},
	{flSeparator: true},
	{label: "Table", type: "table", flExternal: true},
	{label: "WP-Text", type: "wptext", flExternal: true},
	{label: "Outline", type: "outline", flExternal: true},
	{label: "Script", type: "script", flExternal: true},
	{label: "MenuBar", type: "menubar", flExternal: true},
	{flSeparator: true},
	{label: "List", type: "list", flListTarget: true},
	{label: "Record"},
	{label: "Binary"} //binary cells hold passwords; DW's call before they change type here
	];

const kindNamesForRowKinds = { //what the row's kind column says, mapped to the popup's type names
	"boolean": "boolean", "char": "char", "number": "number", "date": "date", "string": "string",
	"address": "address", "table": "table", "wp text": "wptext", "outline": "outline",
	"script": "script", "menubar": "menubar", "list": "list", "binary": "binary", "(none)": "novalue"
	};

function buildKindPopup () {
	const theSelect = $(".selectKindPopup");
	theSelect.empty ();
	theSelect.append ($("<option value=\"\" disabled>Kind</option>"));
	kindPopupChoices.forEach (function (theChoice, ix) {
		if (theChoice.flSeparator === true) {
			theSelect.append ($("<option disabled>──────</option>")); //box-drawing dashes
			return;
			}
		const theOption = $("<option></option>").text (theChoice.label).val ((theChoice.type === undefined) ? "unsupported-" + ix : theChoice.type);
		if (theChoice.type === undefined) {
			theOption.prop ("disabled", true);
			}
		theSelect.append (theOption);
		});
	theSelect.on ("change", function () {
		const theType = String (theSelect.val ());
		const theNode = cursorRowNode ();
		if ((theNode === undefined) || (theType.length === 0)) {
			return;
			}
		const theAddress = addressForNode (theNode);
		tableEditCall ({action: "settype", address: theAddress, type: theType}, function (err, data) {
			if (err !== undefined) {
				showError (err);
				updateKindPopup (); //back to what the cell really is
				return;
				}
			const attributes = theNode.data ("attributes");
			if (((data.kind === "table") !== (attributes.tableid !== undefined))) { //became a table (or stopped being one) -- the row's shape changes
				refreshLevels ();
				return;
				}
			attributes.value = data.value;
			attributes.kind = data.kind;
			const theWrapper = theNode.children (".concord-wrapper");
			theWrapper.children (".spanValue").text (valueTextFor (attributes));
			theWrapper.children (".spanKind").text (data.kind);
			updateKindPopup ();
			});
		});
	updateKindPopup ();
	}

function updateKindPopup () { //the popup shows the cursor cell's kind, the kernel's checked item
	const theSelect = $(".selectKindPopup");
	const theNode = cursorRowNode ();
	if (theNode === undefined) {
		theSelect.val ("");
		theSelect.prop ("disabled", true);
		return;
		}
	const attributes = theNode.data ("attributes");
	const theKind = (attributes === undefined) ? undefined : kindNamesForRowKinds [attributes.kind];
	theSelect.prop ("disabled", false);
	if ((theKind === undefined) || (theKind === "novalue")) {
		theSelect.val (""); //a cell with no value shows the title, nothing checked
		return;
		}
	theSelect.val (theKind);
	if (editableKinds [attributes.kind] !== true) {
		theSelect.prop ("disabled", true); //an external's popup shows its kind and changes nothing -- the kernel disables those moves too
		return;
		}

	/*  9/2/26 by CC -- DW's ask: "disable the items that would get an error
		dialog if you chose it." The server tries each coercion on the
		cell's value (coercionpossible's brute force, tablepopup.c) and
		answers the kinds that work; the rest go grey. The answer is for the
		cell the cursor is on now -- a late answer for a cell it has left
		is dropped.  */

	const theAddress = addressForNode (theNode);
	theSelect.find ("option").each (function () {
		const theOption = $(this);
		if (theOption.val ().indexOf ("unsupported-") !== 0) {
			theOption.prop ("disabled", theOption.val ().length === 0); //everything possible until the server says otherwise; the title stays disabled
			}
		});
	tableEditCall ({action: "possiblekinds", address: theAddress}, function (err, data) {
		if ((err !== undefined) || (data === undefined) || !Array.isArray (data.possible)) {
			return;
			}
		const theCursorNode = cursorRowNode ();
		if ((theCursorNode === undefined) || (addressForNode (theCursorNode) !== theAddress)) {
			return; //the cursor moved on
			}
		theSelect.find ("option").each (function () {
			const theOption = $(this);
			const theValue = theOption.val ();
			if ((theValue.length > 0) && (theValue.indexOf ("unsupported-") !== 0)) {
				theOption.prop ("disabled", data.possible.indexOf (theValue) === -1);
				}
			});
		});
	}

//the Sort popup -- the kernel's other bottom-band control (tablepopup.c, string list 156: Sort By Name, Sort By Value, Sort By Kind)

var theSortOrder = "name"; //what the window sorts by; rides with the table in its formats, beside the column widths
var flSortReversed = false; //9/2/26 by CC -- a second title click reversed the order for one night; DW's 9/3 ruling took it out: "do what the kernel does." Kept false; a table that saved a reversed order comes back forward.

function sortEntriesForDisplay (entries) {
	if (theSortOrder === "name") {
		return (flSortReversed ? entries.slice ().reverse () : entries); //the server's order -- by name, unicase
		}
	const theSorted = entries.slice ();
	theSorted.sort (function (a, b) {
		var left, right;
		if (theSortOrder === "kind") {
			left = a.kind.toLowerCase ();
			right = b.kind.toLowerCase ();
			}
		else { //by value -- numbers compare as numbers when both sides are numbers, the kernel compares real values
			const leftNumber = parseFloat (a.value);
			const rightNumber = parseFloat (b.value);
			if (!isNaN (leftNumber) && !isNaN (rightNumber)) {
				left = leftNumber;
				right = rightNumber;
				}
			else {
				left = a.value.toLowerCase ();
				right = b.value.toLowerCase ();
				}
			}
		if (left < right) {
			return (-1);
			}
		if (left > right) {
			return (1);
			}
		return ((a.name.toLowerCase () < b.name.toLowerCase ()) ? -1 : 1); //ties break by name
		});
	if (flSortReversed) {
		theSorted.reverse ();
		}
	return (theSorted);
	}

function buildSortPopup () {
	const theSelect = $(".selectSortPopup");
	theSelect.empty ();
	[{label: "Sort By Name", value: "name"}, {label: "Sort By Value", value: "value"}, {label: "Sort By Kind", value: "kind"}].forEach (function (theChoice) {
		theSelect.append ($("<option></option>").text (theChoice.label).val (theChoice.value));
		});
	theSelect.val (theSortOrder);
	theSelect.on ("change", function () {
		theSortOrder = String (theSelect.val ());
		flSortReversed = false; //the popup always chooses the forward order
		persistSortOrder ();
		refreshLevels (); //the window redraws in the new order
		});
	}

function wireColumnTitleClicks () { //8/31/26 by CC -- DW's 8/29 ask: "clicking on the column titles should also do the sort"
	[["spanHeadName", "name"], ["spanHeadValue", "value"], ["spanHeadKind", "kind"]].forEach (function (thePair) {
		$("." + thePair [0]).css ("cursor", "pointer").on ("click", function () {
			theSortOrder = thePair [1]; //9/3/26 by CC -- DW's ruling on the second click reversing the order (built 9/2): "do what the kernel does" -- tabletitleclick only ever sets the column; the reverse is out
			flSortReversed = false;
			$(".selectSortPopup").val (theSortOrder); //the popup shows the order the click chose
			persistSortOrder ();
			refreshLevels ();
			});
		});
	}

function persistSortOrder () {
	if ((theScope.address !== undefined) && (theScope.address.length > 0)) {
		tableEditCall ({action: "setsortorder", address: theScope.address, sortOrder: theSortOrder, flReversed: flSortReversed}, function (err) {
			if (err !== undefined) {
				console.log ("Can't save the sort order -- " + err.message);
				}
			});
		}
	else {
		theState.sortOrder = theSortOrder;
		theState.flSortReversed = flSortReversed;
		writeState ();
		}
	}

//dragging the rule between columns -- the kernel's gesture: the cursor turns at the boundary, anywhere in the grid

function startColumnDrag (ix, startX) {
	flDraggingColumn = true;
	const startWidths = currentPixelWidths ();
	function onMove (moveEvent) {
		const delta = moveEvent.pageX - startX;
		const widths = [startWidths [0], startWidths [1]];
		widths [ix] = Math.min (1000, Math.max (50, startWidths [ix] + delta)); //the kernel's mincolwidth and maxcolwidth, tableformats.c
		theColumnWidths = widths;
		applyColumnGeometry ();
		}
	function onUp () {
		$(document).off ("mousemove", onMove);
		$(document).off ("mouseup", onUp);
		flDraggingColumn = false;
		persistColumnWidths ();
		if (flRefreshQueued) {
			flRefreshQueued = false;
			refreshQuietly ();
			}
		}
	$(document).on ("mousemove", onMove);
	$(document).on ("mouseup", onUp);
	}

function columnBoundaryAt (pageX) { //which rule the mouse is near, or undefined -- ±4 pixels, the kernel's grab zone

	/*  9/2/26 by CC -- the grab zone is measured from the rule AS DRAWN --
		the left edge of a visible value or kind span, where the dotted
		border is -- instead of from the geometry the spans were placed by.
		The two differed by the wrapper's own left padding, so the zone sat
		a few pixels left of the line: DW's 9/2 report, "the active place
		horizontally is a few pixels to the left of the vertical line."  */

	const theValueSpan = $("#divOutliner .spanValue:visible").first ();
	const theKindSpan = $("#divOutliner .spanKind:visible").first ();
	if ((theValueSpan.length === 0) || (theKindSpan.length === 0)) {
		return (undefined);
		}
	if (Math.abs (pageX - theValueSpan.offset ().left) <= 4) {
		return (0);
		}
	if (Math.abs (pageX - theKindSpan.offset ().left) <= 4) {
		return (1);
		}
	return (undefined);
	}

function wireColumnRuleDragging () {
	const theContainer = $(".divOutlinerContainer");
	theContainer.on ("mousemove", function (event) {
		if (flDraggingColumn) {
			return;
			}
		theContainer.css ("cursor", (columnBoundaryAt (event.pageX) === undefined) ? "" : "col-resize");
		});
	theContainer [0].addEventListener ("mousedown", function (event) { //capture, so grabbing the rule never lands the cursor on a row
		const ix = columnBoundaryAt (event.pageX);
		if (ix !== undefined) {
			event.preventDefault ();
			event.stopPropagation ();
			startColumnDrag (ix, event.pageX);
			}
		}, true);
	}

//wiring -- keystrokes and clicks, called once from startOutliner

function wireTableEditing () {

	document.addEventListener ("keydown", function (event) {
		if (flCellEditing || flRestoringTableWindow) {
			return;
			}
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
			}
		const theTag = ((event.target !== null) && (event.target.tagName !== undefined)) ? event.target.tagName.toLowerCase () : "";
		if ((theTag === "input") || (theTag === "textarea")) {
			return;
			}
		if ((typeof event.key === "string") && (event.key.length === 1)) { //9/13/26 by CC -- a printable key is type-ahead (opstructuretextkey, see typeAheadKey); Return, Backspace and the arrows aren't single characters, and cmd, ctrl and option keys left above
			event.preventDefault ();
			event.stopPropagation ();
			typeAheadKey (event.key);
			return;
			}
		switch (keyNameForEvent (event)) {
			case "Enter":
				event.preventDefault ();
				event.stopPropagation ();
				makeNewItem ();
				break;
			case "Backspace": case "Delete":
				event.preventDefault ();
				event.stopPropagation ();
				deleteCursorRow ();
				break;
			}
		}, true);

	//a click on the value column edits the value; a click on the cursor row's name starts a rename, unless a double-click wins

	$("#divOutliner").on ("click", ".spanValue", function (event) {

		/*  8/28/26 by CC -- DW clicked a value and nothing happened. The
			click arrived while the name edit was still committing (blur
			fires first, and its server round-trip hadn't answered), so the
			old flCellEditing guard swallowed it. The kernel's shape:
			leaving one cell and entering another is ONE gesture -- finish
			the open edit, then open this one.  */

		event.stopPropagation ();
		const theNode = $(this).closest (".concord-node");
		finishOpenEditThen (function () {
			concordOp ().setCursor (theNode);

			/*  10/1/26 by CC -- A CLICK ON A VALUE THAT CAN'T BE EDITED IN PLACE
				MOVES THE CURSOR AND NOTHING ELSE. The click went on to
				startValueEdit, which beeps for a table, script, outline or
				menubar -- so the double-click that opens one of those beeped
				once for each of its two clicks: DW's 9/30 report, "it appears
				to work but there are two beeps at the end." In the kernel the
				only beep is the Tab key landing on such a cell
				(tableedittabkey, tablewindow.c); a mouse click there is the
				outliner's click (tableverbmousedown, opmousedown). Tab from
				the name still reaches startValueEdit and still beeps.  */

			const attributes = theNode.data ("attributes");
			if ((attributes !== undefined) && (attributes.kind !== undefined) && !kindIsEditable (attributes.kind)) {
				return;
				}
			startValueEdit (theNode);
			});
		});

	/*  10/1/26 by CC -- THE POINTER OVER A VALUE A DOUBLE-CLICK OPENS. DW,
		10/1: "the cursor should change to a pointer when you hover over the
		middle column to indicate that a 2click does something, you can't edit
		the text in place if it's an external type." Asked at the moment the
		mouse arrives, from what the row is now, so a value that changed kind
		under the window is still right.  */

	$("#divOutliner").on ("mouseenter", ".spanValue", function () {
		const attributes = $(this).closest (".concord-node").data ("attributes");
		$(this).toggleClass ("spanValueOpens", (attributes !== undefined) && (kindsADoubleClickOpens [attributes.kind] === true));
		});

	$("#divOutliner").on ("click", ".concord-text", function (event) {
		if (flRestoringTableWindow) {
			return;
			}
		const theText = $(this);
		const theNode = theText.closest (".concord-node");
		if (theOpenEdit !== undefined) { //a click on a name while editing elsewhere finishes that edit; the cursor click proceeds normally
			finishOpenEditThen (function () {
				concordOp ().setCursor (theNode);
				});
			return;
			}
		if (!theNode.hasClass ("concord-cursor")) { //first click lands the cursor; the second is the text action
			return;
			}
		clearTimeout (theNameClickTimer);
		theNameClickTimer = setTimeout (function () {
			startNameEdit (theNode);
			}, 350);
		});

	document.getElementById ("divOutliner").addEventListener ("dblclick", function (event) {
		clearTimeout (theNameClickTimer); //a double-click is never a rename
		const theIcon = $(event.target).closest (".node-icon");
		if (theIcon.length === 0) {
			return;
			}
		const theNode = theIcon.closest (".concord-node");
		const attributes = theNode.data ("attributes");
		if ((attributes !== undefined) && (attributes.kind === "(none)")) { //the wedge asks the type -- DW's 8/9 design
			event.preventDefault ();
			event.stopPropagation ();
			showTypeDialog (theNode);
			}
		}, true);
	}

function landOnFindLine (ixLine) { //9/24/26 by CC -- a Find hit on an object's name, or a scalar's value: the kernel's tablezoomfound lands in the TABLE window, on the row, the matched name selected

	/*  ixLine is -1 for a row hit; the row is named by the last part of the
		hit's address (theLastTableHit, common.js). The name is put in text
		mode with the match selected when the name is what matched; a
		scalar whose value matched gets the cursor on its row.  */

	if ((theLastTableHit === undefined) || (theLastTableHit.address === undefined)) {
		return;
		}
	const theHitAddress = String (theLastTableHit.address);
	const theName = theHitAddress.slice (theHitAddress.lastIndexOf (".") + 1);
	var theNode;
	$("#divOutliner .concord-node").each (function () {
		const attributes = $(this).data ("attributes");
		if ((theNode === undefined) && (attributes !== undefined) && (attributes.name !== undefined) && (attributes.name.toLowerCase () === theName.toLowerCase ())) {
			theNode = $(this);
			}
		});
	if (theNode === undefined) {
		return;
		}
	if ((theFindText.length > 0) && selectMatchInNode (theNode, 0)) { //the name matched: highlighted, the way the kernel selects it in the name column
		return;
		}
	putCursorOnRow (theName); //the value matched
	}

function landOnFindHitFromUrl () { //9/24/26 by CC -- a table window opened by a Find hit on one of its rows: land on it, and keep the walk going so cmd-G here steps to the next hit
	const theSearch = new URLSearchParams (window.location.search);
	const findLine = theSearch.get ("findline");
	if ((findLine === null) || (findLine === "") || (theScope.cursorName === undefined)) {
		return;
		}
	theFindText = theSearch.get ("find") || ""; //common.js globals, so cmd-G continues the table walk
	const theScopeParam = theSearch.get ("findscope") || "";
	if (theScopeParam.length > 0) {
		theTableFindScope = theScopeParam;
		theLastTableHit = {address: ((theScope.address.length > 0) ? (theScope.address + ".") : "") + theScope.cursorName, line: -1, menuline: -1};
		}
	landOnFindLine (-1);
	}

function restoreCursor () { //after the expansions are back -- a row that was visible then is visible now
	if (theScope.cursorName !== undefined) { //the window was opened to show a particular row, and that wins
		putCursorOnRow (theScope.cursorName);
		landOnFindHitFromUrl (); //9/24/26 by CC -- opened by a Find hit: the match highlighted, the walk carried
		return;
		}
	if ((theState.cursorAddress === undefined) || (theState.cursorAddress.length === 0)) {
		return;
		}
	const theNode = findNodeByAddress (theState.cursorAddress);
	if (theNode !== undefined) {
		concordOp ().setCursor (theNode);
		$(".divOutlinerContainer").scrollTop (theState.scrollTop); //setCursor scrolls its row to the top; the window belongs where the person left it
		}
	}
