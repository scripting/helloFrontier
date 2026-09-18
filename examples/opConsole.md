# op.console.start and op.console.log

After pending 13 years working in JavaScript, I have come to love console.log. Sometimes debugging isn't an option. And sometimes you want every call to a function to announce itself, so you can click to start the debugger. So I wanted this in Frontier, and quickly put this together. A console logging function that works in an outline. 

```javascript
on start ()
	local (adrconsole = @scratchpad.console)
	if not defined (adrconsole^)
		new (outlinetype, adrconsole)
		window.setSize (adrconsole, 800, 400)
	local (oldtarget = target.set (adrconsole))
	edit (adrconsole)
	op.fullCollapse ()
	op.firstsummit ()
	op.insert (clock.now (), up)
	op.insert ("", right)
	target.set (oldtarget)
	return (adrconsole)
bundle //test code
	start ()
```


```javascript
on log (theMessage)
	local (adrconsole = @scratchpad.console)
	local (oldtarget = target.set (adrconsole))
	if op.getlinetext () == ""
		op.setlinetext (theMessage)
	else 
		op.insert (theMessage, down)
	target.set (oldtarget)
bundle //test code
	for i = 1 to 10
		log (i)
```


