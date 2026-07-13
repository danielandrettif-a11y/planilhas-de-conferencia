## Problema

O PDF do Alterdata renderiza a coluna "Empresa" sobreposta a "Número título", fazendo o pdf.js retornar o cabeçalho com caracteres embaralhados (`EmpNreúsmaero título`). O parser atual procura o texto "número título" num item para identificar as colunas — como isso nunca aparece, nenhuma linha é extraída e a coluna INFORMAÇÕES fica vazia.

## Solução

Trocar detecção por cabeçalho por parsing linha-a-linha via regex. Cada linha do relatório termina sempre no mesmo padrão:

```text
... <fornecedor> <datas> <valor título> <valor aberto> [<data baixa>]
```

- Valor título e valor aberto sempre presentes (formato `1.234,56`).
- Data baixa (`dd/mm/aaaa`) só aparece quando pago; senão a linha termina no valor aberto.
- Empresa "0006" e Número título ficam glued no primeiro token (`0006161471`, `000616000400001`).

## Alterações

### `src/lib/parsePagamentosPdf.ts` — reescrita

1. Remover `detectColumns` e todo uso de coordenadas de coluna.
2. Agrupar itens por `y` (como já faz), mas juntar em uma única string por linha respeitando a ordem `x`.
3. Para cada linha do PDF:
   - Aplicar regex final: `/^(.*?)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})(?:\s+(\d{2}\/\d{2}\/\d{4}))?\s*$/`
   - Se não casar → descartar (é cabeçalho, rodapé, `<Filtro Vazio>`, etc.).
   - `valorTitulo` = grupo 2, `valorAberto` = grupo 3, `dataBaixa` = grupo 4 (opcional).
   - Do prefixo (grupo 1): dividir por espaços, remover pela direita os tokens que só contêm dígitos/barras (as 3–4 colunas de datas, incluindo os blobs embaralhados como `11/030/220/0174/2026`).
   - Primeiro token restante = número (com "0006" empresa colada). Remover prefixo `^0+` uma vez e depois `normNota` (já feito em `transformSpreadsheet.ts`) cuida do resto.
   - Tokens restantes = fornecedor (join com espaço).
4. Manter logs `console.info` de contagem e amostra.

### `src/lib/transformSpreadsheet.ts` — sem mudança de lógica

O `applyPagamentosPdf` já funciona: match por número exato ou prefixo com sufixo numérico, exige overlap de fornecedor, formata datas ou mostra "Próximas parcelas ainda sem programação". Deixar como está.

### `src/pages/Index.tsx` — sem mudança

## Validação

Após a reescrita, o PDF `NewReport.pdf` deve produzir linhas como:

```text
numero="0009888 00001" fornecedor="J C C MACHADO INFORMATICA LTDA - ME"
valorTitulo=393,20 valorAberto=0,00 dataBaixa=22/04/2026
```

Assim as NFs 9888 e 9949 do exemplo passam a receber as datas de baixa na coluna INFORMAÇÕES.
