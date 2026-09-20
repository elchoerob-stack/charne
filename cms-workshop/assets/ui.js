/* ============================================================
   CMS Workshop — shared UI bits
   Small, dependency-free helpers the three apps share so a
   badge, a drawer or a signature looks the same everywhere.
   ============================================================ */
window.CMS = window.CMS || {};
var CMS = window.CMS;
CMS.ui = {};

/* h("div.card", {onclick: fn}, child, child) */
CMS.ui.h = function (spec, attrs) {
  var parts = String(spec).split(/(?=[.#])/);
  var node = document.createElement(parts[0] || "div");
  parts.slice(1).forEach(function (p) {
    if (p[0] === ".") node.classList.add(p.slice(1));
    else if (p[0] === "#") node.id = p.slice(1);
  });
  var kids = [].slice.call(arguments, 2);
  /* The second argument is attributes only when it is a plain
     object — a node, a string or a list of children is content. */
  if (attrs && (attrs.nodeType || typeof attrs === "string" || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else node.setAttribute(k, v === true ? "" : v);
    });
  }
  (function add(list) {
    list.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return add(c);
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  })(kids);
  return node;
};
var h = CMS.ui.h;

CMS.ui.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };
CMS.ui.mount = function (node, child) { CMS.ui.clear(node); if (child) node.appendChild(child); return node; };

/* ---------- toast ---------- */
CMS.ui.toast = function (msg, kind, ms) {
  var box = document.querySelector(".toasts");
  if (!box) { box = h("div.toasts"); document.body.appendChild(box); }
  var t = h("div.toast" + (kind ? "." + kind : ""), { text: msg });
  box.appendChild(t);
  setTimeout(function () {
    t.style.transition = "opacity .25s"; t.style.opacity = "0";
    setTimeout(function () { t.remove(); }, 260);
  }, ms || 3200);
};

/* ---------- scrim-backed overlays ---------- */
CMS.ui.closeOverlays = function () {
  document.querySelectorAll(".scrim, .drawer, .modal").forEach(function (n) { n.remove(); });
};
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") CMS.ui.closeOverlays();
});

CMS.ui.drawer = function (title, bodyNode, actions) {
  CMS.ui.closeOverlays();
  var scrim = h("div.scrim", { onclick: CMS.ui.closeOverlays });
  var head = h("div.drawer-head",
    h("h2", { text: title }),
    h("div.spacer"),
    h("button.btn.btn-ghost", { onclick: CMS.ui.closeOverlays, "aria-label": "Close", text: "✕" })
  );
  if (actions) actions.forEach(function (a) { head.insertBefore(a, head.lastChild); });
  var d = h("div.drawer", { role: "dialog", "aria-label": title }, head, h("div.drawer-body", bodyNode));
  document.body.appendChild(scrim); document.body.appendChild(d);
  return d;
};

CMS.ui.modal = function (title, bodyNode, buttons) {
  CMS.ui.closeOverlays();
  var scrim = h("div.scrim", { onclick: CMS.ui.closeOverlays });
  var foot = h("div.btn-row", { style: { marginTop: "16px", justifyContent: "flex-end" } });
  (buttons || []).forEach(function (b) { foot.appendChild(b); });
  var m = h("div.modal", { role: "dialog", "aria-label": title },
    h("h2", { text: title }), bodyNode, foot);
  document.body.appendChild(scrim); document.body.appendChild(m);
  return m;
};

CMS.ui.confirm = function (title, message, onYes, yesLabel) {
  CMS.ui.modal(title, h("p", { text: message }), [
    h("button.btn", { text: "Cancel", onclick: CMS.ui.closeOverlays }),
    h("button.btn.btn-primary", {
      text: yesLabel || "Confirm",
      onclick: function () { CMS.ui.closeOverlays(); onYes(); },
    }),
  ]);
};

/* ---------- small pieces ---------- */
CMS.ui.badge = function (label, tone) { return h("span.badge." + (tone || "grey"), h("i.dot"), label); };
CMS.ui.statusBadge = function (statusId) {
  var s = CMS.status(statusId);
  return CMS.ui.badge(s.label, s.tone);
};
CMS.ui.rag = function (r) { return h("i.rag." + (r || "n"), { title: { r: "Red — needs attention now", a: "Amber — advisory", g: "Green — fine", "": "Not checked" }[r || ""] }); };

