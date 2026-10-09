# system.menus.scripts.mustBeOutline

A slight update to a script I wrote in 1997. 

Added what is now a standard script shell, so there's an easy place to add test code, and dev notes. just easier to work on. 

I don't like using a list, a case statement would be simpler, but let's leave this historic bit here as-is. 

29 years ago was when this code was written. wow.

```javascript
on mustBeOutline ()
	local (okTypes = {scriptType, outlineType, tableType, menubarType})
	local (w = window.frontmost ())
	if okTypes contains window.getType (w)
		return (true)
	else
		local (s = "Can't perform the operation because ")
		if w == nil
			scriptError (s + "no window is open.")
		else
			scriptError (s + "\"" + w + "\" doesn't contain an outline.")
bundle //test script
	dialog.alert (mustBeOutline ())
```


