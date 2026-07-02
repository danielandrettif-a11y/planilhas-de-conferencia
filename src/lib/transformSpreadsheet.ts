import ExcelJS from "exceljs";

export type SheetRow = Record<string, unknown>;

export interface NotaFiscal {
  data: Date | string | number | null;
  fornecedor: string;
  notaFiscal: string;
  valorNF: number;
  faltaPagar: number;
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
  return s.trim();
}

interface Parsed {
  isNF: boolean;
  numero: string | null;
  fornecedor: string;
}

function parseDescricao(desc: string): Parsed {
  const s = desc.trim();
  const upper = s.toUpperCase();

  // Nota fiscal principal
  const mNF = s.match(/^VALOR\s+NF\s*-\s*(.+)$/i);
  if (mNF) {
    const rest = mNF[1].trim();
    const m = rest.match(/^(\d+)\s*[-\s]\s*(.+)$/);
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
  // Padrões: "PAGO NF - 123-...", "... NF - 4394-...", "... NF 4395 ..."
  let numero: string | null = null;
  const m1 = upper.match(/NF\s*-\s*(\d+)/);
  if (m1) numero = m1[1];
  else {
    const m2 = upper.match(/NF\s+(\d+)/);
    if (m2) numero = m2[1];
  }
  return { isNF: false, numero, fornecedor: "" };
}

export interface TransformResult {
  notas: NotaFiscal[];
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
    const valor = Math.abs(toNumber(row[valorKey]));
    const nota: NotaFiscal = {
      data: (row[dataKey] as Date | string | number | null) ?? null,
      fornecedor: parsed.fornecedor,
      notaFiscal: parsed.numero ?? "",
      valorNF: valor,
      faltaPagar: valor,
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
    if (parsed.isNF) continue;
    if (!parsed.numero) continue;
    const nota = byNumero.get(parsed.numero);
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

export async function buildXlsx(result: TransformResult): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Notas Fiscais", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "DATA", key: "data", width: 14 },
    { header: "FORNECEDOR", key: "fornecedor", width: 45 },
    { header: "NOTA FISCAL", key: "nota", width: 15 },
    { header: "VALOR DA NF", key: "valor", width: 18 },
    { header: "FALTA PAGAR", key: "falta", width: 18 },
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
        horizontal: "center",
        wrapText: colNum === 2,
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

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
