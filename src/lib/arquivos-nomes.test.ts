import { describe, expect, it } from "vitest";
import { abreviarEmpresaZip, aliasesEmpresasZip, gerarZip, nomeInternoZip, nomePastaZip, nomeZip } from "./arquivos";

describe("nomes do ZIP para Excel", () => {
  it("limita os nomes e elimina caracteres incompatíveis", () => {
    const alias = abreviarEmpresaZip("Empresa fictícia de serviços médicos com razão social muito comprida /:*?");
    const pasta = nomePastaZip(alias, "2026-10");
    expect(pasta.length).toBeLessThanOrEqual(28);
    expect(pasta).toMatch(/^[a-zA-Z0-9 _-]+ 10-2026$/);
    expect(nomeInternoZip("Folha", "conferencia", alias, "2026-10")).toBe("Conferencia " + pasta + ".xlsx");
    expect(nomeInternoZip("Férias", "pdf", "EXEMPLO", "2026-10")).toBe("Ferias EXEMPLO 10-2026.pdf");
    const prefixo = "C:\\Users\\contabilidade\\AppData\\Local\\Temp\\a5065ad6-c1bf-46eb-b13b-1ffe5979da88_";
    const caminho = prefixo + nomeZip("Folha", "2026-10") + ".a88\\" + pasta + "\\" + nomeInternoZip("Folha", "conferencia", alias, "2026-10");
    expect(caminho.length).toBeLessThan(218);
  });

  it("diferencia abreviações iguais sem usar código na frente", () => {
    const aliases = aliasesEmpresasZip(["Empresa exemplo LTDA", "Empresa exemplo ME"]);
    expect(aliases).toEqual(["EMPRESA EXEMPLO", "EMPRESA EXEMPLO 2"]);
  });

  it("preserva uma planilha Excel válida dentro de uma pasta no ZIP", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const JSZip = (await import("jszip")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Planilha1").addRow(["DATA", "VALOR"]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
    const nome = nomePastaZip("EMPRESA FICTICIA", "2026-10") + "/" + nomeInternoZip("Folha", "importacao", "EMPRESA FICTICIA", "2026-10");
    const zip = await JSZip.loadAsync(await gerarZip([{ nome, bytes }]), { checkCRC32: true });
    const recuperado = await zip.file(nome)!.async("arraybuffer");
    const reaberto = new ExcelJS.Workbook();
    await reaberto.xlsx.load(recuperado);
    expect(reaberto.getWorksheet("Planilha1")!.getCell("A1").value).toBe("DATA");
  });
});
