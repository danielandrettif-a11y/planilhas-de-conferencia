## Problema

Linhas negativas como `VALOR I.S.S. S/ 1153 -ANDRADE DOS SANTOS REFRIGERACAO LTDA` não são abatidas porque a regex atual só reconhece números precedidos de `NF` / `NF -`. Retenções (ISS, IRRF, PIS, COFINS, CSLL, INSS) e outros lançamentos costumam vir sem a sigla "NF".

## Solução

Ampliar a detecção do número da nota nas linhas negativas em `src/lib/transformSpreadsheet.ts`, mantendo a lógica das linhas positivas (`VALOR NF ...`) intacta.

### Estratégia de casamento (em ordem de prioridade)

1. **Padrão explícito `NF`** (já existe): `NF - 1234`, `NF 1234`.
2. **Padrões de retenção comuns**: `S/ 1234`, `S/NF 1234`, `SOBRE 1234`, `REF 1234`, `REF. NF 1234` — capturar o primeiro número após esses marcadores.
3. **Fallback seguro por número conhecido**: se nenhum padrão acima casar, extrair todos os tokens numéricos "candidatos a NF" da descrição (3+ dígitos, ignorando datas `dd/mm/aaaa`, percentuais, valores monetários) e, se **exatamente um** deles bater com um número de NF já coletado na primeira passagem, usar esse. Se houver ambiguidade (nenhum ou vários casam), não abater — evita falso positivo.

### Bônus opcional

Também usar o **nome do fornecedor** como desempate: quando mais de um número candidato bate com NFs conhecidas, priorizar aquele cuja NF tem fornecedor cujo nome aparece (parcialmente) na descrição da linha negativa.

## Arquivos

- `src/lib/transformSpreadsheet.ts` — expandir `parseDescricao` e a segunda passagem em `transformRows` conforme acima.

## Fora do escopo

- Sem mudanças de UI, formatação, ou fluxo de upload.
- Sem alteração nas regras das linhas positivas (`VALOR NF ...`).
