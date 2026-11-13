export type FolhaGrupo = "provento" | "vantagem" | "desconto" | "outros";
export interface EventoFolha { codigo: string; descricao: string; clc: string; grupo: FolhaGrupo; valor: number; pagina: number }
export interface EmpresaFolha { codigo: string; nome: string; competencia: string; liquido: number | null; eventos: EventoFolha[]; errosLeitura: string[] }
export interface LancamentoFolha { descricao: string; valor: number; debito: string; credito: string; historico: string }
export interface ResultadoFolha { lancamentos: LancamentoFolha[]; ignorados: EventoFolha[]; pendentes: EventoFolha[]; liquidoCalculado: number; diferenca: number | null }
interface Item { str: string; x: number; y: number }
const numberBR = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/** Processa somente um formato identificado de relatório Senior, recusando dados ausentes. */
export async function lerFolha(file: File): Promise<EmpresaFolha[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const empresas = new Map<string, EmpresaFolha>();
  const totais = new Map<string, Partial<Record<"provento" | "vantagem" | "desconto", number>>>();
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const width = page.getViewport({ scale: 1 }).width;
      const items: Item[] = content.items.filter((v): v is typeof v & { str: string; transform: number[] } => "str" in v && "transform" in v && !!v.str.trim()).map(v => ({ str: v.str.trim(), x: v.transform[4] * 836 / width, y: v.transform[5] }));
      const lines: Item[][] = [];
      for (const item of items.sort((a,b) => b.y - a.y || a.x - b.x)) {
        const last = lines[lines.length-1];
        if (last && Math.abs(last[0].y-item.y) < 3) last.push(item); else lines.push([item]);
      }
      const text = (line: Item[]) => line.sort((a,b) => a.x-b.x).map(i => i.str).join(" ").replace(/\s+/g," ");
      const header = lines.map(text).find(s => /^\d{3,5}\s+.+P[aá]g\./i.test(s));
      const periodo = lines.map(text).find(s => /Per[ií]odo:/i.test(s));
      const m = header?.match(/^(\d{3,5})\s+(.+?)\s+P[aá]g\./i);
      const dt = periodo?.match(/Per[ií]odo:\s*\d{2}\/(\d{2})\/(\d{4})/i);
      if (!m || !dt) throw new Error(`Não foi possível identificar a empresa ou a competência na página ${n}.`);
      const key = m[1], comp = `${dt[2]}-${dt[1]}`;
      let empresa = empresas.get(key);
      if (!empresa) { empresa = {codigo:key,nome:m[2].trim(),competencia:comp,liquido:null,eventos:[],errosLeitura:[]}; empresas.set(key,empresa); }
      if (empresa.nome !== m[2].trim() || empresa.competencia !== comp) throw new Error(`Dados inconsistentes da empresa ${key} na página ${n}.`);
      let grupos: FolhaGrupo[] = ["outros", "outros"];
      for (const line of lines) {
        const full = text(line);
        for (const [label, grupo] of [["Proventos", "provento"], ["Vantagens", "vantagem"], ["Descontos", "desconto"]] as const) {
          const match = full.match(new RegExp(`^${label}:\\s*([\\d.]+,\\d{2})`, "i"));
          if (match) totais.set(key, { ...totais.get(key), [grupo]: numberBR(match[1]) });
        }
        const net = full.match(/\bL[ií]quido:\s*([\d.]+,\d{2})/i);
        if (net) { if (empresa.liquido !== null) throw new Error(`Líquido duplicado na empresa ${key}.`); empresa.liquido = numberBR(net[1]); }
        for (let side=0; side<2; side++) {
          const offset = side * 407;
          const part = line.filter(i => side === 0 ? i.x < 418 : i.x >= 418);
          const label = normalize(text([...part]));
          if (/^(PROVENTO|VANTAGEM|DESCONTO|OUTROS)$/.test(label)) { grupos[side] = label.toLowerCase() as FolhaGrupo; continue; }
          const first = part.filter(i => i.x>=offset+14 && i.x<offset+38).sort((a,b)=>a.x-b.x)[0];
          const valueItems = part.filter(i => i.x>=offset+220 && i.x<offset+296);
          const clcItems = part.filter(i => i.x>=offset+360 && i.x<offset+416);
          const firstMatch = first?.str.match(/^(\d+)\s*(.*)$/);
          if (!firstMatch || !valueItems.length) continue;
          const vm = text(valueItems).match(/([\d.]+,\d{2})/);
          const cm = text(clcItems).match(/(?:^|\s)(\d{4})\s*$/);
          const desc = [firstMatch[2], text(part.filter(i => i.x>=offset+38 && i.x<offset+180))].filter(Boolean).join(" ");
          if (!vm || !desc) continue;
          empresa.eventos.push({codigo:firstMatch[1],descricao:desc,clc:cm?.[1] || "",grupo:grupos[side],valor:numberBR(vm[1]),pagina:n});
        }
      }
      page.cleanup();
    }
    for (const company of empresas.values()) {
      const expected = totais.get(company.codigo);
      for (const grupo of ["provento", "vantagem", "desconto"] as const) {
        const actual = company.eventos.filter(e => e.grupo === grupo).reduce((sum, e) => sum + e.valor, 0);
        if (expected?.[grupo] === undefined || actual !== expected[grupo]) {
          company.errosLeitura.push(`Não foi possível conferir todos os eventos de ${grupo} da empresa ${company.codigo}. Verifique o formato e as páginas do PDF.`);
        }
      }
    }
    return [...empresas.values()];
  } finally { await loadingTask.destroy(); }
}

