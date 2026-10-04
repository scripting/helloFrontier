var thePassword; //assigned by getPassword, at startup

function getPassword () { //true if we have one; false means an entry form is on screen and the page should wait

	/*  Not prompt () -- Electron doesn't support it, and neither do some
		embedded browsers. A small form in the page works everywhere.  */

	thePassword = localStorage.getItem ("odbBrowserPassword");
	if ((thePassword !== null) && (thePassword.length > 0)) {
		return (true);
		}
	if ((typeof odbDesktop !== "undefined") && (odbDesktop.localPassword !== undefined) && (odbDesktop.localPassword !== null) && (odbDesktop.localPassword.length > 0)) { //8/15/26 by CC -- the desktop Frontier hands its password over; nobody types anything
		thePassword = odbDesktop.localPassword;
		localStorage.setItem ("odbBrowserPassword", thePassword);
		return (true);
		}
	const divEntry = $("<div class=\"divPasswordEntry\"></div>");
	const inputPassword = $("<input type=\"password\" class=\"inputPassword\" placeholder=\"Password for the odb server\">");
	const buttonConnect = $("<button class=\"buttonConnect\">Connect</button>");
	function connect () {
		const theValue = inputPassword.val ();
		if (theValue.length > 0) {
			localStorage.setItem ("odbBrowserPassword", theValue);
			window.location.reload ();
			}
		}
	buttonConnect.click (connect);
	inputPassword.keydown (function (event) {
		if (event.which === 13) { //return key
			connect ();
			}
		});
	divEntry.append (inputPassword).append (buttonConnect);
	$("body").prepend (divEntry);
	inputPassword.focus ();
	return (false);
	}

function letTheRightClickThrough () {

	/*  8/10/26 by CC -- DW: "right click does nothing." Concord takes every
		right-click over a row -- preventDefault, stopPropagation, then its
		own context menu -- so the app never heard about it and Inspect could
		never appear. This listens in the CAPTURE phase, before concord's
		delegated handler on the outline root, and stops the event there
		without preventing the default: the right-click reaches Electron,
		which is what puts up Inspect. Concord's own context menu, which
		these windows don't use, gives way.  */

	document.addEventListener ("contextmenu", function (event) {
		event.stopPropagation ();
		}, true);
	}

function showVersion () {

	/*  8/10/26 by CC -- the version in the upper right corner of every
		window, small type, DW's ask: while we're iterating he has to be able
		to see what he's running at a glance and match it against the number
		I told him to expect. A dialog is too far away for that. This is the
		SERVER's version, which is the code the window itself is made of --
		it's what changes when I ship.  */

	/*  Two numbers in the app, one in a browser. The app is packaged and
		copied to another machine while the server updates on its own, so
		they move separately -- and a menu change with the server standing
		still is exactly the disconnect this is here to prevent. Electron
		writes its own name and version into the user agent, which is where
		the app's number comes from.  */

	const spanVersion = $("<span class=\"spanVersion\"></span>");
	$("body").append (spanVersion);

	/*  8/15/26 by CC -- the app says its own number now (the preload hands it
		over). It used to be parsed out of the user agent, where Electron
		writes the app's NAME beside it -- so the name change to Electric
		Frontier would have quietly emptied the corner.  */

	var theAppVersion = ((window.odbDesktop === undefined) ? undefined : window.odbDesktop.appVersion);
	if (theAppVersion === undefined) { //an older app, or a plain browser
		const theAppMatch = navigator.userAgent.match (/(?:odbdesktop|Electric Frontier)\/([0-9][0-9.]*)/);
		if (theAppMatch !== null) {
			theAppVersion = theAppMatch [1];
			}
		}
	const theAppText = ((theAppVersion === undefined) ? "" : "/" + theAppVersion); //8/10/26 by CC -- no word, no blanks, DW's call

	serverCall ("/version", {}, "GET", function (err, data) {
		if (err !== undefined) {
			spanVersion.text ("?" + theAppText);
			return;
			}
		spanVersion.text (data.version + theAppText);
		});
	}

function serverCall (path, params, method, callback) { //the one transport primitive -- JSON comes back
	var theUrl = path;
	var theQuery = "";
	var theBody;
	var theBodyType = "text/xml";
	Object.keys (params).forEach (function (name) {
		if (name === "opmltext") { //the one param that travels as the body of a POST
			theBody = params [name];
			return;
			}
		if (name === "jsontext") { //8/27/26 by CC -- the table-edit calls POST JSON
			theBody = params [name];
			theBodyType = "application/json";
			return;
			}
		if (params [name] !== undefined) {
			if (theQuery.length > 0) {
				theQuery += "&";
				}
			theQuery += name + "=" + encodeURIComponent (params [name]);
			}
		});
	if (theQuery.length > 0) {
		theUrl += "?" + theQuery;
		}
	$.ajax ({
		url: theUrl,
		type: method,
		data: theBody,
		contentType: (theBody === undefined) ? undefined : theBodyType,
		processData: false,
		headers: {"x-trigger-password": thePassword},
		dataType: "json",
		success: function (data) {
			callback (undefined, data);
			},
		error: function (xhr) {
			var err;
			try {
				err = JSON.parse (xhr.responseText);
				}
			catch (parseError) {
				err = {message: "Can't reach the odb server. The status was " + xhr.status + "."};
				}
			if (xhr.status === 401) { //a wrong saved password would lock the page forever -- forget it so the next visit asks again
				localStorage.removeItem ("odbBrowserPassword");
				}
			callback (err);
			}
		});
	}

/*  Running a script from here, dialogs included -- 8/8/26 by CC. The
	machinery below used to live in script.js, for the Run button. It moved
	here so a menu command can run in whatever window is frontmost: the app
	calls runMenuScript with the script's text, and any dialogs the script
	puts up appear in this window, over whatever the person was looking at.
	showStatus is page-supplied when the page has a status line; the
	fallback is a strip that appears at the bottom and fades.  */

function showRunStatus (theText) {
	if (typeof showStatus === "function") {
		showStatus (theText);
		return;
		}
	var divStrip = $(".divRunStatusStrip");
	if (divStrip.length === 0) {
		divStrip = $("<div class=\"divRunStatusStrip\"></div>");
		$("body").append (divStrip);
		}
	divStrip.stop (true).text (theText).attr ("title", theText).css ("opacity", 1); //the tooltip carries the whole message when the strip clips it -- 8/14/26 by CC
	divStrip.delay (5000).animate ({opacity: 0}, 1000);
	}

var flScriptWroteMessage = false; //8/13/26 by CC -- set by window.msg; a message the script put up outlives the run
var flDepositErrorUnderLine = false; //8/15/26 by CC -- true while a Run Selection is in flight; a failure lands as a comment under the line, DW's rule

/*  8/17/26 by CC -- the Stop button, Frontier's cmd-period, DW's ruling: the
	verb-call cap is gone, so a script that never ends is stopped by the
	person, not a counter. The page names the run itself so Stop can act
	before the /run response ever comes back; while a run is in flight the
	Run button says Stop, and a capture-phase click steps in ahead of the
	button's own run handler. Named Kill until 8/24; DW's 8/20 ruling.  */

var theRunIdInFlight; //assigned by runMenuScript; undefined when no run is going
var flRunFromButton = false; //9/8/26 by CC -- true while a run the Run button started is going; see the window.frontmost case in executeEditorVerb

function setRunButtonForRun (flRunning) {
	const buttonRun = $("#buttonRun");
	if (buttonRun.length > 0) {
		buttonRun.text (flRunning ? "Stop" : "Run"); //8/24/26 by CC -- DW ruling 8/20: "kill is a very negative idea"; the feature stays, the word goes
		}
	}

function killRun () {
	if (theRunIdInFlight !== undefined) {
		serverCall ("/killrun", {runid: theRunIdInFlight}, "POST", function (err, data) {
			});
		}
	}

document.addEventListener ("click", function (event) { //capture phase: while a run is going, the Run button's click means Kill
	if (theRunIdInFlight === undefined) {
		return;
		}
	if ($(event.target).closest ("#buttonRun").length === 0) {
		return;
		}
	event.stopPropagation ();
	event.preventDefault ();
	killRun ();
	}, true);

/*  10/1/26 by CC -- ESC STOPS A RUNNING SCRIPT, and so does cmd-period.
	keyboardescape in kb.c: "check to see if the user has pressed
	cmd-period", and since 10/29/91, "treat Escape key the same as
	cmd-period"; the script runner asks it as it goes (process.c, scripts.c)
	and so does a long expand (opstructure.c). Here only a script window's
	Run button could stop a run, so a menu command that ran long -- Expand
	Everything on a very large outline, DW's 10/1 report -- had no way out
	but quitting. His words: "there should be a way to stop any command
	that's taking too long", and how: "the standard way would be the Esc
	key." While a dialog is up, or a cell is being edited in a table window,
	Esc belongs to the dialog or the cell, as before.  */

document.addEventListener ("keydown", function (event) {
	if (theRunIdInFlight === undefined) {
		return;
		}
	const flEscape = (event.key === "Escape") || (event.which === 27);
	const flCmdPeriod = (event.metaKey === true) && (event.key === ".");
	if (!flEscape && !flCmdPeriod) {
		return;
		}
	if ($(".divDialogMask").length > 0) { //a dialog is asking; Esc is its Cancel
		return;
		}
	if ((typeof flCellEditing !== "undefined") && (flCellEditing === true)) { //a table cell's edit; Esc walks away from it
		return;
		}
	event.stopPropagation ();
	event.preventDefault ();
	killRun ();
	}, true);

function runFinished () {
	theRunIdInFlight = undefined;
	flRunFromButton = false;
	setRunButtonForRun (false);
	holdTheDisplay (false); //9/2/26 by CC -- a script that turned the display off and never turned it back on gets it back when the run ends
	}

/*  8/17/26 by CC -- THE MOUSE ALWAYS COMES BACK. DW's report: sometimes a
	double-click on the wedge stops expanding, and once it does it stays that
	way until he quits and restarts -- while the Expand command in the menu
	keeps working. That difference is the tell: a menu command is the app's,
	and it reaches the outline through the database; the gestures are the
	page's, and there are two ways a page can stop hearing them.

	One is a leftover dialog mask, invisible or not, sitting over the whole
	window and swallowing clicks -- every path that puts one up now takes it
	down (above), and a finished run sweeps any that are left.

	The other is inside Concord: every one of its event handlers begins with
	`if (!concord.handleEvents) return;`, and that flag is global to the page.
	Anything that turns it off and doesn't turn it back on kills every gesture
	in the window at once, exactly as described, while leaving the menu alone.
	Rather than hunt for which path leaves it off, the page checks on every
	press: if the flag is down when the person touches the outline, it goes
	back up. A stuck gesture can't outlive one click now, let alone a
	restart.  */

/*  8/17/26 by CC -- THE COMMENT ICON TELLS THE TRUTH. DW's report: sometimes
	a headline is commented and the icon doesn't show it. Inside Concord the
	two halves of "make this a comment" are done to two different nodes --
	the attribute goes to the attributes object's own cursor, the « icon's
	class goes to whatever the cursor is at that moment -- so anything that
	moves the cursor between them (which is exactly what commenting a whole
	selection does, line by line) can leave the attribute on the line and the
	icon off it. Concord isn't ours to change, so the page puts the icons back
	in step with the attributes after a command runs: every line's icon is
	made to match what that line actually is.  */

function syncCommentIcons () {
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const theAttributes = theNode.data ("attributes");
		const flComment = ((theAttributes !== undefined) && (theAttributes !== null) && (String (theAttributes.isComment) === "true"));
		if (flComment !== theNode.hasClass ("concord-comment")) {
			theNode.toggleClass ("concord-comment", flComment);
			}
		});
	}

function makeSureTheMouseWorks () {
	$(".divDialogMask").remove ();
	if ((typeof concord !== "undefined") && (concord.handleEvents === false)) {
		concord.resumeListening ();
		}
	}

document.addEventListener ("mousedown", function (event) {
	if ((typeof concord === "undefined") || (concord.handleEvents !== false)) {
		return;
		}
	if ($(event.target).closest (".divDialogMask").length > 0) { //a real dialog is up; leave it alone
		return;
		}
	concord.resumeListening ();
	}, true);

function runMenuScript (theScriptText, theScriptAddress) { //runs a menu command's script; dialogs appear right here. 9/5/26 by CC -- theScriptAddress: a script window sends the address of the script it's running, so this answers it
	flScriptWroteMessage = false;
	theRunIdInFlight = "page" + (new Date ()).getTime () + "-" + Math.floor (Math.random () * 1000000);
	setRunButtonForRun (true);
	showRunStatus ("Running…"); //horizontal ellipsis
	const theParams = {interactive: "1", runid: theRunIdInFlight, opmltext: theScriptText};
	if ((theScriptAddress !== undefined) && (theScriptAddress !== null) && (String (theScriptAddress).length > 0)) {
		theParams.address = theScriptAddress;
		}
	serverCall ("/run", theParams, "POST", handleRunAnswer);
	}

function depositCommentUnderCursor (theText) { //the error's home: a comment subordinate to the one-liner, smashing an old deposit the way a value would

	/*  8/15/26 by CC -- the same landing his runSelection gives a value:
		expand, look at the first subhead; a comment there gets smashed,
		anything else gets the new comment inserted above it. Answers false
		when this window has no outline to put it in -- the caller shows
		the dialog instead.  */

	try {
		const theOp = $("#divOutliner").concord ().op;
		if (theOp.getCursor ().length === 0) {
			return (false);
			}
		theOp.setTextMode (false);
		theOp.expand ();
		if (theOp.go ("right", 1)) {
			if ($("#divOutliner").concord ().script.isComment ()) {
				theOp.setLineText (theText);
				theOp.go ("left", 1);
				return (true);
				}
			theOp.go ("left", 1);
			}
		theOp.insert (theText, "right");
		$("#divOutliner").concord ().script.makeComment ();
		theOp.go ("left", 1);
		return (true);
		}
	catch (err) {
		return (false);
		}
	}

/*  THE CLIPBOARD CROSSES WINDOWS WITH ITS STRUCTURE -- 8/24/26 by CC.

	Concord's copy keeps two things: the plain text, which goes to the
	system clipboard, and the selected nodes with every attribute they
	carry, which stay in a variable IN THE WINDOW THAT COPIED. Paste in
	the same window is structural; paste in any other window got only the
	text, so a line's comment flag -- and any attribute -- died in the
	crossing. That is why a one-liner pasted from another window stacked a
	second deposit instead of replacing the first (the old deposit arrived
	stripped of its comment flag, so runSelection rightly didn't recognize
	it), and why blank lines vanished in cross-window pastes.

	Now a copy or cut also builds the selection's OPML and broadcasts it on
	the window channel. A paste whose text matches the broadcast is done
	structurally through op.insertXml, the same way Concord pastes inside
	one window. Concord itself is untouched.  */

function shareTheClipboard () {
	setTimeout (function () { //after Concord's own copy handler has filled concordClipboard
		try {
			if ((typeof concordClipboard === "undefined") || (concordClipboard === undefined)) {
				return;
				}
			const theConcord = $("#divOutliner").concord ();
			const theOp = theConcord.op;
			if (theOp.inTextMode ()) {

				/*  9/13/26 by CC -- A COPY INSIDE A LINE IS THE BROWSER'S OWN.
					In text mode the person selected some text and pressed
					cmd-C; there is nothing structural to share, and the
					cursor moves below took the selection away -- DW's 9/13
					report: "2click to select a name, cmd-c to copy. the
					selection is consumed (text ok but no more selection)."  */

				return;
				}
			const savedCursor = theOp.getCursor ();
			var theSelected = $("#divOutliner .concord-node.selected").filter (function () {
				return ($(this).parents (".concord-node.selected").length === 0); //only the tops; children ride along in the OPML
				});
			if (theSelected.length === 0) {

				/*  9/8/26 by CC -- A COPY WITH NO SELECTION IS THE CURSOR LINE,
					subs and all, which is what Concord's own copy put on the
					clipboard. Nothing was shared in that case, so the paste in
					another window saw text it didn't know and let it fall to
					Concord's paste, which does nothing: DW's 9/8 report, "copy
					from a script window attached to a menu item, paste into a
					odb-based script object, nothing happens" -- and copying
					just the subs, a selection, worked.  */

				theSelected = savedCursor;
				}
			const theParts = [];
			theSelected.each (function () {
				theOp.setCursor ($(this));
				const theDoc = $($.parseXML (theOp.cursorToXml ()));
				theDoc.find ("body").children ("outline").each (function () {
					theParts.push (new XMLSerializer ().serializeToString (this));
					});
				});
			if (savedCursor.length > 0) {
				theOp.setCursor (savedCursor);
				}
			if (theParts.length === 0) {
				return;
				}
			const theOpml = "<?xml version=\"1.0\"?><opml version=\"2.0\"><head></head><body>" + theParts.join ("") + "</body></opml>";

			/*  9/13/26 by CC -- A COPY IN A TABLE WINDOW CARRIES THE OBJECTS'
				ADDRESSES. The kernel's browser copies the objects themselves;
				here the rows' addresses travel with the OPML, and a paste in
				a table window copies the objects through the server (see the
				paste handler below, and pasteObjectsIntoTable in
				odbbrowser.js). DW's 9/13 report: a pasted row was on screen
				with nothing behind it.  */

			var theAddresses;
			if (typeof addressForNode === "function") {
				theAddresses = [];
				theSelected.each (function () {
					const theAddress = addressForNode ($(this));
					if (theAddress.length > 0) {
						theAddresses.push (theAddress);
						}
					});
				}
			theSharedClipboard = {text: concordClipboard.text, opml: theOpml, addresses: theAddresses};
			joinWindowChannel ();
			if (theWindowChannel !== undefined) {
				theWindowChannel.postMessage ({kind: "windowClipboard", text: concordClipboard.text, opml: theOpml, addresses: theAddresses});
				}
			}
		catch (err) {
			}
		}, 100);
	}

