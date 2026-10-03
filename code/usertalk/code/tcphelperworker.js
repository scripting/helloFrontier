/*  tcphelperworker.js -- the socket owner for a HEADLESS run: the behavior
	gate, the in-process runner, compileAll. A script on the server's worker
	thread gets its sockets from the server; a headless script has no
	server, so verbs.js starts this thread and talks to it over shared
	memory, the same stop-and-wait as a dialog.

	9/3/26 by CC. The protocol is trigger.js's answerTheWorker, turned
	around: the script's thread posts a request and Atomics.waits on
	control [0]; this thread answers into the data window, stores the byte
	count in control [1], sets control [0] to 1 and notifies.

	No listener can run here -- a listener's callback needs a server to run
	it as a process -- so a listen request is refused with the reason.  */

const {parentPort, workerData} = require ("worker_threads");
const tcpstreams = require ("./tcpstreams.js");

const theControl = new Int32Array (workerData.sharedControl);
const theData = new Uint8Array (workerData.sharedData);

const theOwner = tcpstreams.makeStreamOwner ({
	flAllowNetwork: workerData.flAllowNetwork,
	folderTemp: workerData.folderTemp
	});

parentPort.on ("message", function (theRequest) {
	theOwner.handle (theRequest, function (theAnswer) {
		var theBytes = Buffer.from (JSON.stringify (theAnswer), "utf8");
		if (theBytes.length > theData.byteLength) {
			theBytes = Buffer.from (JSON.stringify ({message: "Can't deliver the answer because it's " + theBytes.length + " bytes and only " + theData.byteLength + " fit through this channel."}), "utf8");
			}
		theData.set (theBytes);
		Atomics.store (theControl, 1, theBytes.length);
		Atomics.store (theControl, 0, 1);
		Atomics.notify (theControl, 0);
		});
	});
