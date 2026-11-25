import { baixarPdf, baixarZip, separarPdf, nomeArquivo, type ArquivoZip } from "@/lib/arquivos";
import { SeletorEmpresas, PainelLote, useSelecaoEmpresas, resolverLote, baixarLote, type ItemLote } from "@/components/SelecaoEmpresas";
import { useEffect, useRef, useState } from "react";
import { lancarAutonomos, lerAutonomos, type EmpresaAutonomo } from "@/lib/autonomo";

const input="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";
const normalizar=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
const dinheiro=(n:number)=>(n/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
function ultimaData(ano:number,mes:number){const d=new Date(0);d.setFullYear(ano,mes,0);return `${String(ano).padStart(4,"0")}-${String(mes).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

export default function Autonomo() {
  const selecao=useSelecaoEmpresas();const [lote,setLote]=useState<ItemLote<EmpresaAutonomo>[]>([]);
  const [empresa,setEmpresa]=useState("");const [competencia,setCompetencia]=useState("");const [textoCompetencia,setTextoCompetencia]=useState("");const [data,setData]=useState("");
  const [downloads,setDownloads]=useState<string[]>([]);
  const [gerandoZip,setGerandoZip]=useState(false);
  const [resultado,setResultado]=useState<EmpresaAutonomo|null>(null);const [erro,setErro]=useState("");const [loading,setLoading]=useState(false);
  const controller=useRef<AbortController|null>(null), versao=useRef(0), pdfOriginal=useRef<File|null>(null);
  useEffect(()=>()=>{controller.current?.abort();versao.current++;},[]);
  const invalidar=()=>{setLote([]);controller.current?.abort();controller.current=null;versao.current++;pdfOriginal.current=null;setDownloads([]);setResultado(null);setErro("");setLoading(false);};
  const limpar=()=>{selecao.limparSelecao();invalidar();setEmpresa("");setCompetencia("");setTextoCompetencia("");setData("");};
  const ready=!!((selecao.multipla?selecao.lista.length>0&&!empresa.trim():empresa.trim())&&competencia&&data);
  const carregar=async(file:File)=>{
    invalidar();const current=new AbortController();controller.current=current;setLoading(true);
    try{
      const companies=await lerAutonomos(file,current.signal);if(current.signal.aborted)return;
      if(selecao.multipla){const itens=resolverLote(selecao.lista,companies,e=>{const found=companies.find(c=>c.codigo===e.codigo)!;if(found.problemas.length)throw new Error(found.problemas.join(" "));if(!found.pessoas.length)throw new Error("Nenhum profissional encontrado.");if(found.pessoas.some(p=>p.competencia!==competencia))throw new Error("Competência incompatível com o PDF.");const calc=lancarAutonomos(found.pessoas);if(calc.pendencias.length)throw new Error(calc.pendencias.join("; "));return found;});pdfOriginal.current=file;setLote(itens);return;}
      const match=companies.filter(c=>c.codigo===empresa.trim()||normalizar(c.nome).includes(normalizar(empresa)));
      if(match.length!==1)throw new Error(match.length?"Mais de uma empresa corresponde ao nome. Informe o código ou nome completo.":"Empresa não encontrada. Confira o nome ou código.");
      const found=match[0];if(found.problemas.length)throw new Error(found.problemas.join(" "));
      if(!found.pessoas.length)throw new Error("Nenhum profissional encontrado na empresa selecionada.");
      if(found.pessoas.some(p=>p.competencia!==competencia))throw new Error("A competência selecionada não corresponde aos registros da empresa no PDF.");
      pdfOriginal.current=file;setResultado(found);
    }catch(e){if(!current.signal.aborted)setErro(e instanceof Error?e.message:"Não foi possível ler o PDF.");}finally{if(controller.current===current){controller.current=null;setLoading(false);}}
  };
  const calculo=resultado?lancarAutonomos(resultado.pessoas):null;
  const baixar=async(coletar=false, resultadoSelecionado=resultado):Promise<Uint8Array|undefined>=>{
    const resultado=resultadoSelecionado;const calculo=resultado?lancarAutonomos(resultado.pessoas):null;
    if(!resultado||!calculo||calculo.pendencias.length)return;
    const current=versao.current;const ExcelJS=(await import("exceljs")).default;const wb=new ExcelJS.Workbook();const sh=wb.addWorksheet("Planilha1");
    sh.addRow(["DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);
    const [year,month,day]=data.split("-").map(Number), date=new Date(year,month-1,day);
    for(const l of calculo.lancamentos)sh.addRow([date,l.valor/100,Number(l.debito),Number(l.credito),"",l.historico]);
    sh.addRow([]).height=10;
    const aviso=sh.addRow(["ATENÇÃO: confira se há pró-labore e ajuste as contas e os históricos conforme a tabela. Substitua **** pelo nome do sócio. APAGUE AS 5 LINHAS DE AVISO antes de importar."]);
    sh.mergeCells(aviso.number,1,aviso.number,6);
    aviso.height=36;
    const avisoCelula=aviso.getCell(1);
    avisoCelula.font={bold:true,color:{argb:"FF9C0006"},size:11};
    avisoCelula.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFE699"}};
    avisoCelula.alignment={vertical:"middle",wrapText:true};
    const cabecalho=sh.addRow(["LANÇAMENTO","DÉBITO","CRÉDITO","HISTÓRICO SUGERIDO"]);
    const referenciaMes=`${competencia.slice(5,7)}/${competencia.slice(0,4)}`;
    const referencias=[
      ["Remuneração","2009","1260",`VALOR REFERENTE PRÓ-LABORE SÓCIO **** REFERENTE AO MÊS ${referenciaMes}.`],
      ["INSS","1260","1274",`VALOR INSS S/ PRÓ-LABORE SÓCIO **** REFERENTE AO MÊS ${referenciaMes}.`],
      ["IRRF","1260","1162",`VALOR IRRF S/ PRÓ-LABORE SÓCIO **** REFERENTE AO MÊS ${referenciaMes}.`],
    ];
    const linhasReferencia=referencias.map(linha=>sh.addRow(linha));
    for(const linha of [cabecalho,...linhasReferencia])sh.mergeCells(linha.number,4,linha.number,6);
    for(const linha of [cabecalho,...linhasReferencia]){
      linha.height=32;
      linha.eachCell(celula=>{
        celula.fill={type:"pattern",pattern:"solid",fgColor:{argb:linha===cabecalho?"FFFFD966":"FFFFF2CC"}};
        celula.font={bold:linha===cabecalho,color:{argb:"FF4A3200"},size:10};
        celula.alignment={vertical:"middle",wrapText:true};
      });
    }
    sh.getColumn(1).numFmt="dd/mm/yyyy";sh.getColumn(2).numFmt="#,##0.00";[15,18,15,15,16,70].forEach((n,i)=>{sh.getColumn(i+1).width=n;});
    const bytes=await wb.xlsx.writeBuffer(), raw=bytes as unknown as ArrayBuffer|Uint8Array;
    const clear=()=>{if(raw instanceof Uint8Array)raw.fill(0);else new Uint8Array(raw).fill(0);};
    if(current!==versao.current){clear();return;}if(coletar)return raw instanceof Uint8Array?raw:new Uint8Array(raw);const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));clear();
    const link=document.createElement("a");link.href=url;link.download=nomeArquivo("Autônomo",resultado.nome,competencia,"xlsx","Importação");link.click();URL.revokeObjectURL(url);const next=[...new Set([...downloads,"importacao"])];setDownloads(next);if(next.length===2)limpar();
  };
  const downloadPdf=async()=>{if(!resultado||!pdfOriginal.current)return;const current=versao.current;try{const ok=await baixarPdf(pdfOriginal.current,resultado.paginas ?? [],nomeArquivo("Autônomo",resultado.nome,competencia,"pdf"),()=>current===versao.current);if(ok){const next=[...new Set([...downloads,"pdf"])];setDownloads(next);if(next.length===2)limpar();}}catch(e){if(current===versao.current)setErro(e instanceof Error?e.message:"Não foi possível separar o PDF.");}};
  const downloadZip=async()=>{if(!resultado||!pdfOriginal.current||!calculo||calculo.pendencias.length||gerandoZip)return;const current=versao.current,arquivos:ArquivoZip[]=[],nome=resultado.nome;setGerandoZip(true);setErro("");try{arquivos.push({nome:nomeArquivo("Autônomo",nome,competencia,"pdf"),bytes:await separarPdf(pdfOriginal.current,resultado.paginas ?? [])});if(current!==versao.current)return;const bytes=await baixar(true);if(!bytes)return;arquivos.push({nome:nomeArquivo("Autônomo",nome,competencia,"xlsx","Importação"),bytes});if(await baixarZip(arquivos,nomeArquivo("Autônomo",nome,competencia,"zip","Todos os arquivos"),()=>current===versao.current))limpar();}catch(e){if(current===versao.current)setErro(e instanceof Error?e.message:"Não foi possível gerar o ZIP.");}finally{arquivos.forEach(a=>a.bytes.fill(0));setGerandoZip(false);}};
  const baixarTodas=async()=>{if(!pdfOriginal.current||gerandoZip)return;const current=versao.current;setGerandoZip(true);setErro("");try{if(await baixarLote("Autônomo",competencia,lote,pdfOriginal.current,r=>r.paginas??[],async r=>{const bytes=await baixar(true,r);if(!bytes)throw new Error("Geração cancelada.");return [{nome:nomeArquivo("Autônomo",r.nome,competencia,"xlsx","Importação"),bytes}]},()=>current===versao.current))limpar()}catch(e){if(current===versao.current)setErro(e instanceof Error?e.message:"Não foi possível gerar o ZIP.")}finally{setGerandoZip(false)}};
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-3 text-3xl font-semibold">Autônomo</h1><p className="mt-2 text-muted-foreground">Informe a empresa e a competência e selecione o relatório de pagamento de pessoa física.</p></div>
    <div className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2">
      <SeletorEmpresas empresa={empresa} setEmpresa={setEmpresa} selecao={selecao} invalidar={invalidar} inputClass={input} disabled={loading||gerandoZip} />
      <div><label className="text-sm font-medium">Competência<input className={input} type="text" inputMode="numeric" placeholder="MM/AAAA" maxLength={7} value={textoCompetencia} aria-invalid={textoCompetencia.length===7&&!competencia} onChange={e=>{const digits=e.target.value.replace(/\D/g,"").slice(0,6);const m=Number(digits.slice(0,2)),y=Number(digits.slice(2));const ok=digits.length===6&&m>=1&&m<=12&&y>0;invalidar();setTextoCompetencia(digits.length>2?`${digits.slice(0,2)}/${digits.slice(2)}`:digits);setCompetencia(ok?`${digits.slice(2)}-${digits.slice(0,2)}`:"");setData(ok?ultimaData(y,m):"");}} /></label><p className="mt-1 text-xs text-muted-foreground">Digite mês e ano, por exemplo 092026.</p></div>
      <div><label className="text-sm font-medium">Data dos lançamentos<input className={input} type="date" value={data} onChange={e=>{invalidar();setData(e.target.value);}} /></label><p className="mt-1 text-xs text-muted-foreground">Sugerimos o último dia da competência; você pode alterar.</p></div>
      <div className="sm:col-span-2"><label className="block text-sm font-medium">PDF de autônomos<input type="file" className={input} accept=".pdf,application/pdf" disabled={!ready||loading||gerandoZip} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file&&ready)void carregar(file);}} /></label>{!ready&&<p className="mt-1 text-xs text-muted-foreground">Informe empresa, competência e data para anexar o PDF.</p>}</div>
      <p className="text-sm text-muted-foreground sm:col-span-2">Os dados são processados no navegador e a tela é limpa após baixar os dois arquivos ou o ZIP, ou ao clicar em Limpar dados.</p><button type="button" className="text-left text-sm text-muted-foreground underline" onClick={limpar}>Limpar dados</button>
    </div>
    {loading&&<p role="status">Lendo o PDF...</p>}{erro&&<p role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">{erro}</p>}
    {lote.length>0&&<PainelLote itens={lote} gerando={gerandoZip} baixar={()=>void baixarTodas()} aviso="Confira possíveis lançamentos de pró-labore em cada planilha. Ajuste as contas e históricos e apague as 5 linhas de aviso antes de importar." />}
    {resultado&&calculo&&<div className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Conferência: {resultado.codigo} — {resultado.nome}</h2>
      <p>{resultado.pessoas.length} profissional(is) · Bruto: <strong>{dinheiro(resultado.totais.bruto!)}</strong> · INSS: <strong>{dinheiro(resultado.totais.inss!)}</strong> · IRRF: <strong>{dinheiro(resultado.totais.irrf!)}</strong> · Líquido: <strong>{dinheiro(resultado.totais.liquido!)}</strong></p>
      {calculo.pendencias.length>0&&<div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"><p className="font-semibold">Resolva as pendências antes de baixar:</p><ul className="list-disc pl-5">{calculo.pendencias.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}
      <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><strong>Confira antes de importar:</strong> verifique se algum lançamento é de pró-labore e ajuste os lançamentos necessários. Ao final da planilha, consulte as contas e os históricos sugeridos e apague as 5 linhas de aviso antes de importar.</div>
      <details><summary className="cursor-pointer font-medium">Ver lançamentos ({calculo.lancamentos.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Histórico</th><th>Débito</th><th>Crédito</th><th>Valor</th></tr></thead><tbody>{calculo.lancamentos.map((l,i)=><tr key={i} className="border-t"><td className="py-2 pr-3">{l.historico}</td><td>{l.debito}</td><td>{l.credito}</td><td>{dinheiro(l.valor)}</td></tr>)}</tbody></table></div></details>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={gerandoZip} onClick={()=>void downloadPdf()} className="mr-3 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Baixar PDF da empresa</button>
      <button type="button" disabled={!!calculo.pendencias.length || gerandoZip} onClick={()=>void baixar()} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Baixar planilha de importação</button><button type="button" disabled={!!calculo.pendencias.length || gerandoZip} onClick={()=>void downloadZip()} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{gerandoZip?"Gerando ZIP...":"Baixar todos em ZIP"}</button></div>
      {calculo.pendencias.length>0&&<p className="text-sm text-muted-foreground">O ZIP fica disponível quando as pendências de importação forem resolvidas.</p>}
    </div>}
  </section>;
}
