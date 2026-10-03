/*  quickscript.js -- the Quick Script window's own behavior; common.js runs
	the script and shows the dialogs. 9/16/26 by CC.

	What the C does (command.c): cmdiconhit builds the text into a script and
	runs it as a process of its own, one at a time; the value comes back as
	a string on the line under the box (minisetwindowmessage); an error's
	message goes on the same line. The text lives in the root record
	(hscriptstring, cmdsavestring / cmdloadstring) so it's there next time
	the window opens. From this window the frontmost window is the one
	behind it (browserverbs.c, "the quickscript window" note), which is the
	Run button's rule in the script windows here (flRunFromButton).  */

var theSaveTimer;

function setRunButtonForRun (flRunning) { //common.js's puts the words Run and Stop on the button; this window's button is the kernel's icon, a triangle to run and a square to stop
	$("#buttonRun").html (flRunning ? "&#x25A0;" : "&#x25B6;").attr ("title", flRunning ? "Stop the script" : "Run the script (Return)"); //black square; black right-pointing triangle
	$(".divQuickScriptRunLabel").text (flRunning ? "Stop" : "Run");
	}

function showStatus (theText) { //the line under the box; a finished run's summary is trimmed to the value, the way the kernel's line shows the value alone
	const theMatch = String (theText).match (/^(.*) -- \d+ verb calls, \d+ms$/);
	$("#spanStatus").text ((theMatch === null) ? theText : theMatch [1]).attr ("title", theText);
	}

function saveTheText () {
	clearTimeout (theSaveTimer);
	theSaveTimer = setTimeout (function () {
		serverCall ("/setsetting", {name: "quickScript", opmltext: $("#textareaScript").val ()}, "POST", function (err, data) {
			if (err !== undefined) {
				showStatus ("Can't save the script's text because " + err.message);
				}
			});
		}, 500);
	}

function runQuickScript () {
	if (theRunIdInFlight !== undefined) { //one at a time -- the kernel beeps (cmdiconhit's quickscriptprocess check)
		try {
			speakerBeep ();
			}
		catch (err) {
			}
		return;
		}
	clearTimeout (theSaveTimer);
	serverCall ("/setsetting", {name: "quickScript", opmltext: $("#textareaScript").val ()}, "POST", function (err, data) {
		flRunFromButton = true; //window.frontmost answers the window behind, as from a script window's Run button
		runMenuScript ($("#textareaScript").val ());
		});
	}

$(document).ready (function () {
	if (!getPassword ()) { //the entry form is up; the page waits for the reload
		return;
		}
	showVersion ();
	letTheRightClickThrough ();
	document.title = "Quick Script";
	serverCall ("/getsetting", {name: "quickScript"}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus ("Can't read the script's text because " + err.message);
			return;
			}
		$("#textareaScript").val (data.value);
		$("#textareaScript").focus ();
		});
	$("#textareaScript").on ("input", saveTheText);
	$("#textareaScript").on ("keydown", function (event) { //Return runs, the dialog's default button; shift-Return is a new line
		if ((event.which === 13) && !event.shiftKey && !event.altKey) { //13: return; jQuery 1.9's event carries which, not key
			event.preventDefault ();
			runQuickScript ();
			}
		});
	$("#buttonRun").click (function () {
		if (theRunIdInFlight === undefined) { //while a run is going the click means Stop, and common.js's capture-phase handler takes it
			runQuickScript ();
			}
		});
	});
