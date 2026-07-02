## Situação

No meu teste automatizado a página `/` renderiza normalmente (cabeçalho + área de upload), o dev server não reporta erros e o HTML servido está correto. Como do seu lado a tela continua totalmente branca mesmo após hard refresh, provavelmente há um erro de runtime acontecendo só no seu navegador (extensão, ambiente, ou algo específico do iframe do preview) que atualmente derruba a árvore React inteira sem deixar rastro visível.

## O que vou fazer

1. **Criar `src/components/ErrorBoundary.tsx`**
   - Componente de classe React que captura erros de render/lifecycle.
   - Em caso de erro, mostra uma tela amigável com:
     - Título "Algo deu errado ao carregar o app"
     - Mensagem de erro e stack (pré-formatado, para copiar/colar)
     - Botão "Recarregar página"
   - Sem tela branca: mesmo que o `Index` quebre, algo é renderizado.

2. **Envolver o app em `src/App.tsx`**
   - Colocar `<ErrorBoundary>` como wrapper mais externo, antes do `QueryClientProvider`, para pegar qualquer erro.

3. **Verificar**
   - Rodar o preview via Playwright, confirmar que continua renderizando a home normal.
   - Se do seu lado a tela permanecer "branca", agora vamos ver a mensagem de erro em vez de nada — e conseguimos corrigir a causa real.

## Fora do escopo

- Não vou mexer em `Index.tsx`, `transformSpreadsheet.ts`, nem na lógica de conversão.
- Não vou alterar rotas, estilos ou dependências.

Após aplicar, se ainda ficar em branco, me mande o texto que aparecer na tela de erro (ou um print do Console do navegador com F12).