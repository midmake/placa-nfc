import { renderPrintPDF } from "./pdf-engine";
declare const self: {
  onmessage: ((event: { data: any }) => void) | null;
  postMessage: (value: any, transfer?: ArrayBuffer[]) => void;
};
self.onmessage = async (event) => {
  try {
    const { plates, template, art, mode } = event.data;
    const bytes = await renderPrintPDF(
      plates,
      template,
      new Uint8Array(art),
      mode,
      (done) => self.postMessage({ type: "progress", done }),
    );
    const buffer = bytes.buffer as ArrayBuffer;
    self.postMessage({ type: "done", buffer }, [buffer]);
  } catch (e) {
    self.postMessage({ type: "error", message: (e as Error).message });
  }
};
