import { describe, expect, it } from "vitest";
import { calcularFolha, type EmpresaFolha } from "./folha";

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
});
