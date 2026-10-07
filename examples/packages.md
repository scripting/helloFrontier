# workspace.userlandsamples.packages.counter

A simple package, a new feature for Frontier script objects, they can declare several functions that can be called from outside, and can also use data that is visible within the package. Prior art from JavaScript and Node packages. 

```javascript
on bumpcount ()
	if not defined (this^.ct)
		this^.ct = 0
	this^.ct++
	return (this^.ct)
exports.bumpcount = bumpcount
```


This example has one function, bumpCount. When it starts, the count is set to zero and is incremented on each successive call. 

Here's how you call it. 

scratchpad.a = new workspace.userlandSamples.packages.counter ()

And how you bump the counter.

scratchpad.a.bumpcount ()

If you look in scratchpad.a this is <a href="https://imgs.scripting.com/2026/10/07/scratchpad.a.png">what you see</a>. 



