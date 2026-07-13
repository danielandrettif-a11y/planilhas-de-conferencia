## Nova regra da coluna INFORMAÇÕES (via PDF)

Ao invés de listar as **datas de vencimento** das parcelas em aberto, o app passa a olhar a coluna **Data baixa** de cada parcela da NF no PDF.

### Regras para cada NF encontrada no PDF

1. **Todas as parcelas têm Data baixa preenchida** (NF totalmente paga):
   - Lista só as datas de baixa, ordenadas crescentemente.
   - Formato: `10/06 e 10/07/2026` — `dd/MM` nas anteriores, `dd/MM/yyyy` só na última, separadores `, ` e ` e `.
   - Sem prefixo ("Pago em"/"Baixa em").
2. **Alguma parcela sem Data baixa** (ainda tem algo em aberto):
   - Texto fixo: `Próximas parcelas ainda sem programação` (com "P" maiúsculo).
   - Ignora as datas das parcelas já pagas nesse caso.
3. **Conferência de soma**: mantém o sufixo `(conferir)` quando a soma das parcelas do título ≠ `FALTA PAGAR` da planilha.

### Precedência (inalterada)

1. NF aparece no PDF → texto vem do PDF (regras acima).
2. NF não aparece no PDF → mantém texto da planilha do mês anterior.
3. Não aparece em nenhum → coluna em branco.

### Onde mexer no código

- `src/lib/transformSpreadsheet.ts`, função `applyPagamentosPdf`:
  - Trocar o filtro atual (só parcelas com `valorAberto > 0` e sem `dataBaixa`) por uma varredura de **todas** as parcelas da NF.
  - Se `parcelas.some(p => !p.dataBaixa)` → escrever `Próximas parcelas ainda sem programação`.
  - Senão → formatar `parcelas.map(p => p.dataBaixa).sort()` com o formato de datas já existente.
  - Manter validação `soma dos valorTitulo (ou equivalente) vs FALTA PAGAR` para adicionar `(conferir)`.
- `src/lib/parsePagamentosPdf.ts`: sem mudança (já captura `dataBaixa`).
- `src/pages/Index.tsx`: sem mudança.

### Notas

- A comparação de soma para `(conferir)` passa a usar o **valor total do título** (todas as parcelas), não só as em aberto, para refletir o valor original da NF.
