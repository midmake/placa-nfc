import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, cmyk } from "pdf-lib";
import {
  mm,
  renderPrintPDF,
  validateTemplate,
  type PrintTemplate,
} from "../src/print/pdf-engine";

// Synthetic geometry fixture only. This is NOT one of the two production arts.
const template: PrintTemplate = {
  id: "technical-fixture",
  name: "Calibração interna",
  ready: true,
  asset: "/print-art/technical-fixture.pdf",
  codeInk: "black",
  layout: {
    widthMm: 100,
    heightMm: 100,
    bleedMm: 3,
    qr: { xMm: 30, yMm: 30, sizeMm: 40 },
    code: { xMm: 20, yMm: 74, widthMm: 60, fontSizePt: 9 },
  },
};
async function artFixture() {
  const doc = await PDFDocument.create(),
    p = doc.addPage([mm(106), mm(106)]),
    font = await doc.embedFont(StandardFonts.Helvetica);
  p.drawRectangle({
    x: mm(3),
    y: mm(3),
    width: mm(100),
    height: mm(100),
    borderColor: cmyk(0, 0, 0, 1),
    borderWidth: 0.3,
  });
  p.drawText("CALIBRACAO INTERNA - NAO E ARTE", {
    x: 20,
    y: mm(94),
    size: 9,
    font,
  });
  return doc.save();
}
const plate = {
  code: "A3009-K7Q2",
  url: "https://qr.example.com/r/A00001-" + "a".repeat(48),
};
test("PDF final permanece bloqueado sem artes e posicionamento aprovados", async () => {
  const templates = JSON.parse(
    readFileSync(
      new URL("../public/print-templates.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(templates.length, 2);
  for (const t of templates) {
    assert.equal(t.ready, false);
    assert.equal(t.asset, null);
    assert.throws(() => validateTemplate(t), /artes finais/);
  }
});
test("PDF mantém milímetros, sangria, TrimBox, uma página por placa e QR vetorial", async () => {
  const bytes = await renderPrintPDF(
    [plate, { ...plate, code: "A3009-ABCD" }],
    template,
    await artFixture(),
    "production",
  );
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  const page = doc.getPage(0);
  assert.ok(Math.abs(page.getWidth() - mm(106)) < 0.01);
  assert.ok(Math.abs(page.getTrimBox().width - mm(100)) < 0.01);
  assert.equal(page.getTrimBox().x, mm(3));
  assert.ok(
    !doc.context
      .enumerateIndirectObjects()
      .some(([, o]) => o.toString().includes("/Subtype /Image")),
  );
  mkdirSync("tmp/pdfs", { recursive: true });
  writeFileSync("tmp/pdfs/calibration.pdf", bytes);
});
test("PDF modo teste é identificado e não pode ser confundido com arquivo final", async () => {
  const bytes = await renderPrintPDF(
    [plate],
    template,
    await artFixture(),
    "test",
  );
  const doc = await PDFDocument.load(bytes);
  assert.match(doc.getTitle()!, /TESTE/);
});
test("PDF recusa arte com tamanho errado, QR denso demais e áreas sobrepostas", async () => {
  const wrong = await PDFDocument.create();
  wrong.addPage([100, 100]);
  const overlap = structuredClone(template);
  overlap.layout!.code.yMm = 35;
  assert.throws(() => validateTemplate(overlap), /sobrepostas/);
  const badSize = await wrong.save();
  await assert.rejects(
    () => renderPrintPDF([plate], template, badSize, "production"),
    /medida/,
  );
  const dense = structuredClone(template);
  dense.layout!.qr.sizeMm = 20;
  const art = await artFixture();
  await assert.rejects(
    () =>
      renderPrintPDF(
        [{ ...plate, url: "https://qr.example.com/" + "a".repeat(700) }],
        dense,
        art,
        "production",
      ),
    /denso/,
  );
});
test("PDF lote de 1000 processável em quatro partes de 250 no navegador", async () => {
  const art = await artFixture();
  let pages = 0;
  for (let part = 0; part < 4; part++) {
    const bytes = await renderPrintPDF(
      Array.from({ length: 250 }, () => plate),
      template,
      art,
      "production",
    );
    pages += (await PDFDocument.load(bytes)).getPageCount();
  }
  assert.equal(pages, 1000);
});
