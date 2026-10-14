import { MUNICIPALITIES } from "./municipalities-data";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const MUNICIPALITY_LABELS = MUNICIPALITIES.map(([, name, uf]) => `${name} / ${uf}`);
const labels = new Map(MUNICIPALITY_LABELS.map(label => [normalize(label), label]));
const names = new Map<string, string | null>();
for (const label of MUNICIPALITY_LABELS) {
  const name = label.split(" / ")[0].toLowerCase();
  names.set(name, names.has(name) ? null : label);
}
// Exact official names only; old clients may omit UF only for unambiguous names.
// Never guess abbreviations, fuzzy matches, or a state for homonymous cities.
export function officialMunicipality(value: string): string | null {
  const key = normalize(value);
  return labels.get(key) ?? names.get(value.trim().toLowerCase()) ?? null;
}
