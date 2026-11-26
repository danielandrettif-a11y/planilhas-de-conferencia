import {describe,it,expect} from "vitest";
import {sugerirCliente,listarClientes,aplicarClassificacao} from "./classificacaoFaturamento";
import type {ResultadoFaturamento} from "./faturamento";
const base={data:46000,valor:100,debito:null,credito:null,doc:"1",historico:"EXEMPLO"};
const resultado:ResultadoFaturamento={pf:[],pj:[{...base,cliente:"Maria Exemplo",natureza:"liquido"},{...base,cliente:"Maria Exemplo",natureza:"pis",valor:2},{...base,cliente:"Comercial Exemplo LTDA",natureza:"liquido"},{...base,cliente:"João Exemplo",natureza:"liquido"},{...base,avisoRevisao:"Conferir"}],divergencias:0,datasAtipicas:[],abasPJ:2,duplicadosPrimeira:0,adicionaisPrimeira:1};
describe("Classificação local",()=>{
 it("sugere sem presumir certeza",()=>{
  expect(sugerirCliente("Maria Exemplo").tipo).toBe("PF");
  expect(sugerirCliente("Maria Exemplo LTDA").tipo).toBe("PJ");
  expect(sugerirCliente("Exemplo").tipo).toBe("Revisar");
 });
 it("revisa nomes com impostos e preserva todos os valores",()=>{
  const c=listarClientes(resultado);
  expect(c).toHaveLength(3);
  expect(c.find(x=>x.nome==="Maria Exemplo")?.tipo).toBe("Revisar");
  expect(()=>aplicarClassificacao(resultado,c)).toThrow();
  const r=aplicarClassificacao(resultado,c.map(x=>x.nome==="Maria Exemplo"?{...x,tipo:"PF"}:x));
  expect(r.pf).toHaveLength(2);
  expect(r.pf.every(x=>x.debito===42&&x.credito===232)).toBe(true);
  expect(r.pj).toHaveLength(3);
  expect(r.pj.find(x=>x.natureza==="pis")?.valor).toBe(2);
  expect(r.pj.some(x=>x.avisoRevisao)).toBe(true);
 });
 it("mantém modelos anteriores sem revisão",()=>expect(listarClientes({...resultado,abasPJ:1})).toEqual([]));
});
