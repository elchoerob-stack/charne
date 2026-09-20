/* ============================================================
   CMS Workshop — the workshop app
   For the tablet in the bay. Big targets, one job in front of
   you at a time, and the health check built for a person
   standing under a car with oily hands.
   ============================================================ */
var CMS = window.CMS;
var h = CMS.ui.h;

var T = { user: null, tab: "jobs", jobId: null, vhcGroup: 0 };

function boot() {
  CMS.store.init();
  var saved = CMS.db().session && CMS.db().session.techUserId;
  var u = saved ? CMS.person(saved) : null;
  if (u) { T.user = u; CMS.applyPrefs(u.id); paint(); } else signIn();
  CMS.store.sub(function (reason) { if (T.user && reason === "remote") paint(); });
}

/* ---------- sign in ---------- */
function signIn() {
  var people = CMS.cfg().people.filter(function (p) {
    return p.active !== false && ["tech", "foreman"].indexOf(p.role) >= 0;
  });
  var box = h("div", { style: { padding: "20px 16px", maxWidth: "460px", margin: "0 auto" } },
    h("div", { style: { textAlign: "center", marginBottom: "18px" } }, CMS.ui.logo()),
    h("h1", { text: "Workshop" }),
    h("p.muted", { text: "Tap your name, then your PIN." }));
  var list = h("div.touch-list");
  people.forEach(function (p) {
    list.appendChild(h("button.touch-item", { onclick: function () { pin(p); } },
      h("span.badge.blue", { text: p.initials }),
      h("div", h("strong", { text: p.name }), h("div.muted", { text: CMS.roleOf(p).label })),
      h("div.spacer"), h("span", { text: "›" })));
  });
  box.appendChild(list);
  box.appendChild(h("p.muted", { style: { textAlign: "center", marginTop: "20px" } },
    h("a", { href: "index.html", text: "Front of house? Open the main app →" })));
  document.body.className = "";
  CMS.ui.mount(document.body, box);

  function pin(p) {
    var entered = "", dots = h("div.pindots");
    function paintDots() {
      CMS.ui.clear(dots);
      for (var i = 0; i < 4; i++) dots.appendChild(h("i" + (i < entered.length ? ".on" : "")));
    }
    function press(d) {
      if (d === "←") { entered = entered.slice(0, -1); return paintDots(); }
      entered += d; paintDots();
      if (entered.length === 4) {
        if (entered === p.pin) {
          T.user = p;
          CMS.store.patch(function (s) { s.session = s.session || {}; s.session.techUserId = p.id; });
          CMS.applyPrefs(p.id);
          paint();
        } else { CMS.ui.toast("Wrong PIN", "err"); entered = ""; setTimeout(paintDots, 250); }
      }
    }
    var pad = h("div.pinpad");
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", ""].forEach(function (d) {
      pad.appendChild(d ? h("button", { text: d, onclick: function () { press(d); } }) : h("span"));
    });
    paintDots();
    CMS.ui.mount(document.body, h("div", { style: { padding: "26px 16px", maxWidth: "420px", margin: "0 auto" } },
      h("h1", { text: p.name }),
      h("p.muted", { text: "Demo PIN: " + p.pin }),
      dots, pad,
      h("div", { style: { textAlign: "center", marginTop: "18px" } },
        h("button.btn.btn-ghost", { text: "← Someone else", onclick: signIn }))));
  }
}

function signOut() {
  CMS.store.patch(function (s) { s.session.techUserId = null; });
  T.user = null; T.jobId = null;
  signIn();
}

