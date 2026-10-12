async function reviewLink() {
  message("");
  app.innerHTML = reviewLinkPanel(false);
  bindReviewLink();
}
function reviewLinkPanel(compact) {
  const heading = compact ? "h2" : "h1";
  return `<section class="panel review-quick${compact ? "" : " narrow"}"><${heading}>GERAR LINK DE AVALIAÇÃO DO ESTABELECIMENTO</${heading}><p>Cole o link compartilhado do perfil no Google.</p><form id="review-link-form" class="review-link-form"><label>Link do estabelecimento<input name="url" type="text" inputmode="url" autocapitalize="none" spellcheck="false" required maxlength="2048" placeholder="https://share.google/…"></label><button>GERAR LINK DE AVALIAÇÃO</button></form><div id="review-result" aria-live="polite"></div><p class="hint">Confira o estabelecimento em TESTAR antes de usar. Se o Google não permitir a conversão, informe o link de avaliação manualmente.</p></section>`;
}
function mountReviewQuick() {
  app.insertAdjacentHTML("afterbegin", reviewLinkPanel(true));
  bindReviewLink();
}
function bindReviewLink() {
  on("review-link-form", "submit", async (e) => {
    const form = e.currentTarget;
    const output = form.parentElement.querySelector("#review-result");
    const button = form.querySelector("button");
    const data = values(e);
    output.replaceChildren();
    button.disabled = true;
    try {
      const r = await api("/google-review-link", "POST", data);
      if (!form.isConnected || form.elements.url.value !== data.url) return;
      output.innerHTML =
        "<p><strong>Link de avaliação gerado ✓</strong></p>" +
        (r.name ? "<p>" + esc(r.name) + "</p>" : "") +
        '<label>Link de avaliação<input readonly value="' +
        esc(r.url) +
        '"></label><div class="actions"><button type="button" data-copy="' +
        esc(r.url) +
        '">COPIAR</button><a class="button secondary" href="' +
        esc(r.url) +
        '" target="_blank" rel="noopener noreferrer">TESTAR</a></div>';
    } finally {
      button.disabled = false;
    }
  });
  document
    .querySelector("#review-link-form")
    .elements.url.addEventListener("input", () => {
      document.querySelector("#review-result")?.replaceChildren();
    });
}
// Optional conversion: existing valid destinations remain compatible.
// A failed attempt never replaces or saves the field.
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-generate-review]");
  if (!button) return;
  const input = button.closest("form").elements.google_url;
  const original = input.value;
  button.disabled = true;
  try {
    const r = await api("/google-review-link", "POST", { url: original });
    if (input.isConnected && input.value === original) {
      input.value = r.url;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      message("Link de avaliação gerado ✓. Teste o destino antes de salvar.");
    }
  } catch (err) {
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
});
