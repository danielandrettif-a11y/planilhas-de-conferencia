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
}

const HIST_KEYS = ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"];
const VALOR_KEYS = ["Valor"];
const DATA_KEYS = ["Data"];

function findKey(row: SheetRow, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === c.trim().toLowerCase());
    if (found) return found;
  }
  // fallback: partial match
  for (const c of candidates) {
    const found = keys.find((k) =>
      k.trim().toLowerCase().includes(c.trim().toLowerCase()),
    );
    if (found) return found;
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null || v === "") return 0;
  const s = String(v).trim().replace(/\s/g, "");
  // Brazilian format: 1.234,56 or -1.234,56
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return isNaN(n) ? 0 : n;
}

// Remove leading CNPJ/CPF-like fragments: "33.246.073 " or "12.345.678/0001 "
function cleanFornecedor(name: string): string {
  let s = name.trim();
  s = s.replace(/^\d{1,3}(?:\.\d{3})+(?:[-/]\d+)*\s+/, "");
  s = s.replace(/^\d{3}\.\d{3}\.\d{3}(?:-\d{2})?\s+/, "");
  // Strip trailing bank/description noise: "... REFERENTE SERVIÇOS PRESTADOS ...",
  // "... REF. ...", "... NOTA FISCAL ...", "... INTERNET MÊS ...".
  s = s.replace(
    /\s+(REFERENTE|REF\.?|NOTA\s+FISCAL|INTERNET\s+M[ÊE]S|CONFORME|PAGAMENTO)\b.*$/i,
    "",
  );
  // Collapse extra whitespace.
  s = s.replace(/\s+/g, " ").trim();
  // Drop trailing punctuation.
  s = s.replace(/[\s.,;:-]+$/, "").trim();
  return s;
}

interface Parsed {
  isNF: boolean;
  numero: string | null;
  fornecedor: string;
}

function parseDescricao(desc: string): Parsed {
  const s = desc.trim();
  const upper = s.toUpperCase();

  // Nota fiscal principal — aceita "VALOR NF - 2219 - X", "VALOR NF 2219-X", "VALOR NF 2219 X"
  const mNF = s.match(/^VALOR\s+NF\b[\s-]*(.+)$/i);
  if (mNF) {
    const rest = mNF[1].trim();
    const m = rest.match(/^(\d+)\s*[-–]?\s*(.+)$/);
    if (m) {
      return {
        isNF: true,
        numero: m[1],
        fornecedor: cleanFornecedor(m[2]),
      };
    }
    return { isNF: true, numero: null, fornecedor: cleanFornecedor(rest) };
  }

  // Linha negativa relacionada — extrair número da NF
  // 1) Padrão explícito com "NF"
  let numero: string | null = null;
  const m1 = upper.match(/NF\s*-\s*(\d+)/);
  if (m1) numero = m1[1];
  else {
    const m2 = upper.match(/NF\s+(\d+)/);
    if (m2) numero = m2[1];
  }
  // 2) Padrões de retenção comuns: "S/ 1234", "S/NF 1234", "SOBRE 1234", "REF 1234", "REF. NF 1234"
  if (!numero) {
    const mRet = upper.match(/(?:S\s*\/\s*(?:NF\s*)?|SOBRE\s+|REF\.?\s*(?:NF\s*)?)(\d+)/);
    if (mRet) numero = mRet[1];
  }
  return { isNF: false, numero, fornecedor: "" };
}

// Extrai números candidatos a NF de uma descrição, ignorando datas, percentuais e valores monetários.
function extractCandidateNumbers(desc: string): string[] {
  let s = desc;
  // remove datas dd/mm/aaaa ou dd/mm/aa
  s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ");
  // remove percentuais 12% / 12,5%
  s = s.replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ");
  // remove valores monetários (contém vírgula ou ponto decimal) ex: 1.234,56 / 123,45 / 1234.56
  s = s.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, " ");
  s = s.replace(/\b\d+[.,]\d+\b/g, " ");
  const nums = s.match(/\b\d{3,}\b/g) ?? [];
  return nums;
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractDevolucaoRefNumero(desc: string): string | null {
  const normalized = removeAccents(desc).toUpperCase();
  const match = normalized.match(/\bREF\.?\s+DEVOLUCAO\s+NF\s*-?\s*(\d+)\b/);
  return match?.[1] ?? null;
}

