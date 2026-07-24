import {
  applyPagamentosPdf as applyPagamentosPdfOriginal,
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx as buildXlsxOriginal,
  flagDuplicateInvoices,
  transformRows as transformRowsOriginal,
  type BuildXlsxOptions,
  type MesConferencia,
  type NotaFiscal,
  type SheetInput,
  type SheetRow,
  type TransformResult,
} from "./transformSpreadsheet";
import type { PagamentoRow } from "./parsePagamentosPdf";

export {
  applyPreviousInfo,
  buildPreviousInfoMap,
  flagDuplicateInvoices,
};

export type {
  BuildXlsxOptions,
  MesConferencia,
  NotaFiscal,
  SheetInput,
  SheetRow,
  TransformResult,
};

interface ReconciliationWarning {
  linha: number;
  data: Date | string | number | null;
  periodo: string;
  descricao: string;
  valor: number;
  tipo: string;
  motivo: string;
}

interface ReconciliationMeta {
  rawByYear: Map<string, number>;
  rawByMonth: Map<string, number>;
  warnings: ReconciliationWarning[];
}

const MONEY_TOLERANCE = 0.005;
const RETENTION_RE = /\b(?:INSS|IRRF|ISS(?:QN)?|PIS|COFINS|CSLL|RETENCAO|IMPOSTO|ABATIMENTO|DESCONTO)\b/i;
const metaByResult = new WeakMap<TransformResult, ReconciliationMeta>();
const retentionByNote = new WeakMap<NotaFiscal, number>();

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(roundCurrency(value))
    .replace(/\u00a0/g, " ");
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeFiscalText(value: string): string {
  return removeAccents(value)
    .toUpperCase()
    .replace(/I\s*\.?\s*N\s*\.?\s*S\s*\.?\s*S\s*\.?/g, "INSS")
    .replace(/I\s*\.?\s*R\s*\.?\s*R\s*\.?\s*F\s*\.?/g, "IRRF")
    .replace(/I\s*\.?\s*S\s*\.?\s*S\s*\.?\s*Q\s*\.?\s*N\s*\.?/g, "ISSQN")
    .replace(/I\s*\.?\s*S\s*\.?\s*S\s*\.?/g, "ISS")
    .replace(/P\s*\.?\s*I\s*\.?\s*S\s*\.?/g, "PIS")
    .replace(/C\s*\.?\s*S\s*\.?\s*L\s*\.?\s*L\s*\.?/g, "CSLL")
    .replace(/\s+/g, " ")
    .trim();
}

