const encoder = new TextEncoder();
export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function equal(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export async function hashPassword(
  password: string,
  pepper: string,
  salt = randomToken(16),
): Promise<string> {
  if (!pepper || pepper.length < 32)
    throw new Error("PASSWORD_PEPPER must contain at least 32 characters");
  const hk = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mixed = await crypto.subtle.sign("HMAC", hk, encoder.encode(password));
  const key = await crypto.subtle.importKey("raw", mixed, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  const hash = Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `pbkdf2-sha256$100000$${salt}$${hash}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const [algorithm, iterations, salt] = stored.split("$");
  if (algorithm !== "pbkdf2-sha256" || iterations !== "100000" || !salt)
    return false;
  return equal(await hashPassword(password, pepper, salt), stored);
}
