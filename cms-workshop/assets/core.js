/* ============================================================
   CMS Workshop — shared core
   The one copy of the rules. The staff console, the workshop app
   and the customer link all read and write through here, so a
   change made on any surface shows up on the others immediately.
   ============================================================ */
window.CMS = window.CMS || {};
var CMS = window.CMS;

CMS.KEY = "cms.workshop.v1";
CMS.CHANNEL = "cms-workshop-sync";

/* ---------- small helpers ---------- */
CMS.uid = function (p) { return (p || "id") + "-" + Math.random().toString(36).slice(2, 9); };
CMS.nowISO = function () { return new Date().toISOString(); };
CMS.todayISO = function () { return new Date().toISOString().slice(0, 10); };
CMS.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
CMS.esc = function (s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
};
CMS.round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
CMS.clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

CMS.money = function (n, opts) {
  var c = CMS.cfg().money;
  var v = CMS.round2(n);
  var s = (opts && opts.noSymbol ? "" : c.symbol + " ") +
    Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (v < 0 ? "-" : "") + s;
};

CMS.fmtDate = function (iso) {
  if (!iso) return "—";
  var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
};
CMS.fmtDay = function (iso) {
  if (!iso) return "—";
  var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
};
CMS.fmtTime = function (iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
};
CMS.fmtDateTime = function (iso) { return iso ? CMS.fmtDate(iso) + " " + CMS.fmtTime(iso) : "—"; };
CMS.relTime = function (iso) {
  if (!iso) return "";
  var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  var h = Math.floor(mins / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
};
CMS.addMin = function (hhmm, mins) {
  var p = hhmm.split(":"), t = (+p[0]) * 60 + (+p[1]) + mins;
  return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
};
CMS.hhmmToMin = function (hhmm) { var p = String(hhmm).split(":"); return (+p[0]) * 60 + (+p[1] || 0); };

/* South African mobile: 10 digits starting 0, or +27 then 9. */
CMS.normaliseMobile = function (v) {
  var d = String(v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+27")) d = "0" + d.slice(3);
  else if (d.startsWith("27") && d.length === 11) d = "0" + d.slice(2);
  return d;
};
CMS.validMobile = function (v) { return /^0\d{9}$/.test(CMS.normaliseMobile(v)); };
CMS.validEmail = function (v) { return !v || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v).trim()); };
CMS.validVin = function (v) { return /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(v || "").trim()); };
CMS.validReg = function (v) { return String(v || "").trim().length >= 4; };

/* ---------- store ---------- */
CMS.store = {
  state: null,
  _subs: [],
  _bc: null,

  init: function () {
    if (this.state) return this.state;
    var raw = null;
    try { raw = localStorage.getItem(CMS.KEY); } catch (e) { raw = null; }
    if (raw) {
      try { this.state = JSON.parse(raw); } catch (e) { this.state = null; }
    }
    if (!this.state || !this.state.config) this.state = CMS.buildInitialState();
    /* Config gains keys as the product grows; fill in anything a
       saved dealership has never seen without touching their edits. */
    this.state.config = CMS.mergeDefaults(this.state.config, CMS.DEFAULT_CONFIG);
    try {
      this._bc = new BroadcastChannel(CMS.CHANNEL);
      var self = this;
      this._bc.onmessage = function (ev) {
        if (ev.data && ev.data.type === "state") { self._reload(); }
      };
    } catch (e) { /* older browser: falls back to the storage event */ }
    var self2 = this;
    window.addEventListener("storage", function (e) {
      if (e.key === CMS.KEY) self2._reload();
    });
    return this.state;
  },

  _reload: function () {
    try {
      var raw = localStorage.getItem(CMS.KEY);
      if (raw) { this.state = JSON.parse(raw); this.state.config = CMS.mergeDefaults(this.state.config, CMS.DEFAULT_CONFIG); }
    } catch (e) { }
    this._subs.forEach(function (f) { try { f("remote"); } catch (e) { console.error(e); } });
  },

  save: function (reason) {
    try { localStorage.setItem(CMS.KEY, JSON.stringify(this.state)); }
    catch (e) { console.warn("Could not save — storage full or blocked", e); }
    if (this._bc) { try { this._bc.postMessage({ type: "state", at: Date.now() }); } catch (e) { } }
    this._subs.forEach(function (f) { try { f(reason || "local"); } catch (e) { console.error(e); } });
  },

  sub: function (fn) { this._subs.push(fn); return function () { }; },

  /* Mutate then persist in one call: CMS.store.patch(s => {...}) */
  patch: function (fn, reason) {
    var r = fn(this.state);
    this.save(reason);
    return r;
  },

  resetDemo: function () {
    this.state = CMS.buildInitialState();
    this.save("reset");
  },

  wipe: function () {
    try { localStorage.removeItem(CMS.KEY); } catch (e) { }
    this.state = null;
    this.init();
    this.save("wipe");
  },
};

