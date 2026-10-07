/*  Parse UserTalk into an AST. The grammar is langparser.y from the
	Frontier kernel; the input is outline-structured code -- each line is
	one statement or block header, its children are its block. There are
	no braces.
	
	Precedence, from the yacc declarations, loosest first:
	, then = (assign) then or then and then == != then < > <= >=
	beginswith endswith contains then + - then * / mod then not then
	++ -- unary-minus @ then ^ then .
	
	by CC, 7/27/26 */

const charvalue = require ("./charvalue.js");

const keywords = [
	"if", "else", "loop", "fileloop", "in", "break", "return", "bundle",
	"local", "global", "on", "while", "case", "kernel", "for", "to",
	"downto", "continue", "with", "try", "and", "or", "not",
	"beginswith", "endswith", "contains", "mod"
	];

function tokenize (theText) {
	
	const tokens = [];
	var ix = 0;
	
	function error (message) {
		var lineText = theText.replace (/[\r\n]/g, " ").trim ();
		if (lineText.length > 80) {
			lineText = lineText.substring (0, 80) + "...";
			}
		throw new Error ("Can't tokenize the line \"" + lineText + "\" because " + message);
		}
	
	function describeCharacter (theCharacter) {
		
		/*  8/14/26 by CC -- an invisible character in a line cost DW a
			morning: the dialog quoted it raw, which renders as a blank, so
			nobody could see what the tokenizer was objecting to. Name the
			codepoint, and the common invisibles by name.  */
		
		const theCode = theCharacter.codePointAt (0);
		const codeText = "U+" + theCode.toString (16).toUpperCase ().padStart (4, "0");
		if (theCharacter === "\n") {
			return (codeText + " (a line break)");
			}
		if (theCharacter === "\r") {
			return (codeText + " (a carriage return)");
			}
		if (theCode === 160) { //non-breaking space
			return (codeText + " (a non-breaking space)");
			}
		if ((theCode < 32) || (theCode === 127)) {
			return (codeText + " (an invisible control character)");
			}
		return ("\"" + theCharacter + "\" (" + codeText + ")");
		}
	
	while (ix < theText.length) {
		
		const ch = theText.charAt (ix);
		
		if ((ch === " ") || (ch === "\t")) {
			ix++;
			continue;
			}
		
		if (ch === "«") { //left chevron, comment to matching right chevron or end of line
			const ixEnd = theText.indexOf ("»", ix); //right chevron
			if (ixEnd === -1) {
				break;
				}
			ix = ixEnd + 1;
			continue;
			}
		
		if ((ch === "/") && (theText.charAt (ix + 1) === "/")) { //line comment, rest of line
			break;
			}
		
		if (ch === "´") { //acute accent, the older Frontier line comment, rest of line
			break;
			}
		
		/*  8/21/26 by CC -- TYPOGRAPHIC QUOTES OPEN A STRING TOO. Five scripts in
			the seed are written with them, and they're the natural way to hold a
			straight quote without escaping it:
			
				local (quote = “\"”)
				if string.hasSuffix (“\"]”, adr)
			
			A curly open quote closes on the curly CLOSE quote, not on itself,
			which is the one way this differs from " and '.  */
		
		if ((ch === "\"") || (ch === "'") || (ch === "“")) { //left double quotation mark
			const chCloses = (ch === "“") ? "”" : ch; //right double quotation mark
			var literal = "";
			ix++;
			while (ix < theText.length) {
				const chString = theText.charAt (ix);
				if (chString === chCloses) {
					break;
					}
				if (chString === "\\") {
					ix++;
					const chEscaped = theText.charAt (ix);
					switch (chEscaped) {
						case "n":
							literal += "\n";
							break;
						case "r":
							literal += "\r";
							break;
						case "t":
							literal += "\t";
							break;
						default:
							literal += chEscaped;
							break;
						}
					}
				else {
					literal += chString;
					}
				ix++;
				}
			if (ix >= theText.length) {
				error ("a string that starts with " + ch + " never closes.");
				}
			ix++;

			/*  8/26/26 by CC -- a single-quoted ONE-CHARACTER literal is a
				char, the kernel's parsepopcharconst (langscan.c): 'a' is a
				character constant, and 'abcd' is a four-character type code
				(an ostype in the kernel; here the codes are text, the 8/24
				typeOf decision, so it stays a string). Double quotes always
				make strings.  */

			if ((ch === "'") && (literal.length === 1)) {
				tokens.push ({type: "char", value: literal.charCodeAt (0)});
				continue;
				}
			tokens.push ({type: "string", value: literal});
			continue;
			}
		
		if ((ch >= "0") && (ch <= "9")) {
			var number = "";
			while ((ix < theText.length) && (/[0-9.xXa-fA-F]/.test (theText.charAt (ix)))) {
				if ((theText.charAt (ix) === ".") && !(/[0-9]/.test (theText.charAt (ix + 1)))) {
					break; //a dot not followed by a digit belongs to a path, not this number
					}
				number += theText.charAt (ix);
				ix++;
				}
			tokens.push ({type: "number", value: Number (number)});
			continue;
			}
		
		if (/[A-Za-z_]/.test (ch)) {
			var word = "";
			while ((ix < theText.length) && (/[A-Za-z0-9_]/.test (theText.charAt (ix)))) {
				word += theText.charAt (ix);
				ix++;
				}
			const lower = word.toLowerCase ();
			const wordOperators = { //8/11/26 by CC -- Frontier's spelled-out comparisons; runSelection says "if origwindow equals """
				equals: "eq", notequals: "ne",
				greaterthan: "gt", lessthan: "lt",
				greaterthanequals: "ge", lessthanequals: "le"
				};
			if (wordOperators [lower] !== undefined) {
				tokens.push ({type: wordOperators [lower], word});
				}
			else if (keywords.indexOf (lower) !== -1) {
				tokens.push ({type: lower, word});
				}
			else {
				if (lower === "true") {
					tokens.push ({type: "boolean", value: true});
					}
				else {
					if (lower === "false") {
						tokens.push ({type: "boolean", value: false});
						}
					else {
						if (lower === "infinity") {
							tokens.push ({type: "number", value: Infinity});
							}
						else {
							tokens.push ({type: "id", name: word});
							}
						}
					}
				}
			continue;
			}
		
		function take (theOperator, theType) {
			if (theText.slice (ix, ix + theOperator.length) === theOperator) {
				tokens.push ({type: theType});
				ix += theOperator.length;
				return (true);
				}
			return (false);
			}
		
		if (take ("==", "eq") || take ("!=", "ne") || take ("<=", "le") || take (">=", "ge") ||
			take ("&&", "and") || take ("||", "or") || take ("+=", "addassign") || take ("++", "plusplus") || take ("--", "minusminus") || //9/8/26 by CC -- += is DW's ask ("i've wanted that for 30 years"); the kernel has none, langscan.c takes ++ after a plus and nothing else
			take ("≠", "ne") || take ("≤", "le") || take ("≥", "ge") || //not-equal, less-or-equal, greater-or-equal signs
			take ("=", "assign") || take ("<", "lt") || take (">", "gt") ||
			take ("+", "add") || take ("-", "subtract") || take ("*", "multiply") ||
			take ("/", "divide") || take ("%", "mod") || take ("!", "not") ||
			take ("@", "at") || take ("^", "deref") || take (".", "dot") ||
			take (",", "comma") || take ("(", "lparen") || take (")", "rparen") ||
			take ("[", "lbracket") || take ("]", "rbracket") ||
			take ("{", "lbrace") || take ("}", "rbrace") || take (";", "semicolon") ||
			take (":", "colon")) {
			continue;
			}
		
		error ("the character " + describeCharacter (ch) + " isn't part of the language.");
		}
	
	tokens.push ({type: "eol"});
	return (tokens);
	}

