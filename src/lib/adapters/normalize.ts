import type { NormalizedListing } from "@/lib/types";

// ── RSS feed extras (BD career feeds) ──────────────────────────────────────
// Remote-job feeds carry no structured location; company career feeds
// (Enosis/Pinpoint, WordPress job portals like Southtech's) structure their
// content with "Label: value" lines instead. Detecting those unlocks real
// location, application-deadline and remote-flag data for such feeds.

export interface FeedExtras {
  location: string;
  deadline: string | null;
  isRemote: boolean;
}

/** Line-anchored "Location:"/"Application Deadline:" extraction from feed content HTML. */
export function extractFeedExtras(title: string, contentHtml: string): FeedExtras | null {
  const text = contentHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  const location = /(?:^|\n)\s*Location:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
  if (!location) return null;
  const deadlineRaw = /(?:^|\n)\s*Application Deadline:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
  const deadlineDate = deadlineRaw ? new Date(deadlineRaw) : null;
  return {
    location,
    deadline:
      deadlineDate && !Number.isNaN(deadlineDate.getTime()) ? deadlineDate.toISOString() : null,
    isRemote: /remote|work from home/i.test(`${title} ${text}`),
  };
}

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
    deadline: toIsoDate(j.deadlineDB ?? j.deadline),
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
        deadline: toIsoDate(j.deadline),
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
    // SmartRecruiters country codes are ISO-style ("bd", "de") — expand the
    // lowercase country slug so locations display as "Dhaka, Bangladesh"
    const country = (p.location?.country ?? "").trim();
    const loc = [p.location?.city, /^(bd)$/i.test(country) ? "Bangladesh" : country]
      .filter(Boolean)
      .join(", ");
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

// ── JapanDev ───────────────────────────────────────────────────────────────
// GET https://api.japan-dev.com/api/v1/jobs?page=N
//   → { data: [{ id, type: "job_lite", attributes: {...} }] }  (20/page, newest first)
// Detail: GET https://api.japan-dev.com/api/v1/jobs/{slug}
//   → { data: { attributes: { raw_content, sponsors_visas, ... } } }
//
// remote_level: remote_level_full_worldwide | remote_level_partial | remote_level_none
// candidate_location: candidate_location_anywhere | candidate_location_japan_only
// sponsors_visas (detail only): sponsors_visas_yes | sponsors_visas_no

interface JapanDevSkill {
  name?: string;
}

interface JapanDevJob {
  id?: number | string;
  title?: string;
  slug?: string;
  intro?: string | null;
  location?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  skills?: JapanDevSkill[];
  published_at?: string;
  remote_level?: string;
  candidate_location?: string;
  company?: { name?: string; slug?: string; location?: string };
}

/** JPY salary range formatted like japan-dev.com shows it, e.g. "¥8M ~ ¥12M". */
function yenRange(min?: number | null, max?: number | null): string | null {
  if (!min && !max) return null;
  const fmt = (v?: number | null) => (v ? `¥${Math.round(v / 1e6)}M` : "?");
  return `${fmt(min)} ~ ${fmt(max)}`;
}

export function normalizeJapanDev(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: Array<{ id?: number | string; attributes?: JapanDevJob }> }).data)
      : [];
  return jobs.map((entry) => {
    const j = entry.attributes ?? {};
    const slug = String(j.slug ?? idFromUrl(j.title ?? ""));
    const companySlug = j.company?.slug ? String(j.company.slug) : "";
    const isRemote = Boolean(j.remote_level) && j.remote_level !== "remote_level_none";
    const worldwide = j.remote_level === "remote_level_full_worldwide";
    const japanOnly = j.candidate_location === "candidate_location_japan_only";

    // Location doubles as the remote-scope signal for detectRemoteScope():
    // "Anywhere" wins for worldwide-remote; Japan-restricted remote roles get
    // an explicit "(residents only)" marker so they classify as restricted.
    let location = String(j.location ?? j.company?.location ?? "").trim() || "Japan";
    if (isRemote && worldwide && j.candidate_location === "candidate_location_anywhere") {
      location = "Anywhere";
    } else if (isRemote && japanOnly) {
      location = `${location}, Japan (residents only)`;
    }

    const salaryTag = yenRange(j.salary_min, j.salary_max);
    return {
      externalId: slug,
      title: String(j.title ?? "").trim(),
      company: String(j.company?.name ?? "").trim(),
      location,
      isRemote,
      visaSponsorship: false, // detail enrichment sets this from sponsors_visas
      tags: [
        ...(Array.isArray(j.skills) ? j.skills.map((s) => String(s.name ?? "")).filter(Boolean) : []),
        ...(salaryTag ? [salaryTag] : []),
      ].slice(0, 10),
      url: companySlug
        ? `https://japan-dev.com/jobs/${companySlug}/${slug}`
        : `https://japan-dev.com/jobs/${slug}`,
      postedAt: toIsoDate(j.published_at),
      description: stripHtml(String(j.intro ?? "")),
    } satisfies NormalizedListing;
  });
}

