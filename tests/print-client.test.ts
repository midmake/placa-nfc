import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

test("prévia usa só a primeira placa real do backend, com marca de teste e sem paginação", async () => {
  const dom = new JSDOM('<div id="downloads"></div>');
  const posted: any[] = [];
  const requests: string[] = [];
  let terminated = false;
  class Worker {
    onmessage: any;
    postMessage(data: any) {
      posted.push(data);
      queueMicrotask(() =>
        this.onmessage({ data: { type: "done", buffer: new ArrayBuffer(8) } }),
      );
    }
    terminate() {
      terminated = true;
    }
  }
  const generate = vm.runInNewContext(
    readFileSync("public/print-client.js", "utf8").replace(
      "export async function",
      "async function",
    ) + "\ngenerateBatchPDF",
    {
      Worker,
      Blob,
      document: dom.window.document,
      URL: { createObjectURL: () => "blob:test-preview" },
      fetch: async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      }),
    },
  );
  const plates = [
    {
      id: 1,
      code: "A3009-K7Q2",
      url: "https://app.geargo.com.br/r/exact-backend-1",
    },
    {
      id: 2,
      code: "A3009-ABCD",
      url: "https://app.geargo.com.br/r/exact-backend-2",
    },
  ];
  const opts = {
    batchId: "existing-lot",
    mode: "test",
    preview: true,
    template: {
      ready: true,
      asset: "/print-art/gear-go-oficial-azul.pdf",
      layout: {},
    },
    api: async (path: string) => {
      requests.push(path);
      return {
        origin: "https://app.geargo.com.br",
        plates: [...plates],
        total: 1000,
        next_after: 250,
      };
    },
    onProgress: () => {},
    container: dom.window.document.querySelector("#downloads"),
  };
  await generate(opts);
  assert.equal(requests.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].plates.length, 1);
  assert.equal(posted[0].plates[0], plates[0]);
  assert.equal(posted[0].mode, "test");
  assert.equal(terminated, true);
  assert.match(
    dom.window.document.querySelector("a[download]")!.getAttribute("download")!,
    /^TESTE-NAO-IMPRIMIR-/,
  );
  assert.equal(
    dom.window.document.querySelector('a[target="_blank"]')!.textContent,
    "Abrir prévia de teste",
  );
  await assert.rejects(
    () => generate({ ...opts, mode: "production" }),
    /prévia deve ser de teste/,
  );
  dom.window.close();
});
