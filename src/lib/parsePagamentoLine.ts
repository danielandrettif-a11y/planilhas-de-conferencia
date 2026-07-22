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

function isDateLikeToken(value: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value);
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

  if (/^\d{1,6}$/.test(tokens[0])) tokens.shift();
  if (tokens.length < 2) return null;

  let numero = tokens.shift() ?? "";
  if (!/\d/.test(numero)) return null;
  numero = numero.replace(/^0+/, "") || "0";

  const fornecedor = tokens.join(" ").trim();
  if (!fornecedor || /filtro/i.test(fornecedor)) return null;

  const dataBaixa = match[4] ? parseBrDate(match[4]) : null;

  // No relatório do ERP, quando há ao menos três datas antes dos valores,
  // a data mais à direita é a programação usada para a conferência.
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
