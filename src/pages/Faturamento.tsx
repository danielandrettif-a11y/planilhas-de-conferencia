import {useEffect,useRef,useState} from "react";
import {converterAbasFaturamento,type Linha,type LancamentoFaturamento} from "@/lib/faturamento";

import {listarClientes,aplicarClassificacao,type ClienteRevisao} from "@/lib/classificacaoFaturamento";

const botao="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50";
export default function Faturamento(){
  const [arquivo,setArquivo]=useState<File|null>(null);
  const [ocupado,setOcupado]=useState(false);
  const [erro,setErro]=useState("");
  const [status,setStatus]=useState("");
  const [clientes,setClientes]=useState<ClienteRevisao[]>([]);
  const [revisao,setRevisao]=useState(false);
  const campo=useRef<HTMLInputElement>(null);
  const versao=useRef(0);
  const urls=useRef(new Set<string>());
  const timers=useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(()=>()=>{versao.current++;urls.current.forEach(u=>URL.revokeObjectURL(u));timers.current.forEach(t=>clearTimeout(t));},[]);
  const limpar=()=>{versao.current++;setArquivo(null);setClientes([]);setRevisao(false);setOcupado(false);setErro("");setStatus("");if(campo.current)campo.current.value="";};
  const gerar=async()=>{
    if(!arquivo||ocupado)return;
    const v=++versao.current;
    setOcupado(true);setErro("");setStatus("");
    let entrada:Uint8Array|undefined,saida:Uint8Array|undefined;
    let abas:Linha[][]=[];
    let aguardando=false;
    let resultado:ReturnType<typeof converterAbasFaturamento>|undefined;
    try{
      const XLSX=await import("xlsx");
      entrada=new Uint8Array(await arquivo.arrayBuffer());
      if(v!==versao.current)return;
      const origem=XLSX.read(entrada,{type:"array",cellDates:false,cellFormula:false,cellHTML:false,cellNF:false,cellText:false});
      if(origem.SheetNames.length<2)throw new Error("Envie o modelo com pelo menos duas abas.");
      abas=origem.SheetNames.map(nome=>XLSX.utils.sheet_to_json<Linha>(origem.Sheets[nome],{header:1,raw:true,blankrows:true}));
      resultado=converterAbasFaturamento(abas,!!origem.Workbook?.WBProps?.date1904);
      const sugeridos=listarClientes(resultado);
      if(sugeridos.length&&!revisao){aguardando=true;setClientes(sugeridos);setRevisao(true);return;}
      if(revisao)resultado=aplicarClassificacao(resultado,clientes);
      const ExcelJS=(await import("exceljs")).default;
      if(v!==versao.current)return;
      const wb=new ExcelJS.Workbook();
      const sh=wb.addWorksheet("Planilha1");
      sh.addRow(["DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);
      const inserir=(r:LancamentoFaturamento)=>{
        const linha=sh.addRow([r.data,r.valor,r.debito,r.credito,r.doc,r.historico]);
        const vermelho={color:{argb:"FFC00000"},bold:true};
        if(r.avisoData){
          linha.getCell(1).font=vermelho;
          linha.getCell(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFE5E5"}};
          linha.getCell(1).note=r.avisoData;
        }
        if(r.avisoRevisao){
          linha.getCell(6).font=vermelho;
          linha.getCell(6).note=r.avisoRevisao;
        }
      };
      resultado.pf.forEach(inserir);
      if(resultado.pf.length&&resultado.pj.length)sh.addRow([]);
      resultado.pj.forEach(inserir);
      if(resultado.datasAtipicas.length||resultado.adicionaisPrimeira){
        sh.addRow([]);
        if(resultado.datasAtipicas.length){const aviso=sh.addRow(["","","","","","ATENÇÃO: confira as datas em vermelho antes de importar. Origem: "+resultado.datasAtipicas.join("; ")+". Exclua esta linha de aviso."]);aviso.getCell(6).font={color:{argb:"FFC00000"},bold:true};aviso.getCell(6).alignment={wrapText:true};aviso.height=42;}
        if(resultado.adicionaisPrimeira){const aviso=sh.addRow(["","","","","","ATENÇÃO: confira os históricos em vermelho da primeira aba; podem corresponder a valores agrupados. Exclua esta linha de aviso antes de importar."]);aviso.getCell(6).font={color:{argb:"FFC00000"},bold:true};aviso.getCell(6).alignment={wrapText:true};aviso.height=42;}
      }
      sh.getColumn(1).numFmt="dd/mm/yyyy";
      sh.getColumn(2).numFmt="#,##0.00";
      sh.getColumn(5).numFmt="@";
      [15,18,15,15,16,95].forEach((n,i)=>{sh.getColumn(i+1).width=n;});
      saida=new Uint8Array(await wb.xlsx.writeBuffer() as unknown as ArrayBuffer);
      if(v!==versao.current)return;
      const url=URL.createObjectURL(new Blob([saida as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
      urls.current.add(url);
      const link=document.createElement("a");
      link.href=url;link.download="Faturamento - Importacao.xlsx";
      document.body.appendChild(link);
      try{link.click();}finally{link.remove();const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.current.delete(url);timers.current.delete(timer);},1000);timers.current.add(timer);}
      setStatus("Download iniciado: "+resultado.pf.length+" lançamento(s) PF e "+resultado.pj.length+" PJ. "+(resultado.divergencias?resultado.divergencias+" nota(s) com diferença entre bruto e soma dos valores; confira os valores originais. ":"")+(resultado.datasAtipicas.length?"Datas atípicas preservadas: "+resultado.datasAtipicas.join("; ")+". Confira antes de importar. ":"")+"Conferência da primeira aba: "+resultado.duplicadosPrimeira+" correspondência(s) já contemplada(s), "+resultado.adicionaisPrimeira+" lançamento(s) adicional(is) para revisão. Complete as contas de PJ e exclua as linhas de aviso antes de importar.");
    }catch(e){
      if(v===versao.current)setErro(e instanceof Error&&/^(Aba \d|As duas abas|Envie o modelo|Nenhum lançamento)/.test(e.message)?e.message:"Não foi possível processar a planilha. Confira o formato e tente novamente.");
    }finally{
      entrada?.fill(0);saida?.fill(0);
      abas.forEach(aba=>aba.forEach(r=>r.fill(null)));
      abas=[];
      if(resultado){resultado.pf.length=0;resultado.pj.length=0;resultado.datasAtipicas.length=0;}
      if(v===versao.current){setOcupado(false);if(!aguardando){setArquivo(null);setClientes([]);setRevisao(false);if(campo.current)campo.current.value="";}}
    }
  };
  return <section className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-3 text-3xl font-semibold">Faturamento</h1><p className="mt-2 text-muted-foreground">Converta as abas do relatório em uma planilha de importação para o Alterdata.</p></div>
    <div className="space-y-4 rounded-2xl border bg-card p-6">
      <label className="block text-sm font-medium">Planilha bruta (.xlsx, .xls ou .ods)<input ref={campo} type="file" accept=".xlsx,.xls,.ods" disabled={ocupado||revisao} className="mt-2 block w-full rounded-lg border border-input bg-background p-3" onChange={e=>{setArquivo(e.target.files?.[0]??null);setErro("");setStatus("");}}/></label>
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><strong>ATENÇÃO — antes de importar:</strong> preencha as contas de débito e crédito de todos os lançamentos de pessoas jurídicas e impostos conforme o plano de contas da empresa. Exclua a linha em branco entre PF e PJ se o importador exigir. Confira também as notas e os valores.</div>
      <p className="text-sm text-muted-foreground">Pessoas físicas: D 42 / C 232. Pessoas jurídicas: contas em branco. A coluna Doc recebe a NF. As datas e valores vêm do arquivo original.</p>
      <p className="text-xs text-muted-foreground">Processamento local no navegador. Nenhum arquivo ou dado é enviado ao servidor ou guardado no site. Após iniciar o download ou ocorrer um erro, a seleção é limpa. O arquivo original e o download permanecem no seu computador.</p>
      <div className="flex flex-wrap gap-3"><button type="button" className={botao} disabled={!arquivo||ocupado||(revisao&&clientes.some(c=>c.tipo==="Revisar"))} onClick={()=>void gerar()}>{ocupado?"Processando...":revisao?"Confirmar classificação e baixar":"Analisar e gerar importação"}</button><button type="button" className="text-sm underline" onClick={limpar}>Limpar / cancelar</button></div>
    </div>
    {revisao&&<div className="space-y-3 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Classificação de clientes</h2><p className="text-sm text-muted-foreground">Confira todas as sugestões. Nomes não comprovam CPF ou CNPJ. Impostos, juros e outros valores serão preservados com contas em branco, mesmo quando o recebimento for classificado como PF.</p><p className="text-sm font-medium">PF: {clientes.filter(c=>c.tipo==="PF").length} | PJ: {clientes.filter(c=>c.tipo==="PJ").length} | Revisar: {clientes.filter(c=>c.tipo==="Revisar").length}</p><div className="max-h-[480px] overflow-auto divide-y">{clientes.map((c,i)=><div key={i} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="font-medium break-words">{c.nome}</p><p className="text-xs text-muted-foreground">{c.motivo}{c.temOutrosValores?" • Possui impostos, juros ou outros valores":""}</p></div><select aria-label={"Classificação de "+c.nome} disabled={ocupado} className="rounded-md border bg-background p-2" value={c.tipo} onChange={e=>setClientes(old=>old.map((item,j)=>j===i?{...item,tipo:e.target.value as ClienteRevisao["tipo"]}:item))}><option value="Revisar">Revisar</option><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select></div>)}</div><button type="button" className={botao} disabled={ocupado||clientes.some(c=>c.tipo==="Revisar")} onClick={()=>void gerar()}>Confirmar classificação e baixar</button></div>}
    {erro&&<p role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">{erro}</p>}
    {status&&<p role="status" className="rounded-xl border bg-card p-4 text-sm">{status}</p>}
  </section>;
}
