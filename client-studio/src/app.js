/* Charné Client Studio — one file, no server.
   Studio mode: Charné sets up a Listing Presentation or Buyer Guide for a client,
   presents it full screen, saves a PDF, or sends the client their own copy.
   Viewer mode: the same file with one client's data baked in (what the client
   opens from WhatsApp). Everything is saved in this browser (IndexedDB). */
(function () {
'use strict';

// Captured before anything renders: the exported client copy is this file
// with the client's data placed in the cs-client script tag.
const SOURCE = '<!doctype html>\n' + document.documentElement.outerHTML;
const ASSETS = JSON.parse(document.getElementById('cs-assets').textContent);
const SHIPPED = (function () {
  const t = (document.getElementById('cs-client').textContent || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
})();

// ───────────────────────── utilities ─────────────────────────
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const NBSP = ' ';

function money(n) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const v = Math.round(Number(n));
  return (v < 0 ? '−' : '') + 'R' + NBSP + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
function moneyShort(n) {
  if (!n) return '—';
  if (n >= 1e6) return 'R' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm';
  return 'R' + Math.round(n / 1000) + 'k';
}
function moneyInput(n) { return n == null || n === '' ? '' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim().toLowerCase().replace(/^r/, '').replace(/[\s ]/g, '');
  if (!s) return null;
  let mult = 1;
  if (/m$/.test(s)) { mult = 1e6; s = s.slice(0, -1).replace(',', '.'); }
  else if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1).replace(',', '.'); }
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * mult);
}
function todayISO(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + (offsetDays || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function toDate(iso) { if (!iso) return null; const d = new Date(iso + (iso.length === 7 ? '-01' : '') + 'T12:00:00'); return isNaN(d) ? null : d; }
function fmtDate(iso, opts) {
  const d = toDate(iso); if (!d) return '';
  return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtMonth(iso) { return fmtDate(iso, { month: 'short', year: 'numeric' }); }
function addDays(iso, n) { const d = toDate(iso) || new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function nextSunday(iso) { const d = toDate(iso) || new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); }
function firstNameOf(names) {
  if (!names) return '';
  const parts = String(names).split(/\s*(?:&|,|\band\b|\ben\b)\s*/i).map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || '');
}
function greetName(c) { return (c.first || '').trim() || firstNameOf(c.names); }
function waNumber(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '27' + d.slice(1);
  return d;
}
function waLink(phone, text) { const n = waNumber(phone); return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || ''); }
function initials(name) { return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and')
    .replace(/[^\x20-\x7E]+/g, '-').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
}
function debounce(fn, ms) { let t; const d = function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; d.flush = () => { clearTimeout(t); fn(); }; return d; }
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

// Photos are stored as data URLs (so they travel inside the client's file) but
// shown through blob URLs, which keeps re-rendering the preview cheap.
const blobCache = new Map();
function src(dataUrl) {
  if (!dataUrl) return '';
  if (!dataUrl.startsWith('data:')) return dataUrl;
  if (blobCache.has(dataUrl)) return blobCache.get(dataUrl);
  try {
    const comma = dataUrl.indexOf(',');
    const mime = (dataUrl.slice(5, comma).split(';')[0]) || 'image/jpeg';
    const bin = atob(dataUrl.slice(comma + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    blobCache.set(dataUrl, url);
    return url;
  } catch (e) { return dataUrl; }
}
function readImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('none'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', quality || 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ───────────────────────── money rules ─────────────────────────
// SARS transfer duty, property acquired on or after 1 April 2025; unchanged
// for 1 April 2026 onward (sars.gov.za, updated 25 Feb 2026). Same table as
// the keystone-desk skill's costs.py. Re-check after each February Budget.
const DUTY = [[13310000, 1241456, 0.13], [2994800, 106784, 0.11], [2329300, 53544, 0.08], [1663800, 13614, 0.06], [1210000, 0, 0.03]];
function transferDuty(price, vatSale) {
  if (vatSale || !price) return 0;
  for (const [floor, base, rate] of DUTY) if (price > floor) return base + rate * (price - floor);
  return 0;
}
function repayment(principal, ratePct, years) {
  if (!principal || principal <= 0 || !years) return 0;
  const r = (ratePct || 0) / 1200, n = years * 12;
  return r ? principal * r / (1 - Math.pow(1 + r, -n)) : principal / n;
}
function maxBond(income, ratePct, years) {
  const pay = income * 0.30, r = (ratePct || 0) / 1200, n = years * 12;
  return r ? pay * (1 - Math.pow(1 + r, -n)) / r : pay * n;
}
function commission(price, pct, vatIncl) {
  const gross = (price || 0) * (pct || 0) / 100;
  const excl = vatIncl ? gross / 1.15 : gross;
  return { excl, vat: excl * 0.15, incl: excl * 1.15 };
}
function sellerNet(c, price) {
  const com = commission(price, num(c.commission), c.vatIncl);
  return price - com.incl - (num(c.bond) || 0) - (num(c.cancel) || 0) - (num(c.certs) || 0);
}
function compStats(c) {
  const rows = (c.comps || []).filter(r => num(r.price));
  const sold = rows.filter(r => r.status !== 'On the market');
  const withSize = sold.filter(r => num(r.size));
  const avg = sold.length ? sold.reduce((a, r) => a + Number(r.price), 0) / sold.length : null;
  const perM2 = withSize.length ? withSize.reduce((a, r) => a + Number(r.price) / Number(r.size), 0) / withSize.length : null;
  const indicative = perM2 && num(c.floor) ? perM2 * Number(c.floor) : null;
  return { rows, sold, avg, perM2, indicative };
}
const PRIME = 10.75; // SARB raised the repo rate to 7.25% in September 2026: prime 10.75%.

// ───────────────────────── content libraries ─────────────────────────
const FEATURES = ['Covered patio', 'Built-in braai', 'Pool', 'Garden', 'Solar power', 'Inverter & batteries', 'Borehole', 'Water tanks', 'Double garage', 'Automated garage doors', 'Open-plan living', 'Scullery', 'Study', 'Flatlet', 'Staff quarters', 'Walk-in closet', 'Fireplace', 'Views', 'Security estate', 'Pet-friendly', 'Fibre', 'Near schools'];
const FEATURE_LINE = {
  'Covered patio': 'Entertain on the covered patio.', 'Built-in braai': 'A built-in braai for long weekends.', 'Pool': 'A pool for summer afternoons.',
  'Garden': 'A garden with room to play.', 'Solar power': 'Solar power keeps the lights on.', 'Inverter & batteries': 'Inverter and batteries for load-shedding.',
  'Borehole': 'A borehole keeps the garden green.', 'Water tanks': 'Water tanks for backup.', 'Double garage': 'Double garage.',
  'Automated garage doors': 'Automated garage doors.', 'Open-plan living': 'Open-plan living that flows outside.', 'Scullery': 'A scullery keeps the kitchen clear.',
  'Study': 'A study for working from home.', 'Flatlet': 'A flatlet for family or extra income.', 'Staff quarters': 'Staff quarters.',
  'Walk-in closet': 'A walk-in closet in the main bedroom.', 'Fireplace': 'A fireplace for winter evenings.', 'Views': 'Views to wake up to.',
  'Security estate': 'Secure estate living.', 'Pet-friendly': 'Pet-friendly.', 'Fibre': 'Fibre ready.', 'Near schools': 'Close to good schools.'
};
const PROP_TYPES = ['Freehold house', 'Townhouse', 'Cluster home', 'Estate home', 'Apartment', 'Smallholding', 'Vacant stand'];
const SUBURBS = [
  ['Equestria', 'A favourite for secure townhouse complexes and estates in Pretoria East. Schools and shopping are close, with easy access to Lynnwood Road and the N4.'],
  ['Faerie Glen', 'Established and leafy, next to the Faerie Glen Nature Reserve. Good schools, shopping at Glen Village, and quick access to the N1 and N4.'],
  ['Moreleta Park', 'A large, family-friendly suburb with plenty of freehold homes and secure complexes, popular schools, and Woodlands Boulevard close by.'],
  ['Garsfontein', 'Established suburb with generous stands and mature gardens. Popular with families for its schools, with Menlyn and Woodlands Boulevard nearby.'],
  ['The Hills', 'The Hills Game Reserve Estate: secure estate living with game on the estate, walking trails and space to breathe, minutes from Pretoria East.'],
  ['Silver Lakes', 'Silver Lakes Golf Estate: an established secure estate built around a golf course, with larger homes and a strong community feel.'],
  ['Woodhill', 'Woodhill Golf Estate: secure golf-estate living with a clubhouse and walking routes, close to Woodlands Boulevard and Garsfontein Road.'],
  ['Mooikloof', 'Big stands, open space and horse-friendly living on the eastern edge of Pretoria, including the Mooikloof Equestrian Estate.'],
  ['Lynnwood', 'Leafy and central, close to Menlyn and the N1. Established homes on good-sized stands, with well-regarded schools nearby.'],
  ['Waterkloof', 'One of Pretoria\'s most established addresses: large stands, mature trees, embassies, and some of the city\'s best-known schools.'],
  ['Rietvalleirand', 'A quieter, established suburb near Waterkloof Ridge and Erasmuskloof, with easy access to the N1.'],
  ['Wierda Park', 'An established, family-friendly Centurion suburb with freehold homes and complexes, schools nearby and quick access to the N14.'],
  ['Eldoraigne', 'Popular Centurion suburb with generous stands, established gardens and good schools, close to the N14.'],
  ['Rooihuiskraal North', 'A Centurion favourite with families: freehold homes and secure complexes, schools nearby and quick access to the N14.'],
  ['Kosmos', 'A village on the Hartbeespoort Dam with water and mountain views. Weekend-escape living within about an hour of Pretoria.']
];
const SUBURB_TEXT = Object.fromEntries(SUBURBS);
const WANTS = ['Garden', 'Pool', 'Pet-friendly', 'Solar or backup power', 'Security estate', 'Study', 'Flatlet', 'Fibre', 'Near schools', 'Single storey', 'Double garage', 'Borehole or water tanks'];
const TIMELINES = ['As soon as possible', 'In the next 3 months', 'In 3 to 6 months', 'Later this year', 'Just looking for now'];

const ICON = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-3.8M8.2 13l7.6 3.8"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><circle cx="17" cy="8" r="2.4"/><path d="M15.5 13.2c2.3.2 4 1.8 4.8 4.8"/>',
  door: '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12.5" r=".9"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  drone: '<circle cx="5.5" cy="6" r="2.5"/><circle cx="18.5" cy="6" r="2.5"/><path d="M8 7.5l2.5 2.5h3L16 7.5M10 10v4h4v-4M9 18l1.5-4M15 18l-1.5-4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  phone: '<path d="M6.5 3h3l1.5 4.5-2 1.5c1 2.2 2.8 4 5 5l1.5-2 4.5 1.5v3c0 1.1-.9 2-2 2C10.6 18.5 5.5 13.4 4.5 5c0-1.1.9-2 2-2z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  wa: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z"/><path d="M8.8 8.3c.2-.5.5-.5.8-.5h.6c.2 0 .4.1.5.4l.8 1.9c.1.2 0 .5-.1.6l-.6.7c-.1.1-.2.3 0 .5.4.8 1.6 2.2 3.1 2.8.2.1.4 0 .5-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.2.1.3.3.3.5 0 .6-.3 1.5-1.1 1.9-.8.4-1.8.4-3.5-.3-2.6-1.1-4.3-3.6-4.5-4-.2-.4-1-1.6-.9-2.7 0-.8.3-1.3.4-1.6z" fill="currentColor" stroke="none"/>'
};
function icon(name, extra) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + (ICON[name] || '') + '</svg>'; }

const MARKETING = [
  ['photos', 'camera', 'Professional photos', 'Bright, magazine-quality photos that make buyers stop scrolling.'],
  ['p24', 'globe', 'Property24', 'Listed on one of South Africa\'s largest property portals.'],
  ['pp', 'globe', 'Private Property', 'On the second major portal too, wherever buyers search.'],
  ['site', 'home', 'RB Brand website', 'Featured on rbbrandrealestate.co.za.'],
  ['social', 'share', 'Facebook & Instagram', 'Posted to our pages and shared through my network.'],
  ['ads', 'target', 'Targeted social ads', 'Paid ads shown to buyers looking in this area.'],
  ['buyers', 'users', 'My buyer list', 'Sent first to buyers I\'m already helping, before it goes public.'],
  ['showday', 'door', 'Show days', 'Hosted show days so serious buyers can walk through.'],
  ['board', 'flag', 'For Sale board', 'A board at the gate, where the estate rules allow.'],
  ['video', 'video', 'Video walkthrough', 'A short video tour for the portals and social media.'],
  ['drone', 'drone', 'Drone photos', 'Aerial shots of the stand, the views and the area.'],
  ['feedback', 'chart', 'Weekly feedback', 'Every week: viewings, what buyers said, and next steps.']
];
const MARKETING_DEFAULT = ['photos', 'p24', 'pp', 'site', 'social', 'buyers', 'showday', 'feedback'];

const PROMISES = [
  ['Honest pricing', 'A price based on what homes like yours actually sold for, not what you hope to hear.'],
  ['Weekly feedback', 'Every week you hear about viewings, what buyers said, and what we do next.'],
  ['Start to finish', 'From the first photo to the day you are paid out, I handle the details.']
];

const DEFAULT_ME = {
  name: 'Charné Snyman', first: 'Charné', title: 'Property Practitioner', agency: 'RB Brand Real Estate',
  areas: 'Pretoria East & Centurion', phone: '', email: 'charne@rbbrand.co.za', ffc: '', photo: '',
  bio: 'I help families in Pretoria East and Centurion sell and buy with clear advice and no surprises. You will always know where things stand.',
  commission: 6, vatIncl: false, rate: PRIME, signoff: 'Warm regards'
};
const NOTE_LISTING = 'Thank you for inviting me into your home. This plan shows how I would price it, how buyers will find it, and what you can expect to walk away with.\n\nTake your time with it. I am a WhatsApp away if anything is unclear.';
const NOTE_BUYER = 'Buying a home is a big step. This guide walks you through how it works, what it costs, and the areas worth a look.\n\nFill in your wish list on page 7 and send it to me. I will start looking straight away.';

function newListing(me) {
  return {
    id: uid(), type: 'listing', created: Date.now(), updated: Date.now(),
    names: '', first: '', phone: '', email: '', date: todayISO(), note: NOTE_LISTING,
    address: '', suburb: '', city: 'Pretoria East', propType: 'Freehold house', beds: 3, baths: 2, garages: 2, floor: '', erf: '',
    features: [], love: '', photo: '', photo2: '',
    comps: [{ addr: '', price: null, size: '', beds: '', date: '', status: 'Sold' }], low: null, high: null, ask: null,
    commission: me.commission, vatIncl: !!me.vatIncl, bond: null, cancel: null, certs: null,
    marketing: MARKETING_DEFAULT.slice(), launch: todayISO(14), mandate: 'Sole mandate', months: 3
  };
}
function newBuyer(me) {
  return {
    id: uid(), type: 'buyer', created: Date.now(), updated: Date.now(),
    names: '', first: '', phone: '', email: '', date: todayISO(), note: NOTE_BUYER,
    firstTime: false, preapproved: false, timeline: 'In the next 3 months', hero: '',
    priceMax: null, deposit: null, income: null, rate: me.rate || PRIME, years: 20,
    areas: ['Equestria', 'Faerie Glen', 'Moreleta Park'], areaText: {},
    beds: 3, baths: 2, garages: 2, wants: ['Garden', 'Solar or backup power']
  };
}
function exampleListing(me) {
  return Object.assign(newListing(me), {
    example: true, names: 'Pieter & Anri Botha', first: 'Pieter and Anri', phone: '', email: '',
    address: '7 Example Close', suburb: 'Equestria', city: 'Pretoria East', propType: 'Townhouse', beds: 3, baths: 2, garages: 2, floor: 148, erf: '',
    features: ['Covered patio', 'Built-in braai', 'Solar power', 'Double garage', 'Security estate', 'Near schools'],
    love: 'Entertain on the covered patio around the built-in braai. Solar power keeps the lights on. A secure complex with a communal pool, and schools and shopping close by.',
    comps: [
      { addr: '3-bed townhouse, same complex', price: 2050000, size: 152, beds: 3, date: todayISO(-75).slice(0, 7), status: 'Sold' },
      { addr: '3-bed townhouse, Equestria', price: 1980000, size: 140, beds: 3, date: todayISO(-110).slice(0, 7), status: 'Sold' },
      { addr: '3-bed townhouse, secure estate', price: 2150000, size: 155, beds: 3, date: todayISO(-45).slice(0, 7), status: 'Sold' },
      { addr: '3-bed townhouse, two streets away', price: 2195000, size: 150, beds: 3, date: '', status: 'On the market' }
    ],
    low: 2000000, high: 2200000, ask: 2099000, bond: 950000, cancel: null, certs: null
  });
}
function exampleBuyer(me) {
  return Object.assign(newBuyer(me), {
    example: true, names: 'Lerato & Sipho Mokoena', first: 'Lerato and Sipho', firstTime: true, preapproved: false,
    priceMax: 2300000, deposit: 230000, income: 78000,
    areas: ['Equestria', 'Faerie Glen', 'Moreleta Park', 'Silver Lakes'], wants: ['Garden', 'Pet-friendly', 'Solar or backup power', 'Near schools']
  });
}

// ───────────────────────── storage ─────────────────────────
const Store = (function () {
  const mem = new Map();
  let dbp = null, broken = false;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('charne-client-studio', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(e => { broken = true; return null; });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      if (!db) { const r = fn(null); return res(r && 'result' in r ? r.result : undefined); }
      const t = db.transaction('kv', mode), st = t.objectStore('kv');
      const req = fn(st);
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error);
    }));
  }
  return {
    get broken() { return broken; },
    get: k => tx('readonly', st => st ? st.get(k) : { result: mem.get(k) }),
    set: (k, v) => tx('readwrite', st => st ? st.put(v, k) : (mem.set(k, v), null)),
    del: k => tx('readwrite', st => st ? st.delete(k) : (mem.delete(k), null)),
    all: () => tx('readonly', st => st ? st.getAll() : { result: Array.from(mem.values()) }),
    keys: () => tx('readonly', st => st ? st.getAllKeys() : { result: Array.from(mem.keys()) })
  };
})();

