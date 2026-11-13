import { useEffect, useRef, useState } from "react";
import { calcularFolha, codigoEfetivoFolha, lerFolha, type EmpresaFolha, type ResultadoFolha } from "@/lib/folha";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", {style:"currency",currency:"BRL"});
const normalize = (s:string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const input = "mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";
const button = "rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50";
function ultimoDiaDoMes(competencia: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) return "";
  const [ano, mes] = competencia.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(ano, mes, 0);
  return `${competencia}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function FolhaPagamento() {
  const [empresa, setEmpresa] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [competenciaDigitada, setCompetenciaDigitada] = useState("");
  const [data, setData] = useState("");
  const [doc, setDoc] = useState("");
  const [resultado, setResultado] = useState<{empresa:EmpresaFolha; calculo:ResultadoFolha}|null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [baixados, setBaixados] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { controller.current?.abort(); generation.current++; }, []);
  const invalidate = () => {controller.current?.abort();controller.current=null;generation.current++;setLoading(false);setResultado(null);setErro("");setBaixados([]);};
  const reset = () => {controller.current?.abort();controller.current=null;generation.current++;setLoading(false);setEmpresa("");setCompetencia("");setCompetenciaDigitada("");setData("");setDoc("");setResultado(null);setErro("");setBaixados([]);};
  const processar = async (file:File) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    generation.current++;
    setResultado(null);setErro("");setBaixados([]);setLoading(true);
    try {
      const all=await lerFolha(file, current.signal);
      if (current.signal.aborted) return;
      const found=all.filter(e=> e.codigo===empresa.trim() || normalize(e.nome).includes(normalize(empresa)));
      if(found.length!==1) throw new Error(found.length ? `Mais de uma empresa encontrada (${found.map(e=>`${e.codigo} - ${e.nome}`).join("; ")}). Informe o código ou nome completo.` : "Empresa não encontrada. Confira o código ou nome informado.");
      const company=found[0];
      if(company.competencia!==competencia) throw new Error(`A competência do PDF (${company.competencia}) não corresponde à selecionada (${competencia}).`);
      if(company.errosLeitura.length) throw new Error(company.errosLeitura.join(" "));
      if(company.liquido===null || !company.eventos.length) throw new Error("O relatório não possui líquido ou eventos identificáveis para esta empresa.");
      setResultado({empresa:company,calculo:calcularFolha(company)});
    } catch(e) {if (!current.signal.aborted) setErro(e instanceof Error?e.message:"Não foi possível ler o PDF.");} finally {if (controller.current === current) {controller.current=null;setLoading(false);}}
  };
  const download = async (tipo:"importacao"|"conferencia") => {
    if(!resultado) return;
    const version = generation.current;
    const ExcelJS = (await import("exceljs")).default;
    const wb=new ExcelJS.Workbook();
    const {empresa:company, calculo}=resultado;
    const dateParts=data.split("-").map(Number); const date=new Date(dateParts[0],dateParts[1]-1,dateParts[2]);
    if(tipo==="importacao") {
      const sh=wb.addWorksheet("Planilha1");
      sh.addRow(["DATA","VALOR","DEBITO","CREDITO","Doc","HISTORICO"]);
      for(const l of calculo.lancamentos) sh.addRow([date,l.valor/100,Number(l.debito),Number(l.credito),doc,l.historico]);
      sh.getColumn(1).numFmt="dd/mm/yyyy";sh.getColumn(2).numFmt="#,##0.00";
      [15,18,15,15,16,65].forEach((n,i)=>{sh.getColumn(i+1).width=n;});
    } else {
      const sh=wb.addWorksheet("FOLHA");
      const details=wb.addWorksheet("planilha folha");
      const headers=["VR. BRUTO - CLC 1000","SALÁRIO MATERNIDADE - CLC 1004","SALÁRIO FAMÍLIA - CLC 1002","PLANO DE SAÚDE - CLC 1006","FALTAS - CLC 1007","INSS FUNCIONÁRIO - CLC 1008","ASSOCIADOS - CLC 1009","CONTRIBUIÇÃO SINDICAL","PENSÃO - CLC 1011","SEGURO DE VIDA - CLC 1012","RECEBIDOS - CLC 1015","VALE-TRANSPORTE - CLC 1013","MEDICAMENTOS","ALIMENTAÇÃO - CLC 1016","IRRF - CLC 1017","INSS/EMPRESA","FGTS","DEVOLUÇÃO INSS","EMPRÉSTIMO GOV","EMPRÉSTIMO SANTANDER"];
      details.addRow(headers);
      const colByCode:Record<string,number>={"1000":1,"1004":2,"1002":3,"1006":4,"1007":5,"1008":6,"1009":7,"1011":9,"1012":10,"1015":11,"1013":12,"1016":14,"1017":15};
      const values:number[][]=headers.map(()=>[]); const excluded=new Set(calculo.ignorados);
      for(const e of company.eventos) {
        if(excluded.has(e)) continue;
        const col=e.clc==="1036" ? (/gov/i.test(e.descricao)?19:20) : colByCode[codigoEfetivoFolha(e)];
        if(col) values[col-1].push(e.valor/100);
      }
      // Mantém o espaço de 17 linhas do modelo, expandindo se houver mais eventos.
      const lines=Math.max(17,...values.map(v=>v.length));
      for(let i=0;i<lines;i++) details.addRow(values.map(v=>v[i] ?? null));
      const totalRow=lines+2;
      const total=details.getRow(totalRow);
      const bordaFina = {style:"thin" as const,color:{argb:"FF000000"}};
      const formatoContabil = '_-"R$ "* #,##0.00_-;\\-"R$ "* #,##0.00_-;_-"R$ "* \\-??_-;_-@_-';
      values.forEach((v,i)=>{const col=details.getColumn(i+1);col.width=17;col.numFmt=formatoContabil;const letter=col.letter;total.getCell(i+1).value={formula:`SUM(${letter}2:${letter}${totalRow-1})`,result:v.reduce((a,b)=>a+b,0)};});
      details.getRow(1).height=90;
      for(let r=1;r<=totalRow;r++) {
        const row=details.getRow(r);
        for(let c=1;c<=headers.length;c++) {
          const cell=row.getCell(c);
          cell.border={top:bordaFina,bottom:bordaFina,left:bordaFina,right:bordaFina};
          cell.font={name:"Calibri",size:10,bold:r===totalRow};
          cell.alignment={horizontal:r===1?"center":"right",vertical:"middle",wrapText:r===1};
        }
      }
      details.views=[{state:"frozen",ySplit:1,showGridLines:false}];
      sh.addRow(["PLANILHAS DE MOVIMENTOS", "", "", "", "", "FOLHA DE PAGAMENTO"]);
      sh.addRow([`EMPRESA: ${company.nome}`, "", "", "", "", `MÊS: ${competencia.slice(5)}/${competencia.slice(0,4)}`]);
      sh.addRow([]);sh.addRow(["","DEBITO","CREDITO","VALOR","DIA","HISTÓRICO"]);
      const cols:Record<string,string>={"ORDENADOS":"A","SALÁRIO-MATERNIDADE":"B","TRANSFERÊNCIA SALÁRIO-MATERNIDADE":"B","SALÁRIO-FAMÍLIA":"C","TRANSFERÊNCIA SALÁRIO-FAMÍLIA":"C","PLANO DE SAÚDE":"D","FALTAS":"E","INSS DOS FUNCIONÁRIOS":"F","ASSOCIADOS AO SINDICATO":"G","PENSÃO A RECOLHER":"I","SEGURO DE VIDA":"J","RECEBIDOS":"K","VALE-TRANSPORTE":"L","ALIMENTAÇÃO":"N","IRRF SOBRE SALÁRIOS":"O","EMPRÉSTIMO CONSIGNADO GOV":"S","EMPRÉSTIMO CONSIGNADO SANTANDER":"T"};
      for(const l of calculo.lancamentos) sh.addRow(["",Number(l.debito),Number(l.credito),{formula:`'planilha folha'!${cols[l.descricao]}${totalRow}`,result:l.valor/100},date,l.historico]);
      const line=sh.lastRow!.number+1;
      const terms=calculo.lancamentos.map((l,i)=>`${l.credito==="1239"?"+":l.debito==="1239"?"-":"+0*"}D${i+5}`).join("");
      sh.addRow(["","Total", "",{formula:terms.replace(/^\+/,""),result:calculo.liquidoCalculado/100}]);
      if (calculo.pendentes.length) {
        sh.addRow([]);
        sh.addRow(["","PENDÊNCIAS PARA REVISÃO", "", "", "", "Lançamentos abaixo não compõem o total. Informe as contas e ajuste a planilha antes de importar."]);
        for (const e of calculo.pendentes) sh.addRow(["", "", "", e.valor/100, date, `REVISAR: ${e.descricao} — CLC ${e.clc || "não informado"}`]);
      }
      // Segue o modelo enviado: cabeçalhos mesclados, quadro contábil
      // centralizado, bordas finas e históricos com quebra de linha.
      sh.mergeCells("A1:E1");
      sh.mergeCells("A2:E2");
      for (const cell of ["A1", "A2", "F1", "F2"]) {
        sh.getCell(cell).font = {name:"Arial",size:11,bold:true};
        sh.getCell(cell).alignment = {horizontal:cell.startsWith("F") ? "right" : "center",vertical:"middle",wrapText:true};
      }
      sh.getRow(1).height=20;
      sh.getRow(2).height=22;
      sh.getRow(4).height=25.5;
      [4,10,10,16,13,50].forEach((width,i)=>{sh.getColumn(i+1).width=width;});
      sh.getColumn(4).numFmt="#,##0.00";
      sh.getColumn(5).numFmt="[$-416]d/mmm";
      const thin = {style:"thin" as const, color:{argb:"FF000000"}};
      for (let rowNumber=4;rowNumber<=sh.rowCount;rowNumber++) {
        const row=sh.getRow(rowNumber);
        if (rowNumber > 4 && rowNumber < line) {
          const historico=String(row.getCell(6).value ?? "");
          row.height=Math.max(27, Math.ceil(historico.length/53)*13);
        }
        for (let col=2;col<=6;col++) {
          const cell=row.getCell(col);
          cell.border={top:thin,bottom:thin,left:thin,right:thin};
          cell.alignment={horizontal:"center",vertical:"middle",wrapText:true};
          cell.font={name:"Arial",size:col===6 ? 9 : 10,bold:rowNumber===4 || rowNumber>=line || col===2 || col===3};
        }
      }
      sh.mergeCells(line,2,line,3);
      sh.getRow(line).height=20;
      sh.views=[{state:"normal",showGridLines:false}];
      sh.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0};

    }
    const bytes=await wb.xlsx.writeBuffer();
    const dataBuffer = bytes as unknown as ArrayBuffer | Uint8Array;
    const clearBytes = () => { if (dataBuffer instanceof Uint8Array) dataBuffer.fill(0); else new Uint8Array(dataBuffer).fill(0); };
    if (version !== generation.current) { clearBytes(); return; }
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    clearBytes();
    const link=document.createElement("a");link.href=url;link.download=`folha-${company.codigo}-${competencia}-${tipo}.xlsx`;link.click();URL.revokeObjectURL(url);
    const next=[...new Set([...baixados,tipo])];setBaixados(next);if(next.length===2) reset();
  };
  const ready=empresa.trim() && competencia && data;
  const canExport=resultado && resultado.calculo.diferenca===0 && resultado.calculo.pendentes.length===0;
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Lançamento</p><h1 className="mt-3 text-3xl font-semibold">Folha de pagamento</h1><p className="mt-2 text-muted-foreground">Informe os dados, depois selecione o PDF da folha.</p></div>
    <div className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2">
      <label className="text-sm font-medium">Empresa (nome ou código)<input className={input} value={empresa} onChange={e=>{invalidate();setEmpresa(e.target.value);}} /></label>
      <div><label className="text-sm font-medium">Competência<input className={input} type="text" inputMode="numeric" placeholder="MM/AAAA" maxLength={7} value={competenciaDigitada} aria-describedby="competencia-ajuda" aria-invalid={competenciaDigitada.length===7 && !competencia} onChange={e=>{const numeros=e.target.value.replace(/\D/g,"").slice(0,6);const exibicao=numeros.length>2?`${numeros.slice(0,2)}/${numeros.slice(2)}`:numeros;const mes=numeros.slice(0,2),ano=numeros.slice(2);const valido=numeros.length===6 && Number(mes)>=1 && Number(mes)<=12 && Number(ano)>0;const iso=valido?`${ano}-${mes}`:"";invalidate();setCompetenciaDigitada(exibicao);setCompetencia(iso);setData(ultimoDiaDoMes(iso));}} /></label><p id="competencia-ajuda" className={`mt-1 text-xs ${competenciaDigitada.length===7 && !competencia ? "text-destructive" : "text-muted-foreground"}`}>{competenciaDigitada.length===7 && !competencia ? "Informe um mês entre 01 e 12 e um ano válido." : "Digite o mês e o ano, por exemplo: 092026."}</p></div>
      <div><label className="text-sm font-medium">Data dos lançamentos<input className={input} type="date" value={data} onChange={e=>{invalidate();setData(e.target.value);}} /></label><span className="mt-1 block text-xs font-normal text-muted-foreground">Sugerimos o último dia da competência; você pode alterar.</span></div>
      <div><label className="text-sm font-medium">Documento (opcional)<input className={input} value={doc} onChange={e=>{invalidate();setDoc(e.target.value);}} /></label><p className="mt-1 text-xs text-muted-foreground">Preenche a coluna Doc da planilha de importação. Pode ficar em branco.</p></div>
      <div className="sm:col-span-2">
        <label className="block text-sm font-medium">PDF da folha<input aria-describedby="pdf-ajuda" className={input} type="file" accept=".pdf,application/pdf" disabled={!ready || loading} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file && ready) void processar(file);}} /></label>
        <p id="pdf-ajuda" className="mt-2 text-xs text-muted-foreground">{!ready ? "Para anexar, informe a empresa, a competência e uma data válida." : "Selecione o PDF. Após a leitura, você poderá conferir e baixar as planilhas."}</p>
      </div>
      <p className="text-sm text-muted-foreground sm:col-span-2">Os dados ficam temporariamente nesta aba. Após os dois downloads, a tela é limpa. Os arquivos baixados permanecem no seu computador.</p>
      <button className="text-left text-sm text-muted-foreground underline" type="button" onClick={reset}>Limpar dados</button>
    </div>
    {loading && <p role="status">Lendo a folha...</p>}{erro && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">{erro}</p>}
    {resultado && <div className="space-y-4 rounded-2xl border bg-card p-6"><h2 className="text-xl font-semibold">Conferência: {resultado.empresa.codigo} — {resultado.empresa.nome}</h2>
      <p>Líquido do PDF: <strong>{money(resultado.empresa.liquido!)}</strong></p><p>Líquido dos lançamentos: <strong>{money(resultado.calculo.liquidoCalculado)}</strong></p><p>Diferença: <strong>{money(resultado.calculo.diferenca!)}</strong></p>
      <p className={canExport?"text-primary":"text-destructive"}>{canExport?"Valores conferem.":"Não foi possível concluir com segurança. Revise os eventos e as diferenças."}</p>
      {resultado.calculo.pendentes.length>0 && <div><p className="font-semibold">Eventos sem classificação ({resultado.calculo.pendentes.length}):</p><ul className="list-disc pl-5 text-sm">{resultado.calculo.pendentes.map((e,i)=><li key={i}>{e.grupo} · {e.codigo} · CLC {e.clc || "ausente"} · {e.descricao} · {money(e.valor)} · página {e.pagina}</li>)}</ul></div>}
      <details><summary className="cursor-pointer text-sm">Eventos não lançados ({resultado.calculo.ignorados.length})</summary><ul className="list-disc pl-5 text-sm">{resultado.calculo.ignorados.map((e,i)=><li key={i}>{e.descricao} · CLC {e.clc || "ausente"} · {money(e.valor)}</li>)}</ul></details>
      <p className="text-sm text-muted-foreground">Se houver pendências, você pode baixar a conferência para revisá-las. A importação só fica disponível quando a leitura e o líquido estiverem conferidos.</p>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!canExport} onClick={()=>void download("importacao")}>Baixar importação</button><button className={button} onClick={()=>void download("conferencia")}>Baixar conferência</button></div>
    </div>}
  </section>;
}
