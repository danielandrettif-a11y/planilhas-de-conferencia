export type PaginaPdf = { numero: number; cabecalho: string[]; linhas: string[] };
export type SugestaoPagina = {
  pagina: PaginaPdf;
  empresa: string | null;
  motivo: string;
  continuacao?: string;
  paginaImpressa?: number;
  inferida?: boolean;
  revisar?: boolean;
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

/** Numeração impressa no cabeçalho, independente da posição física no PDF. */
export function numeroImpresso(pagina: PaginaPdf): number | undefined {
  const numeros = [...new Set(pagina.cabecalho.flatMap(linha =>
    [...linha.matchAll(/\bP[aá]g(?:ina)?\.?\s*[:.]?\s*(\d{1,7})\b/gi)].map(m => Number(m[1]))
  ))];
  return numeros.length === 1 ? numeros[0] : undefined;
}

export function sugerirPaginas(paginas: PaginaPdf[], empresas: string[]): SugestaoPagina[] {
  let anterior: string | undefined;
  const resultado: SugestaoPagina[] = [];
  for (const pagina of paginas) {
    const paginaImpressa = numeroImpresso(pagina);
    const nomes = titulares(pagina.cabecalho);
    const topo = pagina.cabecalho.join(" ");
    const texto = pagina.linhas.join(" ");
    const noTopo = empresas.filter(e => contemNome(topo, e));
    const noTexto = empresas.filter(e => contemNome(texto, e));
    const anteriorFisica = resultado[resultado.length - 1];
    const consecutiva = anteriorFisica && pagina.numero === anteriorFisica.pagina.numero + 1;
    if (!consecutiva) anterior = undefined;
    let sugestao: SugestaoPagina = {pagina, paginaImpressa, empresa: null, motivo: ""};
    if (noTopo.length > 1 || noTexto.length > 1) {
      anterior = undefined;
      sugestao.motivo = "Mais de uma empresa solicitada aparece na página. Revise manualmente.";
      sugestao.revisar = true;
    } else if (nomes.length) {
      const candidatos = empresas.filter(e => nomes.some(n => contemNome(n, e)));
      const contradicao = nomes.some(n => !candidatos.some(e => contemNome(n, e)));
      if (candidatos.length === 1 && !contradicao) {
        anterior = candidatos[0];
        sugestao.empresa = anterior;
        sugestao.motivo = "Nome encontrado em cabeçalho identificado.";
      } else {
        anterior = undefined;
        sugestao.motivo = "Cabeçalho de outra empresa ou identificação incerta.";
        if (candidatos.length || noTexto.length) sugestao.revisar = true;
      }
    } else if (noTopo.length === 1) {
      anterior = noTopo[0];
      sugestao.empresa = anterior;
      sugestao.motivo = "Nome encontrado na região superior. Confira o titular.";
    } else if (noTexto.length && noTexto[0] !== anterior) {
      anterior = undefined;
      sugestao.motivo = "Nome encontrado apenas no corpo do documento. Confira o titular.";
      sugestao.revisar = true;
    } else if (anterior) {
      sugestao.continuacao = anterior;
      const anteriorImpresso = anteriorFisica?.paginaImpressa;
      if (paginaImpressa !== undefined && anteriorImpresso !== undefined && paginaImpressa === anteriorImpresso + 1 && anteriorFisica?.empresa === anterior) {
        sugestao.empresa = anterior;
        sugestao.inferida = true;
        sugestao.motivo = "Continuação pela numeração impressa consecutiva. Confira o titular.";
      } else {
        sugestao.revisar = true;
        sugestao.motivo = "Possível continuação da empresa anterior. Revise para não pular páginas.";
        // Reinício ou salto na numeração: não propagar a titularidade automaticamente.
        if (paginaImpressa !== undefined && anteriorImpresso !== undefined && paginaImpressa !== anteriorImpresso + 1) {
          anterior = undefined;
          sugestao.continuacao = undefined;
          sugestao.motivo = "Numeração impressa reiniciada ou descontínua. Revise o titular.";
        }
      }
    } else {
      sugestao.motivo = normalizarNomePdf(texto) ? "Empresa não identificada; página inicialmente excluída." : "Sem texto legível. Confira a página visualmente.";
    }
    resultado.push(sugestao);
  }
  // Preenche lacunas entre páginas da mesma empresa, sem atravessar
  // cabeçalhos de outras empresas, conflitos ou reinícios de numeração.
  for (let i = 0; i < resultado.length; i++) {
    const primeira = resultado[i];
    if (!primeira.empresa) continue;
    let j = i + 1;
    while (j < resultado.length && !resultado[j].empresa && resultado[j].continuacao === primeira.empresa &&
      resultado[j].pagina.numero === resultado[j-1].pagina.numero + 1) j++;
    if (j === i + 1 || j >= resultado.length || resultado[j].empresa !== primeira.empresa ||
        resultado[j].pagina.numero !== resultado[j-1].pagina.numero + 1) continue;
    const trecho = resultado.slice(i, j + 1);
    const numeradas = trecho.filter(p => p.paginaImpressa !== undefined);
    if (numeradas.some((p, k) => k > 0 && p.paginaImpressa! - numeradas[k-1].paginaImpressa! !== p.pagina.numero - numeradas[k-1].pagina.numero)) continue;
    for (let k = i + 1; k < j; k++) {
      resultado[k].empresa = primeira.empresa;
      resultado[k].inferida = true;
      resultado[k].revisar = false;
      resultado[k].motivo = "Página intermediária entre duas páginas da mesma empresa. Confira o titular.";
    }
    i = j - 1;
  }
  return resultado;
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
