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
  role = "USER",
  commercial_type = "EQUIPE_GEAR",
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
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
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
          role,
          commercial_type,
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
        role,
        commercial_type,
        must_change_password: Number(needsChange),
      };
    }
    if (path === "/api/password") {
      signed = false;
      needsChange = false;
      response = { ok: true };
    }
    if (path === "/api/batches")
      response = [
        {
          id: "lot-real",
          name: "Lote aprovado",
          physical_prefix: "A3009",
          quantity: 1000,
          active: 0,
          inactive: 1000,
          blocked: 0,
          generation_state: "READY",
          pending_codes: 0,
          created_at: Date.now(),
        },
      ];
    if (path === "/api/print-config")
      response = { origin: "https://test.invalid", production_ready: false };
    if (path === "/print-templates.json")
      response = JSON.parse(source("print-templates.json"));
    if (path === "/api/categories") response = [{ name: "Barbearia" }];
    if (path === "/api/dashboard")
      response = {
        counts: {
          active: 7,
          inactive: 13,
          blocked: 0,
          team: 1,
          resellers: 1,
          invitations: 0,
          month_activations: 7,
        },
        recent: [],
        batches: [],
      };
    if (path === "/api/products")
      response = [
        { name: "Google Reviews", state: "ACTIVE" },
        { name: "Instagram", state: "COMING_SOON" },
        { name: "Pix", state: "COMING_SOON" },
      ];
    if (path.startsWith("/api/people?"))
      response = { users: [], next_offset: null, email_ready: false };
    if (path === "/api/invitations")
      response = {
        link: "https://test.invalid/convite/private-token",
        delivery: "MANUAL",
        expires_at: Date.now() + 172800000,
      };
    if (path.startsWith("/api/allocations?") || path === "/api/allocations")
      response = [
        { batch_name: "Lote", quantity: 20, consumed: 7, available: 13 },
      ];
    if (path.startsWith("/api/establishments")) response = [];
    if (path === "/api/activation/verify")
      response = { grant: "b".repeat(64), code: "A3009-K7Q2" };
    return { ok: status < 400, status, json: async () => response };
  };
  w.eval(
    ["flow.js", "operations-ui.js", "professional-ui.js", "app.js", "ux.js"]
      .map(source)
      .join("\n"),
  );
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
test("ativação aceita digitação sem hífen e limpa erro anterior ao editar", async () => {
  const { w, dom } = await ui({ logged: true, role: "ADMIN" });
  const input = w.document.querySelector('#verify-code [name="code"]');
  input.value = "A3009URRW";
  assert.equal(input.checkValidity(), true);
  w.eval('message("Erro anterior", true)');
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.ok(!w.document.body.textContent.includes("Erro anterior"));
  dom.window.close();
});

test("origem confirmada distingue download dos mesmos QRs sem armazenar PDFs", async () => {
  const { w, dom } = await ui({ logged: true, role: "ADMIN" });
  await w.eval('printScreen({id:"lot",name:"A001",quantity:5,physical_prefix:"A3009",is_test:0,production_origin:"https://test.invalid"})');
  assert.match(w.document.querySelector('button[value="production"]').textContent, /mesmos QRs/);
  assert.match(w.document.body.textContent, /Não cria novas placas nem altera os QRs/);
  assert.match(w.document.body.textContent, /não ficam armazenados na plataforma/);
  dom.window.close();
});

test("Equipe GearGo e Revendedores têm entradas, listas e convites separados", async () => {
  const { w, dom, requests } = await ui({ logged: true, role: "ADMIN", url: "https://test.invalid/" });
  w.document.querySelector('#quick-people').click();
  await settle();
  assert.equal(w.document.querySelector('h1').textContent, "Equipe GearGo");
  assert.deepEqual(Array.from(w.document.querySelectorAll('[name="commercial_type"] option')).map((o: any) => o.value), ["EQUIPE_GEAR"]);
  w.document.querySelector('[data-page="resellers"]').click();
  await settle();
  assert.equal(w.document.querySelector('h1').textContent, "Revendedores");
  assert.deepEqual(Array.from(w.document.querySelectorAll('[name="commercial_type"] option')).map((o: any) => o.value), ["REVENDEDOR"]);
  assert.ok(requests.some(r => r.path.includes('type=EQUIPE_GEAR')));
  assert.ok(requests.some(r => r.path.includes('type=REVENDEDOR')));
  dom.window.close();
});

