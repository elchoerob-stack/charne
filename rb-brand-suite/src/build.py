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
    return '\n'.join(f'.ph[data-img="{k}"]{{--img:url({data_uri(k)})}}' for k in keys)

# RB Brand's logo: the text mark until the real logo file is supplied. Put it in src/ as
# logo.png and it is built into every file (a web link would break in iPhone previews and offline).
_logo = SRC / 'logo.png'
LOGO = ('<img class="logo" alt="RB Brand Real Estate" src="data:image/png;base64,' + base64.b64encode(_logo.read_bytes()).decode() + '">'
        if _logo.exists() else '<b class="wm">RB <i></i> BRAND</b>')

# Interface text per language. Book pages are translated in src/<book>.html (English)
# and src/<book>.af.html (Afrikaans); everything else that the reader sees is here.
LANGS = {
  'en': dict(
    suffix='', other='af', label='EN', otherLabel='AF',
    books={'listing': ('Listing Presentation', 'Let’s sell your home, beautifully'),
           'buyer': ('Buyer Guide', 'Let’s find your next home'),
           'moving': ('Moving Day Pack', 'Congratulations on your new home')},
    edit='✎ Edit', save='⬇ Interactive copy', musicOn='♪ Music on', print='📄 Save as PDF', reset='Start again from the blank template',
    hint='<b>Edit mode:</b> tap any text to change it · tap a photo to replace it · tap a button to set its link. Anything still <span style="background:rgba(224,164,88,.45)">[in brackets]</span> needs filling in. Your work saves on this device automatically. When done, tap <b>📄 Save as PDF</b> and send the client that PDF: it opens on every phone, iPhones included.',
    open='Open the book', openNote='Soft music will play · swipe or tap the page edges to turn · <a href="#" id="quietOpen" style="color:#a9bde3">open without music</a>',
    prev='‹ Prev', next='Next ›', allBooks='‹ All books',
    demoFlag='Concept demo · names, figures, reviews and photos are placeholders',
    ui=dict(edit='✎ Edit', doneEditing='✓ Done editing', musicOn='♪ Music on', musicOff='♪ Music off',
            waPrompt='WhatsApp number (e.g. 082 000 0000):', telPrompt='Phone number:',
            linkPrompt='Link for this button (leave empty to hide it):',
            resetConfirm='Clear everything you typed and start again from the blank template?',
            saveConfirm='{n} spot(s) still show [bracketed] placeholder text (highlighted in Edit mode).\n\nSave the client copy anyway?')),
  'af': dict(
    suffix='.af', other='en', label='AF', otherLabel='EN',
    books={'listing': ('Verkopersaanbieding', 'Kom ons verkoop u huis, met styl'),
           'buyer': ('Kopersgids', 'Kom ons vind u volgende huis'),
           'moving': ('Trekdagpakket', 'Baie geluk met u nuwe huis')},
    edit='✎ Wysig', save='⬇ Interaktiewe kopie', musicOn='♪ Musiek aan', print='📄 Stoor as PDF', reset='Begin weer van die leë sjabloon af',
    hint='<b>Wysigmodus:</b> tik op enige teks om dit te verander · tik op ’n foto om dit te vervang · tik op ’n knoppie om sy skakel te stel. Alles wat nog <span style="background:rgba(224,164,88,.45)">[tussen hakies]</span> staan, moet ingevul word. U werk word outomaties op hierdie toestel gestoor. Tik op <b>📄 Stoor as PDF</b> wanneer u klaar is en stuur daardie PDF aan die kliënt: dit maak op elke foon oop, ook iPhones.',
    open='Maak die boek oop', openNote='Sagte musiek sal speel · swiep of tik op die bladsyrande om te blaai · <a href="#" id="quietOpen" style="color:#a9bde3">maak oop sonder musiek</a>',
    prev='‹ Vorige', next='Volgende ›', allBooks='‹ Alle boeke',
    demoFlag='Konsepdemo · name, syfers, resensies en foto’s is plekhouers',
    ui=dict(edit='✎ Wysig', doneEditing='✓ Klaar', musicOn='♪ Musiek aan', musicOff='♪ Musiek af',
            waPrompt='WhatsApp-nommer (bv. 082 000 0000):', telPrompt='Telefoonnommer:',
            linkPrompt='Skakel vir hierdie knoppie (laat leeg om dit te versteek):',
            resetConfirm='Vee alles uit wat u getik het en begin weer van die leë sjabloon af?',
            saveConfirm='{n} plek(ke) wys nog [tussen hakies] plekhouerteks (uitgelig in Wysigmodus).\n\nStoor die kliëntkopie in elk geval?')),
}
BOOKS = [  # key, source fragment stem, output file stem
    ('listing', 'listing', 'listing-presentation'),
    ('buyer', 'buyer', 'buyer-guide'),
    ('moving', 'moving', 'moving-day-pack'),
]
LANG_SWITCH = ('<span class="langsw edit-only" role="group" aria-label="Language">'
               '<b aria-current="true">{label}</b><a href="{other_href}" data-lang="{other}">{otherLabel}</a></span>')

