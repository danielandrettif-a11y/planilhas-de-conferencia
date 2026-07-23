import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parsePagamentoLine } from "./parsePagamentoLine";
import {
  applyPagamentosPdf,
  buildXlsx,
  flagDuplicateInvoices,
  transformRows,
  type NotaFiscal,
  type SheetInput,
} from "./transformSpreadsheet";
import type { PagamentoRow } from "./parsePagamentoLine";

function date(day: number, month: number, year = 2026): Date {
  return new Date(year, month - 1, day);
}

function nota(overrides: Partial<NotaFiscal> = {}): NotaFiscal {
  return {
    data: date(4, 3),
    fornecedor: "Konimagem Comercial Ltda",
    notaFiscal: "304125",
    valorNF: 87458.6,
    faltaPagar: 58305.74,
    informacoes: "",
    confiancaAssociacao: "Manual",
    motivosConferencia: [],
    ...overrides,
  };
}

function pagamento(
  numero: string,
  dataProgramada: Date | null,
  valorTitulo: number,
  dataBaixa: Date | null = null,
  fornecedor = "KONIMAGEM COMERCIAL LTDA",
  valorAberto?: number,
): PagamentoRow {
  return {
    numero,
    fornecedor,
    valorTitulo,
    valorAberto: valorAberto ?? (dataBaixa ? 0 : valorTitulo),
    dataProgramada,
    dataBaixa,
  };
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo gerado."));
    reader.readAsArrayBuffer(blob);
  });
}

describe("parser de linhas do PDF", () => {
  it("captura NF curta sem confundir com contador de linha", () => {
    const row = parsePagamentoLine(
      "00034 CIRLEI SANTOS PESSANHA 17/11/2025 17/11/2025 24/11/2025 24/11/2025 3.885,00 0,00 24/11/2025",
    );
    expect(row?.numero).toBe("34");
    expect(row?.fornecedor).toBe("CIRLEI SANTOS PESSANHA");
  });

  it("ignora FRETE entre o número e o fornecedor", () => {
    const row = parsePagamentoLine(
      "000 006179 FRETE MARTEC MED INDUSTRIA E COM 24/02/2025 24/02/2025 28/02/2025 28/02/2025 1.895,35 0,00 28/02/2025",
    );
    expect(row?.numero).toBe("6179");
    expect(row?.fornecedor).toBe("MARTEC MED INDUSTRIA E COM");
  });

  it("não transforma simples vencimento em programação", () => {
    const row = parsePagamentoLine(
      "000 000000005335 TRAMED 05/04/2024 05/05/2024 1.000,00 1.000,00",
    );
    expect(row?.dataProgramada).toBeNull();
    expect(row?.dataBaixa).toBeNull();
  });
});