let ME = Object.assign({}, DEFAULT_ME);
let CLIENTS = [];
let VIEW = { name: 'home' };

async function loadAll() {
  try {
    const s = await Store.get('settings');
    if (s) ME = Object.assign({}, DEFAULT_ME, s);
    const keys = await Store.keys();
    const out = [];
    for (const k of keys) if (String(k).startsWith('client:')) { const c = await Store.get(k); if (c) out.push(c); }
    CLIENTS = out.sort((a, b) => b.updated - a.updated);
    return !!s;
  } catch (e) { return false; }
}
const saveMe = debounce(() => Store.set('settings', ME).catch(() => toast('Could not save your details in this browser.')), 300);
const pendingSaves = new Map();
function saveClient(c, immediate) {
  c.updated = Date.now();
  if (!CLIENTS.includes(c)) CLIENTS.unshift(c);
  const run = () => { pendingSaves.delete(c.id); Store.set('client:' + c.id, c).then(markSaved).catch(() => toast('Could not save. Is the disk full?')); };
  clearTimeout(pendingSaves.get(c.id));
  if (immediate) run(); else pendingSaves.set(c.id, setTimeout(run, 350));
  const s = $('#saved'); if (s) s.textContent = 'Saving…';
}
function markSaved() { const s = $('#saved'); if (s) s.textContent = 'Saved ✓'; }
function flushSaves() { for (const [id, t] of pendingSaves) { clearTimeout(t); const c = CLIENTS.find(x => x.id === id); if (c) Store.set('client:' + c.id, c); } pendingSaves.clear(); }
window.addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });

// ───────────────────────── illustrations ─────────────────────────
const SVG_LISTING = '<svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="skA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C2645"/><stop offset=".6" stop-color="#585575"/><stop offset="1" stop-color="#D49A69"/></linearGradient><linearGradient id="wnA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFDE97"/><stop offset="1" stop-color="#E59A4B"/></linearGradient><linearGradient id="plA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6CC0FF"/><stop offset="1" stop-color="#1B58C9"/></linearGradient></defs><rect width="800" height="420" fill="url(#skA)"/><circle cx="640" cy="96" r="2" fill="#fff" opacity=".7"/><circle cx="560" cy="60" r="1.5" fill="#fff" opacity=".6"/><circle cx="130" cy="70" r="1.5" fill="#fff" opacity=".6"/><path d="M0 252 Q120 206 240 236 T480 226 T800 232 V420 H0Z" fill="#2C3352" opacity=".75"/><g fill="#18231F"><circle cx="72" cy="240" r="40"/><circle cx="116" cy="254" r="30"/><circle cx="724" cy="238" r="44"/><circle cx="768" cy="256" r="30"/></g><rect x="170" y="210" width="470" height="110" fill="#D8D1C1"/><rect x="250" y="150" width="330" height="62" fill="#EAE4D7"/><rect x="236" y="140" width="362" height="11" fill="#262B3A"/><rect x="156" y="200" width="500" height="11" fill="#262B3A"/><rect x="190" y="226" width="250" height="88" fill="url(#wnA)"/><g stroke="#262B3A" stroke-width="3"><line x1="252" y1="226" x2="252" y2="314"/><line x1="315" y1="226" x2="315" y2="314"/><line x1="378" y1="226" x2="378" y2="314"/></g><rect x="458" y="222" width="168" height="96" fill="#4A4B57"/><rect x="474" y="236" width="58" height="78" fill="url(#wnA)" opacity=".9"/><rect x="268" y="162" width="190" height="42" fill="url(#wnA)" opacity=".92"/><rect x="476" y="162" width="88" height="42" fill="#3A3E4F"/><rect x="120" y="318" width="580" height="16" fill="#8C877C"/><path d="M150 334 H660 L702 374 H108Z" fill="url(#plA)"/><rect x="200" y="340" width="232" height="7" fill="#FFDE97" opacity=".35"/><rect x="0" y="372" width="800" height="48" fill="#344F2C"/><rect x="0" y="372" width="800" height="7" fill="#4C6E3D"/><g fill="#2A4126"><ellipse cx="134" cy="318" rx="26" ry="14"/><ellipse cx="682" cy="318" rx="30" ry="15"/></g></svg>';
const SVG_BUYER = '<svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="skB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FB5E6"/><stop offset="1" stop-color="#E4F0FA"/></linearGradient></defs><rect width="800" height="420" fill="url(#skB)"/><g fill="#fff" opacity=".75"><ellipse cx="170" cy="80" rx="60" ry="16"/><ellipse cx="215" cy="70" rx="40" ry="14"/><ellipse cx="610" cy="60" rx="70" ry="15"/></g><rect x="0" y="330" width="800" height="90" fill="#6FA44B"/><path d="M470 420 C520 380 600 352 800 346 V372 C640 380 560 396 540 420Z" fill="#DAD6CD"/><polygon points="110,246 140,222 250,222 250,246" fill="#C8CDD3"/><rect x="120" y="244" width="125" height="96" fill="#F7F5EF"/><polygon points="555,246 555,222 668,222 698,246" fill="#C8CDD3"/><rect x="555" y="244" width="130" height="96" fill="#F7F5EF"/><polygon points="212,206 262,172 542,172 592,206" fill="#D2D6DB"/><rect x="230" y="204" width="340" height="136" fill="#FBFAF6"/><polygon points="326,204 400,150 474,204" fill="#C5CAD1"/><rect x="354" y="206" width="12" height="134" fill="#EEEBE3"/><rect x="434" y="206" width="12" height="134" fill="#EEEBE3"/><rect x="386" y="262" width="28" height="78" fill="#B07A4A"/><g fill="#45556A"><rect x="254" y="232" width="30" height="40"/><rect x="300" y="232" width="30" height="40"/><rect x="472" y="232" width="30" height="40"/><rect x="518" y="232" width="30" height="40"/><rect x="146" y="272" width="26" height="34"/><rect x="196" y="272" width="26" height="34"/><rect x="584" y="272" width="26" height="34"/><rect x="634" y="272" width="26" height="34"/><rect x="390" y="214" width="20" height="26"/></g><g fill="none" stroke="#8B6A49" stroke-width="7" stroke-linecap="round"><path d="M86 340 Q96 262 128 196"/><path d="M724 340 Q714 270 690 206"/></g><g fill="none" stroke="#2F6B3A" stroke-width="6" stroke-linecap="round"><path d="M128 196 Q96 178 66 196"/><path d="M128 196 Q110 166 80 160"/><path d="M128 196 Q140 164 168 158"/><path d="M128 196 Q160 182 186 204"/><path d="M128 196 Q132 220 118 238"/><path d="M690 206 Q660 186 630 200"/><path d="M690 206 Q680 174 654 166"/><path d="M690 206 Q704 176 734 172"/><path d="M690 206 Q722 196 744 218"/></g><g fill="#3E7A39"><ellipse cx="250" cy="340" rx="30" ry="12"/><ellipse cx="550" cy="340" rx="30" ry="12"/><ellipse cx="160" cy="342" rx="34" ry="11"/></g><g><circle cx="236" cy="334" r="5" fill="#A64CA6"/><circle cx="252" cy="330" r="5" fill="#D04B8A"/><circle cx="266" cy="336" r="5" fill="#A64CA6"/><circle cx="540" cy="333" r="5" fill="#D04B8A"/><circle cx="556" cy="330" r="5" fill="#A64CA6"/><circle cx="148" cy="338" r="5" fill="#D04B8A"/><circle cx="170" cy="336" r="5" fill="#A64CA6"/></g></svg>';

let svgN = 0;
function svgListing() { const n = ++svgN; return SVG_LISTING.replace(/\b(skA|wnA|plA)\b/g, '$1' + n); }
function svgBuyer() { const n = ++svgN; return SVG_BUYER.replace(/\b(skB)\b/g, '$1' + n); }

// ───────────────────────── pages ─────────────────────────
function foot(me, n, total) {
  return '<div class="foot"><span>' + esc(me.name) + ' · ' + esc(me.agency) + '</span><span>' + n + ' / ' + total + '</span></div>';
}
function page(cls, inner, me, n, total, attrs) {
  return '<section class="pg ' + (cls || '') + '"' + (attrs || '') + '><div class="pg-in">' + inner + '</div>' + foot(me, n, total) + '</section>';
}
function face(me) { return me.photo ? '<img src="' + src(me.photo) + '" alt="">' : esc(initials(me.name)); }
function contactList(me) {
  const items = [];
  if (me.phone) items.push('<li>' + icon('phone') + '<span>' + esc(me.phone) + '</span></li>');
  if (me.email) items.push('<li>' + icon('mail') + '<span>' + esc(me.email) + '</span></li>');
  if (me.ffc) items.push('<li>' + icon('shield') + '<span>FFC ' + esc(me.ffc) + '</span></li>');
  return items.length ? '<ul>' + items.join('') + '</ul>' : '';
}
function agentCard(me) {
  return '<div class="agent"><div class="face">' + face(me) + '</div><div><h3>' + esc(me.name) + '</h3></div>' +
    '<div class="role">' + esc(me.title) + ' · ' + esc(me.agency) + '</div>' +
    (me.bio ? '<p class="small" style="font-size:14px;color:var(--body)">' + esc(me.bio) + '</p>' : '') +
    contactList(me) + '<img class="crest" src="' + ASSETS.lockupNavy + '" alt="RB Brand Real Estate"></div>';
}
function waButton(me, text, label) {
  return '<a class="wa" href="' + esc(waLink(me.phone, text)) + '" target="_blank" rel="noopener">' + icon('wa') + esc(label) + '</a>';
}
function homeTitle(c) { return c.address || 'Your home'; }

