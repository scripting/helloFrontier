/*  langstartup.js -- what the kernel does when the language starts up.

	initEnvironment mirrors initenvironment in langstartup.c: the
	system.environment table is built truthfully at startup, from the
	machine we are really on. The kernel treats it as a system table --
	rebuilt every launch, never trusted from disk -- and so do we: whatever
	a database carries, the launch writes the truth over it.

	DW's rulings 8/26, on Brent's answer at scripting/helloFrontier#2:
	isCarbon is FALSE -- Carbon was a thing for a brief period when OS X
	was new, long gone -- overriding the 2011 kernel's true. isMac answers
	true on his Mac; it had answered false, which is the bug that stopped
	file.openFolder and getSpecialFolderPath.

	by CC, 8/27/26  */

const os = require ("os");
const childProcess = require ("child_process");

function swVers (theFlag) { //one line from sw_vers, or the empty string if it can't run
	try {
		return (String (childProcess.execSync ("sw_vers " + theFlag, {timeout: 5000})).trim ());
		}
	catch (err) {
		return ("");
		}
	}

function buildEnvironmentValues () {
	const flMac = (process.platform === "darwin");
	const flWindows = (process.platform === "win32");
	const theValues = {};

	var versionString = "";
	if (flMac) {
		versionString = swVers ("-productVersion");
		theValues.osBuildNumber = swVers ("-buildVersion");
		theValues.osFullNameForDisplay = swVers ("-productName");
		}
	if (versionString.length === 0) {
		versionString = os.release ();
		}
	if (theValues.osFullNameForDisplay === undefined) {
		theValues.osFullNameForDisplay = os.type ();
		}
	if (theValues.osBuildNumber === undefined) {
		theValues.osBuildNumber = os.release ();
		}

	const theParts = versionString.split (".");
	theValues.osMajorVersion = (theParts [0] === undefined) ? 0 : (Number (theParts [0]) || 0);
	theValues.osMinorVersion = (theParts [1] === undefined) ? 0 : (Number (theParts [1]) || 0);
	theValues.osPointVersion = (theParts [2] === undefined) ? 0 : (Number (theParts [2]) || 0);
	theValues.osVersionString = versionString;

	theValues.isMac = flMac;
	theValues.isWindows = flWindows;
	theValues.isUnix = (!flMac && !flWindows); //not a kernel name -- it was already in the table, and stays truthful: marin answers true, a Mac answers isMac
	theValues.isCarbon = false; //DW's ruling, Brent's answer -- the 2011 kernel said true
	theValues.isMacOsClassic = false;
	theValues.isServer = false; //the kernel's isServer meant the Mac OS X Server product, long gone
	theValues.isFrontier = true;
	theValues.isPike = false;
	theValues.isRadio = false;
	theValues.isOpmlEditor = false; //9/5/26 by CC -- DW's ruling, reversing 9/4's true: "almost everything i read there says it should be false." The app is Frontier, as it was before the OPML Editor. What the 2012 scripts did on the OPML path that we still want (the bookmarks menu) keys on isAtlantis below; what they do on the Frontier path that this kernel can't (the user-info card) is skipped when isAtlantis is true -- misc/ruledEdits.js
	theValues.isAtlantis = true; //9/5/26 by CC -- DW's ruling: "we can have a new system.environment.isAtlantis -- to guide us"
	theValues.maxTcpConnections = 2147483647; //the kernel's longinfinity, MacSocketNetEvents.c

	return (theValues);
	}

function initEnvironment (theStore, theExtraValues) {

	/*  10/4/26 by CC -- theExtraValues: what only the caller knows, written
		into the table with the rest. The server passes the version numbers of
		its parts -- trigger, usertalk, frontierodb -- as triggerVersion,
		usertalkVersion and odbVersion: DW's 10/4 ruling, only one version
		number is shown to users (the app's, in the corner of every window),
		"the other numbers belong in system.environment at startup, for
		debugging."  */

	if (theStore.odb.system === undefined) {
		theStore.odb.system = {};
		}
	if (theStore.odb.system.environment === undefined) {
		theStore.odb.system.environment = {};
		}
	const theTable = theStore.odb.system.environment;
	const theValues = buildEnvironmentValues ();
	if (theExtraValues !== undefined) {
		Object.keys (theExtraValues).forEach (function (theName) {
			theValues [theName] = theExtraValues [theName];
			});
		}
	Object.keys (theValues).forEach (function (theName) {
		if (theTable [theName] !== theValues [theName]) { //only real changes get written -- an up-to-date database costs no writes at launch
			theTable [theName] = theValues [theName];
			}
		});
	}

module.exports = {initEnvironment, buildEnvironmentValues};
