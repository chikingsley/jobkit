const STORAGE_KEY = "jobkit-campaign-flow-v3";
const MAX_CAMPAIGN_COUNTRIES = 3;
const PROFILE_FEEDBACK_PATTERN = /phone|email|signature|contact detail/u;
const WRITING_FEEDBACK_PATTERN =
  /formal|plain|tone|communicative|dear|hello|always|never|every message/u;
const CAMPAIGN_FEEDBACK_PATTERN =
  /week|date|monday|tuesday|wednesday|thursday|friday|campaign/u;

const MARKETS = {
  AL: {
    city: "Tirana, Durrës, and Korçë",
    code: "AL",
    contacts: 37,
    country: "Albania",
    freshness: "Verified 2 days ago",
    jobs: 6,
    schools: 58,
  },
  GE: {
    city: "Tbilisi and Batumi",
    code: "GE",
    contacts: 49,
    country: "Georgia",
    freshness: "Verified today",
    jobs: 8,
    schools: 84,
  },
  HU: {
    city: "Budapest, Szeged, and Debrecen",
    code: "HU",
    contacts: 63,
    country: "Hungary",
    freshness: "Verified yesterday",
    jobs: 11,
    schools: 94,
  },
  LT: {
    city: "Vilnius, Kaunas, and Klaipėda",
    code: "LT",
    contacts: 48,
    country: "Lithuania",
    freshness: "Verified 3 days ago",
    jobs: 9,
    schools: 72,
  },
  PL: {
    city: "Warsaw, Kraków, and Wrocław",
    code: "PL",
    contacts: 92,
    country: "Poland",
    freshness: "Verified today",
    jobs: 18,
    schools: 136,
  },
};
const MARKET_ORDER = ["PL", "GE", "AL", "HU", "LT"];

const BASE_TARGETS = [
  {
    city: "Warsaw",
    contactName: "Ms. Kowalska",
    countryCode: "PL",
    description:
      "Teach academic English to undergraduate students and lead small-group writing workshops. The school lists 18 teaching hours each week and provides an apartment near campus.",
    fit: "Strong",
    id: "pl-warsaw-academic",
    organization: "Warsaw International College",
    pay: "$2,950–$3,550/mo + housing",
    recipient: "m.kowalska@warsawcollege.example",
    requirements: [
      "Bachelor’s degree",
      "Two years of adult or university teaching",
      "Native-level English",
      "Available for an August start",
    ],
    route: "Direct email",
    source: "School careers page",
    title: "Academic English Lecturer",
    type: "posted",
  },
  {
    city: "Tbilisi",
    contactName: "",
    countryCode: "GE",
    description:
      "Full-time English teaching position for secondary students. The role combines classroom teaching, one weekly activity club, and curriculum planning with the English department.",
    fit: "Strong",
    id: "ge-tbilisi-secondary",
    organization: "Tbilisi International Academy",
    pay: "$1,850–$2,250/mo + housing",
    recipient: "careers@tbilisiacademy.example",
    requirements: [
      "Bachelor’s degree",
      "Recognized teaching qualification",
      "Experience with teenage learners",
      "Background check before arrival",
    ],
    route: "Direct email",
    source: "Current vacancy",
    title: "Secondary English Teacher",
    type: "posted",
  },
  {
    city: "Wrocław",
    contactName: "Dr. Nowak",
    countryCode: "PL",
    description:
      "The school has no current public vacancy. Its English department accepts direct expressions of interest from licensed teachers for upcoming primary and secondary openings.",
    fit: "Strong",
    id: "pl-wroclaw-school",
    organization: "Wrocław Community School",
    pay: "Compensation discussed after interest",
    recipient: "a.nowak@wroclawcommunity.example",
    requirements: [
      "Bachelor’s degree",
      "State teaching license",
      "Experience with school-age learners",
      "Willingness to relocate",
    ],
    route: "Verified school contact",
    source: "School directory and website",
    title: "English teaching inquiry",
    type: "school",
  },
  {
    city: "Batumi",
    contactName: "Mr. Beridze",
    countryCode: "GE",
    description:
      "The university invites applications for an English instructor supporting first-year academic writing and general English courses. Class sizes range from 18 to 30 students.",
    fit: "Strong",
    id: "ge-batumi-university",
    organization: "Batumi Metropolitan University",
    pay: "$1,650–$2,050/mo",
    recipient: "d.beridze@bmu.example",
    requirements: [
      "Bachelor’s degree",
      "Adult or university classroom experience",
      "Academic writing experience preferred",
      "Two professional references",
    ],
    route: "Direct email",
    source: "University vacancy",
    title: "University English Instructor",
    type: "posted",
  },
  {
    city: "Kraków",
    contactName: "",
    countryCode: "PL",
    description:
      "Teach English and homeroom support to upper-primary learners in an international program. The role includes 20 classroom hours, planning time, and a furnished studio.",
    fit: "Strong",
    id: "pl-krakow-primary",
    organization: "Kraków International Academy",
    pay: "$2,700–$3,200/mo + housing",
    recipient: "recruitment@krakowacademy.example",
    requirements: [
      "Bachelor’s degree",
      "Teaching license or equivalent",
      "Primary or middle-school experience",
      "Recent criminal background check",
    ],
    route: "Direct email",
    source: "Current vacancy",
    title: "Primary English Teacher",
    type: "posted",
  },
  {
    city: "Gdańsk",
    contactName: "Ms. Zielińska",
    countryCode: "PL",
    description:
      "A bilingual secondary school is building its candidate pool for English and humanities positions beginning in the autumn term.",
    fit: "Likely",
    id: "pl-gdansk-school",
    organization: "Gdańsk Bilingual School",
    pay: "Compensation discussed after interest",
    recipient: "k.zielinska@gdansk-bilingual.example",
    requirements: [
      "Bachelor’s degree",
      "Classroom teaching experience",
      "Teaching credential preferred",
      "Interest in a full-time role",
    ],
    route: "Verified school contact",
    source: "School website",
    title: "English teacher candidate pool",
    type: "school",
  },
  {
    city: "Kutaisi",
    contactName: "",
    countryCode: "GE",
    description:
      "Teach general English to secondary learners at a private school. The position includes 18 teaching hours and an optional after-school conversation club.",
    fit: "Strong",
    id: "ge-kutaisi-english",
    organization: "Kutaisi European School",
    pay: "$1,550–$1,900/mo + housing",
    recipient: "jobs@kutaiseuropean.example",
    requirements: [
      "Bachelor’s degree",
      "Two years of teaching experience",
      "Experience with teenagers",
      "TEFL or teaching license",
    ],
    route: "Direct email",
    source: "Current vacancy",
    title: "General English Teacher",
    type: "posted",
  },
  {
    city: "Tbilisi",
    contactName: "Ms. Kapanadze",
    countryCode: "GE",
    description:
      "A private K–12 school accepts direct applications from international English teachers for future vacancies and substitute coverage.",
    fit: "Likely",
    id: "ge-tbilisi-school",
    organization: "New Tbilisi School",
    pay: "Compensation discussed after interest",
    recipient: "n.kapanadze@newtbilisi.example",
    requirements: [
      "Bachelor’s degree",
      "Teaching experience",
      "School-age learner experience",
      "Availability within three months",
    ],
    route: "Verified school contact",
    source: "School website and directory",
    title: "English teaching inquiry",
    type: "school",
  },
];

const EXTRA_TITLES = [
  "English Language Teacher",
  "Academic Writing Instructor",
  "Middle School English Teacher",
  "Adult English Instructor",
  "English Program Teacher",
  "International School English Teacher",
];

const EXTRA_CITIES = {
  AL: ["Tirana", "Durrës", "Korçë", "Vlorë"],
  GE: ["Tbilisi", "Batumi", "Kutaisi", "Rustavi"],
  HU: ["Budapest", "Szeged", "Debrecen", "Pécs"],
  LT: ["Vilnius", "Kaunas", "Klaipėda", "Šiauliai"],
  PL: ["Warsaw", "Kraków", "Wrocław", "Gdańsk", "Poznań", "Łódź"],
};

const EXTRA_ORGANIZATIONS = {
  AL: [
    "Tirana International Academy",
    "Adriatic Learning School",
    "Albania Academic Centre",
    "Illyria International School",
  ],
  GE: [
    "Caucasus Learning School",
    "Georgia International College",
    "Black Sea Academy",
    "Tbilisi Modern School",
  ],
  HU: [
    "Danube International School",
    "Budapest Academic Centre",
    "Pannonia Learning Academy",
    "Central Europe School",
  ],
  LT: [
    "Baltic International School",
    "Vilnius Academic Centre",
    "Kaunas Learning Academy",
    "Lithuania Modern School",
  ],
  PL: [
    "Vistula International School",
    "Polonia Academic Centre",
    "New Europe Academy",
    "Central Poland School",
  ],
};

