/*  httphelper.js -- one HTTP request, run as a child process and waited on.

	8/31/26 by CC. UserTalk is synchronous and the network isn't; this is
	the seam, the same one s3helper.js cut for S3. The worker gets its HTTP
	from the server over the shared-memory channel; a headless run -- the
	in-process runner, the behavior gate, an agent of the gate's -- has no
	server to ask, so verbs.js spawns this and reads the answer.

	The request logic is COPIED from fetchOneResponse and fetchForScript in
	trigger/trigger.js -- the proven pair -- minus the server's own config
	and the public-address gate, which guards a server exposed to the web,
	not a script a person runs at their desk. When one changes the other
	should too.

	stdin: JSON {url, method, headers, data, milliseconds, ctFollowRedirects, flJustHeaders}
	stdout: JSON {text, statusCode, theUrl} or {message}  */

const http = require ("http");
const https = require ("https");

const maxHttpBytes = 32 * 1024 * 1024;

/*  9/27/26 by CC -- AN ANSWER THAT IS BYTES STAYS BYTES. The response body
	was decoded as UTF-8 whatever it was, so a png read with tcp.httpReadUrl
	came back with every byte past 127 changed, and the picture DW's sample
	posted from the web was an empty box on Bluesky. The Content-Type of
	the answer says which it is: an image, a sound, a video or an
	octet-stream is bytes, one character per byte, the way file.readWholeFile
	answers; everything else is text, UTF-8 as before. The other half of
	bodyBufferFor, which does the same for a request going out.  */

function textForResponseBody (theHeaders, theChunks) {
	var theType = "";
	Object.keys (theHeaders).forEach (function (theName) {
		if (theName.toLowerCase () === "content-type") {
			theType = String (theHeaders [theName]).toLowerCase ();
			}
		});
	const flBytes = (theType.indexOf ("image/") === 0) || (theType.indexOf ("audio/") === 0) || (theType.indexOf ("video/") === 0) || (theType.indexOf ("application/octet-stream") === 0);
	return (Buffer.concat (theChunks).toString (flBytes ? "latin1" : "utf8"));
	}

/*  9/26/26 by CC -- A BINARY BODY GOES OUT AS ITS BYTES. A request body
	arrives here as a JavaScript string: text, or the bytes of a binary
	value one character per byte (a png read with file.readWholeFile,
	on its way to Bluesky's uploadBlob). Written as UTF-8, every byte past
	127 became two, and the image was garbage at the far end. The
	Content-Type says which it is: an image, a sound, a video or an
	octet-stream is bytes; everything else is text, UTF-8 as before.  */

function bodyBufferFor (theHeaders, theData) {
	var theType = "";
	Object.keys (theHeaders).forEach (function (theName) {
		if (theName.toLowerCase () === "content-type") {
			theType = String (theHeaders [theName]).toLowerCase ();
			}
		});
	const flBytes = (theType.indexOf ("image/") === 0) || (theType.indexOf ("audio/") === 0) || (theType.indexOf ("video/") === 0) || (theType.indexOf ("application/octet-stream") === 0);
	return (Buffer.from (String (theData), flBytes ? "latin1" : "utf8"));
	}

function answer (theAnswer) {
	process.stdout.write (JSON.stringify (theAnswer), function () { //exit only after the pipe has drained -- an early exit truncates stdout
		process.exit (0);
		});
	}