function parseLine (theText) {
	
	/*  8/14/26 by CC -- every parse error names the line it happened on,
		the way the tokenizer's do: without it, a syntax error in a long
		script is a hunt with no map (DW, with no debugger: "when there's a
		syntax error i can't click a button to see where the error is").  */
	
	try {
		return (parseLineGuts (theText));
		}
	catch (err) {
		if (err.message.startsWith ("Can't parse the line because")) {
			var lineText = theText.replace (/[\r\n]/g, " ").trim ();
			if (lineText.length > 80) {
				lineText = lineText.substring (0, 80) + "...";
				}
			const enriched = new Error ("Can't parse the line \"" + lineText + "\" because" + err.message.substring ("Can't parse the line because".length));
			enriched.flRethrow = err.flRethrow;
			throw enriched;
			}
		throw err;
		}
	}

function parseLineGuts (theText) {
	
	/*  Parse one line into a statement node. Block statements get their
		bodies attached later, from the outline structure.  */
	
	const tokens = tokenize (theText);
	var ixToken = 0;
	
	function peek () {
		return (tokens [ixToken]);
		}
	
	function next () {
		const token = tokens [ixToken];
		ixToken++;
		return (token);
		}
	
	function expect (theType, theContext) {
		const token = next ();
		if (token.type !== theType) {
			throw new Error ("Can't parse the line because " + theContext + " expected " + theType + " but got " + token.type + ".");
			}
		return (token);
		}
	
	function flAtEnd () {
		return (peek ().type === "eol");
		}
	
	//expressions, precedence climbing per the yacc declarations
	
	function parsePrimary () {
		
		const token = next ();
		
		switch (token.type) {
			case "string":
				return ({op: "const", value: token.value});
			case "char": //8/26/26 by CC -- 'a', the kernel's character constant
				return ({op: "const", value: charvalue.makeChar (token.value)});
			case "number":
				return ({op: "const", value: token.value});
			case "boolean":
				return ({op: "const", value: token.value});
			case "id":

				/*  10/5/26 by CC -- new userlandSamples.socketClient (): an instance
					of a package, DW's 10/5 design ("local (socketClient = new
					userlandSamples.socketClient ())"). The word new followed by a
					name, not a parenthesis, is the form; new (tableType, @adr),
					the verb, is untouched. What follows is parsed as a call --
					the dotted name and its arguments -- and becomes a new node
					holding the script's address and the arguments.  */

				if ((token.name.toLowerCase () === "new") && (peek ().type === "id")) {
					const theCall = parsePostfix ();
					if (theCall.op !== "call") {
						throw new Error ("Can't parse the line because new must be followed by a package name and its parentheses, as in new userlandSamples.socketClient ().");
						}
					return ({op: "new", target: theCall.fn, args: theCall.args});
					}
				return ({op: "id", name: token.name});
			case "lparen": {
				const inner = parseExpr ();
				expect ("rparen", "a parenthesized expression");
				return (inner);
				}
			case "lbracket": { //a computed identifier: [server].mail.send, @[path + name]
				const nameExpr = parseExpr ();
				expect ("rbracket", "a computed identifier");
				return ({op: "computedid", expr: nameExpr});
				}
			case "lbrace": { //a list literal, or a record when the first item is followed by a colon
				
				/*  8/21/26 by CC -- RECORDS. Frontier has a record type -- the
					kernel's recordvaluetype, which langbuildnamedparamlist
					turns into named parameters -- and 156 scripts in the seed
					use one, more than every other gap put together:
					
						local (params = {"username":username, "password":string (password)})
						ftpRec = {'name': name, path: thePath, host: theHost}
						local (rec = {methods.[method]:params})
					
					The key is a string, however it's written: quoted, a bare
					name, or an expression that answers one. Braces with no
					colon in them are still a list, exactly as before.  */
				
				const items = [];
				if (peek ().type !== "rbrace") {
					const firstItem = parseExpr ();
					if (peek ().type === "colon") {
						next ();
						const entries = [{key: firstItem, value: parseExpr ()}];
						while (peek ().type === "comma") {
							next ();
							const theKey = parseExpr ();
							expect ("colon", "a record");
							entries.push ({key: theKey, value: parseExpr ()});
							}
						expect ("rbrace", "a record");
						return ({op: "record", entries});
						}
					items.push (firstItem);
					while (peek ().type === "comma") {
						next ();
						items.push (parseExpr ());
						}
					}
				expect ("rbrace", "a list literal");
				return ({op: "list", items});
				}
			case "at":
				return ({op: "address", expr: parseUnary ()});
			case "not":
				return ({op: "not", expr: parseUnary ()});
			case "subtract":
				return ({op: "negate", expr: parseUnary ()});
			case "plusplus":
				return ({op: "preincrement", expr: parseUnary ()});
			case "minusminus":
				return ({op: "predecrement", expr: parseUnary ()});
			default:
				
				/*  8/21/26 by CC -- a keyword can be an ordinary name. `mod` is
					the one in DW's code -- `if mod (i, 2) != 0`, and a handler
					`on mod (num, base)` -- and it only reaches here at the
					START of an expression, where the infix reading is
					impossible anyway. Followed by a paren it's a call, so the
					name wins.  */
				
				if ((keywords.indexOf (token.type) !== -1) && (peek ().type === "lparen")) {
					return ({op: "id", name: token.word});
					}
				throw new Error ("Can't parse the line because an expression can't start with " + token.type + ".");
			}
		}
	
	function parsePostfix () {
		var node = parsePrimary ();
		while (true) {
			const token = peek ();
			if (token.type === "dot") {
				next ();
				if (peek ().type === "lbracket") {
					/*  computed member: adrtable^.[fname] -- the dot form is a
						computed NAME, so .[2026] means the entry named 2026;
						the bare form, table [2], means the second entry.  */
					next ();
					const memberExpr = parseExpr ();
					expect ("rbracket", "a computed member");
					node = {op: "index", left: node, index: memberExpr, flComputedName: true};
					continue;
					}
				const idToken = next ();
				if ((idToken.type !== "id") && (keywords.indexOf (idToken.type) === -1)) {
					throw new Error ("Can't parse the line because a dot must be followed by a name, not " + idToken.type + ".");
					}
				var name = idToken.name;
				if (name === undefined) {
					name = idToken.word; //a keyword used as a table entry name, legal after a dot
					}
				node = {op: "dot", left: node, name};
				continue;
				}
			if (token.type === "lbracket") {
				next ();
				const index = parseExpr ();
				expect ("rbracket", "a subscript");
				node = {op: "index", left: node, index};
				continue;
				}
			if (token.type === "lparen") {
				next ();
				const args = [];
				if (peek ().type !== "rparen") {
					args.push (parseCallArg ());
					while (peek ().type === "comma") {
						next ();
						args.push (parseCallArg ());
						}
					}
				expect ("rparen", "a call's arguments");
				node = {op: "call", fn: node, args};
				continue;
				}
			if (token.type === "deref") {
				next ();
				node = {op: "deref", expr: node};
				continue;
				}
			if (token.type === "plusplus") {
				next ();
				node = {op: "postincrement", expr: node};
				continue;
				}
			if (token.type === "minusminus") {
				next ();
				node = {op: "postdecrement", expr: node};
				continue;
				}
			break;
			}
		return (node);
		}
	
	function parseCallArg () { //an argument may be named: flatfilenames: true
		if ((peek ().type === "id") && (tokens [ixToken + 1] !== undefined) && (tokens [ixToken + 1].type === "colon")) {
			const nameToken = next ();
			next ();
			return ({op: "namedarg", name: nameToken.name, value: parseExpr ()});
			}
		return (parseExpr ());
		}
	
	function parseUnary () {
		return (parsePostfix ());
		}
	
	const binaryLevels = [ //loosest first; assign handled at statement level
		["or"],
		["and"],
		["eq", "ne"],
		["lt", "gt", "le", "ge", "beginswith", "endswith", "contains"],
		["add", "subtract"],
		["multiply", "divide", "mod"]
		];
	
	function parseBinary (level) {
		if (level >= binaryLevels.length) {
			return (parseUnary ());
			}
		var node = parseBinary (level + 1);
		while (binaryLevels [level].indexOf (peek ().type) !== -1) {
			const operator = next ().type;
			const right = parseBinary (level + 1);
			node = {op: operator, left: node, right};
			}
		return (node);
		}
	
	function parseExpr () {
		return (parseBinary (0));
		}
	
	/*  8/21/26 by CC -- A NAME IS NOT ALWAYS A PLAIN IDENTIFIER. Three shapes
		show up in DW's own database and none of them parsed:
		
			on mod (num, base)                                  a keyword as a name
			on ["rss.xml"] ()                                   a quoted name in brackets
			local ([outlinetitle] = adroutline^, ...)           a bare name in brackets
		
		The bracket form is how Frontier writes any name that isn't a legal
		identifier -- the worldOutline website handlers are named for the URLs
		they answer -- and it is the same form the language already accepts
		after a dot. One helper, used everywhere a name is taken.  */
	
	function takeName (theWhat) {
		const theToken = peek ();
		if (theToken.type === "id") {
			next ();
			return (theToken.name);
			}
		if (keywords.indexOf (theToken.type) !== -1) { //mod, contains, to -- ordinary names in Frontier
			next ();
			return (theToken.word);
			}
		if (theToken.type === "lbracket") {
			next ();
			const theInner = next ();
			var theName;
			if (theInner.type === "string") {
				theName = String (theInner.value);
				}
			else {
				if (theInner.type === "char") { //8/26/26 by CC -- .['x'] names by the character
					theName = String.fromCharCode (theInner.value);
					}
				else {
					if (theInner.type === "id") {
						theName = theInner.name;
						}
					else {
						throw new Error ("Can't parse the line because " + theWhat + " expected a name in brackets but got " + theInner.type + ".");
						}
					}
				}
			expect ("rbracket", theWhat);
			return (theName);
			}
		return (expect ("id", theWhat).name);
		}
	
	function parseNameList () { //for local (...) and handler parameters: name, or name = default
		const inits = [];
		if ((peek ().type !== "rparen") && (peek ().type !== "rbrace")) {
			while (true) {
				const theName = takeName ("a name list");
				var value = undefined; //8/4/26 by CC -- var is function-scoped, so without the reset every name after an initialized one inherited its value: local (a = f (), b, c) gave b and c the value of f ()
				if (peek ().type === "assign") {
					next ();
					value = parseExpr ();
					}
				inits.push ({name: theName, value});
				if (peek ().type === "comma") {
					next ();
					continue;
					}
				break;
				}
			}
		return (inits);
		}
	
	function parseSimpleStatement () { //an expression or an assignment, no keyword forms
		const expr = parseExpr ();
		if (peek ().type === "assign") {
			next ();
			const value = parseExpr ();
			return ({op: "assign", target: expr, value});
			}
		if (peek ().type === "addassign") { //9/8/26 by CC -- x += y is x = x + y; the target is an lvalue the way = takes one
			next ();
			const value = parseExpr ();
			return ({op: "assign", target: expr, value: {op: "add", left: expr, right: value}});
			}
		return ({op: "expression", expr});
		}
	
	function parseStatement () {
		
		const token = peek ();
		
		switch (token.type) {
			
			case "eol":
				return ({op: "noop"});
			
			case "on": {
				next ();
				const theHandlerName = takeName ("a handler definition");
				expect ("lparen", "a handler definition");
				const params = parseNameList ();
				expect ("rparen", "a handler definition");
				return ({op: "handler", name: theHandlerName, params, body: []});
				}
			
			case "local": case "global": {
				const which = next ().type;
				var inits = [];
				if (peek ().type === "eol") { //block form: bare local, declarations on the child lines
					return ({op: which, inits, flBlockForm: true});
					}
				if (peek ().type === "lparen") {
					next ();
					inits = parseNameList ();
					expect ("rparen", "a " + which + " declaration");
					}
				else {
					if (peek ().type === "lbrace") {
						next ();
						inits = parseNameList ();
						expect ("rbrace", "a " + which + " declaration");
						}
					else {
						inits = parseNameList (); //bare form: local name = value
						}
					}
				return ({op: which, inits});
				}
			
			case "if": {
				next ();
				const test = parseExpr ();
				return ({op: "if", test, body: [], elseBody: undefined});
				}
			
			case "else":
				next ();
				if (peek ().type === "if") { //else if, cascaded
					const nested = parseStatement ();
					return ({op: "else", nestedIf: nested, body: []});
					}
				return ({op: "else", body: []});
			
			case "loop": {
				next ();
				if (peek ().type === "lparen") {
					next ();
					const first = parseSimpleStatement ();
					if (peek ().type === "semicolon") { //loop (init; test; step)
						next ();
						const test = parseExpr ();
						expect ("semicolon", "a three-part loop header");
						const step = parseSimpleStatement ();
						expect ("rparen", "a three-part loop header");
						return ({op: "loop3", init: first, test, step, body: []});
						}
					expect ("rparen", "a loop header");
					if (first.op !== "expression") {
						throw new Error ("Can't parse the line because a counted loop header needs an expression.");
						}
					return ({op: "loop", count: first.expr, body: []});
					}
				return ({op: "loop", body: []});
				}
			
			case "while": {
				next ();
				const test = parseExpr ();
				return ({op: "while", test, body: []});
				}
			
			case "fileloop": {
				next ();
				expect ("lparen", "a fileloop header");
				const nameToken = expect ("id", "a fileloop header");
				expect ("in", "a fileloop header");
				const folder = parseExpr ();
				var depth;
				if (peek ().type === "comma") {
					next ();
					depth = parseExpr ();
					}
				expect ("rparen", "a fileloop header");
				return ({op: "fileloop", name: nameToken.name, folder, depth, body: []});
				}
			
			case "for": {
				next ();
				var flParen = false;
				if (peek ().type === "lparen") { //optional parens: for (x in y)
					next ();
					flParen = true;
					}
				const nameToken = expect ("id", "a for header");
				if (peek ().type === "in") {
					next ();
					const list = parseExpr ();
					if (flParen) {
						expect ("rparen", "a for header");
						}
					return ({op: "forin", name: nameToken.name, list, body: []});
					}
				expect ("assign", "a for header");
				const from = parseExpr ();
				const directionToken = next ();
				if ((directionToken.type !== "to") && (directionToken.type !== "downto")) {
					throw new Error ("Can't parse the line because a for header expected to or downto, not " + directionToken.type + ".");
					}
				const limit = parseExpr ();
				if (flParen) {
					expect ("rparen", "a for header");
					}
				return ({op: "for", name: nameToken.name, from, limit, flDown: directionToken.type === "downto", body: []});
				}
			
			case "bundle":
				next ();
				return ({op: "bundle", body: []});
			
			case "with": {
				next ();
				const paths = [parseExpr ()]; //8/9/26 by CC -- with takes a comma-separated list of tables
				while (peek ().type === "comma") {
					next ();
					paths.push (parseExpr ());
					}
				return ({op: "with", path: paths [0], paths, body: []});
				}
			
			case "try":
				next ();
				if (peek ().type === "lbrace") { //inline form: try {statements}, semicolons legal, return legal
					next ();
					const inner = [];
					if (peek ().type !== "rbrace") {
						inner.push (parseStatement ());
						while (peek ().type === "semicolon") {
							next ();
							if (peek ().type !== "rbrace") {
								inner.push (parseStatement ());
								}
							}
						}
					expect ("rbrace", "an inline try");

					/*  9/4/26 by CC -- the inline else: try {a; b} else {c}, one
						line, the way the 2012 opml.root's op.xmlToOutline writes
						it ("try {text = attstable.text; delete (@attstable.text)}
						else {text = \"\"}"). The grammar's try statement takes an
						else clause whichever way the braces fall; this parser
						only knew the block form, so the distribution's own glue
						didn't parse.  */

					var elseInner;
					if (peek ().type === "else") {
						next ();
						if (peek ().type === "lbrace") {
							next ();
							elseInner = [];
							if (peek ().type !== "rbrace") {
								elseInner.push (parseStatement ());
								while (peek ().type === "semicolon") {
									next ();
									if (peek ().type !== "rbrace") {
										elseInner.push (parseStatement ());
										}
									}
								}
							expect ("rbrace", "an inline else");
							}
						}
					return ({op: "try", body: inner, elseBody: elseInner});
					}
				return ({op: "try", body: [], elseBody: undefined});
			
			case "case": {
				next ();
				const value = parseExpr ();
				return ({op: "case", value, body: []});
				}
			
			case "kernel": {
				/*  7/27/26 by CC -- kernel (x.y.z): a builtin's body line saying
					"the implementation lives in the kernel here". Becomes a call
					to the kernel special form; the path is read token by token
					so path parts that collide with keywords still parse.  */
				next ();
				expect ("lparen", "a kernel statement");
				var kernelPath = "";
				while ((!flAtEnd ()) && (peek ().type !== "rparen")) {
					const pathToken = next ();
					if (pathToken.type === "dot") {
						kernelPath += ".";
						}
					else {
						kernelPath += (pathToken.name !== undefined) ? pathToken.name : ((pathToken.word !== undefined) ? pathToken.word : String (pathToken.value));
						}
					}
				expect ("rparen", "a kernel statement");
				var kernelArgNode = {op: "id", name: kernelPath.split (".") [0]};
				kernelPath.split (".").slice (1).forEach (function (part) {
					kernelArgNode = {op: "dot", left: kernelArgNode, name: part};
					});
				return ({op: "expression", expr: {op: "call", fn: {op: "id", name: "kernel"}, args: [kernelArgNode]}});
				}
			
			case "break":
				next ();
				if (peek ().type === "lparen") {
					next ();
					expect ("rparen", "a break statement");
					}
				return ({op: "break"});
			
			case "continue":
				next ();
				return ({op: "continue"});
			
			case "return": {
				next ();
				var value;
				if (!flAtEnd () && (peek ().type !== "semicolon")) {
					value = parseExpr ();
					}
				return ({op: "return", value});
				}
			
			default: {
				const expr = parseExpr ();
				if (peek ().type === "assign") {
					next ();
					const value = parseExpr ();
					return ({op: "assign", target: expr, value});
					}
				if (peek ().type === "addassign") { //9/8/26 by CC -- +=, see parseSimpleStatement
					next ();
					const value = parseExpr ();
					return ({op: "assign", target: expr, value: {op: "add", left: expr, right: value}});
					}
				return ({op: "expression", expr});
				}
			}
		}
	
	function attachInlineBody (statement) {
		/*  7/27/26 by CC -- a block header can carry its body inline in
			braces: while (typeof (nomad^) == addresstype) {nomad = nomad^}  */
		if ((peek ().type === "lbrace") && (blockOps.indexOf (statement.op) !== -1)) {
			next ();
			statement.body = [];
			if (peek ().type !== "rbrace") {
				statement.body.push (parseStatement ());
				while (peek ().type === "semicolon") {
					next ();
					if (peek ().type !== "rbrace") {
						statement.body.push (parseStatement ());
						}
					}
				}
			expect ("rbrace", "an inline block body");
			}
		}
	
	const statements = [];
	statements.push (parseStatement ());
	attachInlineBody (statements [statements.length - 1]);
	while (peek ().type === "semicolon") { //semicolons separate statements on one line, and trail legally
		next ();
		if (!flAtEnd ()) {
			statements.push (parseStatement ());
			attachInlineBody (statements [statements.length - 1]);
			}
		}
	if (!flAtEnd ()) {
		throw new Error ("Can't parse the line because there are extra tokens after the statement, starting with " + peek ().type + ".");
		}
	if (statements.length === 1) {
		return (statements [0]);
		}
	return ({op: "sequence", statements});
	}

