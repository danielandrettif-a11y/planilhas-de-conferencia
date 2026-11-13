export interface Autonomo { nome:string; codigo:string; bruto:number; inss:number; deducaoInss:number; irrf:number; iss:number; pensao:number; outrosProventos:number; outrosDescontos:number; liquido:number; competencia:string; pagina:number }
export interface EmpresaAutonomo { codigo:string; nome:string; pessoas:Autonomo[]; problemas:string[]; totais: Partial<Record<"bruto"|"inss"|"irrf"|"liquido",number>> }
type Parcial = Partial<Autonomo> & {pagina:number};
type Item = {str:string;x:number;y:number};
const cents=(s:string)=>Math.round(Number(s.replace(/\./g,"").replace(",","."))*100);
const valor=(line:string,label:string) => {const m=line.match(new RegExp(`${label}:\\s*([\\d.]+,\\d{2})`,"i"));return m?cents(m[1]):undefined;};
const cancel=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException("Leitura cancelada","AbortError");};

/** Lê o relatório Senior Pagamento Pessoa Física. Valores sempre em centavos. */
export async function lerAutonomos(file:File, signal?:AbortSignal):Promise<EmpresaAutonomo[]> {
  cancel(signal);
  const pdfjs=await import("pdfjs-dist"), worker=await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(signal?.aborted){bytes.fill(0);cancel(signal);}
  const task=pdfjs.getDocument({data:bytes}); const abort=()=>{void task.destroy().catch(()=>{});};
  signal?.addEventListener("abort",abort,{once:true});
  const empresas=new Map<string,EmpresaAutonomo>();
  let atual:Parcial|null=null, atualEmpresa:EmpresaAutonomo|null=null, emTotal=false;
  const fechar=()=>{
    if(!atual || !atualEmpresa) return;
    const a=atual;atual=null;
    const required:(keyof Autonomo)[]=["nome","codigo","competencia","bruto","inss","deducaoInss","irrf","iss","pensao","outrosProventos","outrosDescontos","liquido"];
    const missing=required.filter(k=>a[k]===undefined || a[k]==="");
    if(missing.length){atualEmpresa.problemas.push(`Dados incompletos no registro da página ${a.pagina}: ${missing.join(", ")}.`);return;}
    const row=a as Autonomo;
    if(row.inss!==row.deducaoInss) atualEmpresa.problemas.push(`Os dois valores de INSS divergem para o registro ${row.codigo}.`);
    if(row.bruto+row.outrosProventos-row.inss-row.irrf-row.iss-row.pensao-row.outrosDescontos!==row.liquido) atualEmpresa.problemas.push(`Os valores do registro ${row.codigo} não fecham com o líquido informado.`);
    atualEmpresa.pessoas.push(row);
  };
  try {
    const pdf=await task.promise;
    for(let n=1;n<=pdf.numPages;n++){
      cancel(signal);
      const page=await pdf.getPage(n), content=await page.getTextContent();
      const items:Item[]=content.items.filter((v):v is typeof v & {str:string;transform:number[]}=>"str" in v && "transform" in v && !!v.str.trim()).map(v=>({str:v.str.trim(),x:v.transform[4],y:v.transform[5]}));
      const groups:Item[][]=[];for(const item of items.sort((a,b)=>b.y-a.y||a.x-b.x)){const last=groups[groups.length-1];if(last && Math.abs(last[0].y-item.y)<3)last.push(item);else groups.push([item]);}
      const lines=groups.map(g=>g.sort((a,b)=>a.x-b.x).map(i=>i.str).join(" ").replace(/\s+/g," ").trim());
      if(!lines.some(s=>/Pagamento Pessoa F[ií]sica/i.test(s)))throw new Error(`A página ${n} não corresponde ao relatório de autônomos esperado.`);
      const header=lines.map(s=>s.match(/^(\d{3,5})\s*-\s*(.+?)\s+P[aá]g\./i)).find(Boolean);
      if(!header)throw new Error(`Não foi possível identificar a empresa na página ${n}.`);
      const code=header[1], name=header[2].trim();
      if(atualEmpresa && atualEmpresa.codigo!==code){fechar();emTotal=false;}
      let current=empresas.get(code);if(!current){current={codigo:code,nome:name,pessoas:[],problemas:[],totais:{}};empresas.set(code,current);}
      if(current.nome!==name) throw new Error(`Identificação inconsistente da empresa ${code}.`);
      atualEmpresa=current;
      for(const line of lines){
        if(/^Total Geral da Empresa\b/i.test(line)){fechar();emTotal=true;continue;}
        const terceiro=line.match(/^Terceiro:\s*(\d+)\s*-\s*(.+?)\s+Compet[eê]ncia:\s*(\d{2})\/(\d{4})/i);
        if(terceiro){fechar();emTotal=false;atual={codigo:terceiro[1],nome:terceiro[2].trim(),competencia:`${terceiro[4]}-${terceiro[3]}`,pagina:n};continue;}
        if(emTotal){for(const [key,pattern] of [["bruto","Rendimentos Bruto"],["inss","Contribuição INSS"],["irrf","IR Retido"],["liquido","Valor Líquido"]] as const){const n=valor(line,pattern);if(n!==undefined)current.totais[key]=n;}continue;}
        if(!atual)continue;
        for(const [key,pattern] of [["bruto","Rendimentos Bruto"],["inss","Contribuição INSS"],["deducaoInss","Dedução INSS"],["irrf","IR Retido"],["iss","Valor ISS"],["pensao","Pensão Judicial"],["outrosProventos","Outros Proventos"],["outrosDescontos","Outros Descontos"],["liquido","Valor Líquido"]] as const){const amount=valor(line,pattern);if(amount!==undefined)atual[key]=amount;}
      }
      page.cleanup();
    }
    fechar();
    for(const company of empresas.values()){
      for(const key of ["bruto","inss","irrf","liquido"] as const){const sum=company.pessoas.reduce((a,p)=>a+p[key],0);if(company.totais[key]===undefined||company.totais[key]!==sum)company.problemas.push(`A soma de ${key} não confere com o total da empresa no PDF.`);}
    }
    return [...empresas.values()];
  } finally {signal?.removeEventListener("abort",abort);await task.destroy();if(bytes.byteLength)bytes.fill(0);}
}
export interface LancamentoAutonomo {valor:number;debito:string;credito:string;historico:string}
export function lancarAutonomos(pessoas:Autonomo[], contaIrrf:string):{lancamentos:LancamentoAutonomo[];pendencias:string[]} {
  const lancamentos:LancamentoAutonomo[]=[],pendencias:string[]=[];
  for(const p of pessoas){
    if(p.outrosProventos||p.outrosDescontos||p.iss||p.pensao)pendencias.push(`Registro ${p.codigo}: há valores adicionais ou descontos sem conta definida.`);
    const base=`${p.nome} REF. ${p.competencia.slice(5)}/${p.competencia.slice(0,4)}`;
    if(p.bruto)lancamentos.push({valor:p.bruto,debito:"2083",credito:"2082",historico:`VALOR BRUTO AUTÔNOMO ${base}`});
    if(p.inss)lancamentos.push({valor:p.inss,debito:"2082",credito:"1274",historico:`INSS RETIDO AUTÔNOMO ${base}`});
    if(p.irrf){if(!/^\d+$/.test(contaIrrf))pendencias.push(`Registro ${p.codigo}: informe a conta de crédito para o IRRF.`);else lancamentos.push({valor:p.irrf,debito:"2082",credito:contaIrrf,historico:`IRRF RETIDO AUTÔNOMO ${base}`});}
  }
  return {lancamentos,pendencias};
}
