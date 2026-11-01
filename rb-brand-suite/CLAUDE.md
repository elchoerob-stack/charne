# RB Brand client books

Three page-turning client books (Listing Presentation, Buyer Guide, Moving Day Pack) in English
and Afrikaans, built from `src/` into single self-contained HTML files, PDFs and a one-page
StallFlow pricing proposal.

## Build

```
python3 src/build.py      # books, home pages and the interactive demo
node src/make_pdf.js      # showcase PDFs (pdf/) and the pricing proposal
node src/check_devices.js # device check, see below
```

Edit `src/`, never the built files: a rebuild overwrites them.

## Always check on other devices before anything is sent

Every change must be checked on the devices people will actually open it on. A file that works
on the computer it was built on is not done.

1. **Run `node src/check_devices.js` after every build.** It opens the demo as:
   - an iPhone's WhatsApp / Files preview (Quick Look runs no JavaScript, so the reading view
     must show every page);
   - iPhone Safari;
   - Android Chrome;
   - a laptop.

   Each book is opened in both languages, and the check confirms photos, page counts, one page
   shown at a time, no sideways scrolling and that Back works. Exit code 1 means **do not send**.
   Look at the screenshots in `.pdf-work/device-check/`; don't just trust the ticks.
2. **Check by hand on a real iPhone and a real Android phone** before a file goes to anyone.
   The script runs Chromium with an iPhone-sized screen. It does not run Safari's engine, so it
   cannot prove an iPhone works. Open the file from WhatsApp on both phones, as the recipient will.
3. **Open the PDFs on a phone too.** They are what most recipients will read.
4. **Say what was and wasn't checked** when handing files over: name the devices tested, and
   say plainly if a real-device check is still outstanding.

## Sending to clients: PDF first

iPhones open HTML files from WhatsApp and Files in Quick Look, which runs no JavaScript, so the
interactive book can't work there. So:

- **The client gets a PDF.** Agents personalise a book, tap **📄 Save as PDF** and send that file.
  It opens on every phone, and its WhatsApp, call and "Sign the mandate" buttons stay links.
  `check_devices.js` confirms the links survive.
- **Every HTML file must stay readable without JavaScript.** Book mode only switches on once a
  script adds `html.js`; without it, pages stack up to scroll through, sized to the screen. A
  saved client copy drops the `js` class so it opens readable everywhere. Any new feature that
  needs JavaScript must still look right without it.
- **Nothing may depend on a web link to load** (logo, photos, fonts aside): previews and offline
  phones can't fetch them. The RB Brand logo goes in as `src/logo.png`, built into every file.
