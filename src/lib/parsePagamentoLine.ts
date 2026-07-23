export interface PagamentoRow {
  numero: string;
  fornecedor: string;
  valorTitulo: number;
  valorAberto: number;
  dataProgramada: Date | null;
  dataBaixa: Date | null;
}

export interface PagamentoColumns {
  numero: string;
  fornecedor: string;
  dataCadastro?: string;
  dataEmissao?: string;
  dataProgramada?: string;
  dataOriginal?: string;
  valorTitulo: string;
  valorAberto: string;
  dataBaixa?: string;
}

function parseBrDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseBrNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTitleNumber(raw: string): string {
  const matches = [...raw.matchAll(/\d+/g)];
  if (matches.length === 0) return "";

  // Usa o maior bloco numérico. Em caso de empate, prefere o último bloco,
  // o que cobre títulos como "5954/6179 - 1 PARC" sem concatenar números.
  let best = matches[0][0];
  for (const match of matches.slice(1)) {
    if (match[0].length >= best.length) best = match[0];
  }

  return best.replace(/^0+/, "") || "0";
}

function normalizeSupplier(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parsePagamentoColumns(columns: PagamentoColumns): PagamentoRow | null {
  const numero = normalizeTitleNumber(columns.numero);
  const fornecedor = normalizeSupplier(columns.fornecedor);
  if (!numero || !fornecedor || /filtro/i.test(fornecedor)) return null;

  const valorTitulo = parseBrNumber(columns.valorTitulo);
  const valorAberto = parseBrNumber(columns.valorAberto);
  if (valorTitulo === null || valorAberto === null) return null;

  return {
    numero,
    fornecedor,
    valorTitulo,
    valorAberto,
    dataProgramada: parseBrDate(columns.dataProgramada),
    dataBaixa: parseBrDate(columns.dataBaixa),
  };
}

const LINE_RE =
  /^(.*?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*$/;

const TITLE_COMPLEMENTS = new Set([
  "FRETE",
  "BOLETO",
  "DUPLICATA",
  "PARCELA",
]);

function isDateLikeToken(value: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value);
}

function cleanSupplierTokens(tokens: string[]): string[] {
  const cleaned = [...tokens];
  while (
    cleaned.length > 1
    && TITLE_COMPLEMENTS.has(cleaned[0].toUpperCase().replace(/[^A-Z]/g, ""))
  ) {
    cleaned.shift();
  }
  return cleaned;
}

export function parsePagamentoLine(text: string): PagamentoRow | null {
  const match = text.match(LINE_RE);
  if (!match) return null;

  const tokens = match[1].trim().split(/\s+/);
  const removedDatesRightToLeft: string[] = [];

  while (tokens.length > 0 && isDateLikeToken(tokens[tokens.length - 1])) {
    removedDatesRightToLeft.push(tokens.pop() ?? "");
  }

  if (tokens.length < 2) return null;

  // O primeiro campo do relatório é o código da empresa. Dependendo do motor
  // do PDF ele pode chegar como 000, 00044 ou outro código iniciado por zero.
  // Só removemos quando o campo seguinte também contém um número de título.
  if (/^0\d{2,5}$/.test(tokens[0]) && tokens.length >= 3 && /\d/.test(tokens[1])) {
    tokens.shift();
  }
  if (tokens.length < 2) return null;

  const numeroRaw = tokens.shift() ?? "";
  const fornecedorTokens = cleanSupplierTokens(tokens);
  const fornecedor = fornecedorTokens.join(" ").trim();

  // As datas removidas estavam da direita para a esquerda. Após inverter,
  // a ordem esperada é cadastro, emissão, programada e original.
  const datesLeftToRight = removedDatesRightToLeft.reverse();

  return parsePagamentoColumns({
    numero: numeroRaw,
    fornecedor,
    dataCadastro: datesLeftToRight[0],
    dataEmissao: datesLeftToRight[1],
    dataProgramada: datesLeftToRight[2],
    dataOriginal: datesLeftToRight[3],
    valorTitulo: match[2],
    valorAberto: match[3],
    dataBaixa: match[4],
  });
}
