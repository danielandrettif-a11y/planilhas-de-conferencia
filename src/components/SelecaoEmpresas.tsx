import { useRef, useState } from "react";
import { baixarZip, nomePastaZip, nomeZip, nomeInternoZip, separarPdf, type ArquivoZip } from "@/lib/arquivos";

const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export type EmpresaIdentificada = { codigo: string; nome: string };
export type ItemLote<T> = { consulta: string; empresa?: EmpresaIdentificada; resultado?: T; erro?: string };

export function resolverLote<T>(consultas: string[], empresas: EmpresaIdentificada[], validar: (e: EmpresaIdentificada) => T): ItemLote<T>[] {
  const vistos = new Set<string>();
  return consultas.map(consulta => {
    const termo = normalizar(consulta);
    const exatas = empresas.filter(e => e.codigo === consulta.trim() || normalizar(e.nome) === termo);
    const matches = exatas.length ? exatas : empresas.filter(e => normalizar(e.nome).includes(termo));
    if (matches.length !== 1) return { consulta, erro: matches.length ? "Nome ambíguo. Informe o código ou nome completo." : "Empresa não encontrada no PDF." };
    const empresa = matches[0];
    if (vistos.has(empresa.codigo)) return { consulta, empresa, erro: "Empresa já selecionada por outro nome ou código." };
    vistos.add(empresa.codigo);
    try { return { consulta, empresa, resultado: validar(empresa) }; }
    catch (e) { return { consulta, empresa, erro: e instanceof Error ? e.message : "Não foi possível validar esta empresa." }; }
  });
}

export function useSelecaoEmpresas() {
  const [multipla, setMultipla] = useState(false);
  const [lista, setLista] = useState<string[]>([]);
  const limparSelecao = () => { setLista([]); };
  return { multipla, setMultipla, lista, setLista, limparSelecao };
}

