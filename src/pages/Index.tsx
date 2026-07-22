import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  applyPagamentosPdf,
  applyPreviousInfo,
  buildPreviousInfoMap,
  buildXlsx,
  transformRows,
  type SheetInput,
  type SheetRow,
} from "@/lib/transformSpreadsheet";
import {
  parsePagamentosPdfDetailed,
  type PagamentoRow,
  type PagamentosPdfResult,
} from "@/lib/parsePagamentosPdf";
import { setWorkbookCompanyName } from "@/lib/buildXlsx";

const ACCEPTED = [".xlsx", ".xls"];

type StepId = 1 | 2 | 3 | 4 | 5 | 6;

interface RawFile {
  file: File;
  conta: string;
  rows: SheetRow[];
}

const MESES_NOMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extractConta(filename: string): string | null {
  const base = filename.replace(/\.(xlsx|xls)$/i, "");
  const match = base.match(/\d{3,}/);
  return match ? match[0] : null;
}

function buildMesOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let year = now.getFullYear() - 2; year <= now.getFullYear() + 1; year++) {
    for (let month = 1; month <= 12; month++) {
      out.push({
        value: `${year}-${String(month).padStart(2, "0")}`,
        label: `${MESES_NOMES[month - 1]}/${year}`,
      });
    }
  }
  return out;
}

const MES_OPTIONS = buildMesOptions();

