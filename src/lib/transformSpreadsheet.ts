import type { PagamentoRow } from "./parsePagamentosPdf";
import { buildXlsxFile } from "./buildXlsx";

export type SheetRow = Record<string, unknown>;

export interface NotaFiscal {
  data: Date | string | number | null;
  fornecedor: string;
  notaFiscal: string;
  valorNF: number;
  faltaPagar: number;
  informacoes: string;
  motivosConferencia: string[];
}

export interface TransformResult { notas: NotaFiscal[] }
export interface SheetInput { conta: string; result: TransformResult }
export interface MesConferencia { ano: number; mes: number }
export interface BuildXlsxOptions {
  mesConferencia?: MesConferencia;
  generatedAt?: Date;
}

const HIST_KEYS = ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"];
const VALOR_KEYS = ["Valor"];
const DATA_KEYS = ["Data"];
const PREV_FORNECEDOR_KEYS = ["FORNECEDOR", "Fornecedor"];
const PREV_NOTA_KEYS = [
  "NOTA FISCAL", "Nota Fiscal", "NotaFiscal", "NF", "N.F.", "N F", "Nº NF",
  "NUMERO NF", "NÚMERO NF", "Nota",
];
const PREV_INFO_KEYS = ["INFORMAÇÕES", "INFORMACOES", "Informações", "Informacoes"];
const MONEY_TOLERANCE = 0.005;

let lastWorkbookContext: (BuildXlsxOptions & { recordedAt: number }) | null = null;

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

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normNota(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().replace(/\.0+$/, "").replace(/\D+/g, "").replace(/^0+/, "") || "0";
}

const LEGAL_SUFFIXES = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s a", "cia", "mei",
]);

const STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "com",
  "ltda", "me", "epp", "eireli", "sa", "cia", "mei",
  "comercio", "comercial", "servico", "servicos", "industria", "industrial",
  "empresa", "produtos", "produto", "fornecedores", "fornecedor",
]);

interface NormalizedSupplier {
  full: string;
  tokens: string[];
  significant: string[];
  removedNumericPrefix: boolean;
  removedNumericSuffix: boolean;
}

function looksLikeExternalNumericIdentifier(token: string): boolean {
  const digits = token.replace(/\D/g, "");
  if (digits.length < 6) return false;
  return /^[\d.\-/]+$/.test(token);
}

function normalizeToken(token: string): string {
  if (token === "servicos") return "servico";
  if (token === "medicos") return "medico";
  if (token === "medicas") return "medica";
  if (token === "materiais") return "material";
  return token;
}

function normalizeSupplier(value: unknown): NormalizedSupplier {
  if (value == null) {
    return { full: "", tokens: [], significant: [], removedNumericPrefix: false, removedNumericSuffix: false };
  }

  const text = removeAccents(String(value)).toLowerCase().replace(/[;,|]+/g, " ").replace(/\s+/g, " ").trim();
  const rawTokens = text.split(" ").filter(Boolean);
  let removedNumericPrefix = false;
  let removedNumericSuffix = false;

  while (rawTokens.length > 1 && looksLikeExternalNumericIdentifier(rawTokens[0])) {
    rawTokens.shift();
    removedNumericPrefix = true;
  }
  while (rawTokens.length > 1 && looksLikeExternalNumericIdentifier(rawTokens[rawTokens.length - 1])) {
    rawTokens.pop();
    removedNumericSuffix = true;
  }

  const tokens = rawTokens
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .map(normalizeToken);

  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();

  const full = tokens.join(" ");
  const significant = tokens.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  return { full, tokens, significant, removedNumericPrefix, removedNumericSuffix };
}

function tokenPrefixCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && longer.startsWith(shorter);
}

function consecutivePrefixMatches(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let count = 0;
  for (let index = 0; index < max; index++) {
    if (!tokenPrefixCompatible(a[index], b[index])) break;
    count++;
  }
  return count;
}

