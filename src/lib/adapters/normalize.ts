import type { NormalizedListing } from "@/lib/types";

// ── Greenhouse company boards ──────────────────────────────────────────────
// GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
// → { jobs: [...] }

interface GreenhouseJob {
  id?: number | string;
  title?: string;
  updated_at?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
}

export function normalizeGreenhouse(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs)
      ? ((payload as { jobs: GreenhouseJob[] }).jobs)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.id ?? idFromUrl(j.absolute_url ?? j.title ?? "")),
    title: String(j.title ?? "").trim(),
    company: "", // filled from board name by the fetch layer
    location: String(j.location?.name ?? "").trim(),
    isRemote: /remote/i.test(`${j.location?.name ?? ""} ${j.title ?? ""}`),
    visaSponsorship: detectVisaSponsorship(j.content, j.title),
    tags: [],
    url: String(j.absolute_url ?? ""),
    postedAt: toIsoDate(j.updated_at),
    description: stripHtml(String(j.content ?? "")),
  }));
}

// ── Working Nomads ─────────────────────────────────────────────────────────
// GET https://www.workingnomads.com/api/exposed_jobs/ → [ ... ]

interface WorkingNomadsJob {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string;
  location?: string;
  pub_date?: string;
}

export function normalizeWorkingNomads(payload: unknown): NormalizedListing[] {
  if (!Array.isArray(payload)) return [];
  return (payload as WorkingNomadsJob[]).map((j) => ({
    externalId: idFromUrl(j.url ?? j.title ?? ""),
    title: String(j.title ?? "").trim(),
    company: String(j.company_name ?? "").trim(),
    location: String(j.location ?? "Remote").trim() || "Remote",
    isRemote: true,
    visaSponsorship: detectVisaSponsorship(j.description, j.title),
    tags: typeof j.tags === "string" && j.tags.length ? j.tags.split(",").map((t) => t.trim()) : [],
    url: String(j.url ?? ""),
    postedAt: toIsoDate(j.pub_date),
    description: stripHtml(String(j.description ?? "")),
  }));
}

// ── Airwork (reverse-engineered public API) ────────────────────────────────
// GET https://ignition.airwork.ai/api/v2/public/jobs?limit=50&skip=N

interface AirworkJob {
  _id?: string;
  title?: string;
  slug?: string;
  status?: string;
  company?: { name?: string };
  location?: { city?: string; country?: string; isAnywhere?: boolean };
  jobType?: string;
  engagementType?: string;
  skills?: string[];
  description?: string;
  publishedDate?: string;
  createdAt?: string;
}

export function normalizeAirwork(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: AirworkJob[] }).data)
      : [];
  return jobs
    .filter((j) => (j.status ?? "active") === "active")
    .map((j) => {
      const anywhere = j.location?.isAnywhere === true;
      const loc = [j.location?.city, j.location?.country].filter(Boolean).join(", ");
      return {
        externalId: String(j._id ?? idFromUrl(j.slug ?? j.title ?? "")),
        title: String(j.title ?? "").trim(),
        company: String(j.company?.name ?? "").trim(),
        location: anywhere ? "Anywhere" : loc || "Bangladesh",
        isRemote: anywhere,
        visaSponsorship: detectVisaSponsorship(j.description, j.title),
        tags: (Array.isArray(j.skills) ? j.skills : []).slice(0, 10),
        url: j.slug ? `https://app.airwork.ai/opportunities?job=${j.slug}` : "",
        postedAt: toIsoDate(j.publishedDate ?? j.createdAt),
        description: stripHtml(String(j.description ?? "")),
      } satisfies NormalizedListing;
    });
}

// ── Talvette (live-jobs spreadsheet API) ───────────────────────────────────
// GET https://api.sheety.co/.../talvetteLiveJoblist/liveJobs

interface TalvetteJob {
  id?: number | string;
  manatalId?: string;
  title?: string;
  category?: string;
  jobType?: string;
  locationType?: string;
  officeLocation?: string;
  employmentStructure?: string;
  techStack?: string;
  aboutTheRole?: string;
  skillsAndQualifications?: string;
  salaryRange?: string;
  timestamp?: string;
}