/* ---------- shell ---------- */
function paint() {
  if (!T.user) return signIn();
  var top = h("header.mobile-top",
    T.jobId ? h("button.btn.btn-sm", { text: "‹ Back", onclick: function () { T.jobId = null; paint(); } }) : CMS.ui.logo("white"),
    h("h1", { text: T.jobId ? (CMS.job(T.jobId) || {}).ref || "" : T.user.name.split(" ")[0] }),
    h("div.spacer"),
    h("button.btn.btn-sm", { text: "⟳", title: "Refresh", onclick: function () { CMS.store._reload(); paint(); } }));
  var body = h("div.app-mobile", { style: { padding: "var(--gap-sm) 14px" } });
  var tabbar = h("nav.tabbar");
  [
    { id: "jobs", label: "My work", icon: "▣" },
    { id: "board", label: "Workshop", icon: "▥" },
    { id: "me", label: "Me", icon: "☺" },
  ].forEach(function (t) {
    tabbar.appendChild(h("button", {
      "aria-current": (!T.jobId && T.tab === t.id) ? "page" : null,
      onclick: function () { T.tab = t.id; T.jobId = null; paint(); },
    }, h("span.ico", { text: t.icon }), h("span", { text: t.label })));
  });
  CMS.ui.mount(document.body, h("div", top, body, tabbar));
  if (T.jobId) return jobScreen(body);
  ({ jobs: myJobs, board: boardScreen, me: meScreen })[T.tab](body);
}

/* ---------- my work ---------- */
function myJobs(box) {
  var today = CMS.workingDate();
  var mine = CMS.jobs().filter(function (j) {
    return j.techId === T.user.id && j.slot && j.slot.date <= today && ["collected", "invoiced"].indexOf(j.status) < 0;
  });
  var unassigned = CMS.jobs().filter(function (j) {
    return !j.techId && j.slot && j.slot.date === today && ["collected", "invoiced", "ready"].indexOf(j.status) < 0;
  });
  var onNow = mine.filter(function (j) { return CMS.isClockedOn(j, T.user.id); });

  if (onNow.length) {
    box.appendChild(h("div.card", { style: { borderLeft: "5px solid var(--green)" } },
      h("h3", { text: "Clocked on" }),
      onNow.map(function (j) {
        return h("button.touch-item", { style: { marginBottom: "6px" }, onclick: function () { T.jobId = j.id; paint(); } },
          h("div", h("strong", { text: CMS.ui.vehLabel(j) }),
            h("div.muted", { text: (CMS.clockedMinutes(j, T.user.id) / 60).toFixed(1) + "h on this job" })),
          h("div.spacer"), h("span", { text: "›" }));
      })));
  }

  box.appendChild(h("h2", { text: "My " + CMS.t("jobs").toLowerCase() }));
  if (!mine.length) box.appendChild(CMS.ui.empty("▣", "Nothing allocated to you. Take one from the workshop list below."));
  var list = h("div.touch-list");
  mine.forEach(function (j) { list.appendChild(jobRow(j)); });
  box.appendChild(list);

  if (unassigned.length) {
    box.appendChild(h("h2", { style: { marginTop: "var(--gap)" }, text: "Waiting for a " + CMS.t("tech").toLowerCase() }));
    var ul = h("div.touch-list");
    unassigned.forEach(function (j) {
      ul.appendChild(h("button.touch-item", { style: { borderLeftColor: "var(--cool)" }, onclick: function () {
        CMS.ui.confirm("Take this " + CMS.t("job").toLowerCase(), CMS.ui.vehLabel(j) + " — " + ((j.requested[0] || {}).title || ""), function () {
          CMS.updateJob(j.id, function (jj) { jj.techId = T.user.id; CMS.log(jj, "Taken by " + T.user.name, T.user.id); });
          T.jobId = j.id; paint();
        }, "Take it");
      } },
        h("span.badge.grey", { text: j.slot.start }),
        h("div", h("strong", { text: CMS.ui.vehLabel(j) }), h("div.muted", { text: (j.requested[0] || {}).title || "" })),
        h("div.spacer"), h("span", { text: "Take ›" })));
    });
    box.appendChild(ul);
  }
}

