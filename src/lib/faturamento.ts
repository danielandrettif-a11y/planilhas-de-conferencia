export type Celula = string | number | Date | null | undefined;
export type Linha = Celula[];
export type LancamentoFaturamento = {data:number; valor:number; debito:number|null; credito:number|null; doc:string; historico:string; avisoData?:string; avisoRevisao?:string; cliente?:string; natureza?:string};
export type ResultadoFaturamento = {pf:LancamentoFaturamento[]; pj:LancamentoFaturamento[]; divergencias:number; datasAtipicas:string[]; abasPJ:number; duplicadosPrimeira:number; adicionaisPrimeira:number};

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
  {chave:"juros",prefixo:"VALOR RECEBIDO DE JUROS"},
  {chave:"liquido",prefixo:"VALOR RECEBIDO"},
] as const;
type CampoPJ = typeof regrasPJ[number]["chave"]|"nome"|"doc"|"bruto"|"data"|"lei"|"guiaIss";
// LEI e GUIA ISS A PAGAR são reconhecidas no layout, mas não geram lançamentos.
const nomesPJ:Record<CampoPJ,string[]>={
  nome:["CONVENIO","CONVENIOS","RAZAOSOCIAL","EMPRESA"],doc:["NOTA","FISCAL","NOTAFISCAL","NF","NUMERONF","NUMERODANOTA"],
  bruto:["BRUTODANF","BRUTONF","VALORBRUTO","VRBRUTO","VALORAPRES","VALORAPRESENTADO","VALORDA NF".replace(/ /g,""),"BRUTO"],
  data:["DATA","DATAPAGAMENTO","DATADOPAGAMENTO","DATARECEBIMENTO","PAGAMENTO","DIA"],
  irf:["IRF","IRRF"],pis:["PIS"],cofins:["COFINS"],irpj:["IRPJ"],csll:["CSLL"],
  iss:["ISS","ISSTX","ISSRETIDO"],taxas:["TAXAS","TAXA"],juros:["JUROS","VALORJUROS","JUROSRECEBIDOS"],guiaIss:["GUIAISSAPAGAR","ISSAPAGAR"],
  liquido:["LIQREC","LIQUIDORECEBIDO","LIQUIDO","VALORLIQUIDO"],lei:["LEI","LEI10833","TOTALLEI10833","TOTALPCC"],
};
const nomesPF={debito:["DEB","DEBITO"],credito:["CRED","CREDITO"],valor:["VALOR"],data:["DIA","DATA"],historico:["COMPLEMENTOHISTORICO","HISTORICO","CONVENIO","CONVENIOS"]};
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
function identificarPJ(linhas:Linha[],aba=2,inicio=0,apenasInicio=false){
  for(let i=inicio;i<linhas.length&&(!apenasInicio||i===inicio);i++){
    for(const altura of [1,2]){
      if(i+altura>linhas.length)continue;
      // Uma linha de dados não pode ser confundida com o início de cabeçalho.
      if(altura===2&&(linhas[i].filter(v=>typeof v==="number"||v instanceof Date).length>1||linhas[i+1].filter(v=>typeof v==="number"||v instanceof Date).length>1))continue;
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
      return {inicio:i,fim:i+altura-1,mapa:m};
    }
  }
  if(apenasInicio)return null;
  throw new Error("Aba "+aba+": cabeçalho de faturamento não reconhecido. Confira as colunas de convênio, NF, bruto, impostos, líquido e data.");
}
export function localizarCabecalhos(primeira:Linha[],segunda:Linha[]):[number,number]{
  return [identificarPF(primeira).fim,identificarPJ(segunda)!.fim];
}
export function converterFaturamento(primeira:Linha[],segunda:Linha[],base1904=false):ResultadoFaturamento{
  return converterAbasFaturamento([primeira,segunda],base1904);
}

