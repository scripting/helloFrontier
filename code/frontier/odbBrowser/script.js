var theAddress, theScriptType; //assigned at startup, from the url and the download
var theSavedBody; //the outline body as saved in the database, in this page's own rendering; undefined means unknown
var theLastSeenBody; //the body at the last autosave check
var flAutosave; //assigned at startup -- odb data saves itself, the way Frontier does; only a window with odb buttons waits for Save
var flSaveInFlight = false; //one save at a time -- two in-flight uploads could land out of order
var theMenubarAddress, theMenubarLineIx, theMenubarLineText; //assigned at startup when the window edits a MENU COMMAND's script -- 9/1/26 by CC, the menubar editor; theMenubarLineText rides every save so a script can't land on the wrong command after the menubar was rearranged

function opmlBody (theOpml) { //just the outline -- the head carries a timestamp that changes on every render, so comparing whole documents always says "changed"
	const ixStart = theOpml.indexOf ("<body>");
	const ixEnd = theOpml.lastIndexOf ("</body>");
	if ((ixStart === -1) || (ixEnd === -1)) {
		return (theOpml);
		}
	return (theOpml.substring (ixStart, ixEnd));
	}

$(document).ready (function () {
	if (!getPassword ()) { //the password form is on screen -- the page starts over after Connect
		return;
		}
	showVersion ();
	letTheRightClickThrough ();
	const theParams = new URLSearchParams (window.location.search);
	theAddress = theParams.get ("address");
	theMenubarAddress = theParams.get ("menubar"); //9/1/26 by CC -- the window edits one menu command's script, inside the menubar object
	theMenubarLineIx = theParams.get ("menuline");
	const flMenubarScript = (theMenubarAddress !== null) && (theMenubarAddress.length > 0);
	if (flMenubarScript) {
		theAddress = theMenubarAddress + " line " + theMenubarLineIx; //only for the draft and window-state keys; the object has no address of its own
		}
	if ((theAddress === null) || (theAddress.length === 0)) {
		showStatus ("Can't open anything because the url carried no address.");
		return;
		}
	var theTitle = theParams.get ("title"); //8/8/26 by CC -- a window opened by the edit verb carries its own title
	if ((theTitle === null) || (theTitle.length === 0)) {
		theTitle = theAddress;
		}
	const flReadonly = theParams.get ("readonly") === "1";
	document.title = theTitle;
	$(".divWindowTitle").text (theTitle);
	const theButtonsAddress = theParams.get ("buttons"); //8/8/26 by CC -- the edit verb points at a table of scripts, one per button
	const flOdbButtons = (theButtonsAddress !== null) && (theButtonsAddress.length > 0);
	removeBuiltInButtons (); //8/12/26 by CC -- what buttons a window gets depends on what it opened on; they go up once that's known
	if (flOdbButtons) {
		buildOdbButtons (theButtonsAddress);
		}
	flAutosave = !flReadonly; /*  8/19/26 by CC -- BACK TO THE WAY FRONTIER WORKS, DW's instruction. On 8/12 I made a window with
		project buttons wait for Save, reasoning that Save means deploy and half-typed edits shouldn't ship. That reasoning was mine
		and it was wrong -- his Save button runs HIS script and builds the project, and Frontier saves as you type everywhere. He
		found it by noticing an "unsaved changes" indicator that never cleared, with new code in the window and not in the database.  */
	$("#divOutliner").concord ({

		/*  8/12/26 by CC -- Drummer's formatting, which is also Concord, and
			which DW checked against his running copy: Ubuntu 17, line height
			27. His reason: "a fair amount of time went into that in drummer."
			These are the fallbacks; user.prefs.outliner wins, see below.  */

		prefs: {
			outlineFont: "Ubuntu",
			outlineFontSize: 17,
			outlineLineHeight: 27,
			renderMode: false,
			readonly: flReadonly
			},
		callbacks: {
			opCursorMoved: rememberWindowSoon,
			opExpand: function (op) { //9/29/26 by CC -- the subheads show after an expand, the kernel's opvisisubheads (common.js)
				scrollExpandedIntoView (op.getCursor ());
				rememberWindowSoon ();
				},
			opCollapse: rememberWindowSoon
			}
		});
	applyOutlinerPrefs (); //8/12/26 by CC
	if (flReadonly !== true) {
		captureMenubarKeystrokes (); //8/12/26 by CC -- cmd-/ and cmd-\ belong to the menubar, not to Concord
		}

	/*  8/12/26 by CC -- cmd-double-click on an address in the text opens
		what it names. Capture phase, because Concord answers double-clicks
		of its own.  */

	document.getElementById ("divOutliner").addEventListener ("dblclick", function (event) {

		/*  8/17/26 by CC -- only when the double-click landed ON THE TEXT of a
			line. The wedge, the bullet and the space around them belong to the
			outliner, and a double-click there means expand or collapse. This
			handler reads the SELECTION, which survives from wherever it was
			last set, so without this test a wedge click right after a click on
			a dotted address could be taken for another click on that address
			-- and get swallowed.  */

		if ($(event.target).closest (".concord-text").length === 0) {
			return;
			}
		const theAddress = addressAtSelection ();
		if (theAddress === undefined) {
			return;
			}
		if (event.metaKey === true) { //cmd-double-click opens what the address names
			event.preventDefault ();
			event.stopPropagation ();
			openObjectAtAddress (theAddress, showStatus);
			return;
			}
		if (theAddress.indexOf (".") !== -1) { //8/14/26 by CC -- a plain double-click on a dotted id selects the whole thing, DW's ask; a wordless click or a plain word stays Concord's
			event.preventDefault ();
			event.stopPropagation ();
			}
		}, true);
	if (flMenubarScript) {

		/*  9/1/26 by CC -- a menu command's script lives INSIDE the menubar
			object, so it moves through /menubaredit instead of the address
			endpoints. The window is otherwise the ordinary script window --
			the same outline, the same autosave.  */

		serverCall ("/menubaredit", {jsontext: JSON.stringify ({action: "getscript", address: theMenubarAddress, ixline: Number (theMenubarLineIx)})}, "POST", function (err, data) {
			if (err !== undefined) {
				showStatus (err.message);
				return;
				}
			if (data.message !== undefined) {
				showStatus (data.message);
				return;
				}
			theMenubarLineText = data.lineText;
			theScriptType = "script";
			if ((theParams.get ("title") === null) || (theParams.get ("title").length === 0)) {
				document.title = data.lineText + " — " + theMenubarAddress; //em dash
				$(".divWindowTitle").text (document.title);
				}
			loadOutlineXml (data.opmltext); //10/1/26 by CC -- built off the page, see common.js
			theSavedBody = opmlBody (currentOpml ());
			theLastSeenBody = theSavedBody;
			showStatus ("");
			bundleSetFirstCursor ();
			landOnFindHitFromUrl (); //9/24/26 by CC -- a Find hit in this menu command's script: land on the line, the match selected
			setInterval (autosaveCheck, 1500);
			});
		return;
		}
	serverCall ("/downloadobject", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			}
		else {

			/*  8/28/26 by CC -- the window carries the object's REAL address,
				DW's report: opened on "console.log" from a one-liner, the
				title said console.log and nothing told him where he'd
				landed. Berkeley says suites.console.log. The full path is
				the title now (unless the edit verb handed one in), and it's
				also the address the window answers for on the channel --
				frontmostverb's rule, an address built from the table the
				variable was actually found in.  */

			if ((data.resolvedAddress !== undefined) && (data.resolvedAddress.length > 0) && (data.resolvedAddress.toLowerCase () !== theAddress.toLowerCase ())) {
				theAddress = data.resolvedAddress;
				if ((theParams.get ("title") === null) || (theParams.get ("title").length === 0)) {
					document.title = theAddress;
					$(".divWindowTitle").text (theAddress);
					}
				}
			theScriptType = data.scriptType;
			if ((theScriptType === "script") && (flOdbButtons !== true) && (flReadonly !== true)) {
				buildScriptButtons (); //8/12/26 by CC -- now that the window knows it opened on a script
				}

			/*  8/12/26 by CC -- an OUTLINE renders its markup, a script shows
				its text as written. DW keeps bold in his notepad, and it went
				literal the moment anything redrew a line: Concord escapes on
				redraw unless it's in render mode, so the tags survived the
				first draw and died on the next one. A script window stays
				out of render mode -- code is the characters you typed.  */

			if (theScriptType === "outline") {
				$("#divOutliner").concord ().op.setRenderMode (true);
				}
			const theDraft = localStorage.getItem (draftKey ());
			if (theDraft !== null) { //edits from last time that never made it to the database
				loadOutlineXml (theDraft);
				showDirty (true); //theSavedBody stays undefined -- the window is dirty until the next Save
				showStatus ("Restored unsaved changes from last time.");
				if (flAutosave) { //8/12/26 by CC -- an autosave window has no Save button to press; the restored edits go into the database now
					saveToDatabase ();
					}
				}
			else {
				/*  8/12/26 by CC -- an object already in the database with no
					lines in it still opens on a line you can type in; there is
					no zero-line outline in Frontier.  */
				const theOpml = (data.ctLines === 0) ? "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head><title>" + theAddress + "</title></head><body><outline text=\"\"></outline></body></opml>" : data.opmltext;
				loadOutlineXml (theOpml); //10/1/26 by CC -- built off the page, see common.js
				theSavedBody = opmlBody (currentOpml ()); //this page's own rendering, so later compares are apples to apples
				showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
				}
			theLastSeenBody = opmlBody (currentOpml ());
			if (restoreWindowState () !== true) { //8/12/26 by CC -- a window it has never seen before opens on line one
				bundleSetFirstCursor (); //8/11/26 by CC -- the way the OPML Editor does; without a cursor, every op verb (and cmd-/) has nothing to work on
				}
			landOnFindHitFromUrl (); //9/11/26 by CC -- a Find hit opened this window at a line; land on it, over any restored cursor
			markWindowReadyForTarget (flReadonly); //8/15/26 by CC -- the outline is up; a script that opened this window can aim at it now
			setInterval (autosaveCheck, 1500);
			if (flReadonly) { //8/13/26 by CC -- a read-only window is a VIEWER: it shows what's in the database now, which is what makes the console live
				theShownBody = opmlBody (data.opmltext);
				setInterval (refreshIfChanged, 2000);
				}
			}
		});
	$("#buttonSave").click (saveScript);
	$("#buttonRun").click (runScript);
	$("#buttonZoom").click (zoomOutline);
	$(".divOutlinerContainer").scroll (rememberWindowSoon); //8/12/26 by CC
	$(window).on ("pagehide", rememberWindow); //8/16/26 by CC -- the debounce could lose the last cursor move or collapse when the window closed inside its 400ms
	});

