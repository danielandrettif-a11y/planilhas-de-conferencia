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
const RETENTION_DESCRIPTION_RE = /\b(?:INSS|IRRF|ISS(?:QN)?|PIS|COFINS|CSLL|RETENCAO|IMPOSTO|ABATIMENTO|DESCONTO)\b/i;
const GENERIC_SUPPLIER_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por",
  "ltda", "me", "epp", "eireli", "sa", "cia", "mei",
  "valor", "nf", "nota", "fiscal", "sobre", "terceiros",
  "inss", "irrf", "iss", "issqn", "pis", "cofins", "csll", "retencao", "imposto", "abatimento", "desconto",
  "comercio", "comercial", "servico", "servicos", "empresa", "produto", "produtos", "fornecedor", "fornecedores",
]);

/**
 * Guarda o saldo real da planilha bruta e as retenções da NF para o mesmo
 * conjunto de notas usado nas etapas de PDF e geração do Excel.
 */
const rawBalanceByNotes = new WeakMap<NotaFiscal[], number>();
const retentionByNote = new WeakMap<NotaFiscal, number>();

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(roundCurrency(value)).replace(/\u00a0/g, " ");
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findKey(rows: SheetRow[], candidates: string[]): string | null {
  const first = rows[0];
  if (!first) return null;
  const keys = Object.keys(first);

  for (const candidate of candidates) {
    const exact = keys.find((key) => key.trim().toLowerCase() === candidate.trim().toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = keys.find((key) => key.trim().toLowerCase().includes(candidate.trim().toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

function findValueKey(rows: SheetRow[]): string | null {
  return findKey(rows, ["Valor"]);
}

function findDescriptionKey(rows: SheetRow[]): string | null {
  return findKey(rows, ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"]);
}

/**
 * Interpreta números reais e valores textuais do relatório, incluindo os
 * indicadores contábeis C e D.
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

/**
 * Replica a interpretação antiga do núcleo, que removia D/C sem considerar o
 * lado contábil. É usada apenas para detectar retenções textuais que ainda não
 * foram abatidas pelo processamento original.
 */
function parseLegacyValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || String(value).trim() === "") return null;

  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!cleaned || !/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const thousandsOnly = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(cleaned);
    normalized = thousandsOnly ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeNoteNumber(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\.0+$/, "").replace(/\D+/g, "").replace(/^0+/, "") || "0";
}

function extractRetentionNoteNumber(description: string): string | null {
  const normalized = removeAccents(description).toUpperCase();
  const match = normalized.match(/(?:S\s*\/\s*(?:NF\s*)?|SOBRE\s+(?:A\s+)?(?:NF\s*)?|REF\.?\s*(?:NF\s*)?|NF\s*(?:-|N[ºO.]?\s*)?)\s*(\d+)/)
    ?? normalized.match(/\bNOTA\s+FISCAL\s*(?:N[ºO.]?\s*)?(\d+)/);
  return match ? normalizeNoteNumber(match[1]) : null;
}

function isSafeShortenedNote(fullNumber: string, shortened: string): boolean {
  if (shortened.length < 5 || fullNumber.length <= shortened.length || !fullNumber.endsWith(shortened)) return false;
  const removedPrefix = fullNumber.slice(0, fullNumber.length - shortened.length);
  return /^\d{2,}$/.test(removedPrefix);
}

function supplierTokens(value: string): Set<string> {
  const tokens = removeAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_SUPPLIER_WORDS.has(token));
  return new Set(tokens);
}

function supplierOverlap(description: string, supplier: string): number {
  const descriptionTokens = supplierTokens(description);
  const supplierNameTokens = supplierTokens(supplier);
  let overlap = 0;
  for (const token of supplierNameTokens) {
    if (descriptionTokens.has(token)) overlap++;
  }
  return overlap;
}

function findRetentionTarget(
  number: string,
  description: string,
  notas: NotaFiscal[],
): NotaFiscal | null {
  const exact = notas.filter((nota) => normalizeNoteNumber(nota.notaFiscal) === number);
  const candidates = exact.length > 0
    ? exact
    : notas.filter((nota) => isSafeShortenedNote(normalizeNoteNumber(nota.notaFiscal), number));

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const ranked = candidates
    .map((nota) => ({ nota, score: supplierOverlap(description, nota.fornecedor) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score ?? -1)) return ranked[0].nota;
  return null;
}

function collectRetentions(rows: SheetRow[], notas: NotaFiscal[]): void {
  const descriptionKey = findDescriptionKey(rows);
  const valueKey = findValueKey(rows);
  if (!descriptionKey || !valueKey) return;

  const totals = new Map<NotaFiscal, number>();

  for (const row of rows) {
    const description = String(row[descriptionKey] ?? "").trim();
    if (!description || !RETENTION_DESCRIPTION_RE.test(removeAccents(description))) continue;

    const value = parseAccountingValue(row[valueKey]);
    if (value === null || value >= -MONEY_TOLERANCE) continue;

    const number = extractRetentionNoteNumber(description);
    if (!number) continue;

    const target = findRetentionTarget(number, description, notas);
    if (!target) continue;

    const amount = Math.abs(value);
    totals.set(target, roundCurrency((totals.get(target) ?? 0) + amount));

    // Ex.: "34,53D" virava +34,53 no núcleo antigo e não era descontado.
    const legacyValue = parseLegacyValue(row[valueKey]);
    if (legacyValue !== null && legacyValue >= -MONEY_TOLERANCE) {
      target.faltaPagar = roundCurrency(target.faltaPagar - amount);
    }
  }

  for (const nota of notas) {
    retentionByNote.set(nota, totals.get(nota) ?? 0);
  }
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
  collectRetentions(rows, result.notas);

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

function rewriteNetValueReasons(notas: NotaFiscal[]): void {
  for (const nota of notas) {
    const retention = retentionByNote.get(nota) ?? 0;
    if (retention <= MONEY_TOLERANCE) continue;

    nota.motivosConferencia = nota.motivosConferencia.map((reason) => (
      reason.replace(/^O valor da NF é /, "O valor líquido esperado da NF é ")
    ));
  }
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const previousBalances = new Map<NotaFiscal, number>();
  const grossValues = new Map<NotaFiscal, number>();

  for (const nota of notas) {
    if (isReconciliationRow(nota)) continue;
    previousBalances.set(nota, nota.faltaPagar);

    const retention = retentionByNote.get(nota) ?? 0;
    if (retention > MONEY_TOLERANCE) {
      grossValues.set(nota, nota.valorNF);
      nota.valorNF = roundCurrency(Math.max(0, nota.valorNF - retention));
    }
  }

  // A linha de reconciliação não deve ser consultada no PDF do ERP.
  removeReconciliationRows(notas);

  try {
    // O núcleo passa a comparar o pagamento com o valor líquido temporário.
    applyPagamentosPdfOriginal(notas, pdfRows, opts);
  } finally {
    // O relatório continua exibindo o valor bruto original da NF.
    for (const [nota, grossValue] of grossValues) nota.valorNF = grossValue;
  }

  rewriteNetValueReasons(notas);
  restoreUnsafeNegativeBalances(notas, previousBalances);

  const rawBalance = rawBalanceByNotes.get(notas);
  if (rawBalance !== undefined) reconcileToRawBalance(notas, rawBalance);
}
