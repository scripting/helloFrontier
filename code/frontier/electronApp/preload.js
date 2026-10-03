/*  preload.js -- 8/12/26 by CC

	The one thing a window's page can ask the app itself to do.

	Everything else in a window is a plain web page talking to the server.
	But the server is a droplet in a data center, and a backup that lands
	there isn't a backup -- DW: "without backup i can't do anything, i know
	i will lose my work." So the app, which runs on his machine, writes the
	file.

	The page gets a small fixed set of functions and no more. windowGeometry
	(8/20/26) is here because window.getPosition and window.setPosition are
	about the window on the SCREEN -- shellgetglobalwindowrect in the kernel
	-- and only the app knows where its windows are. writeWholeFile
	names a FILE, never a location: the folder is the app's business, chosen
	once in a real Mac folder dialog and remembered. A script on the server
	can't aim a write anywhere on the disk, which is the same rule View
	follows. getFileDialog (8/16/26) is the other direction: the PERSON
	picks the file, in a real Mac dialog, so what crosses is only what they
	chose.  */

const {contextBridge, ipcRenderer} = require ("electron");

contextBridge.exposeInMainWorld ("odbDesktop", {
	writeWholeFile: function (theFilename, theText) { //answers the full path of the file it wrote
		return (ipcRenderer.invoke ("desktop.writeWholeFile", theFilename, theText));
		},
	getFileDialog: function (thePrompt, theStartPath) { //8/16/26 by CC -- file.getFileDialog's dialog; answers {flOk, colonPath}
		return (ipcRenderer.invoke ("desktop.getFileDialog", thePrompt, theStartPath));
		},
	putFileDialog: function (thePrompt, theStartPath, theDefaultName) { //8/17/26 by CC -- file.putFileDialog: where shall I save it
		return (ipcRenderer.invoke ("desktop.putFileDialog", thePrompt, theStartPath, theDefaultName));
		},
	getFolderDialog: function (thePrompt, theStartPath) { //8/17/26 by CC -- file.getFolderDialog: pick a folder
		return (ipcRenderer.invoke ("desktop.getFolderDialog", thePrompt, theStartPath));
		},
	windowGeometry: function (theAddress, theChange) { //8/20/26 by CC -- window.getPosition and its family; answers {flOpen, x, y, width, height, title}
		return (ipcRenderer.invoke ("desktop.windowGeometry", theAddress, theChange));
		},
	windowBehind: function () { //9/8/26 by CC -- window.frontmost from the Run button: what the window behind this one answers, or "" when there is none
		return (ipcRenderer.invoke ("desktop.windowBehind"));
		},
	popupMenu: function (theItems) { //9/10/26 by CC -- the title's path popup: labels in, the index chosen out, or -1
		return (ipcRenderer.invoke ("desktop.popupMenu", theItems));
		},
	zoomWindow: function () { //9/10/26 by CC -- a double-click on the title zooms, the way the title bar itself did
		return (ipcRenderer.invoke ("desktop.zoomWindow"));
		},
	moveWindowBy: function (dx, dy) { //9/13/26 by CC -- a drag on the title text moves the window (common.js installTitleStrip)
		ipcRenderer.send ("desktop.moveWindowBy", dx, dy);
		},
	resizeSelf: function (theWidth, theHeight) { //9/16/26 by CC -- the About window's flag: the page sets its own window's content size; 0 for the width keeps it
		return (ipcRenderer.invoke ("desktop.resizeSelf", theWidth, theHeight));
		},
	openQuickScriptWindow: function () { //9/16/26 by CC -- window.quickScript
		return (ipcRenderer.invoke ("desktop.openQuickScriptWindow"));
		},
	openAboutWindow: function () { //8/20/26 by CC -- window.about
		return (ipcRenderer.invoke ("desktop.openAboutWindow"));
		},
	localPassword: ipcRenderer.sendSync ("desktop.localPassword"), //8/15/26 by CC -- the desktop Frontier's own password, so no page ever shows the connect form; undefined everywhere else
	appVersion: ipcRenderer.sendSync ("desktop.appVersion") //8/15/26 by CC -- the number in the corner, from the app itself instead of parsed out of the user agent
	});