function jobRow(j) {
  var s = CMS.vhcSummary(j);
  var st = CMS.status(j.status);
  return h("button.touch-item", {
    style: { borderLeftColor: CMS.isClockedOn(j, T.user.id) ? "var(--green)" : j.status === "awaiting_auth" ? "var(--mustard)" : j.status === "parts_hold" ? "var(--orange)" : "var(--blue)" },
    onclick: function () { T.jobId = j.id; T.vhcGroup = 0; paint(); },
  },
    h("span.badge.blue", { text: j.slot.start }),
    h("div", h("strong", { text: CMS.ui.vehLabel(j) }),
      h("div.muted", { text: (j.requested[0] || {}).title || "" }),
      h("div.row", CMS.ui.badge(st.label, st.tone),
        j.vhc ? h("span.row", CMS.ui.rag("r"), h("small", { text: String(s.r) }), CMS.ui.rag("a"), h("small", { text: String(s.a) })) : null)),
    h("div.spacer"), h("span", { text: "›" }));
}

/* ---------- one job ---------- */
function jobScreen(box) {
  var j = CMS.job(T.jobId);
  if (!j) { T.jobId = null; return paint(); }
  var veh = CMS.vehicle(j.vehicleId) || {};
  var on = CMS.isClockedOn(j, T.user.id);

  box.appendChild(h("div.card",
    h("h2", { style: { margin: 0 }, text: veh.reg || "" }),
    h("p.muted", { text: [veh.make, veh.model, veh.year, veh.km ? veh.km + " km" : ""].filter(Boolean).join(" · ") }),
    h("div.row", CMS.ui.statusBadge(j.status),
      CMS.ui.badge((CMS.clockedMinutes(j, T.user.id) / 60).toFixed(1) + "h clocked", "blue"))));

  box.appendChild(h("button.btn.btn-lg.btn-block" + (on ? ".btn-danger" : ".btn-primary"), {
    text: on ? "■  Clock off" : "▶  Clock on",
    onclick: function () {
      if (on) CMS.clockOff(j.id, T.user.id); else CMS.clockOn(j.id, T.user.id);
      paint();
    },
  }));

  var work = h("div.card", h("h3", { text: "What was asked for" }));
  (j.requested || []).forEach(function (r) {
    work.appendChild(h("div", { style: { padding: "6px 0", borderBottom: "1px solid var(--border)" } },
      h("strong", { text: r.title }), r.note ? h("div.muted", { text: r.note }) : null));
  });
  if (j.workshopNote) work.appendChild(h("p", CMS.ui.badge("Note from the front", "amber"), h("span", { text: " " + j.workshopNote })));
  box.appendChild(work);

  /* Health check */
  if (CMS.feature("vhc")) {
    var s = CMS.vhcSummary(j);
    var vc = h("div.card", h("div.card-head", h("h3", { text: CMS.t("vhc") }), h("div.spacer"),
      j.vhc ? CMS.ui.badge(s.done + "/" + s.total, j.vhc.completedAt ? "green" : "amber") : null));
    if (!j.vhc) {
      var tplSel = CMS.ui.select(CMS.cfg().vhcTemplates.map(function (t) { return { value: t.id, label: t.name }; }),
        (CMS.cfg().vhcTemplates.filter(function (t) { return t.default; })[0] || {}).id);
      vc.appendChild(CMS.ui.field("Template", tplSel));
      vc.appendChild(h("button.btn.btn-lg.btn-block.btn-accent", { text: "Start the health check", onclick: function () {
        CMS.startVhc(j.id, tplSel.value, T.user.id);
        CMS.setStatus(j.id, "vhc", T.user.id);
        T.vhcGroup = 0; paint();
      } }));
    } else {
      vc.appendChild(h("div.progress", h("i", { style: { width: (s.total ? s.done / s.total * 100 : 0) + "%" } })));
      vc.appendChild(h("button.btn.btn-lg.btn-block.btn-accent", { style: { marginTop: "10px" },
        text: j.vhc.completedAt ? "Look at the health check" : "Carry on with the health check",
        onclick: function () { vhcScreen(j.id); } }));
    }
    box.appendChild(vc);
  }

  /* Parts */
  var pc = h("div.card", h("h3", { text: "Parts" }));
  (j.partsRequests || []).forEach(function (r) {
    pc.appendChild(h("div.row", { style: { padding: "6px 0", borderBottom: "1px solid var(--border)" } },
      CMS.ui.badge(r.status, r.status === "issued" ? "green" : r.status === "backorder" ? "red" : "amber"),
      h("span", { text: r.items.map(function (i) { return i.qty + "× " + i.no; }).join(", ") }),
      h("div.spacer"), h("small.muted", { text: CMS.relTime(r.at) })));
  });
  pc.appendChild(h("button.btn.btn-block", { text: "＋ Ask parts for something", onclick: function () { partsDialog(j); } }));
  box.appendChild(pc);

  /* Notes and photos */
  var nc = h("div.card", h("h3", { text: "Notes" }));
  (j.notes || []).slice(0, 5).forEach(function (n) {
    nc.appendChild(h("div", { style: { padding: "6px 0", borderBottom: "1px solid var(--border)" } },
      h("div", { text: n.text }), h("small.muted", { text: ((CMS.person(n.by) || {}).name || "") + " · " + CMS.relTime(n.at) })));
  });
  var ta = h("textarea", { placeholder: "Something the advisor should know…" });
  nc.appendChild(ta);
  nc.appendChild(h("button.btn.btn-block", { style: { marginTop: "8px" }, text: "Add note", onclick: function () {
    if (!ta.value.trim()) return;
    CMS.updateJob(j.id, function (jj) { (jj.notes = jj.notes || []).unshift({ at: CMS.nowISO(), by: T.user.id, text: ta.value.trim() }); });
    paint();
  } }));
  box.appendChild(nc);

  /* Hand back */
  var hand = h("div.card", h("h3", { text: "Hand it back" }));
  var pending = j.lines.filter(function (l) { return l.authStatus === "pending"; });
  if (pending.length) {
    hand.appendChild(h("p", CMS.ui.badge(pending.length + " items with the advisor for approval", "amber")));
  }
  hand.appendChild(h("div.btn-row",
    h("button.btn.btn-lg", { text: "Waiting on parts", onclick: function () { CMS.setStatus(j.id, "parts_hold", T.user.id); paint(); } }),
    h("button.btn.btn-lg", { text: "Needs approval", onclick: function () {
      CMS.setStatus(j.id, "awaiting_auth", T.user.id);
      CMS.updateJob(j.id, function (jj) { CMS.log(jj, "Technician asked for the extra work to be quoted", T.user.id); });
      CMS.ui.toast("The advisor has been told", "ok"); paint();
    } }),
    h("button.btn.btn-lg.btn-primary", { text: "Work complete", onclick: function () {
      CMS.ui.confirm("Finished?", "This tells the front that " + (veh.reg || "the vehicle") + " is done.", function () {
        if (CMS.isClockedOn(j, T.user.id)) CMS.clockOff(j.id, T.user.id);
        CMS.setStatus(j.id, CMS.feature("qcSignOff") ? "qc" : "work_complete", T.user.id);
        T.jobId = null; paint();
        CMS.ui.toast("Handed back", "ok");
      }, "Yes, done");
    } })));
  box.appendChild(hand);
}

