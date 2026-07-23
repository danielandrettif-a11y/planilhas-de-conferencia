import { FileSpreadsheet, Loader2, ReceiptText } from "lucide-react";
import Index from "./Index";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Dashboard = () => (
  <Tabs defaultValue="conferencia" className="min-h-screen">
    <div className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur-xl">
      <div className="container mx-auto flex justify-center px-4 py-3">
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-2 gap-1 p-1">
          <TabsTrigger value="conferencia" className="gap-2 py-2.5">
            <FileSpreadsheet className="h-4 w-4" />
            Conferência de Planilhas
          </TabsTrigger>
          <TabsTrigger value="faturamento" className="gap-2 py-2.5">
            <ReceiptText className="h-4 w-4" />
            Faturamento Simplificado
          </TabsTrigger>
        </TabsList>
      </div>
    </div>

    <TabsContent value="conferencia" className="mt-0">
      <Index />
    </TabsContent>

    <TabsContent value="faturamento" className="mt-0">
      <main className="container mx-auto flex min-h-[calc(100vh-72px)] max-w-6xl items-center justify-center px-4 py-14">
        <section className="w-full rounded-3xl border-2 border-primary/40 bg-primary/5 px-6 py-16 text-center shadow-[var(--shadow-glow)] backdrop-blur-xl sm:px-12 sm:py-20">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptText className="h-8 w-8" />
          </div>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Faturamento Simplificado
          </p>
          <h1 className="mx-auto mt-6 max-w-5xl text-4xl font-black uppercase leading-tight tracking-tight text-primary sm:text-6xl lg:text-7xl">
            CALMA VICTORYA, JA VAI FICAR PRONTO!!!
          </h1>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Funcionalidade em desenvolvimento
          </div>
        </section>
      </main>
    </TabsContent>
  </Tabs>
);

export default Dashboard;
