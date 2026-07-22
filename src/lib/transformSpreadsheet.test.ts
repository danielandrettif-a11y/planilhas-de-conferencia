import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parsePagamentoLine } from "./parsePagamentoLine";
import {
  applyPagamentosPdf,
  buildXlsx,
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

    expect(current.informacoes).toContain("ERP indica pagamento integral");
    expect(current.informacoes).toContain("R$ 176,00");
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

describe("arquivo Excel", () => {
  it("cria nomes contábeis e saldos ligados às abas", async () => {
    const sheets: SheetInput[] = [
      { conta: "81362", result: { notas: [nota({ faltaPagar: 167238.83 })] } },
      { conta: "81354", result: { notas: [nota({ faltaPagar: 28458.35 })] } },
    ];

    const blob = await buildXlsx(sheets, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());

    expect(workbook.worksheets[0].name).toBe("Geral");
    expect(workbook.worksheets[1].name).toContain("81354");
    expect(workbook.worksheets[2].name).toContain("81362");

    const geral = workbook.getWorksheet("Geral");
    expect(geral?.getCell("A6").value).toMatchObject({ text: "Material e Medicamentos - 81354" });
    expect(geral?.getCell("A7").value).toMatchObject({ text: "Prestadores de Serviços - 81362" });

    const saldo = geral?.getCell("B6").value as ExcelJS.CellFormulaValue;
    expect(saldo.formula).toContain("!E4");
    expect(saldo.result).toBe(28458.35);
  });
});