function opmlFromPastedText (theText) { //9/8/26 by CC -- lines become headlines, leading tabs the level, for the paste above; undefined when there's nothing to paste
	const theLines = String (theText).replace (/\r\n?/g, "\n").split ("\n");
	while ((theLines.length > 0) && (theLines [theLines.length - 1].trim ().length === 0)) {
		theLines.pop ();
		}
	if (theLines.length === 0) {
		return (undefined);
		}
	function escaped (s) {
		return (String (s).replace (/&/g, "&amp;").replace (/</g, "&lt;").replace (/>/g, "&gt;").replace (/"/g, "&quot;"));
		}
	var theOpml = "";
	const theStack = []; //open levels
	var baseLevel;
	theLines.forEach (function (theLine) {
		var theLevel = 0;
		while (theLine.charAt (theLevel) === "\t") {
			theLevel++;
			}
		if (baseLevel === undefined) {
			baseLevel = theLevel;
			}
		theLevel = Math.max (0, theLevel - baseLevel);
		if (theLevel > theStack.length) { //a jump of more than one level reads as one
			theLevel = theStack.length;
			}
		while (theStack.length > theLevel) {
			theOpml += "</outline>";
			theStack.pop ();
			}
		theOpml += "<outline text=\"" + escaped (theLine.replace (/^\t+/, "")) + "\">";
		theStack.push (true);
		});
	while (theStack.length > 0) {
		theOpml += "</outline>";
		theStack.pop ();
		}
	return ("<?xml version=\"1.0\"?><opml version=\"2.0\"><head></head><body>" + theOpml + "</body></opml>");
	}

document.addEventListener ("copy", shareTheClipboard, false);
document.addEventListener ("cut", shareTheClipboard, false);

document.addEventListener ("paste", function (event) { //capture phase: a paste of something one of our windows copied goes in with its structure
	try {
		if ($("#divOutliner").length === 0) {
			return;
			}
		const theTag = ((event.target === undefined) || (event.target === null) || (event.target.tagName === undefined)) ? "" : String (event.target.tagName).toUpperCase ();
		if ((theTag === "INPUT") || (theTag === "TEXTAREA")) { //9/16/26 by CC -- a paste into a dialog's field is the field's, not the outline's. DW's 9/15 report: cmd-J, then paste, and the string went into the document behind the dialog
			return;
			}
		if ((typeof flReadonly !== "undefined") && (flReadonly === true)) {
			return;
			}
		const osText = ((event.clipboardData === undefined) || (event.clipboardData === null)) ? "" : event.clipboardData.getData ("text/plain");
		function trimmed (theText) {
			return (String (theText).replace (/^[\s\r\n]+|[\s\r\n]+$/g, ""));
			}
		if (trimmed (osText).length === 0) {
			return;
			}
		if ((typeof pasteObjectsIntoTable === "function") && (theSharedClipboard !== undefined) && (trimmed (theSharedClipboard.text) === trimmed (osText)) && Array.isArray (theSharedClipboard.addresses) && (theSharedClipboard.addresses.length > 0)) {

			/*  9/13/26 by CC -- A PASTE IN A TABLE WINDOW COPIES THE OBJECTS,
				whether the copy was made in this window or another. Before
				this, a cross-window paste put a line in the outline and
				nothing in the database, and a same-window paste did nothing
				(Concord's paste is off in a read-only outline).  */

			event.preventDefault ();
			event.stopImmediatePropagation ();
			pasteObjectsIntoTable (theSharedClipboard.addresses);
			return;
			}
		if ((typeof concordClipboard !== "undefined") && (concordClipboard !== undefined) && (trimmed (concordClipboard.text) === trimmed (osText))) {
			return; //this window made the copy -- Concord's own structural paste handles it
			}
		const theConcord = $("#divOutliner").concord ();
		var theOpmlToPaste;
		if ((theSharedClipboard !== undefined) && (trimmed (theSharedClipboard.text) === trimmed (osText))) {
			theOpmlToPaste = theSharedClipboard.opml; //a copy made in one of our windows: its structure
			}
		else {

			/*  9/8/26 by CC -- TEXT PASTES AS LINES. When the clipboard holds
				text this window doesn't know -- from another app, or a copy
				whose structure never got shared -- the paste used to fall
				through to Concord's, which does nothing in bar-cursor mode
				("paste: //problem!" in concord.js). DW's 9/8 report: "copy from
				a script window attached to a menu item, paste into a odb-based
				script object, nothing happens." The kernel pastes text into an
				outline as headlines, a tab per level (opinsertheadline from the
				scrap's text). In text mode the browser's own paste into the line
				stands, as before.  */

			if (theConcord.op.inTextMode ()) {
				return;
				}
			theOpmlToPaste = opmlFromPastedText (osText);
			if (theOpmlToPaste === undefined) {
				return;
				}
			}
		event.preventDefault ();
		event.stopImmediatePropagation ();
		theConcord.op.setTextMode (false);
		const theCursorBefore = theConcord.op.getCursor ();
		theConcord.op.insertXml (theOpmlToPaste); //after the cursor, the way Concord's own paste lands
		const thePasted = theCursorBefore.next (".concord-node"); //8/26/26 by CC -- DW 8/25: the cursor lands on the pasted thing; insertXml leaves it where it was
		if (thePasted.length > 0) {
			theConcord.op.setCursor (thePasted);
			}
		}
	catch (err) {
		}
	}, true);

/*  8/12/26 by CC -- keystrokes the menubar owns, and Concord doesn't.

	Concord has its own Run Selection on cmd-/ and its own Toggle Comment on
	cmd-\, and its Run Selection evaluates the line as JAVASCRIPT. So
	"12+12" answered 24 and looked right, while "random (0, 1200)" was a
	ReferenceError in the console and nothing appeared. Toggle Comment was
	worse: the menu command commented the line and Concord's handler
	uncommented it in the same keystroke, so the change vanished as it
	happened.

	Concord offers every keystroke to the page before acting on it, with
	flKeyCaptured riding on the event -- setting it true is how the page
	says "this one is mine." These two go to the menubar, which runs the
	real UserTalk command.

	The page runs the command itself, and it runs the command from the
	MENUBAR -- the same script the menu's own item runs, fetched from the
	database on first use. Nothing here reimplements what those commands
	do; the outline in the database is the only copy.  */

const theMenubarKeystrokes = { //the key's code => the menubar's command key
	191: "/", //Run Selection
	220: "\\" //Toggle Comment
	};
var theMenubarCommands; //assigned on the first captured keystroke -- command key => the command's script

function runMenubarCommand (theCmdKey) {
	if (theMenubarCommands !== undefined) {
		const theScript = theMenubarCommands [theCmdKey];
		if (theScript === undefined) {
			showRunStatus ("Can't run the command for cmd-" + theCmdKey + " because the menubar hasn't got one on that key.");
			}
		else {
			flDepositErrorUnderLine = (theCmdKey === "/"); //8/15/26 by CC -- DW: a one-liner that fails puts the message as a comment under the line, not in a dialog
			runMenuScript (theScript);
			}
		return;
		}
	serverCall ("/getmenubar", {address: "system.menus.menubar"}, "GET", function (err, data) {
		if (err !== undefined) {
			showRunStatus ("Can't run the command for cmd-" + theCmdKey + " because " + err.message);
			return;
			}
		theMenubarCommands = {};
		data.lines.forEach (function (theLine) {
			if ((theLine.cmdkey !== undefined) && (theLine.scriptOpml !== undefined)) {
				theMenubarCommands [theLine.cmdkey] = theLine.scriptOpml;
				}
			});
		runMenubarCommand (theCmdKey);
		});
	}

function captureMenubarKeystrokes () {

	/*  The keystroke is taken in the capture phase, before Concord's own
		handler on the document hears about it at all. Concord offers a
		flag for this -- the page can say it took the key -- but its
		Toggle Comment doesn't look at the flag and toggles anyway, so
		our command and Concord's cancelled each other out.

		Concord isn't the thing to change: it's a good outliner we're
		building Frontier around, and what it does is its own business.
		Same trick as the right-click that reaches Inspect and the
		double-click that opens a script -- Concord swallows those too.  */

	captureFindKeystrokes (); //8/14/26 by CC -- registered first, so Find always answers cmd-F

	document.addEventListener ("keydown", function (event) {
		if ((event.metaKey !== true) && (event.ctrlKey !== true)) {
			return;
			}
		const theCmdKey = theMenubarKeystrokes [event.keyCode];
		if (theCmdKey === undefined) {
			return;
			}
		event.stopPropagation ();
		event.preventDefault ();
		runMenubarCommand (theCmdKey);
		}, true);
	}

//The Find command -- 8/14/26 by CC

	/*  DW's spec, given 8/14: minimal, find only, no replace, no regex.
		Started in an outline or a script it searches that outline; started
		in a table it searches the objects in the table at all levels --
		"i can search my entire codebase by putting the table cursor on
		config.nodeeditor.projects and search." It's on the list because
		it's how you locate a syntax error without a debugger.

		cmd-F asks what to look for and finds the first hit past the
		cursor; cmd-G finds the next one; both wrap. In a window the hit is
		revealed and the cursor lands on it, the way the kernel's opflatfind
		does it (expand, cursor, select). In a table the walk is the
		server's, and the hit opens in its own window.  */

var theFindText = ""; //what we're looking for, kept for Find Next
var theReplaceText = ""; //8/15/26 by CC -- Find grew Replace; DW's correction: Frontier's Find always had it, Drummer is the find-only one
var theTableFindScope; //9/11/26 by CC -- the table a Find is walking; set in a table window at cmd-F, or handed to a Find-result window by the url, so cmd-G continues the same walk from either
var theLastTableHit; //where the last hit was -- {address, line} -- so cmd-G continues past it, line by line and then object by object

function replaceInText (theText, lookFor, replaceWith) { //every occurrence, matched unicase, replaced as typed
	var theResult = "";
	var theRest = theText;
	while (theRest.length > 0) {
		const ix = theRest.toLowerCase ().indexOf (lookFor.toLowerCase ());
		if (ix === -1) {
			theResult += theRest;
			break;
			}
		theResult += theRest.slice (0, ix) + replaceWith;
		theRest = theRest.slice (ix + lookFor.length);
		}
	return (theResult);
	}

function replaceInCursorLine () { //replace in the line the cursor is on, then find the next hit -- Frontier's Replace rhythm
	if (theFindText.length === 0) {
		return;
		}
	const theOp = $("#divOutliner").concord ().op;
	const theLine = theOp.getLineText ();
	if (theLine.toLowerCase ().indexOf (theFindText.toLowerCase ()) !== -1) {
		theOp.setLineText (replaceInText (theLine, theFindText, theReplaceText));
		}
	findInThisWindow (false);
	}

function replaceAllInWindow () { //every occurrence in every line; says how many lines changed
	if (theFindText.length === 0) {
		return;
		}
	const theOp = $("#divOutliner").concord ().op;
	const theNodes = $("#divOutliner .concord-node");
	const theCursorWas = theOp.getCursor ();
	var ctChanged = 0;
	theNodes.each (function () {
		const theNode = $(this);
		const theText = theNode.children (".concord-wrapper").find (".concord-text").first ().text ();
		if (theText.toLowerCase ().indexOf (theFindText.toLowerCase ()) !== -1) {
			theOp.setCursor (theNode);
			theOp.setLineText (replaceInText (theText, theFindText, theReplaceText));
			ctChanged++;
			}
		});
	if ((theCursorWas !== undefined) && (theCursorWas.length > 0)) {
		theOp.setCursor (theCursorWas);
		}
	showRunStatus ((ctChanged === 0) ? ("Can't find \"" + theFindText + "\".") : ("Replaced in " + ctChanged + ((ctChanged === 1) ? " line." : " lines.")));
	}

function captureFindKeystrokes () { //cmd-F and cmd-G, capture phase; script windows get these through captureMenubarKeystrokes, table windows call this directly
	document.addEventListener ("keydown", function (event) {
		if ((event.metaKey !== true) && (event.ctrlKey !== true)) {
			return;
			}
		if (event.keyCode === 70) { //the letter F
			event.stopPropagation ();
			event.preventDefault ();
			startFind ();
			return;
			}
		if (event.keyCode === 71) { //the letter G
			event.stopPropagation ();
			event.preventDefault ();
			findNext ();
			return;
			}
		}, true);
	}

function flIsTableWindow () { //this window shows a table -- a fresh cmd-F here walks the table
	return ((typeof theScope !== "undefined") && (theScope !== undefined) && (theScope.address !== undefined));
	}

function flTableFindScope () { //a table walk is in progress and cmd-G should continue it, whichever window we're in
	return (theTableFindScope !== undefined);
	}

function textElementOfNode (theNode) { //the element holding a line's text
	return (theNode.children (".concord-wrapper").find (".concord-text").first ());
	}

function selectionEndInNode (theNode) { //9/24/26 by CC -- where the selection ends in this line's text, as a character offset; -1 if the selection isn't in this line

	/*  The kernel's opflatfind: "if (opeditingtext (nomad)) { opeditgetselection
		(&startsel, &endsel); ixfind = max (startsel, endsel); }" -- Find Next
		looks past the highlighted match first, so two matches on one line
		are two stops.  */

	const elText = textElementOfNode (theNode) [0];
	if (elText === undefined) {
		return (-1);
		}
	const theSelection = window.getSelection ();
	if ((theSelection === null) || (theSelection.rangeCount === 0)) {
		return (-1);
		}
	const theRange = theSelection.getRangeAt (0);
	if (!elText.contains (theRange.endContainer)) {
		return (-1);
		}
	const theMeasure = document.createRange ();
	theMeasure.selectNodeContents (elText);
	theMeasure.setEnd (theRange.endContainer, theRange.endOffset);
	return (theMeasure.toString ().length);
	}

function selectTextInNode (theNode, ixStart, ixEnd) { //9/24/26 by CC -- the kernel's opeditsetselection: the line goes into text mode and the characters from ixStart to ixEnd are the selection, highlighted

	/*  The line's text can sit in more than one text node (a link, an
		entity), so the offsets are walked across them. The window is left
		in text mode with the match selected, the way Frontier leaves it:
		typing replaces the match, an arrow key steps off it.  */

	const theOp = $("#divOutliner").concord ().op;
	theOp.setCursor (theNode);
	theOp.setTextMode (true);
	const elText = textElementOfNode (theNode) [0];
	if (elText === undefined) {
		return;
		}
	const theRange = document.createRange ();
	const theWalker = document.createTreeWalker (elText, NodeFilter.SHOW_TEXT);
	var ixSoFar = 0, flStartSet = false, flEndSet = false;
	var textNode = theWalker.nextNode ();
	while ((textNode !== null) && !flEndSet) {
		const theLength = textNode.nodeValue.length;
		if (!flStartSet && (ixStart <= ixSoFar + theLength)) {
			theRange.setStart (textNode, ixStart - ixSoFar);
			flStartSet = true;
			}
		if (flStartSet && (ixEnd <= ixSoFar + theLength)) {
			theRange.setEnd (textNode, ixEnd - ixSoFar);
			flEndSet = true;
			}
		ixSoFar += theLength;
		textNode = theWalker.nextNode ();
		}
	if (!flStartSet) {
		return;
		}
	if (!flEndSet) {
		theRange.setEndAfter (elText.lastChild || elText);
		}
	const theSelection = window.getSelection ();
	theSelection.removeAllRanges ();
	theSelection.addRange (theRange);
	if (theNode [0] !== undefined) {
		theNode [0].scrollIntoView ({block: "center"});
		}
	}

function selectMatchInNode (theNode, ixFrom) { //find theFindText in the line from ixFrom on, unicase; select it and answer true, or answer false
	const theText = textElementOfNode (theNode).text ();
	const ix = theText.toLowerCase ().indexOf (theFindText.toLowerCase (), ixFrom);
	if (ix === -1) {
		return (false);
		}
	theNode.parents (".concord-node").removeClass ("collapsed"); //expand to reveal the hit
	selectTextInNode (theNode, ix, ix + theFindText.length);
	return (true);
	}

function findInThisWindow (flFromTop, flNoWrap) { //answers true when a match was found and selected

	/*  9/24/26 by CC -- DW: "make it so that the text it found is
		highlighted." Rewritten to the kernel's opflatfind: the search starts
		in the cursor line just past the selection (so it steps match by
		match), then bumps flatdown line by line, wrapping to the top unless
		told not to; the hit is expanded to, put in text mode, and the
		matched characters are the selection. flNoWrap is the table walk's:
		a window opened by a Find hit is searched to its end, and then the
		walk goes on to the next object (the kernel's
		langexternalcontinuesearch).  */

	const theNodes = $("#divOutliner .concord-node");
	if (theNodes.length === 0) {
		if (!flNoWrap) {
			showRunStatus ("Can't find \"" + theFindText + "\" because the window is empty.");
			}
		return (false);
		}
	const theOp = $("#divOutliner").concord ().op;

	var ixStart = 0, ixChar = 0;
	if (!flFromTop) {
		const theCursor = theOp.getCursor ();
		theNodes.each (function (ix) {
			if ((theCursor !== undefined) && (theCursor.length > 0) && (this === theCursor [0])) {
				const ixSelectionEnd = selectionEndInNode (theCursor);
				if (ixSelectionEnd >= 0) { //the rest of the cursor line first
					ixStart = ix;
					ixChar = ixSelectionEnd;
					}
				else {
					ixStart = ix + 1; //the search starts past the cursor line
					}
				}
			});
		}

	var ixLook = ixStart;
	var ctLooked = 0;
	const ctMax = flNoWrap ? (theNodes.length - ixStart) : (theNodes.length + 1); //the start line can be looked at twice on a wrap: its end first, its beginning last
	while (ctLooked < ctMax) {
		const theNode = theNodes.eq (ixLook % theNodes.length);
		if (selectMatchInNode (theNode, (ctLooked === 0) ? ixChar : 0)) {
			if (typeof noteInWindowHit === "function") { //the page keeps the table walk's place in step with the window
				noteInWindowHit (ixLook % theNodes.length);
				}
			return (true);
			}
		ixLook++;
		ctLooked++;
		}

	if (!flNoWrap) {
		showRunStatus ("Can't find \"" + theFindText + "\".");
		}
	return (false);
	}

function findInTable (flFromStart) {

	/*  9/11/26 by CC -- DW's Find, the basic case: the cursor in a table,
		cmd-F, a string, Return. The server walks everything under the table
		depth-first and answers the first line that matches; the window it's
		in opens on that line. cmd-G asks for the next one, handing back the
		last hit so the walk resumes line by line, then object by object.  */

	if (theTableFindScope === undefined) {
		return;
		}
	const theParams = {address: theTableFindScope, "for": theFindText};
	if (!flFromStart && (theLastTableHit !== undefined)) {
		theParams.after = theLastTableHit.address;
		theParams.afterline = theLastTableHit.line;
		theParams.aftermenuline = (theLastTableHit.menuline === undefined) ? -1 : theLastTableHit.menuline; //9/24/26 by CC -- inside a menubar, which line
		}
	serverCall ("/searchsubtree", theParams, "GET", function (err, data) {
		if (err !== undefined) {
			showRunStatus ("Can't search because " + err.message);
			return;
			}
		if (data.found !== true) {
			if (theParams.after !== undefined) { //past the last hit there's nothing more -- wrap once
				theLastTableHit = undefined;
				findInTable (true);
				return;
				}
			showRunStatus ("Can't find \"" + theFindText + "\" in " + theTableFindScope + ".");
			return;
			}
		theLastTableHit = {address: data.address, line: (data.line === undefined) ? -1 : data.line, menuline: (data.menuline === undefined) ? -1 : data.menuline};
		showRunStatus ("Found in " + data.address + ((data.menuline >= 0) ? (", menu line " + (data.menuline + 1)) : "") + ((data.line >= 0) ? (", line " + (data.line + 1)) : ""));
		openFindHit (data);
		});
	}

function landHitInWindow (theWindowAddress, theLandLine, theUrl, data) { //9/24/26 by CC -- one window of a Find hit: this window lands directly, an open one lands over the channel, a closed one opens from the url

	const theHit = {address: data.address, line: Number (data.line), menuline: (data.menuline === undefined) ? -1 : Number (data.menuline)};
	if ((theWindowAddress.toLowerCase () === myChannelAddress ()) && (typeof landOnFindLine === "function")) { //9/12/26 by CC -- DW's report: cmd-G in the hit's own window went nowhere. The next hit is in THIS window, and a BroadcastChannel never delivers to the window that posted, so the walk advanced while the cursor stayed put. Land here directly
		theLastTableHit = theHit;
		landOnFindLine (Number (theLandLine));
		return;
		}
	if (theWindowChannel !== undefined) { //an already-open window lands on the line without reloading
		theWindowChannel.postMessage ({kind: "findLandOn", address: theWindowAddress.toLowerCase (), hitAddress: data.address, line: theHit.line, menuline: theHit.menuline, landLine: Number (theLandLine), find: theFindText, scope: theTableFindScope});
		}
	window.open (theUrl + "&findline=" + encodeURIComponent (theLandLine) + "&find=" + encodeURIComponent (theFindText) + "&findscope=" + encodeURIComponent (theTableFindScope) + "&findhitline=" + encodeURIComponent (theHit.line) + "&findmenuline=" + encodeURIComponent (theHit.menuline), "_blank"); //a not-yet-open window lands from the url
	}

function openFindHit (data) { //open the object the hit is in and land on the matching line; a window already open on it gets the line over the channel

	if (((data.kind === "script") || (data.kind === "outline") || (data.kind === "wptext")) && (data.line !== undefined) && (data.line >= 0)) {
		landHitInWindow (data.address, data.line, "script.html?address=" + encodeURIComponent (data.address), data);
		return;
		}
	if ((data.kind === "menubar") && (data.menuline !== undefined) && (data.menuline >= 0)) {

		/*  9/24/26 by CC -- the kernel's menufind: the menubar window opens
			expanded to the menu line (mezoommenubarwindow, meexpandto), and
			when the match is in the script linked to that line, the script's
			window opens on it too (mezoomscriptwindow), the match selected.  */

		landHitInWindow (data.address, data.menuline, "menubar.html?address=" + encodeURIComponent (data.address), data);
		if (data.line >= 0) {
			landHitInWindow (data.address + " line " + data.menuline, data.line, "script.html?menubar=" + encodeURIComponent (data.address) + "&menuline=" + encodeURIComponent (data.menuline), data);
			}
		return;
		}

	/*  9/24/26 by CC -- a hit on an object's NAME, or on a scalar's value,
		lands in the table that holds it, on the row, the name highlighted --
		the kernel's tablezoomfound (tablezoomtoname, the name column in
		text mode, opeditsetselection). Before today the object itself was
		opened, with no way to go on: cmd-G there began a new search.  */

	const ixLastDot = data.address.lastIndexOf (".");
	const theParent = (ixLastDot === -1) ? "" : data.address.slice (0, ixLastDot);
	const theName = data.address.slice (ixLastDot + 1);
	landHitInWindow (theParent, -1, "./?address=" + encodeURIComponent (theParent) + "&cursor=" + encodeURIComponent (theName), data);
	}

function flThisWindowHoldsLastHit () { //9/24/26 by CC -- the table walk's last stop is in this window, so cmd-G searches here first (the kernel: a window's own Find Next, then langexternalcontinuesearch back in the table)
	if ((theLastTableHit === undefined) || (theLastTableHit.address === undefined)) {
		return (false);
		}
	if ((theLastTableHit.line < 0) && ((theLastTableHit.menuline === undefined) || (theLastTableHit.menuline < 0))) { //a hit on a row -- the name or a scalar's value -- sits in a table window; cmd-G there goes back to the walk, which continues INTO that row (the kernel's tablefind marker, flmarkbeforevalue)
		return (false);
		}
	var theWindowAddress = theLastTableHit.address;
	if ((theLastTableHit.menuline !== undefined) && (theLastTableHit.menuline >= 0) && (theLastTableHit.line >= 0)) {
		theWindowAddress += " line " + theLastTableHit.menuline; //a menu command's script window
		}
	return (theWindowAddress.toLowerCase () === myChannelAddress ());
	}

function startFind () {

	/*  8/15/26 by CC -- Find and Replace, the way Frontier always had it
		(DW's correction: Drummer is the find-only one). In an outline or
		script window: Find lands on the next hit; Replace fixes the cursor
		line and finds the next; Replace All sweeps the window and says how
		many lines changed. A table window searches only -- the hits are
		other objects, and replacing into them sight unseen isn't Find's
		job.  */

	const flTableScope = flIsTableWindow (); //a fresh cmd-F in a table window walks the table; in a script window it searches this window and grows Replace
	const divMask = $("<div class=\"divDialogMask\"></div>");
	const divDialog = $("<div class=\"divDialog\"></div>");
	divDialog.append ($("<div class=\"divDialogPrompt\"></div>").text ("Find what?"));
	const inputAnswer = $("<input type=\"text\" class=\"inputDialogAnswer\">").val (theFindText);
	divDialog.append (inputAnswer);
	var inputReplace;
	if (!flTableScope) {
		divDialog.append ($("<div class=\"divDialogPrompt\"></div>").text ("Replace with?"));
		inputReplace = $("<input type=\"text\" class=\"inputDialogAnswer\">").val (theReplaceText);
		divDialog.append (inputReplace);
		}
	const divButtons = $("<div class=\"divDialogButtons\"></div>");
	function takeTheTexts () { //what's typed, into the globals cmd-G and Replace lean on; false if there's nothing to find
		theFindText = inputAnswer.val ();
		if (inputReplace !== undefined) {
			theReplaceText = inputReplace.val ();
			}
		divMask.remove ();
		return (theFindText.length > 0);
		}
	function goFind () {
		if (takeTheTexts ()) {
			theLastTableHit = undefined;
			if (flTableScope) {
				theTableFindScope = theScope.address; //9/11/26 by CC -- walk this table; cmd-G in the hit's window continues from here
				findInTable (true);
				}
			else {
				theTableFindScope = undefined; //a fresh in-window search; cmd-G stays in this window
				findInThisWindow (false);
				}
			}
		}
	const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>").click (function () {
		divMask.remove ();
		});
	const buttonFind = $("<button class=\"buttonBar buttonDefault\">Find</button>").click (goFind);
	if (flTableScope) {
		divButtons.append (buttonCancel, buttonFind);
		}
	else {
		const buttonReplace = $("<button class=\"buttonBar\">Replace</button>").click (function () {
			if (takeTheTexts ()) {
				replaceInCursorLine ();
				}
			});
		const buttonReplaceAll = $("<button class=\"buttonBar\">Replace All</button>").click (function () {
			if (takeTheTexts ()) {
				replaceAllInWindow ();
				}
			});
		divButtons.append (buttonCancel, buttonReplaceAll, buttonReplace, buttonFind);
		}
	divDialog.append (divButtons);
	divMask.append (divDialog);
	$("body").append (divMask);
	function keysForInput (theInput) {
		theInput.keydown (function (event) {

			/*  9/24/26 by CC -- the keystroke stops here. Find now leaves the
				hit selected in text mode, and the same Return that closed the
				dialog went on to the outliner, which split the line at the
				selection: "webBrowser.openUrl (url)" became two lines with the
				match gone. Seen driving the page; never his.  */

			if (event.which === 13) { //return key
				event.preventDefault ();
				event.stopPropagation ();
				goFind ();
				}
			if (event.which === 27) { //escape key
				event.preventDefault ();
				event.stopPropagation ();
				divMask.remove ();
				}
			});
		}
	keysForInput (inputAnswer);
	if (inputReplace !== undefined) {
		keysForInput (inputReplace);
		}
	inputAnswer.focus ().select ();
	}