function uniqueKnownMatches(matches: string[], byNumero: Map<string, NotaFiscal>): string[] {
  return Array.from(new Set(matches.filter((n) => byNumero.has(n))));
}

function removeOneDigitVariants(numero: string): string[] {
  const variants: string[] = [];
  for (let i = 0; i < numero.length; i++) {
    variants.push(numero.slice(0, i) + numero.slice(i + 1));
  }
  return variants;
}

function findSafeNumeroVariant(
  numero: string | null,
  desc: string,
  byNumero: Map<string, NotaFiscal>,
): string | null {
  if (!numero || byNumero.has(numero)) return numero;

  const matches: string[] = [];
  for (const known of byNumero.keys()) {
    const suffix = numero.slice(known.length);
    if (numero.startsWith(known) && /^0+\d*$/.test(suffix)) {
      matches.push(known);
    }
  }
  matches.push(...uniqueKnownMatches(removeOneDigitVariants(numero), byNumero));

  const descTokens = fornecedorTokens(desc);
  const supplierMatches = Array.from(new Set(matches)).filter((n) => {
    const nota = byNumero.get(n);
    if (!nota) return false;
    return tokenOverlap(descTokens, fornecedorTokens(nota.fornecedor)) > 0;
  });

  return supplierMatches.length === 1 ? supplierMatches[0] : null;
}

export interface TransformResult {
  notas: NotaFiscal[];
}

// ============ Previous month lookup ============

const PREV_FORNECEDOR_KEYS = ["FORNECEDOR", "Fornecedor"];
const PREV_NOTA_KEYS = ["NOTA FISCAL", "Nota Fiscal", "NotaFiscal", "NF", "N.F.", "N F", "Nº NF", "NUMERO NF", "NÚMERO NF", "Nota"];
const PREV_INFO_KEYS = ["INFORMAÇÕES", "INFORMACOES", "Informações", "Informacoes"];

function normNota(v: unknown): string {
  if (v == null) return "";
  let s = String(v).trim();
  s = s.replace(/\.0+$/, "");
  // Remove qualquer caractere que não seja dígito (pontos iniciais, espaços internos,
  // hifens, etc.) — o número da NF é sempre puramente numérico.
  s = s.replace(/\D+/g, "");
  // Remove zeros à esquerda.
  s = s.replace(/^0+/, "");
  return s;
}