function draftKey () {
	return ("odbDraft:" + theAddress);
	}

function reloadThisWindow () { //9/13/26 by CC -- window.update (adr) on this window: the object comes back from the database, the cursor stays on its line (common.js, "window.update")
	serverCall ("/downloadobject", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			return;
			}
		const theOp = $("#divOutliner").concord ().op;
		const theNodesBefore = $("#divOutliner .concord-node");
		var ixCursor = -1;
		theNodesBefore.each (function (ix) {
			if ($(this).hasClass ("concord-cursor")) {
				ixCursor = ix;
				}
			});
		const theOpml = (data.ctLines === 0) ? "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><head><title>" + theAddress + "</title></head><body><outline text=\"\"></outline></body></opml>" : data.opmltext;
		loadOutlineXml (theOpml);
		theSavedBody = opmlBody (currentOpml ());
		theLastSeenBody = theSavedBody;
		theShownBody = opmlBody (data.opmltext);
		const theNodesAfter = $("#divOutliner .concord-node");
		if ((ixCursor >= 0) && (ixCursor < theNodesAfter.length)) {
			const theNode = theNodesAfter.eq (ixCursor);
			revealNode (theNode);
			theOp.setCursor (theNode);
			}
		else {
			bundleSetFirstCursor ();
			}
		showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
		});
	}