function findNext () {
	if (theFindText.length === 0) {
		startFind ();
		return;
		}
	if (flTableFindScope ()) {
		if (flThisWindowHoldsLastHit () && findInThisWindow (false, true)) { //9/24/26 by CC -- the rest of this window first, match by match; then on to the next object
			return;
			}
		findInTable (false);
		}
	else {
		findInThisWindow (false);
		}
	}

function showLocalAlert (theText) { //an error big enough to actually see; no server round trip, OK just closes it

	/*  8/17/26 by CC -- three ways this could leave a mask sitting over the
		window with no way to get rid of it: the escape key did nothing, a
		click outside did nothing, and a second alert put a SECOND mask on top
		of the first, so dismissing the one you can see leaves the one you
		can't. A mask over the page eats every click the outliner would have
		gotten -- the gestures die while the menu bar, which is the app's and
		not the page's, keeps working.  */

	$(".divDialogMask").remove (); //never stack

	const divMask = $("<div class=\"divDialogMask\"></div>");
	const divDialog = $("<div class=\"divDialog\"></div>");
	divDialog.append ($("<div class=\"divDialogPrompt\"></div>").text (theText));
	const divButtons = $("<div class=\"divDialogButtons\"></div>");
	function closeIt () {
		divMask.remove ();
		$(document).off ("keydown.localAlert");
		}
	const buttonOk = $("<button class=\"buttonBar buttonDefault\">OK</button>").click (closeIt);
	divButtons.append (buttonOk);
	divDialog.append (divButtons);
	divMask.append (divDialog);
	divMask.click (function (event) { //a click on the mask itself, outside the dialog, closes it
		if (event.target === divMask [0]) {
			closeIt ();
			}
		});
	$(document).on ("keydown.localAlert", function (event) {
		if ((event.which === 27) || (event.which === 13)) { //escape or return
			closeIt ();
			}
		});
	$("body").append (divMask);
	buttonOk.focus ();
	}

/*  The window channel -- 8/15/26 by CC. DW's rule: "if you set the target
	to an already-open window you don't create another target window, you
	use the one that's already open." His sequence, all over his code:
	adr = @scratchpad.hello; edit (adr); target.set (adr).

	The windows of one Frontier are pages from one origin, so they can talk
	to each other directly on a BroadcastChannel. Three exchanges ride it:
	a PING ("is anyone showing this address?"), an OP CALL forwarded from
	the window whose script is running to the window showing the target,
	and a READY announcement a new window makes when its outline is up --
	which is what lets a script edit (adr) and aim ops at adr in its very
	next line, the way Frontier's edit comes back when the window is open.

	Read-only windows announce ready but never answer for a target: they
	are viewers, they follow the database by polling, and the database path
	is what keeps them live.  */

var theWindowChannel; //assigned by joinWindowChannel
var theSharedClipboard; //8/24/26 by CC -- {text, opml} from the last copy or cut in ANY of our windows; see shareTheClipboard below
var flAnswerForTarget = false; //set by markWindowReadyForTarget in editable editor windows
var ctChannelCalls = 0;

function applyCustomCss () {

	/*  9/10/26 by CC -- HIS OWN CSS, LIVE. DW, 9/9: "find a way for me to tweak
		the display CSS, it'll be much faster if i can play with the values
		and just give you numbers to change in the code" -- the spacing of
		text on a line needed quick iteration by him, not by me. An outline
		at user.prefs.outliner.css holds CSS, one line per rule or
		declaration, the lines joined; it goes into every window as a style
		element after every other rule, so what it says wins. It is read when
		a window opens and again each time the window comes to the front, so
		he edits the outline in one window, clicks into another, and sees it.
		No outline there means nothing added.  */

	if (typeof serverCall !== "function") {
		return;
		}
	serverCall ("/downloadobject", {address: "user.prefs.outliner.css"}, "GET", function (err, data) {
		if ((err !== undefined) || (data === undefined) || (data.opmltext === undefined)) { //no outline there is the normal case
			$("style.customCssStyle").remove ();
			return;
			}
		/*  9/10/26 by CC -- THE OUTLINE IS THE FILE, the way his CSS outlines in
			Drummer and wordland are (his 9/10 screenshot, the prior art) and the
			way fatpages/misc/renderSourceOpml.js renders source.opml: every
			line's text in outline order, a tab per level, a comment line and
			everything under it left out. The braces are his, in the text;
			nothing is generated. His words: "i would like to be able to use an
			outline, the way i do in my css files i write in drummer and
			frontier" and "can i comment lines in the CSS and have them be
			ignored."  */

		const theLines = [];
		var theDocument;
		try {
			theDocument = new DOMParser ().parseFromString (String (data.opmltext), "text/xml");
			}
		catch (err) {
			return;
			}
		function walk (theParent, theDepth) {
			$(theParent).children ("outline").each (function () {
				if (String ($(this).attr ("isComment")).toLowerCase () === "true") {
					return;
					}
				const theText = $(this).attr ("text");
				theLines.push ("\t".repeat (theDepth) + ((theText === undefined) ? "" : theText));
				walk (this, theDepth + 1);
				});
			}
		const theBody = $(theDocument).find ("body").first ();
		if (theBody.length > 0) {
			walk (theBody [0], 0);
			}
		const theCss = theLines.join ("\n");
		const theStyle = $("style.customCssStyle");
		if ((theStyle.length > 0) && (theStyle.text () === theCss)) {
			return;
			}
		theStyle.remove ();
		if (theCss.trim ().length > 0) {
			$("head").append ($("<style type=\"text/css\" class=\"customCssStyle\"></style>").text (theCss));
			}
		});
	}

$(window).on ("focus", function () { //9/10/26 by CC -- the CSS outline may have changed in another window
	if (typeof serverCall === "function") {
		applyCustomCss ();
		}
	});

function nudgeOutlineText () {

	/*  9/9/26 by CC -- THE TEXT SITS TWO PIXELS LOWER THAN IT SHOULD. DW, 9/9,
		with fontSize 16 and lineHeight 25: "to make this look right one or
		two fewer pixels on the top." The browser centers the font's whole
		box in the line, and the font's own ascent leaves the letters looking
		low. So the line keeps its height, but four pixels of it go below the
		text as padding and the text is centered in what's left: two pixels
		higher. Runs after Concord's own prefs rule, and outranks it.  */

	var theLineHeight;
	try {
		const thePrefs = $("#divOutliner").concord ().prefs ();
		theLineHeight = Number (thePrefs.outlineLineHeight);
		if (!(theLineHeight > 0)) {
			theLineHeight = Number (thePrefs.outlineFontSize) + 6;
			}
		}
	catch (err) {
		}
	if (!(theLineHeight > 8)) {
		return;
		}
	$("style.nudgeStyle").remove ();
	const thePadding = 4;
	$("head").append ("<style type=\"text/css\" class=\"nudgeStyle\">#divOutliner .concord-node .concord-wrapper .concord-text { line-height: " + (theLineHeight - thePadding) + "px !important; min-height: " + (theLineHeight - thePadding) + "px !important; padding-bottom: " + thePadding + "px !important; box-sizing: content-box; }</style>");
	}

function flVerbActsOnTheTarget (theVerb) { //9/10/26 by CC -- the outline and script verbs that act on the target window's outline; the window and dialog verbs don't
	const lower = String (theVerb).toLowerCase ();
	return (lower.startsWith ("op.") || lower.startsWith ("script.") || lower.startsWith ("wp.") || (lower === "table.getcursor"));
	}

function myContentSize () {

	/*  9/10/26 by CC -- what this window's content needs, for the zoom box
		(main.js zoomWindowToFit; shellzoomwindow's getcontentsizeroutine):
		the outline's own width and height plus everything the page puts
		around it -- the title strip, the buttons, the container's padding.  */

	const theContainer = $(".divOutlinerContainer");
	const theOutline = $("#divOutliner");
	if ((theContainer.length === 0) || (theOutline.length === 0)) {
		return (undefined);
		}
	const theContainerElement = theContainer [0];
	const thePaddingWidth = theContainerElement.offsetWidth - theContainerElement.clientWidth + (parseFloat (theContainer.css ("padding-left")) || 0) + (parseFloat (theContainer.css ("padding-right")) || 0);
	const thePaddingHeight = theContainerElement.offsetHeight - theContainerElement.clientHeight + (parseFloat (theContainer.css ("padding-top")) || 0) + (parseFloat (theContainer.css ("padding-bottom")) || 0);
	var theOutlineWidth = 0; //the widest line, wherever it ends -- the outline's own scrollWidth is the container's width, a block, so it can never say the text needs less
	var theOutlineHeight = theOutline [0].scrollHeight;
	const theOutlineRect = theOutline [0].getBoundingClientRect ();
	theOutline.find (".concord-text, .spanValue, .spanKind").each (function () {
		const theRect = this.getBoundingClientRect ();
		theOutlineWidth = Math.max (theOutlineWidth, theRect.right - theOutlineRect.left + 4);
		});
	if (theOutline [0].scrollWidth > theContainerElement.clientWidth) { //a line already scrolling sideways
		theOutlineWidth = Math.max (theOutlineWidth, theOutline [0].scrollWidth);
		}
	return ({
		width: Math.ceil (theOutlineWidth + thePaddingWidth + (window.innerWidth - theContainerElement.offsetWidth)),
		height: Math.ceil (theOutlineHeight + thePaddingHeight + (window.innerHeight - theContainerElement.offsetHeight))
		});
	}

function splitAddressTextOnPage (theText) { //9/10/26 by CC -- the server's splitAddressText, the same rule: dots outside brackets split, a bracketed name comes back without its brackets and quotes
	const segments = [];
	var current = "";
	var ix = 0;
	while (ix < theText.length) {
		const ch = theText.charAt (ix);
		if (ch === "[") {
			const ixClose = theText.indexOf ("]", ix);
			if (ixClose === -1) {
				current += theText.slice (ix);
				break;
				}
			var inner = theText.slice (ix + 1, ixClose).trim ();
			if ((inner.length >= 2) && (inner.charAt (0) === "\"") && (inner.charAt (inner.length - 1) === "\"")) {
				inner = inner.slice (1, inner.length - 1);
				}
			current += inner;
			ix = ixClose + 1;
			}
		else if (ch === ".") {
			segments.push (current);
			current = "";
			ix++;
			}
		else {
			current += ch;
			ix++;
			}
		}
	segments.push (current);
	return (segments);
	}