function fetchOneResponse (theRequest, callback) { //callback (err, {statusCode, headerText, theBody, theHeaders})
	var theUrl;
	try {
		theUrl = new URL (theRequest.url);
		}
	catch (err) {
		callback ({message: "\"" + theRequest.url + "\" isn't a url."});
		return;
		}
	if ((theUrl.protocol !== "http:") && (theUrl.protocol !== "https:")) {
		callback ({message: theUrl.protocol + " isn't a protocol a script can read."});
		return;
		}
	const theModule = (theUrl.protocol === "https:") ? https : http;
	const theHeaders = Object.assign ({}, theRequest.headers);
	const flBody = (theRequest.data !== undefined) && (theRequest.data.length > 0);
	if (flBody) { //9/12/26 by CC -- DW's report, a verb that worked: uploadRss stopped at S3 with "A header you provided implies functionality that is not implemented." A body written with no Content-Length goes out chunked, and S3 refuses chunked uploads. The transport under tcp.httpClient drops the glue's Content-Length (parseHttpCommand), so it's set here, from the bytes actually sent
		var flHasLength = false;
		Object.keys (theHeaders).forEach (function (theName) {
			if (theName.toLowerCase () === "content-length") {
				flHasLength = true;
				}
			});
		if (!flHasLength) {
			theHeaders ["Content-Length"] = bodyBufferFor (theHeaders, theRequest.data).length; //9/26/26 by CC -- the bytes actually sent, see bodyBufferFor
			}
		}
	const theOptions = {
		method: theRequest.method,
		headers: theHeaders
		};
	const theClientRequest = theModule.request (theUrl, theOptions, function (theClientResponse) {
		const theChunks = [];
		var ctBytes = 0;
		var flStopped = false;
		theClientResponse.on ("data", function (theChunk) {
			ctBytes += theChunk.length;
			if (ctBytes > maxHttpBytes) {
				flStopped = true;
				theClientRequest.destroy ();
				callback ({message: "the answer from " + theUrl.hostname + " is bigger than " + maxHttpBytes + " bytes."});
				return;
				}
			theChunks.push (theChunk);
			});
		theClientResponse.on ("end", function () {
			if (flStopped) {
				return;
				}
			var headerText = "HTTP/" + theClientResponse.httpVersion + " " + theClientResponse.statusCode + " " + theClientResponse.statusMessage + "\r\n";
			Object.keys (theClientResponse.headers).forEach (function (theName) {
				const theValue = theClientResponse.headers [theName];
				if (Array.isArray (theValue)) {
					theValue.forEach (function (oneValue) {
						headerText += theName + ": " + oneValue + "\r\n";
						});
					}
				else {
					headerText += theName + ": " + theValue + "\r\n";
					}
				});
			callback (undefined, {
				statusCode: theClientResponse.statusCode,
				theHeaders: theClientResponse.headers,
				headerText,
				theBody: textForResponseBody (theClientResponse.headers, theChunks) //9/27/26 by CC -- bytes stay bytes, see textForResponseBody
				});
			});
		});
	theClientRequest.setTimeout (theRequest.milliseconds, function () {
		theClientRequest.destroy ();
		callback ({message: theUrl.hostname + " didn't answer within " + Math.round (theRequest.milliseconds / 1000) + " seconds."});
		});
	theClientRequest.on ("error", function (err) {
		callback ({message: err.message + "."});
		});
	if (flBody) {
		theClientRequest.write (bodyBufferFor (theHeaders, theRequest.data)); //9/26/26 by CC -- a binary body as its bytes
		}
	theClientRequest.end ();
	}

function fetchForScript (theRequest, callback) { //callback ({text, statusCode, theUrl} or {message})

	var ctRedirectsLeft = theRequest.ctFollowRedirects;

	function tryOne (theUrl) {
		fetchOneResponse (Object.assign ({}, theRequest, {url: theUrl}), function (err, theResult) {
			if (err !== undefined) {
				callback ({message: "Can't read " + theUrl + " because " + err.message});
				return;
				}
			const flRedirect = (theResult.statusCode >= 300) && (theResult.statusCode <= 308) && (theResult.theHeaders.location !== undefined);
			if (flRedirect && (ctRedirectsLeft > 0)) {
				ctRedirectsLeft--;
				tryOne (new URL (theResult.theHeaders.location, theUrl).toString ());
				return;
				}
			callback ({
				text: theRequest.flJustHeaders ? theResult.headerText : (theResult.headerText + "\r\n" + theResult.theBody),
				statusCode: theResult.statusCode,
				theUrl
				});
			});
		}

	tryOne (theRequest.url);
	}

var theInput = "";
process.stdin.on ("data", function (theChunk) {
	theInput += theChunk;
	});
process.stdin.on ("end", function () {
	var theRequest;
	try {
		theRequest = JSON.parse (theInput);
		}
	catch (err) {
		answer ({message: "the request couldn't be read -- " + err.message});
		return;
		}
	try {
		fetchForScript (theRequest, answer);
		}
	catch (err) {
		answer ({message: err.message});
		}
	});
