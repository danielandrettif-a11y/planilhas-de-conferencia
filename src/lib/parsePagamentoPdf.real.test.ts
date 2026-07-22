import { describe, expect, it } from "vitest";
import { parsePagamentoColumns, parsePagamentoLine } from "./parsePagamentoLine";

describe("parser do relatório real do ERP", () => {
  it("ignora o código da empresa 00044 e lê o número completo do título", () => {
    const row = parsePagamentoLine(
      "00044 30412500004 KONIMAGEM COMERCIAL LTDA 09/03/2026 09/03/2026 01/07/2026 02/07/2026 14.576,43 0,00 01/07/2026",
    );

    expect(row?.numero).toBe("30412500004");
    expect(row?.fornecedor).toBe("KONIMAGEM COMERCIAL LTDA");
    expect(row?.dataProgramada).toEqual(new Date(2026, 6, 1));
    expect(row?.dataBaixa).toEqual(new Date(2026, 6, 1));
  });

  it("usa a data programada e não o vencimento original", () => {
    const row = parsePagamentoColumns({
      numero: "30027800002",
      fornecedor: "KONIMAGEM COMERCIAL LTDA",
      dataCadastro: "03/03/2026",
      dataEmissao: "03/03/2026",
      dataProgramada: "13/03/2026",
      dataOriginal: "04/08/2026",
      valorTitulo: "14.449,77",
      valorAberto: "0,00",
      dataBaixa: "13/03/2026",
    });

    expect(row?.dataProgramada).toEqual(new Date(2026, 2, 13));
    expect(row?.dataBaixa).toEqual(new Date(2026, 2, 13));
  });

  it("ignora FRETE entre o título e o fornecedor", () => {
    const row = parsePagamentoLine(
      "00044 6179 FRETE MARTEC MED INDUSTRIA E COMERCIO DE EQUIPAMENTOS ME 24/02/2025 24/02/2025 28/02/2025 28/02/2025 1.895,35 0,00 28/02/2025",
    );

    expect(row?.numero).toBe("6179");
    expect(row?.fornecedor).toBe("MARTEC MED INDUSTRIA E COMERCIO DE EQUIPAMENTOS ME");
  });

  it("preserva parcelas em aberto sem data de baixa", () => {
    const row = parsePagamentoColumns({
      numero: "30412500005",
      fornecedor: "KONIMAGEM COMERCIAL LTDA",
      dataCadastro: "09/03/2026",
      dataEmissao: "09/03/2026",
      dataProgramada: "01/08/2026",
      dataOriginal: "01/08/2026",
      valorTitulo: "14.576,43",
      valorAberto: "14.576,43",
    });

    expect(row?.valorAberto).toBe(14576.43);
    expect(row?.dataProgramada).toEqual(new Date(2026, 7, 1));
    expect(row?.dataBaixa).toBeNull();
  });
});
