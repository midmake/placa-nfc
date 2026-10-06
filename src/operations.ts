import {
  type Env,
  type User,
  type Row,
  admin,
  audit,
  baseURL,
  body,
  cookieToken,
  establishmentInput,
  fail,
  getEst,
  guard,
  json,
  mutate,
  text,
} from "./core";
import { digest, randomToken } from "./security";
import {
  lotPrefix,
  physicalCode,
  normalizeCode,
  validPhysicalCode,
  validQrKey,
} from "./physical-code";
import { parseGoogleURL } from "./google-url";
import { allocationFor } from "./professional";

const ACTIVATION_ERROR =
  "Não foi possível validar esta placa. Confira o código ou fale com o administrador.";
const GENERATION_CHUNK = 200;
const qrURL = (origin: string, p: Row) => `${origin}/r/${p.code}-${p.token}`;
function unavailable() {
  return new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gear Go Digital</title><link rel="stylesheet" href="/style.css"><main class="panel narrow"><img src="/logo.svg" width="64" height="64" alt="Gear Go Digital"><h1>Placa indisponível</h1><p>Esta placa está temporariamente indisponível. Entre em contato com o responsável pelo serviço.</p></main></html>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
export async function redirectPlate(req: Request, env: Env) {
  const qr = new URL(req.url).pathname.slice(3);
  if (!validQrKey(qr)) fail(404, "Placa não encontrada.");
  const cut = qr.lastIndexOf("-");
  const p = await env.DB.prepare(
    "SELECT p.status,p.blocked,e.google_url FROM plates p LEFT JOIN establishments e ON e.id=p.establishment_id WHERE p.token=? AND p.code=?",
  )
    .bind(qr.slice(cut + 1), qr.slice(0, cut))
    .first<Row>();
  if (!p) fail(404, "Placa não encontrada.");
  if (p.blocked) return unavailable();
  if (p.status !== "ACTIVE")
    return new Response(null, {
      status: 302,
      headers: { Location: "/?activate=" + encodeURIComponent(qr) },
    });
  try {
    parseGoogleURL(p.google_url);
  } catch {
    return unavailable();
  }
  return new Response(null, {
    status: 302,
    headers: { Location: p.google_url },
  });
}
async function activationLimit(req: Request, env: Env, user: User) {
  const now = Date.now();
  const keys = [
    { key: await digest("activation-user:" + user.id), max: 12 },
    {
      key: await digest(
        "activation-ip:" + (req.headers.get("cf-connecting-ip") || "local"),
      ),
      max: 50,
    },
  ];
  const rows = await env.DB.batch(
    keys.map((k) =>
      env.DB.prepare(
        "INSERT INTO login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts",
      ).bind(k.key, now + 900000, now, now, now + 900000),
    ),
  );
  if (rows.some((r, i) => Number((r.results[0] as Row).attempts) > keys[i].max))
    fail(429, "Limite de tentativas de ativação. Aguarde 15 minutos.");
}
async function verifiedGrant(
  req: Request,
  env: Env,
  user: User,
  token: unknown,
) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    fail(404, ACTIVATION_ERROR);
  const hash = await digest(token),
    session = await digest(cookieToken(req)!);
  const p = await env.DB.prepare(
    "SELECT p.*,g.token_hash AS grant_hash,g.session_hash FROM activation_grants g JOIN plates p ON p.id=g.plate_id WHERE g.token_hash=? AND g.user_id=? AND g.session_hash=? AND g.expires_at>? AND p.blocked=0 AND p.status<>'ACTIVE' AND (p.owner_id IS NULL OR p.owner_id=?)",
  )
    .bind(hash, user.id, session, Date.now(), user.id)
    .first<Row>();
  if (!p) fail(404, ACTIVATION_ERROR);
  return p;
}
async function finishActivation(req: Request, env: Env, user: User, b: Row) {
  const db = env.DB,
    p = await verifiedGrant(req, env, user, b.grant);
  const { batch, allocation } = await allocationFor(db, user, p);
  let eid: string;
  const stmts: D1PreparedStatement[] = [];
  if (b.establishment_id) {
    const e = await getEst(
      db,
      text(b.establishment_id, "Estabelecimento"),
      user,
    );
    if (e.owner_id !== user.id) fail(404, ACTIVATION_ERROR);
    if (e.archived_at || e.is_test !== batch.is_test)
      fail(
        409,
        "Escolha um cliente não arquivado da mesma finalidade: teste ou real.",
      );
    eid = e.id;
  } else {
    const input = await establishmentInput(b, env);
    const matches = (
      await db
        .prepare(
          "SELECT id,name,city,phone FROM establishments WHERE owner_id=? AND archived_at IS NULL AND is_test=? AND (phone_normalized=? OR google_url=? OR (name_key=? AND city_key=?)) LIMIT 20",
        )
        .bind(
          user.id,
          batch.is_test,
          input.phone_normalized,
          input.google_url,
          input.name_key,
          input.city_key,
        )
        .all()
    ).results;
    if (matches.length && b.confirm_new !== true)
      return json(
        {
          error:
            "Encontramos um estabelecimento já cadastrado. Deseja vincular esta placa a ele?",
          matches,
        },
        409,
      );
    eid = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          "INSERT INTO establishments(id,owner_id,name,city,segment,responsible,phone,phone_normalized,google_url,name_key,city_key,initial_snapshot,created_by,address,is_test) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          eid,
          user.id,
          input.name,
          input.city,
          input.segment,
          input.responsible,
          input.phone,
          input.phone_normalized,
          input.google_url,
          input.name_key,
          input.city_key,
          JSON.stringify(input),
          user.id,
          input.address,
          batch.is_test,
        ),
      audit(db, user, "establishment", eid, "created", null, input),
    );
  }
  if (allocation)
    stmts.push(
      db
        .prepare(
          "UPDATE allocations SET consumed=consumed+1 WHERE id=? AND user_id=? AND batch_id=? AND consumed<quantity",
        )
        .bind(allocation.id, user.id, p.batch_id),
      guard(db),
      audit(db, user, "allocation", allocation.id, "unit_consumed", null, {
        plate_id: p.id,
        user_id: user.id,
        batch_id: p.batch_id,
      }),
    );
  // Delete consumes the one-use proof inside the SAME transaction as the claim.
  stmts.push(
    db
      .prepare(
        "DELETE FROM activation_grants WHERE token_hash=? AND session_hash=? AND expires_at>?",
      )
      .bind(p.grant_hash, p.session_hash, Date.now()),
    guard(db),
    db
      .prepare(
        "UPDATE plates SET owner_id=?,establishment_id=?,activated_by=?,activation_type=?,allocation_id=?,status='ACTIVE',activated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND blocked=0 AND status<>'ACTIVE' AND owner_id IS ? AND (owner_id IS NULL OR owner_id=?)",
      )
      .bind(
        user.id,
        eid,
        user.id,
        user.commercial_type || "EQUIPE_GEAR",
        allocation?.id || null,
        p.id,
        p.owner_id,
        user.id,
      ),
    guard(db),
    audit(
      db,
      user,
      "plate",
      String(p.id),
      "activated",
      { owner_id: p.owner_id, status: p.status, establishment_id: null },
      {
        code: p.physical_code,
        owner_id: user.id,
        status: "ACTIVE",
        establishment_id: eid,
        commercial_type: user.commercial_type || "EQUIPE_GEAR",
        allocation_id: allocation?.id || null,
        product: batch.product,
        is_test: !!batch.is_test,
      },
    ),
  );
  if (!p.owner_id)
    stmts.push(
      audit(
        db,
        user,
        "plate",
        String(p.id),
        "assigned_on_activation",
        { owner_id: null },
        { owner_id: user.id },
      ),
    );
  await mutate(db, stmts);
  return json({ ok: true, establishment_id: eid });
}
async function batchById(db: D1Database, id: string) {
  const b = await db
    .prepare(
      "SELECT b.*,(SELECT COUNT(*) FROM plates p WHERE p.batch_id=b.id) AS quantity,(SELECT COUNT(*) FROM plates p WHERE p.batch_id=b.id AND p.physical_code IS NULL) AS pending_codes FROM batches b WHERE b.id=?",
    )
    .bind(id)
    .first<Row>();
  if (!b) fail(404, "Lote não encontrado.");
  if (b.archived_at)
    fail(
      409,
      "Lote arquivado. Seus QRs ativos e histórico permanecem preservados.",
    );
  return b;
}
async function generateStep(env: Env, user: User, id: string) {
  const db = env.DB;
  for (let attempt = 0; attempt < 8; attempt++) {
    const b = await batchById(db, id);
    const prefix = b.physical_prefix || lotPrefix(new Date(b.created_at));
    const missing = (
      await db
        .prepare(
          "SELECT id FROM plates WHERE batch_id=? AND physical_code IS NULL ORDER BY id LIMIT ?",
        )
        .bind(id, GENERATION_CHUNK)
        .all<Row>()
    ).results;
    const needed =
      b.generation_state === "GENERATING"
        ? Math.max(0, b.target_quantity - b.quantity)
        : 0;
    if (!needed && !missing.length)
      return json({
        id,
        quantity: b.quantity,
        target: b.target_quantity || b.quantity,
        complete: true,
      });
    const count = Math.min(GENERATION_CHUNK, needed);
    const seen = new Set<string>();
    const unique = () => {
      for (let i = 0; i < 100; i++) {
        const c = physicalCode(prefix);
        if (!seen.has(c)) {
          seen.add(c);
          return c;
        }
      }
      throw new Error("Random generator exhausted");
    };
    const created = Array.from({ length: count }, () => ({
      token: randomToken(24),
      physical_code: unique(),
    }));
    const fill = missing.map((p) => ({ id: p.id, physical_code: unique() }));
    const complete =
      b.quantity + count >= b.target_quantity &&
      b.pending_codes === fill.length;
    const stmts = [
      db
        .prepare(
          "INSERT INTO mutation_guard(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM plates WHERE batch_id=?)=? THEN 1 ELSE 0 END",
        )
        .bind(id, b.quantity),
    ];
    if (fill.length)
      stmts.push(
        db
          .prepare(
            "UPDATE plates SET physical_code=(SELECT json_extract(j.value,'$.physical_code') FROM json_each(?) j WHERE json_extract(j.value,'$.id')=plates.id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND physical_code IS NULL",
          )
          .bind(JSON.stringify(fill), JSON.stringify(fill)),
        guard(db, fill.length),
      );
    if (count)
      stmts.push(
        db
          .prepare(
            "INSERT INTO plates(token,batch_id,physical_code,status) SELECT json_extract(value,'$.token'),?,json_extract(value,'$.physical_code'),'UNASSIGNED' FROM json_each(?)",
          )
          .bind(id, JSON.stringify(created)),
      );
    stmts.push(
      db
        .prepare(
          "UPDATE batches SET physical_prefix=?,generation_state=? WHERE id=?",
        )
        .bind(prefix, complete ? "READY" : "GENERATING", id),
      audit(
        db,
        user,
        "batch",
        id,
        fill.length ? "physical_codes_generated" : "generation_progress",
        { quantity: b.quantity },
        {
          quantity: b.quantity + count,
          physical_codes_added: fill.length,
          complete,
        },
      ),
    );
    try {
      await db.batch([...stmts, db.prepare("DELETE FROM mutation_guard")]);
      return json({
        id,
        quantity: b.quantity + count,
        target: b.target_quantity || b.quantity,
        complete,
      });
    } catch (e) {
      if (
        String(e).includes("UNIQUE constraint") ||
        String(e).includes("CHECK constraint")
      )
        continue;
      throw e;
    }
  }
  fail(
    409,
    "Geração ocupada. Clique em continuar para retomar sem duplicar placas.",
  );
}
function definitiveOrigin(req: Request, env: Env) {
  if (env.QR_PRODUCTION_READY !== "true" || !env.PUBLIC_BASE_URL)
    fail(
      409,
      "Defina PUBLIC_BASE_URL definitivo e QR_PRODUCTION_READY=true antes da produção. Use o modo teste por enquanto.",
    );
  const origin = baseURL(req, env),
    u = new URL(origin);
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".workers.dev") ||
    u.hostname.endsWith(".pages.dev") ||
    /^[\d.]+$/.test(u.hostname)
  )
    fail(409, "A geração de produção exige um domínio HTTPS definitivo.");
  return origin;
}
async function exportInfo(req: Request, env: Env, id: string) {
  const url = new URL(req.url),
    b = await batchById(env.DB, id),
    mode = url.searchParams.get("mode");
  if (b.generation_state !== "READY" || b.pending_codes)
    fail(
      409,
      "Conclua a geração do lote e dos códigos físicos antes de exportar.",
    );
  if (mode !== "test" && mode !== "production")
    fail(400, "Selecione explicitamente teste ou produção.");
  let origin = baseURL(req, env);
  if (mode === "production") {
    if (b.is_test)
      fail(409, "Lotes de teste não podem ser exportados para produção.");
    origin = definitiveOrigin(req, env);
    if (b.production_origin !== origin)
      fail(409, "Confirme a origem definitiva deste lote antes de exportar.");
  }
  return { b, mode, origin };
}
export async function operations(
  req: Request,
  env: Env,
  user: User,
): Promise<Response | null> {
  const db = env.DB,
    url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path === "/api/activation/verify" && method === "POST") {
    await activationLimit(req, env, user);
    const b = await body(req),
      code = normalizeCode(b.code);
    if (!validPhysicalCode(code) || (b.qr !== undefined && !validQrKey(b.qr)))
      fail(404, ACTIVATION_ERROR);
    const p = await db
      .prepare(
        "SELECT id,code,token,physical_code,batch_id,owner_id FROM plates WHERE physical_code=? AND blocked=0 AND status<>'ACTIVE'",
      )
      .bind(code)
      .first<Row>();
    if (!p || (b.qr !== undefined && `${p.code}-${p.token}` !== b.qr))
      fail(404, ACTIVATION_ERROR);
    if (p.owner_id && p.owner_id !== user.id)
      fail(409, "Esta placa foi designada pelo administrador a outro usuário. Peça ao administrador para revisar a atribuição antes de ativar.");
    const eligibility = await allocationFor(db, user, p);
    const grant = randomToken();
    await db.batch([
      db
        .prepare("DELETE FROM activation_grants WHERE expires_at<=?")
        .bind(Date.now()),
      db
        .prepare(
          "INSERT INTO activation_grants(token_hash,plate_id,user_id,session_hash,expires_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          await digest(grant),
          p.id,
          user.id,
          await digest(cookieToken(req)!),
          Date.now() + 900000,
        ),
    ]);
    return json({
      grant,
      code: p.physical_code,
      expires_in: 900,
      is_test: !!eligibility.batch.is_test,
    });
  }
  if (path === "/api/activation/complete" && method === "POST")
    return finishActivation(req, env, user, await body(req));
  // There is deliberately no old ID-only activation endpoint: it would bypass proof.
  if (
    /^\/api\/plates\/\d+\/activate$/.test(path) ||
    path === "/api/establishments/matches"
  )
    fail(410, "Abra Ativar placa e confirme o código físico.");
  if (path === "/api/batches" && method === "GET") {
    admin(user);
    return json(
      (
        await db
          .prepare(
            "SELECT b.*,COUNT(p.id) AS quantity,COALESCE(SUM(p.status='ACTIVE' AND p.blocked=0),0) AS active,COALESCE(SUM(p.status<>'ACTIVE' AND p.blocked=0),0) AS inactive,COALESCE(SUM(p.blocked=1),0) AS blocked,COALESCE(SUM(p.id IS NOT NULL AND p.physical_code IS NULL),0) AS pending_codes FROM batches b LEFT JOIN plates p ON p.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC",
          )
          .all()
      ).results,
    );
  }
  if (path === "/api/batches" && method === "POST") {
    admin(user);
    const b = await body(req),
      quantity = Number(b.quantity),
      name = text(b.name, "Nome do lote", 100),
      requestKey = text(b.request_key, "Identificador da operação", 80);
    if (b.product !== undefined && b.product !== "GOOGLE")
      fail(400, "Somente Google Reviews está disponível.");
    if (b.is_test !== undefined && typeof b.is_test !== "boolean")
      fail(400, "Finalidade de teste inválida.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000)
      fail(400, "Gere entre 1 e 5.000 placas por lote.");
    const existing = await db
      .prepare(
        "SELECT id,name,target_quantity,is_test FROM batches WHERE request_key=?",
      )
      .bind(requestKey)
      .first<Row>();
    if (existing) {
      if (
        existing.name !== name ||
        existing.target_quantity !== quantity ||
        existing.is_test !== (b.is_test ? 1 : 0)
      )
        fail(409, "Operação já usada para outro lote.");
      return json({ id: existing.id, quantity, complete: false });
    }
    const id = crypto.randomUUID();
    await mutate(db, [
      db
        .prepare(
          "INSERT INTO batches(id,name,created_by,physical_prefix,target_quantity,generation_state,request_key,is_test) VALUES(?,?,?,?,?,'GENERATING',?,?)",
        )
        .bind(
          id,
          name,
          user.id,
          lotPrefix(),
          quantity,
          requestKey,
          b.is_test ? 1 : 0,
        ),
      audit(db, user, "batch", id, "created", null, {
        name,
        target_quantity: quantity,
        is_test: !!b.is_test,
        product: "GOOGLE",
      }),
    ]);
    return json({ id, quantity, complete: false }, 201);
  }
  let m = path.match(/^\/api\/batches\/([^/]+)\/generate$/);
  if (m && method === "POST") {
    admin(user);
    await body(req);
    return generateStep(env, user, m[1]);
  }
  m = path.match(/^\/api\/batches\/([^/]+)\/confirm-production$/);
  if (m && method === "POST") {
    admin(user);
    const b = await body(req),
      origin = definitiveOrigin(req, env),
      batch = await batchById(db, m[1]);
    if (b.origin !== origin)
      fail(400, "A confirmação deve corresponder à origem definitiva exibida.");
    if (batch.production_origin && batch.production_origin !== origin)
      fail(
        409,
        "Este lote já tem uma origem definitiva fixada. Preserve a URL impressa.",
      );
    if (!batch.production_origin)
      await mutate(db, [
        db
          .prepare(
            "UPDATE batches SET production_origin=? WHERE id=? AND production_origin IS NULL",
          )
          .bind(origin, m[1]),
        guard(db),
        audit(db, user, "batch", m[1], "production_origin_confirmed", null, {
          origin,
        }),
      ]);
    return json({ origin });
  }
  if (path === "/api/print-config" && method === "GET") {
    admin(user);
    let productionReady = false;
    try {
      definitiveOrigin(req, env);
      productionReady = true;
    } catch {}
    return json({
      origin: baseURL(req, env),
      production_ready: productionReady,
    });
  }
  m = path.match(/^\/api\/batches\/([^/]+)\/(print-data|csv)$/);
  if (m && method === "GET") {
    admin(user);
    const { b, origin, mode } = await exportInfo(req, env, m[1]);
    const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
    const rows = (
      await db
        .prepare(
          "SELECT id,code,token,physical_code FROM plates WHERE batch_id=? AND id>? ORDER BY id LIMIT ?",
        )
        .bind(b.id, m[2] === "csv" ? 0 : after, m[2] === "csv" ? 5000 : 250)
        .all<Row>()
    ).results;
    const mapped = rows.map((p) => ({
      id: p.id,
      code: p.physical_code,
      url: qrURL(origin, p),
    }));
    if (m[2] === "csv")
      return new Response(
        "\uFEFFcodigo,url\r\n" +
          mapped.map((p) => `${p.code},${p.url}`).join("\r\n") +
          "\r\n",
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${mode === "test" ? "TESTE-NAO-IMPRIMIR-" : ""}placas.csv"`,
          },
        },
      );
    return json({
      batch_id: b.id,
      total: b.quantity,
      mode,
      origin,
      plates: mapped,
      next_after: rows.length === 250 ? rows.at(-1)!.id : null,
    });
  }
  if (path === "/api/plate-groups" && method === "GET") {
    admin(user);
    const q = "%" + (url.searchParams.get("q") || "").slice(0, 160) + "%";
    return json(
      (
        await db
          .prepare(
            "SELECT u.id,u.name,u.email,COUNT(p.id) AS quantity,SUM(p.status='ACTIVE') AS activated,SUM(p.blocked) AS blocked FROM plates p JOIN users u ON u.id=p.owner_id JOIN batches b ON b.id=p.batch_id LEFT JOIN establishments e ON e.id=p.establishment_id WHERE p.physical_code LIKE ? OR p.code LIKE ? OR u.name LIKE ? OR e.name LIKE ? OR b.name LIKE ? GROUP BY u.id ORDER BY u.name",
          )
          .bind(q, q, q, q, q)
          .all()
      ).results,
    );
  }
  if (path === "/api/plates" && method === "GET") {
    const q = "%" + (url.searchParams.get("q") || "").slice(0, 160) + "%",
      after = Math.max(0, Number(url.searchParams.get("after")) || 0);
    const clauses = [
      "p.id>?",
      "(p.physical_code LIKE ? OR p.code LIKE ? OR e.name LIKE ? OR u.name LIKE ? OR b.name LIKE ?)",
    ];
    const args: any[] = [after, q, q, q, q, q];
    if (user.role !== "ADMIN") {
      clauses.push("p.owner_id=? AND p.status='ACTIVE'");
      args.push(user.id);
    }
    for (const field of ["owner_id", "batch_id"])
      if (url.searchParams.get(field) && user.role === "ADMIN") {
        clauses.push(`p.${field}=?`);
        args.push(url.searchParams.get(field));
      }
    if (
      user.role === "ADMIN" &&
      !url.searchParams.get("q") &&
      !url.searchParams.get("batch_id") &&
      !url.searchParams.get("owner_id")
    )
      clauses.push("p.owner_id IS NOT NULL");
    const rows = (
      await db
        .prepare(
          `SELECT p.*,e.name AS establishment_name,u.name AS owner_name,b.name AS batch_name FROM plates p JOIN batches b ON b.id=p.batch_id LEFT JOIN establishments e ON e.id=p.establishment_id LEFT JOIN users u ON u.id=p.owner_id WHERE ${clauses.join(" AND ")} ORDER BY p.id LIMIT 100`,
        )
        .bind(...args)
        .all<Row>()
    ).results;
    return json({
      plates: rows.map((p) => ({ ...p, qr_url: qrURL(baseURL(req, env), p) })),
      next_after: rows.length === 100 ? rows.at(-1)!.id : null,
    });
  }
  m = path.match(/^\/api\/(plates|users)\/([^/]+)\/block$/);
  if (m && method === "POST") {
    admin(user);
    const b = await body(req);
    if (typeof b.blocked !== "boolean")
      fail(400, "Informe bloquear ou desbloquear.");
    const column = m[1] === "users" ? "owner_id" : "id",
      target = m[2],
      next = b.blocked ? 1 : 0,
      action = b.blocked ? "blocked" : "unblocked";
    if (
      m[1] === "plates" &&
      !(await db
        .prepare("SELECT id FROM plates WHERE id=?")
        .bind(target)
        .first())
    )
      fail(404, "Placa não encontrada.");
    if (
      m[1] === "users" &&
      !(await db
        .prepare("SELECT id FROM users WHERE id=?")
        .bind(target)
        .first())
    )
      fail(404, "Usuário não encontrado.");
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO audit_log(actor_id,entity_type,entity_id,action,old_data,new_data) SELECT ?,'plate',CAST(id AS TEXT),?,json_object('blocked',blocked,'owner_id',owner_id),json_object('blocked',?,'scope',?) FROM plates WHERE ${column}=? AND blocked<>?`,
        )
        .bind(user.id, action, next, m[1], target, next),
      db
        .prepare(`UPDATE plates SET blocked=? WHERE ${column}=? AND blocked<>?`)
        .bind(next, target, next),
      db
        .prepare(
          `DELETE FROM activation_grants WHERE plate_id IN (SELECT id FROM plates WHERE ${column}=?)`,
        )
        .bind(target),
    ]);
    return json({ ok: true, changed: result[1].meta.changes });
  }
  m = path.match(/^\/api\/(plates|batches)\/([^/]+)\/assign$/);
  if (m && method === "POST") {
    admin(user);
    const b = await body(req),
      owner = text(b.owner_id, "Vendedor");
    if (
      !(await db
        .prepare(
          "SELECT id FROM users WHERE id=? AND commercial_type='EQUIPE_GEAR' AND state='ACTIVE' AND archived_at IS NULL",
        )
        .bind(owner)
        .first())
    )
      fail(
        400,
        "Selecione uma pessoa ativa da Equipe Gear. Para revendedor, use Atribuir unidades.",
      );
    // Batch assignment is explicitly administrative and touches only never-activated plates.
    const column = m[1] === "plates" ? "id" : "batch_id",
      target = m[2];
    if (m[1] === "plates") {
      const p = await db
        .prepare("SELECT status,batch_id FROM plates WHERE id=?")
        .bind(target)
        .first<Row>();
      if (!p) fail(404, "Placa não encontrada.");
      await batchById(db, p.batch_id);
      if (p.status === "ACTIVE")
        fail(409, "Não é possível transferir uma placa ativa.");
    } else await batchById(db, target);
    const where = `${column}=? AND status<>'ACTIVE' AND owner_id IS NOT ?`;
    const result = await mutate(db, [
      db
        .prepare(
          `INSERT INTO audit_log(actor_id,entity_type,entity_id,action,old_data,new_data) SELECT ?,'plate',CAST(id AS TEXT),'assigned',json_object('owner_id',owner_id),json_object('owner_id',?) FROM plates WHERE ${where}`,
        )
        .bind(user.id, owner, target, owner),
      db
        .prepare(
          `UPDATE plates SET owner_id=?,status='AVAILABLE' WHERE ${where}`,
        )
        .bind(owner, target, owner),
      db
        .prepare(
          `DELETE FROM activation_grants WHERE plate_id IN (SELECT id FROM plates WHERE ${column}=? AND status<>'ACTIVE')`,
        )
        .bind(target),
    ]);
    return json({ ok: true, changed: result[1].meta.changes });
  }
  if (path === "/api/audit" && method === "GET") {
    admin(user);
    const categories: Record<string, string> = {
      users: "a.entity_type='user'",
      batches: "a.entity_type='batch'",
      plates: "a.entity_type='plate'",
      activations:
        "a.action IN ('activated','assigned','assigned_on_activation')",
      establishments: "a.entity_type='establishment'",
      changes: "a.entity_type='establishment' AND a.action='updated'",
      blocks: "a.action IN ('blocked','unblocked')",
      allocations: "a.entity_type='allocation'",
    };
    const category = url.searchParams.get("category") || "all";
    if (category !== "all" && !categories[category])
      fail(400, "Categoria de histórico inválida.");
    const clauses = ["a.id<?"],
      args: any[] = [
        Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER,
      ];
    if (categories[category]) clauses.push(categories[category]);
    const id = url.searchParams.get("entity_id"),
      type = url.searchParams.get("entity_type");
    if (id && type) {
      clauses.push("a.entity_id=? AND a.entity_type=?");
      args.push(id, type);
    }
    const entries = (
      await db
        .prepare(
          `SELECT a.*,u.name AS actor_name,u.email AS actor_email FROM audit_log a JOIN users u ON u.id=a.actor_id WHERE ${clauses.join(" AND ")} ORDER BY a.id DESC LIMIT 100`,
        )
        .bind(...args)
        .all()
    ).results;
    return json({
      entries,
      next_before: entries.length === 100 ? entries.at(-1)!.id : null,
    });
  }
  return null;
}
