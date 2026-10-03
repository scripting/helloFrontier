/*  tableedit.js -- the kernel's rules for editing a table cell's value,
	mirrored from tablegetwpedittext in tableedit.c.

	What the person typed into the value column is RUN as a script in the
	table's context. If the run answers something usable, that's the new
	value. If it doesn't, and the old value wasn't a string, the text is
	tried again wrapped in quotes -- that's how a bare word becomes a
	string. Whatever comes out is coerced to the OLD value's type, so a
	number cell stays a number cell; a cell that never had a value
	(novalue) takes the new value's own type. A coercion that can't be
	done means no change at all -- the kernel beeps there, and the caller
	should too.

	Which cells are editable is tablecelliseditable's rule: names always,
	values only when the value is a scalar -- never an external (table,
	script, outline, wptext, menubar), never code.

	The caller supplies the two callbacks that touch the language, so this
	module has no dependencies and the behavior gate can test the rules
	directly:

		evaluateText (theText) -- run the text in the table's context,
			answer the value, throw on a compile or runtime error.
		coerceText (theExpression, theSeedValue) -- run a one-verb
			coercion like "string (ccCellValue)" with the seed value bound
			to ccCellValue, answer the value, throw when the language
			can't coerce.

	by CC, 8/27/26  */

const editableScalarTypes = {
	string: true, number: true, boolean: true, date: true, char: true,
	list: true, address: true, novalue: true
	};

function flCellEditable (theType) { //tablecelliseditable's valuecolumn rule, by row type
	return (editableScalarTypes [theType] === true);
	}

function flResultUsable (theValue) { //the kernel refuses externalvaluetype as an edit result
	if ((theValue === undefined) || (theValue === null)) {
		return (false);
		}
	if ((typeof theValue === "object") && ((theValue.flOdbSqlTable === true) || (theValue.flOdbScript === true) || (theValue.flOdbMenubar === true) || (theValue.flWpText === true))) {
		return (false);
		}
	return (true);
	}

function quotedText (theText) { //the kernel's 2.1b2 retry: the same text with quotes around it
	return ("\"" + String (theText).replace (/\\/g, "\\\\").replace (/"/g, "\\\"") + "\"");
	}

const coercionVerbs = { //how each row type asks the language to coerce -- the product's own rules, not JavaScript's
	string: "string (ccCellValue)",
	number: "number (ccCellValue)",
	boolean: "boolean (ccCellValue)",
	date: "date (ccCellValue)",
	char: "char (ccCellValue)",
	address: "address (ccCellValue)"
	};

function editCellValue (params) {

	/*  params: {oldType, theText, evaluateText, coerceText}
		answers: {flChanged, theValue} -- flChanged false means leave the
		cell alone; throws with a message when the edit can't be done.  */

	const oldType = params.oldType;
	const theText = String (params.theText);

	if (!flCellEditable (oldType)) {
		const message = "Can't edit the value because it's a " + oldType + ", not a scalar.";
		throw new Error (message);
		}

	if ((theText.length === 0) && (oldType !== "string") && (oldType !== "novalue")) {
		return ({flChanged: false}); //empty text on a typed cell is not an assignment
		}

	var theCandidate;
	var flHaveCandidate = false;

	try {
		const theResult = params.evaluateText (theText);
		if (flResultUsable (theResult) && (theText.length > 0)) {
			theCandidate = theResult;
			flHaveCandidate = true;
			}
		}
	catch (err) {
		}

	if (!flHaveCandidate && (oldType !== "string") && (theText.length > 0)) { //the quoted retry
		try {
			const theResult = params.evaluateText (quotedText (theText));
			if (flResultUsable (theResult)) {
				theCandidate = theResult;
				flHaveCandidate = true;
				}
			}
		catch (err) {
			}
		}

	if (!flHaveCandidate) {
		theCandidate = theText; //the raw text, as a string -- the kernel's setheapvalue fallback
		}

	if ((oldType !== "novalue") && (coercionVerbs [oldType] !== undefined)) {
		var theCoerced;
		try {
			theCoerced = params.coerceText (coercionVerbs [oldType], theCandidate);
			}
		catch (err) {
			const message = "Can't set the value because \"" + theText + "\" can't be made into a " + oldType + ".";
			throw new Error (message);
			}
		if ((oldType === "number") && ((typeof theCoerced !== "number") || isNaN (theCoerced))) {
			const message = "Can't set the value because \"" + theText + "\" can't be made into a number.";
			throw new Error (message);
			}
		if ((oldType === "date") && (!(theCoerced instanceof Date) || isNaN (theCoerced.getTime ()))) {
			const message = "Can't set the value because \"" + theText + "\" can't be made into a date.";
			throw new Error (message);
			}
		theCandidate = theCoerced;
		}

	if (oldType === "list") { //no coercion verb -- the run had to answer a list
		if (!Array.isArray (theCandidate)) {
			const message = "Can't set the value because \"" + theText + "\" isn't a list.";
			throw new Error (message);
			}
		}

	return ({flChanged: true, theValue: theCandidate});
	}

module.exports = {editCellValue, flCellEditable};
