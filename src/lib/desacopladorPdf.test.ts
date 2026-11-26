import {describe,it,expect} from "vitest";
import {sugerirPaginas,type PaginaPdf} from "./desacopladorPdf";
const p=(numero:number,cabecalho:string[],linhas=cabecalho):PaginaPdf=>({numero,cabecalho,linhas});
describe("Desacoplador de PDF",()=>{
  it("agrupa páginas não consecutivas pelo cabeçalho, sem confundir outras empresas",()=>{
    const resultados=sugerirPaginas([p(1,["Razão social: ALFA LTDA"]),p(2,["Empresa: BETA LTDA"]),p(3,["Empresa: GAMA LTDA"]),p(4,["Razão social: ALFA LTDA"])],["ALFA","BETA"]);
    expect(resultados.map(r=>r.empresa)).toEqual(["ALFA","BETA",null,"ALFA"]);
  });
  it("não confunde palavras semelhantes",()=>{
    expect(sugerirPaginas([p(1,["Empresa: ALFABET LTDA"])],["ALFA"])[0].empresa).toBeNull();
  });
  it("não atribui uma página compartilhada por empresas selecionadas",()=>{
    expect(sugerirPaginas([p(1,["Empresa: ALFA","Empresa: BETA"])],["ALFA","BETA"])[0].empresa).toBeNull();
  });
  it("não atribui por mera menção no corpo ou se o cabeçalho contradiz",()=>{
    expect(sugerirPaginas([p(1,["Empresa: GAMA"],["Empresa: GAMA","Cliente ALFA"]),p(2,["Relatório"],["Relatório","Cliente ALFA"])],["ALFA"]).map(r=>r.empresa)).toEqual([null,null]);
  });
  it("sugere continuação sem atribuir páginas sem cabeçalho",()=>{
    const r=sugerirPaginas([p(1,["ALFA LTDA"]),p(2,["Continuação"]),p(3,[])],["ALFA"]);
    expect(r[1].empresa).toBeNull();expect(r[1].continuacao).toBe("ALFA");expect(r[2].empresa).toBeNull();
  });
  it("inclui a página 90 e a continuação final pela numeração impressa",()=>{
    const r=sugerirPaginas([p(1,["Empresa: ALFA LTDA","Pag. 89"]),p(2,["Pag. 90"]),p(3,["Pag. 91"])],["ALFA"]);
    expect(r.map(x=>x.empresa)).toEqual(["ALFA","ALFA","ALFA"]);
    expect(r[1].inferida).toBe(true);
  });
  it("preenche uma lacuna entre páginas da mesma empresa",()=>{
    const r=sugerirPaginas([p(1,["ALFA LTDA","Pag. 89"]),p(2,["Continuação"]),p(3,["ALFA LTDA","Pag. 91"])],["ALFA"]);
    expect(r.map(x=>x.empresa)).toEqual(["ALFA","ALFA","ALFA"]);
  });
  it("não atravessa cabeçalho de outra empresa nem reinício de paginação",()=>{
    const r=sugerirPaginas([p(1,["Empresa: ALFA","Pag. 89"]),p(2,["Empresa: GAMA","Pag. 90"]),p(3,["Pag. 91"]),p(4,["Empresa: ALFA","Pag. 92"]),p(5,["Pag. 1"])],["ALFA"]);
    expect(r.map(x=>x.empresa)).toEqual(["ALFA",null,null,"ALFA",null]);
    expect(r[4].revisar).toBe(true);
  });
  it("sinaliza última página sem numeração para revisão",()=>{
    const r=sugerirPaginas([p(1,["Empresa: ALFA"]),p(2,["Continuação"])],["ALFA"]);
    expect(r[1].revisar).toBe(true);
  });
});