interface SupplierMatch {
  score: number;
  kind: "exact" | "normalized" | "truncated" | "numeric-code-removed" | "tokens" | "none";
}

function supplierMatch(a: unknown, b: unknown): SupplierMatch {
  const na = normalizeSupplier(a);
  const nb = normalizeSupplier(b);
  if (!na.full || !nb.full) return { score: 0, kind: "none" };

  const numericRemoved = na.removedNumericPrefix || na.removedNumericSuffix
    || nb.removedNumericPrefix || nb.removedNumericSuffix;

  if (na.full === nb.full) {
    return { score: 100, kind: numericRemoved ? "numeric-code-removed" : "exact" };
  }

  const shorterFull = na.full.length <= nb.full.length ? na.full : nb.full;
  const longerFull = na.full.length <= nb.full.length ? nb.full : na.full;
  if (shorterFull.length >= 12 && longerFull.startsWith(shorterFull)) {
    return { score: 92, kind: numericRemoved ? "numeric-code-removed" : "truncated" };
  }

  const prefixMatches = consecutivePrefixMatches(na.significant, nb.significant);
  const minSignificant = Math.min(na.significant.length, nb.significant.length);
  if (prefixMatches >= 3 || (prefixMatches >= 2 && prefixMatches === minSignificant)) {
    return { score: 88, kind: numericRemoved ? "numeric-code-removed" : "truncated" };
  }

  const setA = new Set(na.significant);
  const setB = new Set(nb.significant);
  let overlap = 0;
  for (const tokenA of setA) {
    if ([...setB].some((tokenB) => tokenPrefixCompatible(tokenA, tokenB))) overlap++;
  }

  const required = Math.max(1, Math.min(2, minSignificant));
  if (overlap >= required) {
    const coverage = minSignificant > 0 ? overlap / minSignificant : 0;
    return {
      score: Math.round(60 + coverage * 20),
      kind: numericRemoved ? "numeric-code-removed" : "tokens",
    };
  }

  return { score: 0, kind: "none" };
}

function supplierScore(a: unknown, b: unknown): number {
  return supplierMatch(a, b).score;
}

function cleanFornecedor(name: string): string {
  return name.trim()
    .replace(/^\d{1,3}(?:\.\d{3})+(?:[-/]\d+)*\s+/, "")
    .replace(/^\d{3}\.\d{3}\.\d{3}(?:-\d{2})?\s+/, "")
    .replace(/\s+(REFERENTE|REF\.?|NOTA\s+FISCAL|INTERNET\s+M[ÊE]S|CONFORME|PAGAMENTO)\b.*$/i, "")
    .replace(/\s+/g, " ").replace(/[\s.,;:-]+$/, "").trim();
}

interface Parsed { isNF: boolean; numero: string | null; fornecedor: string }

function parseDescricao(desc: string): Parsed {
  const value = desc.trim();
  const upper = value.toUpperCase();
  const nf = value.match(/^VALOR\s+NF\b[\s-]*(.+)$/i);
  if (nf) {
    const rest = nf[1].trim();
    const match = rest.match(/^(\d+)\s*[-–]?\s*(.+)$/);
    if (match) return { isNF: true, numero: match[1], fornecedor: cleanFornecedor(match[2]) };
    return { isNF: true, numero: null, fornecedor: cleanFornecedor(rest) };
  }
  const explicit = upper.match(/NF\s*(?:-|N[ºO.]?\s*)?\s*(\d+)/)
    ?? upper.match(/(?:S\s*\/\s*(?:NF\s*)?|SOBRE\s+|REF\.?\s*(?:NF\s*)?)(\d+)/);
  return { isNF: false, numero: explicit?.[1] ?? null, fornecedor: "" };
}

function extractCandidateNumbers(desc: string): string[] {
  const cleaned = desc
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, " ")
    .replace(/\b\d+[.,]\d+\b/g, " ");
  return cleaned.match(/\b\d+\b/g) ?? [];
}