/* Deep-merge saved config over defaults; arrays are taken whole
   from the saved copy so a dealership's edited lists stay theirs. */
CMS.mergeDefaults = function (saved, defaults) {
  var out = CMS.clone(defaults);
  if (!saved) return out;
  Object.keys(saved).forEach(function (k) {
    var sv = saved[k], dv = out[k];
    if (Array.isArray(sv) || sv === null || typeof sv !== "object" || dv === undefined || typeof dv !== "object" || Array.isArray(dv)) {
      out[k] = sv;
    } else {
      out[k] = CMS.mergeDefaults(sv, dv);
    }
  });
  return out;
};

/* ---------- config accessors ---------- */
CMS.cfg = function () { return CMS.store.init().config; };
CMS.db = function () { return CMS.store.init(); };

CMS.t = function (key, fallback) {
  var terms = CMS.cfg().terms || {};
  return terms[key] || fallback || key;
};
CMS.person = function (id) {
  return CMS.cfg().people.filter(function (p) { return p.id === id; })[0] || null;
};
CMS.peopleByRole = function (role) {
  return CMS.cfg().people.filter(function (p) { return p.role === role && p.active !== false; });
};
CMS.roleOf = function (user) { return (CMS.cfg().roles || {})[user && user.role] || { label: user && user.role, nav: [], can: [] }; };
CMS.can = function (user, perm) {
  if (!user) return false;
  var r = CMS.roleOf(user);
  return (r.can || []).indexOf("*") >= 0 || (r.can || []).indexOf(perm) >= 0;
};
CMS.status = function (id) {
  return CMS.cfg().statuses.filter(function (s) { return s.id === id; })[0] ||
    { id: id, label: id, tone: "grey", stage: "working" };
};
CMS.feature = function (name) { return !!(CMS.cfg().features || {})[name]; };

CMS.prefs = function (userId) {
  var db = CMS.db();
  db.prefs = db.prefs || {};
  if (!db.prefs[userId]) db.prefs[userId] = CMS.clone(CMS.cfg().prefDefaults);
  return Object.assign({}, CMS.cfg().prefDefaults, db.prefs[userId]);
};
CMS.setPref = function (userId, key, value) {
  CMS.store.patch(function (s) {
    s.prefs = s.prefs || {};
    s.prefs[userId] = Object.assign({}, CMS.cfg().prefDefaults, s.prefs[userId] || {});
    s.prefs[userId][key] = value;
  });
};

/* Applies a user's look-and-feel to the current document. */
CMS.applyPrefs = function (userId) {
  var p = CMS.prefs(userId || "guest");
  var theme = p.theme;
  if (theme === "auto") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-density", p.density || "comfortable");
  document.documentElement.setAttribute("data-rag", p.rag || "standard");
  return p;
};

/* ---------- pricing ---------- */
CMS.labourRate = function (rateId) {
  var m = CMS.cfg().money;
  var r = m.labourRates.filter(function (x) { return x.id === (rateId || m.defaultLabourRateId); })[0];
  return r ? r.rate : (m.labourRates[0] ? m.labourRates[0].rate : 0);
};
CMS.markupPct = function (cost) {
  var bands = CMS.cfg().money.partsMarkup || [];
  for (var i = 0; i < bands.length; i++) {
    if (bands[i].upTo === null || cost <= bands[i].upTo) return bands[i].pct;
  }
  return 0;
};
CMS.part = function (no) {
  return CMS.cfg().parts.filter(function (p) { return p.no === no; })[0] || null;
};
/* Sell price = Evolve price-file cost + franchise markup. VAT is
   added for display only, never stored on the line. */
CMS.partSell = function (no) {
  var p = CMS.part(no);
  if (!p) return 0;
  return CMS.round2(p.cost * (1 + CMS.markupPct(p.cost) / 100));
};
CMS.withVat = function (n) { return CMS.round2(n * (1 + CMS.cfg().money.vatRate / 100)); };

