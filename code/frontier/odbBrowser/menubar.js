/*  menubar.js -- THE MENUBAR EDITOR. 9/1/26 by CC, DW's go-ahead.

	The design: a menubar is an outline where every line can carry a script
	and a command key -- so the editor is the outline window opened on a
	menubar object. The structure edits the way any outline does; each
	line's command key shows in a column on the right and edits in place;
	double-clicking a line opens its script in an ordinary script window.
	Saves write the menubar object back, and the app's real menus follow
	the database, so a change here shows up in the menubar itself.

	What rides each concord node: ixOriginal (the line's index when the
	window loaded -- the server merges scripts and modifier flags by it, so
	a script saved from its own window is never clobbered by this window's
	stale copy) and cmdkey. A line typed fresh in the window has neither,
	which is what "no script yet" looks like.  */

var theAddress; //assigned at startup, from the url
var theSavedLines; //JSON of the lines as last saved -- undefined means unknown
var flSaveInFlight = false;

$(document).ready (function () {
	if (!getPassword ()) { //the password form is on screen -- the page starts over after Connect
		return;
		}
	showVersion ();
	letTheRightClickThrough ();
	captureFindKeystrokes (); //9/29/26 by CC -- cmd-F and cmd-G in a menubar window. The table window and the script window each asked for them; this window never did, so Find did nothing here -- DW's 9/29 report
	const theParams = new URLSearchParams (window.location.search);
	theAddress = theParams.get ("address");
	if ((theAddress === null) || (theAddress.length === 0)) {
		showStatus ("Can't open anything because the url carried no address.");
		return;
		}
	var theTitle = theParams.get ("title");
	if ((theTitle === null) || (theTitle.length === 0)) {
		theTitle = theAddress;
		}
	document.title = theTitle;
	$(".divWindowTitle").text (theTitle);

	$("#divOutliner").concord ({
		prefs: {
			outlineFont: "Ubuntu",
			outlineFontSize: 17,
			outlineLineHeight: 27,
			renderMode: false,
			readonly: false
			}
		});
	applyOutlinerPrefs ();

	serverCall ("/getmenubar", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			return;
			}
		if ((data.address !== undefined) && (data.address.toLowerCase () !== theAddress.toLowerCase ())) {
			theAddress = data.address; //the object's real address, the window title's rule
			if ((theParams.get ("title") === null) || (theParams.get ("title").length === 0)) {
				document.title = theAddress;
				$(".divWindowTitle").text (theAddress);
				}
			}
		buildTheOutline (data.lines);
		theSavedLines = JSON.stringify (collectTheLines ());
		showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
		bundleSetFirstCursor ();
		const theLineParam = theParams.get ("line"); //9/3/26 by CC -- the option-key open from the real menubar lands on the chosen command
		if ((theLineParam !== null) && (theLineParam.length > 0)) {
			landOnMenuLine (Number (theLineParam));
			}
		landOnFindHitFromUrl (); //9/24/26 by CC -- a Find hit inside this menubar: land on the menu line, and keep the walk going so cmd-G here steps to the next hit
		setInterval (autosaveCheck, 1500);
		});

	/*  Double-click on a line's text opens the command's script in a script
		window. Capture phase, because concord swallows double-clicks on the
		text. Unsaved structure goes to the database first, so the line
		number the script window opens on is the line number the database
		has.  */

	document.getElementById ("divOutliner").addEventListener ("dblclick", function (event) {

		/*  9/3/26 by CC -- THE WEDGE, NOT THE TEXT. DW's 9/3 ruling: "stick
			with the wedge. make it work there. not in the text." A double-click
			on the text is for editing the text and moves the selection; the
			wedge is the open gesture, the same one the table window uses.  */

		if ($(event.target).closest (".concord-text").length > 0) {
			return;
			}
		if ($(event.target).closest (".concord-wrapper").length === 0) {
			return;
			}
		const theNode = $(event.target).closest (".concord-node");
		if (theNode.length === 0) {
			return;
			}
		event.preventDefault ();
		event.stopPropagation ();

		/*  9/6/26 by CC -- A LINE WITH SUBHEADS EXPANDS OR COLLAPSES; ONLY A
			COMMAND OPENS ITS SCRIPT. DW, 9/6, on the blank window a double-click
			on a menu's title opened: "it's handling a 2-click as 'open the
			attached script' even when it's the title of a menu and doesn't
			have an attached script." The kernel (menueditor.c, meicon2click):
			`if (ophassubheads (hnode)) return (false);` -- the outliner's own
			double-click takes over, which toggles the line's subs.  */

		if (theNode.children ("ol").children (".concord-node").length > 0) {
			const op = $("#divOutliner").concord ().op;
			op.setTextMode (false);
			op.setCursor (theNode);
			if (op.subsExpanded ()) {
				op.collapse ();
				}
			else {
				op.expand ();
				}
			return;
			}
		saveIfDirty (function (err) {
			if (err !== undefined) {
				showStatus (err.message);
				return;
				}
			var ixLine = -1;
			$("#divOutliner .concord-node").each (function (ix) {
				if (this === theNode [0]) {
					ixLine = ix;
					}
				});
			const theUrl = "script.html?menubar=" + encodeURIComponent (theAddress) + "&menuline=" + ixLine;
			window.open (theUrl, "_blank");
			});
		}, true);
	});