type SeletorProps = {
  empresa: string; setEmpresa: (v: string) => void;
  selecao: ReturnType<typeof useSelecaoEmpresas>;
  invalidar: () => void; inputClass: string; disabled?: boolean;
};
export function SeletorEmpresas({empresa, setEmpresa, selecao, invalidar, inputClass, disabled}: SeletorProps) {
  const campo = useRef<HTMLInputElement>(null);
  const {multipla, setMultipla, lista, setLista} = selecao;
  const [aviso, setAviso] = useState("");
  const adicionar = () => {
    const valor = empresa.trim();
    if (!valor) return;
    if (lista.some(e => normalizar(e) === normalizar(valor))) { setAviso("Esta empresa já está na lista."); campo.current?.focus(); return; }
    invalidar(); setLista([...lista, valor]); setEmpresa(""); setAviso(""); campo.current?.focus();
  };
  return <div className="space-y-3">
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={multipla} disabled={disabled} onChange={e => {
        invalidar(); setAviso(""); setMultipla(e.target.checked); setLista([]);
      }} /> Selecionar várias empresas
    </label>
    <label className="block text-sm font-medium">Empresa (nome ou código)
      <input ref={campo} className={inputClass} value={empresa} disabled={disabled}
        placeholder={multipla ? "Digite e pressione Enter" : undefined}
        onChange={e => { invalidar(); setAviso(""); setEmpresa(e.target.value); }}
        onKeyDown={e => { if (multipla && e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
    </label>
    {multipla && <>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50" onClick={adicionar} disabled={disabled || !empresa.trim()}>+ Adicionar empresa</button>
      <p className="text-xs text-muted-foreground">Pressione Enter após cada empresa. Use o código se houver nomes parecidos.</p>
      {aviso && <p role="alert" className="text-xs text-destructive">{aviso}</p>}
      <div className="rounded-lg border p-3">
        <p className="text-sm font-semibold">{lista.length} empresa(s) selecionada(s)</p>
        {lista.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Nenhuma empresa adicionada.</p> :
          <ul className="mt-2 space-y-1">{lista.map(e => <li key={e} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-sm">
            <span className="break-all">{e}</span><button type="button" disabled={disabled} className="px-2 text-muted-foreground hover:text-destructive" aria-label={"Remover " + e} onClick={() => { invalidar(); setLista(lista.filter(v => v !== e)); setAviso(""); }}>×</button>
          </li>)}</ul>}
        {lista.length > 0 && <button type="button" disabled={disabled} className="mt-2 text-xs underline" onClick={() => { invalidar(); setLista([]); setAviso(""); }}>Limpar lista</button>}
      </div>
      {empresa.trim() && <p className="text-xs text-muted-foreground">Pressione Enter para adicionar a empresa digitada antes de anexar o PDF.</p>}
    </>}
  </div>;
}

export function PainelLote<T>({itens, gerando, baixar, aviso}: {itens: ItemLote<T>[]; gerando: boolean; baixar: () => void; aviso?: string}) {
  const ok = itens.filter(i => i.resultado !== undefined && !i.erro).length;
  return <div className="space-y-4 rounded-2xl border bg-card p-6">
    <h2 className="text-xl font-semibold">Conferência em lote</h2>
    <p role="status" className="text-sm">{ok} de {itens.length} empresa(s) prontas para exportação.</p>
    <ul className="space-y-2">{itens.map(i => <li key={i.consulta} className="rounded-lg border p-3 text-sm">
      <p className="font-medium">{i.empresa ? i.empresa.codigo + " — " + i.empresa.nome : i.consulta}</p>
      <p className={i.erro ? "text-destructive" : "text-primary"}>{i.erro || "Pronta para gerar os arquivos."}</p>
    </li>)}</ul>
    {aviso && <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{aviso}</p>}
    {ok !== itens.length && <p className="text-sm text-muted-foreground">Corrija as pendências ou remova as empresas com erro e anexe novamente o PDF. Nenhuma importação inválida será incluída no ZIP.</p>}
    <button type="button" disabled={!ok || ok !== itens.length || gerando} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={baixar}>{gerando ? "Gerando ZIP..." : "Baixar ZIP de todas as empresas"}</button>
  </div>;
}


export async function baixarLote<T>(
  tipo: string, competencia: string, itens: ItemLote<T>[], file: File,
  paginas: (resultado: T) => number[],
  planilhas: (resultado: T) => Promise<ArquivoZip[]>,
  valido: () => boolean,
) {
  const arquivos: ArquivoZip[] = [];
  try {
    if (!itens.length || itens.some(i => i.erro || i.resultado === undefined || !i.empresa)) throw new Error("Há empresas com pendências.");
    const pastas = new Set<string>();
    const paginasUsadas = new Set<number>();
    for (const i of itens) {
      const pasta = nomePastaZip(i.empresa!.codigo, i.empresa!.nome);
      if (pastas.has(pasta.toLowerCase())) throw new Error("Duas empresas gerariam a mesma pasta.");
      pastas.add(pasta.toLowerCase());
      const p = [...new Set(paginas(i.resultado!))];
      if (p.some(n => paginasUsadas.has(n))) throw new Error("Empresas compartilham páginas no PDF. Revise o relatório antes de separar.");
      p.forEach(n => paginasUsadas.add(n));
    }
    for (const i of itens) {
      if (!valido()) return false;
      const empresa = i.empresa!, resultado = i.resultado!, pasta = nomePastaZip(empresa.codigo, empresa.nome);
      arquivos.push({nome: pasta + "/" + nomeInternoZip(tipo, "pdf"), bytes: await separarPdf(file, paginas(resultado))});
      if (!valido()) return false;
      const gerados = await planilhas(resultado);
      for (const a of gerados) arquivos.push({...a, nome: pasta + "/" + a.nome});
      if (!valido()) return false;
    }
    return await baixarZip(arquivos, nomeZip(tipo, competencia), valido);
  } finally { arquivos.forEach(a => a.bytes.fill(0)); }
}
