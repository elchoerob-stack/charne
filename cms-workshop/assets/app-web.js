/* ============================================================
   CMS Workshop — staff console (the web version)
   Service advisors, foremen, parts and managers. Everything a
   role may see comes from config.roles, so the same build fits
   a one-man workshop and a multi-franchise dealership.
   ============================================================ */
var CMS = window.CMS;
var h = CMS.ui.h;

var App = {
  user: null,
  view: "dashboard",
  param: null,
  diaryDate: null,        // set at boot to the next working day
  boardDate: null,
  jobFilter: { q: "", status: "", advisor: "", when: "today" },
  draft: null,          // the booking wizard's autosaved draft
  wall: false,
};

/* ---------- navigation catalogue ---------- */
var VIEWS = {
  dashboard:      { label: "Today",            icon: "▦", render: viewDashboard },
  diary:          { label: "Diary",            icon: "▤", render: viewDiary },
  board:          { label: "Dispatch board",   icon: "▥", render: viewBoard },
  bookings:       { label: "New booking",      icon: "＋", render: viewBooking },
  jobs:           { label: "Job cards",        icon: "▣", render: viewJobs },
  vhc:            { label: "Health checks",    icon: "✓", render: viewVhc },
  authorisations: { label: "Authorisations",   icon: "◆", render: viewAuths },
  parts:          { label: "Parts",            icon: "⚙", render: viewParts },
  customers:      { label: "Customers",        icon: "☺", render: viewCustomers },
  reports:        { label: "Reports",          icon: "▨", render: viewReports },
  setup:          { label: "Setup",            icon: "⚒", render: viewSetup },
};

/* Terminology overrides the stock labels. */
function navLabel(id) {
  return ({
    jobs: CMS.t("jobs"), board: CMS.t("board"), vhc: CMS.t("vhc") + " checks",
    bookings: "New " + CMS.t("booking").toLowerCase(), authorisations: CMS.t("auth") + "s",
  })[id] || VIEWS[id].label;
}

/* ============================================================
   Boot
   ============================================================ */
function boot() {
  CMS.store.init();
  App.diaryDate = App.diaryDate || CMS.workingDate();
  App.boardDate = App.boardDate || CMS.workingDate();
  var saved = CMS.db().session && CMS.db().session.webUserId;
  var user = saved ? CMS.person(saved) : null;
  if (user) signIn(user, true); else renderSignIn();

  window.addEventListener("hashchange", routeFromHash);
  CMS.store.sub(function (reason) { if (App.user && reason === "remote") render(); });
}

function renderSignIn() {
  var people = CMS.cfg().people.filter(function (p) {
    return p.active !== false && (CMS.roleOf(p).appOnly || "web") !== "workshop";
  });
  var pinWrap = h("div", { hidden: true });
  var chosen = null;
  var list = h("div.touch-list");
  people.forEach(function (p) {
    list.appendChild(h("button.touch-item", { onclick: function () { pick(p); } },
      h("span.badge.blue", { text: p.initials }),
      h("div", h("strong", { text: p.name }), h("div.muted", { text: CMS.roleOf(p).label })),
      h("div.spacer"), h("span", { text: "›" })));
  });

  function pick(p) {
    chosen = p;
    pinWrap.hidden = false;
    CMS.ui.clear(pinWrap);
    var dots = h("div.pindots");
    var entered = "";
    function paint() {
      CMS.ui.clear(dots);
      for (var i = 0; i < 4; i++) dots.appendChild(h("i" + (i < entered.length ? ".on" : "")));
    }
    function press(d) {
      if (d === "←") { entered = entered.slice(0, -1); paint(); return; }
      entered += d; paint();
      if (entered.length === 4) {
        if (entered === p.pin) signIn(p);
        else { CMS.ui.toast("That PIN does not match", "err"); entered = ""; setTimeout(paint, 300); }
      }
    }
    var pad = h("div.pinpad");
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", ""].forEach(function (d) {
      pad.appendChild(d ? h("button", { text: d, onclick: function () { press(d); } }) : h("span"));
    });
    paint();
    pinWrap.appendChild(h("div.card",
      h("h3", { text: "Hello, " + p.name.split(" ")[0] }),
      h("p.muted", { text: "Enter your four-digit PIN. Demo PIN: " + p.pin }),
      dots, pad,
      h("div.btn-row", { style: { marginTop: "14px", justifyContent: "center" } },
        h("button.btn.btn-ghost", { text: "Someone else", onclick: function () { pinWrap.hidden = true; } }))));
    pinWrap.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.body.className = "";
  CMS.ui.mount(document.body, h("div", { style: { maxWidth: "520px", margin: "0 auto", padding: "40px 16px" } },
    h("div", { style: { textAlign: "center", marginBottom: "24px" } }, CMS.ui.logo()),
    h("h1", { text: CMS.cfg().dealer.name + " · Workshop" }),
    h("p.muted", { text: "Choose your name to sign in. Your view, your shortcuts and your layout come with you." }),
    h("div.card", list),
    pinWrap,
    h("p.muted", { style: { textAlign: "center" } },
      h("a", { href: "workshop.html", text: "Technician? Open the workshop app →" }))));
}

function signIn(user, silent) {
  App.user = user;
  CMS.store.patch(function (s) { s.session = s.session || {}; s.session.webUserId = user.id; });
  CMS.applyPrefs(user.id);
  var p = CMS.prefs(user.id);
  var nav = CMS.roleOf(user).nav || ["dashboard"];
  if (!location.hash || location.hash === "#") {
    location.hash = "#/" + (p.landing && nav.indexOf(p.landing) >= 0 ? p.landing : nav[0]);
  }
  routeFromHash();
  if (!silent) CMS.ui.toast("Signed in as " + user.name, "ok");
}

function signOut() {
  CMS.store.patch(function (s) { s.session.webUserId = null; });
  App.user = null;
  location.hash = "";
  renderSignIn();
}

function routeFromHash() {
  var parts = (location.hash || "#/dashboard").replace(/^#\//, "").split("/");
  var v = parts[0] || "dashboard";
  if (!VIEWS[v]) v = "dashboard";
  var nav = CMS.roleOf(App.user).nav || [];
  if (nav.indexOf(v) < 0 && !CMS.can(App.user, "*")) {
    CMS.ui.toast("Your role does not have " + navLabel(v), "warn");
    v = nav[0] || "dashboard";
  }
  App.view = v;
  App.param = parts[1] || null;
  render();
}

function go(view, param) { location.hash = "#/" + view + (param ? "/" + param : ""); }

/* ============================================================
   Shell
   ============================================================ */
function render() {
  if (!App.user) return renderSignIn();
  var nav = CMS.roleOf(App.user).nav || [];
  var prefs = CMS.prefs(App.user.id);

  var sidebar = h("aside.sidebar",
    h("div.sidebar-brand", CMS.ui.logo("white")),
    h("nav.sidebar-nav", { "aria-label": "Sections" }));
  var navBox = sidebar.querySelector(".sidebar-nav");
  nav.forEach(function (id) {
    if (!VIEWS[id]) return;
    if (id === "vhc" && !CMS.feature("vhc")) return;
    if (id === "parts" && !CMS.feature("partsCatalogue")) return;
    var badge = navCount(id);
    navBox.appendChild(h("button.nav-item", {
      "aria-current": App.view === id ? "page" : null,
      onclick: function () { go(id); },
    }, h("span.ico", { text: VIEWS[id].icon }), h("span", { text: navLabel(id) }),
      badge ? h("span.pill", { text: String(badge) }) : null));
  });
  sidebar.appendChild(h("div.sidebar-foot",
    h("div", { text: App.user.name }),
    h("div", { text: CMS.roleOf(App.user).label }),
    h("button.btn.btn-sm.btn-ghost", { style: { color: "#fff", marginTop: "8px" }, text: "Sign out", onclick: signOut })));

  var topbar = h("header.topbar",
    h("button.btn.btn-ghost.only-mobile", { text: "☰", "aria-label": "Menu", onclick: function () {
      var sh = document.querySelector(".shell");
      sh.dataset.nav = sh.dataset.nav === "open" ? "" : "open";
    } }),
    h("h1", { text: navLabel(App.view) }),
    h("div.spacer"),
    h("input", {
      type: "search", placeholder: "Search a registration, a name or a " + CMS.t("ro"),
      style: { maxWidth: "260px" }, class: "hide-wall",
      onkeydown: function (e) { if (e.key === "Enter") quickSearch(e.target.value); },
    }),
    h("button.btn.btn-ghost.hide-wall", { text: "☾", title: "Light / dark", onclick: function () {
      var next = CMS.prefs(App.user.id).theme === "dark" ? "light" : "dark";
      CMS.setPref(App.user.id, "theme", next); CMS.applyPrefs(App.user.id);
    } }),
    h("button.btn.btn-ghost.hide-wall", { text: "⚙", title: "My preferences", onclick: openPrefs }),
    CMS.can(App.user, "book") ? h("button.btn.btn-primary.hide-wall", { text: "＋ " + CMS.t("booking"), onclick: function () { go("bookings"); } }) : null);

  var content = h("main.content");
  var shell = h("div.shell", { "data-nav": "" }, sidebar, h("div.main", topbar, content));
  document.body.className = App.wall ? "wall" : "";
  CMS.ui.mount(document.body, shell);
  try { VIEWS[App.view].render(content); }
  catch (err) {
    console.error(err);
    content.appendChild(h("div.card", h("h3", { text: "That screen could not be drawn" }), h("p.muted", { text: String(err.message || err) })));
  }
}

function navCount(id) {
  var jobs = CMS.jobs();
  if (id === "authorisations") return jobs.filter(function (j) { return j.status === "awaiting_auth"; }).length;
  if (id === "parts") return jobs.reduce(function (a, j) {
    return a + (j.partsRequests || []).filter(function (r) { return r.status === "requested"; }).length;
  }, 0);
  if (id === "vhc") return jobs.filter(function (j) { return j.vhc && !j.vhc.completedAt; }).length;
  return 0;
}

function quickSearch(q) {
  q = String(q || "").trim().toLowerCase();
  if (!q) return;
  var hit = CMS.jobs().filter(function (j) {
    var v = CMS.vehicle(j.vehicleId) || {}, c = CMS.customer(j.customerId) || {};
    return [j.ref, v.reg, v.vin, c.name, c.mobile].join(" ").toLowerCase().indexOf(q) >= 0;
  })[0];
  if (hit) openJob(hit.id);
  else CMS.ui.toast("Nothing found for “" + q + "”", "warn");
}

/* ---------- personal preferences ---------- */
function openPrefs() {
  var u = App.user, p = CMS.prefs(u.id);
  var nav = CMS.roleOf(u).nav || [];
  function set(k, v) { CMS.setPref(u.id, k, v); CMS.applyPrefs(u.id); render(); }
  CMS.ui.drawer("My preferences", h("div",
    h("p.muted", { text: "These are yours alone — they follow you on this device and change nothing for anyone else." }),
    h("div.card",
      h("h3", { text: "Look" }),
      CMS.ui.field("Theme", CMS.ui.select(
        [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "auto", label: "Match my device" }],
        p.theme, { onchange: function (e) { set("theme", e.target.value); } })),
      CMS.ui.field("Density", CMS.ui.select(
        [{ value: "compact", label: "Compact — more rows on screen" },
         { value: "comfortable", label: "Comfortable" },
         { value: "large", label: "Large — easier on a touchscreen" }],
        p.density, { onchange: function (e) { set("density", e.target.value); } })),
      CMS.ui.field("Health-check colours", CMS.ui.select(
        [{ value: "standard", label: "Standard red / amber / green" },
         { value: "accessible", label: "Colour-blind safe" }],
        p.rag, { onchange: function (e) { set("rag", e.target.value); } }),
        { hint: "Changes the eVHC palette here and on the tablets." })),
    h("div.card",
      h("h3", { text: "Where I start" }),
      CMS.ui.field("Open this screen when I sign in", CMS.ui.select(
        [{ value: "", label: "First item on my menu" }].concat(nav.map(function (n) { return { value: n, label: navLabel(n) }; })),
        p.landing, { onchange: function (e) { set("landing", e.target.value); } })),
      CMS.ui.field("Group the " + CMS.t("board").toLowerCase() + " by", CMS.ui.select(
        [{ value: "tech", label: CMS.t("techs") }, { value: "bay", label: CMS.t("bay") + "s" }],
        p.boardGroupBy, { onchange: function (e) { set("boardGroupBy", e.target.value); } }))),
    h("div.card",
      h("h3", { text: "Signed in as" }),
      h("p", { text: u.name + " · " + CMS.roleOf(u).label }),
      h("button.btn", { text: "Sign out", onclick: function () { CMS.ui.closeOverlays(); signOut(); } }))));
}

/* ============================================================
   Today
   ============================================================ */
function viewDashboard(root) {
  var today = CMS.workingDate();
  var todays = CMS.jobsOn(today);
  var k = CMS.kpis(today, today);
  var mine = todays.filter(function (j) { return j.advisorId === App.user.id; });

  if (today !== CMS.todayISO()) {
    root.appendChild(h("div.card", { style: { borderLeft: "5px solid var(--turquoise)" } },
      h("strong", { text: "The workshop is closed today." }),
      h("div.muted", { text: "Showing " + CMS.fmtDay(today) + ", the next working day. Opening days are set in Setup → Diary." })));
  }

  root.appendChild(h("div.kpis",
    CMS.ui.kpi("In the workshop", k.wip, todays.length + " booked today"),
    CMS.ui.kpi("Awaiting approval", k.awaitingAuth, "customer decision", k.awaitingAuth > 0),
    CMS.ui.kpi("Waiting on parts", k.partsHold, "on hold", k.partsHold > 0),
    CMS.ui.kpi("Upsell approved", CMS.money(k.upsellSold), k.conversion + "% of what was presented"),
    CMS.ui.kpi(CMS.t("vhc") + " done", k.vhcRate + "%", k.redAmber + " red/amber found"),
    CMS.ui.kpi("Ready to collect", todays.filter(function (j) { return j.status === "ready"; }).length, "")));

  var cols = h("div.cols", { style: { marginTop: "var(--gap)" } });

  /* What needs a person right now, in the order it needs them. */
  var attention = [];
  CMS.jobs().forEach(function (j) {
    if (j.status === "awaiting_auth") {
      var mins = j.auth && j.auth.requestedAt ? Math.round((Date.now() - new Date(j.auth.requestedAt)) / 60000) : 0;
      attention.push({ j: j, why: "Waiting on the customer " + (mins > 90 ? "for " + Math.round(mins / 60) + "h — chase it" : CMS.relTime(j.auth.requestedAt)), tone: mins > 90 ? "red" : "amber", sort: 1 });
    }
    if (j.status === "parts_hold") attention.push({ j: j, why: "Parts on backorder", tone: "amber", sort: 2 });
    if ((j.posting || []).filter(function (p) { return p.status === "failed"; })[0] && !j.postingCleared) {
      attention.push({ j: j, why: "Evolve post failed — " + j.posting.filter(function (p) { return p.status === "failed"; })[0].response, tone: "red", sort: 0 });
    }
    if (j.vhc && !j.vhc.completedAt && j.status !== "booked") {
      var s = CMS.vhcSummary(j);
      if (s.done > 0) attention.push({ j: j, why: CMS.t("vhc") + " part-done (" + s.done + "/" + s.total + ")", tone: "grey", sort: 3 });
    }
    if (j.status === "ready" && j.readyAt && (Date.now() - new Date(j.readyAt)) > 3 * 3600e3) {
      attention.push({ j: j, why: "Ready since " + CMS.fmtTime(j.readyAt) + " — customer not collected", tone: "amber", sort: 4 });
    }
  });
  attention.sort(function (a, b) { return a.sort - b.sort; });

  var attCard = h("div.card", h("div.card-head", h("h2", { text: "Needs you" }), h("div.spacer"),
    CMS.ui.badge(String(attention.length), attention.length ? "red" : "green")));
  if (!attention.length) attCard.appendChild(CMS.ui.empty("✓", "Nothing waiting. The board is clean."));
  attention.slice(0, 9).forEach(function (a) {
    attCard.appendChild(h("button.touch-item", { style: { marginBottom: "8px" }, onclick: function () { openJob(a.j.id); } },
      h("div", h("strong", { text: a.j.ref + " · " + CMS.ui.vehLabel(a.j) }),
        h("div.muted", { text: CMS.ui.custName(a.j) + " — " + a.why })),
      h("div.spacer"), CMS.ui.badge(CMS.status(a.j.status).label, a.tone)));
  });
  cols.appendChild(attCard);

  var mineCard = h("div.card", h("div.card-head", h("h2", { text: "My " + CMS.t("jobs").toLowerCase() + " today" })));
  if (!mine.length) mineCard.appendChild(CMS.ui.empty("▤", "Nothing booked to you today."));
  mine.forEach(function (j) {
    mineCard.appendChild(h("button.touch-item", { style: { marginBottom: "8px" }, onclick: function () { openJob(j.id); } },
      h("span.badge.blue", { text: j.slot.start }),
      h("div", h("strong", { text: CMS.ui.vehLabel(j) }), h("div.muted", { text: CMS.ui.custName(j) })),
      h("div.spacer"), CMS.ui.statusBadge(j.status)));
  });
  cols.appendChild(mineCard);
  root.appendChild(cols);
}

