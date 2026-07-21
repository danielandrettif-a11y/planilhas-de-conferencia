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

function parseBrDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBrNumber(value: string): number {
  const parsed = Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
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
  const tolerance = 3;
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= tolerance) last.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function joinLine(line: TextItem[]): string {
  return line.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
}

const LINE_RE =
  /^(.*?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*$/;

function isDateLikeToken(value: string): boolean {
  return /^[\d/]+$/.test(value) && value.includes("/");
}

function parseLine(text: string): PagamentoRow | null {
  const match = text.match(LINE_RE);
  if (!match) return null;

  const tokens = match[1].trim().split(/\s+/);
  while (tokens.length > 0 && isDateLikeToken(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length < 2) return null;

  if (/^\d{1,6}$/.test(tokens[0])) tokens.shift();
  if (tokens.length < 2) return null;

  let numero = tokens.shift() ?? "";
  if (!/\d/.test(numero)) return null;
  numero = numero.replace(/^0+/, "") || "0";

  const fornecedor = tokens.join(" ").trim();
  if (!fornecedor || /filtro/i.test(fornecedor)) return null;

  return {
    numero,
    fornecedor,
    valorTitulo: parseBrNumber(match[2]),
    valorAberto: parseBrNumber(match[3]),
    dataBaixa: match[4] ? parseBrDate(match[4]) : null,
  };
}

export async function parsePagamentosPdf(file: File): Promise<PagamentoRow[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const rows: PagamentoRow[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItem[] = [];

    for (const item of content.items as Array<{ str: string; transform: number[]; width: number }>) {
      if (!item.str) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width ?? 0 });
    }

    for (const line of groupByLine(items)) {
      const row = parseLine(joinLine(line));
      if (row) rows.push(row);
    }
  }

  if (import.meta.env.DEV) {
    console.info(`[pdf] ${pdf.numPages} página(s), ${rows.length} linha(s) extraída(s)`);
  }
  return rows;
}