export function normalizeTalvette(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { liveJobs?: unknown }).liveJobs)
      ? ((payload as { liveJobs: TalvetteJob[] }).liveJobs)
      : [];
  return jobs.map((j) => {
    const remote = /remote/i.test(String(j.locationType ?? ""));
    const posted = (() => {
      if (!j.timestamp) return null;
      const d = new Date(j.timestamp);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();
    return {
      externalId: String(j.manatalId ?? j.id ?? idFromUrl(j.title ?? "")),
      title: String(j.title ?? "").trim(),
      company: "Talvette client",
      location: String(j.officeLocation || j.locationType || "Bangladesh").trim(),
      isRemote: remote,
      visaSponsorship: false,
      tags: [j.category, j.jobType, j.employmentStructure]
        .filter(Boolean)
        .map(String)
        .slice(0, 6),
      url: "https://talvette.com/forjobseekers",
      postedAt: posted,
      description: [j.aboutTheRole, j.skillsAndQualifications, j.techStack]
        .filter(Boolean)
        .map(String)
        .join(" "),
    } satisfies NormalizedListing;
  });
}

// ── BDJobs (reverse-engineered public search API) ──────────────────────────
// GET https://api.bdjobs.com/Jobs/api/JobSearch/GetJobSearch?category=8&pg=N&rpp=50
// category=8 is Information Technology / Telecommunication.

interface BdjobsJob {
  Jobid?: string;
  jobTitle?: string;
  companyName?: string;
  deadline?: string;
  deadlineDB?: string;
  publishDate?: string;
  location?: string;
  experience?: string;
  jobDescription?: string;
  eduRec?: string;
  JobType?: string;
  WorkPlace?: string;
  Vacancies?: number;
}

export function normalizeBdjobs(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: BdjobsJob[] }).data)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.Jobid ?? idFromUrl(j.jobTitle ?? "")),
    title: String(j.jobTitle ?? "").trim(),
    company: String(j.companyName ?? "").trim(),
    location: [j.location, "Bangladesh"].filter(Boolean).join(", "),
    isRemote: /remote|work from home/i.test(`${j.WorkPlace ?? ""} ${j.jobTitle ?? ""}`),
    visaSponsorship: false,
    tags: [
      j.JobType,
      j.WorkPlace,
      j.experience,
      j.Vacancies ? `${j.Vacancies} vacancy` : "",
    ]
      .filter(Boolean)
      .map(String)
      .slice(0, 6),
    url: j.Jobid ? `https://jobs.bdjobs.com/jobdetails.asp?id=${j.Jobid}&ln=1` : "",
    postedAt: toIsoDate(j.publishDate),
    description: stripHtml(String(j.jobDescription ?? j.eduRec ?? "")),
  }));
}

// ── Tekarsh (open careers API) ─────────────────────────────────────────────
// GET https://tekarsh.com/api/admin/jobs?limit=1000 → { jobs: [...] }

interface TekarshJob {
  _id?: string;
  title?: string;
  slug?: string;
  status?: string;
  employmentType?: string;
  workLocation?: string;
  workMode?: string;
  deadline?: string;
  postedDate?: string;
  technicalSkills?: string[] | string;
  introduction?: string;
  responsibilities?: string | string[];
  qualifications?: string | string[];
}

export function normalizeTekarsh(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs)
      ? ((payload as { jobs: TekarshJob[] }).jobs)
      : [];
  return jobs
    .filter((j) => !j.status || j.status === "active" || j.status === "open")
    .map((j) => {
      const skills =
        typeof j.technicalSkills === "string"
          ? j.technicalSkills.split(",").map((s) => s.trim())
          : Array.isArray(j.technicalSkills)
            ? j.technicalSkills
            : [];
      const asArray = (v: string | string[] | undefined) =>
        Array.isArray(v) ? v.join(" ") : v ?? "";
      return {
        externalId: String(j._id ?? idFromUrl(j.slug ?? j.title ?? "")),
        title: String(j.title ?? "").trim(),
        company: "", // filled from board name
        location: String(j.workLocation || "Dhaka, Bangladesh").trim(),
        isRemote: /remote/i.test(`${j.workMode ?? ""} ${j.title ?? ""}`),
        visaSponsorship: false,
        tags: [
          ...skills.slice(0, 8),
          ...(j.employmentType ? [String(j.employmentType)] : []),
          ...(j.workMode ? [String(j.workMode)] : []),
        ].slice(0, 10),
        url: j.slug ? `https://tekarsh.com/career/job/${j.slug}` : "",
        postedAt: toIsoDate(j.postedDate),
        description: stripHtml(
          `${asArray(j.introduction)} ${asArray(j.responsibilities)} ${asArray(j.qualifications)}`,
        ),
      } satisfies NormalizedListing;
    });
}

// ── SmartRecruiters hosted career pages ────────────────────────────────────
// GET https://api.smartrecruiters.com/v1/companies/{company}/postings

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string };
}