SHELL = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>document.documentElement.classList.add('js')</script>
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
  <h1><a class="edit-only back" href="{home}">‹</a>{title}</h1>
  <div class="tools">
    {langsw}
    <button class="edit-only" id="editBtn">{edit}</button>
    <button class="edit-only" id="saveBtn">{save}</button>
    <button id="musicBtn">{musicOn}</button>
    <button class="solid" onclick="window.print()">{print}</button>
    <button class="edit-only" id="resetBtn" title="{reset}">↺</button>
  </div>
</div>
<div id="hint" class="edit-only">{hint}</div>
<div id="intro">
  <div>
    <b class="wm">RB <i></i> BRAND</b>
    <div class="t">{intro}</div>
    <div class="s">Where Dedication Meets Excellence</div>
    <button id="openBook">{open}</button>
    <p>{openNote}</p>
  </div>
</div>
<div id="stage"><div id="book">
{pages}
</div></div>
<div class="nav"><button id="prev">{prev}</button><span id="count"></span><button id="next">{next}</button></div>
<div id="credit"></div>
<input type="file" id="photoInput" accept="image/*" hidden>
<script>
const UI = {ui};
{js}
</script>
{extra}
</body>
</html>
"""

def fill(template, values):
    """Replace {key} tokens one by one (CSS and JS are full of braces, so no str.format)."""
    for k, v in values.items():
        template = template.replace('{' + k + '}', v, 1 if k in ('css', 'js', 'pages', 'extra', 'photos') else -1)
    return template

css, js = (SRC / 'book.css').read_text(), (SRC / 'book.js').read_text()
built, reader_pages = {}, {}  # (lang, key) -> html / finished pages
for lang, L in LANGS.items():
    O = LANGS[L['other']]
    for key, src, out in BOOKS:
        frag = (SRC / f'{src}{L["suffix"]}.html').read_text()
        pages, _, extra = frag.partition('<!--SCRIPT-->')
        if not extra.strip():  # a translation with no text in its script reuses the English script
            extra = (SRC / f'{src}.html').read_text().partition('<!--SCRIPT-->')[2]
        pages = pages.replace('{{logo}}', LOGO)
        pages = re.sub(r""" style="--img:url\('\{\{img:(\w+)\}\}'\)\"""", r' data-img="\1"', pages)
        title, intro = L['books'][key]
        html = fill(SHELL, {
            'lang': lang, 'title': title, 'intro': intro, 'home': f'index{L["suffix"]}.html',
            'langsw': fill(LANG_SWITCH, {'label': L['label'], 'otherLabel': L['otherLabel'], 'other': L['other'],
                                         'other_href': f'{out}{O["suffix"]}.html'}),
            **{k: L[k] for k in ('edit', 'save', 'musicOn', 'print', 'reset', 'hint', 'open', 'openNote', 'prev', 'next')},
            'ui': json.dumps(L['ui'], ensure_ascii=False),
            'css': css, 'photos': photo_css(pages), 'js': js, 'pages': pages.strip(), 'extra': extra.strip()})
        (OUT / f'{out}{L["suffix"]}.html').write_text(html)
        built[lang, key] = html
        reader_pages[lang, key] = pages.strip()
        print('built', f'{out}{L["suffix"]}.html')

