import {
  applyPagamentosPdf,
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
  transformRows as transformRowsBase,
  type BuildXlsxOptions,
  type MesConferencia,
  type NotaFiscal,
  type SheetInput,
  type SheetRow,
  type TransformResult,
} from "./transformSpreadsheetFinal";

export {
  applyPagamentosPdf,
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  flagDuplicateInvoices,
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
const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por",
  "ltda", "me", "epp", "eireli", "sa", "cia", "mei",
  "pagto", "pagamento", "nf", "nota", "fiscal", "referente", "conforme", "debito", "credito",
  "material", "materiais", "medicamento", "medicamentos", "produto", "produtos", "servico", "servicos",
]);

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNoteNumber(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/\.0+$/, "")
    .replace(/\D+/g, "")
    .replace(/^0+/, "") || "0";
}

function findKey(row: SheetRow | undefined, candidates: string[]): string | null {
  if (!row) return null;
  const keys = Object.keys(row);
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

function parseAccountingValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
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
    normalized = cleaned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
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

function extractPaymentTitle(description: string): string | null {
  const normalized = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const match = normalized.match(/\b(?:PAGTO|PAGAMENTO)\s+(?:DA\s+)?NF\s*[-:]?\s*(\d+)/);
  return match ? normalizeNoteNumber(match[1]) : null;
}

function isDerivedTitle(baseNumber: string, titleNumber: string): boolean {
  if (!baseNumber || !titleNumber || titleNumber === baseNumber) return false;
  if (!titleNumber.startsWith(baseNumber)) return false;
  const suffix = titleNumber.slice(baseNumber.length);
  return suffix.length >= 3 && /^0+\d+$/.test(suffix);
}

function supplierTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
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

function chooseDerivedPaymentTarget(
  titleNumber: string,
  description: string,
  notes: NotaFiscal[],
): NotaFiscal | null {
  const candidates = notes
    .filter((note) => isDerivedTitle(normalizeNoteNumber(note.notaFiscal), titleNumber))
    .map((note) => ({
      note,
      baseLength: normalizeNoteNumber(note.notaFiscal).length,
      supplierScore: supplierOverlap(description, note.fornecedor),
    }))
    .filter((candidate) => candidate.supplierScore > 0)
    .sort((a, b) => (
      b.baseLength - a.baseLength
      || b.supplierScore - a.supplierScore
    ));

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].note;

  const first = candidates[0];
  const second = candidates[1];
  if (first.baseLength > second.baseLength) return first.note;
  if (first.supplierScore > second.supplierScore) return first.note;
  return null;
}

/**
 * Complementa o processamento da planilha bruta para títulos contábeis como
 * 2563700001, em que 25637 é a NF-base e 00001 representa a parcela.
 */
export function transformRows(rows: SheetRow[]): TransformResult {
  const result = transformRowsBase(rows);
  const descriptionKey = findKey(rows[0], ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"]);
  const valueKey = findKey(rows[0], ["Valor"]);
  if (!descriptionKey || !valueKey) return result;

  for (const [index, row] of rows.entries()) {
    const description = String(row[descriptionKey] ?? "").trim();
    if (!/\b(?:PAGTO|PAGAMENTO)\b/i.test(description)) continue;

    const value = parseAccountingValue(row[valueKey]);
    if (value === null || value >= -MONEY_TOLERANCE) continue;

    const titleNumber = extractPaymentTitle(description);
    if (!titleNumber) continue;

    // Números exatos já são tratados pelo núcleo; aqui entram somente derivados.
    if (result.notas.some((note) => normalizeNoteNumber(note.notaFiscal) === titleNumber)) continue;

    const target = chooseDerivedPaymentTarget(titleNumber, description, result.notas);
    if (!target) continue;

    const amount = roundCurrency(Math.abs(value));
    target.faltaPagar = roundCurrency(target.faltaPagar - amount);

    const reason = `Pagamento contábil de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount)} na linha ${index + 2} foi vinculado à NF ${target.notaFiscal} pelo título derivado ${titleNumber}.`;
    if (!target.motivosConferencia.includes(reason)) target.motivosConferencia.push(reason);
  }

  return result;
}
