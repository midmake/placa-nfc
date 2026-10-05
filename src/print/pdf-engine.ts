import { PDFDocument, StandardFonts, cmyk } from "pdf-lib";
import QRCode from "qrcode";
export type PrintPlate = { code: string; url: string };
export type PrintLayout = {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  qr: { xMm: number; yMm: number; sizeMm: number; symbolSizeMm?: number };
  code: { xMm: number; yMm: number; widthMm: number; fontSizePt: number };
};
export type PrintTemplate = {
  id: string;
  name: string;
  ready: boolean;
  asset: string | null;
  layout: PrintLayout | null;
  codeInk: "black" | "white";
};
export const mm = (value: number) => (value * 72) / 25.4;
export function validateTemplate(template: PrintTemplate): PrintLayout {
  if (!template.ready || !template.asset || !template.layout)
    throw new Error(
      "As artes finais e suas medidas ainda não foram fornecidas.",
    );
  const l = template.layout,
    values = [
      l.widthMm,
      l.heightMm,
      l.bleedMm,
      l.qr.xMm,
      l.qr.yMm,
      l.qr.sizeMm,
      l.code.xMm,
      l.code.yMm,
      l.code.widthMm,
      l.code.fontSizePt,
    ];
  if (
    values.some((v) => !Number.isFinite(v)) ||
    l.widthMm <= 0 ||
    l.heightMm <= 0 ||
    l.bleedMm < 0 ||
    l.bleedMm > 10 ||
    l.qr.sizeMm < 20 ||
    l.code.fontSizePt < 6 ||
    l.code.widthMm <= 0
  )
    throw new Error("Medidas de impressão inválidas.");
  if (
    l.qr.symbolSizeMm !== undefined &&
    (!Number.isFinite(l.qr.symbolSizeMm) ||
      l.qr.symbolSizeMm <= 0 ||
      l.qr.symbolSizeMm >= l.qr.sizeMm)
  )
    throw new Error("Medida do símbolo QR inválida.");
  for (const area of [
    { x: l.qr.xMm, y: l.qr.yMm, w: l.qr.sizeMm, h: l.qr.sizeMm },
    {
      x: l.code.xMm,
      y: l.code.yMm,
      w: l.code.widthMm,
      h: ((l.code.fontSizePt * 25.4) / 72) * 1.3,
    },
  ]) {
    if (
      area.x < 0 ||
      area.y < 0 ||
      area.x + area.w > l.widthMm ||
      area.y + area.h > l.heightMm
    )
      throw new Error("QR ou código fora da área de corte.");
  }
  if (
    l.code.xMm < l.qr.xMm + l.qr.sizeMm &&
    l.code.xMm + l.code.widthMm > l.qr.xMm &&
    l.code.yMm < l.qr.yMm + l.qr.sizeMm &&
    l.code.yMm + ((l.code.fontSizePt * 25.4) / 72) * 1.3 > l.qr.yMm
  )
    throw new Error("Áreas de QR e código sobrepostas.");
  return l;
}
/** One plate/page, exact MediaBox, TrimBox and BleedBox; coordinates from trim top-left.
 * QR is drawn as vector rectangles with a FOUR-module white quiet zone.
 * No CDN, raster QR, server rendering or unapproved print art.
 */
