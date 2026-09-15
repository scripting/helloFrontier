# twitter.newPost

Was having a conversation with friends about the capability of glue scripts. This is an example of a script that was started in 2007, about a year after Twitter started up. No doubt this API is no longer supported, but it gives you an idea what's possible using HTTP. It was being maintained through April, 2011. 

```javascript
on newPost (text, username=nil, password=nil, maxchars=nil, posturl=nil, source=nil, inResponseTo=nil, adrResponse=nil, latitude=nil, longitude=nil, adruser=nil)
	twitter.init ()
	
	bundle //try doing it the OAuth way, 3/26/11 by DW
		if adruser != nil
			if twitter.oAuth.initUser (adruser)
				try
					local (adrapp = @adruser^.oauth, params, xmltext)
					new (tabletype, @params)
					params.status = text
					OAuth.authenticatedCall (user.twitter.prefs.posturl, @params, adrapp^.consumerkey, adrapp^.consumersecret, adrapp^.accesstoken, adrapp^.accesstokensecret, @xmltext, "POST")
					wp.newtextobject (xmltext, @scratchpad.xmltext)
					if adrresponse != nil //4/2/11 by DW
						xml.compile (xmltext, adrresponse)
					return (true)
			return (false)
	
	bundle //set defaults
		if username == nil
			username = user.twitter.prefs.username
		if password == nil
			password = string (user.twitter.prefs.password)
		if maxchars == nil
			maxchars = user.twitter.prefs.maxchars
		if posturl == nil
			posturl = user.twitter.prefs.posturl
	if sizeof (text) > maxchars
		text = string.mid (text, 1, maxchars)
	local (urllist = string.urlsplit (posturl))
	local (path = urllist [3] + "?status=" + string.urlencode (text))
	if source != nil
		path = path + "&source=" + string.urlencode (source)
	if inResponseTo != nil //8/15/08 by DW
		path = path + "&in_reply_to_status_id=" + inResponseTo
	if latitude != nil //11/19/09 by DW
		path = path + "&lat=" + latitude
	if longitude != nil //11/19/09 by DW
		path = path + "&long=" + longitude
	try
		local (tc = clock.ticks (), timeoutticks = 60 * user.twitter.prefs.timeOutSecs)
		local (s = string.httpResultSplit (tcp.httpClient (server:urllist [2], path:path, username:username, password:password,  method:"POST", timeoutticks:timeoutticks, flmessages:false)))
		if adrresponse != nil //8/15/08 by DW
			local (xstruct)
			new (tabletype, adrresponse)
			xml.compile (s, @xstruct)
			local (adrstatus = xml.getaddress (@xstruct, "status"))
			adrresponse^.id = xml.getvalue (adrstatus, "id")
			adrresponse^.inReplyToStatusId = xml.getvalue (adrstatus, "in_reply_to_status_id")
			adrresponse^.inReplyToUserId = xml.getvalue (adrstatus, "in_reply_to_user_id")
		user.twitter.stats.whenLastPost = clock.now ()
		user.twitter.stats.ctPosts++
		user.twitter.stats.ctSecsLastPost = double (clock.ticks () - tc) / 60
		user.twitter.stats.lastPostError = ""
		return (true)
	else
		user.twitter.stats.lastPostError = tryerror
		return (false)
bundle //test code
	newpost ("Excuse the interruption. This is just a test post.", adruser:@config.radioReallySimple.users.bullmancuso)
	return
	local (lat = random (-90, 90), long = random (-180, 180))
	newpost ("This twit has geocoding info, if it works. :-)", source:"Lucky Lou", latitude:lat, longitude:long)
```