# ---- Home pages ----
hubs = {}
for lang, L in LANGS.items():
    hub = (SRC / f'index{L["suffix"]}.html').read_text()
    hub = re.sub(r'\{\{thumb:(\w+)\}\}', lambda m: data_uri(m.group(1), 700), hub)
    (OUT / f'index{L["suffix"]}.html').write_text(hub)
    hubs[lang] = hub
    print('built', f'index{L["suffix"]}.html')

# ---- Concept demo: the home page and all three books, in both languages, in ONE file,
# so it can be sent on WhatsApp or email and opened on any phone or computer ----
FLAG = ('<div style="width:min(794px,100%);margin:0 0 12px;padding:8px 14px;border:1px dashed #E0A458;'
        'color:#E0A458;font-size:12px;letter-spacing:.12em;text-transform:uppercase;text-align:center">{t}</div>')
books, used = {}, set()
for (lang, key), h in built.items():
    L = LANGS[lang]; out = dict((k, o) for k, _, o in BOOKS)[key]
    h = re.sub(r'<a class="edit-only back" href="[^"]*">‹</a>',  # back to the demo's home page
               f'<a class="edit-only back" href="#" onclick="parent.postMessage(\'rb-close\', \'*\'); return false" style="font-size:15px;letter-spacing:.12em;opacity:.8;display:block;margin-bottom:4px">{L["allBooks"]}</a>', h)
    h = re.sub(r'<a href="[^"]*" data-lang="(\w+)">',  # the language switch reopens this book in the other language
               lambda m: f'<a href="#" data-lang="{m.group(1)}" onclick="parent.postMessage(\'rb-lang:{m.group(1)}\', \'*\'); return false">', h)
    h = h.replace('<div id="hint"', FLAG.replace('{t}', L['demoFlag']) + '\n<div id="hint"', 1)
    # each photo is stored once for the whole demo and put back when a book opens
    m = re.search(r'<style id="photos">\n(.*?)\n</style>', h, re.S)
    keys = re.findall(r'\.ph\[data-img="(\w+)"\]', m.group(1)); used.update(keys)
    h = h.replace(m.group(0), '<style id="photos">/*PHOTOS:' + ','.join(keys) + '*/</style>')
    books.setdefault(lang, {})[out] = h
PHOTO_CSS = '\n'.join(f'.ph[data-img="{k}"]{{--img:url({data_uri(k)})}}' for k in sorted(used))

