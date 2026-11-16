export interface ReciboFerias { codigo:string; empresa:string; competencia:string; bruto:number; inss:number; irrf:number; pensao:number; liquido:number; pendentes:string[]; pagina:number }
interface Item { str:string; x:number; y:number }
const cents=(s:string)=>Math.round(Number(s.replace(/\./g,'').replace(',','.'))*100);
const normal=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const cancel=(s?:AbortSignal)=>{if(s?.aborted) throw new DOMException('Leitura cancelada','AbortError')};
export function lerPaginaFerias(items:Item[],pagina:number):ReciboFerias {
 const lines:Item[][]=[];
 for(const i of [...items].filter(x=>x.str.trim()).sort((a,b)=>b.y-a.y||a.x-b.x)) {const row=lines.at(-1);if(row&&Math.abs(row[0].y-i.y)<3)row.push(i);else lines.push([i]);}
 const text=(l:Item[])=>[...l].sort((a,b)=>a.x-b.x).map(i=>i.str.trim()).join(' ').replace(/\s+/g,' ').trim();
 const full=lines.map(text);
 const head=full.find(s=>/^\d{3,5}\s*-\s*.+P[aá]g\./i.test(s))?.match(/^(\d{3,5})\s*-\s*(.+?)\s+P[aá]g\./i);
 const period=full.find(s=>/Per[ií]odo das F[eé]rias/i.test(s))?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
 if(!head||!period||!full.some(s=>/Recibo de F[eé]rias/i.test(s)))throw new Error(`Página ${pagina}: recibo, empresa ou período de férias não reconhecido.`);
 const totalLine=lines.find(l=>/Totais\.{2,}\s*:/i.test(text(l)));const netLine=lines.find(l=>/L[ií]quido\.{2,}\s*:/i.test(text(l)));
 const money=(line:Item[]|undefined,min:number,max:number)=>{const a=line?.filter(i=>i.x>=min&&i.x<max).map(i=>i.str.match(/^[\d.]+,\d{2}$/)?.[0]).filter(Boolean) as string[]|undefined;return a?.length===1?cents(a[0]):null};
 const bruto=money(totalLine,350,450), descontos=money(totalLine,450,560), liquido=money(netLine,350,450);
 if(bruto===null||descontos===null||liquido===null||bruto-descontos!==liquido)throw new Error(`Página ${pagina}: os totais do recibo não puderam ser conferidos.`);
 let inss=0,irrf=0,pensao=0,descontosLidos=0;const pendentes:string[]=[];
 for(const l of lines){const code=l.find(i=>i.x<60&&/^\d{4}$/.test(i.str))?.str;if(!code)continue;const value=money(l,450,560);if(value===null)continue;descontosLidos+=value;const desc=text(l.filter(i=>i.x>=65&&i.x<265));if(code==='0301'&&/INSS/.test(normal(desc)))inss+=value;else if(code==='0308'&&/IRRF/.test(normal(desc)))irrf+=value;else if(code==='0277'&&/PENSAO/.test(normal(desc)))pensao+=value;else pendentes.push(`${code} ${desc} (página ${pagina})`);}
 if(descontosLidos!==descontos)throw new Error(`Página ${pagina}: não foi possível identificar todos os descontos.`);
 return {codigo:head[1],empresa:head[2],competencia:`${period[3]}-${period[2]}`,bruto,inss,irrf,pensao,liquido,pendentes,pagina};
}
export async function lerFerias(file:File,signal?:AbortSignal):Promise<ReciboFerias[]> {
 cancel(signal);const pdfjs=await import('pdfjs-dist');const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
 const bytes=new Uint8Array(await file.arrayBuffer());cancel(signal);const task=pdfjs.getDocument({data:bytes});const abort=()=>{void task.destroy().catch(()=>{})};signal?.addEventListener('abort',abort,{once:true});
 try{const pdf=await task.promise;const recibos:ReciboFerias[]=[];for(let n=1;n<=pdf.numPages;n++){cancel(signal);const page=await pdf.getPage(n);const scale=595.28/page.getViewport({scale:1}).width;const content=await page.getTextContent();const items:Item[]=content.items.filter((v):v is typeof v & {str:string;transform:number[]}=>'str'in v&&'transform'in v).map(v=>({str:v.str,x:v.transform[4]*scale,y:v.transform[5]}));recibos.push(lerPaginaFerias(items,n));page.cleanup();}return recibos;}finally{signal?.removeEventListener('abort',abort);await task.destroy();if(bytes.byteLength)bytes.fill(0)}
}
