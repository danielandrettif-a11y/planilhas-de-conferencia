import { describe, expect, it } from "vitest";
import { applyPagamentosPdf, transformRows } from "./transformSpreadsheetFinal2";
import type { PagamentoRow } from "./parsePagamentosPdf";

const dia = new Date(2026, 4, 10);
const options = { mesConferencia: { ano: 2026, mes: 5 }, generatedAt: dia };
const line = (descricao: string, valor: number | string) => ({
  "Descrição histórico": descricao, Valor: valor, Data: dia,
});
const payment = (numero: string, fornecedor: string, valor: number): PagamentoRow => ({
  numero, fornecedor, valorTitulo: valor, valorAberto: 0,
  dataProgramada: dia, dataBaixa: dia,
});

describe("regras utilizadas pela tela principal", () => {
  it("desconta devolução uma única vez, inclusive com indicador D", () => {
    const result = transformRows([
      line("VALOR NF - 123 - ALFA LTDA", "1.000,00C"),
      line("DEVOLUÇÃO DA NOTA FISCAL 123 ALFA LTDA", "200,00D"),
    ]);
    expect(result.notas[0].faltaPagar).toBe(800);
    expect(result.notas[0].informacoes).toContain("devolução");
  });

  it("desconta uma retenção marcada com D", () => {
    const result = transformRows([
      line("VALOR NF - 123 - ALFA LTDA", "1.000,00C"),
      line("VALOR ISS S/ NF 123 - ALFA LTDA", "50,00D"),
    ]);
    expect(result.notas[0].faltaPagar).toBe(950);
  });

  it("não usa título de outro fornecedor para declarar pagamento", () => {
    const note = transformRows([line("VALOR NF - 123 - ALFA LTDA", 1000)]).notas[0];
    applyPagamentosPdf([note], [payment("123", "EMPRESA BETA LTDA", 1000)], options);
    expect(note.faltaPagar).toBe(1000);
    expect(note.confiancaAssociacao).toBe("Manual");
    expect(note.informacoes).toContain("Não localizado no relatório");
    expect(note.informacoes).toContain("conferir");
  });

  it("avisa quando ERP aponta quitação mas o saldo contábil permanece aberto", () => {
    const note = transformRows([line("VALOR NF - 123 - ALFA LTDA", 1000)]).notas[0];
    applyPagamentosPdf([note], [payment("123", "ALFA LTDA", 1000)], options);
    expect(note.faltaPagar).toBe(1000);
    expect(note.informacoes).toContain("conferir");
    expect(note.motivosConferencia.length).toBeGreaterThan(0);
  });
});
