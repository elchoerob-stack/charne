// RB Brand books · flipbook, tap-to-edit, photo upload, client copy, music
// UI holds this book's interface text in its language (set by build.py)
const CLIENT = document.documentElement.hasAttribute('data-client');
const STUDIO = document.documentElement.dataset.studio || ''; // set by Agent Studio: one draft per client and book
const STORE = 'rbbook:' + document.title + (STUDIO ? ':' + STUDIO : '');
const book = document.getElementById('book');

// ---- Restore Charné's saved draft (never in a client copy) ----
if (!CLIENT) {
  try { const saved = localStorage.getItem(STORE); if (saved) book.innerHTML = saved; } catch (e) {}
}

// ---- Fit the A4 page to the screen ----
function fit() { const s = Math.min((innerWidth - 32) / 794, (innerHeight - 200) / 1123, 1); document.documentElement.style.setProperty('--s', Math.max(s, .2)); }
fit(); addEventListener('resize', fit);

// ---- Flipbook: only the current page is drawn, and only the turning page animates ----
const pages = [...book.querySelectorAll('section.page')];
pages.forEach(p => { p.classList.remove('show', 'turn-out', 'turn-in', 'flipped'); p.style.zIndex = ''; });
let cur = 0, editing = false, busy = false;
const count = document.getElementById('count'), prev = document.getElementById('prev'), next = document.getElementById('next');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
function status() {
  count.textContent = (cur + 1) + ' / ' + pages.length;
  prev.disabled = cur === 0; next.disabled = cur === pages.length - 1;
}
function settle(el, fn) { // run fn once the turn finishes (with a timer in case the event never fires)
  let done = false;
  const end = () => { if (done) return; done = true; fn(); busy = false; };
  el.addEventListener('animationend', end, { once: true }); setTimeout(end, 1000);
}
function go(d) {
  const n = cur + d;
  if (busy || n < 0 || n >= pages.length) return;
  const from = pages[cur], to = pages[n];
  cur = n; status();
  if (calm) { from.classList.remove('show'); to.classList.add('show'); return; }
  busy = true;
  if (d > 0) { // current page turns away to reveal the next one underneath
    to.classList.add('show'); to.style.zIndex = 1; from.style.zIndex = 2; from.classList.add('turn-out');
    settle(from, () => { from.classList.remove('show', 'turn-out'); from.style.zIndex = to.style.zIndex = ''; });
  } else { // previous page turns back over the current one
    to.classList.add('show', 'turn-in'); to.style.zIndex = 2; from.style.zIndex = 1;
    settle(to, () => { to.classList.remove('turn-in'); from.classList.remove('show'); from.style.zIndex = to.style.zIndex = ''; });
  }
}
pages[0].classList.add('show'); status();
prev.onclick = () => go(-1); next.onclick = () => go(1);
const interactive = t => t.closest('input,select,textarea,button,a,label,[contenteditable="true"]');
book.addEventListener('click', e => {
  if (editing || interactive(e.target)) return;
  const r = book.getBoundingClientRect(); go(e.clientX - r.left < r.width / 3 ? -1 : 1);
});
document.addEventListener('keydown', e => {
  if (editing || e.target.closest('input,select,textarea')) return;
  if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1);
});
let sx = null;
book.addEventListener('touchstart', e => sx = e.touches[0].clientX, { passive: true });
book.addEventListener('touchend', e => {
  if (sx === null || editing) return;
  const dx = e.changedTouches[0].clientX - sx;
  if (Math.abs(dx) > 50 && !interactive(e.target)) { e.preventDefault(); go(dx < 0 ? 1 : -1); }
  sx = null;
});