/* ============================================================
   Diary
   ============================================================ */
function viewDiary(root) {
  var d = CMS.cfg().diary;
  var date = App.diaryDate;
  var slots = CMS.slotsForDay(date);
  var head = h("div.card",
    h("div.card-head",
      h("button.btn", { text: "‹", onclick: function () { shift(-1); } }),
      h("h2", { text: CMS.fmtDay(date) }),
      h("button.btn", { text: "›", onclick: function () { shift(1); } }),
      h("button.btn.btn-ghost", { text: "Today", onclick: function () { App.diaryDate = CMS.todayISO(); render(); } }),
      h("div.spacer"),
      h("span.badge" + (CMS.dayLoadHours(date) > d.dailyCapacityHours ? ".red" : ".blue"),
        { text: CMS.dayLoadHours(date) + "h booked of " + d.dailyCapacityHours + "h" }),
      CMS.can(App.user, "book") ? h("button.btn.btn-primary", { text: "＋ " + CMS.t("booking"), onclick: function () { go("bookings"); } }) : null));
  function shift(n) {
    App.diaryDate = new Date(new Date(date + "T00:00:00").getTime() + n * 86400e3).toISOString().slice(0, 10);
    render();
  }
  root.appendChild(head);

  if (!slots.length) {
    root.appendChild(CMS.ui.empty("▤", "The workshop is closed on " + CMS.fmtDay(date) + ". Opening days are set in Setup → Diary.",
      h("button.btn.btn-primary", { style: { marginTop: "12px" }, text: "Go to the next working day",
        onclick: function () { App.diaryDate = CMS.nextOpenDay(shiftDate(date, 1), 1); render(); } })));
    return;
  }

  var wrap = h("div.card.flush");
  var tbl = h("table.data");
  tbl.appendChild(h("thead", h("tr",
    h("th", { style: { width: "90px" }, text: "Time" }),
    h("th", { text: "Booked in" }),
    h("th", { style: { width: "130px" }, text: "Load" }))));
  var tb = h("tbody");
  slots.forEach(function (t) {
    var inSlot = CMS.jobsOn(date).filter(function (j) { return j.slot.start === t; });
    var load = inSlot.length;
    var cells = h("td");
    inSlot.forEach(function (j) {
      cells.appendChild(h("button.btn.btn-sm", {
        style: { marginRight: "6px", marginBottom: "4px" },
        onclick: function () { openJob(j.id); },
        text: CMS.ui.vehLabel(j) + " · " + CMS.ui.custName(j),
      }));
    });
    if (!load) cells.appendChild(h("button.btn.btn-sm.btn-ghost", {
      text: "＋ book " + t, onclick: function () { go("bookings"); App.draftSlot = { date: date, start: t }; },
    }));
    tb.appendChild(h("tr",
      h("td", h("strong", { text: t })),
      cells,
      h("td", h("div.meter-row",
        h("div.progress", h("i", { style: { width: Math.min(100, load / d.slotCapacity * 100) + "%", background: load > d.slotCapacity ? "var(--red)" : "var(--turquoise)" } })),
        h("span.muted", { text: load + "/" + d.slotCapacity })))));
  });
  tbl.appendChild(tb);
  wrap.appendChild(h("div.table-wrap", tbl));
  root.appendChild(wrap);
}

/* ============================================================
   Dispatch board
   ============================================================ */
function viewBoard(root) {
  var prefs = CMS.prefs(App.user.id);
  var groupBy = prefs.boardGroupBy || "tech";
  var date = App.boardDate;
  var cfg = CMS.cfg();
  var columns = groupBy === "bay"
    ? cfg.bays.map(function (b) { return { id: b.id, name: b.name, sub: b.type }; })
    : CMS.peopleByRole("tech").map(function (p) { return { id: p.id, name: p.name, sub: (p.skills || []).join(", ") }; });
  columns.unshift({ id: "", name: "Unassigned", sub: "drag onto a column" });

  root.appendChild(h("div.card",
    h("div.card-head",
      h("button.btn", { text: "‹", onclick: function () { App.boardDate = shiftDate(date, -1); render(); } }),
      h("h2", { text: CMS.fmtDay(date) }),
      h("button.btn", { text: "›", onclick: function () { App.boardDate = shiftDate(date, 1); render(); } }),
      h("div.spacer"),
      h("div.chipbar",
        h("button.chip", { "aria-pressed": String(groupBy === "tech"), text: "By " + CMS.t("tech").toLowerCase(), onclick: function () { CMS.setPref(App.user.id, "boardGroupBy", "tech"); render(); } }),
        h("button.chip", { "aria-pressed": String(groupBy === "bay"), text: "By " + CMS.t("bay").toLowerCase(), onclick: function () { CMS.setPref(App.user.id, "boardGroupBy", "bay"); render(); } })),
      CMS.feature("wallScreen") ? h("button.btn.hide-wall", { text: "Wall screen", onclick: function () {
        App.wall = true; render();
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () { });
      } }) : null,
      App.wall ? h("button.btn", { text: "Exit wall screen", onclick: function () {
        App.wall = false; render();
        if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
      } }) : null)));

  var slots = CMS.slotsForDay(date);
  if (!slots.length) {
    root.appendChild(CMS.ui.empty("▥", "The workshop is closed on " + CMS.fmtDay(date) + ".",
      h("button.btn.btn-primary", { style: { marginTop: "12px" }, text: "Go to the next working day",
        onclick: function () { App.boardDate = CMS.nextOpenDay(shiftDate(date, 1), 1); render(); } })));
    return;
  }

  var grid = h("div.board", { style: { gridTemplateColumns: "88px repeat(" + columns.length + ", minmax(180px, 1fr))" } });
  grid.appendChild(h("div.bhead.corner", { text: "Time" }));
  columns.forEach(function (c) {
    grid.appendChild(h("div.bhead", h("div", { text: c.name }), h("small.muted", { text: c.sub || "" })));
  });

  var jobs = CMS.jobsOn(date);
  slots.forEach(function (t) {
    grid.appendChild(h("div.bcell.btime", { text: t }));
    columns.forEach(function (c) {
      var cell = h("div.bcell", { "data-col": c.id, "data-slot": t });
      cell.addEventListener("dragover", function (e) { e.preventDefault(); cell.classList.add("drop-active"); });
      cell.addEventListener("dragleave", function () { cell.classList.remove("drop-active"); });
      cell.addEventListener("drop", function (e) {
        e.preventDefault(); cell.classList.remove("drop-active");
        var id = e.dataTransfer.getData("text/plain");
        if (!id) return;
        if (!CMS.can(App.user, "dispatch") && !CMS.can(App.user, "*")) { CMS.ui.toast("Your role cannot move jobs on the board", "warn"); return; }
        CMS.updateJob(id, function (j) {
          j.slot.start = t;
          if (groupBy === "bay") { j.bayId = c.id || null; CMS.log(j, "Moved to " + (c.name) + " at " + t, App.user.id); }
          else { j.techId = c.id || null; CMS.log(j, "Assigned to " + c.name + " at " + t, App.user.id); }
        });
        render();
      });
      jobs.filter(function (j) {
        var key = groupBy === "bay" ? (j.bayId || "") : (j.techId || "");
        return j.slot.start === t && key === c.id;
      }).forEach(function (j) { cell.appendChild(jobChip(j)); });
      grid.appendChild(cell);
    });
  });
  root.appendChild(h("div.board-scroll", grid));
  root.appendChild(h("p.muted", { text: "Drag a card onto another column or time to re-assign. Everything you change here shows on the technicians' app straight away." }));
}

function shiftDate(d, n) { return new Date(new Date(d + "T00:00:00").getTime() + n * 86400e3).toISOString().slice(0, 10); }

function jobChip(j) {
  var st = CMS.status(j.status);
  var overdue = j.slot && st.wip && CMS.hhmmToMin(CMS.addMin(j.slot.start, j.slot.durationMin || 60)) < (new Date().getHours() * 60 + new Date().getMinutes()) && j.slot.date === CMS.todayISO();
  var chip = h("div.jobchip", {
    draggable: "true", "data-state": overdue ? "overdue" : j.status,
    onclick: function () { openJob(j.id); },
    title: j.ref + " · " + CMS.ui.custName(j),
  },
    h("strong", { text: CMS.ui.vehLabel(j) }),
    h("div.meta", { text: (j.requested[0] ? j.requested[0].title : st.label) }),
    h("div.meta", CMS.ui.statusBadge(j.status),
      j.vhc ? h("span", { style: { marginLeft: "5px" } }, CMS.ui.rag(worstRag(j))) : null));
  chip.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", j.id); });
  return chip;
}
function worstRag(j) {
  var s = CMS.vhcSummary(j);
  return s.r ? "r" : s.a ? "a" : s.g ? "g" : "";
}

/* ============================================================
   Booking wizard
   Customer → Vehicle → Work requested → Slot & advisor → Confirm.
   The draft saves on every step, so a walk-in interrupting a
   phone booking costs nothing.
   ============================================================ */
var WIZ_STEPS = [
  { id: "customer", label: "Customer" },
  { id: "vehicle", label: "Vehicle" },
  { id: "work", label: "Work requested" },
  { id: "slot", label: "Slot & " + "advisor" },
  { id: "confirm", label: "Confirm" },
];

function newDraft() {
  return {
    id: CMS.uid("draft"), step: 0, startedAt: CMS.nowISO(),
    customer: { id: "", name: "", mobile: "", email: "", consent: { sms: true, whatsapp: true, email: true } },
    vehicle: { id: "", reg: "", vin: "", make: "", model: "", year: "", km: "" },
    work: { menuIds: [], items: [], note: "" },
    slot: {
      date: (App.draftSlot && App.draftSlot.date) || CMS.workingDate(),
      start: (App.draftSlot && App.draftSlot.start) || "08:00",
      durationMin: CMS.cfg().diary.defaultDurationMin,
      advisorId: App.user && App.user.role === "advisor" ? App.user.id : "",
      techId: "", bayId: "", transport: "leave",
    },
  };
}
function saveDraft() {
  CMS.store.patch(function (s) {
    s.drafts = (s.drafts || []).filter(function (d) { return d.id !== App.draft.id; });
    s.drafts.unshift(CMS.clone(App.draft));
    s.drafts = s.drafts.slice(0, 12);
  });
}
function dropDraft(id) {
  CMS.store.patch(function (s) { s.drafts = (s.drafts || []).filter(function (d) { return d.id !== id; }); });
}

/* What is missing on the current step. Empty array = Next is live. */
function stepErrors(d, step) {
  var e = {};
  if (step === 0) {
    if (!d.customer.name.trim()) e.name = "We need a name.";
    if (!CMS.validMobile(d.customer.mobile)) e.mobile = "Ten digits starting with 0, or +27 and nine digits.";
    if (!CMS.validEmail(d.customer.email)) e.email = "That e-mail address does not look right.";
  }
  if (step === 1) {
    if (!CMS.validReg(d.vehicle.reg)) e.reg = "Registration is needed.";
    if (d.vehicle.vin && !CMS.validVin(d.vehicle.vin)) e.vin = "A VIN is 17 characters and never uses I, O or Q.";
  }
  if (step === 2) {
    if (!d.work.menuIds.length && !d.work.items.length) e.work = "Add at least one job, or a line of your own.";
  }
  if (step === 3) {
    if (!d.slot.date) e.date = "Pick a date.";
    if (!d.slot.advisorId) e.advisorId = "A " + CMS.t("advisor").toLowerCase() + " must own the booking.";
    if (d.slot.date && !CMS.isOpenDay(d.slot.date)) {
      e.date = "The workshop is closed that day — the next open day is " + CMS.fmtDay(CMS.nextOpenDay(d.slot.date, 1)) + ".";
    }
  }
  return e;
}

function viewBooking(root) {
  if (!App.draft) App.draft = newDraft();
  var d = App.draft;
  var errs = stepErrors(d, d.step);

  var drafts = (CMS.db().drafts || []).filter(function (x) { return x.id !== d.id; });
  if (drafts.length) {
    var dr = h("div.card", h("div.card-head", h("h3", { text: "Unfinished " + CMS.t("booking").toLowerCase() + "s" }), h("div.spacer"),
      h("small.muted", { text: "Saved automatically on every step" })));
    drafts.forEach(function (x) {
      dr.appendChild(h("div.row", { style: { justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "8px 0" } },
        h("div", h("strong", { text: (x.vehicle.reg || "No reg yet") + " · " + (x.customer.name || "No name yet") }),
          h("div.muted", { text: WIZ_STEPS[x.step].label + " — started " + CMS.relTime(x.startedAt) })),
        h("div.btn-row",
          h("button.btn.btn-sm", { text: "Resume", onclick: function () { App.draft = x; render(); } }),
          h("button.btn.btn-sm.btn-ghost", { text: "Discard", onclick: function () { dropDraft(x.id); render(); } }))));
    });
    root.appendChild(dr);
  }

  var stepper = h("div.stepper", { role: "tablist" });
  WIZ_STEPS.forEach(function (s, i) {
    stepper.appendChild(h("button.step", {
      "aria-current": i === d.step ? "step" : null,
      "data-done": String(i < d.step),
      disabled: i > d.step ? true : null,
      onclick: function () { if (i <= d.step) { d.step = i; saveDraft(); render(); } },
    }, h("span.n", { text: "Step " + (i + 1) }), h("span.t", { text: s.label })));
  });

  var body = h("div.card");
  ([stepCustomer, stepVehicle, stepWork, stepSlot, stepConfirm])[d.step](body, d, errs);

  var next = h("button.btn.btn-primary", {
    text: d.step === 4 ? "Confirm " + CMS.t("booking").toLowerCase() : "Next →",
    disabled: Object.keys(errs).length ? true : null,
    onclick: function () {
      if (d.step === 4) return commitBooking(d);
      d.step++; saveDraft(); render();
    },
  });
  App._wizNext = next;
  var foot = h("div.wizard-foot",
    d.step > 0 ? h("button.btn", { text: "← Back", onclick: function () { d.step--; saveDraft(); render(); } }) : null,
    h("div.spacer"),
    Object.keys(errs).length ? h("small.muted", { text: "Fill the fields marked in red to carry on" }) : null,
    h("button.btn.btn-ghost", { text: "Save & close", onclick: function () { saveDraft(); App.draft = null; go("diary"); } }),
    next);
  body.appendChild(foot);

  root.appendChild(stepper);
  root.appendChild(body);
}

/* Validity is re-checked on every keystroke, so Next comes alive
   the moment the last mandatory field is good — no clicking away
   first. The red outline and the reason only appear once the
   person has left the field, so nothing shouts at them mid-word. */
function wizRevalidate() {
  if (!App._wizNext || !App.draft) return;
  App._wizNext.disabled = Object.keys(stepErrors(App.draft, App.draft.step)).length > 0;
}

function wizField(label, obj, key, opts) {
  opts = opts || {};
  var node = h("input", { type: opts.type || "text", placeholder: opts.placeholder || "", inputmode: opts.inputmode || null });
  node.value = obj[key] == null ? "" : obj[key];
  var f = CMS.ui.field(label, node, { required: opts.required, hint: opts.hint });
  var errBox = h("small.err", { hidden: true });
  f.appendChild(errBox);
  function refresh(showErr) {
    var e = stepErrors(App.draft, App.draft.step)[key];
    if (e && showErr) { f.classList.add("invalid"); errBox.hidden = false; errBox.textContent = e; }
    else { f.classList.remove("invalid"); errBox.hidden = true; }
    wizRevalidate();
  }
  node.addEventListener("input", function () {
    obj[key] = node.value; saveDraft();
    if (opts.oninput) opts.oninput(node.value);
    refresh(false);
  });
  node.addEventListener("blur", function () { refresh(true); });
  if (opts.error && String(obj[key] || "").length) refresh(true);
  return f;
}

