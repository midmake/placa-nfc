import {
  BLOCKED,
  UNRESOLVED,
  bounded,
  kgmid,
  nameKey,
  parseReviewURL,
  readPage,
  reviewFromPublicPage,
  reviewFromURL,
  reviewResult,
  type Review,
} from "./google-review-page";
export { UNRESOLVED, reviewFromURL } from "./google-review-page";

const shortHosts = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "g.page",
  "share.google",
]);
// Bounded five-minute isolate cache, success only. No D1 writes or migrations.
const caches = new WeakMap<
  typeof fetch,
  Map<string, { expires: number; result: Review }>
>();
export async function generateReviewLink(
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  let u = parseReviewURL(input, true);
  const signal = AbortSignal.timeout(6000);
  const cache =
    caches.get(fetcher) ||
    new Map<string, { expires: number; result: Review }>();
  caches.set(fetcher, cache);
  const keys = new Set<string>();
  let selectedMid: string | null = null;
  let selectedName = "";
  for (let requests = 0; ; requests++) {
    const mid = kgmid(u);
    if (mid) {
      if (selectedMid && selectedMid !== mid) throw new Error(UNRESOLVED);
      selectedMid = mid;
      selectedName ||= u.searchParams.get("q") || "";
    }
    const key = mid ? "kg:" + mid + ":" + nameKey(selectedName) : u.href;
    keys.add(key);
    const review = reviewFromURL(u); // validate conflicting IDs even on a cache hit
    if (review) {
      // Once KGMID is selected, do not trust a redirect to an unrelated Place ID.
      if (selectedMid && mid !== selectedMid) throw new Error(UNRESOLVED);
      return reviewResult(review);
    }
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.result };
    if (hit) cache.delete(key);
    if (!shortHosts.has(u.hostname) && u.pathname !== "/share.google" && !mid)
      throw new Error(UNRESOLVED);
    if (requests >= 5)
      throw new Error("O link contém redirecionamentos demais.");
    const res = await bounded(
      fetcher(u.href, {
        redirect: "manual",
        credentials: "omit",
        signal,
        headers: { "User-Agent": "GearGo-ReviewLink/1.0", Accept: "text/html" },
      }),
      signal,
    );
    if (res.status >= 300 && res.status <= 399) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || location.length > 2048) throw new Error(UNRESOLVED);
      u = parseReviewURL(new URL(location, u).href); // BEFORE next request
      continue;
    }
    if (!res.ok || !mid) {
      await res.body?.cancel();
      throw new Error(
        res.status === 429 || res.status === 403 ? BLOCKED : UNRESOLVED,
      );
    }
    const source = new URL(u.href);
    if (selectedName) source.searchParams.set("q", selectedName);
    const resolved = reviewFromPublicPage(await readPage(res, signal), source);
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
    for (const k of keys) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(k, { expires: Date.now() + 300000, result: { ...resolved } });
    }
    return resolved;
  }
}
