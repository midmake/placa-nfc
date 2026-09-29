import {
  digest,
  hashPassword,
  randomToken,
  validPassword,
  verifyPassword,
} from "./security";
import { parseGoogleURL, validateGoogleDestination } from "./google-url";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PASSWORD_PEPPER: string;
  PUBLIC_BASE_URL?: string;
}
type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  must_change_password: number;
  password_hash?: string;
};
type Row = Record<string, any>;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(s: number, m: string): never {
  throw new HttpError(s, m);
}
const json = (data: unknown, status = 200) => Response.json(data, { status });
const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export function normalizePhone(s: string): string {
  let n = s.replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return n;
}
const text = (v: unknown, name: string, max = 160): string =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max
    ? v.trim()
    : fail(400, `${name}: preenchimento obrigatório (até ${max} caracteres).`);
async function body(req: Request): Promise<Row> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    fail(415, "Envie JSON.");
  const raw = await req.text();
  if (raw.length > 16384) fail(413, "Formulário muito grande.");
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  return fail(400, "Formulário inválido.");
}
function scope(user: User, owner: unknown) {
  if (user.role !== "ADMIN" && owner !== user.id)
    fail(404, "Registro não encontrado.");
}
function admin(user: User) {
  if (user.role !== "ADMIN") fail(403, "Acesso exclusivo do administrador.");
}
function audit(
  db: D1Database,
  user: User,
  type: string,
  id: string,
  action: string,
  oldData: unknown,
  newData: unknown,
) {
  return db
    .prepare(
      "INSERT INTO audit_log(actor_id,entity_type,entity_id,action,old_data,new_data) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      user.id,
      type,
      id,
      action,
      oldData == null ? null : JSON.stringify(oldData),
      newData == null ? null : JSON.stringify(newData),
    );
}
function guard(db: D1Database, count = 1) {
  return db
    .prepare(
      "INSERT INTO mutation_guard(ok) VALUES(CASE WHEN changes()=? THEN 1 ELSE 0 END)",
    )
    .bind(count);
}
async function mutate(db: D1Database, stmts: D1PreparedStatement[]) {
  try {
    await db.batch([...stmts, db.prepare("DELETE FROM mutation_guard")]);
  } catch (e) {
    if (
      String(e).includes("CHECK constraint failed") ||
      String(e).includes("UNIQUE constraint")
    )
      fail(
        409,
        "Os dados mudaram ou já existem. Atualize a tela e tente novamente.",
      );
    throw e;
  }
}
function sessionCookie(token: string, req: Request, age: number) {
  return `gg_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
const cookieToken = (req: Request) =>
  req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)gg_session=([a-f0-9]{64})(?:;|$)/)?.[1];
async function current(req: Request, db: D1Database): Promise<User> {
  const token = cookieToken(req);
  if (!token) fail(401, "Entre para continuar.");
  const u = await db
    .prepare(
      "SELECT u.id,u.name,u.email,u.role,u.must_change_password FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .bind(await digest(token!), Date.now())
    .first<User>();
  return u ?? fail(401, "Sessão expirada. Entre novamente.");
}
async function limitLogin(db: D1Database, email: string, ip: string) {
  const now = Date.now();
  const keys = [
    { key: await digest("email:" + email), max: 10 },
    { key: await digest("ip:" + ip), max: 40 },
  ];
  const rows = await db.batch(
    keys.map((k) =>
      db
        .prepare(
          "INSERT INTO login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts",
        )
        .bind(k.key, now + 900000, now, now, now + 900000),
    ),
  );
  if (rows.some((r, i) => Number((r.results[0] as Row).attempts) > keys[i].max))
    fail(429, "Muitas tentativas. Aguarde 15 minutos.");
  await db
    .prepare("DELETE FROM login_limits WHERE reset_at<?")
    .bind(now - 900000)
    .run();
}
async function establishmentInput(b: Row, env: Env) {
  const name = text(b.name, "Nome"),
    city = text(b.city, "Cidade", 100),
    segment = text(b.segment, "Segmento", 80),
    responsible = text(b.responsible, "Responsável"),
    phone = text(b.phone, "Telefone", 30);
  const normalized = normalizePhone(phone);
  if (!/^\d{10,15}$/.test(normalized))
    fail(400, "Telefone inválido. Informe DDD e número.");
  if (
    !(await env.DB.prepare("SELECT name FROM categories WHERE name=?")
      .bind(segment)
      .first())
  )
    fail(400, "Selecione um segmento da lista.");
  let google_url: string;
  try {
    google_url = await validateGoogleDestination(b.google_url);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
  return {
    name,
    city,
    segment,
    responsible,
    phone,
    phone_normalized: normalized,
    google_url,
    name_key: key(name),
    city_key: key(city),
  };
}
async function getPlate(db: D1Database, id: string, user: User) {
  const p = await db
    .prepare("SELECT * FROM plates WHERE id=?")
    .bind(id)
    .first<Row>();
  if (!p) fail(404, "Placa não encontrada.");
  scope(user, p!.owner_id);
  return p!;
}
async function getEst(db: D1Database, id: string, user: User) {
  const e = await db
    .prepare("SELECT * FROM establishments WHERE id=?")
    .bind(id)
    .first<Row>();
  if (!e) fail(404, "Estabelecimento não encontrado.");
  scope(user, e!.owner_id);
  return e!;
}
function baseURL(req: Request, env: Env) {
  const u = new URL(env.PUBLIC_BASE_URL || new URL(req.url).origin);
  if (u.pathname !== "/" || u.search || u.hash)
    throw new Error("Invalid PUBLIC_BASE_URL");
  return u.origin;
}
async function route(req: Request, env: Env): Promise<Response> {
  const { DB: db } = env;
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path.startsWith("/r/") && (method === "GET" || method === "HEAD")) {
    const token = path.slice(3);
    if (!/^A\d{5,}-[a-f0-9]{48}$/.test(token))
      fail(404, "Placa não encontrada.");
    const p = await db
      .prepare(
        "SELECT p.status,e.google_url FROM plates p LEFT JOIN establishments e ON e.id=p.establishment_id WHERE p.code||'-'||p.token=?",
      )
      .bind(token)
      .first<Row>();
    if (!p) fail(404, "Placa não encontrada.");
    if (p.status !== "ACTIVE")
      return new Response(
        "GEAR GO DIGITAL — Esta placa ainda não foi ativada. Entre em contato com quem forneceu a placa.",
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    try {
      parseGoogleURL(p.google_url);
    } catch {
      return new Response(
        "Destino indisponível. Entre em contato com a Gear Go Digital.",
        { status: 503 },
      );
    }
    return new Response(null, {
      status: 302,
      headers: { Location: p.google_url },
    });
  }
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.get("origin") !== url.origin)
      fail(403, "Origem inválida. Atualize a página e tente novamente.");
    if (req.headers.get("sec-fetch-site") === "cross-site")
      fail(403, "Origem inválida.");
  }
  if (path === "/api/login" && method === "POST") {
    const b = await body(req);
    const email = text(b.email, "E-mail", 254).toLowerCase();
    const password = text(b.password, "Senha", 128);
    await limitLogin(db, email, req.headers.get("cf-connecting-ip") || "local");
    const u = await db
      .prepare("SELECT * FROM users WHERE email=?")
      .bind(email)
      .first<User>();
    // Perform a real derivation for nonexistent accounts too.
    const valid = u
      ? await verifyPassword(password, u.password_hash!, env.PASSWORD_PEPPER)
      : (await hashPassword(password, env.PASSWORD_PEPPER, "0".repeat(32)),
        false);
    if (!u || !valid) fail(401, "E-mail ou senha inválidos.");
    const token = randomToken();
    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      db
        .prepare(
          "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
        )
        .bind(await digest(token), u.id, now + 43200000, now),
    ]);
    const res = json({
      id: u.id,
      name: u.name,
      role: u.role,
      must_change_password: u.must_change_password,
    });
    res.headers.set("Set-Cookie", sessionCookie(token, req, 43200));
    return res;
  }
  const user = await current(req, db);
  if (path === "/api/me" && method === "GET") return json(user);
  if (path === "/api/logout" && method === "POST") {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await digest(cookieToken(req)!))
      .run();
    const res = json({ ok: true });
    res.headers.set("Set-Cookie", sessionCookie("", req, 0));
    return res;
  }
  if (path === "/api/password" && method === "POST") {
    const b = await body(req);
    if (!validPassword(b.password))
      fail(400, "Use uma senha de 12 a 128 caracteres.");
    const stored = await db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (
      typeof b.current_password !== "string" ||
      !(await verifyPassword(
        b.current_password,
        stored!.password_hash,
        env.PASSWORD_PEPPER,
      ))
    )
      fail(400, "Senha atual incorreta.");
    if (b.password === b.current_password)
      fail(400, "A nova senha deve ser diferente da temporária/atual.");
    await mutate(db, [
      db
        .prepare(
          "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=?",
        )
        .bind(
          await hashPassword(b.password, env.PASSWORD_PEPPER),
          user.id,
          stored!.password_hash,
        ),
      guard(db),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
      audit(db, user, "user", user.id, "password_changed", null, {
        sessions_revoked: true,
      }),
    ]);
    const res = json({ ok: true, login_required: true });
    res.headers.set("Set-Cookie", sessionCookie("", req, 0));
    return res;
  }
  if (user.must_change_password)
    fail(403, "Troque sua senha temporária antes de continuar.");
  if (path === "/api/categories" && method === "GET")
    return json(
      (await db.prepare("SELECT name FROM categories ORDER BY name").all())
        .results,
    );
  if (path === "/api/categories" && method === "POST") {
    admin(user);
    const b = await body(req),
      name = text(b.name, "Categoria", 80);
    await mutate(db, [
      db.prepare("INSERT INTO categories(name) VALUES(?)").bind(name),
      audit(db, user, "category", name, "created", null, { name }),
    ]);
    return json({ name }, 201);
  }
  if (path === "/api/users" && method === "GET") {
    admin(user);
    return json(
      (
        await db
          .prepare(
            "SELECT id,name,email,role,must_change_password,created_at FROM users ORDER BY name",
          )
          .all()
      ).results,
    );
  }
  if (path === "/api/users" && method === "POST") {
    admin(user);
    const b = await body(req),
      name = text(b.name, "Nome"),
      email = text(b.email, "E-mail", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "E-mail inválido.");
    const password = b.password || randomToken(10);
    if (!validPassword(password))
      fail(400, "Senha temporária deve ter de 12 a 128 caracteres.");
    const id = crypto.randomUUID();
    await mutate(db, [
      db
        .prepare(
          "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,'USER')",
        )
        .bind(
          id,
          name,
          email,
          await hashPassword(password, env.PASSWORD_PEPPER),
        ),
      audit(db, user, "user", id, "created", null, {
        name,
        email,
        role: "USER",
      }),
    ]);
    return json({ id, name, email, temporary_password: password }, 201);
  }
  let match = path.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (match && method === "POST") {
    admin(user);
    const id = match[1];
    const target = await db
      .prepare("SELECT id FROM users WHERE id=?")
      .bind(id)
      .first();
    if (!target) fail(404, "Usuário não encontrado.");
    const password = randomToken(10);
    await mutate(db, [
      db
        .prepare(
          "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
        )
        .bind(await hashPassword(password, env.PASSWORD_PEPPER), id),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
      audit(db, user, "user", id, "password_reset", null, {
        sessions_revoked: true,
      }),
    ]);
    return json({ temporary_password: password });
  }
  if (path === "/api/batches" && method === "GET")
    return json(
      (
        await db
          .prepare(
            `SELECT b.*,u.name AS owner_name,COUNT(p.id) AS quantity FROM batches b LEFT JOIN users u ON u.id=b.owner_id LEFT JOIN plates p ON p.batch_id=b.id ${user.role === "ADMIN" ? "" : "WHERE b.owner_id=?"} GROUP BY b.id ORDER BY b.created_at DESC`,
          )
          .bind(...(user.role === "ADMIN" ? [] : [user.id]))
          .all()
      ).results,
    );
  if (path === "/api/batches" && method === "POST") {
    admin(user);
    const b = await body(req),
      name = text(b.name, "Nome do lote", 100),
      quantity = Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      fail(400, "Gere entre 1 e 100 placas por lote nesta versão.");
    const owner = b.owner_id || null;
    if (
      owner &&
      !(await db.prepare("SELECT id FROM users WHERE id=?").bind(owner).first())
    )
      fail(400, "Usuário inválido.");
    const id = crypto.randomUUID();
    const stmts = [
      db
        .prepare(
          "INSERT INTO batches(id,name,owner_id,created_by) VALUES(?,?,?,?)",
        )
        .bind(id, name, owner, user.id),
    ];
    for (let offset = 0; offset < quantity; offset += 20) {
      const size = Math.min(20, quantity - offset);
      const args = [];
      for (let i = 0; i < size; i++)
        args.push(
          randomToken(24),
          id,
          owner,
          owner ? "AVAILABLE" : "UNASSIGNED",
        );
      stmts.push(
        db
          .prepare(
            "INSERT INTO plates(token,batch_id,owner_id,status) VALUES " +
              Array(size).fill("(?,?,?,?)").join(","),
          )
          .bind(...args),
      );
    }
    stmts.push(
      audit(db, user, "batch", id, "created", null, {
        name,
        quantity,
        owner_id: owner,
      }),
    );
    await mutate(db, stmts);
    return json({ id, quantity }, 201);
  }
  match = path.match(/^\/api\/batches\/([^/]+)\/assign$/);
  if (match && method === "POST") {
    admin(user);
    const b = await body(req),
      id = match[1],
      owner = text(b.owner_id, "Usuário");
    const batch = await db
      .prepare("SELECT * FROM batches WHERE id=?")
      .bind(id)
      .first<Row>();
    if (!batch) fail(404, "Lote não encontrado.");
    if (
      !(await db.prepare("SELECT id FROM users WHERE id=?").bind(owner).first())
    )
      fail(400, "Usuário inválido.");
    const plates = (
      await db
        .prepare("SELECT id,code,owner_id,status FROM plates WHERE batch_id=?")
        .bind(id)
        .all()
    ).results;
    if (plates.some((p) => p.status === "ACTIVE"))
      fail(
        409,
        "Este lote possui placas ativas. Atribua individualmente as placas disponíveis.",
      );
    await mutate(db, [
      db
        .prepare(
          "INSERT INTO mutation_guard(ok) SELECT CASE WHEN (SELECT COUNT(*) FROM plates WHERE batch_id=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN plates p ON p.id=json_extract(j.value,'$.id') WHERE p.owner_id IS NOT json_extract(j.value,'$.owner_id') OR p.status<>json_extract(j.value,'$.status')) THEN 1 ELSE 0 END",
        )
        .bind(id, plates.length, JSON.stringify(plates)),
      db
        .prepare(
          "UPDATE batches SET owner_id=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM plates WHERE batch_id=? AND status='ACTIVE')",
        )
        .bind(owner, id, id),
      guard(db),
      db
        .prepare(
          "UPDATE plates SET owner_id=?,status='AVAILABLE' WHERE batch_id=? AND establishment_id IS NULL",
        )
        .bind(owner, id),
      guard(db, plates.length),
      audit(
        db,
        user,
        "batch",
        id,
        "assigned",
        { batch, plates },
        { owner_id: owner },
      ),
    ]);
    return json({ ok: true });
  }
  match = path.match(/^\/api\/batches\/([^/]+)\/csv$/);
  if (match && method === "GET") {
    admin(user);
    const rows = (
      await db
        .prepare("SELECT code,token FROM plates WHERE batch_id=? ORDER BY id")
        .bind(match[1])
        .all<{ code: string; token: string }>()
    ).results;
    if (!rows.length) fail(404, "Lote não encontrado.");
    const base = baseURL(req, env);
    return new Response(
      "\uFEFFcodigo,url\r\n" +
        rows
          .map((p) => `${p.code},${base}/r/${p.code}-${p.token}`)
          .join("\r\n") +
        "\r\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="placas.csv"',
        },
      },
    );
  }
  if (path === "/api/plates" && method === "GET") {
    const q = (url.searchParams.get("q") || "").slice(0, 160);
    const filters = [
      ...(user.role === "ADMIN" ? [] : ["p.owner_id=?"]),
      "(p.code LIKE ? OR e.name LIKE ?)",
    ];
    const args = [
      ...(user.role === "ADMIN" ? [] : [user.id]),
      `%${q}%`,
      `%${q}%`,
    ];
    const rows = (
      await db
        .prepare(
          `SELECT p.*,e.name AS establishment_name,u.name AS owner_name FROM plates p LEFT JOIN establishments e ON e.id=p.establishment_id LEFT JOIN users u ON u.id=p.owner_id WHERE ${filters.join(" AND ")} ORDER BY p.id DESC LIMIT 500`,
        )
        .bind(...args)
        .all<Row>()
    ).results;
    const counts = (
      await db
        .prepare(
          `SELECT status,COUNT(*) AS quantity FROM plates ${user.role === "ADMIN" ? "" : "WHERE owner_id=?"} GROUP BY status`,
        )
        .bind(...(user.role === "ADMIN" ? [] : [user.id]))
        .all()
    ).results;
    return json({
      plates: rows.map((p) => ({
        ...p,
        qr_url: `${baseURL(req, env)}/r/${p.code}-${p.token}`,
      })),
      counts,
      limit: 500,
    });
  }
  match = path.match(/^\/api\/plates\/(\d+)\/assign$/);
  if (match && method === "POST") {
    admin(user);
    const p = await getPlate(db, match[1], user),
      b = await body(req),
      owner = text(b.owner_id, "Usuário");
    if (p.status === "ACTIVE")
      fail(409, "Não é possível transferir placa ativa nesta versão.");
    if (
      !(await db.prepare("SELECT id FROM users WHERE id=?").bind(owner).first())
    )
      fail(400, "Usuário inválido.");
    await mutate(db, [
      db
        .prepare(
          "UPDATE plates SET owner_id=?,status='AVAILABLE' WHERE id=? AND status<>'ACTIVE' AND owner_id IS ?",
        )
        .bind(owner, p.id, p.owner_id),
      guard(db),
      audit(
        db,
        user,
        "plate",
        String(p.id),
        "assigned",
        { code: p.code, owner_id: p.owner_id },
        { owner_id: owner },
      ),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/establishments" && method === "GET") {
    const clauses = user.role === "ADMIN" ? ["1=1"] : ["e.owner_id=?"];
    const args: unknown[] = user.role === "ADMIN" ? [] : [user.id];
    for (const field of ["city", "segment"]) {
      const v = url.searchParams.get(field);
      if (v) {
        clauses.push(`e.${field} LIKE ?`);
        args.push(`%${v.slice(0, 160)}%`);
      }
    }
    const q = (url.searchParams.get("q") || "").slice(0, 160);
    if (q) {
      clauses.push(
        "(e.name LIKE ? OR e.phone_normalized LIKE ? OR EXISTS(SELECT 1 FROM plates x WHERE x.establishment_id=e.id AND x.code LIKE ?))",
      );
      args.push(
        `%${q}%`,
        `%${q.replace(/\D/g, "") || "NOT_A_PHONE"}%`,
        `%${q}%`,
      );
    }
    const rows = (
      await db
        .prepare(
          `SELECT e.*,(SELECT COUNT(*) FROM plates p WHERE p.establishment_id=e.id) AS plate_count FROM establishments e WHERE ${clauses.join(" AND ")} ORDER BY e.name LIMIT 500`,
        )
        .bind(...args)
        .all()
    ).results;
    return json(rows);
  }
  if (path === "/api/establishments/matches" && method === "POST") {
    const b = await body(req),
      p = await getPlate(db, text(String(b.plate_id), "Placa"), user);
    if (!p.owner_id) fail(400, "Atribua a placa antes de ativar.");
    const input = await establishmentInput(b, env);
    const matches = (
      await db
        .prepare(
          "SELECT id,name,city,phone,segment FROM establishments WHERE owner_id=? AND (phone_normalized=? OR google_url=? OR (name_key=? AND city_key=?)) LIMIT 20",
        )
        .bind(
          p.owner_id,
          input.phone_normalized,
          input.google_url,
          input.name_key,
          input.city_key,
        )
        .all()
    ).results;
    return json({ matches });
  }
  match = path.match(/^\/api\/plates\/(\d+)\/activate$/);
  if (match && method === "POST") {
    const p = await getPlate(db, match[1], user);
    if (p.status !== "AVAILABLE")
      fail(409, "A placa precisa estar disponível e atribuída.");
    const b = await body(req);
    let eid: string;
    const stmts: D1PreparedStatement[] = [];
    if (b.establishment_id) {
      const e = await getEst(
        db,
        text(b.establishment_id, "Estabelecimento"),
        user,
      );
      if (e.owner_id !== p.owner_id)
        fail(409, "Placa e estabelecimento precisam ter o mesmo responsável.");
      eid = e.id;
    } else {
      const input = await establishmentInput(b, env);
      const matches = (
        await db
          .prepare(
            "SELECT id,name,city,phone FROM establishments WHERE owner_id=? AND (phone_normalized=? OR google_url=? OR (name_key=? AND city_key=?)) LIMIT 20",
          )
          .bind(
            p.owner_id,
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
            "INSERT INTO establishments(id,owner_id,name,city,segment,responsible,phone,phone_normalized,google_url,name_key,city_key,initial_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            eid,
            p.owner_id,
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
          ),
        audit(db, user, "establishment", eid, "created", null, input),
      );
    }
    stmts.push(
      db
        .prepare(
          "UPDATE plates SET establishment_id=?,status='ACTIVE',activated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='AVAILABLE' AND owner_id=?",
        )
        .bind(eid, p.id, p.owner_id),
      guard(db),
      audit(
        db,
        user,
        "plate",
        String(p.id),
        "activated",
        { code: p.code, status: p.status, establishment_id: null },
        { status: "ACTIVE", establishment_id: eid },
      ),
    );
    await mutate(db, stmts);
    return json({ ok: true, establishment_id: eid });
  }
  match = path.match(/^\/api\/establishments\/([^/]+)$/);
  if (match && method === "GET") {
    const e = await getEst(db, match[1], user);
    const plates = (
      await db
        .prepare(
          "SELECT id,code,status,token FROM plates WHERE establishment_id=? ORDER BY id",
        )
        .bind(e.id)
        .all<Row>()
    ).results;
    return json({
      ...e,
      plates: plates.map((p) => ({
        ...p,
        qr_url: `${baseURL(req, env)}/r/${p.code}-${p.token}`,
      })),
    });
  }
  if (match && method === "PATCH") {
    const e = await getEst(db, match[1], user),
      b = await body(req);
    if (b.version !== e.version)
      fail(
        409,
        "Este estabelecimento foi alterado. Reabra a tela antes de salvar.",
      );
    const input = await establishmentInput(b, env);
    await mutate(db, [
      db
        .prepare(
          "UPDATE establishments SET name=?,city=?,segment=?,responsible=?,phone=?,phone_normalized=?,google_url=?,name_key=?,city_key=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?",
        )
        .bind(
          input.name,
          input.city,
          input.segment,
          input.responsible,
          input.phone,
          input.phone_normalized,
          input.google_url,
          input.name_key,
          input.city_key,
          e.id,
          e.version,
        ),
      guard(db),
      audit(
        db,
        user,
        "establishment",
        e.id,
        "updated",
        Object.fromEntries(Object.keys(input).map((k) => [k, e[k]])),
        input,
      ),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/audit" && method === "GET") {
    admin(user);
    const id = url.searchParams.get("entity_id"),
      type = url.searchParams.get("entity_type"),
      before =
        Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
    const rows = (
      await db
        .prepare(
          `SELECT a.*,u.name AS actor_name,u.email AS actor_email FROM audit_log a JOIN users u ON u.id=a.actor_id WHERE a.id<? ${id && type ? "AND a.entity_id=? AND a.entity_type=?" : ""} ORDER BY a.id DESC LIMIT 100`,
        )
        .bind(before, ...(id && type ? [id, type] : []))
        .all()
    ).results;
    return json({
      entries: rows,
      next_before: rows.length === 100 ? rows.at(-1)!.id : null,
    });
  }
  return fail(404, "Operação não encontrada.");
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError)
        res = req.url.includes("/api/")
          ? json({ error: e.message }, e.status)
          : new Response(e.message, { status: e.status });
      else {
        console.error("Request failed", e instanceof Error ? e.name : "Error");
        res = json(
          { error: "Não foi possível concluir. Tente novamente." },
          500,
        );
      }
    }
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-store");
    out.headers.set("X-Content-Type-Options", "nosniff");
    out.headers.set("Referrer-Policy", "no-referrer");
    out.headers.set("X-Frame-Options", "DENY");
    out.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    out.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(req.url).protocol === "https:")
      out.headers.set("Strict-Transport-Security", "max-age=31536000");
    return out;
  },
};
