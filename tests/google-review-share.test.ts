import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { generateReviewLink } from "../src/google-review-link";
import {
  BLOCKED,
  MAX_BYTES,
  UNRESOLVED,
  parseReviewURL,
  reviewFromPublicPage,
} from "../src/google-review-page";

// The redirect paths, KGMID, and business name match the real shared example.
// Payload and Place IDs below are SYNTHETIC: Google returned /sorry/ in the live
// check, so no Senac Place ID or captured Google payload is claimed by fixtures.
const share = "https://share.google/2iEk4mF5TiTm2VuHn";
const hop = "https://www.google.com/share.google?q=2iEk4mF5TiTm2VuHn";
const search =
  "https://www.google.com/search?client=mobilesearchapp&kgmid=/g/1tdz5_5n&q=Senac+Tech&hl=pt_BR";
const id = "ChIJSyntheticSenacFixture0001";
const other = "ChIJSyntheticRelatedFixture02";
const review = "https://search.google.com/local/writereview?placeid=" + id;
const entity = {
  "@type": "EducationalOrganization",
  name: "Senac Tech",
  kgmid: "/g/1tdz5_5n",
  placeId: id,
  address: "Av. Venâncio Aires, 93, Porto Alegre/RS",
};
const page = (
  records: unknown = [
    entity,
    { name: "Outra escola", kgmid: "/g/related", placeId: other },
  ],
) =>
  '<!doctype html><html><script type="application/ld+json">' +
  JSON.stringify(records) +
  "</script></html>";
const response = (html = page()) =>
  new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const redirect = (url: string) =>
  new Response(null, { status: 302, headers: { location: url } });

test("share.google follows observed intermediate, KGMID resolves only same-record Place ID", async () => {
  const seen: string[] = [];
  let signal: AbortSignal | undefined | null;
  const f = (async (url, init) => {
    seen.push(String(url));
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    if (signal) assert.equal(init?.signal, signal);
    signal = init?.signal;
    if (seen.length === 1) return redirect(hop);
    if (seen.length === 2) return redirect(search);
    return response();
  }) as typeof fetch;
  assert.deepEqual(await generateReviewLink(share, f), {
    url: review,
    identified: true,
    placeId: id,
    name: "Senac Tech",
  });
  assert.deepEqual(seen, [share, hop, search]);
  await generateReviewLink(share, f);
  await generateReviewLink(search + "&utm_source=other", f);
  assert.equal(seen.length, 3, "successful share and KGMID cache avoids fetch");
});
for (const input of [
  review,
  "https://google.com/maps?place_id=" + id,
  "https://google.com/maps?query_place_id=" + id,
  "https://google.com/maps?q=place_id:" + id,
  "https://google.com/maps/place/Test/data=!4m2!3m1!1s" + id,
])
  test("explicit identifier has no network: " + input, async () => {
    const r = await generateReviewLink(input, (async () => {
      throw Error("unexpected fetch");
    }) as typeof fetch);
    assert.equal(r.url, review);
  });
test("maps.app.goo.gl and bare share host normalize safely", async () => {
  for (const input of [
    "https://maps.app.goo.gl/Fixture",
    share.replace("https://", ""),
  ])
    assert.equal(
      (
        await generateReviewLink(input, (async () =>
          redirect(review)) as typeof fetch)
      ).url,
      review,
    );
});
for (const bad of [
  "https://evil.com/profile",
  "https://share.google.evil.com/test",
  "https://localhost",
  "https://10.0.0.1",
  "https://169.254.169.254/latest/meta-data",
  "javascript:alert(1)",
  "data:text/html,hello",
  "not a URL",
  "https://share.google/%zz",
  "https://share.google/test?url=https://evil.com",
  "https://www.google.com/search?kgmid=ChIJfake&q=Senac",
  "https://www.google.com/search?kgmid=/g/a&kgmid=/g/b",
  "https://share.google:444/test",
  "https://share.google@test.invalid/test",
])
  test("rejects input without network: " + bad, async () => {
    let calls = 0;
    await assert.rejects(() =>
      generateReviewLink(bad, (async () => {
        calls++;
        return response();
      }) as typeof fetch),
    );
    assert.equal(calls, 0);
  });
