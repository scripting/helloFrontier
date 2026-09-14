# workspace.timing

The last time we ran this script was in August, and it takes approx twice the time for each call.

9/14/26; 11:15:57 AM by DW

```javascript
on doVeryLittle ()
	//Changes
		//8/17/2026; 12:29:14 PM by DW
			//Created.
	return (100 + 959)
bundle //test code
	doVeryLittle ()
```


```javascript
on timing ()
	//Changes
		//8/17/2026; 12:08:09 PM by DW
			//Created.
	local (ctloops = 500000)
	on secondsSince (whenstart)
		local (ctsecs = number (clock.now ()) - number (whenstart))
		return (ctsecs)
	local (whenstart = clock.now (), x = 0)
	for i = 1 to ctloops
		workspace.doVeryLittle ()
	op.console.start ()
	op.console.log (ctloops + " loops took " + secondsSince (whenstart) + " seconds.")
bundle //test code
	timing ()
```