// ---- Photos: mirrors copy the main home photo onto the marketing mock-ups ----
function syncPhotos() {
  const uploaded = p => /url\(/.test(p.style.getPropertyValue('--img'));
  book.querySelectorAll('.ph').forEach(p => p.classList.toggle('has-img', p.hasAttribute('data-img') || uploaded(p)));
  book.querySelectorAll('[data-mirror]').forEach(m => {
    const src = book.querySelector('[data-key="' + m.dataset.mirror + '"]'); if (!src) return;
    if (uploaded(src)) { m.style.setProperty('--img', src.style.getPropertyValue('--img')); m.removeAttribute('data-img'); }
    else { m.style.removeProperty('--img'); if (src.dataset.img) m.dataset.img = src.dataset.img; }
  });
}
syncPhotos();
const photoInput = document.getElementById('photoInput');
let photoTarget = null;
book.addEventListener('click', e => {
  if (!editing) return;
  if (e.target.closest('[contenteditable="true"],a,input,select,label')) return;
  // the photo may sit under a text overlay or shading, so look beneath the tap too
  const ph = e.target.closest('.ph[data-photo]') || document.elementsFromPoint(e.clientX, e.clientY).find(el => el.matches('.ph[data-photo]'));
  if (ph) { photoTarget = ph; photoInput.value = ''; photoInput.click(); }
});
photoInput.addEventListener('change', () => {
  const f = photoInput.files[0]; if (!f || !photoTarget) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => { // shrink to keep the saved file small
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    photoTarget.style.setProperty('--img', "url('" + c.toDataURL('image/jpeg', .82) + "')");
    photoTarget.removeAttribute('data-img');
    URL.revokeObjectURL(url); syncPhotos(); save();
  };
  img.src = url;
});

// ---- Links (WhatsApp, e-sign, video, reviews) ----
book.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || !editing) return;
  e.preventDefault();
  const kind = a.dataset.link;
  if (kind === 'wa') {
    const n = prompt(UI.waPrompt, a.dataset.num || '');
    if (n === null) return;
    a.dataset.num = n; a.href = 'https://wa.me/27' + n.replace(/\D/g, '').replace(/^0/, '');
  } else if (kind === 'tel') {
    const n = prompt(UI.telPrompt, a.dataset.num || '');
    if (n === null) return;
    a.dataset.num = n; a.href = 'tel:+27' + n.replace(/\D/g, '').replace(/^0/, '');
    const lbl = a.querySelector('.num'); if (lbl) lbl.textContent = n;
  } else {
    const u = prompt(UI.linkPrompt, a.getAttribute('href') === '#' ? '' : a.href);
    if (u === null) return;
    a.setAttribute('href', u.trim() || '#');
  }
  save();
});

// ---- Edit mode ----
const EDITABLE = 'h1,h2,h3,h4,p,li,td,th,dt,small,.who,.addr2,.cv-meta span,.areas,.quote,.big,.big2,.sigline,.urgent,.creds,.kpi strong,.kpi span,.stats strong,.sold,.pr b,.pr em,.sc-t span,.lst b,.lst span,.so-cap,.fl-in b,.fl-in small,.ch span,.tl .when,.pill,.foot span,.note,.ph>span,.tm b,.stars,.rv b,.tx span,.kick,.lbl-edit';
const editBtn = document.getElementById('editBtn');
function markTodos() { // highlight anything still in [brackets]
  book.querySelectorAll('.todo').forEach(e => e.classList.remove('todo'));
  if (!editing) return;
  book.querySelectorAll(EDITABLE).forEach(e => { if (/\[[^\]]+\]/.test(e.textContent)) e.classList.add('todo'); });
}
function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  book.querySelectorAll(EDITABLE).forEach(e => { if (!e.closest('.calc,.wish,.result')) e.contentEditable = on ? 'true' : 'false'; });
  if (!on) book.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
  if (editBtn) { editBtn.classList.toggle('on', on); editBtn.textContent = on ? UI.doneEditing : UI.edit; }
  markTodos();
}
if (editBtn) editBtn.onclick = () => setEditing(!editing);

// ---- Autosave the draft on this device ----
let saveT;
function cleanHTML(root) {
  const c = root.cloneNode(true);
  c.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
  c.querySelectorAll('.todo').forEach(e => e.classList.remove('todo'));
  c.querySelectorAll('.page').forEach(e => { e.classList.remove('show', 'turn-out', 'turn-in', 'flipped'); e.style.zIndex = ''; });
  return c;
}
function save() {
  if (CLIENT) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(STORE, cleanHTML(book).innerHTML); } catch (e) {} }, 400);
}
book.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('input,select')) { // keep typed values in the saved copy
    if (t.type === 'checkbox') t.toggleAttribute('checked', t.checked); else t.setAttribute('value', t.value);
  }
  if (editing) markTodos();
  save();
});
book.addEventListener('change', save);
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) resetBtn.onclick = () => {
  if (!confirm(UI.resetConfirm)) return;
  try { localStorage.removeItem(STORE); } catch (e) {}
  location.reload();
};

// ---- Save a personalised copy to send to the client ----
const saveBtn = document.getElementById('saveBtn');
if (saveBtn) saveBtn.onclick = () => {
  const left = [...book.querySelectorAll(EDITABLE)].filter(e => /\[[^\]]+\]/.test(e.textContent) && !e.querySelector(EDITABLE)).length;
  if (left && !confirm(UI.saveConfirm.replace('{n}', left))) return;
  const wasEditing = editing; setEditing(false);
  const doc = document.documentElement.cloneNode(true);
  doc.setAttribute('data-client', '');
  doc.classList.remove('js'); // the saved file starts readable; its own script turns book mode back on
  doc.removeAttribute('style');
  doc.querySelector('#book').replaceWith(cleanHTML(book));
  doc.querySelector('#intro').classList.remove('gone');
  doc.querySelector('body').className = '';
  const name = (book.querySelector('[data-filename]') || {}).textContent || 'client';
  const file = (document.title + ' - ' + name).replace(/[\[\]]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/[\s-]+/g, '-') + '.html';
  const blob = new Blob(['<!doctype html>\n' + doc.outerHTML], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (wasEditing) setEditing(true);
};

