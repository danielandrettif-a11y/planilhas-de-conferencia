export type Celula = string | number | Date | null | undefined;
export type Linha = Celula[];
export type LancamentoFaturamento = {data:number; valor:number; debito:number|null; credito:number|null; doc:string; historico:string};
export type ResultadoFaturamento = {pf:LancamentoFaturamento[]; pj:LancamentoFaturamento[]; divergencias:number};

const texto=(v:Celula)=>String(v??"").trim();
const normal=(v:Celula)=>texto(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const vazio=(v:Celula)=>v===undefined||v===null||texto(v)==="";
const falha=(aba:number,linha:number,motivo:string)=>new Error("Aba "+aba+", linha "+linha+": "+motivo);
function centavos(v:Celula,aba:number,linha:number):number{
  if(vazio(v))return 0;
  let num:number;
  if(typeof v==="number")num=v;
  else {
    const s=texto(v).replace(/^R\$\s*/,"").replace(/\s/g,"");
    if(!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s))throw falha(aba,linha,"valor monetário inválido.");
    num=Number(s.replace(/\./g,"").replace(",","."));
  }
  const n=Math.sign(num)*Math.round((Math.abs(num)+Number.EPSILON)*100);
  if(!Number.isSafeInteger(n))throw falha(aba,linha,"valor monetário inválido.");
  return n;
}
function dataSerial(v:Celula,aba:number,linha:number,base1904:boolean):number{
  const epoch=Date.UTC(1899,11,30);
  if(typeof v==="number"){
    const n=Math.floor(v)+(base1904?1462:0);
    if(Number.isFinite(v)&&n>=61&&n<=2958465)return n;
  }
  let y=0,m=0,d=0;
  if(v instanceof Date&&!Number.isNaN(v.getTime())){y=v.getUTCFullYear();m=v.getUTCMonth()+1;d=v.getUTCDate();}
  else{
    const s=texto(v),iso=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/),br=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(iso){y=+iso[1];m=+iso[2];d=+iso[3];}
    if(br){y=+br[3];m=+br[2];d=+br[1];}
  }
  const t=new Date(Date.UTC(y,m-1,d));
  if(y>=1900&&y<=9999&&t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d)return (t.getTime()-epoch)/86400000;
  throw falha(aba,linha,"data do lançamento inválida ou ausente.");
}
const regrasPJ=[
  {col:4,prefixo:"VALOR DO PIS A COMPENSAR – LEI 10833"},
  {col:7,prefixo:"VALOR DA CSLL A COMPENSAR – LEI 10833"},
  {col:3,prefixo:"VALOR IRRF RETIDO NA FONTE"},
  {col:5,prefixo:"VALOR DO COFINS A COMPENSAR – LEI 10833"},
  {col:6,prefixo:"VALOR I.R.R.F. RETIDO NA FONTE"},
  {col:8,prefixo:"VALOR DO I.S.S. Á RECUPERAR"},
  {col:9,prefixo:"VALOR REFERENTE TAXAS"},
  {col:10,prefixo:"VALOR RECEBIDO"},
] as const;
export function localizarCabecalhos(primeira:Linha[],segunda:Linha[]):[number,number]{
  const a=primeira.findIndex(r=>["DEB","DEBITO"].includes(normal(r[0]))&&["CRED","CREDITO"].includes(normal(r[1]))&&normal(r[2])==="VALOR"&&["DIA","DATA"].includes(normal(r[3]))&&["COMPLEMENTOHISTORICO","HISTORICO"].includes(normal(r[4])));
  const b=segunda.findIndex(r=>["CONVENIOS","CONVENIO"].includes(normal(r[0]))&&["IRF","IRRF"].includes(normal(r[3]))&&normal(r[4])==="PIS"&&normal(r[5])==="COFINS"&&normal(r[6])==="IRPJ"&&normal(r[7])==="CSLL"&&["ISSTX","ISS"].includes(normal(r[8]))&&normal(r[9])==="TAXAS"&&["LIQREC","LIQUIDORECEBIDO"].includes(normal(r[10])));
  if(a<0||b<0)throw new Error("As duas abas não correspondem ao modelo de faturamento aprovado. Confira os cabeçalhos e a ordem das colunas.");
  return [a,b];
}

export function converterFaturamento(primeira:Linha[],segunda:Linha[],base1904=false):ResultadoFaturamento{
  const [a,b]=localizarCabecalhos(primeira,segunda);
  const pf:LancamentoFaturamento[]=[],pj:LancamentoFaturamento[]=[];
  let divergencias=0;
  for(let i=a+1;i<primeira.length;i++){
    const r=primeira[i];
    if(Number(r[0])!==42||Number(r[1])!==232)continue;
    const valor=centavos(r[2],1,i+1);
    if(!valor)continue;
    const h=texto(r[4]).replace(/^VALOR RECEBIDO PESSOA F[IÍ]SICA\s+/i,"");
    const m=h.match(/^(.+?)\s+NF\s*[.:\-]?\s*(\d+)\s*\.?$/i);
    if(!m)throw falha(1,i+1,"nome ou nota fiscal da pessoa física não reconhecido.");
    const doc=m[2],nome=m[1].trim().toUpperCase();
    pf.push({data:dataSerial(r[3],1,i+1,base1904),valor:valor/100,debito:42,credito:232,doc,historico:"VALOR RECEBIDO PESSOA FISICA "+nome+" NF "+doc});
  }
  for(let i=b+1;i<segunda.length;i++){
    const r=segunda[i],nome=texto(r[0]),doc=texto(r[1]).toUpperCase();
    if(vazio(r[1])&&vazio(r[11])&&/^(VALORGERAL|TOTAL|TOTALGERAL|SUBTOTAL)$/.test(normal(r[0])))continue;
    // Linhas auxiliares fora da tabela, sem data e sem valores em D:K.
    if(!nome&&vazio(r[11])&&r.slice(3,11).every(vazio))continue;
    if(r.every(vazio))continue;
    if(!nome||!doc||vazio(r[11]))throw falha(2,i+1,"registro incompleto; confira convênio, nota fiscal e data.");
    if(!/^(?:\d+|S\/N|S\/NF|C\/NF)$/.test(doc))throw falha(2,i+1,"identificação de nota fiscal não reconhecida.");
    const data=dataSerial(r[11],2,i+1,base1904);
    const nota=/^\d+$/.test(doc)?"NF "+doc:doc;
    let soma=0;
    for(const regra of regrasPJ){
      const valor=centavos(r[regra.col],2,i+1);
      soma+=valor;if(!valor)continue;
      pj.push({data,valor:valor/100,debito:null,credito:null,doc,historico:regra.prefixo+" "+nota+" DO CONVÊNIO "+nome.toUpperCase()+" REFERENTE SERVIÇOS PRESTADOS."});
    }
    if(!vazio(r[2])&&centavos(r[2],2,i+1)!==soma)divergencias++;
  }
  if(!pf.length&&!pj.length)throw new Error("Nenhum lançamento identificado.");
  return {pf,pj,divergencias};
}
