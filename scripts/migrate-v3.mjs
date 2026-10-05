import { execFileSync } from "node:child_process";
const origin = execFileSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).trim();
if (!/^https:\/\/github\.com\/midmake\/placa-nfc(?:\.git)?$/.test(origin))
  throw new Error("Repositório incorreto. Abortado.");
const location = process.argv.includes("--remote") ? "--remote" : "--local";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
function query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", location, "--command", sql, "--json"],
    { encoding: "utf8", env },
  );
  const start = out.search(/\[\s*\{/);
  if (start < 0) throw new Error("Resposta D1 inesperada.");
  return JSON.parse(out.slice(start)).flatMap((r) => r.results || []);
}
const tables = query("SELECT name FROM sqlite_master WHERE type='table'").map(
  (r) => r.name,
);
if (
  !tables.includes("schema_versions") ||
  !query("SELECT version FROM schema_versions WHERE version='0002_operations'")
    .length
)
  throw new Error("Aplique e valide 0002 antes de 0003.");
const columns = {
  users: ["commercial_type", "state", "archived_at"],
  batches: ["product", "is_test", "archived_at"],
  establishments: ["is_test", "archived_at"],
  plates: ["activated_by", "activation_type", "allocation_id"],
};
const applied = query(
  "SELECT version FROM schema_versions WHERE version='0003_professional_users'",
).length;
for (const [table, names] of Object.entries(columns)) {
  const actual = query(`PRAGMA table_xinfo(${table})`).map((r) => r.name);
  if (
    applied
      ? names.some((n) => !actual.includes(n))
      : names.some((n) => actual.includes(n))
  )
    throw new Error(
      `Schema parcial/divergente em ${table}. Pare e peça revisão; não reaplique SQL.`,
    );
}
for (const table of ["access_tokens", "allocations"])
  if (Boolean(applied) !== tables.includes(table))
    throw new Error(`Schema parcial/divergente: ${table}.`);
if (query("PRAGMA foreign_key_check").length)
  throw new Error("Violações de integridade existentes; não prosseguir.");
if (applied) {
  console.log("0003 já aplicada e colunas verificadas. Nenhuma alteração.");
  process.exit(0);
}
console.log(`Pré-verificação 0003 aprovada (${location}).`);
if (!process.argv.includes("--apply")) {
  console.log(
    "Somente leitura. Faça backup e obtenha autorização antes de aplicar.",
  );
  process.exit(0);
}
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    location,
    "--file",
    "migrations/0003_professional_users.sql",
  ],
  { stdio: "inherit", env },
);
if (
  !query(
    "SELECT version FROM schema_versions WHERE version='0003_professional_users'",
  ).length ||
  query("PRAGMA foreign_key_check").length
)
  throw new Error("Validação falhou. Não faça deploy; peça revisão.");
console.log(
  "0003 aplicada. Confira contagens e faça deploy somente quando autorizado.",
);
