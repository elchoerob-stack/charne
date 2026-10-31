// RB Brand books · flipbook, tap-to-edit, photo upload, client copy, music
const CLIENT = document.documentElement.hasAttribute('data-client');
const STORE = 'rbbook:' + location.pathname.split('/').pop();
const book = document.getElementById('book');

// ---- Restore Charné's saved draft (never in a client copy) ----
if (!CLIENT) {
  try { const saved = localStorage.getItem(STORE); if (saved) book.innerHTML = saved; } catch (e) {}
}

// ---- Fit the A4 page to the screen ----
function fit() { const s = Math.min((innerWidth - 32) / 794, (innerHeight - 200) / 1123, 1); document.documentElement.style.setProperty('--s', Math.max(s, .2)); }
fit(); addEventListener('resize', fit);

// ---- Flipbook ----
const pages = [...book.querySelectorAll('section.page')];
pages.forEach((p, i) => { p.style.zIndex = pages.length - i; p.classList.remove('flipped'); });
let cur = 0, editing = false;
const count = document.getElementById('count'), prev = document.getElementById('prev'), next = document.getElementById('next');
function render() {
  pages.forEach((p, i) => p.classList.toggle('flipped', i < cur));
  count.textContent = (cur + 1) + ' / ' + pages.length;
  prev.disabled = cur === 0; next.disabled = cur === pages.length - 1;
}
function go(d) { const n = cur + d; if (n < 0 || n >= pages.length) return; cur = n; render(); }
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
render();