const mapping: Record<string, [string,string,string]> = {
  "1000": ["1981","1239","ORDENADOS"], "1002":["6445","1239","SALÁRIO-FAMÍLIA"],
  "1004":["6452","1239","SALÁRIO-MATERNIDADE"], "1006":["1239","12640","PLANO DE SAÚDE"],
  "1007":["1239","1981","FALTAS"], "1008":["1239","1274","INSS DOS FUNCIONÁRIOS"],
  "1009":["1239","6431","ASSOCIADOS AO SINDICATO"], "1011":["1239","1307","PENSÃO A RECOLHER"],
  "1012":["1239","6438","SEGURO DE VIDA"], "1013":["1239","2037","VALE-TRANSPORTE"],
  "1015":["1239","1981","RECEBIDOS"], "1016":["1239","1981","ALIMENTAÇÃO"],
  "1017":["1239","1162","IRRF SOBRE SALÁRIOS"],
};
export function calcularFolha(empresa: EmpresaFolha): ResultadoFolha {
  const groups = new Map<string,{valor:number; item:[string,string,string]}>(), ignorados:EventoFolha[]=[],pendentes:EventoFolha[]=[];
  for (const e of empresa.eventos) {
    const desc=normalize(e.descricao);
    if(e.grupo==="outros" || /FERIAS/.test(desc) || ["1018","1019","1020","1021","1034"].includes(e.clc)) { ignorados.push(e); continue; }
    let rule=mapping[e.clc];
    if(e.clc==="1036") rule=/GOV/.test(desc)?["1239","83620","EMPRÉSTIMO CONSIGNADO GOV"]:/SANTANDER/.test(desc)?["1239","1856","EMPRÉSTIMO CONSIGNADO SANTANDER"]:undefined;
    if(!rule || (e.grupo==="desconto") !== (rule[0]==="1239")) { pendentes.push(e); continue; }
    const id=rule.join("|"); const current=groups.get(id); groups.set(id,{valor:(current?.valor||0)+e.valor,item:rule});
  }
  const mes=empresa.competencia.slice(5);
  const lancamentos=[...groups.values()].map(({valor,item:[debito,credito,descricao]})=>({valor,debito,credito,descricao,historico:`VR. REF. ${descricao} MÊS ${mes}, CONF. FOLHA DE PAGAMENTO.`}));
  for (const code of ["1002","1004"]) {
    const item=mapping[code]; const found=groups.get(item.join("|"));
    if(found) lancamentos.push({valor:found.valor,debito:"1274",credito:item[0],descricao:`TRANSFERÊNCIA ${item[2]}`,historico:`VR. QUE SE TRANSFERE REF. ${item[2]} MÊS ${mes}, CONF. FOLHA DE PAGAMENTO.`});
  }
  const liquidoCalculado=lancamentos.reduce((sum,l)=>sum+(l.credito==="1239"?l.valor:0)-(l.debito==="1239"?l.valor:0),0);
  return {lancamentos,ignorados,pendentes,liquidoCalculado,diferenca:empresa.liquido===null?null:liquidoCalculado-empresa.liquido};
}