REVIEW = {
 'en': """
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
  </div>""",
 'af': """
  <div class="review">
    <span class="rv-tag">Konsepdemo · vir hersiening</span>
    <p>Voorberei deur Charné Robilliard vir hersiening deur die prinsipaal. Dit is ’n werkende konsep: die boeke maak oop, blaai om en kan verpersoonlik word, maar alle name, syfers, resensies en foto’s is plekhouers. Niks is aan kliënte gestuur nie.</p>
    <h3>Waaroor ek graag u insette wil hê</h3>
    <ol>
      <li>Is u gelukkig dat die boeke RB Brand se naam, logo en kleure dra soos gewys?</li>
      <li>Die kommissiekoers en bewoording vir die verkoper se “in die hand”-bladsy.</li>
      <li>Ons PPRA- en Getrouheidsfondsbesonderhede, en watter onlangse verkopings en Google-resensies ons mag uitlig.</li>
      <li>Moet die hele span hierdie boeke gebruik?</li>
    </ol>
  </div>"""}
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
// Each book (in English and Afrikaans) is stored inside this one file and opened over the
// home page when its card is tapped. Photos are stored once and put back into a book as it opens.
const BOOKS = %BOOKS%, PHOTOS = {};
document.getElementById('photos').textContent.replace(/\\.ph\\[data-img="(\\w+)"\\]\\{--img:url\\(([^)]*)\\)\\}/g, (_, k, u) => (PHOTOS[k] = u));
const viewer = document.getElementById('viewer'), frame = document.getElementById('frame');
let lang = 'en', current = null;
try { if (localStorage.getItem('rb-lang') === 'af') lang = 'af'; } catch (e) {}
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.querySelectorAll('[data-hub]').forEach(h => h.hidden = h.dataset.hub !== l);
  try { localStorage.setItem('rb-lang', l); } catch (e) {}
}
function bookHTML(k) {
  return BOOKS[lang][k].replace(/\\/\\*PHOTOS:([\\w,]*)\\*\\//, (_, keys) =>
    keys.split(',').filter(Boolean).map(x => '.ph[data-img="' + x + '"]{--img:url(' + PHOTOS[x] + ')}').join('\\n'));
}
function openBook(k) { current = k; frame.srcdoc = bookHTML(k); viewer.hidden = false; document.body.style.overflow = 'hidden'; }
function closeBook() { current = null; viewer.hidden = true; frame.srcdoc = ''; document.body.style.overflow = ''; }
document.querySelectorAll('a[data-book]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); history.pushState({ book: a.dataset.book }, ''); openBook(a.dataset.book);
}));
document.querySelectorAll('a[data-lang]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setLang(a.dataset.lang); }));
addEventListener('message', e => {
  if (e.data === 'rb-close' && !viewer.hidden) history.back();
  if (typeof e.data === 'string' && e.data.startsWith('rb-lang:') && current) { setLang(e.data.slice(8)); openBook(current); }
});
addEventListener('popstate', closeBook); // the phone's Back button closes the book
setLang(lang);
</script>
"""
# ---- Reading view: iPhone's Quick Look (what WhatsApp and Files use to open an HTML file)
# runs no scripts, so the interactive books can't open there. Inside <noscript>, every page of
# every book is laid out to scroll through instead, with photos and calculator results filled in.
def rand(n): return 'R ' + f'{round(n):,}'.replace(',', ' ')
def num(v): return float(re.sub(r'[^\d.]', '', v) or 0)
def static_pages(html):
    m = re.search(r'data-key="home" data-img="(\w+)"', html)  # mock-ups show the cover photo
    if m: html = html.replace('data-mirror="home"', f'data-mirror="home" data-img="{m.group(1)}"')
    inp = dict(re.findall(r'data-k="(\w+)" value="([^"]*)"', html))
    out = {}
    if 'cancel' in inp:  # seller's walk-away calculator (VAT defaults to 15%)
        price, bond = num(inp['price']), num(inp['bond'])
        comm = price * num(inp['comm']) / 100 * 1.15
        fees, other = num(inp['cancel']) + num(inp['certs']), num(inp['other'])
        out = dict(price=rand(price), comm='– ' + rand(comm), fees='– ' + rand(fees), other='– ' + rand(other),
                   bond='– ' + rand(bond), costs=rand(comm + fees + other), net=rand(price - comm - fees - other - bond))
    elif 'tfees' in inp:  # buyer's cost calculator, SARS transfer duty from 1 April 2025
        price, dep = num(inp['price']), num(inp['dep']); loan = price - dep
        r, n = num(inp['rate']) / 1200, num(inp['yrs']) * 12
        pmt = loan * r / (1 - (1 + r) ** -n)
        duty = next((b + (price - f) * t for f, b, t in [(13310000, 1241456, .13), (2994800, 106784, .11),
                     (2329300, 53544, .08), (1663800, 13614, .06), (1210000, 0, .03)] if price > f), 0)
        tf, bf = num(inp['tfees']), num(inp['bfees'])
        out = dict(pmt=rand(pmt), loan=rand(loan), duty=rand(duty), tfees=rand(tf), bfees=rand(bf), dep=rand(dep), cash=rand(dep + duty + tf + bf))
    for k, v in out.items():
        html = re.sub(rf'(data-out="{k}"[^>]*>)[^<]*', lambda m: m.group(1) + v, html)
    return html

READER_CSS = """body{color:#FDFBF6}
.wrap .wm,.wrap h1{color:#FDFBF6}
.reader{color:var(--ink)}
.reader{width:100%;max-width:820px;margin:44px auto 0}
.reader h2.rd{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:30px;color:#FDFBF6;margin:36px 0 8px}
.reader h3.rd{font-size:12px;font-weight:600;letter-spacing:.25em;text-transform:uppercase;color:#E0A458;margin:26px 0 12px}
.reader .rd-note{background:rgba(224,164,88,.12);border:1px solid #E0A458;border-radius:6px;padding:14px 16px;color:#e4e8f0;font-size:14px;line-height:1.55}
.reader .page{position:relative;inset:auto;visibility:visible;margin:0 auto 16px;box-shadow:0 10px 24px rgba(0,0,0,.35)}
.reader .page::before{display:none}
.reader input,.reader select,.reader a{pointer-events:none}
.grid,.how,.langsw{display:none!important}
.wrap{width:100%}
@media (max-width:840px){.reader .page{zoom:.84}}
@media (max-width:700px){.reader .page{zoom:.71}}
@media (max-width:600px){.reader .page{zoom:.59}}
@media (max-width:500px){.reader .page{zoom:.51}}
@media (max-width:440px){.reader .page{zoom:.48}}
@media (max-width:414px){.reader .page{zoom:.45}}
@media (max-width:390px){.reader .page{zoom:.41}}
@media (max-width:360px){.reader .page{zoom:.36}}
"""
READ_TEXT = {
  'en': ('Reading view', 'This preview can’t run the interactive book, so here are all the pages to scroll through. For page turning, music and live calculators, open the file in Chrome or Safari on a computer.'),
  'af': ('Leesaansig', 'Hierdie voorskou kan nie die interaktiewe boek laat loop nie, so hier is al die bladsye om deur te blaai. Maak die lêer in Chrome of Safari op ’n rekenaar oop vir blaai-effekte, musiek en lewendige sakrekenaars.'),
}
sections = []
for lang, L in LANGS.items():
    sections.append(f'<h2 class="rd">{"English" if lang == "en" else "Afrikaans"}</h2>'
                    f'<p class="rd-note"><b>{READ_TEXT[lang][0]}.</b> {READ_TEXT[lang][1]}</p>')
    for key, _, _ in BOOKS:
        sections.append(f'<h3 class="rd">{L["books"][key][0]}</h3>' + static_pages(reader_pages[lang, key]))
READER = ('<noscript><style>\n' + css + '\n' + READER_CSS + '</style>\n<div class="reader">\n'
          + '\n'.join(sections) + '\n</div></noscript>\n')

def body_of(html):
    return html[html.index('<body>') + 6:html.index('</body>')]
demo = hubs['en']
demo = demo.replace('<title>RB Brand Books</title>', '<title>RB Brand Client Books</title>')
demo = demo.replace('</style>', REVIEW_CSS + '</style>', 1)
parts = []
for lang in LANGS:
    b = re.sub(r'(<p class="lede">.*?</p>)', lambda m: m.group(1) + REVIEW[lang], body_of(hubs[lang]), count=1, flags=re.S)
    b = re.sub(r'(<a class="card[^"]*") href="([\w-]+?)(?:\.af)?\.html"', r'\1 href="#" data-book="\2"', b)  # book cards
    parts.append(f'<div data-hub="{lang}"{" hidden" if lang != "en" else ""}>{b}</div>')
demo = demo[:demo.index('<body>') + 6] + '\n'.join(parts) + demo[demo.index('</body>'):]
demo = demo.replace('</head>', '<style id="photos">\n' + PHOTO_CSS + '\n</style>\n</head>', 1)
demo = demo.replace('</body>', READER + OPEN_JS.replace('%BOOKS%', json.dumps(books, ensure_ascii=False).replace('</', '<\\/')) + '</body>')
DEMO_NAME = 'RB Brand Client Books - Interactive.html'
(OUT / DEMO_NAME).write_text(demo)
print('built', DEMO_NAME)

# ---- Overview page for the PDF (src/make_pdf.js turns it and the books into one PDF) ----
work = OUT / '.pdf-work'; work.mkdir(exist_ok=True)
for suffix in ('', '.af'):
    ov = re.sub(r'\{\{thumb:(\w+)\}\}', lambda m: data_uri(m.group(1), 700), (SRC / f'overview{suffix}.html').read_text())
    (work / f'overview{suffix}.html').write_text(ov)
