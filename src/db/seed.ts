import type { BoardType } from "@/lib/types";

/**
 * Boards seeded into a fresh remote database. The on-device mirror reuses
 * this list when it has to stand in for a remote that has never been
 * reachable, so a brand-new install still boots with usable sources.
 */
export const SEED_BOARDS: Array<{
  name: string;
  type: BoardType;
  url: string;
  keywords: string[];
  enabled?: boolean;
}> = [
  {
    name: "RemoteOK",
    type: "api",
    url: "https://remoteok.com/api",
    keywords: ["java"],
  },
  {
    name: "Remotive",
    type: "api",
    url: "https://remotive.com/api/remote-jobs?search=java",
    keywords: ["java", "spring"],
  },
  {
    name: "Remotive (Software Dev)",
    type: "api",
    url: "https://remotive.com/api/remote-jobs?category=software-dev&limit=100",
    keywords: [],
  },
  {
    name: "Arbeitnow",
    type: "api",
    url: "https://www.arbeitnow.com/api/job-board-api",
    keywords: ["java", "spring"],
  },
  {
    name: "HimalayasApp",
    type: "api",
    url: "https://himalayas.app/jobs/api",
    keywords: ["java", "spring boot"],
  },
  {
    name: "Working Nomads",
    type: "api",
    url: "https://www.workingnomads.com/api/exposed_jobs/",
    keywords: [],
  },
  {
    name: "WeWorkRemotely (Backend)",
    type: "rss",
    url: "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    keywords: ["java", "spring"],
  },

  // ── International sources ─────────────────────────────────────────────────
  // Broad tech ingestion by design: each board carries its source's tech/dev
  // category (no java-only narrowing at fetch time — Java filtering happens in
  // the UI via global keywords and skill facets). Descriptions come from the
  // feed directly (Jobicy) or via bounded detail enrichment (Arc, Relocate.me,
  // Reed) so skills extraction has material at upsert time.
  {
    // v2 API, industry=engineering = Jobicy's "Software Engineering" category
    // (replaces the old "Jobicy (Java tag)" RSS seed that 403'd)
    name: "Jobicy",
    type: "api",
    url: "https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering",
    keywords: [],
  },
  {
    // __NEXT_DATA__ listing; detail enrichment adds description + visa flag +
    // company (vetted jobs). requiredCountries=[] maps to "Anywhere".
    name: "Arc.dev",
    type: "scrape",
    url: "https://arc.dev/remote-jobs",
    keywords: [],
  },
  {
    // relocation-native EU/UK board; SSR cards + JSON-LD detail enrichment
    name: "Relocate.me",
    type: "scrape",
    url: "https://relocate.me/international-jobs",
    keywords: [],
  },
  {
    // UK board with a free jobseeker API — needs REED_API_KEY (Basic auth),
    // so seeded disabled; enable once the key is configured
    name: "Reed (UK)",
    type: "api",
    url: "https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=100",
    keywords: [],
    enabled: false,
  },

  // ── Japan sources ───────────────────────────────────────────────────────
  // JapanDev: public web API (list has no description — adapter enriches
  // from detail endpoints). TokyoDev: SSR listing page, plain HTML scrape;
  // descriptions filled via headless-browser detail enrichment.
  {
    name: "JapanDev",
    type: "api",
    url: "https://api.japan-dev.com/api/v1/jobs?page=1",
    keywords: [],
  },
  {
    name: "TokyoDev",
    type: "scrape",
    url: "https://www.tokyodev.com/jobs",
    keywords: [],
  },

  {
    name: "BDJobs IT",
    type: "api",
    url: "https://api.bdjobs.com/Jobs/api/JobSearch/GetJobSearch?category=8",
    keywords: [],
  },
  {
    name: "Cefalo (careers)",
    type: "scrape",
    url: "https://career.cefalo.com/",
    keywords: [],
  },
  {
    name: "Tekarsh (careers)",
    type: "api",
    url: "https://tekarsh.com/api/admin/jobs?limit=1000",
    keywords: [],
  },
  {
    name: "Craftsmen (careers)",
    type: "api",
    url: "https://api.smartrecruiters.com/v1/companies/CraftsmenLtd/postings",
    keywords: [],
  },

  // ── Bangladesh sources (server-rendered HTML scrapers) ─────────────────
  {
    name: "Brain Station 23 (careers)",
    type: "scrape",
    url: "https://brainstation-23.easy.jobs/",
    keywords: [],
  },
  // easy.jobs tenants — BD tech companies on the country's dominant hiring
  // platform. Tenants with zero current openings render an explicit empty
  // state (fetched as "ok · 0"), and pick up jobs automatically when posted.
  {
    name: "Vivasoft (careers)",
    type: "scrape",
    url: "https://vivasoft.easy.jobs/",
    keywords: [],
  },
  {
    name: "Chaldal (careers)",
    type: "scrape",
    url: "https://chaldal.easy.jobs/",
    keywords: [],
  },
  {
    name: "Sheba Platform (careers)",
    type: "scrape",
    url: "https://sheba.easy.jobs/",
    keywords: [],
  },
  {
    name: "Datasoft Systems (careers)",
    type: "scrape",
    url: "https://datasoft.easy.jobs/",
    keywords: [],
  },
  {
    name: "KONA Software Lab (careers)",
    type: "scrape",
    url: "https://konasl.easy.jobs/",
    keywords: [],
  },
  {
    name: "Pathao (careers)",
    type: "scrape",
    url: "https://pathao.easy.jobs/",
    keywords: [],
  },
  {
    name: "LEADS Corporation (careers)",
    type: "scrape",
    url: "https://leads.easy.jobs/",
    keywords: [],
  },
  {
    name: "Dream 71 (careers)",
    type: "scrape",
    url: "https://dream71.easy.jobs/",
    keywords: [],
  },
  {
    name: "Shohoz (careers)",
    type: "scrape",
    url: "https://shohoz.easy.jobs/",
    keywords: [],
  },
  // single-company career feeds (company name filled from the board name)
  {
    name: "Enosis Solutions (careers)",
    type: "rss",
    url: "https://careers.enosisbd.com/jobs.rss",
    keywords: [],
  },
  {
    name: "Southtech Group (careers)",
    type: "rss",
    url: "https://career.southtechgroup.com/feed/",
    keywords: [],
  },
  {
    name: "Riseup Labs (careers)",
    type: "scrape",
    url: "https://riseuplabs.com/jobs/",
    keywords: [],
  },
  // IoT/telecom tech company hiring via SmartRecruiters (host dispatch above)
  {
    name: "Bondstein Technologies (careers)",
    type: "api",
    url: "https://api.smartrecruiters.com/v1/companies/BondsteinTechnologiesLtd/postings",
    keywords: [],
  },
  {
    name: "Daraz (careers)",
    type: "scrape",
    url: "https://daraz.easy.jobs/",
    keywords: [],
  },
  // general BD portal — newest ~25 jobs per fetch, filtered to tech titles;
  // each job names its real hiring company, covering many employers at once
  {
    name: "Skill.jobs (tech)",
    type: "scrape",
    url: "https://skill.jobs/browse-jobs",
    keywords: [],
  },
  {
    name: "Nextjobz BD",
    type: "scrape",
    url: "https://nextjobz.com.bd/it-jobs",
    keywords: [],
  },
  {
    name: "Airwork BD",
    type: "scrape",
    url: "https://ignition.airwork.ai/api/v2/public/jobs",
    keywords: [],
  },
  {
    name: "Talvette",
    type: "scrape",
    url: "https://api.sheety.co/d6464fb14c638c8070881d5e8789c1fc/talvetteLiveJoblist/liveJobs",
    keywords: [],
  },

  // ── Company career pages (Greenhouse boards) ────────────────────────────
  // Remote-friendly companies with meaningful Java/Kotlin/Scala footprints.
  // filter_keywords pre-filter each company's full job board down to
  // backend-relevant roles before anything is stored.
  {
    name: "SumUp (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/sumup/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "HelloFresh (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/hellofresh/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "Coinbase (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true",
    keywords: ["java", "kotlin", "backend"],
  },
  {
    name: "Neo4j (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/neo4j/jobs?content=true",
    keywords: ["java", "kotlin", "backend"],
  },
  {
    name: "Wise (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/wise/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "Databricks (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true",
    keywords: ["java", "scala", "backend"],
  },
  {
    name: "Okta (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=true",
    keywords: ["java", "spring", "backend"],
  },
  {
    name: "Twilio (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true",
    keywords: ["java", "backend"],
  },
  {
    name: "N26 (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=true",
    keywords: ["java", "kotlin", "spring", "backend"],
  },
  {
    name: "GetYourGuide (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/getyourguide/jobs?content=true",
    keywords: ["kotlin", "java", "backend"],
  },
  {
    name: "Celonis (careers)",
    type: "greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/celonis/jobs?content=true",
    keywords: ["java", "backend"],
  },
];
