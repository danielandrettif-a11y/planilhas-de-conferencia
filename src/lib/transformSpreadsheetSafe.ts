import ExcelJS from "exceljs";
import {
  applyPreviousInfo as applyPreviousInfoOriginal,
  buildPreviousInfoMap as buildPreviousInfoMapOriginal,
  buildXlsx as buildXlsxOriginal,
  flagDuplicateInvoices as flagDuplicateInvoicesOriginal,
  type AssociationConfidence,
  type BuildXlsxOptions,
  type MesConferencia,
  type NotaFiscal as OriginalNotaFiscal,
  type PrevEntry,
  type SheetRow,
} from "./transformSpreadsheet";
import type { PagamentoRow } from "./parsePagamentosPdf";

export type {
  AssociationConfidence,
  BuildXlsxOptions,
  MesConferencia,
  PrevEntry,
  SheetRow,
};

export interface ImportPending {
  linha: number;
  data: Date | string | number | null;
  descricao: string;
  valor: number;
  motivo: string;
}

export type NotaFiscal = OriginalNotaFiscal & {
  totalRetencoes?: number;
  origemLinha?: number;
  sintetica?: boolean;
};

export interface TransformResult {
  notas: NotaFiscal[];
  pendencias: ImportPending[];
  saldoBruto: number;
}

export interface SheetInput {
  conta: string;
  result: TransformResult;
}

const MONEY_TOLERANCE = 0.005;
const AUTO_VALUE_MIN_TOLERANCE = 5;
const AUTO_VALUE_PERCENT_TOLERANCE = 0.01;

const LEGAL_SUFFIXES = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "cia", "mei", "ss",
]);

const GENERIC_SUPPLIER_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por",
  "empresa", "fornecedor", "fornecedores", "comercio", "comercial", "industria", "industrial", "produto", "produtos",
  "servico", "servicos", "medico", "medica", "medicos", "medicas", "hospitalar", "hospitalares",
  "valor", "nf", "nota", "fiscal", "pagamento", "pago", "ref", "referente", "sobre", "terceiros",
  "inss", "irrf", "iss", "issqn", "pis", "cofins", "csll", "retencao", "imposto", "abatimento", "desconto",
]);

const RETENTION_RE = /\b(?:INSS|IRRF|ISS(?:QN)?|PIS|COFINS|CSLL|RETENCAO|IMPOSTO|ABATIMENTO|DESCONTO)\b/i;

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(roundCurrency(value))
    .replace(/\u00a0/g, " ");
}

function formatDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const parsed = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const parsed = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findKey(row: SheetRow, candidates: string[]): string | null {
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

interface AccountingValue {
  value: number;
  indicator: "D" | "C" | null;
}

function parseLocaleNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/[^\d.,+-]/g, "");
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

function parseAccountingValue(value: unknown): AccountingValue | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, indicator: null } : null;
  }
  if (value == null || String(value).trim() === "") return null;

  const text = String(value).trim().toUpperCase();
  const indicatorMatch = text.match(/([DC])\s*$/);
  const parsed = parseLocaleNumber(text);
  if (parsed === null) return null;

  const indicator = indicatorMatch ? indicatorMatch[1] as "D" | "C" : null;
  if (indicator === "D") return { value: -Math.abs(parsed), indicator };
  if (indicator === "C") return { value: Math.abs(parsed), indicator };
  return { value: parsed, indicator: null };
}

function normNota(value: unknown): string {
  if (value == null) return "";
  const digits = String(value).trim().replace(/\.0+$/, "").replace(/\D+/g, "").replace(/^0+/, "");
  return digits || "0";
}

function cleanFornecedor(value: string): string {
  return value
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+(?:REFERENTE|REF\.?|NOTA\s+FISCAL|CONFORME|PAGAMENTO)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:\-–—]+$/, "")
    .trim();
}

interface ParsedDescription {
  isNF: boolean;
  numero: string | null;
  fornecedor: string;
}

