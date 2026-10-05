export const PHYSICAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function lotPrefix(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  return (
    "A" +
    parts.find((p) => p.type === "day")!.value +
    parts.find((p) => p.type === "month")!.value
  );
}
/** Rejection sampling avoids modulo bias. DB uniqueness remains authoritative. */
export function physicalCode(
  prefix: string,
  random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a),
): string {
  if (!/^A\d{4}$/.test(prefix)) throw new Error("Invalid lot prefix");
  let suffix = "";
  while (suffix.length < 4)
    for (const n of random(new Uint8Array(8))) {
      if (
        n >=
        Math.floor(256 / PHYSICAL_ALPHABET.length) * PHYSICAL_ALPHABET.length
      )
        continue;
      suffix += PHYSICAL_ALPHABET[n % PHYSICAL_ALPHABET.length];
      if (suffix.length === 4) break;
    }
  return prefix + "-" + suffix;
}
export const normalizeCode = (v: unknown): string =>
  typeof v === "string" ? v.trim().toUpperCase() : "";
export const validPhysicalCode = (v: string) =>
  /^A\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(v);
export const validQrKey = (v: unknown): v is string =>
  typeof v === "string" && /^A\d{5,}-[a-f0-9]{48}$/.test(v);
