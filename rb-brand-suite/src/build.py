"""Build the RB Brand books: wraps each src/<book>.html page set in the shared shell
(book.css + book.js inlined) so every book, and every client copy saved from it,
is a single self-contained HTML file.  Run:  python3 src/build.py"""
import json, pathlib, re

SRC = pathlib.Path(__file__).parent
OUT = SRC.parent

U = lambda i, w=1400: f"https://images.unsplash.com/photo-{i}?auto=format&fit=crop&w={w}&q=70"
IMG = dict(  # free Unsplash photos used as placeholders until real ones are added
    hero=U('1757356657991-c3fd6e2e812e', 1600), dusk=U('1757359056339-22968344cce6'),
    white=U('1757361652977-218a1173e8d6'), classic=U('1570129477492-45c003edd2be', 900),
    garden=U('1606410688276-103f1982f342'), modern=U('1628744448840-55bdb2497bd4', 900),
    int1=U('1628744876497-eb30460be9f6'), int2=U('1631679706909-1844bbd07221', 900),
    int3=U('1616486338812-3dadae4b4ace', 900), keys=U('1560518883-ce09059eeffa'),
    keys2=U('1585914641050-fa9883c4e21c', 900), first=U('1758227365187-016878604d94'),
    newhome=U('1733897669171-e7cf3712cced', 900), bright=U('1633505899118-4ca6bd143043', 900),
)
LOGO = ('<img class="logo" src="https://www.rbbrandrealestate.co.za/assets/media/logo-home.ee14f19952f8320d747c2b8e4797f9e6.png" '
        'alt="RB Brand Real Estate" onerror="this.replaceWith(Object.assign(document.createElement(\'b\'),'
        '{className:\'wm\',innerHTML:\'RB <i></i> BRAND\'}))">')

SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div class="toolbar">
  <h1><a class="edit-only" href="index.html">‹</a>{title}</h1>
  <div class="tools">
    <button class="edit-only" id="editBtn">✎ Edit</button>
    <button class="edit-only" id="saveBtn">⬇ Save client copy</button>
    <button id="musicBtn">♪ Music on</button>
    <button class="solid" onclick="window.print()">Print / PDF</button>
    <button class="edit-only" id="resetBtn" title="Start again from the blank template">↺</button>
  </div>
</div>
<div id="hint" class="edit-only"><b>Edit mode:</b> tap any text to change it · tap a photo to replace it · tap a button to set its link. Anything still <span style="background:rgba(224,164,88,.45)">[in brackets]</span> needs filling in. Your work saves on this device automatically. When done, tap <b>Save client copy</b>.</div>
<div id="intro">
  <div>
    <b class="wm">RB <i></i> BRAND</b>
    <div class="t">{intro}</div>
    <div class="s">Where Dedication Meets Excellence</div>
    <button id="openBook">Open the book</button>
    <p>Soft music will play · swipe or tap the page edges to turn · <a href="#" id="quietOpen" style="color:#a9bde3">open without music</a></p>
  </div>