function parseDescription(description: string): ParsedDescription {
  const value = description.trim();
  const nf = value.match(/^VALOR\s+NF\b[\s-]*(.+)$/i);
  if (nf) {
    const rest = nf[1].trim();
    const match = rest.match(/^(\d+)\s*[-–—]?\s*(.*)$/);
    if (match) {
      return {
        isNF: true,
        numero: normNota(match[1]),
        fornecedor: cleanFornecedor(match[2]),
      };
    }
    return { isNF: true, numero: null, fornecedor: cleanFornecedor(rest) };
  }

  const upper = removeAccents(value).toUpperCase();
  const numberMatch = upper.match(/(?:S\s*\/\s*(?:NF\s*)?|SOBRE\s+(?:A\s+)?(?:NF\s*)?|REF\.?\s*(?:NF\s*)?|NF\s*(?:-|N[ºO.]?\s*)?)\s*(\d+)/)
    ?? upper.match(/\bNOTA\s+FISCAL\s*(?:N[ºO.]?\s*)?(\d+)/);
  const numero = numberMatch ? normNota(numberMatch[1]) : null;

  let fornecedor = value;
  if (numero) {
    const index = upper.lastIndexOf(numberMatch?.[1] ?? "");
    if (index >= 0) fornecedor = value.slice(index + (numberMatch?.[1].length ?? 0));
  }

  return { isNF: false, numero, fornecedor: cleanFornecedor(fornecedor) };
}

interface NormalizedSupplier {
  full: string;
  significant: string[];
}

function normalizeSupplier(value: unknown): NormalizedSupplier {
  const text = removeAccents(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = text
    .split(" ")
    .filter(Boolean)
    .filter((token) => !/^\d{4,}$/.test(token))
    .map((token) => token === "servicos" ? "servico" : token)
    .map((token) => token === "medicos" ? "medico" : token)
    .filter((token) => !LEGAL_SUFFIXES.has(token));

  const significant = tokens.filter((token) => token.length >= 3 && !GENERIC_SUPPLIER_WORDS.has(token));
  return { full: tokens.join(" "), significant };
}

function tokenCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.startsWith(shorter);
}

function supplierScore(a: unknown, b: unknown): number {
  const first = normalizeSupplier(a);
  const second = normalizeSupplier(b);
  if (!first.full || !second.full) return 0;
  if (first.full === second.full) return 100;

  const shorter = first.full.length <= second.full.length ? first.full : second.full;
  const longer = first.full.length <= second.full.length ? second.full : first.full;
  if (shorter.length >= 10 && longer.startsWith(shorter)) return 96;

  let overlap = 0;
  for (const token of first.significant) {
    if (second.significant.some((other) => tokenCompatible(token, other))) overlap++;
  }

  const minimum = Math.min(first.significant.length, second.significant.length);
  if (overlap < 2 || minimum < 2) return 0;
  const coverage = overlap / minimum;
  if (coverage >= 0.8) return 94;
  if (coverage >= 0.6) return 90;
  return 0;
}

function isSafeShortenedTitle(fullNumber: string, shortened: string): boolean {
  if (shortened.length < 5 || fullNumber.length <= shortened.length || !fullNumber.endsWith(shortened)) return false;
  const removed = fullNumber.slice(0, fullNumber.length - shortened.length);
  return /^\d{2,}$/.test(removed);
}

function isSafeDerivedTitle(nf: string, title: string): boolean {
  if (!nf || title === nf || !title.startsWith(nf)) return false;
  const suffix = title.slice(nf.length);
  return suffix.length >= 3 && /^0+\d*$/.test(suffix);
}

function isRetentionDescription(description: string): boolean {
  return RETENTION_RE.test(removeAccents(description));
}

function addReason(nota: NotaFiscal, reason: string): void {
  if (reason && !nota.motivosConferencia.includes(reason)) nota.motivosConferencia.push(reason);
}

function markConferir(nota: NotaFiscal): void {
  if (!/\(conferir\)/i.test(nota.informacoes)) {
    nota.informacoes = nota.informacoes ? `${nota.informacoes} (conferir)` : "(conferir)";
  }
}

function makeSyntheticNote(
  row: SheetRow,
  index: number,
  description: string,
  value: number,
  dataKey: string,
  parsed: ParsedDescription,
  reason: string,
): NotaFiscal {
  return {
    data: (row[dataKey] as Date | string | number | null) ?? null,
    fornecedor: parsed.fornecedor || cleanFornecedor(description.replace(/^VALOR\s+/i, "")),
    notaFiscal: parsed.numero ?? "",
    valorNF: value > 0 ? value : 0,
    faltaPagar: value,
    informacoes: `${reason} (conferir)`,
    confiancaAssociacao: "Manual",
    motivosConferencia: [reason],
    origemLinha: index + 2,
    sintetica: true,
  };
}