CMS.lineNet = function (line) {
  if (line.kind === "labour") return CMS.round2((line.hours || 0) * (line.rate || CMS.labourRate(line.rateId)));
  return CMS.round2((line.qty || 1) * (line.unitPrice || 0));
};

/* Totals for a set of lines. `only` filters by authStatus. */
CMS.totals = function (lines, only) {
  var sel = (lines || []).filter(function (l) {
    if (!only) return true;
    if (only === "billable") return l.authStatus !== "declined";
    return l.authStatus === only;
  });
  var net = sel.reduce(function (a, l) { return a + CMS.lineNet(l); }, 0);
  var m = CMS.cfg().money;
  var sundries = Math.min(CMS.round2(net * (m.sundriesPct || 0) / 100), m.sundriesCap || 0);
  var vat = CMS.round2((net + sundries) * m.vatRate / 100);
  return {
    count: sel.length,
    net: CMS.round2(net),
    sundries: sundries,
    vat: vat,
    gross: CMS.round2(net + sundries + vat),
    labourHours: CMS.round2(sel.filter(function (l) { return l.kind === "labour"; })
      .reduce(function (a, l) { return a + (l.hours || 0); }, 0)),
  };
};

/* ---------- references ---------- */
CMS.nextRef = function (kind) {
  return CMS.store.patch(function (s) {
    s.seq = s.seq || { job: 1000, invoice: 5000, vhc: 100 };
    s.seq[kind] = (s.seq[kind] || 1000) + 1;
    var prefix = { job: "JC", invoice: "INV", vhc: "VHC" }[kind] || "REF";
    return prefix + "-" + s.seq[kind];
  });
};

/* ---------- customers & vehicles ---------- */
CMS.customer = function (id) { return CMS.db().customers.filter(function (c) { return c.id === id; })[0] || null; };
CMS.vehicle = function (id) { return CMS.db().vehicles.filter(function (v) { return v.id === id; })[0] || null; };

CMS.upsertCustomer = function (c) {
  return CMS.store.patch(function (s) {
    if (c.id) {
      var i = s.customers.findIndex(function (x) { return x.id === c.id; });
      if (i >= 0) { s.customers[i] = Object.assign(s.customers[i], c); return s.customers[i]; }
    }
    c.id = c.id || CMS.uid("cust");
    c.createdAt = CMS.nowISO();
    c.mobile = CMS.normaliseMobile(c.mobile);
    s.customers.push(c);
    return c;
  });
};
CMS.upsertVehicle = function (v) {
  return CMS.store.patch(function (s) {
    if (v.id) {
      var i = s.vehicles.findIndex(function (x) { return x.id === v.id; });
      if (i >= 0) { s.vehicles[i] = Object.assign(s.vehicles[i], v); return s.vehicles[i]; }
    }
    v.id = v.id || CMS.uid("veh");
    v.reg = String(v.reg || "").toUpperCase().trim();
    s.vehicles.push(v);
    return v;
  });
};

/* Stands in for the Superservice VIN decode. A 17-character VIN
   that passes the check digit-ish test returns a model; anything
   else comes back undecoded, which is what makes the menu empty. */
CMS.decodeVin = function (vin) {
  if (!CMS.validVin(vin)) return { ok: false, reason: "VIN must be 17 characters (no I, O or Q)." };
  var makes = ["Volkswagen", "Toyota", "Ford", "Hyundai", "Isuzu", "BMW", "Mercedes-Benz", "Suzuki"];
  var models = ["Polo Vivo 1.4", "Hilux 2.8 GD-6", "Ranger 2.0 SiT", "i20 1.2", "D-Max 250", "320i", "C200", "Swift 1.2"];
  var n = vin.toUpperCase().split("").reduce(function (a, ch) { return a + ch.charCodeAt(0); }, 0) % makes.length;
  var yr = 2016 + (vin.charCodeAt(9) % 9);
  return { ok: true, make: makes[n], model: models[n], year: yr, engine: ["1.4 TSI", "2.8 D", "2.0 D", "1.2 P"][n % 4] };
};