function normFornecedor(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fornecedorTokens(v: unknown): Set<string> {
  const stop = new Set([
    "ltda", "me", "epp", "sa", "s", "a", "eireli", "cia", "e", "de", "da", "do",
    "das", "dos", "the", "com",
  ]);
  return new Set(
    normFornecedor(v)
      .split(" ")
      .filter((t) => t.length >= 3 && !stop.has(t)),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function formatInfoValue(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${v.getFullYear()}`;
  }
  if (typeof v === "number") {
    // Excel date serial heuristic: values between 20000 (1954) and 80000 (2119) with reasonable range
    if (v > 20000 && v < 80000 && Number.isInteger(v)) {
      const utc = Math.round((v - 25569) * 86400 * 1000);
      const dt = new Date(utc);
      const d = String(dt.getDate()).padStart(2, "0");
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      return `${d}/${m}/${dt.getFullYear()}`;
    }
    return String(v);
  }
  return String(v).trim();
}

export interface PrevEntry {
  fornecedor: string;
  tokens: Set<string>;
  info: string;
}

export function buildPreviousInfoMap(
  rows: SheetRow[],
): Map<string, PrevEntry[]> {
  const map = new Map<string, PrevEntry[]>();
  if (rows.length === 0) return map;
  const sample = rows[0];
  const fornKey = findKey(sample, PREV_FORNECEDOR_KEYS);
  const notaKey = findKey(sample, PREV_NOTA_KEYS);
  const infoKey = findKey(sample, PREV_INFO_KEYS);
  if (!fornKey || !notaKey || !infoKey) {
    throw new Error(
      "A planilha do mês anterior precisa conter as colunas FORNECEDOR, NOTA FISCAL e INFORMAÇÕES.",
    );
  }
  for (const row of rows) {
    const nota = normNota(row[notaKey]);
    const forn = row[fornKey];
    const info = row[infoKey];
    if (!nota || forn == null || String(forn).trim() === "") continue;
    const infoStr = formatInfoValue(info);
    if (!infoStr) continue;
    const entry: PrevEntry = {
      fornecedor: String(forn),
      tokens: fornecedorTokens(forn),
      info: infoStr,
    };
    const arr = map.get(nota);
    if (arr) arr.push(entry);
    else map.set(nota, [entry]);
  }
  return map;
}

export function applyPreviousInfo(
  notas: NotaFiscal[],
  prevMap: Map<string, PrevEntry[]>,
): void {
  for (const nota of notas) {
    const candidates = prevMap.get(normNota(nota.notaFiscal));
    if (!candidates || candidates.length === 0) continue;
    // Sempre exigir match por fornecedor (via overlap de tokens) além da NF.
    // Se o fornecedor não bater, deixar em branco — a NF pode ser nova (mês atual)
    // e coincidir por acaso com uma NF antiga de outro fornecedor.
    const genTokens = fornecedorTokens(nota.fornecedor);
    let chosen: PrevEntry | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = tokenOverlap(genTokens, c.tokens);
      if (score > bestScore) {
        bestScore = score;
        chosen = c;
      }
    }
    if (chosen) nota.informacoes = chosen.info;
  }
}

// ============ Pagamentos PDF matching ============

function formatVencList(dates: Date[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const dd = (d: Date) => String(d.getDate()).padStart(2, "0");
  const mm = (d: Date) => String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = (d: Date) => String(d.getFullYear());
  const short = sorted.slice(0, -1).map((d) => `${dd(d)}/${mm(d)}`);
  const last = sorted[sorted.length - 1];
  const lastStr = `${dd(last)}/${mm(last)}/${yyyy(last)}`;
  if (short.length === 0) return lastStr;
  if (short.length === 1) return `${short[0]} e ${lastStr}`;
  return `${short.join(", ")} e ${lastStr}`;
}

function formatShortDates(dates: Date[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const s = sorted.map(
    (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
  );
  if (s.length === 1) return s[0];
  if (s.length === 2) return `${s[0]} e ${s[1]}`;
  return `${s.slice(0, -1).join(", ")} e ${s[s.length - 1]}`;
}

export interface MesConferencia {
  ano: number;
  mes: number; // 1-12
}

function ymIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

function isLastDayOfMonth(d: Date, mes: MesConferencia): boolean {
  if (d.getFullYear() !== mes.ano || d.getMonth() + 1 !== mes.mes) return false;
  const last = new Date(mes.ano, mes.mes, 0).getDate();
  return d.getDate() === last;
}

// Returns { ok, needsReview } — needsReview is true when match came from a fuzzy rule.
function matchesTitulo(
  nfNorm: string,
  tituloNorm: string,
): { ok: boolean; needsReview: boolean } {
  if (!nfNorm || !tituloNorm) return { ok: false, needsReview: false };
  if (tituloNorm === nfNorm) return { ok: true, needsReview: false };
  // titulo = nf + digits (parcelas)
  if (tituloNorm.startsWith(nfNorm)) {
    const suffix = tituloNorm.slice(nfNorm.length);
    if (/^\d+$/.test(suffix)) return { ok: true, needsReview: false };
  }
  // nf termina com titulo (nf tem prefixo numérico extra)
  if (nfNorm.length > tituloNorm.length && nfNorm.endsWith(tituloNorm)) {
    const prefix = nfNorm.slice(0, nfNorm.length - tituloNorm.length);
    if (/^\d+$/.test(prefix)) return { ok: true, needsReview: true };
  }
  // titulo termina com nf (titulo tem prefixo numérico extra)
  if (tituloNorm.length > nfNorm.length && tituloNorm.endsWith(nfNorm)) {
    const prefix = tituloNorm.slice(0, tituloNorm.length - nfNorm.length);
    if (/^\d+$/.test(prefix)) return { ok: true, needsReview: true };
  }
  return { ok: false, needsReview: false };
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia },
): void {
  if (pdfRows.length === 0) return;
  const mes = opts.mesConferencia;
  const mesIdx = mes.ano * 12 + (mes.mes - 1);

  // Pre-normalize PDF rows.
  const normalized = pdfRows.map((r) => ({
    ...r,
    numeroNorm: normNota(r.numero),
    tokens: fornecedorTokens(r.fornecedor),
  }));

  for (const nota of notas) {
    const nfNorm = normNota(nota.notaFiscal);
    if (!nfNorm) continue;
    const notaTokens = fornecedorTokens(nota.fornecedor);

    let fuzzyMatch = false;
    const matches = normalized.filter((r) => {
      if (!r.numeroNorm) return false;
      const m = matchesTitulo(nfNorm, r.numeroNorm);
      if (!m.ok) return false;
      if (tokenOverlap(notaTokens, r.tokens) === 0) return false;
      if (m.needsReview) fuzzyMatch = true;
      return true;
    });

    if (matches.length === 0) continue;

    // Split parcelas por status vs mês de conferência.
    const hasPending = matches.some((r) => r.dataBaixa == null);
    const displayDates: Date[] = [];
    let lastDayFlag = false;
    for (const r of matches) {
      if (!r.dataBaixa) continue;
      if (isLastDayOfMonth(r.dataBaixa, mes)) {
        displayDates.push(r.dataBaixa);
        lastDayFlag = true;
        continue;
      }
      // Passada = mesmo mês ou anterior → oculta.
      if (ymIndex(r.dataBaixa) <= mesIdx) continue;
      displayDates.push(r.dataBaixa);
    }

    let text: string;
    if (hasPending && displayDates.length === 0) {
      text = "Próximas parcelas ainda sem programação";
    } else if (hasPending) {
      text = `${formatShortDates(displayDates)} e próximas ainda sem programação`;
    } else if (displayDates.length === 0) {
      // Todas pagas e todas em meses passados — nada a mostrar.
      text = "";
    } else {
      text = formatVencList(displayDates);
    }

    // Conferência: soma do valor total de TODAS as parcelas casadas vs FALTA PAGAR.
    const somaTotal = matches.reduce(
      (s, r) => s + (r.valorTitulo || r.valorAberto || 0),
      0,
    );
    const sumMismatch = Math.abs(somaTotal - nota.faltaPagar) > 0.01;
    if ((sumMismatch || fuzzyMatch || lastDayFlag) && text && !/\(conferir\)/i.test(text)) {
      text += " (conferir)";
    } else if ((sumMismatch || fuzzyMatch) && !text) {
      text = "(conferir)";
    }
    if (text) nota.informacoes = text;
  }
}

export function transformRows(rows: SheetRow[]): TransformResult {
  if (rows.length === 0) throw new Error("Planilha vazia.");
  const sample = rows[0];
  const histKey = findKey(sample, HIST_KEYS);
  const valorKey = findKey(sample, VALOR_KEYS);
  const dataKey = findKey(sample, DATA_KEYS);

  if (!histKey) throw new Error('Coluna "Descrição histórico" não encontrada.');
  if (!valorKey) throw new Error('Coluna "Valor" não encontrada.');
  if (!dataKey) throw new Error('Coluna "Data" não encontrada.');

  const notas: NotaFiscal[] = [];
  const byNumero = new Map<string, NotaFiscal>();

  // Primeira passagem: coletar notas fiscais
  for (const row of rows) {
    const desc = String(row[histKey] ?? "");
    if (!desc.trim()) continue;
    const parsed = parseDescricao(desc);
    if (!parsed.isNF) continue;
    const rawValor = toNumber(row[valorKey]);
    // Linha "VALOR NF" com valor negativo é devolução/abatimento — não é NF nova.
    // Será tratada na segunda passagem como retenção.
    if (rawValor < 0) continue;
    const valor = Math.abs(rawValor);
    const nota: NotaFiscal = {
      data: (row[dataKey] as Date | string | number | null) ?? null,
      fornecedor: parsed.fornecedor,
      notaFiscal: parsed.numero ?? "",
      valorNF: valor,
      faltaPagar: valor,
      informacoes: "",
    };
    notas.push(nota);
    if (parsed.numero) byNumero.set(parsed.numero, nota);
  }

  if (notas.length === 0) {
    throw new Error('Nenhuma linha com "VALOR NF -" foi encontrada no arquivo.');
  }

  // Segunda passagem: abater negativos
  for (const row of rows) {
    const desc = String(row[histKey] ?? "");
    if (!desc.trim()) continue;
    const valor = toNumber(row[valorKey]);
    if (valor >= 0) continue;
    const parsed = parseDescricao(desc);
    let numero = extractDevolucaoRefNumero(desc) ?? parsed.numero;
    // Se for uma linha "VALOR NF" negativa (devolução), o primeiro número é o da
    // própria devolução — ignoramos e procuramos a NF referenciada no texto.
    if (parsed.isNF && !extractDevolucaoRefNumero(desc)) numero = null;
    // 3) Fallback: procurar um único número na descrição que bata com NF conhecida
    if (!numero) {
      const candidates = extractCandidateNumbers(desc);
      const matches = Array.from(new Set(candidates.filter((n) => byNumero.has(n))));
      if (matches.length === 1) {
        numero = matches[0];
      } else if (matches.length > 1) {
        // desempate por fornecedor: descrição contém parte do nome do fornecedor
        const upperDesc = desc.toUpperCase();
        const scored = matches.filter((n) => {
          const forn = (byNumero.get(n)?.fornecedor ?? "").toUpperCase();
          if (!forn) return false;
          const firstWord = forn.split(/\s+/)[0];
          return firstWord.length >= 3 && upperDesc.includes(firstWord);
        });
        if (scored.length === 1) numero = scored[0];
      }
    }
    numero = findSafeNumeroVariant(numero, desc, byNumero);
    if (!numero) continue;
    const nota = byNumero.get(numero);
    if (!nota) continue;
    nota.faltaPagar += valor; // valor é negativo, então subtrai
  }

  return { notas };
}

function toJsDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial
    const utc = Math.round((v - 25569) * 86400 * 1000);
    return new Date(utc);
  }
  if (typeof v === "string" && v.trim()) {
    // dd/mm/yyyy
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(yy, Number(m[2]) - 1, Number(m[1]));
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export interface SheetInput {
  conta: string;
  result: TransformResult;
}

function sanitizeSheetName(name: string): string {
  // Excel sheet name rules: max 31 chars, no []:*?/\
  return name.replace(/[\[\]:*?\/\\]/g, "_").slice(0, 31) || "Sheet";
}

function populateSheet(ws: ExcelJS.Worksheet, result: TransformResult): void {
  ws.columns = [
    { header: "DATA", key: "data", width: 14 },
    { header: "FORNECEDOR", key: "fornecedor", width: 45 },
    { header: "NOTA FISCAL", key: "nota", width: 15 },
    { header: "VALOR DA NF", key: "valor", width: 18 },
    { header: "FALTA PAGAR", key: "falta", width: 18 },
    { header: "INFORMAÇÕES", key: "info", width: 60 },
  ];

  // Header style
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF374151" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  });

  for (const nota of result.notas) {
    ws.addRow({
      data: toJsDate(nota.data) ?? nota.data ?? "",
      fornecedor: nota.fornecedor,
      nota: nota.notaFiscal,
      valor: nota.valorNF,
      falta: nota.faltaPagar,
      info: nota.informacoes ?? "",
    });
  }

  // Total row
  const totalRowNum = ws.rowCount + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(3).value = "TOTAL";
  totalRow.getCell(5).value = {
    formula: `SUM(E2:E${totalRowNum - 1})`,
  };

  const currencyFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  const dateFmt = "dd/mm/yyyy";

  // Body styling
  for (let r = 2; r <= totalRowNum; r++) {
    const row = ws.getRow(r);
    const isTotal = r === totalRowNum;
    row.height = isTotal ? 22 : 20;
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNum === 2 || colNum === 6 ? "left" : "center",
        wrapText: colNum === 2 || colNum === 6,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isTotal ? "FFE5E7EB" : "FFF1F5F9" },
      };
      if (isTotal) cell.font = { bold: true };
      if (colNum === 1) cell.numFmt = dateFmt;
      if (colNum === 4 || colNum === 5) cell.numFmt = currencyFmt;
    });
  }
}

export async function buildXlsx(input: TransformResult | SheetInput[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const sheets: SheetInput[] = Array.isArray(input)
    ? input
    : [{ conta: "Notas Fiscais", result: input }];
  const used = new Set<string>();
  for (const { conta, result } of sheets) {
    let name = sanitizeSheetName(conta);
    let i = 2;
    while (used.has(name)) name = sanitizeSheetName(`${conta}_${i++}`);
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    populateSheet(ws, result);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
