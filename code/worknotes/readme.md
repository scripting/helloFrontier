# Claude's worknotes

### 10/6/26; 1:49:32 PM by CC

Packages, the way they came out of a day of trying them. new takes arguments now: scratchpad.feedland = new userlandSamples.socketClient (url) makes the instance and calls the package's init with the url, this set to the instance. A socket's callback can be the instance itself: inside init, tcp.websocket.open (url, this), and every message runs the instance's handleMessage. Calling a package by its own name tells you it's a package and names what it exports. exports is always there, so running a package script from its window works.

workspace.userlandSamples.socketClient is a sample package that listens to FeedLand and fills its instance's items table as stories arrive; it comes as a part.

### 10/5/26; 7:47:36 PM by CC

Packages. A script can be a package: it says what it exports the way a node module does, exports.init = init, one line per handler, and a caller runs an exported handler by name, socketClient.init (url). Handlers the script doesn't export can't be called from outside. new userlandSamples.socketClient () makes an instance, a table that remembers which package it came from; calling socketClient.init (url) on the instance runs the package's handler with this set to the instance, so the package keeps its data in the instance, where you can open it and watch it change.

Big outlines are quicker to work in. The window checked the whole outline for changes every 1.5 seconds, which on a 12,000-line outline stalled it for a tenth of a second each time; now it looks only after you've typed, pasted or changed something. The Zoom button on an outline is faster too.

The attribute editor is rebuilt to match the newest table editor from Dave's dialogs: the title, the Name and Value columns, wider boxes, OK and Cancel at the right and + at the left.

An include line shows an angle in place of its wedge.

tcp.websocket.getOpenSockets answers the ids of every open websocket, so a script can loop over them. The glue script comes in the tcp.websocket part.

### 10/5/26; 11:11:00 AM by CC

Fixes a bug in the menubar editor that could attach every command's script to the wrong menu item. If you deleted a line and opened a command's script in the same instant, the window saved twice at once and the second save shifted the scripts below the deleted line by one. If your menus have this, the scripts are still there, one line off.

Websockets. tcp.websocket.open connects to a server, keeps the connection up and runs the script you name for every message. tcp.websocket.listen takes connections on Frontier's own port, at a path you name. send, close, isOpen and broadcast round it out. Messages are strings. The glue scripts come as a part; run the updates to get them.

A bug Colin found: a local declared in one bundle leaked into a later bundle, so the startup script never opened your guest databases. Fixed the way Frontier does it: a local lives in the block that declares it, and a with looks in its table before the locals outside it.

Every line gets a created attribute as you move through an outline. An include line shows a share icon in place of its wedge.

Closing a table no longer closes the windows you opened from it.

Add Bookmark from a database's own window bookmarks the item under the cursor.

One version number in the corner of every window, the app's. The server's and the language's are in system.environment.

op.attributes.edit works when run from another script window.

Build instructions and backup instructions are in misc, buildInstructions.md and backupInstructions.md.

### 10/4/26; 11:51:46 AM by CC

Adds includes. Give a line two attributes, type with the value include, and url with the address of an OPML file. Expand the line and the outline at that url appears under it.

Adds an attribute editor. op.attributes.edit opens a dialog with the cursor line's attributes, where you can add, change and delete them. Put it in a menu.

Lines keep their attributes when saved.

Adds a way to switch an outline between formatted and source text: op.setHtmlFormatting and op.getHtmlFormatting. Works from a menu command; cmd-` doesn't reach the app, the Mac uses it to switch windows.

The glue scripts for the new verbs come as parts; run the updates to get them.

The Flickr API key is out of Flickr.init, as a part and in the shipped root.

Fixes: copying a folder with file.copy, deleting a folder with files in it, Jump to root, the wedge on blank lines, the cursor when double-clicking an address.

Known: op.attributes.edit fails when run from another script window. Every line should get a created attribute; not yet.

### 10/1/26; 7:48:00 PM by CC

No dialog at an ordinary launch; it comes up only at first launch or when a Tool installs.

Add Link in the HTML menu makes the selected text a link.

Esc stops a running script. So does cmd-period.

Double-clicking in the value column no longer beeps.

The log's daily databases are out of the Window menu, and the frontier.root window no longer lists a database opened after it.

Big outlines open faster, and Expand Everything is faster.