function landOnMenuLine (ixLine) { //the cursor on this menu line, expanded to, scrolled into view
	const theTarget = $("#divOutliner .concord-node").eq (ixLine);
	if (theTarget.length > 0) {
		theTarget.parents (".concord-node").removeClass ("collapsed");
		$("#divOutliner").concord ().op.setCursor (theTarget);
		theTarget [0].scrollIntoView ({block: "center"});
		}
	}

function landOnFindLine (ixLine) { //9/24/26 by CC -- a Find hit lands here: on the menu line, with the matched text selected when the match is in the line's own text (the kernel's menufind: meexpandto the line)

	const theNodes = $("#divOutliner .concord-node");
	if ((ixLine < 0) || (ixLine >= theNodes.length)) {
		return;
		}
	const theNode = theNodes.eq (ixLine);
	theNode.parents (".concord-node").removeClass ("collapsed");
	if ((theFindText.length > 0) && (theLastTableHit !== undefined) && (theLastTableHit.line < 0) && selectMatchInNode (theNode, 0)) { //the match is in the menu line's text
		return;
		}
	landOnMenuLine (ixLine); //the match is in the line's script, which opens in its own window
	}

function noteInWindowHit (ixLine) { //9/24/26 by CC -- cmd-G found a further match in a menu line's text here: the walk resumes after that menu line
	if ((theLastTableHit !== undefined) && flThisWindowHoldsLastHit ()) {
		theLastTableHit.menuline = ixLine;
		theLastTableHit.line = -1;
		}
	}

function landOnFindHitFromUrl () { //9/24/26 by CC -- a Find-result window opened with the menu line in the url: land on it, and keep the walk going
	const theSearch = new URLSearchParams (window.location.search);
	const findLine = theSearch.get ("findline");
	if ((findLine === null) || (findLine === "")) {
		return;
		}
	theFindText = theSearch.get ("find") || ""; //common.js globals, so cmd-G continues the table walk
	const theScopeParam = theSearch.get ("findscope") || "";
	if (theScopeParam.length > 0) {
		theTableFindScope = theScopeParam;
		const theHitLine = theSearch.get ("findhitline");
		theLastTableHit = {address: theAddress, menuline: Number (findLine), line: ((theHitLine === null) || (theHitLine === "")) ? -1 : Number (theHitLine)};
		}
	landOnFindLine (Number (findLine));
	}

function bundleSetFirstCursor () {
	const theFirst = $("#divOutliner .concord-node").first ();
	if (theFirst.length > 0) {
		$("#divOutliner").concord ().op.setCursor (theFirst);
		}
	}

