// Operational screens share authentication, forms and error handling from app.js.
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
async function activationCode(establishmentId = null) {
  document.body.classList.remove("login-view");
  page = "activate";
  menu();
  const qr = pendingQR();
  app.innerHTML = `<section class="panel narrow"><p class="eyebrow">ATIVAÇÃO DE PLACA</p><h1>Confirme o código físico</h1><p class="muted">${qr ? "Você escaneou uma placa. Digite o código impresso nela para continuar." : "Pegue a placa que deseja preparar e digite o código impresso."}</p><form id="verify-code"><label>Código da placa<input name="code" class="physical-code" placeholder="A3009-K7Q2" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" required pattern="[Aa][0-9]{4}-[A-Za-z2-9]{4}"></label><button class="full">Continuar</button></form><p class="hint">A placa só ficará vinculada a você ao concluir o cadastro.</p><button id="cancel-code" class="secondary full">Cancelar</button></section>`;
  on("verify-code", "submit", async (e) => {
    const result = await api("/activation/verify", "POST", {
      code: values(e).code,
      ...(qr ? { qr } : {}),
    });
    await activation(result, establishmentId);
  });
  on("cancel-code", "click", () => {
    clearPending();
    return go(me.role === "ADMIN" ? "batches" : "establishments");
  });
}
async function activation(proof, establishmentId = null) {
  const existing = (await api("/establishments")).filter(
    (e) => e.owner_id === me.id,
  );
  app.innerHTML = `<h1>Ativar ${esc(proof.code)}</h1><p class="muted">Confirmação válida por 15 minutos. Nenhuma placa foi reservada.</p><section class="panel"><h2>Vincular a um cliente existente</h2><form id="link-existing"><label>Estabelecimento<select name="establishment_id" required><option value="">Selecione</option>${existing.map((e) => `<option value="${esc(e.id)}" ${e.id === establishmentId ? "selected" : ""}>${esc(e.name)} · ${esc(e.city)}</option>`).join("")}</select></label><button ${existing.length ? "" : "disabled"}>Concluir ativação</button></form></section><section class="panel"><h2>Cadastrar novo cliente</h2><form id="activate-form">${fields()}<label>Endereço comercial (opcional)<input name="address" maxlength="240" autocomplete="street-address"></label><div id="matches"></div><div class="actions"><button>Concluir ativação</button><button type="button" id="cancel-activation" class="secondary">Cancelar</button></div></form></section>`;
  const finish = async (b) => {
    const r = await api("/activation/complete", "POST", {
      ...b,
      grant: proof.grant,
    });
    clearPending();
    await estDetail(r.establishment_id);
    message("Placa ativada e vinculada ao seu cliente.");
  };
  on("link-existing", "submit", (e) => finish(values(e)));
  on("cancel-activation", "click", () => {
    clearPending();
    return go("establishments");
  });
  on("activate-form", "submit", async (e) => {
    const b = values(e);
    try {
      await finish(b);
    } catch (err) {
      if (!err.data?.matches) throw err;
      const m = document.querySelector("#matches");
      m.innerHTML = `<section class="match-panel"><h3>Encontramos um estabelecimento já cadastrado.</h3><p>Deseja vincular esta placa a ele?</p>${err.data.matches.map((x) => `<button type="button" data-match="${esc(x.id)}">${esc(x.name)} · ${esc(x.city)} · ${esc(x.phone)}</button>`).join("")}<div class="actions"><button type="button" id="force-new" class="secondary">É outra empresa: criar novo</button></div></section>`;
      m.querySelectorAll("[data-match]").forEach((btn) =>
        onMatch(btn, () => finish({ establishment_id: btn.dataset.match })),
      );
      on("force-new", "click", () => finish({ ...b, confirm_new: true }));
      m.scrollIntoView({ block: "center" });
    }
  });
}
function bindEst() {
  app
    .querySelectorAll("[data-est]")
    .forEach((b) => onMatch(b, () => estDetail(b.dataset.est)));
}
function plateCard(p) {
  return `<article class="plate-line"><div><strong class="code-label">${esc(plateLabel(p))}</strong> <span class="badge ${p.blocked ? "blocked" : p.status.toLowerCase()}">${plateStatus(p)}</span><p>${esc(p.establishment_name || "Ainda não ativada")}<br><small>${esc(p.batch_name || "")}</small></p></div><div class="actions">${p.establishment_id ? `<button data-est="${esc(p.establishment_id)}">Cliente</button>` : ""}<a class="button secondary" href="${esc(p.qr_url)}" target="_blank" rel="noopener">Testar QR</a>${me.role === "ADMIN" ? `<button class="secondary" data-block="${p.id}" data-next="${p.blocked ? "false" : "true"}">${p.blocked ? "Desbloquear" : "Bloquear"}</button>${p.status !== "ACTIVE" ? `<button class="secondary" data-assign="${p.id}">Atribuir</button>` : ""}` : ""}</div></article>`;
}
function bindPlateActions(refresh) {
  bindEst();
  app.querySelectorAll("[data-block]").forEach((btn) =>
    onMatch(btn, async () => {
      const blocked = btn.dataset.next === "true";
      if (
        !confirm(
          `${blocked ? "Bloquear" : "Desbloquear"} esta placa? Os vínculos e o histórico serão mantidos.`,
        )
      )
        return;
      await api(`/plates/${btn.dataset.block}/block`, "POST", { blocked });
      await refresh();
      message("Status da placa atualizado.");
    }),
  );
  app
    .querySelectorAll("[data-assign]")
    .forEach((btn) =>
      onMatch(btn, () => assignment("plates", btn.dataset.assign)),
    );
}
async function plates(q = "") {
  if (me.role !== "ADMIN") return establishments();
  const groups = await api("/plate-groups?q=" + encodeURIComponent(q));
  app.innerHTML = `<h1>Placas por vendedor</h1><p class="muted">Placas ativas e atribuições administrativas. Para unidades sem vendedor, use Lotes.</p><form id="plate-search" class="search"><label>Buscar código, vendedor, estabelecimento ou lote<input name="q" value="${esc(q)}"></label><button>Buscar</button></form><div id="groups">${groups.map((g) => `<details class="panel seller-group" data-seller="${esc(g.id)}"><summary><strong>${esc(g.name)}</strong><span>${g.quantity} placa(s) · ${g.activated} ativada(s) · ${g.blocked} bloqueada(s)</span></summary><div class="actions"><button class="secondary" data-bulk="${esc(g.id)}" data-next="true">Bloquear placas do vendedor</button><button class="secondary" data-bulk="${esc(g.id)}" data-next="false">Desbloquear placas do vendedor</button></div><div id="seller-${esc(g.id)}"></div></details>`).join("") || '<section class="panel empty">Nenhuma placa vinculada a vendedores nesta busca.</section>'}</div>${q ? '<section class="panel"><h2>Resultados por placa</h2><div id="search-plates"></div></section>' : ""}`;
  on("plate-search", "submit", (e) => plates(values(e).q));
  for (const d of app.querySelectorAll("[data-seller]"))
    d.addEventListener("toggle", async () => {
      if (d.open && !d.dataset.loaded) {
        try {
          await loadPlatePage(
            document.getElementById("seller-" + d.dataset.seller),
            { owner_id: d.dataset.seller, q },
          );
          d.dataset.loaded = "1";
        } catch (e) {
          message(e.message, true);
        }
      }
    });
  app.querySelectorAll("[data-bulk]").forEach((btn) =>
    onMatch(btn, async () => {
      const blocked = btn.dataset.next === "true";
      if (
        !confirm(
          `${blocked ? "Bloquear" : "Desbloquear"} TODAS as placas vinculadas a este vendedor? Nenhum dado será apagado.`,
        )
      )
        return;
      const r = await api(`/users/${btn.dataset.bulk}/block`, "POST", {
        blocked,
      });
      await plates(q);
      message(`${r.changed} placa(s) atualizada(s).`);
    }),
  );
  if (q) await loadPlatePage(document.querySelector("#search-plates"), { q });
}
async function loadPlatePage(container, filters, after = "") {
  const r = await api("/plates?" + new URLSearchParams({ ...filters, after }));
  const section = document.createElement("div");
  section.innerHTML =
    r.plates.map(plateCard).join("") ||
    '<p class="muted">Nenhuma placa encontrada.</p>';
  container.append(section);
  bindPlateActions(() => plates(filters.q || ""));
  if (r.next_after) {
    const btn = document.createElement("button");
    btn.textContent = "Carregar mais";
    btn.className = "secondary";
    container.append(btn);
    onMatch(btn, async () => {
      btn.remove();
      await loadPlatePage(container, filters, String(r.next_after));
    });
  }
}
async function establishments(params = {}) {
  const rows = await api("/establishments?" + new URLSearchParams(params));
  app.innerHTML = `<div class="row"><div><p class="eyebrow">${me.role === "ADMIN" ? "BASE COMERCIAL" : "SUA OPERAÇÃO"}</p><h1>${me.role === "ADMIN" ? "Estabelecimentos" : "Meus clientes"}</h1></div><button id="new-activation">Ativar placa</button></div><form id="filters" class="search"><label>Nome, telefone ou código<input name="q" value="${esc(params.q)}"></label><label>Cidade<input name="city" value="${esc(params.city)}"></label><label>Segmento<input name="segment" list="segments" value="${esc(params.segment)}">${segmentList()}</label><button>Filtrar</button></form><div class="grid">${
    rows
      .map(
        (e) =>
          `<article class="card client-card"><h2>${esc(e.name)}</h2><p>${esc(e.city)} · ${esc(e.segment)}<br>${esc(e.address || "")}<br>${esc(e.phone)}</p><p class="hint wrap">${esc(e.google_url)}</p><div class="chip-list">${JSON.parse(
            e.plate_summary || "[]",
          )
            .map(
              (p) =>
                `<span class="badge ${p.blocked ? "blocked" : ""}">${esc(p.code)} · ${p.blocked ? "BLOQUEADA" : "ATIVA"}</span>`,
            )
            .join(
              "",
            )}</div><p class="hint">Placas vinculadas: ${e.plate_count}</p><button data-est="${esc(e.id)}">Abrir cliente</button></article>`,
      )
      .join("") ||
    '<section class="panel empty">Seus clientes aparecerão aqui depois da primeira ativação.</section>'
  }</div>${rows.length === 500 ? "<p>Refine os filtros para encontrar outros registros.</p>" : ""}`;
  on("new-activation", "click", () => activationCode());
  on("filters", "submit", (e) => establishments(values(e)));
  bindEst();
}
async function estDetail(id) {
  document.body.classList.remove("login-view");
  const e = await api("/establishments/" + id);
  app.innerHTML = `<h1>${esc(e.name)}</h1><p class="muted">Placas vinculadas: ${e.plates.length}</p><section class="panel"><form id="edit-est">${fields(e)}<label>Endereço comercial (opcional)<input name="address" value="${esc(e.address)}" maxlength="240"></label><p class="hint">Alterar o link atualiza todas as placas deste estabelecimento. Bloqueios continuam sendo respeitados e o histórico é preservado.</p><div class="actions"><button>Salvar alterações</button><button type="button" id="back-est" class="secondary">Voltar</button></div></form></section><section class="panel"><h2>Placas vinculadas</h2>${e.plates.map(plateCard).join("")}<div class="actions">${e.owner_id === me.id ? '<button id="link-more">+ Vincular outra placa</button>' : ""}${me.role === "ADMIN" ? '<button id="est-history" class="secondary">Histórico do estabelecimento</button>' : ""}</div></section>`;
  on("edit-est", "submit", async (ev) => {
    await api("/establishments/" + id, "PATCH", {
      ...values(ev),
      version: e.version,
    });
    await estDetail(id);
    message("Dados atualizados. Histórico preservado.");
  });
  on("back-est", "click", () => go("establishments"));
  on("link-more", "click", () => activationCode(id));
  on("est-history", "click", () => audit("establishment", id));
  bindPlateActions(() => estDetail(id));
}
async function batches() {
  const rows = await api("/batches");
  app.innerHTML = `<div class="row"><div><p class="eyebrow">PRODUÇÃO & OPERAÇÃO</p><h1>Lotes de placas</h1></div><span class="muted">Sem estoque por vendedor</span></div><section class="panel"><h2>Criar lote</h2><form id="create-batch"><div class="grid"><label>Nome do lote<input name="name" required maxlength="100" placeholder="Lote A3009"></label><label>Quantidade<input type="number" name="quantity" min="1" max="5000" value="50" required></label></div><p class="hint">Cada unidade gerada representa uma placa física. Elas nascem sem vendedor.</p><button>Gerar placas</button></form></section><div id="generation-progress" role="status"></div>${rows.map((b) => `<article class="panel batch-card"><div class="row"><h2>${esc(b.name)}</h2><small>${esc(new Date(b.created_at).toLocaleDateString("pt-BR"))}</small></div><div class="lot-counts"><div><span>Total gerado</span><strong>${b.quantity.toLocaleString("pt-BR")}</strong></div><div><span>Ativas</span><strong>${b.active.toLocaleString("pt-BR")}</strong></div><div><span>Inativas</span><strong>${b.inactive.toLocaleString("pt-BR")}</strong></div><div><span>Bloqueadas</span><strong>${b.blocked.toLocaleString("pt-BR")}</strong></div></div>${b.generation_state !== "READY" ? `<p>Geração em andamento: ${b.quantity} / ${b.target_quantity}</p>` : ""}${b.pending_codes ? `<p class="hint">${b.pending_codes} placa(s) antiga(s) precisam receber o novo código físico. As URLs atuais não serão alteradas.</p>` : ""}<div class="actions">${b.generation_state !== "READY" || b.pending_codes ? `<button data-generate="${esc(b.id)}">${b.pending_codes ? "Preparar códigos físicos" : "Continuar geração"}</button>` : `<button data-export="${esc(b.id)}">Gerar PDF / CSV</button>`}<button class="secondary" data-inspect="${esc(b.id)}">Ver placas</button></div><details><summary>Ferramentas administrativas</summary><button class="secondary" data-assign-batch="${esc(b.id)}">Atribuir placas inativas a um vendedor</button></details><div id="batch-${esc(b.id)}"></div></article>`).join("") || '<p class="empty">Nenhum lote criado.</p>'}<p class="hint">Ativas + inativas + bloqueadas = total gerado. Bloqueadas formam uma categoria separada, mesmo quando já ativadas. Sem bloqueio, placas reservadas contam como inativas.</p>`;
  let requestKey = crypto.randomUUID();
  on("create-batch", "submit", async (e) => {
    const b = values(e);
    const r = await api("/batches", "POST", {
      ...b,
      quantity: Number(b.quantity),
      request_key: requestKey,
    });
    await continueGeneration(r.id);
    requestKey = crypto.randomUUID();
  });
  app
    .querySelectorAll("[data-generate]")
    .forEach((btn) =>
      onMatch(btn, () => continueGeneration(btn.dataset.generate)),
    );
  app.querySelectorAll("[data-inspect]").forEach((btn) =>
    onMatch(btn, async () => {
      const el = document.getElementById("batch-" + btn.dataset.inspect);
      el.innerHTML = "";
      await loadPlatePage(el, { batch_id: btn.dataset.inspect });
    }),
  );
  app
    .querySelectorAll("[data-assign-batch]")
    .forEach((btn) =>
      onMatch(btn, () => assignment("batches", btn.dataset.assignBatch)),
    );
  app
    .querySelectorAll("[data-export]")
    .forEach((btn) => onMatch(btn, () => printScreen(btn.dataset.export)));
}
async function continueGeneration(id) {
  // One small request per chunk; refresh/retry resumes the same lot, never restarts it.
  let r;
  do {
    r = await api(`/batches/${id}/generate`, "POST", {});
    message(`Gerando placas: ${r.quantity} / ${r.target}`);
  } while (!r.complete);
  await batches();
  message("Lote pronto. Códigos físicos e URLs gerados.");
}
function assignment(type, id) {
  app.innerHTML = `<section class="panel narrow"><h1>Atribuição administrativa</h1><p>Reserva excepcional de ${type === "batches" ? "placas ainda inativas do lote" : "uma placa inativa"}. Não cria estoque no painel do vendedor.</p><form id="assign"><label>Vendedor<select name="owner_id" required><option value="">Selecione</option>${userOptions()}</select></label><div class="actions"><button>Confirmar atribuição</button><button type="button" id="cancel-assign" class="secondary">Cancelar</button></div></form></section>`;
  on("assign", "submit", async (e) => {
    const r = await api(`/${type}/${id}/assign`, "POST", values(e));
    await go(type === "batches" ? "batches" : "plates");
    message(`${r.changed} placa(s) atribuída(s).`);
  });
  on("cancel-assign", "click", () => go("batches"));
}
async function printScreen(id) {
  const config = await api("/print-config"),
    templates = await (
      await fetch("/print-templates.json", { cache: "no-store" })
    ).json();
  app.innerHTML = `<section class="panel"><p class="eyebrow">MATERIAL PARA GRÁFICA</p><h1>Gerar PDF</h1><p class="wrap">Origem dos QRs: <strong>${esc(config.origin)}</strong></p><form id="print-form"><label>Finalidade<select name="mode"><option value="test">Teste — não enviar à gráfica</option><option value="production" ${config.production_ready ? "" : "disabled"}>Produção — domínio definitivo</option></select></label><label>Template<select name="template">${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.ready ? "" : " · arte pendente"}</option>`).join("")}</select></label><p class="hint">${config.production_ready ? "Ao selecionar produção, confirme a origem definitiva antes de exportar." : "Produção bloqueada até configurar PUBLIC_BASE_URL definitivo e QR_PRODUCTION_READY=true. O modo teste usa a origem atual."}</p><div class="actions"><button>Gerar PDF</button><button type="button" id="csv" class="secondary">Baixar CSV</button><button type="button" id="cancel-print" class="secondary">Voltar</button></div></form><div id="pdf-state" role="status"></div><div id="pdf-downloads"></div><p class="hint">As duas artes finais ainda não foram fornecidas. O gerador não inventa layout: QR, código, medidas e sangria só serão liberados para PDF após aprovação das artes.</p></section>`;
  const opts = () =>
    Object.fromEntries(new FormData(document.querySelector("#print-form")));
  const authorize = async (mode) => {
    if (mode === "production") {
      if (
        !confirm(
          `CONFIRMAR ORIGEM DEFINITIVA: ${config.origin}\n\nEste endereço será impresso e não poderá ser trocado nas placas. Continuar?`,
        )
      )
        return false;
      await api(`/batches/${id}/confirm-production`, "POST", {
        origin: config.origin,
      });
    } else if (
      !confirm(
        "EXPORTAÇÃO DE TESTE. Não envie à gráfica nem venda placas com estas URLs temporárias. Continuar?",
      )
    )
      return false;
    return true;
  };
  on("csv", "click", async () => {
    const { mode } = opts();
    if (await authorize(mode))
      location.href = `/api/batches/${id}/csv?mode=${mode}`;
  });
  on("print-form", "submit", async () => {
    const { mode, template } = opts(),
      selected = templates.find((t) => t.id === template);
    if (!selected?.ready)
      throw new Error(
        "PDF final aguardando as duas artes e as medidas aprovadas. CSV de teste já disponível.",
      );
    if (!(await authorize(mode))) return;
    const mod = await import("/print-client.js");
    await mod.generateBatchPDF({
      batchId: id,
      mode,
      template: selected,
      api,
      onProgress: (s) => (document.querySelector("#pdf-state").textContent = s),
      container: document.querySelector("#pdf-downloads"),
    });
  });
  on("cancel-print", "click", () => go("batches"));
}
