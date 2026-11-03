import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(".");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const target = pathname === "/" ? resolve(root, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": mime[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

const browser = await chromium.launch({ headless: true });
let pageErrors = [];
try {
  await new Promise(resolveListen => server.listen(4173, "127.0.0.1", resolveListen));
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  await context.addInitScript(() => {
    localStorage.setItem("rta_schedule_group", "Ю603/О-2503");
    window.Telegram = { WebApp: { initData: "" } };

    // Freeze the calendar at Wednesday 14 October 2026 so parity tests are
    // deterministic: 12–18 Oct is week Б, 19–25 Oct is week А.
    const NativeDate = Date;
    const fixedNow = new NativeDate("2026-10-14T12:00:00");
    class FixedDate extends NativeDate {
      constructor(...args) {
        if (args.length === 0) super(fixedNow.getTime());
        else super(...args);
      }
      static now() { return fixedNow.getTime(); }
    }
    window.Date = FixedDate;
  });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("https://rta-schedule-api.onrender.com/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [], lessons: [], _groups: [], changes: [], recurring_changes: [] })
  }));
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
  await page.locator("#days .day").first().waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator("#days .day").count(), 7, "week must render seven day buttons");

  const initialRange = await page.locator("#weekRange").innerText();
  assert.match(initialRange, /12.*18/, "fixed date must start in the week of 12–18 October");
  assert.match(await page.locator("#weekParity").innerText(), /Нечётная неделя/i, "12–18 October must be week Б / odd");

  await page.locator("#nextWeek").click();
  await page.waitForFunction(previous => document.querySelector("#weekRange")?.textContent !== previous, initialRange);
  const nextRange = await page.locator("#weekRange").innerText();
  assert.match(nextRange, /19.*25/, "next week must be 19–25 October");
  assert.match(await page.locator("#weekParity").innerText(), /Чётная неделя/i, "19–25 October must be week А / even");

  // Check parity in both directions, including negative offsets and repeated weeks.
  for (let i = 0; i < 3; i++) {
    await page.locator("#nextWeek").click();
    await page.waitForFunction(previous => document.querySelector("#weekRange")?.textContent !== previous, nextRange);
  }
  assert.match(await page.locator("#weekParity").innerText(), /Нечётная неделя/i, "week parity must alternate after multiple forward moves");
  await page.locator("#prevWeek").click();
  await page.waitForFunction(() => /Чётная неделя/i.test(document.querySelector("#weekParity")?.textContent || ""));
  await page.locator("#prevWeek").click();
  await page.waitForFunction(() => /Нечётная неделя/i.test(document.querySelector("#weekParity")?.textContent || ""));
  await page.locator("#prevWeek").click();
  await page.waitForFunction(() => /Чётная неделя/i.test(document.querySelector("#weekParity")?.textContent || ""));
  await page.locator("#prevWeek").click();
  await page.waitForFunction(() => /Нечётная неделя/i.test(document.querySelector("#weekParity")?.textContent || ""));
  await page.locator("#prevWeek").click();
  await page.waitForFunction(expected => document.querySelector("#weekRange")?.textContent === expected, initialRange);

  await page.locator("#todayWeek").click();
  const activeDay = page.locator("#days .day.active");
  assert.equal(await activeDay.count(), 1, "exactly one day must be selected");
  const dayNames = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  for (let i = 0; i < dayNames.length; i++) {
    await page.locator("#days .day").nth(i).click();
    await page.waitForFunction(name => (document.querySelector("#dayHeading")?.textContent || "").includes(name), dayNames[i]);
    assert.match(await page.locator("#dayHeading").innerText(), new RegExp(dayNames[i], "i"), dayNames[i] + " must be selectable");
  }
  await page.locator("#days .day").last().click();
  await page.waitForFunction(() => /Воскресенье/i.test(document.querySelector("#dayHeading")?.textContent || ""));
  assert.match(await page.locator("#dayHeading").innerText(), /Воскресенье/i, "Sunday must be selectable");
  const sundayRange = await page.locator("#weekRange").innerText();

  const swipe = async direction => page.locator("#dayView").evaluate((el, dir) => {
    const x0 = dir > 0 ? 300 : 80;
    const x1 = dir > 0 ? 80 : 300;
    const y = 260;
    const touch = x => new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
    const start = touch(x0);
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }));
    const moved = touch(x1);
    el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [moved], changedTouches: [moved] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [moved] }));
  }, direction);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await swipe(1);
  await page.waitForFunction(() => /Понедельник/i.test(document.querySelector("#dayHeading")?.textContent || ""));
  await page.waitForFunction(previous => document.querySelector("#weekRange")?.textContent !== previous, sundayRange);
  const mondayRange = await page.locator("#weekRange").innerText();
  assert.notEqual(mondayRange, sundayRange, "swiping left from Sunday must advance to the next week");

  await swipe(1);
  await page.waitForFunction(() => /Вторник/i.test(document.querySelector("#dayHeading")?.textContent || ""));
  await swipe(-1);
  await page.waitForFunction(() => /Понедельник/i.test(document.querySelector("#dayHeading")?.textContent || ""));
  assert.equal(await page.locator("#weekRange").innerText(), mondayRange, "rapid reverse swipe must restore the same week");
  assert.deepEqual(pageErrors, [], "application must not throw uncaught JavaScript errors");

  console.log("PASS: seven selectable days, Today, stable 12–18 Oct week Б / 19–25 Oct week А anchor, alternating parity across forward/backward week changes, Sunday→Monday rollover, repeated/reverse touch swipes, no uncaught page errors.");
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
