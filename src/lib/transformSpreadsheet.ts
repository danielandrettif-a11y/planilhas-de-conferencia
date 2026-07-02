import * as XLSX from "xlsx";

export type SheetRow = Record<string, unknown>;

export interface MappingRules {
  // Placeholder: será preenchido quando os modelos de planilha
  // (original Alterdata + saída desejada) forem fornecidos.
  columnMap?: Record<string, string>;
  dateColumns?: string[];
  currencyColumns?: string[];
}

export interface TransformResult {
  rows: SheetRow[];
  headers: string[];
}

/**
 * Ponto de extensão futuro. Por enquanto apenas repassa os dados,
 * mantendo cabeçalhos e valores originais. Quando as regras de
 * conversão forem definidas, implementar aqui a lógica real.
 */
export function transformSpreadsheet(
  inputData: SheetRow[],
  _mappingRules?: MappingRules,
): TransformResult {
  const headers =
    inputData.length > 0 ? Object.keys(inputData[0]) : [];
  return { rows: inputData, headers };
}

/**
 * Gera um workbook .xlsx com formatação básica organizada:
 * cabeçalhos em destaque, larguras automáticas, congelamento
 * da primeira linha. Bordas/alinhamento são aplicados pelo
 * Excel via estilos padrão do SheetJS community (limitado).
 */
export function buildFormattedWorkbook(
  result: TransformResult,
): XLSX.WorkBook {
  const { rows, headers } = result;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Larguras automáticas aproximadas
  const colWidths = headers.map((h) => {
    const maxLen = rows.reduce((acc, r) => {
      const v = r[h];
      const s = v == null ? "" : String(v);
      return Math.max(acc, s.length);
    }, h.length);
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
  });
  ws["!cols"] = colWidths;

  // Congelar primeira linha
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];

  XLSX.utils.book_append_sheet(wb, ws, "Planilha");
  return wb;
}