import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload, Download, ShieldCheck, X, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  transformRows,
  buildXlsx,
  buildPreviousInfoMap,
  applyPreviousInfo,
  type SheetRow,
  type SheetInput,
} from "@/lib/transformSpreadsheet";

const ACCEPTED = [".xlsx", ".xls"];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extractConta(filename: string): string | null {
  const base = filename.replace(/\.(xlsx|xls)$/i, "");
  const m = base.match(/\d{3,}/);
  return m ? m[0] : null;
}

interface RawFile {
  file: File;
  conta: string;
  rows: SheetRow[];
}

const Index = () => {
  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prevFile, setPrevFile] = useState<File | null>(null);
  const [prevSheets, setPrevSheets] = useState<Record<string, SheetRow[]>>({});
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevDragOver, setPrevDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevInputRef = useRef<HTMLInputElement>(null);

  const resetAll = () => {
    setRawFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeRaw = (conta: string) => {
    setRawFiles((prev) => prev.filter((r) => r.conta !== conta));
  };

  const resetPrev = () => {
    setPrevFile(null);
    setPrevSheets({});
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
      const sheets: Record<string, SheetRow[]> = {};
      let validCount = 0;
      let lastError: unknown = null;
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "", raw: true });
        if (json.length === 0) continue;
        try {
          buildPreviousInfoMap(json);
          sheets[name] = json;
          validCount++;
        } catch (err) {
          lastError = err;
        }
      }
      if (validCount === 0) {
        toast({
          title: "Planilha do mês anterior inválida",
          description:
            lastError instanceof Error
              ? lastError.message
              : "Nenhuma aba com as colunas FORNECEDOR, NOTA FISCAL e INFORMAÇÕES.",
          variant: "destructive",
        });
        setPrevLoading(false);
        return;
      }
      setPrevFile(f);
      setPrevSheets(sheets);
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

  const handleFiles = useCallback(async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    setLoading(true);
    try {
      const parsed: RawFile[] = [];
      const skipped: string[] = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
          skipped.push(`${f.name} (formato inválido)`);
          continue;
        }
        if (f.size === 0) {
          skipped.push(`${f.name} (vazio)`);
          continue;
        }
        const conta = extractConta(f.name);
        if (!conta) {
          skipped.push(`${f.name} (sem código no nome — ex.: 81354.xlsx)`);
          continue;
        }
        try {
          const buf = await f.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array", cellDates: true });
          const first = wb.SheetNames[0];
          if (!first) {
            skipped.push(`${f.name} (sem abas)`);
            continue;
          }
          const json = XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[first], {
            defval: "",
            raw: true,
          });
          if (json.length === 0) {
            skipped.push(`${f.name} (sem linhas)`);
            continue;
          }
          parsed.push({ file: f, conta, rows: json });
        } catch (err) {
          console.error(err);
          skipped.push(`${f.name} (falha ao ler)`);
        }
      }
      setRawFiles((prev) => {
        const map = new Map(prev.map((r) => [r.conta, r]));
        const duplicates: string[] = [];
        for (const r of parsed) {
          if (map.has(r.conta)) duplicates.push(`${r.conta}`);
          map.set(r.conta, r);
        }
        if (duplicates.length > 0) {
          toast({
            title: "Conta duplicada substituída",
            description: `Contas: ${duplicates.join(", ")}`,
          });
        }
        return Array.from(map.values());
      });
      if (skipped.length > 0) {
        toast({
          title: "Alguns arquivos foram ignorados",
          description: skipped.join(" · "),
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const onGenerate = async () => {
    if (rawFiles.length === 0) return;
    setGenerating(true);
    try {
      const sheets: SheetInput[] = [];
      let totalNotas = 0;
      for (const raw of rawFiles) {
        const result = transformRows(raw.rows);
        const prev = prevSheets[raw.conta];
        if (prev && prev.length > 0) {
          const map = buildPreviousInfoMap(prev);
          applyPreviousInfo(result.notas, map);
        }
        sheets.push({ conta: raw.conta, result });
        totalNotas += result.notas.length;
      }
      sheets.sort((a, b) => {
        const na = parseInt(String(a.conta).match(/\d+/)?.[0] ?? "", 10);
        const nb = parseInt(String(b.conta).match(/\d+/)?.[0] ?? "", 10);
        const aNum = Number.isFinite(na);
        const bNum = Number.isFinite(nb);
        if (aNum && bNum) return na - nb;
        if (aNum) return -1;
        if (bNum) return 1;
        return String(a.conta).localeCompare(String(b.conta));
      });
      const blob = await buildXlsx(sheets);
      const base =
        rawFiles.length === 1
          ? rawFiles[0].file.name.replace(/\.(xlsx|xls)$/i, "")
          : "planilhas";
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
        description: `${sheets.length} aba(s) · ${totalNotas} nota(s) exportada(s). Nenhum dado foi armazenado.`,
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 backdrop-blur-xl bg-background/40 sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
              <FileSpreadsheet className="h-5 w-5" />
              <div className="absolute inset-0 rounded-xl bg-primary/20 blur-md -z-10" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono">Alterdata · Conferência</p>
              <h1 className="text-lg font-semibold tracking-tight">Conversor de Planilhas</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
              processamento local
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-14 space-y-10">
        <section className="text-center space-y-5 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground font-mono">
            <Sparkles className="h-3 w-3 text-primary" />
            zero uploads · zero storage
          </div>
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Transforme sua planilha bruta em{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              relatório formatado
            </span>
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            Envie o export do Alterdata e receba uma planilha padronizada com fornecedor, nota fiscal e valores em segundos.
          </p>
        </section>

        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/20 backdrop-blur px-5 py-4 text-sm text-accent-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            Nenhuma informação é salva. Tudo é processado no seu navegador e descartado ao fechar a página.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
        <StepCard
          step="01"
          title="Planilhas brutas do mês atual"
          description="Envie uma ou mais planilhas. O nome do arquivo deve conter o código da conta (ex.: 81354.xlsx). Cada arquivo vira uma aba na planilha final."
        >
          <div className="space-y-3">
            <Dropzone
              inputRef={inputRef}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onDrop={onDrop}
              onSelect={handleFiles}
              loading={loading}
              multiple
              label={
                rawFiles.length > 0
                  ? "Adicionar mais arquivos"
                  : "Solte os arquivos aqui"
              }
            />
            {rawFiles.length > 0 && (
              <div className="space-y-2">
                {rawFiles.map((r) => (
                  <FileChip
                    key={r.conta}
                    name={r.file.name}
                    info={`aba ${r.conta} · ${formatSize(r.file.size)} · ${r.rows.length} linhas`}
                    onRemove={() => removeRaw(r.conta)}
                  />
                ))}
                {rawFiles.length > 1 && (
                  <button
                    onClick={resetAll}
                    className="text-xs text-muted-foreground hover:text-foreground font-mono"
                  >
                    limpar todos
                  </button>
                )}
              </div>
            )}
          </div>
        </StepCard>

        <StepCard
          step="02"
          title="Planilha do mês anterior"
          badge="opcional"
          description="Um único arquivo com uma aba por conta (mesmo código do mês atual). Importa a coluna INFORMAÇÕES."
        >
          {!prevFile ? (
            <Dropzone
              inputRef={prevInputRef}
              dragOver={prevDragOver}
              setDragOver={setPrevDragOver}
              onDrop={(e) => {
                e.preventDefault();
                setPrevDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handlePrevFile(f);
              }}
              onSelect={(fs) => {
                const f = Array.isArray(fs) ? fs[0] : fs[0];
                if (f) handlePrevFile(f);
              }}
              loading={prevLoading}
              label="Solte a planilha do mês anterior aqui"
            />
          ) : (
            <FileChip
              name={prevFile.name}
              info={`${formatSize(prevFile.size)} · ${Object.keys(prevSheets).length} aba(s): ${Object.keys(prevSheets).join(", ")}`}
              onRemove={resetPrev}
            />
          )}
        </StepCard>
        </div>

        {rawFiles.length > 0 && (
          <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-[var(--gradient-surface)] p-8 shadow-[var(--shadow-soft)]">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.25em] text-primary font-mono">03 · finalizar</p>
                <h3 className="text-2xl font-semibold tracking-tight">
                  Gerar planilha ({rawFiles.length} aba{rawFiles.length > 1 ? "s" : ""})
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {prevFile
                    ? "A coluna INFORMAÇÕES será preenchida com base na planilha anterior."
                    : "A coluna INFORMAÇÕES ficará em branco (nenhuma planilha anterior)."}
                </p>
              </div>
              <Button
                size="lg"
                onClick={onGenerate}
                disabled={generating}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[var(--shadow-glow)] font-semibold"
              >
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Gerar planilha
              </Button>
            </div>
          </div>
        )}

        <footer className="pt-8 pb-4 text-center text-xs text-muted-foreground font-mono">
          feito para conferência interna
        </footer>
      </main>
    </div>
  );
};

function StepCard({
  step,
  title,
  description,
  badge,
  children,
}: {
  step: string;
  title: string;
  description: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="group rounded-3xl border border-border/60 bg-card/60 backdrop-blur p-6 sm:p-8 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-4 mb-5">
        <span className="font-mono text-xs text-primary tracking-[0.2em] pt-1">{step}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            {badge && (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Dropzone({
  inputRef,
  dragOver,
  setDragOver,
  onDrop,
  onSelect,
  loading,
  label,
  multiple,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onSelect: (files: FileList | File[]) => void;
  loading: boolean;
  label: string;
  multiple?: boolean;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`group/drop relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition-all ${
        dragOver
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border/70 hover:border-primary/60 hover:bg-primary/5"
      }`}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover/drop:scale-110">
        <Upload className="h-5 w-5" />
      </div>
      <p className="font-medium">
        {loading ? "Lendo arquivo..." : label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground font-mono">
        clique ou arraste · .xlsx .xls{multiple ? " · múltiplos" : ""}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onSelect(e.target.files);
        }}
      />
    </div>
  );
}

function FileChip({ name, info, onRemove }: { name: string; info: string; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground font-mono">{info}</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="shrink-0">
        <X className="mr-1 h-4 w-4" />
        Remover
      </Button>
    </div>
  );
}

export default Index;
