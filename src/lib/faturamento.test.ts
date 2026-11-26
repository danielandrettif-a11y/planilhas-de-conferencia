import {describe,it,expect} from "vitest";
import {converterFaturamento,type Linha} from "./faturamento";
const pfHeader=["DÉB","CRÉD.","VALOR","DIA","COMPLEMENTO HISTÓRICO"];
const pjHeader=["CONVENIOS","","","IRF","PIS","COFINS","IRPJ","CSLL","ISS/TX","TAXAS","LIQ.REC","",""];
const primeira:Linha[]=[["Relatório fictício"],pfHeader,[42,232,120,"2026-10-01","PESSOA EXEMPLO NF.0007"],[42,999,300,"2026-10-01","IGNORAR NF.2"]];
const segunda:Linha[]=[["Empresa fictícia"],pjHeader,["CONVENIO EXEMPLO","123",100,1,2,3,4,5,6,7,72,"2026-10-02",900],["OUTRO EXEMPLO","S/NF",20,0,0,0,0,0,0,0,20,"2026-10-03"],["VALOR GERAL:",null,120,1,2,3,4,5,6,7,92],["", "RESUMO", 120]];
describe("Faturamento",()=>{
  it("filtra PF e lança todos os valores PJ exceto bruto e subtotal",()=>{
    const r=converterFaturamento(primeira,segunda);
    expect(r.pf).toHaveLength(1);
    expect(r.pf[0]).toMatchObject({valor:120,debito:42,credito:232,doc:"0007",historico:"VALOR RECEBIDO PESSOA FISICA PESSOA EXEMPLO NF 0007"});
    expect(r.pj.map(x=>x.valor)).toEqual([2,5,1,3,4,6,7,72,20]);
    expect(r.pj.every(x=>x.debito===null&&x.credito===null)).toBe(true);
    expect(r.pj[4].historico).toContain("VALOR I.R.R.F. RETIDO NA FONTE NF 123");
    expect(r.pj[5].historico).toContain("VALOR DO I.S.S. Á RECUPERAR NF 123");
    expect(r.pj[8].doc).toBe("S/NF");
    expect(r.divergencias).toBe(0);
  });
  it("recusa layout não reconhecido ou data ausente",()=>{
    expect(()=>converterFaturamento([],segunda)).toThrow();
    expect(()=>converterFaturamento(primeira,[pjHeader,["EXEMPLO",123,1,0,0,0,0,0,0,0,1]])).toThrow();
  });
  it("preserva valores originais quando há diferença",()=>{
    const r=converterFaturamento([pfHeader],[pjHeader,["EXEMPLO","9",100,0,0,0,0,0,0,0,99.99,"02/10/2026"]]);
    expect(r.divergencias).toBe(1);expect(r.pj[0].valor).toBe(99.99);
  });
  it("reconhece cabeçalhos em duas linhas e não duplica o subtotal LEI",()=>{
    const r=converterFaturamento([pfHeader,[42,231,100,"2026-10-01","CONVENIO EXEMPLO NF 1"]],[
      ["CONVENIOS","NOTA","VALOR","","DESCONTOS EFETUADOS","","","","","","","DATA"],
      ["","FISCAL","APRES.","IRF","PIS","COFINS","IRPJ","CSLL","LEI","GUIA ISS À PAGAR","LIQ.REC","PAGAMENTO"],
      ["LEI 10.833"],
      ["CONVENIO FICTICIO",1,100,1,2,3,0,4,9,5,90,"2026-10-02"],
      ["TOTAL",null,100,1,2,3,0,4,9,5,90]
    ]);
    expect(r.pf).toHaveLength(0);
    expect(r.pj.map(x=>x.valor)).toEqual([2,4,1,3,5,90]);
    expect(r.guiasIss).toBe(1);
    expect(r.divergencias).toBe(0);
    expect(r.pj[4].historico).toContain("VALOR DO I.S.S. A PAGAR");
  });
  it("reconhece ordem diferente de colunas",()=>{
    const r=converterFaturamento([["DIA","HISTORICO","VALOR","CREDITO","DEBITO"],["2026-10-01","PESSOA EXEMPLO NF 3",10,232,42]],[["NF","DATA","CONVENIO","LIQUIDO","PIS","BRUTO"],[7,"2026-10-01","EXEMPLO",99,1,100]]);
    expect(r.pf[0].valor).toBe(10);expect(r.pj.map(x=>x.valor)).toEqual([1,99]);
  });
});
