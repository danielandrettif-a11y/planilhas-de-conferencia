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

// Column x-ranges detected from the header of each page.
interface Columns {
  numero: [number, number];
  titulo: [number, number];
  valorTitulo: [number, number];
  valorAberto: [number, number];
  dataBaixa: [number, number];
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

function joinInRange(line: TextItem[], range: [number, number]): string {
  const parts: string[] = [];
  for (const it of line) {
    const cx = it.x + it.w / 2;
    if (cx >= range[0] && cx < range[1]) parts.push(it.str);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function detectColumns(lines: TextItem[][]): Columns | null {
  // Look for header line containing "Número título" split possibly across items.
  for (const line of lines) {
    const text = line.map((i) => i.str).join(" ").toLowerCase();
    if (
      text.includes("número título") &&
      text.includes("valor") &&
      text.includes("baixa")
    ) {
      const xNumero = (() => {
        for (const it of line) {
          if (it.str.toLowerCase().includes("número")) return it.x;
        }
        return null;
      })();
      // "Título" appears twice; second occurrence after "Número título"
      let xTitulo: number | null = null;
      let seenNumero = false;
      for (const it of line) {
        const s = it.str.toLowerCase();
        if (!seenNumero && s.includes("número")) seenNumero = true;
        else if (seenNumero && s.includes("título") && !s.includes("número")) {
          xTitulo = it.x;
          break;
        }
      }
      // Values
      let xValorTitulo: number | null = null;
      let xValorAberto: number | null = null;
      let seenValor = 0;
      for (const it of line) {
        const s = it.str.toLowerCase();
        if (s.includes("valor")) {
          if (seenValor === 0) xValorTitulo = it.x;
          else if (seenValor === 1) xValorAberto = it.x;
          seenValor++;
        }
      }
      let xBaixa: number | null = null;
      for (const it of line) {
        if (it.str.toLowerCase().includes("baixa")) {
          xBaixa = it.x;
          break;
        }
      }

      if (
        xNumero == null ||
        xTitulo == null ||
        xValorTitulo == null ||
        xValorAberto == null ||
        xBaixa == null
      )
        continue;

      const cols: Columns = {
        numero: [xNumero - 5, xTitulo - 2],
        titulo: [xTitulo - 2, xValorTitulo - 5],
        valorTitulo: [xValorTitulo - 5, xValorAberto - 5],
        valorAberto: [xValorAberto - 5, xBaixa - 5],
        dataBaixa: [xBaixa - 5, 10_000],
      };
      return cols;
    }
  }
  return null;
}

export async function parsePagamentosPdf(file: File): Promise<PagamentoRow[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows: PagamentoRow[] = [];
  let pagesWithHeader = 0;

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
    const cols = detectColumns(lines);
    if (!cols) {
      console.info(`[pdf] página ${p}: cabeçalho não detectado`);
      continue;
    }
    pagesWithHeader++;

    // Find header y so data lines are below it.
    let headerY = Infinity;
    for (const line of lines) {
      const t = line.map((i) => i.str).join(" ").toLowerCase();
      if (t.includes("número título")) {
        headerY = line[0].y;
        break;
      }
    }

    for (const line of lines) {
      if (line[0].y >= headerY) continue;
      const numeroRaw = joinInRange(line, cols.numero);
      const titulo = joinInRange(line, cols.titulo);
      const valorTituloStr = joinInRange(line, cols.valorTitulo);
      const valorAbertoStr = joinInRange(line, cols.valorAberto);
      const baixaStr = joinInRange(line, cols.dataBaixa);

      if (!numeroRaw || !titulo) continue;
      // Skip lines that look like filters/footers
      if (/filtro/i.test(numeroRaw + " " + titulo)) continue;
      // Require at least 3 digits in the número
      const digits = numeroRaw.replace(/\D+/g, "");
      if (digits.length < 3) continue;

      const dataBaixa = parseBrDate(baixaStr);
      const valorTitulo = parseBrNumber(valorTituloStr);
      const valorAberto = parseBrNumber(valorAbertoStr);

      rows.push({
        numero: numeroRaw,
        fornecedor: titulo,
        valorTitulo,
        valorAberto,
        dataBaixa,
      });
    }
  }

  console.info(
    `[pdf] ${pdf.numPages} página(s), header em ${pagesWithHeader}, ${rows.length} linha(s) extraída(s)`,
  );
  if (rows.length > 0) console.info("[pdf] amostra:", rows.slice(0, 3));
  return rows;
}
