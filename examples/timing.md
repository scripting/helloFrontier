# workspace.timing

Measures the amount of time it takes to call an odb-based script. This was too slow when we got started.

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
	console.start ()
	for i = 1 to ctloops
		workspace.doVeryLittle ()
	console.log (ctloops + " loops took " + secondsSince (whenstart) + " seconds.")
bundle //test code
	timing ()

```