function partsDialog(j) {
  var rows = [{ no: "", qty: 1 }];
  var body = h("div");
  var listBox = h("div");
  var note = h("input", { type: "text", placeholder: "Anything parts should know" });
  function paintRows() {
    CMS.ui.clear(listBox);
    rows.forEach(function (r, i) {
      var sel = h("input", { type: "text", placeholder: "Part number or description", list: "partlist" });
      sel.value = r.no;
      sel.addEventListener("input", function () { r.no = sel.value; });
      var qty = h("input", { type: "number", min: "1", value: String(r.qty), style: { maxWidth: "90px" } });
      qty.addEventListener("input", function () { r.qty = +qty.value || 1; });
      listBox.appendChild(h("div.row", { style: { marginBottom: "6px" } }, sel, qty,
        h("button.btn.btn-sm.btn-ghost", { text: "✕", onclick: function () { rows.splice(i, 1); paintRows(); } })));
    });
  }
  paintRows();
  var dl = h("datalist", { id: "partlist" });
  CMS.cfg().parts.forEach(function (p) { dl.appendChild(h("option", { value: p.no, label: p.desc })); });
  body.appendChild(dl);
  body.appendChild(listBox);
  body.appendChild(h("button.btn.btn-sm", { text: "＋ Another part", onclick: function () { rows.push({ no: "", qty: 1 }); paintRows(); } }));
  body.appendChild(CMS.ui.field("Note", note));
  CMS.ui.modal("Ask parts for something", body, [
    h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", { text: "Send to parts", onclick: function () {
      var items = rows.filter(function (r) { return r.no.trim(); });
      if (!items.length) return CMS.ui.toast("Add at least one part", "warn");
      CMS.requestParts(j.id, items, T.user.id, note.value);
      CMS.ui.closeOverlays(); paint(); CMS.ui.toast("Parts have it", "ok");
    } })]);
}