CMS.ui.field = function (label, control, opts) {
  opts = opts || {};
  var f = h("div.field",
    h("label", label, opts.required ? h("span.req", "*") : null),
    control,
    opts.hint ? h("small.muted", { text: opts.hint }) : null);
  return f;
};
CMS.ui.input = function (attrs) { return h("input", Object.assign({ type: "text" }, attrs)); };
CMS.ui.select = function (options, value, attrs) {
  var s = h("select", attrs || {});
  options.forEach(function (o) {
    var opt = h("option", { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
};
CMS.ui.empty = function (icon, text, action) {
  return h("div.empty", h("span.big", icon), h("div", { text: text }), action || null);
};
CMS.ui.kpi = function (label, value, sub, alert) {
  return h("div.kpi" + (alert ? ".alert" : ""),
    h("div.label", { text: label }),
    h("div.value", { text: String(value) }),
    sub ? h("div.sub", { text: sub }) : null);
};
CMS.ui.tabs = function (items, active, onPick) {
  var bar = h("div.tabs", { role: "tablist" });
  items.forEach(function (it) {
    bar.appendChild(h("button.tab", {
      role: "tab", "aria-selected": String(it.id === active), text: it.label,
      onclick: function () { onPick(it.id); },
    }));
  });
  return bar;
};
CMS.ui.logo = function (variant) {
  var cfg = CMS.cfg();
  var custom = variant === "customer" ? cfg.dealer.customerLogoDataUrl : cfg.dealer.logoDataUrl;
  var src = custom || ("assets/logos/cms-eco-logo-" + (variant === "white" ? "white" : "full-colour") + ".png");
  return h("img.logo", { src: src, alt: custom ? cfg.dealer.name : "CMS eco", loading: "lazy" });
};

/* ---------- signature pad ---------- */
CMS.ui.signaturePad = function () {
  var canvas = h("canvas.sigpad", { width: 640, height: 170 });
  var ctx = canvas.getContext("2d");
  var drawing = false, dirty = false;
  ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#2E2E2E";
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
  }
  function start(e) { e.preventDefault(); drawing = true; dirty = true; canvas.classList.add("signed"); var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function end() { drawing = false; }
  ["mousedown", "touchstart"].forEach(function (ev) { canvas.addEventListener(ev, start, { passive: false }); });
  ["mousemove", "touchmove"].forEach(function (ev) { canvas.addEventListener(ev, move, { passive: false }); });
  ["mouseup", "mouseleave", "touchend"].forEach(function (ev) { canvas.addEventListener(ev, end); });
  return {
    el: canvas,
    clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; canvas.classList.remove("signed"); },
    isSigned: function () { return dirty; },
    dataUrl: function () { return dirty ? canvas.toDataURL("image/png") : null; },
  };
};

/* ---------- photo capture ----------
   Uses the device camera on a phone or tablet and a file picker
   on a laptop. Images are scaled down before they are stored —
   full-resolution photos are what fills a tablet's storage and
   what fails an upload with a 413. */
CMS.ui.photoInput = function (onPhoto) {
  var input = h("input", { type: "file", accept: "image/*", capture: "environment", style: { display: "none" } });
  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 900;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        onPhoto(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    input.value = "";
  });
  return input;
};

/* ---------- misc ---------- */
CMS.ui.copy = function (text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { CMS.ui.toast("Copied", "ok"); },
      function () { CMS.ui.prompt("Copy this", text); });
  } else { CMS.ui.prompt("Copy this", text); }
};
CMS.ui.prompt = function (title, text) {
  var ta = h("textarea", { style: { minHeight: "120px" } });
  ta.value = text;
  CMS.ui.modal(title, ta, [h("button.btn.btn-primary", { text: "Done", onclick: CMS.ui.closeOverlays })]);
  ta.select();
};
CMS.ui.download = function (filename, text, mime) {
  var blob = new Blob([text], { type: mime || "application/json" });
  var a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
};
CMS.ui.vehLabel = function (job) {
  var v = CMS.vehicle(job.vehicleId);
  if (!v) return "—";
  var desc = [v.make, v.model].filter(Boolean).join(" ");
  return desc ? v.reg + " · " + desc : v.reg;
};
CMS.ui.custName = function (job) {
  var c = CMS.customer(job.customerId);
  return c ? c.name : "—";
};