function addReason(nota: NotaFiscal, reason: string): void {
  if (reason && !nota.motivosConferencia.includes(reason)) nota.motivosConferencia.push(reason);
}

function markConferir(nota: NotaFiscal): void {
  if (!/\(conferir\)/i.test(nota.informacoes)) {
    nota.informacoes = nota.informacoes ? `${nota.informacoes} (conferir)` : "(conferir)";
  }
}

function stripConferir(value: string): string {
  return value.replace(/\s*\(conferir\)\s*$/i, "").trim();
}

function isAutomaticPaymentInfo(value: string): boolean {
  return /faltou\s+pagar|pagou\s+.*\s+a\s+(?:menos|mais)|pr[oó]ximas\s+parcelas|sem\s+pagamento\s+no\s+erp|t[ií]tulo\s+cadastrado|programado\s+para|erp\s+indica\s+pagamento|pagamento\s+localizado|sem\s+parcelas\s+posteriores|n[aã]o\s+(?:consta|aparece)\s+no\s+erp/i.test(value);
}

function wasMissingInErp(value: string): boolean {
  return /n[aã]o\s+(?:consta|aparece)\s+no\s+erp/i.test(value);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(roundCurrency(value)).replace(/\u00a0/g, " ");
}

function formatDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export interface PrevEntry { fornecedor: string; tokens: Set<string>; info: string }

function formatInfoValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "number" && value > 20000 && value < 80000 && Number.isInteger(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return formatDate(date);
  }
  return String(value).trim();
}

export function buildPreviousInfoMap(rows: SheetRow[]): Map<string, PrevEntry[]> {
  const map = new Map<string, PrevEntry[]>();
  if (rows.length === 0) return map;
  const fornKey = findKey(rows[0], PREV_FORNECEDOR_KEYS);
  const notaKey = findKey(rows[0], PREV_NOTA_KEYS);
  const infoKey = findKey(rows[0], PREV_INFO_KEYS);
  if (!fornKey || !notaKey || !infoKey) {
    throw new Error("A planilha do mês anterior precisa conter as colunas FORNECEDOR, NOTA FISCAL e INFORMAÇÕES.");
  }
  for (const row of rows) {
    const nota = normNota(row[notaKey]);
    const fornecedor = row[fornKey];
    const info = formatInfoValue(row[infoKey]);
    if (!nota || !String(fornecedor ?? "").trim() || !info) continue;
    const entry = {
      fornecedor: String(fornecedor),
      tokens: new Set(normalizeSupplier(fornecedor).significant),
      info,
    };
    map.set(nota, [...(map.get(nota) ?? []), entry]);
  }
  return map;
}