function stepCustomer(box, d, errs) {
  box.appendChild(h("h2", { text: "Who is the " + CMS.t("customer").toLowerCase() + "?" }));
  var search = h("input", { type: "search", placeholder: "Search name, mobile or registration…" });
  var results = h("div", { style: { marginBottom: "var(--gap)" } });
  search.addEventListener("input", function () {
    var q = search.value.trim().toLowerCase();
    CMS.ui.clear(results);
    if (q.length < 2) return;
    CMS.db().customers.filter(function (c) {
      var vs = CMS.db().vehicles.filter(function (v) { return v.customerId === c.id; }).map(function (v) { return v.reg; }).join(" ");
      return (c.name + " " + c.mobile + " " + (c.email || "") + " " + vs).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6).forEach(function (c) {
      results.appendChild(h("button.touch-item", { style: { marginBottom: "6px" }, onclick: function () {
        d.customer = { id: c.id, name: c.name, mobile: c.mobile, email: c.email || "", consent: c.consent || {} };
        var v = CMS.db().vehicles.filter(function (x) { return x.customerId === c.id; })[0];
        if (v) d.vehicle = { id: v.id, reg: v.reg, vin: v.vin || "", make: v.make, model: v.model, year: v.year, km: v.km };
        saveDraft(); render();
      } },
        h("div", h("strong", { text: c.name }), h("div.muted", { text: c.mobile + (c.type === "fleet" ? " · fleet account " + (c.account || "") : "") })),
        h("div.spacer"), h("span", { text: "Use ›" })));
    });
    if (!results.children.length) results.appendChild(h("p.muted", { text: "No match — capture them below as a new " + CMS.t("customer").toLowerCase() + "." }));
  });
  box.appendChild(CMS.ui.field("Find an existing " + CMS.t("customer").toLowerCase(), search));
  box.appendChild(results);
  if (d.customer.id) box.appendChild(h("p", CMS.ui.badge("Existing customer", "green"),
    h("button.btn.btn-sm.btn-ghost", { text: "Clear", onclick: function () { d.customer = newDraft().customer; saveDraft(); render(); } })));

  var g = h("div.grid-2");
  g.appendChild(wizField("Name", d.customer, "name", { required: true, error: errs.name }));
  g.appendChild(wizField("Mobile", d.customer, "mobile", { required: true, type: "tel", inputmode: "tel", error: errs.mobile, hint: "SMS and WhatsApp go to this number." }));
  g.appendChild(wizField("E-mail", d.customer, "email", { type: "email", error: errs.email }));
  box.appendChild(g);

  var con = h("div", h("h4", { text: "How may we contact them?" }));
  [["sms", "SMS"], ["whatsapp", "WhatsApp"], ["email", "E-mail"]].forEach(function (p) {
    var cb = h("input", { type: "checkbox" });
    cb.checked = !!(d.customer.consent || {})[p[0]];
    cb.addEventListener("change", function () { d.customer.consent = d.customer.consent || {}; d.customer.consent[p[0]] = cb.checked; saveDraft(); });
    con.appendChild(h("label.checkline", cb, h("span", { text: p[1] })));
  });
  con.appendChild(h("small.muted", { text: "Recorded against the customer for POPIA. Channels they have not consented to are not offered when you send an approval request." }));
  box.appendChild(con);
}

function stepVehicle(box, d, errs) {
  box.appendChild(h("h2", { text: "Which vehicle?" }));
  var g = h("div.grid-2");
  g.appendChild(wizField("Registration", d.vehicle, "reg", { required: true, error: errs.reg }));
  g.appendChild(wizField("VIN", d.vehicle, "vin", {
    error: errs.vin,
    hint: "Optional — but OEM service menus need a VIN that decodes.",
    oninput: function (v) {
      if (CMS.validVin(v)) {
        var r = CMS.decodeVin(v);
        if (r.ok) { d.vehicle.make = r.make; d.vehicle.model = r.model; d.vehicle.year = r.year; saveDraft(); render(); }
      }
    },
  }));
  g.appendChild(wizField("Make", d.vehicle, "make"));
  g.appendChild(wizField("Model", d.vehicle, "model"));
  g.appendChild(wizField("Year", d.vehicle, "year", { type: "number" }));
  g.appendChild(wizField("Odometer (km)", d.vehicle, "km", { type: "number" }));
  box.appendChild(g);
  if (CMS.validVin(d.vehicle.vin)) {
    box.appendChild(h("p", CMS.ui.badge("VIN decoded · Superservice menus available", "green")));
  } else if (CMS.feature("superserviceMenus")) {
    box.appendChild(h("p", CMS.ui.badge("No VIN — OEM menus will not load", "amber"),
      h("small.muted", { text: " You can still book generic work." })));
  }
  var prior = d.customer.id ? CMS.jobs().filter(function (j) { return j.customerId === d.customer.id; }) : [];
  if (prior.length) {
    var hist = h("div.card", { style: { marginTop: "var(--gap)" } }, h("h4", { text: "Previous visits" }));
    prior.slice(0, 5).forEach(function (j) {
      hist.appendChild(h("div.row", { style: { borderBottom: "1px solid var(--border)", padding: "6px 0" } },
        h("span.muted", { text: CMS.fmtDate(j.slot ? j.slot.date : j.createdAt) }),
        h("span", { text: (j.requested[0] || {}).title || "—" }), h("div.spacer"), CMS.ui.statusBadge(j.status)));
    });
    box.appendChild(hist);
  }
}

function stepWork(box, d, errs) {
  box.appendChild(h("h2", { text: "What are we doing?" }));
  var vinOk = CMS.validVin(d.vehicle.vin);
  var menus = CMS.cfg().menus;
  var menuBox = h("div.card", h("div.card-head", h("h3", { text: "Service menus" }), h("div.spacer"),
    CMS.ui.badge(vinOk ? "Priced from the VIN" : "Generic pricing — no VIN", vinOk ? "green" : "amber")));
  menus.forEach(function (m) {
    var on = d.work.menuIds.indexOf(m.id) >= 0;
    var price = CMS.round2(m.hours * CMS.labourRate(m.rateId) +
      (m.parts || []).reduce(function (a, p) { return a + CMS.partSell(p); }, 0));
    menuBox.appendChild(h("button.touch-item", {
      style: { marginBottom: "6px", borderLeftColor: on ? "var(--green)" : "var(--blue)" },
      onclick: function () {
        if (on) d.work.menuIds = d.work.menuIds.filter(function (x) { return x !== m.id; });
        else d.work.menuIds.push(m.id);
        saveDraft(); render();
      },
    },
      h("span.badge" + (on ? ".green" : ".blue"), { text: on ? "✓" : "＋" }),
      h("div", h("strong", { text: m.title }),
        h("div.muted", { text: m.code + " · " + m.hours + "h · " + (m.parts || []).length + " parts" })),
      h("div.spacer"),
      h("strong", { text: CMS.money(CMS.withVat(price)) })));
  });
  box.appendChild(menuBox);

  var own = h("div.card", h("h3", { text: "Customer's own words" }));
  var itemsBox = h("div");
  function paintItems() {
    CMS.ui.clear(itemsBox);
    d.work.items.forEach(function (it, i) {
      itemsBox.appendChild(h("div.row", { style: { borderBottom: "1px solid var(--border)", padding: "6px 0" } },
        h("div", h("strong", { text: it.title }), it.note ? h("div.muted", { text: it.note }) : null),
        h("div.spacer"),
        h("button.btn.btn-sm.btn-ghost", { text: "✕", onclick: function () { d.work.items.splice(i, 1); saveDraft(); paintItems(); } })));
    });
  }
  var ti = h("input", { type: "text", placeholder: "e.g. Judder under braking from 80km/h" });
  own.appendChild(CMS.ui.field("Add what the customer reported", ti,
    { hint: "Write it as they said it — the technician reads this first." }));
  own.appendChild(h("button.btn", { text: "Add", onclick: function () {
    if (!ti.value.trim()) return;
    d.work.items.push({ id: CMS.uid("rq"), title: ti.value.trim(), note: "" });
    ti.value = ""; saveDraft(); paintItems();
    if (errs.work) render();
  } }));
  own.appendChild(itemsBox);
  paintItems();
  box.appendChild(own);
  if (errs.work) box.appendChild(h("p.err", { style: { color: "var(--red)", fontWeight: "500" }, text: errs.work }));

  var note = h("textarea", { placeholder: "Anything the workshop should know — gate code, spare key, warranty claim…" });
  note.value = d.work.note || "";
  note.addEventListener("input", function () { d.work.note = note.value; saveDraft(); });
  box.appendChild(CMS.ui.field("Note for the workshop", note));
}

function stepSlot(box, d, errs) {
  box.appendChild(h("h2", { text: "When, and who owns it?" }));
  var cfg = CMS.cfg();
  var g = h("div.grid-2");

  var date = h("input", { type: "date", min: CMS.todayISO() });
  date.value = d.slot.date;
  date.addEventListener("change", function () { d.slot.date = date.value; saveDraft(); render(); });
  var dateField = CMS.ui.field("Date", date, { required: true });
  if (errs.date) { dateField.classList.add("invalid"); dateField.appendChild(h("small.err", { text: errs.date })); }
  g.appendChild(dateField);

  var slots = CMS.slotsForDay(d.slot.date);
  var timeSel = CMS.ui.select(slots.map(function (t) {
    var load = CMS.slotLoad(d.slot.date, t);
    return { value: t, label: t + (load ? "  (" + load + " booked)" : "  — free") };
  }), d.slot.start, { onchange: function (e) { d.slot.start = e.target.value; saveDraft(); render(); } });
  g.appendChild(CMS.ui.field("Time", timeSel));

  var dur = h("input", { type: "number", min: "15", step: "15" });
  dur.value = d.slot.durationMin;
  dur.addEventListener("input", function () { d.slot.durationMin = +dur.value; saveDraft(); });
  g.appendChild(CMS.ui.field("Expected duration (minutes)", dur));

  var advOpts = [{ value: "", label: "— choose —" }].concat(CMS.peopleByRole("advisor").map(function (p) { return { value: p.id, label: p.name }; }));
  var advSel = CMS.ui.select(advOpts, d.slot.advisorId, { onchange: function (e) { d.slot.advisorId = e.target.value; saveDraft(); render(); } });
  var advField = CMS.ui.field(CMS.t("advisor"), advSel, { required: true });
  if (errs.advisorId) { advField.classList.add("invalid"); advField.appendChild(h("small.err", { text: errs.advisorId })); }
  g.appendChild(advField);

  g.appendChild(CMS.ui.field(CMS.t("tech") + " (optional)", CMS.ui.select(
    [{ value: "", label: "Leave for the foreman" }].concat(CMS.peopleByRole("tech").map(function (p) { return { value: p.id, label: p.name }; })),
    d.slot.techId, { onchange: function (e) { d.slot.techId = e.target.value; saveDraft(); } })));
  g.appendChild(CMS.ui.field(CMS.t("bay") + " (optional)", CMS.ui.select(
    [{ value: "", label: "Unallocated" }].concat(cfg.bays.map(function (b) { return { value: b.id, label: b.name }; })),
    d.slot.bayId, { onchange: function (e) { d.slot.bayId = e.target.value; saveDraft(); } })));
  box.appendChild(g);

  var tOpts = cfg.transport.filter(function (t) { return !t.requires || CMS.feature(t.requires); });
  var tb = h("div.chipbar");
  tOpts.forEach(function (t) {
    tb.appendChild(h("button.chip", {
      "aria-pressed": String(d.slot.transport === t.id), text: t.label,
      title: t.note || "",
      onclick: function () { d.slot.transport = t.id; saveDraft(); render(); },
    }));
  });
  box.appendChild(CMS.ui.field("How does the customer get on with their day?", tb));

  var load = CMS.dayLoadHours(d.slot.date);
  var cap = cfg.diary.dailyCapacityHours;
  box.appendChild(h("div.card", h("div.meter-row",
    h("span", { text: "Workshop load " + CMS.fmtDay(d.slot.date) }),
    h("div.progress", h("i", { style: { width: Math.min(100, load / cap * 100) + "%", background: load > cap ? "var(--red)" : "var(--turquoise)" } })),
    h("strong", { text: load + "h / " + cap + "h" }))));
  if (load > cap) box.appendChild(h("p", CMS.ui.badge("Over capacity — check with the foreman", "amber")));
}

function stepConfirm(box, d) {
  box.appendChild(h("h2", { text: "Check and confirm" }));
  var menus = CMS.cfg().menus.filter(function (m) { return d.work.menuIds.indexOf(m.id) >= 0; });
  var est = menus.reduce(function (a, m) {
    return a + m.hours * CMS.labourRate(m.rateId) + (m.parts || []).reduce(function (b, p) { return b + CMS.partSell(p); }, 0);
  }, 0);
  var adv = CMS.person(d.slot.advisorId);
  var rows = [
    [CMS.t("customer"), d.customer.name + " · " + d.customer.mobile],
    ["Vehicle", d.vehicle.reg + " · " + [d.vehicle.make, d.vehicle.model, d.vehicle.year].filter(Boolean).join(" ")],
    ["When", CMS.fmtDay(d.slot.date) + " at " + d.slot.start + " (" + d.slot.durationMin + " min)"],
    [CMS.t("advisor"), adv ? adv.name : "—"],
    ["Transport", (CMS.cfg().transport.filter(function (t) { return t.id === d.slot.transport; })[0] || {}).label || "—"],
    ["Work", menus.map(function (m) { return m.title; }).concat(d.work.items.map(function (i) { return i.title; })).join(" · ") || "—"],
  ];
  var tbl = h("table.data");
  var tb = h("tbody");
  rows.forEach(function (r) { tb.appendChild(h("tr", h("td", h("strong", { text: r[0] })), h("td", { text: r[1] }))); });
  tbl.appendChild(tb);
  box.appendChild(h("div.table-wrap", tbl));
  box.appendChild(h("div.kpis", { style: { marginTop: "var(--gap)" } },
    CMS.ui.kpi("Estimate (incl VAT)", CMS.money(CMS.withVat(est)), "menu work only — health-check findings are quoted later")));

  var sendCb = h("input", { type: "checkbox" }); sendCb.checked = true;
  d.sendConfirm = true;
  sendCb.addEventListener("change", function () { d.sendConfirm = sendCb.checked; });
  box.appendChild(h("label.checkline", sendCb,
    h("span", { text: "Send the confirmation and tracking link to " + d.customer.mobile })));
}

function commitBooking(d) {
  var cust = CMS.upsertCustomer({
    id: d.customer.id || undefined, name: d.customer.name, mobile: d.customer.mobile,
    email: d.customer.email, consent: d.customer.consent, type: "retail",
  });
  var veh = CMS.upsertVehicle({
    id: d.vehicle.id || undefined, customerId: cust.id, reg: d.vehicle.reg, vin: d.vehicle.vin,
    make: d.vehicle.make, model: d.vehicle.model, year: +d.vehicle.year || null, km: +d.vehicle.km || null,
  });
  var job = CMS.createJob({
    customerId: cust.id, vehicleId: veh.id, advisorId: d.slot.advisorId,
    techId: d.slot.techId || null, bayId: d.slot.bayId || null,
    slot: { date: d.slot.date, start: d.slot.start, durationMin: d.slot.durationMin },
    transport: d.slot.transport, odometer: +d.vehicle.km || null,
    requested: CMS.cfg().menus.filter(function (m) { return d.work.menuIds.indexOf(m.id) >= 0; })
      .map(function (m) { return { id: CMS.uid("rq"), title: m.title, note: "", menuId: m.id }; })
      .concat(d.work.items),
    workshopNote: d.work.note, createdBy: App.user.id,
  });
  d.work.menuIds.forEach(function (id) { CMS.applyMenu(job.id, id, App.user.id); });
  if (CMS.cfg().integrations.evolve.enabled && CMS.cfg().integrations.evolve.postOnOpen) {
    CMS.postToEvolve(job.id, "jobcard", App.user.id);
  }
  if (d.sendConfirm !== false) {
    CMS.updateJob(job.id, function (j) {
      var body = CMS.renderTemplate(CMS.cfg().messages.booking_confirm.whatsapp, j);
      j.auth.sent = j.auth.sent || [];
      j.auth.sent.unshift({ id: CMS.uid("msg"), channel: "whatsapp", to: cust.mobile, at: CMS.nowISO(), status: "delivered", body: body, kind: "booking_confirm" });
      CMS.log(j, "Booking confirmation sent to " + cust.mobile, App.user.id);
    });
  }
  dropDraft(d.id);
  App.draft = null; App.draftSlot = null;
  CMS.ui.toast(job.ref + " booked for " + CMS.fmtDay(job.slot.date) + " " + job.slot.start, "ok");
  go("jobs");
  setTimeout(function () { openJob(job.id); }, 60);
}

/* ============================================================
   Job cards
   ============================================================ */
function viewJobs(root) {
  var f = App.jobFilter;
  var bar = h("div.card", h("div.card-head",
    h("input", { type: "search", placeholder: "Filter…", value: f.q, style: { maxWidth: "220px" },
      oninput: function (e) { f.q = e.target.value; paint(); } }),
    CMS.ui.select([{ value: "", label: "All statuses" }].concat(CMS.cfg().statuses.map(function (s) { return { value: s.id, label: s.label }; })),
      f.status, { style: "max-width:200px", onchange: function (e) { f.status = e.target.value; paint(); } }),
    CMS.ui.select([{ value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }, { value: "week", label: "This week" }, { value: "open", label: "All open" }, { value: "all", label: "Everything" }],
      f.when, { style: "max-width:170px", onchange: function (e) { f.when = e.target.value; paint(); } }),
    CMS.ui.select([{ value: "", label: "Any " + CMS.t("advisor").toLowerCase() }].concat(CMS.peopleByRole("advisor").map(function (p) { return { value: p.id, label: p.name }; })),
      f.advisor, { style: "max-width:200px", onchange: function (e) { f.advisor = e.target.value; paint(); } }),
    h("div.spacer"),
    h("button.btn.btn-ghost", { text: "Export CSV", onclick: exportJobsCsv })));
  root.appendChild(bar);
  var list = h("div.card.flush");
  root.appendChild(list);
  paint();

  function paint() {
    CMS.ui.clear(list);
    var rows = filteredJobs();
    if (!rows.length) { list.appendChild(CMS.ui.empty("▣", "No " + CMS.t("jobs").toLowerCase() + " match that filter.")); return; }
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr",
      h("th", { text: CMS.t("ro") }), h("th", { text: "Vehicle" }), h("th", { text: CMS.t("customer") }),
      h("th", { text: "In" }), h("th", { text: CMS.t("advisor") }), h("th", { text: CMS.t("vhc") }),
      h("th.num", { text: "Value" }), h("th", { text: "Status" }))));
    var tb = h("tbody");
    rows.forEach(function (j) {
      var t = CMS.totals(j.lines, "billable");
      var s = CMS.vhcSummary(j);
      tb.appendChild(h("tr.clickable", { onclick: function () { openJob(j.id); } },
        h("td", h("strong", { text: j.ref })),
        h("td", { text: CMS.ui.vehLabel(j) }),
        h("td", { text: CMS.ui.custName(j) }),
        h("td", { text: j.slot ? CMS.fmtDay(j.slot.date) + " " + j.slot.start : "—" }),
        h("td", { text: (CMS.person(j.advisorId) || {}).initials || "—" }),
        h("td", j.vhc ? h("span.row", CMS.ui.rag("r"), h("small", { text: String(s.r) }), CMS.ui.rag("a"), h("small", { text: String(s.a) })) : h("span.muted", { text: "—" })),
        h("td.num", { text: CMS.money(t.gross) }),
        h("td", CMS.ui.statusBadge(j.status))));
    });
    tbl.appendChild(tb);
    list.appendChild(h("div.table-wrap", tbl));
    list.appendChild(h("div", { style: { padding: "10px var(--pad)" } },
      h("small.muted", { text: rows.length + " " + CMS.t("jobs").toLowerCase() + " · " + CMS.money(rows.reduce(function (a, j) { return a + CMS.totals(j.lines, "billable").gross; }, 0)) + " on the board" })));
  }
}