function listingPages(c, me) {
  const T = 12, out = [];
  const first = greetName(c);
  const place = [c.suburb, c.city].filter(Boolean).join(', ');
  const stats = compStats(c);
  const ask = num(c.ask), low = num(c.low), high = num(c.high);

  // 1 cover
  out.push('<section class="pg cover"><div class="cv-img">' + (c.photo ? '<img src="' + src(c.photo) + '" alt="">' : svgListing()) + '</div><div class="cv-shade"></div>' +
    '<div class="cv-top"><img src="' + ASSETS.lockupWhite + '" alt="RB Brand Real Estate"><span>' + esc(fmtDate(c.date)) + '</span></div>' +
    '<div class="cv-txt"><div class="eyb">Listing presentation</div><h1>' + esc(homeTitle(c)) + '</h1>' + (place ? '<p class="cv-sub">' + esc(place) + '</p>' : '') +
    '<div class="cv-for"><span>Prepared for</span><b>' + esc(c.names || 'Your name here') + '</b></div></div>' +
    '<div class="cv-agent"><div>' + esc(me.name) + '<br><span>' + esc(me.title) + ' · ' + esc(me.agency) + '</span></div><span>' + esc(me.phone || me.email || '') + '</span></div></section>');

  // 2 note + about
  out.push(page('', '<div class="cols c37">' + agentCard(me) +
    '<div class="stack"><div class="eyb">Before we start</div><h2>Thank you' + (first ? ', ' + esc(first) : '') + '</h2><p class="note">' + esc(c.note) + '</p>' +
    '<div class="promises">' + PROMISES.map((p, i) => '<div class="promise"><span class="k">' + (i + 1) + '</span><div><b>' + esc(p[0]) + '</b><span>' + esc(p[1]) + '</span></div></div>').join('') + '</div>' +
    '<div class="sign">' + esc(me.first || me.name) + '</div></div></div>', me, 2, T));

  // 3 your home
  const facts = [[c.beds, 'Bedrooms'], [c.baths, 'Bathrooms'], [c.garages, 'Garages'], [c.floor ? c.floor + ' m²' : '', 'Floor size'], [c.erf ? c.erf + ' m²' : '', 'Stand']].filter(f => f[0] !== '' && f[0] != null && f[0] !== 0);
  const pic = c.photo2 || c.photo;
  out.push(page('', '<div class="cols">' +
    '<div class="ph-box">' + (pic ? '<img src="' + src(pic) + '" alt="">' : svgListing()) + '</div>' +
    '<div class="stack"><div class="eyb">Your home</div><h2>' + esc(c.propType || 'Home') + (c.suburb ? ' in ' + esc(c.suburb) : '') + '</h2>' +
    (facts.length ? '<div class="facts">' + facts.map(f => '<div class="fact"><b>' + esc(String(f[0]).replace(' m²', '')) + (String(f[0]).includes('m²') ? '<small style="font-size:16px"> m²</small>' : '') + '</b><span>' + f[1] + '</span></div>').join('') + '</div>' : '') +
    (c.love ? '<p class="love">' + esc(c.love) + '</p>' : '') +
    ((c.features || []).length ? '<div><div class="small" style="letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px">Features buyers look for</div><div class="feat">' + c.features.map(f => '<span>' + esc(f) + '</span>').join('') + '</div></div>' : '') +
    '</div></div>', me, 3, T));

  // 4 market
  const rows = stats.rows.slice(0, 6);
  out.push(page('', '<div class="eyb">The market</div><h2>What\'s selling ' + (c.suburb ? 'in ' + esc(c.suburb) : 'around you') + '</h2>' +
    '<p class="lede">Recent sales of similar homes nearby. What buyers actually paid matters more than what sellers are asking.</p>' +
    (rows.length ? '<table class="tbl"><thead><tr><th>Home</th><th class="r hide-s">Beds</th><th class="r">Size</th><th class="r">Price</th><th class="r hide-s">When</th><th class="r">R/m²</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + esc(r.addr || 'Similar home') + (r.status === 'On the market' ? '<span class="mk-on">On the market</span>' : '') + '</td><td class="r hide-s">' + esc(r.beds || '—') + '</td><td class="r">' + (num(r.size) ? esc(r.size) + ' m²' : '—') + '</td><td class="r">' + money(r.price) + '</td><td class="r hide-s">' + (r.status === 'On the market' ? 'Listed' : esc(fmtMonth(r.date) || '—')) + '</td><td class="r">' + (num(r.size) ? money(r.price / r.size) : '—') + '</td></tr>').join('') +
      yourRow(c, ask) + '</tbody></table>' + (c.compSource ? '<p class="small">Sales figures: ' + esc(c.compSource) + '</p>' : '') : '<p class="lede">Comparable sales to follow.</p>') +
    '<div class="tiles"><div class="tile"><span>Average sold price</span><b>' + (stats.avg ? money(stats.avg) : '—') + '</b></div><div class="tile"><span>Average per m²</span><b>' + (stats.perM2 ? money(stats.perM2) : '—') + '</b></div>' +
    '<div class="tile dark"><span>Your home at that rate</span><b>' + (stats.indicative ? money(stats.indicative) : '—') + '</b></div></div>', me, 4, T));

  // 5 pricing
  const pts = stats.rows.map(r => Number(r.price)).concat([low, high, ask].filter(Boolean));
  let bar = '';
  if (pts.length >= 2) {
    const minP = Math.min.apply(null, pts), maxP = Math.max.apply(null, pts);
    const lo = minP * 0.97, hi = maxP * 1.03, span = hi - lo || 1;
    const x = v => ((v - lo) / span * 100).toFixed(2) + '%';
    bar = '<div class="pbar"><div class="track"></div>' +
      (low && high ? '<div class="band" style="left:' + x(low) + ';width:calc(' + x(high) + ' - ' + x(low) + ')"><i>Recommended range</i></div>' : '') +
      stats.rows.map(r => '<div class="dot' + (r.status === 'On the market' ? ' mkt' : '') + '" style="left:' + x(r.price) + '" title="' + esc(r.addr) + '"></div>').join('') +
      (ask ? '<div class="ppin" style="left:' + x(ask) + '"><b>' + money(ask) + '</b><i></i></div>' : '') +
      '<div class="ax" style="left:' + x(minP) + '">' + moneyShort(minP) + '</div><div class="ax" style="left:' + x(maxP) + '">' + moneyShort(maxP) + '</div></div>' +
      '<div class="legend"><span><i></i>Sold nearby</span><span><i class="mkt"></i>On the market now</span>' + (low && high ? '<span><i class="band"></i>Recommended range</span>' : '') + '</div>';
  }
  const bracket = ask ? Math.ceil(ask / 100000) * 100000 : null;
  out.push(page('', '<div class="eyb">Pricing</div><h2>Where your home should sit</h2>' +
    '<div class="cols c73" style="flex:none;align-items:end"><div class="askbig"><span>Recommended asking price</span><b>' + (ask ? money(ask) : 'To be agreed') + '</b>' +
    (low && high ? '<em>Range ' + money(low) + ' to ' + money(high) + '</em>' : '') + '</div>' +
    '<div class="stack" style="gap:8px">' + (stats.sold.length ? '<p class="small" style="font-size:14px;color:var(--body)">Based on ' + stats.sold.length + ' recent sale' + (stats.sold.length > 1 ? 's' : '') + ' nearby' + (stats.perM2 ? ' at an average of ' + money(stats.perM2) + ' per m²' : '') + '.</p>' : '') +
    (bracket ? '<p class="small" style="font-size:14px;color:var(--body)">Buyers search the portals in price brackets. At ' + money(ask) + ', your home shows up for everyone searching up to ' + moneyShort(bracket) + '.</p>' : '') + '</div></div>' +
    bar + priceTiles(c, stats, ask, low), me, 5, T));

  // 6 first weeks
  out.push(page('', '<div class="eyb">Timing</div><h2>The first weeks count</h2>' +
    '<p class="lede">A new listing gets its strongest attention in the first few weeks. Buyers who have been waiting see it at once. Pricing it right from day one turns that attention into viewings and offers.</p>' +
    '<svg viewBox="0 0 900 190" style="width:100%;height:auto;flex:none" aria-hidden="true"><line x1="40" y1="160" x2="880" y2="160" stroke="#D3CCBC" stroke-width="2"/><line x1="40" y1="20" x2="40" y2="160" stroke="#D3CCBC" stroke-width="2"/>' +
    '<path d="M40 40 C200 44 300 60 420 92 S700 128 880 132" fill="none" stroke="#2D4B8E" stroke-width="4"/><path d="M40 40 C140 70 220 118 360 140 S700 154 880 156" fill="none" stroke="#A8742F" stroke-width="4" stroke-dasharray="10 8"/>' +
    '<circle cx="230" cy="52" r="7" fill="#2D4B8E"/><text x="246" y="47" font-size="15" fill="#2D4B8E" font-family="Noto Sans, sans-serif">Offers come in</text>' +
    '<text x="44" y="182" font-size="13" fill="#767B88" font-family="Noto Sans, sans-serif">Launch</text><text x="820" y="182" font-size="13" fill="#767B88" font-family="Noto Sans, sans-serif">Weeks</text>' +
    '<text x="52" y="16" font-size="13" fill="#767B88" font-family="Noto Sans, sans-serif">Buyer interest</text></svg>' +
    '<div class="pcards"><div class="pcard"><h3 style="color:var(--blue)">Priced right</h3><p>Viewings in the first two weeks. Buyers compete, and offers follow.</p></div>' +
    '<div class="pcard"><h3 class="gold">Priced too high</h3><p>Buyers wait for a price drop. The listing goes stale and ends up selling for less.</p></div>' +
    '<div class="pcard"><h3>Our plan</h3><p>Launch at the right price, to every buyer at once, and review it together every week.</p></div></div>', me, 6, T));

  // 7 marketing
  const mk = MARKETING.filter(m => (c.marketing || []).includes(m[0]));
  out.push(page('', '<div class="eyb">Marketing</div><h2>How buyers will find your home</h2>' +
    '<div class="pcards mkt">' + mk.map(m => '<div class="pcard"><div class="ic">' + icon(m[1]) + '</div><h3>' + esc(m[2]) + '</h3><p>' + esc(m[3]) + '</p></div>').join('') + '</div>', me, 7, T));

  // 8 launch plan
  const L = c.launch || todayISO(14);
  const tl = [
    [fmtDate(addDays(L, -7), { day: 'numeric', month: 'short' }) + ' →', 'Get ready', 'Mandate and disclosure form signed. Compliance certificates ordered. Photos booked.', false],
    [fmtDate(L, { day: 'numeric', month: 'short' }), 'Launch', 'Live on the portals and our website, and sent to my buyers first.', true],
    [fmtDate(nextSunday(addDays(L, 3)), { weekday: 'short', day: 'numeric', month: 'short' }), 'First show day', 'Open for serious buyers to walk through.', false],
    ['Every week', 'Feedback report', 'Viewings, what buyers said, and what we do next.', false],
    ['Weeks 2 to 6', 'Offers', 'I help you compare them on price, conditions and timing.', false],
    ['Offer accepted', 'On to transfer', 'The offer is signed in ink, and the attorneys take it from there.', true]
  ];
  out.push(page('', '<div class="cols c37"><div class="stack"><div class="eyb">Launch plan</div><h2>From today to sold</h2><p class="lede">A clear plan, with dates. You will always know what happens next.</p>' +
    (c.mandate ? '<div class="callout">' + esc(c.mandate) + (c.months ? ' for ' + esc(c.months) + ' months' : '') + '. One agent, fully accountable, with every channel working at once.</div>' : '') + '</div>' +
    '<div class="tline">' + tl.map(t => '<div class="tl' + (t[3] ? ' key' : '') + '"><div class="when">' + esc(t[0]) + '</div><div class="dotc"></div><div><b>' + esc(t[1]) + '</b><span>' + esc(t[2]) + '</span></div></div>').join('') + '</div></div>', me, 8, T));

  // 9 net
  const pct = num(c.commission);
  let net = '<p class="lede">Add the asking price to see this page.</p>';
  if (ask) {
    const com = commission(ask, pct, c.vatIncl);
    net = '<div class="net">' +
      '<div class="ln"><span>Selling price</span><b>' + money(ask) + '</b></div>' +
      (pct ? '<div class="ln"><span>Agent\'s commission (' + esc(pct) + '%' + (c.vatIncl ? ' incl. VAT' : ' + VAT') + ')</span><span>− ' + money(com.incl) + '</span></div>' : '') +
      (num(c.bond) ? '<div class="ln"><span>Bond settlement</span><span>− ' + money(c.bond) + '</span></div>' : '') +
      (num(c.cancel) ? '<div class="ln"><span>Bond cancellation fees</span><span>− ' + money(c.cancel) + '</span></div>' : '') +
      (num(c.certs) ? '<div class="ln"><span>Compliance certificates</span><span>− ' + money(c.certs) + '</span></div>' : '') +
      '<div class="ln tot"><span>Estimated amount to you</span><b>' + money(sellerNet(c, ask)) + '</b></div></div>';
  }
  const range = ask && low && high ? '<div class="small" style="letter-spacing:.18em;text-transform:uppercase">Across the range</div><div class="tiles" style="grid-template-columns:1fr"><div class="tile"><span>If it sells at ' + moneyShort(low) + '</span><b>' + money(sellerNet(c, low)) + '</b></div><div class="tile"><span>If it sells at ' + moneyShort(high) + '</span><b>' + money(sellerNet(c, high)) + '</b></div></div>' : '';
  out.push(page('', '<div class="eyb">Your numbers</div><h2>What you\'ll walk away with</h2><div class="cols c73" style="flex:none"><div class="stack">' + net + '</div>' +
    '<div class="stack">' + range +
    '<p class="small">An estimate to plan with. Your bank confirms the settlement figure, and the transferring attorney\'s statement is final. Rates and levies are paid up to the transfer date. ' + (num(c.bond) ? '' : 'No bond entered. ') + (num(c.certs) ? '' : 'Compliance certificates are quoted separately. ') + '</p></div></div>', me, 9, T));

  // 10 process
  const steps = [
    ['Offer accepted', 'The offer to purchase is signed by everyone, in ink. Electronic signatures are not valid for a property sale.', true],
    ['Bond approval', 'The buyer\'s bank approves the loan within the time the offer allows.'],
    ['Certificates', 'Electrical, plus electric fence and gas if you have them, and anything else the offer requires.'],
    ['Attorneys & FICA', 'You appoint the transferring attorney. Both sides provide FICA documents.'],
    ['Clearances', 'Rates clearance from the City, and a levy clearance where there is a body corporate or HOA.'],
    ['Lodgement', 'The attorneys lodge the documents at the Deeds Office.'],
    ['Registration', 'The property registers in the buyer\'s name, and you are paid out.', true]
  ];
  out.push(page('', '<div class="eyb">After the offer</div><h2>From offer to transfer</h2>' +
    '<div class="proc">' + steps.map((s, i) => '<div class="s' + (s[2] ? ' hl' : '') + '"><span class="k">' + (i + 1) + '</span><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('') +
    '<div class="s" style="background:transparent;border-style:dashed"><b>How long?</b><span>Usually 8 to 12 weeks from a signed offer, depending on the buyer\'s bond and the Deeds Office.</span></div></div>' +
    '<div class="callout" style="margin-top:auto">While the attorneys work, I keep things moving. I follow up with the bank, the attorneys and the municipality, and you get an update every week until you are paid out.</div>', me, 10, T));

  // 11 documents
  out.push(page('', '<div class="eyb">Paperwork</div><h2>What I\'ll need from you</h2>' +
    '<div class="cols"><div class="stack"><h3>You and the mandate</h3><ul class="chk">' +
    '<li><span>ID for every owner<small>And your spouse, if married in community of property</small></span></li>' +
    '<li><span>Proof of address<small>Not older than three months (FICA)</small></span></li>' +
    '<li><span>Marriage or company documents<small>Antenuptial contract, or trust or company papers if it owns the property</small></span></li>' +
    '<li><span>Mandatory disclosure form<small>I bring it. It lists what you know about the property\'s condition, and goes to the buyer</small></span></li>' +
    '<li><span>The signed mandate<small>' + esc(c.mandate || 'Sole mandate') + (c.months ? ', ' + esc(c.months) + ' months' : '') + '</small></span></li></ul></div>' +
    '<div class="stack"><h3>The property</h3><ul class="chk">' +
    '<li><span>Latest municipal rates account</span></li>' +
    '<li><span>Levy statement and conduct rules<small>For sectional title or an estate</small></span></li>' +
    '<li><span>Bond account number<small>So the bank can prepare the cancellation figure</small></span></li>' +
    '<li><span>Approved building plans<small>Including any additions</small></span></li>' +
    '<li><span>Compliance certificates<small>Electrical always; electric fence and gas if present. Beetle and plumbing when the offer asks for them</small></span></li></ul></div></div>', me, 11, T));

  // 12 close
  out.push('<section class="pg close"><div class="pg-in"><div class="eyb">Next step</div><h2>Let\'s launch ' + esc(c.address || 'your home') + '</h2>' +
    '<p class="lede">Three steps and your home is live' + (c.launch ? ' on ' + esc(fmtDate(c.launch, { weekday: 'long', day: 'numeric', month: 'long' })) : '') + '.</p>' +
    '<div class="nexts"><div class="s"><span class="k">1</span><b>Sign the mandate</b><span>And the disclosure form. It takes ten minutes, and we can do it today.</span></div>' +
    '<div class="s"><span class="k">2</span><b>Photos and certificates</b><span>I book the photographer and order the compliance certificates.</span></div>' +
    '<div class="s"><span class="k">3</span><b>Go live</b><span>On the portals, our website and social media, and to my buyers first.</span></div></div>' +
    (c.photo ? '<div class="strip"><img src="' + src(c.photo) + '" alt=""></div>' : '') +
    '<div class="closebar"><div class="who"><div class="face">' + face(me) + '</div><div><b>' + esc(me.name) + '</b><span>' + esc([me.phone, me.email].filter(Boolean).join(' · ')) + '</span></div></div>' +
    waButton(me, 'Hi ' + (me.first || '') + ', we are ready to launch ' + (c.address || 'our home') + '.', 'Let\'s launch') + '</div></div>' + foot(me, 12, T) + '</section>');
  return out;
}

function yourRow(c, ask) {
  const fl = num(c.floor);
  if (!fl && !ask) return '';
  return '<tr class="you"><td>Your home</td><td class="r hide-s">' + esc(c.beds || '—') + '</td><td class="r">' + (fl ? esc(fl) + ' m²' : '—') + '</td><td class="r">' + (ask ? money(ask) : '—') + '</td><td class="r hide-s">' + (ask ? 'Asking' : '') + '</td><td class="r">' + (ask && fl ? money(ask / fl) : '—') + '</td></tr>';
}
function priceTiles(c, stats, ask, low) {
  if (!ask) return '';
  const fl = num(c.floor), per = fl ? ask / fl : null;
  const t = [];
  if (per) t.push(['Asking price per m²', money(per), stats.perM2 ? (Math.abs(per / stats.perM2 - 1) < 0.03 ? 'In line with recent sales' : (per > stats.perM2 ? Math.round((per / stats.perM2 - 1) * 100) + '% above the average' : Math.round((1 - per / stats.perM2) * 100) + '% below the average')) : '']);
  if (stats.perM2) t.push(['Average sold per m²', money(stats.perM2), stats.sold.length + ' recent sale' + (stats.sold.length > 1 ? 's' : '')]);
  if (low && ask > low) t.push(['Room to negotiate', money(ask - low), 'Down to the bottom of the range']);
  if (!t.length) return '';
  return '<div class="tiles" style="margin-top:auto">' + t.map((x, i) => '<div class="tile' + (i === 0 ? ' dark' : '') + '"><span>' + x[0] + '</span><b>' + x[1] + '</b>' + (x[2] ? '<em class="small" style="font-style:normal' + (i === 0 ? ';color:rgba(255,255,255,.7)' : '') + '">' + esc(x[2]) + '</em>' : '') + '</div>').join('') + '</div>';
}
function areaText(c, a) { const t = c.areaText || {}; return Object.prototype.hasOwnProperty.call(t, a) ? t[a] : (SUBURB_TEXT[a] || ''); }
function areaList(c) { return (c.areas || []).slice(0, 6).map(a => [a, areaText(c, a)]); }

function buyerPages(c, me) {
  const T = 9, out = [];
  const first = greetName(c);
  const price = num(c.priceMax), dep = num(c.deposit), rate = num(c.rate) || me.rate || PRIME, years = num(c.years) || 20, income = num(c.income);
  const opt = (vals, sel) => vals.map(v => '<option' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(v) + '</option>').join('');

  // 1 cover
  out.push('<section class="pg cover"><div class="cv-img">' + (c.hero ? '<img src="' + src(c.hero) + '" alt="">' : svgBuyer()) + '</div><div class="cv-shade"></div>' +
    '<div class="cv-top"><img src="' + ASSETS.lockupWhite + '" alt="RB Brand Real Estate"><span>' + esc(fmtDate(c.date)) + '</span></div>' +
    '<div class="cv-txt"><div class="eyb">Buyer guide</div><h1>Your home-buying guide</h1><p class="cv-sub">' + esc(me.areas || 'Pretoria East & Centurion') + '</p>' +
    '<div class="cv-for"><span>Prepared for</span><b>' + esc(c.names || 'Your name here') + '</b></div></div>' +
    '<div class="cv-agent"><div>' + esc(me.name) + '<br><span>' + esc(me.title) + ' · ' + esc(me.agency) + '</span></div><span>' + esc(me.phone || me.email || '') + '</span></div></section>');

  // 2 hello
  out.push(page('', '<div class="cols c37">' + agentCard(me) +
    '<div class="stack"><div class="eyb">Hello</div><h2>' + (first ? 'Welcome, ' + esc(first) : 'Welcome') + '</h2><p class="note">' + esc(c.note) + '</p>' +
    '<div class="promises"><div class="promise"><span class="k">1</span><div><b>Straight answers</b><span>What things cost, what to look out for, and what I would do in your shoes.</span></div></div>' +
    '<div class="promise"><span class="k">2</span><div><b>Homes that fit</b><span>I send you the ones that match your wish list, including new listings before they go public.</span></div></div>' +
    '<div class="promise"><span class="k">3</span><div><b>With you to the keys</b><span>From your first viewing to registration day.</span></div></div></div>' +
    '<div class="sign">' + esc(me.first || me.name) + '</div></div></div>', me, 2, T));

  // 3 process
  const steps = [
    ['Get pre-approved', 'A bond pre-approval shows what you can borrow and makes your offer stronger.', true],
    ['Find your home', 'Send me your wish list. I line up viewings and send new listings as they come in.'],
    ['Make an offer', 'We write the offer to purchase together. It must be signed in ink, not electronically.'],
    ['Bond approval', 'Your bank values the property and approves the loan, usually within a few weeks.'],
    ['FICA & attorneys', 'You give the attorneys your documents and sign the transfer papers.'],
    ['Pay transfer costs', 'Transfer duty and the attorneys\' fees are paid before lodgement.'],
    ['Registration', 'The home registers in your name. You get the keys.', true]
  ];
  out.push(page('', '<div class="eyb">How it works</div><h2>Buying, step by step</h2>' +
    '<div class="proc">' + steps.map((s, i) => '<div class="s' + (s[2] ? ' hl' : '') + '"><span class="k">' + (i + 1) + '</span><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('') +
    '<div class="s" style="background:transparent;border-style:dashed"><b>How long?</b><span>Usually 8 to 12 weeks from a signed offer to registration.</span></div></div>' +
    (c.firstTime ? '<div class="callout">First home? Ask your bank about its first-time buyer options. And there is no transfer duty on homes up to ' + money(1210000) + '.</div>' : ''), me, 3, T));

  // 4 affordability calculator
  out.push(page('', '<div class="eyb">Your budget</div><h2>What will it cost each month?</h2>' +
    '<div class="cols"><div class="calc">' +
    '<label>Purchase price<input class="pin" data-ci="price" inputmode="numeric" value="' + esc(moneyInput(price)) + '" placeholder="e.g. 2 000 000"></label>' +
    '<div class="two"><label><span>Deposit <small>(optional)</small></span><input class="pin" data-ci="deposit" inputmode="numeric" value="' + esc(moneyInput(dep)) + '" placeholder="0"></label>' +
    '<label>Interest rate %<input class="pin" data-ci="rate" type="number" step="0.25" min="0" value="' + esc(rate) + '"></label></div>' +
    '<div class="two"><label>Term<select class="pin" data-ci="years">' + opt([20, 25, 30], years) + '</select></label>' +
    '<label><span>Gross monthly income <small>(optional)</small></span><input class="pin" data-ci="income" inputmode="numeric" value="' + esc(moneyInput(income)) + '" placeholder="Household, before tax"></label></div>' +
    '<p class="small">Prime is ' + PRIME + '% (South African Reserve Bank, September 2026). Your bank\'s offer may be higher or lower. Banks usually want the repayment to be no more than about 30% of gross income, and their own assessment decides.</p>' +
    '<div data-co="ladder"></div></div>' +
    '<div class="res"><div class="hd"><span>Monthly repayment</span><b data-co="pay">—</b><em data-co="term"></em></div>' +
    '<div class="ln"><span>Bond amount</span><b data-co="bond">—</b></div>' +
    '<div class="ln"><span>Total repaid</span><b data-co="total">—</b></div>' +
    '<div class="ln"><span>Income banks look for</span><b data-co="need">—</b></div>' +
    '<div class="ln" data-co-row="max"><span>Largest bond on your income</span><b data-co="max">—</b></div>' +
    '<div class="ln" data-co-row="fit"><span>On your income</span><b data-co="fit">—</b></div></div></div>', me, 4, T, ' data-calc="afford"'));

  // 5 transfer costs
  out.push(page('', '<div class="eyb">Transfer costs</div><h2>The cash you\'ll need</h2>' +
    '<div class="cols"><div class="calc">' +
    '<div class="two"><label>Purchase price<input class="pin" data-ci="price" inputmode="numeric" value="' + esc(moneyInput(price)) + '" placeholder="e.g. 2 000 000"></label>' +
    '<label>Deposit<input class="pin" data-ci="deposit" inputmode="numeric" value="' + esc(moneyInput(dep)) + '" placeholder="0"></label></div>' +
    '<label class="tick"><input type="checkbox" data-ci="vat"> New development bought from a VAT-registered developer (VAT is in the price, so no transfer duty)</label>' +
    '<div class="two"><label><span>Transfer attorney <small>(from quote)</small></span><input class="pin" data-ci="tfees" inputmode="numeric" placeholder="Quote needed"></label>' +
    '<label><span>Bond attorney <small>(from quote)</small></span><input class="pin" data-ci="bfees" inputmode="numeric" placeholder="Quote needed"></label></div>' +
    '<p class="small">Transfer duty follows the SARS table for property bought from 1 April 2025, unchanged for 2026: no duty up to ' + money(1210000) + '. Attorney fees come from their quotes. I will get them for you.</p>' +
    '<div><div class="small" style="letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px">Transfer duty at a glance</div><table class="tbl mini"><thead><tr><th>Price</th><th class="r">Transfer duty</th></tr></thead><tbody>' +
    [1210000, 1500000, 2000000, 2500000, 3000000, 4000000].map(v => '<tr><td>' + money(v) + '</td><td class="r">' + money(transferDuty(v)) + '</td></tr>').join('') + '</tbody></table></div></div>' +
    '<div class="res"><div class="hd"><span data-co="cashlabel">Cash needed on transfer</span><b data-co="cash">—</b></div>' +
    '<div class="ln"><span>Deposit</span><b data-co="dep">—</b></div>' +
    '<div class="ln"><span>Transfer duty (SARS)</span><b data-co="duty">—</b></div>' +
    '<div class="ln"><span>Transfer attorney</span><b data-co="tf">—</b></div>' +
    '<div class="ln"><span>Bond attorney</span><b data-co="bf">—</b></div></div></div>', me, 5, T, ' data-calc="costs"'));

  // 6 areas
  const areas = areaList(c);
  out.push(page('', '<div class="eyb">Where to look</div><h2>Areas worth a look</h2>' +
    (areas.length ? '<div class="areas n' + areas.length + '">' + areas.map(a => '<div class="a"><h3>' + esc(a[0]) + '</h3><p>' + esc(a[1]) + '</p></div>').join('') + '</div>'
      : '<p class="lede">Tell me where you would like to live, and I will put together what you need to know.</p>') +
    '<p class="small">Ask me for recent sales in any of these areas. I will send you the real numbers, not portal asking prices.</p>', me, 6, T));

  // 7 wish list
  const allAreas = areaList(c).map(a => a[0]);
  out.push(page('', '<div class="eyb">Your wish list</div><h2>Tell me what you\'re looking for</h2>' +
    '<div class="wish"><div class="calc"><div class="two"><label>Bedrooms<select class="pin" data-w="beds">' + opt(['1', '2', '3', '4', '5+'], c.beds >= 5 ? '5+' : c.beds) + '</select></label>' +
    '<label>Bathrooms<select class="pin" data-w="baths">' + opt(['1', '1.5', '2', '2.5', '3+'], c.baths >= 3 ? '3+' : c.baths) + '</select></label></div>' +
    '<div class="two"><label>Garages<select class="pin" data-w="garages">' + opt(['0', '1', '2', '3+'], c.garages >= 3 ? '3+' : c.garages) + '</select></label>' +
    '<label>Up to<input class="pin" data-w="price" inputmode="numeric" value="' + esc(moneyInput(price)) + '" placeholder="Budget"></label></div>' +
    '<label>Move by<select class="pin" data-w="when">' + opt(TIMELINES, c.timeline) + '</select></label></div>' +
    '<div class="calc"><span class="small" style="font-weight:600;color:var(--ink)">Areas</span><div class="wchips" data-w="areas">' + allAreas.map(a => '<button type="button" class="wchip on">' + esc(a) + '</button>').join('') + '</div>' +
    '<span class="small" style="font-weight:600;color:var(--ink)">Must-haves</span><div class="wchips" data-w="wants">' + WANTS.map(w => '<button type="button" class="wchip' + ((c.wants || []).includes(w) ? ' on' : '') + '">' + esc(w) + '</button>').join('') + '</div></div>' +
    '<div class="full calc"><label><span>Anything else? <small>(schools, pets, work from home…)</small></span><textarea class="pin" data-w="notes" placeholder="e.g. Close to Garsfontein schools, room for two dogs"></textarea></label>' +
    '<div><button type="button" class="wa" data-wa-wish>' + icon('wa') + 'Send my wish list to ' + esc(me.first || 'Charné') + '</button></div></div></div>', me, 7, T));

  // 8 viewing checklist
  out.push(page('', '<div class="eyb">At a viewing</div><h2>What to check</h2>' +
    '<div class="cols"><div class="stack"><h3>Inside</h3><ul class="chk">' +
    '<li><span>Backup power<small>Solar, inverter, batteries: what does it run, and for how long?</small></span></li>' +
    '<li><span>Water<small>Borehole or tanks? Any signs of damp, leaks or a tired geyser?</small></span></li>' +
    '<li><span>Roof and ceilings<small>Stains, cracks and sagging</small></span></li>' +
    '<li><span>Electrics<small>Ask when the electrical certificate was last done</small></span></li>' +
    '<li><span>Light, flow and storage<small>Visit in the morning and the afternoon if you can</small></span></li></ul></div>' +
    '<div class="stack"><h3>Outside and around</h3><ul class="chk">' +
    '<li><span>Security<small>Walls, fencing, estate access and patrols</small></span></li>' +
    '<li><span>Monthly costs<small>Rates, levies, and what the levy covers</small></span></li>' +
    '<li><span>The rules<small>Pets, renovations, home businesses and short-term letting</small></span></li>' +
    '<li><span>Your commute and schools<small>Drive it at rush hour before you decide</small></span></li>' +
    '<li><span>Fibre<small>Check which providers reach the street</small></span></li></ul></div></div>', me, 8, T));

  // 9 next steps
  out.push('<section class="pg close"><div class="pg-in"><div class="eyb">Next steps</div><h2>Let\'s find your home</h2>' +
    '<div class="nexts"><div class="s"><span class="k">1</span><b>Send your wish list</b><span>Page 7, straight to my WhatsApp.</span></div>' +
    '<div class="s"><span class="k">2</span><b>Get pre-approved</b><span>Have ready: ID, proof of address, three months\' payslips and bank statements. Self-employed: two years\' financials.</span></div>' +
    '<div class="s"><span class="k">3</span><b>Start viewing</b><span>I line up the homes that fit and come with you.</span></div></div>' +
    '<p class="mandate">Your details are used only to help you buy a home. Ask me at any time to see or delete them.</p>' +
    '<div class="closebar"><div class="who"><div class="face">' + face(me) + '</div><div><b>' + esc(me.name) + '</b><span>' + esc([me.phone, me.email].filter(Boolean).join(' · ')) + '</span></div></div>' +
    waButton(me, 'Hi ' + (me.first || '') + ', I have read my buyer guide. Let\'s talk.', 'WhatsApp ' + (me.first || 'me')) + '</div></div>' + foot(me, 9, T) + '</section>');
  return out;
}

function pagesFor(c, me) { return c.type === 'buyer' ? buyerPages(c, me) : listingPages(c, me); }

// Interactive bits inside pages (calculators, wish list). Delegated so they
// work in the preview, the presentation, the PDF and the client's copy.
function readPin(pg, k) { const el = pg.querySelector('[data-ci="' + k + '"]'); if (!el) return null; if (el.type === 'checkbox') return el.checked; return el.dataset.ci === 'rate' || el.dataset.ci === 'years' ? num(el.value) : parseMoney(el.value); }
function setOut(pg, k, v) { const el = pg.querySelector('[data-co="' + k + '"]'); if (el) el.innerHTML = v; }
function updateCalc(pg) {
  const kind = pg.dataset.calc;
  if (kind === 'afford') {
    const price = readPin(pg, 'price') || 0, dep = readPin(pg, 'deposit') || 0, rate = readPin(pg, 'rate') || 0, years = readPin(pg, 'years') || 20, income = readPin(pg, 'income');
    const bond = Math.max(price - dep, 0), pay = repayment(bond, rate, years);
    setOut(pg, 'pay', price ? money(pay) : '—');
    setOut(pg, 'term', price ? 'over ' + years + ' years at ' + rate + '%' : 'Enter a purchase price');
    setOut(pg, 'bond', price ? money(bond) : '—');
    setOut(pg, 'total', price ? money(pay * years * 12) : '—');
    setOut(pg, 'need', price ? money(pay / 0.30) + ' / month' : '—');
    const showInc = !!income;
    $$('[data-co-row]', pg).forEach(r => r.hidden = !showInc);
    const ladder = pg.querySelector('[data-co="ladder"]');
    if (ladder) {
      if (!price) ladder.innerHTML = '';
      else {
        const share = dep / price;
        const pts = Array.from(new Set([0.8, 0.9, 1, 1.1].map(k => Math.round(price * k / 50000) * 50000))).filter(v => v > 0);
        ladder.innerHTML = '<div class="small" style="letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px">Other price points</div><table class="tbl mini"><thead><tr><th>Price</th><th class="r">Per month</th><th class="r">Income needed</th></tr></thead><tbody>' +
          pts.map(v => { const pm = repayment(v * (1 - share), rate, years); return '<tr' + (v === Math.round(price / 50000) * 50000 ? ' class="you"' : '') + '><td>' + money(v) + '</td><td class="r">' + money(pm) + '</td><td class="r">' + money(pm / 0.3) + '</td></tr>'; }).join('') + '</tbody></table>';
      }
    }
    if (showInc) {
      setOut(pg, 'max', money(maxBond(income, rate, years)));
      setOut(pg, 'fit', !price ? '—' : (pay <= income * 0.30 ? '<span class="ok">Within reach</span>' : '<span class="stretch">A stretch</span>'));
    }
  } else if (kind === 'costs') {
    const price = readPin(pg, 'price') || 0, dep = readPin(pg, 'deposit') || 0, vat = readPin(pg, 'vat'), tf = readPin(pg, 'tfees'), bf = readPin(pg, 'bfees');
    const duty = transferDuty(price, vat);
    const loan = price - dep > 0;
    setOut(pg, 'dep', money(dep));
    setOut(pg, 'duty', price ? (vat ? 'None (VAT sale)' : money(duty)) : '—');
    setOut(pg, 'tf', tf ? money(tf) : '<span class="q">Quote needed</span>');
    setOut(pg, 'bf', !loan ? 'No bond' : (bf ? money(bf) : '<span class="q">Quote needed</span>'));
    const complete = !!tf && (!loan || !!bf);
    setOut(pg, 'cashlabel', complete ? 'Cash needed on transfer' : 'Cash needed, before attorney fees');
    setOut(pg, 'cash', price ? money(dep + duty + (tf || 0) + (loan ? (bf || 0) : 0)) : '—');
  }
}
function initPages(root) { $$('.pg[data-calc]', root).forEach(updateCalc); }
document.addEventListener('input', e => { const pg = e.target.closest && e.target.closest('.pg[data-calc]'); if (pg) updateCalc(pg); });
document.addEventListener('change', e => { const pg = e.target.closest && e.target.closest('.pg[data-calc]'); if (pg) updateCalc(pg); });
document.addEventListener('focusout', e => {
  const t = e.target; if (!t.classList || !t.classList.contains('pin')) return;
  const k = t.dataset.ci || t.dataset.w;
  if (['price', 'deposit', 'income', 'tfees', 'bfees'].includes(k)) { const v = parseMoney(t.value); if (v != null) t.value = moneyInput(v); }
});
document.addEventListener('click', e => {
  const chip = e.target.closest && e.target.closest('.wchip');
  if (chip) { chip.classList.toggle('on'); return; }
  const wish = e.target.closest && e.target.closest('[data-wa-wish]');
  if (wish) {
    const pg = wish.closest('.pg');
    const val = k => { const el = pg.querySelector('[data-w="' + k + '"]'); return el ? el.value : ''; };
    const chips = k => $$('[data-w="' + k + '"] .wchip.on', pg).map(b => b.textContent);
    const who = CURRENT_CLIENT ? (CURRENT_CLIENT.names || '') : '';
    const lines = ['Hi ' + (CURRENT_ME.first || '') + ', here is my wish list' + (who ? ' (' + who + ')' : '') + ':',
      '• ' + val('beds') + ' bedrooms, ' + val('baths') + ' bathrooms, ' + val('garages') + ' garages',
      val('price') ? '• Budget up to R' + val('price') : '',
      chips('areas').length ? '• Areas: ' + chips('areas').join(', ') : '',
      chips('wants').length ? '• Must-haves: ' + chips('wants').join(', ') : '',
      '• Move: ' + val('when'),
      val('notes') ? '• Also: ' + val('notes') : ''].filter(Boolean);
    window.open(waLink(CURRENT_ME.phone, lines.join('\n')), '_blank', 'noopener');
  }
});
let CURRENT_CLIENT = null, CURRENT_ME = ME;

// ───────────────────────── decks: fit, present, print ─────────────────────────
const PW = 1122, PH = 793;
function deckHTML(pages) { return pages.map((p, i) => '<div class="frame" data-i="' + i + '">' + p + '</div>').join(''); }
function fitFrames(frames, width, maxH, allowFlow) {
  const flow = allowFlow && width < 760;
  const s = Math.min(width / PW, maxH ? maxH / PH : Infinity);
  frames.forEach(f => {
    f.classList.toggle('fixed', !flow); f.classList.toggle('flow', flow);
    if (!flow) f.style.setProperty('--s', s.toFixed(4)); else f.style.removeProperty('--s');
  });
}

function present(c, me, start) {
  CURRENT_CLIENT = c; CURRENT_ME = me;
  const pages = pagesFor(c, me);
  let i = Math.max(0, Math.min(start || 0, pages.length - 1));
  const ov = $('#overlay');
  ov.innerHTML = '<div class="present" role="dialog" aria-label="Presentation"><div class="pr-stage">' + deckHTML(pages) + '</div>' +
    '<div class="pr-bar"><button class="btn btn-d btn-sm" data-pr="prev" aria-label="Previous page">←</button><span class="count" id="pr-count"></span><button class="btn btn-d btn-sm" data-pr="next" aria-label="Next page">→</button>' +
    '<div class="pr-dots">' + pages.map((_, k) => '<button data-pr-go="' + k + '" aria-label="Page ' + (k + 1) + '"></button>').join('') + '</div><span class="sp"></span>' +
    '<span style="font-size:12.5px;opacity:.6">← → to move · Esc to finish</span><button class="btn btn-d btn-sm" data-pr="full">Full screen</button><button class="btn btn-d btn-sm" data-pr="close">Close</button></div></div>';
  const stage = $('.pr-stage', ov), frames = $$('.frame', stage);
  function layout() { fitFrames(frames, stage.clientWidth - 32, stage.clientHeight - 32, false); }
  function show() {
    frames.forEach((f, k) => f.hidden = k !== i);
    $('#pr-count').textContent = (i + 1) + ' / ' + pages.length;
    $$('[data-pr-go]', ov).forEach((b, k) => b.classList.toggle('on', k === i));
  }
  function go(n) { i = Math.max(0, Math.min(pages.length - 1, n)); show(); }
  function close() {
    document.removeEventListener('keydown', key); window.removeEventListener('resize', layout);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ov.onclick = null; ov.innerHTML = '';
  }
  function key(e) {
    if (e.target.closest && e.target.closest('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(i + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(pages.length - 1);
    else if (e.key === 'Escape' && !document.fullscreenElement) close();
  }
  ov.onclick = e => {
    const b = e.target.closest('[data-pr],[data-pr-go]'); if (!b) return;
    if (b.dataset.prGo) return go(Number(b.dataset.prGo));
    const a = b.dataset.pr;
    if (a === 'prev') go(i - 1); else if (a === 'next') go(i + 1); else if (a === 'close') close();
    else if (a === 'full') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here. Press F11.')); }
  };
  document.addEventListener('keydown', key); window.addEventListener('resize', layout);
  document.addEventListener('fullscreenchange', () => setTimeout(layout, 60));
  layout(); show(); initPages(stage);
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
}

function preparePrint(c, me) {
  CURRENT_CLIENT = c; CURRENT_ME = me;
  const root = $('#print-root');
  root.innerHTML = deckHTML(pagesFor(c, me));
  $$('.frame', root).forEach(f => { f.classList.add('fixed'); f.style.setProperty('--s', '1'); });
  initPages(root);
  const oldTitle = document.title;
  document.title = docTitle(c);
  document.body.classList.add('printing');
  let finished = false;
  return function done() {
    if (finished) return; finished = true;
    document.body.classList.remove('printing'); document.title = oldTitle; root.innerHTML = '';
  };
}
function printDeck(c, me) {
  const done = preparePrint(c, me);
  const after = () => { window.removeEventListener('afterprint', after); done(); };
  window.addEventListener('afterprint', after);
  setTimeout(() => { window.print(); setTimeout(after, 500); }, 250);
}
function docTitle(c) {
  return c.type === 'buyer' ? 'Buyer guide - ' + (c.names || 'client') : 'Selling plan - ' + (c.address || c.names || 'client');
}
function exportHTML(c, me) {
  const payload = JSON.stringify({ v: 1, client: c, me: me, made: new Date().toISOString() }).replace(/</g, '\\u003c');
  const re = /<script id="cs-client" type="application\/json">[\s\S]*?<\/script>/;
  let html = SOURCE.replace(re, () => '<script id="cs-client" type="application/json">' + payload + '<\/script>');
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + esc(docTitle(c)) + '</title>');
  return html;
}

// ───────────────────────── studio: home ─────────────────────────
const app = $('#app');
function go(view) { VIEW = view; render(); window.scrollTo(0, 0); }
function render() {
  if (VIEW.name === 'edit') { const c = CLIENTS.find(x => x.id === VIEW.id); if (c) return renderEditor(c); VIEW = { name: 'home' }; }
  renderHome();
}

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function renderHome() {
  document.title = 'Charné Client Studio';
  window.onresize = null;
  const rows = CLIENTS.map(c => {
    const isB = c.type === 'buyer';
    const pic = isB ? (c.hero || '') : (c.photo || '');
    const title = isB ? (c.names || 'New buyer') : (c.address || c.names || 'New listing');
    const sub = isB ? [c.priceMax ? 'Up to ' + moneyShort(c.priceMax) : '', (c.areas || []).slice(0, 3).join(', ')] : [c.names, c.suburb, c.ask ? money(c.ask) : ''];
    return '<div class="crow"><button class="thumb" data-open="' + c.id + '" aria-label="Open">' + (pic ? '<img src="' + src(pic) + '" alt="">' : (isB ? svgBuyer() : svgListing())) + '</button>' +
      '<div style="min-width:0"><button class="nm" data-open="' + c.id + '">' + esc(title) + '</button><div class="meta"><span class="pill ' + (isB ? 'buyer' : 'seller') + '">' + (isB ? 'Buyer guide' : 'Listing') + '</span>' + (c.example ? '<span class="pill ex">Example</span>' : '') +
      sub.filter(Boolean).map(s => '<span>' + esc(s) + '</span>').join('<span>·</span>') + '<span>· edited ' + esc(timeAgo(c.updated)) + '</span></div></div>' +
      '<div class="acts"><button class="btn btn-d btn-sm" data-open="' + c.id + '">Edit</button><button class="btn btn-d btn-sm" data-present="' + c.id + '">Present</button><button class="btn btn-p btn-sm" data-send="' + c.id + '">Send</button>' +
      '<button class="btn btn-d btn-sm" data-copy="' + c.id + '" title="Make a copy for another client">Copy</button><button class="btn btn-d btn-sm" data-del="' + c.id + '" title="Delete">Delete</button></div></div>';
  }).join('');
  app.innerHTML = '<div class="home"><div class="topbar"><img class="lock" src="' + ASSETS.lockupWhite + '" alt="RB Brand Real Estate"><span class="app-name">Client Studio</span><span class="sp"></span>' +
    '<button class="btn btn-p btn-sm" data-act="ai">✦ Build with Claude or ChatGPT</button><button class="btn btn-d btn-sm" data-act="demo">How to demo</button><button class="btn btn-d btn-sm" data-act="me">My details</button></div>' +
    '<div class="hello"><div class="eyebrow">' + esc(ME.name) + ' · ' + esc(ME.agency) + '</div><h1>' + greeting() + ', ' + esc(ME.first || 'Charné') + '</h1>' +
    '<p>Pick what you need, fill in the client\'s details, and it builds itself. Present it on your laptop, save it as a PDF, or send it to the client on WhatsApp.</p></div>' +
    (Store.broken ? '<div class="banner"><b>This browser can\'t save.</b><span>Work will be lost when the tab closes. Open this file in Chrome or Edge.</span></div>' : '') +
    (!ME.phone ? '<div class="banner"><span><b>Add your WhatsApp number.</b> It makes the "Let\'s launch" and wish-list buttons reach you.</span><span class="sp"></span><button class="btn btn-l btn-sm" data-act="me">Add it now</button></div>' : '') +
    '<div class="cards">' +
    '<article class="card"><div class="ph">' + svgListing() + '<span class="tag seller">Sellers</span></div><div class="bd"><h2>Listing Presentation</h2><p>For the valuation appointment. Their home on the cover, comparable sales, the marketing plan, what they\'ll walk away with, and a clear "let\'s launch" close.</p>' +
    '<div class="acts"><button class="cta" data-new="listing">Start for a client · 12 pages →</button><button class="cta quiet" data-example="listing">See an example</button></div></div></article>' +
    '<article class="card"><div class="ph">' + svgBuyer() + '<span class="tag buyer">Buyers</span></div><div class="bd"><h2>Buyer Guide</h2><p>For prospective buyers. The buying process, a transfer-cost and repayment calculator, suburb guides, and a wish list that goes straight to WhatsApp.</p>' +
    '<div class="acts"><button class="cta" data-new="buyer">Start for a client · 9 pages →</button><button class="cta quiet" data-example="buyer">See an example</button></div></div></article></div>' +
    '<div class="section-h"><h2>Your clients</h2><p>Saved on this computer. Click a name to carry on.</p></div>' +
    (rows ? '<div class="clients">' + rows + '</div>' : '<div class="empty">No clients yet. Start with one of the cards above. It takes about five minutes.</div>') +
    '<div class="home-foot"><span>Nothing leaves this computer until you send it.</span><span><button class="link" style="color:rgba(255,255,255,.7)" data-act="backup">Download a backup</button></span></div></div>';
}
function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
}

app.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-open]'); if (!t) return;
  const d = t.dataset;
  if (d.new) { const c = d.new === 'buyer' ? newBuyer(ME) : newListing(ME); saveClient(c, true); go({ name: 'edit', id: c.id, step: 0 }); }
  else if (d.example) {
    const have = CLIENTS.find(x => x.example && x.type === d.example);
    const c = have || (d.example === 'buyer' ? exampleBuyer(ME) : exampleListing(ME));
    if (!have) saveClient(c, true);
    go({ name: 'edit', id: c.id, step: 0 }); toast(have ? 'Here is the example again.' : 'Example loaded. Change anything you like.');
  }
  else if (d.open) go({ name: 'edit', id: d.open, step: 0 });
  else if (d.present) { const c = CLIENTS.find(x => x.id === d.present); if (c) present(c, ME, 0); }
  else if (d.send) { const c = CLIENTS.find(x => x.id === d.send); if (c) openSend(c); }
  else if (d.copy) {
    const src0 = CLIENTS.find(x => x.id === d.copy); if (!src0) return;
    const c = JSON.parse(JSON.stringify(src0)); c.id = uid(); c.created = Date.now(); c.example = false;
    c.names = ''; c.first = ''; c.phone = ''; c.email = ''; c.date = todayISO();
    if (c.type === 'listing') { c.address = ''; c.photo = ''; c.photo2 = ''; c.bond = null; } else { c.income = null; }
    saveClient(c, true); go({ name: 'edit', id: c.id, step: 0 }); toast('Copied. Comparables and settings kept; client details cleared.');
  }
  else if (d.del) {
    const c = CLIENTS.find(x => x.id === d.del); if (!c) return;
    if (!confirm('Delete ' + (c.address || c.names || 'this client') + '? This cannot be undone.')) return;
    CLIENTS = CLIENTS.filter(x => x !== c); await Store.del('client:' + c.id); render(); toast('Deleted.');
  }
  else if (d.act === 'me') openMe(false);
  else if (d.act === 'demo') openDemo();
  else if (d.act === 'ai') openAI();
  else if (d.act === 'backup') backup();
  else if (d.act === 'home') { flushSaves(); go({ name: 'home' }); }
  else if (d.act === 'present') { const c = CLIENTS.find(x => x.id === VIEW.id); if (c) present(c, ME, 0); }
  else if (d.act === 'send') { const c = CLIENTS.find(x => x.id === VIEW.id); if (c) openSend(c); }
  else if (d.act === 'pdf') { const c = CLIENTS.find(x => x.id === VIEW.id); if (c) printDeck(c, ME); }
});

