# Hello Frontier

I'm working on a new version of Frontier, a complete rewrite, running in Electron, a project that could only be approached with the new AI tools, in this case Claude Code. 

To start it's just for sharing bits of code and documenting decisions I had to make while we're going along. And to give people with Frontier expertise a way to be involved and help Frontier emerge from its holiday, to return to party with us, same as it ever was. There will be a rule in this repo -- people only.

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

### Policy about who writes

People are starting to paste huge documents from ChatGPT or Claude into issues sections of repos, and I want to stamp that out right now, if not everywhere, here. It's realllly rude to have a bot speak for you, and then to not speak to us as if we're all busy people who need you to get to the point. 

That said, Claude is much better at writing up the issues than I am. But it's posts will be carefully identitifed, and probably in a special folder on the repo, pointed to by me. 

We're all building with these tools now, and they're fantastic, but this is a place for humans to communicate with humans. 

### What is Frontier?

When we want to know what Frontier does, we refer to the Frontier source code [archived](https://github.com/tedchoward/Frontier) by Ted C. Howard, archived in November 2011. 

### The role that AI plays

Claude Code wrote most of what's in the code folder. The exception is Concord, which was written by Kyle Shank. 

The code in Frontier.root came from two sources.

1. The main root file for the OPML Editor distribution of Frontier.  

2. Additions by me in 2026. Some things have changed, and others added for network features that didn't exist last time we worked on Frontier. 

### No pull requests

We can't deal with pull requests because we have a process for making changes. There's a lot of review. This is far from a new product, and breakage is of prime concern.  

If you see a problem, write a bug report. Include:

1. What you did.

2. What you expected.

3. What actually happened.

Screen shots can help. 

### Are you working with AI?

If so, in addition to downloading the <a href="https://github.com/scripting/helloFrontier/tree/master/code">code</a>, please also give <a href="https://github.com/scripting/helloFrontier/blob/master/docs/whatIsFrontier.md">whatIsFrontier.md</a> to your system, and it will know a lot more about Frontier and how it works than it can by reading the source, although the source is well commented, and explains a lot too. 

