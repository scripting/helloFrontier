# workspace.userlandsamples.mastodon.exportMyMastofeed

Builds the RSS feed of Mastodon posts for the indicated user, saving the file on the desktop folder.

```javascript
on exportMyMastofeed (siteUrl, accountName,  ctPosts=25, feedUrl=nil)
	local (xmltext = mastodon.buildRss (siteUrl, accountName,  ctPosts, feedUrl))
	local (f = file.getSpecialFolderPath ("", "desktop folder", true) + "rssx.xml") 
	file.surefilepath (f)
	file.writewholefile (f, xmltext) 
	speaker.beep ()
bundle //test code
	exportMyMastofeed ("https://mastodon.social/", "davew", 25, "https://masto.feediverse.org/davew/rss.xml")
```