export function applyPreviousInfo(notas: NotaFiscal[], prevMap: Map<string, PrevEntry[]>): void {
  for (const nota of notas) {
    const candidates = prevMap.get(normNota(nota.notaFiscal)) ?? [];
    const ranked = candidates
      .map((candidate) => ({ candidate, score: supplierScore(nota.fornecedor, candidate.fornecedor) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked.length > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
      nota.informacoes = ranked[0].candidate.info;
    }
  }
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function uniqueDates(dates: Date[]): Date[] {
  return [...new Map(dates.map((date) => [dateKey(date), date])).values()];
}

function formatDateList(dates: Date[]): string {
  const sorted = uniqueDates(dates).sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length === 0) return "";
  const pieces = sorted.map((date, index) => {
    const base = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    return index === sorted.length - 1 ? `${base}/${date.getFullYear()}` : base;
  });
  if (pieces.length === 1) return pieces[0];
  if (pieces.length === 2) return `${pieces[0]} e ${pieces[1]}`;
  return `${pieces.slice(0, -1).join(", ")} e ${pieces[pieces.length - 1]}`;
}

function ymIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function isCalendarMonthLastDay(date: Date): boolean {
  return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

interface NormalizedPayment extends PagamentoRow {
  numeroNorm: string;
}

type MatchKind = "exact" | "exact-with-derived" | "derived" | "shortened";
type SelectionFailure = "number-not-found" | "supplier-not-found" | "supplier-ambiguous" | "title-ambiguous";

interface PaymentSelection {
  rows: NormalizedPayment[];
  kind: MatchKind | null;
  supplierKind: SupplierMatch["kind"];
  failure: SelectionFailure | null;
}

function isSafeDerivedTitle(nf: string, title: string): boolean {
  if (nf.length < 1 || !title.startsWith(nf) || title === nf) return false;
  const suffix = title.slice(nf.length);
  return suffix.length >= 3 && /^0+\d*$/.test(suffix);
}

function isSafeShortenedTitle(nf: string, title: string): boolean {
  if (title.length < 5 || nf.length <= title.length || !nf.endsWith(title)) return false;
  const removedPrefix = nf.slice(0, nf.length - title.length);
  return /^\d+$/.test(removedPrefix) && removedPrefix.length >= 2;
}

function groupBySupplier(rows: NormalizedPayment[]): Map<string, NormalizedPayment[]> {
  const groups = new Map<string, NormalizedPayment[]>();
  for (const row of rows) {
    const key = normalizeSupplier(row.fornecedor).full || row.fornecedor.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function groupDerivedBySuffixLength(nf: string, rows: NormalizedPayment[]): NormalizedPayment[][] {
  const groups = new Map<number, NormalizedPayment[]>();
  for (const row of rows) {
    if (!isSafeDerivedTitle(nf, row.numeroNorm)) continue;
    const length = row.numeroNorm.length - nf.length;
    groups.set(length, [...(groups.get(length) ?? []), row]);
  }
  return [...groups.values()];
}

function chooseUniqueClosestGroup(groups: NormalizedPayment[][], nota: NotaFiscal): NormalizedPayment[] | null {
  if (groups.length === 0) return [];
  if (groups.length === 1) return groups[0];
  const ranked = groups.map((group) => {
    const total = roundCurrency(group.reduce((sum, row) => sum + row.valorTitulo, 0));
    const distance = Math.min(Math.abs(total - nota.valorNF), Math.abs(total - nota.faltaPagar));
    return { group, distance };
  }).sort((a, b) => a.distance - b.distance);
  return ranked[0].distance + MONEY_TOLERANCE < ranked[1].distance ? ranked[0].group : null;
}

function selectPaymentsForInvoice(nota: NotaFiscal, rows: NormalizedPayment[]): PaymentSelection {
  const nf = normNota(nota.notaFiscal);
  if (!nf || nf === "0") {
    return { rows: [], kind: null, supplierKind: "none", failure: "number-not-found" };
  }

  const numberCandidates = rows.filter((row) => (
    row.numeroNorm === nf
    || isSafeDerivedTitle(nf, row.numeroNorm)
    || isSafeShortenedTitle(nf, row.numeroNorm)
  ));
  if (numberCandidates.length === 0) {
    return { rows: [], kind: null, supplierKind: "none", failure: "number-not-found" };
  }

  const supplierGroups = [...groupBySupplier(numberCandidates).values()].map((group) => {
    const match = supplierMatch(nota.fornecedor, group[0].fornecedor);
    return { group, match };
  }).filter((item) => item.match.score > 0).sort((a, b) => b.match.score - a.match.score);

  if (supplierGroups.length === 0) {
    return { rows: [], kind: null, supplierKind: "none", failure: "supplier-not-found" };
  }
  if (supplierGroups.length > 1 && supplierGroups[0].match.score === supplierGroups[1].match.score) {
    return { rows: [], kind: null, supplierKind: "none", failure: "supplier-ambiguous" };
  }

  const supplierRows = supplierGroups[0].group;
  const supplierKind = supplierGroups[0].match.kind;
  const exact = supplierRows.filter((row) => row.numeroNorm === nf);
  const derivedGroups = groupDerivedBySuffixLength(nf, supplierRows);
  const chosenDerived = chooseUniqueClosestGroup(derivedGroups, nota);

  if (chosenDerived === null) {
    return { rows: [], kind: null, supplierKind, failure: "title-ambiguous" };
  }
  if (exact.length > 0 && chosenDerived.length > 0) {
    return { rows: [...exact, ...chosenDerived], kind: "exact-with-derived", supplierKind, failure: null };
  }
  if (exact.length > 0) {
    return { rows: exact, kind: "exact", supplierKind, failure: null };
  }
  if (chosenDerived.length > 0) {
    return { rows: chosenDerived, kind: "derived", supplierKind, failure: null };
  }

  const shortened = supplierRows.filter((row) => isSafeShortenedTitle(nf, row.numeroNorm));
  const shortenedGroups = [...new Map(shortened.map((row) => [
    row.numeroNorm,
    shortened.filter((item) => item.numeroNorm === row.numeroNorm),
  ])).values()];
  if (shortenedGroups.length === 1) {
    return { rows: shortenedGroups[0], kind: "shortened", supplierKind, failure: null };
  }

  return { rows: [], kind: null, supplierKind, failure: "title-ambiguous" };
}

function addSupplierMatchReason(nota: NotaFiscal, kind: SupplierMatch["kind"]): void {
  if (kind === "numeric-code-removed") {
    addReason(nota, "O fornecedor foi identificado após ignorar um código numérico, CPF, CNPJ ou matrícula junto ao nome.");
  } else if (kind === "truncated") {
    addReason(nota, "O fornecedor foi identificado por nome truncado no relatório do ERP.");
  } else if (kind === "tokens") {
    addReason(nota, "O fornecedor foi identificado por palavras relevantes em comum; conferir a associação.");
  }
}

function addSelectionReason(nota: NotaFiscal, selection: PaymentSelection, rows: NormalizedPayment[]): void {
  addSupplierMatchReason(nota, selection.supplierKind);
  if (selection.kind === "exact-with-derived") {
    addReason(nota, `A NF exata foi agrupada com títulos parcelados derivados: ${rows.map((row) => row.numeroNorm).join(", ")}.`);
  } else if (selection.kind === "derived") {
    addReason(nota, `Pagamento vinculado por títulos derivados da NF ${nota.notaFiscal}: ${rows.map((row) => row.numeroNorm).join(", ")}.`);
  } else if (selection.kind === "shortened") {
    addReason(nota, `Título do ERP identificado pelo final da NF ${nota.notaFiscal}: ${rows.map((row) => row.numeroNorm).join(", ")}.`);
  }
}

function setSelectionFailureInfo(nota: NotaFiscal, failure: SelectionFailure | null, generatedDate: string): void {
  if (failure === "supplier-not-found") {
    nota.informacoes = "NF localizada no ERP, mas o fornecedor não corresponde com segurança";
    addReason(nota, "O número da NF foi localizado no relatório, porém o fornecedor não pôde ser confirmado com segurança.");
  } else if (failure === "supplier-ambiguous") {
    nota.informacoes = "NF localizada para mais de um fornecedor possível";
    addReason(nota, "Mais de um fornecedor apresentou a mesma pontuação de correspondência para esta NF.");
  } else if (failure === "title-ambiguous") {
    nota.informacoes = "Mais de um grupo de títulos possível no ERP";
    addReason(nota, "Foram localizados múltiplos grupos compatíveis e não foi possível escolher um deles com segurança.");
  } else {
    nota.informacoes = `Não consta no ERP até ${generatedDate}`;
    addReason(nota, `Nenhum título correspondente a esta NF e fornecedor foi localizado no relatório do ERP processado em ${generatedDate}.`);
  }
  markConferir(nota);
}

function uniquePayments(rows: NormalizedPayment[]): NormalizedPayment[] {
  return [...new Map(rows.map((row) => [
    `${row.numeroNorm}|${normalizeSupplier(row.fornecedor).full}|${row.valorTitulo}|${row.valorAberto}|${row.dataProgramada ? dateKey(row.dataProgramada) : ""}|${row.dataBaixa ? dateKey(row.dataBaixa) : ""}`,
    row,
  ])).values()];
}

function paymentTotal(rows: NormalizedPayment[], field: "valorTitulo" | "valorAberto"): number {
  return roundCurrency(rows.reduce((sum, row) => sum + row[field], 0));
}

function paidTotal(rows: NormalizedPayment[]): number {
  return roundCurrency(rows.reduce((sum, row) => sum + Math.max(0, row.valorTitulo - row.valorAberto), 0));
}

function setPaymentDifferenceInfo(nota: NotaFiscal, paid: number): boolean {
  const difference = roundCurrency(paid - nota.valorNF);
  if (Math.abs(difference) < 0.01) return false;
  if (difference < 0) {
    nota.informacoes = `Pagou ${formatBRL(Math.abs(difference))} a menos`;
    addReason(nota, `O valor da NF é ${formatBRL(nota.valorNF)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(Math.abs(difference))} a menos.`);
  } else {
    nota.informacoes = `Pagou ${formatBRL(difference)} a mais`;
    addReason(nota, `O valor da NF é ${formatBRL(nota.valorNF)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(difference)} a mais.`);
  }
  return true;
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const generatedAt = opts.generatedAt ?? new Date();
  lastWorkbookContext = { mesConferencia: opts.mesConferencia, generatedAt, recordedAt: Date.now() };
  if (pdfRows.length === 0) return;

  const mesIdx = opts.mesConferencia.ano * 12 + opts.mesConferencia.mes - 1;
  const generatedDate = formatDate(generatedAt);
  const normalized: NormalizedPayment[] = pdfRows.map((row) => ({ ...row, numeroNorm: normNota(row.numero) }));

  for (const nota of notas) {
    const previousInfo = nota.informacoes;
    nota.motivosConferencia = [];
    const selection = selectPaymentsForInvoice(nota, normalized);

    if (selection.rows.length === 0) {
      setSelectionFailureInfo(nota, selection.failure, generatedDate);
      continue;
    }

    const rows = uniquePayments(selection.rows);
    if (rows.length < selection.rows.length) {
      addReason(nota, "O PDF continha lançamentos duplicados; as duplicidades foram ignoradas.");
    }
    addSelectionReason(nota, selection, rows);
    if (wasMissingInErp(previousInfo)) {
      addReason(nota, "A planilha do mês anterior informava que a NF não constava no ERP. No relatório atual foram encontrados títulos correspondentes, e a informação foi atualizada automaticamente.");
    }

    const relevantRows = rows.filter((row) => {
      if (!row.dataProgramada) return false;
      const scheduledMonth = ymIndex(row.dataProgramada);
      return scheduledMonth > mesIdx || (scheduledMonth === mesIdx && isCalendarMonthLastDay(row.dataProgramada));
    });
    const lastDayRows = relevantRows.filter((row) => (
      row.dataProgramada !== null
      && ymIndex(row.dataProgramada) === mesIdx
      && isCalendarMonthLastDay(row.dataProgramada)
    ));
    const openRows = rows.filter((row) => row.valorAberto > MONEY_TOLERANCE);
    const openScheduledRows = openRows.filter((row) => row.dataProgramada !== null && row.dataBaixa === null);
    const openUndatedRows = openRows.filter((row) => row.dataProgramada === null);
    const totalAberto = paymentTotal(rows, "valorAberto");
    const totalPago = paidTotal(rows);

    if (relevantRows.length > 0) {
      const dates = formatDateList(relevantRows.map((row) => row.dataProgramada as Date));
      const singleOpenScheduled = rows.length === 1 && openScheduledRows.length === 1 && relevantRows.length === 1;
      nota.informacoes = singleOpenScheduled ? `Programado para ${dates}, mas ainda sem data de baixa` : dates;

      const relevantTotal = paymentTotal(relevantRows, "valorTitulo");
      const difference = roundCurrency(relevantTotal - nota.faltaPagar);
      if (Math.abs(difference) >= 0.01) {
        addReason(nota, `A soma das parcelas consideradas após o mês conferido é ${formatBRL(relevantTotal)}, mas o FALTA PAGAR é ${formatBRL(nota.faltaPagar)}. Diferença de ${formatBRL(Math.abs(difference))}.`);
      }
      if (lastDayRows.length > 0) {
        const lastDates = formatDateList(lastDayRows.map((row) => row.dataProgramada as Date));
        addReason(nota, `A parcela de ${lastDates} foi programada para o último dia do mês conferido e pode ter sido compensada no primeiro dia útil do mês seguinte.`);
      }
      if (openScheduledRows.some((row) => relevantRows.includes(row))) {
        addReason(nota, "Há parcela programada no ERP que ainda não possui data de baixa.");
      }
    } else if (openRows.length > 0) {
      if (openScheduledRows.length > 0) {
        const dates = formatDateList(openScheduledRows.map((row) => row.dataProgramada as Date));
        nota.informacoes = `Programado para ${dates}, mas ainda sem data de baixa`;
        addReason(nota, "O título possui data programada no ERP, permanece em aberto e ainda não possui data de baixa.");
      } else if (openUndatedRows.length > 0) {
        nota.informacoes = "Título cadastrado, mas ainda sem data programada para pagamento";
        addReason(nota, "O título foi localizado no ERP, permanece em aberto e ainda não possui data programada ou data de baixa.");
      } else {
        nota.informacoes = "Título permanece em aberto no ERP";
        addReason(nota, "O título foi localizado no ERP com saldo em aberto, mas sem uma situação de pagamento conclusiva.");
      }

      const openDifference = roundCurrency(totalAberto - nota.faltaPagar);
      if (Math.abs(openDifference) >= 0.01) {
        addReason(nota, `O ERP informa ${formatBRL(totalAberto)} em aberto, mas a planilha informa FALTA PAGAR de ${formatBRL(nota.faltaPagar)}. Diferença de ${formatBRL(Math.abs(openDifference))}.`);
      }
    } else if (!setPaymentDifferenceInfo(nota, totalPago)) {
      if (nota.faltaPagar > MONEY_TOLERANCE) {
        nota.informacoes = `ERP indica pagamento integral, mas a planilha ainda possui ${formatBRL(nota.faltaPagar)} em aberto`;
        addReason(nota, `O título foi localizado no ERP com valor em aberto de ${formatBRL(totalAberto)} e pagamento de ${formatBRL(totalPago)}. Porém, a planilha informa FALTA PAGAR de ${formatBRL(nota.faltaPagar)}. Conferir se o pagamento ainda não foi lançado ou abatido na conta.`);
      } else {
        const paidDates = rows.map((row) => row.dataBaixa).filter((date): date is Date => date !== null);
        nota.informacoes = paidDates.length > 0 ? `Pagamento localizado no ERP em ${formatDateList(paidDates)}` : "Pagamento integral localizado no ERP";
      }
    }

    if (!nota.informacoes) {
      const previousManualInfo = previousInfo && !isAutomaticPaymentInfo(previousInfo) ? stripConferir(previousInfo) : "";
      nota.informacoes = previousManualInfo || "Sem parcelas posteriores ao mês conferido";
      if (!previousManualInfo) {
        addReason(nota, "A NF foi localizada no ERP, mas não foram encontradas parcelas posteriores ao mês conferido.");
      }
    }

    if (nota.motivosConferencia.length > 0) markConferir(nota);
  }
}

function chooseTaxTarget(numero: string, desc: string, byNumero: Map<string, NotaFiscal[]>): NotaFiscal | null {
  const candidates = byNumero.get(numero) ?? [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;
  const ranked = candidates.map((nota) => ({ nota, score: supplierScore(desc, nota.fornecedor) })).sort((a, b) => b.score - a.score);
  if (ranked[0].score > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) return ranked[0].nota;
  for (const candidate of candidates) {
    addReason(candidate, `NF ${numero} repetida entre fornecedores; o imposto/abatimento não foi vinculado por falta de identificação segura.`);
    markConferir(candidate);
  }
  return null;
}

export function transformRows(rows: SheetRow[]): TransformResult {
  if (rows.length === 0) throw new Error("Planilha vazia.");
  const histKey = findKey(rows[0], HIST_KEYS);
  const valorKey = findKey(rows[0], VALOR_KEYS);
  const dataKey = findKey(rows[0], DATA_KEYS);
  if (!histKey) throw new Error('Coluna "Descrição histórico" não encontrada.');
  if (!valorKey) throw new Error('Coluna "Valor" não encontrada.');
  if (!dataKey) throw new Error('Coluna "Data" não encontrada.');

  const notas: NotaFiscal[] = [];
  const byNumero = new Map<string, NotaFiscal[]>();
  for (const row of rows) {
    const desc = String(row[histKey] ?? "");
    const parsed = parseDescricao(desc);
    const rawValue = toNumber(row[valorKey]);
    if (!parsed.isNF || rawValue < 0) continue;
    const nota: NotaFiscal = {
      data: (row[dataKey] as Date | string | number | null) ?? null,
      fornecedor: parsed.fornecedor,
      notaFiscal: parsed.numero ?? "",
      valorNF: Math.abs(rawValue),
      faltaPagar: Math.abs(rawValue),
      informacoes: "",
      motivosConferencia: [],
    };
    notas.push(nota);
    if (parsed.numero) byNumero.set(parsed.numero, [...(byNumero.get(parsed.numero) ?? []), nota]);
  }
  if (notas.length === 0) throw new Error('Nenhuma linha com "VALOR NF -" foi encontrada no arquivo.');

  const appliedRows = new Set<number>();
  rows.forEach((row, index) => {
    const desc = String(row[histKey] ?? "");
    const value = toNumber(row[valorKey]);
    if (!desc.trim() || value >= 0 || appliedRows.has(index)) return;
    const parsed = parseDescricao(desc);
    const numbers = parsed.numero ? [parsed.numero] : extractCandidateNumbers(desc);
    const known = [...new Set(numbers.filter((number) => byNumero.has(number)))];
    let target: NotaFiscal | null = null;
    if (known.length === 1) target = chooseTaxTarget(known[0], desc, byNumero);
    else if (known.length > 1) {
      const possibilities = known.flatMap((number) => (byNumero.get(number) ?? []).map((nota) => ({ nota, score: supplierScore(desc, nota.fornecedor) })));
      possibilities.sort((a, b) => b.score - a.score);
      if (possibilities[0]?.score > 0 && possibilities[0].score > (possibilities[1]?.score ?? -1)) target = possibilities[0].nota;
    }
    if (!target) return;
    target.faltaPagar += value;
    appliedRows.add(index);
  });

  return { notas };
}

export async function buildXlsx(input: TransformResult | SheetInput[], options: BuildXlsxOptions = {}): Promise<Blob> {
  const freshContext = lastWorkbookContext && Date.now() - lastWorkbookContext.recordedAt < 60_000 ? lastWorkbookContext : null;
  return buildXlsxFile(input, {
    mesConferencia: options.mesConferencia ?? freshContext?.mesConferencia,
    generatedAt: options.generatedAt ?? freshContext?.generatedAt ?? new Date(),
  });
}
