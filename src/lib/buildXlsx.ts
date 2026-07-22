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

const ACCOUNT_TAB_NAMES: Record<string, string> = {
  "81354": "Material e Medicamentos - 81354",
  "81355": "Material de Alimentação - 81355",
  "81356": "Máquinas e Equipamentos - 81356",
  "81357": "Mat. para Informática - 81357",
  "81358": "Materiais Diversos - 81358",
  "81360": "Limpeza e Conservação - 81360",
  "81361": "Expediente e Impressos - 81361",
  "81362": "Prestadores de Serviços - 81362",
  "81363": "Móveis e Utensílios - 81363",
};

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

function accountDisplayName(conta: string): string {
  const code = accountCode(conta);
  const description = ACCOUNT_NAMES[code];
  return description ? `${description} - ${code}` : `Conta ${code}`;
}

function accountTabName(conta: string): string {
  const code = accountCode(conta);
  return ACCOUNT_TAB_NAMES[code] ?? accountDisplayName(conta);
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
    hyperlink: "#'Geral'!A1",
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
  displayName: string;
  sheetName: string;
  totalRowNumber: number;
  cachedBalance: number;
}

function populateGeneralSheet(
  ws: ExcelJS.Worksheet,
  entries: GeneralEntry[],
  opts: BuildXlsxOptions,
): void {
  ws.columns = [
    { key: "conta", width: 52 },
    { key: "saldo", width: 24 },
  ];
  ws.properties.defaultRowHeight = 22;
  ws.views = [{ state: "frozen", ySplit: 5 }];
  ws.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  ws.mergeCells("A1:B1");
  const title = ws.getCell("A1");
  title.value = "Resumo Geral das Contas";
  title.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 34;

  ws.mergeCells("A2:B2");
  const monthCell = ws.getCell("A2");
  monthCell.value = `Mês de conferência: ${formatMonthLabel(opts.mesConferencia)}`;
  monthCell.font = { bold: true, color: { argb: "FF374151" } };
  monthCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  monthCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells("A3:B3");
  const dateCell = ws.getCell("A3");
  dateCell.value = `Planilha gerada em: ${formatDate(opts.generatedAt ?? new Date())}`;
  dateCell.font = { italic: true, color: { argb: "FF6B7280" } };
  dateCell.alignment = { horizontal: "center", vertical: "middle" };

  const headerRow = ws.getRow(5);
  headerRow.values = ["CONTA", "SALDO FINAL"];
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = thinBorder();
  });

  entries.forEach((entry, index) => {
    const rowNumber = 6 + index;
    const row = ws.getRow(rowNumber);
    const accountCell = row.getCell(1);
    accountCell.value = {
      text: entry.displayName,
      hyperlink: `#'${escapeSheetNameForLink(entry.sheetName)}'!A1`,
    };
    accountCell.font = { bold: true, color: { argb: "FF1D4ED8" }, underline: true };
    accountCell.alignment = { vertical: "middle", horizontal: "left" };

    const balanceCell = row.getCell(2);
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
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.border = thinBorder();
    });
    row.height = 27;
  });

  const firstDataRow = 6;
  const lastDataRow = entries.length > 0 ? firstDataRow + entries.length - 1 : firstDataRow;
  const totalRowNumber = entries.length > 0 ? lastDataRow + 1 : firstDataRow;
  const totalRow = ws.getRow(totalRowNumber);
  totalRow.getCell(1).value = "TOTAL GERAL";
  const totalResult = roundCurrency(entries.reduce((sum, entry) => sum + entry.cachedBalance, 0));
  totalRow.getCell(2).value = entries.length > 0
    ? { formula: `SUM(B${firstDataRow}:B${lastDataRow})`, result: totalResult }
    : 0;
  totalRow.getCell(2).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  totalRow.height = 27;
  totalRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { bold: true, color: { argb: "FF111827" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEAFE" } };
    cell.alignment = {
      vertical: "middle",
      horizontal: columnNumber === 2 ? "right" : "center",
    };
    cell.border = thinBorder();
  });

  if (entries.length > 0) {
    ws.autoFilter = { from: "A5", to: `B${lastDataRow}` };
  }
}

export async function buildXlsxFile(
  input: TransformResult | SheetInput[],
  options: BuildXlsxOptions,
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
    let name = sanitizeSheetName(accountTabName(sheet.conta));
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = sanitizeSheetName(`${accountTabName(sheet.conta)}_${suffix++}`);
    }
    usedNames.add(name.toLowerCase());

    return {
      ...sheet,
      code: accountCode(sheet.conta),
      displayName: accountDisplayName(sheet.conta),
      sheetName: name,
      totalRowNumber: sheet.result.notas.length + 3,
      cachedBalance: accountBalance(sheet.result),
    };
  });

  const entries: GeneralEntry[] = mappedSheets.map((sheet) => ({
    code: sheet.code,
    displayName: sheet.displayName,
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
