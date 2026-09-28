# workspace.userlandsamples.mastodon.exportMyMastofeed

Builds the RSS feed of Mastodon posts for the indicated user, saving the file on the desktop folder.

feedUrl, if provided, is used to generate the source:self element. 

We beep the speaker at the end so you know it's done. 

```javascript
on exportMyMastofeed (siteUrl, accountName,  ctPosts=25, feedUrl=nil)
	local (xmltext = mastodon.buildRss (siteUrl, accountName,  ctPosts, feedUrl))
	local (f = file.getSpecialFolderPath ("", "desktop folder", true) + "rss.xml") 
	file.surefilepath (f)
	file.writewholefile (f, xmltext) 
	speaker.beep ()
bundle //test code
	exportMyMastofeed ("https://mastodon.social/", "davew", 25, "https://masto.feediverse.org/davew/rss.xml")
```