const TARGETS = buildTargets();

function buildTargets() {
  const targets = [...BASE_TARGETS];
  for (const countryCode of MARKET_ORDER) {
    const market = MARKETS[countryCode];
    for (const type of ["posted", "school"]) {
      const existing = targets.filter(
        (target) => target.countryCode === countryCode && target.type === type
      ).length;
      const baseCount = type === "posted" ? market.jobs : market.contacts;
      const desired = baseCount + (type === "school" ? 12 : 0);
      for (let sequence = existing; sequence < desired; sequence += 1) {
        targets.push(
          buildExtraTarget(
            targets.length,
            countryCode,
            type,
            sequence,
            type === "school" && sequence >= baseCount
          )
        );
      }
    }
  }
  return targets;
}

function buildExtraTarget(index, countryCode, type, sequence, discovered) {
  const market = MARKETS[countryCode];
  const cityOptions = EXTRA_CITIES[countryCode];
  const organizationOptions = EXTRA_ORGANIZATIONS[countryCode];
  const city = cityOptions[sequence % cityOptions.length];
  const organization =
    organizationOptions[sequence % organizationOptions.length];
  return {
    city,
    contactName: sequence % 4 === 0 ? "Ms. Director" : "",
    countryCode,
    description: extraDescription(type, city, market.country),
    discovered,
    fit: index % 6 === 0 ? "Likely" : "Strong",
    id: `${countryCode.toLowerCase()}-${type}-${sequence + 1}`,
    organization,
    pay: extraPay(type, countryCode),
    recipient: `${type}-${sequence + 1}@${slugOf(organization)}.example`,
    requirements: [
      "Bachelor’s degree",
      "Relevant teaching experience",
      "Native-level English",
      type === "posted"
        ? "Available for the listed start date"
        : "Open to relocation",
    ],
    route: type === "posted" ? "Direct email" : "Verified school contact",
    source: type === "posted" ? "Current vacancy" : "Verified school website",
    title:
      type === "posted"
        ? EXTRA_TITLES[index % EXTRA_TITLES.length]
        : "English teaching inquiry",
    type,
  };
}

function extraDescription(type, city, country) {
  if (type === "posted") {
    return `A current English teaching opportunity in ${city} with a verified application route, a defined learner group, and a full-time schedule.`;
  }
  return `A verified ${country.toLowerCase()} school contact accepting direct expressions of interest from experienced English teachers.`;
}

function extraPay(type, countryCode) {
  if (type !== "posted") {
    return "Compensation discussed after interest";
  }
  const ranges = {
    AL: "$1,250–$1,750/mo",
    GE: "$1,450–$1,950/mo",
    HU: "$1,900–$2,650/mo",
    LT: "$2,050–$2,750/mo",
    PL: "$2,350–$3,050/mo",
  };
  return ranges[countryCode];
}

function defaultState() {
  return {
    accountMenuOpen: false,
    activities: [
      {
        detail: "Selected market inventory verified",
        time: "Just now",
      },
    ],
    calibrationEnabled: true,
    calibrationIndex: 0,
    calibrationOpen: false,
    campaignStarted: false,
    customize: false,
    dailyPace: 10,
    decisions: {},
    detailTargetId: "",
    directEditTargetId: "",
    feedbackProposal: null,
    feedbackRules: [],
    findMore: {},
    marketQuery: "",
    marketsCollapsed: false,
    messageChanges: {},
    previewFilter: "all",
    researchMarketCode: "",
    revisedMessages: {},
    revisionDrafts: {},
    run: {
      day: 1,
      replies: [],
      sent: 0,
      status: "draft",
    },
    selectedCountries: ["PL", "GE"],
    stopAfter: 3,
    strategy: "openings-first",
  };
}

let state = loadState();

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return stored ? { ...defaultState(), ...stored } : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateState(patch, shouldRender = true) {
  state = { ...state, ...patch };
  saveState();
  if (shouldRender) {
    render();
  }
}

