// Progressive, accessible controls. No form contents are persisted to storage.
let citySuggestions;
let suggestionId = 0;
const suggestionKey = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
function enhanceSuggestions() {
  document
    .querySelectorAll("[data-suggest]:not([data-suggest-ready])")
    .forEach((input) => {
      input.dataset.suggestReady = "1";
      const list = document.createElement("div");
      list.id = "suggestions-" + ++suggestionId;
      list.className = "suggestions";
      list.setAttribute("role", "listbox");
      list.setAttribute(
        "aria-label",
        input.dataset.suggest === "city"
          ? "Cidades sugeridas"
          : "Segmentos sugeridos",
      );
      list.hidden = true;
      input.after(list);
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", list.id);
      input.setAttribute("aria-expanded", "false");
      let items = [],
        selected = -1,
        generation = 0;
      const close = () => {
        generation++;
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
      };
      const other = () => {
        const label = input.form?.querySelector("[data-other-segment]");
        if (input.dataset.suggest !== "segment" || !label) return;
        const active = input.value === "Outros";
        label.hidden = !active;
        label.querySelector("input").disabled = !active;
        label.querySelector("input").required = active;
      };
      const choose = (item) => {
        input.value = item.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      };
      const render = async () => {
        other();
        const request = ++generation;
        const q = suggestionKey(input.value);
        let source;
        if (input.dataset.suggest === "city") {
          citySuggestions ||= api("/cities").then((r) =>
            r.map((name) => ({ value: name, label: name })),
          );
          try {
            source = await citySuggestions;
          } catch {
            citySuggestions = null;
            source = [];
          }
        } else {
          source = categories
            .filter((c) => c.name !== "Outro" && c.name !== "Outros")
            .map((c) => ({ value: c.name, label: c.name }));
        }
        if (
          request !== generation ||
          !input.isConnected ||
          document.activeElement !== input
        )
          return;
        const matches = source.filter((c) =>
          suggestionKey(c.label).includes(q),
        );
        matches.sort(
          (a, b) =>
            Number(suggestionKey(b.label).startsWith(q)) -
            Number(suggestionKey(a.label).startsWith(q)),
        );
        items = matches.slice(0, 12);
        if (input.dataset.suggest === "segment")
          items.push({
            value: "Outros",
            label: "Outros — informar manualmente",
          });
        list.replaceChildren();
        selected = -1;
        input.removeAttribute("aria-activedescendant");
        for (const [i, item] of items.entries()) {
          const option = document.createElement("div");
          option.id = list.id + "-" + i;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.textContent = item.label;
          option.addEventListener("mousedown", (e) => e.preventDefault());
          option.addEventListener("click", () => choose(item));
          list.append(option);
        }
        if (!items.length) {
          const hint = document.createElement("p");
          hint.className = "hint";
          hint.textContent =
            "Sem sugestões. Você pode informar a cidade manualmente.";
          list.append(hint);
        }
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      };
      input.addEventListener("focus", render);
      input.addEventListener("click", render);
      input.addEventListener("input", render);
      input.addEventListener("blur", () => setTimeout(close, 180));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          close();
          return;
        }
        if (e.key === "Enter" && !list.hidden && selected >= 0) {
          e.preventDefault();
          choose(items[selected]);
          return;
        }
        if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        if (list.hidden) {
          render();
          return;
        }
        if (!items.length) return;
        selected =
          (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
        [...list.children].forEach((el, i) =>
          el.setAttribute("aria-selected", String(i === selected)),
        );
        input.setAttribute("aria-activedescendant", list.children[selected].id);
        list.children[selected].scrollIntoView({ block: "nearest" });
      });
      other();
    });
}
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
    enhanceSuggestions();
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
    const button = e.target.closest("[data-copy],[data-copy-field]");
    if (!button) return;
    try {
      const value = button.dataset.copyField
        ? button.closest("form").elements[button.dataset.copyField].value.trim()
        : button.dataset.copy;
      if (!value) return message("Preencha o link antes de copiar.", true);
      await navigator.clipboard.writeText(value);
      message("Copiado.");
    } catch {
      message(
        "Não foi possível copiar. Selecione o código ou link e copie manualmente.",
        true,
      );
    }
  });
})();