function addressTextForNames (theNames) { //9/10/26 by CC -- the kernel's langexternalbracketname: an identifier bare, anything else in brackets and quotes
	const theParts = [];
	theNames.forEach (function (theName) {
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

function showTitlePopup () {

	/*  9/10/26 by CC -- THE TITLE POPUP, tablepopup.c tableclienttitlepopuphit
		and tablefilltitlepopup: Cmd-click (or right-click) on the window's
		title pops up the object's ancestry, leaf first, root last; the first
		item is the object itself and does nothing; choosing an ancestor opens
		that table with the cursor on the name below it (tablezoomtoname);
		the option key closes this window as well. DW, 8/28, his screenshot:
		"log, console, suites, root -- one per line, pick one and you go
		there"; 9/10: "i reach for the window title popup all the time."  */

	if ((typeof window.odbDesktop === "undefined") || (window.odbDesktop === null) || (typeof window.odbDesktop.popupMenu !== "function")) {
		return;
		}
	const theAddress = myFrontmostAnswer ();
	if ((theAddress === undefined) || (theAddress === null) || (String (theAddress).length === 0)) {
		return;
		}
	const theNames = splitAddressTextOnPage (String (theAddress));
	const theItems = [];
	var ix;
	for (ix = theNames.length - 1; ix >= 0; ix--) {
		theItems.push (theNames [ix]);
		}
	theItems.push ("root");
	window.odbDesktop.popupMenu (theItems).then (function (theChosen) {
		if ((theChosen === undefined) || (theChosen === null) || (theChosen <= 0)) {
			return; //nothing chosen, or the object itself
			}
		const ixName = theNames.length - theChosen; //the name the cursor lands on, in the table above it
		const theParentNames = theNames.slice (0, ixName);
		const theCursorName = theNames [ixName];
		if (theParentNames.length === 0) {
			window.open ("./?database=frontier.root&cursor=" + encodeURIComponent (theCursorName), "_blank");
			}
		else {
			window.open ("./?address=" + encodeURIComponent (addressTextForNames (theParentNames)) + "&cursor=" + encodeURIComponent (theCursorName), "_blank");
			}
		});
	}

var thePathsPrefixesForTitle = []; //9/11/26 by CC -- system.paths, longest first; the drawn title strip trims them off the way the Window menu does (main.js stripPathsPrefix), DW: system.verbs.builtins.op.console reads op.console

function shortenTitleForStrip (theTitle) { //the same rule as main.js stripPathsPrefix: the first (longest) system.paths prefix that fits comes off
	const theText = String (theTitle);
	const lower = theText.toLowerCase ();
	var theAnswer = theText;
	thePathsPrefixesForTitle.forEach (function (thePrefix) {
		if ((theAnswer === theText) && lower.startsWith (thePrefix.toLowerCase () + ".")) {
			theAnswer = theText.slice (thePrefix.length + 1);
			}
		});
	return (theAnswer);
	}

function fetchPathsPrefixesForTitle () { //system.paths as the server lists it; an address entry's value is its path text
	serverCall ("/listtable", {address: "system.paths"}, "GET", function (err, data) {
		if ((err === undefined) && (data !== undefined) && Array.isArray (data.entries)) {
			const thePrefixes = [];
			data.entries.forEach (function (theEntry) {
				if ((theEntry.kind === "address") && (typeof theEntry.value === "string") && (theEntry.value.length > 0)) {
					thePrefixes.push (theEntry.value);
					}
				});
			thePrefixes.sort (function (a, b) {
				return (b.length - a.length);
				});
			thePathsPrefixesForTitle = thePrefixes;
			}
		});
	}

function installTitleStrip () {

	/*  9/10/26 by CC -- in the app the title bar is the page's to draw
		(main.js, titleBarStyle hiddenInset): a strip at the top with the
		window's title, dragged like a title bar, the traffic lights still the
		Mac's. A Cmd-click or right-click on the title shows the path popup;
		a double-click zooms, as the title bar itself did. 9/11/26 by CC --
		DW: bigger text, and the system.paths prefix trimmed the way the
		Window menu does it.  */

	if ((typeof window.odbDesktop === "undefined") || (window.odbDesktop === null)) {
		return;
		}
	if ($(".divTitleStrip").length > 0) {
		return;
		}
	const theStrip = $("<div class=\"divTitleStrip\"><span class=\"spanTitleText\"></span></div>");
	const theText = theStrip.find (".spanTitleText");
	if ($(".divWindow").length > 0) {
		$(".divWindow").first ().prepend (theStrip); //inside the flex column, so the outline container keeps its share
		}
	else {
		$("body").prepend (theStrip);
		}
	function syncTheTitle () {
		const theDisplay = shortenTitleForStrip (document.title); //9/11/26 by CC -- the strip shows the short form; document.title stays the whole address, so the Window menu and window.getTitle are unchanged
		if (theText.text () !== theDisplay) {
			theText.text (theDisplay);
			}
		}
	fetchPathsPrefixesForTitle (); //once the paths are in, the next sync shortens
	syncTheTitle ();
	setInterval (syncTheTitle, 300);
	theText.on ("mousedown", function (theEvent) {
		if (theEvent.metaKey || (theEvent.which === 3)) {
			theEvent.preventDefault ();
			showTitlePopup ();
			return;
			}

		/*  9/13/26 by CC -- DRAG THE WINDOW BY THE TITLE TEXT. The strip is a
			drag region, but the text on it can't be (a drag region gets no
			clicks, and the cmd-click popup lives on the text), so a grab in
			the middle of the title -- where a person grabs, DW's 9/13 report
			-- moved nothing. The page tracks the mouse itself and asks the
			app to move the window by the same amount.  */

		if ((theEvent.which !== 1) || (typeof window.odbDesktop.moveWindowBy !== "function")) {
			return;
			}
		theEvent.preventDefault ();
		var lastX = theEvent.screenX, lastY = theEvent.screenY;
		function onMove (moveEvent) {
			const dx = moveEvent.screenX - lastX, dy = moveEvent.screenY - lastY;
			if ((dx !== 0) || (dy !== 0)) {
				lastX = moveEvent.screenX;
				lastY = moveEvent.screenY;
				window.odbDesktop.moveWindowBy (dx, dy);
				}
			}
		function onUp () {
			document.removeEventListener ("mousemove", onMove, true);
			document.removeEventListener ("mouseup", onUp, true);
			}
		document.addEventListener ("mousemove", onMove, true);
		document.addEventListener ("mouseup", onUp, true);
		});
	theText.on ("contextmenu", function (theEvent) {
		theEvent.preventDefault ();
		});
	theStrip.on ("dblclick", function () {
		if (typeof window.odbDesktop.zoomWindow === "function") {
			window.odbDesktop.zoomWindow ();
			}
		});
	}

$(document).ready (function () { //9/10/26 by CC -- the title strip goes in as soon as the page is there
	installTitleStrip ();
	});

function myFrontmostAnswer () { //9/8/26 by CC -- what this window answers window.frontmost with, case kept; the app asks a window behind for it
	if ((typeof theAddress !== "undefined") && (theAddress !== null) && (theAddress.length > 0)) { //a script or project window knows its address
		return (theAddress);
		}
	if ((typeof theScope !== "undefined") && (theScope !== undefined)) { //a browse window is rooted somewhere
		return (theScope.address);
		}
	return ("");
	}

function myChannelAddress () { //the address this window is showing, lowercased; same logic as window.frontmost
	if ((typeof theAddress !== "undefined") && (theAddress !== null) && (String (theAddress).length > 0)) {
		return (String (theAddress).toLowerCase ());
		}
	if ((typeof theScope !== "undefined") && (theScope !== undefined) && (theScope.address !== undefined)) {
		return (String (theScope.address).toLowerCase ());
		}
	return ("");
	}

function joinWindowChannel () {
	if ((typeof BroadcastChannel === "undefined") || (theWindowChannel !== undefined)) {
		return;
		}
	theWindowChannel = new BroadcastChannel ("frontierWindows");
	theWindowChannel.addEventListener ("message", function (theEvent) {
		const theMessage = theEvent.data;
		if ((theMessage === undefined) || (theMessage === null)) {
			return;
			}
		const flAddressMatch = (theMessage.address !== undefined) && (String (theMessage.address).toLowerCase () === myChannelAddress ());
		const flMine = flAnswerForTarget && flAddressMatch;
		switch (theMessage.kind) {
			case "windowPing":
				if (flMine) {
					theWindowChannel.postMessage ({kind: "windowPong", callId: theMessage.callId});
					}
				break;
			case "windowPingAny": //9/13/26 by CC -- is ANY window showing the address, a table window too; window.update asks
				if (flAddressMatch) {
					theWindowChannel.postMessage ({kind: "windowPongAny", callId: theMessage.callId});
					}
				break;
			case "windowUpdate": //9/13/26 by CC -- window.update (adr): the window on adr reloads its object from the database
				if (flAddressMatch && (typeof reloadThisWindow === "function")) {
					reloadThisWindow ();
					}
				break;
			case "windowVerbAny": { //9/14/26 by CC -- a window verb aimed at the window on an address, any window at all: window.zoom, isReadOnly, isModified, setModified (see callAnyWindow)
				if (!flAddressMatch) {
					break;
					}
				var theAnyAnswer;
				try {
					theAnyAnswer = executeEditorVerb (theMessage.verb, theMessage.params);
					}
				catch (anyErr) {
					theAnyAnswer = false;
					}
				if ((theAnyAnswer !== undefined) && (theAnyAnswer !== null) && (typeof theAnyAnswer.then === "function")) {
					theAnyAnswer.then (function (theResolved) {
						theWindowChannel.postMessage ({value: theResolved, kind: "windowVerbAnyAnswer", callId: theMessage.callId});
						}, function () {
						theWindowChannel.postMessage ({value: false, kind: "windowVerbAnyAnswer", callId: theMessage.callId});
						});
					break;
					}
				theWindowChannel.postMessage ({value: theAnyAnswer, kind: "windowVerbAnyAnswer", callId: theMessage.callId});
				break;
				}
			case "windowClipboard": //8/24/26 by CC -- a copy or cut in any window travels to every window with its structure
				theSharedClipboard = {text: theMessage.text, opml: theMessage.opml, addresses: theMessage.addresses}; //9/13/26 by CC -- and, from a table window, the rows' addresses
				break;
			case "objectDeleted": { //8/27/26 by CC -- the kernel's tableclosewindows: deleting an object closes the windows open on it, and on everything under it
				const deletedAddress = String (theMessage.address).toLowerCase ();
				const myAddress = myChannelAddress ();
				if ((myAddress.length > 0) && ((myAddress === deletedAddress) || (myAddress.indexOf (deletedAddress + ".") === 0))) {
					window.close ();
					}
				break;
				}
			case "cursorTo": //9/3/26 by CC -- a double-clicked address wants this table window's cursor on one of its rows; see the address double-click in odbbrowser.js
				if (flAddressMatch && (typeof putCursorOnRow === "function")) {
					putCursorOnRow (String (theMessage.name));
					}
				break;
			case "findLandOn": //9/11/26 by CC -- a table Find hit is in this already-open window: land on the line, and keep cmd-G walking the same table
				if (flAddressMatch && (typeof landOnFindLine === "function")) {
					theFindText = String (theMessage.find || "");
					if ((theMessage.scope !== undefined) && (String (theMessage.scope).length > 0)) {
						theTableFindScope = String (theMessage.scope);
						}
					theLastTableHit = {address: String (theMessage.hitAddress || theMessage.address), line: Number (theMessage.line), menuline: (theMessage.menuline === undefined) ? -1 : Number (theMessage.menuline)};
					landOnFindLine ((theMessage.landLine === undefined) ? Number (theMessage.line) : Number (theMessage.landLine)); //9/24/26 by CC -- the line to land on in THIS window; the hit itself may be deeper (a menu line's script)
					}
				break;
			case "windowFront": //edit of an object that's already open -- Frontier brings the window to the front
				if (flAddressMatch) {
				
					/*  8/22/26 by CC -- window.focus () alone does nothing for
						a native window sitting behind others; the app has to
						raise it. In a plain browser tab focus () is still all
						there is.  */
					
					if ((window.odbDesktop !== undefined) && (window.odbDesktop.windowGeometry !== undefined)) {
						window.odbDesktop.windowGeometry (myChannelAddress (), {flFront: true});
						}
					window.focus ();
					}
				break;
			case "editorverbForTarget":
				if (flAddressMatch && !flAnswerForTarget && flIsTableWindow () && (String (theMessage.verb).toLowerCase () === "table.getcursor")) {

					/*  9/26/26 by CC -- A TABLE WINDOW ANSWERS table.getCursor FOR A
						SCRIPT AIMED AT IT. The table window never answers for a
						target (its rows aren't op lines, 8/15), which was right for
						the op verbs and wrong for this one: getcursorfunc
						(tableverbs.c) reads the bar cursor of the front table
						window, and from the Quick Script window -- whose front
						window is the one behind it -- the ask went out on the
						channel and nobody answered: DW's 9/26 report, "Can't do
						table.getcursor because the window showing system.verbs.apps
						didn't answer."  */

					var theCursorAnswer;
					try {
						theCursorAnswer = {value: executeEditorVerb (theMessage.verb, theMessage.params)};
						}
					catch (cursorErr) {
						theCursorAnswer = {message: "Can't do " + theMessage.verb + " in the " + theMessage.address + " window because " + cursorErr.message};
						}
					theCursorAnswer.kind = "editorverbAnswer";
					theCursorAnswer.callId = theMessage.callId;
					theWindowChannel.postMessage (theCursorAnswer);
					break;
					}
				if (flMine) {
					var theAnswer;
					try {
						const theValue = executeEditorVerb (theMessage.verb, theMessage.params);
						if ((theValue !== undefined) && (theValue !== null) && (typeof theValue.then === "function")) { //8/26/26 by CC -- the app answers the geometry verbs with a promise; see the note on the /dialoganswer path
							theValue.then (function (theResolved) {
								theWindowChannel.postMessage ({value: theResolved, kind: "editorverbAnswer", callId: theMessage.callId});
								}, function (promiseErr) {
								theWindowChannel.postMessage ({message: "Can't do " + theMessage.verb + " in the " + theMessage.address + " window because " + promiseErr.message, kind: "editorverbAnswer", callId: theMessage.callId});
								});
							break;
							}
						theAnswer = {value: theValue};
						}
					catch (editorErr) {
						theAnswer = {message: "Can't do " + theMessage.verb + " in the " + theMessage.address + " window because " + editorErr.message};
						}
					theAnswer.kind = "editorverbAnswer";
					theAnswer.callId = theMessage.callId;
					theWindowChannel.postMessage (theAnswer);
					}
				break;
			}
		});
	}

function markWindowReadyForTarget (flReadonly) { //a window's outline is up; scripts can aim at it now
	joinWindowChannel ();
	if (flReadonly !== true) {
		flAnswerForTarget = true;
		}
	if (theWindowChannel !== undefined) {
		theWindowChannel.postMessage ({kind: "windowReady", address: myChannelAddress ()});
		}
	}

function askOnWindowChannel (theMessage, answerKind, ctMillisecondsToWait, makeTimeoutAnswer, callback) { //broadcast, wait for the one answer with our callId
	joinWindowChannel ();
	if (theWindowChannel === undefined) {
		callback (makeTimeoutAnswer ());
		return;
		}
	ctChannelCalls++;
	const theCallId = String (Date.now ()) + "-" + String (ctChannelCalls);
	var theTimeout;
	function listener (theEvent) {
		const theAnswer = theEvent.data;
		if ((theAnswer !== undefined) && (theAnswer !== null) && (theAnswer.kind === answerKind) && (theAnswer.callId === theCallId)) {
			clearTimeout (theTimeout);
			theWindowChannel.removeEventListener ("message", listener);
			callback (theAnswer);
			}
		}
	theWindowChannel.addEventListener ("message", listener);
	theTimeout = setTimeout (function () {
		theWindowChannel.removeEventListener ("message", listener);
		callback (makeTimeoutAnswer ());
		}, ctMillisecondsToWait);
	theMessage.callId = theCallId;
	theWindowChannel.postMessage (theMessage);
	}

function callAnyWindow (theTargetAddress, theVerb, theParams, callback) { //9/14/26 by CC -- run a window verb in whichever window shows the address, table windows included; callback (theValue), false when no window answers
	askOnWindowChannel ({kind: "windowVerbAny", address: String (theTargetAddress).toLowerCase (), verb: theVerb, params: theParams}, "windowVerbAnyAnswer", 600, function () {
		return ({value: false});
		}, function (theAnswer) {
		callback ((theAnswer === undefined) ? false : theAnswer.value);
		});
	}

function pingForAnyWindow (theTargetAddress, callback) { //9/13/26 by CC -- flOpen: is any window at all showing the address, table windows included; window.update's question
	askOnWindowChannel ({kind: "windowPingAny", address: String (theTargetAddress).toLowerCase ()}, "windowPongAny", 250, function () {
		return (undefined);
		}, function (theAnswer) {
		callback (theAnswer !== undefined);
		});
	}

function pingForWindow (theTargetAddress, callback) { //flOpen -- is any editable window showing the address?
	askOnWindowChannel ({kind: "windowPing", address: String (theTargetAddress).toLowerCase ()}, "windowPong", 250, function () {
		return (undefined);
		}, function (theAnswer) {
		callback (theAnswer !== undefined);
		});
	}

function callWindowOnTarget (theTargetAddress, theVerb, theParams, callback) { //the answer object for /dialoganswer, whatever happened
	askOnWindowChannel ({kind: "editorverbForTarget", address: String (theTargetAddress).toLowerCase (), verb: theVerb, params: theParams}, "editorverbAnswer", 3000, function () {
		return ({message: "Can't do " + theVerb + " because the window showing " + theTargetAddress + " didn't answer."});
		}, function (theAnswer) {
		callback ({value: theAnswer.value, message: theAnswer.message});
		});
	}

/*  Multi-line deposits -- 8/15/26 by CC. DW's rule, from Drummer: a one-liner
	that answers an object deposits it as an OUTLINE under the line. The
	value arrives as tabbed text (displayString renders structure that way
	now); these two build the structure out of Concord's own primitives --
	insert down/right and go left -- which is exactly how a person would
	type it.  */

function linesFromTabbedText (theText) { //[{level, text}], levels normalized so the shallowest is 0
	const theLines = [];
	var minLevel;
	String (theText).split ("\n").forEach (function (theLine) {
		const withoutTabs = theLine.replace (/^\t+/, "");
		const theLevel = theLine.length - withoutTabs.length;
		if (withoutTabs.trim ().length === 0) {
			return;
			}
		if ((minLevel === undefined) || (theLevel < minLevel)) {
			minLevel = theLevel;
			}
		theLines.push ({level: theLevel, text: withoutTabs});
		});
	theLines.forEach (function (theLine) {
		theLine.level -= minLevel;
		});
	return (theLines);
	}

/*  8/31/26 by CC -- THE FAST PATH FOR BIG DEPOSITS. Every op.insert starts
	with concord's saveState, which clones the WHOLE outline for undo -- so
	inserting a deposit line by line clones a growing outline once per line,
	and an 880-line deposit (file.readWholeFile of the fatpages source.opml)
	froze the window for ten seconds. DW's 8/31 report: "the call took so
	long i thought the app had crashed." A big deposit now builds its nodes
	detached -- the same markup op.insert makes -- and attaches them in one
	gesture: one undo snapshot, one markChanged, no freeze. Small deposits
	keep the line-by-line path that has been shipping since 8/15.  */

const ctLinesBigDeposit = 20; //past this many lines the deposit builds detached

var theLastDepositRoot, theLastDepositNodes; //9/2/26 by CC -- the first line of the outline the last multi-line op.insert built, and every top-level line of it, for script.makeComment

/*  9/2/26 by CC -- WHEN THE PERSON LAST TYPED. DW's ruling, 9/2, after an
	autosave caught an agent script mid-word and the half-typed line took
	the server down: "the normal way to do this is to never do anything in
	the background while the user is typing, until they have stopped typing
	for say 1/2 second. prior art in every one of my products, most
	recently rss.chat." WordLand's everySecond does exactly this --
	secondsSince (whenLastKeystroke) >= 1 before it looks at the text. Every
	window's autosave asks here before it saves.  */

var whenLastKeystroke = new Date (0);

function noteTheKeystroke () {
	whenLastKeystroke = new Date ();
	}

function secondsSinceLastKeystroke () {
	return ((new Date () - whenLastKeystroke) / 1000);
	}

function flTypingPaused () { //true once the person has been quiet for half a second
	return (secondsSinceLastKeystroke () >= 0.5);
	}

document.addEventListener ("keydown", noteTheKeystroke, true);
document.addEventListener ("input", noteTheKeystroke, true);
document.addEventListener ("paste", noteTheKeystroke, true);

/*  9/2/26 by CC -- op.setDisplay. While the display is held, a still copy of
	the outline covers the live one and the live one is hidden from view but
	not from layout, so the ops that follow change nothing on screen; letting
	go removes the copy and the finished outline shows in one step. A window
	whose script never turns the display back on gets it back with the run's
	end (endRun in the run machinery calls holdTheDisplay (false)).  */

var flDisplayHeld = false;

function holdTheDisplay (flHold) {

	/*  9/3/26 by CC -- the first version (9/2) hid the live outline under the
		copy and gave the copy a new id. DW's 9/3 report: the text jumped to a
		bigger font, then all of it got selected, then it came back -- "even
		uglier than it was last time," and the same on Collapse Everything,
		whose glue turns the display off too. Two causes: Concord writes the
		font prefs into a style rule keyed by the outline's id, so a copy
		with another id lost them; and hiding the live outline made the
		browser show its selection through the copy. Now the copy sits ON
		TOP of the live outline, opaque, and the live one is left exactly as
		it is; the copy gets its own copy of the prefs rule; nothing in it
		can be selected or clicked.  */

	const theOutliner = $("#divOutliner");
	if (flHold) {
		if (flDisplayHeld) {
			return;
			}
		flDisplayHeld = true;
		const theCopy = theOutliner.clone (false);
		theCopy.attr ("id", "divOutlinerHeld").addClass ("divOutlinerHeld");
		theCopy.find ("[id]").removeAttr ("id");
		theCopy.find ("[contenteditable]").attr ("contenteditable", "false");
		var theBackground = theOutliner.css ("background-color");
		if ((theBackground === undefined) || (theBackground === "rgba(0, 0, 0, 0)") || (theBackground === "transparent")) {
			theBackground = $(document.body).css ("background-color");
			}
		if ((theBackground === undefined) || (theBackground === "rgba(0, 0, 0, 0)") || (theBackground === "transparent")) {
			theBackground = "white";
			}
		const thePosition = theOutliner.position ();
		theCopy.css ({position: "absolute", top: thePosition.top + "px", left: thePosition.left + "px", width: theOutliner.outerWidth () + "px", height: theOutliner.outerHeight () + "px", overflow: "hidden", pointerEvents: "none", userSelect: "none", backgroundColor: theBackground, zIndex: 50});
		theOutliner.after (theCopy);
		theCopy.scrollTop (theOutliner.scrollTop ());
		$("style.prefsStyle").each (function () { //Concord's font rule, keyed by the outline's id -- the copy gets the same rule under its own id
			const theText = $(this).text ();
			if (theText.indexOf ("#divOutliner") !== -1) {
				$("<style class=\"heldPrefsStyle\"></style>").text (theText.split ("#divOutliner ").join ("#divOutlinerHeld ")).appendTo (document.head);
				}
			});
		}
	else {
		if (!flDisplayHeld) {
			return;
			}
		flDisplayHeld = false;
		if (typeof afterDisplayReleased === "function") { //9/24/26 by CC -- a table window's refresh that waited for the script's display hold to end
			afterDisplayReleased ();
			}
		$("#divOutlinerHeld").remove ();
		$("style.heldPrefsStyle").remove ();
		finishQuietCursor (); //10/1/26 by CC -- a cursor moved while the display was off is handed to Concord now; see setCursorQuietly
		}
	}

function guardRenderedLines () { //9/19/26 by CC -- a line is drawn with its bold or its link showing only if saving it gives back the text that went in

	/*  In render mode Concord hands a line's tags -- a, img, b, i -- to the
		browser as the real thing, and the save reads each line back from
		the page. The browser has rewritten the tag by then, in its own
		form. For <b>hello</b> the text that comes back is the same. For
		a line of JavaScript, href=\"" + url + "\", it is not, and the
		save writes the rewritten text over DW's code -- every such line in
		the outline, not only the one he edited. 64 lines of his
		libraries.scripts on 9/19, and his blog off the air.

		The kernel never reads text back from what it drew; it keeps the
		line's text and draws from it (opeditrecalcheadline). Concord does
		read it back, so the guard is here: every line Concord draws goes
		through its editor's escape, and this stands in front of it. If the
		round trip would change the line, the line is drawn as plain
		characters, the way every line in a script window is, and plain
		characters come back as they went in. Any other line is drawn
		exactly as Concord draws it.  */

	const theConcordEditor = ConcordEditor; //Concord's own constructor
	ConcordEditor = function (root, concordInstance) {
		const theEditor = new theConcordEditor (root, concordInstance);
		const theEscape = theEditor.escape;
		theEditor.escape = function (theText) {
			const theHtml = theEscape.call (theEditor, theText);
			if (theHtml.indexOf ("<") === -1) { //nothing on the line went to the browser as a tag
				return (theHtml);
				}
			else {
				const theTextBack = theEditor.unescape ($("<div/>").html (theHtml).html ()); //what the save would read
				if (theTextBack === theText) {
					return (theHtml);
					}
				else {
					return ($("<div/>").text (theText).html ().replace (/ /g, " ")); //the line as plain characters, what Concord draws outside render mode -- the non-breaking space becomes a space, as Concord does
					}
				}
			};
		return (theEditor);
		};
	}
guardRenderedLines ();

function firstSubheadElement (theNodeElement) { //the first line under a line, as an element; undefined when it has none
	var theChild = theNodeElement.firstElementChild;
	while ((theChild !== null) && (theChild.tagName !== "OL")) {
		theChild = theChild.nextElementSibling;
		}
	if (theChild === null) {
		return (undefined);
		}
	var theSub = theChild.firstElementChild;
	while ((theSub !== null) && !theSub.classList.contains ("concord-node")) {
		theSub = theSub.nextElementSibling;
		}
	return ((theSub === null) ? undefined : theSub);
	}

function applyExpansionState (theRootElement, theExpansionText) { //10/1/26 by CC -- Concord's own walk in op.xmlToOutline, with the list of numbers looked up instead of searched; see loadOutlineXml
	const flOpenAt = {};
	String (theExpansionText).split (",").forEach (function (theNumber) {
		const theTrimmed = theNumber.trim ();
		if (theTrimmed.length > 0) {
			flOpenAt [theTrimmed] = true;
			}
		});
	var theCursor = theRootElement.querySelector (".concord-node");
	var nodeId = 1;
	while ((theCursor !== null) && (theCursor !== undefined)) {
		if (flOpenAt [String (nodeId)] === true) {
			theCursor.classList.remove ("collapsed");
			}
		nodeId++;
		var theNext;
		if (!theCursor.classList.contains ("collapsed")) {
			theNext = firstSubheadElement (theCursor);
			}
		else {
			theNext = undefined;
			}
		while ((theNext === undefined) && (theCursor !== null)) { //Concord's _walk_down: the next line at this level, or at the nearest level above that has one
			if (theCursor.nextElementSibling !== null) {
				theNext = theCursor.nextElementSibling;
				}
			else {
				const theList = theCursor.parentElement;
				const theParentNode = (theList === null) ? null : theList.parentElement;
				theCursor = ((theParentNode !== null) && theParentNode.classList.contains ("concord-node")) ? theParentNode : null;
				}
			}
		theCursor = theNext;
		}
	}

function loadOutlineXml (theOpmlText) { //10/1/26 by CC -- the window's outline from OPML: what Concord's op.xmlToOutline (theOpmlText, false) builds, in time that grows with the outline and not with its square

	/*  THE OPML IS HANDED TO CONCORD AS ELEMENTS OF THIS PAGE. Concord reads
		the OPML through jQuery as a document of its own, and builds the
		page's lines through jQuery too. When jQuery's selector engine is
		asked about one document and then the other it sets itself up
		again, and that setup costs more the bigger the two documents are.
		Concord's builder makes it happen for every line that has exactly
		one subhead, so the time to open an outline grew faster than the
		outline. Measured 10/1. A test outline where most lines have one
		subhead: 8,210 lines took 10.9 seconds, 20,520 lines with every
		line open took 138 seconds, and 41,020 never came up. DW's own
		projects, where fewer lines are like that: wordLand, 17,919 lines,
		1.6 seconds; libraries, 13,545 lines, 1.6 seconds.
		Parsed here and imported into the page's document first -- the same
		elements, the same attributes with their case kept -- there is one
		document, nothing to set up again, and Concord's own builder does
		the same work in a straight line: the test outline's 20,520 lines
		in 0.9 seconds, wordLand in 0.8, libraries in 0.6. What Concord
		builds is the same either way: compared on 945 scripts and outlines
		of the database and on nine of his projects, the lines on the
		page, their attributes and the OPML they save as. DW, 10/1: "i want
		to keep looking for perf upgrades. we've done almost no testing."
		Concord is not changed.

		AND THE LIST OF OPEN LINES IS LOOKED UP, NOT SEARCHED. The OPML's
		expansionState is the numbers of the lines whose subheads show,
		counting the visible lines from the top. Concord walks the outline
		and, for each visible line, searches the whole list for its number,
		so an outline with many lines open pays lines times open lines.
		Here the list is taken out of the OPML before Concord sees it and
		applied afterward by the same walk -- line one is number one, an
		open line's subheads come next, a closed line's are passed over --
		with each number looked up directly: the same lines open.  */

	const theOp = $("#divOutliner").concord ().op;
	if (typeof theOpmlText !== "string") { //already parsed; Concord's own way
		theOp.xmlToOutline (theOpmlText, false);
		return;
		}
	var theExpansionText;
	const theStateMatch = theOpmlText.match (/<expansionState>([^<]*)<\/expansionState>/);
	if (theStateMatch !== null) {
		theExpansionText = theStateMatch [1];
		theOpmlText = theOpmlText.replace (theStateMatch [0], "<expansionState></expansionState>");
		}
	const theXmlDocument = $.parseXML (theOpmlText); //what Concord calls; bad XML throws here as it did there
	theOp.xmlToOutline (document.importNode (theXmlDocument.documentElement, true), false);
	if (theExpansionText !== undefined) {
		const theRoot = $("#divOutliner .concord-root").first ();
		if (theRoot.length === 1) {
			applyExpansionState (theRoot [0], theExpansionText);
			const theHead = theRoot.data ("head"); //the head Concord keeps for the outline says what the OPML said, as it would have
			if ((theHead !== undefined) && (theHead !== null)) {
				theHead.expansionState = theExpansionText;
				}
			}
		}
	}

function buildDepositNodes (theEditor, theLines, theBaseLevel) { //the deposit as detached DOM, a forest of concord nodes
	const theTopNodes = [];
	const theParents = []; //one per level, the node new children append into
	var lastLevel = 0;
	theLines.forEach (function (theLine) {
		var theLevel = Math.min (theLine.level, lastLevel + 1); //tabbed text only ever steps down by one, the line-by-line path's own rule
		while ((theLevel > 0) && (theParents [theLevel - 1] === undefined)) {
			theLevel--; //a line deeper than any parent yet seen lands at the top
			}
		const theNode = $("<li></li>").addClass ("concord-node").addClass ("concord-level-" + (theBaseLevel + theLevel));
		const theWrapper = $("<div class='concord-wrapper'></div>").addClass ("type-icon");
		theWrapper.append (ConcordUtil.getIconHtml ("caret-right"));
		const theText = $("<div class='concord-text' contenteditable='true'></div>").addClass ("concord-level-" + (theBaseLevel + theLevel) + "-text");
		theText.html (theEditor.escape (theLine.text));
		theWrapper.append (theText);
		theNode.append (theWrapper);
		theNode.append ($("<ol></ol>"));
		if (theLevel === 0) {
			theTopNodes.push (theNode);
			}
		else {
			theParents [theLevel - 1].children ("ol").append (theNode);
			}
		theParents [theLevel] = theNode;
		lastLevel = theLevel;
		});
	return (theTopNodes);
	}

function insertOutlineText (theOp, theText, theDirection) { //build the structure line by line; the cursor ends on the FIRST inserted line, where the caller expects it
	const theLines = linesFromTabbedText (theText);
	if (theLines.length === 0) {
		return;
		}

	if (theLines.length > ctLinesBigDeposit) { //the fast path: detached build, one attach
		const theConcord = $("#divOutliner").concord ();
		theOp.saveState (); //the one undo snapshot for the whole deposit
		const theCursor = theOp.getCursor ();
		const cursorLevel = theCursor.parents (".concord-node").length + 1;
		const theBaseLevel = (theDirection === "right") ? (cursorLevel + 1) : cursorLevel;
		const theNodes = buildDepositNodes (theConcord.editor, theLines, theBaseLevel);
		switch (theDirection) {
			case "right":
				theCursor.children ("ol").prepend (theNodes [0]);
				theCursor.removeClass ("collapsed"); //what op.insert's expand does for the parent
				break;
			case "up":
				theCursor.before (theNodes [0]);
				break;
			default: //down -- the sibling below
				theCursor.after (theNodes [0]);
				break;
			}
		var thePrevious = theNodes [0];
		theNodes.slice (1).forEach (function (theNode) {
			thePrevious.after (theNode);
			thePrevious = theNode;
			});
		theOp.setCursor (theNodes [0]);
		theOp.markChanged ();
		return;
		}

	theOp.insert (theLines [0].text, theDirection);
	const theFirstNode = theOp.getCursor ();
	var lastLevel = theLines [0].level;
	theLines.slice (1).forEach (function (theLine) {
		if (theLine.level > lastLevel) {
			theOp.insert (theLine.text, "right"); //one level deeper -- tabbed outline text only ever steps down by one
			lastLevel += 1;
			}
		else {
			var ctBack = lastLevel - theLine.level;
			while (ctBack > 0) {
				theOp.go ("left", 1);
				ctBack--;
				}
			theOp.insert (theLine.text, "down");
			lastLevel = theLine.level;
			}
		});
	theOp.setCursor (theFirstNode);
	}

function setLineOutlineText (theOp, theText) { //smash an old outline deposit: first line replaces the line's text, the rest replace its subtree
	const theLines = linesFromTabbedText (theText);
	if (theLines.length === 0) {
		theOp.setLineText ("");
		return;
		}
	theOp.setLineText (theLines [0].text);
	const theRootNode = theOp.getCursor ();
	theRootNode.children ("ol").children (".concord-node").remove (); //the old subtree goes; the nodes ARE Concord's state, so removing them is the deletion

	if (theLines.length > ctLinesBigDeposit) { //the fast path, same reason as insertOutlineText's
		const theConcord = $("#divOutliner").concord ();
		const rootLevel = theRootNode.parents (".concord-node").length + 1;

		/*  The line-by-line path nests every remaining line one level under
			the smashed line -- the first insert goes right -- so the
			detached build does the same.  */

		const theNodes = buildDepositNodes (theConcord.editor, theLines.slice (1), rootLevel + 1);
		const theOutline = theRootNode.children ("ol");
		theNodes.forEach (function (theNode) {
			theOutline.append (theNode);
			});
		theRootNode.removeClass ("collapsed");
		theOp.setCursor (theRootNode);
		theOp.markChanged ();
		return;
		}

	if (theLines.length > 1) {
		var lastLevel = theLines [0].level;
		theLines.slice (1).forEach (function (theLine) {
			if (theLine.level > lastLevel) {
				theOp.insert (theLine.text, "right");
				lastLevel += 1;
				}
			else {
				var ctBack = lastLevel - theLine.level;
				while (ctBack > 0) {
					theOp.go ("left", 1);
					ctBack--;
					}
				theOp.insert (theLine.text, "down");
				lastLevel = theLine.level;
				}
			});
		}
	theOp.setCursor (theRootNode);
	theOp.markChanged ();
	}

/*  8/20/26 by CC -- the two pieces the expansion-state verbs are built on,
	each one the kernel's own rule. opbumpflatdown with expanded true walks
	the lines a person can SEE, in order, so a line inside a collapsed
	headline is not on the walk. opsubheadsexpanded answers false when a
	headline has no subheads at all, and otherwise whether they're showing.  */

function visibleOutlineNodes () {
	return ($("#divOutliner .concord-node").filter (function () {
		return ($(this).parents (".concord-node.collapsed").length === 0);
		}));
	}

function flSubheadsExpanded (theNode) {
	if (theNode.children ("ol").children (".concord-node").length === 0) {
		return (false);
		}
	return (!theNode.hasClass ("collapsed"));
	}

function scrollExpandedIntoView (theNode) {

	/*  9/29/26 by CC -- AFTER AN EXPAND THE SUBHEADS SHOW. The kernel's
		opexpand ends with opvisisubheads (opstructure.c, opdisplay.c): make
		the last expanded subhead visible, then the node itself -- so when
		the whole subtree fits it is all on screen, and when it doesn't, the
		parent line stays at the top and the children take the rest. DW's
		8/22 report, confirmed 9/29: "expanding an item should scroll the
		outline so the text is visible."  */

	const theContainer = $(".divOutlinerContainer");
	if ((theContainer.length === 0) || (theNode === undefined) || (theNode === null) || (theNode.length === 0)) {
		return;
		}
	setTimeout (function () { //Concord fires opExpand BEFORE it opens the node, so the measuring waits a tick
		const containerTop = theContainer.offset ().top;
		const containerBottom = containerTop + theContainer.innerHeight ();
		const lineTop = theNode.offset ().top;
		const subtreeBottom = lineTop + theNode.outerHeight (); //the node's box holds its children
		if (subtreeBottom <= containerBottom) {
			return; //everything already shows
			}
		var delta = subtreeBottom - containerBottom; //down, so the last subhead shows
		if ((lineTop - delta) < containerTop) {
			delta = lineTop - containerTop; //but never past the parent line: it stays at the top
			}
		if (delta > 0) {
			theContainer.scrollTop (theContainer.scrollTop () + delta);
			}
		}, 0);
	}

/*  10/1/26 by CC -- WHILE THE DISPLAY IS OFF, THE OUTLINE CHANGES AND NOTHING
	IS DRAWN. op.fullExpand's glue turns the display off, goes to the first
	summit, and for each summit calls op.expand (infinity) and op.go (down,
	1). Each of those went through Concord's own expand and cursor move,
	and each of those measures or focuses something, which makes the
	browser lay out the whole outline again -- once or twice for every
	summit. Measured 10/1 on 8,210 lines in 10 summits: 1.7 seconds, 0.5 of
	it in the expands and their layouts and 0.6 in the ten cursor moves;
	it grows with summits times lines, so a very large outline took
	minutes: DW's 10/1 report, "the big expand-all was going to take
	minutes. that's too much ... it should be an in-memory thing." The
	kernel's opsetdisplay (false) is exactly that: the structure changes,
	the drawing waits. So while a script holds the display in an outline or
	script window, an expand sets the line's state where it stands and a
	cursor move marks the new line, the way Concord marks it, and when the
	display comes back Concord is handed the cursor once, properly, and the
	line is brought into view. A table window keeps its own way of doing
	this (odbbrowser.js, 9/24).  */

var flCursorMovedQuietly = false; //true when a cursor move was made while the display was held; the release hands the cursor to Concord

function flQuietWhileHeld () {
	return (flDisplayHeld && !flIsTableWindow ());
	}

function setCursorQuietly (theOp, theNode) {
	if (theOp.inTextMode ()) { //Concord's own cursor moves leave text mode first; so does this
		theOp.setTextMode (false);
		}
	$("#divOutliner .concord-cursor").removeClass ("concord-cursor");
	theNode.addClass ("concord-cursor");
	flCursorMovedQuietly = true;
	}

function goQuietly (theOp, theDirection, theCount) { //the four structure moves of Concord's op.go; true if the cursor could move at all
	var theCursor = theOp.getCursor ();
	var flMoved = false;
	var ixStep;
	for (ixStep = 0; ixStep < theCount; ixStep++) {
		var theNext;
		switch (theDirection) {
			case "up":
				theNext = theCursor.prev ();
				break;
			case "down":
				theNext = theCursor.next ();
				break;
			case "left":
				theNext = theCursor.parents (".concord-node:first");
				break;
			default: //right
				theNext = theCursor.children ("ol").children (".concord-node:first");
				break;
			}
		if (theNext.length !== 1) {
			break;
			}
		theCursor = theNext;
		flMoved = true;
		}
	setCursorQuietly (theOp, theCursor);
	return (flMoved);
	}

function finishQuietCursor () { //the display is back: Concord takes the cursor the usual way, and the line is on screen
	if (!flCursorMovedQuietly) {
		return;
		}
	flCursorMovedQuietly = false;
	const theOp = $("#divOutliner").concord ().op;
	const theCursor = theOp.getCursor ();
	if (theCursor.length === 1) {
		theOp.setCursor (theCursor);
		theCursor.children (".concord-wrapper") [0].scrollIntoView ({block: "nearest"}); //the kernel's opmoveto leaves the cursor line visible
		}
	}

/*  10/1/26 by CC -- THE SELECTION IN THE CURSOR LINE, COUNTED IN THE LINE'S
	TEXT. The wp verbs speak in character positions of the text the line
	holds -- what op.getLineText answers, tags included. The page holds the
	line as drawn: in render mode a link is an element, and the browser's
	selection is a place in what is drawn. These go between the two. A piece
	of text counts as its characters; an element counts as its opening tag,
	what it holds, and its closing tag, each the way the save writes it.  */

function cursorTextElement (theOp) { //the element holding the cursor line's text; undefined when there is no cursor line
	const theCursor = theOp.getCursor ();
	if ((theCursor === undefined) || (theCursor.length !== 1)) {
		return (undefined);
		}
	const theText = theCursor.children (".concord-wrapper").children (".concord-text").first ();
	return ((theText.length === 1) ? theText [0] : undefined);
	}

function tagTextsOfElement (theElement) { //{opening, closing} as they appear in the line's stored text; closing is empty for an element that has none (img, br)
	const theOuter = theElement.cloneNode (false).outerHTML;
	const theClosing = "</" + theElement.tagName.toLowerCase () + ">";
	const theEditor = $("#divOutliner").concord ().editor;
	if (theOuter.endsWith (theClosing)) {
		return ({opening: theEditor.unescape (theOuter.slice (0, theOuter.length - theClosing.length)), closing: theClosing});
		}
	return ({opening: theEditor.unescape (theOuter), closing: ""});
	}

function textLengthOfNode (theNode) { //how many characters of the line's text this node accounts for
	if (theNode.nodeType === 3) {
		return (theNode.data.length);
		}
	if (theNode.nodeType !== 1) {
		return (0);
		}
	const theTags = tagTextsOfElement (theNode);
	var theLength = theTags.opening.length + theTags.closing.length;
	theNode.childNodes.forEach (function (theChild) {
		theLength += textLengthOfNode (theChild);
		});
	return (theLength);
	}

function textOffsetInLine (theLineElement, theContainer, theOffset) { //the character position in the line's text of a place in the drawn line (a node and an offset in it, the browser's way)
	var theCount = 0;
	function visit (theNode) { //true once the place has been reached
		if (theNode === theContainer) {
			if (theNode.nodeType === 3) {
				theCount += theOffset;
				return (true);
				}
			if (theNode !== theLineElement) {
				theCount += tagTextsOfElement (theNode).opening.length;
				}
			var ixChild;
			for (ixChild = 0; (ixChild < theOffset) && (ixChild < theNode.childNodes.length); ixChild++) {
				theCount += textLengthOfNode (theNode.childNodes [ixChild]);
				}
			return (true);
			}
		if (theNode.nodeType === 3) {
			theCount += theNode.data.length;
			return (false);
			}
		if (theNode.nodeType !== 1) {
			return (false);
			}
		const theTags = (theNode === theLineElement) ? {opening: "", closing: ""} : tagTextsOfElement (theNode);
		theCount += theTags.opening.length;
		var ix;
		for (ix = 0; ix < theNode.childNodes.length; ix++) {
			if (visit (theNode.childNodes [ix])) {
				return (true);
				}
			}
		theCount += theTags.closing.length;
		return (false);
		}
	visit (theLineElement);
	return (theCount);
	}

function placeInLineForOffset (theLineElement, theTextOffset) { //the other way: {node, offset}, the place in the drawn line for a character position in the line's text
	var theCount = 0;
	var thePlace;
	function visit (theNode) {
		if (thePlace !== undefined) {
			return;
			}
		if (theNode.nodeType === 3) {
			if (theTextOffset <= theCount + theNode.data.length) {
				thePlace = {node: theNode, offset: theTextOffset - theCount};
				}
			else {
				theCount += theNode.data.length;
				}
			return;
			}
		if (theNode.nodeType !== 1) {
			return;
			}
		const theTags = (theNode === theLineElement) ? {opening: "", closing: ""} : tagTextsOfElement (theNode);
		if (theNode !== theLineElement) {
			if (theTextOffset === theCount) { //just before the tag: the place in front of the element
				thePlace = {node: theNode.parentNode, offset: Array.prototype.indexOf.call (theNode.parentNode.childNodes, theNode)};
				return;
				}
			if (theTextOffset < theCount + theTags.opening.length) { //inside the tag's own characters: the start of what it holds
				thePlace = {node: theNode, offset: 0};
				return;
				}
			}
		theCount += theTags.opening.length;
		var ix;
		for (ix = 0; (ix < theNode.childNodes.length) && (thePlace === undefined); ix++) {
			visit (theNode.childNodes [ix]);
			}
		if (thePlace !== undefined) {
			return;
			}
		if (theTextOffset < theCount + theTags.closing.length) { //inside the closing tag: the end of what it holds
			thePlace = {node: theNode, offset: theNode.childNodes.length};
			return;
			}
		theCount += theTags.closing.length;
		}
	visit (theLineElement);
	if (thePlace === undefined) {
		thePlace = {node: theLineElement, offset: theLineElement.childNodes.length};
		}
	return (thePlace);
	}

function lineSelection (theOp) { //{text, start, end, flInLine}: the cursor line's text and where the selection is in it; with no selection in the line, both ends are the end of the text. undefined when there is no cursor line
	const theLineElement = cursorTextElement (theOp);
	if (theLineElement === undefined) {
		return (undefined);
		}
	var theText = theOp.getLineText ();
	if ((theText === undefined) || (theText === null)) {
		theText = "";
		}
	const theAnswer = {text: theText, start: theText.length, end: theText.length, flInLine: false};
	const theSelection = window.getSelection ();
	if ((theSelection !== null) && (theSelection.rangeCount > 0)) {
		const theRange = theSelection.getRangeAt (0);
		if (theLineElement.contains (theRange.startContainer) && theLineElement.contains (theRange.endContainer)) {
			theAnswer.start = Math.min (textOffsetInLine (theLineElement, theRange.startContainer, theRange.startOffset), theText.length);
			theAnswer.end = Math.min (textOffsetInLine (theLineElement, theRange.endContainer, theRange.endOffset), theText.length);
			theAnswer.flInLine = true;
			}
		}
	return (theAnswer);
	}

function selectInLine (theOp, theStart, theEnd) { //the selection becomes the characters from theStart to theEnd of the cursor line's text, the line in text mode; false when there is no cursor line
	const theLineElement = cursorTextElement (theOp);
	if (theLineElement === undefined) {
		return (false);
		}
	if (!theOp.inTextMode ()) {
		theOp.setTextMode (true);
		}
	const startPlace = placeInLineForOffset (theLineElement, Math.max (0, theStart));
	const endPlace = placeInLineForOffset (theLineElement, Math.max (theStart, theEnd));
	const theRange = document.createRange ();
	theRange.setStart (startPlace.node, startPlace.offset);
	theRange.setEnd (endPlace.node, endPlace.offset);
	const theSelection = window.getSelection ();
	theSelection.removeAllRanges ();
	theSelection.addRange (theRange);
	return (true);
	}

function executeEditorVerb (theVerb, theParams) {

	/*  8/8/26 by CC -- the window's side of an op verb call: a script
		running on the server asked to operate on THIS window's outline.
		The verbs map onto Concord's op.  */

	const theOp = $("#divOutliner").concord ().op;
	switch (theVerb) {
		case "objectreplaced": { //9/29/26 by CC -- unpack wrote a new object over the one at this address (an import): the windows open on it close, the way tableclosewindows does when the old value is disposed. DW's 9/29 report, "the now gone text is still viewable and editable in a window!", and his call: "i would just close the window if it was imported."
			const replacedAddress = String (theParams [0]).toLowerCase ();
			if (theWindowChannel !== undefined) {
				theWindowChannel.postMessage ({kind: "objectDeleted", address: replacedAddress});
				}
			const myAddress = myChannelAddress ();
			if ((myAddress.length > 0) && ((myAddress === replacedAddress) || (myAddress.indexOf (replacedAddress + ".") === 0))) {
				setTimeout (function () {window.close ();}, 200); //after the answer goes back to the script
				}
			return (true);
			}
		case "op.fullcollapse":
			theOp.fullCollapse ();
			return (true);
		case "op.fullexpand":
			if (typeof fullExpandTableWindow === "function") { //9/24/26 by CC -- a table window loads every subtable on the way down; see odbbrowser.js. The answer waits for the last row to arrive, so the script (and the window's refresh when the run ends) doesn't get ahead of the loading
				return (new Promise (function (resolve) {
					fullExpandTableWindow (function () {
						resolve (true);
						});
					}));
				}
			theOp.fullExpand ();
			scrollExpandedIntoView (theOp.getCursor ()); //9/29/26 by CC -- the same rule after Expand Everything: the cursor line stays on screen, at the top when its subs don't fit
			return (true);
		case "op.expand": {

			/*  9/24/26 by CC -- opexpand (hnode, ctlevels): the cursor's subs
				open, and with ctlevels above 1 the subs' subs down that many
				levels; infinity is all of them. The count arrives as null when
				the script said infinity (JSON has no word for it). Before
				today the count was ignored and one level opened, which is why
				the Outliner menu's Expand Everything -- op.fullExpand's glue
				walks the summits calling op.expand (infinity) on each -- opened
				one level and no more: DW's 9/24 report, "the screen flashes,
				no new stuff is revealed." A table window loads the rows of
				every subtable on the way down and answers when they're in.  */

			const theCount = ((theParams [0] === undefined) || (theParams [0] === null)) ? ((theParams [0] === null) ? Infinity : 1) : Number (theParams [0]);
			const theCursor = theOp.getCursor ();
			if ((theCursor === undefined) || (theCursor.length === 0)) {
				return (false);
				}
			if (typeof expandNodeInTableWindow === "function") {
				return (new Promise (function (resolve) {
					expandNodeInTableWindow (theCursor, theCount, function (flExpandedAny) {
						if ($.contains (document.body, theCursor [0])) { //the loading moved the cursor from subtable to subtable; opexpand leaves it where it was
							theOp.setCursor (theCursor);
							}
						resolve (flExpandedAny);
						});
					}));
				}
			const flWasCollapsed = theCursor.hasClass ("collapsed") && (theCursor.children ("ol").children (".concord-node").length > 0);
			if (flQuietWhileHeld ()) { //10/1/26 by CC -- the display is off: the line opens and nothing is measured, scrolled or drawn; see setCursorQuietly
				theCursor.removeClass ("collapsed");
				}
			else {
				theOp.expand ();
				}
			var flExpandedAny = flWasCollapsed;
			if (theCount === Infinity) { //10/1/26 by CC -- all the way down: only the lines that are closed are visited, not every line under the cursor
				theCursor.find (".concord-node.collapsed").each (function () {
					const theNode = $(this);
					if (theNode.children ("ol").children (".concord-node").length > 0) {
						theNode.removeClass ("collapsed");
						flExpandedAny = true;
						}
					});
				}
			else if (theCount > 1) {
				theCursor.find (".concord-node").each (function () {
					const theNode = $(this);
					const theDepth = theNode.parentsUntil (theCursor, ".concord-node").length + 1; //1 for a direct sub
					if ((theDepth < theCount) && theNode.hasClass ("collapsed") && (theNode.children ("ol").children (".concord-node").length > 0)) {
						theNode.removeClass ("collapsed");
						flExpandedAny = true;
						}
					});
				}
			return (flExpandedAny);
			}
		case "op.collapse":
			theOp.collapse ();
			return (true);
		case "op.firstsummit": {
			const summits = $("#divOutliner .concord-node").filter (function () {
				return ($(this).parents (".concord-node").length === 0);
				});
			if (summits.length > 0) {
				if (flQuietWhileHeld ()) { //10/1/26 by CC
					setCursorQuietly (theOp, summits.first ());
					}
				else {
					theOp.setCursor (summits.first ());
					}
				}
			return (true);
			}
		case "op.go": {
			const theDirection = String (theParams [0]).toLowerCase ();
			const theCount = (theParams [1] === undefined) ? 1 : Number (theParams [1]);
			if (flQuietWhileHeld () && ((theDirection === "up") || (theDirection === "down") || (theDirection === "left") || (theDirection === "right"))) { //10/1/26 by CC -- the four structure moves, Concord's own rules for each, without the drawing
				return (goQuietly (theOp, theDirection, theCount));
				}
			return (theOp.go (theParams [0], theCount) !== false);
			}

		/*  8/11/26 by CC -- the rest of what runSelection asks a window to
			do. The cursor travels the channel as a number: the line's place
			in a flat walk of the outline, this window's own counting.  */

		case "op.getcursor": {
			const theNodes = $("#divOutliner .concord-node");
			const theCursor = theOp.getCursor ();
			var theIndex = -1;
			theNodes.each (function (ix) {
				if (this === theCursor [0]) {
					theIndex = ix;
					}
				});
			return (theIndex);
			}
		case "op.setcursor": {
			const theNodes = $("#divOutliner .concord-node");
			const theIndex = Number (theParams [0]);
			if ((theIndex >= 0) && (theIndex < theNodes.length)) {
				if (flQuietWhileHeld ()) { //10/1/26 by CC
					setCursorQuietly (theOp, theNodes.eq (theIndex));
					}
				else {
					theOp.setCursor (theNodes.eq (theIndex));
					}
				}
			return (true);
			}
		case "op.insert": {
			const theText = String (theParams [0]).replace (/\r\n|\r/g, "\n"); //9/21/26 by CC -- a return makes it outline text, the kernel's isoutlinetext (chreturn); the same line is in runnerWorker.js for a target with no window
			if (theText.indexOf ("\n") !== -1) { //a multi-line text is an outline to build -- DW's Drummer rule: an object deposits as an outline, not one smashed line
				insertOutlineText (theOp, theText, theParams [1]);

				/*  9/2/26 by CC -- remember what was just built: the first line
					(where the cursor lands) and the top-level lines that follow
					it as siblings, one per level-0 line of the text. script.makeComment
					on the first line comments all of them, subs included.  */

				var ctTopLines = 0;
				linesFromTabbedText (theText).forEach (function (theLine) {
					if (theLine.level === 0) {
						ctTopLines++;
						}
					});
				theLastDepositRoot = theOp.getCursor ();
				theLastDepositNodes = theLastDepositRoot.add (theLastDepositRoot.nextAll (".concord-node").slice (0, ctTopLines - 1));
				return (true);
				}
			theOp.insert (theText, theParams [1]);
			theLastDepositRoot = undefined;
			theLastDepositNodes = undefined;
			return (true);
			}
		/*  8/19/26 by CC -- more of the op family, each one checked against
			the kernel's own source (Common/source/opverbs.c, opstructure.c
			and opops.c in tedchoward/Frontier) before it was written, so what
			Concord does and what the kernel does are known to agree. DW:
			"the op verbs are really central to everything."  */

		case "op.promote": {

			/*  oppromote: "move all the subheads of the bar cursor node out
				one level," and it answers false when there are none.  */

			if (theOp.countSubs () === 0) {
				return (false);
				}
			theOp.promote ();
			return (true);
			}
		case "op.demote": {

			/*  opdemote: the heads at the cursor's level below it become the
				cursor's subs. False when there are none below.  */

			if (theOp.getCursor ().nextAll (".concord-node").length === 0) {
				return (false);
				}
			theOp.demote ();
			return (true);
			}
		case "op.reorg":
			return (theOp.reorg (theParams [0], (theParams [1] === undefined) ? 1 : Number (theParams [1])) !== false);
		case "op.deletesubs":
			theOp.deleteSubs ();
			return (true);
		case "op.level":
			return (theOp.level ());
		case "op.countsubs": {

			/*  opcountsubheads (node, level) visits DOWN that many levels and
				counts what it finds -- so 1 is the direct subs and a big
				number is the whole subtree. Concord's own countSubs only ever
				counts the direct ones, so the walk is here.  */

			const ctLevels = (theParams [0] === undefined) ? 1 : Number (theParams [0]);
			var ctSubs = 0;
			function countDown (theNode, ctDepth) {
				if (ctDepth > ctLevels) {
					return;
					}
				theNode.children ("ol").children (".concord-node").each (function () {
					ctSubs++;
					countDown ($(this), ctDepth + 1);
					});
				}
			countDown (theOp.getCursor (), 1);
			return (ctSubs);
			}
		case "op.countsummits": {
			var ctSummits = 0;
			$("#divOutliner .concord-node").each (function () {
				if ($(this).parents (".concord-node").length === 0) {
					ctSummits++;
					}
				});
			return (ctSummits);
			}
		case "op.getheadnumber": { //7.0b17: the one-based place of the cursor line in a flat walk
			const theNodes = $("#divOutliner .concord-node");
			const theCursor = theOp.getCursor ();
			var ixNode = 0;
			theNodes.each (function (ix) {
				if (this === theCursor [0]) {
					ixNode = ix + 1;
					}
				});
			return (ixNode);
			}
		case "op.getsuboutline": {

			/*  opgetsuboutlinevisit: "recursively get the current headline and
				all its subheads as a string" -- the cursor's own line at no
				indent, each level below it one tab further in. flIndent
				defaults true; false gives the same lines flat.  */

			const flIndent = (theParams [0] !== false);
			var theText = "";
			function writeNode (theNode, ctLevel) {
				theText += (flIndent ? "\t".repeat (ctLevel) : "") + theNode.children (".concord-wrapper").text () + "\n";
				theNode.children ("ol").children (".concord-node").each (function () {
					writeNode ($(this), ctLevel + 1);
					});
				}
			writeNode (theOp.getCursor (), 0);
			return (theText);
			}
		case "op.setmodified": //7.0b5: set or clear the outline's dirty bit
			if (theParams [0] === false) {
				theOp.clearChanged ();
				}
			else {
				theOp.markChanged ();
				}
			return (true);

		case "op.deleteline": //8/14/26 by CC -- the cursor line and its subtree, Concord's own delete
			theOp.deleteLine ();
			return (true);
		case "op.subsexpanded":
			return (theOp.subsExpanded ());

		/*  8/20/26 by CC -- the window verbs that are about the window on the
			SCREEN. getboundsverb in the kernel reads shellgetglobalwindowrect,
			so these are the app's window, not the page in it, and only the app
			knows where its windows are. The address of the object whose window
			it is arrives as the first parameter -- window.getPosition
			(@system.verbs, @horiz, @vert) -- and the server does the assigning
			into the other two.  */

		case "window.getposition": case "window.setposition":
		case "window.getsize": case "window.setsize":
		case "window.gettitle": case "window.settitle": {
			if ((window.odbDesktop === undefined) || (window.odbDesktop.windowGeometry === undefined)) {

				/*  8/26/26 by CC -- a page outside the app can still answer for
					ITSELF: its title and its place on the screen, which is what
					the backup command asks a frontmost window for. Another
					window's geometry is the app's to know; without the app that
					answer is not-open.  */

				const askedFor = String (theParams [0]).toLowerCase ();
				if ((askedFor.length > 0) && (askedFor !== myChannelAddress ())) {
					return ({flOpen: false});
					}
				const theChange = theParams [1];
				if ((theChange !== undefined) && (theChange !== null)) {
					if (theChange.title !== undefined) {
						document.title = String (theChange.title);
						}
					}
				return ({flOpen: true, x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, title: document.title});
				}
			return (window.odbDesktop.windowGeometry (theParams [0], theParams [1]));
			}

		case "window.quickscript": { //9/16/26 by CC -- window.quickScript opens the Quick Script window, the app's; nothing to open it with outside the app
			if ((window.odbDesktop === undefined) || (window.odbDesktop.openQuickScriptWindow === undefined)) {
				return (false);
				}
			return (window.odbDesktop.openQuickScriptWindow ());
			}
		case "window.about": {
			if ((window.odbDesktop === undefined) || (window.odbDesktop.openAboutWindow === undefined)) {
				return (false);
				}
			return (window.odbDesktop.openAboutWindow ());
			}

		case "window.zoom": case "window.isreadonly": case "window.ismodified": case "window.setmodified": {

			/*  9/14/26 by CC -- four of the unbuilt window verbs, from the C
				(shellwindowverbs.c): each names the window by the object's
				address, answers false when no window is open on it, and
				otherwise: zoomverb zooms it (shellzoomwindow), isreadonlyverb
				says whether the object is read-only, ismodifiedverb whether
				the window has unsaved changes, setmodifiedverb sets that flag.
				This window answers for itself; another window is asked over
				the window channel (callAnyWindow), any kind of window.  */

			const theTarget = String ((theParams [0] === undefined) || (theParams [0] === null) ? "" : theParams [0]).toLowerCase ();
			if ((theTarget.length > 0) && (theTarget !== myChannelAddress ())) {
				return (new Promise (function (resolve) {
					callAnyWindow (theTarget, theVerb, theParams, function (theValue) {
						resolve (theValue);
						});
					}));
				}
			switch (theVerb) {
				case "window.zoom":
					if ((window.odbDesktop === undefined) || (window.odbDesktop === null) || (typeof window.odbDesktop.zoomWindow !== "function")) {
						return (false); //outside the app there is no window to zoom
						}
					window.odbDesktop.zoomWindow ();
					return (true);
				case "window.isreadonly":
					return ((typeof flReadonly !== "undefined") && (flReadonly === true));
				case "window.ismodified":
					return ((typeof windowIsModified === "function") ? (windowIsModified () === true) : false);
				case "window.setmodified":
					if (typeof windowSetModified === "function") {
						windowSetModified (theParams [1] !== false);
						}
					return (true);
				}
			return (false);
			}

		/*  8/20/26 by CC -- opgetscrollstateverb: "the line number (one-based)
			of the first headline displayed in the outline window", and
			opsetscrollstateverb scrolls so that line is first, taking the
			last line when the number is past the end. The outline scrolls
			inside .divOutlinerContainer, so the first line showing is the
			first visible node whose bottom is below the top of that box.  */

		case "op.getscrollstate": {
			const theBox = $(".divOutlinerContainer");
			const theTop = theBox.offset ().top + theBox.scrollTop ();
			const theNodes = visibleOutlineNodes ();
			var ixFirst = 1;
			var flFound = false;
			theNodes.each (function (ix) {
				if (flFound) {
					return;
					}
				const theLine = $(this).children (".concord-wrapper");
				if ((theLine.offset ().top + theLine.height ()) > theTop) {
					ixFirst = ix + 1;
					flFound = true;
					}
				});
			return (ixFirst);
			}

		case "op.setscrollstate": {
			const theNodes = visibleOutlineNodes ();
			if (theNodes.length === 0) {
				return (true);
				}
			var ixLine = Number (theParams [0]);
			if ((ixLine < 1) || (ixLine > theNodes.length)) {
				ixLine = theNodes.length; //past the end scrolls to the last line, the way the kernel does
				}
			const theBox = $(".divOutlinerContainer");
			const theNode = theNodes.eq (ixLine - 1);
			theBox.scrollTop (theBox.scrollTop () + theNode.offset ().top - theBox.offset ().top);
			return (true);
			}

		/*  8/20/26 by CC -- the clipboard. clipboard.put takes text;
			clipboard.putValue takes any value and puts its text form there,
			which is what his scripts use to hand a result to the person.  */

		case "clipboard.put": case "clipboard.putvalue": {
			const theText = String ((theParams [0] === undefined) ? "" : theParams [0]);
			const theArea = $("<textarea></textarea>").css ({position: "fixed", top: "-1000px"}).val (theText);
			$("body").append (theArea);
			theArea [0].select ();
			try {
				document.execCommand ("copy");
				}
			catch (err) {
				}
			theArea.remove ();
			return (true);
			}

		case "clipboard.get": {
			return (""); //nothing can read the clipboard without the person's permission
			}

		/*  8/20/26 by CC -- opgetexpansionstateverb: "a list of numbers; each
			number is the line number (one-based) of an expanded headline."
			His op.outlineToXml reads it, writes the outline out, and puts it
			back; his op.xmlToOutline restores it from the file.  */

		case "op.getexpansionstate": {
			const theState = [];
			visibleOutlineNodes ().each (function (ix) {
				if (flSubheadsExpanded ($(this))) {
					theState.push (ix + 1);
					}
				});
			return (theState);
			}

		/*  8/20/26 by CC -- opsetexpansionstateverb walks the visible lines
			one at a time and expands a headline whose number is in the list,
			collapsing every other one. The walk is re-read on each step
			because expanding a headline puts its subheads on it -- which is
			what the kernel's opbumpflatdown does after the opexpand.  */

		case "op.setexpansionstate": {
			const theNumbers = {};
			const theList = (theParams [0] === undefined) ? [] : theParams [0];
			theList.forEach (function (theNumber) {
				theNumbers [Number (theNumber)] = true;
				});
			const theCursorNode = theOp.getCursor ();
			var ixLine = 0;
			while (true) {
				const theNodes = visibleOutlineNodes ();
				if (ixLine >= theNodes.length) {
					break;
					}
				const theNode = theNodes.eq (ixLine);
				ixLine++;
				if (theNode.children ("ol").children (".concord-node").length > 0) {
					theOp.setCursor (theNode);
					if (theNumbers [ixLine] === true) {
						if (!flSubheadsExpanded (theNode)) {
							theOp.expand ();
							}
						}
					else {
						if (flSubheadsExpanded (theNode)) {
							theOp.collapse ();
							}
						}
					}
				}
			if (theCursorNode.length > 0) {
				theOp.setCursor (theCursorNode);
				}
			return (true);
			}

		/*  8/13/26 by CC -- DW's spec for cmd-4: "i put the text cursor at a
			place on a line of text. press cmd-4 and it inserts the text in
			the headline." No new line, no comment, ever. In Frontier the
			insertion point lives in the line, so a window with a cursor line
			answers yes to inTextMode -- that routes clock.timeStamp to its
			wp.insert branch. The insert lands at the caret when the person
			is really typing in the line, at the end of the line's text when
			the cursor is a bar.  */

		case "wp.intextmode":
			return (theOp.getCursor ().length > 0);
		case "wp.insert": {
			const theText = String (theParams [0]);
			const theSelection = lineSelection (theOp);

			/*  10/1/26 by CC -- WHAT IS INSERTED REPLACES THE SELECTION, AND A
				LINK SHOWS AS A LINK. wpinserthandle in wpengine.c: the text
				goes in at the selection, and in an outline whose text is HTML
				the headline's edit buffer is unloaded and loaded again and
				the selection put back -- the line is drawn from its new text.
				Here the insert typed the characters into the line, so a tag
				stayed on screen as the characters of a tag until the window
				was opened again: DW's 10/1 report on Add Link, "it should
				also display it as a link, not in naked html code." When the
				line holds, or is getting, anything a window in render mode
				draws as markup, the line's text is put together here and
				handed to Concord to draw, and the insertion point lands after
				what went in. A plain insert into a plain line is typed in as
				before -- cmd-4's time stamp.  */

			const theLineElement = cursorTextElement (theOp);
			const flMarkupInvolved = theOp.getRenderMode () && (theSelection !== undefined) && ((theText.indexOf ("<") !== -1) || (theLineElement.querySelector ("*:not(br)") !== null)); //a lone br is the browser's own end-of-line mark, not markup
			if (flMarkupInvolved) {
				const flWasInTextMode = theOp.inTextMode ();
				theOp.setLineText (theSelection.text.slice (0, theSelection.start) + theText + theSelection.text.slice (theSelection.end));
				theOp.markChanged ();
				if (flWasInTextMode) {
					selectInLine (theOp, theSelection.start + theText.length, theSelection.start + theText.length);
					}
				return (true);
				}
			if (theOp.inTextMode () && document.execCommand ("insertText", false, theText)) {
				return (true);
				}
			theOp.setLineText (theOp.getLineText () + theText);
			return (true);
			}

		/*  10/1/26 by CC -- THE SELECTION VERBS ARE REAL. wp.getSelect,
			wp.getSelText, wp.setSelect and wp.setTextMode answered "no
			selection" and did nothing, so the HTML menu's Add Link -- which
			asks where the selection is, takes its text, and wraps it in the
			anchor -- always got nothing and put an empty link over what was
			selected: DW's 10/1 report, "it should turn the selected text into
			a link." wpverbs.c: getselectfunc answers the start and end of the
			selection in the text (wpgetselection), getseltextfunc the selected
			text, setselectfunc sets it, settextmodefunc calls the window's
			settextmoderoutine, which for an outline is opsettextmode. The
			numbers count characters of the line's text as it is stored, tags
			and all, the way the kernel counts an HTML headline's hidden
			text.  */

		case "wp.settextmode":
			theOp.setTextMode (theParams [0] === true);
			return (true);
		case "op.sethtmlformatting": { //10/3/26 by CC -- sethtmlformattingfunc (opverbs.c): the outline window's flhtml flag, "HTML semi-wizzy formatting"; here Concord's render mode, which an outline window already opens in. The HTML menu's cmd-` command (=html.menu.formatText ()) toggles with these two, DW's 10/3 ask: "there's no way to switch between wizzy mode in the outline and source mode... we MUST have something that does that"
			const flWanted = (theParams [0] === true);
			if (theOp.getRenderMode () === flWanted) {
				return (false); //the kernel answers whether anything changed
				}
			setHtmlFormatting (theOp, flWanted);
			return (true);
			}
		case "op.gethtmlformatting": //gethtmlformattingfunc: true when HTML formatting is on; false for anything but an outline
			return (theOp.getRenderMode () === true);
		case "op.attributes.edit": //10/3/26 by CC -- DW's 10/3 ask: the attribute editor, cribbed from Drummer's Edit attributes dialog (tableeditor.js); a verb he puts in a menu himself
			return (editAttributesDialog (theOp));
		case "wp.getselect": {
			const theSelection = lineSelection (theOp);
			if (theSelection === undefined) {
				return ({start: 0, end: 0});
				}
			return ({start: theSelection.start, end: theSelection.end});
			}
		case "wp.getseltext": {
			const theSelection = lineSelection (theOp);
			if (theSelection === undefined) {
				return ("");
				}
			return (theSelection.text.slice (theSelection.start, theSelection.end));
			}
		case "wp.setselect":
			return (selectInLine (theOp, Number (theParams [0]), Number (theParams [1])));
		case "script.iscomment":
			return ($("#divOutliner").concord ().script.isComment ());
		case "script.makecomment": case "script.uncomment": {

			/*  8/15/26 by CC -- DW: with two lines selected, commenting
				should comment BOTH. Concord's own verb acts on the cursor
				line only, so when there's a multiple selection this walks
				it, cursoring each line and applying the verb -- Concord
				itself untouched, per the standing rule.  */

			const theConcord = $("#divOutliner").concord ();
			
			/*  8/21/26 by CC -- DW, 8/21: "with one line in an outline selected,
				it comments the one above it too, as if it were also selected."
				
				It was: the walk below puts the selection back when it's done, so
				a second cmd-\ acts on the same lines (his 8/16 ask). Concord
				clears .selected on a MOUSE event, but moving the cursor with the
				arrow keys doesn't clear marks that were re-added after the fact
				-- and in an outliner he moves with the keys. So the lines from
				the last multi-line comment stayed marked, and the next single
				line he commented brought them along.
				
				Only the marks WE put back are cleaned up, and only once the
				cursor has left the line the walk ended on. Concord is untouched.  */
			
			if (theLastCommentMarks !== undefined) {
				const theCursorNow = theOp.getCursor ();
				const flSameLine = (theCursorNow !== undefined) && (theCursorNow.length > 0) &&
					(theLastCommentMarks.cursor !== undefined) && (theLastCommentMarks.cursor.length > 0) &&
					(theCursorNow [0] === theLastCommentMarks.cursor [0]);
				if (!flSameLine) {
					theLastCommentMarks.nodes.forEach (function (theNode) {
						$(theNode).removeClass ("selected");
						});
					theLastCommentMarks = undefined;
					}
				}
			
			const theSelected = $("#divOutliner .concord-node.selected").toArray ();
			if (theSelected.length > 1) {
				const theCursorWas = theOp.getCursor (); //8/16/26 by CC -- the walk below moves the cursor line to line, and every move clears the selection; DW: "the selection reverts to just one line selected." What the person selected comes back when the walk is done -- so a second cmd-\ acts on the same lines, which is also what "sometimes it works" was: the second press only ever saw one line.
				theSelected.forEach (function (theNode) {
					theOp.setCursor ($(theNode));

					/*  8/18/26 by CC -- A FRESH CONCORD FOR EACH LINE, and
						this is DW's 8/18 report: "multi-line comment marks
						only the cursor's line."

						Concord binds an op's attributes to the cursor AT THE
						MOMENT THE OP WAS MADE -- concord.js ends ConcordOp
						with "this.attributes = new ConcordOpAttributes
						(concordInstance, this.getCursor ())" -- while the «
						icon goes on the live cursor. So one instance reused
						down the walk wrote EVERY line's isComment onto the
						line the walk started at, and only the icons moved.
						It looked right until the 8/17 icon sync began telling
						the truth about what each line actually is.

						Concord isn't ours to change, and it isn't wrong: an
						op is a cursor's op. Asking for one per line is what
						its own code does everywhere else (setCursorContext).  */

					const theLineConcord = $("#divOutliner").concord ();
					if (theVerb === "script.makecomment") {
						theLineConcord.script.makeComment ();
						}
					else {
						theLineConcord.script.unComment ();
						}
					});
				if ((theCursorWas !== undefined) && (theCursorWas.length > 0)) {
					theOp.setCursor (theCursorWas);
					}
				theSelected.forEach (function (theNode) {
					$(theNode).addClass ("selected");
					});
				theLastCommentMarks = {nodes: theSelected, cursor: theCursorWas}; //what we put back, so it can be taken away again
				return (true);
				}
			if (theVerb === "script.makecomment") {
				const theCursorBefore = theOp.getCursor (); //read before the mark goes on -- Concord may hand back a different element afterward
				const theAnswer = theConcord.script.makeComment ();

				/*  9/2/26 by CC -- a deposit is a comment ALL THE WAY DOWN.
					runSelection inserts the value and makes the cursor line a
					comment, which in Frontier is the whole deposit because a
					deposit is one line there. Here an object deposits as an
					outline (DW's Drummer rule), so the lines under the head
					came out as code -- DW's 9/2 report: "everything should be
					in a comment, not just the first line." When the line being
					commented is the head of the outline op.insert just built,
					every line under it gets the mark too.  */

				if ((theLastDepositRoot !== undefined) && (theCursorBefore.length > 0) && (theCursorBefore [0] === theLastDepositRoot [0])) {

					/*  each line gets the mark the way Concord gives it -- the
						cursor on the line, a fresh Concord, makeComment -- so
						the isComment attribute is on the line and the icon
						sync keeps the mark; a class alone gets stripped by the
						next sync (the 8/18 lesson, above).  */

					const theNodesToMark = [];
					theLastDepositNodes.each (function () {
						const theNode = $(this);
						if (theNode [0] !== theCursorBefore [0]) {
							theNodesToMark.push (theNode);
							}
						theNode.find (".concord-node").each (function () {
							theNodesToMark.push ($(this));
							});
						});
					theNodesToMark.forEach (function (theNode) {
						theOp.setCursor (theNode);
						$("#divOutliner").concord ().script.makeComment ();
						});
					theOp.setCursor (theCursorBefore);
					}
				return (theAnswer);
				}
			return (theConcord.script.unComment ());
			}
		case "op.getdisplay":
			return (!flDisplayHeld);
		case "op.setdisplay": {

			/*  9/2/26 by CC -- op.setDisplay (false) is REAL now. The kernel's
				opsetdisplay stops drawing, so runSelection's deposit -- expand,
				go right, delete the old deposit, insert, make the comment --
				lands as ONE change on screen. Ours answered politely and kept
				drawing, and every one of those steps is its own round trip
				through the window channel, so the person saw each one: DW's
				9/2 report, "an awful lot of flashing, text being deleted,
				added back, deleted again," on every cmd-/. While the display
				is off a still copy of the outline sits over the live one, the
				way the Mac kept the old pixels; setDisplay (true) takes it
				away and the finished outline is what shows.  */

			holdTheDisplay (theParams [0] !== true);
			return (true);
			}
		case "window.update": {

			/*  9/13/26 by CC -- window.update (adr), the kernel's updateverb: the
				window open on adr redraws; false when none is. Here the window
				reloads its object from the database -- DW's reload command,
				which he decided (9/13) should be this verb and not a new one:
				a pasted row that had lost its size, a table changed by a
				script, a menubar edited elsewhere. The window that ran the
				script reloads itself when the address is its own; any other
				window is found over the window channel (any window showing
				the address, editable or not) and told to reload.  */

			const theTarget = String ((theParams [0] === undefined) || (theParams [0] === null) ? "" : theParams [0]).toLowerCase ();
			if ((theTarget.length === 0) || (theTarget === myChannelAddress ())) {
				if (typeof reloadThisWindow === "function") {
					reloadThisWindow ();
					return (true);
					}
				return (false);
				}
			return (new Promise (function (resolve) {
				pingForAnyWindow (theTarget, function (flOpen) {
					if (!flOpen) {
						resolve (false);
						return;
						}
					theWindowChannel.postMessage ({kind: "windowUpdate", address: theTarget});
					resolve (true);
					});
				}));
			}
		case "window.next":
			return (""); //there is no window behind this one
		case "window.msg":
			showStatus (String (theParams [0]));
			flScriptWroteMessage = true; //8/13/26 by CC -- the script said something; the run summary must not smash it
			return (true);
		case "op.getlinetext":
			return (theOp.getLineText ());
		case "op.setlinetext": {
			const theText = String (theParams [0]);
			if (theText.indexOf ("\n") !== -1) { //smashing an old outline deposit with a new one: the first line replaces the line's text, the rest replace its subtree
				setLineOutlineText (theOp, theText);
				return (true);
				}
			theOp.setLineText (theText);
			return (true);
			}
		case "op.attributes.getall": {
			const theNode = theOp.getCursor ();
			const attributes = theNode.data ("attributes");
			return ((attributes === undefined) ? {} : attributes);
			}
		case "console.log": //8/26/26 by CC -- DW's ruling: the real console.log; this window's JavaScript console is the one Inspect opens
			console.log (String (theParams [0]));
			return (true);
		case "window.frontmost":

			/*  9/8/26 by CC -- THE RUN BUTTON'S SCRIPT IS NOT ITS OWN FRONT
				WINDOW. scriptgettargetdata in scripts.c: a script window is
				left out of the window walk (shellfindtargetwindow) only while
				its own Run-button process runs, so window.frontmost from the
				Run button answers the window BEHIND; from a menu command the
				script window counts. DW's 9/7 rule: "when a script runs in
				its own window, that window is not window.frontmost --
				frontmost is the window behind it." Only the app knows the
				window order, so it answers, through the promise path.  */

			if (flRunFromButton && (typeof window.odbDesktop !== "undefined") && (window.odbDesktop !== null) && (typeof window.odbDesktop.windowBehind === "function")) {
				return (window.odbDesktop.windowBehind ().then (function (theBehindAnswer) {
					return (((theBehindAnswer === undefined) || (theBehindAnswer === null)) ? "" : String (theBehindAnswer));
					}));
				}
			return (myFrontmostAnswer ());
		case "table.getcursor": {

			/*  8/26/26 by CC -- getcursorfunc, Common/source/tableverbs.c:
				the address of the table line the bar cursor points at. Only a
				table window has one -- addressForNode lives in the table page
				-- so a script or project window answers the empty string, the
				kernel's answer when tablegetcursorinfo has no cursor to read.  */

			if (typeof addressForNode !== "function") {
				return ("");
				}
			const theCursorNode = theOp.getCursor ();
			if (theCursorNode.length === 0) {
				return ("");
				}
			return (addressForNode (theCursorNode));
			}
		case "openurl": {
			/*  8/10/26 by CC -- the View button's end: the script named a
				page and the person's own machine opens it. In the desktop
				app the main process hands anything that isn't one of our own
				pages to the real browser; in a plain browser it's a new tab.

				This window NEVER goes anywhere. The first version fell back
				to loading the page right here when window.open answered
				nothing, which is what a popup blocker calls for -- but in
				the app window.open always answers nothing, because the main
				process took the url and denied the in-app window. So View
				replaced the outline DW was working in with the page he asked
				to look at, and his place was gone. His words: "in frontier i
				lose my context." In the app, nothing answered means it
				worked. In a browser, it means the blocker stopped it, and
				the message says so.  */

			const theUrl = String (theParams [0]);
			const flInTheApp = (navigator.userAgent.indexOf ("Electron") >= 0);

			if ((window.open (theUrl, "_blank") === null) && (flInTheApp !== true)) {
				const message = "the browser blocked the new tab for " + theUrl + ".";
				throw new Error (message);
				}
			return (true);
			}
		case "speaker.beep": {
			/*  8/20/26 by CC -- DW's own beep, the one all his software makes:
				beep.js from fargo.io/code/shared, playing the wav at
				s3.amazonaws.com/scripting.com/code/includes. It used to be a
				880Hz tone this code synthesized, which was nobody's beep.
				Defining speakerBeep as a global is also what Concord looks
				for, so the outliner's own beep becomes the same sound.  */
			try {
				speakerBeep ();
				}
			catch (err) {
				}
			return (true);
			}
		default: {
			const message = "the window doesn't know that verb.";
			throw new Error (message);
			}
		}
	}

function openEditWindow (theDialog, callback) { //a script called edit -- a real window opens on the object it named; callback when it's READY, so the script's next line can aim at it

	/*  In the desktop app window.open makes a real window, tracked and
		restored like the others; in a plain browser it's a tab. The url
		carries everything the window needs, so it comes back whole when
		the app restores its windows at launch.

		8/15/26 by CC -- the callback. Frontier's edit answers when the
		window is open, and DW's scripts lean on that: console.start says
		edit (adrconsole) and aims op verbs at it on the very next line.
		So the answer waits: for a window already open (it answers the
		ping), or for the new window's ready announcement, or five seconds,
		whichever comes first -- a run never hangs on a window that can't
		say ready.  */

	var theUrl = (theDialog.objectType === "table") ? "./?address=" : ((theDialog.objectType === "menubar") ? "menubar.html?address=" : "script.html?address="); //a table opens a table window, a menubar the menubar editor (9/3/26), everything else the script editor
	theUrl += encodeURIComponent (theDialog.address);
	if (theDialog.title !== undefined) {
		theUrl += "&title=" + encodeURIComponent (theDialog.title);
		}
	if (theDialog.buttonsAddress !== undefined) {
		theUrl += "&buttons=" + encodeURIComponent (theDialog.buttonsAddress);
		}
	if (theDialog.flReadonly === true) {
		theUrl += "&readonly=1";
		}

	if (callback === undefined) {
		callback = function () {
			};
		}
	var flAnswered = false;
	var readyListener;
	function done () {
		if (!flAnswered) {
			flAnswered = true;
			if ((readyListener !== undefined) && (theWindowChannel !== undefined)) {
				theWindowChannel.removeEventListener ("message", readyListener);
				}
			callback ();
			}
		}

	function openTheWindow () {

		/*  8/15/26 by CC -- when window.open answers null, this used to load
			the object right here instead. That null isn't only a popup
			blocker: in the app, opening an object whose window already
			exists is DENIED (the app fronts the existing window), and the
			answer is null there too. So the fallback replaced the window
			the person was working in -- DW ran console.start, his window
			became the console, and the run died with the page. The window
			it navigated away from was the one running the script.

			Now: null means the window didn't open HERE, and this window
			stays what it is. The run continues either way.  */

		if (window.open (theUrl, "_blank") === null) {
			done ();
			return;
			}
		setTimeout (done, 5000);
		}

	joinWindowChannel ();
	if (theWindowChannel === undefined) {
		openTheWindow ();
		done ();
		return;
		}

	const theWantedAddress = String (theDialog.address).toLowerCase ();
	readyListener = function (theEvent) {
		const theMessage = theEvent.data;
		if ((theMessage !== undefined) && (theMessage !== null) && (theMessage.kind === "windowReady") && (theMessage.address === theWantedAddress)) {
			done ();
			}
		};
	theWindowChannel.addEventListener ("message", readyListener);
	pingForWindow (theDialog.address, function (flOpen) {
		if (flOpen) { //already open -- edit fronts it, the way Frontier does; no second window
			theWindowChannel.postMessage ({kind: "windowFront", address: theWantedAddress});
			done ();
			}
		else {
			openTheWindow ();
			}
		});
	}

function openObjectAtAddress (theAddress, showMessage) {

	/*  8/12/26 by CC -- cmd-double-click on an address opens what it names.
		DW: "if it's a scalar it opens the table that contains it with the
		cursor on the line."

		Nothing here knows what kind of object the address names, so it
		asks the database: a table lists, an outline or a script downloads,
		and anything else is a value that lives in a table -- so the table
		opens, with the cursor sitting on it.  */

	function openUrl (theUrl) {
		window.open (theUrl, "_blank"); //null just means it didn't open HERE -- in the app that's the deny that fronts the already-open window; never navigate this one away (8/15/26 by CC)
		}

	function openTheContainingTable () {
		const ixLastDot = theAddress.lastIndexOf (".");
		if (ixLastDot === -1) {
			showMessage ("Can't open " + theAddress + " because there is no object at that address.");
			return;
			}
		const theParent = theAddress.slice (0, ixLastDot);
		const theName = theAddress.slice (ixLastDot + 1);
		serverCall ("/listtable", {address: theParent}, "GET", function (err, data) {
			if (err !== undefined) {
				showMessage ("Can't open " + theAddress + " because there is no object at that address.");
				return;
				}
			var flFound = false;
			var theRealName = theName;
			var theKind;
			data.entries.forEach (function (theEntry) {
				if (theEntry.name.toLowerCase () === theName.toLowerCase ()) { //8/15/26 by CC -- names in the odb are unicase; cmd-double-click matches the way the database does
					flFound = true;
					theRealName = theEntry.name; //the cursor lands on the row as it's really spelled
					theKind = theEntry.kind;
					}
				});
			if (flFound !== true) {
				showMessage ("Can't open " + theAddress + " because " + theParent + " has nothing named " + theName + ".");
				return;
				}

			/*  9/5/26 by CC -- ONLY A SCALAR OPENS ITS CONTAINING TABLE. DW's
				9/5 report: cmd-double-click on scratchpad.myMenubar, the
				address a one-liner had just deposited, opened scratchpad --
				"it's not a scalar, it should open in its own window." The
				listing above says what the thing is; a menubar, a script or
				an outline opens in its own window, the 9/3 ruling ("a menubar
				is an object type that opens in its own window everywhere").  */

			const theFullAddress = theParent + "." + theRealName;
			if (theKind === "menubar") {
				openUrl ("menubar.html?address=" + encodeURIComponent (theFullAddress));
				return;
				}
			if ((theKind === "script") || (theKind === "outline")) {
				openUrl ("script.html?address=" + encodeURIComponent (theFullAddress));
				return;
				}
			openUrl ("./?address=" + encodeURIComponent (theParent) + "&cursor=" + encodeURIComponent (theRealName));
			});
		}

	/*  9/12/26 by CC -- THE WINDOW OPENS ON THE OBJECT'S REAL ADDRESS. DW's
		9/12 report: the Window menu listed simpleRootUpdate.doUpdate twice. A
		cmd-click on a short name (simpleRootUpdate.doUpdate, found through
		system.paths) opened a window keyed by that short spelling, while the
		same script opened from its table was keyed by its full address; two
		windows, one object, and the title strip trims both to the same
		label. The server answers resolvedAddress on both calls; the window
		opens on that, so one object has one key however it was reached.  */

	serverCall ("/listtable", {address: theAddress}, "GET", function (errTable, dataTable) {
		if (errTable === undefined) {
			openUrl ("./?address=" + encodeURIComponent (((dataTable !== undefined) && (dataTable.resolvedAddress !== undefined)) ? dataTable.resolvedAddress : theAddress));
			return;
			}
		serverCall ("/downloadobject", {address: theAddress}, "GET", function (errObject, dataObject) {
			if (errObject === undefined) {
				openUrl ("script.html?address=" + encodeURIComponent (((dataObject !== undefined) && (dataObject.resolvedAddress !== undefined)) ? dataObject.resolvedAddress : theAddress));
				return;
				}
			openTheContainingTable ();
			});
		});
	}

function addressAtSelection () {

	/*  8/12/26 by CC -- the dotted address around what the double-click
		selected. A double-click selects one word, and an address is words
		with dots between them, so the selection grows outward through
		anything an address can be made of.  */

	const theSelection = window.getSelection ();
	if ((theSelection === null) || (theSelection.rangeCount === 0)) {
		return (undefined);
		}
	const theTextNode = theSelection.anchorNode;
	if ((theTextNode === null) || (theTextNode.nodeType !== 3)) { //3 is a text node -- a click that landed anywhere else has no word
		return (undefined);
		}
	const theText = theTextNode.textContent;
	function flAddressCharacter (theCharacter) {
		return (/[A-Za-z0-9_.]/.test (theCharacter));
		}
	var ixStart = Math.min (theSelection.anchorOffset, theSelection.focusOffset);
	var ixEnd = Math.max (theSelection.anchorOffset, theSelection.focusOffset);
	while ((ixStart > 0) && flAddressCharacter (theText.charAt (ixStart - 1))) {
		ixStart--;
		}
	while ((ixEnd < theText.length) && flAddressCharacter (theText.charAt (ixEnd))) {
		ixEnd++;
		}
	while ((ixEnd > ixStart) && (theText.charAt (ixEnd - 1) === ".")) { //a sentence's period isn't part of the address
		ixEnd--;
		}
	while ((ixStart < ixEnd) && (theText.charAt (ixStart) === ".")) {
		ixStart++;
		}
	if (ixStart === ixEnd) {
		return (undefined);
		}

	/*  8/12/26 by CC -- the whole address highlights, the way it would have
		in the Frontier outliner, where a period is part of a word. Concord
		takes a period as the end of one, so a double-click there selects a
		single segment; this puts the selection where the eye expects it,
		and shows which address is about to open.  */

	const theRange = document.createRange ();
	theRange.setStart (theTextNode, ixStart);
	theRange.setEnd (theTextNode, ixEnd);
	theSelection.removeAllRanges ();
	theSelection.addRange (theRange);

	return (theText.slice (ixStart, ixEnd));
	}

function getFileOnDesktop (theParams, callback) {

	/*  8/16/26 by CC -- file.getFileDialog's window half: the app puts up a
		real Mac open-file dialog and answers the chosen file as a Frontier
		colon path. Outside the app there is no dialog to show.  */

	if (window.odbDesktop === undefined) {
		callback ({message: "Can't put up the file dialog because this window isn't running in the Electric Frontier app."});
		return;
		}
	window.odbDesktop.getFileDialog (String (theParams [0]), (theParams [1] === undefined) ? "" : String (theParams [1])).then (function (theAnswer) {
		callback ({value: theAnswer});
		}).catch (function (theError) {
		var message = theError.message;
		const ixLast = message.lastIndexOf ("Error: ");
		if (ixLast !== -1) {
			message = message.slice (ixLast + 7);
			}
		callback ({message: "Can't put up the file dialog because " + message});
		});
	}

function putFileOnDesktop (theParams, callback) { //8/17/26 by CC -- file.putFileDialog's window half

	if (window.odbDesktop === undefined) {
		callback ({message: "Can't put up the save dialog because this window isn't running in the Electric Frontier app."});
		return;
		}
	window.odbDesktop.putFileDialog (String (theParams [0]), (theParams [1] === undefined) ? "" : String (theParams [1]), (theParams [2] === undefined) ? "" : String (theParams [2])).then (function (theAnswer) {
		callback ({value: theAnswer});
		}).catch (function (theError) {
		callback ({message: "Can't put up the save dialog because " + theError.message});
		});
	}

function getFolderOnDesktop (theParams, callback) { //8/17/26 by CC -- file.getFolderDialog's window half

	if (window.odbDesktop === undefined) {
		callback ({message: "Can't put up the folder dialog because this window isn't running in the Electric Frontier app."});
		return;
		}
	window.odbDesktop.getFolderDialog (String (theParams [0]), (theParams [1] === undefined) ? "" : String (theParams [1])).then (function (theAnswer) {
		callback ({value: theAnswer});
		}).catch (function (theError) {
		callback ({message: "Can't put up the folder dialog because " + theError.message});
		});
	}

function writeFileOnDesktop (theParams, callback) {

	/*  8/12/26 by CC -- the one thing a window asks the APP to do, rather
		than the server: put a file on the machine the person is sitting at.
		The app owns the folder; the script named only the file.  */

	if (window.odbDesktop === undefined) {
		callback ({message: "Can't write the file because this window isn't running in the Electric Frontier app."});
		return;
		}
	window.odbDesktop.writeWholeFile (String (theParams [0]), (theParams [1] === undefined) ? "" : String (theParams [1])).then (function (thePath) {
		callback ({value: thePath});
		}).catch (function (theError) {
		var message = theError.message;
		const ixLast = message.lastIndexOf ("Error: "); //Electron wraps what the app threw; the message is the part that says something
		if (ixLast !== -1) {
			message = message.slice (ixLast + 7);
			}
		callback ({message: "Can't write the file because " + message});
		});
	}

/*  8/21/26 by CC -- THE STACK CRAWL IN THE JS CONSOLE, DW's ask on 8/21, the day
	a morning went into finding out who called op.getcursor: "it's ok to put the
	stack crawl in the js console. until we get the debugger running that will
	help a lot."

	The interpreter keeps a log of calls, not a stack -- nothing records a
	return -- so what prints is the last calls made before the failure, most
	recent last. The caller of the failing verb is the line above it.  */

function writeCrawlToConsole (theMessage, theCrawl) {
	if ((theCrawl === undefined) || (theCrawl === null) || (theCrawl.length === 0)) {
		console.log ("Script failed: " + theMessage);
		return;
		}
	console.log ("Script failed: " + theMessage);
	console.log ("The last " + theCrawl.length + ((theCrawl.length === 1) ? " call before it, " : " calls before it, ") + "most recent last:");
	var ixCall = 0;
	theCrawl.forEach (function (theEntry) {
		ixCall++;
		var theLine = "   " + String (ixCall) + ". " + theEntry.verb + " (" + theEntry.args.join (", ") + ")";
		if (theEntry.kind !== "script") {
			theLine += "   [" + theEntry.kind + "]";
			}
		console.log (theLine);
		});
	}

var theLastCommentMarks; //8/21/26 by CC -- the .selected marks the comment command put back, and the line the cursor was on; see script.makecomment

function handleRunAnswer (err, data) { //every exchange with a running script lands here, until it finishes
	if (err !== undefined) {
		runFinished ();
		makeSureTheMouseWorks ();
		showRunStatus (err.message);
		showLocalAlert (err.message); //8/8/26 by CC -- a failure has to be SEEN; the status line alone wasn't (DW's Zoom report)
		return;
		}
	if (data.finished === false) {
		if (data.dialog.kind === "edit") { //8/8/26 by CC -- the script asked for a window, not an answer; 8/15/26 -- the answer waits for the window to be READY, so the script's next line can aim at it
			openEditWindow (data.dialog, function () {
				serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({button: "ok"})}, "POST", handleRunAnswer);
				});
			return;
			}
		if (data.dialog.kind === "editorverb") { //8/8/26 by CC -- the script is operating on THIS window's outline
			if (data.dialog.verb === "desktop.writewholefile") { //8/12/26 by CC -- the app writes it, and that takes a moment
				writeFileOnDesktop (data.dialog.params, function (theDesktopAnswer) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theDesktopAnswer)}, "POST", handleRunAnswer);
					});
				return;
				}
			if (data.dialog.verb === "desktop.getfiledialog") { //8/16/26 by CC -- file.getFileDialog: the app shows the dialog, the person picks
				getFileOnDesktop (data.dialog.params, function (theDesktopAnswer) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theDesktopAnswer)}, "POST", handleRunAnswer);
					});
				return;
				}
			if (data.dialog.verb === "desktop.putfiledialog") { //8/17/26 by CC -- file.putFileDialog
				putFileOnDesktop (data.dialog.params, function (theDesktopAnswer) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theDesktopAnswer)}, "POST", handleRunAnswer);
					});
				return;
				}
			if (data.dialog.verb === "desktop.getfolderdialog") { //8/17/26 by CC -- file.getFolderDialog
				getFolderOnDesktop (data.dialog.params, function (theDesktopAnswer) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theDesktopAnswer)}, "POST", handleRunAnswer);
					});
				return;
				}
			if (data.dialog.verb === "window.isopen") { //8/15/26 by CC -- the script asks before aiming ops at its target
				pingForWindow (String (data.dialog.params [0]), function (flOpen) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({value: flOpen})}, "POST", handleRunAnswer);
					});
				return;
				}
			if ((data.dialog.targetAddress === undefined) && flRunFromButton && flVerbActsOnTheTarget (data.dialog.verb) && (typeof window.odbDesktop !== "undefined") && (window.odbDesktop !== null) && (typeof window.odbDesktop.windowBehind === "function")) {

				/*  9/10/26 by CC -- FROM THE RUN BUTTON, THE OP VERBS ACT ON THE WINDOW
					BEHIND. opverbgettargetdata goes through scriptgettargetdata
					(scripts.c): while a script window's own Run-button process runs,
					that window steps out of the target walk, so the outline the op
					verbs find is the next window down -- the same rule that answers
					window.frontmost (9/8). From a menu command the script's window is
					a window like any other. DW, 9/10: "yes, but you should check prior
					art in c kernel." No window behind: no target, the kernel's answer.  */

				window.odbDesktop.windowBehind ().then (function (theBehindAddress) {
					const theAddress = ((theBehindAddress === undefined) || (theBehindAddress === null)) ? "" : String (theBehindAddress);
					if (theAddress.length === 0) {
						serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({message: "Can't do " + data.dialog.verb + " because there is no window behind the script's window for it to act on."})}, "POST", handleRunAnswer);
						return;
						}
					callWindowOnTarget (theAddress, data.dialog.verb, data.dialog.params, function (theTargetAnswer) {
						serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theTargetAnswer)}, "POST", handleRunAnswer);
						});
					}, function (err) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({message: "Can't do " + data.dialog.verb + " because the app couldn't say which window is behind this one."})}, "POST", handleRunAnswer);
					});
				return;
				}
			if ((data.dialog.targetAddress !== undefined) && (String (data.dialog.targetAddress).toLowerCase () !== myChannelAddress ())) { //8/15/26 by CC -- the op belongs to the window showing the target, not this one
				callWindowOnTarget (data.dialog.targetAddress, data.dialog.verb, data.dialog.params, function (theTargetAnswer) {
					serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theTargetAnswer)}, "POST", handleRunAnswer);
					});
				return;
				}
			var theAnswer;
			try {
				const theValue = executeEditorVerb (data.dialog.verb, data.dialog.params);
				if ((theValue !== undefined) && (theValue !== null) && (typeof theValue.then === "function")) {

					/*  8/26/26 by CC -- window.getPosition and its family answer
						through the app, which answers with a promise. Posting the
						promise itself serialized as an empty object, so the script
						saw no window where one was open -- DW's 8/22 report on the
						window family, and the 8/25 fire alarm on window.getTitle.
						The answer goes back when the app has actually answered.  */

					theValue.then (function (theResolved) {
						serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({value: theResolved})}, "POST", handleRunAnswer);
						}, function (promiseErr) {
						serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({message: "Can't do " + data.dialog.verb + " in this window because " + promiseErr.message})}, "POST", handleRunAnswer);
						});
					return;
					}
				theAnswer = {value: theValue};
				}
			catch (editorErr) {
				theAnswer = {message: "Can't do " + data.dialog.verb + " in this window because " + editorErr.message};
				}
			serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theAnswer)}, "POST", handleRunAnswer);
			return;
			}
		showDialog (data.dialog, data.runId);
		return;
		}
	if (data.threadsDone === true) { //9/16/26 by CC -- the last thread that held this window let go; the listening is over
		return;
		}
	if (data.threadsWithWindow === true) { //9/16/26 by CC -- the run is done but threads it started still have this window; keep answering their questions until the server says they're gone. DW's 9/16 report: nodeEditor's Save button starts a thread and returns, and the thread's window verbs had no window
		listenForThreads (data.runId);
		}
	runFinished (); //everything past here is a finished run
	makeSureTheMouseWorks (); //8/17/26 by CC -- a run that ended with a dialog still up leaves nothing behind
	syncCommentIcons (); //8/17/26 by CC -- and the comment icons match what the lines are
	if (data.message !== undefined) { //the script failed, or the dialog timed out
		writeCrawlToConsole (data.message, data.stack); //8/21/26 by CC -- the whole point: who called the verb that failed
		showRunStatus (data.message);
		if (data.message === "The script was stopped.") { //8/26/26 by CC -- DW's ruling 8/25: stopping a script gets a beep, not a dialog; the status line stays
			flDepositErrorUnderLine = false;
			try {
				speakerBeep ();
				}
			catch (beepErr) {
				}
			return;
			}
		if (flDepositErrorUnderLine && depositCommentUnderCursor (data.message)) { //8/15/26 by CC -- a one-liner's failure reads like its value: a comment under the line
			flDepositErrorUnderLine = false;
			return;
			}
		flDepositErrorUnderLine = false;
		showLocalAlert (data.message);
		return;
		}
	flDepositErrorUnderLine = false; //the run finished clean; the next failure is somebody else's
	if (flScriptWroteMessage) { //8/13/26 by CC -- the script's own message stays; DW saw window.msg ("hello") flash and vanish under the summary
		return;
		}
	var theValueText = JSON.stringify (data.value);
	if (theValueText === undefined) { //a script with no value
		theValueText = "(no value)";
		}
	showRunStatus (theValueText + " -- " + data.ctVerbCalls + " verb calls, " + data.ctMilliseconds + "ms");
	}

