import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Macintosh) Chrome/126";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA });

async function render(url, waitMs = 5000) {
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on("request", r => { const u = r.url(); if (/api|json|search/i.test(u)) apiCalls.push(u); });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 35000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    return { html: await page.content(), apiCalls };
  } finally { await page.close(); }
}

// BDJobs: start from homepage to find real search URL
let r = await render("https://jobs.bdjobs.com/", 3000);
console.log("BDJOBS home:", r.html.length, "b");
const searchLinks = [...new Set([...r.html.matchAll(/href="([^"]*(?:jobsearch|alljobs|search)[^"]*)"/gi)].map(m => m[1]))];
console.log("  search links:", searchLinks.slice(0, 5));
console.log("  api calls seen:", [...new Set(r.apiCalls)].slice(0, 5));

// try known modern paths
for (const u of ["https://jobs.bdjobs.com/alljobs", "https://jobs.bdjobs.com/jobsearch.asp?fcatId=8&icatId=0"]) {
  r = await render(u, 4000);
  const jobs = (r.html.match(/IJOB|jobdetail|job-details/gi) || []).length;
  console.log(`  ${u} → ${r.html.length}b, job-signals:${jobs}`);
  console.log("   api:", [...new Set(r.apiCalls)].slice(0, 4));
}
await browser.close();
