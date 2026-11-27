import type {Celula,Linha} from "./faturamento";
export type Banco="bradesco"|"sicoob"|"brasil";
export const bancos:Record<Banco,string>={bradesco:"Bradesco",sicoob:"Sicoob",brasil:"Banco do Brasil"};
export type Recebimento={aba:number;linha:number;titulo:string;nome:string;data:number;banco:Banco;original:number;liquido:number;baixado:number;juros:number;desconto:number;tipo:string;observacao:string;avisos:string[]};
export type ResultadoRecebimentos={registros:Recebimento[];avisos:string[];competencia:string;subtotais:number};
export type Lancamento={data:number;valor:number;debito:null;credito:null;doc:string;historico:string;tipo:"recebimento"|"juros"|"desconto";origem:Recebimento};
const txt=(v:Celula)=>String(v??"").trim();
const norm=(v:Celula)=>txt(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const falha=(aba:number,linha:number,msg:string)=>new Error("Aba "+aba+", linha "+linha+": "+msg);
function banco(v:Celula):Banco|undefined{
 const n=norm(v);
 if(n.includes("BRADESCO"))return "bradesco";
 if(n.includes("SICOOB")||n.includes("BANCOOB")||n.includes("BANCOCOOPERATIVODOBRASIL"))return "sicoob";
 if(n==="BB"||n.startsWith("BANCODOBRASIL"))return "brasil";
}
const aliases={titulo:["NRTITULO","NUMEROTITULO","TITULO"],nome:["NOMEDAPESSOA","CLIENTE","NOMECLIENTE"],data:["DTBAIXA","DATABAIXA"],original:["VLORIGINAL","VALORORIGINAL"],liquido:["VLLIQUIDODOITEM","VALORLIQUIDODOITEM","VLLIQUIDO"],baixado:["VLBAIXADO","VALORBAIXADO"],juros:["VLJUROS","VALORJUROS"],desconto:["VLDESCONTO","VALORDESCONTO"],banco:["BANCODABAIXA","BANCO"],tipo:["TIPODEBAIXA"],observacao:["OBSERVACAODOTITULO","OBSERVACAO"]} as const;
type Campo=keyof typeof aliases;
type Mapa=Record<Campo,number>;
function cabecalho(r:Linha):Mapa|null{
 const m={} as Mapa;
 for(const k of Object.keys(aliases) as Campo[]){
  const indices=r.flatMap((v,i)=>(aliases[k] as readonly string[]).includes(norm(v))?[i]:[]);
  if(indices.length!==1)return null;
  m[k]=indices[0];
 }
 return m;
}
function cents(v:Celula,aba:number,linha:number,opcional=false):number{
 if(!txt(v)){if(opcional)return 0;throw falha(aba,linha,"valor obrigatório ausente.");}
 let n:number;
 if(typeof v==="number")n=v;
 else{
  const t=txt(v).replace(/^R\$\s*/,"").replace(/\s/g,"");
  if(!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(t))throw falha(aba,linha,"valor monetário inválido.");
  n=Number(t.replace(/\./g,"").replace(",","."));
 }
 const c=Math.sign(n)*Math.round((Math.abs(n)+Number.EPSILON)*100);
 if(!Number.isSafeInteger(c))throw falha(aba,linha,"valor monetário inválido.");
 return c;
}
const epoch=Date.UTC(1899,11,30);
function serial(v:Celula,aba:number,linha:number,base1904:boolean):number{
 if(typeof v==="number"&&Number.isFinite(v)&&Math.floor(v)+(base1904?1462:0)>=61&&Math.floor(v)+(base1904?1462:0)<=2958465)return Math.floor(v)+(base1904?1462:0);
 let y=0,m=0,d=0;
 if(v instanceof Date){y=v.getUTCFullYear();m=v.getUTCMonth()+1;d=v.getUTCDate();}
 else{const t=txt(v),br=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/),iso=t.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);if(br){d=+br[1];m=+br[2];y=+br[3];}if(iso){y=+iso[1];m=+iso[2];d=+iso[3];}}
 const date=new Date(Date.UTC(y,m-1,d));
 if(y>=1900&&y<=9999&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d)return (date.getTime()-epoch)/86400000;
 throw falha(aba,linha,"data de baixa inválida.");
}
export const mesData=(n:number)=>new Date(epoch+n*86400000).toISOString().slice(0,7);
const valores=["original","liquido","baixado","juros","desconto"] as const;
type Valores=Record<typeof valores[number],number>;
const zerados=():Valores=>({original:0,liquido:0,baixado:0,juros:0,desconto:0});
function somar(dest:Valores,orig:Valores){for(const k of valores)dest[k]+=orig[k];}
export function analisarRecebimentos(abas:Linha[][],base1904=false):ResultadoRecebimentos{
 const registros:Recebimento[]=[],avisos:string[]=[];
 let subtotais=0;
 for(let a=0;a<abas.length;a++){
  const linhas=abas[a],aba=a+1;
  if(linhas.every(r=>r.every(v=>!txt(v))))continue;
  let mapa:Mapa|null=null,grupo:Banco|undefined,secao=zerados(),geral=zerados(),quantidade=0;
  for(let i=0;i<linhas.length;i++){
   const r=linhas[i],linha=i+1;
   const preenchidos=r.filter(v=>!!txt(v));
   if(!preenchidos.length)continue;
   const h=cabecalho(r);if(h){mapa=h;continue;}
   if(preenchidos.length===1&&banco(preenchidos[0])){
    if(quantidade)avisos.push("Aba "+aba+", linha "+linha+": grupo anterior sem subtotal conferido.");
    grupo=banco(preenchidos[0]);secao=zerados();quantidade=0;continue;
   }
   if(!mapa)throw falha(aba,linha,"cabeçalho de recebimentos não reconhecido.");
   const m=mapa,cel=(k:Campo)=>r[m[k]];
   const titulo=txt(cel("titulo")),nome=txt(cel("nome"));
   if(!nome&&!txt(cel("data"))&&(!titulo||/^(TOTAL|SUBTOTAL|TOTALGERAL)$/.test(norm(titulo)))){
    const colunas=new Set(valores.map(k=>m[k]));
    if(!valores.some(k=>txt(cel(k)))||Array.from(r.entries()).some(([c,v])=>txt(v)&&c!==m.titulo&&!colunas.has(c)))throw falha(aba,linha,"linha auxiliar não reconhecida.");
    const alvo=quantidade?secao:geral;
    for(const k of valores)if(cents(cel(k),aba,linha,true)!==alvo[k])throw falha(aba,linha,"subtotal ou total geral divergente.");
    subtotais++;if(quantidade){secao=zerados();quantidade=0;}continue;
   }
   if(!titulo||!nome)throw falha(aba,linha,"título ou nome da pessoa ausente.");
   const explicito=txt(cel("banco")),identificado=banco(cel("banco"));
   if(explicito&&!identificado)throw falha(aba,linha,"banco não mapeado. Revise o relatório antes de gerar.");
   const b=identificado??grupo;if(!b)throw falha(aba,linha,"banco ausente e sem grupo identificável.");
   const v:Valores={original:cents(cel("original"),aba,linha),liquido:cents(cel("liquido"),aba,linha),baixado:cents(cel("baixado"),aba,linha),juros:cents(cel("juros"),aba,linha,true),desconto:cents(cel("desconto"),aba,linha,true)};
   const data=serial(cel("data"),aba,linha,base1904),tipo=txt(cel("tipo")),observacao=txt(cel("observacao")),alertas:string[]=[];
   if(!identificado)alertas.push("Banco sugerido pelo grupo; confirme.");
   if(grupo&&identificado&&grupo!==identificado)alertas.push("Banco da linha diferente do grupo; confirme.");
   if(v.liquido+v.juros-v.desconto!==v.baixado)alertas.push("Divergência: líquido + juros - desconto não corresponde à baixa.");
   if(v.baixado<v.juros||valores.some(k=>v[k]<0))alertas.push("Valor negativo ou juros superiores à baixa; tratamento manual necessário.");
   if(!tipo||!norm(tipo).includes("PAGAMENTOTOTAL"))alertas.push("Tipo de baixa ausente ou diferente de pagamento total.");
   if(observacao)alertas.push("Observação do título: revisar manualmente.");
   registros.push({aba,linha,titulo,nome,data,banco:b,...v,tipo,observacao,avisos:alertas});
   somar(secao,v);somar(geral,v);quantidade++;
  }
  if(!mapa)throw new Error("Aba "+aba+": cabeçalho de recebimentos não encontrado.");
  if(quantidade)avisos.push("Aba "+aba+": último grupo sem subtotal conferido.");
 }
 if(!registros.length)throw new Error("Nenhum recebimento identificado.");
 const meses=new Map<string,number>();for(const r of registros){const m=mesData(r.data);meses.set(m,(meses.get(m)??0)+1);}
 const competencia=[...meses].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0][0];
 const titulos=new Map<string,number>();for(const r of registros)titulos.set(r.titulo,(titulos.get(r.titulo)??0)+1);
 for(const r of registros)if((titulos.get(r.titulo)??0)>1)r.avisos.push("Título completo repetido; conferir sem excluir automaticamente.");
 return {registros,avisos,competencia,subtotais};
}
export function competenciaValida(competencia:string):boolean{
 return /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)&&Number(competencia.slice(0,4))>=1901;
}
export function dataImportacao(data:number,competencia:string):number{
 if(!competenciaValida(competencia))throw new Error("Informe uma competência válida.");
 const [ano,mes]=competencia.split("-").map(Number);
 const primeiro=(Date.UTC(ano,mes-1,1)-epoch)/86400000;
 return data===primeiro-1?primeiro:data;
}
export function alertasRecebimento(r:Recebimento,competencia:string):string[]{
 if(!competenciaValida(competencia))return [...r.avisos];
 const destino=dataImportacao(r.data,competencia);
 return [...r.avisos,...(destino!==r.data?["Data ajustada para o primeiro dia da competência (último dia do mês anterior)."]:mesData(r.data)!==competencia?["Data de baixa fora da competência selecionada."]:[])];
}
export function bloqueado(r:Recebimento):boolean{return r.liquido+r.juros-r.desconto!==r.baixado||r.baixado<r.juros||valores.some(k=>r[k]<0);}
export function gerarLancamentosRecebimentos(registros:Recebimento[],competencia:string):Lancamento[]{
 if(!competenciaValida(competencia))throw new Error("Informe uma competência válida.");
 if(registros.some(bloqueado))throw new Error("Existem divergências de valores que precisam ser corrigidas no arquivo original.");
 const out:Lancamento[]=[];
 for(const r of registros){
  const ref=r.nome.toUpperCase()+" NF "+r.titulo,base={data:dataImportacao(r.data,competencia),doc:r.titulo,origem:r};
  const add=(valor:number,historico:string,tipo:Lancamento["tipo"])=>{if(valor)out.push({...base,valor:valor/100,debito:null,credito:null,historico,tipo});};
  add(r.baixado-r.juros,"VALOR RECEBIDO DE "+ref,"recebimento");
  add(r.juros,"VALOR RECEBIDO DE JUROS S/ "+ref,"juros");
  add(r.desconto,"VALOR REFERENTE DESCONTO CONCEDIDO S/ "+ref,"desconto");
 }
 return out;
}
