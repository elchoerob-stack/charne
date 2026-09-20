/* ============================================================
   CMS Workshop — the customer link
   One page, opened from an SMS or WhatsApp on a phone, usually
   while the person is at work. It has to explain itself with no
   training at all: what we found, why it matters, what it costs,
   and a way to say yes or no to each item.
   ============================================================ */
var CMS = window.CMS;
var h = CMS.ui.h;

var C = { token: null, job: null, verified: false, decisions: {}, submitted: false };

function boot() {
  CMS.store.init();
  C.token = (location.hash || "").replace(/^#/, "").trim();
  route();
  window.addEventListener("hashchange", function () { C.token = (location.hash || "").replace(/^#/, ""); C.verified = false; route(); });
  CMS.store.sub(function (reason) { if (reason === "remote" && C.job) { C.job = CMS.jobByToken(C.token); paint(); } });
}

function route() {
  if (!C.token) return notFound("No job on this link.");
  C.job = CMS.jobByToken(C.token);
  if (!C.job) return notFound("This link is not valid any more.");
  var pol = CMS.cfg().authorisation;
  var expired = C.job.auth.expiresAt && new Date(C.job.auth.expiresAt) < new Date();
  if (expired) return notFound("This link has expired. Please phone us and we will send a new one.");
  C.decisions = {};
  C.job.lines.forEach(function (l) { if (l.authStatus === "pending") C.decisions[l.id] = null; });
  if (!pol.otpRequired || C.job.auth.otpVerifiedAt) { C.verified = true; paint(); }
  else otpGate();
}

function shell(inner, opts) {
  var d = CMS.cfg().dealer;
  var head = h("header.portal-head", h("div.inner",
    CMS.ui.logo("customer"),
    h("div", h("strong", { text: d.name }), h("div.muted", { text: d.branch + " · " + d.phone }))));
  document.documentElement.setAttribute("data-theme", "light");
  CMS.ui.mount(document.body, h("div", head, h("main.portal", inner), opts && opts.sticky ? opts.sticky : null));
}

function notFound(msg) {
  shell(h("div.card", { style: { marginTop: "24px" } },
    h("h1", { text: "We can't open this" }),
    h("p", { text: msg }),
    h("p.muted", { text: "Phone " + CMS.cfg().dealer.phone + " and we will help." })));
}

/* ---------- one-time code ---------- */
function otpGate() {
  var cust = CMS.customer(C.job.customerId) || {};
  var masked = (cust.mobile || "").replace(/^(\d{3})\d+(\d{2})$/, "$1***$2");
  var input = h("input", {
    type: "text", inputmode: "numeric", maxlength: String(CMS.cfg().authorisation.otpLength),
    style: { fontSize: "1.6rem", letterSpacing: ".4em", textAlign: "center" }, placeholder: "----",
  });
  var err = h("div");
  function submit() {
    var r = CMS.verifyOtp(C.token, input.value);
    if (r.ok) { C.verified = true; C.job = CMS.jobByToken(C.token); paint(); }
    else CMS.ui.mount(err, h("p", CMS.ui.badge(r.reason, "red")));
  }
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  shell(h("div.card", { style: { marginTop: "24px" } },
    h("h1", { text: "Just checking it's you" }),
    h("p", { text: "Enter the " + CMS.cfg().authorisation.otpLength + "-digit code we sent to " + (masked || "your phone") + "." }),
    CMS.ui.field("Your code", input),
    err,
    h("button.btn.btn-lg.btn-primary.btn-block", { text: "Continue", onclick: submit }),
    h("p.muted", { style: { marginTop: "14px" },
      text: "Demo code: " + C.job.auth.otp }),
    h("p.muted", h("span", { text: "No code? Phone us on " }), h("a", { href: "tel:" + CMS.cfg().dealer.phone, text: CMS.cfg().dealer.phone }))));
  setTimeout(function () { input.focus(); }, 60);
}

/* ---------- the page ---------- */
function paint() {
  var j = C.job = CMS.jobByToken(C.token);
  var veh = CMS.vehicle(j.vehicleId) || {};
  var cust = CMS.customer(j.customerId) || {};
  var adv = CMS.person(j.advisorId) || {};
  var pending = j.lines.filter(function (l) { return l.authStatus === "pending"; });

  var body = h("div");

  body.appendChild(h("div.card", { style: { marginTop: "var(--gap)" } },
    h("h1", { style: { marginBottom: "2px" }, text: veh.reg || "Your vehicle" }),
    h("p.muted", { text: [veh.make, veh.model].filter(Boolean).join(" ") + " · " + CMS.t("ro") + " " + j.ref }),
    tracker(j),
    h("div.row", { style: { marginTop: "var(--gap-sm)" } },
      h("a.btn", { href: "tel:" + CMS.cfg().dealer.phone, text: "Phone " + (adv.name ? adv.name.split(" ")[0] : "us") }),
      cust.mobile ? h("a.btn", { href: "https://wa.me/27" + String(cust.mobile).slice(1), target: "_blank", rel: "noopener", text: "WhatsApp us" }) : null)));

  /* Once they have decided, the confirmation is the first thing
     they see when the page comes back. */
  if (C.submitted || (j.auth && j.auth.signedAt)) body.appendChild(decisionSummary(j));

  /* What we are already doing */
  var booked = j.lines.filter(function (l) { return l.authStatus === "not_required"; });
  if (booked.length) {
    var bc = h("div.card", h("h2", { text: "What you booked in for" }));
    (j.requested || []).forEach(function (r) { bc.appendChild(h("p", h("strong", { text: "• " + r.title }))); });
    bc.appendChild(h("p.muted", { text: "Total for the booked work: " + CMS.money(CMS.totals(booked).gross) + " including VAT." }));
    body.appendChild(bc);
  }

  /* The decision */
  if (pending.length && !C.submitted) {
    body.appendChild(h("div.card", { style: { borderLeft: "5px solid var(--mustard)" } },
      h("h2", { text: "We found some things" }),
      h("p", { text: "Your " + (veh.make || "vehicle") + " has been checked over. Below is what we found, why it matters and what it costs. Choose what you would like us to do — you are not committed to any of it." })));

    var groupCards = h("div");
    pending.forEach(function (l) { groupCards.appendChild(lineCard(j, l)); });
    body.appendChild(groupCards);

    body.appendChild(signBlock(j));
  } else if (!(C.submitted || (j.auth && j.auth.signedAt))) {
    body.appendChild(h("div.card",
      h("h2", { text: "Nothing needs a decision" }),
      h("p", { text: "We will let you know the moment your vehicle is ready." })));
  }

  /* The health check, green items included */
  if (j.vhc && j.vhc.completedAt) body.appendChild(vhcCard(j));

  body.appendChild(h("div.card",
    h("h3", { text: "Questions?" }),
    h("p", { text: (adv.name ? adv.name + " is looking after your vehicle. " : "") + "Phone " + CMS.cfg().dealer.phone + " and quote " + j.ref + "." }),
    h("p.muted", { text: CMS.cfg().dealer.name + " · " + CMS.cfg().dealer.address })));

  var sticky = pending.length && !C.submitted ? stickyBar(j) : null;
  shell(body, { sticky: sticky });
}

function tracker(j) {
  var stages = [
    { id: "booked", label: "Booked in" },
    { id: "working", label: "In the workshop" },
    { id: "approval", label: "Your decision" },
    { id: "ready", label: "Ready" },
    { id: "done", label: "Collected" },
  ];
  var cur = CMS.status(j.status).stage;
  var idx = stages.map(function (s) { return s.id; }).indexOf(cur);
  var bar = h("div.tracker");
  stages.forEach(function (s, i) {
    bar.appendChild(h("div.t", { "data-done": String(i < idx), "data-current": String(i === idx), text: s.label }));
  });
  return bar;
}

function lineCard(j, l) {
  var decision = C.decisions[l.id];
  var photos = [];
  if (j.vhc && l.evhcItem) {
    var it = j.vhc.items.filter(function (x) { return x.id === l.evhcItem; })[0];
    if (it) photos = it.photos || [];
  }
  var card = h("div.authline" + (decision === "approved" ? ".approved" : decision === "declined" ? ".declined" : ""));
  card.appendChild(h("div.head",
    h("div", h("strong", { text: l.title }),
      l.why ? h("p.why", { text: l.why }) : null),
    h("div.price", { text: CMS.money(CMS.withVat(CMS.lineNet(l))) })));
  if (photos.length) {
    var ph = h("div.photos", { style: { marginTop: "8px" } });
    photos.forEach(function (p) { ph.appendChild(h("figure", h("img", { src: p, alt: l.title }))); });
    card.appendChild(ph);
  }
  var btns = h("div.btn-row", { style: { marginTop: "10px" } },
    h("button.btn" + (decision === "approved" ? ".btn-accent" : ""), {
      style: { flex: "1" }, text: decision === "approved" ? "✓  Yes, go ahead" : "Yes, go ahead",
      onclick: function () { C.decisions[l.id] = decision === "approved" ? null : "approved"; paint(); },
    }),
    h("button.btn" + (decision === "declined" ? ".btn-danger" : ""), {
      style: { flex: "1" }, text: decision === "declined" ? "✕  Not this time" : "Not this time",
      onclick: function () { C.decisions[l.id] = decision === "declined" ? null : "declined"; paint(); },
    }));
  card.appendChild(btns);
  return card;
}

function approvedTotal() {
  var lines = C.job.lines.filter(function (l) { return C.decisions[l.id] === "approved"; });
  return CMS.totals(lines).gross;
}

function stickyBar(j) {
  var undecided = Object.keys(C.decisions).filter(function (k) { return !C.decisions[k]; }).length;
  return h("div.sticky-total", h("div.inner",
    h("div", h("div.muted", { text: "You have chosen" }), h("div.amt", { text: CMS.money(approvedTotal()) })),
    h("div.spacer"),
    h("button.btn.btn-lg.btn-primary", {
      text: undecided ? undecided + " still to decide" : "Continue →",
      disabled: undecided ? true : null,
      onclick: function () { document.getElementById("sign").scrollIntoView({ behavior: "smooth" }); },
    })));
}

function signBlock(j) {
  var pol = CMS.cfg().authorisation;
  var card = h("div.card#sign", h("h2", { text: "Confirm your choices" }));
  var approved = j.lines.filter(function (l) { return C.decisions[l.id] === "approved"; });
  var declined = j.lines.filter(function (l) { return C.decisions[l.id] === "declined"; });
  var t = CMS.totals(approved);

  var sum = h("div");
  approved.forEach(function (l) {
    sum.appendChild(h("div.row", { style: { padding: "5px 0", borderBottom: "1px solid var(--border)" } },
      h("span", { text: "✓ " + l.title }), h("div.spacer"), h("strong", { text: CMS.money(CMS.withVat(CMS.lineNet(l))) })));
  });
  declined.forEach(function (l) {
    sum.appendChild(h("div.row", { style: { padding: "5px 0", borderBottom: "1px solid var(--border)", opacity: ".6" } },
      h("span", { text: "✕ " + l.title }), h("div.spacer"), h("span.muted", { text: "not this time" })));
  });
  card.appendChild(sum);
  card.appendChild(h("div.row", { style: { marginTop: "10px" } },
    h("strong", { text: "Total to add, including VAT" }), h("div.spacer"),
    h("strong", { style: { fontSize: "1.25rem" }, text: CMS.money(t.gross) })));

  if (!approved.length) {
    card.appendChild(h("p.muted", { text: "You have said no to everything — that is completely fine. Confirm below and we will finish the work you booked in for." }));
  }

  card.appendChild(h("p.muted", { style: { marginTop: "var(--gap)" }, text: pol.terms }));

  var name = h("input", { type: "text", placeholder: "Your full name" });
  name.value = (CMS.customer(j.customerId) || {}).name || "";
  card.appendChild(CMS.ui.field("Your name", name, { required: true }));

  var pad = null;
  if (pol.signatureRequired) {
    pad = CMS.ui.signaturePad();
    card.appendChild(CMS.ui.field("Sign with your finger", pad.el));
    card.appendChild(h("button.btn.btn-sm.btn-ghost", { text: "Clear signature", onclick: function () { pad.clear(); } }));
  }

  card.appendChild(h("button.btn.btn-lg.btn-primary.btn-block", { style: { marginTop: "var(--gap)" },
    text: "Confirm and send to the workshop",
    onclick: function () {
      if (!name.value.trim()) return CMS.ui.toast("Please put your name in", "warn");
      if (pol.signatureRequired && (!pad || !pad.isSigned())) return CMS.ui.toast("Please sign in the box", "warn");
      Object.keys(C.decisions).forEach(function (lineId) {
        CMS.setLineDecision(j.id, lineId, C.decisions[lineId] || "declined", "customer");
      });
      CMS.submitAuthorisation(j.id, { name: name.value.trim(), signature: pad ? pad.dataUrl() : null, method: "link", by: "customer" });
      C.submitted = true;
      C.job = CMS.jobByToken(C.token);
      window.scrollTo({ top: 0, behavior: "smooth" });
      paint();
    } }));
  return card;
}

function decisionSummary(j) {
  var approved = j.lines.filter(function (l) { return l.authStatus === "approved"; });
  var declined = j.lines.filter(function (l) { return l.authStatus === "declined"; });
  var t = CMS.totals(approved);
  var card = h("div.card", { style: { borderLeft: "5px solid var(--green)" } },
    h("h2", { text: "Thank you — we have it" }),
    h("p", { text: approved.length
      ? "The workshop has been told and is carrying on with the extra work you approved."
      : "No extra work has been added. We are finishing what you booked in for." }));
  approved.forEach(function (l) {
    card.appendChild(h("div.row", { style: { padding: "5px 0", borderBottom: "1px solid var(--border)" } },
      h("span", { text: "✓ " + l.title }), h("div.spacer"), h("span", { text: CMS.money(CMS.withVat(CMS.lineNet(l))) })));
  });
  if (approved.length) {
    card.appendChild(h("div.row", { style: { marginTop: "8px" } },
      h("strong", { text: "Added to your bill" }), h("div.spacer"), h("strong", { text: CMS.money(t.gross) })));
  }
  if (declined.length) {
    card.appendChild(h("p.muted", { style: { marginTop: "10px" },
      text: "You asked us to leave: " + declined.map(function (l) { return l.title; }).join(", ") + ". We have made a note so we can look at it next time." }));
  }
  if (j.auth && j.auth.signedAt) {
    card.appendChild(h("p.muted", { text: "Approved by " + j.auth.signedName + " on " + CMS.fmtDateTime(j.auth.signedAt) +
      (j.auth.method === "phone" ? " (by telephone)" : "") + "." }));
  }
  if (j.invoice) {
    card.appendChild(h("p", CMS.ui.badge("Invoice " + j.invoice.no + " · " + CMS.money(j.invoice.total), "blue")));
  }
  return card;
}

function vhcCard(j) {
  var s = CMS.vhcSummary(j);
  var card = h("div.card",
    h("h2", { text: "Your vehicle's health check" }),
    h("p.muted", { text: "Checked by " + ((CMS.person(j.vhc.techId) || {}).name || "our technician") + " on " + CMS.fmtDate(j.vhc.completedAt) + "." }),
    h("div.row",
      CMS.ui.badge(s.r + " need attention", "red"),
      CMS.ui.badge(s.a + " keep an eye on", "amber"),
      CMS.ui.badge(s.g + " all good", "green")));
  var det = h("details", { style: { marginTop: "var(--gap-sm)" } },
    h("summary", { style: { cursor: "pointer", fontWeight: "500" }, text: "See every item we checked" }));
  var byGroup = {};
  j.vhc.items.forEach(function (it) { if (it.rag) (byGroup[it.group] = byGroup[it.group] || []).push(it); });
  Object.keys(byGroup).forEach(function (g) {
    det.appendChild(h("h4", { style: { marginTop: "12px" }, text: g }));
    byGroup[g].forEach(function (it) {
      det.appendChild(h("div.row", { style: { padding: "4px 0" } },
        CMS.ui.rag(it.rag), h("span", { text: it.label }),
        it.value ? h("span.muted", { text: " — " + it.value + (it.unit || "") }) : null,
        it.note ? h("span.muted", { text: " · " + it.note }) : null));
    });
  });
  card.appendChild(det);
  return card;
}

document.addEventListener("DOMContentLoaded", boot);
