import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FolhaPagamento from "./FolhaPagamento";

const mocks = vi.hoisted(() => ({ lerFolha: vi.fn() }));
vi.mock("@/lib/folha", () => ({ lerFolha: mocks.lerFolha, calcularFolha: vi.fn(), codigoEfetivoFolha: vi.fn() }));

describe("limpeza de dados da folha", () => {
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
    expect(screen.queryByLabelText("PDF da folha")).not.toBeInTheDocument();
  });
});
