import { hashPassword } from "../src/security";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const remote = process.argv.includes("--remote");
let pepper = process.env.PASSWORD_PEPPER;
if (!pepper && !remote) {
  try {
    pepper = readFileSync(".dev.vars", "utf8").match(
      /^PASSWORD_PEPPER\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m,
    )?.[1];
  } catch {}
}
const email = process.env.GG_ADMIN_EMAIL?.trim().toLowerCase(),
  password = process.env.GG_ADMIN_PASSWORD,
  name = process.env.GG_ADMIN_NAME || "Administrador Gear Go";
if (
  !email ||
  !password ||
  password.length < 12 ||
  password.length > 128 ||
  !pepper ||
  pepper.length < 32
) {
  console.error(
    "Defina GG_ADMIN_EMAIL, GG_ADMIN_PASSWORD (12–128 caracteres) e PASSWORD_PEPPER (mínimo 32). Localmente o pepper pode vir de .dev.vars.",
  );
  process.exit(1);
}
const hash = await hashPassword(password, pepper);
const id = crypto.randomUUID();
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const file = `.wrangler/bootstrap-${crypto.randomUUID()}.sql`;
mkdirSync(".wrangler", { recursive: true });
// Bootstrap is intentionally CLI-only: no public endpoint or permanent bootstrap key.
writeFileSync(
  file,
  `INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES(${quote(id)},${quote(name)},${quote(email)},${quote(hash)},'ADMIN',1);\nINSERT INTO audit_log(actor_id,entity_type,entity_id,action,new_data) VALUES(${quote(id)},'user',${quote(id)},'bootstrap',${quote(JSON.stringify({ name, email, role: "ADMIN" }))});`,
  { mode: 0o600 },
);
try {
  const r = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      remote ? "--remote" : "--local",
      "--file",
      file,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) process.exitCode = 1;
  else
    console.log(
      "Administrador criado. Troca de senha obrigatória no primeiro acesso.",
    );
} finally {
  unlinkSync(file);
}