var theShownBody; //8/13/26 by CC -- what the read-only viewer last rendered, in the server's own rendering

function refreshIfChanged () {

	/*  8/13/26 by CC -- the read-only window polls the database and redraws
		when the object changed. If the person was reading the bottom, the
		bottom follows the new lines -- a console tails; anywhere else, the
		scroll stays put. A failed poll says nothing; the next one may
		succeed.  */

	serverCall ("/downloadobject", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			return;
			}
		const theBody = opmlBody (data.opmltext);
		if (theBody === theShownBody) {
			return;
			}
		theShownBody = theBody;
		const theContainer = $(".divOutlinerContainer");
		const flAtBottom = (theContainer.scrollTop () + theContainer.innerHeight () + 40) >= theContainer [0].scrollHeight;
		loadOutlineXml (data.opmltext); //10/1/26 by CC -- built off the page, see common.js
		if (flAtBottom) {
			theContainer.scrollTop (theContainer [0].scrollHeight);
			}
		});
	}

/*  Everything is where you left it -- 8/12/26 by CC.

	Which lines were collapsed, where the cursor was, how far down the
	window was scrolled. Lines are counted the way the op verbs count them,
	their place in a flat walk of the whole outline, collapsed lines
	included -- so the numbers mean the same thing to both.

	This is per window, kept on this machine, the way a window's size and
	place are. Nothing about it goes into the database.  */

