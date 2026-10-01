// Only a same-app QR identifier is retained through login/password changes.
// No arbitrary next/return URL is accepted; no credential is stored in Web Storage.
globalThis.GearGoFlow = Object.freeze({
  pendingQR(href) {
    const value = new URL(href).searchParams.get("activate");
    return value && /^A\d{5,}-[a-f0-9]{48}$/.test(value) ? value : null;
  },
});