</div>
<div id="stage"><div id="book">
{pages}
</div></div>
<div class="nav"><button id="prev">‹ Prev</button><span id="count"></span><button id="next">Next ›</button></div>
<div id="credit"></div>
<input type="file" id="photoInput" accept="image/*" hidden>
<script>
{js}
</script>
{extra}
</body>
</html>
"""

BOOKS = [  # source fragment, output file, title, intro line
    ('listing.html', 'listing-presentation.html', 'Listing Presentation', 'Let’s sell your home, beautifully'),
    ('buyer.html', 'buyer-guide.html', 'Buyer Guide', 'Let’s find your next home'),
    ('moving.html', 'moving-day-pack.html', 'Moving Day Pack', 'Congratulations on your new home'),
]

css, js = (SRC / 'book.css').read_text(), (SRC / 'book.js').read_text()
for src, out, title, intro in BOOKS:
    frag = (SRC / src).read_text()
    pages, _, extra = frag.partition('<!--SCRIPT-->')
    pages = pages.replace('{{logo}}', LOGO)
    pages = re.sub(r'\{\{img:(\w+)\}\}', lambda m: IMG[m.group(1)], pages)
    html = SHELL.replace('{title}', title).replace('{intro}', intro)  # CSS/JS contain braces, so no str.format
    for key, val in (('{css}', css), ('{js}', js), ('{pages}', pages.strip()), ('{extra}', extra.strip())):
        html = html.replace(key, val, 1)
    (OUT / out).write_text(html)
    print('built', out)

# ---- Concept demo: the home page and all three books in ONE file, so it can be
# sent on WhatsApp or email and opened on any phone or computer ----
import base64
DEMO_FLAG = ('<div style="width:min(794px,100%);margin:0 0 12px;padding:8px 14px;border:1px dashed #E0A458;'
             'color:#E0A458;font-size:12px;letter-spacing:.12em;text-transform:uppercase;text-align:center">'
             'Concept demo · names, figures, reviews and photos are placeholders</div>')
books = {}
for _, out, _, _ in BOOKS:
    h = (OUT / out).read_text()
    h = h.replace('<a class="edit-only" href="index.html">‹</a>', '<a class="edit-only" href="javascript:history.back()">‹</a>')
    h = h.replace('<div id="hint"', DEMO_FLAG + '\n<div id="hint"', 1)
    books[out.removesuffix('.html')] = base64.b64encode(h.encode()).decode()

REVIEW = """
  <div class="review">
    <span class="rv-tag">Concept demo · for review</span>
    <p>Prepared by Charné Robilliard for review by the principal. This is a working concept: the books open, turn and can be personalised, but all names, figures, reviews and photos are placeholders. Nothing has been sent to clients.</p>
    <h3>What I’d love your input on</h3>
    <ol>
      <li>Are you happy for the books to carry the RB Brand name, logo and colours as shown?</li>
      <li>The commission rate and wording to use on the seller’s walk-away page.</li>
      <li>Our PPRA and Fidelity Fund details, and which recent sales and Google reviews we may feature.</li>
      <li>Should the whole team use these books?</li>
    </ol>
  </div>"""
REVIEW_CSS = """.review{margin:28px 0 0;background:rgba(224,164,88,.1);border:1px solid #E0A458;border-radius:6px;padding:22px 26px;color:#e4e8f0;line-height:1.6;font-size:15px}
.rv-tag{display:inline-block;background:#E0A458;color:#242E43;font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;padding:5px 12px;margin-bottom:12px}
.review h3{font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:#E0A458;margin:16px 0 8px}
.review ol{padding-left:20px}
"""
OPEN_JS = """<script>
// Each book is stored inside this file and opened as its own page when its card is tapped
const BOOKS = %s;
document.querySelectorAll('a[data-book]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const bytes = Uint8Array.from(atob(BOOKS[a.dataset.book]), c => c.charCodeAt(0));
  location.href = URL.createObjectURL(new Blob([bytes], { type: 'text/html' }));
}));
</script>
"""
hub = (OUT / 'index.html').read_text()
hub = hub.replace('<title>RB Brand Books</title>', '<title>RB Brand Books · Concept Demo</title>')
hub = hub.replace('</style>', REVIEW_CSS + '</style>', 1)
hub = re.sub(r'(<p class="lede">.*?</p>)', lambda m: m.group(1) + REVIEW, hub, count=1, flags=re.S)
hub = re.sub(r'href="([\w-]+)\.html"', r'href="#" data-book="\1"', hub)
hub = hub.replace('</body>', OPEN_JS % json.dumps(books) + '</body>')
(OUT / 'RB-Brand-Books-Concept-Demo.html').write_text(hub)
print('built RB-Brand-Books-Concept-Demo.html')
