const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = process.env.APP_URL || "http://127.0.0.1:4173";
const API_URL = "https://rta-schedule-api.onrender.com";

test.describe("RTASchedule Mini App regression", () => {
  test("main schedule renders and week navigation is reversible", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    // First-run group selection is intentionally modal; close it before testing background controls.
    if (await page.locator("#groupModal").evaluate(el => el.classList.contains("open"))) {
      await page.locator("#closeGroupModal").click();
    }
    await expect(page).toHaveTitle(/Расписание|RTASchedule/i);
    await expect(page.locator("#scheduleGroupCard")).toBeVisible();
    await expect(page.locator("#weekRange")).toBeVisible();
    await expect(page.locator("#weekParity")).toBeVisible();

    const initialRange = await page.locator("#weekRange").innerText();
    await page.locator("#nextWeek").click();
    await expect(page.locator("#weekRange")).not.toHaveText(initialRange);
    await page.locator("#prevWeek").click();
    await expect(page.locator("#weekRange")).toHaveText(initialRange);

    expect(pageErrors, "uncaught JavaScript errors").toEqual([]);
  });

  test("profile and group selector open without breaking schedule", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    // First-run group selection is intentionally modal; close it before testing background controls.
    if (await page.locator("#groupModal").evaluate(el => el.classList.contains("open"))) {
      await page.locator("#closeGroupModal").click();
    }
    await page.locator("#profileBtn").click();
    await expect(page.locator("#profilePanel")).toBeVisible();
    await page.locator("#profileChangeGroup").click();
    await expect(page.locator("#groupModal")).toHaveClass(/open/);
    await expect(page.locator("#groupModalTitle")).toBeVisible();
    await page.locator("#closeGroupModal").click();
    await expect(page.locator("#groupModal")).not.toHaveClass(/open/);
  });

  test("representative entry point opens login inside profile", async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    // First-run group selection is intentionally modal; close it before testing background controls.
    if (await page.locator("#groupModal").evaluate(el => el.classList.contains("open"))) {
      await page.locator("#closeGroupModal").click();
    }
    await page.locator("#profileBtn").click();
    await page.locator("#repOpen").click();
    await expect(page.locator("#repPanel")).toHaveClass(/open/);
    await expect(page.locator("#repPassword")).toBeVisible();
    await expect(page.locator("#repLoginButton")).toBeVisible();
    // Authentication and destructive schedule edits are intentionally not automated without a test account.
  });

  test("representative edit actions keep the editor open after save/delete/restore", async () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    expect(html).toContain("function keepRepresentativeEditorVisible()");
    expect(html).toMatch(/async function saveEntry[\s\S]{0,5000}keepRepresentativeEditorVisible\(\)/);
    expect(html).toMatch(/async function removeEntry[\s\S]{0,5000}keepRepresentativeEditorVisible\(\)/);
    expect(html).toMatch(/async function restoreHistory[\s\S]{0,5000}keepRepresentativeEditorVisible\(\)/);
    expect(html).toMatch(/<button type="button" class="rep-secondary" data-edit=/);
    expect(html).toMatch(/<button type="button" class="rep-danger" data-delete=/);
  });
});

test.describe("Live API smoke", () => {
  test("health endpoint responds successfully", async ({ request }) => {
    const response = await request.get(`${API_URL}/health`, { timeout: 45_000 });
    expect(response.status(), "API health status").toBe(200);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
  });

  test("public groups endpoint responds with JSON", async ({ request }) => {
    const response = await request.get(`${API_URL}/api/groups`, { timeout: 45_000 });
    expect(response.status(), "public groups status").toBe(200);
    const body = await response.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });
});
