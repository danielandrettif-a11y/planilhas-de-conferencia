import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker as string;

export interface PagamentoRow {
  numero: string;
  fornecedor: string;
  valorTitulo: number;
  valorAberto: number;
  dataBaixa: Date | null;
}

function parseBrDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function parseBrNumber(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return isNaN(n) ? 0 : n;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
}

function groupByLine(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  const TOL = 3;
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= TOL) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

function joinLine(line: TextItem[]): string {
  return line.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
}

// Regex: prefix, valorTitulo, valorAberto, optional dataBaixa
const LINE_RE =
  /^(.*?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*$/;

// Token is "date-like" if it contains only digits and slashes (covers scrambled
// interleaved dates like "11/030/220/0174/2026" and normal "22/04/2026").
function isDateLikeToken(t: string): boolean {
  return /^[\d/]+$/.test(t) && /\//.test(t);
}

function parseLine(text: string): PagamentoRow | null {
  const m = text.match(LINE_RE);
  if (!m) return null;
  let prefix = m[1].trim();
  const valorTitulo = parseBrNumber(m[2]);
  const valorAberto = parseBrNumber(m[3]);
  const dataBaixa = m[4] ? parseBrDate(m[4]) : null;

  const tokens = prefix.split(/\s+/);
  // Remove trailing date-like tokens (the 2-4 date columns before values).
  while (tokens.length > 0 && isDateLikeToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens.length === 0) return null;

  // First token is usually the empresa code (all digits, ≤6). Drop it.
  if (tokens.length >= 2 && /^\d{1,6}$/.test(tokens[0])) {
    tokens.shift();
  }
  if (tokens.length === 0) return null;

  let numero = tokens.shift() as string;
  // Reject headers / summary lines.
  if (!/\d/.test(numero)) return null;
  // Strip "0006" empresa prefix if present (leading zeros + short digits).
  numero = numero.replace(/^0+/, "");
  const digits = numero.replace(/\D+/g, "");
  if (digits.length < 3) return null;

  const fornecedor = tokens.join(" ").trim();
  if (!fornecedor) return null;
  if (/filtro/i.test(fornecedor)) return null;

  return { numero, fornecedor, valorTitulo, valorAberto, dataBaixa };
}

export async function parsePagamentosPdf(file: File): Promise<PagamentoRow[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows: PagamentoRow[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items as Array<{
      str: string;
      transform: number[];
      width: number;
    }>) {
      if (!it.str) continue;
      items.push({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width ?? 0,
      });
    }
    const lines = groupByLine(items);
    for (const line of lines) {
      const text = joinLine(line);
      const row = parseLine(text);
      if (row) rows.push(row);
    }
  }

  console.info(`[pdf] ${pdf.numPages} página(s), ${rows.length} linha(s) extraída(s)`);
  if (rows.length > 0) console.info("[pdf] amostra:", rows.slice(0, 3));
  return rows;
}