export async function renderPrintPDF(
  plates: PrintPlate[],
  template: PrintTemplate,
  art: Uint8Array,
  mode: "test" | "production",
  progress?: (done: number) => void,
): Promise<Uint8Array> {
  const l = validateTemplate(template);
  if (!plates.length || plates.length > 250)
    throw new Error("Use partes de 1 a 250 placas.");
  const source = await PDFDocument.load(art);
  if (source.getPageCount() !== 1)
    throw new Error("A arte precisa conter exatamente uma página.");
  const width = mm(l.widthMm + 2 * l.bleedMm),
    height = mm(l.heightMm + 2 * l.bleedMm),
    size = source.getPage(0).getSize();
  if (
    Math.abs(size.width - width) > 0.5 ||
    Math.abs(size.height - height) > 0.5
  )
    throw new Error(
      "A medida do PDF da arte não corresponde ao formato com sangria.",
    );
  const doc = await PDFDocument.create(),
    [background] = await doc.embedPdf(source, [0]),
    font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(
    mode === "test"
      ? "TESTE - NAO ENVIAR A GRAFICA"
      : "Gear Go Digital - Placas",
  );
  doc.setProducer("Gear Go Digital");
  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i],
      u = new URL(plate.url);
    if (
      !/^A\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(plate.code) ||
      !["https:", "http:"].includes(u.protocol)
    )
      throw new Error("Dados de placa inválidos.");
    const page = doc.addPage([width, height]);
    page.setTrimBox(
      mm(l.bleedMm),
      mm(l.bleedMm),
      mm(l.widthMm),
      mm(l.heightMm),
    );
    page.setBleedBox(0, 0, width, height);
    page.drawPage(background, { x: 0, y: 0, width, height });
    const qr = QRCode.create(plate.url, { errorCorrectionLevel: "M" }),
      n = qr.modules.size,
      side = mm(l.qr.sizeMm),
      unit =
        l.qr.symbolSizeMm === undefined
          ? side / (n + 8)
          : mm(l.qr.symbolSizeMm) / n,
      padding = (side - n * unit) / 2;
    if (padding + 0.00001 < 4 * unit)
      throw new Error(
        "A área aprovada não comporta a margem livre de quatro módulos do QR.",
      );
    if (unit < mm(0.35))
      throw new Error(
        "QR denso demais para esta área. Aumente o QR ou reduza o comprimento da origem.",
      );
    const x = mm(l.bleedMm + l.qr.xMm),
      y = height - mm(l.bleedMm + l.qr.yMm + l.qr.sizeMm);
    page.drawRectangle({
      x,
      y,
      width: side,
      height: side,
      color: cmyk(0, 0, 0, 0),
    });
    // Merge horizontal runs to reduce PDF size without sacrificing vector geometry.
    for (let row = 0; row < n; row++)
      for (let col = 0; col < n; col++)
        if (qr.modules.get(row, col)) {
          const start = col;
          while (col + 1 < n && qr.modules.get(row, col + 1)) col++;
          page.drawRectangle({
            x: x + padding + start * unit,
            y: y + padding + (n - row - 1) * unit,
            width: (col - start + 1) * unit,
            height: unit,
            color: cmyk(0, 0, 0, 1),
          });
        }
    const codeWidth = font.widthOfTextAtSize(plate.code, l.code.fontSizePt);
    if (codeWidth > mm(l.code.widthMm))
      throw new Error("Código não cabe na área aprovada.");
    page.drawText(plate.code, {
      x: mm(l.bleedMm + l.code.xMm) + (mm(l.code.widthMm) - codeWidth) / 2,
      y: height - mm(l.bleedMm + l.code.yMm) - l.code.fontSizePt,
      size: l.code.fontSizePt,
      font,
      color: template.codeInk === "white" ? cmyk(0, 0, 0, 0) : cmyk(0, 0, 0, 1),
    });
    if (mode === "test") {
      // Obscures part of the QR deliberately: a test PDF must not be sent to print.
      page.drawRectangle({
        x: 0,
        y: height / 2 - 12,
        width,
        height: 24,
        color: cmyk(0, 0, 0, 0),
        opacity: 0.95,
      });
      const label = "TESTE - NAO ENVIAR A GRAFICA";
      const fs = Math.min(12, (width - 12) / font.widthOfTextAtSize(label, 1));
      page.drawText(label, {
        x: (width - font.widthOfTextAtSize(label, fs)) / 2,
        y: height / 2 - 4,
        size: fs,
        font,
        color: cmyk(0, 1, 1, 0),
      });
    }
    progress?.(i + 1);
  }
  return doc.save();
}
