import { chromium, type Browser } from "playwright";

/**
 * Lazy singleton headless Chromium for scraping JS-rendered career pages.
 * The browser launches on first use and stays alive for the process
 * lifetime; OS reaps it on exit.
 */

declare const globalThis: { __jobradarBrowser?: Browser };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export async function getBrowser(): Promise<Browser> {
  if (!globalThis.__jobradarBrowser?.isConnected()) {
    globalThis.__jobradarBrowser = await chromium.launch({ headless: true });
  }
  return globalThis.__jobradarBrowser;
}

/** Render a JS-heavy page and return the final HTML after hydration. */
export async function renderPage(url: string, waitMs = 4000): Promise<string> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    return await page.content();
  } finally {
    await ctx.close();
  }
}
