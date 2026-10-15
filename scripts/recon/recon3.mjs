import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Macintosh) Chrome/126";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA });
const page = await ctx.newPage();
const jsonResponses = [];
page.on("response", async (res) => {
  const u = res.url();
  const ct = (res.headers()["content-type"] || "");
  if (ct.includes("json") && !/i18n|maintenance|googleapis/.test(u)) {
    let body = "";
    try { body = (await res.text()).slice(0, 120); } catch {}
    jsonResponses.push({ u: u.slice(0, 130), ct, body });
  }
});
await page.goto("https://jobs.bdjobs.com/jobsearch.asp?fcatId=8&icatId=0", { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
await page.waitForTimeout(6000);
console.log("JSON responses seen:");
for (const j of jsonResponses.slice(0, 10)) console.log(" ", j.u, "\n    →", j.body.replace(/\s+/g, " ").slice(0, 100));
// also dump visible job titles
const titles = await page.evaluate(() =>
  [...document.querySelectorAll("a,div,h2,h3,h4")].map(e => e.textContent?.trim()).filter(t => t && /developer|engineer|java|executive/i.test(t) && t.length < 80).slice(0, 8)
);
console.log("visible role texts:", [...new Set(titles)]);
await browser.close();
