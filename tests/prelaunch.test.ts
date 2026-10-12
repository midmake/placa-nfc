import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./operations.test";
import { body } from "../src/core";
import { hashPassword } from "../src/security";
// Valid manual destination used by the existing edit/redirect regression.
const review =
  "https://search.google.com/local/writereview?placeid=ChIJ3S-JXmauEmsRUcIaWtf4MzE";

test("endpoint do gerador removido retorna 404 sem requests externos", async () => {
  const f = await fixture();
  const original = globalThis.fetch;
  let external = 0;
  globalThis.fetch = (async () => {
    external++;
    throw new Error("Unexpected network");
  }) as typeof fetch;
  try {
    for (const who of ["admin", "seller-a", "seller-b"])
      assert.equal(
        (
          await f.call(
            "/api/google-review-link",
            "POST",
            { url: "https://share.google/Example" },
            who,
          )
        ).r.status,
        404,
      );
    assert.equal(external, 0);
  } finally {
    globalThis.fetch = original;
  }
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