function filteredJobs() {
  var f = App.jobFilter, today = CMS.workingDate();
  var week = new Date(Date.now() + 6 * 86400e3).toISOString().slice(0, 10);
  return CMS.jobs().filter(function (j) {
    var date = (j.slot && j.slot.date) || j.createdAt.slice(0, 10);
    if (f.when === "today" && date !== today) return false;
    if (f.when === "tomorrow" && date !== CMS.nextOpenDay(shiftDate(today, 1), 1)) return false;
    if (f.when === "week" && (date < today || date > week)) return false;
    if (f.when === "open" && ["collected", "invoiced"].indexOf(j.status) >= 0) return false;
    if (f.status && j.status !== f.status) return false;
    if (f.advisor && j.advisorId !== f.advisor) return false;
    if (f.q) {
      var v = CMS.vehicle(j.vehicleId) || {}, c = CMS.customer(j.customerId) || {};
      if ([j.ref, v.reg, v.vin, c.name, c.mobile].join(" ").toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
    }
    return true;
  }).sort(function (a, b) {
    var ad = (a.slot && a.slot.date + a.slot.start) || a.createdAt;
    var bd = (b.slot && b.slot.date + b.slot.start) || b.createdAt;
    return ad < bd ? -1 : 1;
  });
}

function exportJobsCsv() {
  var rows = [["Ref", "Date", "Time", "Reg", "Customer", "Advisor", "Status", "Labour hours", "Value incl VAT", "VHC red", "VHC amber"]];
  filteredJobs().forEach(function (j) {
    var t = CMS.totals(j.lines, "billable"), s = CMS.vhcSummary(j);
    rows.push([j.ref, j.slot ? j.slot.date : "", j.slot ? j.slot.start : "", (CMS.vehicle(j.vehicleId) || {}).reg || "",
      CMS.ui.custName(j), (CMS.person(j.advisorId) || {}).name || "", CMS.status(j.status).label,
      t.labourHours, t.gross, s.r, s.a]);
  });
  CMS.ui.download("cms-jobs-" + CMS.todayISO() + ".csv",
    rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n"),
    "text/csv");
  CMS.ui.toast("CSV downloaded", "ok");
}

/* ============================================================
   The job card itself
   ============================================================ */
var jobTab = "overview";

function openJob(id, tab) {
  jobTab = tab || "overview";
  paintJob(id);
}

function paintJob(id) {
  var j = CMS.job(id);
  if (!j) return CMS.ui.toast("That " + CMS.t("job").toLowerCase() + " is gone", "err");
  var body = h("div");
  var tabs = [
    { id: "overview", label: "Overview" },
    { id: "work", label: "Work & " + CMS.t("quote").toLowerCase() },
  ];
  if (CMS.feature("vhc")) tabs.push({ id: "vhc", label: CMS.t("vhc") });
  tabs.push({ id: "auth", label: CMS.t("auth") });
  if (CMS.feature("partsCatalogue")) tabs.push({ id: "parts", label: "Parts" });
  tabs.push({ id: "financial", label: "Financial" });
  tabs.push({ id: "timeline", label: "History" });

  body.appendChild(jobHeader(j));
  body.appendChild(CMS.ui.tabs(tabs, jobTab, function (t) { jobTab = t; paintJob(id); }));
  var pane = h("div");
  ({
    overview: jobOverview, work: jobWork, vhc: jobVhc, auth: jobAuth,
    parts: jobParts, financial: jobFinancial, timeline: jobTimeline,
  })[jobTab](pane, j);
  body.appendChild(pane);

  CMS.ui.drawer(j.ref + " · " + CMS.ui.vehLabel(j), body, [
    h("button.btn.btn-sm", { text: "Print", onclick: function () { window.print(); } }),
  ]);
}
function refreshJob(id) { paintJob(id); }

function jobHeader(j) {
  var cust = CMS.customer(j.customerId) || {};
  var veh = CMS.vehicle(j.vehicleId) || {};
  var t = CMS.totals(j.lines, "billable");
  var statusSel = CMS.ui.select(CMS.cfg().statuses.map(function (s) { return { value: s.id, label: s.label }; }), j.status, {
    style: "max-width:200px",
    onchange: function (e) { CMS.setStatus(j.id, e.target.value, App.user.id); refreshJob(j.id); render(); },
  });
  return h("div.card",
    h("div.row",
      h("div", h("h3", { style: { margin: 0 }, text: veh.reg || "—" }),
        h("div.muted", { text: [veh.make, veh.model, veh.year].filter(Boolean).join(" ") + (veh.vin ? " · " + veh.vin : "") })),
      h("div.spacer"),
      h("div", { style: { textAlign: "right" } },
        h("strong", { style: { fontSize: "1.2rem" }, text: CMS.money(t.gross) }),
        h("div.muted", { text: t.labourHours + "h labour · " + t.count + " lines" }))),
    h("hr"),
    h("div.grid-3",
      h("div", h("small.muted", { text: CMS.t("customer") }), h("div", { text: cust.name || "—" }),
        h("div.muted", { text: cust.mobile || "" })),
      h("div", h("small.muted", { text: CMS.t("advisor") + " / " + CMS.t("tech") }),
        h("div", { text: (CMS.person(j.advisorId) || {}).name || "—" }),
        h("div.muted", { text: (CMS.person(j.techId) || {}).name || "Not allocated" })),
      h("div", h("small.muted", { text: "Booked" }),
        h("div", { text: j.slot ? CMS.fmtDay(j.slot.date) + " " + j.slot.start : "—" }),
        h("div.muted", { text: (CMS.cfg().transport.filter(function (x) { return x.id === j.transport; })[0] || {}).label || "" }))),
    h("div.row", { style: { marginTop: "var(--gap-sm)" } },
      h("label.muted", { text: "Status" }), statusSel,
      h("div.spacer"),
      CMS.feature("customerTracking") ? h("button.btn.btn-sm", {
        text: "Customer link", title: "Open what the customer sees",
        onclick: function () { window.open(CMS.customerLink(j), "_blank"); },
      }) : null,
      h("button.btn.btn-sm.btn-ghost", { text: "Copy link", onclick: function () {
        var link = CMS.customerLink(j);
        CMS.ui.copy(link);
        /* Opened by double-clicking the file, the link is a path on
           this machine and will not open on anybody's phone. */
        if (link.indexOf("file:") === 0) {
          CMS.ui.toast("That link only works on this machine — serve the folder over the network to send it to a phone", "warn", 6000);
        }
      } })));
}

function jobOverview(pane, j) {
  var req = h("div.card", h("h3", { text: "What was asked for" }));
  (j.requested || []).forEach(function (r) {
    req.appendChild(h("div", { style: { borderBottom: "1px solid var(--border)", padding: "7px 0" } },
      h("strong", { text: r.title }), r.note ? h("div.muted", { text: r.note }) : null));
  });
  if (!(j.requested || []).length) req.appendChild(h("p.muted", { text: "Nothing captured." }));
  if (j.workshopNote) req.appendChild(h("p", CMS.ui.badge("Note for the workshop", "amber"), h("span", { text: " " + j.workshopNote })));
  pane.appendChild(req);

  var s = CMS.vhcSummary(j);
  pane.appendChild(h("div.kpis",
    CMS.ui.kpi("Clocked", (CMS.clockedMinutes(j) / 60).toFixed(1) + "h", (CMS.person(j.techId) || {}).name || ""),
    CMS.ui.kpi(CMS.t("vhc"), j.vhc ? (s.done + "/" + s.total) : "not started", j.vhc ? s.r + " red · " + s.a + " amber" : ""),
    CMS.ui.kpi("Awaiting approval", CMS.money(CMS.totals(j.lines, "pending").gross), CMS.totals(j.lines, "pending").count + " items"),
    CMS.ui.kpi("Approved extra", CMS.money(CMS.totals(j.lines, "approved").gross), "")));

  var notes = h("div.card", h("h3", { text: "Notes" }));
  (j.notes || []).forEach(function (n) {
    notes.appendChild(h("div", { style: { borderBottom: "1px solid var(--border)", padding: "7px 0" } },
      h("div", { text: n.text }),
      h("small.muted", { text: ((CMS.person(n.by) || {}).name || n.by) + " · " + CMS.relTime(n.at) })));
  });
  var ta = h("textarea", { placeholder: "Add a note…" });
  notes.appendChild(CMS.ui.field("", ta));
  notes.appendChild(h("button.btn", { text: "Add note", onclick: function () {
    if (!ta.value.trim()) return;
    CMS.updateJob(j.id, function (jj) { (jj.notes = jj.notes || []).unshift({ at: CMS.nowISO(), by: App.user.id, text: ta.value.trim() }); });
    refreshJob(j.id);
  } }));
  pane.appendChild(notes);
}

/* ---------- work & quote ---------- */
function jobWork(pane, j) {
  var groups = [
    { key: "not_required", label: "On the original booking", tone: "blue" },
    { key: "pending", label: "Waiting on the customer", tone: "amber" },
    { key: "approved", label: "Approved extra work", tone: "green" },
    { key: "declined", label: "Declined", tone: "grey" },
  ];
  groups.forEach(function (g) {
    var lines = j.lines.filter(function (l) { return l.authStatus === g.key; });
    if (!lines.length) return;
    var card = h("div.card.flush", h("div.card-head", h("h3", { text: g.label }), h("div.spacer"),
      CMS.ui.badge(CMS.money(CMS.totals(lines).gross), g.tone)));
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr", h("th", { text: "Code" }), h("th", { text: "Description" }),
      h("th.num", { text: "Qty / hrs" }), h("th.num", { text: "Unit" }), h("th.num", { text: "Net" }), h("th", { text: "" }))));
    var tb = h("tbody");
    lines.forEach(function (l) {
      tb.appendChild(h("tr",
        h("td", h("small", { text: l.code || "—" })),
        h("td", h("div", { text: l.title }),
          l.source === "evhc" ? h("small.muted", { text: "From the health check" }) : null,
          l.why ? h("small.muted", { text: l.why }) : null),
        h("td.num", { text: l.kind === "labour" ? (l.hours + "h") : String(l.qty) }),
        h("td.num", { text: CMS.money(l.kind === "labour" ? l.rate : l.unitPrice) }),
        h("td.num", { text: CMS.money(CMS.lineNet(l)) }),
        h("td", h("button.btn.btn-sm.btn-ghost", { text: "✕", title: "Remove", onclick: function () {
          CMS.removeLine(j.id, l.id, App.user.id); refreshJob(j.id);
        } }))));
    });
    tbl.appendChild(tb);
    card.appendChild(h("div.table-wrap", tbl));
    pane.appendChild(card);
  });

  var t = CMS.totals(j.lines, "billable");
  pane.appendChild(h("div.card",
    h("h3", { text: "Totals" }),
    totalsTable(t)));

  var add = h("div.card", h("h3", { text: "Add work" }));
  add.appendChild(h("div.btn-row",
    h("button.btn", { text: "＋ Service menu", onclick: function () { pickMenu(j); } }),
    h("button.btn", { text: "＋ Labour line", onclick: function () { addLabourDialog(j); } }),
    CMS.feature("partsCatalogue") ? h("button.btn", { text: "＋ Part", onclick: function () { addPartDialog(j); } }) : null));
  pane.appendChild(add);
}

function totalsTable(t) {
  var tbl = h("table.data");
  var tb = h("tbody");
  [["Labour and parts (excl VAT)", t.net], ["Sundries", t.sundries], ["VAT @ " + CMS.cfg().money.vatRate + "%", t.vat]]
    .forEach(function (r) { tb.appendChild(h("tr", h("td", { text: r[0] }), h("td.num", { text: CMS.money(r[1]) }))); });
  tb.appendChild(h("tr", h("td", h("strong", { text: "Total including VAT" })), h("td.num", h("strong", { text: CMS.money(t.gross) }))));
  tbl.appendChild(tb);
  return h("div.table-wrap", tbl);
}

function pickMenu(j) {
  var needAuth = h("input", { type: "checkbox" });
  var box = h("div");
  box.appendChild(h("label.checkline", needAuth, h("span", { text: "Send to the customer for approval before we start" })));
  CMS.cfg().menus.forEach(function (m) {
    var price = CMS.withVat(m.hours * CMS.labourRate(m.rateId) + (m.parts || []).reduce(function (a, p) { return a + CMS.partSell(p); }, 0));
    box.appendChild(h("button.touch-item", { style: { marginBottom: "6px" }, onclick: function () {
      CMS.applyMenu(j.id, m.id, App.user.id, { needsAuth: needAuth.checked });
      CMS.ui.closeOverlays(); refreshJob(j.id); CMS.ui.toast(m.title + " added", "ok");
    } },
      h("div", h("strong", { text: m.title }), h("div.muted", { text: m.code + " · " + m.hours + "h" })),
      h("div.spacer"), h("strong", { text: CMS.money(price) })));
  });
  CMS.ui.modal("Add a service menu", box, [h("button.btn", { text: "Close", onclick: CMS.ui.closeOverlays })]);
}

