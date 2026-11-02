# RB Brand Client Books — handoff brief

## What this is

Three branded, page-turning "client books" for **RB Brand Real Estate** (Pretoria East, South
Africa), built by StallFlow (Pty) Ltd. An estate agent personalises a book in a few minutes and
sends the client their own copy, usually as a PDF.

| Book | For | Pages |
|---|---|---|
| Listing Presentation / *Verkopersaanbieding* | Sellers, at the valuation: wins the mandate | 12 |
| Buyer Guide / *Kopersgids* | Prospective buyers | 9 |
| Moving Day Pack / *Trekdagpakket* | Registration day: handover, welcome guide, thank-you card | 4 |

Every book exists in **English and Afrikaans** (formal "u" form).

Status: **concept demo**. All names, figures, reviews and photos are placeholders. Anything in
`[square brackets]` is a placeholder an agent fills in.

## How it is built

Plain HTML, CSS and JavaScript. No framework and no server. Every output is **one self-contained
file**: CSS, JavaScript and photos are inlined, so a file can be sent on WhatsApp and opened anywhere.

```
src/
  book.css          shared design ("Jacaranda Twilight": navy #242E43, blue #314F8E, cream #FDFBF6,
                    jacaranda #8E6BBF, amber #E0A458; Cormorant Garamond + Noto Sans)
  book.js           the engine: page turning, tap-to-edit, photo upload, autosave, saving a client
                    copy, live calculators' helpers, and the music (an original beat played live by
                    the browser with the Web Audio API)
  listing.html      Listing Presentation pages (English)   listing.af.html  (Afrikaans)
  buyer.html        Buyer Guide pages                       buyer.af.html
  moving.html       Moving Day Pack pages                   moving.af.html
  index.html        home page linking the books             index.af.html
  overview.html     cover page for the showcase PDF         overview.af.html
  proposal.html     one-page StallFlow pricing proposal (StallFlow's own brand, not RB Brand's)
  photos/*.jpg      placeholder photos (Unsplash, free licence)
  build.py          wraps each book's pages in the shared shell -> one HTML file per book and
                    language, the home pages, and the single-file interactive demo
  make_pdf.js       showcase PDFs (both languages) and the proposal PDF (needs Playwright + pypdf)
  check_devices.js  device check: iPhone preview, iPhone Safari, Android, laptop, client copy, PDF
CLAUDE.md           project rules (read this: they apply to any change)
```

Build and check:

```
python3 src/build.py
node src/make_pdf.js
node src/check_devices.js   # must pass before anything is sent
```

**Edit `src/` only.** The `.html` and `.pdf` files at the top level are generated and are
overwritten on every build.

### Page fragments

Each `src/<book>.html` is a list of `<section class="page …">` elements, one per A4 page
(794 × 1123 px). Optional page script goes after a `<!--SCRIPT-->` marker. Build-time tokens:

- `{{logo}}`: the RB Brand logo (a text mark until `src/logo.png` is supplied)
- `style="--img:url('{{img:KEY}}')"`: a photo from `src/photos/KEY.jpg`

Useful attributes:

- `data-photo`: an agent can tap the photo to replace it
- `data-key="home"` / `data-mirror="home"`: the seller's home photo on the cover is repeated
  on the marketing mock-ups
- `data-link="url|wa|tel"`: a button whose link the agent sets in edit mode
- `data-filename`: the text used to name the saved client copy

The calculators are the seller's walk-away calculator and the buyer's transfer-duty and bond
calculator. The buyer's calculator uses the **SARS transfer duty brackets in force from 1 April
2025**, which were unchanged for 2026/27.

## Hard rules (do not break these)

1. **iPhones open HTML from WhatsApp/Files in Quick Look, which runs no JavaScript.** Every file
   must stay readable without scripts. Book mode only switches on when a script adds `html.js`;
   without it the pages stack up, sized to the screen. Any new feature needs a no-JavaScript
   fallback.
2. **The client deliverable is a PDF** (📄 Save as PDF). Its WhatsApp, call and sign buttons must
   stay working links.
3. **Nothing may load from the web** apart from Google Fonts: photos, logo and music are all
   built in.
4. **No copyrighted music.** The music is an original composition in `book.js`. Don't swap in a
   commercial song.
5. **No invented facts.** Sales figures, reviews and statistics stay as clearly marked
   placeholders until the agency supplies real ones.
6. **Keep both languages in step.** A change to an English page needs the same change to its
   Afrikaans page.
7. **Run `node src/check_devices.js` after every change**, then check by hand on a real iPhone
   and a real Android phone before sending anything.

## What to polish

- **Copy:** tighten the wording on every page so it is warm, confident and professional, in South
  African English and natural Afrikaans property language.
- **Design:** consistency of spacing, type sizes and alignment across pages, while keeping the
  existing colour palette and fonts.
- **Accessibility:** colour contrast (4.5:1 for text), tap targets of 44 px or more, and alt text.
- **Code:** readability of `book.js` and `build.py`, without changing behaviour.

Please list every change you make, page by page, so it can be reviewed.
