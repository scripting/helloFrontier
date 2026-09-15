# workspace.timing

The last time we ran this script was in August, now it takes approx twice the time for each call.

9/14/26; 11:15:57 AM by DW

```javascript
on doVeryLittle ()
```
<details><summary><code>&nbsp;&nbsp;&nbsp;&nbsp;//Changes</code></summary>

```javascript
		//8/17/2026; 12:29:14 PM by DW
			//Created.
```
</details>

```javascript
	return (100 + 959)
bundle //test code
	doVeryLittle ()
```


```javascript
on timing ()
```
<details><summary><code>&nbsp;&nbsp;&nbsp;&nbsp;//Changes</code></summary>

```javascript
		//8/17/2026; 12:08:09 PM by DW
			//Created.
```
</details>

```javascript
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


