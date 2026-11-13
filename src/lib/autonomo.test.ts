import {describe,expect,it} from "vitest";
import {lancarAutonomos,type Autonomo} from "./autonomo";
const p:Autonomo={nome:"PROFISSIONAL EXEMPLO",codigo:"10",competencia:"2026-09",bruto:194341,inss:21377,deducaoInss:21377,irrf:0,iss:0,pensao:0,outrosProventos:0,outrosDescontos:0,liquido:172964,pagina:1};
describe("lançamentos de autônomos",()=>{
  it("gera bruto e INSS por profissional com as contas informadas",()=>{
    const r=lancarAutonomos([p]);expect(r.pendencias).toEqual([]);expect(r.lancamentos.map(l=>[l.valor,l.debito,l.credito])).toEqual([[194341,"2083","2082"],[21377,"2082","1274"]]);
    expect(r.lancamentos.map(l=>l.historico)).toEqual(["VALOR PROFISSIONAL EXEMPLO REFERENTE SERVIÇO PRESTADO PESSOA FISICA MÊS 09/2026","VALOR INSS S/ PROFISSIONAL EXEMPLO REFERENTE SERVIÇO PRESTADO PESSOA FISICA MÊS 09/2026"]);
  });
  it("lança IRRF na conta 1162",()=>{
    const comIrrf={...p,irrf:10000,liquido:162964};const r=lancarAutonomos([comIrrf]);expect(r.pendencias).toEqual([]);expect(r.lancamentos[2]).toMatchObject({valor:10000,debito:"2082",credito:"1162",historico:"VALOR IRRF S/ PROFISSIONAL EXEMPLO REFERENTE SERVIÇO PRESTADO PESSOA FISICA MÊS 09/2026"});
  });
  it("sinaliza outros valores não mapeados",()=>{expect(lancarAutonomos([{...p,iss:500}]).pendencias).toHaveLength(1);});
});