test("dashboard ADMIN, produtos secundários e convite com entrega manual", async () => {
  const { w, dom, requests, submit } = await ui({
    logged: true,
    role: "ADMIN",
    url: "https://test.invalid/",
  });
  assert.match(w.document.body.textContent, /Visão geral/);
  assert.match(w.document.body.textContent, /Instagram — Em breve/);
  w.document.querySelector('[data-page="resellers"]').click();
  await settle();
  assert.match(
    w.document.body.textContent,
    /E-mail automático: não configurado/,
  );
  submit("#invite-user", {
    name: "João",
    email: "joao@test.invalid",
    commercial_type: "REVENDEDOR",
  });
  await settle();
  assert.equal(
    requests.find((r) => r.path === "/api/invitations").b.commercial_type,
    "REVENDEDOR",
  );
  assert.ok(w.document.querySelector("#private-access-link"));
  assert.match(w.document.body.textContent, /Entrega manual disponível/);
  dom.window.close();
});
test("revendedor vê saldo sem estoque de IDs", async () => {
  const { w, dom } = await ui({
    logged: true,
    commercial_type: "REVENDEDOR",
    url: "https://test.invalid/",
  });
  w.document.querySelector('[data-page="balance"]').click();
  await settle();
  assert.match(w.document.body.textContent, /Compradas 20/);
  assert.match(w.document.body.textContent, /Disponíveis 13/);
  assert.ok(w.document.querySelector("#balance-activate"));
  assert.ok(!w.document.querySelector('[data-page="users"]'));
  dom.window.close();
});
test("convite e recuperação mantêm token apenas no formulário e voltam ao login", async () => {
  for (const route of ["convite", "redefinir"]) {
    const token = "a".repeat(64);
    const { w, dom, requests, submit } = await ui({
      url: `https://test.invalid/${route}/${token}`,
    });
    assert.equal(w.location.pathname, "/");
    assert.ok(!requests.some((r) => r.path === "/api/me"));
    submit("#accept-access", {
      password: "new-password-123",
      confirmation: "new-password-123",
    });
    await settle();
    assert.equal(
      requests.find((r) => r.path === "/api/access/accept").b.token,
      token,
    );
    assert.ok(w.document.querySelector("#login"));
    assert.ok(!w.document.body.innerHTML.includes(token));
    dom.window.close();
  }
});
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

test("arte por lote mostra dados reais e mantém produção bloqueada após erro", async () => {
  const { w, dom } = await ui({
    logged: true,
    role: "ADMIN",
    url: "https://test.invalid/",
  });
  w.document.querySelector('[data-page="batches"]').click();
  await settle();
  w.document.querySelector('[data-export="lot-real"]').click();
  await settle();
  assert.equal(
    w.document.querySelector("h1").textContent,
    "Gerar arte para gráfica",
  );
  assert.match(w.document.body.textContent, /A3009/);
  assert.match(w.document.body.textContent, /1.000/);
  assert.match(
    w.document.body.textContent,
    /O domínio oficial ainda não foi validado/,
  );
  assert.equal(w.document.querySelector('[value="production"]').disabled, true);
  const form = w.document.querySelector("#print-form");
  form.querySelector('[name="template"]').value = "missing";
  form.dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  await settle();
  assert.equal(
    w.document.querySelector('button[value="production"]').disabled,
    true,
  );
  assert.equal(
    w.document.querySelector('button[value="test"]').disabled,
    false,
  );
  assert.match(
    w.document.querySelector("#notice").textContent,
    /arte aprovada/,
  );
  dom.window.close();
});
test("marca oficial transparente e favicon PNG integram login e PWA", () => {
  const logo = readFileSync("public/gear-go-oficial.png");
  assert.equal(logo[25], 6); // PNG RGBA, not an opaque JPEG.
  assert.match(source("index.html"), /gear-go-oficial\.png/);
  assert.match(source("app.js"), /gear-go-oficial\.png/);
  assert.match(source("index.html"), /icons\/favicon\.png/);
  const m = JSON.parse(source("manifest.webmanifest"));
  assert.equal(m.theme_color, "#102748");
  assert.equal(
    m.icons.find((i: any) => i.purpose === "maskable").sizes,
    "512x512",
  );
});

test("olho da senha alterna visibilidade sem mudar valor e sem enviar formulário", async () => {
  const { w, dom, requests } = await ui({ url: "https://test.invalid/" });
  const input = w.document.querySelector('#login input[name="password"]');
  input.value = "typed-password";
  const toggle = w.document.querySelector("#login .password-toggle");
  assert.ok(toggle);
  toggle.click();
  assert.equal(input.type, "text");
  assert.equal(input.value, "typed-password");
  assert.equal(toggle.getAttribute("aria-label"), "Ocultar senha");
  toggle.click();
  assert.equal(input.type, "password");
  assert.ok(!requests.some((r) => r.path === "/api/login"));
  dom.window.close();
});
test("navegação compacta mantém menu administrativo e protege formulário alterado", async () => {
  const { w, dom } = await ui({
    logged: true,
    role: "ADMIN",
    url: "https://test.invalid/",
  });
  assert.ok(w.document.querySelector('.nav-more [data-page="users"]'));
  w.document.querySelector('[data-page="batches"]').click();
  await settle();
  const input = w.document.querySelector('#create-batch input[name="name"]');
  input.value = "Lote ainda não salvo";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  w.confirm = () => false;
  w.document.querySelector('[data-page="dashboard"]').click();
  await settle();
  assert.equal(
    w.document.querySelector('#create-batch input[name="name"]').value,
    "Lote ainda não salvo",
  );
  w.confirm = () => true;
  w.document.querySelector('[data-page="dashboard"]').click();
  await settle();
  assert.match(w.document.body.textContent, /Visão geral/);
  dom.window.close();
});
test("filtros de lote e prévia não confundem lote comercial com PDF de teste", async () => {
  const { w, dom, submit } = await ui({
    logged: true,
    role: "ADMIN",
    url: "https://test.invalid/",
  });
  w.document.querySelector('[data-page="batches"]').click();
  await settle();
  submit("#batch-filters", { q: "inexistente", kind: "", state: "" });
  await settle();
  assert.equal(w.document.querySelectorAll("[data-export]").length, 0);
  w.document.querySelector("#clear-batches").click();
  await settle();
  w.document.querySelector("[data-export]").click();
  await settle();
  assert.match(w.document.body.textContent, /LOTE COMERCIAL/);
  assert.ok(w.document.querySelector("#preview-print"));
  assert.equal(
    w.document.querySelector('button[value="production"]').disabled,
    true,
  );
  dom.window.close();
});
