// CMS Workflow Recorder — content script.
// Captures user actions and page signals and forwards them to the background
// service worker. Nothing is stored here; the background owns the recording.
(() => {
  if (window.__cmsRecorderLoaded) return;
  window.__cmsRecorderLoaded = true;

  let active = false;
  let t0 = 0;
  const send = (event) => {
    if (!active) return;
    try { chrome.runtime.sendMessage({ kind: "event", event: { t: Date.now() - t0, url: location.href, title: document.title, ...event } }); } catch { /* extension reloaded */ }
  };

  /* ── POPIA masking ────────────────────────────────────────────────── */
  const SENSITIVE_NAME = /pass|pwd|secret|token|otp|pin|idnumber|id_number|identity|card|cvv|account|iban|salary|bank/i;
  const SENSITIVE_VALUE = [
    /^\s*\d{13}\s*$/,                              // SA ID number
    /(\+27|0)\s?\d{2}\s?\d{3}\s?\d{4}/,            // SA mobile number
    /[\w.+-]+@[\w-]+\.[\w.]+/,                     // e-mail
    /\b(?:\d[ -]?){13,19}\b/,                      // card number
  ];
  function isSensitive(el, value) {
    if (!el) return false;
    const type = (el.getAttribute && el.getAttribute("type")) || "";
    if (/password|tel|email/i.test(type)) return true;
    const hint = [el.name, el.id, el.getAttribute?.("autocomplete"), el.getAttribute?.("aria-label"), el.placeholder].filter(Boolean).join(" ");
    if (SENSITIVE_NAME.test(hint)) return true;
    return SENSITIVE_VALUE.some((re) => re.test(String(value ?? "")));
  }
  const mask = (v) => (v ? "•".repeat(Math.min(8, String(v).length)) : "");

  /* ── Target description ───────────────────────────────────────────── */
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);
  function labelFor(el) {
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    const id = el.id;
    if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return clean(l.textContent); }
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\s+/).map((i) => document.getElementById(i)?.textContent || "").join(" "));
    return "";
  }
  function accessibleName(el) {
    return clean(el.getAttribute("aria-label")) || labelFor(el) || clean(el.getAttribute("title")) || (el.tagName === "INPUT" && /submit|button/.test(el.type) ? clean(el.value) : "") || "";
  }
  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      const tid = node.getAttribute("data-testid") || node.getAttribute("data-test") || node.getAttribute("data-cy");
      if (tid) { parts.unshift(`[data-testid="${tid}"]`); break; }
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return undefined;
    // Climb to the interactive ancestor (icon inside a button, span inside a link).
    const interactive = el.closest("button, a, [role=button], [role=link], [role=tab], [role=menuitem], input, select, textarea, [role=textbox], [role=combobox], [role=checkbox], [role=radio], label, tr, li") || el;
    const tag = interactive.tagName.toLowerCase();
    return {
      tag,
      role: interactive.getAttribute("role") || undefined,
      name: accessibleName(interactive) || undefined,
      text: ["input", "select", "textarea"].includes(tag) ? undefined : clean(interactive.textContent) || undefined,
      testId: interactive.getAttribute("data-testid") || interactive.getAttribute("data-test") || interactive.getAttribute("data-cy") || undefined,
      id: interactive.id || undefined,
      placeholder: interactive.placeholder || undefined,
      inputType: tag === "input" ? interactive.type || "text" : undefined,
      selector: cssPath(interactive),
    };
  }

  /* ── Action listeners ─────────────────────────────────────────────── */
  document.addEventListener("click", (e) => {
    const target = describe(e.target);
    if (!target) return;
    send({ type: "click", target });
    chrome.runtime.sendMessage({ kind: "screenshot" });
  }, true);

  let inputTimer;
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || !("value" in el)) return;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      const sensitive = isSensitive(el, el.value);
      const target = describe(el);
      if (target) target.sensitive = sensitive;
      send({ type: "input", target, value: sensitive ? mask(el.value) : String(el.value).slice(0, 200) });
    }, 400);
  }, true);

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el) return;
    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      send({ type: "select", target: describe(el), value: clean(opt ? opt.text : el.value) });
    } else if (el.type === "checkbox" || el.type === "radio") {
      send({ type: "change", target: describe(el), value: el.checked ? "checked" : "unchecked" });
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (["Enter", "Tab", "Escape"].includes(e.key)) send({ type: "keypress", key: e.key, target: describe(e.target) });
  }, true);

  document.addEventListener("submit", (e) => send({ type: "submit", target: describe(e.target) }), true);

  let scrollTimer;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => send({ type: "scroll", scrollY: window.scrollY }), 500); }, { passive: true });

  window.addEventListener("online", () => send({ type: "online" }));
  window.addEventListener("offline", () => send({ type: "offline" }));
  document.addEventListener("visibilitychange", () => send({ type: "visibility", visible: !document.hidden }));

  // SPA navigation (pushState / replaceState / popstate) and full loads.
  let lastUrl = location.href;
  const noteNav = () => { if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(() => send({ type: "navigate" }), 50); } };
  const wrap = (fn) => function () { const r = fn.apply(this, arguments); noteNav(); return r; };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener("popstate", noteNav);
  window.addEventListener("hashchange", noteNav);

  /* ── Page signals: console errors and failed fetch/XHR ────────────── */
  window.addEventListener("error", (e) => send({ type: "console", level: "error", message: `${e.message} (${e.filename}:${e.lineno})` }));
  window.addEventListener("unhandledrejection", (e) => send({ type: "console", level: "error", message: `Unhandled rejection: ${String(e.reason && (e.reason.message || e.reason)).slice(0, 300)}` }));

  // Wrap fetch and XHR in the page context (content scripts run in an isolated world,
  // so inject a small script and listen to its CustomEvents).
  const inject = document.createElement("script");
  inject.textContent = `(() => {
    const emit = (d) => window.dispatchEvent(new CustomEvent("__cmsrec_net", { detail: d }));
    const of = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input.url;
      const method = (init && init.method) || (input && input.method) || "GET";
      const s = performance.now();
      try {
        const res = await of.apply(this, arguments);
        emit({ method, url, status: res.status, ok: res.ok, durationMs: Math.round(performance.now() - s) });
        return res;
      } catch (err) { emit({ method, url, status: 0, ok: false, durationMs: Math.round(performance.now() - s) }); throw err; }
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const s = performance.now();
      this.addEventListener("loadend", () => emit({ method, url: String(url), status: this.status, ok: this.status >= 200 && this.status < 400, durationMs: Math.round(performance.now() - s) }));
      return open.apply(this, arguments);
    };
    const ce = console.error;
    console.error = function () { try { emit({ console: [...arguments].map((a) => (a && a.stack) || String(a)).join(" ").slice(0, 300) }); } catch {} return ce.apply(this, arguments); };
  })();`;
  (document.documentElement || document.head).appendChild(inject);
  inject.remove();
  window.addEventListener("__cmsrec_net", (e) => {
    const d = e.detail || {};
    if (d.console) send({ type: "console", level: "error", message: d.console });
    else send({ type: "network", request: { method: d.method, url: d.url, status: d.status, ok: d.ok, durationMs: d.durationMs } });
  });

  /* ── Control from the background ──────────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.kind === "state") {
      const was = active;
      active = Boolean(msg.active);
      t0 = msg.t0 || Date.now();
      if (active && !was) send({ type: "navigate" });
      reply && reply({ ok: true });
    }
    if (msg.kind === "note") { send({ type: "note", message: msg.text }); reply && reply({ ok: true }); }
  });
  chrome.runtime.sendMessage({ kind: "hello" }, (state) => { if (state) { active = Boolean(state.active); t0 = state.t0 || Date.now(); } });
})();
