## Plano

Corrigir a lógica de devolução para que a linha negativa como:

`VALOR NF 494062 ... REF DEVOLUCAO NF 363720 ...`

não use a NF `494062` como referência, e sim a NF original indicada depois de `REF DEVOLUCAO NF`, neste caso `363720`.

## O que vou alterar

1. **Detectar devolução explicitamente**
   - Criar uma extração específica para padrões como:
     - `REF DEVOLUCAO NF 363720`
     - `REF. DEVOLUÇÃO NF 363720`
     - variações sem acento/sem ponto.

2. **Priorizar a NF original da devolução**
   - Na segunda passagem dos lançamentos negativos, antes do fallback genérico de números, verificar se a descrição contém `REF DEVOLUCAO NF <numero>`.
   - Se encontrar, usar esse número diretamente para localizar a NF original.

3. **Manter a devolução fora das NFs novas**
   - A linha `VALOR NF 494062 ...` com valor negativo continuará sendo ignorada na primeira passagem, para não criar uma aba/linha fantasma de NF positiva.

4. **Abater do lançamento correto**
   - Para o exemplo informado, a linha negativa de `494062` vai abater o valor da NF `363720`:
     - Original: `VALOR NF 363720-CRISTALIA...`
     - Devolução: `VALOR NF 494062 ... REF DEVOLUCAO NF 363720...`

5. **Validar o caso da 81354**
   - Conferir que o total gerado passe a bater com o saldo esperado: `R$ 3.083.760,89`, não `R$ 3.153.635,02`.

## Arquivo afetado

- `src/lib/transformSpreadsheet.ts`

## Fora do escopo

- Não vou mudar layout, uploads, múltiplas abas ou a coluna `INFORMAÇÕES`.
- Não vou salvar dados das planilhas enviadas.