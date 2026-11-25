/** Nomes seguros para os arquivos baixados, mantendo a identificação legível. */
export function nomeArquivo(tipo: string, empresa: string, competencia: string, extensao: string, finalidade?: string): string {
  const nome = empresa.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "Empresa";
  const [ano, mes] = competencia.split("-");
  return `${tipo} ${nome} ${mes}-${ano}${finalidade ? ` - ${finalidade}` : ""}.${extensao}`;
}

export async function separarPdf(file: File, paginas: number[]): Promise<Uint8Array> {
  const indices = [...new Set(paginas)].sort((a, b) => a - b);
  if (!indices.length || indices.some(n => !Number.isInteger(n) || n < 1)) throw new Error("Não foi possível identificar as páginas da empresa no PDF.");
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const original = await PDFDocument.load(bytes);
    if (indices.some(n => n > original.getPageCount())) throw new Error("Página da empresa inválida no PDF.");
    const separado = await PDFDocument.create();
    for (const pagina of await separado.copyPages(original, indices.map(n => n - 1))) separado.addPage(pagina);
    return await separado.save();
  } finally { bytes.fill(0); }
}

export async function baixarPdf(file: File, paginas: number[], nome: string, valido: () => boolean): Promise<boolean> {
  const bytes = await separarPdf(file, paginas);
  try {
    if (!valido()) return false;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const link = document.createElement("a"); link.href = url; link.download = nome; link.click(); URL.revokeObjectURL(url);
    return true;
  } finally { bytes.fill(0); }
}
