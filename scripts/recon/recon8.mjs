import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/126" })).newPage();
await page.goto("https://jobs.bdjobs.com/jobdetails.asp?id=1524519&ln=1", { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
await page.waitForTimeout(4000);
const html = await page.content();
console.log("rendered size:", html.length, "| has Responsibilities:", /responsib/i.test(html));
// find where JD lives: angular state? script json?
const m = html.match(/"jobDescription":"(.{0,120})/);
console.log("jobDescription field:", m ? m[0].slice(0,140) : "none");
const m2 = html.match(/(Responsibilities[\s\S]{0,150})/i);
if (m2) console.log("ctx:", m2[1].replace(/\s+/g," ").slice(0,160));
await browser.close();
