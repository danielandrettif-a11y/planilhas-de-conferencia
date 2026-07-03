## Objetivo

Permitir enviar **várias planilhas brutas** no mesmo slot do mês atual. O nome de cada arquivo (ex.: `81354.xlsx`, `81361.xlsx`) vira o nome da aba no arquivo gerado, seguindo o mesmo modelo da planilha do mês anterior (que já tem uma aba por conta).

## Comportamento novo

**Slot "Mês atual" (múltiplos arquivos):**
- Aceitar N arquivos `.xlsx` de uma vez.
- Para cada arquivo, extrair o código da conta do **nome do arquivo** (primeira sequência de dígitos, ex.: `81354` em `81354.xlsx`, `Conta_81354_abril.xlsx`, etc.).
- Se algum arquivo não tiver dígitos no nome, avisar o usuário e pedir para renomear.
- Se dois arquivos gerarem o mesmo código, avisar (duplicata).
- A UI lista os arquivos carregados com o código detectado ao lado — o usuário confere antes de gerar.

**Slot "Mês anterior" (opcional, continua 1 arquivo):**
- Continua sendo um único `.xlsx` com várias abas (uma por conta), como o `IMNEC_Mês_04-2026_ok.xlsx` que você enviou.
- Ao aplicar `INFORMAÇÕES`, para cada conta buscamos os dados na aba com o **mesmo código** no arquivo anterior. Se a aba não existir, aquela conta sai sem `INFORMAÇÕES` (comportamento atual, só que por aba).

**Geração:**
- O arquivo final passa a ter **uma aba por conta**, nomeada com o código (`81354`, `81361`, ...), cada uma no mesmo formato/estilo da aba única de hoje (cabeçalho, cores, linha de TOTAL, etc.).
- Se só um arquivo bruto for enviado, o resultado é 1 aba — comportamento equivalente ao atual.

## Arquivos a mudar

- `src/lib/transformSpreadsheet.ts`
  - `buildXlsx` passa a aceitar `Array<{ conta: string; result: TransformResult }>` e cria uma aba por item, reusando o estilo atual.
  - `buildPreviousInfoMap` passa a aceitar todas as abas do workbook anterior e retornar `Map<contaCode, Map<nota, PrevEntry[]>>`.
- `src/pages/Index.tsx`
  - Input do mês atual vira `multiple`; state passa a ser `Array<{ file, conta, rows }>`.
  - UI lista arquivos com o código detectado + botão de remover individual.
  - Validação: pelo menos 1 arquivo, todo arquivo com código válido, sem duplicatas.
  - `onGenerate` roda `transformRows` por arquivo, casa com a aba correspondente do mês anterior (se houver) e chama o novo `buildXlsx` com o array.

## Fora do escopo

- Não muda a lógica de parsing de linhas (`VALOR NF`, retenções, etc.).
- Não muda o slot do mês anterior (continua 1 arquivo com N abas).
- Não muda o visual geral do site, só o conteúdo do card 01 para suportar múltiplos arquivos.

## Dúvida rápida

Confirma que o nome do arquivo bruto sempre vai conter o código da conta em dígitos (ex.: `81354.xlsx` ou `Conta 81354 - abril.xlsx`)? Se preferir outro esquema (ex.: um campo de texto ao lado de cada arquivo para digitar o código manualmente), me diz que ajusto o plano.
