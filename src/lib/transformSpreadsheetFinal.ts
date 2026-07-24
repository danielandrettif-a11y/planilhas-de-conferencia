import {
  applyPagamentosPdf as applyPagamentosPdfOriginal,
  type MesConferencia,
  type NotaFiscal,
} from "./transformSpreadsheet";
import {
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
  transformRows,
  type BuildXlsxOptions,
  type SheetInput,
  type SheetRow,
  type TransformResult,
} from "./transformSpreadsheetSafe";
import type { PagamentoRow } from "./parsePagamentosPdf";

export {
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
  transformRows,
};

export type {
  BuildXlsxOptions,
  MesConferencia,
  NotaFiscal,
  SheetInput,
  SheetRow,
  TransformResult,
};

const MONEY_TOLERANCE = 0.005;

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeNoteNumber(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/\.0+$/, "")
    .replace(/\D+/g, "")
    .replace(/^0+/, "") || "0";
}

function formatDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function uniqueDates(dates: Date[]): Date[] {
  return [...new Map(
    dates.map((date) => [
      `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      date,
    ]),
  ).values()].sort((a, b) => a.getTime() - b.getTime());
}

function paymentRowsForNote(nota: NotaFiscal, rows: PagamentoRow[]): PagamentoRow[] {
  const noteNumber = normalizeNoteNumber(nota.notaFiscal);
  if (!noteNumber || noteNumber === "0") return [];
  return rows.filter((row) => normalizeNoteNumber(row.numero) === noteNumber);
}

function paidTotal(rows: PagamentoRow[]): number {
  return roundCurrency(rows.reduce(
    (sum, row) => sum + Math.max(0, row.valorTitulo - row.valorAberto),
    0,
  ));
}

function removeIncorrectDifferenceReasons(nota: NotaFiscal): void {
  nota.motivosConferencia = nota.motivosConferencia.filter((reason) => {
    const normalized = reason.toLowerCase();
    return !normalized.includes("foram pagos")
      && !normalized.includes("pagamento localizado no erp foi")
      && !normalized.includes("valor líquido esperado da nf é");
  });
}

/**
 * Compara o pagamento do ERP com o saldo líquido que a planilha já calculou
 * antes de ler o PDF. Assim, ISS, INSS, IRRF e demais retenções não são
 * reconstruídos uma segunda vez.
 */
export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const expectedNetByNote = new Map<NotaFiscal, number>();
  const grossByNote = new Map<NotaFiscal, number>();

  for (const nota of notas) {
    const expectedNet = roundCurrency(Math.max(0, nota.faltaPagar));
    expectedNetByNote.set(nota, expectedNet);
    grossByNote.set(nota, nota.valorNF);

    // O núcleo antigo compara com valorNF. Temporariamente fornecemos o valor
    // líquido já calculado para que a comparação com o PDF seja correta.
    nota.valorNF = expectedNet;
  }

  try {
    applyPagamentosPdfOriginal(notas, pdfRows, opts);
  } finally {
    for (const [nota, gross] of grossByNote) nota.valorNF = gross;
  }

  for (const nota of notas) {
    const expectedNet = expectedNetByNote.get(nota);
    if (expectedNet === undefined) continue;

    const matchingRows = paymentRowsForNote(nota, pdfRows);
    const paid = paidTotal(matchingRows);
    const isExactPayment = matchingRows.length > 0
      && Math.abs(paid - expectedNet) < 0.01
      && matchingRows.every((row) => row.valorAberto <= MONEY_TOLERANCE);

    if (isExactPayment) {
      const paymentDates = uniqueDates(
        matchingRows
          .map((row) => row.dataBaixa)
          .filter((date): date is Date => date !== null),
      );

      nota.informacoes = paymentDates.length > 0
        ? paymentDates.map(formatDate).join(" e ")
        : "Pagamento integral localizado no ERP";
      removeIncorrectDifferenceReasons(nota);
      continue;
    }

    const createdUnsafeNegative = expectedNet >= -MONEY_TOLERANCE
      && nota.faltaPagar < -MONEY_TOLERANCE
      && nota.confiancaAssociacao !== "Alta";

    if (createdUnsafeNegative) {
      nota.faltaPagar = expectedNet;
      nota.confiancaAssociacao = "Manual";
      nota.informacoes = "Possível pagamento localizado, mas a associação financeira foi bloqueada (conferir)";
      const reason = "A associação criaria saldo negativo sem confiança alta. Nenhum valor financeiro foi alterado.";
      if (!nota.motivosConferencia.includes(reason)) nota.motivosConferencia.push(reason);
    }
  }
}
