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


#### Example code that calls it

```javascript

scratchpad.a = new workspace.userlandSamples.packages.counter () //start a new counter

scratchpad.b = new workspace.userlandSamples.packages.counter () //start another

scratchpad.a.bumpcount ()

scratchpad.a.bumpcount ()

scratchpad.b.bumpcount ()

scratchpad.a.bumpcount ()

```

#### What it does

Creates two counters, scratchpad.a and scratchpad.b.

Then we do some bumping.

And the values of each counter reflects the number of bumps it's been called on to do.

#### More complex example

An <a href="https://github.com/scripting/helloFrontier/blob/master/examples/socketClient.md">working example</a> of a websocket client in 16 lines. ;-)

