import { chromium } from "playwright";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });

async function render(url, waitMs = 4000) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(waitMs);
    return await page.content();
  } catch (e) {
    return `__ERROR__ ${e.message}`;
  } finally {
    await page.close();
  }
}

// 1. BDJobs IT jobs search
let html = await render("https://jobs.bdjobs.com/alljobs.asp?fcatId=8&icatId=0");
console.log("BDJOBS alljobs.asp:", html.length, "bytes | err:", html.startsWith("__ERROR__"));
if (!html.startsWith("__ERROR__")) {
  console.log("  jobTitle-ish:", (html.match(/job-title|jobTitle/gi) || []).length);
  const links = [...html.matchAll(/href="([^"]*jobdetail[^"]*)"/gi)].slice(0, 3).map(m => m[1]);
  console.log("  detail links:", links);
}

// 2. Vivasoft
html = await render("https://vivasoftltd.com/career/");
console.log("\nVIVASOFT:", html.length, "bytes");
const vh = [...html.matchAll(/<h[1-6][^>]*>([^<]*(?:Engineer|Developer|Lead|Specialist|Manager)[^<]*)<\/h[1-6]>/gi)].map(m => m[1].trim());
console.log("  role headings:", [...new Set(vh)].slice(0, 8));

// 3. Cefalo
html = await render("https://career.cefalo.com/");
console.log("\nCEFALO:", html.length, "bytes");
const cl = [...new Set([...html.matchAll(/href="(\/job\/[^"]+)"/g)].map(m => m[1]))];
console.log("  job links:", cl.slice(0, 6), "total:", cl.length);

// 4. atB Jobs
html = await render("https://atb-jobs.com/candidate/jobs", 6000);
console.log("\nATB:", html.length, "bytes");
const at = [...new Set([...html.matchAll(/"title"\s*:\s*"([^"]{8,60})"/g)].map(m => m[1]))];
console.log("  json titles:", at.slice(0, 6));

await browser.close();
