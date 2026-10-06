import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/index";
import { digest } from "../src/security";
import {
  lotPrefix,
  physicalCode,
  normalizeCode,
  PHYSICAL_ALPHABET,
} from "../src/physical-code";
import { TestDB } from "./db";

export async function fixture() {
  const db = new TestDB(),
    cookies: Record<string, string> = {};
  for (const [id, role] of [
    ["admin", "ADMIN"],
    ["seller-a", "USER"],
    ["seller-b", "USER"],
  ]) {
    db.sql
      .prepare(
        "INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES(?,?,?,?,?,0)",
      )
      .run(id, id, id + "@test.invalid", "unchanged-fixture-hash", role);
    const token =
      id === "admin"
        ? "a".repeat(64)
        : id === "seller-a"
          ? "b".repeat(64)
          : "c".repeat(64);
    cookies[id] = "gg_session=" + token;
    db.sql
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(await digest(token), id, Date.now() + 3600000, Date.now());
  }
  const env = {
    DB: db,
    PASSWORD_PEPPER: "existing-pepper-".repeat(4),
    ASSETS: {
      fetch: async (req: Request) =>
        new Response(
          readFileSync(
            new URL(
              "../public" +
                (new URL(req.url).pathname === "/"
                  ? "/index.html"
                  : new URL(req.url).pathname),
              import.meta.url,
            ),
            "utf8",
          ),
        ),
    },
  } as unknown as Env;
  const call = async (
    path: string,
    method = "GET",
    data?: unknown,
    user = "admin",
  ) => {
    if (/^\/(plates|batches|users)\//.test(path)) path = "/api" + path;
    const response = await worker.fetch(
      new Request("https://test.invalid" + path, {
        method,
        headers: {
          Origin: "https://test.invalid",
          "Content-Type": "application/json",
          Cookie: cookies[user] || "",
          "cf-connecting-ip": user,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
    );
    const raw = await response.text();
    let b: any;
    try {
      b = JSON.parse(raw);
    } catch {
      b = raw;
    }
    return { r: response, b };
  };
  const lot = async (quantity = 3) => {
    const created = await call("/api/batches", "POST", {
      name: "Teste A3009",
      quantity,
      request_key: crypto.randomUUID(),
    });
    assert.equal(created.r.status, 201, JSON.stringify(created.b));
    let r;
    do {
      r = await call(`/api/batches/${created.b.id}/generate`, "POST", {});
      assert.equal(r.r.status, 200, JSON.stringify(r.b));
    } while (!r.b.complete);
    return {
      id: created.b.id,
      plates: db.sql
        .prepare("SELECT * FROM plates WHERE batch_id=? ORDER BY id")
        .all(created.b.id) as any[],
    };
  };
  const verify = async (p: any, user = "seller-a", qr?: string) =>
    call(
      "/api/activation/verify",
      "POST",
      { code: p.physical_code, ...(qr ? { qr } : {}) },
      user,
    );
  const data = {
    name: "Cliente de teste",
    city: "Porto Alegre",
    segment: "Barbearia",
    responsible: "Márcio",
    phone: "51999991111",
    address: "Rua de teste, 10",
    google_url:
      "https://search.google.com/local/writereview?placeid=real-format",
  };
  const activate = async (p: any, user = "seller-a", extra = {}) => {
    const grant = await verify(p, user);
    assert.equal(grant.r.status, 200);
    return call(
      "/api/activation/complete",
      "POST",
      { ...data, ...extra, grant: grant.b.grant },
      user,
    );
  };
  return { db, env, call, lot, verify, activate, data, cookies };
}

test("código físico aceita separadores de digitação sem corrigir letras erradas", () => {
  for (const code of ["A3009URRW", "a3009-urrw", " A3009 – URRW "])
    assert.equal(normalizeCode(code), "A3009-URRW");
  assert.equal(normalizeCode("A3009-URRK"), "A3009-URRK");
  assert.equal(normalizeCode("A3009/URRW"), "");
  assert.equal(normalizeCode(null), "");
});

test("ADMIN vende via QR e código sem hífen; vínculo ocorre somente ao concluir", async () => {
  const f = await fixture();
  const { plates: [p] } = await f.lot(1);
  const verified = await f.call("/api/activation/verify", "POST", {
    code: p.physical_code.replace("-", "").toLowerCase(),
    qr: `${p.code}-${p.token}`,
  });
  assert.equal(verified.r.status, 200, JSON.stringify(verified.b));
  assert.equal(f.db.sql.prepare("SELECT owner_id FROM plates WHERE id=?").get(p.id)?.owner_id, null);
  const completed = await f.call("/api/activation/complete", "POST", {
    ...f.data, grant: verified.b.grant,
  });
  assert.equal(completed.r.status, 200, JSON.stringify(completed.b));
  const plate = f.db.sql.prepare("SELECT owner_id,status FROM plates WHERE id=?").get(p.id);
  assert.ok(plate);
  assert.equal(plate.owner_id, "admin");
  assert.equal(plate.status, "ACTIVE");
  const redirect = await f.call(`/r/${p.code}-${p.token}`);
  assert.equal(redirect.r.status, 302);
  assert.equal(redirect.r.headers.get("location"), f.data.google_url);
});

test("lote grande de 1000: retomável, sem vendedor, códigos únicos, contadores exatos", async () => {
  const f = await fixture(),
    key = crypto.randomUUID(),
    body = { name: "Lote de 1000", quantity: 1000, request_key: key };
  const first = await f.call("/api/batches", "POST", body),
    same = await f.call("/api/batches", "POST", body);
  assert.equal(first.b.id, same.b.id);
  assert.equal(
    (await f.call(`/api/batches/${first.b.id}/print-data?mode=test`)).r.status,
    409,
  );
  for (let i = 1; i <= 5; i++) {
    const r = await f.call(`/api/batches/${first.b.id}/generate`, "POST", {});
    assert.equal(r.r.status, 200);
    assert.equal(r.b.quantity, i * 200);
    assert.equal(r.b.complete, i === 5);
  }
  await f.call(`/api/batches/${first.b.id}/generate`, "POST", {});
  const rows = f.db.sql.prepare("SELECT * FROM plates").all();
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((p) => p.physical_code)).size, 1000);
  assert.equal(new Set(rows.map((p) => p.token)).size, 1000);
  assert.ok(
    rows.every((p) => p.owner_id === null && p.status === "UNASSIGNED"),
  );
  const b = (await f.call("/api/batches")).b[0];
  assert.deepEqual(
    [b.quantity, b.active, b.inactive, b.blocked],
    [1000, 0, 1000, 0],
  );
  assert.equal(
    (await f.call("/api/plates", "GET", undefined, "seller-a")).b.plates.length,
    0,
  );
  assert.throws(() =>
    f.db.sql
      .prepare(
        "INSERT INTO plates(token,batch_id,physical_code,status) VALUES('another',?,?,'UNASSIGNED')",
      )
      .run(first.b.id, rows[0].physical_code),
  );
});
test("código A+dia+mês considera São Paulo e evita O/0/I/1", () => {
  assert.equal(lotPrefix(new Date("2026-10-01T01:00:00Z")), "A3009");
  assert.equal(lotPrefix(new Date("2026-10-01T04:00:00Z")), "A0110");
  assert.ok(!/[O01I]/.test(PHYSICAL_ALPHABET));
  assert.match(
    physicalCode("A3009"),
    /^A3009-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
  );
});
test("colisão de código no banco regenera automaticamente sem duplicar lote", async () => {
  const f = await fixture();
  const created = await f.call("/api/batches", "POST", {
    name: "Colisão",
    quantity: 10,
    request_key: crypto.randomUUID(),
  });
  const original = f.db.batch.bind(f.db);
  let tries = 0;
  f.db.batch = async (stmts) => {
    if (tries++ === 0)
      throw new Error("UNIQUE constraint failed: plates.physical_code");
    return original(stmts);
  };
  const result = await f.call(
    `/api/batches/${created.b.id}/generate`,
    "POST",
    {},
  );
  assert.equal(result.r.status, 200);
  assert.equal(tries, 2);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM plates").get()!.n, 10);
});
test("QR inativo encaminha login à placa sem expor código físico", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  const r = await f.call(
    `/r/${p.code}-${p.token}`,
    "GET",
    undefined,
    "anonymous",
  );
  assert.equal(r.r.status, 302);
  assert.equal(r.r.headers.get("location"), `/?activate=${p.code}-${p.token}`);
  assert.ok(!r.r.headers.get("location")!.includes(p.physical_code));
});
test("ativação por QR exige correspondência exata entre QR e código", async () => {
  const f = await fixture(),
    {
      plates: [p, other],
    } = await f.lot(2);
  const wrong = await f.verify(p, "seller-a", `${other.code}-${other.token}`);
  assert.equal(wrong.r.status, 404);
  const correct = await f.verify(p, "seller-a", `${p.code}-${p.token}`);
  assert.equal(correct.r.status, 200);
  const result = await f.call(
    "/api/activation/complete",
    "POST",
    { ...f.data, grant: correct.b.grant },
    "seller-a",
  );
  assert.equal(result.r.status, 200);
  const current = f.db.sql
    .prepare("SELECT * FROM plates WHERE id=?")
    .get(p.id)!;
  assert.equal(current.owner_id, "seller-a");
  assert.equal(current.status, "ACTIVE");
  assert.ok(current.establishment_id);
});
test("código errado, placa alheia e placa bloqueada têm resposta indistinguível", async () => {
  const f = await fixture(),
    {
      plates: [p, b],
    } = await f.lot(2);
  await f.call(`/plates/${p.id}/assign`, "POST", { owner_id: "seller-b" });
  await f.call(`/plates/${b.id}/block`, "POST", { blocked: true });
  const responses = await Promise.all([
    f.verify({ physical_code: "A3009-AAAA" }),
    f.verify(p),
    f.verify(b),
    f.verify({ physical_code: "BAD" }),
  ]);
  responses.forEach((r) => {
    assert.equal(r.r.status, 404);
    assert.deepEqual(r.b, responses[0].b);
  });
});
test("limite de tentativas impede enumeração de códigos", async () => {
  const f = await fixture();
  for (let i = 0; i < 13; i++) {
    const r = await f.verify({ physical_code: "A3009-AAAA" });
    assert.equal(r.r.status, i < 12 ? 404 : 429);
  }
});
test("abandonar formulário não cria estoque, vínculo nem estabelecimento", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  assert.equal((await f.verify(p)).r.status, 200);
  const after = f.db.sql.prepare("SELECT * FROM plates WHERE id=?").get(p.id)!;
  assert.equal(after.owner_id, null);
  assert.equal(after.establishment_id, null);
  assert.equal(after.status, "UNASSIGNED");
  assert.equal(
    f.db.sql.prepare("SELECT COUNT(*) n FROM establishments").get()!.n,
    0,
  );
});
test("ativação pelo painel compartilha prova e regra de posse, sem endpoint antigo", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  assert.equal((await f.activate(p)).r.status, 200);
  assert.equal((await f.verify(p, "seller-b")).r.status, 404);
  assert.equal(
    (await f.call(`/plates/${p.id}/activate`, "POST", f.data, "seller-b")).r
      .status,
    410,
  );
});
test("prova de ativação é vinculada ao usuário e sessão, expira e só pode ser usada uma vez", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  const g = (await f.verify(p)).b.grant;
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...f.data, grant: g },
        "seller-b",
      )
    ).r.status,
    404,
  );
  f.db.sql
    .prepare("UPDATE activation_grants SET expires_at=?")
    .run(Date.now() - 1);
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...f.data, grant: g },
        "seller-a",
      )
    ).r.status,
    404,
  );
  const good = (await f.verify(p)).b.grant;
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...f.data, grant: good },
        "seller-a",
      )
    ).r.status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...f.data, grant: good },
        "seller-a",
      )
    ).r.status,
    404,
  );
});
test("duas ativações concorrentes: somente uma ganha, sem estabelecimento fantasma", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1),
    a = (await f.verify(p, "seller-a")).b.grant,
    b = (await f.verify(p, "seller-b")).b.grant;
  const results = await Promise.all([
    f.call(
      "/api/activation/complete",
      "POST",
      { ...f.data, grant: a },
      "seller-a",
    ),
    f.call(
      "/api/activation/complete",
      "POST",
      { ...f.data, name: "Outro cliente", grant: b },
      "seller-b",
    ),
  ]);
  assert.equal(results.filter((r) => r.r.status === 200).length, 1);
  assert.ok(results.every((r) => [200, 404, 409].includes(r.r.status)));
  assert.equal(
    f.db.sql.prepare("SELECT COUNT(*) n FROM establishments").get()!.n,
    1,
  );
  assert.equal(
    f.db.sql
      .prepare("SELECT COUNT(*) n FROM audit_log WHERE action='activated'")
      .get()!.n,
    1,
  );
});
test("atribuição excepcional não aparece como estoque e exige vendedor correto", async () => {
  const f = await fixture(),
    {
      id,
      plates: [p],
    } = await f.lot(1);
  await f.call(`/plates/${p.id}/assign`, "POST", { owner_id: "seller-a" });
  assert.equal(
    (await f.call("/api/plates", "GET", undefined, "seller-a")).b.plates.length,
    0,
  );
  assert.equal(
    (await f.call("/api/establishments", "GET", undefined, "seller-a")).b
      .length,
    0,
  );
  assert.equal((await f.verify(p, "seller-b")).r.status, 404);
  const b = (await f.call("/api/batches")).b.find((b: any) => b.id === id);
  assert.equal(b.inactive, 1);
  assert.equal((await f.activate(p)).r.status, 200);
  assert.equal(
    (await f.call("/api/plates", "GET", undefined, "seller-a")).b.plates.length,
    1,
  );
});
test("mudança administrativa durante formulário invalida a prova", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  const g = (await f.verify(p)).b.grant;
  await f.call(`/plates/${p.id}/assign`, "POST", { owner_id: "seller-b" });
  assert.equal(
    (
      await f.call(
        "/api/activation/complete",
        "POST",
        { ...f.data, grant: g },
        "seller-a",
      )
    ).r.status,
    404,
  );
  assert.equal(
    f.db.sql.prepare("SELECT COUNT(*) n FROM establishments").get()!.n,
    0,
  );
});
test("várias placas no cliente e edição de destino atualiza todas", async () => {
  const f = await fixture(),
    {
      plates: [a, b],
    } = await f.lot(2);
  const r = await f.activate(a),
    eid = r.b.establishment_id;
  assert.equal(
    (await f.activate(b, "seller-a", { establishment_id: eid })).r.status,
    200,
  );
  const e = (
    await f.call("/api/establishments/" + eid, "GET", undefined, "seller-a")
  ).b;
  assert.equal(e.plates.length, 2);
  const changed = await f.call(
    "/api/establishments/" + eid,
    "PATCH",
    { ...e, google_url: "https://www.google.com/maps?cid=456" },
    "seller-a",
  );
  assert.equal(changed.r.status, 200);
  for (const p of [a, b])
    assert.equal(
      (await f.call(`/r/${p.code}-${p.token}`)).r.headers.get("location"),
      "https://www.google.com/maps?cid=456",
    );
});
test("bloquear/desbloquear preserva cliente, token, destino e histórico", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  await f.activate(p);
  const before = f.db.sql.prepare("SELECT * FROM plates WHERE id=?").get(p.id)!;
  assert.equal(
    (await f.call(`/plates/${p.id}/block`, "POST", { blocked: true })).r.status,
    200,
  );
  let qr = await f.call(`/r/${p.code}-${p.token}`);
  assert.equal(qr.r.status, 200);
  assert.equal(qr.r.headers.get("location"), null);
  assert.match(qr.b, /temporariamente indisponível/);
  assert.ok(!/financeir|pagamento|dívida/.test(qr.b));
  assert.equal(qr.r.headers.get("cache-control"), "no-store");
  await f.call(`/plates/${p.id}/block`, "POST", { blocked: false });
  qr = await f.call(`/r/${p.code}-${p.token}`);
  assert.equal(qr.r.status, 302);
  const after = f.db.sql.prepare("SELECT * FROM plates WHERE id=?").get(p.id)!;
  assert.deepEqual(after, before);
  assert.equal(
    (await f.call("/api/audit?category=blocks")).b.entries.length,
    2,
  );
});
test("bloqueio em massa por vendedor isolado, reversível e auditado por placa", async () => {
  const f = await fixture(),
    {
      plates: [a, b, c],
    } = await f.lot(3);
  await f.activate(a);
  await f.call(`/plates/${b.id}/assign`, "POST", { owner_id: "seller-a" });
  await f.activate(c, "seller-b");
  assert.equal(
    (await f.call("/api/users/seller-a/block", "POST", { blocked: true })).b
      .changed,
    2,
  );
  assert.equal((await f.call(`/r/${c.code}-${c.token}`)).r.status, 302);
  assert.equal((await f.verify(b)).r.status, 404);
  assert.equal(
    (await f.call("/api/users/seller-a/block", "POST", { blocked: false })).b
      .changed,
    2,
  );
  assert.equal(
    (await f.call("/api/audit?category=blocks")).b.entries.length,
    4,
  );
});
test("contadores do lote formam partição: ativa/inativa/bloqueada", async () => {
  const f = await fixture(),
    {
      plates: [a, b, c, d],
    } = await f.lot(4);
  await f.activate(a);
  await f.activate(b, "seller-b");
  await f.call(`/plates/${b.id}/block`, "POST", { blocked: true });
  await f.call(`/plates/${c.id}/block`, "POST", { blocked: true });
  let batch = (await f.call("/api/batches")).b[0];
  assert.deepEqual(
    [batch.quantity, batch.active, batch.inactive, batch.blocked],
    [4, 1, 1, 2],
  );
  await f.call(`/plates/${c.id}/block`, "POST", { blocked: false });
  batch = (await f.call("/api/batches")).b[0];
  assert.equal(batch.inactive, 2);
});
test("isolamento de vendedor e visibilidade administrativa com pesquisa/agrupamento", async () => {
  const f = await fixture(),
    {
      plates: [a, b],
    } = await f.lot(2);
  const ea = (await f.activate(a)).b.establishment_id,
    eb = (await f.activate(b, "seller-b")).b.establishment_id;
  assert.equal(
    (await f.call("/api/establishments/" + eb, "GET", undefined, "seller-a")).r
      .status,
    404,
  );
  assert.equal(
    (await f.call("/api/establishments", "GET", undefined, "seller-a")).b
      .length,
    1,
  );
  assert.equal((await f.call("/api/establishments")).b.length, 2);
  assert.equal((await f.call("/api/plate-groups")).b.length, 2);
  assert.equal(
    (await f.call("/api/plates?q=" + a.physical_code)).b.plates.length,
    1,
  );
  for (const path of [
    "/api/batches",
    "/api/plate-groups",
    "/api/audit",
    "/api/print-config",
  ])
    assert.equal(
      (await f.call(path, "GET", undefined, "seller-a")).r.status,
      403,
    );
  assert.equal(
    (
      await f.call(
        `/plates/${a.id}/block`,
        "POST",
        { blocked: true },
        "seller-a",
      )
    ).r.status,
    403,
  );
});
test("histórico filtrável preserva autoria, snapshots e ordem cronológica", async () => {
  const f = await fixture(),
    {
      plates: [p],
    } = await f.lot(1);
  await f.activate(p);
  const activations = (await f.call("/api/audit?category=activations")).b
    .entries;
  assert.equal(activations.length, 2);
  assert.ok(activations.every((e: any) => e.actor_id === "seller-a"));
  assert.ok(activations[0].id > activations[1].id);
  const snapshot = f.db.sql
    .prepare("SELECT initial_snapshot FROM establishments")
    .get()!.initial_snapshot as string;
  assert.equal(JSON.parse(snapshot).phone, f.data.phone);
  assert.throws(() => f.db.sql.exec("UPDATE audit_log SET action='tamper'"));
});
test("exportação PDF paginada de 1000 placas e origem configurável", async () => {
  const f = await fixture(),
    { id } = await f.lot(1000);
  let after = "",
    rows: any[] = [];
  do {
    const r = await f.call(
      `/api/batches/${id}/print-data?mode=test&after=${after}`,
    );
    assert.equal(r.r.status, 200);
    rows.push(...r.b.plates);
    after = r.b.next_after ? String(r.b.next_after) : "";
  } while (after);
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((r) => r.url)).size, 1000);
  assert.ok(
    rows.every(
      (r) =>
        r.code.startsWith("A") && r.url.startsWith("https://test.invalid/r/"),
    ),
  );
  assert.equal((await f.call(`/api/batches/${id}/print-data`)).r.status, 400);
  assert.equal(
    (await f.call(`/api/batches/${id}/csv?mode=production`)).r.status,
    409,
  );
  f.env.PUBLIC_BASE_URL = "https://qr.example.com";
  f.env.QR_PRODUCTION_READY = "true";
  assert.equal(
    (
      await f.call(`/api/batches/${id}/confirm-production`, "POST", {
        origin: "https://qr.example.com",
      })
    ).r.status,
    200,
  );
  assert.match(
    (await f.call(`/api/batches/${id}/csv?mode=production`)).b,
    /https:\/\/qr.example.com\/r\//,
  );
  f.env.PUBLIC_BASE_URL = "https://new.example.com";
  assert.equal(
    (
      await f.call(`/api/batches/${id}/confirm-production`, "POST", {
        origin: f.env.PUBLIC_BASE_URL,
      })
    ).r.status,
    409,
  );
});
test("produção não aceita workers.dev mesmo com flag ligada", async () => {
  const f = await fixture();
  f.env.PUBLIC_BASE_URL = "https://placa-nfc.test.workers.dev";
  f.env.QR_PRODUCTION_READY = "true";
  assert.equal((await f.call("/api/print-config")).b.production_ready, false);
});
test("migração manual preserva linhas antigas e não depende de d1_migrations", async () => {
  const db = new TestDB(false);
  db.sql.exec(
    "INSERT INTO users VALUES('u','Admin','u@test.invalid','original-password-hash','ADMIN',0,'original-date'); INSERT INTO batches(id,name,created_by) VALUES('b','Legado','u'); INSERT INTO plates(token,batch_id,status) VALUES('original-token','b','UNASSIGNED'); INSERT INTO sessions VALUES('hash','u',9999999999999,1); INSERT INTO audit_log(actor_id,entity_type,entity_id,action,new_data) VALUES('u','batch','b','created','{}');",
  );
  const before = db.sql.prepare("SELECT * FROM plates").get()!;
  db.sql.exec(
    readFileSync(
      new URL("../migrations/0002_operations.sql", import.meta.url),
      "utf8",
    ),
  );
  const after = db.sql.prepare("SELECT * FROM plates").get()!;
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v);
  assert.equal(after.blocked, 0);
  assert.equal(after.physical_code, null);
  assert.equal(
    db.sql.prepare("SELECT password_hash FROM users").get()!.password_hash,
    "original-password-hash",
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM sessions").get()!.n, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM audit_log").get()!.n, 1);
  assert.throws(() => db.sql.exec("SELECT * FROM d1_migrations"));
});
test("códigos em lote legado preservam tokens e podem ser retomados", async () => {
  const f = await fixture();
  f.db.sql.exec(
    "INSERT INTO batches(id,name,created_by) VALUES('legacy','Legado','admin'); INSERT INTO plates(token,batch_id,status) VALUES('legacy-token','legacy','UNASSIGNED');",
  );
  const r = await f.call("/api/batches/legacy/generate", "POST", {});
  assert.equal(r.r.status, 200);
  const p = f.db.sql
    .prepare("SELECT * FROM plates WHERE token='legacy-token'")
    .get()!;
  assert.match(p.physical_code as string, /^A\d{4}-[A-Z2-9]{4}$/);
  assert.equal(p.token, "legacy-token");
  assert.throws(() =>
    f.db.sql.exec("UPDATE plates SET physical_code='A3009-ZZZZ'"),
  );
});
