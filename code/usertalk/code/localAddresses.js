/*  localAddresses.js -- the address of a LOCAL table, kept good while it sits in the database.

	9/21/26 by CC, for the Manila work. In the kernel an address is a table
	handle and a name, so the address of a local table is a real address: it
	can be put in any table and it leads to the local for as long as the local
	lives. mainResponder does exactly that on every request --
	html.setPageTableAddress stores the address of the request's param table, a
	local of the server's frame, in system.temp.pageTableAddresses, and every
	macro and every Manila script finds its page table there.

	Here the database is rows of text, and an address went in as its path:
	"paramTable". It came back leading nowhere.

	So an address whose target is a table that is NOT in the database goes in
	as a token, and the running address is remembered here under that token.
	Read back in the same process, the token answers the running address.
	Read in another process, or after this one ends, it answers an address
	that leads to nothing -- a dangling address, which is what the kernel
	would have too.  */

const thePrefix = "(local table) "; //no address text begins this way
const theRegistry = new Map ();
const maxRemembered = 5000; //a server that runs for weeks doesn't keep every request's param table alive
var ctRegistered = 0;

function flLocalTableAddress (theValue) { //an address made at runtime whose target is a table outside the database
	if ((theValue === undefined) || (theValue === null) || (theValue.flAddress !== true) || (theValue.reference === undefined)) {
		return (false);
		}
	var theTarget;
	try {
		theTarget = theValue.reference.get ();
		}
	catch (err) {
		return (false);
		}
	if ((theTarget === undefined) || (theTarget === null) || (typeof theTarget !== "object")) {
		return (false);
		}
	if ((theTarget.flOdbSqlTable === true) || Array.isArray (theTarget) || (theTarget instanceof Date) || (theTarget instanceof Number)) {
		return (false);
		}
	if ((theTarget.flOdbScript === true) || (theTarget.flOdbMenubar === true) || (theTarget.flWpText === true) || (theTarget.flAddress === true) || (theTarget.flOdbAddressText === true) || (theTarget.flFilespec === true) || (theTarget.flCharValue === true) || (typeof theTarget.type === "string")) {
		return (false); //a value that is an object here, not a table
		}
	return (true);
	}

function register (theAddress) { //the token to store
	ctRegistered++;
	const theToken = thePrefix + process.pid + "." + ctRegistered + " " + String (theAddress.pathText);
	theRegistry.set (theToken, theAddress);
	if (theRegistry.size > maxRemembered) {
		theRegistry.delete (theRegistry.keys ().next ().value); //the oldest
		}
	return (theToken);
	}

function flToken (theText) {
	return ((typeof theText === "string") && (theText.indexOf (thePrefix) === 0));
	}

function lookup (theToken) { //the running address, or undefined when it is gone
	return (theRegistry.get (theToken));
	}

module.exports = {flLocalTableAddress, register, flToken, lookup};
