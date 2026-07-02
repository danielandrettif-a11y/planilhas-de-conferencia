import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload, Download, ShieldCheck, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  transformRows,
  buildXlsx,
  buildPreviousInfoMap,
  applyPreviousInfo,
  type SheetRow,
} from "@/lib/transformSpreadsheet";

const ACCEPTED = [".xlsx", ".xls"];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const Index = () => {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prevFile, setPrevFile] = useState<File | null>(null);
  const [prevRows, setPrevRows] = useState<SheetRow[]>([]);
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevDragOver, setPrevDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setRows([]);
    setHeaders([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const resetPrev = () => {
    setPrevFile(null);
    setPrevRows([]);
    if (prevInputRef.current) prevInputRef.current.value = "";
  };

  const handlePrevFile = useCallback(async (f: File) => {
    const lower = f.name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      toast({
        title: "Arquivo inválido",
        description: "Envie uma planilha .xlsx ou .xls.",
        variant: "destructive",
      });
      return;
    }
    setPrevLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("Nenhuma aba encontrada");
      const ws = wb.Sheets[firstSheet];
      const json = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "", raw: true });
      // Validate columns
      try {
        buildPreviousInfoMap(json);
      } catch (err) {
        toast({
          title: "Planilha do mês anterior inválida",
          description: err instanceof Error ? err.message : "Colunas ausentes.",
          variant: "destructive",
        });
        setPrevLoading(false);
        return;
      }
      setPrevFile(f);
      setPrevRows(json);
    } catch (err) {
      console.error(err);
      toast({
        title: "Falha ao ler arquivo",
        description: "Não foi possível ler a planilha do mês anterior.",
        variant: "destructive",
      });
    } finally {
      setPrevLoading(false);
    }
  }, []);

  const handleFile = useCallback(async (f: File) => {
    const lower = f.name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      toast({
        title: "Arquivo inválido",
        description: "Envie uma planilha .xlsx ou .xls exportada do Alterdata.",
        variant: "destructive",
      });
      return;
    }
    if (f.size === 0) {
      toast({
        title: "Arquivo vazio",
        description: "O arquivo enviado não contém dados.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("Nenhuma aba encontrada");
      const ws = wb.Sheets[firstSheet];
      const json = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "", raw: true });
      if (json.length === 0) {
        toast({
          title: "Planilha vazia",
          description: "Não foram encontradas linhas de dados.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      setFile(f);
      setRows(json);
      setHeaders(Object.keys(json[0]));
    } catch (err) {
      console.error(err);
      toast({
        title: "Falha ao ler arquivo",
        description: "Não foi possível ler a planilha. Verifique o formato.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onGenerate = async () => {
    if (rows.length === 0) return;
    setGenerating(true);
    try {
      const result = transformRows(rows);
      if (prevRows.length > 0) {
        const map = buildPreviousInfoMap(prevRows);
        applyPreviousInfo(result.notas, map);
      }
      const blob = await buildXlsx(result);
      const base = file?.name.replace(/\.(xlsx|xls)$/i, "") ?? "planilha";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-formatada.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Planilha gerada",
        description: `${result.notas.length} nota(s) fiscal(is) exportada(s). Nenhum dado foi armazenado.`,
      });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Tente novamente com outro arquivo.";
      toast({
        title: "Erro ao gerar planilha",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const previewRows = rows.slice(0, 5);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center gap-3 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Conversor de Planilhas Alterdata
            </h1>
            <p className="text-sm text-muted-foreground">
              Ferramenta interna · processamento local no navegador
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 py-8">
        <div className="flex items-start gap-3 rounded-md border border-accent bg-accent/60 px-4 py-3 text-sm text-accent-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Nenhuma informação é salva. O arquivo é usado apenas para gerar
            a nova planilha e é descartado ao fechar ou recarregar a página.
          </p>
        </div>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold">1. Enviar planilha</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Arraste um arquivo .xlsx ou .xls exportado do Alterdata, ou clique para selecionar.
          </p>

          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-accent/50"
                  : "border-border hover:border-primary/60 hover:bg-muted/40"
              }`}
            >
              <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">
                {loading ? "Lendo arquivo..." : "Solte o arquivo aqui"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                ou clique para escolher (.xlsx, .xls)
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)} · {rows.length} linhas · {headers.length} colunas
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <X className="mr-1 h-4 w-4" />
                Remover
              </Button>
            </div>
          )}
        </Card>

        {rows.length > 0 && (
          <>
            <Card className="p-6">
              <h2 className="mb-1 text-base font-semibold">2. Prévia</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Primeiras {previewRows.length} linhas do arquivo carregado.
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      {headers.map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap border-b px-3 py-2 text-left font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        {headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-3 py-2">
                            {String(r[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">3. Gerar planilha formatada</h2>
                <p className="text-sm text-muted-foreground">
                  Um arquivo .xlsx será gerado com a formatação base e baixado imediatamente.
                </p>
              </div>
              <Button size="lg" onClick={onGenerate} disabled={generating}>
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Gerar planilha formatada
              </Button>
            </Card>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
