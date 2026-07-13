## Ajustes na coluna INFORMAÇÕES

### 1. Mix de parcelas pagas + em aberto
Em `applyPagamentosPdf` (src/lib/transformSpreadsheet.ts):
- Todas com `dataBaixa` → lista todas as datas (mantém atual).
- Nenhuma com `dataBaixa` → `"Próximas parcelas ainda sem programação"`.
- **Misto** → datas baixadas + `" e próximas ainda sem programação"`.
  - Ex.: `"11/06 e próximas ainda sem programação"`.

### 2. Seletor de mês de conferência
Novo passo no wizard (entre "Mês anterior" e "Planilhas brutas"):
- `<Select>` com meses (~36 opções, ±1 ano do atual), default = mês atual, obrigatório.

**Filtro em `applyPagamentosPdf`:**
- Baixa "passada" = `dataBaixa` em mês **anterior ou igual** ao mês selecionado → some da lista exibida.
- **Exceção — último dia do mês selecionado:** se `dataBaixa` for exatamente o último dia do mês de conferência (ex.: 30/06 quando confere 06/2026), **mantém a data na lista** e força sufixo `" (conferir)"` no texto (compensação bancária real cai no 1º dia útil do mês seguinte, precisa revisão manual).
- Descartes são apenas visuais: as parcelas filtradas continuam contando na soma de conferência (item 3).
- Pós-filtro, se sobra só aberto → frase padrão; só datas → lista; misto → regra do item 1.

### 3. Flag `(conferir)` por soma
- Comparar `Σ valorTitulo` (fallback `valorAberto`) de **todas** as parcelas casadas, inclusive filtradas.
- Diferença > R$ 0,01 → acrescenta `" (conferir)"` ao final.
- Se já houver `(conferir)` (por item 2 ou 4), não duplicar.

### 4. Match de NF com dígitos extras via fornecedor
Ampliar casamento em `applyPagamentosPdf` (sempre exigindo overlap de fornecedor):
1. `titulo === nf` (exato).
2. `titulo` começa com `nf` + só dígitos (parcelas — já existe).
3. **Novo:** `nf` termina com `titulo` e o prefixo removido é só dígitos (ex.: NF `2600001002519`, título `1002519`).
4. **Novo:** `titulo` termina com `nf` e o prefixo removido é só dígitos.

Matches vindos das regras 3 ou 4 → sufixo `" (conferir)"` no texto (sem duplicar).

### Detalhes técnicos

**src/lib/transformSpreadsheet.ts**
- `applyPagamentosPdf(notas, pdfRows, { mesConferencia: { ano, mes } })`.
- Helpers: `isPast(baixa, mes)`, `isLastDayOfMonth(baixa, mes)`, `matchesTitulo(nfNorm, tituloNorm) → { ok, needsReview }`.
- Formatador de datas com sufixo `" e próximas ainda sem programação"`.

**src/pages/Index.tsx**
- Estado `mesConferencia` (`"YYYY-MM"`), default mês atual.
- Novo card no wizard com `<Select>` (Mês anterior → **Mês de conferência** → Brutas → PDF → Gerar).
- Passar `mesConferencia` para `applyPagamentosPdf` em `handleGenerate`.

Sem alterações no parser de PDF, layout do Excel, ou demais regras.