var flRestoringWindow = false; //while it's true, putting the window back doesn't count as the person moving things
var theRememberTimer;

function windowStateKey () {
	return ("odbWindowState:" + theAddress);
	}

function rememberWindowSoon () {
	if (flRestoringWindow) {
		return;
		}
	clearTimeout (theRememberTimer);
	theRememberTimer = setTimeout (rememberWindow, 400);
	}

function rememberWindow () {
	const theNodes = $("#divOutliner .concord-node");
	const theCursor = $("#divOutliner").concord ().op.getCursor ();
	const collapsed = [];
	var ixCursor = -1;
	theNodes.each (function (ix) {
		if (this.classList.contains ("collapsed")) { //10/1/26 by CC -- asked of the element itself; wrapping every line in jQuery took 0.6 seconds on 20,520 lines, each time the window remembered itself
			collapsed.push (ix);
			}
		if ((theCursor.length > 0) && (this === theCursor [0])) {
			ixCursor = ix;
			}
		});
	localStorage.setItem (windowStateKey (), JSON.stringify ({
		collapsed,
		ixCursor,
		ctLines: theNodes.length, //9/13/26 by CC -- so a state saved for a different outline is known for what it is (see restoreWindowState)
		scrollTop: $(".divOutlinerContainer").scrollTop ()
		}));
	}

function restoreWindowState () { //true if there was something to restore

	const theText = localStorage.getItem (windowStateKey ());
	if (theText === null) {
		return (false);
		}
	var theState;
	try {
		theState = JSON.parse (theText);
		}
	catch (err) {
		return (false);
		}
	const theOp = $("#divOutliner").concord ().op;
	const theNodes = $("#divOutliner .concord-node");
	flRestoringWindow = true;

	/*  Every line is put the way it was, opened as well as closed -- the
		outline arrives with whatever expansion the database remembers, and
		a line the person opened has to come back open. Only the lines whose
		state differs are touched.  */

	/*  9/13/26 by CC -- A STATE SAVED FOR A DIFFERENT OUTLINE IS NOT APPLIED.
		The lines are remembered by their position in a flat walk, and every
		line not on the collapsed list is opened -- so a state saved when the
		object had other lines (a project rebuilt, an object replaced by an
		update, a window whose object changed under it) opened nearly
		everything. DW's 9/13 report: wpIdentity's project window came up with
		every line expanded while daveAppServer's came up right; the database
		holds both folded (322 open lines of 6,084, 99 of 3,017). When the
		saved line count doesn't match, the outline keeps the folding the
		database remembers; the cursor and scroll still come back.  */

	const flSameOutline = (theState.ctLines === theNodes.length); //a state saved before today has no count and isn't trusted; the next save writes one
	if (flSameOutline) {

		/*  10/1/26 by CC -- EACH LINE IS OPENED OR CLOSED WHERE IT STANDS. This
			walked the outline moving Concord's cursor to every line whose
			state differed and telling Concord to expand or collapse it; each
			of those lays the whole outline out again, so an outline with
			thousands of lines to open took minutes to come up -- and that is
			what a stopped Expand Everything left behind for the next launch:
			DW's 10/1 report, "quit the app and restarted but it was saving the
			interim result?" What a line's being collapsed IS, to Concord, is
			the class on its node, and only a line with subheads carries it;
			so the class is set on each line directly. Same outline on screen,
			one layout at the end.  */

		const flCollapsedAt = {};
		theState.collapsed.forEach (function (ix) {
			flCollapsedAt [ix] = true;
			});
		theNodes.each (function (ix) {
			const flShouldBeCollapsed = (flCollapsedAt [ix] === true) && (firstSubheadElement (this) !== undefined); //firstSubheadElement is common.js's
			if (this.classList.contains ("collapsed") !== flShouldBeCollapsed) {
				this.classList.toggle ("collapsed", flShouldBeCollapsed);
				}
			});
		}
	if ((theState.ixCursor >= 0) && (theState.ixCursor < theNodes.length)) {
		const theCursorNode = theNodes.eq (theState.ixCursor);
		revealNode (theCursorNode); //8/16/26 by CC -- a cursor restored into a collapsed branch was invisible, which reads as no cursor at all; the kernel expands to show it, the way a find hit lands
		theOp.setCursor (theCursorNode);
		}
	else {
		bundleSetFirstCursor ();
		}
	if (theState.scrollTop !== undefined) {
		$(".divOutlinerContainer").scrollTop (theState.scrollTop);
		}
	flRestoringWindow = false;
	return (true);
	}

