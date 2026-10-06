import {
  type Env,
  type User,
  type Row,
  admin,
  audit,
  body,
  fail,
  guard,
  json,
  mutate,
  text,
} from "./core";
import {
  digest,
  hashPassword,
  randomToken,
  validPassword,
  verifyPassword,
} from "./security";
import { sendAccessEmail } from "./email";

const BAD_TOKEN =
  "Link inválido, expirado ou já utilizado. Solicite um novo link.";
const RESET_RESPONSE = {
  ok: true,
  message:
    "Se houver uma conta elegível, enviaremos as instruções. Se não receber, fale com o administrador.",
};
export async function throttle(
  req: Request,
  env: Env,
  namespace: string,
  identity: string,
  max = 8,
) {
  const now = Date.now(),
    keys = [
      await digest(namespace + ":" + identity),
      await digest(
        namespace + ":ip:" + (req.headers.get("cf-connecting-ip") || "local"),
      ),
    ];
  const result = await env.DB.batch(
    keys.map((k) =>
      env.DB.prepare(
        "INSERT INTO login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts",
      ).bind(k, now + 900000, now, now, now + 900000),
    ),
  );
  if (
    result.some(
      (r, i) => Number((r.results[0] as Row).attempts) > (i ? max * 5 : max),
    )
  )
    fail(429, "Muitas tentativas. Aguarde 15 minutos.");
}
async function reauthenticate(req: Request, env: Env, user: User, b: Row) {
  admin(user);
  await throttle(req, env, "admin-confirm", user.id, 8);
  const row = await env.DB.prepare(
    "SELECT password_hash FROM users WHERE id=? AND state='ACTIVE' AND archived_at IS NULL",
  )
    .bind(user.id)
    .first<Row>();
  if (
    typeof b.current_password !== "string" ||
    b.current_password.length > 128 ||
    !row ||
    !(await verifyPassword(
      b.current_password,
      row.password_hash,
      env.PASSWORD_PEPPER,
    ))
  )
    fail(403, "Senha atual do administrador incorreta.");
}
function kindType(value: unknown) {
  if (value !== "EQUIPE_GEAR" && value !== "REVENDEDOR")
    fail(400, "Selecione Equipe Gear ou Revendedor.");
  return value;
}
async function issue(
  req: Request,
  env: Env,
  actor: User,
  target: Row,
  kind: "INVITE" | "RESET",
  initial: D1PreparedStatement[] = [],
) {
  const id = crypto.randomUUID(),
    token = randomToken(),
    now = Date.now(),
    expires = now + (kind === "INVITE" ? 172800000 : 1800000),
    db = env.DB;
  await mutate(db, [
    ...initial,
    db
      .prepare(
        "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL AND revoked_at IS NULL",
      )
      .bind(now, target.id, kind),
    db
      .prepare(
        "INSERT INTO access_tokens(id,user_id,kind,token_hash,expires_at,created_at,created_by) SELECT ?,id,?,?,?,?,? FROM users WHERE id=? AND archived_at IS NULL AND state=?",
      )
      .bind(
        id,
        kind,
        await digest(token),
        expires,
        now,
        actor.id,
        target.id,
        kind === "INVITE" ? "INVITED" : "ACTIVE",
      ),
    guard(db),
    audit(
      db,
      actor,
      "user",
      target.id,
      kind === "INVITE" ? "invited" : "reset_requested",
      null,
      {
        token_id: id,
        expires_at: expires,
        commercial_type: target.commercial_type,
      },
    ),
  ]);
  // Account-access links use this Worker's actual origin, not the future print origin.
  const link = new URL(
    kind === "INVITE" ? `/convite/${token}` : `/redefinir/${token}`,
    req.url,
  ).href;
  const deliver = async () => {
    const delivery = await sendAccessEmail(
      env,
      target.email,
      target.name,
      target.commercial_type,
      kind,
      link,
      id,
    );
    await mutate(db, [
      db
        .prepare("UPDATE access_tokens SET delivery=? WHERE id=?")
        .bind(delivery, id),
      audit(db, actor, "user", target.id, "email_delivery", null, {
        token_id: id,
        delivery,
        kind,
      }),
    ]);
    return delivery;
  };
  return { id, link, expires_at: expires, deliver };
}
export async function publicAccounts(
  req: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (
    req.method !== "POST" ||
    !["/api/access/accept", "/api/password/forgot"].includes(path)
  )
    return null;
  const b = await body(req),
    db = env.DB;
  if (path === "/api/password/forgot") {
    const email =
      typeof b.email === "string"
        ? b.email.trim().toLowerCase().slice(0, 254)
        : "";
    await throttle(req, env, "forgot", email, 5);
    const work = async () => {
      const u = await db
        .prepare(
          "SELECT * FROM users WHERE email=? AND state='ACTIVE' AND archived_at IS NULL",
        )
        .bind(email)
        .first<Row>();
      if (!u) return;
      const t = await issue(req, env, u as User, u, "RESET");
      await t.deliver();
    };
    // Return the same public response before delivery; existence never appears in body.
    if (ctx)
      ctx.waitUntil(
        work().catch(() => {
          console.error(JSON.stringify({ event: "password_recovery_failed" }));
        }),
      );
    else await work();
    return json(RESET_RESPONSE);
  }
  await throttle(
    req,
    env,
    "access-token",
    req.headers.get("cf-connecting-ip") || "local",
    12,
  );
  if (!validPassword(b.password) || b.password !== b.confirmation)
    fail(400, "Use de 12 a 128 caracteres e confirme a mesma senha.");
  if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token))
    fail(400, BAD_TOKEN);
  const t = await db
    .prepare(
      "SELECT t.*,u.state,u.archived_at FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?",
    )
    .bind(await digest(b.token), Date.now())
    .first<Row>();
  if (
    !t ||
    t.archived_at ||
    t.state !== (t.kind === "INVITE" ? "INVITED" : "ACTIVE")
  )
    fail(400, BAD_TOKEN);
  const hash = await hashPassword(b.password, env.PASSWORD_PEPPER),
    actor = { id: t.user_id } as User;
  await mutate(db, [
    db
      .prepare(
        "UPDATE access_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?",
      )
      .bind(Date.now(), t.id, Date.now()),
    guard(db),
    db
      .prepare(
        "UPDATE users SET password_hash=?,must_change_password=0,state='ACTIVE' WHERE id=? AND state=? AND archived_at IS NULL",
      )
      .bind(hash, t.user_id, t.kind === "INVITE" ? "INVITED" : "ACTIVE"),
    guard(db),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(t.user_id),
    db
      .prepare(
        "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND id<>? AND consumed_at IS NULL AND revoked_at IS NULL",
      )
      .bind(Date.now(), t.user_id, t.id),
    audit(
      db,
      actor,
      "user",
      t.user_id,
      t.kind === "INVITE" ? "invite_accepted" : "password_recovered",
      null,
      { sessions_revoked: true },
    ),
  ]);
  return json({ ok: true, login_required: true });
}
export async function allocationFor(db: D1Database, user: User, p: Row) {
  const b = await db
    .prepare(
      "SELECT * FROM batches WHERE id=? AND product='GOOGLE' AND archived_at IS NULL",
    )
    .bind(p.batch_id)
    .first<Row>();
  if (!b) fail(409, "Este lote não está disponível para ativação.");
  let allocation: Row | null = null;
  if (user.commercial_type === "REVENDEDOR") {
    allocation = await db
      .prepare(
        "SELECT * FROM allocations WHERE user_id=? AND batch_id=? AND product=? AND consumed<quantity ORDER BY created_at,id LIMIT 1",
      )
      .bind(user.id, p.batch_id, b.product)
      .first<Row>();
    if (!allocation || p.owner_id)
      fail(
        409,
        "Sem unidades disponíveis para este produto/lote. Fale com o administrador.",
      );
  }
  return { batch: b, allocation };
}
export async function professional(
  req: Request,
  env: Env,
  user: User,
): Promise<Response | null> {
  const db = env.DB,
    url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path === "/api/products" && method === "GET")
    return json([
      { id: "GOOGLE", name: "Google Reviews", state: "ACTIVE" },
      { id: "INSTAGRAM", name: "Instagram", state: "COMING_SOON" },
      { id: "PIX", name: "Pix", state: "COMING_SOON" },
    ]);
  if (path === "/api/invitations" && method === "POST") {
    admin(user);
    const b = await body(req),
      name = text(b.name, "Nome"),
      email = text(b.email, "E-mail", 254).toLowerCase(),
      type = kindType(b.commercial_type);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "E-mail inválido.");
    await throttle(req, env, "invite", user.id, 30);
    const id = crypto.randomUUID(),
      target = { id, name, email, commercial_type: type };
    const t = await issue(req, env, user, target, "INVITE", [
      db
        .prepare(
          "INSERT INTO users(id,name,email,password_hash,role,must_change_password,state,commercial_type) VALUES(?,?,?,?,'USER',0,'INVITED',?)",
        )
        .bind(
          id,
          name,
          email,
          await hashPassword(randomToken(), env.PASSWORD_PEPPER),
          type,
        ),
    ]);
    return json(
      {
        id,
        link: t.link,
        expires_at: t.expires_at,
        delivery: await t.deliver(),
      },
      201,
    );
  }
  if (path === "/api/people" && method === "GET") {
    admin(user);
    const type = url.searchParams.get("type") || "";
    if (type && !["EQUIPE_GEAR", "REVENDEDOR"].includes(type)) fail(400, "Tipo de usuário inválido.");
    const q = (url.searchParams.get("q") || "").slice(0, 160),
      offset = Math.max(
        0,
        Math.floor(Number(url.searchParams.get("offset")) || 0),
      );
    const rows = (
      await db
        .prepare(
          "SELECT u.id,u.name,u.email,u.role,u.commercial_type,u.state,u.archived_at,u.created_at,t.id AS invitation_id,t.created_at AS invited_at,t.expires_at,t.revoked_at,t.consumed_at,t.delivery FROM users u LEFT JOIN access_tokens t ON t.id=(SELECT id FROM access_tokens WHERE user_id=u.id AND kind='INVITE' ORDER BY created_at DESC,id DESC LIMIT 1) WHERE (instr(lower(u.name),lower(?)) OR instr(lower(u.email),lower(?))) AND (?=\'\' OR u.commercial_type=?) ORDER BY u.created_at DESC,u.id LIMIT 51 OFFSET ?",
        )
        .bind(q, q, type, type, offset)
        .all()
    ).results;
    return json({
      users: rows.slice(0, 50),
      next_offset: rows.length > 50 ? offset + 50 : null,
      email_ready: !!(env.RESEND_API_KEY && env.EMAIL_FROM),
    });
  }
  let m = path.match(
    /^\/api\/people\/([^/]+)\/(resend|cancel|reset-link|state|archive)$/,
  );
  if (m && method === "POST") {
    admin(user);
    const b = await body(req),
      u = await db
        .prepare("SELECT * FROM users WHERE id=?")
        .bind(m[1])
        .first<Row>();
    if (!u) fail(404, "Usuário não encontrado.");
    const action = m[2];
    if (action === "resend" || action === "reset-link") {
      await throttle(req, env, "invite", user.id, 30);
      if (action === "reset-link") await reauthenticate(req, env, user, b);
      if (
        u.archived_at ||
        u.state !== (action === "resend" ? "INVITED" : "ACTIVE")
      )
        fail(409, "Estado do usuário não permite esta operação.");
      const t = await issue(
        req,
        env,
        user,
        u,
        action === "resend" ? "INVITE" : "RESET",
      );
      return json({
        link: t.link,
        expires_at: t.expires_at,
        delivery: await t.deliver(),
      });
    }
    if (action === "cancel") {
      if (u.state !== "INVITED")
        fail(409, "Somente convites pendentes podem ser cancelados.");
      await mutate(db, [
        db
          .prepare(
            "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND kind='INVITE' AND consumed_at IS NULL AND revoked_at IS NULL",
          )
          .bind(Date.now(), u.id),
        audit(db, user, "user", u.id, "invite_cancelled", null, {}),
      ]);
      return json({ ok: true });
    }
    if (u.role === "ADMIN")
      fail(409, "Contas ADMIN são protegidas nesta operação.");
    if (action === "archive") {
      await reauthenticate(req, env, user, b);
      if (b.confirmation !== `ARQUIVAR ${u.email}`)
        fail(400, "Confirmação digitada incorretamente.");
      await mutate(db, [
        db
          .prepare(
            "UPDATE users SET archived_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),state='SUSPENDED' WHERE id=?",
          )
          .bind(u.id),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
        db
          .prepare(
            "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
          )
          .bind(Date.now(), u.id),
        audit(
          db,
          user,
          "user",
          u.id,
          "archived",
          { state: u.state },
          { state: "SUSPENDED" },
        ),
      ]);
      return json({ ok: true });
    }
    if (
      !["ACTIVE", "SUSPENDED"].includes(b.state) ||
      u.archived_at ||
      u.state === "INVITED"
    )
      fail(
        400,
        "Estado inválido. Convites precisam ser aceitos antes da reativação.",
      );
    await mutate(db, [
      db
        .prepare(
          "UPDATE users SET state=? WHERE id=? AND state=? AND archived_at IS NULL",
        )
        .bind(b.state, u.id, u.state),
      guard(db),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
      db
        .prepare(
          "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(Date.now(), u.id),
      audit(
        db,
        user,
        "user",
        u.id,
        b.state === "ACTIVE" ? "reactivated" : "suspended",
        { state: u.state },
        { state: b.state },
      ),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/allocations" && method === "GET") {
    const owner =
      user.role === "ADMIN" ? url.searchParams.get("user_id") || "" : user.id;
    const rows = (
      await db
        .prepare(
          "SELECT a.*,b.name AS batch_name,b.is_test,b.archived_at,(a.quantity-a.consumed) AS available FROM allocations a JOIN batches b ON b.id=a.batch_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 500",
        )
        .bind(owner)
        .all()
    ).results;
    return json(rows);
  }
  if (path === "/api/allocations" && method === "POST") {
    admin(user);
    const b = await body(req),
      owner = text(b.user_id, "Revendedor"),
      batch = text(b.batch_id, "Lote"),
      key = text(b.request_key, "Identificador", 80),
      quantity = Number(b.quantity);
    if (
      b.product !== "GOOGLE" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 5000
    )
      fail(400, "Selecione Google e quantidade entre 1 e 5.000.");
    const old = await db
      .prepare("SELECT * FROM allocations WHERE request_key=?")
      .bind(key)
      .first<Row>();
    if (old) {
      if (
        old.user_id !== owner ||
        old.batch_id !== batch ||
        old.quantity !== quantity
      )
        fail(409, "Operação já utilizada.");
      return json({ id: old.id });
    }
    const id = crypto.randomUUID();
    await mutate(db, [
      db
        .prepare(
          "INSERT INTO allocations(id,user_id,batch_id,quantity,request_key,created_by) VALUES(?,?,?,?,?,?)",
        )
        .bind(id, owner, batch, quantity, key, user.id),
      audit(db, user, "allocation", id, "allocated", null, {
        user_id: owner,
        batch_id: batch,
        quantity,
        product: "GOOGLE",
      }),
    ]);
    return json({ id }, 201);
  }
  if (path === "/api/dashboard" && method === "GET") {
    admin(user);
    const counts = await db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM plates WHERE status='ACTIVE' AND blocked=0) AS active,(SELECT COUNT(*) FROM plates WHERE status<>'ACTIVE' AND blocked=0) AS inactive,(SELECT COUNT(*) FROM plates WHERE blocked=1) AS blocked,(SELECT COUNT(*) FROM users WHERE role='USER' AND commercial_type='EQUIPE_GEAR' AND state='ACTIVE' AND archived_at IS NULL) AS team,(SELECT COUNT(*) FROM users WHERE commercial_type='REVENDEDOR' AND state='ACTIVE' AND archived_at IS NULL) AS resellers,(SELECT COUNT(*) FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.kind='INVITE' AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>? AND u.state='INVITED' AND u.archived_at IS NULL) AS invitations,(SELECT COUNT(*) FROM plates WHERE activated_at>=?) AS month_activations",
      )
      .bind(Date.now(), monthStart())
      .first();
    const recent = (
      await db
        .prepare(
          "SELECT p.id,p.physical_code,p.activated_at,p.activation_type,e.name AS establishment_name,u.name AS actor FROM plates p LEFT JOIN establishments e ON e.id=p.establishment_id LEFT JOIN users u ON u.id=p.activated_by WHERE p.status='ACTIVE' ORDER BY p.activated_at DESC LIMIT 10",
        )
        .all()
    ).results;
    const batches = (
      await db
        .prepare(
          "SELECT id,name,is_test,created_at FROM batches WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 5",
        )
        .all()
    ).results;
    return json({ counts, recent, batches });
  }
  if (path === "/api/search" && method === "GET") {
    admin(user);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 160),
      after = url.searchParams.get("after") || "";
    if (!q) return json({ results: [], next_after: null });
    const rows = (
      await db
        .prepare(
          "SELECT * FROM (SELECT 'plate:'||printf('%015d',p.id) AS cursor,'plate' AS kind,CAST(p.id AS TEXT) AS id,COALESCE(p.physical_code,p.code) AS title,COALESCE(e.name,'')||' · '||COALESCE(u.name,'')||' · '||b.name AS detail FROM plates p JOIN batches b ON b.id=p.batch_id LEFT JOIN establishments e ON e.id=p.establishment_id LEFT JOIN users u ON u.id=p.owner_id WHERE instr(lower(COALESCE(p.physical_code,p.code)||' '||b.name||' '||COALESCE(e.name,'')||' '||COALESCE(u.name,'')||' '||COALESCE(u.email,'')),lower(?)) UNION ALL SELECT 'user:'||id,'user',id,name,email||' · '||commercial_type FROM users WHERE instr(lower(name||' '||email),lower(?)) UNION ALL SELECT 'batch:'||id,'batch',id,name,product FROM batches WHERE instr(lower(name||' '||COALESCE(physical_prefix,'')),lower(?)) UNION ALL SELECT 'establishment:'||id,'establishment',id,name,city||' · '||phone FROM establishments WHERE instr(lower(name||' '||city||' '||phone_normalized),lower(?))) WHERE cursor>? ORDER BY cursor LIMIT 51",
        )
        .bind(q, q, q, q, after)
        .all<Row>()
    ).results;
    return json({
      results: rows.slice(0, 50),
      next_after: rows.length > 50 ? rows[49].cursor : null,
    });
  }
  m = path.match(/^\/api\/plates\/(\d+)\/trace$/);
  if (m && method === "GET") {
    const p = await db
      .prepare(
        "SELECT p.*,b.name AS batch_name,b.product,b.is_test,u.name AS activated_by_name,e.name AS establishment_name FROM plates p JOIN batches b ON b.id=p.batch_id LEFT JOIN users u ON u.id=p.activated_by LEFT JOIN establishments e ON e.id=p.establishment_id WHERE p.id=? AND (?='ADMIN' OR (p.owner_id=? AND p.status='ACTIVE'))",
      )
      .bind(m[1], user.role, user.id)
      .first<Row>();
    if (!p) fail(404, "Placa não encontrada.");
    delete p.token;
    return json(p);
  }
  m = path.match(
    /^\/api\/(batches|establishments)\/([^/]+)\/(archive|delete-test)$/,
  );
  if (m && method === "POST") {
    await safeRemove(req, env, user, m[1], m[2], m[3], await body(req));
    return json({ ok: true });
  }
  return null;
}
function monthStart() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-01T03:00:00.000Z`;
}
async function safeRemove(
  req: Request,
  env: Env,
  user: User,
  table: string,
  id: string,
  action: string,
  b: Row,
) {
  await reauthenticate(req, env, user, b);
  const db = env.DB,
    row = await db
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .bind(id)
      .first<Row>();
  if (!row) fail(404, "Registro não encontrado.");
  const expected = `${action === "archive" ? "ARQUIVAR" : "EXCLUIR"} ${row.name}`;
  if (b.confirmation !== expected) fail(400, `Digite exatamente: ${expected}`);
  if (action === "archive") {
    await mutate(db, [
      db
        .prepare(
          `UPDATE ${table} SET archived_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        )
        .bind(id),
      audit(
        db,
        user,
        table === "batches" ? "batch" : "establishment",
        id,
        "archived",
        { name: row.name },
        { archived: true },
      ),
    ]);
    return;
  }
  if (!row.is_test)
    fail(409, "Dados reais não podem ser excluídos. Use Arquivar.");
  if (table === "establishments") {
    await mutate(db, [
      db
        .prepare(
          "DELETE FROM establishments WHERE id=? AND is_test=1 AND NOT EXISTS(SELECT 1 FROM plates WHERE establishment_id=?)",
        )
        .bind(id, id),
      guard(db),
      audit(
        db,
        user,
        "establishment",
        id,
        "test_deleted",
        { name: row.name, is_test: true },
        null,
      ),
    ]);
    return;
  }
  // Refuse dependent allocations and clients shared with any other lot. No cascades.
  const blocker = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM allocations WHERE batch_id=?) + (SELECT COUNT(*) FROM plates p JOIN establishments e ON e.id=p.establishment_id WHERE p.batch_id=? AND (e.is_test=0 OR EXISTS(SELECT 1 FROM plates x WHERE x.establishment_id=e.id AND x.batch_id<>?))) AS total",
    )
    .bind(id, id, id)
    .first<Row>();
  if (blocker!.total)
    fail(
      409,
      "Lote possui alocação de revenda, cliente real ou cliente compartilhado. Arquive para preservar os vínculos.",
    );
  const clients = (
    await db
      .prepare(
        "SELECT DISTINCT e.id,e.name FROM establishments e JOIN plates p ON p.establishment_id=e.id WHERE p.batch_id=?",
      )
      .bind(id)
      .all<Row>()
  ).results;
  await mutate(db, [
    db
      .prepare(
        "INSERT INTO mutation_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM allocations WHERE batch_id=?) AND NOT EXISTS(SELECT 1 FROM plates p JOIN establishments e ON e.id=p.establishment_id WHERE p.batch_id=? AND (e.is_test=0 OR EXISTS(SELECT 1 FROM plates x WHERE x.establishment_id=e.id AND x.batch_id<>?))) AND (SELECT COUNT(DISTINCT establishment_id) FROM plates WHERE batch_id=?)=? THEN 1 ELSE 0 END",
      )
      .bind(id, id, id, id, clients.length),
    audit(
      db,
      user,
      "batch",
      id,
      "test_deleted",
      { name: row.name, is_test: true },
      null,
    ),
    db
      .prepare(
        "INSERT INTO audit_log(actor_id,entity_type,entity_id,action,old_data) SELECT ?,'plate',CAST(id AS TEXT),'test_deleted',json_object('physical_code',physical_code,'batch_id',batch_id,'owner_id',owner_id,'establishment_id',establishment_id,'status',status) FROM plates WHERE batch_id=?",
      )
      .bind(user.id, id),
    db
      .prepare(
        "DELETE FROM activation_grants WHERE plate_id IN (SELECT id FROM plates WHERE batch_id=?)",
      )
      .bind(id),
    db.prepare("DELETE FROM plates WHERE batch_id=?").bind(id),
    ...clients.flatMap((e) => [
      db
        .prepare(
          "DELETE FROM establishments WHERE id=? AND is_test=1 AND NOT EXISTS(SELECT 1 FROM plates WHERE establishment_id=?)",
        )
        .bind(e.id, e.id),
      guard(db),
      audit(
        db,
        user,
        "establishment",
        e.id,
        "test_deleted",
        { name: e.name, is_test: true },
        null,
      ),
    ]),
    db.prepare("DELETE FROM batches WHERE id=? AND is_test=1").bind(id),
    guard(db),
  ]);
}