const blockOps = ["handler", "if", "else", "loop", "loop3", "while", "fileloop", "for", "forin", "bundle", "with", "try", "case"];

function parseOutline (theNodes) {
	
	/*  theNodes is an array of {text, subs} outline nodes. Returns an
		array of statements, children attached as bodies, else-lines
		joined to their if or try.  */
	
	const statements = [];
	
	theNodes.forEach (function (node) {
		
		if ((node.text.trim ().length === 0) && (node.subs.length > 0)) { //a blank organizer line -- its children run at this level
			parseOutline (node.subs).forEach (function (child) {
				statements.push (child);
				});
			return;
			}
		
		const statement = parseLine (node.text);
		
		if (statement.op === "case") { //children are clauses: a value line whose children are its body, or an else line
			statement.clauses = [];
			node.subs.forEach (function (clauseNode) {
				const clauseLine = parseLine (clauseNode.text);
				if (clauseLine.op === "else") {
					statement.elseBody = parseOutline (clauseNode.subs);
					return;
					}
				if (clauseNode.text.trim ().length === 0) { //8/21/26 by CC -- a blank line between clauses is spacing, the way it is everywhere else in an outline
					return;
					}
				if (clauseLine.op !== "expression") {
					throw new Error ("Can't parse the outline because the case clause \"" + clauseNode.text + "\" isn't a value.");
					}
				statement.clauses.push ({value: clauseLine.expr, body: parseOutline (clauseNode.subs)});
				});
			statements.push (statement);
			return;
			}
		
		if (node.subs.length > 0) {
			if (((statement.op === "local") || (statement.op === "global")) && (statement.flBlockForm === true)) {
				/*  block form: bare local over child lines, one declaration
					each -- a name, or name = value.  */
				node.subs.forEach (function (declarationNode) {

					/*  9/26/26 by CC -- each child line is a NAME LIST, the grammar's
						namelist (langparser.y: "localtoken '{' namelist '}'", and a
						namelist is namelistids separated by commas), so one line can
						declare several: docserver.root's dsClassList writes
						"i, localPageTable, htmltext = """ under a bare local, and
						every class page of the site said its script doesn't parse.
						The line is parsed as the parenthesized form of the same
						statement, so what it takes is exactly what local (...) takes.  */

					var theDeclarationText = declarationNode.text; //a trailing comment -- « or // outside a string -- comes off first, or it would swallow the closing paren
					(function () {
						var quoteChar = "";
						var ix;
						for (ix = 0; ix < theDeclarationText.length; ix++) {
							const ch = theDeclarationText.charAt (ix);
							if (quoteChar !== "") {
								if (ch === "\\") {
									ix++;
									}
								else if (ch === quoteChar) {
									quoteChar = "";
									}
								continue;
								}
							if ((ch === "\"") || (ch === "'")) {
								quoteChar = ch;
								continue;
								}
							if ((ch === "\u00ab") || ((ch === "/") && (theDeclarationText.charAt (ix + 1) === "/"))) { //« or //
								theDeclarationText = theDeclarationText.slice (0, ix);
								return;
								}
							}
						}) ();
					var declaration;
					try {
						declaration = parseLine (statement.op + " (" + theDeclarationText + ")");
						}
					catch (err) {
						throw new Error ("Can't parse the outline because the " + statement.op + " declaration \"" + declarationNode.text + "\" isn't a name or an assignment.");
						}
					if ((declaration.op !== statement.op) || !Array.isArray (declaration.inits)) {
						throw new Error ("Can't parse the outline because the " + statement.op + " declaration \"" + declarationNode.text + "\" isn't a name or an assignment.");
						}
					declaration.inits.forEach (function (theInit) {
						statement.inits.push (theInit);
						});
					});
				statements.push (statement);
				return;
				}
			if (blockOps.indexOf (statement.op) === -1) {
				/*  a plain line with children -- Frontier treats subordinate
					lines of a non-block statement as part of no block; in
					Dave's corpus this shape is a continuation comment holder,
					so children must be empty of code. Refuse loudly.  */
				throw new Error ("Can't parse the outline because the line \"" + node.text + "\" isn't a block header but has sublines.");
				}
			if ((statement.op === "else") && (statement.nestedIf !== undefined)) {
				statement.nestedIf.body = parseOutline (node.subs);
				}
			else {
				statement.body = parseOutline (node.subs);
				}
			}
		
		if ((statement.op === "else") && (statements.length > 0)) {
			const previous = statements [statements.length - 1];
			if ((previous.op === "if") || (previous.op === "try") || (previous.op === "case")) {
				if (statement.nestedIf !== undefined) {
					previous.elseBody = [statement.nestedIf];
					}
				else {
					previous.elseBody = statement.body;
					}
				return;
				}
			throw new Error ("Can't parse the outline because an else line doesn't follow an if, try or case.");
			}
		
		statements.push (statement);
		});
	
	return (statements);
	}

