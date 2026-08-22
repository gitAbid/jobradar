import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/126" });
const page = await ctx.newPage();
const calls = [];
page.on("response", async r => {
  const u = r.url(); const ct = r.headers()["content-type"] || "";
  if (ct.includes("json")) {
    let body = ""; try { body = (await res_text(r)).slice(0,150); } catch {}
    if (/1524519|job|detail/i.test(u) || body.includes("Responsib") || body.length > 50)
      calls.push({ u: u.slice(0,150), body });
  }
});
async function res_text(r){ return await r.text(); }
await page.goto("https://jobs.bdjobs.com/jobdetails.asp?id=1524519&ln=1", { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
await page.waitForTimeout(6000);
for (const c of [...new Map(calls.map(c=>[c.u,c])).values()].slice(0,8)) {
  console.log("→", c.u); console.log("   ", c.body.replace(/\s+/g," ").slice(0,130));
}
await browser.close();
