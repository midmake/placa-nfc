// Render production UI with synthetic API fixtures, never contacts production.
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.GEARGO_PLAYWRIGHT_MODULE || "playwright",
);
const root = resolve("public");
const server = createServer((req, res) => {
  const path = resolve(
    root,
    "." + new URL(req.url, "http://localhost").pathname,
  );
  if (!path.startsWith(root + "/") && path !== root) {
    res.writeHead(404).end();
    return;
  }
  try {
    const file =
      path === root || path === root + "/" ? root + "/index.html" : path;
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".json": "application/json",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.GEARGO_CHROMIUM_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--no-zygote",
  ],
});
const page = await browser.newPage();
let logged = true,
  role = "ADMIN";
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
const batch = {
  id: "fixture-lot",
  name: "Lote teste local",
  quantity: 251,
  active: 1,
  inactive: 249,
  blocked: 1,
  generation_state: "READY",
  pending_codes: 0,
  is_test: 1,
  created_at: "2026-10-01",
  physical_prefix: "A0110",
};
await page.route("**/api/**", async (route) => {
  const u = new URL(route.request().url()),
    path = u.pathname;
  let b = {},
    status = 200;
  if (path === "/api/me") {
    if (logged)
      b = {
        id: "local",
        name: "Local",
        role,
        commercial_type: role === "ADMIN" ? "EQUIPE_GEAR" : "REVENDEDOR",
      };
    else {
      status = 401;
      b = { error: "Entre" };
    }
  }
  if (path === "/api/categories")
    b = [{ name: "Barbearia" }, { name: "Restaurante" }];
  if (path === "/api/cities") b = ["Porto Alegre", "São Paulo"];
  if (path === "/api/users" || path === "/api/establishments") b = [];
  if (path === "/api/dashboard")
    b = {
      counts: {
        active: 1,
        inactive: 249,
        blocked: 1,
        team: 2,
        resellers: 2,
        invitations: 0,
        month_activations: 1,
      },
      recent: [],
      batches: [],
    };
  if (path === "/api/products") b = [];
  if (path === "/api/batches") b = [batch];
  if (path === "/api/people")
    b = { users: [], next_offset: null, email_ready: true };
  if (path === "/api/allocations")
    b = [
      { batch_name: "Lote local", quantity: 20, consumed: 7, available: 13 },
    ];
  if (path === "/api/plates")
    b = {
      plates: [],
      next_after: null,
      counts: { total: 251, active: 1, inactive: 249, blocked: 1 },
    };
  if (path === "/api/activation/verify")
    b = { grant: "fixture", code: "A0110-K7Q2" };
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(b),
  });
});
mkdirSync("tmp/mobile", { recursive: true });
const results = [];
try {
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    logged = true;
    role = "ADMIN";
    await page.goto(origin);
    await page.waitForSelector("#quick-activate");
    for (const screen of [
      "dashboard",
      "activate",
      "batches",
      "establishments",
      "resellers",
    ]) {
      await page.evaluate((p) => globalThis.go(p), screen);
      if (screen === "activate") {
        await page.locator('[name="code"]').fill("A0110K7Q2");
        await page.locator("#verify-code button").click();
        await page.waitForSelector("#activate-form");
      }
      if (screen === "batches") {
        await page.locator('[data-lot-status="INACTIVE"]').click();
      }
      const sizes = await page.evaluate(() => ({
        w: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(
        sizes.scroll <= sizes.w + 1,
        screen + " overflow at " + width + ": " + JSON.stringify(sizes),
      );
      results.push({ width, screen, overflow: false });
      if (width === 390)
        await page.screenshot({
          path: "tmp/mobile/" + screen + ".png",
          fullPage: true,
        });
    }
    logged = false;
    await page.goto(origin);
    await page.waitForSelector("#login");
    await page.evaluate(() =>
      globalThis.message("Senha definida. Entre com a nova senha."),
    );
    const color = await page
      .locator("#notice")
      .evaluate((el) => getComputedStyle(el).color);
    assert.equal(color, "rgb(24, 45, 73)");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    results.push({ width, screen: "login-notice", overflow: false, color });
    if (width === 390)
      await page.screenshot({ path: "tmp/mobile/login.png", fullPage: true });
    logged = true;
    role = "USER";
    await page.goto(origin);
    await page.waitForSelector("#new-activation");
    await page.evaluate(() => globalThis.go("balance"));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    results.push({ width, screen: "reseller-balance", overflow: false });
  }
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify(
      { checks: results.length, results, pageErrors: failures },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
