import { describe, expect, it } from "vitest";
import { gerarZip, nomeInternoZip, nomePastaZip, nomeZip } from "./arquivos";

describe("nomes do ZIP para Excel", () => {
  it("limita os nomes e elimina caracteres incompatíveis", () => {
    const pasta = nomePastaZip("0104", "Empresa fictícia de serviços médicos com razão social muito comprida /:*?");
    expect(pasta.length).toBeLessThanOrEqual(47);
    expect(pasta).toMatch(/^0104 - [a-zA-Z0-9 _-]+$/);
    expect(nomeInternoZip("Folha", "conferencia")).toBe("Conferencia.xlsx");
    expect(nomeInternoZip("Férias", "pdf")).toBe("Ferias.pdf");
    const prefixo = "C:\\Users\\contabilidade\\AppData\\Local\\Temp\\a5065ad6-c1bf-46eb-b13b-1ffe5979da88_";
    const caminho = prefixo + nomeZip("Folha", "2026-10") + ".a88\\" + pasta + "\\" + nomeInternoZip("Folha", "conferencia");
    expect(caminho.length).toBeLessThan(218);
  });

  it("preserva uma planilha Excel válida dentro de uma pasta no ZIP", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const JSZip = (await import("jszip")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Planilha1").addRow(["DATA", "VALOR"]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
    const nome = nomePastaZip("0104", "Empresa fictícia") + "/" + nomeInternoZip("Folha", "importacao");
    const zip = await JSZip.loadAsync(await gerarZip([{ nome, bytes }]), { checkCRC32: true });
    const recuperado = await zip.file(nome)!.async("arraybuffer");
    const reaberto = new ExcelJS.Workbook();
    await reaberto.xlsx.load(recuperado);
    expect(reaberto.getWorksheet("Planilha1")!.getCell("A1").value).toBe("DATA");
  });
});
