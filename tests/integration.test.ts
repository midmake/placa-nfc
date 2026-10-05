import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/index";
import { hashPassword } from "../src/security";
// Real SQLite schema/constraints/transactions, exposing D1's small interface.
// Wrangler runtime smoke tests are additionally documented in README.
import { TestDB } from "./db";
test("MVP completo: autenticação, autorização, lote, cadastro, múltiplas placas, histórico, reset", async () => {
  const db = new TestDB(),
    pepper = "test-pepper-only-never-deploy-".repeat(2);
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("assets") },
    PASSWORD_PEPPER: pepper,
  } as unknown as Env;
  const initial = "Temporary-Password-123";
  db.sql
    .prepare(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
    )
    .run(
      "admin",
      "Admin",
      "admin@test.invalid",
      await hashPassword(initial, pepper),
      "ADMIN",
    );
  let cookie = "";
  async function call(
    path: string,
    method = "GET",
    data?: unknown,
    customCookie = cookie,
    origin = "https://test.invalid",
  ) {
    const r = await worker.fetch(
      new Request("https://test.invalid" + path, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: customCookie,
        },
        body: data ? JSON.stringify(data) : undefined,
      }),
      env,
    );
    let b: any;
    const raw = await r.text();
    try {
      b = JSON.parse(raw);
    } catch {
      b = raw;
    }
    return { r, b };
  }
  async function login(email: string, password: string) {
    const { r, b } = await call("/api/login", "POST", { email, password });
    assert.equal(r.status, 200, JSON.stringify(b));
    return r.headers.get("set-cookie")!.split(";")[0];
  }
  assert.equal((await call("/api/plates")).r.status, 401);
  assert.equal(
    (
      await call("/api/login", "POST", {
        email: "admin@test.invalid",
        password: "wrong",
      })
    ).r.status,
    401,
  );
  cookie = await login("admin@test.invalid", initial);
  assert.match(cookie, /gg_session=/);
  assert.equal((await call("/api/plates")).r.status, 403);
  assert.equal(
    (
      await call("/api/password", "POST", {
        current_password: initial,
        password: initial,
      })
    ).r.status,
    400,
  );
  assert.equal(
    (
      await call("/api/password", "POST", {
        current_password: initial,
        password: "Permanent-Admin-123",
      })
    ).r.status,
    200,
  );
  assert.equal((await call("/api/me")).r.status, 401);
  cookie = await login("admin@test.invalid", "Permanent-Admin-123");
  const adminCookie = cookie;
  assert.equal(
    (
      await call(
        "/api/users",
        "POST",
        { name: "X", email: "x@test.invalid" },
        cookie,
        "https://evil.test",
      )
    ).r.status,
    403,
  );
  const u = (
    await call("/api/users", "POST", {
      name: "Gabriel",
      email: "gabriel@test.invalid",
    })
  ).b;
  assert.ok(u.temporary_password);
  const u2 = (
    await call("/api/users", "POST", {
      name: "Outro",
      email: "outro@test.invalid",
    })
  ).b;
  const batch = (
    await call("/api/batches", "POST", {
      name: "Piloto",
      quantity: 50,
      request_key: crypto.randomUUID(),
    })
  ).b;
  assert.ok(batch.id);
  assert.equal(
    (await call(`/api/batches/${batch.id}/generate`, "POST", {})).r.status,
    200,
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM plates").get()!.n, 50);
  assert.equal(
    (await call(`/api/batches/${batch.id}/assign`, "POST", { owner_id: u.id }))
      .r.status,
    200,
  );
  const csv = await call(`/api/batches/${batch.id}/csv?mode=test`);
  assert.equal(csv.r.status, 200);
  assert.match(
    csv.b,
    /A\d{4}-[A-Z2-9]{4},https:\/\/test.invalid\/r\/A00001-[a-f0-9]{48}/,
  );
  const all = (await call("/api/plates")).b.plates;
  const first = all.find((p: any) => p.code === "A00001"),
    second = all.find((p: any) => p.code === "A00002");
  const redirectPath = new URL(first.qr_url).pathname;
  assert.match(
    (await call(redirectPath)).r.headers.get("location")!,
    /activate=A00001-/,
  );
  cookie = await login("gabriel@test.invalid", u.temporary_password);
  await call("/api/password", "POST", {
    current_password: u.temporary_password,
    password: "Gabriel-Permanent-123",
  });
  cookie = await login("gabriel@test.invalid", "Gabriel-Permanent-123");
  const userCookie = cookie;
  assert.equal((await call("/api/users")).r.status, 403);
  assert.equal(
    (await call("/api/batches", "POST", { name: "Bad", quantity: 1 })).r.status,
    403,
  );
  assert.equal((await call(`/api/batches/${batch.id}/csv`)).r.status, 403);
  assert.equal((await call("/api/audit")).r.status, 403);
  const input = {
    name: "Barbearia Márcio",
    city: "Porto Alegre",
    segment: "Barbearia",
    responsible: "Márcio",
    phone: "(51) 99999-1111",
    google_url: "https://search.google.com/local/writereview?placeid=abc",
  };
  const grant1 = (
    await call("/api/activation/verify", "POST", { code: first.physical_code })
  ).b.grant;
  const grant2 = (
    await call("/api/activation/verify", "POST", { code: second.physical_code })
  ).b.grant;
  assert.equal(
    (
      await call("/api/activation/complete", "POST", {
        ...input,
        grant: grant1,
        google_url: "https://evil.com",
      })
    ).r.status,
    400,
  );
  const activated = await call("/api/activation/complete", "POST", {
    ...input,
    grant: grant1,
  });
  assert.equal(activated.r.status, 200, JSON.stringify(activated.b));
  const eid = activated.b.establishment_id;
  assert.equal(
    (await call(redirectPath)).r.headers.get("location"),
    input.google_url,
  );
  const duplicate = await call("/api/activation/complete", "POST", {
    ...input,
    grant: grant2,
  });
  assert.equal(duplicate.r.status, 409);
  assert.equal(duplicate.b.matches.length, 1);
  assert.equal(
    (
      await call("/api/activation/complete", "POST", {
        grant: grant2,
        establishment_id: eid,
      })
    ).r.status,
    200,
  );
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) n FROM establishments").get()!.n,
    1,
  );
  let e = (await call("/api/establishments/" + eid)).b;
  assert.equal(e.plates.length, 2);
  const newer = {
    ...input,
    phone: "(51) 98888-2222",
    google_url: "https://www.google.com/maps?cid=456",
    version: e.version,
  };
  assert.equal(
    (await call("/api/establishments/" + eid, "PATCH", newer)).r.status,
    200,
  );
  assert.equal(
    (await call("/api/establishments/" + eid, "PATCH", newer)).r.status,
    409,
  );
  assert.equal(
    (await call(redirectPath)).r.headers.get("location"),
    newer.google_url,
  );
  assert.equal(
    (await call(new URL(second.qr_url).pathname)).r.headers.get("location"),
    newer.google_url,
  );
  e = (await call("/api/establishments/" + eid)).b;
  assert.equal(JSON.parse(e.initial_snapshot).phone, input.phone);
  cookie = await login("outro@test.invalid", u2.temporary_password);
  await call("/api/password", "POST", {
    current_password: u2.temporary_password,
    password: "Other-Permanent-123",
  });
  cookie = await login("outro@test.invalid", "Other-Permanent-123");
  assert.equal((await call("/api/plates")).b.plates.length, 0);
  assert.equal((await call("/api/establishments")).b.length, 0);
  assert.equal((await call("/api/establishments/" + eid)).r.status, 404);
  assert.equal(
    (await call("/api/establishments/" + eid, "PATCH", newer)).r.status,
    404,
  );
  assert.equal(
    (
      await call("/api/activation/verify", "POST", {
        code: first.physical_code,
      })
    ).r.status,
    404,
  );
  cookie = adminCookie;
  const log = (
    await call("/api/audit?entity_type=establishment&entity_id=" + eid)
  ).b.entries;
  assert.equal(log.length, 2);
  assert.equal(JSON.parse(log[0].old_data).phone, input.phone);
  assert.equal(JSON.parse(log[0].new_data).phone, newer.phone);
  assert.equal(log[0].actor_id, u.id);
  assert.throws(() => db.sql.exec("DELETE FROM audit_log"));
  assert.throws(() =>
    db.sql.exec("UPDATE establishments SET initial_snapshot='{}'"),
  );
  assert.throws(() => db.sql.exec("UPDATE plates SET token='other'"));
  assert.equal(
    (await call(`/api/batches/${batch.id}/assign`, "POST", { owner_id: u2.id }))
      .r.status,
    200,
  );
  assert.equal(
    (await call(`/api/plates/${first.id}/assign`, "POST", { owner_id: u2.id }))
      .r.status,
    409,
  );
  const reset = await call(`/api/users/${u.id}/reset-password`, "POST", {});
  assert.ok(reset.b.temporary_password);
  assert.equal(
    (await call("/api/me", "GET", undefined, userCookie)).r.status,
    401,
  );
  assert.equal(
    (
      await call(
        "/api/establishments?q=98888&city=Porto%20Alegre&segment=Barbearia",
      )
    ).b.length,
    1,
  );
  assert.equal((await call("/r/A00001")).r.status, 404);
  const stored = db.sql
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(u.id)!;
  assert.notEqual(stored.password_hash, reset.b.temporary_password);
  assert.ok((await call("/api/me")).r.headers.get("content-security-policy"));
  await call("/api/logout", "POST", {});
  assert.equal((await call("/api/me")).r.status, 401);
  db.sql.close();
});
test("limita tentativas e não registra senhas", async () => {
  const db = new TestDB();
  const env = { DB: db, PASSWORD_PEPPER: "x".repeat(64) } as unknown as Env;
  for (let i = 0; i < 11; i++) {
    const r = await worker.fetch(
      new Request("https://test.invalid/api/login", {
        method: "POST",
        headers: {
          Origin: "https://test.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "missing@test.invalid",
          password: "random-password",
        }),
      }),
      env,
    );
    assert.equal(r.status, i < 10 ? 401 : 429);
  }
  db.sql.close();
});
test("rollback inclui auditoria e criação de estabelecimento", async () => {
  const db = new TestDB();
  await assert.rejects(() =>
    db.batch([
      db.prepare("INSERT INTO categories(name) VALUES('Teste rollback')"),
      db.prepare("INSERT INTO mutation_guard(ok) VALUES(0)"),
    ]),
  );
  assert.equal(
    db.sql
      .prepare("SELECT COUNT(*) n FROM categories WHERE name='Teste rollback'")
      .get()!.n,
    0,
  );
  db.sql.close();
});
