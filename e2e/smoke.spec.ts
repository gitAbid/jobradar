import { expect, test } from "@playwright/test";

// One serial journey: sign in -> onboarding -> filter -> favorite -> applied
// -> /saved -> API key -> public API. Needs migrated DB + e2e/fixtures.sql.
test("core user journey", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@jobradar.test`;

  await test.step("sign in with test login", async () => {
    await page.goto("/signin");
    await page.getByLabel("Test login (dev only)").fill(email);
    await page.getByRole("button", { name: "Sign in as test user" }).click();
    await page.waitForURL(/\/onboarding/);
  });

  await test.step("skip onboarding", async () => {
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"));
  });

  await test.step("filter the feed", async () => {
    await page.goto("/?showAll=1");
    const cards = page.locator("article");
    await expect(cards.first()).toBeVisible();
    const before = await cards.count();
    expect(before).toBeGreaterThanOrEqual(6);

    await page.getByLabel("Search jobs").fill("Kotlin");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=Kotlin/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Senior Kotlin Engineer");
    expect(1).toBeLessThan(before);
  });

  await test.step("favorite then apply", async () => {
    const card = page.locator("article").first();
    const fav = card.getByRole("button", { name: "Favorite" });
    await fav.click();
    await expect(fav).toHaveAttribute("aria-pressed", "true");
    const applied = card.getByRole("button", { name: "Applied" });
    await applied.click();
    await expect(applied).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("shows under Applied on /saved", async () => {
    await page.goto("/saved");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Applied", exact: true }) }).last();
    await expect(section.getByText("Senior Kotlin Engineer")).toBeVisible();
  });

  let key = "";
  await test.step("create an API key", async () => {
    await page.goto("/settings");
    await page.getByPlaceholder("my-app").fill("e2e-key");
    await page.getByRole("button", { name: "Create key" }).click();
    const secret = page.locator("code").filter({ hasText: /^\S{16,}$/ }).first();
    await expect(secret).toBeVisible();
    key = (await secret.innerText()).trim();
    expect(key.length).toBeGreaterThan(16);
  });

  await test.step("public API", async () => {
    const ok = await request.get("/api/v1/jobs", { headers: { Authorization: `Bearer ${key}` } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const denied = await request.get("/api/v1/jobs");
    expect(denied.status()).toBe(401);
  });
});