// ───────────────────────── studio: editor ─────────────────────────
const STEPS = {
  listing: [
    { key: 'client', title: 'The client', pages: [0, 1] },
    { key: 'home', title: 'Their home', pages: [2, 0] },
    { key: 'price', title: 'Sales & price', pages: [4, 3] },
    { key: 'net', title: 'Walk-away figure', pages: [8] },
    { key: 'market', title: 'Marketing & launch', pages: [6, 7] },
    { key: 'send', title: 'Present & send', pages: [11] }
  ],
  buyer: [
    { key: 'client', title: 'The buyer', pages: [0, 1] },
    { key: 'budget', title: 'Budget', pages: [3, 4] },
    { key: 'areas', title: 'Areas', pages: [5] },
    { key: 'wish', title: 'Wish list', pages: [6] },
    { key: 'send', title: 'Present & send', pages: [8] }
  ]
};
function f(label, input, hint) { return '<div class="f"><label>' + label + '</label>' + input + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }
function inp(c, k, opts) {
  opts = opts || {};
  let v = c[k];
  if (opts.money) v = moneyInput(v);
  return '<input class="in" data-k="' + k + '"' + (opts.money ? ' data-t="money" inputmode="numeric"' : '') + (opts.type ? ' type="' + opts.type + '"' : '') + (opts.step ? ' step="' + opts.step + '"' : '') +
    (opts.min != null ? ' min="' + opts.min + '"' : '') + (opts.list ? ' list="' + opts.list + '"' : '') + (opts.type === 'number' ? ' data-t="num"' : '') +
    ' value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(opts.ph || '') + '">';
}
function sel(c, k, vals) { return '<select class="in" data-k="' + k + '"' + (typeof vals[0] === 'number' ? ' data-t="num"' : '') + '>' + vals.map(v => '<option' + (String(v) === String(c[k]) ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>'; }
function area(c, k, ph) { return '<textarea class="in" data-k="' + k + '" placeholder="' + esc(ph || '') + '">' + esc(c[k] || '') + '</textarea>'; }
function tog(c, k, label) { return '<label class="toggle"><input type="checkbox" data-k="' + k + '" data-t="bool"' + (c[k] ? ' checked' : '') + '><span>' + label + '</span></label>'; }
function dropZone(c, k, title, hint) {
  return '<div class="drop" tabindex="0" data-photo="' + k + '" role="button" aria-label="' + esc(title) + '">' +
    (c[k] ? '<img src="' + src(c[k]) + '" alt=""><div class="drop-acts"><span class="link">Replace</span><span class="link" data-clear-photo="' + k + '">Remove</span></div>'
      : '<div class="big">' + esc(title) + '</div><div>Drag a photo here, click to choose one, or paste (Ctrl+V)</div>') +
    (hint ? '<div class="hint">' + hint + '</div>' : '') + '<input type="file" accept="image/*" hidden></div>';
}

function stepForm(c, step) {
  const L = c.type === 'listing';
  const key = STEPS[c.type][step].key;
  let h = '';
  if (key === 'client') {
    h = '<h2>' + (L ? 'Who is this for?' : 'Who is buying?') + '</h2><p class="lead">' + (L ? 'Start with the seller. Their name goes on the cover.' : 'Their name goes on the cover of the guide.') + '</p>' +
      f(L ? 'Seller name(s)' : 'Buyer name(s)', inp(c, 'names', { ph: L ? 'e.g. Pieter & Anri Botha' : 'e.g. Lerato & Sipho Mokoena' })) +
      f('How to greet them', inp(c, 'first', { ph: firstNameOf(c.names) || 'First names' }), 'Used on page 2: "' + (L ? 'Thank you' : 'Welcome') + ', ' + esc(greetName(c) || '…') + '". Leave blank to use first names.') +
      '<div class="row2">' + f('Their WhatsApp number', inp(c, 'phone', { ph: '082 123 4567', type: 'tel' }), 'For sending their copy') + f('Email', inp(c, 'email', { ph: 'optional', type: 'email' })) + '</div>' +
      f(L ? 'Appointment date' : 'Date', inp(c, 'date', { type: 'date' })) +
      (L ? '' : '<div class="row2">' + f('Timeline', sel(c, 'timeline', TIMELINES)) + '<div class="f" style="align-content:end;gap:8px">' + tog(c, 'firstTime', 'First-time buyer') + tog(c, 'preapproved', 'Already pre-approved') + '</div></div>') +
      f('Personal note', area(c, 'note'), 'Prefilled. Make it yours. It appears on page 2.') +
      (L ? '' : f('Cover photo (optional)', dropZone(c, 'hero', 'Add a cover photo', 'Leave it empty to use the illustration.')));
  } else if (key === 'home') {
    h = '<h2>Their home</h2><p class="lead">The cover and page 3 build from this.</p>' +
      f('Street address', inp(c, 'address', { ph: 'e.g. 12 Jacaranda Street' })) +
      '<div class="row2">' + f('Suburb', inp(c, 'suburb', { ph: 'e.g. Equestria', list: 'dl-suburbs' })) + f('Area', inp(c, 'city', { ph: 'Pretoria East', list: 'dl-cities' })) + '</div>' +
      '<datalist id="dl-suburbs">' + SUBURBS.map(s => '<option value="' + esc(s[0]) + '">').join('') + '</datalist><datalist id="dl-cities"><option value="Pretoria East"><option value="Centurion"><option value="Pretoria"><option value="Hartbeespoort"></datalist>' +
      f('Type of home', sel(c, 'propType', PROP_TYPES)) +
      '<div class="row3">' + f('Bedrooms', inp(c, 'beds', { type: 'number', min: 0 })) + f('Bathrooms', inp(c, 'baths', { type: 'number', min: 0, step: 0.5 })) + f('Garages', inp(c, 'garages', { type: 'number', min: 0 })) + '</div>' +
      '<div class="row2">' + f('Floor size (m²)', inp(c, 'floor', { type: 'number', min: 0, ph: 'e.g. 148' })) + f('Stand size (m²)', inp(c, 'erf', { type: 'number', min: 0, ph: 'optional' })) + '</div>' +
      f('Cover photo', dropZone(c, 'photo', 'Add the cover photo', 'Their home, front or garden side. Landscape works best.')) +
      '<div class="f"><span class="lbl">Features</span><div class="chips" data-chips="features">' + FEATURES.concat((c.features || []).filter(x => !FEATURES.includes(x))).map(x => '<button type="button" class="chip' + ((c.features || []).includes(x) ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>' +
      '<div class="addrow"><input class="in" id="feat-add" placeholder="Add your own, e.g. Jacuzzi"><button class="btn btn-l btn-sm" data-add-feature>Add</button></div></div>' +
      '<div class="f"><label>What buyers will love</label>' + area(c, 'love', 'One or two lines. Lifestyle first, then the facts.') +
      '<div class="hint"><button class="link" data-write-love>Write it for me</button> from the features you ticked. Edit as you like.</div></div>' +
      f('Second photo (optional)', dropZone(c, 'photo2', 'Add a second photo', 'Shown on page 3. Inside or the garden.'));
  } else if (key === 'price') {
    const st = compStats(c);
    h = '<h2>Comparable sales & price</h2><p class="lead">Add three to six recent sales nearby: what they sold for, not asking prices. Add a listing that\'s on the market too, if it\'s competition.</p>' +
      (c.comps || []).map((r, i) => '<div class="comp"><div class="comp-h"><span>Sale ' + (i + 1) + '</span><button class="x" data-del-comp="' + i + '">Remove</button></div>' +
        '<input class="in" data-comp="' + i + '" data-ck="addr" value="' + esc(r.addr || '') + '" placeholder="Address or description, e.g. 3-bed, same complex">' +
        '<div class="row2"><input class="in" data-comp="' + i + '" data-ck="price" data-t="money" inputmode="numeric" value="' + esc(moneyInput(r.price)) + '" placeholder="Price, e.g. 2 050 000">' +
        '<input class="in" data-comp="' + i + '" data-ck="size" data-t="num" type="number" min="0" value="' + esc(r.size || '') + '" placeholder="Size m²"></div>' +
        '<div class="row3 comp3"><input class="in" data-comp="' + i + '" data-ck="beds" data-t="num" type="number" min="0" value="' + esc(r.beds || '') + '" placeholder="Beds">' +
        '<input class="in" data-comp="' + i + '" data-ck="date" type="month" value="' + esc(r.date || '') + '" title="Month sold">' +
        '<select class="in" data-comp="' + i + '" data-ck="status">' + ['Sold', 'On the market'].map(s => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div></div>').join('') +
      ((c.comps || []).length < 6 ? '<button class="btn btn-l" data-add-comp>+ Add a sale</button>' : '') +
      f('Where the figures come from (optional)', inp(c, 'compSource', { ph: 'e.g. Lightstone, Deeds Office records' }), 'Shown under the table on page 4.') +
      '<div class="sumbox" id="comp-sum">' + compSummary(c, st) + '</div>' +
      '<div class="row3">' + f('Range from', inp(c, 'low', { money: true, ph: '2 000 000' })) + f('Range to', inp(c, 'high', { money: true, ph: '2 200 000' })) + f('Asking price', inp(c, 'ask', { money: true, ph: '2 099 000' })) + '</div>' +
      '<div class="hint">Type prices any way: 2099000, 2 099 000 or 2.1m.</div>';
  } else if (key === 'net') {
    h = '<h2>What they\'ll walk away with</h2><p class="lead">Page 9 works out the seller\'s estimated net at the asking price. Leave anything you don\'t know blank. It simply won\'t show.</p>' +
      '<div class="row2">' + f('Commission %', inp(c, 'commission', { type: 'number', min: 0, step: 0.25 }), 'Your rate for this mandate') + '<div class="f" style="align-content:end">' + tog(c, 'vatIncl', 'This % already includes VAT') + '</div></div>' +
      f('Bond settlement (optional)', inp(c, 'bond', { money: true, ph: 'From their bank' }), 'Ask what they still owe. The bank gives the exact figure later.') +
      f('Bond cancellation fees (optional)', inp(c, 'cancel', { money: true, ph: 'From the attorney\'s quote' })) +
      f('Compliance certificates (optional)', inp(c, 'certs', { money: true, ph: 'From quotes' }), 'Electrical always; fence and gas if present.') +
      '<div class="sumbox" id="net-sum">' + netSummary(c) + '</div>';
  } else if (key === 'market') {
    h = '<h2>Marketing & launch</h2><p class="lead">Tick what you\'ll do for this home. Page 7 shows each one with a line on why it matters.</p>' +
      '<div class="mk" data-chips="marketing">' + MARKETING.map(m => '<button type="button" class="mkc' + ((c.marketing || []).includes(m[0]) ? ' on' : '') + '" data-v="' + m[0] + '">' + icon(m[1]) + '<span>' + esc(m[2]) + '</span></button>').join('') + '</div>' +
      f('Launch date', inp(c, 'launch', { type: 'date' }), 'The timeline on page 8 is worked out from this.') +
      '<div class="row2">' + f('Mandate', sel(c, 'mandate', ['Sole mandate', 'Open mandate', 'Dual mandate'])) + f('Months', sel(c, 'months', [1, 2, 3, 4, 5, 6])) + '</div>';
  } else if (key === 'budget') {
    h = '<h2>Their budget</h2><p class="lead">This fills in the calculators on pages 4 and 5. The buyer can change the numbers on their own copy.</p>' +
      '<div class="row2">' + f('Looking up to', inp(c, 'priceMax', { money: true, ph: 'e.g. 2 300 000' })) + f('Deposit (optional)', inp(c, 'deposit', { money: true, ph: '0' })) + '</div>' +
      f('Gross monthly income (optional)', inp(c, 'income', { money: true, ph: 'Household, before tax' }), 'Only if they shared it. It shows the largest bond banks are likely to offer.') +
      '<div class="row2">' + f('Interest rate %', inp(c, 'rate', { type: 'number', min: 0, step: 0.25 }), 'Prime is ' + PRIME + '%') + f('Term (years)', sel(c, 'years', [20, 25, 30])) + '</div>' +
      '<div class="sumbox" id="buy-sum">' + buyerSummary(c) + '</div>';
  } else if (key === 'areas') {
    const on = c.areas || [];
    h = '<h2>Areas to suggest</h2><p class="lead">Tick up to six. Edit any description: you know these streets better than anyone.</p>' +
      '<div class="hint" id="area-count">' + on.length + ' of 6 chosen</div>' +
      Array.from(new Set(SUBURBS.map(s => s[0]).concat(on, Object.keys(c.areaText || {})))).map(a => { const isOn = on.includes(a); return '<div class="area' + (isOn ? ' on' : '') + '"><label class="toggle"><input type="checkbox" data-area="' + esc(a) + '"' + (isOn ? ' checked' : '') + '><b>' + esc(a) + '</b></label>' +
        (isOn ? '<textarea class="in" data-area-text="' + esc(a) + '" placeholder="A line or two about living here">' + esc(areaText(c, a)) + '</textarea>' : '') + '</div>'; }).join('') +
      '<div class="f"><span class="lbl">Add another area</span><div class="addrow"><input class="in" id="area-add" placeholder="e.g. Olympus"><button class="btn btn-l btn-sm" data-add-area>Add</button></div></div>';
  } else if (key === 'wish') {
    h = '<h2>Their wish list</h2><p class="lead">Fill in what you already know. On their copy they can change it and send it back to you on WhatsApp.</p>' +
      '<div class="row3">' + f('Bedrooms', sel(c, 'beds', [1, 2, 3, 4, 5])) + f('Bathrooms', sel(c, 'baths', [1, 1.5, 2, 2.5, 3])) + f('Garages', sel(c, 'garages', [0, 1, 2, 3])) + '</div>' +
      '<div class="f"><span class="lbl">Must-haves</span><div class="chips" data-chips="wants">' + WANTS.map(x => '<button type="button" class="chip' + ((c.wants || []).includes(x) ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div></div>';
  } else if (key === 'send') {
    const checks = readiness(c);
    h = '<h2>Ready to present</h2><p class="lead">' + (checks.every(x => x[0]) ? 'Everything is in. Pick how you want to share it.' : 'Nearly there. You can present now and fill in the rest later.') + '</p>' +
      '<ul class="ready">' + checks.map(x => '<li class="' + (x[0] ? 'ok' : 'todo') + '"><span class="ic">' + (x[0] ? '✓' : '!') + '</span><span>' + x[1] + '</span></li>').join('') + '</ul>' +
      '<div class="bigacts"><button class="btn btn-p" data-act="present"><span>▶&nbsp; Present full screen<small>Walk them through it on your laptop. ← → to move, Esc to finish.</small></span></button>' +
      '<button class="btn btn-g" data-act="send"><span>' + icon('wa', ' style="width:18px;height:18px;vertical-align:-3px"') + '&nbsp; Send to ' + esc(greetName(c) || 'the client') + '<small>Their own copy, to open on a phone or computer.</small></span></button>' +
      '<button class="btn btn-l" data-act="pdf"><span>⤓&nbsp; Save as PDF<small>For email, or to print. Choose "Save as PDF" as the printer.</small></span></button></div>';
  }
  const steps = STEPS[c.type];
  h += '<div class="navbtns">' + (step > 0 ? '<button class="btn btn-l" data-step="' + (step - 1) + '">← Back</button>' : '<span></span>') +
    (step < steps.length - 1 ? '<button class="btn btn-p" data-step="' + (step + 1) + '">Next: ' + esc(steps[step + 1].title) + ' →</button>' : '<button class="btn btn-l" data-act="home">Done</button>') + '</div>';
  return h;
}
function compSummary(c, st) {
  st = st || compStats(c);
  if (!st.sold.length) return '<span>Add sold prices and sizes to see the average and a suggested price.</span>';
  let s = '<span>Average sold: <b>' + money(st.avg) + '</b>' + (st.perM2 ? ' · Average per m²: <b>' + money(st.perM2) + '</b>' : '') + '</span>';
  if (st.indicative) s += '<span>Their ' + esc(c.floor) + ' m² at that rate: <b>' + money(st.indicative) + '</b></span><div><button class="link" data-suggest>Use this to fill in the range and asking price</button></div>';
  else if (st.perM2) s += '<span class="hint">Add the floor size on step 2 to get a suggested price.</span>';
  return s;
}
function netSummary(c) {
  const ask = num(c.ask);
  if (!ask) return '<span>Add the asking price on step 3 first.</span>';
  const com = commission(ask, num(c.commission), c.vatIncl);
  return '<span>At ' + money(ask) + ', commission incl. VAT is <b>' + money(com.incl) + '</b></span><span>Estimated amount to the seller</span><span class="big">' + money(sellerNet(c, ask)) + '</span>';
}
function buyerSummary(c) {
  const p = num(c.priceMax); if (!p) return '<span>Add a price to see the monthly repayment.</span>';
  const bond = Math.max(p - (num(c.deposit) || 0), 0), pay = repayment(bond, num(c.rate) || PRIME, num(c.years) || 20);
  return '<span>At ' + money(p) + ', the repayment is about</span><span class="big">' + money(pay) + ' / month</span><span>Transfer duty: <b>' + money(transferDuty(p)) + '</b> · Income banks look for: <b>' + money(pay / 0.3) + '</b></span>';
}
function readiness(c) {
  const out = [];
  out.push([!!c.names, c.type === 'buyer' ? 'Buyer\'s name' : 'Seller\'s name']);
  if (c.type === 'listing') {
    out.push([!!c.address, 'Address']);
    out.push([!!c.photo, 'Cover photo of their home']);
    out.push([compStats(c).sold.length >= 1, 'At least one comparable sale']);
    out.push([!!num(c.ask), 'Asking price']);
  } else {
    out.push([!!num(c.priceMax), 'Budget']);
    out.push([(c.areas || []).length > 0, 'At least one area']);
  }
  out.push([!!c.phone, 'Their WhatsApp number, for sending their copy']);
  out.push([!!ME.phone, 'Your own WhatsApp number in <button class="link" data-act="me">My details</button>, so their buttons reach you']);
  return out;
}
function writeLove(c) {
  const t = (c.propType || 'home').toLowerCase();
  const open = (c.beds ? c.beds + '-bedroom ' : '') + t + (c.suburb ? ' in ' + c.suburb : '') + '.';
  const lines = (c.features || []).map(x => FEATURE_LINE[x] || (x + '.')).slice(0, 4);
  return [open.charAt(0).toUpperCase() + open.slice(1)].concat(lines).join(' ');
}

let refreshPreview = () => {};
function renderEditor(c) {
  const steps = STEPS[c.type];
  const step = Math.max(0, Math.min(VIEW.step || 0, steps.length - 1));
  VIEW.step = step;
  if (VIEW.focus == null) VIEW.focus = steps[step].pages[0];
  CURRENT_CLIENT = c; CURRENT_ME = ME;
  document.title = (c.type === 'buyer' ? 'Buyer guide' : 'Listing') + ' – ' + (c.address || c.names || 'new') + ' · Client Studio';
  app.innerHTML = '<div class="ed"><div class="ed-bar"><button class="btn btn-d btn-sm" data-act="home">← All clients</button>' +
    '<div class="ttl" id="ed-title">' + esc(edTitle(c)) + '<small>' + (c.type === 'buyer' ? 'Buyer guide' : 'Listing presentation') + '</small></div>' +
    '<span class="saved" id="saved">Saved ✓</span><button class="btn btn-d btn-sm" data-act="pdf">Save as PDF</button><button class="btn btn-d btn-sm" data-act="present">▶ Present</button><button class="btn btn-p btn-sm" data-act="send">Send to client</button></div>' +
    '<nav class="steps" aria-label="Steps">' + steps.map((s, i) => '<button class="step' + (i === step ? ' on' : '') + (i < step ? ' done' : '') + '" data-step="' + i + '"><b>' + (i < step ? '✓' : i + 1) + '</b>' + esc(s.title) + '</button>').join('') + '</nav>' +
    '<div class="ed-main"><form class="form" id="form" autocomplete="off" onsubmit="return false">' + stepForm(c, step) + '</form>' +
    '<aside class="preview" aria-label="Preview"><div class="pv-label"><span id="pv-name"></span><span>Live preview · click a page below to see it</span></div><div class="pv-main" id="pv-main"></div><div class="thumbs" id="thumbs"></div></aside></div></div>';
  const form = $('#form');
  const pvMain = $('#pv-main'), thumbs = $('#thumbs');
  const draw = () => {
    const pages = pagesFor(c, ME);
    const fi = Math.min(VIEW.focus || 0, pages.length - 1);
    pvMain.innerHTML = '<div class="frame">' + pages[fi] + '</div>';
    const pvW = pvMain.clientWidth || 700;
    const maxH = Math.max(320, window.innerHeight - 250);
    fitFrames($$('.frame', pvMain), pvW, maxH, false);
    thumbs.innerHTML = pages.map((p, i) => '<button type="button" data-focus="' + i + '"' + (i === fi ? ' class="on"' : '') + ' aria-label="Page ' + (i + 1) + '"><span class="tn">' + (i + 1) + '</span><div class="frame">' + p + '</div></button>').join('');
    fitFrames($$('.frame', thumbs), 120, null, false);
    $('#pv-name').textContent = 'Page ' + (fi + 1) + ' of ' + pages.length;
    initPages(pvMain);
    const t = $('#ed-title'); if (t) t.firstChild.textContent = edTitle(c);
  };
  refreshPreview = debounce(draw, 140);
  draw();
  window.onresize = debounce(draw, 150);

  const change = () => { saveClient(c); refreshPreview(); updateSums(c); };
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.k) {
      const k = el.dataset.k, t = el.dataset.t;
      let v = el.value;
      if (t === 'money') v = parseMoney(v);
      else if (t === 'num') v = v === '' ? '' : Number(v);
      else if (t === 'bool') v = el.checked;
      c[k] = v;
      if (k === 'names' && !c.first) { const ph = $('[data-k="first"]'); if (ph) ph.placeholder = firstNameOf(c.names) || 'First names'; }
      change();
    } else if (el.dataset.comp != null) {
      const r = c.comps[Number(el.dataset.comp)]; const k = el.dataset.ck, t = el.dataset.t;
      r[k] = t === 'money' ? parseMoney(el.value) : t === 'num' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      change();
    } else if (el.dataset.areaText) {
      c.areaText = c.areaText || {}; c.areaText[el.dataset.areaText] = el.value; change();
    }
  });
  form.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.area) {
      const a = el.dataset.area; c.areas = c.areas || [];
      if (el.checked) { if (c.areas.length >= 6) { el.checked = false; toast('Six areas at most, so each one gets room on the page.'); return; } c.areas.push(a); }
      else c.areas = c.areas.filter(x => x !== a);
      change(); rerenderForm(c);
    } else if (el.type === 'checkbox' && el.dataset.k) { c[el.dataset.k] = el.checked; change(); }
    else if (el.tagName === 'SELECT' && el.dataset.k) { c[el.dataset.k] = el.dataset.t === 'num' ? Number(el.value) : el.value; change(); }
  });
  form.addEventListener('focusout', e => {
    const el = e.target;
    if (el.dataset && el.dataset.t === 'money') { const v = parseMoney(el.value); el.value = moneyInput(v); }
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('button,[data-photo],[data-clear-photo]'); if (!b) return;
    if (b.dataset.clearPhoto) { e.stopPropagation(); c[b.dataset.clearPhoto] = ''; change(); rerenderForm(c); return; }
    if (b.dataset.photo) { const fi = b.querySelector('input[type=file]'); if (e.target !== fi) fi.click(); return; }
    if (b.closest('[data-chips]') && b.dataset.v != null) {
      const k = b.closest('[data-chips]').dataset.chips, v = b.dataset.v; c[k] = c[k] || [];
      c[k] = c[k].includes(v) ? c[k].filter(x => x !== v) : c[k].concat([v]);
      b.classList.toggle('on'); change(); return;
    }
    if (b.hasAttribute('data-add-feature')) { const i = $('#feat-add'); const v = i.value.trim(); if (v) { c.features = (c.features || []).concat([v]); change(); rerenderForm(c); } return; }
    if (b.hasAttribute('data-write-love')) { c.love = writeLove(c); change(); rerenderForm(c); toast('Drafted. Edit it to taste.'); return; }
    if (b.hasAttribute('data-add-comp')) { c.comps.push({ addr: '', price: null, size: '', beds: '', date: '', status: 'Sold' }); change(); rerenderForm(c); return; }
    if (b.dataset.delComp != null) { c.comps.splice(Number(b.dataset.delComp), 1); change(); rerenderForm(c); return; }
    if (b.hasAttribute('data-suggest')) {
      const st = compStats(c); if (!st.indicative) return;
      const v = st.indicative;
      c.low = Math.round(v * 0.96 / 50000) * 50000; c.high = Math.round(v * 1.04 / 50000) * 50000; c.ask = Math.round(v / 100000) * 100000 - 1000;
      change(); rerenderForm(c); toast('Range and asking price filled in. Adjust them to your judgement.'); return;
    }
    if (b.hasAttribute('data-add-area')) {
      const i = $('#area-add'); const v = i.value.trim(); if (!v) return;
      if ((c.areas || []).length >= 6) { toast('Six areas at most.'); return; }
      if ((c.areas || []).includes(v)) return;
      if (!(v in SUBURB_TEXT)) { c.areaText = c.areaText || {}; if (!(v in c.areaText)) c.areaText[v] = ''; }
      c.areas = (c.areas || []).concat([v]); change(); rerenderForm(c); return;
    }
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault();
    if (e.key === 'Enter' && e.target.id === 'feat-add') { e.preventDefault(); $('[data-add-feature]').click(); }
    if (e.key === 'Enter' && e.target.id === 'area-add') { e.preventDefault(); $('[data-add-area]').click(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.photo) { e.preventDefault(); e.target.querySelector('input[type=file]').click(); }
  });
  form.addEventListener('change', e => { if (e.target.type === 'file') { const z = e.target.closest('[data-photo]'); takePhoto(c, z.dataset.photo, e.target.files[0]); } });
  form.addEventListener('dragover', e => { const z = e.target.closest('[data-photo]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  form.addEventListener('dragleave', e => { const z = e.target.closest('[data-photo]'); if (z) z.classList.remove('over'); });
  form.addEventListener('drop', e => { const z = e.target.closest('[data-photo]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); takePhoto(c, z.dataset.photo, e.dataTransfer.files[0]); });

  $('.steps').onclick = e => { const b = e.target.closest('[data-step]'); if (b) gotoStep(c, Number(b.dataset.step)); };
  form.addEventListener('click', e => { const b = e.target.closest('.navbtns [data-step]'); if (b) gotoStep(c, Number(b.dataset.step)); });
  thumbs.onclick = e => { const b = e.target.closest('[data-focus]'); if (b) { VIEW.focus = Number(b.dataset.focus); draw(); } };
}
function edTitle(c) { return c.type === 'buyer' ? (c.names || 'New buyer guide') : (c.address || c.names || 'New listing presentation'); }
function gotoStep(c, i) { VIEW.step = i; VIEW.focus = STEPS[c.type][i].pages[0]; renderEditor(c); window.scrollTo(0, 0); }
function rerenderForm(c) {
  const form = $('#form'); if (!form) return;
  const y = window.scrollY;
  form.innerHTML = stepForm(c, VIEW.step);
  window.scrollTo(0, y);
}
function updateSums(c) {
  const a = $('#comp-sum'); if (a) a.innerHTML = compSummary(c);
  const b = $('#net-sum'); if (b) b.innerHTML = netSummary(c);
  const d = $('#buy-sum'); if (d) d.innerHTML = buyerSummary(c);
  const n = $('#area-count'); if (n) n.textContent = (c.areas || []).length + ' of 6 chosen';
}
async function takePhoto(c, k, file) {
  if (!file) return;
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) { toast('iPhone HEIC photos can\'t be read here. Save it as a JPG first (or take a screenshot).', 5000); return; }
  toast('Adding photo…');
  try {
    c[k] = await readImage(file, k === 'photo' || k === 'hero' ? 1800 : 1400, 0.82);
    saveClient(c); rerenderForm(c); refreshPreview(); toast('Photo added.');
    if (k === 'photo' || k === 'hero') { VIEW.focus = 0; refreshPreview(); }
  } catch (e) { toast('That file isn\'t a photo this browser can read. Try a JPG or PNG.', 4000); }
}
document.addEventListener('paste', e => {
  if (VIEW.name === 'home' && !SHIPPED && !$('#overlay').children.length) {
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (t.includes(AI_TAG)) { e.preventDefault(); try { afterImport(importAI(t)); } catch (err) { toast('Couldn\'t read that reply. Use "Build with Claude or ChatGPT" and paste it there.', 4500); } }
    return;
  }
  if (VIEW.name !== 'edit' || $('#overlay').children.length) return;
  const items = Array.from((e.clipboardData || {}).items || []);
  const it = items.find(x => x.type && x.type.startsWith('image/'));
  if (!it) return;
  const c = CLIENTS.find(x => x.id === VIEW.id); if (!c) return;
  const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.photo;
  const target = focused || (c.type === 'buyer' ? 'hero' : (c.photo ? (c.photo2 ? 'photo' : 'photo2') : 'photo'));
  e.preventDefault(); takePhoto(c, target, it.getAsFile());
});

// ───────────────────────── modals ─────────────────────────
function modal(html, wide) {
  const ov = $('#overlay');
  ov.innerHTML = '<div class="modal-wrap"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
  const wrap = $('.modal-wrap', ov);
  const close = () => { ov.innerHTML = ''; document.removeEventListener('keydown', esck); };
  const esck = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esck);
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  return { el: $('.modal', ov), close };
}

function openSend(c) {
  const first = greetName(c) || 'there';
  const msg = c.type === 'buyer'
    ? 'Hi ' + first + ', here is your home-buying guide. It has the costs, the areas we spoke about, and a wish list you can send straight back to me. Open the attached file on your phone or computer.\n\n' + (ME.first || '')
    : 'Hi ' + first + ', thank you for your time today. Here is your selling plan for ' + (c.address || 'your home') + '. Open the attached file on your phone or computer.\n\n' + (ME.signoff ? ME.signoff + ', ' : '') + (ME.first || '');
  const fileName = slug(docTitle(c)) + '.html';
  const m = modal('<h2>Send to ' + esc(first) + '</h2><p class="lead">They get their own copy: it opens on any phone or computer, with no app or login.</p>' +
    '<div class="sendstep"><span class="n">1</span><div class="t"><b>Download their copy</b><div><button class="btn btn-p" data-dl>⤓ Download “' + esc(fileName) + '”</button></div><span class="hint">It lands in your Downloads folder.</span></div></div>' +
    '<div class="sendstep"><span class="n">2</span><div class="t"><b>Open WhatsApp with a message ready</b><textarea class="in" id="send-msg" style="min-height:110px">' + esc(msg) + '</textarea>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-g" data-wa>' + icon('wa', ' style="width:18px;height:18px"') + ' Open WhatsApp' + (c.phone ? ' to ' + esc(c.phone) : '') + '</button><button class="btn btn-l" data-copy-msg>Copy message</button></div>' +
    (c.phone ? '' : '<span class="hint">No number saved for them, so WhatsApp will ask who to send it to.</span>') + '</div></div>' +
    '<div class="sendstep"><span class="n">3</span><div class="t"><b>Drag the file into the chat</b><span class="hint">From Downloads into the WhatsApp chat, or click the paperclip → Document. Then send.</span></div></div>' +
    '<div class="or">or</div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-l" data-pdf>Save as PDF instead</button>' + (c.email ? '<button class="btn btn-l" data-mail>Email ' + esc(c.email) + '</button>' : '') + '</div>' +
    '<div class="modal-acts"><button class="btn btn-l" data-close>Done</button></div>');
  m.el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-dl')) { flushSaves(); download(fileName, exportHTML(c, ME)); toast('Saved to Downloads.'); }
    else if (b.hasAttribute('data-wa')) window.open(waLink(c.phone, $('#send-msg').value), '_blank', 'noopener');
    else if (b.hasAttribute('data-copy-msg')) { navigator.clipboard.writeText($('#send-msg').value).then(() => toast('Message copied.'), () => toast('Select the text and copy it.')); }
    else if (b.hasAttribute('data-pdf')) { m.close(); printDeck(c, ME); }
    else if (b.hasAttribute('data-mail')) location.href = 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent(docTitle(c)) + '&body=' + encodeURIComponent($('#send-msg').value + '\n\n(Attach the file from your Downloads folder.)');
  });
}

function openMe(welcome) {
  const m = modal((welcome ? '<div class="eyebrow" style="color:var(--blue)">Welcome</div>' : '') + '<h2>' + (welcome ? 'Let\'s set up your details' : 'My details') + '</h2>' +
    '<p class="lead">Fill this in once. It appears on every presentation and guide.</p>' +
    '<div class="row2"><div class="f"><span class="lbl">Your photo</span>' + dropZone(ME, 'photo', 'Add your photo', 'A friendly headshot. Square works best.') + '</div>' +
    '<div class="f" style="align-content:start;gap:12px">' + f('Name', inp(ME, 'name')) + f('First name', inp(ME, 'first')) + f('Title', inp(ME, 'title')) + '</div></div>' +
    '<div class="row2">' + f('WhatsApp number', inp(ME, 'phone', { ph: '082 123 4567', type: 'tel' }), 'Clients\' "Let\'s launch" and wish-list buttons go here.') + f('Email', inp(ME, 'email', { type: 'email' })) + '</div>' +
    '<div class="row2">' + f('Agency', inp(ME, 'agency')) + f('Areas you work', inp(ME, 'areas')) + '</div>' +
    f('FFC number', inp(ME, 'ffc', { ph: 'Fidelity Fund Certificate number' }), 'Shown with your contact details.') +
    f('Short bio', area(ME, 'bio'), 'Two short sentences. It sits next to your photo on page 2.') +
    '<div class="row3">' + f('Usual commission %', inp(ME, 'commission', { type: 'number', step: 0.25, min: 0 })) + f('Bond rate % for buyers', inp(ME, 'rate', { type: 'number', step: 0.25, min: 0 }), 'Prime: ' + PRIME + '%') + f('Sign-off', inp(ME, 'signoff')) + '</div>' +
    '<div class="tips"><b>Backups</b><span>Your clients are saved in this browser on this computer. Download a backup now and then, and keep it with your work files.</span><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-l btn-sm" data-backup>Download a backup</button><button class="btn btn-l btn-sm" data-restore>Restore from a backup</button><input type="file" accept=".json,application/json" hidden id="restore-file"></div></div>' +
    '<div class="modal-acts"><button class="btn btn-p" data-close>' + (welcome ? 'Save and start' : 'Done') + '</button></div>', true);
  const el = m.el;
  const setMe = (k, v) => { ME[k] = v; saveMe(); };
  el.addEventListener('input', e => { const t = e.target; if (!t.dataset.k) return; let v = t.value; if (t.dataset.t === 'num') v = v === '' ? '' : Number(v); setMe(t.dataset.k, v); });
  el.addEventListener('click', e => {
    const b = e.target.closest('button,[data-photo],[data-clear-photo]'); if (!b) return;
    if (b.dataset.clearPhoto) { e.stopPropagation(); setMe('photo', ''); refreshMePhoto(); return; }
    if (b.dataset.photo) { const fi = b.querySelector('input[type=file]'); if (e.target !== fi) fi.click(); return; }
    if (b.hasAttribute('data-backup')) backup();
    if (b.hasAttribute('data-restore')) $('#restore-file').click();
  });
  const refreshMePhoto = () => { const z = el.querySelector('[data-photo]'); z.outerHTML = dropZone(ME, 'photo', 'Add your photo', 'A friendly headshot. Square works best.'); };
  const takeMe = async file => {
    if (!file) return;
    try { setMe('photo', await readImage(file, 600, 0.85)); refreshMePhoto(); toast('Photo added.'); } catch (e2) { toast('Try a JPG or PNG photo.'); }
  };
  el.addEventListener('change', async e => {
    if (e.target.id === 'restore-file') return restore(e.target.files[0]);
    if (e.target.type === 'file') takeMe(e.target.files[0]);
  });
  el.addEventListener('dragover', e => { const z = e.target.closest('[data-photo]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  el.addEventListener('drop', e => { const z = e.target.closest('[data-photo]'); if (!z) return; e.preventDefault(); takeMe(e.dataTransfer.files[0]); });
  const obs = new MutationObserver(() => { if (!document.body.contains(el)) { obs.disconnect(); saveMe.flush(); render(); } });
  obs.observe($('#overlay'), { childList: true });
}

// ───────────────────────── Claude / ChatGPT ─────────────────────────
// The AI replies with one JSON block (spec in AI-INSTRUCTIONS.md, embedded at
// build time). Pasting it here creates the client; photos are added after.
const AI_PROMPT = "@AI_PROMPT@";
const AI_TAG = 'charne-client-studio';
function extractJSON(text) {
  let t = String(text || '');
  const fences = Array.from(t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map(m => m[1]);
  const tries = fences.length ? fences : [t];
  for (const chunk of tries) {
    const a = chunk.search(/[\[{]/), b = Math.max(chunk.lastIndexOf('}'), chunk.lastIndexOf(']'));
    if (a < 0 || b <= a) continue;
    try { return JSON.parse(chunk.slice(a, b + 1).replace(/[“”]/g, '"')); } catch (e) { /* next */ }
  }
  throw new Error('no json');
}
function pick(list, v) { if (typeof v !== 'string') return null; const k = list.find(x => String(x).toLowerCase() === v.trim().toLowerCase()); return k == null ? null : k; }
function normalizeAI(x) {
  if (!x || typeof x !== 'object') throw new Error('not an object');
  const type = /buy/i.test(String(x.type || '')) || x.priceMax != null || x.wants ? 'buyer' : 'listing';
  const c = type === 'buyer' ? newBuyer(ME) : newListing(ME);
  ['names', 'first', 'phone', 'email', 'note', 'address', 'suburb', 'city', 'love', 'compSource'].forEach(k => { if (typeof x[k] === 'string' && x[k].trim()) c[k] = x[k].trim(); });
  ['date', 'launch'].forEach(k => { if (/^\d{4}-\d{2}-\d{2}$/.test(String(x[k] || ''))) c[k] = x[k]; });
  ['beds', 'baths', 'garages', 'floor', 'erf', 'months', 'years', 'commission', 'rate'].forEach(k => { const v = parseFloat(x[k]); if (!isNaN(v) && v >= 0) c[k] = v; });
  ['low', 'high', 'ask', 'bond', 'cancel', 'certs', 'priceMax', 'deposit', 'income'].forEach(k => { if (x[k] == null || x[k] === '') return; const v = typeof x[k] === 'number' ? Math.round(x[k]) : parseMoney(x[k]); if (v != null && v >= 0) c[k] = v; });
  ['vatIncl', 'firstTime', 'preapproved'].forEach(k => { if (typeof x[k] === 'boolean') c[k] = x[k]; });
  const sb = pick(SUBURBS.map(r => r[0]), c.suburb); if (sb) c.suburb = sb;
  const pt = pick(PROP_TYPES, x.propType); if (pt) c.propType = pt;
  const tl = pick(TIMELINES, x.timeline); if (tl) c.timeline = tl;
  const md = pick(['Sole mandate', 'Open mandate', 'Dual mandate'], x.mandate); if (md) c.mandate = md;
  if (type === 'buyer' && c.years && ![20, 25, 30].includes(c.years)) c.years = 20;
  if (c.months) c.months = Math.min(6, Math.max(1, Math.round(c.months)));
  const strs = v => Array.isArray(v) ? v.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : null;
  const feats = strs(x.features); if (feats) c.features = feats.map(f => pick(FEATURES, f) || f);
  const wants = strs(x.wants); if (wants) c.wants = wants.map(w => pick(WANTS, w) || w);
  const mk = strs(x.marketing);
  if (mk) { const ids = mk.map(m => (MARKETING.find(r => r[0] === m.toLowerCase() || r[2].toLowerCase() === m.toLowerCase()) || [])[0]).filter(Boolean); if (ids.length) c.marketing = Array.from(new Set(ids.concat(['feedback']))); }
  const areas = strs(x.areas); if (areas) c.areas = Array.from(new Set(areas.map(a => pick(SUBURBS.map(s => s[0]), a) || a))).slice(0, 6);
  if (x.areaText && typeof x.areaText === 'object') { c.areaText = {}; Object.keys(x.areaText).forEach(k => { if (typeof x.areaText[k] === 'string') c.areaText[pick(SUBURBS.map(s => s[0]), k) || k] = x.areaText[k].trim(); }); }
  if (type === 'buyer') (c.areas || []).forEach(a => { if (!(a in SUBURB_TEXT) && !(c.areaText && a in c.areaText)) { c.areaText = c.areaText || {}; c.areaText[a] = ''; } });
  if (type === 'listing' && Array.isArray(x.comps) && x.comps.length) {
    c.comps = x.comps.slice(0, 6).filter(r => r && typeof r === 'object').map(r => ({
      addr: String(r.addr || r.address || r.description || '').trim(),
      price: typeof r.price === 'number' ? Math.round(r.price) : parseMoney(r.price),
      size: parseFloat(r.size || r.floor) || '', beds: parseFloat(r.beds) || '',
      date: /^\d{4}-\d{2}/.test(String(r.date || '')) ? String(r.date).slice(0, 7) : '',
      status: /market|listed|active|for sale/i.test(String(r.status || '')) ? 'On the market' : 'Sold'
    }));
  }
  if (!c.first && c.names) c.first = '';
  return c;
}
function importAI(text) {
  const raw = extractJSON(text);
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw.clients) ? raw.clients : [raw.client || raw]);
  const made = list.map(normalizeAI);
  made.forEach(c => saveClient(c, true));
  return made;
}
function afterImport(made) {
  $('#overlay').innerHTML = '';
  const c = made[made.length - 1];
  go({ name: 'edit', id: c.id, step: STEPS[c.type].length - 1 });
  toast((made.length > 1 ? made.length + ' clients built' : 'Built') + '. Add the photo' + (c.type === 'buyer' ? ' if you like' : '') + ', then present or send.', 4500);
}
function copyText(t, ok) {
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(ok); } catch (e) { toast('Could not copy. Use the download instead.'); } ta.remove(); };
  if (navigator.clipboard && window.isSecureContext !== false) navigator.clipboard.writeText(t).then(() => toast(ok), fallback); else fallback();
}
function openAI() {
  const m = modal('<div class="eyebrow" style="color:var(--blue)">Claude or ChatGPT</div><h2>Build it from a prompt</h2>' +
    '<p class="lead">Describe the client in your own words. The AI writes it up, you paste its reply here, and the presentation builds itself.</p>' +
    '<div class="sendstep"><span class="n">1</span><div class="t"><b>Give the AI its instructions</b><span class="hint">Copy them and paste as your first message in a new chat. To skip this step next time, save them once in a Claude Project or a ChatGPT custom GPT (as its instructions).</span>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-p" data-ai-copy>Copy the instructions</button><a class="btn btn-l" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a><a class="btn btn-l" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT</a><button class="btn btn-l" data-ai-dl>Download as a file</button></div></div></div>' +
    '<div class="sendstep"><span class="n">2</span><div class="t"><b>Tell it about the client</b><span class="hint">Talk to it like an assistant. For example:</span>' +
    '<div class="tips" style="font-style:italic">"Valuation for Johan and Elmarie van der Merwe, 12 Jacaranda Street, Faerie Glen. 4 bed, 2 bath, double garage, 210 m² on 850 m². Pool, solar, covered patio. Sold nearby: 2.65m for 220 m² in August, 2.55m for 205 m² in July. Asking 2.6m. They owe about 1.1m."</div>' +
    '<span class="hint">Or: "Buyer guide for Lerato Mokoena, first-time buyer, up to 1.8m, R180 000 deposit, wants Equestria or Moreleta Park, 3 bed with a garden for two dogs."</span></div></div>' +
    '<div class="sendstep"><span class="n">3</span><div class="t"><b>Paste its reply here</b><textarea class="in" id="ai-reply" style="min-height:130px;font-family:ui-monospace,Consolas,monospace;font-size:13px" placeholder="Paste the whole reply. The code block is enough."></textarea>' +
    '<div id="ai-err" class="hint" style="color:var(--bad)"></div><div><button class="btn btn-g btn-big" data-ai-build>Build it →</button></div>' +
    '<span class="hint">Tip: on the home screen you can also just press Ctrl+V with the reply copied. Photos are added afterwards; the AI can\'t send them.</span></div></div>' +
    '<div class="modal-acts"><button class="btn btn-l" data-close>Close</button></div>', true);
  m.el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-ai-copy')) copyText(AI_PROMPT, 'Instructions copied. Paste them into Claude or ChatGPT.');
    else if (b.hasAttribute('data-ai-dl')) { download('Client Studio - AI instructions.txt', AI_PROMPT, 'text/plain'); toast('Saved to Downloads.'); }
    else if (b.hasAttribute('data-ai-build')) {
      try { afterImport(importAI($('#ai-reply').value)); }
      catch (err) { $('#ai-err').textContent = 'That doesn\'t look like a reply from the instructions. Copy the AI\'s whole answer, including the part in the grey code box, and paste it again.'; }
    }
  });
  setTimeout(() => { const t = $('#ai-reply'); if (t) t.addEventListener('paste', () => setTimeout(() => { try { extractJSON(t.value); $('#ai-err').textContent = ''; } catch (e) { /* wait for Build */ } }, 0)); }, 0);
}

function openDemo() {
  modal('<div class="demo"><div class="eyebrow" style="color:var(--blue)">Tomorrow morning</div><h2>How to demo it in 10 minutes</h2>' +
    '<p class="lead">Set one up for a real client, live, from a blank page. Say the line in italics as you go.</p><ol>' +
    '<li><span><b>Open the studio</b>Show the two cards: one for sellers, one for buyers.<span class="say">"Two tools: one for the valuation, one for every new buyer."</span></span></li>' +
    '<li><span><b>Listing Presentation → Start for a client</b>Type the sellers\' names and pick the date. The note on page 2 is already written.<span class="say">"Their name goes on the cover. Watch the right-hand side."</span></span></li>' +
    '<li><span><b>Their home</b>Address, suburb, rooms. Drag in a photo (or copy one from the listing and press Ctrl+V). Tick features, then "Write it for me".<span class="say">"That\'s their home on the cover, in under a minute."</span></span></li>' +
    '<li><span><b>Sales & price</b>Add three sold prices with sizes. Click "Use this to fill in the range".<span class="say">"Real sales, not asking prices. The chart draws itself."</span></span></li>' +
    '<li><span><b>Walk-away figure</b>Commission and their bond. Page 9 shows what they keep.<span class="say">"The question every seller asks, answered before they ask it."</span></span></li>' +
    '<li><span><b>Marketing & launch</b>Tick the channels and pick a launch date. The timeline fills in.</span></li>' +
    '<li><span><b>Present</b>Full screen. Arrow keys through the 12 pages. Esc to finish.</span></li>' +
    '<li><span><b>Send to client</b>Download their copy, open WhatsApp, drop the file in.<span class="say">"They open it on their phone. No app, no login."</span></span></li>' +
    '<li><span><b>Buyer Guide (2 minutes)</b>Start one, add a budget and three areas. Present page 4 and change the price live, then page 7: the wish list goes to your WhatsApp.</span></li></ol>' +
    '<div class="tips"><b>Before you start</b><ul><li>Fill in <b>My details</b> once, including your WhatsApp number and photo.</li><li>Have one house photo ready on the desktop. iPhone photos must be JPG.</li><li>Do a dry run tonight, then delete it. "See an example" is there if you need a safety net.</li><li>Use Chrome or Edge. Everything except WhatsApp works without internet.</li></ul></div>' +
    '<div class="modal-acts"><button class="btn btn-p" data-close>Got it</button></div></div>', true);
}

async function backup() {
  flushSaves();
  const data = { app: 'charne-client-studio', v: 1, saved: new Date().toISOString(), settings: ME, clients: CLIENTS };
  download('Client Studio backup ' + todayISO() + '.json', JSON.stringify(data), 'application/json');
  toast('Backup saved to Downloads.');
}
async function restore(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'charne-client-studio') throw new Error('not ours');
    if (!confirm('Restore ' + (data.clients || []).length + ' clients from this backup? Clients already here are replaced by the backup\'s version.')) return;
    if (data.settings) { ME = Object.assign({}, DEFAULT_ME, data.settings); await Store.set('settings', ME); }
    for (const c of data.clients || []) await Store.set('client:' + c.id, c);
    await loadAll(); $('#overlay').innerHTML = ''; render(); toast('Restored.');
  } catch (e) { toast('That file isn\'t a Client Studio backup.'); }
}

// ───────────────────────── viewer (client's copy) ─────────────────────────
function renderViewer(data) {
  const c = data.client, me = Object.assign({}, DEFAULT_ME, data.me || {});
  CURRENT_CLIENT = c; CURRENT_ME = me;
  document.title = docTitle(c);
  document.body.style.background = '#E9E5DB';
  const pages = pagesFor(c, me);
  app.innerHTML = '<div class="viewer"><div class="vbar"><img src="' + ASSETS.lockupWhite + '" alt="RB Brand Real Estate"><div class="who"><b>' + esc(c.type === 'buyer' ? 'Your home-buying guide' : 'Your selling plan') + '</b>Prepared for ' + esc(c.names || 'you') + ' by ' + esc(me.name) + '</div>' +
    '<button class="btn btn-d btn-sm" data-v="present" id="v-present">▶ Present</button><button class="btn btn-d btn-sm" data-v="pdf">Save PDF</button>' +
    '<a class="btn btn-g btn-sm" href="' + esc(waLink(me.phone, 'Hi ' + (me.first || '') + ', ')) + '" target="_blank" rel="noopener">WhatsApp ' + esc(me.first || '') + '</a></div>' +
    '<div class="vdeck" id="vdeck">' + deckHTML(pages) + '</div><p class="vfoot">Prepared by ' + esc(me.name) + ', ' + esc(me.agency) + (me.ffc ? ' (FFC ' + esc(me.ffc) + ')' : '') + ', on ' + esc(fmtDate(c.date)) + '. Figures are estimates to plan with; the bank and the attorneys confirm the final numbers.</p></div>';
  const deck = $('#vdeck'), frames = $$('.frame', deck);
  const layout = () => { const w = deck.clientWidth - (window.innerWidth < 760 ? 0 : 32); fitFrames(frames, w, null, true); $('#v-present').hidden = window.innerWidth < 900; };
  layout(); initPages(deck);
  window.addEventListener('resize', debounce(layout, 120));
  app.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'present') present(c, me, 0);
    if (b.dataset.v === 'pdf') printDeck(c, me);
  });
}

// ───────────────────────── start ─────────────────────────
async function start() {
  if (SHIPPED && SHIPPED.client) { renderViewer(SHIPPED); return; }
  const hadSettings = await loadAll();
  CURRENT_ME = ME;
  render();
  if (!hadSettings) openMe(true);
}
// Exposed for checks in tests only.
window.__studio = { importAI, extractJSON, AI_PROMPT, preparePrint, transferDuty, repayment, commission, parseMoney, money, waNumber, firstNameOf, exportHTML, pagesFor, get ME() { return ME; }, get CLIENTS() { return CLIENTS; } };
start();
})();