// ---- Number helpers for the calculators ----
const num = v => parseFloat(String(v).replace(/[^\d.]/g, '')) || 0;
const rand = n => 'R ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ---- Music: an original slow, dreamy beat, played live by the browser (nothing to download) ----
// A minor at 80 bpm: four bars of piano and pads, then a soft beat and bass, then the melody.
let ctx, master, playing = false, timer, step = 0, nextT = 0;
const S16 = 60 / 80 / 4;                                          // one sixteenth note, in seconds
const CHORDS = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]];  // Am · F · C · G
const BASS = [45, 41, 48, 43];
const ARP = [0, 1, 2, 1, 0, 1, 2, 3];                              // piano eighths; 3 = root an octave up
const TUNE = [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4], [16, 72, 6], [22, 71, 2], [24, 69, 8],
              [32, 76, 4], [36, 77, 4], [40, 76, 2], [42, 74, 2], [44, 72, 4], [48, 74, 6], [54, 72, 2], [56, 71, 8]];
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function setup(c) {
  ctx = c || new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor(), verb = ctx.createConvolver(), warm = ctx.createBiquadFilter();
  const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  verb.buffer = ir; warm.type = 'lowpass'; warm.frequency.value = 5200;
  const wet = ctx.createGain(); wet.gain.value = .32;
  master.connect(warm); warm.connect(comp); master.connect(verb); verb.connect(wet).connect(comp); comp.connect(ctx.destination);
}
function voice(f, t, dur, vol, type, attack = .005, detune = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}
function noise(t, dur, vol, type, freq) {
  const n = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(f).connect(g).connect(master); src.start(t);
}
function kick(t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + .2);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
  o.connect(g).connect(master); o.start(t); o.stop(t + .4);
}
function schedule(i, t) {
  const n = Math.floor(i / 16), s = i % 16;
  const bar = n < 4 ? n : 4 + (n - 4) % 16;                       // 4-bar intro, then a 16-bar loop
  const c = CHORDS[bar % 4];
  if (s === 0) c.forEach(m => [-7, 7].forEach(dt => voice(hz(m - 12), t, S16 * 16 + .5, .02, 'triangle', .9, dt)));  // warm pad
  if (s % 2 === 0) {                                               // piano
    const k = ARP[s / 2], m = (k === 3 ? c[0] + 12 : c[k]) + 12, v = s % 8 === 0 ? .06 : .04;
    voice(hz(m), t, 1.1, v, 'triangle'); voice(hz(m + 12), t, .5, v * .18, 'sine');
  }
  if (bar >= 4) {                                                  // the beat and bass come in
    if (s === 0 || s === 10) voice(hz(BASS[bar % 4]), t, S16 * (s === 0 ? 9 : 6), .16, 'sine', .015);
    if (s === 0 || s === 8) kick(t, .3); if (s === 11) kick(t, .15);
    if (s === 4 || s === 12) noise(t, .16, .1, 'bandpass', 1900);  // soft snap on 2 and 4
  }
  if (bar >= 8 && s % 4 === 2) noise(t, .05, .028, 'highpass', 7000);  // light hi-hat
  if ((bar >= 8 && bar < 12) || bar >= 16) {                       // the melody, every other phrase
    const pos = (bar % 4) * 16 + s;
    TUNE.filter(x => x[0] === pos).forEach(x => { voice(hz(x[1]), t, S16 * x[2] + .5, .055, 'sine', .02); voice(hz(x[1] + 12), t, S16 * x[2] * .5, .012, 'triangle', .02); });
  }
}
function tick() { while (nextT < ctx.currentTime + .2) { schedule(step++, nextT); nextT += S16; } }
const musicBtn = document.getElementById('musicBtn');
function startMusic() {
  if (!ctx) setup(); ctx.resume(); playing = true; musicBtn.textContent = UI.musicOff;
  step = 0; nextT = ctx.currentTime + .1;
  master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(.85, ctx.currentTime + 2);
  clearInterval(timer); timer = setInterval(tick, 50);
}
function stopMusic() {
  playing = false; musicBtn.textContent = UI.musicOn;
  master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
  setTimeout(() => { if (!playing) clearInterval(timer); }, 1100);
}
musicBtn.onclick = () => playing ? stopMusic() : startMusic();
document.getElementById('openBook').onclick = () => { document.getElementById('intro').classList.add('gone'); startMusic(); };
document.getElementById('quietOpen').onclick = e => { e.preventDefault(); document.getElementById('intro').classList.add('gone'); };
