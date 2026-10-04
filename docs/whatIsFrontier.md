# What I was taught about Frontier

*Written by Claude, the AI that ported Frontier to Node with Dave Winer between July and October 2026. This is my own account of what I learned: what Frontier is, how it works, how the port (Atlantis, in the app called Electric Frontier) is built, and how to work on it without breaking what makes it Frontier. It is written for any AI that picks this up next, and for the people who will read it alongside the code. Nothing here is Dave's voice except where I quote him; the judgments are mine.*

## 1. What Frontier is

Frontier is a scripting environment with an object database at its center and an outliner as its editor. Those two sentences carry most of what took me weeks to understand, so I'll unpack them.

**The database is the namespace.** Every script, every table, every piece of data a program uses lives in one hierarchical object database, the root, and is reached by a dotted address: `system.verbs.builtins.string.padWithZeros`, `user.prefs.initials`, `workspace.notepad`. There is no file system of source files behind the scenes. When a script says `string.padWithZeros (x, 3)`, the name is looked up in the database, the script stored there is called, and its answer comes back. The database is the program.

**Scripts are outlines.** A script is not a text file; it is an outline, and structure in the outline is structure in the code. A line is a statement; the lines indented under it are its body. There are no braces to close, no `end` keywords, because the outline is the block structure. A line can be a comment (greyed, ignored by the compiler); the parts under a comment are comments too. People who write Frontier code think in the outline: collapse what you are not working on, expand what you are.

**UserTalk is the language.** It reads like JavaScript's older cousin: `local`, `if`, `else`, `loop`, `for`, `bundle` (a block that exists only to be collapsible), `on name (params)` for a handler, `return`. Values have types: string, number, boolean, date, address, table, outline, script, binary, and more. A table is both a record and a directory: `t.a = 1` writes into it, and a table in the database is a folder of the namespace. An address, written `@system.verbs.builtins`, is a pointer into the database, and `adr^` dereferences it.

**The outliner is everywhere.** Tables open in outline windows (one row per entry: name, value, kind). Scripts open in outline windows. Menubars are outlines, with each command's script attached to its line. The one editor edits everything.

**Everything is scriptable.** Menu commands run scripts. The built-in verbs are scripts that call into the kernel. Agents are scripts that run on a schedule. A web server is a script that answers requests. When the person using Frontier wants something different, they open the script and change it.

Dave's two rulings that define the bar for the port: *"it has to BE frontier, not LIKE frontier"* and *"the existing feature set IS the spec."*

## 2. The kernel is the source of truth

Frontier's original implementation is the C kernel, released under the GPL in 2004 and carried forward by Ted Howard (tedchoward/Frontier on GitHub; the 2011 code is what we read). When there is a question about what Frontier does, the answer is in the C, not in anyone's memory, including Dave's. He said so himself, more than once: *"that's not proof. what does the actual kernel code return. read the C code."*

Where to look, by subsystem, under `Common/source/`:

1. The language: `langparser.y` (grammar), `langevaluate.c` (evaluator), `langvalue.c` (values, coercion, how a stored script's handler is chosen), `langhash.c` (tables, the scope chain), `langscan.c` (tokenizer).
2. Name lookup: `langsearchpathlookup` -- the local chain, then the root, then `system.paths` in order, then open guest databases.
3. The outliner: `op*.c`; `oppack.c` is the packed outline format.
4. Tables: `table*.c`, `tablepack.c`.
5. Menubars: `menupack.c`, `menuverbs.c`.
6. Window verbs: `shellwindowverbs.c`.
7. Dialogs: `langdialog.c`.
8. The database file: `db.c`, `dbinternal.h`, `cancoon.c`.
9. The About window and its message line: `about.c` (`ccmsg`).
10. Every kernel verb the language dispatches, by name: `Common/resources/Mac/kernelverbs.r`.

The C files are MacRoman text; a grep that mysteriously finds nothing wants `grep -a`.

The habit this builds: before proposing any verb, any name, any behavior, look in `kernelverbs.r`, then the C, then the scripts in the root. Frontier has been around since 1988; it already has a name for what you are about to invent. I proposed `op.toggleSourceMode` for switching an outline between rendered and source text; Frontier has had `op.setHtmlFormatting` and `op.getHtmlFormatting` since version 7, and the menu command that calls them was already in the database. Dave: *"you were about to reinvent something that is already defined. that's why we do this METHODICALLY."*

## 3. The vocabulary

Use Frontier's words. They are precise, and the people who know Frontier hear a wrong word instantly.

- **The root**: the main database, `frontier.root` (the file) and the top table in it. Never "the seed", even if a file is named that way in a build script.
- **Guest database**: another `.root` file opened alongside the root; its top-level names join the lookup.
- **Tools**: guest databases in the Tools folder that install a suite into the root at launch and own a menu.
- **Table, script, outline, wp-text, menubar**: the kinds of objects.
- **Scalar**: a value that is not a table or an external (string, number, boolean, date, address...). Not "primitive".
- **Verb**: a callable name. A built-in verb is a *glue script* in `system.verbs.builtins` that calls the kernel; a UserTalk verb is a full implementation, never "just a script".
- **Handler**: `on name (params)` inside a script. Calling a stored script runs the handler whose name matches the call.
- **Agent**: a script in `system.agents` that the scheduler runs on its own, in the background.
- **Thread**: a script started with `thread.callScript`, running on its own alongside the caller.
- **Fat page**: Frontier's export format for an object, a text file wrapping the packed object in base64, with directives saying where it belongs.
- **Part**: a fat page released as an update.
- **Jump**: the command that opens a window on an address you type.
- **The About window**: the main window, with the message line that `msg ()` writes to.
- **Address**: `@a.b.c`, a pointer into the database; `adr^` is what it points to.
- **Target**: the object the op verbs operate on when no window is in front; set with `target.set`.

Errors are sentences in the form *"Can't do x because y."* -- with the names and values involved, in these words. A raw JavaScript message reaching the user is a bug.

## 4. How a name is found

This is the part of Frontier that is hardest to see from outside and most important to get right.

When a script says `foo.bar`, the lookup walks, in order:

1. The script's local variables, then the enclosing scripts' locals.
2. The root, as the global symbol table.
3. The name `root` itself, which means the root table.
4. Each table named in `system.paths`, in sorted order. This is how `string.padWithZeros` is found: `system.paths` names `system.verbs.builtins`, and `string` is a table there.
5. The open guest databases.

The search takes the *first* table with the right name and looks the rest of the address up in that table. It does not go on to the next candidate if the rest isn't found. That rule bit us: a JavaScript verb group named `menus.something`, placed in a table ahead of `system.menus` in the paths, hid all twenty-six scripts of the real `system.menus`. The port carries a sweep (`shadowSweep.js`) that reports any JavaScript verb group standing in front of a real table.

Two consequences worth stating plainly:

- Assigning to an undeclared name inside a script makes a **local** in that script's frame. It does not create a root entry. (The kernel's comment: "undeclared variables assumed to be local".)
- A stored script's **last compiled code** is what runs when it is called, until it is compiled again. Editing the text in a window changes the text, not the code; the Run button and Compile link the window's text when it parses. Dave's rule: *"autosave is not the same thing as compile."*

And one more rule from `langgetentrypoint`: when a stored script is called by name, only the handler whose name matches the call runs. Loose code at the top level of the script -- the test line a programmer leaves at the bottom -- runs only when the person runs the script from its window, or when no handler matches.

## 5. The port: Atlantis, and the app Electric Frontier

Atlantis is Frontier on Node. Electric Frontier is the desktop app that wraps it in Electron. The pieces:

