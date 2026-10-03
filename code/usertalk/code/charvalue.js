/*  charvalue.js -- Frontier's char type, a real value in the language.

	Built 8/26/26 on DW's go-ahead, the way double became a boxed Number on
	8/19. A char is one byte carrying a character code, and the kernel
	defines every edge of it in langvalue.c:

		coercetolong takes the code, coercetostring takes the character
		(so valueOf and toString below make Number () and String () right
		without anyone knowing);

		coercetochar accepts a number 0 through 255, a boolean, nil (which
		becomes '0'), or a string exactly one character long (stringtochar);

		addvalue has the special case: two chars add into a two-character
		string, a char and a number add into a char, byte arithmetic
		wrapping the way a byte wraps.

	The evaluator and the verb library special-case chars where the kernel
	does; everything else coerces through valueOf and toString and keeps
	working without knowing the type exists.

	by CC, 8/26/26  */

function CharValue (theCode) {

	/*  9/14/26 by CC -- A CHAR CAN CARRY A CHARACTER BEYOND ONE BYTE. The
		kernel's char is a byte because its strings are bytes (MacRoman);
		Atlantis strings are Unicode, so a character read out of a string --
		s [i], string.nthChar -- can be a curly quote or an accented letter
		with a code above 255. Masking it to a byte made it the wrong
		character, and the number it coerced to was wrong with it: DW's
		xml.entityEncode wrote &#NaN; (before s [i] answered a char at all)
		and would have written &#25; for a right single quote. Now a code
		that fits a byte wraps the way a byte wraps, the kernel's arithmetic,
		and a code above 255 is kept whole.  */

	this.code = (theCode > 255) ? theCode : (theCode & 255);
	}

CharValue.prototype.flOdbChar = true; //so a module that can't require this one (frontierodb) still knows a char when it sees one

CharValue.prototype.valueOf = function () { //arithmetic and Number () take the code -- coercetolong's rule
	return (this.code);
	};

CharValue.prototype.toString = function () { //String () takes the character itself -- coercetostring's rule
	return (String.fromCharCode (this.code));
	};

CharValue.prototype.toJSON = function () { //crossing to a page or a log, a char reads as its character
	return (this.toString ());
	};

function makeChar (theCode) {
	return (new CharValue (theCode));
	}

function flCharValue (theValue) {
	return (theValue instanceof CharValue);
	}

module.exports = {makeChar, flCharValue};