function findKey(rows: SheetRow[], candidates: string[]): string | null {
  const first = rows[0];
  if (!first) return null;
  const keys = Object.keys(first);
  for (const candidate of candidates) {
    const exact = keys.find((key) => key.trim().toLowerCase() === candidate.trim().toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = keys.find((key) => key.trim().toLowerCase().includes(candidate.trim().toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

function parseAccountingValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || String(value).trim() === "") return null;

  const original = String(value).trim();
  const indicator = original.match(/([DC])\s*$/i)?.[1]?.toUpperCase() ?? null;
  const cleaned = original
    .replace(/([DC])\s*$/i, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!cleaned || !/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const thousandsOnly = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(cleaned);
    normalized = thousandsOnly ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (indicator === "D") return -Math.abs(parsed);
  if (indicator === "C") return Math.abs(parsed);
  return parsed;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string") return null;
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodKeys(value: unknown): { year: string; month: string } {
  const date = toDate(value);
  if (!date) return { year: "SEM DATA", month: "SEM DATA" };
  const year = String(date.getFullYear());
  const month = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return { year, month };
}

function addToMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, roundCurrency((map.get(key) ?? 0) + value));
}

function normalizeNoteNumber(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\.0+$/, "").replace(/\D+/g, "").replace(/^0+/, "") || "0";
}

function extractNoteNumber(description: string): string | null {
  const text = normalizeFiscalText(description);
  const match = text.match(/(?:S\s*\/\s*(?:NF\s*)?|SOBRE\s+(?:A\s+)?(?:NF\s*)?|REF\.?\s*(?:NF\s*)?|NF\s*(?:-|N[ºO.]?\s*)?)\s*(\d+)/)
    ?? text.match(/\bNOTA\s+FISCAL\s*(?:N[ºO.]?\s*)?(\d+)/);
  return match ? normalizeNoteNumber(match[1]) : null;
}

function isSafeShortenedNote(full: string, shortened: string): boolean {
  return shortened.length >= 5 && full.length > shortened.length && full.endsWith(shortened)
    && /^\d{2,}$/.test(full.slice(0, full.length - shortened.length));
}

function findRetentionTarget(number: string, notas: NotaFiscal[]): NotaFiscal | null {
  const exact = notas.filter((nota) => normalizeNoteNumber(nota.notaFiscal) === number);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const shortened = notas.filter((nota) => isSafeShortenedNote(normalizeNoteNumber(nota.notaFiscal), number));
  return shortened.length === 1 ? shortened[0] : null;
}

function collectMeta(rows: SheetRow[], result: TransformResult): ReconciliationMeta {
  const histKey = findKey(rows, ["Descrição histórico", "Descricao historico", "DescriÃ§Ã£o histÃ³rico"]);
  const valueKey = findKey(rows, ["Valor"]);
  const dataKey = findKey(rows, ["Data"]);
  const rawByYear = new Map<string, number>();
  const rawByMonth = new Map<string, number>();
  const warnings: ReconciliationWarning[] = [];

  if (!histKey || !valueKey || !dataKey) return { rawByYear, rawByMonth, warnings };

  for (const [index, row] of rows.entries()) {
    const value = parseAccountingValue(row[valueKey]);
    if (value === null || Math.abs(value) < MONEY_TOLERANCE) continue;
    const data = row[dataKey] as Date | string | number | null;
    const period = periodKeys(data);
    addToMap(rawByYear, period.year, value);
    addToMap(rawByMonth, period.month, value);

    const description = String(row[histKey] ?? "").trim();
    const normalizedDescription = normalizeFiscalText(description);
    const isInvoice = /^VALOR\s+NF\b/.test(normalizedDescription);
    const isRetention = RETENTION_RE.test(normalizedDescription);

    if (isRetention && value < 0) {
      const number = extractNoteNumber(description);
      const target = number ? findRetentionTarget(number, result.notas) : null;
      if (target) {
        retentionByNote.set(target, roundCurrency((retentionByNote.get(target) ?? 0) + Math.abs(value)));
        continue;
      }
      warnings.push({
        linha: index + 2,
        data,
        periodo: period.month,
        descricao: description,
        valor: value,
        tipo: "Retenção não vinculada",
        motivo: number
          ? `A retenção indica a NF ${number}, mas não foi possível localizar uma única NF correspondente.`
          : "A linha parece ser uma retenção, mas não contém um número de NF identificável.",
      });
      continue;
    }

    if (!isInvoice) {
      warnings.push({
        linha: index + 2,
        data,
        periodo: period.month,
        descricao: description,
        valor: value,
        tipo: "Linha monetária fora do padrão",
        motivo: "A linha possui valor, mas não foi classificada como NF ou retenção vinculada. Ela não será usada para criar um lançamento artificial.",
      });
    }
  }

  return { rawByYear, rawByMonth, warnings };
}

export function transformRows(rows: SheetRow[]): TransformResult {
  const result = transformRowsOriginal(rows);
  metaByResult.set(result, collectMeta(rows, result));
  return result;
}

function isClearlyUnsafeNegative(nota: NotaFiscal, previous: number): boolean {
  if (previous < -MONEY_TOLERANCE || nota.faltaPagar >= -MONEY_TOLERANCE) return false;
  const reference = Math.max(Math.abs(previous), Math.abs(nota.valorNF));
  return nota.confiancaAssociacao !== "Alta"
    || Math.abs(nota.faltaPagar) > Math.max(5000, reference * 0.5);
}

export function applyPagamentosPdf(
  notas: NotaFiscal[],
  pdfRows: PagamentoRow[],
  opts: { mesConferencia: MesConferencia; generatedAt?: Date },
): void {
  const previousBalances = new Map<NotaFiscal, number>();
  const grossValues = new Map<NotaFiscal, number>();

  for (const nota of notas) {
    previousBalances.set(nota, nota.faltaPagar);
    const retention = retentionByNote.get(nota) ?? 0;
    if (retention > MONEY_TOLERANCE) {
      grossValues.set(nota, nota.valorNF);
      nota.valorNF = roundCurrency(Math.max(0, nota.valorNF - retention));
    }
  }

  try {
    applyPagamentosPdfOriginal(notas, pdfRows, opts);
  } finally {
    for (const [nota, gross] of grossValues) nota.valorNF = gross;
  }

  for (const nota of notas) {
    const previous = previousBalances.get(nota);
    if (previous === undefined || !isClearlyUnsafeNegative(nota, previous)) continue;
    nota.faltaPagar = previous;
    nota.confiancaAssociacao = "Manual";
    nota.informacoes = "Possível pagamento localizado, mas a associação financeira foi bloqueada (conferir)";
    const reason = "A associação criaria saldo negativo sem segurança suficiente. Nenhum valor financeiro foi alterado.";
    if (!nota.motivosConferencia.includes(reason)) nota.motivosConferencia.push(reason);
  }
}

function generatedByPeriod(notas: NotaFiscal[], level: "year" | "month"): Map<string, number> {
  const map = new Map<string, number>();
  for (const nota of notas) {
    const period = periodKeys(nota.data);
    addToMap(map, level === "year" ? period.year : period.month, nota.faltaPagar);
  }
  return map;
}

function displayPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  return `${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

function styleHeader(row: import("exceljs").Row): void {
  row.font = { bold: true };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
}

export async function buildXlsx(
  input: TransformResult | SheetInput[],
  options: BuildXlsxOptions = {},
): Promise<Blob> {
  const original = await buildXlsxOriginal(input, options);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await original.arrayBuffer());

  const sheets: SheetInput[] = Array.isArray(input)
    ? input
    : [{ conta: "Conta", result: input }];

  const existingReconciliation = workbook.getWorksheet("Reconciliação");
  if (existingReconciliation) workbook.removeWorksheet(existingReconciliation.id);
  const existingWarnings = workbook.getWorksheet("Avisos Reconciliação");
  if (existingWarnings) workbook.removeWorksheet(existingWarnings.id);

  const reconciliation = workbook.addWorksheet("Reconciliação");
  reconciliation.columns = [
    { header: "CONTA", key: "conta", width: 14 },
    { header: "NÍVEL", key: "nivel", width: 12 },
    { header: "PERÍODO", key: "periodo", width: 14 },
    { header: "PLANILHA BRUTA", key: "bruto", width: 20 },
    { header: "RESULTADO GERADO", key: "gerado", width: 20 },
    { header: "DIFERENÇA", key: "diferenca", width: 18 },
    { header: "STATUS", key: "status", width: 16 },
  ];
  styleHeader(reconciliation.getRow(1));

  const allWarnings: Array<ReconciliationWarning & { conta: string }> = [];

  for (const sheet of sheets) {
    const meta = metaByResult.get(sheet.result);
    if (!meta) continue;
    allWarnings.push(...meta.warnings.map((warning) => ({ conta: sheet.conta, ...warning })));

    const generatedYears = generatedByPeriod(sheet.result.notas, "year");
    const years = [...new Set([...meta.rawByYear.keys(), ...generatedYears.keys()])]
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

    for (const year of years) {
      const raw = roundCurrency(meta.rawByYear.get(year) ?? 0);
      const generated = roundCurrency(generatedYears.get(year) ?? 0);
      const difference = roundCurrency(raw - generated);
      reconciliation.addRow({
        conta: sheet.conta,
        nivel: "Ano",
        periodo: year,
        bruto: raw,
        gerado: generated,
        diferenca: difference,
        status: Math.abs(difference) < 0.01 ? "CONFERE" : "NÃO CONFERE",
      });

      if (Math.abs(difference) < 0.01) continue;
      const generatedMonths = generatedByPeriod(sheet.result.notas, "month");
      const months = [...new Set([...meta.rawByMonth.keys(), ...generatedMonths.keys()])]
        .filter((month) => month.startsWith(`${year}-`) || year === "SEM DATA")
        .sort();

      for (const month of months) {
        const rawMonth = roundCurrency(meta.rawByMonth.get(month) ?? 0);
        const generatedMonth = roundCurrency(generatedMonths.get(month) ?? 0);
        const monthDifference = roundCurrency(rawMonth - generatedMonth);
        reconciliation.addRow({
          conta: sheet.conta,
          nivel: "Mês",
          periodo: displayPeriod(month),
          bruto: rawMonth,
          gerado: generatedMonth,
          diferenca: monthDifference,
          status: Math.abs(monthDifference) < 0.01 ? "CONFERE" : "NÃO CONFERE",
        });
      }
    }
  }

  for (const column of ["D", "E", "F"]) {
    reconciliation.getColumn(column).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  }
  reconciliation.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];

  const warningsSheet = workbook.addWorksheet("Avisos Reconciliação");
  warningsSheet.columns = [
    { header: "CONTA", key: "conta", width: 14 },
    { header: "PERÍODO", key: "periodo", width: 14 },
    { header: "LINHA ORIGINAL", key: "linha", width: 16 },
    { header: "DATA", key: "data", width: 14 },
    { header: "DESCRIÇÃO ORIGINAL", key: "descricao", width: 70 },
    { header: "VALOR", key: "valor", width: 18 },
    { header: "TIPO", key: "tipo", width: 28 },
    { header: "MOTIVO", key: "motivo", width: 80 },
  ];
  styleHeader(warningsSheet.getRow(1));

  for (const warning of allWarnings) {
    warningsSheet.addRow({
      ...warning,
      periodo: displayPeriod(warning.periodo),
      data: toDate(warning.data) ?? warning.data,
    });
  }
  warningsSheet.getColumn("D").numFmt = "dd/mm/yyyy";
  warningsSheet.getColumn("F").numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  warningsSheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];

  const output = await workbook.xlsx.writeBuffer();
  return new Blob([output as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
