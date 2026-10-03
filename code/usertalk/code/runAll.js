/*  Execute all 361 build scripts under the interpreter in dry-run mode:
	file verbs answer without touching disk, so what's being measured is
	the language -- does every script RUN, not just parse.
	
	by CC, 7/27/26 */

const fs = require ("fs");
const parse = require ("./parse.js");
const evaluate = require ("./evaluate.js");
const verbsMaker = require ("./verbs.js");

const folderBuildScripts = "/Users/davewiner/Claude/daveMigrates/usertalk build scripts";
const pathPathMap = require ("path").join (__dirname, "pathmap.json"); //7/27/26 by CC -- next to the code, wherever the repo lives
const pathReport = "/Users/davewiner/Claude/usertalk/misc/reports/runAllReport.json";

function unescapeXml (theString) {
	return (theString
		.replace (/&lt;/g, "<")
		.replace (/&gt;/g, ">")
		.replace (/&quot;/g, "\"")
		.replace (/&apos;/g, "'")
		.replace (/&amp;/g, "&"));
	}

function opmlToTree (theXml) {
	const root = {text: "", subs: []};
	const stack = [root];
	var depthSkip = -1;
	var depth = 0;
	const tagPattern = /<outline\b([^>]*?)(\/?)>|<\/outline>/g;
	var match;
	while ((match = tagPattern.exec (theXml)) !== null) {
		if (match [0] === "</outline>") {
			depth--;
			if ((depthSkip >= 0) && (depth <= depthSkip)) {
				depthSkip = -1;
				}
			stack.length = depth + 1;
			}
		else {
			const attributes = match [1];
			const flSelfClosing = match [2] === "/";
			const flComment = /isComment="true"/.test (attributes);
			const textMatch = attributes.match (/text="([^"]*)"/);
			var text = "";
			if (textMatch !== null) {
				text = unescapeXml (textMatch [1]);
				}
			if (depthSkip === -1) {
				if (flComment) {
					if (!flSelfClosing) {
						depthSkip = depth;
						}
					}
				else {
					const node = {text, subs: []};
					stack [depth].subs.push (node);
					if (!flSelfClosing) {
						stack [depth + 1] = node;
						}
					}
				}
			if (!flSelfClosing) {
				depth++;
				}
			}
		}
	return (root.subs);
	}

const odbLoader = require ("./odbLoader.js");

const thePathMap = JSON.parse (fs.readFileSync (pathPathMap, "utf8"));

/*  8/18/26 by CC -- the harness writes to disk only because every path in its
	map lands inside the sandbox folder, and it PROVES that here instead of
	trusting it. The network is never turned on -- the s3 verbs are refused by
	the write gate in verbs.js before they can look at a bucket, which is the
	hole that took FeedLand down on 8/17. See misc/howWeGetPastThis.md.  */

const folderSandbox = "/Users/davewiner/Claude/usertalk/misc/sandbox/";

if (thePathMap.flCorralPaths === false) {
	const message = "Can't run the suite because the path map turns the corral off, which would let a script write anywhere on the disk.";
	throw new Error (message);
	}
Object.keys (thePathMap.prefixes).forEach (function (prefix) {
	const theRealFolder = thePathMap.prefixes [prefix];
	if (theRealFolder.indexOf (folderSandbox) !== 0) {
		const message = "Can't run the suite because " + prefix + " maps to " + theRealFolder + ", which is outside the sandbox folder.";
		throw new Error (message);
		}
	});
thePathMap.flAllowDiskWrites = true; //proven above to reach nothing but the sandbox

console.log ("loading the real odb...");
const theRealOdb = odbLoader.loadOdb (); //shared across runs -- dry mode, crosstalk acceptable for the metric
theRealOdb.user.prefs.githubfolder = thePathMap.prefs.githubfolder;
theRealOdb.user.prefs.dropboxfolder = thePathMap.prefs.dropboxfolder;
console.log ("odb loaded");

