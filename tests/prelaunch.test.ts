import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReviewLink, UNRESOLVED } from "../src/google-review-link";
import { fixture } from "./operations.test";
import { body } from "../src/core";
import { hashPassword } from "../src/security";

// Public Google Maps URL documentation: Sydney Opera House (actual published Place ID).
const place = "ChIJ3S-JXmauEmsRUcIaWtf4MzE";
const review = "https://search.google.com/local/writereview?placeid=" + place;
for (const url of [
  review,
  "https://www.google.com/maps/search/?api=1&query=Sydney+Opera+House&query_place_id=" +
    place,
  "https://google.com/maps?q=place_id:" + place + "&utm_source=test",
  "https://www.google.com/maps/place/Sydney/data=!4m2!3m1!1s" + place,
  "https://g.page/r/CbEGsFfmQ6MIEBM/review",
])
  test("review converter: " + new URL(url).pathname, async () => {
    const r = await generateReviewLink(url, (async () => {
      throw Error("No fetch needed");
    }) as typeof fetch);
    assert.equal(r.url, url.includes("g.page") ? url : review);
  });
test("short link uses manual redirects, one timeout, cancels body", async () => {
  let calls = 0,
    signal: AbortSignal | null | undefined;
  const f = (async (_url, init) => {
    assert.equal(init?.redirect, "manual");
    if (signal) assert.equal(signal, init?.signal);
    signal = init?.signal;
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: calls === 1 ? "https://goo.gl/maps/Test" : review },
    });
  }) as typeof fetch;
  assert.equal(
    (await generateReviewLink("https://maps.app.goo.gl/Test", f)).url,
    review,
  );
  assert.equal(calls, 2);
});
for (const url of [
  "javascript:alert(1)",
  "data:text/html,test",
  "http://google.com/maps",
  "https://google.com.evil.test/maps",
  "https://127.0.0.1/maps",
  "https://10.0.0.1/maps",
  "https://169.254.169.254/latest/meta-data",
  "https://localhost/maps",
  "https://[::1]/maps",
  "https://google.com@evil.test/maps",
  "https://google.com/url?q=https://evil.test",
  "https://google.com/maps?redirect=https://evil.test",
  "https://google.com:444/maps",
])
  test("review SSRF refuses before fetch: " + url, async () => {
    let calls = 0;
    await assert.rejects(() =>
      generateReviewLink(url, (async () => {
        calls++;
        return new Response();
      }) as typeof fetch),
    );
    assert.equal(calls, 0);
  });
