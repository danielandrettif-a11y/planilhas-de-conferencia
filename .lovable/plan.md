## Problema

pdf.js entrega as linhas do PDF já bem separadas por espaços (ex: `00066 11471 TERCEIRA VIA COMUNICAÇÃO LTDA ...`). O parser atual pega o primeiro token como número do título, mas esse token é o código da empresa (`00066`). Depois de remover os zeros à esquerda sobra `66` (2 dígitos), o que aciona o filtro `digits.length < 3` e todas as linhas são descartadas — daí "PDF sem títulos reconhecidos".

## Correção

Em `src/lib/parsePagamentosPdf.ts`, dentro de `parseLine`, ajustar a extração do número:

1. Após remover os tokens finais de datas, se o primeiro token restante for todo numérico e tiver ≤ 6 dígitos, tratá-lo como código de empresa e descartá-lo.
2. Usar o próximo token como número da NF.
3. Manter a normalização (remover zeros à esquerda) e o filtro de `digits.length < 3` só para o número já sem a empresa.
4. Se o primeiro token restante já for alfanumérico (letras) — caso de identificadores textuais como `FERIAS 07/2026` — mantém como está.

Nada muda em `transformSpreadsheet.ts` nem em `Index.tsx`.

## Validação

Após o ajuste, o log `[pdf] N linha(s) extraída(s)` deve mostrar N > 0 e as NFs numéricas (9888, 9949, 11471, 28617, etc.) devem ser reconhecidas e casadas contra a planilha, preenchendo a coluna INFORMAÇÕES.
