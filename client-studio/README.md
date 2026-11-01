# Charné Client Studio

Listing presentations and buyer guides for Charné Snyman (RB Brand Real Estate),
set up per client in a few minutes.

**The file to use is `Charne-Client-Studio.html`.** It is one self-contained file:
fonts, the RB Brand logo and all the code are inside it. No install, no login,
no internet needed (except to open WhatsApp).

## Setting it up on Charné's computer

1. Save `Charne-Client-Studio.html` to the Desktop (or Documents).
2. Double-click it. It opens in Chrome or Edge.
3. The first time, it asks for Charné's details: WhatsApp number, photo, FFC number,
   bio. Fill them in once. The WhatsApp number is what makes the clients'
   "Let's launch" and wish-list buttons reach Charné.

Clients are saved in that browser on that computer. Always open the studio in
the same browser. **My details → Download a backup** saves everything to one
file, which **Restore from a backup** brings back, on any computer.

## What it makes

| | Pages | For |
|---|---|---|
| **Listing Presentation** | 12 | The valuation appointment. Their home on the cover, thank-you note, the home, comparable sales, pricing with a chart, why the first weeks count, marketing plan, dated launch plan, what they'll walk away with, offer-to-transfer steps, the documents needed, and a "Let's launch" close. |
| **Buyer Guide** | 9 | New buyers. Welcome, buying step by step, a live repayment calculator, a transfer-cost calculator (SARS transfer duty), suburb guides, a wish list that goes to Charné's WhatsApp, a viewing checklist, and next steps. |

Each one can be:

- **Presented** full screen on the laptop (arrow keys, Esc to finish).
- **Saved as a PDF** (A4 landscape, one page per sheet).
- **Sent to the client**: a copy with only that client's details, which opens on
  any phone or computer. The calculators and wish list work in it.

## The 10-minute demo

The same run-sheet is inside the app under **How to demo**.

1. **Open the studio.** Show the two cards. *"Two tools: one for the valuation,
   one for every new buyer."*
2. **Listing Presentation → Start for a client.** Sellers' names and the date.
   *"Their name goes on the cover. Watch the right-hand side."*
3. **Their home.** Address, suburb, rooms. Drag in a photo, or copy one and press
   Ctrl+V. Tick features, then **Write it for me**.
4. **Sales & price.** Three sold prices with sizes, then **Use this to fill in
   the range**. *"Real sales, not asking prices. The chart draws itself."*
5. **Walk-away figure.** Commission and their bond. Page 9 shows what they keep.
6. **Marketing & launch.** Tick the channels, pick a launch date.
7. **Present.** Arrow keys through the 12 pages.
8. **Send to client.** Download their copy, open WhatsApp, drop the file in.
9. **Buyer Guide** (2 minutes). Budget and three areas. On page 4, change the
   price live. On page 7, the wish list goes to Charné's WhatsApp.

Before the demo: fill in My details, have one house photo on the desktop
(iPhone photos must be JPG), do a dry run, and use **See an example** as a
safety net.

## Numbers and rules it uses

- **Transfer duty:** the SARS table for property acquired from 1 April 2025,
  unchanged for 2026/27. The same table as `skills/keystone-desk/scripts/costs.py`;
  the two agree at every bracket edge. Re-check after each February Budget.
- **Prime rate:** 10.75% (SARB, September 2026). Change the default in
  My details when it moves.
- **Affordability:** repayment at most about 30% of gross income.
- **Attorney fees are never guessed.** The cost calculator shows "Quote needed"
  until a quote is typed in.
- **Commission:** percentage of price plus 15% VAT, unless marked VAT-inclusive.
- The offer to purchase is described as signed **in ink** (ECT Act).
  Compliance certificates: electrical always; electric fence and gas if present;
  beetle and plumbing when the offer requires them.

## Changing it

The source is in `src/` (`studio.html`, `studio.css`, `app.js`), with fonts and
logos in `assets/`. After a change, rebuild the single file:

```bash
python3 client-studio/build.py
```

The suburb descriptions, marketing channels and feature list are near the top
of `src/app.js`. Charné can also edit any suburb description per buyer, in the
app.
