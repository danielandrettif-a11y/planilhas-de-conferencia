/** Componentes curtos e compatíveis com nomes do Windows/Excel. */
function parteZip(valor: string, max: number): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 _-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() || "Empresa";
}

export function nomePastaZip(codigo: string, empresa: string): string {
  return `${parteZip(codigo, 12)} - ${parteZip(empresa, 32)}`;
}

export function nomeZip(tipo: string, competencia: string, identificacao = "Todas"): string {
  const [ano, mes] = competencia.split("-");
  return `${parteZip(tipo, 12)} ${parteZip(identificacao, 32)} ${mes}-${ano}.zip`;
}

export function nomeInternoZip(tipo: string, finalidade: "pdf" | "importacao" | "conferencia"): string {
  if (finalidade === "pdf") return `${parteZip(tipo, 12)}.pdf`;
  return finalidade === "importacao" ? "Importacao.xlsx" : "Conferencia.xlsx";
}

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

export type ArquivoZip = { nome: string; bytes: Uint8Array };

/** Compacta apenas os arquivos já gerados, sem enviar dados pela rede. */
export async function gerarZip(arquivos: ArquivoZip[]): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const arquivo of arquivos) zip.file(arquivo.nome, arquivo.bytes);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function baixarZip(arquivos: ArquivoZip[], nome: string, valido: () => boolean): Promise<boolean> {
  const bytes = await gerarZip(arquivos);
  try {
    if (!valido()) return false;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const link = document.createElement("a"); link.href = url; link.download = nome; link.click(); URL.revokeObjectURL(url);
    return true;
  } finally { bytes.fill(0); }
}
