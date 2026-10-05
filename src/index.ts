import {
  digest,
  hashPassword,
  randomToken,
  validPassword,
  verifyPassword,
} from "./security";
import { parseGoogleURL } from "./google-url";
import { operations, redirectPlate } from "./operations";
import { professional, publicAccounts } from "./professional";
import {
  type Env,
  type User,
  type Row,
  HttpError,
  fail,
  json,
  key,
  text,
  body,
  scope,
  admin,
  audit,
  guard,
  mutate,
  sessionCookie,
  cookieToken,
  current,
  limitLogin,
  establishmentInput,
  getEst,
  baseURL,
} from "./core";
export type { Env } from "./core";
export { normalizePhone } from "./core";
async function route(
  req: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const { DB: db } = env;
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path.startsWith("/r/") && (method === "GET" || method === "HEAD"))
    return redirectPlate(req, env);
  if (/^\/(convite|redefinir)\/[^/]+$/.test(path)) {
    const asset = new URL(req.url);
    asset.pathname = "/";
    asset.search = "";
    return env.ASSETS.fetch(new Request(asset, { method: "GET" }));
  }
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.get("origin") !== url.origin)
      fail(403, "Origem inválida. Atualize a página e tente novamente.");
    if (req.headers.get("sec-fetch-site") === "cross-site")
      fail(403, "Origem inválida.");
  }
  const publicAccount = await publicAccounts(req, env, ctx);
  if (publicAccount) return publicAccount;
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
    if (!u || !valid || u.state !== "ACTIVE" || u.archived_at)
      fail(401, "E-mail ou senha inválidos.");
    const token = randomToken();
    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      db
        .prepare(
          "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) SELECT ?,id,?,? FROM users WHERE id=? AND state='ACTIVE' AND archived_at IS NULL",
        )
        .bind(await digest(token), now + 43200000, now, u.id),
    ]);
    const res = json({
      id: u.id,
      name: u.name,
      role: u.role,
      must_change_password: u.must_change_password,
      commercial_type: u.commercial_type,
      state: u.state,
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
      db
        .prepare(
          "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(Date.now(), user.id),
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
  const pro = await professional(req, env, user);
  if (pro) return pro;
  const operational = await operations(req, env, user);
  if (operational) return operational;
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
            "SELECT id,name,email,role,must_change_password,created_at,commercial_type,state,archived_at FROM users ORDER BY name",
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
      db
        .prepare(
          "UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
        )
        .bind(Date.now(), id),
      audit(db, user, "user", id, "password_reset", null, {
        sessions_revoked: true,
      }),
    ]);
    return json({ temporary_password: password });
  }
  if (path === "/api/establishments" && method === "GET") {
    const clauses = user.role === "ADMIN" ? ["1=1"] : ["e.owner_id=?"];
    if (url.searchParams.get("archived") !== "true" || user.role !== "ADMIN")
      clauses.push("e.archived_at IS NULL");
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
        "(e.name LIKE ? OR e.phone_normalized LIKE ? OR EXISTS(SELECT 1 FROM plates x WHERE x.establishment_id=e.id AND (x.code LIKE ? OR x.physical_code LIKE ?)))",
      );
      args.push(
        `%${q}%`,
        `%${q.replace(/\D/g, "") || "NOT_A_PHONE"}%`,
        `%${q}%`,
        `%${q}%`,
      );
    }
    const rows = (
      await db
        .prepare(
          `SELECT e.*,(SELECT COUNT(*) FROM plates p WHERE p.establishment_id=e.id) AS plate_count,(SELECT json_group_array(json_object('id',p.id,'code',COALESCE(p.physical_code,p.code),'blocked',p.blocked)) FROM plates p WHERE p.establishment_id=e.id) AS plate_summary FROM establishments e WHERE ${clauses.join(" AND ")} ORDER BY e.name LIMIT 500`,
        )
        .bind(...args)
        .all()
    ).results;
    return json(rows);
  }
  match = path.match(/^\/api\/establishments\/([^/]+)$/);
  if (match && method === "GET") {
    const e = await getEst(db, match[1], user);
    const plates = (
      await db
        .prepare(
          "SELECT p.id,p.code,p.physical_code,p.blocked,p.status,p.token,b.name AS batch_name,p.establishment_id FROM plates p JOIN batches b ON b.id=p.batch_id WHERE establishment_id=? ORDER BY p.id",
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
          "UPDATE establishments SET name=?,city=?,segment=?,responsible=?,phone=?,phone_normalized=?,google_url=?,name_key=?,city_key=?,address=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?",
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
          input.address,
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
  return fail(404, "Operação não encontrada.");
}
export default {
  async fetch(
    req: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError)
        res = req.url.includes("/api/")
          ? json({ error: e.message }, e.status)
          : new Response(e.message, { status: e.status });
      else {
        const requestId = crypto.randomUUID();
        console.error(
          JSON.stringify({
            event: "request_failed",
            request_id: requestId,
            method: req.method,
          }),
        );
        res = json(
          {
            error: "Não foi possível concluir. Tente novamente.",
            request_id: requestId,
          },
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