/* ---------- the health check ---------- */
function vhcScreen(jobId) {
  var j = CMS.job(jobId);
  var groups = [];
  j.vhc.items.forEach(function (it) {
    if (!groups.length || groups[groups.length - 1].name !== it.group) groups.push({ name: it.group, items: [] });
    groups[groups.length - 1].items.push(it);
  });
  var gi = Math.min(T.vhcGroup, groups.length - 1);
  var g = groups[gi];
  var s = CMS.vhcSummary(j);

  var box = h("div.app-mobile", { style: { padding: "var(--gap-sm) 14px" } });
  var top = h("header.mobile-top",
    h("button.btn.btn-sm", { text: "‹ Job", onclick: function () { paint(); } }),
    h("h1", { text: CMS.t("vhc") + " · " + (CMS.vehicle(j.vehicleId) || {}).reg }),
    h("div.spacer"),
    h("span.badge.turq", { text: s.done + "/" + s.total }));

  box.appendChild(h("div.progress", h("i", { style: { width: (s.done / s.total * 100) + "%" } })));

  var nav = h("div.chipbar", { style: { margin: "var(--gap-sm) 0" } });
  groups.forEach(function (gg, i) {
    var done = gg.items.filter(function (x) { return x.rag; }).length;
    nav.appendChild(h("button.chip", { "aria-pressed": String(i === gi), text: gg.name + " (" + done + "/" + gg.items.length + ")",
      onclick: function () { T.vhcGroup = i; vhcScreen(jobId); } }));
  });
  box.appendChild(nav);

  g.items.forEach(function (item) {
    box.appendChild(vhcItemCard(j, item, function () { vhcScreen(jobId); }));
  });

  var foot = h("div.btn-row", { style: { marginTop: "var(--gap)" } },
    gi > 0 ? h("button.btn.btn-lg", { text: "← " + groups[gi - 1].name, onclick: function () { T.vhcGroup = gi - 1; vhcScreen(jobId); } }) : null,
    gi < groups.length - 1
      ? h("button.btn.btn-lg.btn-primary", { text: groups[gi + 1].name + " →", onclick: function () { T.vhcGroup = gi + 1; vhcScreen(jobId); } })
      : h("button.btn.btn-lg.btn-primary", { text: "Finish the health check", onclick: function () { finishVhc(j.id); } }));
  box.appendChild(foot);

  var tabbar = h("nav.tabbar",
    h("button", { onclick: function () { paint(); } }, h("span.ico", { text: "‹" }), h("span", { text: "Back to the job" })),
    h("button", { onclick: function () { finishVhc(j.id); } }, h("span.ico", { text: "✓" }), h("span", { text: "Finish" })));
  CMS.ui.mount(document.body, h("div", top, box, tabbar));
}

