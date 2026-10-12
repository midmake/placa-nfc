import { parseGoogleURL } from "./google-url";

// Deliberately isolated undocumented Google markup. No evaluation of scripts,
// name search, mathematical KGMID conversion, or first-ChIJ guessing.
export const UNRESOLVED =
  "Não foi possível gerar automaticamente o link de avaliação a partir deste formato. Tente copiar novamente o link pelo botão Compartilhar do Google. Ou cole diretamente o link de avaliação.";
export const BLOCKED =
  "O Google bloqueou a consulta automática. Cole diretamente o link de avaliação ou tente novamente mais tarde.";
const searchHosts = new Set([
  "google.com",
  "www.google.com",
  "google.com.br",
  "www.google.com.br",
]);
const KG = /^\/g\/[A-Za-z0-9_-]{1,100}$/;
const PLACE = /^ChIJ[A-Za-z0-9_-]{10,200}$/;
export const MAX_BYTES = 512 * 1024;
export type Review = {
  url: string;
  identified: true;
  placeId?: string;
  name?: string;
};
export const nameKey = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function kgmid(u: URL): string | null {
  const values = u.searchParams.getAll("kgmid");
  return values.length === 1 && KG.test(values[0]) ? values[0] : null;
}
/** Converter-only allowlist. Does not broaden registered QR destination rules. */
export function parseReviewURL(input: unknown, initial = false): URL {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error(UNRESOLVED);
  let value = input.trim();
  if (
    initial &&
    /^(?:share\.google|maps\.app\.goo\.gl|(?:www\.)?google\.com(?:\.br)?|search\.google\.com|g\.page)\//.test(
      value,
    )
  )
    value = "https://" + value;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(UNRESOLVED);
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    /[\\\u0000-\u0020]/.test(value)
  )
    throw new Error(UNRESOLVED);
  if (searchHosts.has(u.hostname) && /^\/sorry(?:\/|$)/.test(u.pathname))
    throw new Error(BLOCKED);
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    throw new Error(UNRESOLVED);
  }
  if (/[\\%]/.test(path) || path.includes("..")) throw new Error(UNRESOLVED);
  for (const [key, val] of u.searchParams)
    if (
      /^(url|qurl|continue|redirect|redirect_uri|redirect_url|dest|destination|link|target)$/i.test(
        key,
      ) ||
      /^(https?:)?\/\//i.test(val)
    )
      throw new Error(UNRESOLVED);
  if (
    initial &&
    u.hostname === "share.google" &&
    /^\/[A-Za-z0-9_-]{1,128}\/?$/.test(path) &&
    !u.search
  )
    return u;
  // Observed first hop from share.google, not a generic Google redirect endpoint.
  if (
    u.hostname === "www.google.com" &&
    path === "/share.google" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(u.searchParams.get("q") || "") &&
    [...u.searchParams.keys()].every((k) => k === "q") &&
    u.searchParams.getAll("q").length === 1
  )
    return u;
  if (searchHosts.has(u.hostname) && path === "/search" && kgmid(u)) return u;
  return parseGoogleURL(value);
}

export function reviewFromURL(u: URL): string | null {
  if (u.hostname === "g.page" && /\/review\/?$/.test(u.pathname)) return u.href;
  const ids = new Set<string>();
  for (const key of ["placeid", "place_id", "query_place_id"])
    for (const value of u.searchParams.getAll(key)) ids.add(value);
  const query = u.searchParams.get("q") || "";
  if (query.startsWith("place_id:")) ids.add(query.slice(9));
  let data: string;
  try {
    data = decodeURIComponent(u.pathname + u.search);
  } catch {
    throw new Error(UNRESOLVED);
  }
  for (const match of data.matchAll(/!1s(ChIJ[A-Za-z0-9_-]{10,200})(?=!|&|$)/g))
    ids.add(match[1]);
  if (ids.size > 1) throw new Error(UNRESOLVED);
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  if (!/^[A-Za-z0-9_-]{10,255}$/.test(id)) throw new Error(UNRESOLVED);
  return (
    "https://search.google.com/local/writereview?placeid=" +
    encodeURIComponent(id)
  );
}
export function reviewResult(url: string, name?: string): Review {
  const u = parseGoogleURL(url);
  return {
    url: u.href,
    identified: true,
    ...(u.searchParams.get("placeid")
      ? { placeId: u.searchParams.get("placeid")! }
      : {}),
    ...(name ? { name } : {}),
  };
}
function entities(s: string): string {
  return s.replace(
    /&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi,
    (v) => {
      const names: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (names[v.toLowerCase()]) return names[v.toLowerCase()];
      const code =
        v[2].toLowerCase() === "x"
          ? parseInt(v.slice(3, -1), 16)
          : Number(v.slice(2, -1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    },
  );
}
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const m of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const key = m[1].toLowerCase();
    if (key in out) throw new Error(UNRESOLVED);
    out[key] = entities(m[2] ?? m[3] ?? m[4]);
  }
  return out;
}

