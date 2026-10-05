import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/index";
import { digest, hashPassword } from "../src/security";
import { accessEmail, sendAccessEmail } from "../src/email";
import { TestDB } from "./db";
const PASSWORD = "Example-safe-password-2026";
const business = {
  name: "Cliente Teste",
  city: "Porto Alegre",
  segment: "Barbearia",
  responsible: "Teste",
  phone: "51999991111",
  google_url: "https://www.google.com/maps?cid=123",
};
async function fixture() {
  const db = new TestDB(),
    hash = await hashPassword(PASSWORD, "test-pepper".repeat(4));
  for (const [id, role, type] of [
    ["admin", "ADMIN", "EQUIPE_GEAR"],
    ["team", "USER", "EQUIPE_GEAR"],
    ["reseller", "USER", "REVENDEDOR"],
    ["other", "USER", "REVENDEDOR"],
  ]) {
    db.sql
      .prepare(
        "INSERT INTO users(id,name,email,password_hash,role,must_change_password,commercial_type) VALUES(?,?,?,?,?,0,?)",
      )
      .run(id, id, id + "@example.test", hash, role, type);
    db.sql
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(
        await digest(id[0].repeat(64)),
        id,
        Date.now() + 3600000,
        Date.now(),
      );
  }
  // Session tokens are hex, so use a stable per-user mapping.
  const tokens = {
    admin: "a".repeat(64),
    team: "b".repeat(64),
    reseller: "c".repeat(64),
    other: "d".repeat(64),
  };
  db.sql.exec("DELETE FROM sessions");
  for (const [id, t] of Object.entries(tokens))
    db.sql
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(await digest(t), id, Date.now() + 3600000, Date.now());
  const env = {
    DB: db,
    PASSWORD_PEPPER: "test-pepper".repeat(4),
    ASSETS: {
      fetch: async () =>
        new Response(readFileSync("public/index.html", "utf8")),
    },
  } as unknown as Env;
  const call = async (
    path: string,
    method = "GET",
    data?: any,
    user = "admin",
  ) => {
    const r = await worker.fetch(
      new Request("https://placa.test.workers.dev" + path, {
        method,
        headers: {
          origin: "https://placa.test.workers.dev",
          "content-type": "application/json",
          "cf-connecting-ip": user,
          cookie: "gg_session=" + (tokens[user as keyof typeof tokens] || ""),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
    );
    const raw = await r.text();
    let b: any;
    try {
      b = JSON.parse(raw);
    } catch {
      b = raw;
    }
    return { r, b };
  };
  const lot = async (quantity = 3, is_test = false) => {
    const c = await call("/api/batches", "POST", {
      name: "Lote A0410",
      quantity,
      is_test,
      request_key: crypto.randomUUID(),
    });
    assert.equal(c.r.status, 201, JSON.stringify(c.b));
    let g;
    do {
      g = await call(`/api/batches/${c.b.id}/generate`, "POST", {});
      assert.equal(g.r.status, 200, JSON.stringify(g.b));
    } while (!g.b.complete);
    return {
      id: c.b.id,
      plates: db.sql
        .prepare("SELECT * FROM plates WHERE batch_id=? ORDER BY id")
        .all(c.b.id) as any[],
    };
  };
  const allocate = (
    id: string,
    quantity = 20,
    user_id = "reseller",
    request_key = crypto.randomUUID(),
  ) =>
    call("/api/allocations", "POST", {
      batch_id: id,
      quantity,
      user_id,
      product: "GOOGLE",
      request_key,
    });
  const proof = async (p: any, user = "reseller") => {
    const r = await call(
      "/api/activation/verify",
      "POST",
      { code: p.physical_code },
      user,
    );
    assert.equal(r.r.status, 200, JSON.stringify(r.b));
    return r.b.grant;
  };
  const activate = async (p: any, user = "reseller", input: any = business) =>
    call(
      "/api/activation/complete",
      "POST",
      { ...input, grant: await proof(p, user) },
      user,
    );
  const invite = (
    type = "EQUIPE_GEAR",
    email = crypto.randomUUID() + "@example.test",
  ) =>
    call("/api/invitations", "POST", {
      name: "Pessoa <Teste>",
      email,
      commercial_type: type,
    });
  const accept = (link: string, password = PASSWORD) =>
    call(
      "/api/access/accept",
      "POST",
      { token: link.split("/").at(-1), password, confirmation: password },
      "public",
    );
  return { db, env, call, lot, allocate, proof, activate, invite, accept };
}
for (const type of ["EQUIPE_GEAR", "REVENDEDOR"])
  test(`convite ${type}: hash apenas, 48h, acesso pela URL workers.dev e uso único`, async () => {
    const f = await fixture(),
      r = await f.invite(type);
    assert.equal(r.r.status, 201, JSON.stringify(r.b));
    assert.equal(r.b.delivery, "MANUAL");
    assert.match(
      r.b.link,
      /^https:\/\/placa.test.workers.dev\/convite\/[a-f0-9]{64}$/,
    );
    const row = f.db.sql
      .prepare("SELECT * FROM access_tokens WHERE user_id=?")
      .get(r.b.id) as any;
    assert.equal(row.expires_at - row.created_at, 48 * 3600000);
    assert.notEqual(row.token_hash, r.b.link.split("/").at(-1));
    assert.equal((await f.accept(r.b.link)).r.status, 200);
    assert.equal((await f.accept(r.b.link)).r.status, 400);
    const u = f.db.sql
      .prepare("SELECT * FROM users WHERE id=?")
      .get(r.b.id) as any;
    assert.equal(u.state, "ACTIVE");
    assert.equal(u.commercial_type, type);
    assert.equal(u.must_change_password, 0);
    const login = await f.call(
      "/api/login",
      "POST",
      { email: u.email, password: PASSWORD },
      "public",
    );
    assert.equal(login.r.status, 200);
    const logs = JSON.stringify(
      f.db.sql.prepare("SELECT * FROM audit_log").all(),
    );
    assert.ok(!logs.includes(PASSWORD));
    assert.ok(!logs.includes(r.b.link.split("/").at(-1)));
    assert.equal((await f.call(new URL(r.b.link).pathname)).r.status, 200);
  });
test("convite expirado, cancelado, reenviado e senha inválida", async () => {
  const f = await fixture(),
    first = await f.invite();
  assert.equal((await f.accept(first.b.link, "short")).r.status, 400);
  f.db.sql
    .prepare("UPDATE access_tokens SET expires_at=0 WHERE user_id=?")
    .run(first.b.id);
  assert.equal((await f.accept(first.b.link)).r.status, 400);
  const resend = await f.call(`/api/people/${first.b.id}/resend`, "POST", {});
  assert.equal(resend.r.status, 200);
  assert.notEqual(resend.b.link, first.b.link);
  assert.equal(
    (await f.call(`/api/people/${first.b.id}/cancel`, "POST", {})).r.status,
    200,
  );
  assert.equal((await f.accept(resend.b.link)).r.status, 400);
  const third = await f.call(`/api/people/${first.b.id}/resend`, "POST", {});
  assert.equal((await f.accept(third.b.link)).r.status, 200);
  assert.equal(
    (
      await f.call(
        "/api/invitations",
        "POST",
        { name: "x", email: "x@x.test", commercial_type: "ADMIN" },
        "team",
      )
    ).r.status,
    403,
  );
});
test("reset genérico, link privado só admin reautenticado, uso único e sessões revogadas", async () => {
  const f = await fixture();
  const known = await f.call(
      "/api/password/forgot",
      "POST",
      { email: "team@example.test" },
      "public",
    ),
    unknown = await f.call(
      "/api/password/forgot",
      "POST",
      { email: "missing@example.test" },
      "public",
    );
  assert.deepEqual(known.b, unknown.b);
  assert.equal(known.r.status, 200);
  assert.equal(
    (
      await f.call("/api/people/team/reset-link", "POST", {
        current_password: "wrong",
      })
    ).r.status,
    403,
  );
  const r = await f.call("/api/people/team/reset-link", "POST", {
    current_password: PASSWORD,
  });
  assert.equal(r.r.status, 200);
  const row = f.db.sql
    .prepare(
      "SELECT * FROM access_tokens WHERE user_id='team' AND revoked_at IS NULL",
    )
    .get() as any;
  assert.equal(row.expires_at - row.created_at, 1800000);
  assert.equal((await f.accept(r.b.link, PASSWORD + "new")).r.status, 200);
  assert.equal(
    (await f.call("/api/me", "GET", undefined, "team")).r.status,
    401,
  );
  assert.equal((await f.accept(r.b.link)).r.status, 400);
  assert.equal(
    (
      await f.call(
        "/api/login",
        "POST",
        { email: "team@example.test", password: PASSWORD + "new" },
        "public",
      )
    ).r.status,
    200,
  );
});
test("suspensão revoga sessão e prova, não apaga saldo/clientes e reativação preserva senha", async () => {
  const f = await fixture(),
    lot = await f.lot();
  await f.allocate(lot.id, 2);
  const grant = await f.proof(lot.plates[0]);
  assert.equal(
    (await f.call("/api/people/reseller/state", "POST", { state: "SUSPENDED" }))
      .r.status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...business, grant },
        "reseller",
      )
    ).r.status,
    401,
  );
  assert.equal(
    (
      await f.call(
        "/api/login",
        "POST",
        { email: "reseller@example.test", password: PASSWORD },
        "public",
      )
    ).r.status,
    401,
  );
  assert.equal(
    (
      f.db.sql
        .prepare("SELECT quantity FROM allocations WHERE user_id='reseller'")
        .get() as any
    ).quantity,
    2,
  );
  await f.call("/api/people/reseller/state", "POST", { state: "ACTIVE" });
  assert.equal(
    (
      await f.call(
        "/api/login",
        "POST",
        { email: "reseller@example.test", password: PASSWORD },
        "public",
      )
    ).r.status,
    200,
  );
  assert.equal(
    (await f.call("/api/people/admin/state", "POST", { state: "SUSPENDED" })).r
      .status,
    409,
  );
});
test("alocação 20, consumo 20→19, origem e rastreabilidade, idempotência e isolamento", async () => {
  const f = await fixture(),
    lot = await f.lot(25),
    key = crypto.randomUUID();
  const a = await f.allocate(lot.id, 20, "reseller", key);
  assert.equal(a.r.status, 201);
  assert.equal((await f.allocate(lot.id, 20, "reseller", key)).b.id, a.b.id);
  assert.equal((await f.activate(lot.plates[0])).r.status, 200);
  const balance = await f.call(
    "/api/allocations?user_id=other",
    "GET",
    undefined,
    "reseller",
  );
  assert.equal(balance.b[0].quantity, 20);
  assert.equal(balance.b[0].consumed, 1);
  assert.equal(balance.b[0].available, 19);
  const trace = await f.call(`/api/plates/${lot.plates[0].id}/trace`);
  assert.equal(trace.b.allocation_id, a.b.id);
  assert.equal(trace.b.activated_by, "reseller");
  assert.equal(trace.b.activation_type, "REVENDEDOR");
  assert.equal(trace.b.product, "GOOGLE");
  assert.ok(!("token" in trace.b));
  assert.equal(
    (
      await f.call(
        `/api/plates/${lot.plates[0].id}/trace`,
        "GET",
        undefined,
        "other",
      )
    ).r.status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "/api/activation/verify",
        "POST",
        { code: lot.plates[1].physical_code },
        "other",
      )
    ).r.status,
    409,
  );
  assert.equal((await f.allocate(lot.id, 6, "other")).r.status, 409);
});
test("última unidade concorrente, esgotamento e equipe não consome unidades reservadas", async () => {
  const f = await fixture(),
    lot = await f.lot(2);
  await f.allocate(lot.id, 1);
  const one = await f.proof(lot.plates[0]),
    two = await f.proof(lot.plates[1]);
  const results = await Promise.all(
    [one, two].map((grant) =>
      f.call(
        "/api/activation/complete",
        "POST",
        { ...business, grant, confirm_new: true },
        "reseller",
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.r.status).sort(), [200, 409]);
  assert.equal(
    (f.db.sql.prepare("SELECT consumed FROM allocations").get() as any)
      .consumed,
    1,
  );
  assert.equal(
    (f.db.sql.prepare("SELECT COUNT(*) n FROM establishments").get() as any).n,
    1,
  );
  const unused = f.db.sql
    .prepare("SELECT * FROM plates WHERE status<>'ACTIVE'")
    .get() as any;
  assert.equal(
    (
      await f.call(
        "/api/activation/verify",
        "POST",
        { code: unused.physical_code },
        "reseller",
      )
    ).r.status,
    409,
  );
  const separate = await f.lot(1);
  await f.allocate(separate.id, 1, "other");
  assert.equal((await f.activate(separate.plates[0], "team")).r.status, 409);
  assert.equal(
    (
      f.db.sql
        .prepare("SELECT COUNT(*) n FROM establishments WHERE owner_id='team'")
        .get() as any
    ).n,
    0,
  );
});
test("revendedor não usa outro lote/produto nem reserva manual como saldo", async () => {
  const f = await fixture(),
    a = await f.lot(),
    b = await f.lot();
  await f.allocate(a.id, 1);
  assert.equal(
    (
      await f.call(
        "/api/activation/verify",
        "POST",
        { code: b.plates[0].physical_code },
        "reseller",
      )
    ).r.status,
    409,
  );
  assert.equal(
    (
      await f.call("/api/allocations", "POST", {
        user_id: "reseller",
        batch_id: a.id,
        product: "PIX",
        quantity: 1,
        request_key: crypto.randomUUID(),
      })
    ).r.status,
    400,
  );
  assert.equal(
    (
      await f.call(`/api/plates/${a.plates[0].id}/assign`, "POST", {
        owner_id: "reseller",
      })
    ).r.status,
    400,
  );
});
test("classificação teste imutável: lote real não pode virar teste e cliente real não se mistura", async () => {
  const f = await fixture(),
    real = await f.lot(1),
    testLot = await f.lot(1, true);
  const e = await f.activate(real.plates[0], "team");
  assert.equal(e.r.status, 200);
  assert.throws(
    () =>
      f.db.sql.prepare("UPDATE batches SET is_test=1 WHERE id=?").run(real.id),
    /immutable/,
  );
  assert.equal(
    (
      await f.activate(testLot.plates[0], "team", {
        establishment_id: e.b.establishment_id,
      })
    ).r.status,
    409,
  );
  assert.equal(
    (await f.call(`/api/batches/${testLot.id}/csv?mode=production`)).r.status,
    409,
  );
});
test("exclusão segura: senha errada, confirmação, real protegido e teste ativo removido com auditoria", async () => {
  const f = await fixture(),
    real = await f.lot(1),
    l = await f.lot(1, true);
  assert.equal((await f.activate(l.plates[0], "team")).r.status, 200);
  const route = `/api/batches/${l.id}/delete-test`,
    confirm = {
      current_password: PASSWORD,
      confirmation: "EXCLUIR Lote A0410",
    };
  assert.equal(
    (await f.call(route, "POST", { ...confirm, current_password: "wrong" })).r
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(route, "POST", {
        ...confirm,
        confirmation: "EXCLUIR errado",
      })
    ).r.status,
    400,
  );
  assert.equal(
    (await f.call(`/api/batches/${real.id}/delete-test`, "POST", confirm)).r
      .status,
    409,
  );
  assert.equal((await f.call(route, "POST", confirm)).r.status, 200);
  assert.equal(
    (f.db.sql.prepare("SELECT COUNT(*) n FROM establishments").get() as any).n,
    0,
  );
  assert.equal(
    (f.db.sql.prepare("SELECT COUNT(*) n FROM plates").get() as any).n,
    1,
  );
  assert.equal(
    (
      f.db.sql
        .prepare("SELECT COUNT(*) n FROM audit_log WHERE action='test_deleted'")
        .get() as any
    ).n,
    3,
  );
});
test("dependências de alocação impedem excluir teste; arquivamento preserva saldo e QR ativo", async () => {
  const f = await fixture(),
    l = await f.lot(2, true);
  await f.allocate(l.id, 2);
  assert.equal((await f.activate(l.plates[0])).r.status, 200);
  assert.equal(
    (
      await f.call(`/api/batches/${l.id}/delete-test`, "POST", {
        current_password: PASSWORD,
        confirmation: "EXCLUIR Lote A0410",
      })
    ).r.status,
    409,
  );
  assert.equal(
    (
      await f.call(`/api/batches/${l.id}/archive`, "POST", {
        current_password: PASSWORD,
        confirmation: "ARQUIVAR Lote A0410",
      })
    ).r.status,
    200,
  );
  assert.equal(
    (await f.call("/r/" + l.plates[0].code + "-" + l.plates[0].token)).r.status,
    302,
  );
  assert.equal(
    (
      await f.call(
        "/api/activation/verify",
        "POST",
        { code: l.plates[1].physical_code },
        "reseller",
      )
    ).r.status,
    409,
  );
  assert.equal(
    (
      f.db.sql
        .prepare("SELECT quantity-consumed n FROM allocations")
        .get() as any
    ).n,
    1,
  );
});
test("dashboard, busca paginada, produtos e restrições ADMIN", async () => {
  const f = await fixture(),
    l = await f.lot();
  await f.invite();
  await f.activate(l.plates[0], "team");
  const d = await f.call("/api/dashboard");
  assert.equal(d.b.counts.active, 1);
  assert.equal(d.b.counts.invitations, 1);
  assert.equal(d.b.counts.month_activations, 1);
  assert.equal(
    (await f.call("/api/dashboard", "GET", undefined, "reseller")).r.status,
    403,
  );
  for (const q of [
    l.plates[0].physical_code,
    "team@example.test",
    "Cliente Teste",
    "Lote A0410",
  ])
    assert.ok(
      (await f.call("/api/search?q=" + encodeURIComponent(q))).b.results
        .length > 0,
    );
  assert.equal(
    (await f.call("/api/search?q=team", "GET", undefined, "team")).r.status,
    403,
  );
  const products = await f.call("/api/products");
  assert.deepEqual(
    products.b.map((p: any) => p.state),
    ["ACTIVE", "COMING_SOON", "COMING_SOON"],
  );
  for (let i = 0; i < 60; i++)
    f.db.sql
      .prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,'USER')",
      )
      .run("page" + i, "Pagination " + i, "page" + i + "@test.invalid", "test");
  const search = await f.call("/api/search?q=Pagination");
  assert.equal(search.b.results.length, 50);
  assert.equal(
    (
      await f.call(
        "/api/search?q=Pagination&after=" +
          encodeURIComponent(search.b.next_after),
      )
    ).b.results.length,
    10,
  );
});
test("migration 0003 preserva usuário/admin/hash e GOOGLE default sem histórico Wrangler", async () => {
  const db = new TestDB(false);
  db.sql.exec(readFileSync("migrations/0002_operations.sql", "utf8"));
  db.sql.exec(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES('admin','Admin','a@a.test','original-hash','ADMIN'); INSERT INTO batches(id,name,created_by) VALUES('old','Old','admin')",
  );
  db.sql.exec(readFileSync("migrations/0003_professional_users.sql", "utf8"));
  const u = db.sql.prepare("SELECT * FROM users").get() as any;
  assert.equal(u.password_hash, "original-hash");
  assert.equal(u.role, "ADMIN");
  assert.equal(u.state, "ACTIVE");
  assert.equal(u.commercial_type, "EQUIPE_GEAR");
  assert.equal(
    (db.sql.prepare("SELECT * FROM batches").get() as any).product,
    "GOOGLE",
  );
  assert.deepEqual(db.sql.prepare("PRAGMA foreign_key_check").all(), []);
});
test("Resend: HTML escapado, textos corretos, mock sucesso/falha e ausência de credenciais", async () => {
  const f = await fixture();
  const html = accessEmail(
    "<script>",
    "EQUIPE_GEAR",
    "INVITE",
    "https://test.invalid/convite/token",
  );
  assert.ok(!html.html.includes("<script>"));
  assert.match(html.subject, /fazer parte/);
  assert.match(
    accessEmail("João", "REVENDEDOR", "INVITE", "https://test.invalid").subject,
    /Revendedor/,
  );
  assert.equal(
    await sendAccessEmail(
      f.env,
      "a@b.test",
      "Name",
      "EQUIPE_GEAR",
      "INVITE",
      "https://test.invalid",
      "id",
    ),
    "MANUAL",
  );
  const original = globalThis.fetch;
  try {
    f.env.RESEND_API_KEY = "mock-key";
    f.env.EMAIL_FROM = "Gear Go <mock@example.test>";
    f.env.EMAIL_REPLY_TO = "reply@example.test";
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://api.resend.com/emails");
      assert.equal((init!.headers as any).Authorization, "Bearer mock-key");
      assert.equal(
        JSON.parse(init!.body as string).reply_to,
        "reply@example.test",
      );
      return Response.json({ id: "provider-id" });
    };
    assert.equal(
      await sendAccessEmail(
        f.env,
        "a@b.test",
        "Name",
        "EQUIPE_GEAR",
        "INVITE",
        "https://test.invalid",
        "id",
      ),
      "SENT",
    );
    globalThis.fetch = async () =>
      new Response("sensitive error", { status: 500 });
    assert.equal(
      await sendAccessEmail(
        f.env,
        "a@b.test",
        "Name",
        "EQUIPE_GEAR",
        "RESET",
        "https://test.invalid",
        "id",
      ),
      "FAILED",
    );
    globalThis.fetch = async () => {
      throw new Error("Network");
    };
    assert.equal(
      await sendAccessEmail(
        f.env,
        "a@b.test",
        "Name",
        "EQUIPE_GEAR",
        "RESET",
        "https://test.invalid",
        "id",
      ),
      "FAILED",
    );
  } finally {
    globalThis.fetch = original;
  }
});