1. **usertalk** -- the language. `parse.js` turns an outline into statements; `evaluate.js` runs them; `verbs.js` is the JavaScript library the glue scripts call into through `kernel (x.y)`; `odbSql.js` is the object database on SQLite; `odbHome.js` reads `.root` files.
2. **odb** (the frontierOdb package) -- reads and writes Frontier's own binary formats: `.root` files and fat pages, byte for byte, so a 2012 database opens here and an object exported here opens there.
3. **frontier** (the trigger folder) -- `trigger.js` is the server: the database connection, the HTTP endpoints the windows and the agents use; `runnerWorker.js` runs a script on a worker thread with the window verbs; `odbBrowser/` is the pages that are the windows; `electronApp/` is the desktop wrapper; `misc/` holds the build script and the gates.
4. **concord** -- Dave's outliner in JavaScript, which the pages load. It is used as it is; the pages add behavior around it.

The database is one SQLite file, rows in an `odb` table by id and parent id, one row per object, the value as JSON. `frontier.root` as shipped is built from the 2012 OPML Editor distribution plus only the additions Dave has ruled on; the list is written down (`misc/frontierRootChanges.md`). Nothing is harvested from his own working database into the shipping root. Once built, nothing is ever written back to a `.root` file: the database is the truth.

**There is no verb table in front of the database.** A name resolves as an address or it does not exist. The only door into the JavaScript verb library is `kernel (x.y)` inside a glue script that anyone can open and read -- exactly the shape the C kernel has, where glue scripts in the database call `kernel (verb)`.

**Two processes, one database.** The server opens the database at startup; every interactive run spawns a worker that opens its own connection. The database layer caches rows, and a cached miss is remembered, so the server asks SQLite's `data_version` at the end of a run and at the top of every request to learn whether another connection wrote.

**Windows are web pages; window verbs cross a channel.** A script that calls `op.getLineText ()` or `dialog.ask (...)` is running on a worker thread. The verb posts its question to the server, the server hands it to the page that is the window, the page does the thing with Concord and answers, the server wakes the worker. The worker blocks on `Atomics.wait` meanwhile, so a dialog stops the script and nothing else. From outside, through the plain `/run` endpoint, the window verbs look like stubs; through `/run?interactive=1` -- the path the Run button uses -- they are real.

**Threads and agents.** `thread.callScript` starts a worker of its own and the caller goes on. A thread started from a window keeps that window, and keeps it after the run that started it ends. Agents run once a second, on their own workers, with no window; a verb that needs to ask the user something fails in an agent with a message that says so. `msg ()` from a one-shot process (a run, a thread, a startup script) is a foreground message on the About window's line; an agent's is a background message, filed under the agent's name -- the kernel's `ccmsg` rule, and the port follows it.

**Menus.** The app's native menus are built from menubars in the database: `system.menus.menubar` (Outliner, HTML, Misc), `user.menus.customMenu`, the bookmarks menu, each Tool's menu. A menu item runs its script in the front window, dialogs and all. A menu title that starts with `=` is an expression evaluated for the title.

**The desktop app** carries a whole Frontier: the server, the interpreter, the pages, Concord, with `node_modules` built for Electron's engine; it launches the server with Electron's own binary, so there is nothing to install. Everything writable -- config, database, rendered files -- lives in the app's data folder (`Library/Application Support/Electric Frontier`), seeded from the bundled root at first launch. Installing a new version over the old one never touches the database.

## 6. Where the port deviates, knowingly

Not everything has been built, and a few things are decided differently. These are the ones I know; the list in `misc/todo.opml` is the live one.

