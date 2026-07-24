import {
  applyPagamentosPdf as applyPagamentosPdfOriginal,
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
  transformRows as transformRowsOriginal,
  type MesConferencia,
  type NotaFiscal,
  type SheetInput,
  type SheetRow,
  type TransformResult,
} from "./transformSpreadsheet";
import type { PagamentoRow } from "./parsePagamentosPdf";

export {
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
};

export type {
  MesConferencia,
  NotaFiscal,
  SheetInput,
  SheetRow,
  TransformResult,
};

const MONEY_TOLERANCE = 0.005;
const RECONCILIATION_SUPPLIER = "AJUSTE DE RECONCILIAÇÃO DA PLANILHA BRUTA";

/**
 * Guarda o saldo real da planilha bruta para o mesmo array de notas que segue
 * pelas etapas de mês anterior, PDF do ERP e geração do Excel.
 */
const rawBalanceByNotes = new WeakMap<NotaFiscal[], number>();

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(roundCurrency(value)).replace(/\u00a0/g, " ");
}

function findValueKey(rows: SheetRow[]): string | null {
  const first = rows[0];
  if (!first) return null;
  const keys = Object.keys(first);
  return keys.find((key) => key.trim().toLowerCase() === "valor")
    ?? keys.find((key) => key.trim().toLowerCase().includes("valor"))
    ?? null;
}

/**
 * Interpreta tanto números reais quanto valores textuais do relatório,
 * incluindo os indicadores contábeis C e D.
 */
function parseAccountingValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null || String(value).trim() === "") return null;

  const original = String(value).trim();
  const indicator = original.match(/([DC])\s*$/i)?.[1]?.toUpperCase() ?? null;
  const cleaned = original
    .replace(/([DC])\s*$/i, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");

  if (!cleaned || !/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const thousandsOnly = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(cleaned);
    normalized = thousandsOnly ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (indicator === "D") return -Math.abs(parsed);
  if (indicator === "C") return Math.abs(parsed);
  return parsed;
}

function calculateRawBalance(rows: SheetRow[]): number | null {
  const valueKey = findValueKey(rows);
  if (!valueKey) return null;

  let found = false;
  const total = rows.reduce((sum, row) => {
    const value = parseAccountingValue(row[valueKey]);
    if (value === null) return sum;
    found = true;
    return sum + value;
  }, 0);

  return found ? roundCurrency(total) : null;
}

function isReconciliationRow(nota: NotaFiscal): boolean {
  return nota.fornecedor === RECONCILIATION_SUPPLIER;
}

function removeReconciliationRows(notas: NotaFiscal[]): void {
  for (let index = notas.length - 1; index >= 0; index--) {
    if (isReconciliationRow(notas[index])) notas.splice(index, 1);
  }
}

/**
 * Impede que qualquer lançamento da planilha bruta desapareça silenciosamente.
 * A diferença fica visível em uma linha manual e o total da aba passa a ser
 * exatamente o mesmo saldo obtido pela soma dos lançamentos de origem.
 */
function reconcileToRawBalance(notas: NotaFiscal[], rawBalance: number): void {
  removeReconciliationRows(notas);

  const generatedBalance = roundCurrency(
    notas.reduce((sum, nota) => sum + nota.faltaPagar, 0),
  );
  const difference = roundCurrency(rawBalance - generatedBalance);
  if (Math.abs(difference) < 0.01) return;

  const direction = difference > 0 ? "credor" : "devedor";
  const reason = [
    `A transformação deixou uma diferença de ${formatBRL(Math.abs(difference))} no lado ${direction}.`,
    `O valor foi preservado nesta linha para que o total gerado corresponda ao saldo real da planilha bruta (${formatBRL(rawBalance)}).`,
    "Conferir os lançamentos sem padrão de NF ou sem associação segura antes de fazer ajustes contábeis.",
  ].join(" ");

  notas.push({
    data: null,
    fornecedor: RECONCILIATION_SUPPLIER,
    notaFiscal: "",
    valorNF: difference > 0 ? difference : 0,
    faltaPagar: difference,
    informacoes: `Diferença da importação preservada: ${formatBRL(difference)} (conferir)`,
    confiancaAssociacao: "Manual",
    motivosConferencia: [reason],
  });
}

export function transformRows(rows: SheetRow[]): TransformResult {
  const result = transformRowsOriginal(rows);
  const rawBalance = calculateRawBalance(rows);

  if (rawBalance !== null) {
    rawBalanceByNotes.set(result.notas, rawBalance);
    reconcileToRawBalance(result.notas, rawBalance);
  }

  return result;
}

function restoreUnsafeNegativeBalances(
  notas: NotaFiscal[],
  previousBalances: Map<NotaFiscal, number>,
): void {
  for (const nota of notas) {
    if (isReconciliationRow(nota)) continue;

    const previous = previousBalances.get(nota);
    if (previous === undefined) continue;

    const createdNegative = previous >= -MONEY_TOLERANCE
      && nota.faltaPagar < -MONEY_TOLERANCE;
    if (!createdNegative) continue;

    const reference = Math.max(Math.abs(previous), Math.abs(nota.valorNF));
    const clearlyIncompatible = Math.abs(nota.faltaPagar) > Math.max(5000, reference * 0.5);
    const associationIsNotHigh = nota.confiancaAssociacao !== "Alta";

    if (!associationIsNotHigh && !clearlyIncompatible) continue;

    const rejectedValue = Math.abs(nota.faltaPagar);
    nota.faltaPagar = previous;
    nota.confiancaAssociacao = "Manual";
    nota.informacoes = "Possível pagamento localizado, mas a associação financeira foi bloqueada (conferir)";

    const reason = clearlyIncompatible
      ? `O pagamento candidato criaria saldo negativo de ${formatBRL(rejectedValue)}, incompatível com a NF de ${formatBRL(nota.valorNF)}. Nenhum valor financeiro foi alterado.`
      : "A associação não possui confiança alta e criaria saldo negativo. Nenhum valor financeiro foi alterado.";

    if (!nota.motivosConferencia.includes(reason)) {
      nota.motivosConferencia.push(reason);
    }
  }
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const previousBalances = new Map<NotaFiscal, number>();
  for (const nota of notas) {
    if (!isReconciliationRow(nota)) previousBalances.set(nota, nota.faltaPagar);
  }

  // A linha de reconciliação não deve ser consultada no PDF do ERP.
  removeReconciliationRows(notas);
  applyPagamentosPdfOriginal(notas, pdfRows, opts);
  restoreUnsafeNegativeBalances(notas, previousBalances);

  const rawBalance = rawBalanceByNotes.get(notas);
  if (rawBalance !== undefined) reconcileToRawBalance(notas, rawBalance);
}