function bundleSetFirstCursor () { //8/11/26 by CC
	const theFirst = $("#divOutliner .concord-node").first ();
	if (theFirst.length > 0) {
		$("#divOutliner").concord ().op.setCursor (theFirst);
		}
	}

function revealNode (theNode) { //8/16/26 by CC -- expand every collapsed ancestor so the line is visible
	var current = theNode.parent ().closest (".concord-node");
	while (current.length > 0) {
		current.removeClass ("collapsed");
		current = current.parent ().closest (".concord-node");
		}
	}

function applyOutlinerPrefs () {

	/*  8/12/26 by CC -- the person's own formatting, from
		user.prefs.outliner: font, fontSize, lineHeight. Anything missing
		keeps the built-in value, so an empty table changes nothing and a
		table with one entry in it changes one thing.

		Named for the role, not for Concord, at DW's call -- and temporary
		by intent: where these values really belong, and whether they're a
		named style rather than three numbers, is a discussion we set aside
		today. A change shows up in the next window you open.  */

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
		nudgeOutlineText (); //9/9/26 by CC -- two pixels up, DW's ask
		});
	nudgeOutlineText (); //and for the built-in values, before the table answers
	applyCustomCss (); //9/10/26 by CC -- his own CSS, from user.prefs.outliner.css
	}

function removeBuiltInButtons () { //8/12/26 by CC -- the bar starts empty; what goes in it depends on what the window opened on
	$("#buttonSave").remove ();
	$("#buttonRun").remove ();
	$("#buttonZoom").remove ();
	}

function buildScriptButtons () {

	/*  8/12/26 by CC -- what a script window carries in Frontier, from DW's
		screenshot of one of his own: Run, Debug, Compile. Two of them have
		nothing behind them yet and go up disabled, at his instruction --
		"I want to keep being reminded we need to do some of this."

		An outline window gets none of these; there's no single bit of code
		in an outline to run. Neither does a window nodeEditor opened, for
		the same reason in his words: "it isn't a single bit of code and Run
		makes no sense there" -- those get their buttons from his table.  */

	const buttonRun = $("<button class=\"buttonBar\" id=\"buttonRun\">Run</button>").click (runScript); //8/17/26 by CC -- the id so the shared Kill machinery can find it while a run is in flight
	const buttonDebug = $("<button class=\"buttonBar\" disabled>Debug</button>");
	const buttonCompile = $("<button class=\"buttonBar\" id=\"buttonCompile\">Compile</button>").click (compileScript); //8/14/26 by CC -- live, DW: "i need the Compile button active, so i can hunt for a syntax error without running it"
	$("#spanDirty").before (buttonRun, buttonDebug, buttonCompile);
	}

