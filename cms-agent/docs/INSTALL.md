# Installing Foreman

Foreman is a small server that runs on your Windows laptop (the Acer) and a
web console you install as an app on the laptop and on your phone. The phone
talks to the laptop over the network, so nothing is uploaded anywhere except
the Claude API calls the server makes.

## Part 1 — the server on your computer (once, about 15 minutes)

1. **Install Node.js 22 LTS.** Download from https://nodejs.org (the "LTS"
   button), run the installer, accept defaults. Open a new PowerShell window
   and check:
   ```powershell
   node --version    # v22.x
   ```
2. **Install Git** from https://git-scm.com/download/win (defaults are fine),
   or download the repository as a ZIP from GitHub and unzip it.
3. **Get the code.**
   ```powershell
   cd $HOME\Documents
   git clone https://github.com/elchoerob-stack/charne.git
   cd charne
   git checkout claude/grokbot-cms-agent-5vkq13
   cd cms-agent\server
   ```
4. **Install dependencies.**
   ```powershell
   npm install
   ```
   `better-sqlite3` ships prebuilt binaries for Windows; if you see a build
   error, install "Desktop development with C++" from the Visual Studio Build
   Tools and run `npm install` again.
5. **Configure.** Copy `.env.example` to `.env` and open it in Notepad:
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   Set at least:
   - `ANTHROPIC_API_KEY=` your key from https://console.anthropic.com
     (or run `ant auth login` once and leave it blank)
   - `CMS_AGENT_TOKEN=` a long random string if the phone will reach the
     server over anything other than your own Wi-Fi
   - `PUBLIC_URL=http://<laptop-ip>:8787` so links inside tickets work from
     other devices (find the IP with `ipconfig`, e.g. `192.168.1.23`)
   - the ticket channel section if you want escalations sent automatically
     (see `docs/USER_GUIDE.md` → Escalating)
6. **Run it.**
   ```powershell
   npm run dev
   ```
   You should see `Foreman (CMS Agent) listening on http://localhost:8787`.
   Open that address in Chrome or Edge.
7. **Check the tests once** (no API key needed):
   ```powershell
   npm test
   npx tsx eval\run.ts
   ```

### Start Foreman automatically at logon (recommended)

1. Create `C:\Users\<you>\Documents\charne\cms-agent\server\start-foreman.cmd`:
   ```
   @echo off
   cd /d %~dp0
   npm run build
   node dist\index.js
   ```
2. Task Scheduler → Create Task → Trigger "At log on" → Action "Start a
   program" pointing at that `.cmd` → tick "Run only when user is logged on".
   Foreman then runs in its own window like the cTrader agent does.

### Allow the phone through Windows Firewall

Run once in an elevated PowerShell:
```powershell
New-NetFirewallRule -DisplayName "Foreman 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

## Part 2 — install the console as a computer app

1. In Chrome or Edge open `http://localhost:8787`.
2. Click the gold **Install app** button in the top bar (or the install icon
   in the address bar → Install).
3. Foreman now opens in its own window from the Start menu, with the CMS eco
   icon. Pin it to the taskbar.

## Part 3 — install on your phone (Galaxy S25 Plus)

Foreman is a progressive web app, so it installs from the browser without an
app store.

1. Put the phone on the **same Wi-Fi** as the laptop, or install
   **Tailscale** on both (free; https://tailscale.com) so the phone can reach
   the laptop from anywhere, including a dealership. With Tailscale use the
   laptop's Tailscale IP (100.x.x.x) below.
2. Open **Chrome** on the phone and go to `http://<laptop-ip>:8787`
   (for example `http://192.168.1.23:8787`).
3. If you set `CMS_AGENT_TOKEN`, the page will ask for it once; it is kept
   on the phone.
4. Tap the **⋮ menu → Add to Home screen → Install** (or the **Install app**
   button in the top bar).
5. Foreman opens full-screen from the home screen with the icon. Dictation
   (🎙) uses Samsung/Google speech recognition; allow the microphone when
   asked. Photos of a screen can be attached with 🖼 or pasted.

Samsung Internet also works: **☰ → Add page to → Home screen**.

## Part 4 — the Workflow Recorder extension (Chrome on the laptop)

1. `chrome://extensions` → Developer mode on → **Load unpacked** →
   choose `cms-agent\recorder-extension`.
2. Click the extension → Server settings → URL `http://localhost:8787` and
   the token if set → Save.
3. Pin it to the toolbar so it is one click away during a rollout.

## Updating

```powershell
cd $HOME\Documents\charne
git pull
cd cms-agent\server
npm install
```
Restart Foreman. The database (`server\data\`) is kept.

## Where things live

| What | Where |
|---|---|
| Database, uploaded exports, built reports | `cms-agent\server\data\` |
| Promoted playbooks | `cms-agent\server\knowledge\playbooks.custom.json` |
| Eval cases and results | `cms-agent\server\eval\` |
| Settings | `cms-agent\server\.env` |