function addLabourDialog(j) {
  var title = h("input", { type: "text", placeholder: "Description" });
  var hours = h("input", { type: "number", step: "0.1", value: "1" });
  var rate = CMS.ui.select(CMS.cfg().money.labourRates.map(function (r) { return { value: r.id, label: r.label + " — " + CMS.money(r.rate) + "/h" }; }), CMS.cfg().money.defaultLabourRateId);
  var auth = h("input", { type: "checkbox" });
  var why = h("textarea", { placeholder: "Why does it need doing? The customer reads this on the link." });
  CMS.ui.modal("Add labour", h("div",
    CMS.ui.field("Description", title, { required: true }),
    h("div.grid-2", CMS.ui.field("Hours", hours), CMS.ui.field("Rate", rate)),
    h("label.checkline", auth, h("span", { text: "Needs customer approval" })),
    CMS.ui.field("Reason", why)), [
    h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", { text: "Add", onclick: function () {
      if (!title.value.trim()) return CMS.ui.toast("Give it a description", "warn");
      CMS.addLine(j.id, {
        kind: "labour", title: title.value.trim(), hours: +hours.value || 0,
        rateId: rate.value, rate: CMS.labourRate(rate.value), why: why.value.trim(),
        authStatus: auth.checked ? "pending" : "not_required", source: "manual",
      }, App.user.id);
      CMS.ui.closeOverlays(); refreshJob(j.id);
    } })]);
}

function addPartDialog(j) {
  var search = h("input", { type: "search", placeholder: "Part number or description…" });
  var results = h("div");
  var auth = h("input", { type: "checkbox" });
  function paint() {
    CMS.ui.clear(results);
    var q = search.value.trim().toLowerCase();
    CMS.cfg().parts.filter(function (p) {
      return !q || (p.no + " " + p.desc).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 12).forEach(function (p) {
      var sup = p.supersededBy ? CMS.part(p.supersededBy) : null;
      results.appendChild(h("button.touch-item", { style: { marginBottom: "6px" }, onclick: function () {
        var use = sup || p;
        CMS.addLine(j.id, {
          kind: "part", code: use.no, title: use.desc, qty: 1, cost: use.cost,
          unitPrice: CMS.partSell(use.no), source: "catalogue",
          authStatus: auth.checked ? "pending" : "not_required",
        }, App.user.id);
        CMS.ui.closeOverlays(); refreshJob(j.id);
        if (sup) CMS.ui.toast(p.no + " is superseded — " + sup.no + " added instead", "warn");
      } },
        h("div", h("strong", { text: p.no }), h("div.muted", { text: p.desc }),
          sup ? h("small", CMS.ui.badge("superseded by " + sup.no, "amber")) : null,
          h("small.muted", { text: "In stock: " + p.qty + " · bin " + p.bin })),
        h("div.spacer"),
        h("div", { style: { textAlign: "right" } },
          h("strong", { text: CMS.money(CMS.partSell(p.no)) }),
          h("div.muted", { text: "cost " + CMS.money(p.cost) + " +" + CMS.markupPct(p.cost) + "%" }))));
    });
  }
  search.addEventListener("input", paint);
  paint();
  CMS.ui.modal("Add a part", h("div",
    CMS.ui.field("Search the price file", search),
    h("label.checkline", auth, h("span", { text: "Needs customer approval" })),
    results), [h("button.btn", { text: "Close", onclick: CMS.ui.closeOverlays })]);
}

/* ---------- eVHC ---------- */
function jobVhc(pane, j) {
  if (!j.vhc) {
    var sel = CMS.ui.select(CMS.cfg().vhcTemplates.map(function (t) { return { value: t.id, label: t.name }; }),
      (CMS.cfg().vhcTemplates.filter(function (t) { return t.default; })[0] || {}).id);
    pane.appendChild(h("div.card",
      h("h3", { text: "No health check yet" }),
      h("p.muted", { text: "The technician normally starts this on the tablet. You can open one here and it appears on their app immediately." }),
      CMS.ui.field("Template", sel),
      h("button.btn.btn-primary", { text: "Start " + CMS.t("vhc"), onclick: function () {
        CMS.startVhc(j.id, sel.value, j.techId || App.user.id); refreshJob(j.id);
      } })));
    return;
  }
  var s = CMS.vhcSummary(j);
  pane.appendChild(h("div.card",
    h("div.card-head", h("h3", { text: j.vhc.templateName }), h("div.spacer"),
      CMS.ui.badge(j.vhc.completedAt ? "Completed " + CMS.relTime(j.vhc.completedAt) : "In progress", j.vhc.completedAt ? "green" : "amber")),
    h("div.kpis",
      CMS.ui.kpi("Red", s.r, "needs attention now", s.r > 0),
      CMS.ui.kpi("Amber", s.a, "advisory"),
      CMS.ui.kpi("Green", s.g, "fine"),
      CMS.ui.kpi("Checked", s.done + "/" + s.total, s.missingPhotos ? s.missingPhotos + " missing photos" : "")),
    h("p.muted", { text: "By " + ((CMS.person(j.vhc.techId) || {}).name || "—") + ", started " + CMS.relTime(j.vhc.startedAt) })));

  var byGroup = {};
  j.vhc.items.forEach(function (it) { (byGroup[it.group] = byGroup[it.group] || []).push(it); });
  Object.keys(byGroup).forEach(function (g) {
    var card = h("div.card", h("h4", { text: g }));
    byGroup[g].forEach(function (it) {
      var row = h("div", { style: { borderBottom: "1px solid var(--border)", padding: "8px 0" } },
        h("div.row", CMS.ui.rag(it.rag), h("strong", { text: it.label }),
          it.value ? CMS.ui.badge(it.value + (it.unit || ""), it.rag === "r" ? "red" : it.rag === "a" ? "amber" : "green") : null,
          h("div.spacer"),
          (it.rag === "r" || it.rag === "a") ? h("button.btn.btn-sm", { text: "Quote it", onclick: function () { quoteFromVhc(j, it); } }) : null),
        it.note ? h("div.muted", { text: it.note }) : null);
      if ((it.photos || []).length) {
        var ph = h("div.photos");
        it.photos.forEach(function (p) { ph.appendChild(h("figure", h("img", { src: p, alt: it.label }))); });
        row.appendChild(ph);
      } else if (it.rag && (j.vhc.requirePhotoOn || []).indexOf(it.rag) >= 0) {
        row.appendChild(h("small", CMS.ui.badge("photo required but missing", "amber")));
      }
      card.appendChild(row);
    });
    pane.appendChild(card);
  });
}

function quoteFromVhc(j, item) {
  var title = h("input", { type: "text", value: "Attend to: " + item.label });
  var hours = h("input", { type: "number", step: "0.1", value: "0.5" });
  var why = h("textarea");
  why.value = item.note || (item.value ? item.label + " measured " + item.value + (item.unit || "") + "." : "");
  var partSel = CMS.ui.select([{ value: "", label: "— no part —" }].concat(CMS.cfg().parts.map(function (p) {
    return { value: p.no, label: p.no + " · " + p.desc + " · " + CMS.money(CMS.partSell(p.no)) };
  })), "");
  CMS.ui.modal("Quote this finding", h("div",
    h("p", CMS.ui.rag(item.rag), h("strong", { text: " " + item.label })),
    CMS.ui.field("Work", title),
    h("div.grid-2", CMS.ui.field("Hours", hours), CMS.ui.field("Part", partSel)),
    CMS.ui.field("Why — the customer reads this", why)), [
    h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", { text: "Add for approval", onclick: function () {
      CMS.addLine(j.id, {
        kind: "labour", title: title.value, hours: +hours.value || 0,
        rateId: CMS.cfg().money.defaultLabourRateId, rate: CMS.labourRate(),
        why: why.value, source: "evhc", evhcItem: item.id, authStatus: "pending",
      }, App.user.id);
      if (partSel.value) {
        var p = CMS.part(partSel.value);
        CMS.addLine(j.id, { kind: "part", code: p.no, title: p.desc, qty: 1, cost: p.cost,
          unitPrice: CMS.partSell(p.no), source: "evhc", evhcItem: item.id, authStatus: "pending" }, App.user.id);
      }
      CMS.ui.closeOverlays(); jobTab = "auth"; refreshJob(j.id);
    } })]);
}

/* ---------- authorisation ---------- */
function jobAuth(pane, j) {
  var pending = j.lines.filter(function (l) { return l.authStatus === "pending"; });
  var t = CMS.totals(pending);
  var cust = CMS.customer(j.customerId) || {};
  var pol = CMS.cfg().authorisation;

  pane.appendChild(h("div.card",
    h("div.card-head", h("h3", { text: "To be approved" }), h("div.spacer"), h("strong", { text: CMS.money(t.gross) })),
    pending.length
      ? h("div", pending.map(function (l) {
          return h("div", { style: { borderBottom: "1px solid var(--border)", padding: "7px 0" } },
            h("div.row", h("strong", { text: l.title }), h("div.spacer"), h("span", { text: CMS.money(CMS.withVat(CMS.lineNet(l))) })),
            l.why ? h("div.muted", { text: l.why }) : null);
        }))
      : CMS.ui.empty("✍", "Nothing is waiting for a decision. Quote a health-check finding to build a request.")));

  if (pending.length) {
    var channels = pol.channels.filter(function (c) {
      var consent = cust.consent || {};
      return consent[c] !== false;
    });
    var chWrap = h("div.chipbar");
    var channel = pol.defaultChannel;
    channels.forEach(function (c) {
      chWrap.appendChild(h("button.chip", { "aria-pressed": String(c === channel), text: c === "sms" ? "SMS" : c === "email" ? "E-mail" : "WhatsApp",
        onclick: function () { channel = c; [].forEach.call(chWrap.children, function (n) { n.setAttribute("aria-pressed", String(n.textContent.toLowerCase().indexOf(c === "email" ? "mail" : c) >= 0)); }); preview(); } }));
    });
    var pv = h("pre", { style: { whiteSpace: "pre-wrap", background: "var(--surface-sunken)", padding: "12px", borderRadius: "6px", fontSize: ".85rem" } });
    function preview() { pv.textContent = CMS.renderTemplate((CMS.cfg().messages.auth_request || {})[channel] || "", j); }
    preview();

    var send = h("div.card",
      h("h3", { text: "Send the request" }),
      CMS.ui.field("Channel", chWrap, { hint: "Only channels the customer consented to are shown." }),
      CMS.ui.field("What they receive", pv),
      h("div.btn-row",
        h("button.btn.btn-primary", { text: "Send", onclick: function () {
          var entry = CMS.sendAuth(j.id, channel, App.user.id);
          CMS.ui.toast(entry.status === "failed" ? entry.reason : "Sent by " + channel, entry.status === "failed" ? "err" : "ok");
          refreshJob(j.id); render();
        } }),
        CMS.feature("phoneAuthFallback") && pol.otpRequired
          ? h("button.btn", { text: "Authorised by telephone", onclick: function () { phoneAuthDialog(j); } })
          : null,
        h("button.btn.btn-ghost", { text: "Open as the customer", onclick: function () { window.open(CMS.customerLink(j), "_blank"); } })));
    pane.appendChild(send);
  }

  if (j.auth && j.auth.signedAt) {
    pane.appendChild(h("div.card",
      h("h3", { text: "Signed" }),
      h("p", { text: j.auth.signedName + " · " + CMS.fmtDateTime(j.auth.signedAt) + (j.auth.method === "phone" ? " (telephone)" : "") }),
      j.auth.signature ? h("img", { src: j.auth.signature, alt: "Signature", style: { maxWidth: "280px", border: "1px solid var(--border)", borderRadius: "6px", background: "#fff" } }) : null));
  }

  var log = h("div.card.flush", h("div.card-head", h("h3", { text: "Send log" })));
  if (!(j.auth && (j.auth.sent || []).length)) log.appendChild(h("div", { style: { padding: "var(--pad)" } }, h("p.muted", { text: "Nothing sent yet." })));
  else {
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr", h("th", { text: "When" }), h("th", { text: "Channel" }), h("th", { text: "To" }), h("th", { text: "Status" }))));
    var tb = h("tbody");
    j.auth.sent.forEach(function (m) {
      tb.appendChild(h("tr.clickable", { onclick: function () { CMS.ui.prompt("Message sent", m.body || ""); } },
        h("td", { text: CMS.fmtDateTime(m.at) }), h("td", { text: m.channel }), h("td", { text: m.to || "—" }),
        h("td", CMS.ui.badge(m.status + (m.reason ? " — " + m.reason : ""),
          m.status === "delivered" ? "green" : m.status === "failed" ? "red" : "amber"))));
    });
    tbl.appendChild(tb);
    log.appendChild(h("div.table-wrap", tbl));
  }
  pane.appendChild(log);
}

function phoneAuthDialog(j) {
  var who = h("input", { type: "text", placeholder: "Who did you speak to?" });
  who.value = (CMS.customer(j.customerId) || {}).name || "";
  var note = h("textarea", { placeholder: "What was agreed, and at what time." });
  note.value = "Phoned at " + CMS.fmtTime(CMS.nowISO()) + " — verbal approval for all pending items.";
  CMS.ui.modal("Telephone authorisation", h("div",
    h("p.muted", { text: "Use this when messaging is down or the customer cannot open the link. The call is recorded on the job card in place of a signature." }),
    CMS.ui.field("Spoke to", who, { required: true }),
    CMS.ui.field("Record of the call", note, { required: true })), [
    h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", { text: "Record approval", onclick: function () {
      CMS.authoriseByPhone(j.id, App.user.id, who.value + " — " + note.value);
      CMS.ui.closeOverlays(); refreshJob(j.id); render();
      CMS.ui.toast("Recorded as authorised by telephone", "ok");
    } })]);
}

/* ---------- parts on the job ---------- */
function jobParts(pane, j) {
  var reqs = j.partsRequests || [];
  var card = h("div.card", h("h3", { text: "Requests from the workshop" }));
  if (!reqs.length) card.appendChild(h("p.muted", { text: "No parts requested on this " + CMS.t("job").toLowerCase() + "." }));
  reqs.forEach(function (r) {
    card.appendChild(h("div", { style: { borderBottom: "1px solid var(--border)", padding: "9px 0" } },
      h("div.row", CMS.ui.badge(r.status, r.status === "issued" ? "green" : r.status === "backorder" ? "red" : "amber"),
        h("span", { text: r.items.map(function (i) { return i.qty + "× " + i.no; }).join(", ") }),
        h("div.spacer"), h("small.muted", { text: CMS.relTime(r.at) })),
      r.note ? h("div.muted", { text: r.note }) : null,
      r.status === "requested" && (CMS.can(App.user, "pick_parts") || CMS.can(App.user, "*"))
        ? h("div.btn-row", { style: { marginTop: "6px" } },
            h("button.btn.btn-sm.btn-primary", { text: "Issue", onclick: function () { CMS.fulfilParts(j.id, r.id, "issued", App.user.id); refreshJob(j.id); render(); } }),
            h("button.btn.btn-sm", { text: "Backorder", onclick: function () { CMS.fulfilParts(j.id, r.id, "backorder", App.user.id); refreshJob(j.id); render(); } }))
        : null));
  });
  pane.appendChild(card);

  var onJob = j.lines.filter(function (l) { return l.kind === "part"; });
  var pc = h("div.card.flush", h("div.card-head", h("h3", { text: "Parts on the " + CMS.t("job").toLowerCase() })));
  var tbl = h("table.data");
  tbl.appendChild(h("thead", h("tr", h("th", { text: "Part" }), h("th", { text: "Description" }), h("th.num", { text: "Qty" }),
    h("th.num", { text: "Cost" }), h("th.num", { text: "Sell" }), h("th.num", { text: "Margin" }))));
  var tb = h("tbody");
  onJob.forEach(function (l) {
    var margin = l.cost ? Math.round((l.unitPrice - l.cost) / l.unitPrice * 100) : 0;
    tb.appendChild(h("tr", h("td", { text: l.code }), h("td", { text: l.title }), h("td.num", { text: String(l.qty) }),
      h("td.num", { text: CMS.money(l.cost || 0) }), h("td.num", { text: CMS.money(l.unitPrice) }), h("td.num", { text: margin + "%" })));
  });
  tbl.appendChild(tb);
  pc.appendChild(h("div.table-wrap", tbl));
  pane.appendChild(pc);
}