function defaultMes(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function mesLabelExtenso(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return "";
  return `${MESES_NOMES[month - 1]} ${year}`;
}

const MESES_REGEX = new RegExp(
  `(${MESES_NOMES.join("|")})(?:[\\s._-]*(?:de[\\s._-]*)?(\\d{4}|\\d{2}))?`,
  "i",
);

function buildOutputFilename(
  empresa: string,
  previousName: string | null,
  rawFiles: RawFile[],
  mesConferencia: string,
): string {
  const mesExtenso = mesLabelExtenso(mesConferencia);
  const [, month] = mesConferencia.split("-");
  const suffix = " (Conferir).xlsx";

  const trySubstitute = (name: string): string | null => {
    const base = name.replace(/\.(xlsx|xls)$/i, "");
    if (MESES_REGEX.test(base)) return base.replace(MESES_REGEX, mesExtenso);

    const monthMatch = base.match(/m[êe]s[\s._-]*\d{1,2}/i);
    if (monthMatch) return base.replace(monthMatch[0], `mês ${month}`);

    const numericMatch = base.match(/\b(\d{1,2})[._-](\d{4})\b/);
    if (numericMatch) return base.replace(numericMatch[0], mesExtenso);
    return null;
  };

  if (previousName) {
    const substituted = trySubstitute(previousName);
    if (substituted) return `${substituted}${suffix}`;
  }

  if (rawFiles.length === 1) {
    const substituted = trySubstitute(rawFiles[0].file.name);
    if (substituted) return `${substituted}${suffix}`;
  }

  const safeCompany = empresa
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return `${safeCompany || "planilhas"} - ${mesExtenso}${suffix}`;
}

function findPreviousRows(prevSheets: Record<string, SheetRow[]>, conta: string): SheetRow[] | null {
  if (prevSheets[conta]) return prevSheets[conta];
  const matchingKey = Object.keys(prevSheets).find((name) => name.match(/\d{3,}/)?.[0] === conta);
  return matchingKey ? prevSheets[matchingKey] : null;
}

const Index = () => {
  const [empresa, setEmpresa] = useState("");
  const [mesConferencia, setMesConferencia] = useState(defaultMes());
  const [step, setStep] = useState<StepId>(1);

  const [prevFile, setPrevFile] = useState<File | null>(null);
  const [prevSheets, setPrevSheets] = useState<Record<string, SheetRow[]>>({});
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevDragOver, setPrevDragOver] = useState(false);
  const [prevSkipped, setPrevSkipped] = useState(false);

  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfRows, setPdfRows] = useState<PagamentoRow[]>([]);
  const [pdfStats, setPdfStats] = useState<PagamentosPdfResult | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [pdfSkipped, setPdfSkipped] = useState(false);

  const [generating, setGenerating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const prevInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const stepDone: Record<1 | 2 | 3 | 4 | 5, boolean> = {
    1: empresa.trim().length >= 2,
    2: Boolean(mesConferencia),
    3: prevFile !== null || prevSkipped,
    4: rawFiles.length > 0,
    5: pdfFile !== null || pdfSkipped,
  };

  const resetPrev = () => {
    setPrevFile(null);
    setPrevSheets({});
    if (prevInputRef.current) prevInputRef.current.value = "";
  };

  const resetRaw = () => {
    setRawFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const resetPdf = () => {
    setPdfFile(null);
    setPdfRows([]);
    setPdfStats(null);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  const handlePrevFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      toast({ title: "Arquivo inválido", description: "Envie uma planilha .xlsx ou .xls.", variant: "destructive" });
      return;
    }

    setPrevLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheets: Record<string, SheetRow[]> = {};
      let validCount = 0;
      let lastError: unknown = null;

      for (const name of workbook.SheetNames) {
        const worksheet = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json<SheetRow>(worksheet, { defval: "", raw: true });
        if (rows.length === 0) continue;
        try {
          buildPreviousInfoMap(rows);
          sheets[name] = rows;
          validCount++;
        } catch (error) {
          lastError = error;
        }
      }

      if (validCount === 0) {
        toast({
          title: "Planilha do mês anterior inválida",
          description: lastError instanceof Error
            ? lastError.message
            : "Nenhuma aba válida com FORNECEDOR, NOTA FISCAL e INFORMAÇÕES.",
          variant: "destructive",
        });
        return;
      }

      setPrevFile(file);
      setPrevSheets(sheets);
      setPrevSkipped(false);
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      toast({ title: "Falha ao ler arquivo", description: "Não foi possível ler a planilha do mês anterior.", variant: "destructive" });
    } finally {
      setPrevLoading(false);
    }
  }, []);

  const handleRawFiles = useCallback(async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;

    setLoading(true);
    try {
      const parsed: RawFile[] = [];
      const skipped: string[] = [];

      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
          skipped.push(`${file.name} (formato inválido)`);
          continue;
        }
        if (file.size === 0) {
          skipped.push(`${file.name} (vazio)`);
          continue;
        }

        const conta = extractConta(file.name);
        if (!conta) {
          skipped.push(`${file.name} (sem código no nome — ex.: 81354.xls)`);
          continue;
        }

        try {
          const buffer = await file.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
          const firstSheet = workbook.SheetNames[0];
          if (!firstSheet) {
            skipped.push(`${file.name} (sem abas)`);
            continue;
          }
          const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[firstSheet], {
            defval: "",
            raw: true,
          });
          if (rows.length === 0) {
            skipped.push(`${file.name} (sem linhas)`);
            continue;
          }
          parsed.push({ file, conta, rows });
        } catch (error) {
          if (import.meta.env.DEV) console.error(error);
          skipped.push(`${file.name} (falha ao ler)`);
        }
      }

      setRawFiles((previous) => {
        const byAccount = new Map(previous.map((item) => [item.conta, item]));
        for (const item of parsed) byAccount.set(item.conta, item);
        return Array.from(byAccount.values()).sort((a, b) => Number(a.conta) - Number(b.conta));
      });

      if (skipped.length > 0) {
        toast({ title: "Alguns arquivos foram ignorados", description: skipped.join(" · "), variant: "destructive" });
      }
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const handlePdfFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Arquivo inválido", description: "Envie um arquivo .pdf.", variant: "destructive" });
      return;
    }

    setPdfLoading(true);
    try {
      const result = await parsePagamentosPdfDetailed(file);
      setPdfFile(file);
      setPdfRows(result.rows);
      setPdfStats(result);
      setPdfSkipped(false);
      toast({
        title: "PDF validado",
        description: `${result.pages} página(s) · ${result.rows.length} título(s) · ${result.uniqueTitles} número(s) diferente(s).`,
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      resetPdf();
      toast({
        title: "Falha ao validar PDF",
        description: error instanceof Error ? error.message : "Não foi possível processar o relatório.",
        variant: "destructive",
      });
    } finally {
      setPdfLoading(false);
    }
  }, []);

  const onGenerate = async () => {
    if (!stepDone[1] || rawFiles.length === 0) return;
    setGenerating(true);
    try {
      const sheets: SheetInput[] = [];
      let totalNotas = 0;
      const [year, month] = mesConferencia.split("-").map(Number);

      for (const raw of rawFiles) {
        const result = transformRows(raw.rows);
        const previousRows = findPreviousRows(prevSheets, raw.conta);
        if (previousRows?.length) {
          applyPreviousInfo(result.notas, buildPreviousInfoMap(previousRows));
        }
        if (pdfRows.length > 0) {
          applyPagamentosPdf(result.notas, pdfRows, {
            mesConferencia: { ano: year, mes: month },
          });
        }
        sheets.push({ conta: raw.conta, result });
        totalNotas += result.notas.length;
      }

      sheets.sort((a, b) => Number(a.conta) - Number(b.conta));
      setWorkbookCompanyName(empresa);
      const blob = await buildXlsx(sheets);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildOutputFilename(empresa, prevFile?.name ?? null, rawFiles, mesConferencia);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast({
        title: "Planilha gerada",
        description: `${sheets.length} aba(s) · ${totalNotas} nota(s). Nenhum dado foi armazenado.`,
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error(error);
      toast({
        title: "Erro ao gerar planilha",
        description: error instanceof Error ? error.message : "Tente novamente com outro arquivo.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Alterdata · Conferência</p>
              <h1 className="text-lg font-semibold tracking-tight">Conversor de Planilhas</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">processamento local</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-9 px-4 py-12">
        <section className="mx-auto max-w-2xl space-y-5 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            zero uploads · zero storage
          </div>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Transforme sua planilha bruta em relatório formatado
          </h2>
          <p className="text-muted-foreground">
            O aplicativo cruza as planilhas brutas com o relatório do ERP e gera um arquivo de conferência organizado.
          </p>
        </section>

        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/20 px-5 py-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">Seus arquivos são processados localmente no navegador e não são armazenados.</p>
        </div>

        <Stepper current={step} setStep={setStep} done={stepDone} />

        {step === 1 && (
          <StepCard step="01" title="Empresa" description="Informe o nome da empresa que aparecerá no resumo da planilha.">
            <StepNavigation next={() => setStep(2)} nextDisabled={!stepDone[1]} />
            <div className="space-y-2">
              <label htmlFor="empresa" className="text-sm font-medium">Nome da empresa</label>
              <input
                id="empresa"
                value={empresa}
                onChange={(event) => setEmpresa(event.target.value)}
                placeholder="Ex.: Instituto de Medicina Nuclear"
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </StepCard>
        )}

        {step === 2 && (
          <StepCard
            step="02"
            title="Mês de conferência"
            description="O mês selecionado define quais parcelas futuras serão exibidas. Parcelas do último dia do mês permanecem com aviso."
          >
            <StepNavigation back={() => setStep(1)} next={() => setStep(3)} nextDisabled={!stepDone[2]} />
            <Select value={mesConferencia} onValueChange={setMesConferencia}>
              <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Selecione o mês" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {MES_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </StepCard>
        )}

        {step === 3 && (
          <StepCard
            step="03"
            title="Planilha do mês anterior"
            badge="opcional"
            description="Importa as informações existentes e preserva mensagens anteriores quando ainda forem aplicáveis."
          >
            <StepNavigation back={() => setStep(2)} next={() => setStep(4)} nextDisabled={!stepDone[3]} />
            <div className="space-y-4">
              {!prevSkipped ? (
                prevFile ? (
                  <FileChip
                    name={prevFile.name}
                    info={`${formatSize(prevFile.size)} · ${Object.keys(prevSheets).length} aba(s)`}
                    onRemove={resetPrev}
                  />
                ) : (
                  <Dropzone
                    inputRef={prevInputRef}
                    dragOver={prevDragOver}
                    setDragOver={setPrevDragOver}
                    loading={prevLoading}
                    label="Solte a planilha do mês anterior aqui"
                    onDrop={(event) => {
                      event.preventDefault();
                      setPrevDragOver(false);
                      const file = event.dataTransfer.files?.[0];
                      if (file) handlePrevFile(file);
                    }}
                    onSelect={(files) => {
                      const file = Array.from(files)[0];
                      if (file) handlePrevFile(file);
                    }}
                  />
                )
              ) : (
                <InfoBox>Sem planilha anterior. As informações serão preenchidas somente pelo PDF atual.</InfoBox>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={prevSkipped}
                  onCheckedChange={(value) => {
                    const checked = value === true;
                    setPrevSkipped(checked);
                    if (checked) resetPrev();
                  }}
                />
                Não tenho a planilha do mês anterior
              </label>
            </div>
          </StepCard>
        )}

        {step === 4 && (
          <StepCard
            step="04"
            title="Planilhas brutas"
            description="Envie uma ou mais planilhas. O nome do arquivo deve conter o número da conta, como 81354.xls."
          >
            <StepNavigation back={() => setStep(3)} next={() => setStep(5)} nextDisabled={!stepDone[4]} />
            <div className="space-y-4">
              <Dropzone
                inputRef={inputRef}
                dragOver={dragOver}
                setDragOver={setDragOver}
                loading={loading}
                multiple
                label={rawFiles.length > 0 ? "Adicionar mais planilhas" : "Solte as planilhas brutas aqui"}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  if (event.dataTransfer.files?.length) handleRawFiles(event.dataTransfer.files);
                }}
                onSelect={handleRawFiles}
              />

              {rawFiles.length > 0 && (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {rawFiles.map((raw) => (
                    <FileChip
                      key={raw.conta}
                      name={raw.file.name}
                      info={`conta ${raw.conta} · ${formatSize(raw.file.size)} · ${raw.rows.length} linhas`}
                      onRemove={() => setRawFiles((items) => items.filter((item) => item.conta !== raw.conta))}
                    />
                  ))}
                  {rawFiles.length > 1 && (
                    <button type="button" onClick={resetRaw} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                      limpar todos
                    </button>
                  )}
                </div>
              )}
            </div>
          </StepCard>
        )}

        {step === 5 && (
          <StepCard
            step="05"
            title="PDF de pagamentos"
            badge="opcional"
            description="O PDF é validado antes da geração para evitar que uma falha de leitura marque todas as NFs como ausentes no ERP."
          >
            <StepNavigation back={() => setStep(4)} next={() => setStep(6)} nextDisabled={!stepDone[5]} />
            <div className="space-y-4">
              {!pdfSkipped ? (
                pdfFile ? (
                  <>
                    <FileChip
                      name={pdfFile.name}
                      info={`${formatSize(pdfFile.size)} · ${pdfRows.length} títulos lidos`}
                      onRemove={resetPdf}
                      icon="pdf"
                    />
                    {pdfStats && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Metric label="Páginas" value={String(pdfStats.pages)} />
                        <Metric label="Títulos lidos" value={String(pdfStats.rows.length)} />
                        <Metric label="Números diferentes" value={String(pdfStats.uniqueTitles)} />
                      </div>
                    )}
                  </>
                ) : (
                  <Dropzone
                    inputRef={pdfInputRef}
                    dragOver={pdfDragOver}
                    setDragOver={setPdfDragOver}
                    loading={pdfLoading}
                    accept=".pdf"
                    label="Solte o PDF de pagamentos aqui"
                    onDrop={(event) => {
                      event.preventDefault();
                      setPdfDragOver(false);
                      const file = event.dataTransfer.files?.[0];
                      if (file) handlePdfFile(file);
                    }}
                    onSelect={(files) => {
                      const file = Array.from(files)[0];
                      if (file) handlePdfFile(file);
                    }}
                  />
                )
              ) : (
                <InfoBox>Sem PDF. A planilha utilizará apenas as informações herdadas do mês anterior.</InfoBox>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={pdfSkipped}
                  onCheckedChange={(value) => {
                    const checked = value === true;
                    setPdfSkipped(checked);
                    if (checked) resetPdf();
                  }}
                />
                Não tenho o PDF de pagamentos
              </label>
            </div>
          </StepCard>
        )}

        {step === 6 && (
          <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-[var(--gradient-surface)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <StepNavigation back={() => setStep(5)} />
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary">06 · finalizar</p>
                <h3 className="mt-1 text-2xl font-semibold">Gerar planilha</h3>
              </div>
              <ul className="space-y-2 text-sm">
                <SummaryRow ok={stepDone[1]} label={`Empresa: ${empresa || "—"}`} />
                <SummaryRow ok={stepDone[2]} label={`Mês: ${MES_OPTIONS.find((item) => item.value === mesConferencia)?.label ?? "—"}`} />
                <SummaryRow ok={prevFile !== null} label={prevFile ? `Mês anterior: ${Object.keys(prevSheets).length} aba(s)` : "Mês anterior: não enviado"} />
                <SummaryRow ok={rawFiles.length > 0} label={`Planilhas brutas: ${rawFiles.length} arquivo(s)`} />
                <SummaryRow ok={pdfFile !== null} label={pdfFile ? `PDF: ${pdfRows.length} título(s) validados` : "PDF: não enviado"} />
              </ul>
              <Button
                size="lg"
                onClick={onGenerate}
                disabled={generating || !stepDone[1] || rawFiles.length === 0}
                className="w-full bg-primary font-semibold text-primary-foreground shadow-[var(--shadow-glow)] hover:bg-primary/90 sm:w-auto"
              >
                {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Gerar planilha
              </Button>
            </div>
          </section>
        )}

        <footer className="pb-4 pt-8 text-center font-mono text-xs text-muted-foreground">feito para conferência interna</footer>
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
    <section className="rounded-3xl border border-border/60 bg-card/60 p-6 backdrop-blur sm:p-8">
      <div className="mb-5 flex items-start gap-4">
        <span className="pt-1 font-mono text-xs tracking-[0.2em] text-primary">{step}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            {badge && <span className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{badge}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function StepNavigation({
  back,
  next,
  nextDisabled,
}: {
  back?: () => void;
  next?: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="sticky top-[88px] z-10 flex items-center justify-between rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <Button variant="ghost" onClick={back} disabled={!back}>Voltar</Button>
      {next && (
        <Button onClick={next} disabled={nextDisabled} className="bg-primary text-primary-foreground hover:bg-primary/90">Continuar</Button>
      )}
    </div>
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
  accept,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  onDrop: (event: React.DragEvent) => void;
  onSelect: (files: FileList | File[]) => void;
  loading: boolean;
  label: string;
  multiple?: boolean;
  accept?: string;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition-all ${
        dragOver ? "scale-[1.01] border-primary bg-primary/5" : "border-border/70 hover:border-primary/60 hover:bg-primary/5"
      }`}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Upload className="h-5 w-5" />
      </div>
      <p className="font-medium">{loading ? "Lendo e validando..." : label}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">clique ou arraste · {accept ?? ".xlsx .xls"}{multiple ? " · múltiplos" : ""}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? ".xlsx,.xls"}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) onSelect(event.target.files);
        }}
      />
    </div>
  );
}

function FileChip({
  name,
  info,
  onRemove,
  icon,
}: {
  name: string;
  info: string;
  onRemove: () => void;
  icon?: "sheet" | "pdf";
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {icon === "pdf" ? <FileText className="h-5 w-5" /> : <FileSpreadsheet className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          <p className="font-mono text-xs text-muted-foreground">{info}</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="shrink-0"><X className="mr-1 h-4 w-4" />Remover</Button>
    </div>
  );
}

function Stepper({
  current,
  setStep,
  done,
}: {
  current: StepId;
  setStep: (step: StepId) => void;
  done: Record<1 | 2 | 3 | 4 | 5, boolean>;
}) {
  const steps: { id: StepId; label: string }[] = [
    { id: 1, label: "Empresa" },
    { id: 2, label: "Mês" },
    { id: 3, label: "Mês anterior" },
    { id: 4, label: "Brutas" },
    { id: 5, label: "PDF" },
    { id: 6, label: "Gerar" },
  ];

  const canReach = (id: StepId): boolean => {
    for (let index = 1; index < id; index++) {
      if (!done[index as 1 | 2 | 3 | 4 | 5]) return false;
    }
    return true;
  };

  return (
    <ol className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      {steps.map((item, index) => {
        const isCurrent = current === item.id;
        const isDone = item.id !== 6 && done[item.id as 1 | 2 | 3 | 4 | 5];
        const canJump = !isCurrent && canReach(item.id);
        const disabled = !isCurrent && !canJump;
        return (
          <li key={item.id} className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => canJump && setStep(item.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
                isCurrent
                  ? "border-primary bg-primary/10 text-primary"
                  : isDone
                    ? "border-border/60 bg-card/60 text-foreground hover:border-primary/40"
                    : "border-border/40 bg-transparent text-muted-foreground"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isCurrent ? "bg-primary/20" : "bg-muted"}`}>
                {isCurrent ? item.id : isDone ? <Check className="h-3 w-3" /> : item.id}
              </span>
              {item.label}
            </button>
            {index < steps.length - 1 && <span className="h-px w-4 bg-border/60 sm:w-6" />}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? "bg-primary/20 text-primary" : "bg-muted"}`}>
        {ok ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
      </span>
      {label}
    </li>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-center">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default Index;