function buildOdbButtons (theButtonsAddress) {

	/*  8/8/26 by CC -- the buttons come from the database: a table of
		scripts, one per button, named "00001000<tab>Save" -- the number
		sorts them, the label follows the tab. Clicking a button fetches
		its script fresh and runs it -- the table is user-editable data,
		so the click always runs what's there NOW. These replace the
		built-in Save/Run/Zoom, which belong to plain script windows.

		8/11/26 by CC -- and because they replace the built-in Save, a
		click first writes the window's outline to the database if it
		changed. These scripts read the object from the database, not
		from the screen, so without this they run against the previous
		version and say nothing about it. That's what happened to DW's
		sallysReader edit: it rendered and deployed the copy from two
		days earlier, and every file compared equal so nothing was
		written.  */

	$("#buttonSave").remove ();
	$("#buttonRun").remove ();
	$("#buttonZoom").remove ();

	serverCall ("/listtable", {address: theButtonsAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus ("Can't get the buttons because " + err.message);
			return;
			}
		data.entries.forEach (function (theEntry) {
			if (theEntry.kind !== "script") {
				return;
				}
			const ixTab = theEntry.name.indexOf ("\t");
			const theLabel = (ixTab === -1) ? theEntry.name : theEntry.name.slice (ixTab + 1);
			const buttonOdb = $("<button class=\"buttonBar\"></button>").text (theLabel);
			buttonOdb.click (function () {
				saveIfDirty (function (saveErr) { //8/11/26 by CC -- what's on screen goes into the database before the script runs against it
					if (saveErr !== undefined) {
						showStatus ("Can't run " + theLabel + " because the window couldn't be saved -- " + saveErr.message);
						}
					else {
						serverCall ("/downloadobject", {address: theButtonsAddress + "." + theEntry.name}, "GET", function (downloadErr, downloadData) {
							if (downloadErr !== undefined) {
								showStatus ("Can't run " + theLabel + " because " + downloadErr.message);
								}
							else {
								runMenuScript (downloadData.opmltext);
								}
							});
						}
					});
				});
			$("#spanDirty").before (buttonOdb);
			});
		});
	}

function currentOpml () {
	return ($("#divOutliner").concord ().op.outlineToXml ());
	}

function showStatus (theText) {
	$("#spanStatus").text (theText).attr ("title", theText); //8/14/26 by CC -- when the message doesn't fit, hovering shows the whole thing, DW's ask
	}

$(document).on ("click", "#spanStatus", function () { //8/26/26 by CC -- DW 8/25: clicking the message line makes the message go away
	$(this).text ("").attr ("title", "");
	});

function showDirty (flDirty) {
	$("#spanDirty").text (flDirty ? "unsaved changes" : "");
	}

function windowIsModified () { //9/14/26 by CC -- window.isModified (adr), ismodifiedverb: does this window hold changes the database doesn't have
	return ((theSavedBody === undefined) || (opmlBody (currentOpml ()) !== theSavedBody));
	}

function windowSetModified (flModified) { //9/14/26 by CC -- window.setModified (adr, fl), setmodifiedverb: mark the window dirty, or clean as of what it shows now
	if (flModified) {
		theSavedBody = undefined;
		showDirty (true);
		}
	else {
		theSavedBody = opmlBody (currentOpml ());
		showDirty (false);
		}
	}

function autosaveCheck () {

	/*  8/12/26 by CC -- odb data saves itself, the way Frontier does: when
		the outline changed, it goes straight into the database. Only a
		window with odb buttons (a script launched by nodeEditor) keeps the
		old model -- edits held locally, the database changing on Save --
		because there Save means deploy and half-typed edits shouldn't ship.

		One save at a time: a tick that lands while a save is in flight
		waits for the next tick, so uploads can't pass each other.  */

	updateCompileButton (); //8/15/26 by CC -- the Compile button wakes and sleeps on the same beat

	if (!flTypingPaused ()) { //9/2/26 by CC -- DW's rule: nothing happens in the background while the person is typing; half a second of quiet first
		return;
		}

	if (flAutosave) {
		if (flSaveInFlight) {
			return;
			}
		const theBody = opmlBody (currentOpml ());
		if (theBody !== theSavedBody) { //a failed save keeps not-matching, so the next tick tries again
			saveToDatabase ();
			}
		return;
		}

	const theOpml = currentOpml ();
	const theBody = opmlBody (theOpml);
	if (theBody !== theLastSeenBody) {
		theLastSeenBody = theBody;
		if (theBody === theSavedBody) { //edited back to what the database has
			localStorage.removeItem (draftKey ());
			showDirty (false);
			}
		else {
			localStorage.setItem (draftKey (), theOpml);
			showDirty (true);
			}
		}
	}