/* ---------- financial ---------- */
function jobFinancial(pane, j) {
  var t = CMS.totals(j.lines, "billable");
  var card = h("div.card", h("h3", { text: "Invoice" }));
  card.appendChild(totalsTable(t));
  if (j.invoice) {
    card.appendChild(h("p", CMS.ui.badge(j.invoice.no + " · " + CMS.fmtDateTime(j.invoice.at), "green")));
  } else if (CMS.can(App.user, "invoice") || CMS.can(App.user, "*")) {
    var blocked = CMS.feature("requireVhcBeforeInvoice") && CMS.feature("vhc") && (!j.vhc || !j.vhc.completedAt);
    card.appendChild(h("button.btn.btn-primary", {
      text: "Raise the invoice", disabled: blocked ? true : null,
      onclick: function () {
        CMS.invoiceJob(j.id, App.user.id);
        if (CMS.cfg().integrations.evolve.enabled && CMS.cfg().integrations.evolve.postOnInvoice) {
          var r = CMS.postToEvolve(j.id, "invoice", App.user.id);
          CMS.ui.toast(r.status === "failed" ? "Invoice raised, Evolve post failed" : "Invoiced and posted to Evolve", r.status === "failed" ? "err" : "ok");
        }
        refreshJob(j.id); render();
      },
    }));
    if (blocked) card.appendChild(h("p", CMS.ui.badge("This dealership requires a completed " + CMS.t("vhc") + " before invoicing", "amber")));
  }
  pane.appendChild(card);

  var pl = h("div.card.flush", h("div.card-head", h("h3", { text: "Evolve posting log" }), h("div.spacer"),
    h("small.muted", { text: "Evolve DMS is the financial system of record" })));
  var tbl = h("table.data");
  tbl.appendChild(h("thead", h("tr", h("th", { text: "When" }), h("th", { text: "What" }), h("th", { text: "Result" }), h("th", { text: "" }))));
  var tb = h("tbody");
  (j.posting || []).forEach(function (p) {
    tb.appendChild(h("tr",
      h("td", { text: CMS.fmtDateTime(p.at) }), h("td", { text: p.kind }),
      h("td", CMS.ui.badge(p.status, p.status === "posted" ? "green" : "red"), h("div.muted", { text: p.response })),
      h("td", p.status === "failed" ? h("button.btn.btn-sm", { text: "Retry", onclick: function () {
        var r = CMS.postToEvolve(j.id, p.kind, App.user.id);
        CMS.ui.toast(r.status === "posted" ? "Posted" : "Still failing — " + r.response, r.status === "posted" ? "ok" : "err");
        refreshJob(j.id);
      } }) : null)));
  });
  tbl.appendChild(tb);
  pl.appendChild(h("div.table-wrap", tbl));
  pl.appendChild(h("p.muted", { style: { padding: "0 var(--pad) var(--pad)" },
    text: "Fix the cause in Evolve, then retry. Never re-invoice to get round a failed post — it leaves duplicate documents in Evolve." }));
  pane.appendChild(pl);
}

function jobTimeline(pane, j) {
  var card = h("div.card", h("h3", { text: "Everything that happened" }));
  var ul = h("ul.timeline");
  (j.timeline || []).forEach(function (e) {
    ul.appendChild(h("li", h("span", { text: e.what }),
      h("span.when", { text: CMS.fmtDateTime(e.at) + " · " + ((CMS.person(e.who) || {}).name || e.who) })));
  });
  card.appendChild(ul);
  pane.appendChild(card);
}

/* ============================================================
   Health checks across the workshop
   ============================================================ */
function viewVhc(root) {
  var open = CMS.jobs().filter(function (j) { return j.vhc; });
  if (!open.length) { root.appendChild(CMS.ui.empty("✓", "No health checks yet today.")); return; }
  var card = h("div.card.flush");
  var tbl = h("table.data");
  tbl.appendChild(h("thead", h("tr", h("th", { text: CMS.t("ro") }), h("th", { text: "Vehicle" }), h("th", { text: CMS.t("tech") }),
    h("th", { text: "Progress" }), h("th", { text: "Findings" }), h("th.num", { text: "Quoted" }), h("th", { text: "" }))));
  var tb = h("tbody");
  open.sort(function (a, b) { return (a.vhc.completedAt ? 1 : 0) - (b.vhc.completedAt ? 1 : 0); }).forEach(function (j) {
    var s = CMS.vhcSummary(j);
    var quoted = CMS.totals(j.lines.filter(function (l) { return l.source === "evhc"; }));
    tb.appendChild(h("tr.clickable", { onclick: function () { openJob(j.id, "vhc"); } },
      h("td", h("strong", { text: j.ref })),
      h("td", { text: CMS.ui.vehLabel(j) }),
      h("td", { text: (CMS.person(j.vhc.techId) || {}).name || "—" }),
      h("td", h("div.meter-row", h("div.progress", h("i", { style: { width: (s.total ? s.done / s.total * 100 : 0) + "%" } })),
        h("small", { text: s.done + "/" + s.total }))),
      h("td", h("span.row", CMS.ui.rag("r"), h("small", { text: String(s.r) }), CMS.ui.rag("a"), h("small", { text: String(s.a) }),
        CMS.ui.rag("g"), h("small", { text: String(s.g) }))),
      h("td.num", { text: CMS.money(quoted.gross) }),
      h("td", CMS.ui.badge(j.vhc.completedAt ? "complete" : "in progress", j.vhc.completedAt ? "green" : "amber"))));
  });
  tbl.appendChild(tb);
  card.appendChild(h("div.table-wrap", tbl));
  root.appendChild(card);
}

/* ============================================================
   Authorisations
   ============================================================ */
function viewAuths(root) {
  var waiting = CMS.jobs().filter(function (j) { return j.lines.some(function (l) { return l.authStatus === "pending"; }); });
  var decided = CMS.jobs().filter(function (j) { return j.auth && j.auth.signedAt; });

  var w = h("div.card", h("div.card-head", h("h2", { text: "Waiting on a customer" }), h("div.spacer"),
    CMS.ui.badge(String(waiting.length), waiting.length ? "amber" : "green")));
  if (!waiting.length) w.appendChild(CMS.ui.empty("✍", "Nothing outstanding."));
  waiting.forEach(function (j) {
    var t = CMS.totals(j.lines, "pending");
    var sent = j.auth && j.auth.requestedAt;
    var mins = sent ? Math.round((Date.now() - new Date(j.auth.requestedAt)) / 60000) : null;
    w.appendChild(h("button.touch-item", { style: { marginBottom: "8px", borderLeftColor: mins > 90 ? "var(--red)" : "var(--mustard)" },
      onclick: function () { openJob(j.id, "auth"); } },
      h("div", h("strong", { text: j.ref + " · " + CMS.ui.vehLabel(j) }),
        h("div.muted", { text: CMS.ui.custName(j) + " · " + t.count + " items · " + (sent ? "sent " + CMS.relTime(j.auth.requestedAt) : "not sent yet") })),
      h("div.spacer"),
      h("div", { style: { textAlign: "right" } }, h("strong", { text: CMS.money(t.gross) }),
        h("div", sent ? CMS.ui.badge((j.auth.sent[0] || {}).status || "sent", mins > 90 ? "red" : "amber") : CMS.ui.badge("not sent", "grey")))));
  });
  root.appendChild(w);

  var d = h("div.card", h("h2", { text: "Decided" }));
  if (!decided.length) d.appendChild(h("p.muted", { text: "Nothing signed yet." }));
  decided.slice(0, 12).forEach(function (j) {
    var ap = CMS.totals(j.lines, "approved"), dc = j.lines.filter(function (l) { return l.authStatus === "declined"; });
    d.appendChild(h("button.touch-item", { style: { marginBottom: "8px", borderLeftColor: "var(--green)" },
      onclick: function () { openJob(j.id, "auth"); } },
      h("div", h("strong", { text: j.ref + " · " + CMS.ui.vehLabel(j) }),
        h("div.muted", { text: j.auth.signedName + " · " + CMS.fmtDateTime(j.auth.signedAt) + (j.auth.method === "phone" ? " (telephone)" : "") })),
      h("div.spacer"),
      h("div", { style: { textAlign: "right" } }, h("strong", { text: CMS.money(ap.gross) }),
        dc.length ? h("div.muted", { text: dc.length + " declined" }) : null)));
  });
  root.appendChild(d);
}

/* ============================================================
   Parts
   ============================================================ */
function viewParts(root) {
  var reqs = [];
  CMS.jobs().forEach(function (j) {
    (j.partsRequests || []).forEach(function (r) { reqs.push({ j: j, r: r }); });
  });
  var open = reqs.filter(function (x) { return x.r.status === "requested" || x.r.status === "backorder"; });

  var card = h("div.card", h("div.card-head", h("h2", { text: "Requests from the workshop" }), h("div.spacer"),
    CMS.ui.badge(String(open.length), open.length ? "amber" : "green")));
  if (!open.length) card.appendChild(CMS.ui.empty("⚙", "No open parts requests."));
  open.forEach(function (x) {
    var lines = x.r.items.map(function (i) {
      var p = CMS.part(i.no);
      return i.qty + "× " + i.no + (p ? " · " + p.desc + " (stock " + p.qty + ", bin " + p.bin + ")" : " · not on the price file");
    });
    card.appendChild(h("div", { style: { borderBottom: "1px solid var(--border)", padding: "10px 0" } },
      h("div.row", CMS.ui.badge(x.r.status, x.r.status === "backorder" ? "red" : "amber"),
        h("strong", { text: x.j.ref + " · " + CMS.ui.vehLabel(x.j) }),
        h("div.spacer"), h("small.muted", { text: CMS.relTime(x.r.at) + " · " + ((CMS.person(x.r.by) || {}).name || "") })),
      h("div.muted", { text: lines.join("  |  ") }),
      x.r.note ? h("div.muted", { text: "Note: " + x.r.note }) : null,
      h("div.btn-row", { style: { marginTop: "7px" } },
        h("button.btn.btn-sm.btn-primary", { text: "Issue to the job", onclick: function () { CMS.fulfilParts(x.j.id, x.r.id, "issued", App.user.id); render(); } }),
        h("button.btn.btn-sm", { text: "Backorder", onclick: function () { CMS.fulfilParts(x.j.id, x.r.id, "backorder", App.user.id); render(); } }),
        h("button.btn.btn-sm.btn-ghost", { text: "Open " + CMS.t("job").toLowerCase(), onclick: function () { openJob(x.j.id, "parts"); } }))));
  });
  root.appendChild(card);

  var search = h("input", { type: "search", placeholder: "Search the price file…" });
  var results = h("div.card.flush");
  function paint() {
    CMS.ui.clear(results);
    var q = search.value.trim().toLowerCase();
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr", h("th", { text: "Part" }), h("th", { text: "Description" }), h("th.num", { text: "Cost" }),
      h("th.num", { text: "Markup" }), h("th.num", { text: "Sell excl" }), h("th.num", { text: "Sell incl" }),
      h("th.num", { text: "Stock" }), h("th", { text: "Bin" }))));
    var tb = h("tbody");
    CMS.cfg().parts.filter(function (p) { return !q || (p.no + " " + p.desc).toLowerCase().indexOf(q) >= 0; })
      .forEach(function (p) {
        tb.appendChild(h("tr",
          h("td", h("strong", { text: p.no }), p.supersededBy ? h("div", CMS.ui.badge("→ " + p.supersededBy, "amber")) : null),
          h("td", { text: p.desc }),
          h("td.num", { text: CMS.money(p.cost) }),
          h("td.num", { text: CMS.markupPct(p.cost) + "%" }),
          h("td.num", { text: CMS.money(CMS.partSell(p.no)) }),
          h("td.num", { text: CMS.money(CMS.withVat(CMS.partSell(p.no))) }),
          h("td.num", { text: String(p.qty) }),
          h("td", { text: p.bin })));
      });
    tbl.appendChild(tb);
    results.appendChild(h("div.table-wrap", tbl));
  }
  search.addEventListener("input", paint);
  root.appendChild(h("div.card", h("div.card-head", h("h2", { text: "Price file" }), h("div.spacer"), search,
    h("small.muted", { text: "Prices shown are the Evolve cost plus this dealership's markup matrix." }))));
  root.appendChild(results);
  paint();
}

/* ============================================================
   Customers
   ============================================================ */
function viewCustomers(root) {
  var search = h("input", { type: "search", placeholder: "Name, mobile, registration…", style: { maxWidth: "300px" } });
  var list = h("div.card.flush");
  function paint() {
    CMS.ui.clear(list);
    var q = search.value.trim().toLowerCase();
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr", h("th", { text: "Name" }), h("th", { text: "Mobile" }), h("th", { text: "Vehicles" }),
      h("th.num", { text: "Visits" }), h("th.num", { text: "Spend" }), h("th", { text: "Contact by" }))));
    var tb = h("tbody");
    CMS.db().customers.filter(function (c) {
      var vs = CMS.db().vehicles.filter(function (v) { return v.customerId === c.id; }).map(function (v) { return v.reg; }).join(" ");
      return !q || (c.name + " " + c.mobile + " " + vs).toLowerCase().indexOf(q) >= 0;
    }).forEach(function (c) {
      var vs = CMS.db().vehicles.filter(function (v) { return v.customerId === c.id; });
      var js = CMS.jobs().filter(function (j) { return j.customerId === c.id; });
      var spend = js.reduce(function (a, j) { return a + (j.invoice ? j.invoice.total : 0); }, 0);
      var con = c.consent || {};
      tb.appendChild(h("tr.clickable", { onclick: function () { openCustomer(c); } },
        h("td", h("strong", { text: c.name }), c.type === "fleet" ? h("div", CMS.ui.badge("fleet " + (c.account || ""), "blue")) : null),
        h("td", { text: c.mobile }),
        h("td", { text: vs.map(function (v) { return v.reg; }).join(", ") || "—" }),
        h("td.num", { text: String(js.length) }),
        h("td.num", { text: CMS.money(spend) }),
        h("td", h("span.row",
          con.sms !== false ? CMS.ui.badge("SMS", "green") : null,
          con.whatsapp !== false ? CMS.ui.badge("WhatsApp", "green") : null,
          con.email !== false ? CMS.ui.badge("E-mail", "green") : null))));
    });
    tbl.appendChild(tb);
    list.appendChild(h("div.table-wrap", tbl));
  }
  search.addEventListener("input", paint);
  root.appendChild(h("div.card", h("div.card-head", h("h2", { text: CMS.t("customer") + "s" }), h("div.spacer"), search)));
  root.appendChild(list);
  paint();
}

function openCustomer(c) {
  var vs = CMS.db().vehicles.filter(function (v) { return v.customerId === c.id; });
  var js = CMS.jobs().filter(function (j) { return j.customerId === c.id; });
  var box = h("div");
  box.appendChild(h("div.card",
    h("h3", { text: c.name }),
    h("p.muted", { text: c.mobile + (c.email ? " · " + c.email : "") + (c.suburb ? " · " + c.suburb : "") }),
    h("h4", { text: "POPIA consent" }),
    h("div", ["sms", "whatsapp", "email"].map(function (k) {
      var cb = h("input", { type: "checkbox" });
      cb.checked = (c.consent || {})[k] !== false;
      cb.addEventListener("change", function () {
        CMS.upsertCustomer({ id: c.id, consent: Object.assign({}, c.consent, (function () { var o = {}; o[k] = cb.checked; return o; })()) });
        CMS.ui.toast("Consent updated", "ok");
      });
      return h("label.checkline", cb, h("span", { text: k === "sms" ? "SMS" : k === "email" ? "E-mail" : "WhatsApp" }));
    }))));
  var vc = h("div.card", h("h4", { text: "Vehicles" }));
  vs.forEach(function (v) {
    vc.appendChild(h("div", { style: { borderBottom: "1px solid var(--border)", padding: "7px 0" } },
      h("strong", { text: v.reg }), h("div.muted", { text: [v.make, v.model, v.year, v.km ? v.km + " km" : ""].filter(Boolean).join(" · ") }),
      v.vin ? h("small.muted", { text: "VIN " + v.vin }) : null));
  });
  box.appendChild(vc);
  var hc = h("div.card", h("h4", { text: "History" }));
  js.forEach(function (j) {
    hc.appendChild(h("button.touch-item", { style: { marginBottom: "6px" }, onclick: function () { openJob(j.id); } },
      h("div", h("strong", { text: j.ref }), h("div.muted", { text: (j.requested[0] || {}).title || "—" })),
      h("div.spacer"), h("div", { style: { textAlign: "right" } },
        h("div", { text: j.slot ? CMS.fmtDate(j.slot.date) : "" }),
        j.invoice ? h("strong", { text: CMS.money(j.invoice.total) }) : CMS.ui.statusBadge(j.status))));
  });
  box.appendChild(hc);
  CMS.ui.drawer(c.name, box);
}

