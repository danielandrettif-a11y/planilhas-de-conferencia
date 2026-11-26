import type {ResultadoFaturamento} from "./faturamento";
export type TipoCliente="PF"|"PJ"|"Revisar";
export type ClienteRevisao={nome:string;tipo:TipoCliente;motivo:string;temOutrosValores:boolean};
const palavras=(nome:string)=>nome.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().match(/[A-Z0-9]+/g)??[];
const empresas=new Set("LTDA LIMITADA EIRELI EPP ME MEI EMPRESA COMERCIAL COMERCIO SERVICOS SERVICO ASSOCIACAO INSTITUTO FUNDACAO PREFEITURA MUNICIPAL SECRETARIA HOSPITAL CLINICA COOPERATIVA CONDOMINIO INDUSTRIA COMUNICACAO PUBLICIDADE EDITORA TRANSPORTES BANCO".split(" "));
const pessoais=new Set("JOAO JOSE MARIA ANA CARLOS PAULO PEDRO LUCAS MARCOS MARCELO JULIANA FERNANDA PATRICIA RAFAEL BRUNO ANDRE DANIEL LUIZ LUIS ANTONIO FRANCISCO GABRIEL RICARDO EDUARDO ROBERTO SANDRA RENATA BEATRIZ AMANDA CAMILA LUCIANA ADRIANA FELIPE MATEUS MATHEUS GUSTAVO LEONARDO ALEXANDRE CLAUDIA CRISTINA ALINE VITOR VICTOR THIAGO TIAGO RODRIGO".split(" "));
export function sugerirCliente(nome:string):Pick<ClienteRevisao,"tipo"|"motivo">{
 const p=palavras(nome);
 if(p.some(t=>empresas.has(t))||/\bS\s*[./]\s*A\b/i.test(nome))return {tipo:"PJ",motivo:"Termo empresarial identificado"};
 const relevantes=p.filter(t=>!["DE","DA","DO","DAS","DOS","E"].includes(t));
 if(relevantes.length>=2&&pessoais.has(p[0])&&/^[\p{L}\s.'’-]+$/u.test(nome))return {tipo:"PF",motivo:"Padrão de nome pessoal"};
 return {tipo:"Revisar",motivo:"Nome sem identificação conclusiva"};
}
export function listarClientes(r:ResultadoFaturamento):ClienteRevisao[]{
 if(r.abasPJ<2)return [];
 const mapa=new Map<string,ClienteRevisao>();
 for(const l of r.pj){
  if(!l.cliente)continue;
  let c=mapa.get(l.cliente);
  if(!c){c={nome:l.cliente,...sugerirCliente(l.cliente),temOutrosValores:false};mapa.set(l.cliente,c);}
  if(l.natureza!=="liquido")c.temOutrosValores=true;
 }
 return Array.from(mapa.values()).map(c=>c.temOutrosValores&&c.tipo==="PF"?{...c,tipo:"Revisar",motivo:"Nome pessoal com impostos, juros ou outros valores"}:c).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
}
export function aplicarClassificacao(r:ResultadoFaturamento,clientes:ClienteRevisao[]){
 const mapa=new Map(clientes.map(c=>[c.nome,c.tipo]));
 if(listarClientes(r).some(c=>!mapa.has(c.nome)||mapa.get(c.nome)==="Revisar"))throw new Error("Confirme todos os clientes antes de gerar.");
 const pf=[...r.pf],pj:typeof r.pj=[];
 for(const l of r.pj){
  if(l.cliente&&mapa.get(l.cliente)==="PF"&&l.natureza==="liquido"){
   const nota=/^\d+$/.test(l.doc)?"NF "+l.doc:l.doc;
   pf.push({...l,debito:42,credito:232,historico:"VALOR RECEBIDO PESSOA FISICA "+l.cliente.toUpperCase()+" "+nota});
  }else pj.push(l);
 }
 return {...r,pf,pj};
}
