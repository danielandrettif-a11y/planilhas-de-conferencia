## Diagnóstico

A regra da coluna INFORMAÇÕES está correta no código (`applyPagamentosPdf`):
- Todas as parcelas com Data baixa → lista todas as datas.
- Alguma parcela sem Data baixa → "Próximas parcelas ainda sem programação".

O motivo da coluna vir totalmente vazia é o **parser do PDF descartando as linhas**: hoje ele exige um `Data vencimento` válido (`if (!venc) continue;`) para aceitar cada linha. Neste PDF a coluna de vencimento parece estar sendo lida do lugar errado (o cabeçalho tem "Data vencimento" e "Data vencimento c/ prorrog.") e cai fora da faixa esperada, então TODAS as parcelas são descartadas antes de chegar no match.

## O que fazer

### 1. `src/lib/parsePagamentosPdf.ts` — ignorar Data vencimento

- Remover `vencimento` do tipo `PagamentoRow` (não é mais usado em lugar nenhum).
- Remover a detecção de coluna `vencimento` em `detectColumns` e as faixas dependentes.
- Reconstruir as faixas de coluna a partir dos headers que interessam apenas: `Número título`, `Título`, `Valor título`, `Valor aberto`, `Data baixa`. Fim de cada faixa = x do próximo header à direita.
- Nova regra de aceitação de linha: aceita se `numero` (só dígitos após normalização) tiver ≥ 3 dígitos **e** `titulo` (fornecedor) não estiver vazio. Não exigir mais data.
- Continuar parseando `Data baixa` via `parseBrDate` — se vazio, `dataBaixa = null` (parcela em aberto).
- Adicionar `console.info` com: páginas processadas, header detectado sim/não por página, total de linhas extraídas.

### 2. `src/lib/transformSpreadsheet.ts` — limpar referências a `vencimento`

- Remover qualquer leitura de `r.vencimento` (não há uso funcional depois da mudança).
- Manter a lógica atual de `applyPagamentosPdf`:
  - Match: `numeroNorm` exato ou `startsWith(nfNorm)` com sufixo puramente numérico, exigindo overlap de fornecedor.
  - `hasPending = matches.some(r => r.dataBaixa == null)` → texto fixo "Próximas parcelas ainda sem programação".
  - Caso contrário → `formatVencList(dataBaixa)` (já produz "dd/MM, dd/MM e dd/MM/yyyy").
  - Sufixo `(conferir)` quando soma total ≠ FALTA PAGAR.

### 3. `src/pages/Index.tsx` — feedback e log
- No handler do Passo 03, após `parsePagamentosPdf`, logar `pdfRows.length` e as 3 primeiras linhas no console.
- Já existe o chip mostrando "X parcela(s)"; garantir que continua exibindo o total real.

### 4. Atualizar `.lovable/plan.md`
Refletir a nova regra: parser ignora Data vencimento; coluna INFORMAÇÕES usa apenas Data baixa e regra binária (todas pagas vs. alguma em aberto).

### 5. Validação
- Recarregar o PDF de exemplo.
- Conferir no console: `pdfRows.length` > 0 e linhas com `numero`/`dataBaixa`.
- NF 9888 (3 parcelas todas com Data baixa 22/04, 22/05, 22/06/2026) → INFORMAÇÕES deve mostrar `22/04, 22/05 e 22/06/2026`.
- NF com alguma parcela em aberto → `Próximas parcelas ainda sem programação`.
- NF fora do PDF → coluna em branco (ou herda do mês anterior, se houver).
