import {describe,it,expect} from "vitest";
import {analisarRecebimentos,gerarLancamentosRecebimentos,dataImportacao,mesData,bloqueado,alertasRecebimento} from "./recebimentos";
const h=["Nr. título","Nome curto","Nome da pessoa","Dt. emissão","Dt. venc. programado","Dt. baixa","Vl. original","Vl. líquido do item","Vl. baixado","Vl. juros","Vl. desconto","Forma de pagamento","Banco da baixa","Cidade","Tipo de baixa","Observação do título"];
describe("Recebimentos bancários",()=>{
 it("separa juros e descontos sem duplicar o banco",()=>{
 const r=analisarRecebimentos([[["BANCO BRADESCO S.A."],h,["1-1","X","CLIENTE FICTICIO",null,null,"01/10/2026",105,100,103,5,2,"PIX",null,null,"PAGAMENTO TOTAL (BANCO)",""],[null,null,null,null,null,null,105,100,103,5,2],[null,null,null,null,null,null,105,100,103,5,2]]]);
 const l=gerarLancamentosRecebimentos(r.registros,"2026-10");
 expect(l.map(x=>[x.valor,x.debito,x.credito])).toEqual([[98,null,null],[5,null,null],[2,null,null]]);
 expect(r.subtotais).toBe(2);expect(r.registros[0].avisos).toHaveLength(1);
 expect(alertasRecebimento(r.registros[0],"2026-11")).toHaveLength(2);
 });
 it("bloqueia divergências e bancos desconhecidos",()=>{
 const linha=["1","X","EXEMPLO",null,null,"01/10/2026",100,100,99,0,0,"PIX","SICOOB",null,"PAGAMENTO TOTAL",""];
 const r=analisarRecebimentos([[h,linha]]);
 expect(bloqueado(r.registros[0])).toBe(true);
 expect(()=>gerarLancamentosRecebimentos(r.registros,"2026-10")).toThrow();
 expect(()=>analisarRecebimentos([[h,[...linha.slice(0,12),"BANCO DESCONHECIDO",...linha.slice(13)]]])).toThrow();
 });
});

it("ajusta somente a última data do mês anterior e preserva a origem",()=>{
 const linha=["1","X","EXEMPLO",null,null,"30/09/2026",100,100,102,3,1,"PIX","SICOOB",null,"PAGAMENTO TOTAL",""];
 const r=analisarRecebimentos([[h,linha]]);
 const original=r.registros[0].data;
 const l=gerarLancamentosRecebimentos(r.registros,"2026-10");
 expect(l).toHaveLength(3);expect(l.every(x=>x.data===original+1&&x.debito===null&&x.credito===null)).toBe(true);
 expect(r.registros[0].data).toBe(original);
 expect(dataImportacao(original-1,"2026-10")).toBe(original-1);
 expect(dataImportacao(original+2,"2026-10")).toBe(original+2);
 expect(mesData(l[0].data)).toBe("2026-10");
 expect(alertasRecebimento(r.registros[0],"2026-10").join(" ")).toContain("Data ajustada");
 expect(()=>gerarLancamentosRecebimentos(r.registros,"")).toThrow();
});
it("respeita a virada de ano e fevereiro bissexto",()=>{
 const excel=(a:number,m:number,d:number)=>(Date.UTC(a,m-1,d)-Date.UTC(1899,11,30))/86400000;
 expect(dataImportacao(excel(2025,12,31),"2026-01")).toBe(excel(2026,1,1));
 expect(dataImportacao(excel(2024,2,29),"2024-03")).toBe(excel(2024,3,1));
});
