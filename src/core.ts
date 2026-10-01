import { digest, hashPassword, randomToken } from "./security";
import { parseGoogleURL, validateGoogleDestination } from "./google-url";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PASSWORD_PEPPER: string;
  PUBLIC_BASE_URL?: string;
  QR_PRODUCTION_READY?: string;
}
export type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  must_change_password: number;
  password_hash?: string;
};
export type Row = Record<string, any>;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(s: number, m: string): never {
  throw new HttpError(s, m);
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status });
export const key = (s: string) =>
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
export const text = (v: unknown, name: string, max = 160): string =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max
    ? v.trim()
    : fail(400, `${name}: preenchimento obrigatório (até ${max} caracteres).`);
export async function body(req: Request): Promise<Row> {
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
export function scope(user: User, owner: unknown) {
  if (user.role !== "ADMIN" && owner !== user.id)
    fail(404, "Registro não encontrado.");
}
export function admin(user: User) {
  if (user.role !== "ADMIN") fail(403, "Acesso exclusivo do administrador.");
}
export function audit(
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
export function guard(db: D1Database, count = 1) {
  return db
    .prepare(
      "INSERT INTO mutation_guard(ok) VALUES(CASE WHEN changes()=? THEN 1 ELSE 0 END)",
    )
    .bind(count);
}
export async function mutate(db: D1Database, stmts: D1PreparedStatement[]) {
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
export function sessionCookie(token: string, req: Request, age: number) {
  return `gg_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export const cookieToken = (req: Request) =>
  req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)gg_session=([a-f0-9]{64})(?:;|$)/)?.[1];
export async function current(req: Request, db: D1Database): Promise<User> {
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
export async function limitLogin(db: D1Database, email: string, ip: string) {
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
export async function establishmentInput(b: Row, env: Env) {
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
    address:
      typeof b.address === "string" ? b.address.trim().slice(0, 240) : "",
  };
}
export async function getPlate(db: D1Database, id: string, user: User) {
  const p = await db
    .prepare("SELECT * FROM plates WHERE id=?")
    .bind(id)
    .first<Row>();
  if (!p) fail(404, "Placa não encontrada.");
  scope(user, p!.owner_id);
  return p!;
}
export async function getEst(db: D1Database, id: string, user: User) {
  const e = await db
    .prepare("SELECT * FROM establishments WHERE id=?")
    .bind(id)
    .first<Row>();
  if (!e) fail(404, "Estabelecimento não encontrado.");
  scope(user, e!.owner_id);
  return e!;
}
export function baseURL(req: Request, env: Env) {
  const u = new URL(env.PUBLIC_BASE_URL || new URL(req.url).origin);
  if (
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password ||
    !["https:", "http:"].includes(u.protocol)
  )
    throw new Error("Invalid PUBLIC_BASE_URL");
  return u.origin;
}
