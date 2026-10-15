import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/126" });
const page = await ctx.newPage();
await page.goto("https://tekarsh.com/career", { waitUntil: "networkidle", timeout: 35000 }).catch(() => {});
await page.waitForTimeout(4000);
const links = [...new Set([...(await page.content()).matchAll(/href="([^"]*career\/job\/[^"]+)"/g)].map(m => m[1]))];
console.log("tekarsh job links:", links.length);
links.slice(0, 6).forEach(l => console.log(" •", l));
// also capture XHR api
const apis = new Set();
page.on("request", r => { if (/api|json/i.test(r.url()) && !/google|font/i.test(r.url())) apis.add(r.url()); });
await page.reload({ waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(3000);
console.log("apis:", [...apis].slice(0, 5));
await browser.close();