// ---- Photos: mirrors copy the main home photo onto the marketing mock-ups ----
function syncPhotos() {
  book.querySelectorAll('.ph').forEach(p => p.classList.toggle('has-img', /url\(/.test(p.style.getPropertyValue('--img'))));
  book.querySelectorAll('[data-mirror]').forEach(m => {
    const src = book.querySelector('[data-key="' + m.dataset.mirror + '"]');
    if (src) m.style.setProperty('--img', src.style.getPropertyValue('--img'));
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
    const n = prompt('WhatsApp number (e.g. 082 000 0000):', a.dataset.num || '');
    if (n === null) return;
    a.dataset.num = n; a.href = 'https://wa.me/27' + n.replace(/\D/g, '').replace(/^0/, '');
  } else if (kind === 'tel') {
    const n = prompt('Phone number:', a.dataset.num || '');
    if (n === null) return;
    a.dataset.num = n; a.href = 'tel:+27' + n.replace(/\D/g, '').replace(/^0/, '');
    const lbl = a.querySelector('.num'); if (lbl) lbl.textContent = n;
  } else {
    const u = prompt('Link for this button (leave empty to hide it):', a.getAttribute('href') === '#' ? '' : a.href);
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
  if (editBtn) { editBtn.classList.toggle('on', on); editBtn.textContent = on ? '✓ Done editing' : '✎ Edit'; }
  markTodos();
}
if (editBtn) editBtn.onclick = () => setEditing(!editing);

// ---- Autosave the draft on this device ----
let saveT;
function cleanHTML(root) {
  const c = root.cloneNode(true);
  c.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
  c.querySelectorAll('.todo').forEach(e => e.classList.remove('todo'));
  c.querySelectorAll('.flipped').forEach(e => e.classList.remove('flipped'));
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
  if (!confirm('Clear everything you typed and start again from the blank template?')) return;
  try { localStorage.removeItem(STORE); } catch (e) {}
  location.reload();
};

// ---- Save a personalised copy to send to the client ----
const saveBtn = document.getElementById('saveBtn');
if (saveBtn) saveBtn.onclick = () => {
  const left = [...book.querySelectorAll(EDITABLE)].filter(e => /\[[^\]]+\]/.test(e.textContent) && !e.querySelector(EDITABLE)).length;
  if (left && !confirm(left + ' spot(s) still show [bracketed] placeholder text (highlighted in Edit mode).\n\nSave the client copy anyway?')) return;
  const wasEditing = editing; setEditing(false);
  const doc = document.documentElement.cloneNode(true);
  doc.setAttribute('data-client', '');
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

// ---- Music: soft royalty-free tracks, with a gentle generated tune as backup ----
let ctx, master, playing = false, timer, step = 0, nextT = 0;
const S16 = 60 / 84 / 4;
const chords = [[62,66,69],[61,64,69],[62,66,71],[62,67,71]], roots = [38, 45, 47, 43];
const melody = [[0,74,4],[4,76,2],[6,78,4],[10,76,2],[12,74,4],[16,73,4],[20,74,2],[22,76,6],[28,69,4],[32,71,4],[36,74,2],[38,78,4],[42,81,2],[44,78,4],[48,79,4],[52,78,2],[54,76,4],[58,74,6]];
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function setup() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor(), verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = .28;
  master.connect(comp); master.connect(verb); verb.connect(wet).connect(comp); comp.connect(ctx.destination);
}
function voice(f, t, dur, vol, type, attack = .005) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}
function schedule(i, t) {
  const bar = Math.floor(i / 16) % 4, s = i % 16, c = chords[bar];
  if (s === 0) c.forEach(m => voice(hz(m - 12), t, S16 * 16, .03, 'sine', .4));
  if (s % 2 === 0) { const m = c[(s / 2) % 3] + (s >= 8 ? 12 : 0); voice(hz(m), t, .6, .05, 'triangle'); voice(hz(m) * 2, t, .3, .012, 'sine'); }
  if ([0, 6, 8, 14].includes(s)) voice(hz(roots[bar]), t, S16 * 3, .14, 'sine', .01);
  if (i >= 64) melody.filter(n => n[0] === i % 64).forEach(n => voice(hz(n[1]), t, S16 * n[2] + .3, .07, 'sine', .01));
}
function tick() { while (nextT < ctx.currentTime + .2) { schedule(step++, nextT); nextT += S16; } }
const TRACKS = ['Easy Lemon', 'Dreamer', 'Lobby Time']; // Kevin MacLeod (incompetech.com), CC BY 4.0
const audio = new Audio(); audio.preload = 'auto'; audio.volume = 0;
let ti = 0, useSynth = false, fade;
const musicBtn = document.getElementById('musicBtn');
function loadTrack() { audio.src = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/' + encodeURIComponent(TRACKS[ti]) + '.mp3'; credit(); }
function credit() { document.getElementById('credit').textContent = useSynth ? '' : '♪ "' + TRACKS[ti] + '" · Kevin MacLeod (incompetech.com) · CC BY 4.0'; }
audio.addEventListener('ended', () => { ti = (ti + 1) % TRACKS.length; loadTrack(); audio.play(); });
audio.addEventListener('error', () => { if (playing && !useSynth) { useSynth = true; credit(); startSynth(); } });
function fadeTo(v, ms) { clearInterval(fade); const st = audio.volume, t0 = Date.now(); fade = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / ms); audio.volume = st + (v - st) * k; if (k === 1) { clearInterval(fade); if (v === 0) audio.pause(); } }, 50); }
function startSynth() {
  step = 0; nextT = ctx.currentTime + .1;
  master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(.85, ctx.currentTime + 2);
  clearInterval(timer); timer = setInterval(tick, 50);
}
function startMusic() {
  if (!ctx) setup(); ctx.resume(); playing = true; musicBtn.textContent = '♪ Music off';
  if (useSynth) return startSynth();
  if (!audio.src) loadTrack();
  audio.play().then(() => fadeTo(.45, 2500)).catch(() => { useSynth = true; credit(); startSynth(); });
}
function stopMusic() {
  playing = false; musicBtn.textContent = '♪ Music on';
  if (!useSynth) return fadeTo(0, 1000);
  clearInterval(timer);
  master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
}
musicBtn.onclick = () => playing ? stopMusic() : startMusic();
document.getElementById('openBook').onclick = () => { document.getElementById('intro').classList.add('gone'); startMusic(); };
document.getElementById('quietOpen').onclick = () => document.getElementById('intro').classList.add('gone');