/* ============================================================
   Reports
   ============================================================ */
function viewReports(root) {
  var from = h("input", { type: "date", value: shiftDate(CMS.todayISO(), -30) });
  var to = h("input", { type: "date", value: CMS.todayISO() });
  var out = h("div");
  function paint() {
    CMS.ui.clear(out);
    var k = CMS.kpis(from.value, to.value);
    out.appendChild(h("div.kpis",
      CMS.ui.kpi(CMS.t("jobs"), k.jobs, "in the period"),
      CMS.ui.kpi("Invoiced", CMS.money(k.invoicedValue), k.invoiced + " invoices"),
      CMS.ui.kpi("Average " + CMS.t("ro"), CMS.money(k.avgRo), ""),
      CMS.ui.kpi(CMS.t("vhc") + " completion", k.vhcRate + "%", k.redAmber + " red/amber found"),
      CMS.ui.kpi("Upsell conversion", k.conversion + "%", CMS.money(k.upsellSold) + " of " + CMS.money(k.upsellPresented)),
      CMS.ui.kpi("Workshop efficiency", k.efficiency + "%", k.hoursSold + "h sold / " + k.hoursClocked + "h clocked")));

    /* By advisor */
    var rows = {};
    CMS.jobs().forEach(function (j) {
      var d = (j.slot && j.slot.date) || j.createdAt.slice(0, 10);
      if (d < from.value || d > to.value) return;
      var id = j.advisorId || "—";
      var r = rows[id] = rows[id] || { jobs: 0, value: 0, presented: 0, sold: 0, vhc: 0 };
      r.jobs++;
      r.value += j.invoice ? j.invoice.total : 0;
      if (j.vhc && j.vhc.completedAt) r.vhc++;
      j.lines.forEach(function (l) {
        if (l.authStatus === "approved") r.sold += CMS.lineNet(l);
        if (["approved", "declined", "pending"].indexOf(l.authStatus) >= 0) r.presented += CMS.lineNet(l);
      });
    });
    var card = h("div.card.flush", h("div.card-head", h("h3", { text: "By " + CMS.t("advisor").toLowerCase() })));
    var tbl = h("table.data");
    tbl.appendChild(h("thead", h("tr", h("th", { text: CMS.t("advisor") }), h("th.num", { text: CMS.t("jobs") }),
      h("th.num", { text: "Invoiced" }), h("th.num", { text: CMS.t("vhc") + " done" }),
      h("th.num", { text: "Presented" }), h("th.num", { text: "Sold" }), h("th.num", { text: "Conversion" }))));
    var tb = h("tbody");
    Object.keys(rows).forEach(function (id) {
      var r = rows[id];
      tb.appendChild(h("tr",
        h("td", { text: (CMS.person(id) || {}).name || "Unassigned" }),
        h("td.num", { text: String(r.jobs) }),
        h("td.num", { text: CMS.money(r.value) }),
        h("td.num", { text: r.vhc + "/" + r.jobs }),
        h("td.num", { text: CMS.money(r.presented) }),
        h("td.num", { text: CMS.money(r.sold) }),
        h("td.num", { text: (r.presented ? Math.round(r.sold / r.presented * 100) : 0) + "%" })));
    });
    tbl.appendChild(tb);
    card.appendChild(h("div.table-wrap", tbl));
    out.appendChild(card);

    /* Technician productivity */
    var tr = {};
    CMS.jobs().forEach(function (j) {
      var d = (j.slot && j.slot.date) || j.createdAt.slice(0, 10);
      if (d < from.value || d > to.value) return;
      (j.time || []).forEach(function (t) {
        var r = tr[t.techId] = tr[t.techId] || { clocked: 0, sold: 0, jobs: {} };
        r.clocked += ((t.end ? new Date(t.end) : new Date()) - new Date(t.start)) / 3600e3;
        r.jobs[j.id] = true;
      });
      if (j.techId) {
        var r2 = tr[j.techId] = tr[j.techId] || { clocked: 0, sold: 0, jobs: {} };
        r2.sold += j.lines.filter(function (l) { return l.kind === "labour" && l.authStatus !== "declined"; })
          .reduce(function (a, l) { return a + (l.hours || 0); }, 0);
      }
    });
    var tc = h("div.card.flush", h("div.card-head", h("h3", { text: CMS.t("tech") + " productivity" })));
    var t2 = h("table.data");
    t2.appendChild(h("thead", h("tr", h("th", { text: CMS.t("tech") }), h("th.num", { text: CMS.t("jobs") }),
      h("th.num", { text: "Hours clocked" }), h("th.num", { text: "Hours sold" }), h("th.num", { text: "Efficiency" }))));
    var tb2 = h("tbody");
    Object.keys(tr).forEach(function (id) {
      var r = tr[id];
      tb2.appendChild(h("tr",
        h("td", { text: (CMS.person(id) || {}).name || id }),
        h("td.num", { text: String(Object.keys(r.jobs).length) }),
        h("td.num", { text: r.clocked.toFixed(1) }),
        h("td.num", { text: r.sold.toFixed(1) }),
        h("td.num", { text: (r.clocked ? Math.round(r.sold / r.clocked * 100) : 0) + "%" })));
    });
    t2.appendChild(tb2);
    tc.appendChild(h("div.table-wrap", t2));
    out.appendChild(tc);
  }
  from.addEventListener("change", paint); to.addEventListener("change", paint);
  root.appendChild(h("div.card", h("div.card-head",
    h("h2", { text: "Workshop performance" }), h("div.spacer"),
    CMS.ui.field("From", from), CMS.ui.field("To", to),
    h("button.btn.btn-ghost", { text: "Export CSV", onclick: exportJobsCsv }))));
  root.appendChild(out);
  paint();
}

/* ============================================================
   Setup — how this dealership is different from the last one
   ============================================================ */
var setupTab = "dealer";

function cfgGet(path) {
  return path.split(".").reduce(function (o, k) { return o ? o[k] : undefined; }, CMS.cfg());
}
function cfgSet(path, value) {
  CMS.store.patch(function (s) {
    var parts = path.split("."), o = s.config;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  });
}
function cfgInput(label, path, opts) {
  opts = opts || {};
  var node = opts.textarea ? h("textarea") : h("input", { type: opts.type || "text" });
  node.value = cfgGet(path) == null ? "" : cfgGet(path);
  node.addEventListener("change", function () {
    cfgSet(path, opts.type === "number" ? (+node.value || 0) : node.value);
    CMS.ui.toast("Saved", "ok", 1200);
    if (opts.rerender) render();
  });
  return CMS.ui.field(label, node, { hint: opts.hint });
}
function cfgToggle(label, path, hint) {
  var cb = h("input", { type: "checkbox" });
  cb.checked = !!cfgGet(path);
  cb.addEventListener("change", function () { cfgSet(path, cb.checked); CMS.ui.toast("Saved", "ok", 1200); render(); });
  return h("label.checkline", cb, h("span", h("strong", { text: label }), hint ? h("div.muted", { text: hint }) : null));
}

/* A small editable grid over a config array. */
function tableEditor(path, columns, blankRow, opts) {
  opts = opts || {};
  var rows = cfgGet(path) || [];
  var card = h("div.card.flush");
  var tbl = h("table.data");
  tbl.appendChild(h("thead", h("tr",
    columns.map(function (c) { return h("th", { text: c.label }); }).concat([h("th", { text: "" })]))));
  var tb = h("tbody");
  rows.forEach(function (row, i) {
    var cells = columns.map(function (c) {
      var input;
      if (c.options) {
        input = CMS.ui.select(c.options(), row[c.key], {});
      } else {
        input = h("input", { type: c.type || "text" });
        input.value = row[c.key] == null ? "" : row[c.key];
      }
      input.addEventListener("change", function () {
        var v = input.value;
        if (c.type === "number") v = +v || 0;
        if (c.type === "checkbox") v = input.checked;
        CMS.store.patch(function (s) {
          var arr = path.split(".").reduce(function (o, k) { return o[k]; }, s.config);
          arr[i][c.key] = v;
        });
        CMS.ui.toast("Saved", "ok", 1200);
        if (opts.rerender) render();
      });
      return h("td", input);
    });
    cells.push(h("td", h("button.btn.btn-sm.btn-ghost", { text: "✕", title: "Remove", onclick: function () {
      CMS.ui.confirm("Remove row", "Remove this row? Anything already using it keeps its own copy.", function () {
        CMS.store.patch(function (s) {
          var arr = path.split(".").reduce(function (o, k) { return o[k]; }, s.config);
          arr.splice(i, 1);
        });
        render();
      }, "Remove");
    } })));
    tb.appendChild(h("tr", cells));
  });
  tbl.appendChild(tb);
  card.appendChild(h("div.table-wrap", tbl));
  card.appendChild(h("div", { style: { padding: "var(--gap-sm) var(--pad)" } },
    h("button.btn", { text: "＋ Add row", onclick: function () {
      CMS.store.patch(function (s) {
        var arr = path.split(".").reduce(function (o, k) { return o[k]; }, s.config);
        arr.push(Object.assign({ id: CMS.uid("row") }, blankRow));
      });
      render();
    } })));
  return card;
}

