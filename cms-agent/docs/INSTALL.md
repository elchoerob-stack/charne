# Installing Foreman

Foreman is one file. Download it, double-click it, and it does everything
else. No terminal, no Git, no Node, no `npm install`, and nothing to type
again the next time you want to use it.

---

## On the laptop (Windows)

1. Go to the repository's **Releases** page and download **`Foreman.exe`**.
   If there is no release yet, open the **Actions** tab, run the workflow
   called **Foreman for Windows**, and download `Foreman-windows-x64` from the
   finished run.
2. Put the file somewhere you will find it again — the Desktop is fine.
3. Double-click it.

The first run takes a few minutes because it unpacks itself and downloads the
browser it drives (about 150 MB, once). It prints something like this and
opens the console in your browser:

```
[foreman] Installed Foreman 1.0.0 in C:\Users\Jacques\AppData\Local\Foreman
[foreman] Fetching the browser Foreman drives (about 150 MB, once). It downloads in the background.
[foreman] Foreman 1.0.0 is running.
[foreman]   this computer            http://127.0.0.1:8787
[foreman]   works on this Wi-Fi      http://192.168.1.24:8787
[foreman]   access code              9ecd138cbc0b990a032939471b342cff
[foreman] Close this window to stop Foreman.
```

Every run after the first starts in a few seconds.

**The small black window is Foreman itself.** Leave it open while you work —
closing it stops Foreman, which is how you switch it off. Minimise it if it
is in the way.

Windows will show a **"Windows protected your PC"** box the first time, and
possibly a **Windows Defender Firewall** prompt.

* On the blue SmartScreen box: click **More info** → **Run anyway**. It says
  that because the file is not signed by a company Microsoft recognises, not
  because anything is wrong with it.
* On the firewall prompt: tick **Private networks** and click **Allow
  access**. Without that your phone cannot reach it.

### Where things end up

| What | Where |
| --- | --- |
| The program | `C:\Users\<you>\AppData\Local\Foreman\versions\` |
| Your database, signed-in sites, promoted playbooks | `…\Foreman\data\` |
| Settings (access code, API key, port) | `…\Foreman\foreman.env` |
| Logs, when something goes wrong | `…\Foreman\logs\` |
| Finished work (downloads, spreadsheets, notes) | `C:\Users\<you>\Foreman\` |

An update replaces the program folder and never touches the rest. To see all
of this at any time, open a Command Prompt where the file is and run
`Foreman.exe --where`, or make a shortcut with `--where` on the end.

### Starting it automatically

Press <kbd>Win</kbd>+<kbd>R</kbd>, type `shell:startup`, press Enter, and drop
a shortcut to `Foreman.exe` into the folder that opens. It will then start
when you log in.

---

## Add your Claude API key

Foreman records and replays tasks without a key. It needs one for the parts
that *think*: chat, diagnosis, the report an agent writes, and — most
importantly — working out what to do when a page has changed and a recorded
step no longer fits.

1. Open `C:\Users\<you>\AppData\Local\Foreman\foreman.env` in Notepad
   (`Foreman.exe --where` prints the exact path).
2. Add a line:

   ```
   ANTHROPIC_API_KEY=sk-ant-…
   ```

3. Save, close the Foreman window, and start it again.

---

## On the phone (Samsung S25+)

The console is a web app, so there is nothing to install from the Play Store.

1. With the phone on the same Wi-Fi as the laptop, open the console on the
   laptop and tap **Connect phone**. A QR code appears.
2. Scan it with the phone camera and open the link. The access code travels in
   the link, so you are signed in straight away.
3. In Chrome, tap **⋮ → Add to Home screen**. You now have a Foreman icon that
   opens full screen, with no browser bars.

### Making it work away from the Wi-Fi

The QR code above contains a Wi-Fi address, which stops working the moment you
leave the building. To have the phone reach Foreman from Upington, a hotel or
the car, install [Tailscale](https://tailscale.com/download) on the laptop and
on the phone and sign both into the same account — it is free for personal
use.

Foreman notices the Tailscale address on its own and starts handing that one
out instead. The QR code then contains an address that does not change when
you move, so the app on your home screen keeps working. See
[REMOTE_ACCESS.md](REMOTE_ACCESS.md) for the details and for the alternative
if you cannot install Tailscale.

---

## Is this safe?

* **Every request needs an access code.** Foreman generates a 32-character one
  on the first run and puts it in `foreman.env`. There is no way to reach the
  data without it, on any network.
* **It listens beyond your own machine only because it has that code.** With
  no code set, Foreman refuses to listen anywhere but the laptop itself.
* **Nothing is published to the internet.** Tailscale is a private link
  between your own devices. The optional Cloudflare tunnel *is* public, so
  Foreman refuses to start one unless the access code is strong.
* **Your passwords are never stored.** You sign into a site once in a real
  browser window; Foreman keeps the session cookie, not the password.
* **Your data stays on your laptop.** The only thing that leaves is the text
  of what you ask Claude.

If you ever think the access code has leaked, delete the
`CMS_AGENT_TOKEN=` line from `foreman.env` and restart — a new one is
generated, and every device has to be paired again.

---

## Updating

Download the newer `Foreman.exe` and replace the old one. Your database,
signed-in sites and settings are in a different folder and are left alone. The
previous version is kept in `versions\` in case you want to go back to it.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Port 8787 is taken by something else, so this copy is on 8788." | Nothing — an older copy or another program had the port and Foreman moved aside. The address it prints is the one to use. |
| "Foreman is already running on port 8787." | It is. The console opens; there is only ever one copy against one database. |
| "Foreman keeps stopping." | Open the log it names in `…\Foreman\logs\foreman.log`; the reason is at the bottom. |
| "The browser download did not finish." | Everything except running recorded tasks still works. It tries again next time you start it. Check `logs\browser-install.log` if it keeps failing. |
| The phone shows "can't reach this site" | Either the firewall prompt was refused (allow `Foreman.exe` on private networks in Windows Defender Firewall) or you are no longer on that Wi-Fi — that is what Tailscale is for. |

---

## Running from the source instead

You do not need this. It is here for when you want to change the code.

```powershell
cd $HOME\Documents\charne; git pull; cd cms-agent\server; npm install; npm run dev
```

Needs Node 22.13 or newer. `npm test` runs the test suite; `npm run payload`,
`npm run launcher` and `npm run icon` build the pieces the Windows workflow
assembles into `Foreman.exe`.