export function normalizeSmartRecruiters(payload: unknown): NormalizedListing[] {
  const postings =
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { content?: unknown }).content)
      ? ((payload as { content: SmartRecruitersPosting[] }).content)
      : [];
  return postings.map((p) => {
    const loc = [p.location?.city, p.location?.country].filter(Boolean).join(", ");
    return {
      externalId: String(p.id ?? idFromUrl(p.name ?? "")),
      title: String(p.name ?? "").trim(),
      company: String(p.company?.name ?? "").trim(),
      location: loc || "Bangladesh",
      isRemote: /remote/i.test(String(p.name ?? "") + " " + loc),
      visaSponsorship: false,
      tags: [],
      url:
        p.company?.identifier && p.id
          ? `https://jobs.smartrecruiters.com/${p.company.identifier}/${p.id}`
          : "",
      postedAt: toIsoDate(p.releasedDate),
      description: "",
    } satisfies NormalizedListing;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

const VISA_RE = /(visa\s*sponsor|work\s*permit|relocation\s*(package|support|assistance)|relocat(e|ion)\b)/i;

export function detectVisaSponsorship(...texts: Array<string | undefined>): boolean {
  return VISA_RE.test(texts.filter((t): t is string => Boolean(t)).join(" "));
}

// ── Remote scope detection ─────────────────────────────────────────────────

export type RemoteScope = "anywhere" | "restricted";

const ANYWHERE_RE =
  /\b(anywhere|world ?wide|globally|from anywhere|no location (?:restriction|requirement)|remote[- ]first)\b/i;

/** Regions/countries that commonly appear in "this job is limited to X" phrases. */
const REGION_RE =
  /\b(usa?|u\.s\.a?|united states|canada|canadian|uk|united kingdom|britain|europe|european union|eu|emea|apac|latam|americas|benelux|dach|germany|netherlands|poland|spain|france|portugal|italy|romania|ukraine|india|philippines|vietnam|singapore|japan|australia|new zealand|brazil|mexico|argentina|colombia|middle east|uae|africa|asia|north america|south america|bd|bangladesh)\b/i;

const EXPLICIT_RESTRICT_RE =
  /\b(only|residents?|citizens?|located (?:in)?|based (?:in)?|living (?:in)?|residing (?:in)?|eligible to work|within)\b[^.!?]{0,60}"?/i;

/**
 * Classify a listing's remote scope:
 *  - "anywhere":   remote, no geographic signal (treated as worldwide)
 *  - "restricted": remote but tied to specific countries/regions
 *  - null:         not remote
 */
export function detectRemoteScope(input: {
  isRemote: boolean;
  location?: string;
  description?: string;
}): RemoteScope | null {
  if (!input.isRemote) return null;

  const loc = input.location ?? "";
  const desc = input.description ?? "";

  if (ANYWHERE_RE.test(loc)) return "anywhere";
  if (REGION_RE.test(loc)) {
    // "Anywhere in Europe" style overrides a bare region mention
    return ANYWHERE_RE.test(desc) && !EXPLICIT_RESTRICT_RE.test(desc)
      ? "anywhere"
      : "restricted";
  }
  // explicit restriction phrasing in the body ("US residents only", "must be located in the EU")
  if (
    REGION_RE.test(desc) &&
    EXPLICIT_RESTRICT_RE.test(desc.slice(Math.max(0, desc.search(REGION_RE) - 60), desc.search(REGION_RE) + 120))
  ) {
    return "restricted";
  }
  return "anywhere"; // remote with no geographic signal → assume worldwide
}

/**
 * Tag sanitation, two passes:
 * 1. Drop known non-skill category/level words ("senior", "dev", "sales",
 *    …). Boards attach them indiscriminately, so a tag hit on "senior"
 *    says nothing — while the same word in a *title* still matches.
 * 2. Drop any remaining tag appearing on more than 30% of the listings
 *    in a reasonably sized batch (board-specific spam vocabularies).
 */
const TAG_STOPWORDS = new Set([
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "head",
  "mid", "mid-level", "entry", "entry-level", "graduate", "intern",
  "dev", "developer", "engineer", "technical", "technology", "engineering",
  "ops", "operations", "sys admin", "admin", "administration",
  "marketing", "sales", "finance", "accounting", "legal", "medical",
  "healthcare", "design", "designer", "education", "research",
  "customer support", "support", "recruiter", "hr", "people",
  "infosec", "security", "testing", "qa", "other", "misc", "general",
  "full time", "full-time", "part time", "part-time", "contract",
  "remote", "hybrid", "onsite", "digital nomad", "microsoft", "exec",
  "executive", "manager", "supervisor", "associate", "assistant",
]);

export function sanitizeTags(listings: NormalizedListing[]): NormalizedListing[] {
  // pass 1: stopwords (always)
  let cleaned = listings.map((l) => ({
    ...l,
    tags: [...new Set(l.tags.map((t) => t.trim()))]
      .filter((t) => t.length > 0 && !TAG_STOPWORDS.has(t.toLowerCase()))
      .slice(0, 12),
  }));

  // pass 2: frequency-based (only meaningful on decent-sized batches)
  if (cleaned.length >= 10) {
    const counts = new Map<string, number>();
    for (const l of cleaned) {
      for (const t of new Set(l.tags.map((t) => t.toLowerCase()))) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const threshold = cleaned.length * 0.3;
    cleaned = cleaned.map((l) => ({
      ...l,
      tags: l.tags.filter((t) => (counts.get(t.toLowerCase()) ?? 0) <= threshold),
    }));
  }
  return cleaned;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "number") {
    // unix seconds or ms
    const ms = input > 1e12 ? input : input * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(input));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Stable id derived from a URL when a source has no explicit id. */
export function idFromUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  return `u${(h >>> 0).toString(36)}`;
}

// ── RemoteOK ───────────────────────────────────────────────────────────────
// GET https://remoteok.com/api → [ legalNotice, job, job, ... ]

interface RemoteOkJob {
  slug?: string;
  id?: number | string;
  position?: string;
  company?: string;
  location?: string;
  tags?: string[];
  description?: string;
  date?: string;
  url?: string;
}

export function normalizeRemoteOk(payload: unknown): NormalizedListing[] {
  if (!Array.isArray(payload)) return [];
  const jobs = payload.slice(1).filter((j): j is RemoteOkJob => typeof j === "object" && j !== null && "position" in j);
  return jobs.map((j) => ({
    externalId: String(j.id ?? j.slug ?? idFromUrl(j.url ?? j.position ?? "")),
    title: String(j.position ?? "").trim(),
    company: String(j.company ?? "").trim(),
    location: String(j.location ?? "Remote").trim() || "Remote",
    isRemote: true,
    visaSponsorship: detectVisaSponsorship(j.description, j.position),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    url: String(j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? ""}`),
    postedAt: toIsoDate(j.date),
    description: stripHtml(String(j.description ?? "")),
  }));
}

// ── Remotive ───────────────────────────────────────────────────────────────
// GET https://remotive.com/api/remote-jobs?search=java → { jobs: [...] }

interface RemotiveJob {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  tags?: string[];
  publication_date?: string;
  description?: string;
}

export function normalizeRemotive(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs)
      ? ((payload as { jobs: RemotiveJob[] }).jobs)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.id ?? idFromUrl(j.url ?? j.title ?? "")),
    title: String(j.title ?? "").trim(),
    company: String(j.company_name ?? "").trim(),
    location: String(j.candidate_required_location ?? "Remote").trim() || "Remote",
    isRemote: true,
    visaSponsorship: detectVisaSponsorship(j.description, j.title),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    url: String(j.url ?? ""),
    postedAt: toIsoDate(j.publication_date),
    description: stripHtml(String(j.description ?? "")),
  }));
}

// ── Arbeitnow ──────────────────────────────────────────────────────────────
// GET https://www.arbeitnow.com/api/job-board-api → { data: [...] }

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[] | string;
  location?: string;
  created_at?: number;
}

export function normalizeArbeitnow(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: ArbeitnowJob[] }).data)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.slug ?? idFromUrl(j.url ?? j.title ?? "")),
    title: String(j.title ?? "").trim(),
    company: String(j.company_name ?? "").trim(),
    location: String(j.location ?? "").trim(),
    isRemote: j.remote === true,
    visaSponsorship: detectVisaSponsorship(j.description, j.title),
    tags: Array.isArray(j.tags)
      ? j.tags.map(String)
      : typeof j.tags === "string" && j.tags.length
        ? j.tags.split(",").map((t) => t.trim())
        : [],
    url: String(j.url ?? ""),
    postedAt: toIsoDate(j.created_at),
    description: stripHtml(String(j.description ?? "")),
  }));
}

// ── HimalayasApp ───────────────────────────────────────────────────────────
// GET https://himalayas.app/jobs/api → { jobs: [...] }

interface HimalayasJob {
  guid?: string;
  title?: string;
  companyName?: string;
  applicationLink?: string;
  locationRestrictions?: string[];
  workplaceType?: string;
  isRemote?: boolean;
  postedAt?: string;
  description?: string;
  seniorityLevel?: string[];
}

export function normalizeHimalayas(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs)
      ? ((payload as { jobs: HimalayasJob[] }).jobs)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.guid ?? idFromUrl(j.applicationLink ?? j.title ?? "")),
    title: String(j.title ?? "").trim(),
    company: String(j.companyName ?? "").trim(),
    location: Array.isArray(j.locationRestrictions) && j.locationRestrictions.length
      ? j.locationRestrictions.join(", ")
      : "Remote",
    isRemote: j.isRemote !== false,
    visaSponsorship: detectVisaSponsorship(j.description, j.title),
    tags: [
      ...(Array.isArray(j.seniorityLevel) ? j.seniorityLevel : []),
      ...(j.workplaceType ? [String(j.workplaceType)] : []),
    ],
    url: String(j.applicationLink ?? ""),
    postedAt: toIsoDate(j.postedAt),
    description: stripHtml(String(j.description ?? "")),
  }));
}