/* Advanced editors fall back to JSON so nothing is un-editable. */
function jsonEditor(path, label, hint) {
  var ta = h("textarea", { style: { minHeight: "280px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: ".82rem" } });
  ta.value = JSON.stringify(cfgGet(path), null, 2);
  var msg = h("div");
  return h("div.card",
    h("h3", { text: label }),
    hint ? h("p.muted", { text: hint }) : null,
    ta, msg,
    h("button.btn.btn-primary", { text: "Save", onclick: function () {
      try {
        var parsed = JSON.parse(ta.value);
        cfgSet(path, parsed);
        CMS.ui.mount(msg, h("p", CMS.ui.badge("Saved", "green")));
        render();
      } catch (e) {
        CMS.ui.mount(msg, h("p", CMS.ui.badge("Not valid JSON — " + e.message, "red")));
      }
    } }));
}

function viewSetup(root) {
  var tabs = [
    { id: "dealer", label: "Dealership" },
    { id: "diary", label: "Diary" },
    { id: "money", label: "Rates & pricing" },
    { id: "people", label: "People" },
    { id: "roles", label: "Roles" },
    { id: "words", label: "Words we use" },
    { id: "modules", label: "Modules" },
    { id: "statuses", label: "Statuses" },
    { id: "vhc", label: "Health checks" },
    { id: "menus", label: "Menus & parts" },
    { id: "messages", label: "Messages" },
    { id: "auth", label: "Authorisation" },
    { id: "integrations", label: "Integrations" },
    { id: "data", label: "Data" },
  ];
  root.appendChild(CMS.ui.tabs(tabs, setupTab, function (t) { setupTab = t; render(); }));
  var pane = h("div");
  ({
    dealer: setupDealer, diary: setupDiary, money: setupMoney, people: setupPeople,
    roles: setupRoles, words: setupWords, modules: setupModules, statuses: setupStatuses,
    vhc: setupVhc, menus: setupMenus, messages: setupMessages, auth: setupAuth,
    integrations: setupIntegrations, data: setupData,
  })[setupTab](pane);
  root.appendChild(pane);
}

function setupDealer(pane) {
  pane.appendChild(h("div.card",
    h("h3", { text: "Dealership details" }),
    h("p.muted", { text: "These appear on the customer link, on printed job cards and on anything posted to Evolve." }),
    h("div.grid-2",
      cfgInput("Trading name", "dealer.name", { rerender: true }),
      cfgInput("Franchise", "dealer.franchise"),
      cfgInput("Branch", "dealer.branch"),
      cfgInput("Dealer code", "dealer.dealerCode"),
      cfgInput("Telephone", "dealer.phone"),
      cfgInput("E-mail", "dealer.email"),
      cfgInput("VAT number", "dealer.vatNo")),
    cfgInput("Address", "dealer.address", { textarea: true })));

  var logoCard = h("div.card", h("h3", { text: "Branding" }),
    h("p.muted", { text: "The staff apps carry the CMS eco mark. The customer link may carry the dealership's own mark instead — that is the page the customer sees." }));
  [["logoDataUrl", "Staff apps logo"], ["customerLogoDataUrl", "Customer link logo"]].forEach(function (pair) {
    var current = cfgGet("dealer." + pair[0]);
    var input = CMS.ui.photoInput(function (dataUrl) {
      cfgSet("dealer." + pair[0], dataUrl);
      CMS.ui.toast("Logo updated", "ok"); render();
    });
    logoCard.appendChild(h("div", { style: { borderTop: "1px solid var(--border)", paddingTop: "10px", marginTop: "10px" } },
      h("h4", { text: pair[1] }),
      current ? h("img", { src: current, alt: "", style: { maxHeight: "48px", display: "block", marginBottom: "8px" } })
              : h("p.muted", { text: "Using the CMS eco lock-up." }),
      h("div.btn-row",
        h("button.btn", { text: "Upload…", onclick: function () { input.click(); } }),
        current ? h("button.btn.btn-ghost", { text: "Back to CMS eco", onclick: function () { cfgSet("dealer." + pair[0], ""); render(); } }) : null),
      input));
  });
  pane.appendChild(logoCard);
}

function setupDiary(pane) {
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var chosen = cfgGet("diary.days") || [];
  var bar = h("div.chipbar");
  days.forEach(function (d, i) {
    bar.appendChild(h("button.chip", { "aria-pressed": String(chosen.indexOf(i) >= 0), text: d, onclick: function () {
      var next = chosen.indexOf(i) >= 0 ? chosen.filter(function (x) { return x !== i; }) : chosen.concat([i]).sort();
      cfgSet("diary.days", next); render();
    } }));
  });
  pane.appendChild(h("div.card",
    h("h3", { text: "Opening" }),
    CMS.ui.field("Days the workshop takes bookings", bar),
    h("div.grid-3",
      cfgInput("Opens", "diary.open", { type: "time" }),
      cfgInput("Closes", "diary.close", { type: "time" }),
      cfgInput("Saturday closes", "diary.saturdayClose", { type: "time" }))));
  pane.appendChild(h("div.card",
    h("h3", { text: "Capacity" }),
    h("div.grid-3",
      cfgInput("Slot length (minutes)", "diary.slotMinutes", { type: "number" }),
      cfgInput("Jobs per slot before we warn", "diary.slotCapacity", { type: "number" }),
      cfgInput("Sellable hours a day", "diary.dailyCapacityHours", { type: "number" }),
      cfgInput("Default job length (minutes)", "diary.defaultDurationMin", { type: "number" }),
      cfgInput("How far ahead bookings open (days)", "diary.leadTimeDays", { type: "number" })),
    cfgToggle("Allow overbooking", "diary.allowOverbook", "The wizard still warns, but does not stop the booking.")));
  pane.appendChild(h("div.card", h("h3", { text: CMS.t("bay") + "s" }),
    tableEditor("bays", [
      { key: "name", label: "Name" },
      { key: "type", label: "Type", options: function () { return ["service", "diagnostic", "repair", "prep"].map(function (t) { return { value: t, label: t }; }); } },
    ], { name: "New bay", type: "service" })));
}

function setupMoney(pane) {
  pane.appendChild(h("div.card",
    h("h3", { text: "Money" }),
    h("div.grid-3",
      cfgInput("Currency symbol", "money.symbol"),
      cfgInput("VAT rate (%)", "money.vatRate", { type: "number" }),
      cfgInput("Sundries (% of labour and parts)", "money.sundriesPct", { type: "number" }),
      cfgInput("Sundries cap", "money.sundriesCap", { type: "number" })),
    cfgToggle("Show prices including VAT to the customer", "money.displayVatInclusive",
      "Compare VAT-exclusive before raising a price mismatch with Evolve.")));
  pane.appendChild(h("div.card", h("h3", { text: "Labour rates" }),
    h("p.muted", { text: "A menu or a line can be priced on any of these." }),
    tableEditor("money.labourRates", [
      { key: "label", label: "Name" },
      { key: "rate", label: "Rate per hour", type: "number" },
    ], { id: CMS.uid("rate"), label: "New rate", rate: 750 })));
  pane.appendChild(h("div.card", h("h3", { text: "Parts markup matrix" }),
    h("p.muted", { text: "Applied to the Evolve price-file cost. The first band the cost falls into wins; leave the last band's ceiling empty for everything above." }),
    tableEditor("money.partsMarkup", [
      { key: "upTo", label: "Cost up to", type: "number" },
      { key: "pct", label: "Markup %", type: "number" },
    ], { upTo: 1000, pct: 30 })));
}

function setupPeople(pane) {
  pane.appendChild(h("div.card", h("h3", { text: "People" }),
    h("p.muted", { text: "The role decides which screens they see and what they may do. Technicians sign in on the workshop app with their PIN." }),
    tableEditor("people", [
      { key: "name", label: "Name" },
      { key: "initials", label: "Initials" },
      { key: "role", label: "Role", options: function () {
        return Object.keys(CMS.cfg().roles).map(function (r) { return { value: r, label: CMS.cfg().roles[r].label }; });
      } },
      { key: "pin", label: "PIN" },
      { key: "email", label: "E-mail" },
    ], { name: "New person", initials: "NN", role: "tech", pin: "0000", active: true }, { rerender: true })));
}

function setupRoles(pane) {
  pane.appendChild(h("div.card", h("h3", { text: "What each role sees" }),
    h("p.muted", { text: "Tick the screens a role gets, in the order you tick them. The first is where they land." })));
  Object.keys(CMS.cfg().roles).forEach(function (rid) {
    var role = CMS.cfg().roles[rid];
    var card = h("div.card", h("div.card-head", h("h4", { text: role.label }), h("div.spacer"),
      CMS.ui.badge(CMS.peopleByRole(rid).length + " people", "blue")));
    var navBox = h("div.grid-3");
    Object.keys(VIEWS).forEach(function (v) {
      var cb = h("input", { type: "checkbox" });
      cb.checked = (role.nav || []).indexOf(v) >= 0;
      cb.addEventListener("change", function () {
        var next = cb.checked ? (role.nav || []).concat([v]) : (role.nav || []).filter(function (x) { return x !== v; });
        cfgSet("roles." + rid + ".nav", next);
        render();
      });
      navBox.appendChild(h("label.checkline", cb, h("span", { text: navLabel(v) })));
    });
    card.appendChild(navBox);
    var perms = ["book", "edit_job", "quote", "send_auth", "phone_auth", "invoice", "dispatch", "assign_tech", "pick_parts", "price_parts", "qc", "override", "view_reports", "clock", "vhc_capture", "request_parts", "request_auth"];
    var pBox = h("div.grid-4");
    perms.forEach(function (p) {
      var cb = h("input", { type: "checkbox" });
      cb.checked = (role.can || []).indexOf(p) >= 0 || (role.can || []).indexOf("*") >= 0;
      cb.disabled = (role.can || []).indexOf("*") >= 0;
      cb.addEventListener("change", function () {
        var next = cb.checked ? (role.can || []).concat([p]) : (role.can || []).filter(function (x) { return x !== p; });
        cfgSet("roles." + rid + ".can", next);
      });
      pBox.appendChild(h("label.checkline", cb, h("span", { text: p.replace(/_/g, " ") })));
    });
    card.appendChild(h("h4", { text: "May do" }));
    card.appendChild(pBox);
    pane.appendChild(card);
  });
}

function setupWords(pane) {
  var card = h("div.card", h("h3", { text: "Words we use" }),
    h("p.muted", { text: "Change a word once and it changes on every screen, including the technicians' app and the customer link." }));
  var g = h("div.grid-3");
  Object.keys(CMS.cfg().terms).forEach(function (k) {
    g.appendChild(cfgInput(k, "terms." + k, { rerender: true }));
  });
  card.appendChild(g);
  pane.appendChild(card);
}

function setupModules(pane) {
  var labels = {
    vhc: ["Electronic health check", "Technicians complete a RAG check on a tablet and the findings become quote lines."],
    vhcVideo: ["Video on the health check", "Short clips as well as photos."],
    onlineAuthorisation: ["Customer approval link", "OTP, per-item approval and an electronic signature."],
    phoneAuthFallback: ["Telephone authorisation", "Record a verbal approval when messaging is down."],
    partsCatalogue: ["Parts and price file", "Search, markup, supersession."],
    courtesyCars: ["Courtesy cars", "Offered as a transport option at booking."],
    collectAndDeliver: ["Collect and deliver", "Offered as a transport option at booking."],
    wallScreen: ["Wall screen mode", "Full-screen dispatch board for the workshop wall."],
    customerTracking: ["Customer tracking page", "The customer can follow progress on the same link."],
    qcSignOff: ["Quality check before ready", "A quality-check status between work complete and ready."],
    superserviceMenus: ["OEM service menus", "Menus priced from the decoded VIN."],
    evolvePosting: ["Post to Evolve DMS", "Job card on open, invoice on finalise."],
    requireVhcBeforeInvoice: ["Health check before invoicing", "Blocks the invoice until the check is complete."],
  };
  var card = h("div.card", h("h3", { text: "Modules" }),
    h("p.muted", { text: "Switch off what this dealership does not use. Screens and buttons disappear with it." }));
  Object.keys(CMS.cfg().features).forEach(function (f) {
    var l = labels[f] || [f, ""];
    card.appendChild(cfgToggle(l[0], "features." + f, l[1]));
  });
  pane.appendChild(card);
}

function setupStatuses(pane) {
  pane.appendChild(h("div.card", h("h3", { text: "Job statuses" }),
    h("p.muted", { text: "The board, the customer's tracker and the reports all follow this list, in this order. Stage drives what the customer sees; WIP marks the ones that count as work in the workshop." }),
    tableEditor("statuses", [
      { key: "label", label: "Label" },
      { key: "tone", label: "Colour", options: function () { return ["grey", "blue", "turq", "green", "amber", "red"].map(function (t) { return { value: t, label: t }; }); } },
      { key: "stage", label: "Customer stage", options: function () { return ["booked", "working", "approval", "ready", "done"].map(function (t) { return { value: t, label: t }; }); } },
      { key: "wip", label: "Counts as WIP", options: function () { return [{ value: true, label: "yes" }, { value: false, label: "no" }]; } },
    ], { id: CMS.uid("st"), label: "New status", tone: "grey", stage: "working", wip: true }, { rerender: true })));
}

function setupVhc(pane) {
  CMS.cfg().vhcTemplates.forEach(function (t, i) {
    var count = t.groups.reduce(function (a, g) { return a + g.items.length; }, 0);
    pane.appendChild(h("div.card",
      h("div.card-head", h("h3", { text: t.name }), h("div.spacer"),
        CMS.ui.badge(count + " checks", "blue"),
        t.default ? CMS.ui.badge("default", "green") : h("button.btn.btn-sm", { text: "Make default", onclick: function () {
          CMS.store.patch(function (s) { s.config.vhcTemplates.forEach(function (x, xi) { x.default = xi === i; }); });
          render();
        } })),
      h("p.muted", { text: "Photo required on: " + (t.requirePhotoOn || []).join(", ").toUpperCase() }),
      h("div", t.groups.map(function (g) {
        return h("div", { style: { padding: "6px 0", borderBottom: "1px solid var(--border)" } },
          h("strong", { text: g.name }),
          h("div.muted", { text: g.items.map(function (it) { return it.label + (it.measure ? " (" + it.measure + " " + it.unit + ")" : ""); }).join(" · ") }));
      }))));
  });
  pane.appendChild(jsonEditor("vhcTemplates", "Edit the templates",
    "Each group has items. An item may carry measure/unit plus amberBelow and redBelow, and the tablet then colours itself from the number the technician types."));
}

function setupMenus(pane) {
  pane.appendChild(h("div.card", h("h3", { text: "Service menus" }),
    h("p.muted", { text: "Where Infomedia Superservice is wired in these come from the decoded VIN. These are the fallbacks and the dealership's own menus." }),
    tableEditor("menus", [
      { key: "code", label: "Code" },
      { key: "title", label: "Title" },
      { key: "hours", label: "Hours", type: "number" },
      { key: "rateId", label: "Rate", options: function () { return CMS.cfg().money.labourRates.map(function (r) { return { value: r.id, label: r.label }; }); } },
    ], { id: CMS.uid("m"), code: "NEW", title: "New menu", hours: 1, rateId: "std", parts: [], franchise: "*" })));
  pane.appendChild(jsonEditor("menus", "Menu parts lists",
    "Each menu's `parts` array holds part numbers from the price file below."));
  pane.appendChild(h("div.card", h("h3", { text: "Parts price file" }),
    h("p.muted", { text: "Cost is what Evolve charges the dealership; list is the OEM catalogue price. Sell is worked out from the markup matrix." }),
    tableEditor("parts", [
      { key: "no", label: "Part number" },
      { key: "desc", label: "Description" },
      { key: "cost", label: "Cost", type: "number" },
      { key: "list", label: "OEM list", type: "number" },
      { key: "qty", label: "On hand", type: "number" },
      { key: "bin", label: "Bin" },
      { key: "supersededBy", label: "Superseded by" },
    ], { no: "NEW-PART", desc: "New part", cost: 100, list: 160, qty: 0, bin: "" })));
}

function setupMessages(pane) {
  pane.appendChild(h("div.card", h("h3", { text: "What we send" }),
    h("p.muted", { text: "Placeholders: {{name}} {{fullname}} {{ref}} {{reg}} {{dealer}} {{advisor}} {{link}} {{otp}} {{total}} {{time}}" })));
  Object.keys(CMS.cfg().messages).forEach(function (key) {
    var m = CMS.cfg().messages[key];
    var card = h("div.card", h("h4", { text: m.label || key }));
    ["sms", "whatsapp", "email"].forEach(function (ch) {
      if (m[ch] == null) return;
      card.appendChild(cfgInput(ch === "sms" ? "SMS" : ch === "email" ? "E-mail" : "WhatsApp", "messages." + key + "." + ch, { textarea: true }));
    });
    pane.appendChild(card);
  });
}

function setupAuth(pane) {
  pane.appendChild(h("div.card",
    h("h3", { text: "How customers approve work" }),
    cfgToggle("Require a one-time code", "authorisation.otpRequired", "The code goes in the same message as the link."),
    cfgToggle("Require a signature", "authorisation.signatureRequired", "Drawn with a finger on a phone."),
    cfgToggle("Let them approve item by item", "authorisation.allowPartialApproval", "Off means all or nothing."),
    cfgToggle("Ask why when they decline", "authorisation.declineReasonRequired"),
    h("div.grid-3",
      cfgInput("Code length", "authorisation.otpLength", { type: "number" }),
      cfgInput("Link expires after (hours)", "authorisation.linkExpiryHours", { type: "number" }),
      cfgInput("Re-authorise anything above", "authorisation.reAuthoriseAbove", { type: "number" })),
    cfgInput("Terms shown above the signature", "authorisation.terms", { textarea: true })));
}

function setupIntegrations(pane) {
  pane.appendChild(h("div.card",
    h("h3", { text: "Evolve DMS" }),
    h("p.muted", { text: "Evolve is the financial system of record. CMS posts the job card when it opens and the invoice when it is finalised." }),
    cfgToggle("Enabled", "integrations.evolve.enabled"),
    cfgToggle("Post the job card when it opens", "integrations.evolve.postOnOpen"),
    cfgToggle("Post the invoice when it is finalised", "integrations.evolve.postOnInvoice"),
    h("div.grid-2",
      cfgInput("Endpoint", "integrations.evolve.endpoint"),
      cfgInput("Dealer account", "integrations.evolve.dealerAccount"))));
  pane.appendChild(h("div.card",
    h("h3", { text: "Infomedia" }),
    h("p.muted", { text: "Superservice Menus needs a VIN that decodes, the franchise's brand code, and a labour rate plus a parts pricing rule. Miss any one and the menu loads without prices or comes back empty." }),
    cfgToggle("Enabled", "integrations.infomedia.enabled"),
    cfgToggle("Service menus", "integrations.infomedia.menusEnabled"),
    cfgToggle("Intelligent Catalog", "integrations.infomedia.catalogueEnabled"),
    h("div.grid-2",
      cfgInput("Brand code", "integrations.infomedia.brandCode"),
      cfgInput("Menu cache (hours)", "integrations.infomedia.cacheHours", { type: "number" }))));
  pane.appendChild(h("div.card",
    h("h3", { text: "Messaging" }),
    h("div.grid-3",
      cfgInput("SMS provider", "integrations.messaging.smsProvider"),
      cfgInput("WhatsApp provider", "integrations.messaging.whatsappProvider"),
      cfgInput("Sender name", "integrations.messaging.fromName"))));

  var sim = CMS.db().simulate || {};
  var cb = h("input", { type: "checkbox" });
  cb.checked = !!sim.postingFailure;
  cb.addEventListener("change", function () {
    CMS.store.patch(function (s) { s.simulate = s.simulate || {}; s.simulate.postingFailure = cb.checked; });
    CMS.ui.toast(cb.checked ? "Posting will now fail — for training" : "Posting back to normal", "warn");
  });
  var reason = h("input", { type: "text", value: sim.postingReason || "Debtor account on hold" });
  reason.addEventListener("change", function () {
    CMS.store.patch(function (s) { s.simulate.postingReason = reason.value; });
  });
  pane.appendChild(h("div.card",
    h("h3", { text: "Training switches" }),
    h("p.muted", { text: "For showing a dealership what a failure looks like without breaking anything." }),
    h("label.checkline", cb, h("span", { text: "Make the next Evolve post fail" })),
    CMS.ui.field("Failure reason", reason)));
}

function setupData(pane) {
  pane.appendChild(h("div.card",
    h("h3", { text: "Dealer profile" }),
    h("p.muted", { text: "Everything on these Setup tabs travels in one file — set a dealership up once, then carry it to the next rollout." }),
    h("div.btn-row",
      h("button.btn.btn-primary", { text: "Export this dealership", onclick: function () {
        CMS.ui.download("cms-workshop-" + CMS.cfg().dealer.dealerCode + ".json", CMS.exportProfile());
        CMS.ui.toast("Profile downloaded", "ok");
      } }),
      h("button.btn", { text: "Import a profile", onclick: function () {
        var ta = h("textarea", { placeholder: "Paste the profile JSON here", style: { minHeight: "220px" } });
        var file = h("input", { type: "file", accept: "application/json" });
        file.addEventListener("change", function () {
          var f = file.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () { ta.value = r.result; };
          r.readAsText(f);
        });
        CMS.ui.modal("Import a dealer profile", h("div", file, ta), [
          h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
          h("button.btn.btn-primary", { text: "Import", onclick: function () {
            try { CMS.importProfile(ta.value); CMS.ui.closeOverlays(); CMS.ui.toast("Profile imported", "ok"); render(); }
            catch (e) { CMS.ui.toast(e.message, "err"); }
          } })]);
      } }))));

  var counts = CMS.db();
  pane.appendChild(h("div.card",
    h("h3", { text: "This installation" }),
    h("div.kpis",
      CMS.ui.kpi(CMS.t("jobs"), counts.jobs.length, ""),
      CMS.ui.kpi("Customers", counts.customers.length, ""),
      CMS.ui.kpi("Vehicles", counts.vehicles.length, ""),
      CMS.ui.kpi("Storage", Math.round((JSON.stringify(counts).length / 1024)) + " KB", "in this browser")),
    h("p.muted", { text: "Everything lives in this browser — nothing leaves the machine. Clearing the browser's site data clears this too, so export anything you want to keep." }),
    h("div.btn-row",
      h("button.btn", { text: "Download everything as JSON", onclick: function () {
        CMS.ui.download("cms-workshop-data-" + CMS.todayISO() + ".json", JSON.stringify(CMS.db(), null, 2));
      } }),
      h("button.btn", { text: "Reset the demo dealership", onclick: function () {
        CMS.ui.confirm("Reset the demo", "This puts the demo workshop back the way it started. Any bookings you made here are lost.", function () {
          CMS.store.resetDemo(); CMS.ui.toast("Demo reset", "ok"); location.hash = "#/dashboard"; render();
        }, "Reset");
      } }),
      h("button.btn.btn-danger", { text: "Clear everything for a live setup", onclick: function () {
        CMS.ui.confirm("Clear everything", "Removes all demo customers, vehicles and job cards and leaves the configuration as it is. Use this before going live at a dealership.", function () {
          CMS.store.patch(function (s) { s.customers = []; s.vehicles = []; s.jobs = []; s.drafts = []; s.seq = { job: 1000, invoice: 5000, vhc: 100 }; });
          CMS.ui.toast("Cleared — the dealership is empty and ready", "ok");
          location.hash = "#/dashboard"; render();
        }, "Clear everything");
      } }))));
}

/* ---------- go ---------- */
document.addEventListener("DOMContentLoaded", boot);
