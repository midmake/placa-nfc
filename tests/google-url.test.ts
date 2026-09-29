import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoogleURL, validateGoogleDestination } from "../src/google-url";
for (const url of [
  "https://www.google.com/maps/place/Example",
  "https://google.com/maps?cid=123",
  "https://maps.google.com/?cid=123",
  "https://www.google.com.br/maps/place/Teste",
  "https://search.google.com/local/writereview?placeid=abc",
  "https://maps.app.goo.gl/AbCd123",
  "https://g.page/r/ABC/review",
  "https://g.page/nome/review",
  "https://goo.gl/maps/Abc123",
])
  test("aceita " + url, () =>
    assert.equal(parseGoogleURL(url).hostname, new URL(url).hostname),
  );
for (const url of [
  "https://evil.com/google.com",
  "https://google.com.evil.com/maps",
  "https://evilgoogle.com/maps",
  "https://google.com@evil.com/maps",
  "https://user:pass@google.com/maps",
  "http://google.com/maps",
  "javascript:alert(1)",
  "https://google.com:444/maps",
  "https://google.com/url?q=https://evil.com",
  "https://www.google.com/amp/s/evil.com",
  "https://sites.google.com/view/anything",
  "https://docs.google.com/document/d/123",
  "https://pay.google.com/",
  "https://maps.google.com/?q=https://evil.com",
  "https://google.com/maps?redirect=https://evil.com",
  "https://google.com/maps?continue=evil",
  "https://google.com/maps/%252e%252e/url",
  "https://maps.app.goo.gl.evil.com/abc",
  "https://goo.gl/anything",
  "https://google.com./maps",
  "https://google.com/maps#external",
  "https://google.com\\@evil.com/maps",
])
  test("recusa " + url, () => assert.throws(() => parseGoogleURL(url)));
test("expande link curto para Google e persiste URL final", async () => {
  const f = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://www.google.com/maps?cid=123" },
    })) as typeof fetch;
  assert.equal(
    await validateGoogleDestination("https://maps.app.goo.gl/abc", f),
    "https://www.google.com/maps?cid=123",
  );
});
test("link curto externo é recusado sem visitar o destino externo", async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.com" },
    });
  }) as typeof fetch;
  await assert.rejects(() =>
    validateGoogleDestination("https://maps.app.goo.gl/abc", f),
  );
  assert.equal(calls, 1);
});
test("recusa link curto que termina em Google /url", async () => {
  const f = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://google.com/url?q=https://evil.com" },
    })) as typeof fetch;
  await assert.rejects(() =>
    validateGoogleDestination("https://g.page/test/review", f),
  );
});
test("loop de redirect é limitado", async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://maps.app.goo.gl/abc" },
    });
  }) as typeof fetch;
  await assert.rejects(() =>
    validateGoogleDestination("https://maps.app.goo.gl/abc", f),
  );
  assert.equal(calls, 5);
});
