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
      <main className="container mx-auto flex min-h-[calc(100vh-72px)] max-w-4xl items-center justify-center px-4 py-14">
        <section className="w-full max-w-xl rounded-3xl border border-border/60 bg-card/50 px-8 py-14 text-center shadow-sm backdrop-blur-xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptText className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Faturamento Simplificado</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Em Contabilização, aguarde Daniel terminar
          </p>
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