function makeDryVerbs (theTrace) {
	
	const made = verbsMaker.makeVerbs (thePathMap, theTrace);
	const verbs = made.verbs;
	
	//file verbs answer plausibly without disk
	
	verbs ["file.copy"] = function (args) {
		return (true);
		};
	verbs ["file.surefilepath"] = function (args) {
		return (true);
		};
	verbs ["file.surefolder"] = function (args) {
		return (true);
		};
	verbs ["file.exists"] = function (args) {
		return (true);
		};
	verbs ["file.isfolder"] = function (args) {
		return (String (args [0]).endsWith (":"));
		};
	verbs ["file.readwholefile"] = function (args) {
		return ("dry run contents of " + args [0]);
		};
	verbs ["file.writewholefile"] = function (args) {
		return (true);
		};
	verbs ["file.delete"] = function (args) {
		return (true);
		};
	verbs ["file.modified"] = function (args) {
		return (new Date (0));
		};
	verbs ["fileloop.list"] = function (args) { //two pretend files so loop bodies execute
		var base = String (args [0]);
		if (!base.endsWith (":")) {
			base += ":";
			}
		return ([base + "dryRunFileOne.txt", base + "dryRunFileTwo.txt"]);
		};
	verbs ["tcp.httpreadurl"] = function (args) {
		return ("");
		};
	
	/*  8/20/26 by CC -- the machine's own address, answered dry. His tcp glue
		scripts run now -- tcp.myDottedID is one of his, over tcp.myAddress --
		and the harness has no network, the same way it has no disk. The
		loopback address is what tcp.myDottedID already claimed to be before
		the flip, said as a long. The product does NOT have these; whether it
		should is a network question, and network is off.  */
	
	verbs ["tcp.myaddress"] = function (args) {
		return (2130706433); //127.0.0.1
		};
	
	verbs ["tcp.nametoaddress"] = function (args) {
		return (2130706433);
		};
	verbs ["file.rename"] = function (args) {
		return (true);
		};
	
	/*  8/20/26 by CC -- the primitive file verbs answer dry too. They were
		never needed before because file.writeWholeFile and its neighbours
		were JavaScript here; now they are DW's own UserTalk -- his
		writeTextFile is 152 lines -- and what reaches the disk is the layer
		underneath: new, open, write, close. Left alone they try to map a
		colon path onto this machine and fail on a path the harness's map
		doesn't cover.  */
	
	const dryFileAnswers = {
		"file.new": true, "file.open": true, "file.close": true,
		"file.write": true, "file.writeline": true,
		"file.read": "", "file.readline": "",
		"file.setposition": true, "file.getposition": 0,
		"file.setendoffile": true, "file.endoffile": false,
		"file.getendoffile": 0, "file.size": 0,
		"file.settype": true, "file.setcreator": true,
		"file.type": "TEXT", "file.creator": "R*ch",
		"file.setmodified": true, "file.touchpath": true,
		"file.created": new Date (0), "file.newfolder": true,
		"file.countlines": 0, "file.findinfile": 0,
		"file.setcomment": true, "file.getcomment": "",
		"file.lock": true, "file.unlock": true, "file.islocked": false,
		"file.isalias": false, "file.isvisible": true, "file.setvisible": true,
		"file.setcreated": true, "file.move": true, "file.compare": true,
		"file.followalias": "", "file.newalias": true, "file.setpath": true
		};
	Object.keys (dryFileAnswers).forEach (function (verbName) {
		verbs [verbName] = function (args) {
			return (dryFileAnswers [verbName]);
			};
		});

	/*  8/17/26 by CC -- the s3 verbs answer dry, like the disk. Found the
		hard way: daves3's dependencies landed in node_modules with the 8/16
		desktop bundling, and the next suite run reached REAL S3 with the
		machine's own credentials -- metadata reads only, and s3.deleteObject
		isn't implemented, so nothing was written or deleted. A test suite
		must never be one missing stub away from real buckets.  */

	verbs ["s3.objectexists"] = function (args) {
		return (false);
		};
	verbs ["s3.getobject"] = function (args) {
		return ("");
		};
	verbs ["s3.newobject"] = function (args) {
		return (true);
		};

	/*  8/20/26 by CC -- the window's verbs answer dry, the same way the disk
		does. They exist in the app, where they are routed to the outline in
		the front window; here there is no window, and no outline. They are
		needed now because a verb resolves in the database first: op.outlineToXml
		used to be a JavaScript function, and is now DW's own UserTalk, which
		drives the outline through the cursor.
		
		op.go answers false -- it can't move, because there is nothing to move
		in -- so a walk over an outline finishes instead of running forever.  */
	
	const windowAnswers = {
		"op.fullcollapse": true, "op.fullexpand": true, "op.expand": true, "op.collapse": true,
		"op.firstsummit": true, "op.go": false, "op.getlinetext": "", "op.setlinetext": true,
		"op.getcursor": 0, "op.setcursor": true, "op.insert": true, "op.deleteline": true,
		"op.subsexpanded": false, "op.getexpansionstate": [], "op.setexpansionstate": true,
		"op.promote": true, "op.demote": true, "op.reorg": true, "op.deletesubs": true, "op.level": 1,
		"op.countsubs": 0, "op.countsummits": 0, "op.getheadnumber": 1, "op.setmodified": true,
		"op.getsuboutline": "", "op.getdisplay": true, "op.setdisplay": true,
		"speaker.beep": true, "window.next": false, "window.msg": true,
		"wp.intextmode": false, "wp.insert": true,
		"script.iscomment": false, "script.makecomment": true, "script.uncomment": true,
		"op.getscrollstate": 1, "op.setscrollstate": true, "op.getrefcon": 0, "op.setrefcon": true,
		"op.hoist": true, "op.dehoist": true, "op.find": false, "op.getselection": "",
		"op.getselectedsuboutlines": "", "op.visitall": true, "op.insertoutline": true,
		"op.flatcursorkeys": true, "op.tabkeyreorg": true,
		"window.gettitle": "dry run window", "window.settitle": true,
		"window.getposition": [0, 0], "window.setposition": true,
		"window.getsize": [600, 400], "window.setsize": true,
		"target.set": true, "lang.rollbeachball": true, "lang.edit": true
		};
	Object.keys (windowAnswers).forEach (function (verbName) {
		verbs [verbName] = function (args) {
			return (windowAnswers [verbName]);
			};
		});
	
	return (verbs);
	}

