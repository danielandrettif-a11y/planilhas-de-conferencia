## Diagnóstico

Comparei o `81354.xls` que você mandou com o que o site gera.

- Saldo final na planilha bruta (última linha, coluna `Saldo`): **R$ 3.083.760,89**
- Total gerado hoje pelo site (soma de FALTA PAGAR): **R$ 3.094.136,89** (após aplicar retenções negativas)
- Diferença: **R$ 10.376,00**

A causa é uma única linha no arquivo bruto:

```
Linha 12 — Valor: -10.376,00
Descrição: "VALOR NF 494062 CRISTALIA PROD. QUIM. FARMACEUTICOS LTDA
            REF DEVOLUCAO NF 363720 EMITIDA 26/04/2024."
```

É uma **devolução**: a linha começa com "VALOR NF" (então nosso parser trata como nota fiscal nova) **mas o valor é negativo** e o texto diz "REF DEVOLUCAO NF 363720" — na verdade é um abatimento da NF 363720.

Hoje o código faz `Math.abs(row.Valor)` para NFs, então essa linha vira uma nota positiva de R$ 10.376,00 em vez de abater R$ 10.376,00 da NF 363720. Isso infla o total em 2 × 10.376 = R$ 20.752, mas como a NF 363720 já existe e recebeu 0 de abatimento, o resultado líquido no total é +10.376 acima do saldo real.

## Correção

Em `src/lib/transformSpreadsheet.ts`, mudar a regra: linha `VALOR NF` com valor **negativo** não vira uma nota nova — é tratada como retenção/devolução, exatamente como as outras linhas negativas.

1. Na primeira passagem (coleta de NFs), pular quando `parsed.isNF && valor < 0`.
2. Na segunda passagem (abater negativos), remover o `if (parsed.isNF) continue;` — ou melhor, deixar essa linha entrar no fluxo de match por número de NF.
3. O parser já sabe extrair o número referenciado: para "VALOR NF 494062 ... REF DEVOLUCAO NF 363720", o `extractCandidateNumbers` retorna os dois. Como só a NF 363720 existe no `byNumero` (494062 nunca foi cadastrada porque agora ignoramos), o filtro `matches.filter(n => byNumero.has(n))` fica com só uma → match único → abate corretamente.
4. Caso a NF referenciada não exista no mês, a linha é ignorada (mesmo comportamento das outras retenções órfãs de hoje).

## Resultado esperado

- Total FALTA PAGAR passa a bater com o Saldo da planilha bruta (R$ 3.083.760,89 no caso do 81354).
- Nenhuma "NF fantasma" de valor R$ 10.376 aparece na saída.
- Comportamento das demais linhas continua idêntico.

## Fora do escopo

- Não muda UI, layout, nem lógica de múltiplas abas / mês anterior.
- Não altera a coluna `INFORMAÇÕES`.
