"use strict";
const app = document.querySelector("#app"),
  nav = document.querySelector("#nav"),
  notice = document.querySelector("#notice");
let me = null,
  categories = [],
  users = [],
  page = "plates";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const status = {
  ACTIVE: "ATIVA",
  AVAILABLE: "INATIVA · RESERVADA",
  UNASSIGNED: "INATIVA",
};
const pendingQR = () => GearGoFlow.pendingQR(location.href);
const clearPending = () => history.replaceState(null, "", location.pathname);
const plateLabel = (p) => p.physical_code || p.code;
const plateStatus = (p) => (p.blocked ? "BLOQUEADA" : status[p.status]);
function message(s, error = false) {
  notice.textContent = s;
  notice.className = error ? "error" : "";
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) {
    if (r.status === 401 && path !== "/login") {
      me = null;
      login();
    }
    const e = new Error(b.error || "Falha na operação");
    e.data = b;
    throw e;
  }
  return b;
}
function on(id, event, fn) {
  document.getElementById(id)?.addEventListener(event, async (e) => {
    e.preventDefault();
    const target = e.currentTarget;
    const buttons =
      target.tagName === "FORM"
        ? [...target.querySelectorAll("button")]
        : [target];
    const previousDisabled = buttons.map((b) => b.disabled);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn(e);
    } catch (err) {
      message(err.message, true);
    } finally {
      buttons.forEach((b, i) => (b.disabled = previousDisabled[i]));
    }
  });
}
const values = (e) => Object.fromEntries(new FormData(e.currentTarget));
function menu() {
  nav.innerHTML =
    me && !me.must_change_password
      ? [
          ...(me.role === "ADMIN"
            ? [
                "dashboard",
                "batches",
                "plates",
                "establishments",
                "users",
                "audit",
              ]
            : [
                "establishments",
                ...(me.commercial_type === "REVENDEDOR" ? ["balance"] : []),
              ]),
          "activate",
          "password",
          "logout",
        ]
          .map(
            (p) =>
              `<button data-page="${p}" class="${p === page ? "selected" : ""}">${{ dashboard: "Visão geral", balance: "Meu saldo", plates: "Placas por vendedor", establishments: me.role === "ADMIN" ? "Estabelecimentos" : "Meus clientes", batches: "Lotes", activate: "Ativar placa", users: "Usuários", audit: "Histórico", password: "Senha", logout: "Sair" }[p]}</button>`,
          )
          .join("")
      : "";
  nav
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () =>
          go(b.dataset.page).catch((e) => message(e.message, true))),
    );
}
async function go(p) {
  document.body.classList.remove("login-view");
  message("");
  page = p;
  menu();
  app.innerHTML = "<p>Carregando…</p>";
  if (p === "logout") {
    await api("/logout", "POST", {});
    me = null;
    login();
    return;
  }
  await {
    dashboard,
    balance: balances,
    plates,
    establishments,
    batches,
    userList,
    users: people,
    audit,
    activate: activationCode,
    password: passwordForm,
  }[p]();
}
function login() {
  document.body.classList.add("login-view");
  nav.innerHTML = "";
  app.innerHTML = `<div class="login-layout"><section class="login-intro"><img class="official-logo" src="/gear-go-oficial.png" width="1536" height="512" alt="Gear Go Digital"><p class="eyebrow">GEAR GO DIGITAL</p><h1>Conexões reais.<br>Gestão simples.</h1><p>Suas placas, seus clientes.<br>Tudo no mesmo lugar.</p><div class="signal-line" aria-hidden="true"></div><small>Acesso exclusivo da equipe</small></section><section class="panel login-panel"><h2>${pendingQR() ? "Entre para ativar sua placa" : "Bem-vindo de volta"}</h2><p class="muted">${pendingQR() ? "Depois do login, confirme o código impresso na placa." : "Acesse sua operação Gear Go Digital."}</p><form id="login"><label>E-mail<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Senha<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button class="full">Entrar</button></form><button id="forgot-password" class="secondary full" type="button">Esqueci minha senha</button><p class="hint">Não há cadastro público. Solicite seu acesso ao administrador.</p></section></div>`;
  on("forgot-password", "click", () => forgotPassword());
  on("login", "submit", async (e) => {
    me = await api("/login", "POST", values(e));
    message("");
    if (me.must_change_password) passwordForm();
    else await start();
  });
}
function passwordForm() {
  document.body.classList.remove("login-view");
  menu();
  app.innerHTML = `<section class="panel narrow"><h1>${me.must_change_password ? "Defina sua senha" : "Alterar senha"}</h1><p>${me.must_change_password ? "Antes de continuar, substitua a senha temporária." : "Você entrará novamente após a alteração."}</p><form id="password"><label>Senha atual ou temporária<input name="current_password" type="password" autocomplete="current-password" required maxlength="128"></label><label>Nova senha (mínimo 12 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Repita a nova senha<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button>Salvar nova senha</button></form></section>`;
  on("password", "submit", async (e) => {
    const b = values(e);
    if (b.password !== b.confirmation)
      throw new Error("As senhas não coincidem.");
    await api("/password", "POST", b);
    me = null;
    login();
    message("Senha alterada. Entre com a nova senha.");
  });
}
async function start() {
  categories = await api("/categories");
  if (me.role === "ADMIN") users = await api("/users");
  await go(
    pendingQR()
      ? "activate"
      : me.role === "ADMIN"
        ? "dashboard"
        : "establishments",
  );
}
const userOptions = (selected) =>
  users
    .filter(
      (u) =>
        (!u.state || u.state === "ACTIVE") &&
        !u.archived_at &&
        u.commercial_type !== "REVENDEDOR",
    )
    .map(
      (u) =>
        `<option value="${esc(u.id)}" ${u.id === selected ? "selected" : ""}>${esc(u.name)} · ${esc(u.email)}</option>`,
    )
    .join("");
