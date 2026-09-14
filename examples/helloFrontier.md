# workspace.userlandSamples.helloFrontier

The first object that we're distributing through rootupdates.

```javascript
on helloFrontier ()
	//Changes
		//9/9/26; 1:24:18 PM by DW
			//I had previously subscribed to the https location in FeedLand and then ping'd on the http location. 
		//9/9/26; 1:15:38 PM by DW
			//The pings didn't show up in the blogroll. Now we're going to use the log on Andrew's server to see if they got the ping.  
				//https://rpc.rsscloud.io/viewLog
		//9/9/26; 12:53:25 PM by DW
			//All the new pieces worked, thanks to the great reviewing prowess of Claude Code. When I write new stuff, I always have it review the changes, and I almost always have to fix something. This is good, I get to relax more writing code I guess. Anyway, in the next update, I'll be watching the blogroll on scripting.com to see if frontier.root updates shows up at the top of the list. 
		//9/9/26; 12:42:19 PM by DW
			//Rewrote the cloud element and the pinging code. The previous method was using xml-rpc and xml.rss.pingCloud and xml.rss.defaultCloud.getCloudElement. It was planning a bunch of generality that never got built on and in the meantime, I have a Node package that does a tighter job, hides a lot more of the detail in building a feed.
		//9/7/26; 11:48:17 AM by DW
			//Changed the cloud server to rpc.rsscloud.io. the old server rpc.rsscloud.org -- i let it lapse for some stupid reason or so it turns out. ;-)
		//9/7/26; 11:35:57 AM by DW
			//There's now a source declaration attached to the rss element. 
		//9/7/26; 10:47:22 AM by DW
			//Second update. Now it has a cloud element. 
		//9/7/26; 9:54:34 AM by DW
			//This is the first update. All I did was put an exclam at the end of Hello World. Let's see how the feed reacts.
		//9/6/2026; 12:36:41 PM by DW
			//A script I am using to help test the rootUpdates mechanism. At first it is just be a Hello World dialog from Frontier. Maybe it will become more than that. Not sure. 
	dialog.alert ("Hello World")
bundle //test code
	helloFrontier ()
```