function selectAdjustmentTarget(
  numero: string,
  description: string,
  byNumero: Map<string, NotaFiscal[]>,
): NotaFiscal | null {
  const exact = byNumero.get(numero) ?? [];
  const candidates = exact.length > 0
    ? exact
    : [...byNumero.entries()]
      .filter(([full]) => isSafeShortenedTitle(full, numero))
      .flatMap(([, notas]) => notas);

  if (candidates.length === 0) return null;
  if (candidates.length === 1 && exact.length === 1) return candidates[0];

  const ranked = candidates
    .map((nota) => ({ nota, score: supplierScore(description, nota.fornecedor) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score >= 90 && ranked[0].score > (ranked[1]?.score ?? -1)) return ranked[0].nota;
  return null;
}

export function transformRows(rows: SheetRow[]): TransformResult {
  if (rows.length === 0) throw new Error("Planilha vazia.");

  const histKey = findKey(rows[0], ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"]);
  const valorKey = findKey(rows[0], ["Valor"]);
  const dataKey = findKey(rows[0], ["Data"]);
  if (!histKey) throw new Error('Coluna "Descrição histórico" não encontrada.');
  if (!valorKey) throw new Error('Coluna "Valor" não encontrada.');
  if (!dataKey) throw new Error('Coluna "Data" não encontrada.');

  const notas: NotaFiscal[] = [];
  const pendencias: ImportPending[] = [];
  const byNumero = new Map<string, NotaFiscal[]>();
  const invoiceRows = new Set<number>();
  let saldoBruto = 0;

  rows.forEach((row, index) => {
    const accounting = parseAccountingValue(row[valorKey]);
    if (accounting) saldoBruto = roundCurrency(saldoBruto + accounting.value);

    const description = String(row[histKey] ?? "");
    const parsed = parseDescription(description);
    if (!parsed.isNF || !accounting || accounting.value <= 0) return;

    const nota: NotaFiscal = {
      data: (row[dataKey] as Date | string | number | null) ?? null,
      fornecedor: parsed.fornecedor,
      notaFiscal: parsed.numero ?? "",
      valorNF: roundCurrency(Math.abs(accounting.value)),
      faltaPagar: roundCurrency(Math.abs(accounting.value)),
      totalRetencoes: 0,
      informacoes: "",
      confiancaAssociacao: "Manual",
      motivosConferencia: [],
      origemLinha: index + 2,
    };

    notas.push(nota);
    invoiceRows.add(index);
    if (parsed.numero) byNumero.set(parsed.numero, [...(byNumero.get(parsed.numero) ?? []), nota]);
  });

  if (notas.length === 0) throw new Error('Nenhuma linha com "VALOR NF -" foi encontrada no arquivo.');

  rows.forEach((row, index) => {
    if (invoiceRows.has(index)) return;
    const description = String(row[histKey] ?? "").trim();
    const accounting = parseAccountingValue(row[valorKey]);
    if (!description || !accounting || Math.abs(accounting.value) < MONEY_TOLERANCE) return;

    const parsed = parseDescription(description);
    const target = parsed.numero ? selectAdjustmentTarget(parsed.numero, description, byNumero) : null;

    if (accounting.value < 0 && target) {
      target.faltaPagar = roundCurrency(target.faltaPagar + accounting.value);
      if (isRetentionDescription(description)) {
        target.totalRetencoes = roundCurrency((target.totalRetencoes ?? 0) + Math.abs(accounting.value));
      }
      return;
    }

    const reason = accounting.value > 0
      ? "Lançamento credor não identificado pelo padrão VALOR NF; foi preservado para não alterar o saldo da conta."
      : parsed.numero
        ? `Lançamento devedor da NF ${parsed.numero} não pôde ser associado com segurança; foi preservado separadamente.`
        : "Lançamento devedor sem número de NF identificável; foi preservado separadamente.";

    notas.push(makeSyntheticNote(row, index, description, accounting.value, dataKey, parsed, reason));
    pendencias.push({
      linha: index + 2,
      data: (row[dataKey] as Date | string | number | null) ?? null,
      descricao: description,
      valor: accounting.value,
      motivo: reason,
    });
  });

  return { notas, pendencias, saldoBruto: roundCurrency(saldoBruto) };
}

interface PaymentGroup {
  rows: PagamentoRow[];
  score: number;
  supplier: string;
}

function paymentNumberMatches(nf: string, title: string): boolean {
  const normalizedTitle = normNota(title);
  return normalizedTitle === nf
    || isSafeDerivedTitle(nf, normalizedTitle)
    || isSafeShortenedTitle(nf, normalizedTitle);
}

function groupPaymentCandidates(nota: NotaFiscal, rows: PagamentoRow[]): PaymentGroup[] {
  const nf = normNota(nota.notaFiscal);
  const candidates = rows.filter((row) => paymentNumberMatches(nf, row.numero));
  const groups = new Map<string, PagamentoRow[]>();

  for (const row of candidates) {
    const supplier = normalizeSupplier(row.fornecedor).full || row.fornecedor.toLowerCase();
    groups.set(supplier, [...(groups.get(supplier) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([supplier, groupRows]) => ({
      rows: groupRows,
      score: supplierScore(nota.fornecedor, groupRows[0]?.fornecedor ?? ""),
      supplier,
    }))
    .sort((a, b) => b.score - a.score);
}

function uniquePayments(rows: PagamentoRow[]): PagamentoRow[] {
  return [...new Map(rows.map((row) => [
    `${normNota(row.numero)}|${normalizeSupplier(row.fornecedor).full}|${row.valorTitulo}|${row.valorAberto}|${row.dataProgramada?.getTime() ?? ""}|${row.dataBaixa?.getTime() ?? ""}`,
    row,
  ])).values()];
}

function paymentTotal(rows: PagamentoRow[], field: "valorTitulo" | "valorAberto"): number {
  return roundCurrency(rows.reduce((sum, row) => sum + row[field], 0));
}

function paidTotal(rows: PagamentoRow[]): number {
  return roundCurrency(rows.reduce((sum, row) => sum + Math.max(0, row.valorTitulo - row.valorAberto), 0));
}

function ymIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function isLastDay(date: Date): boolean {
  return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function uniqueDates(dates: Date[]): Date[] {
  return [...new Map(dates.map((date) => [`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, date])).values()]
    .sort((a, b) => a.getTime() - b.getTime());
}

function formatDateList(dates: Date[]): string {
  const sorted = uniqueDates(dates);
  const pieces = sorted.map((date, index) => {
    const dayMonth = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    return index === sorted.length - 1 ? `${dayMonth}/${date.getFullYear()}` : dayMonth;
  });
  if (pieces.length === 0) return "";
  if (pieces.length === 1) return pieces[0];
  if (pieces.length === 2) return `${pieces[0]} e ${pieces[1]}`;
  return `${pieces.slice(0, -1).join(", ")} e ${pieces[pieces.length - 1]}`;
}

function valueTolerance(expected: number): number {
  return Math.max(AUTO_VALUE_MIN_TOLERANCE, Math.abs(expected) * AUTO_VALUE_PERCENT_TOLERANCE);
}

function paymentAmountDistance(nota: NotaFiscal, rows: PagamentoRow[]): number {
  const expectedNet = roundCurrency(Math.max(0, nota.valorNF - (nota.totalRetencoes ?? 0)));
  const title = paymentTotal(rows, "valorTitulo");
  const paid = paidTotal(rows);
  return Math.min(
    Math.abs(title - expectedNet),
    Math.abs(title - nota.valorNF),
    Math.abs(paid - expectedNet),
  );
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  if (pdfRows.length === 0) return;
  const generatedAt = opts.generatedAt ?? new Date();
  const generatedDate = formatDate(generatedAt);
  const monthIndex = opts.mesConferencia.ano * 12 + opts.mesConferencia.mes - 1;

  for (const nota of notas) {
    if (nota.sintetica || nota.valorNF <= 0 || !normNota(nota.notaFiscal) || normNota(nota.notaFiscal) === "0") continue;

    nota.motivosConferencia = [];
    const groups = groupPaymentCandidates(nota, pdfRows);
    const strongGroups = groups.filter((group) => group.score >= 90);

    if (strongGroups.length === 0) {
      nota.confiancaAssociacao = "Manual";
      if (groups.length > 0) {
        nota.informacoes = "Possível pagamento localizado, mas o fornecedor não corresponde com segurança";
        addReason(nota, "O número da NF apareceu no ERP, porém houve somente correspondência fraca ou genérica entre os nomes dos fornecedores. Nenhum valor financeiro foi alterado.");
      } else {
        nota.informacoes = `Não consta no ERP até ${generatedDate}`;
        addReason(nota, `Nenhum título seguro foi localizado no relatório do ERP processado em ${generatedDate}.`);
      }
      markConferir(nota);
      continue;
    }

    if (strongGroups.length > 1 && strongGroups[0].score - strongGroups[1].score < 4) {
      nota.confiancaAssociacao = "Manual";
      nota.informacoes = "Mais de um fornecedor possível no ERP";
      addReason(nota, "Mais de um grupo de pagamentos apresentou correspondência forte e semelhante; nenhum valor financeiro foi alterado.");
      markConferir(nota);
      continue;
    }

    const rows = uniquePayments(strongGroups[0].rows);
    const expectedNet = roundCurrency(Math.max(0, nota.valorNF - (nota.totalRetencoes ?? 0)));
    const distance = paymentAmountDistance(nota, rows);
    const tolerance = valueTolerance(expectedNet);
    const exactNumber = rows.some((row) => normNota(row.numero) === normNota(nota.notaFiscal));
    const highConfidence = strongGroups[0].score >= 94 && exactNumber;

    if (distance > tolerance) {
      nota.confiancaAssociacao = "Manual";
      nota.informacoes = "Possível pagamento localizado, mas o valor é incompatível";
      addReason(
        nota,
        `O valor líquido esperado é ${formatBRL(expectedNet)}, mas o grupo candidato no ERP soma ${formatBRL(paymentTotal(rows, "valorTitulo"))}. A associação foi bloqueada e nenhum saldo foi alterado.`,
      );
      markConferir(nota);
      continue;
    }

    nota.confiancaAssociacao = highConfidence ? "Alta" : "Média";
    if (!highConfidence) {
      addReason(nota, "A associação passou pelas validações de fornecedor e valor, mas não possui número de título exatamente igual à NF.");
    }

    const relevantRows = rows.filter((row) => {
      if (!row.dataProgramada) return false;
      const scheduledMonth = ymIndex(row.dataProgramada);
      return scheduledMonth > monthIndex || (scheduledMonth === monthIndex && isLastDay(row.dataProgramada));
    });
    const openRows = rows.filter((row) => row.valorAberto > MONEY_TOLERANCE);
    const openScheduledRows = openRows.filter((row) => row.dataProgramada && !row.dataBaixa);
    const openUndatedRows = openRows.filter((row) => !row.dataProgramada);
    const paid = paidTotal(rows);
    const totalOpen = paymentTotal(rows, "valorAberto");
    const paidDates = rows.map((row) => row.dataBaixa).filter((date): date is Date => date !== null);

    if (relevantRows.length > 0) {
      const dates = formatDateList(relevantRows.map((row) => row.dataProgramada as Date));
      nota.informacoes = rows.length === 1 && openScheduledRows.length === 1
        ? `Programado para ${dates}, mas ainda sem data de baixa`
        : dates;

      if (relevantRows.some((row) => row.dataProgramada && ymIndex(row.dataProgramada) === monthIndex && isLastDay(row.dataProgramada))) {
        addReason(nota, "Há parcela programada para o último dia do mês conferido; conferir possível compensação no primeiro dia útil seguinte.");
      }
      if (openScheduledRows.some((row) => relevantRows.includes(row))) {
        addReason(nota, "Há parcela programada no ERP que ainda não possui data de baixa.");
      }
    } else if (openRows.length > 0) {
      if (openScheduledRows.length > 0) {
        nota.informacoes = `Programado para ${formatDateList(openScheduledRows.map((row) => row.dataProgramada as Date))}, mas ainda sem data de baixa`;
        addReason(nota, "O título permanece em aberto e ainda não possui data de baixa.");
      } else if (openUndatedRows.length > 0) {
        nota.informacoes = "Título cadastrado, mas ainda sem data programada para pagamento";
        addReason(nota, "O título permanece em aberto sem data programada ou data de baixa.");
      } else {
        nota.informacoes = "Título permanece em aberto no ERP";
      }

      const openDifference = roundCurrency(totalOpen - nota.faltaPagar);
      if (Math.abs(openDifference) >= 0.01) {
        addReason(nota, `O ERP informa ${formatBRL(totalOpen)} em aberto, enquanto a planilha informa ${formatBRL(nota.faltaPagar)}.`);
      }
    } else {
      const difference = roundCurrency(paid - expectedNet);
      if (Math.abs(difference) < 0.01) {
        if (nota.faltaPagar > MONEY_TOLERANCE) {
          const dateText = paidDates.length > 0 ? ` em ${formatDateList(paidDates)}` : "";
          nota.informacoes = `ERP indica pagamento integral${dateText}, mas a planilha ainda possui ${formatBRL(nota.faltaPagar)} em aberto`;
          addReason(nota, "O ERP está quitado, mas a conta contábil ainda apresenta saldo para a NF.");
        } else {
          nota.informacoes = paidDates.length > 0
            ? `Pagamento localizado no ERP em ${formatDateList(paidDates)}`
            : "Pagamento integral localizado no ERP";
        }
      } else if (difference < 0) {
        nota.informacoes = `Pagou ${formatBRL(Math.abs(difference))} a menos`;
        addReason(nota, `O valor líquido esperado é ${formatBRL(expectedNet)}, mas o ERP registra pagamento de ${formatBRL(paid)}.`);
      } else if (highConfidence && Math.abs(difference) <= tolerance) {
        nota.faltaPagar = -difference;
        nota.informacoes = `Pagou ${formatBRL(difference)} a mais`;
        addReason(nota, `O pagamento excedeu o valor líquido esperado em ${formatBRL(difference)}.`);
      } else {
        nota.informacoes = "Possível pagamento a maior, aguardando conferência";
        addReason(nota, "A associação não possui confiança suficiente para transformar automaticamente o saldo em negativo.");
      }
    }

    if (nota.motivosConferencia.length > 0) markConferir(nota);
  }
}

export const buildPreviousInfoMap = buildPreviousInfoMapOriginal;
export const applyPreviousInfo = applyPreviousInfoOriginal;
export const flagDuplicateInvoices = flagDuplicateInvoicesOriginal;

function resultList(input: TransformResult | SheetInput[]): SheetInput[] {
  if (Array.isArray(input)) return input;
  return [{ conta: "Conta", result: input }];
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { horizontal: "center", vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
}

export async function buildXlsx(
  input: TransformResult | SheetInput[],
  options: BuildXlsxOptions = {},
): Promise<Blob> {
  const originalBlob = await buildXlsxOriginal(input as never, options);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await originalBlob.arrayBuffer());

  const sheets = resultList(input);
  const existingReconciliation = workbook.getWorksheet("Reconciliação");
  if (existingReconciliation) workbook.removeWorksheet(existingReconciliation.id);
  const existingPending = workbook.getWorksheet("Pendências");
  if (existingPending) workbook.removeWorksheet(existingPending.id);

  const reconciliation = workbook.addWorksheet("Reconciliação");
  reconciliation.columns = [
    { header: "CONTA", key: "conta", width: 16 },
    { header: "SALDO DA PLANILHA BRUTA", key: "bruto", width: 25 },
    { header: "SALDO GERADO", key: "gerado", width: 20 },
    { header: "DIFERENÇA", key: "diferenca", width: 18 },
    { header: "STATUS", key: "status", width: 20 },
  ];
  styleHeader(reconciliation.getRow(1));

  for (const sheet of sheets) {
    const generated = roundCurrency(sheet.result.notas.reduce((sum, nota) => sum + nota.faltaPagar, 0));
    const difference = roundCurrency(sheet.result.saldoBruto - generated);
    reconciliation.addRow({
      conta: sheet.conta,
      bruto: sheet.result.saldoBruto,
      gerado: generated,
      diferenca: difference,
      status: Math.abs(difference) < 0.01 ? "CONCILIADO" : "CONFERIR",
    });
  }

  reconciliation.getColumn("B").numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  reconciliation.getColumn("C").numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  reconciliation.getColumn("D").numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  reconciliation.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];

  const allPending = sheets.flatMap((sheet) => sheet.result.pendencias.map((pending) => ({ conta: sheet.conta, ...pending })));
  if (allPending.length > 0) {
    const pendingSheet = workbook.addWorksheet("Pendências");
    pendingSheet.columns = [
      { header: "CONTA", key: "conta", width: 14 },
      { header: "LINHA ORIGINAL", key: "linha", width: 16 },
      { header: "DATA", key: "data", width: 14 },
      { header: "DESCRIÇÃO", key: "descricao", width: 70 },
      { header: "VALOR", key: "valor", width: 18 },
      { header: "MOTIVO", key: "motivo", width: 75 },
    ];
    styleHeader(pendingSheet.getRow(1));
    for (const pending of allPending) {
      pendingSheet.addRow({
        ...pending,
        data: toDate(pending.data) ?? pending.data,
      });
    }
    pendingSheet.getColumn("C").numFmt = "dd/mm/yyyy";
    pendingSheet.getColumn("E").numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
    pendingSheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  }

  workbook.calcProperties.fullCalcOnLoad = true;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
