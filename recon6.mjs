import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/126" });
const page = await ctx.newPage();
const calls = [];
page.on("response", async r => {
  const u = r.url(); const ct = r.headers()["content-type"] || "";
  if (ct.includes("json") && /jobdetail|JobDetail|GetJob|1524519/i.test(u)) {
    calls.push(u.slice(0,140));
  }
});
await page.goto("https://jobs.bdjobs.com/jobdetails.asp?id=1524519&ln=1", { waitUntil: "networkidle", timeout: 40000 }).catch(e => console.log("nav err:", e.message));
await page.waitForTimeout(5000);
console.log("detail API calls:", [...new Set(calls)]);
// check visible responsibilities text
const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
console.log("page text sample:", txt.replace(/\s+/g," ").slice(0,200));
await browser.close();
