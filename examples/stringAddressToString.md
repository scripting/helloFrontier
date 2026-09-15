# string.addressToString

I noticed that the names of objects in the Window menu were much longer than they needed to be. I asked if we had a way to shorten them, and we did not. Then I looked in the pre-Atlantis Frontier, and it had the same problem, which told me I've been using it this way for hundreds of years or so it seems. So together we figure out where this fit -- there was even a string.stringToAddress verb. 

9/14/26; 10:51:38 AM by DW

```javascript
on addressToString (adr)
	local (fullpath = string (adr), lowerfullpath = string.lower (fullpath), shortest = string (adr), adrpath)
	for adrpath in @system.paths
		local (prefix = string.lower (adrpath^) + ".")
		if lowerfullpath beginsWith prefix
			local (candidate = string.delete (fullpath, 1, sizeof (prefix)))
			if sizeof (candidate) < sizeof (shortest)
				shortest = candidate
	return (shortest)
bundle //test code
	dialog.alert (string.addressToString (@system.VERBS.builtins.xml.rss.getFeedItems)) //9/14/26 by DW
```