test("redirects to external, metadata, and new share origin never fetched", async () => {
  for (const target of [
    "https://evil.com/",
    "https://169.254.169.254/",
    "http://www.google.com/maps",
    share,
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      generateReviewLink(share, (async () => {
        calls++;
        return redirect(target);
      }) as typeof fetch),
    );
    assert.equal(calls, 1);
  }
});
test("redirect count and changed KGMID fail closed", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      generateReviewLink(share, (async () => {
        calls++;
        return redirect(hop);
      }) as typeof fetch),
    /demais/,
  );
  assert.equal(calls, 5);
  calls = 0;
  await assert.rejects(() =>
    generateReviewLink(search, (async () => {
      calls++;
      return redirect(search.replace("1tdz5_5n", "different"));
    }) as typeof fetch),
  );
  assert.equal(calls, 1);
});
test("KGMID ambiguous, missing, unrelated and name-only candidates fail", async () => {
  for (const html of [
    page([entity, { ...entity, placeId: other }]),
    page([{ ...entity, placeId: undefined }]),
    page([{ name: "Senac Tech", placeId: id }]),
    page([{ ...entity, kgmid: "/g/related" }]),
    page([{ ...entity, name: "Senac Outra unidade" }]),
    "<h1>Senac Tech</h1><p>/g/1tdz5_5n " + id + "</p>",
    '<script>AF_initDataCallback({data:["/g/1tdz5_5n","' +
      id +
      '"]});</script>',
    page([
      { kgmid: "/g/1tdz5_5n", related: { name: "Outra unidade", placeId: id } },
    ]),
  ])
    await assert.rejects(
      () =>
        generateReviewLink(search, (async () =>
          response(html)) as typeof fetch),
      { message: UNRESOLVED },
    );
});
test("sameAs and same-element attributes provide explicit identity evidence", () => {
  const structured = { "@id": search, name: "Senac Tech", sameAs: review };
  assert.equal(
    reviewFromPublicPage(page(structured), new URL(search)).placeId,
    id,
  );
  const html =
    '<a data-kgmid="/g/1tdz5_5n" data-name="Senac Tech" href="' +
    review +
    '">Avaliar</a>';
  assert.equal(reviewFromPublicPage(html, new URL(search)).placeId, id);
  assert.throws(() =>
    reviewFromPublicPage(
      '<div data-kgmid="/g/1tdz5_5n"><a href="' +
        review +
        '">Relacionado</a></div>',
      new URL(search),
    ),
  );
});
test("CAPTCHA/block and malformed page fail without caching", async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return redirect(
      "https://www.google.com/sorry/index?continue=https://google.com",
    );
  }) as typeof fetch;
  await assert.rejects(() => generateReviewLink(share, f), {
    message: BLOCKED,
  });
  await assert.rejects(() => generateReviewLink(share, f), {
    message: BLOCKED,
  });
  assert.equal(calls, 2);
  await assert.rejects(
    () =>
      generateReviewLink(search, (async () =>
        response('<div class="g-recaptcha"></div>')) as typeof fetch),
    { message: BLOCKED },
  );
  await assert.rejects(() =>
    generateReviewLink(search, (async () =>
      response(
        '<script type="application/json">{broken}</script>',
      )) as typeof fetch),
  );
});
test("response size and MIME are bounded", async () => {
  for (const res of [
    response("x".repeat(MAX_BYTES + 1)),
    new Response(page(), {
      headers: { "content-type": "application/octet-stream" },
    }),
    new Response(page(), {
      headers: {
        "content-type": "text/html",
        "content-length": String(MAX_BYTES + 1),
      },
    }),
  ])
    await assert.rejects(() =>
      generateReviewLink(search, (async () => res) as typeof fetch),
    );
});
test("whole-chain timeout, including a stalled response stream", async () => {
  for (const body of [false, true]) {
    const controller = new AbortController();
    const timeout = mock.method(
      AbortSignal,
      "timeout",
      () => controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 15);
    try {
      await assert.rejects(
        () =>
          generateReviewLink(search, (async () =>
            body
              ? new Response(new ReadableStream({ start() {} }), {
                  headers: { "content-type": "text/html" },
                })
              : new Promise<Response>(() => {})) as typeof fetch),
        /Tempo esgotado/,
      );
    } finally {
      clearTimeout(timer);
      timeout.mock.restore();
    }
  }
});
test("cache expires, never overrides conflicting Place IDs", async () => {
  let now = 1000000,
    calls = 0;
  const clock = mock.method(Date, "now", () => now);
  const f = (async () => {
    calls++;
    return response();
  }) as typeof fetch;
  try {
    await generateReviewLink(search, f);
    await generateReviewLink(search, f);
    assert.equal(calls, 1);
    await assert.rejects(() =>
      generateReviewLink(
        search + "&placeid=" + id + "&query_place_id=" + other,
        f,
      ),
    );
    now += 300001;
    await generateReviewLink(search, f);
    assert.equal(calls, 2);
  } finally {
    clock.mock.restore();
  }
});
test("converter allowlist is independent from destination validation", () => {
  assert.equal(parseReviewURL(share, true).hostname, "share.google");
  assert.throws(() => parseReviewURL(share));
});
test("commented payload is not profile identity evidence", () => {
  assert.throws(() =>
    reviewFromPublicPage("<!--" + page() + "-->", new URL(search)),
  );
});