function listenForThreads (runId) { //9/16/26 by CC -- after a run finishes, its threads' questions still come through /dialoganswer; a listening request waits for the next one
	serverCall ("/dialoganswer", {runid: runId, opmltext: JSON.stringify ({listening: true})}, "POST", function (err, data) {
		if (err !== undefined) { //the record is gone -- the threads finished long ago, or the server restarted; nothing to show
			return;
			}
		handleRunAnswer (undefined, data);
		});
	}

/*  10/1/26 by CC -- A DIALOG DOESN'T TAKE THE SELECTION AWAY. In Frontier a
	dialog is a window of its own and the outline behind it keeps its
	selection. Here the dialog is drawn in the same page and its text box
	takes the focus, so the selection in the line was gone by the time the
	script went on: Add Link asks for the URL first and then asks what is
	selected. The selection in a line of the outline is remembered when a
	dialog goes up and put back when it comes down.  */

function saveLineSelection () { //{element, range} when the selection is in a line of the outline; undefined otherwise
	const theSelection = window.getSelection ();
	if ((theSelection === null) || (theSelection.rangeCount === 0)) {
		return (undefined);
		}
	const theRange = theSelection.getRangeAt (0);
	const theStart = (theRange.startContainer.nodeType === 1) ? theRange.startContainer : theRange.startContainer.parentNode;
	const theLine = $(theStart).closest ("#divOutliner .concord-text");
	if (theLine.length === 0) {
		return (undefined);
		}
	return ({element: theLine [0], range: theRange.cloneRange ()});
	}