const externalScriptCache = {};

function resolveExternalScript (theName) { //a sibling build script called by bare name
	const lower = theName.toLowerCase ();
	if (externalScriptCache [lower] !== undefined) {
		return (externalScriptCache [lower]);
		}
	var found;
	fs.readdirSync (folderBuildScripts).forEach (function (fname) {
		if (fname.toLowerCase () === lower + ".opml") {
			found = fname;
			}
		});
	if (found === undefined) {
		return (undefined);
		}
	const theXml = fs.readFileSync (folderBuildScripts + "/" + found, "latin1");
	const external = {flOdbScript: true, parsedStatements: parse.parseOutline (opmlToTree (theXml))};
	externalScriptCache [lower] = external;
	return (external);
	}

var ctOk = 0, ctFailed = 0;
const failures = [];

fs.readdirSync (folderBuildScripts).forEach (function (fname) {
	if (!fname.endsWith (".opml")) {
		return;
		}
	
	process.stderr.write (fname + "\n"); //8/17/26 by CC -- a hung run names its script; a silent grind doesn't
	const theXml = fs.readFileSync (folderBuildScripts + "/" + fname, "latin1");
	const theStatements = parse.parseOutline (opmlToTree (theXml));

	const theTrace = [];
	theTrace.push = function (entry) { //7/27/26 by CC -- a dry-run answer can leave a folder walker with no bottom; cap it so the harness always finishes
		Array.prototype.push.call (this, entry);
		if (this.length >= 1000000) {
			const message = "Can't finish the script because it hit the cap of 1000000 verb calls -- likely a loop that dry-run answers never terminate.";
			throw new Error (message);
			}
		};
	const verbs = makeDryVerbs (theTrace);
	
	const environment = evaluate.makeEnvironment (theRealOdb, verbs, theTrace);
	environment.maxLoopIterations = 1000000; //8/17/26 by CC -- the runtime cap is gone (DW's ruling); the dry harness keeps its own bound, because dry answers make some loops bottomless
	environment.parseScript = function (theLines) {
		return (parse.parseOutline (parse.linesToTree (theLines)));
		};
	environment.resolveExternalScript = resolveExternalScript;
	environment.frames.push ({vars: {}});
	
	try {
		evaluate.evaluate (theStatements, environment);
		if (theTrace.length === 0) {
			const handlerName = fname.replace (/\.opml$/, "");
			const handlerKey = evaluate.findKey (environment.frames [0].vars, handlerName);
			if (handlerKey !== undefined) {
				evaluate.evaluate ([{op: "expression", expr: {op: "call", fn: {op: "id", name: handlerKey}, args: []}}], environment);
				}
			}
		ctOk++;
		}
	catch (err) {
		ctFailed++;
		failures.push ({script: fname, message: err.message, ctCallsBeforeFailure: theTrace.length});
		}
	});

const categories = {};
failures.forEach (function (failure) {
	const key = failure.message.replace (/"[^"]*"/g, "\"...\"").replace (/ of [A-Za-z0-9_.]+ /, " of ... ").replace (/call [A-Za-z0-9_.]+ /, "call ... ");
	if (categories [key] === undefined) {
		categories [key] = [];
		}
	categories [key].push (failure.script);
	});

fs.writeFileSync (pathReport, JSON.stringify ({ctOk, ctFailed, categories, failures}, undefined, "\t"));

console.log ("ran clean: " + ctOk + " of " + (ctOk + ctFailed));
Object.keys (categories).forEach (function (key) {
	console.log ("[" + categories [key].length + "] " + key + " -- e.g. " + categories [key] [0]);
	});
