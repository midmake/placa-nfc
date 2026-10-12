// Read-only, redacted heuristic scan. Never prints secret values or matching lines.
import { execFileSync } from "node:child_process";
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 128 * 1024 * 1024 });
const refs = git("rev-list", "--objects", "--all")
  .toString()
  .trim()
  .split("\n");
const candidates = [],
  keywords = new Set();
let scanned = 0;
for (const row of refs) {
  const [sha, ...parts] = row.split(" "),
    path = parts.join(" ");
  if (!path || /\.(png|jpe?g|pdf|ico|woff2?)$/i.test(path)) continue;
  const type = git("cat-file", "-t", sha).toString().trim();
  if (type !== "blob") continue;
  const raw = git("cat-file", "-p", sha);
  if (raw.includes(0)) continue;
  scanned++;
  const text = raw.toString();
  if (
    /PASSWORD_PEPPER|RESEND_API_KEY|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|Authorization|Bearer|API_KEY|SECRET|PASSWORD|TOKEN|JWT|\.env|\.dev.vars/i.test(
      text,
    )
  )
    keywords.add(path);
  const checks = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    [
      "known-provider-token",
      /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk_live_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{30,})/,
    ],
    [
      "credential-url",
      /(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s"'@]+:[^\s"'@]+@/,
    ],
    [
      "literal-secret",
      /(?:PASSWORD_PEPPER|RESEND_API_KEY|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'][A-Za-z0-9_-]{28,}["']/,
    ],
  ];
  for (const [kind, pattern] of checks)
    if (pattern.test(text)) candidates.push({ kind, path, blob: sha });
}
console.log(
  JSON.stringify(
    {
      scannedTextBlobs: scanned,
      keywordPaths: [...keywords].sort(),
      candidates,
      limitation:
        "Heuristic: not proof of absence; unreachable objects, deleted remote refs and Actions artifacts not covered.",
    },
    null,
    2,
  ),
);