/*  applyOutlinerPrefs and showStatus are copied from script.js -- the two
	pages don't share a file beyond common.js, the trigger/runnerWorker
	pattern: change one, change both.  */

function applyOutlinerPrefs () {
	serverCall ("/listtable", {address: "user.prefs.outliner"}, "GET", function (err, data) {
		if (err !== undefined) { //no table there is the normal case, not a failure
			return;
			}
		const thePrefs = {};
		data.entries.forEach (function (theEntry) {
			if (theEntry.name === "font") {
				thePrefs.outlineFont = theEntry.value;
				}
			if (theEntry.name === "fontSize") {
				thePrefs.outlineFontSize = Number (theEntry.value);
				}
			if (theEntry.name === "lineHeight") {
				thePrefs.outlineLineHeight = Number (theEntry.value);
				}
			});
		if (Object.keys (thePrefs).length > 0) {
			$("#divOutliner").concord ().prefs (thePrefs);
			}
		nudgeOutlineText (); //9/9/26 by CC
		});
	nudgeOutlineText ();
	applyCustomCss (); //9/10/26 by CC -- his own CSS, from user.prefs.outliner.css
	}

function showStatus (theText) {
	$("#spanStatus").text (theText).attr ("title", theText);
	}

$(document).on ("click", "#spanStatus", function () { //clicking the message line makes the message go away
	$(this).text ("").attr ("title", "");
	});

function windowIsModified () { //9/14/26 by CC -- window.isModified (adr) on a menubar window
	return ((theSavedLines === undefined) || (JSON.stringify (collectTheLines ()) !== theSavedLines));
	}

function windowSetModified (flModified) { //9/14/26 by CC -- window.setModified (adr, fl) on a menubar window
	theSavedLines = flModified ? undefined : JSON.stringify (collectTheLines ());
	}

function reloadThisWindow () { //9/13/26 by CC -- window.update (adr) on this menubar: the lines come back from the database (common.js, "window.update")
	serverCall ("/getmenubar", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			return;
			}
		buildTheOutline (data.lines);
		theSavedLines = JSON.stringify (collectTheLines ());
		showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
		bundleSetFirstCursor ();
		});
	}

function buildTheOutline (theLines) {

	function escapeAttribute (theText) {
		return (String (theText).split ("&").join ("&amp;").split ("<").join ("&lt;").split (">").join ("&gt;").split ("\"").join ("&quot;"));
		}

	var theOpml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head></head><body>";
	var lastLevel = -1;
	theLines.forEach (function (theLine) {
		const theLevel = Math.max (0, Number (theLine.level));
		while (lastLevel >= theLevel) {
			theOpml += "</outline>";
			lastLevel--;
			}
		theOpml += "<outline text=\"" + escapeAttribute (theLine.text) + "\">";
		lastLevel = theLevel;
		});
	while (lastLevel >= 0) {
		theOpml += "</outline>";
		lastLevel--;
		}
	theOpml += "</body></opml>";
	$("#divOutliner").concord ().op.xmlToOutline (theOpml, false);

	/*  The per-line facts ride the DOM nodes, so they follow a line when
		it's dragged somewhere else.  */

	$("#divOutliner .concord-node").each (function (ix) {
		const theLine = theLines [ix];
		if (theLine === undefined) {
			return;
			}
		$(this).data ("ixOriginal", ix);
		$(this).data ("cmdkey", (theLine.cmdkey === undefined) ? "" : String (theLine.cmdkey));
		if ((theLine.flExpanded === false) && ($(this).children ("ol").children (".concord-node").length > 0)) {
			$(this).addClass ("collapsed");
			}
		});
	decorateCommandKeys ();
	}

