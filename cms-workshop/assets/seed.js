/* ============================================================
   CMS Workshop — demo dealership
   A workshop with a day already half-run, so every screen has
   something real on it the first time it opens. Setup → Data
   resets back to this, or clears it for a live setup.
   ============================================================ */
window.CMS = window.CMS || {};
var CMS = window.CMS;

CMS.buildInitialState = function () {
  var cfg = CMS.clone(CMS.DEFAULT_CONFIG);
  /* The demo is anchored on working days, so it looks like a busy
     workshop whatever day of the week it is opened on. */
  var openDays = cfg.diary.days;
  var stepDay = function (isoDate, n) {
    return new Date(new Date(isoDate + "T00:00:00").getTime() + n * 86400e3).toISOString().slice(0, 10);
  };
  var isOpen = function (isoDate) { return openDays.indexOf(new Date(isoDate + "T00:00:00").getDay()) >= 0; };
  var walk = function (from, dir, count) {
    var d = from, found = 0;
    for (var i = 0; i < 40; i++) {
      if (isOpen(d)) { if (found === count) return d; found++; }
      d = stepDay(d, dir);
    }
    return from;
  };
  var anchor = walk(new Date().toISOString().slice(0, 10), 1, 0);
  var iso = function (offsetDays) {
    if (offsetDays === 0) return anchor;
    return walk(stepDay(anchor, offsetDays > 0 ? 1 : -1), offsetDays > 0 ? 1 : -1, Math.abs(offsetDays) - 1);
  };
  var ago = function (mins) { return new Date(Date.now() - mins * 60000).toISOString(); };

  var customers = [
    { id: "c1", name: "Nomsa Dube",        mobile: "0824451190", email: "nomsa.dube@example.co.za",  type: "retail", suburb: "Centurion",   consent: { sms: true, whatsapp: true, email: true } },
    { id: "c2", name: "Pieter van Wyk",    mobile: "0837742210", email: "pvw@example.co.za",         type: "retail", suburb: "Irene",       consent: { sms: true, whatsapp: true, email: false } },
    { id: "c3", name: "Fleet Co (Pty) Ltd",mobile: "0115557000", email: "fleet@fleetco.co.za",       type: "fleet",  suburb: "Midrand",     account: "FLT-0091", consent: { sms: true, whatsapp: false, email: true } },
    { id: "c4", name: "Aisha Khan",        mobile: "0713398820", email: "aisha.k@example.co.za",     type: "retail", suburb: "Lyttelton",   consent: { sms: true, whatsapp: true, email: true } },
    { id: "c5", name: "Sanele Mthembu",    mobile: "0799012234", email: "",                          type: "retail", suburb: "Olievenhoutbosch", consent: { sms: true, whatsapp: true, email: false } },
    { id: "c6", name: "Elsabe Coetzee",    mobile: "0829901145", email: "elsabe@example.co.za",      type: "retail", suburb: "Wierdapark",  consent: { sms: true, whatsapp: false, email: true } },
    { id: "c7", name: "Municipal Services",mobile: "0126650000", email: "workshop@munserv.gov.za",   type: "fleet",  suburb: "Pretoria",    account: "GOV-0044", consent: { sms: false, whatsapp: false, email: true } },
    { id: "c8", name: "Kabelo Motsepe",    mobile: "0845567781", email: "kabelo.m@example.co.za",    type: "retail", suburb: "Rooihuiskraal",consent: { sms: true, whatsapp: true, email: true } },
  ];

  var vehicles = [
    { id: "v1", customerId: "c1", reg: "JD 44 KP GP", vin: "WVWZZZ1KZAW123456", make: "Volkswagen", model: "Polo Vivo 1.4", year: 2021, km: 62400, colour: "White" },
    { id: "v2", customerId: "c2", reg: "PVW 007 GP",  vin: "AHTKB3CD108123789", make: "Toyota",     model: "Hilux 2.8 GD-6", year: 2022, km: 91250, colour: "Silver" },
    { id: "v3", customerId: "c3", reg: "FL 12 CO GP", vin: "AFAPXXMRKPNR12345", make: "Ford",       model: "Ranger 2.0 SiT", year: 2023, km: 44100, colour: "White" },
    { id: "v4", customerId: "c4", reg: "AK 88 MM GP", vin: "MALA851CAKM123456", make: "Hyundai",    model: "i20 1.2",        year: 2020, km: 78900, colour: "Blue" },
    { id: "v5", customerId: "c5", reg: "SM 19 NT GP", vin: "MPATFS85JKT123456", make: "Isuzu",      model: "D-Max 250",      year: 2019, km: 138400, colour: "Grey" },
    { id: "v6", customerId: "c6", reg: "EC 55 KL GP", vin: "WBA8E1105J1234567", make: "BMW",        model: "320i",           year: 2021, km: 56300, colour: "Black" },
    { id: "v7", customerId: "c7", reg: "BSK 442 GP",  vin: "WDD2050461R123456", make: "Mercedes-Benz", model: "C200",        year: 2022, km: 33200, colour: "White" },
    { id: "v8", customerId: "c8", reg: "KM 21 TT GP", vin: "MA3ZC62S3KA123456", make: "Suzuki",     model: "Swift 1.2",      year: 2023, km: 21750, colour: "Red" },
  ];

  var seq = { job: 1040, invoice: 5100, vhc: 300 };
  var jobs = [];
  var ref = function () { seq.job++; return "JC-" + seq.job; };

  var line = function (o) {
    return Object.assign({ id: CMS.uid("ln"), kind: "labour", qty: 1, authStatus: "not_required", addedAt: ago(200) }, o);
  };
  var labour = function (code, title, hours, rateId, extra) {
    return line(Object.assign({ kind: "labour", code: code, title: title, hours: hours, rateId: rateId || "svc", rate: CMS.DEFAULT_CONFIG.money.labourRates.filter(function (r) { return r.id === (rateId || "svc"); })[0].rate, source: "menu" }, extra || {}));
  };
  var partLine = function (no, qty, extra) {
    var p = cfg.parts.filter(function (x) { return x.no === no; })[0];
    var band = cfg.money.partsMarkup.filter(function (b) { return b.upTo === null || p.cost <= b.upTo; })[0];
    return line(Object.assign({
      kind: "part", code: no, title: p.desc, qty: qty || 1, cost: p.cost,
      unitPrice: Math.round(p.cost * (1 + band.pct / 100) * 100) / 100, source: "menu",
    }, extra || {}));
  };

  /* --- JC-1041 · in the workshop, health check under way --- */
  jobs.push({
    id: "job1", ref: ref(), createdAt: ago(1500), status: "vhc",
    customerId: "c1", vehicleId: "v1", advisorId: "u-adv1", techId: "u-tec1", bayId: "b1",
    slot: { date: iso(0), start: "08:00", durationMin: 90 },
    transport: "wait", odometer: 62400, fuel: "1/2",
    requested: [{ id: "r1", title: "15 000 km service", note: "Customer waiting — promised 10:00" }],
    lines: [
      labour("SVC15", "15 000 km minor service", 1.2, "svc"),
      partLine("OIL-5W30-5L", 1), partLine("FLT-OIL-A", 1), partLine("FLT-AIR-A", 1), partLine("SUMP-WSH", 1),
    ],
    vhc: {
      ref: "VHC-301", templateId: "vhc-standard", templateName: "Standard service health check",
      requirePhotoOn: ["r", "a"], techId: "u-tec1", startedAt: ago(40), completedAt: null,
      items: [
        { id: "oil", group: "Under bonnet", label: "Engine oil level & condition", rag: "a", note: "Below minimum, dark", value: "", unit: "", photos: [] },
        { id: "coolant", group: "Under bonnet", label: "Coolant level & strength", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "battery", group: "Under bonnet", label: "Battery health", rag: "", note: "", measure: "State of health", unit: "%", amberBelow: 70, redBelow: 55, value: "", photos: [] },
        { id: "t-lf", group: "Tyres", label: "Tyre left front", rag: "r", note: "Below legal limit, inner edge worn", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "1.4", photos: [] },
        { id: "t-rf", group: "Tyres", label: "Tyre right front", rag: "a", note: "", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "2.8", photos: [] },
        { id: "t-lr", group: "Tyres", label: "Tyre left rear", rag: "g", note: "", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "5.1", photos: [] },
        { id: "t-rr", group: "Tyres", label: "Tyre right rear", rag: "g", note: "", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "5.4", photos: [] },
        { id: "pad-f", group: "Brakes", label: "Front pads", rag: "", note: "", measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2, value: "", photos: [] },
        { id: "wipers", group: "Interior & electrics", label: "Wiper blades & washers", rag: "a", note: "Smearing", value: "", unit: "", photos: [] },
      ],
    },
    auth: { token: "demo", sent: [] },
    notes: [{ at: ago(60), by: "u-adv1", text: "Customer waiting in reception — keep her posted." }],
    timeline: [
      { at: ago(40), who: "u-tec1", what: "eVHC started (Standard service health check)" },
      { at: ago(70), who: "u-tec1", what: "Clocked on" },
      { at: ago(95), who: "u-adv1", what: "Status → Arrived" },
      { at: ago(1500), who: "u-adv1", what: "Booking created" },
    ],
    time: [{ id: "tm1", techId: "u-tec1", start: ago(70), end: null }],
    posting: [{ id: "p1", at: ago(94), kind: "jobcard", status: "posted", response: "Evolve accepted — RO JC-1041" }],
    partsRequests: [],
  });

  /* --- JC-1042 · the one waiting on the customer. This is the
         job behind the demo customer link. --- */
  jobs.push({
    id: "job2", ref: ref(), createdAt: ago(1600), status: "awaiting_auth",
    customerId: "c2", vehicleId: "v2", advisorId: "u-adv2", techId: "u-tec2", bayId: "b2",
    slot: { date: iso(0), start: "07:30", durationMin: 180 },
    transport: "courtesy", courtesyReg: "CRT 100 GP", odometer: 91250, fuel: "3/4",
    requested: [{ id: "r1", title: "90 000 km service", note: "" }, { id: "r2", title: "Judder under braking", note: "From about 80km/h" }],
    lines: [
      labour("SVC90", "90 000 km service + belt", 4.5, "svc"),
      partLine("OIL-5W30-5L", 2), partLine("FLT-OIL-A", 1), partLine("FLT-AIR-A", 1), partLine("FLT-CAB-A", 1), partLine("BELT-KIT", 1),
      labour("BRKF", "Front brake overhaul", 1.5, "std", { authStatus: "pending", source: "evhc", evhcItem: "pad-f", why: "Front pads measured 2.1mm — below the 4mm advisory and close to the 2mm limit. Discs are lipped and causing the judder you reported." }),
      partLine("PAD-FRT-B", 1, { authStatus: "pending", source: "evhc", evhcItem: "pad-f" }),
      partLine("DISC-FRT-A", 2, { authStatus: "pending", source: "evhc", evhcItem: "disc-f" }),
      partLine("WIPER-PAIR", 1, { authStatus: "pending", source: "evhc", evhcItem: "wipers", why: "Blades are perished and smearing across the driver's line of sight." }),
      line({ kind: "labour", code: "GEO4", title: "Four-wheel alignment", hours: 0.8, rateId: "std", rate: 795, authStatus: "pending", source: "evhc", why: "Uneven front tyre wear — worth setting the geometry while the wheels are off." }),
    ],
    vhc: {
      ref: "VHC-302", templateId: "vhc-standard", templateName: "Standard service health check",
      requirePhotoOn: ["r", "a"], techId: "u-tec2", startedAt: ago(220), completedAt: ago(150),
      items: [
        { id: "oil", group: "Under bonnet", label: "Engine oil level & condition", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "coolant", group: "Under bonnet", label: "Coolant level & strength", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "battery", group: "Under bonnet", label: "Battery health", rag: "a", note: "Holding, but down on capacity", measure: "State of health", unit: "%", amberBelow: 70, redBelow: 55, value: "68", photos: [] },
        { id: "belts", group: "Under bonnet", label: "Drive belts & hoses", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "t-lf", group: "Tyres", label: "Tyre left front", rag: "a", note: "Outer edge wear", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "2.9", photos: [] },
        { id: "t-rf", group: "Tyres", label: "Tyre right front", rag: "a", note: "Outer edge wear", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "2.7", photos: [] },
        { id: "t-lr", group: "Tyres", label: "Tyre left rear", rag: "g", note: "", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "6.0", photos: [] },
        { id: "t-rr", group: "Tyres", label: "Tyre right rear", rag: "g", note: "", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6, value: "5.8", photos: [] },
        { id: "pad-f", group: "Brakes", label: "Front pads", rag: "r", note: "2.1mm remaining, discs lipped", measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2, value: "2.1", photos: [] },
        { id: "pad-r", group: "Brakes", label: "Rear pads", rag: "g", note: "", measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2, value: "7.4", photos: [] },
        { id: "disc-f", group: "Brakes", label: "Front discs", rag: "r", note: "Lipped and scored — source of the judder", value: "", unit: "", photos: [] },
        { id: "susp", group: "Under vehicle", label: "Suspension & shocks", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "leaks", group: "Under vehicle", label: "Oil / fluid leaks", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "lights", group: "Interior & electrics", label: "All lights", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "wipers", group: "Interior & electrics", label: "Wiper blades & washers", rag: "a", note: "Perished, smearing", value: "", unit: "", photos: [] },
        { id: "aircon", group: "Interior & electrics", label: "Air conditioning", rag: "g", note: "", measure: "Vent temp", unit: "°C", value: "6", photos: [] },
      ],
    },
    auth: {
      token: "demo1234", otp: "4417", otpVerifiedAt: null,
      requestedAt: ago(140), requestedBy: "u-adv2",
      expiresAt: new Date(Date.now() + 40 * 3600e3).toISOString(),
      method: "link",
      sent: [
        { id: "m1", channel: "whatsapp", to: "0837742210", at: ago(140), status: "delivered", kind: "auth_request",
          body: "Hi Pieter 👋\n\nWe've finished the health check on your PVW 007 GP (JC-1042).\n\nThere are items needing your decision — photos and prices are on the link below." },
      ],
    },
    notes: [{ at: ago(138), by: "u-adv2", text: "Link delivered on WhatsApp. Phone again at 11:00 if nothing back." }],
    timeline: [
      { at: ago(140), who: "u-adv2", what: "Approval request sent by whatsapp to 0837742210" },
      { at: ago(150), who: "u-tec2", what: "eVHC completed — 2 red, 4 amber, 10 green" },
      { at: ago(220), who: "u-tec2", what: "Clocked on" },
      { at: ago(250), who: "u-adv2", what: "Status → Arrived" },
      { at: ago(1600), who: "u-adv2", what: "Booking created" },
    ],
    time: [{ id: "tm2", techId: "u-tec2", start: ago(220), end: ago(150) }],
    posting: [{ id: "p2", at: ago(249), kind: "jobcard", status: "posted", response: "Evolve accepted — RO JC-1042" }],
    partsRequests: [],
  });

  /* --- JC-1043 · stuck on parts --- */
  jobs.push({
    id: "job3", ref: ref(), createdAt: ago(1700), status: "parts_hold",
    customerId: "c3", vehicleId: "v3", advisorId: "u-adv1", techId: "u-tec3", bayId: "b4",
    slot: { date: iso(0), start: "09:00", durationMin: 120 },
    transport: "leave", odometer: 44100, fuel: "1/4",
    requested: [{ id: "r1", title: "Diagnostic — engine light", note: "P0401 stored" }],
    lines: [labour("DIAG1", "Diagnostic investigation (1h)", 1.0, "std")],
    vhc: null,
    auth: { token: "demo3", sent: [] },
    notes: [],
    timeline: [
      { at: ago(80), who: "u-par1", what: "Parts request backorder" },
      { at: ago(110), who: "u-tec3", what: "Parts requested: 1× DPF-ADD" },
      { at: ago(200), who: "u-adv1", what: "Status → Arrived" },
    ],
    time: [{ id: "tm3", techId: "u-tec3", start: ago(190), end: ago(110) }],
    posting: [{ id: "p3", at: ago(199), kind: "jobcard", status: "posted", response: "Evolve accepted — RO JC-1043" }],
    partsRequests: [{ id: "pr1", at: ago(110), by: "u-tec3", status: "backorder", note: "ETA tomorrow 11:00 from Midrand", items: [{ no: "DPF-ADD", qty: 1 }] }],
  });

  /* --- JC-1044 · ready for collection --- */
  jobs.push({
    id: "job4", ref: ref(), createdAt: ago(1900), status: "ready",
    customerId: "c4", vehicleId: "v4", advisorId: "u-adv2", techId: "u-tec1", bayId: "b3",
    slot: { date: iso(0), start: "07:30", durationMin: 60 },
    transport: "shuttle", odometer: 78900, fuel: "Full",
    requested: [{ id: "r1", title: "Air-con not cold", note: "" }],
    lines: [
      labour("ACSVC", "Air-con service & regas", 1.0, "std"),
      partLine("GAS-R1234", 1), partLine("FLT-CAB-A", 1),
    ],
    vhc: null,
    auth: { token: "demo4", sent: [] },
    notes: [], readyAt: ago(25),
    timeline: [
      { at: ago(25), who: "u-adv2", what: "Status → Ready for collection" },
      { at: ago(45), who: "u-fore", what: "Status → Quality check" },
    ],
    time: [{ id: "tm4", techId: "u-tec1", start: ago(160), end: ago(55) }],
    posting: [{ id: "p4", at: ago(300), kind: "jobcard", status: "posted", response: "Evolve accepted — RO JC-1044" }],
    partsRequests: [],
  });

  /* --- JC-1045 · invoiced but the post to Evolve failed --- */
  jobs.push({
    id: "job5", ref: ref(), createdAt: ago(2800), status: "invoiced",
    customerId: "c7", vehicleId: "v7", advisorId: "u-adv1", techId: "u-tec2", bayId: "b2",
    slot: { date: iso(-1), start: "10:00", durationMin: 90 },
    transport: "leave", odometer: 33200, fuel: "1/2",
    requested: [{ id: "r1", title: "30 000 km service", note: "Fleet account — no upsell without order number" }],
    lines: [
      labour("SVC30", "30 000 km major service", 2.4, "svc"),
      partLine("OIL-5W30-5L", 1), partLine("FLT-OIL-A", 1), partLine("FLT-AIR-A", 1), partLine("FLT-CAB-A", 1), partLine("PLUG-SET", 1),
    ],
    vhc: null,
    auth: { token: "demo5", sent: [] },
    invoice: { no: "INV-5101", at: ago(1400), by: "u-adv1", total: 9563.21, net: 8000, vat: 1200 },
    notes: [{ at: ago(1300), by: "u-adv1", text: "Posting failed — debtor on hold. Accounts phoned, order number to follow." }],
    timeline: [
      { at: ago(1390), who: "u-adv1", what: "Evolve invoice post failed — Debtor account on hold" },
      { at: ago(1400), who: "u-adv1", what: "Invoiced INV-5101" },
    ],
    time: [{ id: "tm5", techId: "u-tec2", start: ago(2600), end: ago(2450) }],
    posting: [
      { id: "p5b", at: ago(1390), kind: "invoice", status: "failed", response: "Debtor account on hold" },
      { id: "p5a", at: ago(2790), kind: "jobcard", status: "posted", response: "Evolve accepted — RO JC-1045" },
    ],
    partsRequests: [],
  });

  /* --- JC-1046 · collected yesterday, upsell taken --- */
  jobs.push({
    id: "job6", ref: ref(), createdAt: ago(3100), status: "collected",
    customerId: "c6", vehicleId: "v6", advisorId: "u-adv2", techId: "u-tec3", bayId: "b5",
    slot: { date: iso(-1), start: "08:00", durationMin: 150 },
    transport: "courtesy", odometer: 56300, fuel: "Full",
    requested: [{ id: "r1", title: "15 000 km service", note: "" }],
    lines: [
      labour("SVC15", "15 000 km minor service", 1.2, "svc"),
      partLine("OIL-5W30-5L", 1), partLine("FLT-OIL-A", 1),
      labour("BRKF", "Front brake overhaul", 1.5, "std", { authStatus: "approved", source: "evhc" }),
      partLine("PAD-FRT-B", 1, { authStatus: "approved", source: "evhc" }),
      partLine("WIPER-PAIR", 1, { authStatus: "declined", source: "evhc" }),
    ],
    vhc: {
      ref: "VHC-299", templateId: "vhc-standard", templateName: "Standard service health check",
      requirePhotoOn: ["r", "a"], techId: "u-tec3", startedAt: ago(3000), completedAt: ago(2900),
      items: [
        { id: "pad-f", group: "Brakes", label: "Front pads", rag: "r", note: "1.9mm", measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2, value: "1.9", photos: [] },
        { id: "wipers", group: "Interior & electrics", label: "Wiper blades & washers", rag: "a", note: "Smearing", value: "", unit: "", photos: [] },
        { id: "oil", group: "Under bonnet", label: "Engine oil level & condition", rag: "g", note: "", value: "", unit: "", photos: [] },
        { id: "lights", group: "Interior & electrics", label: "All lights", rag: "g", note: "", value: "", unit: "", photos: [] },
      ],
    },
    auth: {
      token: "demo6", otp: "9920", otpVerifiedAt: ago(2880),
      signedName: "E Coetzee", signedAt: ago(2870), method: "link", sent: [],
    },
    invoice: { no: "INV-5100", at: ago(2500), by: "u-adv2", total: 11240.5, net: 9400, vat: 1410 },
    notes: [],
    timeline: [
      { at: ago(2400), who: "u-adv2", what: "Status → Collected" },
      { at: ago(2870), who: "customer", what: "Customer authorised 2 item(s), declined 1" },
    ],
    time: [{ id: "tm6", techId: "u-tec3", start: ago(3050), end: ago(2600) }],
    posting: [{ id: "p6", at: ago(2499), kind: "invoice", status: "posted", response: "Evolve accepted — invoice INV-5100" }],
    partsRequests: [],
  });

  /* --- Tomorrow's diary --- */
  [
    { c: "c5", v: "v5", start: "07:30", title: "90 000 km service", adv: "u-adv1", dur: 240, transport: "leave" },
    { c: "c8", v: "v8", start: "08:00", title: "15 000 km service", adv: "u-adv2", dur: 90, transport: "wait" },
    { c: "c1", v: "v1", start: "10:00", title: "Four-wheel alignment", adv: "u-adv1", dur: 60, transport: "wait" },
    { c: "c3", v: "v3", start: "13:00", title: "Front brake overhaul", adv: "u-adv2", dur: 120, transport: "leave" },
  ].forEach(function (b, i) {
    jobs.push({
      id: "jobT" + i, ref: ref(), createdAt: ago(400 + i * 20), status: "booked",
      customerId: b.c, vehicleId: b.v, advisorId: b.adv, techId: null, bayId: null,
      slot: { date: iso(1), start: b.start, durationMin: b.dur },
      transport: b.transport, odometer: null, fuel: "",
      requested: [{ id: "r1", title: b.title, note: "" }],
      lines: [], vhc: null, auth: { token: "demoT" + i, sent: [] }, notes: [],
      timeline: [{ at: ago(400 + i * 20), who: b.adv, what: "Booking created" }],
      time: [], posting: [], partsRequests: [],
    });
  });

  return {
    version: 1,
    createdAt: CMS.nowISO(),
    config: cfg,
    customers: customers,
    vehicles: vehicles,
    jobs: jobs,
    prefs: {},
    seq: seq,
    /* Training switches — Setup → Integrations. Lets a trainer
       show a failed Evolve post without breaking anything. */
    simulate: { postingFailure: false, postingReason: "Debtor account on hold" },
    session: {},
  };
};