function linesToTree (theLines) { //flat {level, text, flComment} lines to {text, subs}, comment subtrees excluded
	
	/*  7/28/26 by CC -- a line ending in backslash continues on the next
		line (usually indented one deeper): join the chain into one logical
		line at the first line's level before building the tree.  */
	const joinedLines = [];
	var ixLine = 0;
	while (ixLine < theLines.length) {
		const line = theLines [ixLine];
		var text = line.text.replace (/[\r\n]+/g, " "); //8/14/26 by CC -- a line break inside a stored line's text is data poison (the tokenizer refuses it); lines already in the database from before the boundary normalization still parse
		var ixAhead = ixLine;
		while (text.replace (/\s+$/, "").endsWith ("\\") && (ixAhead + 1 < theLines.length)) {
			text = text.replace (/\s*\\\s*$/, " ");
			ixAhead++;
			text += theLines [ixAhead].text.trim ();
			}
		joinedLines.push ({level: line.level, text: text, flComment: line.flComment});
		ixLine = ixAhead + 1;
		}
	
	const root = {text: "", subs: []};
	const stack = [root];
	var depthSkip = -1;
	joinedLines.forEach (function (line) {
		if ((depthSkip >= 0) && (line.level > depthSkip)) {
			return;
			}
		depthSkip = -1;
		if (line.flComment) {
			depthSkip = line.level;
			return;
			}
		const node = {text: line.text, subs: []};
		stack [line.level].subs.push (node);
		stack [line.level + 1] = node;
		stack.length = line.level + 2;
		});
	return (root.subs);
	}

exports.parseLine = parseLine;
exports.parseOutline = parseOutline;
exports.tokenize = tokenize;
exports.linesToTree = linesToTree;
