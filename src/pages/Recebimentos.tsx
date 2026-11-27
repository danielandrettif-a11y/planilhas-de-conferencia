import {useEffect,useRef,useState} from "react";
import {analisarRecebimentos,alertasRecebimento,bloqueado,gerarLancamentosRecebimentos,dataImportacao,competenciaValida,bancos,agruparRecebimentosPorBanco,ordemBancos,type Banco,type ResultadoRecebimentos} from "@/lib/recebimentos";
import type {Linha} from "@/lib/faturamento";
const moeda=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v/100);
const coresBanco:Record<Banco,{fundo:string;borda:string}>={bradesco:{fundo:"FFFCE8E8",borda:"FFB91C1C"},sicoob:{fundo:"FFE5F4EB",borda:"FF15803D"},brasil:{fundo:"FFFFF4CC",borda:"FFB38B00"}};
const botao="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50";
export default function Recebimentos(){
 const [r,setR]=useState<ResultadoRecebimentos|null>(null),[comp,setComp]=useState(""),[confirmado,setConfirmado]=useState(false),[ocupado,setOcupado]=useState(false),[erro,setErro]=useState(""),[status,setStatus]=useState("");
 const mes=/^(0[1-9]|1[0-2])\/\d{4}$/.test(comp)?comp.slice(3)+"-"+comp.slice(0,2):"";
 const valido=competenciaValida(mes);
 const campo=useRef<HTMLInputElement>(null),versao=useRef(0),urls=useRef(new Set<string>());
 useEffect(()=>()=>{versao.current++;urls.current.forEach(u=>URL.revokeObjectURL(u));},[]);
 const limpar=()=>{versao.current++;setR(null);setComp("");setConfirmado(false);setOcupado(false);setErro("");setStatus("");if(campo.current)campo.current.value="";};
 async function ler(file:File){
  if(!valido)return;
  versao.current++;setR(null);setConfirmado(false);setErro("");setStatus("");const v=versao.current;setOcupado(true);let bytes:Uint8Array|undefined;let abas:Linha[][]=[];
  try{const X=await import("xlsx");bytes=new Uint8Array(await file.arrayBuffer());if(v!==versao.current)return;
   const w=X.read(bytes,{type:"array",cellDates:false,cellFormula:false,cellHTML:false,cellText:false});
   abas=w.SheetNames.map(n=>X.utils.sheet_to_json<Linha>(w.Sheets[n],{header:1,raw:true,blankrows:true}));
   const resultado=analisarRecebimentos(abas,!!w.Workbook?.WBProps?.date1904);setR(resultado);
  }catch(e){if(v===versao.current)setErro(e instanceof Error&&/^(Aba |Nenhum recebimento)/.test(e.message)?e.message:"Não foi possível ler o relatório.");}
  finally{bytes?.fill(0);abas.forEach(a=>a.forEach(l=>l.fill(null)));if(v===versao.current){setOcupado(false);if(campo.current)campo.current.value="";}}
 }
 const alertas=r?.registros.filter(x=>alertasRecebimento(x,mes).length)??[];
 const bloqueios=r?.registros.filter(bloqueado).length??0;
 const total=r?.registros.reduce((s,x)=>s+x.baixado,0)??0;
 async function baixar(){
  if(!r||!confirmado||bloqueios||ocupado||!valido)return;
  const v=++versao.current;setOcupado(true);setErro("");let bytes:Uint8Array|undefined;
  try{
   const lanc=gerarLancamentosRecebimentos(r.registros,mes);
   const ExcelJS=(await import("exceljs")).default;if(v!==versao.current)return;
   const w=new ExcelJS.Workbook(),s=w.addWorksheet("Planilha1"),c=w.addWorksheet("Conferência");
   s.addRow(["DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);
   const blocos=new Map<Banco,{inicio:number;fim:number;quantidade:number}>();
   let anterior:Banco|undefined;
   for(const l of lanc){const row=s.addRow([l.data,l.valor,l.debito,l.credito,l.doc,l.historico]);
   const banco=l.origem.banco,cor=coresBanco[banco],inicio=banco!==anterior;
   const bloco=blocos.get(banco);
   if(bloco){bloco.fim=row.number;bloco.quantidade++;}else blocos.set(banco,{inicio:row.number,fim:row.number,quantidade:1});
   for(let i=1;i<=6;i++){const cell=row.getCell(i);cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:cor.fundo}};if(inicio)cell.border={top:{style:"medium",color:{argb:cor.borda}}};}
   row.getCell(3).note="Banco: "+bancos[banco]+". Preencha a conta conforme o tipo de lançamento.";
   if(inicio){row.getCell(2).note="INÍCIO DO BLOCO — "+bancos[banco];}
   anterior=banco;
   if(l.data!==l.origem.data){row.getCell(1).note="Data original: "+new Date(Date.UTC(1899,11,30)+l.origem.data*86400000).toLocaleDateString("pt-BR",{timeZone:"UTC"}); }if(alertasRecebimento(l.origem,mes).length){row.getCell(6).note=alertasRecebimento(l.origem,mes).join("; ");row.getCell(6).font={color:{argb:"FFC00000"}};}if(new Date(Date.UTC(1899,11,30)+l.data*86400000).toISOString().slice(0,7)!==mes)row.getCell(1).font={color:{argb:"FFC00000"},bold:true};}
   s.getColumn(1).numFmt="dd/mm/yyyy";s.getColumn(2).numFmt="#,##0.00";s.getColumn(5).numFmt="@";[15,18,15,15,18,95].forEach((n,i)=>s.getColumn(i+1).width=n);
   c.addRow(["ABA","LINHA","TÍTULO","CLIENTE","DATA BAIXA","BANCO","ORIGINAL","LÍQUIDO","BAIXADO","JUROS","DESCONTO","DIFERENÇA","TIPO","OBSERVAÇÃO","AVISOS","DATA IMPORTAÇÃO"]);
   for(const x of agruparRecebimentosPorBanco(r.registros)){const a=alertasRecebimento(x,mes);const row=c.addRow([x.aba,x.linha,x.titulo,x.nome,x.data,bancos[x.banco],x.original/100,x.liquido/100,x.baixado/100,x.juros/100,x.desconto/100,(x.liquido+x.juros-x.desconto-x.baixado)/100,x.tipo,x.observacao,a.join("; "),dataImportacao(x.data,mes)]);if(a.length)row.getCell(15).font={color:{argb:"FFC00000"}};}
   c.getColumn(5).numFmt="dd/mm/yyyy";c.getColumn(16).numFmt="dd/mm/yyyy";c.getColumn(16).width=20;for(let i=7;i<=12;i++)c.getColumn(i).numFmt="#,##0.00";[9,9,18,45,15,20,16,16,16,16,16,16,35,70,80].forEach((n,i)=>c.getColumn(i+1).width=n);
   c.views=[{state:"frozen",ySplit:1}];c.autoFilter={from:"A1",to:"P"+(r.registros.length+1)};c.getRow(1).font={bold:true};
   for(const aviso of r.avisos)c.addRow(["","","","","","","","","","","","","","",aviso]);
   c.addRow([]);
   const legenda=c.addRow(["BLOCOS NA ABA PLANILHA1","LINHA INICIAL","LINHA FINAL","LANÇAMENTOS"]);
   legenda.font={bold:true};
   for(const b of ordemBancos){const bloco=blocos.get(b);if(!bloco)continue;const row=c.addRow([bancos[b],bloco.inicio,bloco.fim,bloco.quantidade]);for(let i=1;i<=4;i++)row.getCell(i).fill={type:"pattern",pattern:"solid",fgColor:{argb:coresBanco[b].fundo}};}
   bytes=new Uint8Array(await w.xlsx.writeBuffer() as unknown as ArrayBuffer);if(v!==versao.current)return;
   const u=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));urls.current.add(u);const a=document.createElement("a");a.href=u;a.download="Recebimentos - "+mes+".xlsx";document.body.appendChild(a);try{a.click();}finally{a.remove();setTimeout(()=>{URL.revokeObjectURL(u);urls.current.delete(u);},1000);}
   setStatus("Download iniciado: "+lanc.length+" lançamentos. Blocos por banco identificados por cor e na legenda da Conferência. Preencha débito e crédito antes de importar somente a aba Planilha1.");
  }catch{if(v===versao.current)setErro("Não foi possível gerar. Confira a competência e os valores.");}
  finally{bytes?.fill(0);if(v===versao.current){setR(null);setComp("");setConfirmado(false);setOcupado(false);}}
 }
 return <section className="space-y-5">
 <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-2 text-3xl font-semibold">Recebimentos Bancários</h1><p className="mt-2 text-muted-foreground">Valide baixas, juros e descontos e gere a importação do Alterdata.</p></div>
 <div className="rounded-2xl border bg-card p-5 space-y-4"><label className="block text-sm font-medium">Competência (MM/AAAA)<input inputMode="numeric" placeholder="10/2026" maxLength={7} value={comp} disabled={ocupado} onChange={e=>{const d=e.target.value.replace(/\D/g,"").slice(0,6);setComp(d.length>2?d.slice(0,2)+"/"+d.slice(2):d);setConfirmado(false);}} className="mt-2 block w-full rounded-lg border bg-background p-3"/></label><label className="block text-sm font-medium">Relatório de recebimentos<input ref={campo} type="file" accept=".xls,.xlsx,.ods" disabled={ocupado||!valido} className="mt-2 block w-full rounded-lg border p-3" onChange={e=>{const f=e.target.files?.[0];if(f)void ler(f);}}/></label>
 <p className="text-xs text-muted-foreground">Os arquivos são processados localmente. Nenhum dado é enviado ou armazenado pelo site.</p>
 <p className="text-sm text-muted-foreground">Débito e crédito serão deixados em branco. Os lançamentos serão agrupados por banco e identificados por cores, com legenda na Conferência.</p>
 <button type="button" className="text-sm underline" onClick={limpar}>Limpar / cancelar</button></div>
 {r&&<div className="space-y-4 rounded-2xl border bg-card p-5"><div className="grid grid-cols-2 gap-3"><div>Recebimentos<strong className="block text-2xl">{r.registros.length}</strong></div><div>Total baixado<strong className="block text-xl">{moeda(total)}</strong></div><div>Juros<strong className="block">{moeda(r.registros.reduce((s,x)=>s+x.juros,0))}</strong></div><div>Descontos<strong className="block">{moeda(r.registros.reduce((s,x)=>s+x.desconto,0))}</strong></div></div>
 <div className="space-y-1 text-sm">{(Object.keys(bancos) as (keyof typeof bancos)[]).map(b=><p key={b}>{bancos[b]}: {moeda(r.registros.filter(x=>x.banco===b).reduce((s,x)=>s+x.baixado,0))}</p>)}</div>
 <p className="text-sm">Datas ajustadas para o primeiro dia: {valido?r.registros.filter(x=>dataImportacao(x.data,mes)!==x.data).length:0}</p>
 <p className="text-sm">Validação: líquido + juros − desconto = baixado. {r.subtotais} totais conferidos. {bloqueios} divergências impeditivas.</p>
 {r.avisos.map((a,i)=><p key={i} className="text-sm text-amber-600">{a}</p>)}
 <h2 className="font-semibold">Registros para revisão ({alertas.length})</h2><div className="max-h-80 overflow-auto divide-y">{alertas.map(x=><div key={x.aba+":"+x.linha} className="py-2 text-sm"><strong>Aba {x.aba}, linha {x.linha} · {x.titulo}</strong><p>{alertasRecebimento(x,mes).join(" ")}</p>{x.observacao&&<p className="text-muted-foreground">{x.observacao}</p>}</div>)}</div>
 <p className="text-sm">Baixas do último dia do mês anterior passam para o primeiro dia da competência; as demais datas são mantidas. A conferência preserva as datas originais. Devoluções e observações não geram lançamentos automaticamente. Confira a aba Conferência. Importe somente Planilha1.</p>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmado} disabled={ocupado||!!bloqueios} onChange={e=>setConfirmado(e.target.checked)}/> Conferi as exceções e estou ciente de que devo preencher débito e crédito.</label>
 <button type="button" className={botao} disabled={!confirmado||!!bloqueios||ocupado||!valido} onClick={()=>void baixar()}>Gerar e baixar importação</button></div>}
 {erro&&<p role="alert" className="text-destructive">{erro}</p>}{status&&<p role="status">{status}</p>}
 </section>;
}
