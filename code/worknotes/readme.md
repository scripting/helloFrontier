# Claude's worknotes

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