function decorateCommandKeys () { //every line shows its command key in a column on the right, edited in place
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const theWrapper = theNode.children (".concord-wrapper");
		if (theWrapper.find (".spanCmdkey").length === 0) {
			const theSpan = $("<span class=\"spanCmdkey\"></span>");
			theSpan.on ("click", function (event) {
				event.stopPropagation ();
				startCmdkeyEdit (theNode, theSpan);
				});
			theWrapper.append (theSpan);
			}
		theWrapper.find (".spanCmdkey").first ().text (cmdkeyDisplay (theNode.data ("cmdkey")));
		});
	}

function cmdkeyDisplay (theKey) {
	if ((theKey === undefined) || (theKey === null) || (String (theKey).length === 0)) {
		return ("");
		}
	return ("⌘" + String (theKey)); //place of interest sign, the command key symbol
	}

function startCmdkeyEdit (theNode, theSpan) {
	const theInput = $("<input class=\"inputCmdkey\" maxlength=\"1\">");
	theInput.val ((theNode.data ("cmdkey") === undefined) ? "" : theNode.data ("cmdkey"));
	theSpan.hide ();
	theSpan.after (theInput);
	theInput.focus ().select ();
	function commit () {
		const theKey = String (theInput.val ()).toUpperCase ().slice (0, 1);
		theNode.data ("cmdkey", theKey);
		theInput.remove ();
		theSpan.text (cmdkeyDisplay (theKey)).show ();
		}
	theInput.on ("blur", commit);
	theInput.on ("keydown", function (event) {
		if (event.key === "Enter") {
			event.preventDefault ();
			theInput.off ("blur", commit);
			commit ();
			}
		if (event.key === "Escape") {
			theInput.off ("blur", commit);
			theInput.remove ();
			theSpan.show ();
			}
		event.stopPropagation ();
		});
	}

function collectTheLines () { //the window's structure, in the walk order the menubar object keeps
	const theLines = [];
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const theLine = {
			level: theNode.parents (".concord-node").length,
			text: theNode.children (".concord-wrapper").find (".concord-text").first ().text (),
			flExpanded: !theNode.hasClass ("collapsed")
			};
		const theKey = theNode.data ("cmdkey");
		if ((theKey !== undefined) && (String (theKey).length > 0)) {
			theLine.cmdkey = String (theKey);
			}
		const ixOriginal = theNode.data ("ixOriginal");
		if (ixOriginal !== undefined) {
			theLine.ixoriginal = ixOriginal;
			}
		theLines.push (theLine);
		});
	return (theLines);
	}

function autosaveCheck () {
	if (flSaveInFlight || (theSavedLines === undefined)) {
		return;
		}
	if (!flTypingPaused ()) { //9/2/26 by CC -- DW's rule: nothing happens in the background while the person is typing; half a second of quiet first
		return;
		}
	decorateCommandKeys (); //a line typed since the last look gets its column
	if (JSON.stringify (collectTheLines ()) !== theSavedLines) {
		saveTheMenubar ();
		}
	}

function saveIfDirty (callback) {
	if ((theSavedLines === undefined) || (JSON.stringify (collectTheLines ()) === theSavedLines)) {
		callback (undefined);
		return;
		}
	saveTheMenubar (callback);
	}

function saveTheMenubar (callback) {
	const theLines = collectTheLines ();
	flSaveInFlight = true;
	serverCall ("/menubaredit", {jsontext: JSON.stringify ({action: "save", address: theAddress, lines: theLines})}, "POST", function (err, data) {
		flSaveInFlight = false;
		if ((err === undefined) && (data.message !== undefined)) {
			err = data;
			}
		if (err !== undefined) {
			showStatus (err.message);
			if (callback !== undefined) {
				callback (err);
				}
			return;
			}

		/*  The database's lines are now exactly this window's order, so
			every node's merge index is simply its place in the walk.  */

		$("#divOutliner .concord-node").each (function (ix) {
			$(this).data ("ixOriginal", ix);
			});
		theSavedLines = JSON.stringify (collectTheLines ());
		if (callback !== undefined) {
			callback (undefined);
			}
		});
	}
