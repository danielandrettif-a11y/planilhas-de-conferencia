import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Dashboard from "./Dashboard";

describe("navegação das áreas", () => {
  it("mantém a conferência preenchida ao visitar um módulo de lançamento", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "O que vamos fazer hoje?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Acessar conferências/ }));
    fireEvent.change(screen.getByLabelText("Nome da empresa"), { target: { value: "Empresa Teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Início" }));
    expect(screen.getByRole("heading", { name: "O que vamos fazer hoje?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lançamento" }));
    for (const name of ["Folha de pagamento", "Férias", "Autônomo", "Faturamento"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Folha de pagamento/ }));
    expect(screen.getByRole("heading", { name: "Folha de pagamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Empresa (nome ou código)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferências" }));
    expect(screen.getByLabelText("Nome da empresa")).toHaveValue("Empresa Teste");
  });
});
