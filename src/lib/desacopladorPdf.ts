export type PaginaPdf = { numero: number; cabecalho: string[]; linhas: string[] };
export type SugestaoPagina = {
  pagina: PaginaPdf;
  empresa: string | null;
  motivo: string;
  continuacao?: string;
};

export const normalizarNomePdf = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function contemNome(texto: string, nome: string): boolean {
  return (" " + normalizarNomePdf(texto) + " ").includes(" " + normalizarNomePdf(nome) + " ");
}

// Cabeçalhos explícitos de empresa, inclusive relatórios com código e página.
function titulares(linhas: string[]): string[] {
  return linhas.flatMap((linha, i) => {
    const label = linha.match(/^\s*(?:empresa|raz[aã]o\s+social|nome\s*(?:\/\s*raz[aã]o\s+social)?\s*(?:do\s+contribuinte)?|contribuinte|empregador|estabelecimento|denomina[cç][aã]o\s+social)\s*[:\-]\s*(.*)$/i);
    const senior = linha.match(/^\s*\d{3,6}\s*-?\s+(.+?)\s+P[aá]g(?:ina)?\.?\s*[:\d]/i);
    if (label) return [label[1].trim() || linhas[i + 1] || ""].filter(Boolean);
    if (senior) return [senior[1].trim()];
    return [];
  });
}

export function sugerirPaginas(paginas: PaginaPdf[], empresas: string[]): SugestaoPagina[] {
  let anterior: string | undefined;
  return paginas.map(pagina => {
    const nomes = titulares(pagina.cabecalho);
    const topo = pagina.cabecalho.join(" ");
    const texto = pagina.linhas.join(" ");
    const noTopo = empresas.filter(e => contemNome(topo, e));
    const noTexto = empresas.filter(e => contemNome(texto, e));
    if (!normalizarNomePdf(texto)) {
      anterior = undefined;
      return {pagina, empresa: null, motivo: "Sem texto legível. Confira a página visualmente."};
    }
    if (noTopo.length > 1 || noTexto.length > 1) {
      anterior = undefined;
      return {pagina, empresa: null, motivo: "Mais de uma empresa solicitada aparece na página. Não foi atribuída automaticamente."};
    }
    if (nomes.length) {
      const candidatos = empresas.filter(e => nomes.some(n => contemNome(n, e)));
      const contradicao = nomes.some(n => !candidatos.some(e => contemNome(n, e)));
      if (candidatos.length === 1 && !contradicao) {
        anterior = candidatos[0];
        return {pagina, empresa: anterior, motivo: "Nome encontrado em cabeçalho identificado."};
      }
      anterior = undefined;
      return {pagina, empresa: null, motivo: "Cabeçalho de outra empresa ou identificação incerta."};
    }
    if (noTopo.length === 1) {
      anterior = noTopo[0];
      return {pagina, empresa: anterior, motivo: "Nome encontrado na região superior. Confira o titular."};
    }
    if (noTexto.length) {
      anterior = undefined;
      return {pagina, empresa: null, motivo: "Nome encontrado apenas no corpo do documento. Confira o titular."};
    }
    // Nunca presume que toda página sem nome pertence à última empresa.
    return {pagina, empresa: null, continuacao: anterior, motivo: anterior ? "Possível continuação; confira e atribua manualmente." : "Empresa não identificada; página inicialmente excluída."};
  });
}

function cancelar(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Leitura cancelada", "AbortError");
}

export async function lerPaginasPdf(file: File, signal?: AbortSignal, progresso?: (atual: number, total: number) => void): Promise<PaginaPdf[]> {
  cancelar(signal);
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) { bytes.fill(0); cancelar(signal); }
  const task = pdfjs.getDocument({data: bytes, isEvalSupported: false});
  const abort = () => { void task.destroy().catch(() => {}); };
  signal?.addEventListener("abort", abort, {once: true});
  try {
    const pdf = await task.promise;
    const paginas: PaginaPdf[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      cancelar(signal);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({scale: 1});
      const content = await page.getTextContent();
      const itens = content.items.filter((v): v is typeof v & {str: string; transform: number[]} => "str" in v && "transform" in v && !!v.str.trim()).map(v => {
        const [x,y] = viewport.convertToViewportPoint(v.transform[4], v.transform[5]);
        return {x,y,texto: v.str.trim()};
      }).sort((a,b) => a.y - b.y || a.x - b.x);
      const grupos: typeof itens[] = [];
      for (const item of itens) {
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && Math.abs(ultimo[0].y - item.y) < 3) ultimo.push(item);
        else grupos.push([item]);
      }
      const linhas = grupos.map(g => ({y: g[0].y, texto: g.sort((a,b) => a.x - b.x).map(i => i.texto).join(" ").replace(/\s+/g, " ")}));
      // A região superior é preferida, não o corpo do documento.
      paginas.push({numero: n, cabecalho: linhas.filter(l => l.y <= viewport.height * 0.45).slice(0, 24).map(l => l.texto), linhas: linhas.map(l => l.texto)});
      page.cleanup();
      progresso?.(n, pdf.numPages);
    }
    cancelar(signal);
    return paginas;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy().catch(() => {});
    if (bytes.byteLength) bytes.fill(0);
  }
}
