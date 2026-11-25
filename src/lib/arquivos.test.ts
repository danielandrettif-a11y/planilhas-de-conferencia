import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { nomeArquivo, separarPdf, gerarZip } from "./arquivos";

describe("arquivos da empresa", () => {
  it("inclui empresa, competência e finalidade em nome seguro", () => {
    expect(nomeArquivo("Folha", "Beda/Imagem", "2026-10", "xlsx", "Conferência")).toBe("Folha Beda Imagem 10-2026 - Conferência.xlsx");
  });
  it("compacta arquivos preservando seus nomes e conteúdos", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await gerarZip([{nome:"Férias Empresa 09-2026.pdf",bytes:new Uint8Array([1,2,3])},{nome:"Importação.xlsx",bytes:new Uint8Array([4,5])}]));
    expect(Object.keys(zip.files)).toEqual(["Férias Empresa 09-2026.pdf", "Importação.xlsx"]);
    expect(await zip.file("Férias Empresa 09-2026.pdf")!.async("uint8array")).toEqual(new Uint8Array([1,2,3]));
    expect(await zip.file("Importação.xlsx")!.async("uint8array")).toEqual(new Uint8Array([4,5]));
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
