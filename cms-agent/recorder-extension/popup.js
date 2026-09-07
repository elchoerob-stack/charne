const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
const say = (t, bad) => { $("msg").textContent = t; $("msg").style.color = bad ? "#8B1A1A" : "#1A6B3A"; };

async function refresh() {
  const s = await send({ kind: "get" });
  const cfg = await chrome.storage.local.get(["server", "token", "dealer", "by"]);
  $("server").value = cfg.server || "http://localhost:8787";
  $("token").value = cfg.token || "";
  if (cfg.dealer) $("dealer").value = cfg.dealer;
  if (cfg.by) $("by").value = cfg.by;
  $("dot").classList.toggle("on", Boolean(s.active));
  $("setup").hidden = Boolean(s.active || s.rec);
  $("live").hidden = !s.active;
  $("done").hidden = s.active || !s.rec;
  if (s.active) $("stat").textContent = `Recording "${s.rec.title}" — ${s.count} events, ${Math.round((Date.now() - s.t0) / 1000)} s`;
  if (!s.active && s.rec) {
    const errs = s.rec.events.filter((e) => e.type === "console").length;
    const bad = s.rec.events.filter((e) => e.type === "network" && e.request && (e.request.ok === false || e.request.status >= 400)).length;
    $("summary").textContent = `"${s.rec.title}": ${s.rec.events.length} events, ${Object.keys(s.rec.screenshots || {}).length} screenshots, ${errs} console errors, ${bad} failed requests.`;
  }
}

$("start").onclick = async () => {
  const title = $("title").value.trim();
  if (!title) return say("Give the workflow a title first.", true);
  await chrome.storage.local.set({ dealer: $("dealer").value.trim(), by: $("by").value.trim() });
  const r = await send({ kind: "start", meta: { title, purpose: $("purpose").value, dealer: $("dealer").value.trim(), recordedBy: $("by").value.trim() } });
  say(r.ok ? "Recording. Work through the task in the current tab, then Stop." : "Could not start.", !r.ok);
  refresh();
};
$("stop").onclick = async () => { await send({ kind: "stop" }); say("Stopped. Review the summary, then send or download."); refresh(); };
$("addNote").onclick = async () => { const t = $("note").value.trim(); if (!t) return; await send({ kind: "note", text: t }); $("note").value = ""; say("Note added."); };
$("discard").onclick = async () => { await send({ kind: "discard" }); say("Discarded."); refresh(); };
$("save").onclick = async () => { await chrome.storage.local.set({ server: $("server").value.trim(), token: $("token").value }); say("Saved."); };
$("upload").onclick = async () => {
  const cfg = await chrome.storage.local.get(["server", "token"]);
  say("Uploading…");
  const r = await send({ kind: "upload", server: cfg.server || "http://localhost:8787", token: cfg.token || "" });
  if (r.ok) { say(`Uploaded as ${r.body.id} (${r.body.stats.steps} steps, ${r.body.stats.failedRequests} failed requests).`); await send({ kind: "discard" }); refresh(); }
  else say(`Upload failed: ${r.error || r.status}`, true);
};
$("download").onclick = async () => {
  const s = await send({ kind: "get" });
  const blob = new Blob([JSON.stringify(s.rec, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads ? chrome.downloads.download({ url, filename: `${s.rec.id}.json` }) : window.open(url);
  say("Download started.");
};
refresh();
setInterval(refresh, 2000);