function restoreLineSelection (theSaved) {
	if (theSaved === undefined) {
		return;
		}
	if (!theSaved.element.isConnected || !theSaved.range.startContainer.isConnected || !theSaved.range.endContainer.isConnected) { //the line changed under the dialog; nothing to put back
		return;
		}
	theSaved.element.focus ();
	const theSelection = window.getSelection ();
	theSelection.removeAllRanges ();
	theSelection.addRange (theSaved.range);
	}

function setHtmlFormatting (theOp, flOn) { //10/3/26 by CC -- the window's lines redraw in the new mode, the way opsethtmlformatting dirties the view and redraws

	/*  Concord reads the render-mode flag when it draws a line, and its
		setRenderMode redraws the outline (outlineToXml, xmlToOutline, the
		cursor put back by its count), so the switch shows at once: in
		render mode the markup shows as formatting, out of it the tags show
		as typed. The open lines stay open; the OPML carries them.  */

	theOp.setRenderMode (flOn);
	}

function editAttributesDialog (theOp) { //10/3/26 by CC -- op.attributes.edit: the cursor line's attributes in a dialog of name and value rows; + adds a row, the trash can deletes one, Save puts them on the line; answers true for Save, false for Cancel

	/*  Cribbed from Drummer's Edit attributes dialog (tableeditor.js:
		tabEdAddRow, tabEdDeleteRow, tabEdOkClick, tabEdShow) -- DW's 10/3
		ask: "we need an attribute editor, can be cribbed from drummer. we
		never had this dialog before, but its essential. the + button adds a
		new blank line. garbage can deletes the line." And: "use this dialog
		for prior art for all the other dialogs." Drummer's loads its markup
		from a file and shows it as a Bootstrap modal; here it is built the
		way this page's other dialogs are (showDialog), on the same mask,
		with the same buttons. An empty name is left out on Save, the way
		an attribute with no name can't be written into OPML.  */

	return (new Promise (function (resolve) {
		const theNode = theOp.getCursor ();
		if (theNode.length !== 1) {
			resolve (false);
			return;
			}
		const theAtts = (theNode.data ("attributes") === undefined) ? {} : theNode.data ("attributes");
		const divMask = $("<div class=\"divDialogMask\"></div>");
		const divDialog = $("<div class=\"divDialog divAttsDialog\"></div>");
		divDialog.append ($("<div class=\"divDialogPrompt\"></div>").text ("Edit attributes"));
		const tableAtts = $("<table class=\"tableAtts\"></table>");
		function addRow (theName, theValue, flFocus) {
			const trRow = $("<tr></tr>");
			const inputName = $("<input type=\"text\" class=\"inputAttName\">").val (theName);
			const inputValue = $("<input type=\"text\" class=\"inputAttValue\">").val (theValue);
			const aDelete = $("<a class=\"aAttDelete\" title=\"Delete this attribute\"><i class=\"far fa-trash-alt\"></i></a>").click (function () { //the trash can, Drummer's
				trRow.remove ();
				});
			trRow.append ($("<td></td>").append (inputName));
			trRow.append ($("<td></td>").append (inputValue));
			trRow.append ($("<td></td>").append (aDelete));
			tableAtts.append (trRow);
			if (flFocus) {
				inputName.focus ();
				}
			}
		Object.keys (theAtts).forEach (function (theName) {
			addRow (theName, String (theAtts [theName]), false);
			});
		if (tableAtts.children ().length === 0) {
			addRow ("", "", false);
			}
		divDialog.append (tableAtts);
		const divButtons = $("<div class=\"divDialogButtons divAttsButtons\"></div>");
		const buttonAdd = $("<button class=\"buttonBar buttonAttAdd\" title=\"Add an attribute\">+</button>").click (function () {
			addRow ("", "", true);
			});
		const theSelectionBefore = saveLineSelection ();
		function finish (flSaved) {
			divMask.remove ();
			restoreLineSelection (theSelectionBefore);
			resolve (flSaved);
			}
		const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>").click (function () {
			finish (false);
			});
		const buttonSave = $("<button class=\"buttonBar buttonDefault\">Save</button>").click (function () {
			const theNewAtts = {};
			tableAtts.find ("tr").each (function () {
				const theName = $(this).find (".inputAttName").val ().trim ();
				if (theName.length > 0) {
					theNewAtts [theName] = $(this).find (".inputAttValue").val ();
					}
				});
			theOp.setCursor (theNode);
			const theLineAtts = new ConcordOpAttributes ($("#divOutliner").concord (), theNode); //Concord's own attribute setter for this line: op.attributes is built once, for the cursor of that moment
			theLineAtts.makeEmpty ();
			theLineAtts.addGroup (theNewAtts);
			theOp.markChanged ();
			finish (true);
			});
		divButtons.append (buttonAdd).append ($("<span class=\"spanAttsButtonGap\"></span>")).append (buttonCancel).append (buttonSave);
		divDialog.append (divButtons);
		divMask.append (divDialog);
		$("body").append (divMask);
		divDialog.keydown (function (event) {
			if (event.which === 13) { //return key
				buttonSave.click ();
				}
			if (event.which === 27) { //escape
				buttonCancel.click ();
				}
			});
		const firstInput = tableAtts.find (".inputAttName").first ();
		if (firstInput.length === 1) {
			firstInput.focus ();
			}
		}));
	}

