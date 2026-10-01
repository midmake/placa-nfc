// No customer/session/QR response is ever put in an offline cache.
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .catch(() => {});
let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector("#install-app").hidden = false;
});
document.querySelector("#install-app").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.querySelector("#install-app").hidden = true;
});
window.addEventListener(
  "appinstalled",
  () => (document.querySelector("#install-app").hidden = true),
);
window.addEventListener("offline", () => {
  document.querySelector("#notice").textContent =
    "Você está sem conexão. Conecte-se à internet para continuar.";
});
