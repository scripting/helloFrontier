# string.addressToString

I noticed that the names of objects in the Window menu were much longer than they needed to be. I asked if we had a way to shorten them, and we did not. Then I looked in the pre-Atlantis Frontier, and it had the same problem, which told me I've been using it this way for hundreds of years or so it seems. So together we figure out where this fit -- there was even a string.stringToAddress verb. 

9/14/26; 10:51:38 AM by DW

```javascript
on addressToString (adr)
```
<details><summary><code>&nbsp;&nbsp;&nbsp;&nbsp;//Changes</code></summary>

```javascript
		//9/14/26; 10:41:45 AM by DW
			//Searches are now unicase. 
		//9/11/26; 5:30:00 PM by DW & CC
			//Created. Returns the shortest possible string to represent the object. Instead of system.verbs.builtins.string.addressToString it returns string.addressToString. Both work, but the shorter one is nicer to use in your code. ;-)
			//This is a new verb in Atlantis, the 2026 release.
			//This code is a good illustration of the role the paths table plays.
```
</details>

```javascript
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
		//true
	//dialog.alert (string.addressToString (@system.verbs.builtins.xml.rss.getFeedItems))
```


