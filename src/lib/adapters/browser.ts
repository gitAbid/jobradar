import type { Browser } from "playwright";

/**
 * Lazy singleton headless Chromium for scraping JS-rendered career pages.
 * The browser is either a local launch, or — when BROWSERLESS_WS_URL is set
 * (e.g. a Browserless Cloud-Chrome endpoint) — a remote session connected
 * over CDP, which is what lets detail enrichment run on serverless where
 * local Chromium cannot. playwright itself is imported lazily too —
 * importing this module must never fail in environments where the package
 * is unavailable (serverless), so adapters can degrade gracefully.
 */

declare const globalThis: { __jobradarBrowser?: Browser };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/**
 * Local headless Chromium cannot run on serverless (no browser binaries,
 * read-only FS), so it is disabled there — unless BROWSERLESS_WS_URL hands
 * rendering to a remote browser. JOBRADAR_DISABLE_BROWSER=1 force-disables
 * rendering everywhere. Boards that need it degrade to their list-only data
 * via the adapters' per-item try/catch; browser-only boards (Cefalo)
 * surface a board error.
 */
export function isHeadlessBrowserAvailable(): boolean {
  if (process.env.JOBRADAR_DISABLE_BROWSER === "1") return false;
  if (process.env.BROWSERLESS_WS_URL) return true;
  return process.env.VERCEL !== "1";
}

function assertBrowserAvailable(): void {
  if (!isHeadlessBrowserAvailable()) {
    throw new Error("headless browser unavailable in this environment");
  }
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const remote = process.env.BROWSERLESS_WS_URL;
  if (remote) return chromium.connectOverCDP(remote);
  return chromium.launch({ headless: true });
}

export async function getBrowser(): Promise<Browser> {
  assertBrowserAvailable();
  if (!globalThis.__jobradarBrowser?.isConnected()) {
    globalThis.__jobradarBrowser = await launchBrowser();
  }
  return globalThis.__jobradarBrowser;
}

/** Render a JS-heavy page and return the final HTML after hydration. */
export async function renderPage(url: string, waitMs = 4000): Promise<string> {
  assertBrowserAvailable();
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

/** Render a JS-heavy page and return its readable plain text (innerText). */
export async function renderText(url: string, waitMs = 3500): Promise<string> {
  assertBrowserAvailable();
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    return await page.evaluate(() => document.body.innerText ?? "");
  } finally {
    await ctx.close();
  }
}
