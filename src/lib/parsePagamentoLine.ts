export interface PagamentoRow {
  numero: string;
  fornecedor: string;
  valorTitulo: number;
  valorAberto: number;
  dataProgramada: Date | null;
  dataBaixa: Date | null;
}

function parseBrDate(value: string): Date | null {
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

function parseBrNumber(value: string): number {
  const parsed = Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
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
  while (cleaned.length > 1 && TITLE_COMPLEMENTS.has(cleaned[0].toUpperCase().replace(/[^A-Z]/g, ""))) {
    cleaned.shift();
  }
  return cleaned;
}

export function parsePagamentoLine(text: string): PagamentoRow | null {
  const match = text.match(LINE_RE);
  if (!match) return null;

  const tokens = match[1].trim().split(/\s+/);
  const trailingDateTokens: string[] = [];

  while (tokens.length > 0 && isDateLikeToken(tokens[tokens.length - 1])) {
    trailingDateTokens.push(tokens.pop() ?? "");
  }

  if (tokens.length < 2) return null;

  // O relatório pode trazer um contador de linha com até três dígitos antes do título.
  // NFs curtas aparecem como 0001, 00020, 00034 etc. e não podem ser descartadas.
  if (/^\d{1,3}$/.test(tokens[0]) && tokens.length >= 3 && /\d/.test(tokens[1])) {
    tokens.shift();
  }
  if (tokens.length < 2) return null;

  let numero = tokens.shift() ?? "";
  if (!/\d/.test(numero)) return null;
  numero = numero.replace(/\D+/g, "").replace(/^0+/, "") || "0";

  const fornecedorTokens = cleanSupplierTokens(tokens);
  const fornecedor = fornecedorTokens.join(" ").trim();
  if (!fornecedor || /filtro/i.test(fornecedor)) return null;

  const dataBaixa = match[4] ? parseBrDate(match[4]) : null;

  // Com três ou mais datas antes dos valores, a data mais à direita representa
  // a programação. Com apenas emissão/vencimento, não presumimos programação.
  const dataProgramada = trailingDateTokens.length >= 3
    ? parseBrDate(trailingDateTokens[0])
    : dataBaixa;

  return {
    numero,
    fornecedor,
    valorTitulo: parseBrNumber(match[2]),
    valorAberto: parseBrNumber(match[3]),
    dataProgramada,
    dataBaixa,
  };
}