- No debugger yet. The Debug button in a script window does nothing. Outline-based `console.log` to a window stands in, except from agents.
- `system.environment.isOpmlEditor` is false and `isAtlantis` is true. Scripts in the 2012 root that run only when `isOpmlEditor` is true -- `mainResponder.startup` among them -- don't run, so the OPML Editor's web-based Preferences, Settings and Tool Catalog commands fail in a fresh database. His call, still open.
- Hoist and De-Hoist in the Outliner menu are not implemented.
- A few window verbs answer politely rather than doing the thing (`op.setDisplay` -- the page's display is always on).
- The Window menu leaves out the log's daily databases; the kernel lists hidden windows in italics. Dave's ruling.
- Fat pages written here carry the lines of an outline but not, yet, the attributes on them.

When something here differs from the kernel and no ruling says so, the port is wrong, not the kernel.

## 7. How changes ship

Two gates, and nothing ships that fails either:

1. `node misc/compileAll.js data/seed.db` -- every script in the database parses (a known baseline of scripts from 2012 that never parsed is expected).
2. `node misc/testBehavior.js data/seed.db` -- runs things against a copy of the database, headless: make a table, put scripts in it, close, reopen, check. Every bug fixed gets a test here first, failing before the fix and passing after.

Plus six server gates that each start a real server on a copy: the server survives a half-typed agent; an agent calls a script as it is now; the op verbs on a target with no window; the Tools install and are never reinstalled over edits; the web server listens and serves; threads.

Changes inside the database ship as **parts** on Dave's codecasting feed (an RSS feed of fat pages); a script in every installed root, `rootUpdates.update`, reads the feed and installs what is new. `frontier.root` as shipped stays the same until a release, and before a release the updates are run into it. Nobody is told to run an update by hand; the feed carries only what Dave released, when he decided.

Versions live in four places and show in the corner of every window: `trigger.js` (first line), `usertalk/package.json`, `odb/package.json`, `electronApp/package.json`.

## 8. How to work on it

These are the rules that made the work go, in the order they were learned. They are about Frontier as much as about Dave.

1. **Search the database before writing anything.** It is full of working suites written over twenty-five years -- menus, states, console, fatPages, s3. The thing you are about to write probably exists. A verb written in UserTalk is a full implementation.
2. **New functionality goes in UserTalk.** Move something into JavaScript (kernelize it) only where UserTalk can't do it, and then leave the whole UserTalk under a Changes note saying it was kernelized, with the `kernel (...)` call below.
3. **Read the C first.** For what a verb does, what a window answers, what a value coerces to. Reasoning from the scripts is not proof.
4. **One thing at a time, slowly.** Build the case that was asked for and not the one next to it. A remark about a neighboring case is not an order to build it.
5. **Never add UI nobody asked for**, and once a feature is in it can't be removed or changed without a ruling.
6. **Report what the user sees.** A change is described in terms of what the app does -- which window, which menu, what happens -- not which function changed. The only thing worth surfacing from inside an implementation is impossibility.
7. **A verb that worked and stopped working is a fire alarm.** It goes at the top of the report, alone, the moment it is seen.
8. **Call out by address anything changed that the person could also edit** -- objects in the database, source they edit.
9. **Errors read "Can't do x because y."** in Frontier's words.
10. **Check the fact before raising it.** Compare the two scripts before calling them the same. Read the function before saying it compiles. If something isn't checked, say "not checked" in the same sentence.
11. **A review is a review.** Findings stay in the reply; they don't become tasks on someone else's list.
12. **The list is the memory.** Everything asked for goes on the list at the time it is said, in the words it was said in.

And the one that took longest to learn: Frontier is not a scripting language you run from the command line. For a while I was building a thing that read scripts from files and ran them, and it took Dave a long time to see that was where it was going -- *"this isn't Frontier folks. this is not what we do."* Frontier is the running environment: the database open, the windows up, the agents going, the menus live, and you, inside it, editing a script in an outline and running it with a keystroke. Everything in this port serves that.

## 9. The sources this was written from

My working notes, which are not public and are written to Dave, not to a reader: the project's `CLAUDE.md`, `misc/handoff.md` (the running record, newest first), `worknotes.md` (every batch, in detail), and my own memory files. The facts above are drawn from them; the words are mine.
