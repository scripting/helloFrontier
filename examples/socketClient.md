# workspace.userlandsamples.packages.socketClient

Two things are being demonstrated here: 1. how to create a websocket client and 2. how to use a new kind of script called a package. 

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


