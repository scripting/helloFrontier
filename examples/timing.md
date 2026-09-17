# workspace.timing

9/17/26 by DW:  Convert to factional seconds. Earlier versions of Frontier couldn't do fractional seconds in date.secondsSince. Now we have two new verbs, clock.milliseconds and date.secondsSinceFractional.

9/17/26 by DW: The last time we ran this script was in August, now it takes approx twice the time for each call.

```javascript
on timing ()
	local (ctloops = 100000)
	on secondsSince (whenstart)
		local (ctsecs = number (clock.now ()) - number (whenstart))
		return (ctsecs)
	local (whenstart = clock.milliseconds (), x = 0)
	for i = 1 to ctloops
		workspace.doVeryLittle ()
	op.console.start ()
	op.console.log (ctloops + " loops took " + date.secondsSinceFractional (whenstart) + " seconds.")
bundle //test code
	timing ()
```


```javascript
on doVeryLittle ()
	return (100 + 959)
bundle //test code
	doVeryLittle ()
```


