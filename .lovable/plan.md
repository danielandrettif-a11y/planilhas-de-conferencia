## Nova funcionalidade: PDF de pagamentos + fluxo em etapas

### Fluxo em etapas (wizard)

A tela passa a mostrar **um passo por vez**, liberando o próximo só quando o atual estiver resolvido:

1. **Passo 1 — Planilha do mês anterior** (opcional)
   - Card com upload + checkbox "Não tenho a planilha do mês anterior".
   - Libera o Passo 2 quando: a planilha foi carregada **ou** o checkbox está marcado.
2. **Passo 2 — Planilhas brutas do mês atual** (obrigatório)
   - Card com upload múltiplo (comportamento atual).
   - Libera o Passo 3 quando existir pelo menos uma planilha bruta válida.
3. **Passo 3 — PDF de pagamentos** (opcional)
   - Card com upload de um único PDF + checkbox "Não tenho o PDF de pagamentos".
   - Libera o Passo 4 quando: o PDF foi carregado **ou** o checkbox está marcado.
4. **Passo 4 — Gerar e baixar**
   - Botão "Gerar planilha" e download do arquivo final.

Detalhes de UX:
- Indicador de progresso no topo (1 → 2 → 3 → 4) com o passo atual destacado.
- Passos anteriores ficam visíveis em modo compacto (resumo + botão "Editar") para o usuário revisar/trocar sem recomeçar.
- Passos futuros ficam bloqueados/ocultos até serem liberados.
- Marcar o checkbox limpa o arquivo daquele passo (evita estado inconsistente).
- Layout responsivo, mantendo o visual atual (dark/glass, verde neon).

### Regras de preenchimento da coluna INFORMAÇÕES

Prioridade por NF:

1. Se a NF aparece no PDF → **PDF manda** (sobrescreve o texto do mês anterior).
   - Considerar apenas parcelas em aberto (`Valor aberto > 0` e `Data baixa` vazia).
   - Listar somente as datas de vencimento, ordenadas por data:
     - 1 parcela: `20/07/2026`
     - 2 parcelas: `20/06 e 20/07/2026`
     - 3+: `20/05, 20/06 e 20/07/2026` (ano só na última)
   - Se a soma das parcelas em aberto ≠ `FALTA PAGAR`, acrescentar `(conferir)` no fim.
2. Se a NF **não aparece no PDF** → mantém o texto vindo da planilha do mês anterior.
3. Se não aparece em nenhum dos dois → coluna em branco.

### Match NF (planilha) ↔ Título (PDF)

Para cada NF da planilha:
- Normalizar número (`normNota`: só dígitos, sem zeros à esquerda).
- Aceitar match quando:
  - **igualdade exata** do número normalizado, OU
  - **prefixo**: o Título começa com o número da NF e o sufixo é só de dígitos (parcelas tipo `1000400001…04`).
- Em ambos os casos, exigir **overlap de tokens do fornecedor** entre `FORNECEDOR` da planilha e `Título` do PDF (reutiliza `fornecedorTokens`).

### Parse do PDF

- `pdfjs-dist` no browser: `getTextContent` por página, agrupamento por linha (mesmo `y`), separação em colunas via faixas de `x` detectadas pelo cabeçalho.
- Colunas: `Número título`, `Título` (fornecedor), `Data emissão`, `Data vencimento`, `Valor título`, `Valor aberto`, `Data baixa`.
- Ignora cabeçalho, `<Filtro Vazio>` e linhas sem número.
- Saída: `{ numero, fornecedor, vencimento: Date, valorAberto: number, dataBaixa: Date|null }[]`.

### Onde mexer no código

- `src/lib/parsePagamentosPdf.ts` (novo): parser do PDF.
- `src/lib/transformSpreadsheet.ts`:
  - nova função `applyPagamentosPdf(notas, pdfRows)` (match + formatação de datas).
  - ordem: aplicar mês anterior, depois PDF (sobrescreve quando casa).
- `src/pages/Index.tsx`: refatorar para wizard com estado de passo atual (`step`), checkboxes "não tenho" para passos 1 e 3, indicador de progresso, cards compactos para passos concluídos.
- `package.json`: adicionar `pdfjs-dist`.

### Notas técnicas

- Formatação de datas: `dd/MM` para todas menos a última, `dd/MM/yyyy` na última; separadores `, ` e ` e `.
- Parcelas do PDF ordenadas por data de vencimento crescente.
- Processamento 100% no navegador — o PDF não sai da máquina do usuário.