function saveToDatabase (callback) { //8/11/26 by CC -- callback gets an err object, or undefined when it's in the database
	const opmltext = currentOpml ();
	flSaveInFlight = true; //8/12/26 by CC

	/*  8/12/26 by CC -- an autosave says nothing when it works. DW: "the
		'Saved at' message at top must not flicker when i edit. it's so
		distracting, it's right where i'm typing." A save that FAILS still
		speaks up, in both kinds of window.  */

	if (flAutosave !== true) {
		showStatus ("Saving…"); //horizontal ellipsis
		}
	if ((theMenubarAddress !== null) && (theMenubarAddress !== undefined) && (theMenubarAddress.length > 0)) { //9/1/26 by CC -- a menu command's script saves into the menubar object
		serverCall ("/menubaredit", {jsontext: JSON.stringify ({action: "setscript", address: theMenubarAddress, ixline: Number (theMenubarLineIx), linetext: theMenubarLineText, opmltext})}, "POST", function (err, data) {
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
			theSavedBody = opmlBody (opmltext);
			localStorage.removeItem (draftKey ());
			showDirty (false);
			if (callback !== undefined) {
				callback (undefined);
				}
			});
		return;
		}
	serverCall ("/uploadobject", {address: theAddress, type: theScriptType, opmltext, autosave: flAutosave ? "1" : undefined}, "POST", function (err, data) { //9/3/26 by CC -- an autosave says so: an agent's autosaved edits don't run until Compile, DW's 9/3 ruling
		flSaveInFlight = false;
		if (err !== undefined) {
			showStatus (err.message);
			if (callback !== undefined) {
				callback (err);
				}
			}
		else {
			theSavedBody = opmlBody (opmltext);
			localStorage.removeItem (draftKey ());
			showDirty (false);
			if (flAutosave !== true) {
				showStatus ("Saved at " + new Date ().toLocaleTimeString () + ", " + data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
				}
			if (callback !== undefined) {
				callback (undefined);
				}
			}
		});
	}
function saveIfDirty (callback) { //8/11/26 by CC -- a button's script reads the object from the database, so what's on screen has to be in it first
	if (opmlBody (currentOpml ()) === theSavedBody) {
		callback (undefined);
		}
	else {
		saveToDatabase (callback);
		}
	}
function saveScript () {
	saveToDatabase ();
	}

function runScript () { //runs what's in the window, saved or not -- dialogs appear right here as the script asks
	flRunFromButton = true; //9/8/26 by CC -- window.frontmost answers the window behind while this run goes (scriptgettargetdata); a menu command's run leaves it false
	runMenuScript (currentOpml (), theAddress); //8/8/26 by CC -- the run-with-dialogs machinery lives in common.js now, shared with menu commands. 9/5/26 -- the address rides along so this answers the script's own address
	}

function compileScript () { //8/14/26 by CC -- parse only, never run; a failure names the line and the cursor jumps to it

	function jumpToFailingLine (theMessage) {

		/*  The error quotes the line it happened on. Find that line in the
			window and put the cursor there, expanding whatever hides it --
			the same landing Find gives a hit.  */

		const theMatch = theMessage.match (/"([^"]*)"/);
		if (theMatch === null) {
			return;
			}
		var theFragment = theMatch [1];
		if (theFragment.endsWith ("...")) { //long lines travel truncated
			theFragment = theFragment.substring (0, theFragment.length - 3);
			}
		if (theFragment.trim ().length === 0) {
			return;
			}
		const theOp = $("#divOutliner").concord ().op;
		const theNodes = $("#divOutliner .concord-node");
		var nodeFound;
		theNodes.each (function () {
			if (nodeFound === undefined) {
				const theNode = $(this);
				const theText = theNode.children (".concord-wrapper").find (".concord-text").first ().text ().trim ();
				if (theText.startsWith (theFragment.trim ())) {
					nodeFound = theNode;
					}
				}
			});
		if (nodeFound !== undefined) {
			nodeFound.parents (".concord-node").removeClass ("collapsed"); //expand to reveal it
			theOp.setCursor (nodeFound);
			}
		}

	showStatus ("Compiling…"); //horizontal ellipsis
	const theCompiledBody = opmlBody (currentOpml ()); //8/15/26 by CC -- what this compile saw; the button sleeps until the outline differs from it
	serverCall ("/compilescript", {opmltext: currentOpml (), address: theAddress}, "POST", function (err, data) { //9/3/26 by CC -- the address rides along: a compiled agent script is what starts the agent over (scriptcompiler, scripts.c)
		if (err !== undefined) {
			showStatus ("Can't compile because " + err.message);
			return;
			}
		theLastCompiledBody = theCompiledBody;
		updateCompileButton ();
		if (data.ok === true) {
			showStatus ("The script compiles.");
			return;
			}
		showStatus (data.message);
		showLocalAlert (data.message);
		jumpToFailingLine (data.message);
		});
	}

