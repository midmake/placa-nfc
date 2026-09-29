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
  AVAILABLE: "DISPONÍVEL",
  UNASSIGNED: "NÃO ATRIBUÍDA",
};
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
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn(e);
    } catch (err) {
      message(err.message, true);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
const values = (e) => Object.fromEntries(new FormData(e.currentTarget));
function menu() {
  nav.innerHTML =
    me && !me.must_change_password
      ? [
          "plates",
          "establishments",
          ...(me.role === "ADMIN" ? ["batches", "users", "audit"] : []),
          "password",
          "logout",
        ]
          .map(
            (p) =>
              `<button data-page="${p}" class="${p === page ? "selected" : ""}">${{ plates: "Placas", establishments: "Estabelecimentos", batches: "Lotes", users: "Usuários", audit: "Histórico", password: "Senha", logout: "Sair" }[p]}</button>`,
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
    plates,
    establishments,
    batches,
    userList,
    users: userList,
    audit,
    password: passwordForm,
  }[p]();
}
function login() {
  nav.innerHTML = "";
  app.innerHTML = `<section class="panel narrow"><h1>Entrar no painel</h1><p class="muted">Acesso exclusivo da equipe Gear Go Digital.</p><form id="login"><label>E-mail<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Senha<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button>Entrar</button></form><p class="hint">Não há cadastro público. Solicite seu acesso ao administrador.</p></section>`;
  on("login", "submit", async (e) => {
    me = await api("/login", "POST", values(e));
    message("");
    if (me.must_change_password) passwordForm();
    else await start();
  });
}
function passwordForm() {
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
  await go("plates");
}
const userOptions = (selected) =>
  users
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
async function plates(q = "") {
  const data = await api("/plates?q=" + encodeURIComponent(q)),
    count = (s) => data.counts.find((c) => c.status === s)?.quantity || 0;
  app.innerHTML = `<h1>Olá, ${esc(me.name)}</h1><p class="muted">${me.role === "ADMIN" ? "Visão geral de todas as placas." : "Gerencie suas placas e estabelecimentos."}</p><div class="stats"><div class="stat">Disponíveis<strong>${count("AVAILABLE")}</strong></div><div class="stat">Ativas<strong>${count("ACTIVE")}</strong></div>${me.role === "ADMIN" ? `<div class="stat">Não atribuídas<strong>${count("UNASSIGNED")}</strong></div>` : ""}</div><form class="search" id="search"><label>Buscar por estabelecimento ou código<input name="q" value="${esc(q)}" placeholder="Ex.: Barbearia Márcio ou A00001"></label><button>Buscar</button></form><div class="grid">${data.plates.map((p) => `<article class="card"><div class="row"><h2>${esc(p.code)}</h2><span class="badge ${p.status.toLowerCase()}">${status[p.status]}</span></div><p>${esc(p.establishment_name || "Ainda não ativada")}</p>${me.role === "ADMIN" ? `<small>Responsável: ${esc(p.owner_name || "A atribuir")}</small>` : ""}<div class="actions">${p.status === "AVAILABLE" ? `<button data-activate="${p.id}">Ativar</button>` : ""}${p.establishment_id ? `<button data-est="${esc(p.establishment_id)}">Abrir estabelecimento</button>` : ""}<a class="button secondary" target="_blank" rel="noopener" href="${esc(p.qr_url)}">Testar QR</a>${me.role === "ADMIN" && p.status !== "ACTIVE" ? `<button class="secondary" data-assign="${p.id}">Atribuir</button>` : ""}</div></article>`).join("") || '<div class="panel empty">Nenhuma placa encontrada.</div>'}</div>${data.plates.length === data.limit ? "<p>Exibindo até 500 placas. Refine a busca para localizar outras.</p>" : ""}`;
  on("search", "submit", (e) => plates(values(e).q));
  app
    .querySelectorAll("[data-activate]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          activation(
            data.plates.find((p) => p.id === Number(b.dataset.activate)),
          ).catch((e) => message(e.message, true))),
    );
  bindEst();
  app
    .querySelectorAll("[data-assign]")
    .forEach((b) => (b.onclick = () => assignment("plates", b.dataset.assign)));
}
function bindEst() {
  app
    .querySelectorAll("[data-est]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          estDetail(b.dataset.est).catch((e) => message(e.message, true))),
    );
}
async function activation(plate, establishmentId = null) {
  message("");
  const existing = (await api("/establishments")).filter(
    (e) => e.owner_id === plate.owner_id,
  );
  app.innerHTML = `<h1>Ativar ${esc(plate.code)}</h1><p>Vincule a um estabelecimento existente ou cadastre um novo.</p><section class="panel"><h2>Já cadastrado</h2><form id="link-existing"><label>Estabelecimento<select name="establishment_id" required><option value="">Selecione</option>${existing.map((e) => `<option value="${esc(e.id)}" ${e.id === establishmentId ? "selected" : ""}>${esc(e.name)} · ${esc(e.city)} · ${e.plate_count} placa(s)</option>`).join("")}</select></label><button ${existing.length ? "" : "disabled"}>Vincular esta placa</button></form></section><section class="panel"><h2>Novo estabelecimento</h2><form id="activate-form">${fields()}<div id="matches"></div><div class="actions"><button>Verificar e ativar</button><button type="button" id="cancel" class="secondary">Cancelar</button></div></form></section>`;
  const finish = async (b) => {
    const r = await api(`/plates/${plate.id}/activate`, "POST", b);
    await estDetail(r.establishment_id);
    message(`${plate.code} ativada com sucesso.`);
  };
  on("link-existing", "submit", (e) => finish(values(e)));
  on("cancel", "click", () => go("plates"));
  on("activate-form", "submit", async (e) => {
    const b = values(e);
    try {
      await finish(b);
    } catch (err) {
      if (!err.data?.matches) throw err;
      const m = document.querySelector("#matches");
      m.innerHTML = `<div class="panel"><h3>Encontramos um estabelecimento já cadastrado.</h3><p>Deseja vincular esta placa a ele?</p>${err.data.matches.map((x) => `<button class="secondary" type="button" data-match="${esc(x.id)}">${esc(x.name)} · ${esc(x.city)} · ${esc(x.phone)}</button>`).join("")}<p class="hint">Se for outra empresa, confirme abaixo.</p><button type="button" id="force-new" class="secondary">É outro estabelecimento: criar novo</button></div>`;
      m.querySelectorAll("[data-match]").forEach((btn) =>
        onMatch(btn, () => finish({ establishment_id: btn.dataset.match })),
      );
      on("force-new", "click", () => finish({ ...b, confirm_new: true }));
      m.scrollIntoView({ block: "center" });
    }
  });
}
function onMatch(button, fn) {
  button.onclick = async () => {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      message(e.message, true);
    } finally {
      button.disabled = false;
    }
  };
}
async function establishments(params = {}) {
  const rows = await api("/establishments?" + new URLSearchParams(params));
  app.innerHTML = `<h1>${me.role === "ADMIN" ? "Leads / Estabelecimentos" : "Estabelecimentos"}</h1><form id="filters" class="search"><label>Nome, telefone ou código<input name="q" value="${esc(params.q)}"></label><label>Cidade<input name="city" value="${esc(params.city)}"></label><label>Segmento<input name="segment" list="segments" value="${esc(params.segment)}">${segmentList()}</label><button>Filtrar</button></form><div class="grid">${rows.map((e) => `<article class="card"><h2>${esc(e.name)}</h2><p>${esc(e.city)} · ${esc(e.segment)}<br>${esc(e.phone)}</p><small>Placas vinculadas: ${e.plate_count}</small><div class="actions"><button data-est="${esc(e.id)}">Abrir estabelecimento</button></div></article>`).join("") || '<div class="panel empty">Nenhum estabelecimento encontrado.</div>'}</div>${rows.length === 500 ? "<p>Exibindo até 500 registros. Refine os filtros.</p>" : ""}`;
  on("filters", "submit", (e) => establishments(values(e)));
  bindEst();
}
async function estDetail(id) {
  const e = await api("/establishments/" + id);
  app.innerHTML = `<h1>${esc(e.name)}</h1><p class="muted">Placas vinculadas: ${e.plates.length}</p><section class="panel"><form id="edit-est">${fields(e)}<p class="hint">Alterar o link Google atualiza o destino de todas as placas vinculadas. Os dados anteriores ficam no histórico administrativo.</p><div class="actions"><button>Salvar alterações</button><button id="back-est" type="button" class="secondary">Voltar</button></div></form></section><section class="panel"><h2>Placas vinculadas</h2>${e.plates.map((p) => `<div class="row"><strong>${esc(p.code)}</strong><a class="button secondary" href="${esc(p.qr_url)}" target="_blank" rel="noopener">Testar QR</a></div>`).join("")}<div class="actions"><button id="link-more">+ Vincular outra placa</button>${me.role === "ADMIN" ? '<button id="est-history" class="secondary">Consultar histórico</button>' : ""}</div><div id="available-plates"></div></section>`;
  on("edit-est", "submit", async (ev) => {
    await api("/establishments/" + id, "PATCH", {
      ...values(ev),
      version: e.version,
    });
    await estDetail(id);
    message("Estabelecimento atualizado. Histórico preservado.");
  });
  on("back-est", "click", () => go("establishments"));
  on("est-history", "click", () => audit("establishment", id));
  on("link-more", "click", async () => {
    const data = await api("/plates");
    const available = data.plates.filter(
      (p) => p.status === "AVAILABLE" && p.owner_id === e.owner_id,
    );
    document.querySelector("#available-plates").innerHTML =
      `<form id="link-more-form"><label>Placa disponível<select name="plate_id" required><option value="">Selecione</option>${available.map((p) => `<option value="${p.id}">${esc(p.code)}</option>`).join("")}</select></label><button ${available.length ? "" : "disabled"}>Vincular</button>${available.length ? "" : "<p>Nenhuma placa disponível para este responsável.</p>"}</form>`;
    on("link-more-form", "submit", async (ev) => {
      await api(`/plates/${values(ev).plate_id}/activate`, "POST", {
        establishment_id: id,
      });
      await estDetail(id);
      message("Nova placa vinculada.");
    });
  });
}
async function batches() {
  const rows = await api("/batches");
  app.innerHTML = `<h1>Lotes de produção</h1><section class="panel"><h2>Criar lote</h2><form id="create-batch"><div class="grid"><label>Nome do lote<input name="name" required maxlength="100" placeholder="Lote piloto 01"></label><label>Quantidade (1 a 100)<input type="number" name="quantity" min="1" max="100" value="50" required></label><label>Responsável<select name="owner_id"><option value="">Atribuir depois</option>${userOptions()}</select></label></div><button>Gerar placas</button></form></section><div class="grid">${rows.map((b) => `<article class="card"><h2>${esc(b.name)}</h2><p>${b.quantity} placas · ${esc(b.owner_name || "Não atribuído")}</p><div class="actions"><a class="button" href="/api/batches/${esc(b.id)}/csv">Baixar CSV</a><button class="secondary" data-batch="${esc(b.id)}">Atribuir lote</button></div></article>`).join("") || '<p class="empty">Nenhum lote criado.</p>'}</div><p class="hint">O CSV contém código e URL permanente. Use o endereço temporário somente em placas de teste. Não renomeie o Worker após imprimir.</p>`;
  on("create-batch", "submit", async (e) => {
    const b = values(e);
    await api("/batches", "POST", { ...b, quantity: Number(b.quantity) });
    await batches();
    message("Lote criado com códigos e tokens exclusivos.");
  });
  app
    .querySelectorAll("[data-batch]")
    .forEach((b) => (b.onclick = () => assignment("batches", b.dataset.batch)));
}
function assignment(type, id) {
  app.innerHTML = `<section class="panel narrow"><h1>Atribuir ${type === "batches" ? "lote" : "placa"}</h1><form id="assign"><label>Responsável<select name="owner_id" required><option value="">Selecione</option>${userOptions()}</select></label><p class="hint">Placas já ativas não podem ser transferidas neste MVP.</p><div class="actions"><button>Atribuir</button><button type="button" id="cancel-assign" class="secondary">Cancelar</button></div></form></section>`;
  on("assign", "submit", async (e) => {
    await api(`/${type}/${id}/assign`, "POST", values(e));
    await go(type);
    message("Atribuição concluída.");
  });
  on("cancel-assign", "click", () => go(type));
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
async function audit(type = "", id = "", before = "") {
  const data = await api(
    "/audit?" +
      new URLSearchParams({ entity_type: type, entity_id: id, before }),
  );
  app.innerHTML = `<h1>Histórico administrativo</h1><p class="muted">Valores anteriores e novos, autor e data de cada alteração.</p>${data.entries.map((e) => `<article class="panel"><h3>${esc(e.entity_type)} · ${esc(e.action)}</h3><p><small>${esc(new Date(e.created_at).toLocaleString("pt-BR"))} · ${esc(e.actor_name)} (${esc(e.actor_email)})</small></p><small class="wrap">Registro: ${esc(e.entity_id)}</small>${diff(e)}</article>`).join("") || '<p class="empty">Nenhuma alteração registrada.</p>'}${data.next_before ? '<button id="older">Ver registros anteriores</button>' : ""}`;
  on("older", "click", () => audit(type, id, String(data.next_before)));
}
(async () => {
  try {
    me = await api("/me");
    if (me.must_change_password) passwordForm();
    else await start();
  } catch (e) {
    if (!me) login();
    else message(e.message, true);
  }
})();