/** Only same-record identity joins. Proximity in a script/text is not evidence.
 * Accept explicit kgmid/mid + placeId in one JSON record, structured
 * sameAs/@id/url links, or attributes on the SAME HTML element.
 * Unlabelled positional AF_initDataCallback arrays are deliberately unsupported.
 * Fixtures represent accepted shapes, NOT captured/verified Senac Google HTML.
 */
export function reviewFromPublicPage(html: string, source: URL): Review {
  const target = kgmid(source);
  if (!target || new TextEncoder().encode(html).length > MAX_BYTES)
    throw new Error(UNRESOLVED);
  if (/g-recaptcha|unusual traffic|detected unusual|\/sorry\/index/i.test(html))
    throw new Error(BLOCKED);
  const expectedName = source.searchParams.get("q") || "";
  const found = new Map<string, Set<string>>();
  const consider = (mid: unknown, ids: unknown[], name: unknown) => {
    if (mid !== target) return;
    if (
      typeof name === "string" &&
      expectedName &&
      nameKey(name) !== nameKey(expectedName)
    )
      throw new Error(UNRESOLVED);
    for (const id of ids) {
      if (typeof id !== "string" || !PLACE.test(id)) continue;
      const names = found.get(id) || new Set<string>();
      if (typeof name === "string" && name.trim() && name.length <= 200)
        names.add(name.trim());
      found.set(id, names);
    }
  };
  const link = (value: unknown) => {
    if (typeof value !== "string") return null;
    try {
      return parseReviewURL(value);
    } catch {
      return null;
    }
  };
  let nodes = 0;
  const visit = (v: unknown, depth = 0): void => {
    if (++nodes > 5000 || depth > 24) throw new Error(UNRESOLVED);
    if (Array.isArray(v)) {
      for (const child of v) visit(child, depth + 1);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const mids = new Set(
      [o.kgmid, o.mid].filter((x) => typeof x === "string" && KG.test(x)),
    );
    const ids: unknown[] = [o.placeId, o.place_id, o.placeid];
    const links = [
      o["@id"],
      o.url,
      ...(Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs]),
    ];
    for (const value of links) {
      const u = link(value);
      if (!u) continue;
      const mid = kgmid(u);
      if (mid) mids.add(mid);
      const review = reviewFromURL(u);
      if (review) ids.push(new URL(review).searchParams.get("placeid"));
    }
    if (mids.has(target) && mids.size !== 1) throw new Error(UNRESOLVED);
    if (mids.size === 1) consider([...mids][0], ids, o.name);
    for (const child of Object.values(o))
      if (child && typeof child === "object") visit(child, depth + 1);
  };
  const withoutScripts = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      (_full, attrs, content) => {
        const a = attributes(attrs);
        if (
          ["application/ld+json", "application/json"].includes(
            (a.type || "").toLowerCase(),
          )
        ) {
          let payload: unknown;
          try {
            payload = JSON.parse(content);
          } catch {
            throw new Error(UNRESOLVED);
          }
          visit(payload);
        }
        return "";
      },
    )
    .replace(/<!--[\s\S]*?-->/g, "");
  for (const m of withoutScripts.matchAll(/<[a-z][^>]{0,8192}>/gi)) {
    const a = attributes(m[0]);
    const mids = [a["data-kgmid"], a["data-mid"]].filter(Boolean);
    const ids: unknown[] = [a["data-place-id"], a["data-placeid"]];
    const u = link(a.href);
    if (u) {
      const mid = kgmid(u);
      if (mid) mids.push(mid);
      const review = reviewFromURL(u);
      if (review) ids.push(new URL(review).searchParams.get("placeid"));
    }
    if (mids.includes(target) && new Set(mids).size > 1)
      throw new Error(UNRESOLVED);
    if (new Set(mids).size === 1) consider(mids[0], ids, a["data-name"]);
  }
  if (found.size !== 1) throw new Error(UNRESOLVED);
  const [id, names] = [...found][0];
  return reviewResult(
    "https://search.google.com/local/writereview?placeid=" + id,
    names.size === 1 ? [...names][0] : undefined,
  );
}

export async function bounded<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        new Error(
          "Tempo esgotado ao consultar o Google. Cole o link de avaliação manualmente.",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function readPage(res: Response, signal: AbortSignal) {
  if (
    !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
      res.headers.get("content-type") || "",
    ) ||
    Number(res.headers.get("content-length") || 0) > MAX_BYTES
  ) {
    await res.body?.cancel();
    throw new Error(UNRESOLVED);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(UNRESOLVED);
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const { done, value } = await bounded(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error(UNRESOLVED);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}