function vhcItemCard(j, item, redraw) {
  var card = h("div.card", { style: { borderLeft: "5px solid " + ({ r: "var(--red)", a: "var(--mustard)", g: "var(--green)" }[item.rag] || "var(--border)") } });
  card.appendChild(h("h3", { style: { color: "var(--text)" }, text: item.label }));

  var rags = h("div.chipbar");
  [["g", "Good"], ["a", "Advisory"], ["r", "Needs work"]].forEach(function (pair) {
    rags.appendChild(h("button.chip.rag-" + pair[0], {
      "aria-pressed": String(item.rag === pair[0]), text: pair[1],
      style: { flex: "1", justifyContent: "center", minHeight: "48px" },
      onclick: function () { setItem(j, item.id, { rag: item.rag === pair[0] ? "" : pair[0] }); redraw(); },
    }));
  });
  rags.style.display = "flex";
  card.appendChild(rags);

  if (item.measure) {
    var val = h("input", { type: "number", step: "0.1", inputmode: "decimal", placeholder: item.measure + " in " + item.unit });
    val.value = item.value || "";
    val.addEventListener("change", function () {
      var auto = CMS.ragFromMeasure(item, val.value);
      setItem(j, item.id, { value: val.value, rag: auto || item.rag });
      redraw();
    });
    card.appendChild(CMS.ui.field(item.measure + " (" + item.unit + ")", val, {
      hint: (item.redBelow != null ? "Red at or below " + item.redBelow + item.unit + ", " : "") +
            (item.amberBelow != null ? "amber at or below " + item.amberBelow + item.unit : ""),
    }));
  }

  var note = h("input", { type: "text", placeholder: "What did you see?" });
  note.value = item.note || "";
  note.addEventListener("change", function () { setItem(j, item.id, { note: note.value }); });
  card.appendChild(CMS.ui.field("Note", note));

  var photos = h("div.photos");
  (item.photos || []).forEach(function (p, i) {
    photos.appendChild(h("figure",
      h("img", { src: p, alt: item.label }),
      h("figcaption", h("button.btn.btn-sm.btn-ghost", { text: "remove", onclick: function () {
        var next = item.photos.slice(); next.splice(i, 1);
        setItem(j, item.id, { photos: next }); redraw();
      } }))));
  });
  var input = CMS.ui.photoInput(function (dataUrl) {
    var next = (item.photos || []).concat([dataUrl]);
    setItem(j, item.id, { photos: next });
    redraw();
    CMS.ui.toast("Photo added", "ok", 1400);
  });
  card.appendChild(photos);
  card.appendChild(input);
  card.appendChild(h("button.btn.btn-block", { text: "＋  Add a photo", onclick: function () { input.click(); } }));

  var need = (j.vhc.requirePhotoOn || []).indexOf(item.rag) >= 0 && !(item.photos || []).length;
  if (need) card.appendChild(h("p", CMS.ui.badge("A photo is required on " + (item.rag === "r" ? "red" : "amber"), "amber")));
  return card;
}

function setItem(j, itemId, patch) {
  CMS.updateJob(j.id, function (jj) {
    var it = jj.vhc.items.filter(function (x) { return x.id === itemId; })[0];
    if (it) Object.assign(it, patch);
  });
}

function finishVhc(jobId) {
  var j = CMS.job(jobId);
  var s = CMS.vhcSummary(j);
  var warn = [];
  if (s.n) warn.push(s.n + " item" + (s.n === 1 ? "" : "s") + " not checked");
  if (s.missingPhotos) warn.push(s.missingPhotos + " red or amber item" + (s.missingPhotos === 1 ? "" : "s") + " without a photo");
  var body = h("div",
    h("p", { text: s.r + " red, " + s.a + " amber, " + s.g + " green." }),
    warn.length ? h("p", CMS.ui.badge(warn.join(" · "), "amber")) : h("p", CMS.ui.badge("Everything checked", "green")),
    h("p.muted", { text: "The advisor gets the findings straight away and builds the customer's quote from them." }));
  CMS.ui.modal("Finish the health check", body, [
    h("button.btn", { text: "Keep going", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", { text: "Send it to the advisor", onclick: function () {
      CMS.completeVhc(jobId, T.user.id);
      if (s.r || s.a) CMS.setStatus(jobId, "awaiting_auth", T.user.id);
      CMS.ui.closeOverlays();
      T.jobId = jobId; paint();
      CMS.ui.toast("Health check sent", "ok");
    } })]);
}

