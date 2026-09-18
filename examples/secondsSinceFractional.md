# date.secondsSinceFractional and clock.milliseconds

New verb. date.secondsSince, a great utility for log messages and such, in Frontier has always been expressed in whole numbers. But there are times when you need more precision. The difference here is that the <i>when</i> value must come from clock.milliseconds, where you used clock.now for date.secondsSince. 

clock.milliseconds is also a new kernel-implemented verb.

```javascript
on secondsSinceFractional (when)
	local (ctsecs = double (clock.milliseconds () - when) / 1000)
	return (ctsecs)
bundle //test code
	local (whenstart = clock.milliseconds ()) 
	loop 
		if random (0, 100000) == 123
			break
	dialog.alert (secondsSinceFractional (whenstart))
```


