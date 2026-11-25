import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { nomeArquivo, separarPdf } from "./arquivos";

describe("arquivos da empresa", () => {
  it("inclui empresa, competência e finalidade em nome seguro", () => {
    expect(nomeArquivo("Folha", "Empresa/Exemplo", "2026-10", "xlsx", "Conferência")).toBe("Folha Empresa Exemplo 10-2026 - Conferência.xlsx");
  });
  it("copia apenas as páginas identificadas, incluindo páginas sem eventos", async () => {
    const original = await PDFDocument.create();
    original.addPage([100, 200]); original.addPage([200, 300]); original.addPage([300, 400]);
    const bytes = await original.save();
    const file = { arrayBuffer: async () => bytes.slice().buffer } as File;
    const result = await PDFDocument.load(await separarPdf(file, [3, 1, 3]));
    expect(result.getPageCount()).toBe(2);
    expect(result.getPages().map(page => page.getWidth())).toEqual([100, 300]);
    await expect(separarPdf(file, [])).rejects.toThrow();
    await expect(separarPdf(file, [4])).rejects.toThrow();
  });
});
