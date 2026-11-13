import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import Autonomo from "./Autonomo";
const mocks=vi.hoisted(()=>({ler:vi.fn(),lancar:vi.fn()}));
vi.mock("@/lib/autonomo",()=>({lerAutonomos:mocks.ler,lancarAutonomos:mocks.lancar}));
describe("tela de autônomos",()=>{
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
 it("solicita empresa e competência e cancela ao limpar",async()=>{
  let finish!:(v:unknown[])=>void;mocks.ler.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<Autonomo/>);
  expect(screen.getByLabelText("PDF de autônomos")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"),{target:{value:"0113"}});
  fireEvent.change(screen.getByLabelText("Competência"),{target:{value:"092026"}});
  expect(screen.getByLabelText("Data dos lançamentos")).toHaveValue("2026-09-30");
  fireEvent.change(screen.getByLabelText("PDF de autônomos"),{target:{files:[new File(["teste"],"folha.pdf")]}});
  const signal=mocks.ler.mock.calls[0][1] as AbortSignal;fireEvent.click(screen.getByRole("button",{name:"Limpar dados"}));expect(signal.aborted).toBe(true);finish([]);
  await waitFor(()=>expect(screen.getByLabelText("Empresa (nome ou código)")).toHaveValue(""));expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 });
 it("gera arquivo com colunas e contas do modelo e limpa a tela",async()=>{
  mocks.ler.mockResolvedValue([{codigo:"0113",nome:"Empresa Exemplo",problemas:[],totais:{bruto:194341,inss:21377,irrf:0,liquido:172964},pessoas:[{codigo:"1",competencia:"2026-09",irrf:0}]}]);
  mocks.lancar.mockReturnValue({pendencias:[],lancamentos:[{valor:194341,debito:"2083",credito:"2082",historico:"BRUTO EXEMPLO"},{valor:21377,debito:"2082",credito:"1274",historico:"INSS EXEMPLO"}]});
  const createUrl=vi.fn().mockReturnValue("blob:teste");vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:createUrl,revokeObjectURL:vi.fn()}));vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  render(<Autonomo/>);fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"),{target:{value:"0113"}});fireEvent.change(screen.getByLabelText("Competência"),{target:{value:"092026"}});fireEvent.change(screen.getByLabelText("PDF de autônomos"),{target:{files:[new File(["teste"],"autonomo.pdf")]}});
  fireEvent.click(await screen.findByRole("button",{name:"Baixar planilha de importação"}));await waitFor(()=>expect(createUrl).toHaveBeenCalled());
  const ExcelJS=(await import("exceljs")).default;const wb=new ExcelJS.Workbook();await wb.xlsx.load(await (createUrl.mock.calls[0][0] as Blob).arrayBuffer());const sh=wb.getWorksheet("Planilha1")!;
  expect(sh.getRow(1).values).toEqual([, "DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);expect([sh.getCell("B2").value,sh.getCell("C2").value,sh.getCell("D2").value]).toEqual([1943.41,2083,2082]);expect([sh.getCell("B3").value,sh.getCell("C3").value,sh.getCell("D3").value]).toEqual([213.77,2082,1274]);
  expect(screen.getByLabelText("Empresa (nome ou código)")).toHaveValue("");
 });
});
