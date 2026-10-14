import { test } from "node:test";
import assert from "node:assert/strict";
import { MUNICIPALITIES } from "../src/municipalities-data";
import { MUNICIPALITY_LABELS, officialMunicipality } from "../src/municipalities";

test("IBGE snapshot contains all 5571 entries, unique IDs, labels and all 27 UFs", () => {
  assert.equal(MUNICIPALITIES.length, 5571);
  assert.equal(new Set(MUNICIPALITIES.map(([id]) => id)).size, 5571);
  assert.equal(new Set(MUNICIPALITY_LABELS).size, 5571);
  assert.equal(new Set(MUNICIPALITIES.map(([, , uf]) => uf)).size, 27);
  assert.ok(MUNICIPALITY_LABELS.includes("Boa Esperança do Norte / MT"));
  assert.ok(MUNICIPALITY_LABELS.includes("Brasília / DF"));
  for (const label of MUNICIPALITY_LABELS) assert.equal(officialMunicipality(label), label);
});

test("only exact official municipality names; no abbreviations, guesses or ambiguous state", () => {
  assert.equal(officialMunicipality("Porto Alegre"), "Porto Alegre / RS");
  assert.equal(officialMunicipality("portao / rs"), "Portão / RS");
  assert.equal(officialMunicipality("São Paulo / SP"), "São Paulo / SP");
  for (const value of ["Poa", "POA / RS", "Porto Ale", "Porão", "Cidade inventada", "Porto Alegre / SC", "Bom Jesus", "", "<script>"])
    assert.equal(officialMunicipality(value), null, value);
  assert.equal(officialMunicipality("Bom Jesus / RS"), "Bom Jesus / RS");
  assert.equal(officialMunicipality("Bom Jesus / PI"), "Bom Jesus / PI");
});
