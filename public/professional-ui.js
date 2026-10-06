// Shared UI helpers are provided by app.js; no credentials are persisted here.
const commercialLabel = (type) =>
  type === "REVENDEDOR" ? "Revendedor" : "Equipe Gear";
function accessEntry() {
  const match = location.pathname.match(/^\/(convite|redefinir)\/([^/]+)$/);
  if (!match) return false;
  const token = match[2],
    invite = match[1] === "convite";
  history.replaceState(null, "", "/"); // Keep secret only in this form's closure.
  document.body.classList.add("login-view");
  nav.innerHTML = "";
  app.innerHTML = `<section class="panel narrow"><img class="access-logo" src="/gear-go-oficial.png" alt="Gear Go Digital"><h1>${invite ? "Crie seu acesso" : "Redefina sua senha"}</h1><p>Escolha uma senha pessoal com pelo menos 12 caracteres.</p><form id="accept-access"><label>Senha<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirme a senha<input name="confirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="full">${invite ? "Criar meu acesso" : "Salvar nova senha"}</button></form><button id="access-back" class="secondary full">Voltar ao login</button></section>`;
  on("accept-access", "submit", async (e) => {
    const b = values(e);
    if (b.password !== b.confirmation)
      throw new Error("As senhas não coincidem.");
    await api("/access/accept", "POST", { ...b, token });
    me = null;
    login();
    message("Senha definida. Entre com seu e-mail e a nova senha.");
  });
  on("access-back", "click", () => login());
  return true;
}
function forgotPassword() {
  app.innerHTML =
    '<section class="panel narrow"><h1>Recuperar acesso</h1><p>Informe seu e-mail. Se não receber as instruções, fale com o administrador.</p><form id="forgot-form"><label>E-mail<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button class="full">Solicitar recuperação</button></form><button id="forgot-back" class="secondary full">Voltar ao login</button></section>';
  on("forgot-form", "submit", async (e) => {
    const r = await api("/password/forgot", "POST", values(e));
    message(r.message);
  });
  on("forgot-back", "click", () => login());
}
function confirmAdmin(title, phrase) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.innerHTML = `<form id="admin-confirm"><h2>${esc(title)}</h2><p>Confirme sua senha atual de ADMIN.</p><label>Senha atual<input name="current_password" type="password" autocomplete="current-password" maxlength="128" required></label><label>Digite <strong>${esc(phrase)}</strong><input name="confirmation" autocomplete="off" required></label><p class="hint">Esta ação será registrada no histórico.</p><div class="actions"><button class="danger">Confirmar</button><button type="button" id="admin-cancel" class="secondary">Cancelar</button></div></form>`;
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("input").focus();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener("cancel", () => finish(null));
    dialog.querySelector("#admin-cancel").onclick = () => finish(null);
    dialog.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.currentTarget));
      if (v.confirmation !== phrase) {
        message(
          "A confirmação digitada não corresponde ao texto solicitado.",
          true,
        );
        return;
      }
      finish(v);
    };
  });
}
function accessLink(result) {
  const el = document.querySelector("#access-result");
  el.innerHTML = `<section class="match-panel"><h3>${result.delivery === "SENT" ? "E-mail enviado" : result.delivery === "MANUAL" ? "Entrega manual disponível" : "Falha no envio de e-mail"}</h3><p>Compartilhe este link apenas com a pessoa convidada. Exibido somente agora; um reenvio invalida o anterior.</p><label>Link pessoal<input id="private-access-link" readonly value="${esc(result.link)}"></label><button id="copy-access" type="button" class="secondary">Copiar link</button><p>Expira: ${esc(new Date(result.expires_at).toLocaleString("pt-BR"))}</p></section>`;
  on("copy-access", "click", async () => {
    const field = document.querySelector("#private-access-link");
    field.select();
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(field.value);
      message("Link copiado.");
    } else message("Link selecionado: use Copiar.");
  });
  el.scrollIntoView({ block: "center" });
}
async function people(q = "", offset = 0) {
  const data = await api("/people?" + new URLSearchParams({ q, offset }));
  app.innerHTML = `<h1>Usuários</h1><details class="panel create-section"><summary>Convidar usuário</summary><p class="hint">${data.email_ready ? "E-mail automático: configurado. O convite pessoal será enviado por e-mail." : "E-mail automático: não configurado. Copie o link pessoal e envie manualmente ao usuário."}</p><form id="invite-user"><div class="grid"><label>Nome<input name="name" maxlength="160" required></label><label>E-mail<input name="email" type="email" maxlength="254" required></label><label>Tipo<select name="commercial_type"><option value="EQUIPE_GEAR">Equipe Gear</option><option value="REVENDEDOR">Revendedor</option></select></label></div><button>Convidar usuário</button></form></details><div id="access-result" aria-live="polite"></div><form id="people-search" class="search"><label>Nome ou e-mail<input name="q" value="${esc(q)}"></label><button>Buscar</button></form><div class="grid">${
    data.users
      .map((u) => {
        const inviteStatus = u.consumed_at
          ? "Aceito"
          : u.revoked_at
            ? "Cancelado"
            : u.expires_at < Date.now()
              ? "Expirado"
              : "Pendente";
        return `<article class="card"><h2>${esc(u.name)}</h2><p class="wrap">${esc(u.email)}</p><p>${u.role === "ADMIN" ? "Administrador" : commercialLabel(u.commercial_type)} · ${u.archived_at ? "Arquivado" : { INVITED: "Convidado", ACTIVE: "Ativo", SUSPENDED: "Suspenso" }[u.state]}</p>${u.invited_at ? `<p class="hint">Convite: ${inviteStatus}<br>Criado: ${esc(new Date(u.invited_at).toLocaleString("pt-BR"))}<br>Expira: ${esc(new Date(u.expires_at).toLocaleString("pt-BR"))}<br>Entrega: ${esc(u.delivery)}</p>` : ""}<div class="actions">${u.state === "INVITED" && !u.archived_at ? `<button data-person="${esc(u.id)}" data-action="resend">Reenviar convite</button><button class="secondary" data-person="${esc(u.id)}" data-action="cancel">Cancelar convite</button>` : ""}${u.commercial_type === "REVENDEDOR" ? `<button data-balance="${esc(u.id)}" class="secondary">Unidades / saldo</button>` : ""}${u.state === "ACTIVE" && !u.archived_at ? `<button class="secondary" data-person="${esc(u.id)}" data-action="reset-link">Recuperar acesso</button>` : ""}${u.role !== "ADMIN" && !u.archived_at ? `${u.state !== "INVITED" ? `<button class="secondary" data-person="${esc(u.id)}" data-action="state" data-state="${u.state === "ACTIVE" ? "SUSPENDED" : "ACTIVE"}">${u.state === "ACTIVE" ? "Suspender" : "Reativar"}</button>` : ""}<button class="danger" data-person="${esc(u.id)}" data-action="archive">Arquivar</button>` : ""}</div></article>`;
      })
      .join("") || '<p class="empty">Nenhum usuário encontrado.</p>'
  }</div><div class="actions">${offset ? '<button id="people-first" class="secondary">Primeira página</button>' : ""}${data.next_offset !== null ? '<button id="people-more">Próxima página</button>' : ""}</div>`;
  on("invite-user", "submit", async (e) => {
    const b = values(e);
    if (
      !confirm(
        `Convidar ${b.name} (${b.email}) como ${commercialLabel(b.commercial_type)}?`,
      )
    )
      return;
    const r = await api("/invitations", "POST", b);
    await people(q);
    accessLink(r);
  });
  on("people-search", "submit", (e) => people(values(e).q));
  on("people-first", "click", () => people(q));
  on("people-more", "click", () => people(q, data.next_offset));
  app
    .querySelectorAll("[data-balance]")
    .forEach((btn) => onMatch(btn, () => balances(btn.dataset.balance)));
  app.querySelectorAll("[data-person]").forEach((btn) =>
    onMatch(btn, async () => {
      const u = data.users.find((u) => u.id === btn.dataset.person),
        action = btn.dataset.action;
      let b = { state: btn.dataset.state };
      if (action === "archive" || action === "reset-link") {
        b = await confirmAdmin(
          action === "archive"
            ? "Arquivar usuário"
            : "Gerar recuperação de acesso",
          `${action === "archive" ? "ARQUIVAR" : "RECUPERAR"} ${u.email}`,
        );
        if (!b) return;
      } else if (!confirm(`${btn.textContent} para ${u.name}?`)) return;
      const r = await api(`/people/${u.id}/${action}`, "POST", b);
      await people(q, offset);
      if (r.link) accessLink(r);
      else message("Usuário atualizado.");
    }),
  );
}
async function balances(userId = me.id) {
  const rows = await api("/allocations?user_id=" + encodeURIComponent(userId)),
    isAdmin = me.role === "ADMIN";
  const sums = rows.reduce(
    (s, a) => ({
      quantity: s.quantity + a.quantity,
      consumed: s.consumed + a.consumed,
      available: s.available + a.available,
    }),
    { quantity: 0, consumed: 0, available: 0 },
  );
  const lots = isAdmin
    ? (await api("/batches")).filter(
        (b) => !b.archived_at && b.generation_state === "READY",
      )
    : [];
  app.innerHTML = `<h1>Unidades de revenda</h1><div class="stats"><article class="card">Compradas <strong>${sums.quantity}</strong></article><article class="card">Ativadas <strong>${sums.consumed}</strong></article><article class="card">Disponíveis <strong>${sums.available}</strong></article></div>${isAdmin ? `<section class="panel"><h2>Atribuir unidades</h2><form id="allocate"><label>Produto<select name="product"><option value="GOOGLE">Google Reviews</option></select></label><label>Lote<select name="batch_id" required>${lots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.is_test ? " · TESTE" : ""}</option>`).join("")}</select></label><label>Quantidade<input type="number" name="quantity" min="1" max="5000" value="20" required></label><button>Atribuir unidades</button></form></section>` : '<p>O saldo vale para o produto e lote indicado. Ative usando o código da placa física.</p><button id="balance-activate">Ativar placa</button>'}${rows.map((a) => `<article class="card"><h2>${esc(a.batch_name)} ${a.is_test ? "· TESTE" : ""}</h2><p>Google Reviews · Compradas ${a.quantity} · Ativadas ${a.consumed} · Disponíveis ${a.available}</p>${a.archived_at ? '<p class="hint">Lote arquivado: fale com o administrador.</p>' : ""}</article>`).join("") || '<p class="empty">Nenhuma alocação cadastrada.</p>'}<button id="balance-back" class="secondary">Voltar</button>`;
  const requestKey = crypto.randomUUID();
  on("allocate", "submit", async (e) => {
    const b = values(e);
    if (!confirm(`Atribuir ${b.quantity} unidades deste lote ao revendedor?`))
      return;
    await api("/allocations", "POST", {
      ...b,
      quantity: Number(b.quantity),
      user_id: userId,
      request_key: requestKey,
    });
    await balances(userId);
    message("Unidades atribuídas.");
  });
  on("balance-activate", "click", () => go("activate"));
  on("balance-back", "click", () => go(isAdmin ? "users" : "establishments"));
}
async function dashboard() {
  const d = await api("/dashboard"),
    labels = {
      active: "Placas ativas",
      inactive: "Placas inativas",
      blocked: "Placas bloqueadas",
      team: "Equipe Gear ativa",
      resellers: "Revendedores ativos",
      invitations: "Convites pendentes",
      month_activations: "Ativações neste mês",
    };
  app.innerHTML = `<h1>Visão geral</h1><p>Olá, ${esc(me.name)}.</p><div class="quick-actions"><button id="quick-activate">Ativar placa</button><button id="quick-people" class="secondary">Equipe e revendedores</button></div><div class="stats">${Object.entries(
    labels,
  )
    .map(
      ([k, v]) =>
        `<article class="card"><span>${v}</span><strong>${d.counts[k]}</strong></article>`,
    )
    .join(
      "",
    )}</div><section class="panel"><h2>Busca global</h2><form id="global-search" class="search"><label>Código, lote, estabelecimento, nome ou e-mail<input name="q" maxlength="160" required></label><button>Buscar</button></form><div id="global-results"></div></section><section class="panel"><h2>Últimas ativações</h2>${d.recent.map((p) => `<p><button class="secondary" data-trace="${p.id}">${esc(p.physical_code || p.id)}</button> ${esc(p.establishment_name)} · ${esc(p.actor)}<br><small>${esc(new Date(p.activated_at).toLocaleString("pt-BR"))} · ${commercialLabel(p.activation_type)}</small></p>`).join("") || '<p class="empty">Nenhuma ativação ainda.</p>'}</section><section class="panel"><h2>Lotes recentes</h2>${d.batches.map((b) => `<p>${esc(b.name)}${b.is_test ? " · TESTE" : ""}</p>`).join("") || "<p>Nenhum lote.</p>"}<button id="dashboard-lots">Abrir lotes</button></section><details class="panel"><summary>Produtos</summary><div id="products"></div></details>`;
  on("quick-activate", "click", () => go("activate"));
  on("quick-people", "click", () => go("users"));
  on("dashboard-lots", "click", () => go("batches"));
  on("global-search", "submit", (e) => globalSearch(values(e).q));
  bindTrace();
  const products = await api("/products");
  document.querySelector("#products").innerHTML = products
    .map(
      (p) =>
        `<p>${esc(p.name)} — ${p.state === "ACTIVE" ? "Ativo" : "Em breve"}</p>`,
    )
    .join("");
}
async function globalSearch(q, after = "") {
  const d = await api("/search?" + new URLSearchParams({ q, after })),
    container = document.querySelector("#global-results");
  if (!after) container.innerHTML = "";
  container.querySelector("#global-more")?.remove();
  const part = document.createElement("div");
  part.innerHTML =
    d.results
      .map(
        (r) =>
          `<p><strong>${esc(r.title)}</strong><br><small>${esc(r.detail)}</small><br><button class="secondary" data-result-kind="${esc(r.kind)}" data-result="${esc(r.id)}">Abrir</button></p>`,
      )
      .join("") || '<p class="empty">Nenhum resultado.</p>';
  container.append(part);
  part.querySelectorAll("[data-result]").forEach((btn) =>
    onMatch(btn, async () => {
      const { resultKind: kind, result: id } = btn.dataset;
      if (kind === "plate") return tracePlate(id);
      if (kind === "establishment") return estDetail(id);
      if (kind === "user") return people(q);
      return go("batches");
    }),
  );
  if (d.next_after) {
    const b = document.createElement("button");
    b.id = "global-more";
    b.textContent = "Carregar mais";
    container.append(b);
    onMatch(b, () => globalSearch(q, d.next_after));
  }
}
function bindTrace() {
  app
    .querySelectorAll("[data-trace]")
    .forEach((btn) => onMatch(btn, () => tracePlate(btn.dataset.trace)));
}
async function tracePlate(id) {
  const p = await api(`/plates/${id}/trace`);
  app.innerHTML = `<section class="panel"><h1>${esc(plateLabel(p))}</h1><dl>${Object.entries(
    {
      Lote: p.batch_name,
      Produto: p.product,
      Finalidade: p.is_test ? "Teste" : "Real",
      "Ativada por": p.activated_by_name || "Ainda não ativada",
      Tipo: p.activation_type ? commercialLabel(p.activation_type) : "—",
      Data: p.activated_at
        ? new Date(p.activated_at).toLocaleString("pt-BR")
        : "—",
      Estabelecimento: p.establishment_name || "—",
      Alocação: p.allocation_id || "Não se aplica",
      Status: plateStatus(p),
    },
  )
    .map(([k, v]) => `<dt>${k}</dt><dd class="wrap">${esc(v)}</dd>`)
    .join("")}</dl><button id="trace-back">Voltar</button></section>`;
  on("trace-back", "click", () =>
    go(me.role === "ADMIN" ? "dashboard" : "establishments"),
  );
}
async function removeRecord(type, id, name, action) {
  const verb = action === "archive" ? "ARQUIVAR" : "EXCLUIR",
    b = await confirmAdmin(
      action === "archive"
        ? "Arquivar registro"
        : "Excluir dados de teste definitivamente",
      `${verb} ${name}`,
    );
  if (!b) return;
  await api(`/${type}/${id}/${action}`, "POST", b);
  await go(type === "batches" ? "batches" : "establishments");
  message(
    action === "archive"
      ? "Registro arquivado. Histórico e vínculos preservados."
      : "Dados de teste excluídos. A exclusão não pode ser desfeita; o histórico foi preservado.",
  );
}
