export type Celula = string | number | Date | null | undefined;
export type Linha = Celula[];
export type LancamentoFaturamento = {data:number; valor:number; debito:number|null; credito:number|null; doc:string; historico:string};
export type ResultadoFaturamento = {pf:LancamentoFaturamento[]; pj:LancamentoFaturamento[]; divergencias:number; guiasIss:number};

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
  {chave:"pis",prefixo:"VALOR DO PIS A COMPENSAR – LEI 10833"},
  {chave:"csll",prefixo:"VALOR DA CSLL A COMPENSAR – LEI 10833"},
  {chave:"irf",prefixo:"VALOR IRRF RETIDO NA FONTE"},
  {chave:"cofins",prefixo:"VALOR DO COFINS A COMPENSAR – LEI 10833"},
  {chave:"irpj",prefixo:"VALOR I.R.R.F. RETIDO NA FONTE"},
  {chave:"iss",prefixo:"VALOR DO I.S.S. Á RECUPERAR"},
  {chave:"taxas",prefixo:"VALOR REFERENTE TAXAS"},
  {chave:"guiaIss",prefixo:"VALOR DO I.S.S. A PAGAR"},
  {chave:"liquido",prefixo:"VALOR RECEBIDO"},
] as const;
type CampoPJ = typeof regrasPJ[number]["chave"]|"nome"|"doc"|"bruto"|"data"|"lei";
const nomesPJ:Record<CampoPJ,string[]>={
  nome:["CONVENIO","CONVENIOS","RAZAOSOCIAL","EMPRESA"],doc:["NOTA","NOTAFISCAL","NF","NUMERONF","NUMERODANOTA"],
  bruto:["BRUTODANF","BRUTONF","VALORBRUTO","VALORAPRES","VALORAPRESENTADO","VALORDA NF".replace(/ /g,""),"BRUTO"],
  data:["DATA","DATAPAGAMENTO","DATADOPAGAMENTO","DATARECEBIMENTO","DIA"],
  irf:["IRF","IRRF"],pis:["PIS"],cofins:["COFINS"],irpj:["IRPJ"],csll:["CSLL"],
  iss:["ISS","ISSTX","ISSRETIDO"],taxas:["TAXAS","TAXA"],guiaIss:["GUIAISSAPAGAR","ISSAPAGAR"],
  liquido:["LIQREC","LIQUIDORECEBIDO","LIQUIDO","VALORLIQUIDO"],lei:["LEI","LEI10833","TOTALLEI10833","TOTALPCC"],
};
const nomesPF={debito:["DEB","DEBITO"],credito:["CRED","CREDITO"],valor:["VALOR"],data:["DIA","DATA"],historico:["COMPLEMENTOHISTORICO","HISTORICO"]};
type MapaPF=Record<keyof typeof nomesPF,number>;
type MapaPJ=Partial<Record<CampoPJ,number>>;
function mapear<T extends string>(linhas:Linha[], inicio:number, altura:number, aliases:Record<T,string[]>):Partial<Record<T,number>>|null{
  const mapa:Partial<Record<T,number>>={};
  const largura=Math.max(...linhas.slice(inicio,inicio+altura).map(r=>r.length));
  for(let c=0;c<largura;c++){
    const partes=linhas.slice(inicio,inicio+altura).map(r=>normal(r[c])).filter(Boolean);
    const juntas=partes.join("");
    const chaves=(Object.keys(aliases) as T[]).filter(k=>aliases[k].includes(juntas));
    const isoladas=(Object.keys(aliases) as T[]).filter(k=>partes.some(p=>aliases[k].includes(p)));
    const candidatas=chaves.length?chaves:isoladas;
    if(candidatas.length>1)return null;
    if(candidatas.length===1){const k=candidatas[0];if(mapa[k]!==undefined)return null;mapa[k]=c;}
  }
  return mapa;
}
function identificarPF(linhas:Linha[]){
  for(let i=0;i<linhas.length;i++){
    const m=mapear(linhas,i,1,nomesPF);
    if(m&&Object.keys(nomesPF).every(k=>m[k as keyof MapaPF]!==undefined))return {fim:i,mapa:m as MapaPF};
  }
  throw new Error("Aba 1: cabeçalho de lançamentos não reconhecido.");
}
function identificarPJ(linhas:Linha[]){
  for(let i=0;i<linhas.length;i++){
    for(const altura of [1,2]){
      if(i+altura>linhas.length)continue;
      const m=mapear(linhas,i,altura,nomesPJ);
      if(!m||m.nome===undefined||m.liquido===undefined||!["irf","pis","cofins","csll"].some(k=>m[k as CampoPJ]!==undefined))continue;
      // Compatibilidade com o primeiro modelo: títulos de NF, bruto e data
      // não estão preenchidos na mesma linha, mas as posições são inequívocas.
      const r=linhas[i];
      if(altura===1&&m.nome===0&&m.irf===3&&m.pis===4&&m.cofins===5&&m.irpj===6&&m.csll===7&&m.iss===8&&m.taxas===9&&m.liquido===10&&[1,2,11].every(c=>vazio(r[c]))){
        m.doc=1;m.bruto=2;m.data=11;
      }
      if(m.doc===undefined||m.bruto===undefined||m.data===undefined)continue;
      if(new Set(Object.values(m)).size!==Object.values(m).length)continue;
      return {fim:i+altura-1,mapa:m};
    }
  }
  throw new Error("Aba 2: cabeçalho de faturamento não reconhecido. Confira as colunas de convênio, NF, bruto, impostos, líquido e data.");
}
export function localizarCabecalhos(primeira:Linha[],segunda:Linha[]):[number,number]{
  return [identificarPF(primeira).fim,identificarPJ(segunda).fim];
}
export function converterFaturamento(primeira:Linha[],segunda:Linha[],base1904=false):ResultadoFaturamento{
  const a=identificarPF(primeira),b=identificarPJ(segunda);
  const pf:LancamentoFaturamento[]=[],pj:LancamentoFaturamento[]=[];
  let divergencias=0,guiasIss=0;
  for(let i=a.fim+1;i<primeira.length;i++){
    const r=primeira[i],m=a.mapa;
    if(Number(r[m.debito])!==42||Number(r[m.credito])!==232)continue;
    const valor=centavos(r[m.valor],1,i+1);
    if(!valor)continue;
    const h=texto(r[m.historico]).replace(/^VALOR RECEBIDO PESSOA F[IÍ]SICA\s+/i,"");
    const match=h.match(/^(.+?)\s+NF\s*[.:\-]?\s*(\d+)\s*\.?$/i);
    if(!match)throw falha(1,i+1,"nome ou nota fiscal da pessoa física não reconhecido.");
    const doc=match[2],nome=match[1].trim().toUpperCase();
    pf.push({data:dataSerial(r[m.data],1,i+1,base1904),valor:valor/100,debito:42,credito:232,doc,historico:"VALOR RECEBIDO PESSOA FISICA "+nome+" NF "+doc});
  }
  for(let i=b.fim+1;i<segunda.length;i++){
    const r=segunda[i],m=b.mapa;
    const cel=(k:CampoPJ):Celula=>m[k]===undefined?undefined:r[m[k]!];
    const nome=texto(cel("nome")),doc=texto(cel("doc")).toUpperCase();
    if(vazio(cel("doc"))&&vazio(cel("data"))&&/^(VALORGERAL|TOTAL|TOTALGERAL|SUBTOTAL)$/.test(normal(nome)))continue;
    const temValores=regrasPJ.some(regra=>!vazio(cel(regra.chave)));
    if(!temValores&&vazio(cel("data"))&&vazio(cel("bruto"))&&(!nome||normal(nome)==="LEI10833"))continue;
    if(!nome&&!temValores&&vazio(cel("data")))continue;
    if(r.every(vazio))continue;
    if(!nome||!doc||vazio(cel("data")))throw falha(2,i+1,"registro incompleto; confira convênio, nota fiscal e data.");
    if(!/^(?:\d+|S\/N|S\/NF|C\/NF)$/.test(doc))throw falha(2,i+1,"identificação de nota fiscal não reconhecida.");
    const data=dataSerial(cel("data"),2,i+1,base1904);
    const nota=/^\d+$/.test(doc)?"NF "+doc:doc;
    let soma=0,pcc=0;
    for(const regra of regrasPJ){
      const valor=centavos(cel(regra.chave),2,i+1);
      // Guia ISS a pagar é obrigação separada, não retenção do recebimento.
      if(regra.chave!=="guiaIss")soma+=valor;
      if(["pis","cofins","csll"].includes(regra.chave))pcc+=valor;
      if(!valor)continue;
      if(regra.chave==="guiaIss")guiasIss++;
      pj.push({data,valor:valor/100,debito:null,credito:null,doc,historico:regra.prefixo+" "+nota+" DO CONVÊNIO "+nome.toUpperCase()+" REFERENTE SERVIÇOS PRESTADOS."});
    }
    if((!vazio(cel("bruto"))&&centavos(cel("bruto"),2,i+1)!==soma)||(!vazio(cel("lei"))&&centavos(cel("lei"),2,i+1)!==pcc))divergencias++;
    // Colunas numéricas desconhecidas não são descartadas silenciosamente,
    // exceto as auxiliares após a última coluna identificada no modelo.
    const conhecidas=new Set(Object.values(m)),ultima=Math.max(...conhecidas);
    for(let c=0;c<=ultima;c++)if(!conhecidas.has(c)&&typeof r[c]==="number"&&r[c]!==0)throw falha(2,i+1,"coluna de valor não reconhecida no modelo.");
  }
  if(!pf.length&&!pj.length)throw new Error("Nenhum lançamento identificado.");
  return {pf,pj,divergencias,guiasIss};
}
