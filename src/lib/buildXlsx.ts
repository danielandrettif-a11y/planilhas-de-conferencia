import ExcelJS from "exceljs";
import type {
  BuildXlsxOptions,
  MesConferencia,
  SheetInput,
  TransformResult,
} from "./transformSpreadsheet";

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const ACCOUNT_NAMES: Record<string, string> = {
  "81354": "Material e Medicamentos",
  "81355": "Material de Alimentação",
  "81356": "Máquinas e Equipamentos",
  "81357": "Material para Informática",
  "81358": "Materiais Diversos",
  "81360": "Material para Limpeza e Conservação",
  "81361": "Material de Expediente ou Impressos",
  "81362": "Prestadores de Serviços",
  "81363": "Móveis e Utensílios",
};

interface WorkbookOptions extends BuildXlsxOptions {
  empresa?: string;
}

let currentCompanyName = "";

export function setWorkbookCompanyName(value: string): void {
  currentCompanyName = value.trim();
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatMonthLabel(value: MesConferencia | undefined): string {
  if (!value || value.mes < 1 || value.mes > 12) return "não informado";
  return `${MONTH_NAMES[value.mes - 1]}/${value.ano}`;
}

function toJsDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400 * 1000));
  if (typeof value === "string" && value.trim()) {
    const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) {
      return new Date(
        br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]),
        Number(br[2]) - 1,
        Number(br[1]),
      );
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
}

function escapeSheetNameForLink(name: string): string {
  return name.replace(/'/g, "''");
}

function accountCode(conta: string): string {
  return String(conta).match(/\d{3,}/)?.[0] ?? String(conta).trim();
}

function accountDescription(conta: string): string {
  const code = accountCode(conta);
  return ACCOUNT_NAMES[code] ?? `Conta ${code}`;
}

function accountDisplayName(conta: string): string {
  const code = accountCode(conta);
  return `${accountDescription(conta)} - ${code}`;
}

function accountSort(a: SheetInput, b: SheetInput): number {
  const aCode = accountCode(a.conta);
  const bCode = accountCode(b.conta);
  const aNumeric = /^\d+$/.test(aCode);
  const bNumeric = /^\d+$/.test(bCode);
  if (aNumeric && bNumeric) return Number(aCode) - Number(bCode);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return aCode.localeCompare(bCode, "pt-BR", { numeric: true });
}

function accountBalance(result: TransformResult): number {
  return roundCurrency(result.notas.reduce((sum, nota) => sum + nota.faltaPagar, 0));
}

function thinBorder() {
  return {
    top: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
    left: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
    right: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  };
}

function populateAccountSheet(
  ws: ExcelJS.Worksheet,
  result: TransformResult,
  displayName: string,
): number {
  ws.columns = [
    { key: "data", width: 14 },
    { key: "fornecedor", width: 45 },
    { key: "nota", width: 15 },
    { key: "valor", width: 18 },
    { key: "falta", width: 18 },
    { key: "info", width: 60 },
    { key: "motivo", width: 65 },
  ];

  ws.mergeCells("A1:G1");
  const backCell = ws.getCell("A1");
  backCell.value = {
    text: `← Voltar para Geral  |  ${displayName}`,
    hyperlink: "#'Geral'!D1",
  };
  backCell.font = { bold: true, color: { argb: "FF1D4ED8" }, underline: true };
  backCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  backCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 24;

  const header = ws.getRow(2);
  header.values = [
    "DATA",
    "FORNECEDOR",
    "NOTA FISCAL",
    "VALOR DA NF",
    "FALTA PAGAR",
    "INFORMAÇÕES",
    "MOTIVO DA CONFERÊNCIA",
  ];
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });

  for (const nota of result.notas) {
    ws.addRow({
      data: toJsDate(nota.data) ?? nota.data ?? "",
      fornecedor: nota.fornecedor,
      nota: nota.notaFiscal,
      valor: nota.valorNF,
      falta: nota.faltaPagar,
      info: nota.informacoes,
      motivo: nota.motivosConferencia.join("\n"),
    });
  }

  const totalResult = accountBalance(result);
  const totalRowNumber = ws.rowCount + 1;
  const totalRow = ws.getRow(totalRowNumber);
  totalRow.getCell(3).value = "TOTAL";
  totalRow.getCell(5).value = {
    formula: `SUM(E3:E${totalRowNumber - 1})`,
    result: totalResult,
  };

  for (let rowNumber = 3; rowNumber <= totalRowNumber; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const isTotal = rowNumber === totalRowNumber;
    row.height = isTotal ? 24 : 32;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 2 || col === 6 || col === 7 ? "left" : "center",
        wrapText: col === 2 || col === 6 || col === 7,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: isTotal ? "FFE5E7EB" : col === 7 && cell.value ? "FFFFF4CC" : "FFF8FAFC",
        },
      };
      if (isTotal) cell.font = { bold: true };
      if (col === 1) cell.numFmt = "dd/mm/yyyy";
      if (col === 4 || col === 5) {
        cell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      }
      cell.border = thinBorder();
    });
  }

  if (totalRowNumber > 3) {
    ws.autoFilter = { from: "A2", to: `G${totalRowNumber - 1}` };
  }
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  return totalRowNumber;
}

interface GeneralEntry {
  code: string;
  description: string;
  sheetName: string;
  totalRowNumber: number;
  cachedBalance: number;
}

