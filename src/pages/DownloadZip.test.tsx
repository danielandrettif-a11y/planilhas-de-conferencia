import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FolhaPagamento from "./FolhaPagamento";
import Ferias from "./Ferias";
import Autonomo from "./Autonomo";

const mocks = vi.hoisted(() => ({ folha: vi.fn(), calcular: vi.fn(), ferias: vi.fn(), autonomos: vi.fn(), lancar: vi.fn(), zip: vi.fn() }));
vi.mock("@/lib/folha", () => ({ lerFolha: mocks.folha, calcularFolha: mocks.calcular, codigoEfetivoFolha: (e: {clc:string}) => e.clc }));
vi.mock("@/lib/ferias", () => ({ lerFerias: mocks.ferias }));
vi.mock("@/lib/autonomo", () => ({ lerAutonomos: mocks.autonomos, lancarAutonomos: mocks.lancar }));
vi.mock("@/lib/arquivos", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/arquivos")>(), separarPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), baixarZip: mocks.zip }));

const arquivo = new File(["relatório"], "relatorio.pdf");
async function conferirZip(esperados: string[]) {
  let arquivos: {nome:string;bytes:Uint8Array}[] = [];
  await act(async () => { arquivos = await new Promise<{nome:string;bytes:Uint8Array}[]>((resolve, reject) => {
    mocks.zip.mockImplementationOnce(async (lista: {nome:string;bytes:Uint8Array}[], _nome:string, valido:()=>boolean) => {
      try { expect(valido()).toBe(true); resolve(lista.map(a=>({nome:a.nome,bytes:a.bytes.slice()}))); return true; } catch (e) { reject(e); throw e; }
    });
    fireEvent.click(screen.getByRole("button", {name:"Baixar todos em ZIP"}));
  }); });
  expect(arquivos.map(a=>a.nome)).toEqual(esperados);
  const ExcelJS=(await import("exceljs")).default;
  for (const xlsx of arquivos.filter(a=>a.nome.endsWith(".xlsx"))) {
    const wb=new ExcelJS.Workbook(); await wb.xlsx.load(xlsx.bytes as never); expect(wb.worksheets.length).toBeGreaterThan(0);
  }
  await waitFor(()=>expect(screen.getByLabelText("Empresa (nome ou código)")).toHaveValue(""));
}
function preencher(pdf: string) {
  fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"),{target:{value:"0104"}});
  fireEvent.change(screen.getByLabelText("Competência"),{target:{value:"092026"}});
  fireEvent.change(screen.getByLabelText(pdf),{target:{files:[arquivo]}});
}
describe("download conjunto",()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});
  it("gera PDF e duas planilhas na folha",async()=>{
    mocks.folha.mockResolvedValue([{codigo:"0104",nome:"Empresa Teste",competencia:"2026-09",liquido:10000,eventos:[{codigo:"1",clc:"1000",descricao:"Salário",grupo:"provento",valor:10000}],errosLeitura:[],paginas:[1]}]);
    mocks.calcular.mockReturnValue({lancamentos:[],ignorados:[],pendentes:[],liquidoCalculado:10000,diferenca:0});
    render(<FolhaPagamento/>); preencher("PDF da folha"); await screen.findByText("Valores conferem.");
    await conferirZip(["Folha Empresa Teste 09-2026.pdf","Folha Empresa Teste 09-2026 - Conferência.xlsx","Folha Empresa Teste 09-2026 - Importação.xlsx"]);
  });
  it("gera PDF e duas planilhas em férias",async()=>{
    mocks.ferias.mockResolvedValue([{codigo:"0104",empresa:"Empresa Teste",competencia:"2026-09",bruto:10000,inss:0,irrf:0,pensao:0,liquido:10000,pendentes:[],pagina:1}]);
    render(<Ferias/>); preencher("PDF de férias"); await screen.findByText(/1 recibos/);
    await conferirZip(["Férias Empresa Teste 09-2026.pdf","Férias Empresa Teste 09-2026 - Conferência.xlsx","Férias Empresa Teste 09-2026 - Importação.xlsx"]);
  });
  it("gera PDF e planilha em autônomo",async()=>{
    mocks.autonomos.mockResolvedValue([{codigo:"0104",nome:"Empresa Teste",problemas:[],paginas:[1],totais:{bruto:10000,inss:0,irrf:0,liquido:10000},pessoas:[{codigo:"1",competencia:"2026-09"}]}]);
    mocks.lancar.mockReturnValue({pendencias:[],lancamentos:[]});
    render(<Autonomo/>); preencher("PDF de autônomos"); await screen.findByText(/1 profissional/);
    await conferirZip(["Autônomo Empresa Teste 09-2026.pdf","Autônomo Empresa Teste 09-2026 - Importação.xlsx"]);
  });
  it("impede ZIP com importação pendente",async()=>{
    mocks.folha.mockResolvedValue([{codigo:"0104",nome:"Empresa Teste",competencia:"2026-09",liquido:10000,eventos:[{codigo:"1"}],errosLeitura:[],paginas:[1]}]);
    mocks.calcular.mockReturnValue({lancamentos:[],ignorados:[],pendentes:[],liquidoCalculado:9000,diferenca:-1000});
    render(<FolhaPagamento/>); preencher("PDF da folha"); await screen.findByText(/Não foi possível concluir com segurança/);
    expect(screen.getByRole("button",{name:"Baixar todos em ZIP"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Baixar PDF da empresa"})).toBeEnabled();
  });
});