test("review rejects external redirect, oversized location, redirect loop and unsupported CID", async () => {
  for (const destination of [
    "https://evil.test",
    "https://127.0.0.1",
    "https://google.com/maps?" + "x".repeat(2100),
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      generateReviewLink("https://maps.app.goo.gl/Test", (async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: destination },
        });
      }) as typeof fetch),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(() =>
    generateReviewLink("https://maps.app.goo.gl/Test", (async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://maps.app.goo.gl/Test" },
      });
    }) as typeof fetch),
  );
  assert.equal(calls, 5);
  await assert.rejects(
    () => generateReviewLink("https://google.com/maps?cid=123"),
    { message: UNRESOLVED },
  );
  await assert.rejects(() =>
    generateReviewLink(
      "https://google.com/maps?placeid=" +
        place +
        "&query_place_id=DifferentPlace123",
    ),
  );
});
test("review generator requires auth and rate limits users", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.call(
        "/api/google-review-link",
        "POST",
        { url: review },
        "anonymous",
      )
    ).r.status,
    401,
  );
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await f.call(
          "/api/google-review-link",
          "POST",
          { url: review },
          "seller-a",
        )
      ).r.status,
      200,
    );
  assert.equal(
    (
      await f.call(
        "/api/google-review-link",
        "POST",
        { url: review },
        "seller-a",
      )
    ).r.status,
    429,
  );
  assert.equal(
    (
      await f.call(
        "/api/google-review-link",
        "POST",
        { url: review },
        "seller-b",
      )
    ).r.status,
    200,
  );
});
test("all-lot filters paginate, refresh counters and preserve URLs", async () => {
  const f = await fixture(),
    lot = await f.lot(251);
  const p = lot.plates[0];
  await f.activate(p);
  const first = await f.call(
    "/api/plates?batch_id=" + lot.id + "&status=INACTIVE",
  );
  assert.equal(first.b.plates.length, 100);
  assert.equal(first.b.counts.inactive, 250);
  const second = await f.call(
    "/api/plates?batch_id=" +
      lot.id +
      "&status=INACTIVE&after=" +
      first.b.next_after,
  );
  assert.equal(second.b.plates.length, 100);
  assert.ok(second.b.plates.every((p: any) => p.status !== "ACTIVE"));
  await f.call("/api/plates/" + p.id + "/block", "POST", { blocked: true });
  const active = await f.call(
    "/api/plates?batch_id=" + lot.id + "&status=ACTIVE",
  );
  assert.equal(active.b.plates.length, 0);
  assert.equal(active.b.counts.blocked, 1);
  const blocked = await f.call(
    "/api/plates?batch_id=" + lot.id + "&status=BLOCKED",
  );
  assert.equal(blocked.b.plates[0].token, p.token);
  assert.equal((await f.call("/api/plates?status=invalid")).r.status, 400);
});
test("edit preserves hidden address; owner and ADMIN edit, another seller cannot", async () => {
  const f = await fixture(),
    lot = await f.lot(1),
    activated = await f.activate(lot.plates[0]);
  const path = "/api/establishments/" + activated.b.establishment_id;
  const { b: e } = await f.call(path, "GET", undefined, "seller-a");
  const { address, ...input } = e;
  assert.equal(
    (await f.call(path, "PATCH", { ...input, google_url: review }, "seller-b"))
      .r.status,
    404,
  );
  assert.equal(
    (await f.call(path, "PATCH", { ...input, google_url: review }, "seller-a"))
      .r.status,
    200,
  );
  const updated = (await f.call(path)).b;
  assert.equal(updated.address, address);
  assert.equal(
    (await f.call(path, "PATCH", { ...updated, name: "ADMIN edited" })).r
      .status,
    200,
  );
  assert.equal(
    (
      await f.call("/r/" + lot.plates[0].code + "-" + lot.plates[0].token)
    ).r.headers.get("location"),
    review,
  );
});
test("custom segments are validated and inserted atomically; cities scoped", async () => {
  const f = await fixture(),
    lot = await f.lot(2);
  const created = await f.activate(lot.plates[0], "seller-a", {
    segment: "__other__",
    segment_other: "Serviço especializado",
  });
  assert.equal(created.r.status, 200);
  assert.equal(
    (await f.call("/api/cities", "GET", undefined, "seller-b")).b.length,
    0,
  );
  assert.deepEqual(
    (await f.call("/api/cities", "GET", undefined, "seller-a")).b,
    ["Porto Alegre"],
  );
  assert.equal(
    (
      await f.activate(lot.plates[1], "seller-a", {
        segment: "__other__",
        segment_other: "",
      })
    ).r.status,
    400,
  );
});
test("streaming body rejects >16KiB before parsing; HTTP JSON errors remain", async () => {
  await assert.rejects(
    () =>
      body(
        new Request("https://test.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x: "é".repeat(9000) }),
        }),
      ),
    { status: 413 },
  );
  await assert.rejects(
    () =>
      body(new Request("https://test.invalid", { method: "POST", body: "{}" })),
    { status: 415 },
  );
  await assert.rejects(
    () =>
      body(
        new Request("https://test.invalid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "bad",
        }),
      ),
    { status: 400 },
  );
});
test("login cooldown restores access and ADMIN legacy reset has secondary brute-force protection", async () => {
  const f = await fixture();
  const password = "Existing-password-for-test";
  f.db.sql
    .prepare("UPDATE users SET password_hash=? WHERE id='admin'")
    .run(await hashPassword(password, f.env.PASSWORD_PEPPER));
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.call("/api/login", "POST", {
          email: "admin@test.invalid",
          password: "incorrect",
        })
      ).r.status,
      401,
    );
  assert.equal(
    (
      await f.call("/api/login", "POST", {
        email: "admin@test.invalid",
        password,
      })
    ).r.status,
    429,
  );
  f.db.sql.prepare("UPDATE login_limits SET reset_at=0").run();
  assert.equal(
    (
      await f.call("/api/login", "POST", {
        email: "admin@test.invalid",
        password,
      })
    ).r.status,
    200,
  );
  for (let i = 0; i < 8; i++)
    assert.equal(
      (
        await f.call("/api/users/seller-a/reset-password", "POST", {
          current_password: "wrong",
        })
      ).r.status,
      403,
    );
  assert.equal(
    (
      await f.call("/api/users/seller-a/reset-password", "POST", {
        current_password: "wrong",
      })
    ).r.status,
    429,
  );
});
test("bounded pagination and unexpected HTTP methods", async () => {
  const f = await fixture();
  for (const path of [
    "/api/people?offset=1000000000",
    "/api/plates?after=Infinity",
    "/api/audit?before=-1",
    "/api/search?q=" + "x".repeat(2049),
  ])
    assert.equal((await f.call(path)).r.status, 400);
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal((await f.call("/api/me", method)).r.status, 404);
});
