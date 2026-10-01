import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const source = (p: string) =>
  readFileSync(new URL("../public/" + p, import.meta.url), "utf8");
const qr = "A00001-" + "a".repeat(48);
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}
async function ui({
  logged = false,
  temporary = false,
  url = "https://test.invalid/?activate=" + qr,
} = {}) {
  const dom = new JSDOM(source("index.html"), {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true,
    }),
    w = dom.window as any;
  let signed = logged,
    needsChange = temporary;
  const requests: any[] = [];
  w.fetch = async (path: string, opts: any = {}) => {
    const b = opts.body ? JSON.parse(opts.body) : null;
    requests.push({ path, method: opts.method, b });
    let response: any = {};
    let status = 200;
    if (path === "/api/me") {
      if (signed)
        response = {
          id: "u",
          name: "Gabriel",
          role: "USER",
          must_change_password: Number(needsChange),
        };
      else {
        status = 401;
        response = { error: "Entre" };
      }
    }
    if (path === "/api/login") {
      signed = true;
      response = {
        id: "u",
        name: "Gabriel",
        role: "USER",
        must_change_password: Number(needsChange),
      };
    }
    if (path === "/api/password") {
      signed = false;
      needsChange = false;
      response = { ok: true };
    }
    if (path === "/api/categories") response = [{ name: "Barbearia" }];
    if (path.startsWith("/api/establishments")) response = [];
    if (path === "/api/activation/verify")
      response = { grant: "b".repeat(64), code: "A3009-K7Q2" };
    return { ok: status < 400, status, json: async () => response };
  };
  w.eval(["flow.js", "operations-ui.js", "app.js"].map(source).join("\n"));
  await settle();
  function submit(selector: string, values: Record<string, string>) {
    const form = w.document.querySelector(selector);
    assert.ok(form, selector);
    for (const [k, v] of Object.entries(values))
      form.querySelector(`[name="${k}"]`).value = v;
    form.dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  }
  return { w, dom, requests, submit };
}
test("QR → login → retorno automático → código → formulário compartilhado", async () => {
  const { w, dom, requests, submit } = await ui();
  assert.match(w.document.querySelector("h2").textContent, /Entre para ativar/);
  submit("#login", { email: "seller@test.invalid", password: "temporary" });
  await settle();
  assert.match(w.document.querySelector("h1").textContent, /Confirme o código/);
  submit("#verify-code", { code: "A3009-K7Q2" });
  await settle();
  const verify = requests.find((r) => r.path === "/api/activation/verify");
  assert.equal(verify.b.qr, qr);
  assert.equal(verify.b.code, "A3009-K7Q2");
  assert.ok(w.document.querySelector("#activate-form"));
  assert.ok(!w.document.body.textContent.includes("Placas disponíveis"));
  dom.window.close();
});
test("troca obrigatória de senha não perde a placa aguardando ativação", async () => {
  const { w, dom, submit } = await ui({ logged: true, temporary: true });
  assert.ok(w.document.querySelector("#password"));
  submit("#password", {
    current_password: "old-pass",
    password: "new-password-123",
    confirmation: "new-password-123",
  });
  await settle();
  assert.ok(w.document.querySelector("#login"));
  submit("#login", {
    email: "seller@test.invalid",
    password: "new-password-123",
  });
  await settle();
  assert.ok(w.document.querySelector("#verify-code"));
  assert.equal(w.GearGoFlow.pendingQR(w.location.href), qr);
  dom.window.close();
});
test("painel vendedor sem estoque e sem redirect aberto via parâmetro next", async () => {
  const { w, dom } = await ui({
    logged: true,
    url: "https://test.invalid/?next=https://evil.test&activate=https://evil.test",
  });
  assert.match(w.document.querySelector("h1").textContent, /Meus clientes/);
  assert.equal(w.GearGoFlow.pendingQR(w.location.href), null);
  assert.ok(!w.document.querySelector('[data-page="batches"]'));
  assert.ok(!w.document.querySelector('[data-page="plates"]'));
  dom.window.close();
});
test("manifest/PWA possuem ícones reais, standalone e service worker sem cache sensível", () => {
  const m = JSON.parse(source("manifest.webmanifest"));
  assert.equal(m.name, "Gear Go Digital");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  for (const icon of m.icons) {
    const bytes = readFileSync(
      new URL("../public" + icon.src, import.meta.url),
    );
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const size = Number(icon.sizes.split("x")[0]),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(16), size);
    assert.equal(view.getUint32(20), size);
  }
  assert.match(source("index.html"), /apple-touch-icon/);
  assert.match(source("index.html"), /Adicionar à Tela de Início/);
  assert.ok(!/caches\.(open|match)/.test(source("sw.js")));
});
test("layout mobile declara viewport, controles confortáveis e breakpoints estreitos", () => {
  assert.match(source("index.html"), /width=device-width/);
  assert.match(source("style.css"), /min-height:\s*4[468]px/);
  assert.match(source("style.css"), /max-width:\s*650px/);
  assert.match(source("style.css"), /grid-template-columns:\s*1fr/);
});
