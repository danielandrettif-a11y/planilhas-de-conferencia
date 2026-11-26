import {useEffect,useRef,useState} from "react";
import {SeletorEmpresas,useSelecaoEmpresas} from "@/components/SelecaoEmpresas";
import {lerPaginasPdf,sugerirPaginas,normalizarNomePdf,type SugestaoPagina} from "@/lib/desacopladorPdf";
import {aliasesEmpresasZip,baixarPdf,baixarZip,separarPdf,type ArquivoZip} from "@/lib/arquivos";

const input="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3";
const botao="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50";

export default function DesacopladorPdf(){
  const selecao=useSelecaoEmpresas();
  const [empresa,setEmpresa]=useState("");
  const [tipo,setTipo]=useState("");
  const [mes,setMes]=useState("");
  const [sugestoes,setSugestoes]=useState<SugestaoPagina[]>([]);
  const [atribuicoes,setAtribuicoes]=useState<Record<number,string>>({});
  const [confirmado,setConfirmado]=useState(false);
  const [ocupado,setOcupado]=useState(false);
  const [erro,setErro]=useState("");
  const [progresso,setProgresso]=useState("");
  const [preview,setPreview]=useState<{url:string;pagina:number}|null>(null);
  const original=useRef<File|null>(null);
  const controller=useRef<AbortController|null>(null);
  const versao=useRef(0);
  const previewUrl=useRef<string|null>(null);
  const fecharPreview=()=>{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;setPreview(null);};
  useEffect(()=>()=>{controller.current?.abort();versao.current++;if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);original.current=null;},[]);
  const invalidar=()=>{controller.current?.abort();versao.current++;original.current=null;setSugestoes([]);setAtribuicoes({});setConfirmado(false);setErro("");setProgresso("");setOcupado(false);fecharPreview();};
  const empresas=selecao.multipla?selecao.lista:[empresa.trim()].filter(Boolean);
  const ready=empresas.length>0&&empresas.every(e=>/[A-Z]/.test(normalizarNomePdf(e)))&&(!selecao.multipla||!empresa.trim());
  const aliases=aliasesEmpresasZip(empresas);
  const nomes=empresas.map((e,i)=>({empresa:e,alias:aliases[i],paginas:sugestoes.filter(s=>atribuicoes[s.pagina.numero]===e).map(s=>s.pagina.numero)}));
  const limpar=()=>{invalidar();setEmpresa("");selecao.limparSelecao();setTipo("");setMes("");};
  const carregar=async(file:File)=>{
    invalidar();const c=new AbortController();controller.current=c;const v=versao.current;setOcupado(true);
    try{
      const paginas=await lerPaginasPdf(file,c.signal,(n,total)=>{if(v===versao.current)setProgresso("Lendo página "+n+" de "+total);});
      if(v!==versao.current)return;
      const resultado=sugerirPaginas(paginas,empresas);
      original.current=file;setSugestoes(resultado);
      setAtribuicoes(Object.fromEntries(resultado.map(s=>[s.pagina.numero,s.empresa??""])));
    }catch(e){if(v===versao.current)setErro(e instanceof Error?e.message:"Não foi possível ler o PDF.");}
    finally{if(v===versao.current){setOcupado(false);setProgresso("");controller.current=null;}}
  };
  const nomePdf=(alias:string)=>{
    const prefixo=tipo.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9 _-]/g," ").trim().slice(0,24)||"Documento";
    const periodo=mes? " "+mes.slice(5)+"-"+mes.slice(0,4):"";
    return prefixo+" "+alias+periodo+".pdf";
  };
  const mostrarPagina=async(n:number)=>{
    const file=original.current;if(!file||ocupado)return;const v=versao.current;fecharPreview();setOcupado(true);
    let bytes:Uint8Array|undefined;
    try{bytes=await separarPdf(file,[n]);if(v!==versao.current)return;
      const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/pdf"}));previewUrl.current=url;setPreview({url,pagina:n});
    }catch(e){if(v===versao.current)setErro(e instanceof Error?e.message:"Erro ao visualizar página.");}
    finally{bytes?.fill(0);if(v===versao.current)setOcupado(false);}
  };
  const exportar=async()=>{
    const file=original.current;if(!file||!confirmado||ocupado||!nomes.every(n=>n.paginas.length))return;
    const v=versao.current;setOcupado(true);setErro("");const arquivos:ArquivoZip[]=[];
    try{
      if(nomes.length===1){await baixarPdf(file,nomes[0].paginas,nomePdf(nomes[0].alias),()=>v===versao.current);}
      else{
        for(const n of nomes){if(v!==versao.current)return;setProgresso("Separando "+n.alias);const nome=nomePdf(n.alias);arquivos.push({nome:n.alias+"/"+nome,bytes:await separarPdf(file,n.paginas)});}
        await baixarZip(arquivos,"PDFs por empresa.zip",()=>v===versao.current);
      }
      if(v===versao.current)limpar();
    }catch(e){if(v===versao.current)setErro(e instanceof Error?e.message:"Erro ao gerar arquivos.");}
    finally{arquivos.forEach(a=>a.bytes.fill(0));if(v===versao.current){setOcupado(false);setProgresso("");}}
  };
  return <section className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-3 text-3xl font-semibold">Desacoplador de PDF</h1><p className="mt-2 text-muted-foreground">Separe documentos de várias empresas em PDFs individuais, sem alterar o conteúdo original das páginas.</p></div>
    <div className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2">
      <SeletorEmpresas empresa={empresa} setEmpresa={setEmpresa} selecao={selecao} invalidar={invalidar} inputClass={input} disabled={ocupado}/>
      <div className="space-y-4">
        <label className="block text-sm font-medium">Tipo de documento (opcional)<input className={input} value={tipo} disabled={ocupado} maxLength={40} placeholder="GPS, FGTS, DARF..." onChange={e=>setTipo(e.target.value)}/></label>
        <label className="block text-sm font-medium">Competência (opcional)<input className={input} type="month" value={mes} disabled={ocupado} onChange={e=>setMes(e.target.value)}/></label>
      </div>
      <label className="text-sm font-medium sm:col-span-2">PDF geral<input className={input} type="file" accept=".pdf,application/pdf" disabled={!ready||ocupado} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f&&ready)void carregar(f);}}/></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Informe nomes de empresas (não apenas códigos). Use nomes completos quando houver empresas semelhantes. O processamento é local, sem envio de arquivos. PDFs digitalizados sem texto exigem revisão manual.</p>
      <button type="button" className="text-left text-sm underline" onClick={limpar}>Limpar dados / cancelar</button>
    </div>
    {progresso&&<p role="status">{progresso}</p>}
    {erro&&<p role="alert" className="rounded-lg bg-destructive/10 p-4 text-destructive">{erro}</p>}
    {preview&&<div className="rounded-xl border bg-card p-4 space-y-2"><p className="font-medium">Página {preview.pagina}</p><a className="text-primary underline" href={preview.url} target="_blank" rel="noopener noreferrer">Abrir página em nova aba</a><button type="button" className="ml-4 text-sm underline" onClick={fecharPreview}>Fechar prévia</button></div>}
    {sugestoes.length>0&&<div className="space-y-4 rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Confira a separação</h2>
      <p className="text-sm text-muted-foreground">Revise todas as páginas, inclusive as excluídas. Páginas sem identificação segura não são incluídas automaticamente. Se uma página contém documentos de empresas diferentes, não a atribua: a ferramenta não recorta partes de páginas.</p>
      <div className="grid gap-2 sm:grid-cols-2">{nomes.map(n=><div key={n.empresa} className="rounded-lg border p-3"><p className="font-semibold break-words">{n.empresa}</p><p className={n.paginas.length?"text-sm text-primary":"text-sm text-destructive"}>{n.paginas.length} página(s): {n.paginas.join(", ")||"nenhuma"}</p></div>)}</div>
      <div className="max-h-[60vh] space-y-3 overflow-auto">{sugestoes.map(s=><div key={s.pagina.numero} className="rounded-lg border p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>Página {s.pagina.numero}</strong><button type="button" disabled={ocupado} className="text-sm text-primary underline" onClick={()=>void mostrarPagina(s.pagina.numero)}>Visualizar página</button></div>
        <p className="text-xs text-muted-foreground">{s.motivo}{s.continuacao?" Sugestão: "+s.continuacao:""}</p>
        <details><summary className="cursor-pointer text-sm">Texto do cabeçalho</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">{s.pagina.cabecalho.join("\n")||"Sem texto extraído."}</p></details>
        <label className="block text-sm">Empresa desta página<select className={input} disabled={ocupado} value={atribuicoes[s.pagina.numero]||""} onChange={e=>{setAtribuicoes(old=>({...old,[s.pagina.numero]:e.target.value}));setConfirmado(false);}}><option value="">Excluir página</option>{empresas.map(e=><option key={e} value={e}>{e}</option>)}</select></label>
      </div>)}</div>
      <p className="text-sm">{sugestoes.filter(s=>!atribuicoes[s.pagina.numero]).length} página(s) excluída(s).</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmado} disabled={ocupado} onChange={e=>setConfirmado(e.target.checked)}/> Revisei a titularidade de todas as páginas e confirmo que os PDFs não contêm documentos de outras empresas.</label>
      <button type="button" className={botao} disabled={!confirmado||ocupado||!nomes.every(n=>n.paginas.length)} onClick={()=>void exportar()}>{ocupado?"Processando...":nomes.length===1?"Baixar PDF da empresa":"Baixar ZIP de todas as empresas"}</button>
    </div>}
  </section>;
}
