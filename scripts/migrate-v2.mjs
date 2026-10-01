import { execFileSync } from "node:child_process";
// Explicit one-file upgrade for the manually initialized production database.
// No replay of 0001 and no manipulation of Wrangler's migrations history.
const remote = process.argv.includes("--remote"),
  apply = process.argv.includes("--apply");
const origin = execFileSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
}).trim();
if (!/^https:\/\/github\.com\/midmake\/placa-nfc(?:\.git)?$/.test(origin))
  throw new Error("Repositório diferente de midmake/placa-nfc. Abortado.");
const location = remote ? "--remote" : "--local";
function query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", location, "--command", sql, "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  const first = out.indexOf("[{") >= 0 ? out.indexOf("[{") : out.indexOf("[\n");
  if (first < 0)
    throw new Error("Resposta D1 inesperada; nenhuma alteração feita.");
  return JSON.parse(out.slice(first)).flatMap((r) => r.results || []);
}
const tables = query("SELECT name FROM sqlite_master WHERE type='table'").map(
  (r) => r.name,
);
if (
  tables.includes("schema_versions") &&
  query("SELECT version FROM schema_versions WHERE version='0002_operations'")
    .length
) {
  console.log("V2 já aplicada. Nenhuma alteração realizada.");
  process.exit(0);
}
for (const table of [
  "users",
  "sessions",
  "login_limits",
  "categories",
  "establishments",
  "batches",
  "plates",
  "audit_log",
  "mutation_guard",
])
  if (!tables.includes(table))
    throw new Error(`Schema inicial incompleto (${table}). Abortado.`);
for (const [table, columns] of [
  ["plates", ["physical_code", "blocked"]],
  [
    "batches",
    [
      "physical_prefix",
      "target_quantity",
      "generation_state",
      "request_key",
      "production_origin",
    ],
  ],
  ["establishments", ["address"]],
]) {
  const existing = query(`PRAGMA table_xinfo(${table})`).map((r) => r.name);
  if (columns.some((c) => existing.includes(c)))
    throw new Error(
      `Migração parcial ou schema divergente em ${table}. Não reaplique SQL: peça revisão.`,
    );
}
if (tables.includes("activation_grants") || tables.includes("schema_versions"))
  throw new Error("Migração parcial detectada. Abortado.");
console.log(
  `Pré-verificação aprovada (${remote ? "PRODUÇÃO" : "local"}). Somente 0002_operations.sql será aplicada.`,
);
if (!apply) {
  console.log(
    "Nenhuma alteração feita. Faça backup e execute npm run db:v2:remote quando estiver pronto.",
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
    "migrations/0002_operations.sql",
  ],
  { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
if (
  !query("SELECT version FROM schema_versions WHERE version='0002_operations'")
    .length
)
  throw new Error("Não foi possível confirmar a versão aplicada.");
console.log("Migração V2 confirmada. Nenhum dado nem segredo foi substituído.");
