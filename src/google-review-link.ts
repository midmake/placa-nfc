import { parseGoogleURL } from "./google-url";

// URL-only strategies: no scraping, no Places API, no invented Place ID.
// Google does not promise stability for Maps !1s/data encodings. Keep them isolated.
export const UNRESOLVED =
  "Não foi possível gerar automaticamente o link de avaliação a partir deste formato. Tente copiar novamente o link pelo botão Compartilhar do Google. Ou cole diretamente o link de avaliação.";
const shortHosts = new Set(["maps.app.goo.gl", "goo.gl", "g.page"]);
export function reviewFromURL(u: URL): string | null {
  if (u.hostname === "g.page" && /\/review\/?$/.test(u.pathname)) return u.href;
  const ids = new Set<string>();
  for (const key of ["placeid", "place_id", "query_place_id"])
    for (const value of u.searchParams.getAll(key)) ids.add(value);
  const query = u.searchParams.get("q") || "";
  if (query.startsWith("place_id:")) ids.add(query.slice(9));
  // Only accept an exposed ChIJ identifier here, never convert CID/hex feature IDs.
  const data = decodeURIComponent(u.pathname + u.search);
  for (const match of data.matchAll(/!1s(ChIJ[A-Za-z0-9_-]{10,200})(?=!|&|$)/g))
    ids.add(match[1]);
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  if (!/^[A-Za-z0-9_-]{10,255}$/.test(id)) return null;
  return (
    "https://search.google.com/local/writereview?placeid=" +
    encodeURIComponent(id)
  );
}
export async function generateReviewLink(
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  let u = parseGoogleURL(input);
  const signal = AbortSignal.timeout(6000); // one budget for the entire chain
  for (let redirects = 0; ; redirects++) {
    const review = reviewFromURL(u);
    if (review) return { url: parseGoogleURL(review).href, identified: true };
    if (!shortHosts.has(u.hostname)) throw new Error(UNRESOLVED);
    if (redirects >= 5)
      throw new Error("O link contém redirecionamentos demais.");
    const res = await fetcher(u.href, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "GearGo-ReviewLink/1.0" },
    });
    // No response body is read or parsed (zero body bytes retained).
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (
      res.status < 300 ||
      res.status > 399 ||
      !location ||
      location.length > 2048
    )
      throw new Error(UNRESOLVED);
    // Validate BEFORE every network hop; literal host allowlist excludes IPs,
    // localhost, metadata, credentials, ports and open redirect Google paths.
    u = parseGoogleURL(new URL(location, u).href);
  }
}
