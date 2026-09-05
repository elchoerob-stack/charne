# How Foreman becomes one file

Foreman started as a repository you cloned, built and ran from a terminal.
That is fine while you are writing it and hopeless when you just want to use
it: `git pull`, `npm install`, `npm run dev`, every single time. This describes
how it turned into a file you double-click, and what each piece is for.

## The shape of it

```
Foreman.exe                     a Node runtime with two things baked in
├── launcher.cjs                the small program that runs first
└── payload.tar.gz              everything Foreman actually is
    ├── server.cjs              the whole server, bundled into one file
    ├── web/                    the console
    ├── knowledge/              the knowledge base
    ├── node_modules/           Playwright
    └── foreman.json            which version this is
```

Nothing is downloaded at install time. The executable carries its own payload,
so the machine it lands on needs no Node, no npm, no Git and no network — the
first double-click unpacks it and starts it.

## What the launcher does

1. Works out where things go: `%LOCALAPPDATA%\Foreman` on Windows,
   `~/.foreman` elsewhere.
2. Reads `foreman.env`, **generating a 32-character access code** the first
   time. Foreman is never left open without one.
3. If this version is not already unpacked, unpacks the payload into
   `versions/<version>` and writes the version into `installed.txt`.
4. Starts the server as a child process and supervises it.
5. Waits for it to answer, prints the addresses and the access code, and opens
   the console.
6. Kicks off the Chromium download in the background if it has not happened
   yet.

Points 3 and 4 need a Node process. The executable *is* a Node runtime, so a
child is `spawn(process.execPath)` with a role in the environment — the same
binary, running a different branch of the same code.

## Three things that only showed up in the real binary

**`require()` inside a packaged executable resolves built-in modules and
nothing else.** It reports an absolute path as an unknown built-in rather than
loading the file. `createRequire(file)(file)` gives back an ordinary CommonJS
loader, which is what the server and browser-install roles need.

**`spawn(process.execPath)` with no arguments is right for the executable and
wrong for development.** Plain `node` with no script reads standard input and
exits immediately — which looks exactly like the server crashing on startup.
The launcher passes its own script path when it is not packaged.

**Waiting for Chromium before starting the server made a slow CDN look like a
broken install.** It is a 150 MB download, and everything except driving a
browser works without it, so it runs in the background now.

## Why Playwright is not bundled

Everything else the server needs — Express, the Anthropic SDK, the spreadsheet
reader — bundles into `server.cjs` cleanly. Playwright does not: its browser
registry resolves `browsers.json` and the browser binaries relative to its own
package directory, so once it is bundled it looks for those files next to the
bundle and does not find them. It stays a real package inside the payload.

The database is Node's built-in `node:sqlite`, chosen for exactly this reason:
a native addon would have to be compiled on the machine, which is how the
first install attempt ended up demanding Visual Studio.

## Program files and your files

They are deliberately in different folders:

| | |
| --- | --- |
| `versions/<version>/` | the program — replaced wholesale by an update |
| `data/` | the database, signed-in sites, promoted playbooks |
| `foreman.env` | access code, API key, port |
| `logs/` | what went wrong, when it did |

An update replaces the first and never touches the others. Promoted playbooks
moved out of `knowledge/` and into `data/` for this reason: they used to sit
next to the program, where an update would have taken them with it.

Unpacking goes into `<version>.partial` and is renamed into place at the very
end, so a machine that loses power halfway through starts on the old version
rather than on half of the new one. A payload without a `server.cjs` is
refused outright.

## Two things a real desktop does

**Something else is already on port 8787.** An old copy started from a
terminal, or an unrelated program. Foreman takes the next free port and says
so, rather than crash-looping on a port it can never have.

**You double-click it twice.** The second one finds the first — through the
port written into `running.json`, which is not necessarily the configured one
— opens the console and exits. Two copies against one database would run every
scheduled task twice.

## Building it

```bash
npm run payload    # bundle the server, copy the console, stage Playwright, tar it
npm run launcher   # bundle the launcher, write the single-executable config
npm run icon       # build foreman.ico from the app icons
```

Then, on Windows, what `.github/workflows/foreman-windows.yml` does: copy
`node.exe`, strip its signature, inject the blob with `postject`, set the icon
and version strings with `rcedit`. The workflow runs the type-check and the
tests first and fails the build if either does.

The Linux equivalent works the same way and is what the packaging was actually
tested with — the Windows executable itself is built by the workflow, not by
hand.
