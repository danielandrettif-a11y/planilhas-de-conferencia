import {
  applyPagamentosPdf as applyPagamentosPdfOriginal,
  type MesConferencia,
  type NotaFiscal,
} from "./transformSpreadsheet";
import {
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx as buildXlsxSafe,
  flagDuplicateInvoices,
  transformRows as transformRowsSafe,
  type BuildXlsxOptions,
  type SheetInput,
  type SheetRow,
  type TransformResult,
} from "./transformSpreadsheetSafe";
import type { PagamentoRow } from "./parsePagamentosPdf";

export {
  applyPreviousInfo,
  buildPreviousInfoMap,
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

interface ReturnEntry {
  amount: number;
  documentNumber: string;
  originalInvoiceNumber: string;
  date: Date | string | number | null;
  description: string;
  sourceRow: number;
}

const MONEY_TOLERANCE = 0.005;
const returnEntriesByNote = new WeakMap<NotaFiscal, ReturnEntry[]>();

const RETURN_STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por",
  "ltda", "me", "epp", "eireli", "sa", "cia", "mei",
  "valor", "nf", "nota", "fiscal", "ref", "referente", "devolucao", "emitida", "emitido", "documento",
  "comercio", "comercial", "servico", "servicos", "produto", "produtos", "fornecedor", "fornecedores",
]);

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
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

function extractReturnInvoiceNumber(description: string): string | null {
  const normalized = normalizeText(description);
  const invoiceReferences = [...normalized.matchAll(/\bNF\s*(?:-|N[ºO.]?\s*)?\s*(\d+)/g)]
    .map((match) => normalizeNoteNumber(match[1]))
    .filter(Boolean);

  if (invoiceReferences.length > 0) return invoiceReferences[invoiceReferences.length - 1];

  const explicit = normalized.match(/DEVOLUCAO\s+(?:DA\s+|DE\s+)?NOTA\s+FISCAL\s*(?:N[ºO.]?\s*)?(\d+)/);
  return explicit ? normalizeNoteNumber(explicit[1]) : null;
}

function extractReturnDocumentNumber(description: string, originalInvoiceNumber: string): string {
  const normalized = normalizeText(description);
  const prefix = normalized.match(/^VALOR\s+(?:DEVOLUCAO\s+)?NF\s*[-:]?\s*(\d+)/);
  const documentNumber = prefix ? normalizeNoteNumber(prefix[1]) : "";
  return documentNumber && documentNumber !== originalInvoiceNumber ? documentNumber : "";
}

function supplierTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !RETURN_STOP_WORDS.has(token)),
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

