import ExcelJS from "exceljs";
import type { PagamentoRow } from "./parsePagamentosPdf";

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

const HIST_KEYS = ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"];
const VALOR_KEYS = ["Valor"];
const DATA_KEYS = ["Data"];
const PREV_FORNECEDOR_KEYS = ["FORNECEDOR", "Fornecedor"];
const PREV_NOTA_KEYS = ["NOTA FISCAL", "Nota Fiscal", "NotaFiscal", "NF", "N.F.", "N F", "Nº NF", "NUMERO NF", "NÚMERO NF", "Nota"];
const PREV_INFO_KEYS = ["INFORMAÇÕES", "INFORMACOES", "Informações", "Informacoes"];

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
  return String(value).trim().replace(/\.0+$/, "").replace(/\D+/g, "").replace(/^0+/, "");
}

function normFornecedor(value: unknown): string {
  if (value == null) return "";
  return removeAccents(String(value)).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "ltda", "me", "epp", "sa", "eireli", "cia", "de", "da", "do", "das", "dos", "com", "e",
  "servicos", "servico", "medicos", "medico", "medica", "medicas", "assistencia", "saude",
  "comercio", "comercial", "industria", "industrial", "produtos", "produto", "distribuidora",
  "transportes", "transporte", "brasil", "nacional", "importacao", "exportacao", "solucoes",
  "tecnologia", "sistemas", "engenharia", "construcao", "hospitalar", "hospital", "clinica",
  "clinicas", "diagnostico", "farmaceutica", "farmaceuticos", "informatica",
]);

function fornecedorTokens(value: unknown): Set<string> {
  return new Set(normFornecedor(value).split(" ").filter((token) => token.length >= 2 && !STOP_WORDS.has(token)));
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count++;
  return count;
}

