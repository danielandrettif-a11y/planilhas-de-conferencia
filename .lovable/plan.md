## Objetivo
Fazer com que a planilha formatada gerada apresente as contas na mesma ordem sequencial da planilha do mês anterior (ex.: 81354, 81355, 81356, ...), em vez da ordem atual.

## Mudanças
1. Em `src/lib/transformSpreadsheet.ts` (ou no ponto onde as contas são agrupadas/emitidas na saída), ordenar a lista de contas por **código numérico crescente** antes de gerar as abas/linhas de saída.
2. Ordenação:
   - Extrair o número da conta (ex.: `81354`) e ordenar numericamente ascendente.
   - Contas sem número numérico válido vão para o final, em ordem alfabética.
3. Manter intacta a ordem interna de lançamentos dentro de cada conta (não mexer na lógica de devolução/abatimento já corrigida).

## Validação
- Rodar a transformação com o arquivo de exemplo e conferir que a sequência de abas/seções sai `81354, 81355, 81356, ...`.
- Reconferir que o total da conta 81354 continua batendo `R$ 3.083.760,89`.
