import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parsePagamentoLine, type PagamentoRow } from "./parsePagamentoLine";

export { parsePagamentoLine } from "./parsePagamentoLine";
export type { PagamentoRow } from "./parsePagamentoLine";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker as string;

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
      const row = parsePagamentoLine(joinLine(line));
      if (row) rows.push(row);
    }
  }

  if (import.meta.env.DEV) {
    console.info(`[pdf] ${pdf.numPages} página(s), ${rows.length} linha(s) extraída(s)`);
  }
  return rows;
}
