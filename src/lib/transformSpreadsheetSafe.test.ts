import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  applyPagamentosPdf,
  buildXlsx,
  transformRows,
  type SheetInput,
} from "./transformSpreadsheetSafe";
import type { PagamentoRow } from "./parsePagamentosPdf";

function date(day: number, month: number, year = 2026): Date {
  return new Date(year, month - 1, day);
}

function payment(numero: string, fornecedor: string, valor: number): PagamentoRow {
  return {
    numero,
    fornecedor,
    valorTitulo: valor,
    valorAberto: 0,
    dataProgramada: date(30, 5),
    dataBaixa: date(30, 5),
  };
}

describe("reconciliação segura", () => {
  it("bloqueia pagamento incompatível mesmo com NF e fornecedor exatos", () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 340 - JD AZEVEDO SERVICOS MEDICOS LTDA",
        Valor: 5600,
        Data: date(10, 5),
      },
      {
        "Descrição histórico": "VALOR ISS S/ NF - 340 - JD AZEVEDO SERVICOS MEDICOS LTDA",
        Valor: -168,
        Data: date(10, 5),
      },
    ]);

    const nota = result.notas[0];
    applyPagamentosPdf(
      [nota],
      [payment("340", "JD AZEVEDO SERVICOS MEDICOS LTDA", 35680.87)],
      { mesConferencia: { ano: 2026, mes: 5 }, generatedAt: date(24, 7) },
    );

    expect(nota.faltaPagar).toBe(5432);
    expect(nota.informacoes).toContain("valor é incompatível");
    expect(nota.confiancaAssociacao).toBe("Manual");
  });

  it("não associa por uma única palavra genérica", () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 63 - VLMS SERVICOS MEDICOS LTDA",
        Valor: 2560,
        Data: date(10, 5),
      },
      {
        "Descrição histórico": "VALOR ISS S/ NF - 63 - VLMS SERVICOS MEDICOS LTDA",
        Valor: -51.46,
        Data: date(10, 5),
      },
    ]);

    const nota = result.notas[0];
    applyPagamentosPdf(
      [nota],
      [payment("63", "OUTRA EMPRESA DE SERVICOS MEDICOS LTDA", 11336.46)],
      { mesConferencia: { ano: 2026, mes: 5 }, generatedAt: date(24, 7) },
    );

    expect(nota.faltaPagar).toBe(2508.54);
    expect(nota.informacoes).toContain("fornecedor não corresponde com segurança");
    expect(nota.faltaPagar).toBeGreaterThan(0);
  });

  it("preserva lançamentos não reconhecidos e mantém a reconciliação", async () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 100 - FORNECEDOR TESTE LTDA",
        Valor: "1.000,00C",
        Data: date(10, 5),
      },
      {
        "Descrição histórico": "VALOR GIGA MAIS FIBRA TELECOMUNICACOES S.A.",
        Valor: "89,81C",
        Data: date(11, 5),
      },
      {
        "Descrição histórico": "VALOR RETENCAO DE PIS COFINS E CSLL S/ NF 1126 RTS RIO S/A",
        Valor: "795,15D",
        Data: date(12, 5),
      },
    ]);

    expect(result.pendencias).toHaveLength(2);
    expect(result.notas.reduce((sum, nota) => sum + nota.faltaPagar, 0)).toBeCloseTo(result.saldoBruto, 2);

    const sheets: SheetInput[] = [{ conta: "81362", result }];
    const blob = await buildXlsx(sheets, { mesConferencia: { ano: 2026, mes: 5 } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());

    expect(workbook.getWorksheet("Reconciliação")).toBeDefined();
    expect(workbook.getWorksheet("Pendências")).toBeDefined();
    expect(workbook.getWorksheet("Reconciliação")?.getCell("E2").value).toBe("CONCILIADO");
  });
});