function slugOf(value) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name, className = "icon") {
  const paths = {
    arrowLeft: '<path d="m15 18-6-6 6-6"/><path d="M21 12H9"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    briefcase:
      '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    external:
      '<path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>',
    message:
      '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    pause:
      '<rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    refresh:
      '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sparkles:
      '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
    target:
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    unlock:
      '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  return `<svg aria-hidden="true" class="${className}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${paths[name] ?? paths.target}</svg>`;
}

function currentRoute() {
  return location.hash.slice(1) || "campaigns";
}

function navigate(route) {
  if (currentRoute() === route) {
    window.scrollTo({ left: 0, top: 0 });
    render();
    return;
  }
  location.hash = route;
}

function handleRouteChange() {
  window.scrollTo({ left: 0, top: 0 });
  render();
}

function activeArea(route) {
  if (["campaigns", "new", "preview", "running"].includes(route)) {
    return "campaigns";
  }
  return route;
}

function selectedTargets() {
  const candidates = TARGETS.filter(
    (target) =>
      state.selectedCountries.includes(target.countryCode) &&
      (!target.discovered || state.findMore[target.countryCode])
  );
  const queues = {
    posted: candidates.filter((target) => target.type === "posted"),
    school: candidates.filter((target) => target.type === "school"),
  };
  const mix = dailyMix();
  const selected = [];

  while (queues.posted.length > 0 || queues.school.length > 0) {
    const countBeforePass = selected.length;
    for (const type of ["posted", "school"]) {
      const quota = mix[type];
      selected.push(...queues[type].splice(0, quota));
    }
    if (selected.length === countBeforePass) {
      selected.push(...queues.posted.splice(0), ...queues.school.splice(0));
    }
  }
  return selected;
}

function targetMix() {
  const mix = { posted: 0, school: 0 };
  for (const target of selectedTargets()) {
    mix[target.type] += 1;
  }
  return mix;
}

function dailyMix(strategy = state.strategy) {
  const ratios = {
    balanced: 0.5,
    "openings-first": 0.8,
    proactive: 0.25,
  };
  const posted = Math.round(state.dailyPace * ratios[strategy]);
  return { posted, school: Math.max(0, state.dailyPace - posted) };
}

function marketTotals() {
  return state.selectedCountries.reduce(
    (totals, code) => {
      const market = MARKETS[code];
      const extra = state.findMore[code]
        ? { contacts: 12, schools: 18 }
        : { contacts: 0, schools: 0 };
      return {
        contacts: totals.contacts + market.contacts + extra.contacts,
        jobs: totals.jobs + market.jobs,
        schools: totals.schools + market.schools + extra.schools,
      };
    },
    { contacts: 0, jobs: 0, schools: 0 }
  );
}

function messageFor(target) {
  const saved = state.revisedMessages[target.id];
  if (saved) {
    return saved;
  }
  const greeting = target.contactName
    ? `Hello, ${target.contactName},`
    : "Hello,";
  const roleSentence =
    target.type === "posted"
      ? `I’m interested in the ${target.title} position at ${target.organization}.`
      : `I’m interested in teaching English at ${target.organization}.`;
  const evidence =
    target.title.toLowerCase().includes("university") ||
    target.title.toLowerCase().includes("academic")
      ? "I have experience teaching adults and university students in the United States and Russia, including leading large biology review lectures and working one-on-one with learners across age groups."
      : "I have experience teaching children, teenagers, and adults in the United States and Russia in both group classes and one-on-one lessons.";
  return `${greeting}\n\n${roleSentence}\n\n${evidence} I hold a bachelor’s degree and an Arizona teaching license.\n\nI’ve attached my resume, diploma, teaching license, and photo. Are you available to talk next week about the role?\n\nBest,\nChibuzor Ejimofor\nM: +1 (304) 216-8700\nE: chibuzor.ejimofor@gmail.com`;
}

function subjectFor(target) {
  return target.type === "posted"
    ? `Application — ${target.title}`
    : `English teaching inquiry — ${target.organization}`;
}

function statusForTarget(target, index) {
  const decision = state.decisions[target.id];
  if (decision === "held") {
    return "Held";
  }
  if (!state.campaignStarted) {
    return index < 5 ? "Calibration" : "Planned";
  }
  if (index < state.run.sent) {
    return "Sent";
  }
  return state.run.status === "paused" ? "Paused" : "Scheduled";
}

function render() {
  const route = currentRoute();
  const app = document.querySelector("#app");
  const pages = {
    campaigns: renderCampaignHome,
    jobs: renderJobsPage,
    messages: renderMessagesPage,
    new: renderCampaignSetup,
    preview: renderCampaignPreview,
    profile: () =>
      renderPlaceholder(
        "Profile",
        "Resume, experience, preferences, documents, and account connections remain together here."
      ),
    running: renderCampaignDashboard,
    writing: () =>
      renderPlaceholder(
        "Writing",
        "Approved message foundations, examples, and reusable feedback live here."
      ),
  };
  const page = pages[route] ?? renderCampaignHome;
  app.innerHTML = renderShell(route, page());
  document.title = `JobKit · ${pageTitle(route)}`;
  renderOverlays();
  document.body.style.overflow =
    state.calibrationOpen ||
    state.detailTargetId ||
    state.accountMenuOpen ||
    state.researchMarketCode
      ? "hidden"
      : "";
}

function pageTitle(route) {
  return (
    {
      campaigns: "Campaigns",
      jobs: "Jobs",
      messages: "Messages",
      new: "New campaign",
      preview: "Campaign preview",
      profile: "Profile",
      running: "Campaign dashboard",
      writing: "Writing",
    }[route] ?? "Campaigns"
  );
}

function campaignName() {
  const names = state.selectedCountries.map((code) => MARKETS[code].country);
  return names.join(" + ") || "New campaign";
}

function renderShell(route, content) {
  const active = activeArea(route);
  const navItems = [
    ["campaigns", "Campaigns"],
    ["jobs", "Jobs"],
    ["messages", "Messages"],
    ["writing", "Writing"],
    ["profile", "Profile"],
  ];
  return `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#campaigns" aria-label="JobKit campaigns">
          <span class="brand-mark">J</span>
          <span>JobKit</span>
        </a>
        <nav aria-label="Main navigation" class="main-nav">
          ${navItems
            .map(
              ([href, label]) => `
                <a class="nav-link" href="#${href}" ${active === href ? 'aria-current="page"' : ""}>
                  ${label}
                </a>`
            )
            .join("")}
        </nav>
        <div class="topbar-actions">
          <span class="badge badge-brand">Prototype</span>
          <button aria-expanded="${state.accountMenuOpen}" aria-label="Open account menu" class="avatar-button" data-action="toggle-account-menu">CE</button>
        </div>
      </header>
      ${content}
    </div>`;
}

function renderCampaignHome() {
  const targets = selectedTargets();
  const mix = targetMix();
  const activeCard = state.campaignStarted
    ? `
      <section class="card card-pad stack" aria-label="Active campaign">
        <div class="section-heading">
          <div>
            <div class="row-wrap">
              <h2>${campaignName()}</h2>
              <span class="status-pill" data-status="${state.run.status}"><span class="status-dot"></span>${state.run.status === "paused" ? "Paused" : "Running"}</span>
            </div>
            <p class="muted text-sm">${targets.length} eligible targets · ${mix.posted} advertised opportunities · ${mix.school} direct school contacts</p>
          </div>
          <button class="button button-secondary" data-route="running">Open campaign ${icon("arrowRight")}</button>
        </div>
        <div class="metric-grid">
          <div class="metric"><span class="metric-value">${state.run.sent}</span><span class="metric-label">Sent</span></div>
          <div class="metric"><span class="metric-value">${state.run.replies.length}</span><span class="metric-label">Human replies</span></div>
          <div class="metric"><span class="metric-value">${Math.max(0, targets.length - state.run.sent)}</span><span class="metric-label">Eligible</span></div>
          <div class="metric"><span class="metric-value">${state.dailyPace}</span><span class="metric-label">Daily pace</span></div>
        </div>
      </section>`
    : `
      <section class="card empty-campaign">
        <div>
          <div class="empty-icon">${icon("target", "icon")}</div>
          <h2>Choose your markets. JobKit handles the campaign.</h2>
          <p>Select countries, confirm the recommended plan, approve the first five messages, and watch outreach move.</p>
          <button class="button button-primary button-large" data-route="new">${icon("plus")} New campaign</button>
        </div>
      </section>`;

  return `
    <main class="page page-narrow">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Application workspace</p>
          <h1>Campaigns</h1>
          <p class="lede">Create a targeted job search, then stay focused on replies and decisions.</p>
        </div>
        ${state.campaignStarted ? `<button class="button button-primary" data-route="new">${icon("plus")} New campaign</button>` : ""}
      </div>
      <div class="stack">
        <div class="notice notice-success">
          <span class="check-dot">✓</span>
          <div><strong>Your application kit is ready.</strong><br />Profile, writing preferences, documents, and Gmail are approved for campaign use.</div>
        </div>
        ${activeCard}
        <section class="steps" aria-label="How campaigns work">
          <article class="step-card"><span class="step-number">1</span><h3>Choose markets</h3><p class="muted text-sm">See current jobs, verified schools, contacts, and coverage before starting.</p></article>
          <article class="step-card"><span class="step-number">2</span><h3>Confirm the plan</h3><p class="muted text-sm">Use the recommended mix and limits, or unlock exact controls.</p></article>
          <article class="step-card"><span class="step-number">3</span><h3>Watch and respond</h3><p class="muted text-sm">JobKit prepares and sends while replies automatically control the pace.</p></article>
        </section>
      </div>
    </main>`;
}

function renderCampaignSetup() {
  const totals = marketTotals();
  const targets = selectedTargets();
  const mix = targetMix();
  const sendMix = dailyMix("openings-first");
  const query = state.marketQuery.trim().toLowerCase();
  const visibleMarkets = MARKET_ORDER.map((code) => MARKETS[code]).filter(
    (market) =>
      !query || `${market.country} ${market.city}`.toLowerCase().includes(query)
  );
  const marketCountLabel = visibleMarkets.length === 1 ? "market" : "markets";
  return `
    <main class="page">
      <button class="back-link" data-route="campaigns">${icon("arrowLeft")} Campaigns</button>
      <div class="page-heading">
        <div>
          <p class="eyebrow">New campaign</p>
          <h1>Where do you want to work?</h1>
          <p class="lede">Choose one or more countries. JobKit will use current openings first, then verified school contacts to complete the plan.</p>
        </div>
      </div>
      <div class="split">
        <div class="stack">
          <section class="card card-pad">
            <div class="section-heading">
              <div><h2>Target markets</h2><p class="muted text-sm">Choose up to ${MAX_CAMPAIGN_COUNTRIES} countries with similar goals. Start another campaign for a different market set.</p></div>
              <span class="badge badge-brand">${state.selectedCountries.length} of ${MAX_CAMPAIGN_COUNTRIES} selected</span>
            </div>
            ${renderMarketPicker(visibleMarkets, marketCountLabel, totals)}
          </section>

          <section class="card card-pad stack" id="campaign-plan">
            <div class="section-heading">
              <div><h2>Campaign plan</h2><p class="muted text-sm">Start from the full eligible pool, then control pace and stopping behavior.</p></div>
              <button class="button button-secondary button-small" data-action="toggle-customize">${icon(state.customize ? "lock" : "unlock")} ${state.customize ? "Use recommended" : "Customize"}</button>
            </div>

            <div class="form-section">
              <div>
                <span class="field-label">Source strategy</span>
                <div class="radio-grid">
                  ${renderStrategyOption("openings-first", "Openings first", "Starting mix", `Aim for ${sendMix.posted} advertised opportunities and ${sendMix.school} direct school contacts per full day while both remain.`)}
                  ${renderStrategyOption("balanced", "Balanced", "50 / 50", "Split each day evenly between advertised opportunities and direct school outreach while both remain.")}
                  ${renderStrategyOption("proactive", "School outreach", "Proactive", "Favor verified school contacts while continuing to include advertised opportunities.")}
                </div>
              </div>
            </div>

            <div class="form-section">
              <label class="switch-row" for="calibration-enabled">
                <span><strong class="text-sm">Approve the first five messages</strong><span class="muted text-xs">Review full context, revise when needed, and allow reusable feedback to update remaining drafts.</span></span>
                <input ${state.calibrationEnabled ? "checked" : ""} class="visually-hidden" data-field="calibration-enabled" id="calibration-enabled" type="checkbox" />
                <span class="switch" data-checked="${state.calibrationEnabled}"></span>
              </label>
            </div>

            ${
              state.customize
                ? renderAdvancedControls()
                : `
              <div class="notice">
                ${icon("target")}
                <div><strong>Starting controls</strong><br />${targets.length} currently eligible targets, up to ${state.dailyPace} sends per day, and automatic pause after ${state.stopAfter} human replies.</div>
              </div>`
            }
          </section>
        </div>

        <aside class="card recommended-card">
          <div class="recommended-banner"><span>${icon("briefcase")} Campaign pool</span><span class="badge badge-brand">Live search</span></div>
          <div class="card-body stack">
            <div class="queue-heading">
              <span class="muted text-xs">${campaignName()}</span>
              <div><strong>${targets.length}</strong><span>eligible targets</span></div>
              <p class="muted text-sm">JobKit can work through this full pool until ${state.stopAfter} people reply, the pool is exhausted, or you stop it.</p>
            </div>
            <div class="source-allocation">
              <div><strong>${mix.posted}</strong><span>Advertised opportunities</span><small>Warm · ${totals.jobs} currently available</small></div>
              <div><strong>${mix.school}</strong><span>Direct school contacts</span><small>Cold · ${totals.contacts} verified routes</small></div>
            </div>
            <div class="plan-summary">
              <div class="summary-row"><span>Starting pace</span><strong>Up to ${state.dailyPace} / day</strong></div>
              <div class="summary-row"><span>Automatic pause</span><strong>${state.stopAfter} human replies</strong></div>
            </div>
            <div class="launch-requirements">
              <div><h3>Launch requirements</h3><p class="muted text-xs">Only genuine blockers stop the campaign.</p></div>
              <div class="readiness">
                <div class="readiness-item"><span>Candidate profile</span><strong class="requirement-status" data-status="ready">Ready</strong></div>
                <div class="readiness-item"><span>Sending account</span><strong class="requirement-status" data-status="ready">Ready</strong></div>
                <div class="readiness-item"><span>Resume</span><strong class="requirement-status" data-status="ready">Ready</strong></div>
                <div class="readiness-item"><span>Writing style</span><strong class="requirement-status" data-status="next">First-five review</strong></div>
                <div class="readiness-item"><span>Extra documents</span><strong class="requirement-status">As required</strong></div>
              </div>
            </div>
            <button class="button button-primary button-large button-block" ${state.selectedCountries.length === 0 ? "disabled" : ""} data-route="preview">Preview ${targets.length} targets ${icon("arrowRight")}</button>
            <p class="faint text-xs" style="margin:0;text-align:center">Nothing is sent from this prototype.</p>
          </div>
        </aside>
      </div>
    </main>`;
}

function renderMarketPicker(visibleMarkets, marketCountLabel, totals) {
  if (
    state.marketsCollapsed &&
    state.selectedCountries.length === MAX_CAMPAIGN_COUNTRIES
  ) {
    return `
      <div class="market-selection-summary">
        <div class="selected-market-list">
          ${state.selectedCountries
            .map(
              (code) => `
                <button aria-label="Remove ${MARKETS[code].country}" class="selected-market-pill" data-action="remove-country" data-code="${code}">
                  <span class="country-code">${code}</span>
                  <strong>${MARKETS[code].country}</strong>
                  ${icon("x")}
                </button>`
            )
            .join("")}
        </div>
        <div class="market-selection-meta">
          <span><strong>${totals.jobs}</strong> current openings</span>
          <span><strong>${totals.schools}</strong> known schools</span>
          <span><strong>${totals.contacts}</strong> verified contacts</span>
        </div>
        <div class="market-selection-footer">
          <span class="muted text-xs">This is the available source pool. The campaign plan decides how many are contacted.</span>
          <button class="button button-secondary button-small" data-action="expand-markets">Change markets</button>
        </div>
      </div>`;
  }
  return `
    <div class="market-toolbar">
      <label class="market-search">
        ${icon("search")}
        <span class="visually-hidden">Search countries</span>
        <input autocomplete="off" data-field="market-search" placeholder="Search countries or cities" type="search" value="${escapeHtml(state.marketQuery)}" />
      </label>
      <span class="muted text-xs">${visibleMarkets.length} ${marketCountLabel} shown</span>
    </div>
    <div class="country-list">
      ${visibleMarkets.map(renderCountryCard).join("") || '<div class="market-empty"><strong>No markets found</strong><span>Try another country or city.</span></div>'}
    </div>`;
}

function renderCountryCard(market) {
  const selected = state.selectedCountries.includes(market.code);
  const expanded = Boolean(state.findMore[market.code]);
  const limitReached =
    !selected && state.selectedCountries.length >= MAX_CAMPAIGN_COUNTRIES;
  return `
    <article class="country-card" data-limit-reached="${limitReached}" data-selected="${selected}">
      <button aria-pressed="${selected}" class="country-select" data-action="toggle-country" data-code="${market.code}" ${limitReached ? "disabled" : ""}>
        <span class="country-card-top">
          <span class="country-title"><span class="country-code">${market.code}</span><span><strong>${market.country}</strong><span class="muted text-xs" style="display:block;margin-top:4px">${market.city}</span></span></span>
          <span class="selection-check">${icon("check")}</span>
        </span>
        <span class="country-metrics">
          <span class="country-metric"><strong>${market.jobs}</strong><span>Open jobs</span></span>
          <span class="country-metric"><strong>${market.schools + (expanded ? 18 : 0)}</strong><span>Schools</span></span>
          <span class="country-metric"><strong>${market.contacts + (expanded ? 12 : 0)}</strong><span>Contacts</span></span>
        </span>
      </button>
      <div class="country-footer"><span>${expanded ? "Expanded just now" : market.freshness}</span><button class="button button-ghost button-small" data-action="find-more" data-code="${market.code}">${icon(expanded ? "check" : "search")} ${expanded ? "Expanded" : "Expand coverage"}</button></div>
    </article>`;
}

function renderStrategyOption(value, label, badge, description) {
  const selected = state.strategy === value;
  return `
    <label class="option-card" data-action="select-strategy" data-selected="${selected}" data-value="${value}">
      <input ${selected ? "checked" : ""} name="strategy" type="radio" value="${value}" />
      <span class="row-wrap"><span class="option-title">${label}</span><span class="badge ${value === "openings-first" ? "badge-brand" : ""}">${badge}</span></span>
      <span class="option-description">${description}</span>
    </label>`;
}

function renderAdvancedControls() {
  return `
    <div class="form-section">
      <div class="advanced-panel">
        <label><span class="field-label">Daily pace</span><input class="input" data-field="daily-pace" min="1" type="number" value="${state.dailyPace}" /><p class="field-help">Starting pace; tune it from delivery and reply data.</p></label>
        <label><span class="field-label">Pause after human replies</span><input class="input" data-field="stop-after" min="1" type="number" value="${state.stopAfter}" /><p class="field-help">Every person-authored reply counts. Automated mail does not.</p></label>
      </div>
    </div>`;
}

function renderCampaignPreview() {
  const targets = selectedTargets();
  const mix = targetMix();
  const visibleTargets = targets.filter(
    (target) =>
      state.previewFilter === "all" || target.type === state.previewFilter
  );
  return `
    <main class="page">
      <button class="back-link" data-route="new">${icon("arrowLeft")} Campaign setup</button>
      <div class="page-heading">
        <div>
          <p class="eyebrow">Plan preview</p>
          <h1>${campaignName()}</h1>
          <p class="lede">Review the shape of the campaign. Open any target for the full source, qualifications, recipient, message, and packet.</p>
        </div>
        <button class="button button-primary button-large" data-action="begin-campaign">${state.calibrationEnabled ? "Review first five" : "Start campaign"} ${icon("arrowRight")}</button>
      </div>

      <section class="preview-summary" aria-label="Campaign summary">
        <div class="preview-stat"><strong>${targets.length}</strong><span>Eligible targets</span></div>
        <div class="preview-stat"><strong>${mix.posted}</strong><span>Advertised opportunities</span></div>
        <div class="preview-stat"><strong>${mix.school}</strong><span>Direct school contacts</span></div>
        <div class="preview-stat"><strong>${state.dailyPace}/day</strong><span>Starting pace</span></div>
        <div class="preview-stat"><strong>${state.stopAfter}</strong><span>Human replies to pause</span></div>
      </section>

      <div class="stack" style="margin-top:18px">
        <div class="notice notice-success">
          ${icon("sparkles")}
          <div><strong>Five-message calibration is enabled.</strong><br />The first five messages sample every selected country plus advertised positions and direct school outreach. Reusable feedback can update all remaining drafts.</div>
        </div>
        <div class="filter-row">
          <div class="tabs" role="tablist" aria-label="Target filters">
            ${renderTargetTab("all", `All ${targets.length}`)}
            ${renderTargetTab("posted", `Openings ${mix.posted}`)}
            ${renderTargetTab("school", `School contacts ${mix.school}`)}
          </div>
        </div>
        <section class="target-list" aria-label="Campaign targets">
          ${visibleTargets.map((target) => renderTargetRow(target, targets.indexOf(target))).join("")}
        </section>
      </div>
    </main>`;
}

function renderTargetTab(value, label) {
  return `<button aria-selected="${state.previewFilter === value}" class="tab" data-action="filter-targets" data-value="${value}" role="tab">${label}</button>`;
}

function renderTargetRow(target, index, includeStatus = false) {
  const market = MARKETS[target.countryCode];
  return `
    <button class="target-row" data-action="open-target" data-target-id="${target.id}">
      <span class="target-main"><strong>${escapeHtml(target.title)}</strong><span>${escapeHtml(target.organization)} · ${escapeHtml(target.city)}</span></span>
      <span class="target-cell target-country"><strong>${market.country}</strong><br />${target.type === "posted" ? "Advertised position" : "School outreach"}</span>
      <span class="target-cell target-pay">${escapeHtml(target.pay)}</span>
      <span class="target-cell target-route">${includeStatus ? `<span class="badge ${statusBadgeClass(statusForTarget(target, index))}">${statusForTarget(target, index)}</span>` : escapeHtml(target.route)}</span>
      <span>${icon("chevron")}</span>
    </button>`;
}

function statusBadgeClass(status) {
  return (
    {
      Held: "badge-warning",
      Paused: "badge-warning",
      Scheduled: "badge-info",
      Sent: "badge-brand",
    }[status] ?? ""
  );
}

function renderCampaignDashboard() {
  const targets = selectedTargets();
  const { replies } = state.run;
  const pausedByReplies =
    state.run.status === "paused" && replies.length >= state.stopAfter;
  return `
    <main class="page">
      <button class="back-link" data-route="campaigns">${icon("arrowLeft")} Campaigns</button>
      <div class="dashboard-header">
        <div>
          <div class="row-wrap" style="margin-bottom:9px">
            <span class="status-pill" data-status="${state.run.status}"><span class="status-dot"></span>${state.run.status === "paused" ? "Paused" : "Running"}</span>
            <span class="badge">Day ${state.run.day}</span>
          </div>
          <h1>${campaignName()}</h1>
          <p class="lede">${targets.length} eligible targets · up to ${state.dailyPace} sends per day · pause after ${state.stopAfter} human replies</p>
        </div>
        <div class="row-wrap">
          <button class="button button-secondary" data-action="simulate-batch">Simulate next batch</button>
          <button class="button ${state.run.status === "paused" ? "button-primary" : "button-secondary"}" data-action="toggle-run">${icon(state.run.status === "paused" ? "play" : "pause")} ${state.run.status === "paused" ? "Resume" : "Pause"}</button>
        </div>
      </div>

      ${
        pausedByReplies
          ? `
        <section class="pause-banner">
          <div><h3>Campaign paused after ${replies.length} human replies</h3><p>${Math.max(0, targets.length - state.run.sent)} eligible targets remain. Automated mail and bounces were ignored.</p></div>
          <button class="button button-primary" data-route="messages">Review replies ${icon("arrowRight")}</button>
        </section>`
          : ""
      }

      <div class="dashboard-grid">
        <div class="stack">
          <section class="card progress-card">
            <div class="campaign-progress">
              <div><strong>${state.run.sent}</strong><span>Sent</span></div>
              <div><strong>${replies.length}</strong><span>Human replies</span></div>
              <div><strong>${Math.max(0, targets.length - state.run.sent)}</strong><span>Eligible</span></div>
              <div><strong>${decisionCount("held")}</strong><span>Held</span></div>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><div><h2>Applications</h2><p class="muted text-sm">Every target can still be inspected from the live campaign.</p></div><span class="badge">${targets.length} total</span></div>
            <div class="target-list" style="border:0;border-radius:0">
              ${targets
                .slice(0, 12)
                .map((target, index) => renderTargetRow(target, index, true))
                .join("")}
            </div>
            <div class="card-footer"><button class="button button-ghost button-small" data-action="show-all-targets">Show all ${targets.length}</button></div>
          </section>
        </div>

        <aside class="stack">
          <section class="card card-pad">
            <div class="section-heading"><div><h2>Market progress</h2><p class="muted text-xs">Sent outreach by country.</p></div></div>
            <div class="market-breakdown">
              ${state.selectedCountries.map((code) => renderMarketProgress(code, targets)).join("")}
            </div>
          </section>

          <section class="card card-pad">
            <div class="section-heading"><div><h2>Reply stop rule</h2><p class="muted text-xs">Bounces and automatic acknowledgements are ignored.</p></div><span class="badge ${replies.length >= state.stopAfter ? "badge-warning" : "badge-brand"}">${replies.length} / ${state.stopAfter}</span></div>
            ${replies.length > 0 ? `<div class="reply-list">${replies.map(renderReplyCard).join("")}</div>` : `<div class="notice"><div>Simulate replies to see the campaign pause automatically after ${state.stopAfter} people respond. Bounces and automated replies are ignored.</div></div>`}
            ${replies.length < state.stopAfter ? `<button class="button button-secondary button-block" style="margin-top:12px" data-action="simulate-replies">Simulate ${state.stopAfter} replies</button>` : ""}
          </section>

          <section class="card card-pad">
            <div class="section-heading"><div><h2>Activity</h2><p class="muted text-xs">The operational story in plain language.</p></div></div>
            <div class="activity-list">${state.activities.slice(0, 6).map(renderActivity).join("")}</div>
          </section>
        </aside>
      </div>
    </main>`;
}

function renderMarketProgress(code, targets) {
  const planned = targets.filter(
    (target) => target.countryCode === code
  ).length;
  const sent = targets
    .slice(0, state.run.sent)
    .filter((target) => target.countryCode === code).length;
  return `
    <div class="market-row">
      <div class="market-row-head"><strong>${MARKETS[code].country}</strong><span class="muted">${sent} of ${planned} sent</span></div>
      <div class="bar"><div style="width:${planned ? Math.min(100, (sent / planned) * 100) : 0}%"></div></div>
    </div>`;
}

function renderReplyCard(reply) {
  return `<article class="reply-card"><div class="row-wrap"><strong class="text-xs">${escapeHtml(reply.from)}</strong><span class="badge ${reply.intent === "Interview" ? "badge-brand" : "badge-info"}">${reply.intent}</span></div><p>${escapeHtml(reply.preview)}</p></article>`;
}

function renderActivity(activity) {
  return `<div class="activity-item"><span class="activity-dot"></span><span class="text-xs">${escapeHtml(activity.detail)}</span><time>${escapeHtml(activity.time)}</time></div>`;
}

function decisionCount(status) {
  return Object.values(state.decisions).filter(
    (decision) => decision === status
  ).length;
}

function renderJobsPage() {
  const targets = selectedTargets().slice(0, 8);
  return `
    <main class="page">
      <div class="page-heading"><div><p class="eyebrow">Manual control</p><h1>Jobs</h1><p class="lede">The existing one-by-one workspace remains available. It uses the same targets, messages, packets, and sending engine as campaigns.</p></div></div>
      <div class="notice"><div><strong>This prototype is focused on campaigns.</strong><br />The rows below demonstrate where the global jobs board continues to fit.</div></div>
      <section class="target-list" style="margin-top:18px">${targets.map((target, index) => renderTargetRow(target, index)).join("")}</section>
    </main>`;
}

function renderMessagesPage() {
  const { replies } = state.run;
  return `
    <main class="page page-narrow">
      <div class="page-heading"><div><p class="eyebrow">Conversations</p><h1>Messages</h1><p class="lede">Sent outreach and replies remain separate from campaign setup while retaining exact campaign and target context.</p></div></div>
      ${
        replies.length > 0
          ? `
        <div class="stack">${replies
          .map(
            (reply) => `
          <article class="card card-pad">
            <div class="section-heading"><div><div class="row-wrap"><h2>${escapeHtml(reply.from)}</h2><span class="badge ${reply.intent === "Interview" ? "badge-brand" : "badge-info"}">${reply.intent}</span></div><p class="muted text-sm">${campaignName()} campaign · human reply</p></div><button class="button button-secondary button-small">Open thread ${icon("arrowRight")}</button></div>
            <p class="text-sm">${escapeHtml(reply.preview)}</p>
          </article>`
          )
          .join("")}</div>`
          : `
        <section class="card empty-campaign"><div><div class="empty-icon">${icon("mail")}</div><h2>No replies in the prototype yet</h2><p>Start the campaign, then use “Simulate replies” to see the automatic pause and message handoff.</p><button class="button button-primary" data-route="${state.campaignStarted ? "running" : "campaigns"}">Back to campaign</button></div></section>`
      }
    </main>`;
}

function renderPlaceholder(title, description) {
  return `<main class="page placeholder-page"><div><p class="eyebrow">Product map</p><h1>${title}</h1><p class="lede">${description}</p><button class="button button-primary" style="margin-top:22px" data-route="campaigns">Open campaigns</button></div></main>`;
}

function renderOverlays() {
  for (const element of document.querySelectorAll(".prototype-overlay")) {
    element.remove();
  }
  if (state.accountMenuOpen) {
    document.body.insertAdjacentHTML("beforeend", renderAccountMenu());
  }
  if (state.researchMarketCode) {
    document.body.insertAdjacentHTML("beforeend", renderResearchDialog());
  }
  if (state.detailTargetId) {
    const target = TARGETS.find((item) => item.id === state.detailTargetId);
    if (target) {
      document.body.insertAdjacentHTML("beforeend", renderTargetDrawer(target));
    }
  }
  if (state.calibrationOpen) {
    document.body.insertAdjacentHTML("beforeend", renderCalibrationModal());
  }
}

function renderAccountMenu() {
  return `
    <div class="prototype-overlay">
      <button aria-label="Close account menu" class="drawer-scrim" data-action="close-account-menu" style="background:transparent"></button>
      <div class="account-menu" role="menu">
        <div class="menu-label"><strong class="text-sm">Chibuzor Ejimofor</strong><div class="faint text-xs">Application kit ready</div></div>
        <button class="menu-action" data-action="reset-prototype">Reset prototype</button>
      </div>
    </div>`;
}

function renderResearchDialog() {
  const market = MARKETS[state.researchMarketCode];
  return `
    <div class="prototype-overlay">
      <div class="modal-scrim">
        <section aria-labelledby="research-dialog-title" aria-modal="true" class="research-dialog" role="dialog">
          <header class="research-dialog-header">
            <div><span class="badge badge-brand">Research action</span><h2 id="research-dialog-title">Expand ${market.country} coverage?</h2><p class="muted text-sm">Search the public web for additional schools, current vacancies, and verified contacts before this campaign starts.</p></div>
            <button aria-label="Close" class="icon-button" data-action="cancel-research">${icon("x")}</button>
          </header>
          <div class="research-dialog-body">
            <div class="research-detail"><span>Estimated use</span><strong>1 research run</strong></div>
            <div class="research-detail"><span>Research provider</span><strong>Connected agent</strong></div>
            <div class="research-detail"><span>Result</span><strong>Schools, jobs, and contacts</strong></div>
            <div class="notice">${icon("sparkles")}<div>If no research provider is connected, this step would ask the user to connect Codex or supply an API key. This prototype simulates the completed run.</div></div>
          </div>
          <footer class="research-dialog-footer"><button class="button button-secondary" data-action="cancel-research">Cancel</button><button class="button button-primary" data-action="confirm-research" data-code="${market.code}">Use 1 research run ${icon("arrowRight")}</button></footer>
        </section>
      </div>
    </div>`;
}

function renderTargetDrawer(target) {
  return `
    <div class="prototype-overlay">
      <button aria-label="Close target details" class="drawer-scrim" data-action="close-target"></button>
      <aside aria-label="${escapeHtml(target.title)} details" class="drawer">
        <header class="drawer-header">
          <div><div class="row-wrap" style="margin-bottom:8px"><span class="badge ${target.type === "posted" ? "badge-brand" : "badge-info"}">${target.type === "posted" ? "Advertised position" : "School outreach"}</span><span class="badge">${target.fit} match</span></div><h2>${escapeHtml(target.title)}</h2><p class="muted text-sm">${escapeHtml(target.organization)} · ${escapeHtml(target.city)}, ${MARKETS[target.countryCode].country}</p></div>
          <button aria-label="Close" class="icon-button" data-action="close-target">${icon("x")}</button>
        </header>
        <div class="drawer-body">
          <section class="detail-section"><h3>Overview</h3><p>${escapeHtml(target.description)}</p><div class="row-wrap"><span class="badge">${escapeHtml(target.pay)}</span><span class="badge">${escapeHtml(target.route)}</span></div></section>
          <section class="detail-section"><h3>Qualifications</h3><ul>${target.requirements.map((requirement) => `<li>${escapeHtml(requirement)}</li>`).join("")}</ul></section>
          <section class="detail-section"><h3>Application route</h3><p>${escapeHtml(target.recipient)}<br />${escapeHtml(target.source)}</p><button class="button button-secondary button-small" data-action="fake-source">Open live source ${icon("external")}</button></section>
          <section class="detail-section"><h3>Prepared message</h3><div class="subject-line"><strong>Subject:</strong> ${escapeHtml(subjectFor(target))}</div><div class="message-preview" style="margin-top:9px">${escapeHtml(messageFor(target))}</div></section>
          <section class="detail-section"><h3>Document packet</h3><div class="row-wrap"><span class="badge">Resume.pdf</span><span class="badge">Diploma.pdf</span><span class="badge">Teaching license.pdf</span><span class="badge">Photo.jpg</span></div></section>
        </div>
        <footer class="drawer-footer"><button class="button button-secondary" data-action="close-target">Close</button></footer>
      </aside>
    </div>`;
}

function renderCalibrationModal() {
  const calibrationTargets = selectedTargets().slice(0, 5);
  if (state.calibrationIndex >= calibrationTargets.length) {
    return renderCalibrationComplete(calibrationTargets);
  }
  const target = calibrationTargets[state.calibrationIndex];
  const message = messageFor(target);
  const change = state.messageChanges[target.id];
  const editing = state.directEditTargetId === target.id;
  return `
    <div class="modal-scrim prototype-overlay" role="presentation">
      <section aria-label="Review message ${state.calibrationIndex + 1} of ${calibrationTargets.length}" aria-modal="true" class="calibration-modal" role="dialog">
        <header class="modal-header">
          <div><div class="row-wrap"><span class="badge badge-brand">First-five approval</span><span class="muted text-xs">Message ${state.calibrationIndex + 1} of ${calibrationTargets.length}</span></div><div class="progress-track"><div class="progress-fill" style="width:${((state.calibrationIndex + 1) / calibrationTargets.length) * 100}%"></div></div></div>
          <button aria-label="Close calibration" class="icon-button" data-action="close-calibration">${icon("x")}</button>
        </header>
        <div class="calibration-grid">
          <div class="calibration-context">
            <div class="stack">
              <section>
                <div class="row-wrap" style="margin-bottom:9px"><span class="badge ${target.type === "posted" ? "badge-brand" : "badge-info"}">${target.type === "posted" ? "Advertised position" : "School outreach"}</span><span class="badge">${target.fit} match</span><span class="badge">${MARKETS[target.countryCode].country}</span></div>
                <h2>${escapeHtml(target.title)}</h2>
                <p class="muted text-sm">${escapeHtml(target.organization)} · ${escapeHtml(target.city)}</p>
              </section>
              <section class="detail-section"><h3>Role summary</h3><p>${escapeHtml(target.description)}</p><div class="row-wrap"><span class="badge">${escapeHtml(target.pay)}</span><span class="badge">${escapeHtml(target.route)}</span></div></section>
              <section class="detail-section"><h3>Qualifications and evidence</h3><div class="qualification-list">${target.requirements.map((requirement) => `<div class="qualification"><span class="qualification-status">✓</span><span><strong>${escapeHtml(requirement)}</strong><br /><span class="muted">Supported by approved profile or document evidence.</span></span></div>`).join("")}</div></section>
              <section class="detail-section"><h3>Full source description</h3><p>${escapeHtml(target.description)} The complete source remains available beside the extracted facts so the candidate can verify the role before approving the message.</p><button class="button button-secondary button-small" data-action="fake-source">Open live source ${icon("external")}</button></section>
              <section class="detail-section"><h3>Application route and packet</h3><p><strong>To:</strong> ${escapeHtml(target.recipient)}<br /><strong>Source:</strong> ${escapeHtml(target.source)}</p><div class="row-wrap"><span class="badge">Resume</span><span class="badge">Diploma</span><span class="badge">License</span><span class="badge">Photo</span></div></section>
            </div>
          </div>

          <div class="calibration-message">
            <div class="section-heading"><div><h2>Message</h2><p class="muted text-xs">Approve it, edit directly, or describe a revision.</p></div><button class="button button-ghost button-small" data-action="toggle-direct-edit" data-target-id="${target.id}">${editing ? "View message" : "Edit directly"}</button></div>
            <div class="subject-line"><strong>Subject:</strong> ${escapeHtml(subjectFor(target))}</div>
            ${editing ? `<textarea aria-label="Direct message edit" class="textarea" data-field="direct-message" data-target-id="${target.id}" style="min-height:310px">${escapeHtml(message)}</textarea>` : `<div class="email-paper">${formatMessage(message, change?.highlight)}</div>`}
            ${change ? `<div class="notice notice-success">${icon("check")}<div><strong>${escapeHtml(change.label)}</strong><br />${escapeHtml(change.scopeLabel)}</div></div>` : ""}
            <div class="revision-panel">
              <div><h3>Request a revision</h3><p class="muted text-xs">JobKit interprets whether the feedback belongs to this message, this campaign, or your future writing preferences.</p></div>
              <textarea aria-label="Revision instruction" class="textarea" data-field="revision-instruction" data-target-id="${target.id}" placeholder="For example: Use plainer language in every message.">${escapeHtml(state.revisionDrafts[target.id] ?? "")}</textarea>
              <div class="row-wrap"><button class="button button-secondary button-small" data-action="sample-feedback" data-target-id="${target.id}">Try sample feedback</button><button class="button button-primary button-small" data-action="interpret-feedback" data-target-id="${target.id}">${icon("sparkles")} Interpret feedback</button></div>
            </div>
            ${state.feedbackProposal?.targetId === target.id ? renderFeedbackProposal(state.feedbackProposal) : ""}
          </div>
        </div>
        <footer class="modal-footer">
          <span class="muted text-xs">${decisionCount("approved")} approved · ${decisionCount("held")} held · ${state.feedbackRules.length} reusable rule${state.feedbackRules.length === 1 ? "" : "s"}</span>
          <div class="row"><button class="button button-secondary" data-action="hold-calibration" data-target-id="${target.id}">Hold target</button><button class="button button-primary" data-action="approve-calibration" data-target-id="${target.id}">Approve &amp; next ${icon("arrowRight")}</button></div>
        </footer>
      </section>
    </div>`;
}

function formatMessage(message, highlight) {
  const escaped = escapeHtml(message);
  if (!highlight) {
    return escaped;
  }
  return escaped.replace(
    escapeHtml(highlight),
    `<mark>${escapeHtml(highlight)}</mark>`
  );
}

function renderFeedbackProposal(proposal) {
  const options = [
    ["message", "This message", "Keep it specific to this target."],
    [
      "campaign",
      "Remaining campaign",
      `Update every unsent ${campaignName()} draft.`,
    ],
    [
      "future",
      "Future campaigns",
      "Save a durable writing or profile preference.",
    ],
  ];
  return `
    <div class="revision-result">
      <div><span class="badge badge-brand">${escapeHtml(proposal.kindLabel)}</span><h3 style="margin-top:8px">${escapeHtml(proposal.rule)}</h3><p class="muted text-xs">JobKit generalized the instruction before changing other drafts. Confirm its scope.</p></div>
      <div class="scope-options">${options.map(([value, label, detail]) => `<button class="scope-option" data-action="select-feedback-scope" data-selected="${proposal.scope === value}" data-value="${value}"><strong>${label}</strong><span>${detail}</span></button>`).join("")}</div>
      <div class="row-wrap" style="justify-content:flex-end"><button class="button button-ghost button-small" data-action="cancel-feedback">Cancel</button><button class="button button-primary button-small" data-action="apply-feedback">Apply revision</button></div>
    </div>`;
}

function renderCalibrationComplete(calibrationTargets) {
  const approved = calibrationTargets.filter(
    (target) => state.decisions[target.id] === "approved"
  ).length;
  const held = calibrationTargets.filter(
    (target) => state.decisions[target.id] === "held"
  ).length;
  return `
    <div class="modal-scrim prototype-overlay" role="presentation">
      <section aria-label="Calibration complete" aria-modal="true" class="calibration-modal" role="dialog">
        <div class="calibration-complete">
          <div>
            <div class="empty-icon">${icon("check")}</div>
            <p class="eyebrow">Calibration complete</p>
            <h1>The campaign is ready to run.</h1>
            <p class="lede">Your five representative targets are resolved. Reusable feedback has been applied before the remaining messages enter the sending schedule.</p>
            <div class="approval-summary"><div><strong>${approved}</strong><span class="muted text-xs">Approved</span></div><div><strong>${held}</strong><span class="muted text-xs">Held</span></div><div><strong>${state.feedbackRules.length}</strong><span class="muted text-xs">Reusable rules</span></div></div>
            ${state.feedbackRules.length ? `<div class="notice notice-success" style="text-align:left;margin-bottom:18px">${icon("sparkles")}<div><strong>Feedback carried forward</strong><br />${state.feedbackRules.map((rule) => escapeHtml(rule.rule)).join(" · ")}</div></div>` : ""}
            <div class="row-wrap" style="justify-content:center"><button class="button button-secondary" data-action="restart-calibration">Review the five again</button><button class="button button-primary button-large" data-action="start-running">Start campaign ${icon("arrowRight")}</button></div>
          </div>
        </div>
      </section>
    </div>`;
}

function interpretFeedback(targetId, instruction) {
  const normalized = instruction.trim().toLowerCase();
  if (PROFILE_FEEDBACK_PATTERN.test(normalized)) {
    return {
      kind: "profile",
      kindLabel: "Profile fact",
      rule: "Keep the approved contact details identical in every unsent signature.",
      scope: "future",
      targetId,
    };
  }
  if (WRITING_FEEDBACK_PATTERN.test(normalized)) {
    return {
      kind: "writing",
      kindLabel: "Writing rule",
      rule: normalized.includes("communicative")
        ? "Use plain language and never describe the candidate as communicative."
        : "Use direct, plain language and preserve the approved message structure.",
      scope: "future",
      targetId,
    };
  }
  if (CAMPAIGN_FEEDBACK_PATTERN.test(normalized)) {
    return {
      kind: "campaign",
      kindLabel: "Campaign rule",
      rule: "Use next-week availability language for every message in this campaign.",
      scope: "campaign",
      targetId,
    };
  }
  return {
    kind: "message",
    kindLabel: "Target-specific edit",
    rule: instruction.trim(),
    scope: "message",
    targetId,
  };
}

function applyFeedbackToMessage(target, proposal) {
  let message = messageFor(target);
  let highlight = "";
  if (proposal.kind === "profile") {
    highlight = "M: +1 (304) 216-8700";
  } else if (proposal.kind === "campaign") {
    message = message.replaceAll("this week", "next week");
    highlight = "next week";
  } else if (proposal.kind === "writing") {
    message = message
      .replaceAll("communicative", "clear")
      .replaceAll(
        "I would welcome the opportunity to discuss",
        "I’d be happy to talk about"
      );
    highlight = message.includes("I’d be happy to talk about")
      ? "I’d be happy to talk about"
      : "I’m interested";
  } else {
    const paragraphMarker = "\n\nI’ve attached";
    const sentence = proposal.rule.endsWith(".")
      ? proposal.rule
      : `${proposal.rule}.`;
    message = message.replace(
      paragraphMarker,
      `\n\n${sentence}${paragraphMarker}`
    );
    highlight = sentence;
  }
  return { highlight, message };
}

function startCampaign() {
  const approved = Math.max(1, decisionCount("approved"));
  const remaining = Math.max(0, selectedTargets().length - approved);
  updateState({
    activities: [
      { detail: `${approved} calibrated sends completed`, time: "Now" },
      {
        detail: `${remaining} eligible targets remain in the live campaign pool`,
        time: "Now",
      },
      ...state.activities,
    ],
    calibrationOpen: false,
    campaignStarted: true,
    run: {
      ...state.run,
      day: 1,
      replies: [],
      sent: approved,
      status: "running",
    },
  });
  navigate("running");
}

function simulateBatch() {
  if (state.run.status === "paused") {
    showToast("Resume the campaign before sending another batch.");
    return;
  }
  const targetCount = selectedTargets().length;
  const nextSent = Math.min(targetCount, state.run.sent + state.dailyPace);
  const added = nextSent - state.run.sent;
  if (added === 0) {
    showToast("The current eligible target pool is exhausted.");
    return;
  }
  updateState({
    activities: [
      { detail: `${added} scheduled sends completed`, time: "Now" },
      ...state.activities,
    ],
    run: { ...state.run, day: state.run.day + 1, sent: nextSent },
  });
  showToast(`${added} outreach messages moved to sent.`);
}

function simulateReplies() {
  const replyPreviews = [
    "We would be happy to schedule an introductory call next week.",
    "Thank you for applying. Could you confirm your preferred start date?",
    "Your teaching experience looks relevant. Please send two references.",
  ];
  const replies = selectedTargets()
    .slice(0, state.stopAfter)
    .map((target, index) => ({
      from: target.organization,
      intent: index === 0 ? "Interview" : "Interested",
      preview: replyPreviews[index % replyPreviews.length],
    }));
  updateState({
    activities: [
      {
        detail: `Campaign paused after ${replies.length} human replies`,
        time: "Now",
      },
      ...replies.map((reply) => ({
        detail: `${reply.intent} reply from ${reply.from}`,
        time: "Now",
      })),
      ...state.activities,
    ],
    run: { ...state.run, replies, status: "paused" },
  });
  showToast(`Campaign paused after ${replies.length} human replies.`);
}

function showToast(message) {
  const region = document.querySelector("#toast-region");
  if (!region) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function resetPrototype() {
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  navigate("campaigns");
  render();
  showToast("Prototype reset.");
}

function toggleCountry(_event, target) {
  const { code } = target.dataset;
  const selected = state.selectedCountries.includes(code);
  if (!selected && state.selectedCountries.length >= MAX_CAMPAIGN_COUNTRIES) {
    showToast(
      `Campaigns support up to ${MAX_CAMPAIGN_COUNTRIES} countries. Remove one or start another campaign.`
    );
    return;
  }
  const next = selected
    ? state.selectedCountries.filter((item) => item !== code)
    : [...state.selectedCountries, code];
  const marketsCollapsed = next.length === MAX_CAMPAIGN_COUNTRIES;
  updateState({ marketsCollapsed, selectedCountries: next });
  if (marketsCollapsed) {
    window.requestAnimationFrame(() => {
      document
        .querySelector("#campaign-plan")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function removeCountry(_event, target) {
  const { code } = target.dataset;
  updateState({
    marketsCollapsed: false,
    selectedCountries: state.selectedCountries.filter((item) => item !== code),
  });
}

function findMore(event, target) {
  event.stopPropagation();
  const { code } = target.dataset;
  if (state.findMore[code]) {
    showToast(`${MARKETS[code].country} coverage is already expanded.`);
    return;
  }
  updateState({ researchMarketCode: code });
}

function confirmResearch(_event, target) {
  const { code } = target.dataset;
  updateState({
    activities: [
      {
        detail: `${MARKETS[code].country} coverage expanded`,
        time: "Just now",
      },
      ...state.activities,
    ],
    findMore: { ...state.findMore, [code]: true },
    researchMarketCode: "",
  });
  showToast(
    `Found 18 more schools and verified 12 more contacts in ${MARKETS[code].country}.`
  );
}

function beginCampaign() {
  if (state.calibrationEnabled) {
    updateState({ calibrationIndex: 0, calibrationOpen: true });
    return;
  }
  startCampaign();
}

function toggleDirectEdit(_event, target) {
  const { targetId } = target.dataset;
  updateState({
    directEditTargetId: state.directEditTargetId === targetId ? "" : targetId,
  });
}

function addSampleFeedback(_event, target) {
  const { targetId } = target.dataset;
  updateState({
    revisionDrafts: {
      ...state.revisionDrafts,
      [targetId]:
        "Use plainer language and never use the word communicative in any message.",
    },
  });
}

function interpretCurrentFeedback(_event, target) {
  const { targetId } = target.dataset;
  const instruction = state.revisionDrafts[targetId]?.trim() ?? "";
  if (!instruction) {
    showToast("Describe the change first.");
    return;
  }
  updateState({ feedbackProposal: interpretFeedback(targetId, instruction) });
}

function selectFeedbackScope(_event, target) {
  if (!state.feedbackProposal) {
    return;
  }
  updateState({
    feedbackProposal: {
      ...state.feedbackProposal,
      scope: target.dataset.value,
    },
  });
}

function applyCurrentFeedback() {
  const proposal = state.feedbackProposal;
  const messageTarget = TARGETS.find((item) => item.id === proposal?.targetId);
  if (!(proposal && messageTarget)) {
    return;
  }
  const applied = applyFeedbackToMessage(messageTarget, proposal);
  const scopeLabel = feedbackScopeLabel(proposal.scope);
  const feedbackRules =
    proposal.scope === "message"
      ? state.feedbackRules
      : [
          ...state.feedbackRules,
          { kind: proposal.kind, rule: proposal.rule, scope: proposal.scope },
        ];
  updateState({
    feedbackProposal: null,
    feedbackRules,
    messageChanges: {
      ...state.messageChanges,
      [messageTarget.id]: {
        highlight: applied.highlight,
        label: proposal.rule,
        scopeLabel,
      },
    },
    revisedMessages: {
      ...state.revisedMessages,
      [messageTarget.id]: applied.message,
    },
    revisionDrafts: { ...state.revisionDrafts, [messageTarget.id]: "" },
  });
  showToast(scopeLabel);
}

function feedbackScopeLabel(scope) {
  const remaining = Math.max(
    0,
    selectedTargets().length - state.calibrationIndex - 1
  );
  const labels = {
    campaign: `Applied to ${remaining} remaining campaign targets.`,
    future: "Saved for this campaign and future campaigns.",
    message: "Applied only to this message.",
  };
  return labels[scope];
}

function decideCalibration(_event, target) {
  const { action, targetId } = target.dataset;
  const decision = action === "approve-calibration" ? "approved" : "held";
  updateState({
    calibrationIndex: state.calibrationIndex + 1,
    decisions: { ...state.decisions, [targetId]: decision },
    directEditTargetId: "",
    feedbackProposal: null,
  });
}

function toggleRun() {
  const nextStatus = state.run.status === "paused" ? "running" : "paused";
  updateState({
    activities: [
      {
        detail: `Campaign ${nextStatus === "paused" ? "paused" : "resumed"} manually`,
        time: "Now",
      },
      ...state.activities,
    ],
    run: { ...state.run, status: nextStatus },
  });
}

const ACTION_HANDLERS = {
  "apply-feedback": applyCurrentFeedback,
  "approve-calibration": decideCalibration,
  "begin-campaign": beginCampaign,
  "cancel-feedback": () => updateState({ feedbackProposal: null }),
  "cancel-research": () => updateState({ researchMarketCode: "" }),
  "close-account-menu": () => updateState({ accountMenuOpen: false }),
  "close-calibration": () => updateState({ calibrationOpen: false }),
  "close-target": () => updateState({ detailTargetId: "" }),
  "confirm-research": confirmResearch,
  "expand-markets": () => updateState({ marketsCollapsed: false }),
  "fake-source": () =>
    showToast("Prototype: the live source would open in a new tab."),
  "filter-targets": (_event, target) =>
    updateState({ previewFilter: target.dataset.value }),
  "find-more": findMore,
  "hold-calibration": decideCalibration,
  "interpret-feedback": interpretCurrentFeedback,
  "open-target": (_event, target) =>
    updateState({ detailTargetId: target.dataset.targetId }),
  "remove-country": removeCountry,
  "reset-prototype": resetPrototype,
  "restart-calibration": () =>
    updateState({ calibrationIndex: 0, decisions: {} }),
  "sample-feedback": addSampleFeedback,
  "select-feedback-scope": selectFeedbackScope,
  "select-strategy": (_event, target) =>
    updateState({ strategy: target.dataset.value }),
  "show-all-targets": () =>
    showToast("Prototype: this would expand the complete target table."),
  "simulate-batch": simulateBatch,
  "simulate-replies": simulateReplies,
  "start-running": startCampaign,
  "toggle-account-menu": () =>
    updateState({ accountMenuOpen: !state.accountMenuOpen }),
  "toggle-country": toggleCountry,
  "toggle-customize": () => updateState({ customize: !state.customize }),
  "toggle-direct-edit": toggleDirectEdit,
  "toggle-run": toggleRun,
};

document.addEventListener("click", (event) => {
  const routeTarget = event.target.closest("[data-route]");
  if (routeTarget) {
    event.preventDefault();
    updateState({ accountMenuOpen: false, detailTargetId: "" }, false);
    const { route } = routeTarget.dataset;
    navigate(route);
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }
  const { action } = target.dataset;
  ACTION_HANDLERS[action]?.(event, target);
});

document.addEventListener("input", (event) => {
  if (event.target.dataset.field !== "market-search") {
    return;
  }
  const marketQuery = event.target.value;
  state = { ...state, marketQuery };
  saveState();
  render();
  const search = document.querySelector('[data-field="market-search"]');
  search?.focus();
  search?.setSelectionRange(marketQuery.length, marketQuery.length);
});

document.addEventListener("change", (event) => {
  const { field } = event.target.dataset;
  if (!field) {
    return;
  }
  if (field === "calibration-enabled") {
    updateState({ calibrationEnabled: event.target.checked });
    return;
  }
  const numeric = Number.parseInt(event.target.value, 10);
  if (!Number.isFinite(numeric)) {
    return;
  }
  if (field === "daily-pace") {
    updateState({ dailyPace: Math.max(1, numeric) });
  } else if (field === "stop-after") {
    updateState({ stopAfter: Math.max(1, numeric) });
  }
});

document.addEventListener("input", (event) => {
  const { field, targetId } = event.target.dataset;
  if (!(field && targetId)) {
    return;
  }
  if (field === "revision-instruction") {
    state = {
      ...state,
      revisionDrafts: {
        ...state.revisionDrafts,
        [targetId]: event.target.value,
      },
    };
    saveState();
  } else if (field === "direct-message") {
    state = {
      ...state,
      revisedMessages: {
        ...state.revisedMessages,
        [targetId]: event.target.value,
      },
    };
    saveState();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.calibrationOpen) {
      updateState({ calibrationOpen: false });
    } else if (state.detailTargetId) {
      updateState({ detailTargetId: "" });
    } else if (state.accountMenuOpen) {
      updateState({ accountMenuOpen: false });
    }
  }
});

window.addEventListener("hashchange", handleRouteChange);

if (!location.hash) {
  history.replaceState(null, "", "#campaigns");
}

render();
