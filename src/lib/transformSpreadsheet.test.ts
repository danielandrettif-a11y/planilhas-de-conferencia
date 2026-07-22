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
): PagamentoRow {
  return {
    numero,
    fornecedor: "KONIMAGEM COMERCIAL LTDA",
    valorTitulo,
    valorAberto: dataBaixa ? 0 : valorTitulo,
    dataProgramada,
    dataBaixa,
  };
}

describe("parser de linhas do PDF", () => {
  it("captura a data programada mais à direita antes dos valores", () => {
    const row = parsePagamentoLine(
      "000 0030412500003 KONIMAGEM COMERCIAL LTDA 09/03/2026 09/03/2026 02/06/2026 02/06/2026 14.576,43 0,00 02/06/2026",
    );

    expect(row).not.toBeNull();
    expect(row?.numero).toBe("30412500003");
    expect(row?.fornecedor).toBe("KONIMAGEM COMERCIAL LTDA");
    expect(row?.valorTitulo).toBe(14576.43);
    expect(row?.dataProgramada).toEqual(date(2, 6));
    expect(row?.dataBaixa).toEqual(date(2, 6));
  });

  it("não transforma simples vencimento em programação quando faltam colunas", () => {
    const row = parsePagamentoLine(
      "000 000000005335 TRAMED 05/04/2024 05/05/2024 1.000,00 1.000,00",
    );

    expect(row).not.toBeNull();
    expect(row?.dataProgramada).toBeNull();
    expect(row?.dataBaixa).toBeNull();
  });
});

describe("regras de parcelas conforme o mês conferido", () => {
  it("mostra apenas parcelas posteriores a maio e soma exatamente o FALTA PAGAR", () => {
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
    expect(current.motivosConferencia.some((reason) => reason.includes("Diferença de"))).toBe(false);
  });

  it("mantém o último dia do mês selecionado e marca para conferir", () => {
    const current = nota({ faltaPagar: 300 });
    const rows: PagamentoRow[] = [
      pagamento("30412500001", date(15, 5), 100),
      pagamento("30412500002", date(31, 5), 100),
      pagamento("30412500003", date(10, 6), 200),
    ];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("31/05 e 10/06/2026");
    expect(current.informacoes).toMatch(/\(conferir\)$/i);
    expect(current.motivosConferencia.some((reason) => reason.includes("último dia do mês"))).toBe(true);
  });

  it("registra divergência de centavos sem descartar as datas", () => {
    const current = nota({ faltaPagar: 300.02 });
    const rows: PagamentoRow[] = [
      pagamento("30412500001", date(1, 6), 100),
      pagamento("30412500002", date(1, 7), 200),
    ];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("01/06 e 01/07/2026");
    expect(current.informacoes).toMatch(/\(conferir\)$/i);
    expect(current.motivosConferencia.join(" ")).toContain("R$ 0,02");
  });

  it("informa a data de geração quando a NF não aparece no ERP", () => {
    const current = nota();

    applyPagamentosPdf([current], [pagamento("999999", date(1, 6), 100)], {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toBe("Não consta no ERP até 22/07/2026 (conferir)");
    expect(current.motivosConferencia.join(" ")).toContain("22/07/2026");
  });

  it("substitui a mensagem herdada de ausência quando o pagamento passa a aparecer", () => {
    const current = nota({
      faltaPagar: 100,
      informacoes: "Não consta no ERP até 20/06/2026 (conferir)",
    });

    applyPagamentosPdf([current], [pagamento("304125", date(10, 6), 100)], {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).toContain("10/06/2026");
    expect(current.informacoes).not.toContain("Não consta");
    expect(current.motivosConferencia.join(" ")).toContain("planilha do mês anterior");
  });
});

describe("arquivo Excel", () => {
  it("cria Geral primeiro, ordena contas, calcula saldos e inclui links internos", async () => {
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

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Geral", "81354", "81362"]);

    const geral = workbook.getWorksheet("Geral");
    expect(geral?.getCell("A1").value).toBe("Resumo Geral das Contas");
    expect(geral?.getCell("A2").value).toBe("Mês de conferência: maio/2026");
    expect(geral?.getCell("A3").value).toBe("Planilha gerada em: 22/07/2026");
    expect(geral?.getCell("A6").value).toEqual({ text: "81354", hyperlink: "#'81354'!A1" });
    expect(geral?.getCell("B6").value).toBe(28458.35);
    expect(geral?.getCell("A7").value).toEqual({ text: "81362", hyperlink: "#'81362'!A1" });
    expect(geral?.getCell("B7").value).toBe(167238.83);

    const total = geral?.getCell("B8").value as ExcelJS.CellFormulaValue;
    expect(total.formula).toBe("SUM(B6:B7)");
    expect(total.result).toBe(195697.18);

    const account = workbook.getWorksheet("81354");
    expect(account?.getCell("A1").value).toEqual({
      text: "← Voltar para Geral  |  Conta 81354",
      hyperlink: "#'Geral'!A1",
    });
  });
});