/* ---------- jobs ---------- */
CMS.jobs = function () { return CMS.db().jobs; };
CMS.job = function (id) { return CMS.db().jobs.filter(function (j) { return j.id === id; })[0] || null; };
CMS.jobByToken = function (tok) {
  return CMS.db().jobs.filter(function (j) { return j.auth && j.auth.token === tok; })[0] || null;
};

CMS.log = function (job, what, who) {
  job.timeline = job.timeline || [];
  job.timeline.unshift({ at: CMS.nowISO(), who: who || "system", what: what });
};

CMS.createJob = function (data) {
  return CMS.store.patch(function (s) {
    var job = Object.assign({
      id: CMS.uid("job"),
      ref: CMS.nextRef("job"),
      createdAt: CMS.nowISO(),
      status: "booked",
      lines: [],
      requested: [],
      notes: [],
      timeline: [],
      time: [],
      posting: [],
      partsRequests: [],
      vhc: null,
      auth: null,
      invoice: null,
    }, data);
    job.auth = job.auth || { token: CMS.uid("t").replace("t-", ""), sent: [], lines: [] };
    CMS.log(job, "Booking created", data.createdBy || "system");
    s.jobs.unshift(job);
    return job;
  });
};

/* Returns whatever the mutator returns — the send-log entry, the
   posting result, the new line — and the job itself when it
   returns nothing. Callers report outcomes from this, so it has
   to be the thing that happened, not the job it happened to. */
CMS.updateJob = function (id, fn, reason) {
  return CMS.store.patch(function (s) {
    var j = s.jobs.filter(function (x) { return x.id === id; })[0];
    if (!j) return null;
    var out = fn(j);
    j.updatedAt = CMS.nowISO();
    return out === undefined ? j : out;
  }, reason);
};

CMS.setStatus = function (id, statusId, who) {
  return CMS.updateJob(id, function (j) {
    if (j.status === statusId) return;
    j.status = statusId;
    CMS.log(j, "Status → " + CMS.status(statusId).label, who);
    if (statusId === "arrived" && !j.arrivedAt) j.arrivedAt = CMS.nowISO();
    if (statusId === "ready" && !j.readyAt) j.readyAt = CMS.nowISO();
    if (statusId === "collected" && !j.collectedAt) j.collectedAt = CMS.nowISO();
  });
};

CMS.addLine = function (id, line, who) {
  return CMS.updateJob(id, function (j) {
    var l = Object.assign({
      id: CMS.uid("ln"),
      kind: "labour",
      qty: 1,
      authStatus: "not_required",
      addedAt: CMS.nowISO(),
      source: "manual",
    }, line);
    if (l.kind === "labour" && !l.rate) l.rate = CMS.labourRate(l.rateId);
    j.lines.push(l);
    CMS.log(j, "Added " + (l.kind === "labour" ? "labour" : "part") + ": " + l.title, who);
    return l;
  });
};
CMS.removeLine = function (id, lineId, who) {
  return CMS.updateJob(id, function (j) {
    var l = j.lines.filter(function (x) { return x.id === lineId; })[0];
    j.lines = j.lines.filter(function (x) { return x.id !== lineId; });
    if (l) CMS.log(j, "Removed: " + l.title, who);
  });
};

/* Expand a service menu into labour + parts lines. */
CMS.applyMenu = function (jobId, menuId, who, opts) {
  var menu = CMS.cfg().menus.filter(function (m) { return m.id === menuId; })[0];
  if (!menu) return null;
  var needAuth = opts && opts.needsAuth;
  CMS.addLine(jobId, {
    kind: "labour", source: "menu", code: menu.code, title: menu.title,
    hours: menu.hours, rateId: menu.rateId, rate: CMS.labourRate(menu.rateId),
    authStatus: needAuth ? "pending" : "not_required",
  }, who);
  (menu.parts || []).forEach(function (no) {
    var p = CMS.part(no);
    if (!p) return;
    CMS.addLine(jobId, {
      kind: "part", source: "menu", code: no, title: p.desc, qty: 1,
      unitPrice: CMS.partSell(no), cost: p.cost,
      authStatus: needAuth ? "pending" : "not_required",
    }, who);
  });
  return menu;
};