const segmentList = () =>
  `<datalist id="segments">${categories.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist>`;
function fields(e = {}) {
  return `<div class="grid"><label>Nome do estabelecimento<input name="name" value="${esc(e.name)}" required maxlength="160" autocomplete="organization"></label><label>Cidade<input name="city" value="${esc(e.city)}" required maxlength="100" autocomplete="address-level2"></label><label>Segmento<input name="segment" list="segments" value="${esc(e.segment)}" required maxlength="80" placeholder="Digite para pesquisar">${segmentList()}</label><label>Nome do responsável<input name="responsible" value="${esc(e.responsible)}" required maxlength="160" autocomplete="name"></label><label>Telefone / WhatsApp comercial<input name="phone" type="tel" value="${esc(e.phone)}" required maxlength="30" autocomplete="tel" placeholder="(51) 99999-9999"></label><label>Link de avaliação Google<input name="google_url" type="url" value="${esc(e.google_url)}" required maxlength="2048" placeholder="https://…"></label></div><p class="hint">Informe dados comerciais que você esteja autorizado a fornecer. Usaremos esses dados para operar as placas e manter o histórico administrativo. <a href="/privacidade.html" target="_blank">Entenda o tratamento dos dados</a>.</p>`;
}
async function userList() {
  users = await api("/users");
  app.innerHTML = `<h1>Usuários</h1><section class="panel"><h2>Criar usuário</h2><form id="create-user"><div class="grid"><label>Nome<input name="name" required maxlength="160"></label><label>E-mail<input name="email" type="email" required maxlength="254"></label><label>Senha temporária (opcional)<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="Em branco: gerar senha segura"></label></div><button>Criar usuário</button></form><div id="new-credentials"></div></section><div class="grid">${users.map((u) => `<article class="card"><h2>${esc(u.name)}</h2><p class="wrap">${esc(u.email)}</p><small>${u.role === "ADMIN" ? "Administrador" : "Usuário"}${u.must_change_password ? " · Troca de senha pendente" : ""}</small><div class="actions"><button class="secondary" data-reset="${esc(u.id)}">Resetar senha</button></div><div id="reset-${esc(u.id)}"></div></article>`).join("")}</div>`;
  const credentials = (p) =>
    `<p>Entregue esta senha temporária ao usuário por um canal privado. Ela é exibida somente agora:</p><p class="secret">${esc(p)}</p><p class="hint">A troca será obrigatória no primeiro acesso.</p>`;
  on("create-user", "submit", async (e) => {
    const b = values(e);
    if (!b.password) delete b.password;
    const r = await api("/users", "POST", b);
    await userList();
    document.querySelector("#new-credentials").innerHTML = credentials(
      r.temporary_password,
    );
    message("Usuário criado.");
  });
  app.querySelectorAll("[data-reset]").forEach((btn) =>
    onMatch(btn, async () => {
      if (
        !confirm("Resetar a senha e encerrar todas as sessões deste usuário?")
      )
        return;
      const r = await api(
        `/users/${btn.dataset.reset}/reset-password`,
        "POST",
        {},
      );
      document.getElementById("reset-" + btn.dataset.reset).innerHTML =
        credentials(r.temporary_password);
    }),
  );
}
const fieldNames = {
  name: "Nome",
  city: "Cidade",
  segment: "Segmento",
  responsible: "Responsável",
  phone: "Telefone",
  google_url: "Link Google",
  owner_id: "Responsável interno",
  status: "Status",
  establishment_id: "Estabelecimento",
  quantity: "Quantidade",
  email: "E-mail",
  role: "Perfil",
  code: "Código",
  sessions_revoked: "Sessões encerradas",
  blocked: "Bloqueada",
  address: "Endereço",
};
function diff(entry) {
  const old = JSON.parse(entry.old_data || "{}"),
    now = JSON.parse(entry.new_data || "{}");
  const keys = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter(
    (k) =>
      !["phone_normalized", "name_key", "city_key"].includes(k) &&
      JSON.stringify(old[k]) !== JSON.stringify(now[k]),
  );
  const display = (v) =>
    v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return `<div class="audit"><table><thead><tr><th>Campo</th><th>Anterior</th><th>Novo</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${esc(fieldNames[k] || k)}</td><td>${esc(display(old[k]))}</td><td>${esc(display(now[k]))}</td></tr>`).join("")}</tbody></table></div>`;
}
async function audit(type = "", id = "", before = "", category = "all") {
  const data = await api(
    "/audit?" +
      new URLSearchParams({
        entity_type: type,
        entity_id: id,
        before,
        category,
      }),
  );
  const categories = {
    all: "Todos",
    users: "Usuários",
    batches: "Lotes",
    plates: "Placas",
    activations: "Ativações / Atribuições",
    allocations: "Alocações de revenda",
    establishments: "Estabelecimentos",
    changes: "Alterações de dados / Link",
    blocks: "Bloqueios",
  };
  app.innerHTML = `<h1>Histórico administrativo</h1><label>Natureza da alteração<select id="audit-category">${Object.entries(
    categories,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${k === category ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></label><p class="muted">Mais recentes primeiro. Expanda para consultar os valores.</p>${data.entries.map((e) => `<details class="panel"><summary><strong>${esc(e.entity_type)} · ${esc(e.action)}</strong><br><small>${esc(new Date(e.created_at).toLocaleString("pt-BR"))} · ${esc(e.actor_name)}</small></summary><p><small>${esc(e.actor_email)}</small></p><small class="wrap">Registro: ${esc(e.entity_id)}</small>${diff(e)}</details>`).join("") || '<p class="empty">Nenhuma alteração nesta categoria.</p>'}${data.next_before ? '<button id="older">Ver registros anteriores</button>' : ""}`;
  on("audit-category", "change", (e) => audit(type, id, "", e.target.value));
  on("older", "click", () =>
    audit(type, id, String(data.next_before), category),
  );
}
(async () => {
  if (accessEntry()) return;
  try {
    me = await api("/me");
    if (me.must_change_password) passwordForm();
    else await start();
  } catch (e) {
    if (!me) login();
    else message(e.message, true);
  }
})();