/*  8/15/26 by CC -- DW: "the Compile button should only be enabled if i've
	made editing changes since the last compile." The button wakes when the
	outline differs from what the last compile saw -- checked on the same
	beat the autosave rides, so no new machinery watches the keystrokes. A
	window that has never compiled starts with the button live.  */

var theLastCompiledBody; //what the last compile saw; undefined means never compiled

function updateCompileButton () {
	const buttonCompile = $("#buttonCompile");
	if (buttonCompile.length === 0) {
		return;
		}
	const flEdited = (theLastCompiledBody === undefined) || (opmlBody (currentOpml ()) !== theLastCompiledBody);
	buttonCompile.prop ("disabled", !flEdited);
	}

function zoomOutline () { //collapse everything, cursor to the first summit, top level showing
	const theOp = $("#divOutliner").concord ().op;
	theOp.fullCollapse ();
	const summits = $("#divOutliner .concord-node").filter (function () {
		return ($(this).parents (".concord-node").length === 0);
		});
	summits.removeClass ("collapsed");
	if (summits.length > 0) {
		theOp.setCursor (summits.first ());
		}
	}

function landOnFindLine (ixLine) { //9/11/26 by CC -- a Find hit lands the cursor on this line, expanding whatever hides it, the way compileScript's jump does

	const theNodes = $("#divOutliner .concord-node");
	if ((ixLine < 0) || (ixLine >= theNodes.length)) {
		return;
		}
	const theNode = theNodes.eq (ixLine);
	theNode.parents (".concord-node").removeClass ("collapsed"); //reveal the line
	if ((theFindText.length > 0) && selectMatchInNode (theNode, 0)) { //9/24/26 by CC -- DW: "make it so that the text it found is highlighted" -- the match is the selection, the kernel's opeditsetselection
		return;
		}
	$("#divOutliner").concord ().op.setCursor (theNode);
	if (theNode [0] !== undefined) {
		theNode [0].scrollIntoView ({block: "center"});
		}
	}

function noteInWindowHit (ixLine) { //9/24/26 by CC -- cmd-G found a further match in this window: the table walk's place moves with it, so the next call to the server continues past it
	if ((theLastTableHit !== undefined) && flThisWindowHoldsLastHit ()) {
		theLastTableHit.line = ixLine;
		}
	}

function landOnFindHitFromUrl () { //9/11/26 by CC -- a Find-result window opened with the line in the url: land on it, and keep the walk going so cmd-G here steps to the next hit

	const theSearch = new URLSearchParams (window.location.search);
	const findLine = theSearch.get ("findline");
	if ((findLine === null) || (findLine === "")) {
		return;
		}
	theFindText = theSearch.get ("find") || ""; //common.js globals, so cmd-G continues the table walk
	const theScopeParam = theSearch.get ("findscope") || "";
	if (theScopeParam.length > 0) {
		theTableFindScope = theScopeParam;
		const theHitLine = theSearch.get ("findhitline"); //9/24/26 by CC -- the hit as the walk sees it: for a menu command's script that's the menubar's address, its menu line, and the line in the script
		const theMenuline = theSearch.get ("findmenuline");
		if ((theMenubarAddress !== null) && (theMenubarAddress !== undefined) && (theMenubarAddress.length > 0)) {
			theLastTableHit = {address: theMenubarAddress, menuline: Number (theMenubarLineIx), line: ((theHitLine === null) || (theHitLine === "")) ? Number (findLine) : Number (theHitLine)};
			}
		else {
			theLastTableHit = {address: theAddress, line: ((theHitLine === null) || (theHitLine === "")) ? Number (findLine) : Number (theHitLine), menuline: ((theMenuline === null) || (theMenuline === "")) ? -1 : Number (theMenuline)};
			}
		}
	landOnFindLine (Number (findLine));
	}