/* ---------- eVHC ---------- */
CMS.startVhc = function (jobId, templateId, techId) {
  var tpl = CMS.cfg().vhcTemplates.filter(function (t) { return t.id === templateId; })[0] ||
    CMS.cfg().vhcTemplates[0];
  return CMS.updateJob(jobId, function (j) {
    if (j.vhc && !j.vhc.completedAt) return;
    var items = [];
    tpl.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        items.push({
          id: it.id, group: g.name, label: it.label, rag: "", note: "",
          measure: it.measure || "", unit: it.unit || "",
          amberBelow: it.amberBelow, redBelow: it.redBelow,
          value: "", photos: [],
        });
      });
    });
    j.vhc = {
      ref: CMS.nextRef("vhc"), templateId: tpl.id, templateName: tpl.name,
      requirePhotoOn: tpl.requirePhotoOn || ["r"],
      techId: techId, startedAt: CMS.nowISO(), completedAt: null, items: items,
    };
    CMS.log(j, CMS.t("vhc") + " started (" + tpl.name + ")", techId);
  });
};

/* A measurement decides its own colour when thresholds exist. */
CMS.ragFromMeasure = function (item, value) {
  var v = parseFloat(value);
  if (isNaN(v)) return "";
  if (item.redBelow != null && v <= item.redBelow) return "r";
  if (item.amberBelow != null && v <= item.amberBelow) return "a";
  return "g";
};

CMS.vhcSummary = function (job) {
  var out = { r: 0, a: 0, g: 0, n: 0, total: 0, done: 0, missingPhotos: 0 };
  if (!job || !job.vhc) return out;
  var need = job.vhc.requirePhotoOn || [];
  job.vhc.items.forEach(function (it) {
    out.total++;
    if (it.rag) { out.done++; out[it.rag]++; } else { out.n++; }
    if (it.rag && need.indexOf(it.rag) >= 0 && (!it.photos || !it.photos.length)) out.missingPhotos++;
  });
  return out;
};

CMS.completeVhc = function (jobId, techId) {
  return CMS.updateJob(jobId, function (j) {
    if (!j.vhc) return;
    j.vhc.completedAt = CMS.nowISO();
    var s = CMS.vhcSummary(j);
    CMS.log(j, CMS.t("vhc") + " completed — " + s.r + " red, " + s.a + " amber, " + s.g + " green", techId);
  });
};

/* ---------- authorisation ---------- */
CMS.otp = function () {
  var n = CMS.cfg().authorisation.otpLength || 4;
  var s = "";
  for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
};

CMS.customerLink = function (job, base) {
  var root = base || (location.href.replace(/[^/]*$/, ""));
  return root + "customer.html#" + job.auth.token;
};

