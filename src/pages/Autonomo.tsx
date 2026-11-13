import { useEffect, useRef, useState } from "react";
import { lancarAutonomos, lerAutonomos, type EmpresaAutonomo } from "@/lib/autonomo";

const input="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";
const normalizar=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
const dinheiro=(n:number)=>(n/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
function ultimaData(ano:number,mes:number){const d=new Date(0);d.setFullYear(ano,mes,0);return `${String(ano).padStart(4,"0")}-${String(mes).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

export default function Autonomo() {
  const [empresa,setEmpresa]=useState("");const [competencia,setCompetencia]=useState("");const [textoCompetencia,setTextoCompetencia]=useState("");const [data,setData]=useState("");
  const [resultado,setResultado]=useState<EmpresaAutonomo|null>(null);const [erro,setErro]=useState("");const [loading,setLoading]=useState(false);
  const controller=useRef<AbortController|null>(null), versao=useRef(0);
  useEffect(()=>()=>{controller.current?.abort();versao.current++;},[]);
  const invalidar=()=>{controller.current?.abort();controller.current=null;versao.current++;setResultado(null);setErro("");setLoading(false);};
  const limpar=()=>{invalidar();setEmpresa("");setCompetencia("");setTextoCompetencia("");setData("");};
  const ready=!!(empresa.trim()&&competencia&&data);
  const carregar=async(file:File)=>{
    invalidar();const current=new AbortController();controller.current=current;setLoading(true);
    try{
      const companies=await lerAutonomos(file,current.signal);if(current.signal.aborted)return;
      const match=companies.filter(c=>c.codigo===empresa.trim()||normalizar(c.nome).includes(normalizar(empresa)));
      if(match.length!==1)throw new Error(match.length?"Mais de uma empresa corresponde ao nome. Informe o código ou nome completo.":"Empresa não encontrada. Confira o nome ou código.");
      const found=match[0];if(found.problemas.length)throw new Error(found.problemas.join(" "));
      if(!found.pessoas.length)throw new Error("Nenhum profissional encontrado na empresa selecionada.");
      if(found.pessoas.some(p=>p.competencia!==competencia))throw new Error("A competência selecionada não corresponde aos registros da empresa no PDF.");
      setResultado(found);
    }catch(e){if(!current.signal.aborted)setErro(e instanceof Error?e.message:"Não foi possível ler o PDF.");}finally{if(controller.current===current){controller.current=null;setLoading(false);}}
  };
  const calculo=resultado?lancarAutonomos(resultado.pessoas):null;
  const baixar=async()=>{
    if(!resultado||!calculo||calculo.pendencias.length)return;
    const current=versao.current;const ExcelJS=(await import("exceljs")).default;const wb=new ExcelJS.Workbook();const sh=wb.addWorksheet("Planilha1");
    sh.addRow(["DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);
    const [year,month,day]=data.split("-").map(Number), date=new Date(year,month-1,day);
    for(const l of calculo.lancamentos)sh.addRow([date,l.valor/100,Number(l.debito),Number(l.credito),"",l.historico]);
    sh.getColumn(1).numFmt="dd/mm/yyyy";sh.getColumn(2).numFmt="#,##0.00";[15,18,15,15,16,70].forEach((n,i)=>{sh.getColumn(i+1).width=n;});
    const bytes=await wb.xlsx.writeBuffer(), raw=bytes as unknown as ArrayBuffer|Uint8Array;
    const clear=()=>{if(raw instanceof Uint8Array)raw.fill(0);else new Uint8Array(raw).fill(0);};
    if(current!==versao.current){clear();return;}const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));clear();
    const link=document.createElement("a");link.href=url;link.download=`autonomo-${resultado.codigo}-${competencia}-importacao.xlsx`;link.click();URL.revokeObjectURL(url);limpar();
  };
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-3 text-3xl font-semibold">Autônomo</h1><p className="mt-2 text-muted-foreground">Informe a empresa e a competência e selecione o relatório de pagamento de pessoa física.</p></div>
    <div className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2">
      <label className="text-sm font-medium">Empresa (nome ou código)<input className={input} value={empresa} onChange={e=>{invalidar();setEmpresa(e.target.value);}} /></label>
      <div><label className="text-sm font-medium">Competência<input className={input} type="text" inputMode="numeric" placeholder="MM/AAAA" maxLength={7} value={textoCompetencia} aria-invalid={textoCompetencia.length===7&&!competencia} onChange={e=>{const digits=e.target.value.replace(/\D/g,"").slice(0,6);const m=Number(digits.slice(0,2)),y=Number(digits.slice(2));const ok=digits.length===6&&m>=1&&m<=12&&y>0;invalidar();setTextoCompetencia(digits.length>2?`${digits.slice(0,2)}/${digits.slice(2)}`:digits);setCompetencia(ok?`${digits.slice(2)}-${digits.slice(0,2)}`:"");setData(ok?ultimaData(y,m):"");}} /></label><p className="mt-1 text-xs text-muted-foreground">Digite mês e ano, por exemplo 092026.</p></div>
      <div><label className="text-sm font-medium">Data dos lançamentos<input className={input} type="date" value={data} onChange={e=>{invalidar();setData(e.target.value);}} /></label><p className="mt-1 text-xs text-muted-foreground">Sugerimos o último dia da competência; você pode alterar.</p></div>
      <div className="sm:col-span-2"><label className="block text-sm font-medium">PDF de autônomos<input type="file" className={input} accept=".pdf,application/pdf" disabled={!ready||loading} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file&&ready)void carregar(file);}} /></label>{!ready&&<p className="mt-1 text-xs text-muted-foreground">Informe empresa, competência e data para anexar o PDF.</p>}</div>
      <p className="text-sm text-muted-foreground sm:col-span-2">Os dados são processados no navegador e a tela é limpa após o download ou ao clicar em Limpar dados.</p><button type="button" className="text-left text-sm text-muted-foreground underline" onClick={limpar}>Limpar dados</button>
    </div>
    {loading&&<p role="status">Lendo o PDF...</p>}{erro&&<p role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">{erro}</p>}
    {resultado&&calculo&&<div className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Conferência: {resultado.codigo} — {resultado.nome}</h2>
      <p>{resultado.pessoas.length} profissional(is) · Bruto: <strong>{dinheiro(resultado.totais.bruto!)}</strong> · INSS: <strong>{dinheiro(resultado.totais.inss!)}</strong> · IRRF: <strong>{dinheiro(resultado.totais.irrf!)}</strong> · Líquido: <strong>{dinheiro(resultado.totais.liquido!)}</strong></p>
      {calculo.pendencias.length>0&&<div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"><p className="font-semibold">Resolva as pendências antes de baixar:</p><ul className="list-disc pl-5">{calculo.pendencias.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}
      <details><summary className="cursor-pointer font-medium">Ver lançamentos ({calculo.lancamentos.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Valor</th></tr></thead><tbody>{calculo.lancamentos.map((l,i)=><tr key={i} className="border-t"><td className="py-2 pr-3">{l.historico}</td><td>{l.debito}</td><td>{l.credito}</td><td>{dinheiro(l.valor)}</td></tr>)}</tbody></table></div></details>
      <button type="button" disabled={!!calculo.pendencias.length} onClick={()=>void baixar()} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Baixar planilha de importação</button>
    </div>}
  </section>;
}
