import { useState } from "react";
import {
  ArrowLeft, ArrowUpRight, CalendarDays, ClipboardCheck, FileSpreadsheet,
  FileText, HardHat, Home, ReceiptText, ShieldCheck, WalletCards,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import Index from "./Index";

type Area = "inicio" | "conferencias" | "lancamento";
type ModuleId = "folha" | "ferias" | "autonomo" | "faturamento";

const modules = [
  { id: "folha", title: "Folha de pagamento", description: "Organize os lançamentos da folha de pagamento.", icon: WalletCards },
  { id: "ferias", title: "Férias", description: "Prepare os lançamentos relacionados às férias.", icon: CalendarDays },
  { id: "autonomo", title: "Autônomo", description: "Organize os lançamentos de profissionais autônomos.", icon: HardHat },
  { id: "faturamento", title: "Faturamento", description: "Prepare os lançamentos de faturamento.", icon: ReceiptText },
] as const;

const Dashboard = () => {
  const [area, setArea] = useState<Area>("inicio");
  const [selected, setSelected] = useState<ModuleId | null>(null);
  const selectedModule = modules.find((module) => module.id === selected);

  const changeArea = (next: Area) => {
    setArea(next);
    setSelected(null);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-background/95">
        <div className="container mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Área de trabalho</p>
              <p className="text-base font-semibold tracking-tight">Planilhas e lançamentos</p>
            </div>
          </div>
          <ThemeToggle />
          <nav aria-label="Áreas do sistema" className="order-last flex w-full gap-1 rounded-xl bg-muted p-1 sm:order-none sm:ml-auto sm:w-auto">
            <button type="button" aria-current={area === "inicio" ? "page" : undefined} onClick={() => changeArea("inicio")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:flex-none ${area === "inicio" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <Home className="h-4 w-4" aria-hidden="true" /> Início
            </button>
            <button type="button" aria-current={area === "conferencias" ? "page" : undefined} onClick={() => changeArea("conferencias")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors sm:flex-none ${area === "conferencias" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Conferências
            </button>
            <button type="button" aria-current={area === "lancamento" ? "page" : undefined} onClick={() => changeArea("lancamento")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors sm:flex-none ${area === "lancamento" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Lançamento
            </button>
          </nav>
        </div>
      </header>

      {area === "inicio" && (
        <main className="container mx-auto max-w-6xl px-4 py-12 sm:py-20">
          <section aria-labelledby="inicio-titulo">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Seu espaço de trabalho</p>
              <h1 id="inicio-titulo" className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">O que vamos fazer hoje?</h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">Escolha uma área para começar a organizar suas rotinas contábeis.</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <button type="button" onClick={() => changeArea("conferencias")} className="group flex min-h-64 flex-col items-start rounded-3xl border border-border bg-card p-7 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8">
                <span className="flex w-full items-start justify-between"><span className="rounded-2xl bg-primary/10 p-4 text-primary"><ClipboardCheck className="h-7 w-7" aria-hidden="true" /></span><ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-primary" aria-hidden="true" /></span>
                <span className="mt-6 text-2xl font-semibold tracking-tight">Conferências</span>
                <span className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Organize e confira suas planilhas e relatórios.</span>
                <span className="mt-auto pt-6 text-sm font-semibold text-primary">Acessar conferências <span aria-hidden="true">→</span></span>
              </button>
              <button type="button" onClick={() => changeArea("lancamento")} className="group flex min-h-64 flex-col items-start rounded-3xl border border-border bg-card p-7 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8">
                <span className="flex w-full items-start justify-between"><span className="rounded-2xl bg-primary/10 p-4 text-primary"><FileText className="h-7 w-7" aria-hidden="true" /></span><ArrowUpRight className="h-5 w-5 text-muted-foreground group-hover:text-primary" aria-hidden="true" /></span>
                <span className="mt-6 text-2xl font-semibold tracking-tight">Lançamento</span>
                <span className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Acesse as áreas de folha, férias, autônomo e faturamento.</span>
                <span className="mt-4 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Funcionalidades em desenvolvimento</span>
                <span className="mt-auto pt-6 text-sm font-semibold text-primary">Acessar lançamentos <span aria-hidden="true">→</span></span>
              </button>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> Os arquivos da conferência são processados no seu navegador.</div>
          </section>
        </main>
      )}

      {/* Mantém os arquivos e a etapa da conferência ao alternar entre as áreas. */}
      <div hidden={area !== "conferencias"}><Index /></div>

      {area === "lancamento" && (
        <main className="container mx-auto max-w-6xl px-4 py-10 sm:py-16">
          {selectedModule ? (
            <section className="mx-auto max-w-3xl">
              <button type="button" onClick={() => setSelected(null)} className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar para Lançamento
              </button>
              <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)] sm:p-12">
                <div className="mb-6 inline-flex rounded-2xl bg-primary/10 p-4 text-primary"><selectedModule.icon className="h-7 w-7" aria-hidden="true" /></div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Lançamento</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{selectedModule.title}</h1>
                <p className="mt-4 max-w-xl text-muted-foreground">{selectedModule.description}</p>
                <div className="mt-8 rounded-2xl border border-border bg-muted/50 p-5">
                  <p className="font-medium">Em desenvolvimento</p>
                  <p className="mt-1 text-sm text-muted-foreground">Esta funcionalidade será construída em uma próxima etapa.</p>
                </div>
              </div>
            </section>
          ) : (
            <section>
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Área de lançamento</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">O que vamos lançar?</h1>
                <p className="mt-3 text-muted-foreground">Escolha uma área para acessar suas funcionalidades de lançamento.</p>
              </div>
              <div className="mt-9 grid gap-4 sm:grid-cols-2">
                {modules.map((module) => (
                  <button key={module.id} type="button" onClick={() => setSelected(module.id)} className="group flex min-h-44 flex-col items-start rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex w-full items-start justify-between"><span className="rounded-xl bg-primary/10 p-3 text-primary"><module.icon className="h-5 w-5" aria-hidden="true" /></span><ArrowUpRight className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" /></span>
                    <span className="mt-5 text-lg font-semibold">{module.title}</span>
                    <span className="mt-1 text-sm text-muted-foreground">{module.description}</span>
                    <span className="mt-4 text-xs font-medium text-muted-foreground">Em desenvolvimento</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  );
};

export default Dashboard;
