/**
 * JSON-LD feasibility probe — experiment branch only, not part of the app.
 *
 * Hypothesis: most job detail pages embed a schema.org JobPosting JSON-LD
 * block that one generic parser can extract (title/company/location/date/
 * description) reliably across sources — replacing per-board scraping.
 *
 * Phase 1: plain HTTP fetch of sampled listing URLs per enabled board,
 *          detect JobPosting JSON-LD and measure field richness.
 * Phase 2 (RENDER=1): re-probe boards that failed phase 1 via headless
 *          Chromium to see whether rendering unlocks JSON-LD.
 *
 * Usage: node scripts/probe-jsonld.mjs [--render]
 */
import { DatabaseSync } from "node:sqlite";

const RENDER = process.argv.includes("--render") || process.env.RENDER === "1";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PER_BOARD = 3;
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 8;

const db = new DatabaseSync("data/jobs.db", { readOnly: true });

function extractJobPosting(html) {
  const found = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      if (Array.isArray(data)) found.push(...data);
      else if (data && typeof data === "object") {
        if (Array.isArray(data["@graph"])) found.push(...data["@graph"]);
        else found.push(data);
      }
    } catch {
      // malformed JSON-LD
    }
  }
  return (
    found.find(
      (d) =>
        d &&
        (d["@type"] === "JobPosting" ||
          (Array.isArray(d["@type"]) && d["@type"].includes("JobPosting"))),
    ) ?? null
  );
}

async function probePlain(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const html = await res.text();
    return summarize(res.status, html);
  } catch (err) {
    return { http: 0, error: String(err?.message ?? err).slice(0, 70), jsonld: false, descLen: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function probeRendered(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(3_500); // let SPA hydration settle
    const html = await page.content();
    await ctx.close();
    return summarize(200, html, true);
  } catch (err) {
    return { http: 0, rendered: true, error: String(err?.message ?? err).slice(0, 70), jsonld: false, descLen: 0 };
  } finally {
    await browser.close();
  }
}

function summarize(http, html, rendered = false) {
  const jp = extractJobPosting(html);
  const addr = jp?.jobLocation?.address;
  return {
    http,
    rendered,
    jsonld: Boolean(jp),
    title: typeof jp?.title === "string" ? jp.title.slice(0, 40) : null,
    org: jp?.hiringOrganization?.name ?? null,
    descLen: typeof jp?.description === "string" ? jp.description.replace(/<[^>]*>/g, "").length : 0,
    datePosted: jp?.datePosted ?? null,
    loc:
      addr && typeof addr === "object"
        ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(",")
        : null,
    htmlLen: html.length,
  };
}

// ── gather samples from the live DB ─────────────────────────────────────────
const boards = db.prepare("SELECT id, name FROM boards WHERE enabled = 1").all();
const samples = [];
for (const b of boards) {
  const rows = db
    .prepare(
      "SELECT url FROM listings WHERE board_id = ? AND url != '' ORDER BY fetched_at DESC LIMIT ?",
    )
    .all(b.id, PER_BOARD);
  for (const r of rows) samples.push({ board: b.name, url: r.url });
}
console.log(`probing ${samples.length} URLs across ${boards.length} boards (render=${RENDER})\n`);

// ── run with bounded concurrency ────────────────────────────────────────────
const results = [];
let cursor = 0;
async function worker(fn) {
  while (cursor < samples.length) {
    const s = samples[cursor++];
    const r = await fn(s.url);
    results.push({ board: s.board, url: s.url, ...r });
    console.log(
      `  ${r.jsonld ? "✅" : r.http === 200 ? "⚠️ " : "❌"} ${s.board.padEnd(28)} http=${r.http} jsonld=${r.jsonld} desc=${r.descLen}${r.error ? ` err=${r.error}` : ""}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(probePlain)));

// ── phase 2: render the failures ────────────────────────────────────────────
if (RENDER) {
  const failedBoards = new Set(results.filter((r) => !r.jsonld).map((r) => r.board));
  const seenPerBoard = new Map();
  const retry = samples.filter((s) => {
    if (!failedBoards.has(s.board)) return false;
    const n = seenPerBoard.get(s.board) ?? 0;
    if (n >= 2) return false;
    seenPerBoard.set(s.board, n + 1);
    return true;
  });
  console.log(`\nre-probing ${retry.length} URLs with headless Chromium…\n`);
  results.length = 0;
  samples.length = 0;
  samples.push(...retry);
  cursor = 0;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(); // one browser for all probes
  try {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        worker(async (url) => {
          try {
            const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
            const page = await ctx.newPage();
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
            await page.waitForTimeout(3_500); // let SPA hydration settle
            const html = await page.content();
            await ctx.close();
            return summarize(200, html, true);
          } catch (err) {
            return { http: 0, rendered: true, error: String(err?.message ?? err).slice(0, 70), jsonld: false, descLen: 0 };
          }
        }),
      ),
    );
  } finally {
    await browser.close();
  }
}

// ── per-board verdict table ────────────────────────────────────────────────
const byBoard = {};
for (const r of results) {
  const s = (byBoard[r.board] ??= { urls: 0, httpOk: 0, jsonLd: 0, jdFromJsonLd: 0 });
  s.urls++;
  if (r.http === 200) s.httpOk++;
  if (r.jsonld) s.jsonLd++;
  if (r.descLen > 0) s.jdFromJsonLd++;
}
console.log("\n════ VERDICT ════");
console.table(
  Object.entries(byBoard)
    .map(([board, s]) => ({
      board,
      urls: s.urls,
      reachable: s.httpOk,
      jsonLd: s.jsonLd,
      fullJdViaJsonLd: s.jdFromJsonLd,
      verdict:
        s.jdFromJsonLd > 0 ? "✅ json-ld works" : s.httpOk > 0 ? "⚠️  reachable, no jobposting" : "❌ blocked/error",
    }))
    .sort((a, b) => a.board.localeCompare(b.board)),
);

const withJd = results.filter((r) => r.descLen >= 200).length;
console.log(`\n${withJd}/${results.length} probes yielded a ≥200-char JD via JSON-LD`);
