# workspace.userlandsamples.mastodon.exportMyMastofeed

Builds the RSS feed of Mastodon posts for the indicated user, saving the file on the desktop folder.

```javascript
on buildRss (siteUrl, accountName, ctPosts=25, feedUrl=nil)
	local (xmltext = "", indentlevel = 0, now = clock.now (), accountId, account, posts, ctItems = 0)
	on add (s)
		xmltext = xmltext + string.filledString ("\t", indentlevel) + s + "\r\n"
	on encode (s)
		return (xml.entityEncode (s, true))
	on postDate (s) //created_at is 2026-09-11T14:43:52.135Z; the root's ISO 8601 verb wants the zone as +00:00
		return (date.iso8601StringToDate (string.replace (s, "Z", "+00:00")))
	on decodeEntities (s)
		s = string.replaceAll (s, "&lt;", "<")
		s = string.replaceAll (s, "&gt;", ">")
		s = string.replaceAll (s, "&quot;", "\"")
		s = string.replaceAll (s, "&#39;", "'")
		s = string.replaceAll (s, "&apos;", "'")
		s = string.replaceAll (s, "&nbsp;", " ")
		return (string.replaceAll (s, "&amp;", "&"))
	on htmlToMarkdown (htmltext) //a post's HTML is paragraphs, line breaks and links, nothing else
		local (s = htmltext, markdowntext = "", ix, ixEnd, tagtext, href, linktext)
		s = string.replaceAll (s, "</p><p>", "\n\n")
		s = string.replaceAll (s, "<br />", "\n")
		s = string.replaceAll (s, "<br/>", "\n")
		s = string.replaceAll (s, "<br>", "\n")
		loop //each link becomes [text](url), or just the url if that's what the text is
			ix = string.patternMatch ("<a ", s)
			if ix == 0
				break
			markdowntext = markdowntext + searchEngine.stripMarkup (string.mid (s, 1, ix - 1))
			s = string.delete (s, 1, ix - 1)
			ixEnd = string.patternMatch (">", s)
			tagtext = string.mid (s, 1, ixEnd)
			s = string.delete (s, 1, ixEnd)
			href = ""
			ix = string.patternMatch ("href=\"", tagtext)
			if ix > 0
				href = string.delete (tagtext, 1, ix + 5)
				href = string.mid (href, 1, string.patternMatch ("\"", href) - 1)
			ixEnd = string.patternMatch ("</a>", s)
			if ixEnd == 0
				break
			linktext = searchEngine.stripMarkup (string.mid (s, 1, ixEnd - 1))
			s = string.delete (s, 1, ixEnd + 3)
			if (linktext == href) or (sizeof (href) == 0)
				markdowntext = markdowntext + linktext
			else
				markdowntext = markdowntext + "[" + linktext + "](" + decodeEntities (href) + ")"
		markdowntext = markdowntext + searchEngine.stripMarkup (s)
		return (decodeEntities (markdowntext))
	bundle //get the account and its posts
		accountId = mastodon.getAccountId (siteUrl, "", accountName, @account)
		mastodon.getPosts (siteUrl, "", @posts, ctPosts, accountId)
	add ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
	add ("<rss version=\"2.0\" xmlns:source=\"http://source.scripting.com/\">"); indentlevel++
	add ("<channel>"); indentlevel++
	bundle //add header elements
		local (displayName = xml.getValue (@account, "display_name"), whenNewest = now)
		if sizeof (displayName) == 0
			displayName = xml.getValue (@account, "username")
		if sizeof (posts) > 0
			whenNewest = postDate (xml.getValue (@posts [1], "created_at"))
		add ("<title>" + encode (displayName) + "</title>")
		add ("<link>" + encode (xml.getValue (@account, "url")) + "</link>")
		add ("<description>" + encode (string.trimWhiteSpace (decodeEntities (searchEngine.stripMarkup (xml.getValue (@account, "note"))))) + "</description>")
		add ("<pubDate>" + date.netStandardString (whenNewest) + "</pubDate>")
		add ("<lastBuildDate>" + date.netStandardString (now) + "</lastBuildDate>")
		add ("<generator>" + frontier.getProgramName () + "</generator>")
		add ("<docs>https://cyber.law.harvard.edu/rss/rss.html</docs>")
		bundle //the account's picture
			local (urlAvatar = xml.getValue (@account, "avatar_static"))
			if sizeof (urlAvatar) > 0
				add ("<image>"); indentlevel++
				add ("<url>" + encode (urlAvatar) + "</url>")
				add ("<title>" + encode (displayName) + "</title>")
				add ("<link>" + encode (xml.getValue (@account, "url")) + "</link>")
				add ("</image>"); indentlevel--
		bundle //source namespace elements for the channel
			local (server = string.nthField (siteUrl, "/", 3))
			add ("<source:account service=\"mastodon\">" + encode (xml.getValue (@account, "username") + "@" + server) + "</source:account>")
			if feedUrl != nil
				add ("<source:self>" + encode (feedUrl) + "</source:self>")
	bundle //add items
		local (adrpost, adr, htmltext, markdowntext, urlPost)
		for adrpost in @posts
			htmltext = xml.getValue (adrpost, "content")
			markdowntext = htmlToMarkdown (htmltext)
			urlPost = xml.getValue (adrpost, "url")
			bundle //pictures go at the end of the text, both ways
				for adr in xml.getAddressList (adrpost, "media_attachments")
					if typeof (adr^) == tabletype
						if xml.getValue (adr, "type") == "image"
							local (urlImage = xml.getValue (adr, "url"), alttext = xml.getValue (adr, "description"))
							if alttext == "undefined" //json.compile's word for null
								alttext = ""
							htmltext = htmltext + "<p><img src=\"" + urlImage + "\" alt=\"" + xml.entityEncode (alttext, true) + "\"></p>"
							markdowntext = markdowntext + "\n\n![" + alttext + "](" + urlImage + ")"
			add ("<item>"); indentlevel++
			add ("<description>" + encode (htmltext) + "</description>")
			add ("<link>" + encode (urlPost) + "</link>")
			add ("<guid>" + encode (urlPost) + "</guid>")
			add ("<pubDate>" + date.netStandardString (postDate (xml.getValue (adrpost, "created_at"))) + "</pubDate>")
			for adr in xml.getAddressList (adrpost, "tags")
				if typeof (adr^) == tabletype
					add ("<category>" + encode (xml.getValue (adr, "name")) + "</category>")
			add ("<source:markdown>" + encode (markdowntext) + "</source:markdown>")
			add ("</item>"); indentlevel--
			ctItems++
	add ("</channel>"); indentlevel--
	add ("</rss>"); indentlevel--
	return (xmltext)
bundle //test code
	local (f = file.getSpecialFolderPath ("", "desktop folder", true) + "rss.xml") 
	local (xmltext = buildRss ("https://mastodon.social/", "davew", 25, nil, "https://masto.feediverse.org/davew/rss.xml"))
	file.writewholefile (f, xmltext)
	speaker.beep ()
```