export interface JapanDevDetail {
  description: string;
  /** yes/no from the sponsors_visas enum; null when absent/unrecognized */
  sponsorsVisas: boolean | null;
}

export function parseJapanDevDetail(payload: unknown): JapanDevDetail {
  const attrs =
    typeof payload === "object" && payload !== null
      ? ((payload as { data?: { attributes?: Record<string, unknown> } }).data?.attributes ?? {})
      : {};
  const sv = attrs.sponsors_visas;
  return {
    description: stripHtml(String(attrs.raw_content ?? "")),
    sponsorsVisas: sv === "sponsors_visas_yes" ? true : sv === "sponsors_visas_no" ? false : null,
  };
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

/** Hard cap on stored description length, to bound list-page payloads (PAGE_SIZE = 20). */
export const MAX_DESCRIPTION_LENGTH = 20_000;

/** Truncate an over-long description; pass short ones through unchanged. */
export function capDescription(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH) : text;
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

// ── Jobicy ─────────────────────────────────────────────────────────────────
// GET https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering
//   → { jobs: [{ id, url, jobTitle, companyName, jobGeo, jobType[], jobLevel,
//                jobDescription (HTML), pubDate, ... }] }
// `industry=engineering` is Jobicy's "Software Engineering" category and the
// whole board is remote-only, so the feed doubles as the tech filter.

interface JobicyJob {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobType?: string[];
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
}

export function normalizeJobicy(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs)
      ? ((payload as { jobs: JobicyJob[] }).jobs)
      : [];
  return jobs.map((j) => ({
    externalId: String(j.id ?? idFromUrl(j.url ?? j.jobTitle ?? "")),
    title: String(j.jobTitle ?? "").trim(),
    company: String(j.companyName ?? "").trim(),
    // jobGeo carries the eligibility region ("USA", "Anywhere in the World",
    // "European Union") — detectRemoteScope classifies regions as restricted
    location: String(j.jobGeo ?? "").trim() || "Remote",
    isRemote: true,
    visaSponsorship: detectVisaSponsorship(j.jobDescription, j.jobTitle),
    tags: [...(j.jobType ?? []), ...(j.jobLevel ? [j.jobLevel] : [])].map(String).slice(0, 6),
    url: String(j.url ?? ""),
    postedAt: toIsoDate(j.pubDate),
    description: stripHtml(String((j.jobDescription || j.jobExcerpt) ?? "")),
  }));
}

// ── Reed (UK) ──────────────────────────────────────────────────────────────
// GET https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=100
//   (HTTP Basic auth — API key as username, empty password; free key from
//   reed.co.uk/developers/Jobseeker)
//   → { totalResults, results: [{ jobId, employerName, jobTitle, locationName,
//        minimumSalary, maximumSalary, currency, datePosted "dd/MM/yyyy",
//        jobUrl }] }
// The search payload carries no description — the fetch layer enriches new
// jobs from GET /api/1.0/jobs/{jobId} → { jobDescription }.

interface ReedJob {
  jobId?: number | string;
  employerName?: string;
  jobTitle?: string;
  locationName?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  currency?: string | null;
  datePosted?: string;
  jobUrl?: string;
}

const REED_CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };

/** "£45k ~ £60k"-style salary tag, mirroring the JapanDev JPY range format. */
function reedSalaryTag(min?: number | null, max?: number | null, currency?: string | null): string | null {
  if (!min && !max) return null;
  const symbol = REED_CURRENCY_SYMBOLS[currency ?? ""] ?? `${currency ?? ""} `;
  const fmt = (v?: number | null) => (v ? `${symbol}${Math.round(v / 1000)}k` : "?");
  return `${fmt(min)} ~ ${fmt(max)}`;
}

/** Reed posts dates as dd/MM/yyyy, which `new Date()` mangles — split manually. */
export function reedDateToIso(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeReed(payload: unknown): NormalizedListing[] {
  const jobs =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { results?: unknown }).results)
      ? ((payload as { results: ReedJob[] }).results)
      : [];
  return jobs.map((j) => {
    const salary = reedSalaryTag(j.minimumSalary, j.maximumSalary, j.currency);
    return {
      externalId: String(j.jobId ?? idFromUrl(j.jobUrl ?? j.jobTitle ?? "")),
      title: String(j.jobTitle ?? "").trim(),
      company: String(j.employerName ?? "").trim(),
      location: String(j.locationName ?? "").trim(),
      isRemote: /remote/i.test(`${j.jobTitle ?? ""} ${j.locationName ?? ""}`),
      visaSponsorship: false, // detail enrichment detects visa wording in the JD
      tags: salary ? [salary] : [],
      url: String(j.jobUrl ?? ""),
      postedAt: reedDateToIso(j.datePosted),
      description: "",
    } satisfies NormalizedListing;
  });
}

/** Full JD text from the Reed job-details endpoint. */
export function parseReedDetail(payload: unknown): string {
  const job = typeof payload === "object" && payload !== null ? (payload as { jobDescription?: unknown }) : {};
  return stripHtml(String(job.jobDescription ?? ""));
}