/* ---------- workshop view ---------- */
function boardScreen(box) {
  var today = CMS.workingDate();
  box.appendChild(h("h2", { text: "In the workshop today" }));
  var jobs = CMS.jobsOn(today);
  if (!jobs.length) return box.appendChild(CMS.ui.empty("▥", "Nothing booked today."));
  var byTech = {};
  jobs.forEach(function (j) { (byTech[j.techId || ""] = byTech[j.techId || ""] || []).push(j); });
  Object.keys(byTech).forEach(function (tid) {
    var card = h("div.card", h("h3", { text: (CMS.person(tid) || {}).name || "Not allocated" }));
    byTech[tid].forEach(function (j) {
      card.appendChild(h("div.row", { style: { padding: "7px 0", borderBottom: "1px solid var(--border)" } },
        h("span.badge.blue", { text: j.slot.start }),
        h("div", h("strong", { text: CMS.ui.vehLabel(j) }), h("div.muted", { text: (j.requested[0] || {}).title || "" })),
        h("div.spacer"), CMS.ui.statusBadge(j.status)));
    });
    box.appendChild(card);
  });
}

/* ---------- me ---------- */
function meScreen(box) {
  var today = CMS.workingDate();
  var mine = CMS.jobs().filter(function (j) { return j.slot && j.slot.date === today && j.techId === T.user.id; });
  var clocked = mine.reduce(function (a, j) { return a + CMS.clockedMinutes(j, T.user.id); }, 0) / 60;
  var sold = mine.reduce(function (a, j) {
    return a + j.lines.filter(function (l) { return l.kind === "labour" && l.authStatus !== "declined"; })
      .reduce(function (b, l) { return b + (l.hours || 0); }, 0);
  }, 0);
  box.appendChild(h("div.card",
    h("h2", { text: T.user.name }),
    h("p.muted", { text: CMS.roleOf(T.user).label + " · " + CMS.cfg().dealer.name }),
    h("div.kpis",
      CMS.ui.kpi("Clocked today", clocked.toFixed(1) + "h", ""),
      CMS.ui.kpi("Hours sold", sold.toFixed(1) + "h", ""),
      CMS.ui.kpi("Efficiency", (clocked ? Math.round(sold / clocked * 100) : 0) + "%", ""),
      CMS.ui.kpi(CMS.t("jobs"), mine.length, "today"))));

  var p = CMS.prefs(T.user.id);
  box.appendChild(h("div.card",
    h("h3", { text: "How this app looks" }),
    CMS.ui.field("Theme", CMS.ui.select([{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "auto", label: "Match the tablet" }],
      p.theme, { onchange: function (e) { CMS.setPref(T.user.id, "theme", e.target.value); CMS.applyPrefs(T.user.id); paint(); } })),
    CMS.ui.field("Size", CMS.ui.select([{ value: "comfortable", label: "Normal" }, { value: "large", label: "Large — gloves on" }, { value: "compact", label: "Compact" }],
      p.density, { onchange: function (e) { CMS.setPref(T.user.id, "density", e.target.value); CMS.applyPrefs(T.user.id); paint(); } })),
    CMS.ui.field("Health-check colours", CMS.ui.select([{ value: "standard", label: "Standard" }, { value: "accessible", label: "Colour-blind safe" }],
      p.rag, { onchange: function (e) { CMS.setPref(T.user.id, "rag", e.target.value); CMS.applyPrefs(T.user.id); paint(); } }))));

  box.appendChild(h("div.card",
    h("h3", { text: "Signal" }),
    h("p.muted", { text: "Everything you enter is kept on this tablet and shows on the front desk as soon as there is a connection. Keep photos to one or two per item — that is what makes uploads fail in a wash bay." }),
    h("button.btn.btn-block", { text: "Sign out", onclick: signOut })));
}

document.addEventListener("DOMContentLoaded", boot);