function findReturnTarget(
  originalInvoiceNumber: string,
  description: string,
  notes: NotaFiscal[],
): NotaFiscal | null {
  const candidates = notes.filter(
    (note) => normalizeNoteNumber(note.notaFiscal) === originalInvoiceNumber,
  );

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((note) => ({ note, score: supplierOverlap(description, note.fornecedor) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score ?? -1)) {
    return ranked[0].note;
  }
  return null;
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

function formatDateList(dates: Date[]): string {
  return uniqueDates(dates).map(formatDate).join(", ");
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(roundCurrency(value))
    .replace(/\u00a0/g, " ");
}

function returnMessage(entry: ReturnEntry): string {
  const documentText = entry.documentNumber
    ? ` — documento ${entry.documentNumber} referente à NF ${entry.originalInvoiceNumber}`
    : ` referente à NF ${entry.originalInvoiceNumber}`;
  return `Foi emitida uma devolução de ${formatBRL(entry.amount)}${documentText}`;
}

function appendReturnMessages(notes: NotaFiscal[]): void {
  for (const note of notes) {
    const entries = returnEntriesByNote.get(note) ?? [];
    if (entries.length === 0) continue;

    const messages = entries.map(returnMessage);
    const missingMessages = messages.filter((message) => !note.informacoes.includes(message));
    if (missingMessages.length > 0) {
      const existing = note.informacoes.replace(/\s*\(conferir\)\s*$/i, "").trim();
      note.informacoes = [existing, ...missingMessages].filter(Boolean).join(" | ");
    }

    if (!/\(conferir\)\s*$/i.test(note.informacoes)) {
      note.informacoes = `${note.informacoes} (conferir)`;
    }

    for (const entry of entries) {
      const reason = `A devolução de ${formatBRL(entry.amount)}, documento ${entry.documentNumber || "não identificado"}, foi vinculada à NF original ${entry.originalInvoiceNumber} a partir da linha ${entry.sourceRow}. O valor foi mantido como crédito no FALTA PAGAR.`;
      if (!note.motivosConferencia.includes(reason)) note.motivosConferencia.push(reason);
    }
  }
}

export function transformRows(rows: SheetRow[]): TransformResult {
  const result = transformRowsSafe(rows);
  const descriptionKey = findKey(rows[0], ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"]);
  const valueKey = findKey(rows[0], ["Valor"]);
  const dateKey = findKey(rows[0], ["Data"]);

  if (!descriptionKey || !valueKey || !dateKey) return result;

  for (const [index, row] of rows.entries()) {
    const description = String(row[descriptionKey] ?? "").trim();
    if (!/DEVOLU[CÇ][AÃ]O/i.test(description)) continue;

    const accountingValue = parseAccountingValue(row[valueKey]);
    if (accountingValue === null || accountingValue >= -MONEY_TOLERANCE) continue;

    const originalInvoiceNumber = extractReturnInvoiceNumber(description);
    if (!originalInvoiceNumber) continue;

    const target = findReturnTarget(originalInvoiceNumber, description, result.notas);
    if (!target) continue;

    const amount = roundCurrency(Math.abs(accountingValue));
    const entry: ReturnEntry = {
      amount,
      documentNumber: extractReturnDocumentNumber(description, originalInvoiceNumber),
      originalInvoiceNumber,
      date: (row[dateKey] as Date | string | number | null) ?? null,
      description,
      sourceRow: index + 2,
    };

    target.faltaPagar = roundCurrency(target.faltaPagar - amount);
    returnEntriesByNote.set(target, [...(returnEntriesByNote.get(target) ?? []), entry]);
  }

  appendReturnMessages(result.notas);
  return result;
}

function paymentRowsForNote(note: NotaFiscal, rows: PagamentoRow[]): PagamentoRow[] {
  const noteNumber = normalizeNoteNumber(note.notaFiscal);
  if (!noteNumber || noteNumber === "0") return [];
  return rows.filter((row) => normalizeNoteNumber(row.numero) === noteNumber);
}

function paidTotal(rows: PagamentoRow[]): number {
  return roundCurrency(rows.reduce(
    (sum, row) => sum + Math.max(0, row.valorTitulo - row.valorAberto),
    0,
  ));
}

function openTotal(rows: PagamentoRow[]): number {
  return roundCurrency(rows.reduce((sum, row) => sum + row.valorAberto, 0));
}

function removeIncorrectDifferenceReasons(note: NotaFiscal): void {
  note.motivosConferencia = note.motivosConferencia.filter((reason) => {
    const normalized = reason.toLowerCase();
    return !normalized.includes("foram pagos")
      && !normalized.includes("pagamento localizado no erp foi")
      && !normalized.includes("valor líquido esperado da nf é")
      && !normalized.includes("pagamento excedeu");
  });
}

/**
 * O PDF é usado apenas para conferir datas, parcelas e divergências. O saldo
 * FALTA PAGAR é sempre restaurado ao valor calculado pelos lançamentos da
 * planilha bruta, evitando descontar o mesmo pagamento duas vezes.
 */
export function applyPagamentosPdf(
  notes: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const accountingBalanceByNote = new Map<NotaFiscal, number>();
  const grossByNote = new Map<NotaFiscal, number>();
  const comparisonValueByNote = new Map<NotaFiscal, number>();

  for (const note of notes) {
    const accountingBalance = roundCurrency(note.faltaPagar);
    const returnTotal = roundCurrency(
      (returnEntriesByNote.get(note) ?? []).reduce((sum, entry) => sum + entry.amount, 0),
    );
    const balanceBeforeReturns = roundCurrency(accountingBalance + returnTotal);
    const matchingRows = paymentRowsForNote(note, pdfRows);
    const paid = paidTotal(matchingRows);
    const allClosed = matchingRows.length > 0 && openTotal(matchingRows) <= MONEY_TOLERANCE;

    accountingBalanceByNote.set(note, accountingBalance);
    grossByNote.set(note, note.valorNF);

    // Quando o PDF está quitado, a comparação temporária usa pagamento + saldo
    // contábil restante. Isso impede que o núcleo subtraia o pagamento novamente.
    const comparisonValue = allClosed && paid > MONEY_TOLERANCE
      ? roundCurrency(paid + Math.max(0, balanceBeforeReturns))
      : note.valorNF;
    comparisonValueByNote.set(note, comparisonValue);
    note.valorNF = comparisonValue;
  }

  try {
    applyPagamentosPdfOriginal(notes, pdfRows, opts);
  } finally {
    for (const note of notes) {
      note.valorNF = grossByNote.get(note) ?? note.valorNF;
      note.faltaPagar = accountingBalanceByNote.get(note) ?? note.faltaPagar;
    }
  }

  for (const note of notes) {
    const accountingBalance = accountingBalanceByNote.get(note);
    if (accountingBalance === undefined) continue;

    const returnTotal = roundCurrency(
      (returnEntriesByNote.get(note) ?? []).reduce((sum, entry) => sum + entry.amount, 0),
    );
    const balanceBeforeReturns = roundCurrency(accountingBalance + returnTotal);
    const matchingRows = paymentRowsForNote(note, pdfRows);
    const paid = paidTotal(matchingRows);
    const allClosed = matchingRows.length > 0 && openTotal(matchingRows) <= MONEY_TOLERANCE;
    const paymentDates = uniqueDates(
      matchingRows
        .map((row) => row.dataBaixa)
        .filter((date): date is Date => date !== null),
    );

    if (allClosed && paid > MONEY_TOLERANCE) {
      const datesText = paymentDates.length > 0
        ? formatDateList(paymentDates)
        : "sem data de baixa informada";

      if (Math.abs(paid - balanceBeforeReturns) < 0.01) {
        note.informacoes = paymentDates.length > 0
          ? datesText
          : "Pagamento integral localizado no ERP";
        removeIncorrectDifferenceReasons(note);
      } else if (Math.abs(roundCurrency(note.valorNF - paid) - balanceBeforeReturns) < 0.01) {
        note.informacoes = `Pagamentos localizados no ERP em ${datesText}. Saldo restante: ${formatBRL(balanceBeforeReturns)}`;
        removeIncorrectDifferenceReasons(note);
      }
    }

    // Reforça a regra central: nenhuma leitura do PDF modifica o saldo contábil.
    note.faltaPagar = accountingBalance;
  }

  appendReturnMessages(notes);
}

export async function buildXlsx(
  input: TransformResult | SheetInput[],
  options: BuildXlsxOptions = {},
): Promise<Blob> {
  const sheets: SheetInput[] = Array.isArray(input)
    ? input
    : [{ conta: "Conta", result: input }];
  for (const sheet of sheets) appendReturnMessages(sheet.result.notas);
  return buildXlsxSafe(input, options);
}
