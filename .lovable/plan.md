## Motivo

A linha `VALOR NF 2219-CAMPO NOVO COMERCIO E SERVICOS EIRELI ME` não entrou porque o extrator exige um hífen **logo depois de "NF"** (padrão `VALOR NF - 2219 - FORNECEDOR`). Nessa linha o hífen aparece só entre o número e o fornecedor (`NF 2219-CAMPO...`), então a regex atual falha e a linha é ignorada.

Trecho responsável em `src/lib/transformSpreadsheet.ts`:

```ts
const mNF = s.match(/^VALOR\s+NF\s*-\s*(.+)$/i); // exige "-" após NF
```

## Ajuste proposto

Em `src/lib/transformSpreadsheet.ts`, dentro de `parseDescricao`:

1. Tornar o hífen após `NF` opcional, aceitando os dois formatos:
   - `VALOR NF - 2219 - FORNECEDOR`
   - `VALOR NF 2219-FORNECEDOR`
   - `VALOR NF 2219 FORNECEDOR`

   Nova regex:
   ```ts
   const mNF = s.match(/^VALOR\s+NF\b[\s-]*(.+)$/i);
   ```

2. Ajustar a extração de número + fornecedor a partir do resto para funcionar com separador `-`, espaço, ou ambos:
   ```ts
   const m = rest.match(/^(\d+)\s*[-–]?\s*(.+)$/);
   ```
   (o número vem primeiro; o restante — após hífen ou espaço — é o fornecedor, que continua passando por `cleanFornecedor`).

3. Nenhuma outra regra muda: abatimento de negativos, cálculo de FALTA PAGAR, formatação e coluna INFORMAÇÕES seguem iguais.

## Resultado esperado

A NF 2219 (CAMPO NOVO COMERCIO E SERVICOS EIRELI ME) passa a ser reconhecida e aparece na planilha gerada, junto com os abatimentos que referenciem `NF 2219` / `NF - 2219`.