describe("regras de pagamentos", () => {
  it("mostra parcelas posteriores ao mês conferido", () => {
    const current = nota();
    const rows: PagamentoRow[] = [
      pagamento("30412500001", date(3, 4), 14576.43, date(3, 4)),
      pagamento("30412500002", date(3, 5), 14576.43, date(3, 5)),
      pagamento("30412500003", date(2, 6), 14576.43, date(2, 6)),
      pagamento("30412500004", date(1, 7), 14576.43, date(1, 7)),
      pagamento("30412500005", date(1, 8), 14576.43),
      pagamento("30412500006", date(31, 8), 14576.45),
    ];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("02/06, 01/07, 01/08 e 31/08/2026");
  });

  it("agrupa título exato com parcelas derivadas", () => {
    const current = nota({
      fornecedor: "ESFRIAR COMERCIO DE REFRIGERACAO LTDA",
      notaFiscal: "2155",
      valorNF: 75000,
      faltaPagar: 18750,
    });
    const rows = [
      pagamento("2155", date(25, 4), 18750, date(25, 4), current.fornecedor),
      pagamento("215500001", date(25, 4), 18750, date(25, 4), current.fornecedor),
      pagamento("215500002", date(25, 5), 18750, date(25, 5), current.fornecedor),
      pagamento("215500003", date(24, 6), 18750, null, current.fornecedor),
    ];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("24/06/2026");
    expect(current.motivosConferencia.join(" ")).toContain("agrupada com títulos parcelados");
  });

  it("identifica pagamento a menos mesmo sem parcelas futuras", () => {
    const current = nota({
      fornecedor: "MIRANTE IND. E COM. EIRELI - ME",
      notaFiscal: "340753",
      valorNF: 731.69,
      faltaPagar: 0.08,
    });
    const rows = [pagamento("340753", date(13, 8, 2024), 731.61, date(13, 8, 2024), "MIRANTE INDUSTRIA E COMERCIO")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("Pagou R$ 0,08 a menos");
  });

  it("transforma pagamento a mais em saldo negativo", () => {
    const current = nota({
      fornecedor: "MARTEC MED INDUSTRIA E COMERCIO DE EQUIP",
      notaFiscal: "6179",
      valorNF: 15395.35,
      faltaPagar: 15395.35,
    });
    const rows = [pagamento(
      "6179",
      date(10, 10, 2025),
      18395.35,
      date(10, 10, 2025),
      "MARTEC MED INDUSTRIA E COMERCIO DE EQUIPAMENTOS ME",
    )];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.faltaPagar).toBe(-3000);
    expect(current.informacoes).toContain("Pagou R$ 3.000,00 a mais");
    expect(current.confiancaAssociacao).toBe("Média");
  });

  it("aceita uma palavra relevante em comum no nome do fornecedor", () => {
    const current = nota({ fornecedor: "MARTEC EQUIPAMENTOS", notaFiscal: "6179", valorNF: 100, faltaPagar: 0 });
    const rows = [pagamento("6179", date(10, 5), 100, date(10, 5), "MARTEC SOLUCOES HOSPITALARES")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).not.toContain("Não consta no ERP");
    expect(current.motivosConferencia.join(" ")).toContain("palavras relevantes em comum");
    expect(current.confiancaAssociacao).toBe("Média");
  });

  it("trata fornecedor totalmente diferente como não localizado", () => {
    const current = nota({ fornecedor: "FORNECEDOR ALFA", notaFiscal: "6179" });
    const rows = [pagamento("6179", date(10, 5), current.valorNF, date(10, 5), "EMPRESA BETA")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("Não consta no ERP até 22/07/2026");
    expect(current.informacoes).not.toContain("fornecedor não corresponde");
    expect(current.confiancaAssociacao).toBe("Manual");
  });

  it("ignora código numérico e aceita nome truncado", () => {
    const current = nota({
      fornecedor: "NAGELA DA SILVA FERREIRA SOUZA 146942317",
      notaFiscal: "1",
      valorNF: 1708,
      faltaPagar: 700,
    });
    const rows = [pagamento("1", date(24, 11, 2025), 1008, date(24, 11, 2025), "NAGELA DA SILVA FERREIRA SOU")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("Pagou R$ 700,00 a menos");
  });

  it("avisa quando ERP está quitado e a planilha ainda está em aberto", () => {
    const current = nota({
      fornecedor: "OXIGASES LTDA",
      notaFiscal: "10723",
      valorNF: 176,
      faltaPagar: 176,
    });
    const rows = [pagamento("10723", date(30, 5), 176, date(30, 5), "OXIGASES LTDA")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("ERP indica pagamento integral no dia 30/05");
    expect(current.informacoes).toContain("R$ 176,00 em aberto");
    expect(current.confiancaAssociacao).toBe("Alta");
  });

  it("diferencia título sem programação de título programado sem baixa", () => {
    const semProgramacao = nota({ notaFiscal: "1002285", valorNF: 118.53, faltaPagar: 118.53 });
    applyPagamentosPdf([semProgramacao], [pagamento("1002285", null, 118.53, null, semProgramacao.fornecedor)], {
      mesConferencia: { ano: 2026, mes: 1 },
      generatedAt: date(22, 7),
    });
    expect(semProgramacao.informacoes).toContain("sem data programada");

    const programado = nota({ notaFiscal: "2600001002323", valorNF: 117.73, faltaPagar: 117.73 });
    applyPagamentosPdf([programado], [pagamento("1002323", date(6, 2), 117.73, null, programado.fornecedor)], {
      mesConferencia: { ano: 2026, mes: 1 },
      generatedAt: date(22, 7),
    });
    expect(programado.informacoes).toContain("Programado para 06/02/2026");
    expect(programado.informacoes).toContain("sem data de baixa");
  });
});

describe("validação da planilha bruta", () => {
  it.each([
    ["1234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.234", 1234],
  ])("interpreta o valor textual %s como %s", (valor, esperado) => {
    const result = transformRows([{
      "Descrição histórico": "VALOR NF - 304125 KONIMAGEM COMERCIAL LTDA",
      Valor: valor,
      Data: date(4, 3),
    }]);

    expect(result.notas[0].valorNF).toBe(esperado);
    expect(result.notas[0].faltaPagar).toBe(esperado);
  });

  it("rejeita valor monetário inválido em uma linha de nota fiscal", () => {
    expect(() => transformRows([
      {
        "Descrição histórico": "VALOR NF - 304125 KONIMAGEM COMERCIAL LTDA",
        Valor: "valor inválido",
        Data: date(4, 3),
      },
    ])).toThrow('Valor inválido na linha 2 da coluna "Valor".');
  });

  it("marca NFs repetidas para associação manual", () => {
    const first = nota({ notaFiscal: "123", confiancaAssociacao: "Alta" });
    const second = nota({ notaFiscal: "123", fornecedor: "Outro Fornecedor", confiancaAssociacao: "Média" });
    const sheets: SheetInput[] = [
      { conta: "81354", result: { notas: [first] } },
      { conta: "81355", result: { notas: [second] } },
    ];

    const alerts = flagDuplicateInvoices(sheets);

    expect(alerts).toEqual([expect.objectContaining({ numero: "123", quantidade: 2, contas: ["81354", "81355"] })]);
    expect(first.confiancaAssociacao).toBe("Manual");
    expect(second.confiancaAssociacao).toBe("Manual");
    expect(first.motivosConferencia.join(" ")).toContain("NF 123 repetida 2 vezes");
  });
});

describe("arquivo Excel", () => {
  it("cria nomes contábeis e saldos ligados às abas", async () => {
    const sheets: SheetInput[] = [
      { conta: "81362", result: { notas: [nota({ faltaPagar: 167238.83 })] } },
      { conta: "81354", result: { notas: [nota({ faltaPagar: 28458.35 })] } },
    ];

    const blob = await buildXlsx(sheets, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
      empresa: "Instituto de Medicina Nuclear",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blobToArrayBuffer(blob));

    expect(workbook.worksheets[0].name).toBe("Geral");
    expect(workbook.worksheets[1].name).toContain("81354");
    expect(workbook.worksheets[2].name).toContain("81362");

    const geral = workbook.getWorksheet("Geral");
    expect(geral?.getColumn("C").width).toBe(48);
    expect(geral?.getColumn("E").width).toBe(21);
    expect(geral?.views[0]?.state).toBe("normal");
    expect(geral?.views[0]?.ySplit).toBeUndefined();
    expect(geral?.views[0]?.showGridLines).toBe(false);
    expect(geral?.getCell("D1").value).toBe("Resumo Geral");
    expect(geral?.getCell("D2").value).toBe("Empresa: Instituto de Medicina Nuclear");
    expect(geral?.getCell("D3").value).toBe("Mês de conferência: maio/2026");
    expect(geral?.getCell("D4").value).toBe("Planilha feita em: 22/07/2026");
    expect(geral?.getCell("D5").value).toBe("NOME DA CONTA DO FORNECEDOR");
    const nameLink = geral?.getCell("D6").value as ExcelJS.CellFormulaValue;
    expect(nameLink.formula).toBe('HYPERLINK("#\'81354\'!A1","Material e Medicamentos")');
    expect(nameLink.result).toBe("Material e Medicamentos");

    const codeLink = geral?.getCell("E6").value as ExcelJS.CellFormulaValue;
    expect(codeLink.formula).toBe('HYPERLINK("#\'81354\'!A1","81354")');
    expect(codeLink.result).toBe("81354");

    expect(geral?.getCell("D7").value).toMatchObject({ result: "Prestadores de Serviços" });
    expect(geral?.getCell("D8").value).toBeNull();
    expect(geral?.getCell("D6").border.bottom?.color?.argb).toBe("FF000000");

    const backLink = workbook.getWorksheet("81354")?.getCell("A1").value as ExcelJS.CellFormulaValue;
    expect(backLink.formula).toContain('HYPERLINK("#\'Geral\'!D1"');

    const accountSheet = workbook.getWorksheet("81354");
    expect(accountSheet?.views[0]?.state).toBe("normal");
    expect(accountSheet?.views[0]?.ySplit).toBeUndefined();
    expect(accountSheet?.getCell("G2").value).toBe("CONFIANÇA DA ASSOCIAÇÃO");
    expect(accountSheet?.getCell("G3").value).toBe("Manual");
    expect(accountSheet?.getCell("H2").value).toBe("MOTIVO DA CONFERÊNCIA");

    const saldo = geral?.getCell("F6").value as ExcelJS.CellFormulaValue;
    expect(saldo.formula).toContain("!E4");
    expect(saldo.result).toBe(28458.35);
  });

  it("leva o pagamento excedente negativo para o saldo da conta", async () => {
    const sheets: SheetInput[] = [
      { conta: "81354", result: { notas: [nota({ faltaPagar: -3000 })] } },
    ];

    const blob = await buildXlsx(sheets, { mesConferencia: { ano: 2026, mes: 5 } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blobToArrayBuffer(blob));

    const saldo = workbook.getWorksheet("Geral")?.getCell("F6").value as ExcelJS.CellFormulaValue;
    expect(saldo.result).toBe(-3000);
  });

  it("mantém a conta 81362 como a última aba", async () => {
    const sheets: SheetInput[] = [
      { conta: "81362", result: { notas: [nota()] } },
      { conta: "81363", result: { notas: [nota()] } },
      { conta: "81354", result: { notas: [nota()] } },
    ];

    const blob = await buildXlsx(sheets, { mesConferencia: { ano: 2026, mes: 5 } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blobToArrayBuffer(blob));

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "Geral",
      "81354",
      "81363",
      "81362",
    ]);
  });

  it("não reutiliza o mês de uma geração anterior", async () => {
    const sheets: SheetInput[] = [
      { conta: "81354", result: { notas: [nota()] } },
    ];

    await buildXlsx(sheets, { mesConferencia: { ano: 2026, mes: 5 } });
    const blob = await buildXlsx(sheets);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blobToArrayBuffer(blob));

    expect(workbook.getWorksheet("Geral")?.getCell("D3").value)
      .toBe("Mês de conferência: não informado");
  });
});
