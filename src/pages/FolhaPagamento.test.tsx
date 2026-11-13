import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FolhaPagamento from "./FolhaPagamento";

const mocks = vi.hoisted(() => ({ lerFolha: vi.fn(), calcularFolha: vi.fn() }));
vi.mock("@/lib/folha", () => ({ lerFolha: mocks.lerFolha, calcularFolha: mocks.calcularFolha, codigoEfetivoFolha: (e:{clc:string}) => e.clc }));

describe("limpeza de dados da folha", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("cancela a leitura e não restaura os dados ao limpar durante o processamento", async () => {
    let finish!: (v: unknown[]) => void;
    mocks.lerFolha.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<FolhaPagamento />);
    fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"), { target: { value: "0104" } });
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "2026-09" } });
    fireEvent.change(screen.getByLabelText("Data dos lançamentos"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("PDF da folha"), { target: { files: [new File(["exemplo"], "folha.pdf", {type:"application/pdf"})] } });
    const signal = mocks.lerFolha.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Limpar dados" }));
    expect(signal.aborted).toBe(true);
    finish([{codigo:"0104", nome:"Empresa Exemplo", competencia:"2026-09", liquido:100, eventos:[], errosLeitura:[]}]);
    await waitFor(() => expect(screen.getByLabelText("Empresa (nome ou código)")).toHaveValue(""));
    expect(screen.queryByText(/Empresa Exemplo/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("PDF da folha")).toBeDisabled();
  });
  it("mantém o anexo visível e sugere o último dia correto para cada competência", () => {
    render(<FolhaPagamento />);
    expect(screen.getByLabelText("PDF da folha")).toBeDisabled();
    expect(screen.getByText(/Para anexar, informe/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"), { target: { value: "BEDALAB" } });
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "2026-09" } });
    expect(screen.getByLabelText("Data dos lançamentos")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("PDF da folha")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "2024-02" } });
    expect(screen.getByLabelText("Data dos lançamentos")).toHaveValue("2024-02-29");
    fireEvent.change(screen.getByLabelText("Data dos lançamentos"), { target: { value: "" } });
    expect(screen.getByLabelText("PDF da folha")).toBeDisabled();
  });
  it("exibe os botões dos dois arquivos após ler uma folha que confere", async () => {
    mocks.lerFolha.mockResolvedValue([{codigo:"0104",nome:"Empresa Exemplo",competencia:"2026-09",liquido:10000,eventos:[{codigo:"1"}],errosLeitura:[]}]);
    mocks.calcularFolha.mockReturnValue({lancamentos:[],ignorados:[],pendentes:[],liquidoCalculado:10000,diferenca:0});
    render(<FolhaPagamento />);
    fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"), { target: { value: "0104" } });
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "2026-09" } });
    fireEvent.change(screen.getByLabelText("PDF da folha"), { target: { files: [new File(["exemplo"], "folha.pdf", {type:"application/pdf"})] } });
    expect(await screen.findByText("Valores conferem.")).toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Baixar importação"})).toBeEnabled();
    expect(screen.getByRole("button", {name:"Baixar conferência"})).toBeEnabled();
  });
  it("gera a conferência com cabeçalhos mesclados, bordas e fórmula preservada", async () => {
    const eventos=[{codigo:"1",clc:"1000",descricao:"Salário",grupo:"provento",valor:10000,pagina:1}];
    mocks.lerFolha.mockResolvedValue([{codigo:"0104",nome:"Empresa Exemplo",competencia:"2026-09",liquido:10000,eventos,errosLeitura:[]}]);
    mocks.calcularFolha.mockReturnValue({lancamentos:[{debito:"1981",credito:"1239",descricao:"ORDENADOS",valor:10000,historico:"HISTÓRICO DE TESTE"}],ignorados:[],pendentes:[],liquidoCalculado:10000,diferenca:0});
    const createUrl=vi.fn().mockReturnValue("blob:teste");
    vi.stubGlobal("URL", Object.assign(URL, {createObjectURL:createUrl,revokeObjectURL:vi.fn()}));
    vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
    render(<FolhaPagamento />);
    fireEvent.change(screen.getByLabelText("Empresa (nome ou código)"), { target:{value:"0104"} });
    fireEvent.change(screen.getByLabelText("Competência"), { target:{value:"2026-09"} });
    fireEvent.change(screen.getByLabelText("PDF da folha"), { target:{files:[new File(["teste"],"folha.pdf")] } });
    await screen.findByText("Valores conferem.");
    fireEvent.click(screen.getByRole("button",{name:"Baixar conferência"}));
    await waitFor(()=>expect(createUrl).toHaveBeenCalled());
    const blob=createUrl.mock.calls[0][0] as Blob;
    const ExcelJS=(await import("exceljs")).default;
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet=workbook.getWorksheet("FOLHA")!;
    expect(sheet.getCell("E1").master.address).toBe("A1");
    expect(sheet.getCell("C2").master.address).toBe("A2");
    expect(sheet.getCell("A2").value).toContain("Empresa Exemplo");
    expect(sheet.getCell("B5").border?.left?.style).toBe("thin");
    expect(sheet.getCell("F5").alignment?.wrapText).toBe(true);
    expect(sheet.getCell("D5").value).toMatchObject({formula:"'planilha folha'!A3",result:100});
    expect(sheet.getCell("D6").value).toMatchObject({formula:"D5",result:100});
    vi.unstubAllGlobals();
  });
});
