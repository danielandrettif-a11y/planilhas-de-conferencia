/** Nomes curtos para evitar caminhos longos no Windows/Excel. */
function parteZip(valor: string, max: number): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 _-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() || "Empresa";
}

const LIMITE_EMPRESA = 20;

export function abreviarEmpresaZip(empresa: string): string {
  const nome = parteZip(empresa, 1000).toUpperCase()
    .replace(/\b(?:LTDA|LIMITADA|EIRELI|EPP|ME|S A|SA)\b/g, " ")
    .replace(/\s+/g, " ").trim() || "EMPRESA";
  if (nome.length <= LIMITE_EMPRESA) return nome;
  const palavras = nome.split(" ");
  const abreviacoes: Record<string, string> = {
    SERVICOS: "SERV", MEDICOS: "MED", MEDICAS: "MED", INSTITUTO: "INST",
    HOSPITAL: "HOSP", CLINICA: "CLIN", LABORATORIO: "LAB",
    DIAGNOSTICO: "DIAG", DIAGNOSTICOS: "DIAG", COMERCIO: "COM",
    ADMINISTRACAO: "ADM", PARTICIPACOES: "PART", COMUNICACAO: "COMUN",
  };
  const reduzido = palavras.map(p => abreviacoes[p] ?? p).join(" ");
  if (reduzido.length <= LIMITE_EMPRESA) return reduzido;
  // Mantém a primeira palavra legível e usa iniciais das restantes se necessário.
  const [primeira, ...resto] = palavras;
  const base = (abreviacoes[primeira] ?? primeira).slice(0, LIMITE_EMPRESA);
  const iniciais = resto.map(p => p[0]).join("");
  const espaco = LIMITE_EMPRESA - base.length - 1;
  return espaco > 0 && iniciais ? base + " " + iniciais.slice(0, espaco) : base;
}

/** Nomes únicos mesmo quando duas razões sociais têm a mesma abreviação. */
export function aliasesEmpresasZip(empresas: string[]): string[] {
  const usados = new Set<string>();
  return empresas.map(empresa => {
    const base = abreviarEmpresaZip(empresa);
    let alias = base, n = 2;
    while (usados.has(alias)) {
      const sufixo = " " + n++;
      alias = base.slice(0, LIMITE_EMPRESA - sufixo.length).trim() + sufixo;
    }
    usados.add(alias);
    return alias;
  });
}

function mesAnoZip(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return /^\d{4}$/.test(ano) && /^(0[1-9]|1[0-2])$/.test(mes) ? mes + "-" + ano : "Sem-mes";
}

export function nomePastaZip(alias: string, competencia: string): string {
  return parteZip(alias, LIMITE_EMPRESA) + " " + mesAnoZip(competencia);
}

export function nomeZip(tipo: string, competencia: string, identificacao = "Todas"): string {
  return parteZip(tipo, 12) + " " + (identificacao === "Todas" ? "Todas" : abreviarEmpresaZip(identificacao)) + " " + mesAnoZip(competencia) + ".zip";
}

export function nomeInternoZip(tipo: string, finalidade: "pdf" | "importacao" | "conferencia", alias: string, competencia: string): string {
  const titulo = finalidade === "pdf" ? parteZip(tipo, 12) : finalidade === "importacao" ? "Importacao" : "Conferencia";
  return titulo + " " + nomePastaZip(alias, competencia) + (finalidade === "pdf" ? ".pdf" : ".xlsx");
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
