async function reviewLink() {
  message("");
  app.innerHTML =
    '<section class="panel narrow"><h1>Gerar link de avaliação</h1><p>Cole aqui o link compartilhado do estabelecimento no Google.</p><form id="review-link-form"><label>Link do estabelecimento<input name="url" type="url" required maxlength="2048" placeholder="https://maps.app.goo.gl/…"></label><button class="full">Gerar link de avaliação</button></form><div id="review-result"></div><p class="hint">Sem API paga. Alguns formatos não permitem conversão automática. Teste o resultado e confira o estabelecimento antes de usar.</p></section>';
  on("review-link-form", "submit", async (e) => {
    document.querySelector("#review-result").replaceChildren();
    const r = await api("/google-review-link", "POST", values(e));
    document.querySelector("#review-result").innerHTML =
      '<h2>Identificador encontrado ✓</h2><p>Confira se o link abre o estabelecimento correto.</p><label>Link de avaliação<input readonly value="' +
      esc(r.url) +
      '"></label><div class="actions"><button type="button" data-copy="' +
      esc(r.url) +
      '">Copiar link</button><a class="button secondary" href="' +
      esc(r.url) +
      '" target="_blank" rel="noopener noreferrer">Testar link</a></div>';
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
