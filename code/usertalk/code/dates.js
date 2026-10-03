/*  dates.js -- Frontier's date-and-time text forms, in one place.
	
	The shapes come from the kernel, read 8/13/26, not from memory:
	timedatestring in strings.c renders a date value as a string -- short
	date, a separator, time with seconds -- which is why DW's Changes
	entries read "8/11/26; 5:09:47 PM by DW" (his timeStamp script shortens
	the year). string.dateString is the longDate form -- his own script's
	comment carries one: "Saturday, December 30, 2000 at 10:42:56 AM".
	string.timeString is TimeString with seconds.
	
	Shared by verbs.js and evaluate.js, so a date reads the same wherever
	it becomes text.
	
	by CC, 8/13/26  */

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function padTwo (theNumber) {
	return ((theNumber < 10) ? "0" + theNumber : String (theNumber));
	}

function frontierTimeString (theDate) { //"11:14:22 AM"
	var hours = theDate.getHours ();
	const ampm = (hours < 12) ? "AM" : "PM";
	hours = hours % 12;
	if (hours === 0) {
		hours = 12;
		}
	return (hours + ":" + padTwo (theDate.getMinutes ()) + ":" + padTwo (theDate.getSeconds ()) + " " + ampm);
	}

function frontierShortDateString (theDate) { //"8/13/2026"
	return ((theDate.getMonth () + 1) + "/" + theDate.getDate () + "/" + theDate.getFullYear ());
	}

function frontierLongDateString (theDate) { //"Thursday, August 13, 2026"
	return (dayNames [theDate.getDay ()] + ", " + monthNames [theDate.getMonth ()] + " " + theDate.getDate () + ", " + theDate.getFullYear ());
	}

function frontierDateToString (theDate) { //"8/13/2026; 11:14:22 AM" -- what a date looks like as a string
	return (frontierShortDateString (theDate) + "; " + frontierTimeString (theDate));
	}


/*  8/17/26 by CC -- Frontier counts time in SECONDS SINCE 1 JANUARY 1904,
	the Mac's own epoch (the kernel's timedate.c: "time in seconds since
	12:00 AM 1904"). JavaScript counts milliseconds since 1970. DW found the
	difference benchmarking -- number (clock.now ()) answered 1786983327465
	here and would answer a number about a thousand times smaller on
	Berkeley. These two turn a date into the number Frontier means, and
	back.  */

const ctSecondsFrom1904To1970 = 2082844800; //66 years, 17 of them leap

function frontierDateFromString (theText) {

	/*  8/24/26 by CC -- the other direction of frontierDateToString: the
		kernel's own date text, "8/23/2026; 10:30:45 PM", back into a date.
		JavaScript's Date can't read the semicolon form, so date () of a
		date the product itself displayed quietly failed, and the date part
		verbs of it answered the current time. The date part alone works
		too, and anything else falls back to what JavaScript can read.  */

	const theMatch = String (theText).trim ().match (/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*;\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
	if (theMatch === null) {
		return (new Date (theText));
		}
	const theMonth = Number (theMatch [1]);
	const theDay = Number (theMatch [2]);
	var theYear = Number (theMatch [3]);
	if (theYear < 100) {
		theYear += (theYear < 37) ? 2000 : 1900; //the kernel's century window
		}
	var theHour = (theMatch [4] === undefined) ? 0 : Number (theMatch [4]);
	const theMinute = (theMatch [5] === undefined) ? 0 : Number (theMatch [5]);
	const theSecond = (theMatch [6] === undefined) ? 0 : Number (theMatch [6]);
	if (theMatch [7] !== undefined) {
		const flPm = theMatch [7].toUpperCase () === "PM";
		if (flPm && (theHour < 12)) {
			theHour += 12;
			}
		if (!flPm && (theHour === 12)) {
			theHour = 0;
			}
		}
	return (new Date (theYear, theMonth - 1, theDay, theHour, theMinute, theSecond));
	}

function frontierSecondsFromDate (theDate) {
	return (Math.floor (theDate.getTime () / 1000) + ctSecondsFrom1904To1970);
	}

function dateFromFrontierSeconds (theSeconds) {
	return (new Date ((Number (theSeconds) - ctSecondsFrom1904To1970) * 1000));
	}

module.exports = {frontierTimeString, frontierShortDateString, frontierLongDateString, frontierDateToString, frontierDateFromString, frontierSecondsFromDate, dateFromFrontierSeconds, ctSecondsFrom1904To1970};