function expandInclude (theOp, theNode) { //10/3/26 by CC -- an include: the OPML at the line's url becomes its subs, read through the server

	/*  Drummer's expandInclude (home/code.js): the url attribute, read with
		Accept: text/x-opml ("the same header the OPML Editor uses for
		includes"), the subs it had deleted, the OPML inserted to the right,
		the change not counted. Here the server reads the url (the page can't
		reach another site itself), and the subs an include shows are never
		written back to the database -- currentOpml leaves them out (see
		opmlWithoutIncludedSubs). DW's 10/3 ask: "grab the code from drummer,
		and hook it into atlantis. i need this now because workspace.notepad
		is slowing down."  */

	const attributes = theNode.data ("attributes");
	const theUrl = (attributes === undefined) ? undefined : attributes.url;
	if ((theUrl === undefined) || (String (theUrl).length === 0)) {
		showMessage ("Can't expand the include because the line has no url attribute.");
		return;
		}
	serverCall ("/readinclude", {url: String (theUrl)}, "GET", function (err, data) {
		if (err !== undefined) {
			showMessage ("Can't expand the include because " + err.message);
			return;
			}
		try {
			theOp.setCursor (theNode);
			theOp.deleteSubs ();
			theOp.insertXml (data.opmltext, "right");
			theOp.setCursor (theNode);
			theNode.removeClass ("collapsed");
			theNode.addClass ("concord-include-expanded");
			}
		catch (errInsert) {
			showMessage ("Can't expand the include because the file at " + theUrl + " isn't an outline.");
			}
		});
	}