function supplierScore(a: unknown, b: unknown): number {
  const na = normFornecedor(a);
  const nb = normFornecedor(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 80;
  const ta = fornecedorTokens(a);
  const tb = fornecedorTokens(b);
  const overlap = tokenOverlap(ta, tb);
  const required = Math.max(1, Math.min(2, Math.min(ta.size, tb.size)));
  return overlap >= required ? overlap * 10 : 0;
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
  return /faltou\s+pagar|pagou\s+.*\s+a\s+(?:menos|mais)|pr[oó]ximas\s+parcelas|sem\s+pagamento\s+no\s+erp|t[ií]tulo\s+cadastrado|n[aã]o\s+(?:consta|aparece)\s+no\s+erp/i.test(value);
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
  if (!fornKey || !notaKey || !infoKey) throw new Error("A planilha do mês anterior precisa conter as colunas FORNECEDOR, NOTA FISCAL e INFORMAÇÕES.");
  for (const row of rows) {
    const nota = normNota(row[notaKey]);
    const fornecedor = row[fornKey];
    const info = formatInfoValue(row[infoKey]);
    if (!nota || !String(fornecedor ?? "").trim() || !info) continue;
    const entry = { fornecedor: String(fornecedor), tokens: fornecedorTokens(fornecedor), info };
    map.set(nota, [...(map.get(nota) ?? []), entry]);
  }
  return map;
}

export function applyPreviousInfo(notas: NotaFiscal[], prevMap: Map<string, PrevEntry[]>): void {
  for (const nota of notas) {
    const candidates = prevMap.get(normNota(nota.notaFiscal)) ?? [];
    const ranked = candidates.map((candidate) => ({ candidate, score: supplierScore(nota.fornecedor, candidate.fornecedor) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (ranked.length > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) nota.informacoes = ranked[0].candidate.info;
  }
}

function dateKey(date: Date): string { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function uniqueDates(dates: Date[]): Date[] { return [...new Map(dates.map((date) => [dateKey(date), date])).values()]; }
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
function ymIndex(date: Date): number { return date.getFullYear() * 12 + date.getMonth(); }
function isCalendarMonthLastDay(date: Date): boolean {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === lastDay;
}

interface NormalizedPayment extends PagamentoRow { numeroNorm: string }
type MatchKind = "exact" | "derived" | "shortened";

function selectSupplierRows(nota: NotaFiscal, rows: NormalizedPayment[]): NormalizedPayment[] {
  const scored = rows.map((row) => ({ row, score: supplierScore(nota.fornecedor, row.fornecedor) }))
    .filter((item) => item.score > 0);
  if (scored.length === 0) return [];

  const strong = scored.filter((item) => item.score >= 80);
  if (strong.length > 0) return strong.map((item) => item.row);

  const bestScore = Math.max(...scored.map((item) => item.score));
  const best = scored.filter((item) => item.score === bestScore);
  const supplierNames = new Set(best.map((item) => normFornecedor(item.row.fornecedor)));
  return supplierNames.size === 1 ? best.map((item) => item.row) : [];
}

function isSafeDerivedTitle(nf: string, title: string): boolean {
  if (nf.length < 4 || !title.startsWith(nf)) return false;
  const suffix = title.slice(nf.length);
  return suffix.length >= 2 && /^0+\d*$/.test(suffix);
}

function isSafeShortenedTitle(nf: string, title: string): boolean {
  if (title.length < 5 || nf.length <= title.length || !nf.endsWith(title)) return false;
  const removedPrefix = nf.slice(0, nf.length - title.length);
  return /^\d+$/.test(removedPrefix) && removedPrefix.length >= 2;
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

function selectPaymentsForInvoice(nota: NotaFiscal, rows: NormalizedPayment[]): { rows: NormalizedPayment[]; kind: MatchKind | null } {
  const nf = normNota(nota.notaFiscal);
  if (!nf) return { rows: [], kind: null };

  const supplierRows = selectSupplierRows(nota, rows);
  if (supplierRows.length === 0) return { rows: [], kind: null };

  const exact = supplierRows.filter((row) => row.numeroNorm === nf);
  if (exact.length > 0) return { rows: exact, kind: "exact" };

  const groups = groupDerivedBySuffixLength(nf, supplierRows);
  if (groups.length === 1) return { rows: groups[0], kind: "derived" };

  const shortened = supplierRows.filter((row) => isSafeShortenedTitle(nf, row.numeroNorm));
  const shortenedByTitle = new Map<string, NormalizedPayment[]>();
  for (const row of shortened) shortenedByTitle.set(row.numeroNorm, [...(shortenedByTitle.get(row.numeroNorm) ?? []), row]);
  const shortenedGroups = [...shortenedByTitle.values()];
  if (shortenedGroups.length === 1) return { rows: shortenedGroups[0], kind: "shortened" };

  return { rows: [], kind: null };
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  if (pdfRows.length === 0) return;
  const mesIdx = opts.mesConferencia.ano * 12 + opts.mesConferencia.mes - 1;
  const generatedAt = opts.generatedAt ?? new Date();
  const generatedDate = formatDate(generatedAt);
  const normalized: NormalizedPayment[] = pdfRows.map((row) => ({ ...row, numeroNorm: normNota(row.numero) }));

  for (const nota of notas) {
    const previousInfo = nota.informacoes;
    const selection = selectPaymentsForInvoice(nota, normalized);

    if (selection.rows.length === 0) {
      nota.informacoes = `Não consta no ERP até ${generatedDate}`;
      addReason(nota, `Nenhum título correspondente a esta NF e fornecedor foi localizado no relatório do ERP processado em ${generatedDate}.`);
      markConferir(nota);
      continue;
    }

    const uniqueRows = [...new Map(selection.rows.map((row) => [
      `${row.numeroNorm}|${normFornecedor(row.fornecedor)}|${row.valorTitulo}|${row.valorAberto}|${row.dataProgramada ? dateKey(row.dataProgramada) : ""}|${row.dataBaixa ? dateKey(row.dataBaixa) : ""}`,
      row,
    ])).values()];

    if (uniqueRows.length < selection.rows.length) addReason(nota, "O PDF continha lançamentos duplicados; as duplicidades foram ignoradas.");
    if (selection.kind === "derived") {
      addReason(nota, `Pagamento vinculado por títulos derivados da NF ${nota.notaFiscal}: ${uniqueRows.map((row) => row.numeroNorm).join(", ")}.`);
    }
    if (selection.kind === "shortened") {
      addReason(nota, `Título do ERP identificado pelo final da NF ${nota.notaFiscal}: ${uniqueRows.map((row) => row.numeroNorm).join(", ")}.`);
    }
    if (wasMissingInErp(previousInfo)) {
      addReason(nota, "A planilha do mês anterior informava que a NF não constava no ERP. No relatório atual foram encontrados títulos correspondentes, e a informação foi atualizada automaticamente.");
    }

    const relevantRows = uniqueRows.filter((row) => {
      const scheduled = row.dataProgramada;
      if (!scheduled) return false;
      const scheduledMonth = ymIndex(scheduled);
      return scheduledMonth > mesIdx || (scheduledMonth === mesIdx && isCalendarMonthLastDay(scheduled));
    });

    const lastDayRows = relevantRows.filter((row) => {
      const scheduled = row.dataProgramada;
      return scheduled !== null && ymIndex(scheduled) === mesIdx && isCalendarMonthLastDay(scheduled);
    });
    const undatedRows = uniqueRows.filter((row) => row.dataProgramada === null);

    if (relevantRows.length > 0) {
      nota.informacoes = formatDateList(relevantRows.map((row) => row.dataProgramada as Date));

      const relevantTotal = roundCurrency(relevantRows.reduce((sum, row) => sum + row.valorTitulo, 0));
      const difference = roundCurrency(relevantTotal - nota.faltaPagar);
      if (Math.abs(difference) >= 0.01) {
        addReason(
          nota,
          `A soma das parcelas consideradas após o mês conferido é ${formatBRL(relevantTotal)}, mas o FALTA PAGAR é ${formatBRL(nota.faltaPagar)}. Diferença de ${formatBRL(Math.abs(difference))}.`,
        );
      }

      if (lastDayRows.length > 0) {
        const dates = formatDateList(lastDayRows.map((row) => row.dataProgramada as Date));
        addReason(nota, `A parcela de ${dates} foi programada para o último dia do mês conferido e pode ter sido compensada no primeiro dia útil do mês seguinte.`);
      }
    } else if (undatedRows.length > 0) {
      nota.informacoes = "Título cadastrado, mas ainda sem data programada para pagamento";
      addReason(nota, "O título foi localizado no ERP para este fornecedor e esta NF, mas ainda não possui data programada para pagamento.");
    } else {
      nota.informacoes = isAutomaticPaymentInfo(previousInfo) ? "" : stripConferir(previousInfo);
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

function toJsDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400 * 1000));
  if (typeof value === "string" && value.trim()) {
    const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) return new Date(br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function sanitizeSheetName(name: string): string { return name.replace(/[\[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet"; }

function populateSheet(ws: ExcelJS.Worksheet, result: TransformResult): void {
  ws.columns = [
    { header: "DATA", key: "data", width: 14 }, { header: "FORNECEDOR", key: "fornecedor", width: 45 },
    { header: "NOTA FISCAL", key: "nota", width: 15 }, { header: "VALOR DA NF", key: "valor", width: 18 },
    { header: "FALTA PAGAR", key: "falta", width: 18 }, { header: "INFORMAÇÕES", key: "info", width: 60 },
    { header: "MOTIVO DA CONFERÊNCIA", key: "motivo", width: 65 },
  ];
  const header = ws.getRow(1); header.height = 22;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  for (const nota of result.notas) ws.addRow({ data: toJsDate(nota.data) ?? nota.data ?? "", fornecedor: nota.fornecedor, nota: nota.notaFiscal, valor: nota.valorNF, falta: nota.faltaPagar, info: nota.informacoes, motivo: nota.motivosConferencia.join("\n") });
  const totalRowNum = ws.rowCount + 1;
  ws.getRow(totalRowNum).getCell(3).value = "TOTAL";
  ws.getRow(totalRowNum).getCell(5).value = { formula: `SUM(E2:E${totalRowNum - 1})` };
  for (let rowNumber = 2; rowNumber <= totalRowNum; rowNumber++) {
    const row = ws.getRow(rowNumber); const isTotal = rowNumber === totalRowNum; row.height = isTotal ? 22 : 32;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = { vertical: "middle", horizontal: col === 2 || col === 6 || col === 7 ? "left" : "center", wrapText: col === 2 || col === 6 || col === 7 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isTotal ? "FFE5E7EB" : col === 7 && cell.value ? "FFFFF4CC" : "FFF1F5F9" } };
      if (isTotal) cell.font = { bold: true };
      if (col === 1) cell.numFmt = "dd/mm/yyyy";
      if (col === 4 || col === 5) cell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      cell.border = { top: { style: "thin", color: { argb: "FF000000" } }, left: { style: "thin", color: { argb: "FF000000" } }, bottom: { style: "thin", color: { argb: "FF000000" } }, right: { style: "thin", color: { argb: "FF000000" } } };
    });
  }
}

export async function buildXlsx(input: TransformResult | SheetInput[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const sheets = Array.isArray(input) ? input : [{ conta: "Notas Fiscais", result: input }];
  const used = new Set<string>();
  for (const sheet of sheets) {
    let name = sanitizeSheetName(sheet.conta); let suffix = 2;
    while (used.has(name)) name = sanitizeSheetName(`${sheet.conta}_${suffix++}`);
    used.add(name);
    populateSheet(workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] }), sheet.result);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