CMS.renderTemplate = function (text, job) {
  var cust = CMS.customer(job.customerId) || {};
  var veh = CMS.vehicle(job.vehicleId) || {};
  var adv = CMS.person(job.advisorId) || {};
  var d = CMS.cfg().dealer;
  var pending = CMS.totals(job.lines, "pending");
  var map = {
    name: (cust.name || "").split(" ")[0] || "there",
    fullname: cust.name || "",
    ref: job.ref,
    reg: veh.reg || "",
    dealer: d.name,
    advisor: adv.name || d.name,
    link: CMS.customerLink(job),
    otp: (job.auth && job.auth.otp) || "----",
    total: CMS.money(pending.gross),
    time: job.slot ? CMS.fmtDay(job.slot.date) + " " + job.slot.start : "",
  };
  return String(text).replace(/\{\{(\w+)\}\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
};

/* Queue an approval request. Returns the message that would go
   out so the advisor can see exactly what the customer receives. */
CMS.sendAuth = function (jobId, channel, who) {
  var pol = CMS.cfg().authorisation;
  return CMS.updateJob(jobId, function (j) {
    var cust = CMS.customer(j.customerId) || {};
    j.auth = j.auth || { token: CMS.uid("t").replace("t-", ""), sent: [] };
    j.auth.otp = pol.otpRequired ? CMS.otp() : null;
    j.auth.otpVerifiedAt = null;
    j.auth.expiresAt = new Date(Date.now() + (pol.linkExpiryHours || 48) * 3600e3).toISOString();
    j.auth.method = "link";
    j.auth.requestedAt = CMS.nowISO();
    j.auth.requestedBy = who;
    var to = channel === "email" ? (cust.email || "") : (cust.mobile || "");
    var body = CMS.renderTemplate((CMS.cfg().messages.auth_request || {})[channel] || "", j);
    var entry = {
      id: CMS.uid("msg"), channel: channel, to: to, at: CMS.nowISO(),
      status: to ? "queued" : "failed",
      reason: to ? "" : (channel === "email" ? "No e-mail address on the customer" : "No mobile number on the customer"),
      body: body, kind: "auth_request",
    };
    j.auth.sent = j.auth.sent || [];
    j.auth.sent.unshift(entry);
    if (to) {
      /* Delivery receipts arrive a moment later in real life; the
         demo walks the same queued → sent → delivered path. */
      setTimeout(function () {
        CMS.updateJob(jobId, function (jj) {
          var e = (jj.auth.sent || []).filter(function (x) { return x.id === entry.id; })[0];
          if (e) e.status = "sent";
        });
      }, 700);
      setTimeout(function () {
        CMS.updateJob(jobId, function (jj) {
          var e = (jj.auth.sent || []).filter(function (x) { return x.id === entry.id; })[0];
          if (e) e.status = "delivered";
        });
      }, 2200);
    }
    j.lines.forEach(function (l) { if (l.authStatus === "not_required" && l.needsAuth) l.authStatus = "pending"; });
    if (j.status !== "awaiting_auth") { j.status = "awaiting_auth"; }
    CMS.log(j, "Approval request " + (to ? "sent by " + channel + " to " + to : "failed — " + entry.reason), who);
    return entry;
  });
};

CMS.verifyOtp = function (token, code) {
  var job = CMS.jobByToken(token);
  if (!job) return { ok: false, reason: "This link is not valid." };
  if (job.auth.expiresAt && new Date(job.auth.expiresAt) < new Date()) {
    return { ok: false, reason: "This link has expired. Please phone us and we will send a new one." };
  }
  if (!CMS.cfg().authorisation.otpRequired) return { ok: true };
  if (String(code).trim() !== String(job.auth.otp)) return { ok: false, reason: "That code does not match. Check the message we sent you." };
  CMS.updateJob(job.id, function (j) { j.auth.otpVerifiedAt = CMS.nowISO(); CMS.log(j, "Customer opened the link and verified the code", "customer"); });
  return { ok: true };
};

CMS.setLineDecision = function (jobId, lineId, decision, who) {
  return CMS.updateJob(jobId, function (j) {
    var l = j.lines.filter(function (x) { return x.id === lineId; })[0];
    if (!l) return;
    l.authStatus = decision;
    l.decidedAt = CMS.nowISO();
  });
};

CMS.submitAuthorisation = function (jobId, payload) {
  return CMS.updateJob(jobId, function (j) {
    j.auth.signature = payload.signature || null;
    j.auth.signedName = payload.name || "";
    j.auth.signedAt = CMS.nowISO();
    j.auth.method = payload.method || "link";
    var ap = j.lines.filter(function (l) { return l.authStatus === "approved"; });
    var dc = j.lines.filter(function (l) { return l.authStatus === "declined"; });
    var t = CMS.totals(ap);
    CMS.log(j, "Customer authorised " + ap.length + " item(s) totalling " + CMS.money(t.gross) +
      (dc.length ? ", declined " + dc.length : "") + (payload.method === "phone" ? " (by telephone)" : ""), payload.by || "customer");
    j.status = ap.length ? "in_progress" : "work_complete";
  });
};

/* Telephone fallback for when messaging is down. */
CMS.authoriseByPhone = function (jobId, who, callNote) {
  return CMS.updateJob(jobId, function (j) {
    j.auth = j.auth || {};
    j.auth.phoneNote = callNote;
    j.auth.phoneAt = CMS.nowISO();
    j.auth.method = "phone";
    j.auth.signedName = "Verbal — " + (callNote || "");
    j.auth.signedAt = CMS.nowISO();
    j.lines.forEach(function (l) { if (l.authStatus === "pending") l.authStatus = "approved"; });
    j.status = "in_progress";
    CMS.log(j, "Authorised by telephone — " + (callNote || "verbal approval recorded"), who);
  });
};

/* ---------- clocking ---------- */
CMS.clockOn = function (jobId, techId) {
  return CMS.updateJob(jobId, function (j) {
    (j.time = j.time || []).push({ id: CMS.uid("tm"), techId: techId, start: CMS.nowISO(), end: null });
    if (j.status === "booked" || j.status === "arrived") j.status = "in_progress";
    CMS.log(j, "Clocked on", techId);
  });
};
CMS.clockOff = function (jobId, techId) {
  return CMS.updateJob(jobId, function (j) {
    var open = (j.time || []).filter(function (t) { return t.techId === techId && !t.end; })[0];
    if (open) { open.end = CMS.nowISO(); CMS.log(j, "Clocked off", techId); }
  });
};
CMS.isClockedOn = function (job, techId) {
  return !!(job.time || []).filter(function (t) { return t.techId === techId && !t.end; })[0];
};
CMS.clockedMinutes = function (job, techId) {
  return (job.time || []).reduce(function (a, t) {
    if (techId && t.techId !== techId) return a;
    var end = t.end ? new Date(t.end) : new Date();
    return a + (end - new Date(t.start)) / 60000;
  }, 0);
};

/* ---------- parts ---------- */
CMS.requestParts = function (jobId, items, who, note) {
  return CMS.updateJob(jobId, function (j) {
    var req = {
      id: CMS.uid("pr"), at: CMS.nowISO(), by: who, note: note || "",
      status: "requested", items: items,
    };
    (j.partsRequests = j.partsRequests || []).unshift(req);
    CMS.log(j, "Parts requested: " + items.map(function (i) { return i.qty + "× " + i.no; }).join(", "), who);
    return req;
  });
};
CMS.fulfilParts = function (jobId, reqId, status, who) {
  return CMS.updateJob(jobId, function (j) {
    var r = (j.partsRequests || []).filter(function (x) { return x.id === reqId; })[0];
    if (!r) return;
    r.status = status;
    r.handledAt = CMS.nowISO();
    r.handledBy = who;
    if (status === "issued") {
      r.items.forEach(function (it) {
        var p = CMS.part(it.no);
        j.lines.push({
          id: CMS.uid("ln"), kind: "part", source: "parts", code: it.no,
          title: (p && p.desc) || it.no, qty: it.qty,
          unitPrice: CMS.partSell(it.no), cost: p ? p.cost : 0,
          authStatus: "not_required", addedAt: CMS.nowISO(),
        });
      });
      if (j.status === "parts_hold") j.status = "in_progress";
    }
    if (status === "backorder") j.status = "parts_hold";
    CMS.log(j, "Parts request " + status, who);
  });
};

/* ---------- Evolve DMS posting (simulated) ---------- */
CMS.postToEvolve = function (jobId, kind, who) {
  var sim = CMS.db().simulate || {};
  return CMS.updateJob(jobId, function (j) {
    var fail = sim.postingFailure;
    var entry = {
      id: CMS.uid("post"), at: CMS.nowISO(), kind: kind, by: who,
      status: fail ? "failed" : "posted",
      response: fail
        ? (sim.postingReason || "Debtor account on hold")
        : "Evolve accepted — " + (kind === "invoice" ? "invoice " + (j.invoice ? j.invoice.no : j.ref) : "RO " + j.ref),
    };
    (j.posting = j.posting || []).unshift(entry);
    CMS.log(j, "Evolve " + kind + " post " + entry.status + " — " + entry.response, who);
    return entry;
  });
};

CMS.invoiceJob = function (jobId, who) {
  return CMS.updateJob(jobId, function (j) {
    if (j.invoice) return j.invoice;
    var t = CMS.totals(j.lines, "billable");
    j.invoice = { no: CMS.nextRef("invoice"), at: CMS.nowISO(), by: who, total: t.gross, net: t.net, vat: t.vat };
    j.status = "invoiced";
    CMS.log(j, "Invoiced " + j.invoice.no + " — " + CMS.money(t.gross), who);
    return j.invoice;
  });
};

/* ---------- diary ---------- */
CMS.isOpenDay = function (dateISO) {
  var d = CMS.cfg().diary;
  return (d.days || []).indexOf(new Date(dateISO + "T00:00:00").getDay()) >= 0;
};
/* The next day the workshop actually takes work, walking forwards
   (dir 1) or backwards (dir -1). Falls back after a fortnight so a
   badly configured diary cannot loop for ever. */
CMS.nextOpenDay = function (fromISO, dir) {
  var d = fromISO, step = dir || 1;
  for (var i = 0; i < 14; i++) {
    if (CMS.isOpenDay(d)) return d;
    d = new Date(new Date(d + "T00:00:00").getTime() + step * 86400e3).toISOString().slice(0, 10);
  }
  return fromISO;
};
/* What the workshop screens should be showing. On a Sunday, or
   before the first open day of a long weekend, that is the next
   working day rather than an empty board. */
CMS.workingDate = function () { return CMS.nextOpenDay(CMS.todayISO(), 1); };

CMS.slotsForDay = function (dateISO) {
  var d = CMS.cfg().diary;
  var day = new Date(dateISO + "T00:00:00").getDay();
  if (d.days.indexOf(day) < 0) return [];
  var close = day === 6 ? (d.saturdayClose || d.close) : d.close;
  var out = [], t = d.open;
  while (CMS.hhmmToMin(t) < CMS.hhmmToMin(close)) { out.push(t); t = CMS.addMin(t, d.slotMinutes); }
  return out;
};
CMS.jobsOn = function (dateISO) {
  return CMS.jobs().filter(function (j) { return j.slot && j.slot.date === dateISO; });
};
CMS.slotLoad = function (dateISO, hhmm) {
  return CMS.jobsOn(dateISO).filter(function (j) { return j.slot.start === hhmm; }).length;
};
CMS.dayLoadHours = function (dateISO) {
  return CMS.round2(CMS.jobsOn(dateISO).reduce(function (a, j) {
    return a + ((j.slot.durationMin || CMS.cfg().diary.defaultDurationMin) / 60);
  }, 0));
};

/* ---------- reporting ---------- */
CMS.kpis = function (fromISO, toISO) {
  var jobs = CMS.jobs().filter(function (j) {
    var d = (j.slot && j.slot.date) || j.createdAt.slice(0, 10);
    return (!fromISO || d >= fromISO) && (!toISO || d <= toISO);
  });
  var vhcDone = jobs.filter(function (j) { return j.vhc && j.vhc.completedAt; });
  var redAmber = 0, sold = 0, presented = 0;
  jobs.forEach(function (j) {
    var s = CMS.vhcSummary(j);
    redAmber += s.r + s.a;
    j.lines.forEach(function (l) {
      if (l.authStatus === "approved") sold += CMS.lineNet(l);
      if (l.authStatus === "approved" || l.authStatus === "declined" || l.authStatus === "pending") presented += CMS.lineNet(l);
    });
  });
  var invoiced = jobs.filter(function (j) { return j.invoice; });
  var wip = jobs.filter(function (j) { return CMS.status(j.status).wip; });
  var hoursSold = jobs.reduce(function (a, j) {
    return a + j.lines.filter(function (l) { return l.kind === "labour" && l.authStatus !== "declined"; })
      .reduce(function (b, l) { return b + (l.hours || 0); }, 0);
  }, 0);
  var hoursClocked = jobs.reduce(function (a, j) { return a + CMS.clockedMinutes(j) / 60; }, 0);
  return {
    jobs: jobs.length,
    wip: wip.length,
    vhcRate: jobs.length ? Math.round(vhcDone.length / jobs.length * 100) : 0,
    redAmber: redAmber,
    upsellSold: CMS.round2(sold),
    upsellPresented: CMS.round2(presented),
    conversion: presented ? Math.round(sold / presented * 100) : 0,
    invoiced: invoiced.length,
    invoicedValue: CMS.round2(invoiced.reduce(function (a, j) { return a + j.invoice.total; }, 0)),
    avgRo: invoiced.length ? CMS.round2(invoiced.reduce(function (a, j) { return a + j.invoice.total; }, 0) / invoiced.length) : 0,
    hoursSold: CMS.round2(hoursSold),
    hoursClocked: CMS.round2(hoursClocked),
    efficiency: hoursClocked ? Math.round(hoursSold / hoursClocked * 100) : 0,
    awaitingAuth: jobs.filter(function (j) { return j.status === "awaiting_auth"; }).length,
    partsHold: jobs.filter(function (j) { return j.status === "parts_hold"; }).length,
  };
};

/* ---------- dealer profile import / export ---------- */
CMS.exportProfile = function () {
  return JSON.stringify({ kind: "cms-workshop-dealer-profile", v: 1, exportedAt: CMS.nowISO(), config: CMS.cfg() }, null, 2);
};
CMS.importProfile = function (json) {
  var parsed = JSON.parse(json);
  var cfg = parsed.config || parsed;
  if (!cfg.dealer || !cfg.statuses) throw new Error("That file is not a dealer profile.");
  CMS.store.patch(function (s) { s.config = CMS.mergeDefaults(cfg, CMS.DEFAULT_CONFIG); });
  return true;
};
