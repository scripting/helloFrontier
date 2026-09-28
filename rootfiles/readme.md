# rootfiles in Frontier

Frontier apps are also called root files because their names end with .root. They are also called Guest Databases, basically they are the apps of Frontier.

### frontier.root, guest databases

Frontier has one main root file called frontier.root. 

All the builtin verbs live there, as well as user prefs, big pieces of the menubar are edited with the outliner. It's where all the scripts and data for the core functionality live.

Then we added the ability to have extra databases, also called "guest databases" that are packages of functionality and user interfaces.

We're going to collect them here as examples and as ways to test new releases. 

A lot of the functionality in Frontier is written in scripts. 

### docserver.root

We started with docserver.root, because we needed to get to work on how we're going to do verb docs as we go forward, and it seemed to be a good test case, and it was. Getting it to run properly exposed some kernel bugs in the Atlantis version we're working on. 

You can see the site it builds at <a href="https://docserver.userland.com/">docserver.userland.com</a>. This was built in Sept 2026 with Atlantis and was quite a milestone.

To  download the file click on the link to docserver.root above and and press Cmd-Shift-S.

