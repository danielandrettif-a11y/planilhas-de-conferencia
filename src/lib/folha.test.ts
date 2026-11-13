import { describe, expect, it } from "vitest";
import { calcularFolha, type EmpresaFolha } from "./folha";
import { modeloFolha } from "./modeloFolha";

const company: EmpresaFolha = {codigo:"001",nome:"Exemplo",competencia:"2026-09",liquido:85000,errosLeitura:[],eventos:[
  {codigo:"1",descricao:"Salários",clc:"1000",grupo:"provento",valor:100000,pagina:1},
  {codigo:"2",descricao:"INSS",clc:"1008",grupo:"desconto",valor:15000,pagina:1},
  {codigo:"3",descricao:"Férias",clc:"1018",grupo:"provento",valor:5000,pagina:1},
  {codigo:"4",descricao:"FGTS",clc:"1028",grupo:"outros",valor:3000,pagina:1},
]};
describe("folha de pagamento",()=>{
  it("confere o líquido com INSS do funcionário e exclui férias e outros",()=>{
    const r=calcularFolha(company);expect(r.liquidoCalculado).toBe(85000);expect(r.diferenca).toBe(0);expect(r.ignorados).toHaveLength(2);expect(r.pendentes).toHaveLength(0);
  });
  it("sinaliza códigos desconhecidos e diferenças",()=>{
    const r=calcularFolha({...company,eventos:[...company.eventos,{codigo:"5",descricao:"Outro desconto",clc:"9999",grupo:"desconto",valor:300,pagina:1}],liquido:84700});
    expect(r.pendentes).toHaveLength(1);expect(r.diferenca).toBe(300);
  });
  it("inclui diferença de férias e exclui insalubridade de abono pecuniário",()=>{
    const r=calcularFolha({...company,liquido:96933,eventos:[...company.eventos,
      {codigo:"142",descricao:"Diferença de Férias",clc:"1000",grupo:"provento",valor:11933,pagina:1},
      {codigo:"154",descricao:"Insalubridade Abono Pec.",clc:"1000",grupo:"provento",valor:22154,pagina:1},
    ]});
    expect(r.liquidoCalculado).toBe(96933);
    expect(r.diferenca).toBe(0);
    expect(r.ignorados.some(e=>e.codigo==="154")).toBe(true);
    expect(r.ignorados.some(e=>e.codigo==="142")).toBe(false);
  });
  it("exclui adicional noturno de abono pecuniário",()=>{
    const r=calcularFolha({...company,eventos:[...company.eventos,
      {codigo:"158",descricao:"Adic.Noturno Abono Pec.",clc:"1000",grupo:"provento",valor:8987,pagina:1},
    ]});
    expect(r.diferenca).toBe(0);
    expect(r.ignorados.some(e=>e.codigo==="158")).toBe(true);
  });
  it("trata abono como excluído e mapeia maternidade e ajuda de custo sem CLC",()=>{
    const r=calcularFolha({...company,liquido:95000,eventos:[...company.eventos,
      {codigo:"156",descricao:"Periculosidade Abono Pec.",clc:"",grupo:"provento",valor:4000,pagina:1},
      {codigo:"152",descricao:"Média V.Variáv.Abono Pec.",clc:"",grupo:"provento",valor:5000,pagina:1},
      {codigo:"190",descricao:"Média H.Extra Maternidade",clc:"",grupo:"provento",valor:1000,pagina:1},
      {codigo:"192",descricao:"Média Variáv.Maternidade",clc:"",grupo:"provento",valor:2000,pagina:1},
      {codigo:"693",descricao:"AJUDA DE CUSTO",clc:"",grupo:"provento",valor:7000,pagina:1},
    ]});
    expect(r.diferenca).toBe(0);
    expect(r.pendentes).toHaveLength(0);
    expect(r.lancamentos.find(l=>l.descricao==="SALÁRIO-MATERNIDADE")?.valor).toBe(3000);
    expect(r.lancamentos.find(l=>l.descricao==="ORDENADOS")?.valor).toBe(107000);
    expect(r.ignorados.filter(e=>["152","156"].includes(e.codigo))).toHaveLength(2);
  });
  it("segue a ordem e os históricos do modelo com as transferências em sequência",()=>{
    const r=calcularFolha({...company,liquido:115000,eventos:[...company.eventos,
      {codigo:"278",descricao:"Salário Família",clc:"1002",grupo:"vantagem",valor:10000,pagina:1},
      {codigo:"16",descricao:"Maternidade",clc:"1004",grupo:"provento",valor:20000,pagina:1},
    ]});
    expect(r.lancamentos.map(l=>l.descricao)).toEqual(["ORDENADOS","SALÁRIO-MATERNIDADE","TRANSFERÊNCIA SALÁRIO-MATERNIDADE","SALÁRIO-FAMÍLIA","TRANSFERÊNCIA SALÁRIO-FAMÍLIA","INSS DOS FUNCIONÁRIOS"]);
    expect(r.lancamentos[0].historico).toBe("VR. BRUTO ORDENADO REF. MÊS 09 CONF. FOLHA DE PAGAMENTO");
    expect(r.diferenca).toBe(0);
    expect(modeloFolha).toHaveLength(22);
    expect(modeloFolha.filter(l=>l.valorExterno).map(l=>l.descricao)).toEqual(["INSS/EMPRESA","FGTS"]);
  });
});
