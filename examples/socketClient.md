# workspace.userlandsamples.packages.socketClient

Two things are being demonstrated here: 1. how to create a websocket client and 2. how to use a new kind of script called a package. 

It defines three local functions -- init, handleMessage and stop. 

This is how you start a new socket.

``scratchpad.mySocket = new workspace.userlandSamples.packages.socketClient ("wss://feedland.social/")``

You can open <a href="https://imgs.scripting.com/2026/10/07/socketscreen.png">scratchpad.mySocket</a> while the socket is running, and watch the new and updated posts accumulate in the items table. We only do that because it's a demo, you might do other things with it. The important thing is we've hooked Frontier up to FeedLand, and it took about twenty lines to set that up. And the new packages feature makes it easy to see how it works, easier than it was when each script had to be in its own odb part. 

```javascript
on init (urlFeedlandSocket)
	new (tableType, @this^.items)
	this^.socket = tcp.websocket.open (urlFeedlandSocket, this)
on handleMessage (socket, message)
	local (command = string.nthField (message, cr, 1))
	local (jsontext = string.delete (message, 1, sizeof (command) + 1))
	local (payload)
	JSON.compile (jsontext, @payload)
	if (command == "newItem") or (command == "updatedItem") //a story: new, changed, or liked
		local (adritem = xml.getAddress (@payload, "item"))
		this^.items.[string (xml.getValue (adritem, "id"))] = adritem^
on stop ()
	tcp.websocket.close (this^.socket)
exports.init = init
exports.handleMessage = handleMessage
exports.stop = stop
```


