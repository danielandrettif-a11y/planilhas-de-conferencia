## Erro encontrado

A devolução da Cristália **não é mais o problema**. Ela está abatendo corretamente:

- Bruto linha 13: `VALOR NF 494062 ... REF DEVOLUCAO NF 363720...`
- Valor: `-10.376,00`
- Abatida na NF original `363720`

A diferença que ainda sobra é exatamente:

`R$ 69.874,13`

E ela vem de **duas linhas negativas que o site não consegue vincular à NF original**.

## Onde está a diferença

### 1. Linha 172 da planilha bruta 81354

Valor não abatido:

`-69.454,17`

Descrição:

`PAGTO NF 23797400001 HOSPINOVA DISTRIBUIDORA DE PRODUTOS HOSPITALARES...`

O site procura a NF `23797400001`, mas a NF lançada na planilha é:

- Linha 48:
  `VALOR NF - 237974-HOSPINOVA DISTRIBUIDORA DE PRODUTOS HOSP`

Ou seja: o pagamento veio como `23797400001`, mas a nota original está como `237974`.

### 2. Linha 317 da planilha bruta 81354

Valor não abatido:

`-419,96`

Descrição:

`PAGTO NF 28233959 EUROFARMA LABORATORIOS S.A...`

O site procura a NF `28233959`, mas a NF correspondente na planilha parece ser:

- Linha 112:
  `VALOR NF - 2823959-Eurofarma Laboratórios S.A.`

Ou seja: o pagamento veio com o número `28233959`, mas a nota original está como `2823959`.

## Conferência dos valores

A soma dessas duas linhas é:

`69.454,17 + 419,96 = 69.874,13`

Esse é exatamente o valor que está sobrando na planilha gerada:

- Saldo correto da bruta: `R$ 3.083.760,89`
- Total gerado na formatada: `R$ 3.153.635,02`
- Diferença: `R$ 69.874,13`

## Onde está o erro no código

Arquivo:

`src/lib/transformSpreadsheet.ts`

Na segunda passagem, a lógica só abate negativos quando encontra uma NF com o **mesmo número exato**.

Hoje ela não entende estes casos:

- `23797400001` deve bater com `237974`
- `28233959` deve bater com `2823959`

## Plano de correção

1. Manter a regra de devolução como está.
2. Adicionar uma regra extra para pagamentos negativos sem match exato.
3. Quando o número extraído do pagamento não existir, tentar localizar uma NF conhecida do mesmo fornecedor por correspondência segura:
   - número do pagamento começa com o número da NF e sobra um sufixo, como `00001`;
   - ou o número do pagamento vira uma NF existente removendo um único dígito extra, como `28233959` → `2823959`.
4. Só aplicar o abatimento se houver **um único match possível** para evitar abater na NF errada.
5. Validar novamente a conta 81354 para o total bater com `R$ 3.083.760,89`.