function populateGeneralSheet(
  ws: ExcelJS.Worksheet,
  entries: GeneralEntry[],
  opts: WorkbookOptions,
): void {
  // Colunas vazias nas laterais centralizam visualmente a tabela em D:F.
  ws.columns = [
    { width: 4 },
    { width: 4 },
    { width: 4 },
    { width: 42 },
    { width: 18 },
    { width: 24 },
    { width: 4 },
    { width: 4 },
    { width: 4 },
  ];
  ws.properties.defaultRowHeight = 22;
  ws.views = [{ state: "frozen", ySplit: 6 }];
  ws.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
  };

  ws.mergeCells("D1:F1");
  const title = ws.getCell("D1");
  title.value = "Resumo Geral dos Fornecedores";
  title.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 34;

  ws.mergeCells("D2:F2");
  const companyCell = ws.getCell("D2");
  companyCell.value = `Empresa: ${opts.empresa?.trim() || currentCompanyName || "não informada"}`;
  companyCell.font = { bold: true, color: { argb: "FF111827" } };
  companyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  companyCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells("D3:F3");
  const monthCell = ws.getCell("D3");
  monthCell.value = `Mês de conferência: ${formatMonthLabel(opts.mesConferencia)}`;
  monthCell.font = { bold: true, color: { argb: "FF374151" } };
  monthCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  monthCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells("D4:F4");
  const dateCell = ws.getCell("D4");
  dateCell.value = `Planilha gerada em: ${formatDate(opts.generatedAt ?? new Date())}`;
  dateCell.font = { italic: true, color: { argb: "FF6B7280" } };
  dateCell.alignment = { horizontal: "center", vertical: "middle" };

  const headerRow = ws.getRow(6);
  headerRow.getCell(4).value = "NOME DA CONTA";
  headerRow.getCell(5).value = "NÚMERO DA CONTA";
  headerRow.getCell(6).value = "SALDO FINAL";
  headerRow.height = 26;
  for (let col = 4; col <= 6; col++) {
    const cell = headerRow.getCell(col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder();
  }

  entries.forEach((entry, index) => {
    const rowNumber = 7 + index;
    const row = ws.getRow(rowNumber);
    const nameCell = row.getCell(4);
    nameCell.value = {
      text: entry.description,
      hyperlink: `#'${escapeSheetNameForLink(entry.sheetName)}'!A1`,
    };
    nameCell.font = { bold: true, color: { argb: "FF1D4ED8" }, underline: true };
    nameCell.alignment = { vertical: "middle", horizontal: "left" };

    const codeCell = row.getCell(5);
    codeCell.value = {
      text: entry.code,
      hyperlink: `#'${escapeSheetNameForLink(entry.sheetName)}'!A1`,
    };
    codeCell.font = { bold: true, color: { argb: "FF1D4ED8" }, underline: true };
    codeCell.alignment = { vertical: "middle", horizontal: "center" };

    const balanceCell = row.getCell(6);
    balanceCell.value = {
      formula: `'${escapeSheetNameForLink(entry.sheetName)}'!E${entry.totalRowNumber}`,
      result: entry.cachedBalance,
    };
    balanceCell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
    balanceCell.font = {
      bold: true,
      color: { argb: entry.cachedBalance < 0 ? "FFB91C1C" : "FF111827" },
    };
    balanceCell.alignment = { vertical: "middle", horizontal: "right" };

    const fillColor = index % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
    for (let col = 4; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.border = thinBorder();
    }
    row.height = 27;
  });

  const firstDataRow = 7;
  const lastDataRow = entries.length > 0 ? firstDataRow + entries.length - 1 : firstDataRow;
  const totalRowNumber = entries.length > 0 ? lastDataRow + 1 : firstDataRow;
  const totalRow = ws.getRow(totalRowNumber);
  totalRow.getCell(4).value = "TOTAL GERAL";
  ws.mergeCells(totalRowNumber, 4, totalRowNumber, 5);
  const totalResult = roundCurrency(entries.reduce((sum, entry) => sum + entry.cachedBalance, 0));
  totalRow.getCell(6).value = entries.length > 0
    ? { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: totalResult }
    : 0;
  totalRow.getCell(6).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  totalRow.height = 27;
  for (let col = 4; col <= 6; col++) {
    const cell = totalRow.getCell(col);
    cell.font = { bold: true, color: { argb: "FF111827" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEAFE" } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col === 6 ? "right" : "center",
    };
    cell.border = thinBorder();
  }

  if (entries.length > 0) {
    ws.autoFilter = { from: "D6", to: `F${lastDataRow}` };
  }
}

export async function buildXlsxFile(
  input: TransformResult | SheetInput[],
  options: WorkbookOptions,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Conversor de Planilhas";
  workbook.created = options.generatedAt ?? new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;

  const sheets = (Array.isArray(input) ? input : [{ conta: "Notas Fiscais", result: input }])
    .slice()
    .sort(accountSort);

  const usedNames = new Set<string>(["geral"]);
  const mappedSheets = sheets.map((sheet) => {
    const code = accountCode(sheet.conta);
    let name = sanitizeSheetName(code);
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = sanitizeSheetName(`${code}_${suffix++}`);
    }
    usedNames.add(name.toLowerCase());

    return {
      ...sheet,
      code,
      description: accountDescription(sheet.conta),
      displayName: accountDisplayName(sheet.conta),
      sheetName: name,
      totalRowNumber: sheet.result.notas.length + 3,
      cachedBalance: accountBalance(sheet.result),
    };
  });

  const entries: GeneralEntry[] = mappedSheets.map((sheet) => ({
    code: sheet.code,
    description: sheet.description,
    sheetName: sheet.sheetName,
    totalRowNumber: sheet.totalRowNumber,
    cachedBalance: sheet.cachedBalance,
  }));

  const generalSheet = workbook.addWorksheet("Geral");
  populateGeneralSheet(generalSheet, entries, options);

  for (const sheet of mappedSheets) {
    const worksheet = workbook.addWorksheet(sheet.sheetName);
    populateAccountSheet(worksheet, sheet.result, sheet.displayName);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
