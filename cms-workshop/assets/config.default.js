/* ============================================================
   CMS Workshop — default configuration
   ------------------------------------------------------------
   Everything a dealership can be set up differently on lives in
   this object. Nothing below is hard-coded anywhere else: the
   three apps read this, and Setup writes changes back into the
   saved copy. Export a dealer from Setup → Dealer profile and
   you get this shape back out as JSON, ready to import at the
   next site.
   ============================================================ */
window.CMS = window.CMS || {};
var CMS = window.CMS;

CMS.DEFAULT_CONFIG = {
  configVersion: 1,

  /* ---- Who this installation belongs to -------------------- */
  dealer: {
    name: "Demo Motors",
    franchise: "Multi-franchise",
    branch: "Centurion",
    address: "1 Lenchen Avenue, Centurion, 0157",
    phone: "012 000 0000",
    email: "service@demomotors.co.za",
    vatNo: "4000000000",
    dealerCode: "DM-CEN",
    /* Data URL. Blank = the CMS eco lock-up is used. A dealership
       that wants its own mark on the customer link uploads one in
       Setup → Branding; the staff apps stay CMS-branded. */
    logoDataUrl: "",
    customerLogoDataUrl: "",
  },

  /* ---- Money ----------------------------------------------- */
  money: {
    currency: "ZAR",
    symbol: "R",
    vatRate: 15,
    /* Prices are captured VAT-exclusive and displayed inclusive
       to the customer — compare VAT-exclusive before raising a
       price mismatch with Evolve. */
    displayVatInclusive: true,
    labourRates: [
      { id: "std", label: "Standard retail", rate: 795 },
      { id: "svc", label: "Service menu", rate: 720 },
      { id: "war", label: "Warranty", rate: 640 },
      { id: "int", label: "Internal", rate: 480 },
    ],
    defaultLabourRateId: "std",
    /* Applied over the Evolve price-file cost, cheapest band that
       the cost falls into wins. */
    partsMarkup: [
      { upTo: 500, pct: 45 },
      { upTo: 2500, pct: 35 },
      { upTo: 10000, pct: 28 },
      { upTo: null, pct: 22 },
    ],
    sundriesPct: 4,
    sundriesCap: 450,
  },

  /* ---- Diary ----------------------------------------------- */
  diary: {
    days: [1, 2, 3, 4, 5, 6],          // 0 = Sunday
    open: "07:00",
    close: "17:00",
    saturdayClose: "12:00",
    slotMinutes: 30,
    /* How many jobs may be booked into one slot across the
       workshop before the wizard warns. */
    slotCapacity: 4,
    dailyCapacityHours: 48,
    leadTimeDays: 14,
    allowOverbook: true,
    defaultDurationMin: 90,
  },

  /* ---- Resources ------------------------------------------- */
  bays: [
    { id: "b1", name: "Bay 1", type: "service" },
    { id: "b2", name: "Bay 2", type: "service" },
    { id: "b3", name: "Bay 3", type: "service" },
    { id: "b4", name: "Bay 4", type: "diagnostic" },
    { id: "b5", name: "Ramp 5", type: "repair" },
    { id: "b6", name: "Wash bay", type: "prep" },
  ],

  people: [
    { id: "u-adv1", name: "Thandi Mokoena", role: "advisor",  pin: "1111", initials: "TM", active: true, email: "thandi@demomotors.co.za" },
    { id: "u-adv2", name: "Riaan Steyn",    role: "advisor",  pin: "2222", initials: "RS", active: true, email: "riaan@demomotors.co.za" },
    { id: "u-fore", name: "Sipho Ndlovu",   role: "foreman",  pin: "3333", initials: "SN", active: true, email: "sipho@demomotors.co.za" },
    { id: "u-tec1", name: "Johan Pretorius",role: "tech",     pin: "4444", initials: "JP", active: true, skills: ["service", "diagnostic"], rateId: "std" },
    { id: "u-tec2", name: "Lebo Dlamini",   role: "tech",     pin: "5555", initials: "LD", active: true, skills: ["service", "repair"], rateId: "std" },
    { id: "u-tec3", name: "Andre Willemse", role: "tech",     pin: "6666", initials: "AW", active: true, skills: ["diagnostic", "repair"], rateId: "std" },
    { id: "u-par1", name: "Fatima Patel",   role: "parts",    pin: "7777", initials: "FP", active: true },
    { id: "u-mgr1", name: "Dean Naidoo",    role: "manager",  pin: "8888", initials: "DN", active: true },
    { id: "u-adm1", name: "Jacques R",      role: "admin",    pin: "9999", initials: "JR", active: true },
  ],

  /* ---- Roles: what each kind of user sees and may do -------
     `nav` is the order of the sidebar for that role — the first
     entry is also where they land at sign-in unless they set a
     personal landing page. Edit these in Setup → Roles. */
  roles: {
    advisor: {
      label: "Service advisor",
      nav: ["dashboard", "diary", "bookings", "jobs", "authorisations", "vhc", "customers", "reports"],
      can: ["book", "edit_job", "quote", "send_auth", "phone_auth", "invoice", "view_reports"],
    },
    foreman: {
      label: "Workshop foreman",
      nav: ["board", "jobs", "vhc", "parts", "diary", "reports"],
      can: ["dispatch", "edit_job", "assign_tech", "quote", "view_reports", "qc"],
    },
    tech: {
      label: "Technician",
      nav: ["myjobs"],
      can: ["clock", "vhc_capture", "request_parts", "request_auth"],
      appOnly: "workshop",            // technicians live in the workshop app
    },
    parts: {
      label: "Parts",
      nav: ["parts", "jobs", "reports"],
      can: ["pick_parts", "price_parts", "view_reports"],
    },
    manager: {
      label: "Workshop manager",
      nav: ["dashboard", "board", "jobs", "authorisations", "parts", "reports", "diary"],
      can: ["dispatch", "edit_job", "quote", "invoice", "view_reports", "qc", "override"],
    },
    admin: {
      label: "System administrator",
      nav: ["dashboard", "diary", "board", "bookings", "jobs", "vhc", "authorisations", "parts", "customers", "reports", "setup"],
      can: ["*"],
    },
  },

  /* ---- Modules on or off for this dealership --------------- */
  features: {
    vhc: true,
    vhcVideo: true,
    onlineAuthorisation: true,
    phoneAuthFallback: true,
    partsCatalogue: true,
    courtesyCars: true,
    collectAndDeliver: true,
    wallScreen: true,
    evolvePosting: true,
    superserviceMenus: true,
    customerTracking: true,
    qcSignOff: true,
    requireVhcBeforeInvoice: false,
  },

  /* ---- What things are called here -------------------------
     Franchises differ. Change the word once, it changes
     everywhere in all three apps. */
  terms: {
    job: "Job card",
    jobs: "Job cards",
    booking: "Booking",
    advisor: "Service advisor",
    tech: "Technician",
    techs: "Technicians",
    vhc: "eVHC",
    board: "Dispatch board",
    customer: "Customer",
    quote: "Quote",
    auth: "Authorisation",
    bay: "Bay",
    ro: "RO number",
  },

  /* ---- Job statuses ---------------------------------------
     Reorder, rename, recolour or remove — the board columns,
     the customer tracker and the reports all follow this list.
     `stage` drives the customer-facing tracker; `counts` marks
     the statuses that count as work-in-progress. */
  statuses: [
    { id: "booked",       label: "Booked",            tone: "grey",  stage: "booked",    wip: false },
    { id: "arrived",      label: "Arrived",           tone: "blue",  stage: "booked",    wip: true },
    { id: "in_progress",  label: "In progress",       tone: "turq",  stage: "working",   wip: true },
    { id: "vhc",          label: "Health check",      tone: "turq",  stage: "working",   wip: true },
    { id: "awaiting_auth",label: "Awaiting approval", tone: "amber", stage: "approval",  wip: true },
    { id: "parts_hold",   label: "Waiting on parts",  tone: "amber", stage: "working",   wip: true },
    { id: "work_complete",label: "Work complete",     tone: "green", stage: "working",   wip: true },
    { id: "qc",           label: "Quality check",     tone: "blue",  stage: "working",   wip: true },
    { id: "ready",        label: "Ready for collection", tone: "green", stage: "ready",  wip: false },
    { id: "invoiced",     label: "Invoiced",          tone: "blue",  stage: "ready",     wip: false },
    { id: "collected",    label: "Collected",         tone: "grey",  stage: "done",      wip: false },
  ],

  /* ---- Transport options offered at booking ---------------- */
  transport: [
    { id: "wait",     label: "Customer waits",   note: "Keep to under 2 hours" },
    { id: "leave",    label: "Leave the vehicle", note: "" },
    { id: "courtesy", label: "Courtesy car",     note: "Subject to availability", requires: "courtesyCars" },
    { id: "shuttle",  label: "Shuttle service",  note: "Within 15km" },
    { id: "collect",  label: "Collect & deliver", note: "Booked with the driver", requires: "collectAndDeliver" },
  ],

  /* ---- eVHC templates -------------------------------------
     A template is a list of groups, each with check items. An
     item may carry a measurement (tread depth, pad thickness)
     with amber/red thresholds so the tablet colours itself. */
  vhcTemplates: [
    {
      id: "vhc-standard",
      name: "Standard service health check",
      default: true,
      requirePhotoOn: ["r", "a"],     // photo mandatory on red and amber
      groups: [
        { name: "Under bonnet", items: [
          { id: "oil",      label: "Engine oil level & condition" },
          { id: "coolant",  label: "Coolant level & strength" },
          { id: "brakefl",  label: "Brake fluid", measure: "Boiling point", unit: "°C" },
          { id: "battery",  label: "Battery health", measure: "State of health", unit: "%", amberBelow: 70, redBelow: 55 },
          { id: "belts",    label: "Drive belts & hoses" },
          { id: "airfilt",  label: "Air filter" },
        ]},
        { name: "Tyres", items: [
          { id: "t-lf", label: "Tyre left front",  measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "t-rf", label: "Tyre right front", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "t-lr", label: "Tyre left rear",   measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "t-rr", label: "Tyre right rear",  measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "spare", label: "Spare / repair kit" },
        ]},
        { name: "Brakes", items: [
          { id: "pad-f", label: "Front pads", measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2 },
          { id: "pad-r", label: "Rear pads",  measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2 },
          { id: "disc-f",label: "Front discs" },
          { id: "disc-r",label: "Rear discs" },
          { id: "hbrake",label: "Parking brake" },
        ]},
        { name: "Under vehicle", items: [
          { id: "susp",  label: "Suspension & shocks" },
          { id: "steer", label: "Steering & track rods" },
          { id: "exh",   label: "Exhaust & mountings" },
          { id: "leaks", label: "Oil / fluid leaks" },
          { id: "cv",    label: "CV boots & driveshafts" },
        ]},
        { name: "Interior & electrics", items: [
          { id: "lights", label: "All lights" },
          { id: "wipers", label: "Wiper blades & washers" },
          { id: "horn",   label: "Horn & warning lamps" },
          { id: "aircon", label: "Air conditioning", measure: "Vent temp", unit: "°C" },
          { id: "cabin",  label: "Cabin filter" },
        ]},
      ],
    },
    {
      id: "vhc-quick",
      name: "Quick check (waiters)",
      requirePhotoOn: ["r"],
      groups: [
        { name: "Safety", items: [
          { id: "t-front", label: "Front tyres", measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "t-rear",  label: "Rear tyres",  measure: "Tread", unit: "mm", amberBelow: 3, redBelow: 1.6 },
          { id: "pads",    label: "Brake pads",  measure: "Remaining", unit: "mm", amberBelow: 4, redBelow: 2 },
          { id: "lights",  label: "Lights" },
          { id: "wipers",  label: "Wipers" },
          { id: "fluids",  label: "Fluid levels" },
        ]},
      ],
    },
  ],

  /* ---- Service menus --------------------------------------
     Stands in for Infomedia Superservice Menus. A real install
     pulls these per decoded VIN; the shape is the same, so the
     quote screen does not change when the live feed is wired in. */
  menus: [
    { id: "m-15k",  code: "SVC15",  title: "15 000 km minor service",  hours: 1.2, rateId: "svc", parts: ["OIL-5W30-5L", "FLT-OIL-A", "FLT-AIR-A", "SUMP-WSH"], franchise: "*" },
    { id: "m-30k",  code: "SVC30",  title: "30 000 km major service",  hours: 2.4, rateId: "svc", parts: ["OIL-5W30-5L", "FLT-OIL-A", "FLT-AIR-A", "FLT-CAB-A", "PLUG-SET", "SUMP-WSH"], franchise: "*" },
    { id: "m-90k",  code: "SVC90",  title: "90 000 km service + belt", hours: 4.5, rateId: "svc", parts: ["OIL-5W30-5L", "FLT-OIL-A", "FLT-AIR-A", "FLT-CAB-A", "BELT-KIT"], franchise: "*" },
    { id: "m-brk",  code: "BRKF",   title: "Front brake overhaul",     hours: 1.5, rateId: "std", parts: ["PAD-FRT-A", "DISC-FRT-A"], franchise: "*" },
    { id: "m-diag", code: "DIAG1",  title: "Diagnostic investigation (1h)", hours: 1.0, rateId: "std", parts: [], franchise: "*" },
    { id: "m-dpf",  code: "DPFCL",  title: "DPF forced regeneration",  hours: 1.8, rateId: "std", parts: ["DPF-ADD"], franchise: "*" },
    { id: "m-aircon", code: "ACSVC", title: "Air-con service & regas", hours: 1.0, rateId: "std", parts: ["GAS-R1234", "FLT-CAB-A"], franchise: "*" },
    { id: "m-geo",  code: "GEO4",   title: "Four-wheel alignment",     hours: 0.8, rateId: "std", parts: [], franchise: "*" },
  ],

  /* ---- Parts price file -----------------------------------
     Cost is the Evolve price-file cost; `list` is the OEM
     catalogue list price, which can legitimately differ.
     `supersededBy` mirrors the Microcat supersession chain. */
  parts: [
    { no: "OIL-5W30-5L", desc: "Engine oil 5W-30 fully synthetic 5L", cost: 420, list: 689, qty: 24, bin: "A1-04" },
    { no: "FLT-OIL-A",   desc: "Oil filter element",                  cost: 96,  list: 168, qty: 18, bin: "A2-11" },
    { no: "FLT-AIR-A",   desc: "Air filter panel",                    cost: 188, list: 315, qty: 9,  bin: "A2-14" },
    { no: "FLT-CAB-A",   desc: "Cabin pollen filter (carbon)",        cost: 214, list: 359, qty: 11, bin: "A2-16" },
    { no: "SUMP-WSH",    desc: "Sump plug washer",                    cost: 9,   list: 22,  qty: 140,bin: "A1-01" },
    { no: "PLUG-SET",    desc: "Spark plug set (4)",                  cost: 612, list: 980, qty: 6,  bin: "B1-07" },
    { no: "PAD-FRT-A",   desc: "Front brake pad set",                 cost: 980, list: 1560,qty: 4,  bin: "C3-02", supersededBy: "PAD-FRT-B" },
    { no: "PAD-FRT-B",   desc: "Front brake pad set (revised)",       cost: 1045,list: 1670,qty: 7,  bin: "C3-03" },
    { no: "DISC-FRT-A",  desc: "Front brake disc (each)",             cost: 890, list: 1420,qty: 6,  bin: "C3-08" },
    { no: "PAD-RR-A",    desc: "Rear brake pad set",                  cost: 760, list: 1225,qty: 5,  bin: "C3-05" },
    { no: "WIPER-PAIR",  desc: "Wiper blade pair",                    cost: 245, list: 420, qty: 16, bin: "D1-02" },
    { no: "BATT-65AH",   desc: "Battery 65Ah",                        cost: 1650,list: 2490,qty: 3,  bin: "E2-01" },
    { no: "BELT-KIT",    desc: "Timing belt kit + water pump",        cost: 3980,list: 5990,qty: 1,  bin: "B4-09" },
    { no: "GAS-R1234",   desc: "Refrigerant R1234yf (per kg)",        cost: 1280,list: 1890,qty: 4,  bin: "F1-01" },
    { no: "DPF-ADD",     desc: "DPF regeneration additive",           cost: 310, list: 495, qty: 8,  bin: "F1-04" },
    { no: "SHOCK-FRT",   desc: "Front shock absorber (each)",         cost: 1340,list: 2150,qty: 2,  bin: "C5-01" },
    { no: "TYRE-205-55", desc: "Tyre 205/55 R16",                     cost: 1180,list: 1790,qty: 8,  bin: "T-RACK" },
  ],

  /* ---- Customer authorisation policy ----------------------- */
  authorisation: {
    channels: ["sms", "whatsapp", "email"],
    defaultChannel: "whatsapp",
    otpRequired: true,
    otpLength: 4,
    signatureRequired: true,
    linkExpiryHours: 48,
    allowPartialApproval: true,        // customer may approve line by line
    declineReasonRequired: false,
    /* Anything at or above this rand value must go back to the
       customer even if they gave a blanket authorisation limit. */
    reAuthoriseAbove: 1500,
    terms:
      "Work is carried out on the terms displayed in the reception area. " +
      "Parts replaced are available for inspection on request for seven days. " +
      "Prices shown include VAT. This approval authorises the additional work listed above only.",
  },

  /* ---- Message templates ----------------------------------
     {{name}} {{ref}} {{dealer}} {{link}} {{otp}} {{advisor}}
     {{reg}} {{total}} {{time}} are substituted at send time. */
  messages: {
    auth_request: {
      label: "Approval request",
      sms: "{{dealer}}: Hi {{name}}, we found extra work on {{reg}}. Approve or decline here: {{link}} (OTP {{otp}}). Queries: {{advisor}}.",
      whatsapp: "Hi {{name}} 👋\n\nWe've finished the health check on your {{reg}} ({{ref}}).\n\nThere are items needing your decision — photos and prices are on the link below.\n\n{{link}}\nYour code: {{otp}}\n\n{{advisor}} · {{dealer}}",
      email: "Good day {{name}},\n\nThe health check on {{reg}} is complete and there are items that need your approval before we carry on.\n\nOpen {{link}} and use code {{otp}}.\n\nRegards\n{{advisor}}\n{{dealer}}",
    },
    booking_confirm: {
      label: "Booking confirmation",
      sms: "{{dealer}}: {{reg}} booked {{time}}. Ref {{ref}}. Track it here: {{link}}",
      whatsapp: "Booking confirmed ✅\n{{reg}} · {{time}}\nRef {{ref}}\n\nTrack progress and approve work here: {{link}}\n\n{{dealer}}",
      email: "Good day {{name}},\n\nYour booking for {{reg}} is confirmed for {{time}}.\nReference {{ref}}.\n\nYou can follow progress at {{link}}.\n\n{{dealer}}",
    },
    ready: {
      label: "Ready for collection",
      sms: "{{dealer}}: {{reg}} is ready for collection. Total {{total}}. Ref {{ref}}.",
      whatsapp: "Your {{reg}} is ready for collection 🚗\n\nTotal: {{total}}\nRef {{ref}}\n\nSee you at {{dealer}}.",
      email: "Good day {{name}},\n\n{{reg}} is ready for collection. The total is {{total}}.\n\n{{dealer}}",
    },
  },

  /* ---- Integrations ---------------------------------------- */
  integrations: {
    evolve: { enabled: true, endpoint: "https://evolve.example/api", dealerAccount: "DM-CEN", postOnOpen: true, postOnInvoice: true },
    infomedia: { enabled: true, brandCode: "DEMO", menusEnabled: true, catalogueEnabled: true, cacheHours: 24 },
    messaging: { smsProvider: "Clickatell", whatsappProvider: "Meta Cloud API", fromName: "Demo Motors" },
  },

  /* ---- Defaults for a brand-new user ----------------------- */
  prefDefaults: {
    theme: "light",           // light | dark | auto
    density: "comfortable",   // compact | comfortable | large
    rag: "standard",          // standard | accessible
    landing: "",              // blank = first nav item for the role
    boardGroupBy: "tech",     // tech | bay
    showHelp: true,
  },
};
