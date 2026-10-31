"""Build the RB Brand books: wraps each src/<book>.html page set in the shared shell
(book.css + book.js inlined) so every book, and every client copy saved from it,
is a single self-contained HTML file.  Run:  python3 src/build.py"""
import pathlib, re

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
