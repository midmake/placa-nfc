// Progressive, accessible controls. No form contents are persisted to storage.
(() => {
  const editable =
    "#activate-form,#edit-est,#invite-user,#create-batch,#allocate";
  const dirty = () =>
    document.querySelector(
      `${editable
        .split(",")
        .map((s) => s + '[data-dirty="true"]')
        .join(",")}`,
    );
  const eye =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  function enhance() {
    document
      .querySelectorAll('input[type="password"]:not([data-eye])')
      .forEach((input) => {
        input.dataset.eye = "1";
        const wrap = document.createElement("span");
        wrap.className = "password-control";
        input.before(wrap);
        wrap.append(input);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "password-toggle";
        button.innerHTML = eye;
        button.setAttribute("aria-label", "Mostrar senha");
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          button.setAttribute(
            "aria-label",
            show ? "Ocultar senha" : "Mostrar senha",
          );
          button.setAttribute("aria-pressed", String(show));
        });
        wrap.append(button);
      });
  }
  new MutationObserver(enhance).observe(document.body, {
    childList: true,
    subtree: true,
  });
  enhance();
  document.addEventListener("input", (e) => {
    const form = e.target.closest(editable);
    if (form) form.dataset.dirty = "true";
  });
  document.addEventListener("change", (e) => {
    const form = e.target.closest(editable);
    if (form) form.dataset.dirty = "true";
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener(
    "click",
    (e) => {
      const leave = e.target.closest(
        "[data-page],[data-est],[data-trace],#cancel-activation,#back-est,.brand",
      );
      if (
        leave &&
        dirty() &&
        !confirm("Há alterações não salvas. Sair e descartar o preenchimento?")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-copy]");
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      message("Copiado.");
    } catch {
      message(
        "Não foi possível copiar. Selecione o código ou link e copie manualmente.",
        true,
      );
    }
  });
})();
