/** Deliberately restrict paths as well as hosts: Google /url can redirect externally.
 * Add verified regional Google domains here, never a google.* regular expression.
 */
export const GOOGLE_DOMAINS = ["google.com", "google.com.br"];
const shortcuts = new Set(["maps.app.goo.gl", "g.page", "goo.gl"]);
export function parseGoogleURL(input: unknown): URL {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error("Informe um link Google válido (até 2048 caracteres).");
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error("Informe a URL completa, começando com https://.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    /[\\\u0000-\u0020]/.test(input.trim())
  )
    throw new Error(
      "Use um link HTTPS do Google, sem credenciais ou fragmentos.",
    );
  const host = u.hostname;
  const google = GOOGLE_DOMAINS.some(
    (d) =>
      host === d ||
      host === `www.${d}` ||
      host === `maps.${d}` ||
      host === `search.${d}`,
  );
  const path = decodeURIComponent(u.pathname);
  // Reject encoded path tricks, open redirect controls and nested external destinations.
  if (path.includes("..") || path.includes("\\") || /%/.test(path))
    throw new Error("Caminho Google inválido.");
  for (const [key, value] of u.searchParams) {
    if (
      /^(url|qurl|continue|redirect|redirect_uri|redirect_url|dest|destination|link|target)$/i.test(
        key,
      ) ||
      /^(https?:)?\/\//i.test(value)
    )
      throw new Error("Link contém redirecionamento não permitido.");
  }
  if (
    google &&
    (/^\/maps(?:\/|$)/.test(path) ||
      path === "/local/writereview" ||
      (host.startsWith("maps.") && path === "/"))
  )
    return u;
  if (host === "maps.app.goo.gl" && /^\/[A-Za-z0-9_-]+\/?$/.test(path))
    return u;
  if (
    host === "g.page" &&
    /^\/(?:r\/)?[A-Za-z0-9_-]+(?:\/review)?\/?$/.test(path)
  )
    return u;
  if (host === "goo.gl" && /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(path)) return u;
  throw new Error(
    "Formato Google não reconhecido. Use o link de avaliação ou compartilhamento do Google Maps; peça ao admin suporte para novos formatos.",
  );
}
export async function validateGoogleDestination(
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let u = parseGoogleURL(input);
  // Resolve short links at registration and store the canonical Google URL.
  // No network request is ever sent to an unvalidated host/path.
  for (let i = 0; shortcuts.has(u.hostname); i++) {
    if (i >= 5)
      throw new Error("O link Google contém redirecionamentos demais.");
    let res: Response;
    try {
      res = await fetcher(u.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "GearGo-LinkValidation/1.0" },
      });
    } catch {
      throw new Error(
        "Não foi possível verificar o link curto. Tente novamente ou cole o link completo do Google Maps.",
      );
    }
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (res.status < 300 || res.status >= 400 || !location)
      throw new Error(
        "Não foi possível expandir o link. Abra-o e copie o endereço completo do Google Maps.",
      );
    u = parseGoogleURL(new URL(location, u).toString());
  }
  return u.toString();
}
