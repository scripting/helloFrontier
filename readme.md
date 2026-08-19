# Hello Frontier

I'm working on a new version of Frontier, a complete rewrite, running in Electron, a project that could only be approached with the new AI tools, in this case Claude Code. 

Dave Winer, August 2026

### Background

Frontier is a lot bigger than I remembered, because I only use a fraction of it when I'm working on my websites and apps. That's how I've been using it since 2013 or so. Writing, documenting and supporting my online projects.

Now we're trying to get Frontier itself running in this mode. We can do almost everything, but some parts will be hard, and probably a few things that worked on the Mac up till the late teens, won't work there either, mostly having to do with background processes. 

### How this works

I'm going to raise issues in the Issues section here, outlining a decision I have to make, usually about how much of Frontier we should:

1. Do now.

2. Support later, maybe.

3. Won't support. 

Things like mac-only data types, that the mac of today probably doesn't support are in category 3.

Some tcp verbs have already been ported, others need to be, and still others aren't generally used at the JS and above layer unless they're doing something really specific with the OS.

There also will be features we will add, for example, we have much better feed reading and building functionality. 

And there are implementations that have changed, and possibly no longer work the same way as the original app worked. Those are bugs, and we're fixing them as they are discovered. 

### What is Frontier?

When we want to know what Frontier does, we refer to the Frontier source code archived by Ted C. Howard. I'm not sure of the date he archived it. 

https://github.com/tedchoward/Frontier

### Policy about who writes

People are starting to paste huge documents from ChatGPT or Claude into issues sections of repos, and I want to stamp that out right now, if not everywhere, here. It's realllly rude to have a bot speak for you, and then to not speak to us as if we're all busy people who need you to get to the point. 

That said, Claude is much better at writing up the issues than I am. But it's posts will be carefully identitifed, and probably in a special folder on the repo, pointed to by me. 

We're all building with these tools now, and they're fantastic, but this is a place for humans to communicate with humans. 

