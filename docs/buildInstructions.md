# Building Electric Frontier from the helloFrontier repo

How to go from the source in the repo's code folder to the app you double-click. Written by CC, 10/4/26, from the build that made 0.4.99 through 0.4.102 on a Mac; DW's word that the build instructions are CC's to write. Scott Hanson built it this way from the repo on 10/4, for both Intel and Apple silicon.

## What you need

1. A Mac. The build makes a Mac app (electron-packager, platform darwin).
2. Node 16 and npm 8. The build was made with node 16.15.0 and npm 8.5.5; Electron 22 is pinned, and its native module (better-sqlite3) is rebuilt against Electron's own engine, so the node you have only has to run the build scripts.
3. The repo cloned, with its code folder: code/frontier (the server, the pages, the desktop app), code/usertalk (the language), code/odb (the reader and writer of Frontier's own file formats), code/concord (the outliner). frontier's config.json points at the others by relative path (../usertalk, ../concord), which is why the four folders have to sit beside each other.

## The steps

All of these run in a terminal. The first two take a while the first time; they download the packages.

1. Install the server's packages. In code/frontier:

```bash
npm ci
```

2. Install the desktop app's packages, Electron included. In code/frontier/electronApp:

```bash
npm ci
```

3. Build the app. In code/frontier:

```bash
node misc/buildDesktopApp.js data/seed.db
```

The database argument is required: data/seed.db is frontier.root, the database the app starts with. Without a database the script refuses to build.

The build stages everything into electronApp/desktopStaging (the app files, plus a server folder holding frontier, usertalk, odb, the pages and Concord), installs the server's packages there and rebuilds better-sqlite3 for Electron, then packages the app. The result is electronApp/dist/electricFrontier.zip, and the app itself is under electronApp/dist/electricFrontier/.

## Running it

Unzip, and double-click Electric Frontier. The first launch makes its data folder (see backupInstructions.md for where) and copies frontier.root into it; after that the app runs against its own copy and never touches the one in the build.

An app built this way isn't signed, so the Mac will say it can't check it for malicious software: right-click the app, choose Open, and open it anyway; once is enough.

## Intel and Apple silicon

The build script names the architecture in two places, both x64 (Intel): the better-sqlite3 rebuild and the electron-packager call, in misc/buildDesktopApp.js. For an Apple-silicon build, change both to arm64. An Intel build runs on Apple silicon under Rosetta.

## Running from the source without building

For working on the code itself you don't need the app. In code/frontier:

```bash
node trigger.js
```

serves on the port in config.json (5339), and the pages are at http://localhost:5339/odbbrowser/. The pages ask for the webeditPassword from config.json once and keep it. The desktop app is the same server wrapped in Electron, with its own config and database in its data folder.

## The two gates

Nothing ships that fails either. From code/frontier:

```bash
node misc/compileAll.js data/seed.db
```

parses every script in the database (the baseline is 24 that don't; they are the 2012 scripts the parser doesn't take yet), and

```bash
node misc/testBehavior.js data/seed.db
```

runs the behavior tests against a copy of it. The server-level gates (misc/testServerSurvives.js, testAgentsFresh.js, testHiddenTarget.js, testTools.js, testWebserver.js, testThreads.js, testWebsocket.js) each start a real server on a copy and check it; they take a database path the same way.
