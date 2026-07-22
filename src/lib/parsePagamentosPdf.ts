import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  parsePagamentoColumns,
  parsePagamentoLine,
  type PagamentoRow,
} from "./parsePagamentoLine";

export { parsePagamentoLine } from "./parsePagamentoLine";
export type { PagamentoRow } from "./parsePagamentoLine";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker as string;

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
}

export interface PagamentosPdfResult {
  rows: PagamentoRow[];
  pages: number;
  uniqueTitles: number;
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

function joinColumn(line: TextItem[], minX: number, maxX = Number.POSITIVE_INFINITY): string {
  return line
    .filter((item) => item.x >= minX && item.x < maxX)
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePositionedLine(line: TextItem[], pageWidth: number): PagamentoRow | null {
  // O relatório usado nos testes reais tem largura-base de 792 pontos.
  // Escalamos pelos limites da página, não pelo último item da linha, porque
  // títulos em aberto não possuem Data baixa e terminam antes da borda direita.
  const scale = pageWidth / 792;
  const x = (value: number) => value * scale;

  const numero = joinColumn(line, x(70), x(167));
  const fornecedor = joinColumn(line, x(167), x(300));
  const dataCadastro = joinColumn(line, x(300), x(368));
  const dataEmissao = joinColumn(line, x(368), x(435));
  const dataProgramada = joinColumn(line, x(435), x(500));
  const dataOriginal = joinColumn(line, x(500), x(580));
  const valorTitulo = joinColumn(line, x(580), x(636));
  const valorAberto = joinColumn(line, x(636), x(702));
  const dataBaixa = joinColumn(line, x(702));

  if (!/\d/.test(numero) || !/\d{1,3}(?:\.\d{3})*,\d{2}/.test(valorTitulo)) return null;

  return parsePagamentoColumns({
    numero,
    fornecedor,
    dataCadastro,
    dataEmissao,
    dataProgramada,
    dataOriginal,
    valorTitulo,
    valorAberto,
    dataBaixa,
  });
}

function validateRows(rows: PagamentoRow[]): void {
  if (rows.length === 0) throw new Error("Nenhum título foi reconhecido no PDF.");

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.numero, (counts.get(row.numero) ?? 0) + 1);
  const mostCommon = Math.max(...counts.values());
  const uniqueRatio = counts.size / rows.length;

  if (rows.length >= 20 && (mostCommon / rows.length > 0.8 || uniqueRatio < 0.005)) {
    throw new Error(
      "O PDF foi lido, mas os números dos títulos não foram identificados corretamente. Gere novamente o relatório ou verifique o formato do arquivo.",
    );
  }
}

export async function parsePagamentosPdfDetailed(file: File): Promise<PagamentosPdfResult> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const rows: PagamentoRow[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];

    for (const item of content.items as Array<{ str: string; transform: number[]; width: number }>) {
      if (!item.str) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width ?? 0 });
    }

    for (const line of groupByLine(items)) {
      const row = parsePositionedLine(line, viewport.width) ?? parsePagamentoLine(joinLine(line));
      if (row) rows.push(row);
    }
  }

  validateRows(rows);
  const uniqueTitles = new Set(rows.map((row) => row.numero)).size;

  if (import.meta.env.DEV) {
    console.info(`[pdf] ${pdf.numPages} página(s), ${rows.length} linha(s), ${uniqueTitles} título(s) único(s)`);
  }

  return { rows, pages: pdf.numPages, uniqueTitles };
}

export async function parsePagamentosPdf(file: File): Promise<PagamentoRow[]> {
  return (await parsePagamentosPdfDetailed(file)).rows;
}