function opmlWithoutIncludedSubs (theOp) { //10/3/26 by CC -- the outline as OPML with every include's subs left out: what an include shows is the other file's, never this one's

	const theDetached = [];
	$("#divOutliner .concord-node[opml-type='include']").each (function () {
		const theList = $(this).children ("ol");
		if (theList.children ().length > 0) {
			theDetached.push ({node: $(this), children: theList.children ().detach ()});
			}
		});
	var theOpml;
	try {
		theOpml = theOp.outlineToXml ();
		}
	finally {
		theDetached.forEach (function (theEntry) {
			theEntry.node.children ("ol").append (theEntry.children);
			});
		}
	return (theOpml);
	}

function showDialog (theDialog, runId) { //the script is standing still until one of these buttons is clicked
	const divMask = $("<div class=\"divDialogMask\"></div>");
	const divDialog = $("<div class=\"divDialog\"></div>");
	const divPrompt = $("<div class=\"divDialogPrompt\"></div>").text (theDialog.prompt);
	divDialog.append (divPrompt);
	var inputAnswer;
	if (theDialog.kind === "ask") {
		inputAnswer = $("<input type=\"text\" class=\"inputDialogAnswer\">").val (theDialog.startValue);
		divDialog.append (inputAnswer);
		}
	const divButtons = $("<div class=\"divDialogButtons\"></div>");
	const theSelectionBefore = saveLineSelection (); //10/1/26 by CC -- see restoreLineSelection
	function answer (theButton) {
		divMask.remove ();
		restoreLineSelection (theSelectionBefore);
		
		/*  8/19/26 by CC -- DW: "when a script ends on a dialog, the word
			Running... stays in the upper left corner of window when the script
			is done." Here is why. flScriptWroteMessage protects a message the
			script put up with window.msg from being smashed by the run summary
			-- but the line below smashes it anyway, and then the protection
			kept the summary from ever replacing THAT. Once the message is off
			the screen there is nothing left to protect.  */
		
		flScriptWroteMessage = false;
		showRunStatus ("Running…"); //horizontal ellipsis
		const theAnswer = {button: theButton};
		if (inputAnswer !== undefined) {
			theAnswer.text = inputAnswer.val ();
			}
		serverCall ("/dialoganswer", {runid: runId, opmltext: JSON.stringify (theAnswer)}, "POST", handleRunAnswer);
		}
	var buttonDefault;
	if (theDialog.kind === "buttons") {

		/*  8/24/26 by CC -- the kernel's twoway and threeway dialogs: the
			prompt with the caller's own button names. Button 1 is the
			default and sits at the right, the way twowaydialog lays it out;
			the answer says which number was hit.  */

		var ixButton;
		for (ixButton = theDialog.buttons.length; ixButton >= 1; ixButton--) {
			const theNumber = ixButton;
			const theButton = $("<button class=\"buttonBar" + ((theNumber === 1) ? " buttonDefault" : "") + "\"></button>").text (String (theDialog.buttons [theNumber - 1])).click (function () {
				answer (theNumber);
				});
			divButtons.append (theButton);
			if (theNumber === 1) {
				buttonDefault = theButton;
				}
			}
		}
	else {
		if ((theDialog.kind === "confirm") || (theDialog.kind === "ask")) {
			const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>").click (function () {
				answer ("cancel");
				});
			divButtons.append (buttonCancel);
			}
		buttonDefault = $("<button class=\"buttonBar buttonDefault\">OK</button>").click (function () {
			answer ("ok");
			});
		divButtons.append (buttonDefault);
		}
	divDialog.append (divButtons);
	divMask.append (divDialog);
	$("body").append (divMask);
	function returnKeyAnswers (event) {
		if (event.which === 13) { //return key
			answer ((theDialog.kind === "buttons") ? 1 : "ok");
			}
		}
	if (inputAnswer !== undefined) {
		inputAnswer.focus ().select ().keydown (returnKeyAnswers); //8/12/26 by CC -- what's there is selected, so typing an address replaces it instead of appending to it
		}
	else {
		buttonDefault.focus ();
		}
	}

function xmlEscape (theText) {

	/*  9/24/26 by CC -- the characters XML 1.0 cannot carry are dropped, the
		rule scriptToOpml (trigger.js) already applies on the way out of the
		database. A binary value -- an icon's bytes, ics4 and ics8 under
		Frontier.tools.data -- is shown as text in a table row, and its
		control characters made the row's OPML unparseable: the table could
		not be expanded at all, and an Expand Everything that reached it
		stopped there with the display held (DW's 9/24 report: "the screen
		flashes, no new stuff is revealed"). Tab, return and linefeed are
		written as references so they survive as themselves in an attribute.  */

	return (String (theText)
		.replace (/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
		.split ("&").join ("&amp;")
		.split ("<").join ("&lt;")
		.split (">").join ("&gt;")
		.split ("\"").join ("&quot;")
		.split ("\t").join ("&#9;")
		.split ("\n").join ("&#10;")
		.split ("\r").join ("&#13;"));
	}
