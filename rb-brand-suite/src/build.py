"""Build the RB Brand books: wraps each src/<book>.html page set in the shared shell
(book.css + book.js inlined) so every book, and every client copy saved from it,
is a single self-contained HTML file.  Run:  python3 src/build.py"""
import base64, json, pathlib, re

SRC = pathlib.Path(__file__).parent
OUT = SRC.parent

PHOTOS = SRC / 'photos'  # free Unsplash photos, built into every file so nothing loads from the web
def data_uri(key, width=None):
    raw = (PHOTOS / f'{key}.jpg').read_bytes()
    if width:  # smaller copy for thumbnails
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(raw)); im = im.resize((width, round(im.height * width / im.width)))
        buf = BytesIO(); im.save(buf, 'JPEG', quality=72, optimize=True); raw = buf.getvalue()
    return 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()

def photo_css(html):
    """One shared rule per photo used, so each photo is stored once per file."""
    keys = sorted(set(re.findall(r'data-img="(\w+)"', html)))
    return '\n'.join(f'[data-img="{k}"]{{--img:url({data_uri(k)})}}' for k in keys)

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
<style id="photos">
{photos}
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
    pages = re.sub(r""" style="--img:url\('\{\{img:(\w+)\}\}'\)\"""", r' data-img="\1"', pages)
    html = SHELL.replace('{title}', title).replace('{intro}', intro)  # CSS/JS contain braces, so no str.format
    for key, val in (('{css}', css), ('{photos}', photo_css(pages)), ('{js}', js), ('{pages}', pages.strip()), ('{extra}', extra.strip())):
        html = html.replace(key, val, 1)
    (OUT / out).write_text(html)
    print('built', out)

# ---- Home page ----
hub = (SRC / 'index.html').read_text()
hub = re.sub(r'\{\{thumb:(\w+)\}\}', lambda m: data_uri(m.group(1), 700), hub)
(OUT / 'index.html').write_text(hub)
print('built index.html')

# ---- Concept demo: the home page and all three books in ONE file, so it can be
# sent on WhatsApp or email and opened on any phone or computer ----
import base64
DEMO_FLAG = ('<div style="width:min(794px,100%);margin:0 0 12px;padding:8px 14px;border:1px dashed #E0A458;'
             'color:#E0A458;font-size:12px;letter-spacing:.12em;text-transform:uppercase;text-align:center">'
             'Concept demo · names, figures, reviews and photos are placeholders</div>')
books = {}
for _, out, _, _ in BOOKS:
    h = (OUT / out).read_text()
    h = h.replace('<a class="edit-only" href="index.html">‹</a>',  # back to the demo's home page
                  '<a class="edit-only" href="#" onclick="parent.postMessage(\'rb-close\', \'*\'); return false" style="font-size:15px;letter-spacing:.12em;opacity:.8;display:block;margin-bottom:4px">‹ All books</a>')
    h = h.replace('<div id="hint"', DEMO_FLAG + '\n<div id="hint"', 1)
    books[out.removesuffix('.html')] = h

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
OPEN_JS = """
<div id="viewer" hidden><iframe id="frame" title="Book"></iframe></div>
<style>
#viewer{position:fixed;inset:0;z-index:100;background:#161c29}
#viewer iframe{width:100%;height:100%;border:0;display:block}
</style>
<script>
// Each book is stored inside this one file and opened over the home page when its card is tapped
const BOOKS = %s;
const viewer = document.getElementById('viewer'), frame = document.getElementById('frame');
function openBook(k) { frame.srcdoc = BOOKS[k]; viewer.hidden = false; document.body.style.overflow = 'hidden'; }
function closeBook() { viewer.hidden = true; frame.srcdoc = ''; document.body.style.overflow = ''; }
document.querySelectorAll('a[data-book]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); history.pushState({ book: a.dataset.book }, ''); openBook(a.dataset.book);
}));
addEventListener('message', e => { if (e.data === 'rb-close' && !viewer.hidden) history.back(); });
addEventListener('popstate', closeBook); // the phone's Back button closes the book
</script>
"""
hub = (OUT / 'index.html').read_text()
hub = hub.replace('<title>RB Brand Books</title>', '<title>RB Brand Books · Concept Demo</title>')
hub = hub.replace('</style>', REVIEW_CSS + '</style>', 1)
hub = re.sub(r'(<p class="lede">.*?</p>)', lambda m: m.group(1) + REVIEW, hub, count=1, flags=re.S)
hub = re.sub(r'href="([\w-]+)\.html"', r'href="#" data-book="\1"', hub)
hub = hub.replace('</body>', OPEN_JS.replace('%s', json.dumps(books).replace('</', '<\\/')) + '</body>')
(OUT / 'RB-Brand-Books-Concept-Demo.html').write_text(hub)
print('built RB-Brand-Books-Concept-Demo.html')

# ---- Overview page for the PDF (src/make_pdf.js turns it and the books into one PDF) ----
work = OUT / '.pdf-work'; work.mkdir(exist_ok=True)
ov = re.sub(r'\{\{thumb:(\w+)\}\}', lambda m: data_uri(m.group(1), 700), (SRC / 'overview.html').read_text())
(work / 'overview.html').write_text(ov)