/** Primeira aba: PF; demais abas preenchidas: tabelas de NF/PJ identificadas. */
export function converterAbasFaturamento(abas:Linha[][],base1904=false):ResultadoFaturamento{
  if(abas.length<2)throw new Error("Envie o modelo com pelo menos duas abas.");
  const primeira=abas[0],a=identificarPF(primeira);
  const pf:LancamentoFaturamento[]=[],pj:LancamentoFaturamento[]=[];
  let divergencias=0,abasPJ=0,duplicadosPrimeira=0,adicionaisPrimeira=0;
  const pendentes:{data:number;valor:number;doc:string;nome:string;historico:string;linha:number}[]=[];
  const candidatos:{data:number;valor:number;doc:string;nome:string;chave:string;usado:boolean}[]=[];
  const nomeComparavel=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/[^A-Z0-9]+/).filter(t=>t&&!['DE','DA','DO','DAS','DOS'].includes(t)).join('');
  const docComparavel=(v:string)=>v.replace(/^0+(?=\d)/,'');
  const datasAtipicas:string[]=[];
  const conferirData=(data:number,aba:number,linha:number)=>{if(data<36526)datasAtipicas.push("Aba "+aba+", linha "+linha);return data;};
  for(let i=a.fim+1;i<primeira.length;i++){
    const r=primeira[i],m=a.mapa;
    const debito=Number(r[m.debito]),credito=Number(r[m.credito]);
    if(debito!==42||![232,1715].includes(credito))continue;
    const valor=centavos(r[m.valor],1,i+1);
    if(!valor)continue;
    const h=texto(r[m.historico]).replace(/^VALOR RECEBIDO PESSOA F[IÍ]SICA\s+/i,"");
    const match=h.match(/^(.+?)\s+N\s*\.?\s*F\s*[.:\-]?\s*(\d+)\s*\.?$/i);
    if(credito===1715){
      if(!h)throw falha(1,i+1,"histórico ausente no lançamento a conferir.");
      pendentes.push({data:dataSerial(r[m.data],1,i+1,base1904),valor,doc:match?.[2]??"",nome:match?.[1]??h,historico:texto(r[m.historico]),linha:i+1});
      continue;
    }
    if(!match)throw falha(1,i+1,"nome ou nota fiscal da pessoa física não reconhecido.");
    const doc=match[2],nome=match[1].trim().toUpperCase();
    const data=conferirData(dataSerial(r[m.data],1,i+1,base1904),1,i+1);
    pf.push({data,valor:valor/100,debito:42,credito:232,doc,historico:"VALOR RECEBIDO PESSOA FISICA "+nome+" NF "+doc,...(data<36526?{avisoData:"Data atípica — confira aba 1, linha "+(i+1)+" do arquivo original."}:{})});
  }
  for(let indice=1;indice<abas.length;indice++){
    const segunda=abas[indice],aba=indice+1;
    if(segunda.every(r=>r.every(vazio)))continue;
    let b=identificarPJ(segunda,aba)!;
    abasPJ++;
    for(let i=b.fim+1;i<segunda.length;i++){
    const r=segunda[i];
    const repetido=identificarPJ(segunda,aba,i,true);
    if(repetido){b=repetido;i=b.fim;continue;}
    const m=b.mapa;
    const cel=(k:CampoPJ):Celula=>m[k]===undefined?undefined:r[m[k]!];
    const nome=texto(cel("nome")),doc=texto(cel("doc")).toUpperCase();
    if(vazio(cel("doc"))&&vazio(cel("data"))&&/^(VALORGERAL|TOTAL|TOTALGERAL|SUBTOTAL)$/.test(normal(nome)))continue;
    const temValores=regrasPJ.some(regra=>!vazio(cel(regra.chave)));
    // Títulos de seção sem valores, NF ou data não são lançamentos.
    if(!temValores&&vazio(cel("data"))&&vazio(cel("bruto"))&&(vazio(cel("doc"))||["NOTA","FISCAL","NOTAFISCAL"].includes(normal(cel("doc")))))continue;
    if(!temValores&&vazio(cel("data"))&&vazio(cel("bruto"))&&(!nome||normal(nome)==="LEI10833"))continue;
    if(!nome&&!temValores&&vazio(cel("data")))continue;
    if(r.every(vazio))continue;
    if(!nome||!doc||vazio(cel("data")))throw falha(aba,i+1,"registro incompleto; confira convênio, nota fiscal e data.");
    if(!/^(?:\d+|S\/N|S\/NF|C\/NF)$/.test(doc))throw falha(aba,i+1,"identificação de nota fiscal não reconhecida.");
    const data=conferirData(dataSerial(cel("data"),aba,i+1,base1904),aba,i+1);
    const nota=/^\d+$/.test(doc)?"NF "+doc:doc;
    let soma=0,pcc=0;
    for(const regra of regrasPJ){
      const valor=centavos(cel(regra.chave),aba,i+1);
      // Juros recebidos acrescem o líquido, em vez de reduzi-lo.
      soma+=regra.chave==="juros"?-valor:valor;
      if(["pis","cofins","csll"].includes(regra.chave))pcc+=valor;
      if(!valor)continue;
      if(regra.chave==="juros"||regra.chave==="liquido")candidatos.push({data,valor,doc,nome,chave:regra.chave,usado:false});
      pj.push({data,valor:valor/100,debito:null,credito:null,doc,cliente:nome,natureza:regra.chave,historico:regra.prefixo+" "+nota+" DO CONVÊNIO "+nome.toUpperCase()+" REFERENTE SERVIÇOS PRESTADOS.",...(data<36526?{avisoData:"Data atípica — confira aba "+aba+", linha "+(i+1)+" do arquivo original."}:{})});
    }
    if((!vazio(cel("bruto"))&&centavos(cel("bruto"),aba,i+1)!==soma)||(!vazio(cel("lei"))&&centavos(cel("lei"),aba,i+1)!==pcc))divergencias++;
    // Colunas numéricas desconhecidas não são descartadas silenciosamente,
    // exceto as auxiliares após a última coluna identificada no modelo.
    const conhecidas=new Set(Object.values(m)),ultima=Math.max(...conhecidas);
    for(let c=0;c<=ultima;c++)if(!conhecidas.has(c)&&typeof r[c]==="number"&&r[c]!==0)throw falha(aba,i+1,"coluna de valor não reconhecida no modelo.");
  }
  }
  if(!abasPJ)throw new Error("Nenhuma aba de faturamento PJ identificada.");
  // Com NF: coincidência de nota, data e valor; sem NF: somente nome normalizado, data e valor de recebimento sem NF.
  // Consome cada correspondência uma única vez. Ambiguidades são mantidas para revisão, nunca descartadas.
  for(const p of pendentes){
    const encontrados=candidatos.filter(c=>!c.usado&&c.data===p.data&&c.valor===p.valor&&(p.doc?(/^\d+$/.test(c.doc)&&docComparavel(c.doc)===docComparavel(p.doc)):(c.chave==="liquido"&&/^(S\/N|S\/NF|C\/NF)$/.test(c.doc)&&nomeComparavel(c.nome)===nomeComparavel(p.nome))));
    if(encontrados.length===1){encontrados[0].usado=true;duplicadosPrimeira++;continue;}
    adicionaisPrimeira++;
    const data=conferirData(p.data,1,p.linha);
    pj.push({data,valor:p.valor/100,debito:null,credito:null,doc:p.doc,historico:p.historico,avisoRevisao:"Aba 1, linha "+p.linha+": "+(encontrados.length?"mais de uma correspondência possível":"sem correspondência individual confirmada")+"; confira se o valor já está incluído em outro lançamento ou total.",...(data<36526?{avisoData:"Data atípica — confira aba 1, linha "+p.linha+" do arquivo original."}:{})});
  }
  if(!pf.length&&!pj.length)throw new Error("Nenhum lançamento identificado.");
  return {pf,pj,divergencias,datasAtipicas,abasPJ,duplicadosPrimeira,adicionaisPrimeira};
}
