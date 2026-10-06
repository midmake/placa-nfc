// Browser-only production pipeline. Large lots are processed in PDF parts of 250.
// Each part gets an explicit download link; mobile browsers do not need to permit
// a burst of automatic downloads. No customer data is sent to a PDF service.
function runPart(worker, input, progress) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.type === "progress") progress(e.data.done);
      if (e.data.type === "error") reject(new Error(e.data.message));
      if (e.data.type === "done") resolve(e.data.buffer);
    };
    worker.onerror = () =>
      reject(
        new Error(
          "Falha no gerador de PDF. Tente uma parte menor ou use um computador.",
        ),
      );
    worker.postMessage(input);
  });
}
export async function generateBatchPDF({
  batchId,
  mode,
  template,
  api,
  onProgress,
  container,
  preview = false,
}) {
  if (preview && mode !== "test")
    throw new Error("A prévia deve ser de teste.");
  if (!template.ready || !template.asset || !template.layout)
    throw new Error("Artes pendentes.");
  if (
    !template.asset.startsWith("/print-art/") ||
    template.asset.includes("..")
  )
    throw new Error("Arte inválida.");
  const response = await fetch(template.asset, { cache: "no-store" });
  if (!response.ok) throw new Error("Arquivo da arte não encontrado.");
  const art = await response.arrayBuffer(),
    worker = new Worker("/print-worker.js");
  let after = "",
    completed = 0,
    part = 1,
    origin = null;
  container.replaceChildren();
  try {
    do {
      const data = await api(
        `/batches/${batchId}/print-data?mode=${mode}&after=${after}`,
      );
      if (origin && data.origin !== origin)
        throw new Error("A origem mudou durante a exportação. Recomece.");
      origin = data.origin;
      if (preview) data.plates = data.plates.slice(0, 1);
      if (data.plates.length) {
        const bytes = await runPart(
          worker,
          { plates: data.plates, template, art, mode },
          (n) =>
            onProgress(`Gerando ${completed + n} de ${data.total} placas…`),
        );
        const blob = new Blob([bytes], { type: "application/pdf" }),
          url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.className = "button secondary";
        link.href = url;
        link.download = `${mode === "test" ? "TESTE-NAO-IMPRIMIR-" : ""}gear-go-${batchId.slice(0, 8)}-parte-${String(part).padStart(3, "0")}.pdf`;
        link.textContent = `${preview ? "Baixar prévia de teste" : "Baixar PDF"} · parte ${part} (${data.plates.length} placas)`;
        if (preview) {
          const open = document.createElement("a");
          open.className = "button";
          open.href = url;
          open.target = "_blank";
          open.rel = "noopener";
          open.textContent = "Abrir prévia de teste";
          container.append(open);
        }
        container.append(link);
        part++;
        completed += data.plates.length;
      }
      after = !preview && data.next_after ? String(data.next_after) : "";
    } while (after);
    onProgress(
      `${preview ? "Prévia de teste" : "Concluído"}: ${completed} placas em ${part - 1} arquivo(s). Baixe todas as partes.`,
    );
  } finally {
    worker.terminate();
  }
}
