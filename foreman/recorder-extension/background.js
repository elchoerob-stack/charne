// Foreman Recorder — background service worker. Owns the recording.
const state = { active: false, t0: 0, rec: null, lastShot: 0, tabId: null };

async function load() {
  const s = await chrome.storage.session.get("state");
  if (s.state) Object.assign(state, s.state);
}
const persist = () => chrome.storage.session.set({ state });

function newRecording(meta) {
  return {
    id: "rec_" + Math.random().toString(36).slice(2, 12),
    title: meta.title || "Untitled workflow",
    app: "cms",
    dealer: meta.dealer || undefined,
    recordedBy: meta.recordedBy || undefined,
    purpose: meta.purpose || "sop",
    startedAt: new Date().toISOString(),
    startUrl: meta.url,
    userAgent: navigator.userAgent,
    events: [],
    screenshots: {},
    notes: "",
  };
}

async function broadcast(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { kind: "state", active: state.active, t0: state.t0 }); } catch { /* no content script yet */ }
}

async function screenshot() {
  if (!state.active || !state.rec || !state.tabId) return;
  const nowMs = Date.now();
  if (nowMs - state.lastShot < 1500) return; // throttle
  state.lastShot = nowMs;
  try {
    const tab = await chrome.tabs.get(state.tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 45 });
    const id = "s" + Object.keys(state.rec.screenshots).length;
    state.rec.screenshots[id] = dataUrl;
    state.rec.events.push({ t: nowMs - state.t0, type: "screenshot", screenshotId: id });
    persist();
  } catch { /* permission or restricted page */ }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    await load();
    switch (msg.kind) {
      case "hello":
        reply({ active: state.active && sender.tab?.id === state.tabId, t0: state.t0 });
        return;
      case "event":
        if (state.active && state.rec && sender.tab?.id === state.tabId) {
          state.rec.events.push(msg.event);
          if (state.rec.events.length % 10 === 0) persist();
        }
        reply({ ok: true });
        return;
      case "screenshot":
        await screenshot();
        reply({ ok: true });
        return;
      case "start": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        state.tabId = tab.id;
        state.t0 = Date.now();
        state.rec = newRecording({ ...msg.meta, url: tab.url });
        state.active = true;
        await persist();
        await broadcast(tab.id);
        await screenshot();
        reply({ ok: true, id: state.rec.id });
        return;
      }
      case "stop":
        state.active = false;
        if (state.rec) state.rec.endedAt = new Date().toISOString();
        await persist();
        if (state.tabId) await broadcast(state.tabId);
        reply({ ok: true, rec: state.rec });
        return;
      case "note":
        if (state.rec && state.active) state.rec.events.push({ t: Date.now() - state.t0, type: "note", message: msg.text });
        await persist();
        reply({ ok: true });
        return;
      case "get":
        reply({ active: state.active, rec: state.rec, count: state.rec ? state.rec.events.length : 0, t0: state.t0 });
        return;
      case "discard":
        state.active = false; state.rec = null; state.tabId = null;
        await persist();
        reply({ ok: true });
        return;
      case "upload": {
        const { server, token } = msg;
        if (!state.rec) { reply({ ok: false, error: "nothing to upload" }); return; }
        try {
          const res = await fetch(server.replace(/\/$/, "") + "/api/recordings", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(state.rec),
          });
          const body = await res.json().catch(() => ({}));
          reply({ ok: res.ok, status: res.status, body });
        } catch (err) { reply({ ok: false, error: String(err) }); }
        return;
      }
      default:
        reply({ ok: false });
    }
  })();
  return true; // async reply
});

// Keep following the recorded tab across full page loads.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await load();
  if (state.active && tabId === state.tabId && info.status === "complete") {
    await broadcast(tabId);
    await screenshot();
  }
});
