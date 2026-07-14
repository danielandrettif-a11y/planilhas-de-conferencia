## Ajustes na interface do Conversor

### 1. Stepper — travar avanço e desligar o "brilho" das etapas inativas
Arquivo: `src/pages/Index.tsx` (componente `Stepper`)

- Só permitir clique em uma etapa se **todas as anteriores estiverem concluídas** (`done[1] && done[2] && ...`). Etapas futuras bloqueadas ganham `cursor-not-allowed` e opacidade reduzida.
- A "bolinha" verde preenchida (círculo com check em `bg-primary`) só aparece na etapa **atualmente ativa**. Etapas já concluídas mas fora do foco mostram um check discreto (contorno + check em cor `muted-foreground`), sem preenchimento verde. Etapas pendentes continuam com bolinha cinza numerada.

### 2. Favicon com referência de planilha sendo convertida
- Gerar um ícone 512×512 (via `imagegen`) representando duas planilhas com uma seta de conversão entre elas, em verde/branco combinando com o tema.
- Salvar em `public/favicon.png`, remover `public/favicon.ico` e atualizar `<link rel="icon">` no `index.html`.

### 3. Nova frase de subtítulo
Arquivo: `src/pages/Index.tsx` (hero, linha ~404)
Trocar por: **"Envie o export do Alterdata e receba uma planilha padronizada com fornecedor, nota fiscal e valores organizados em segundos."**

### 4. Nome do arquivo gerado
Arquivo: `src/pages/Index.tsx` (função `onGenerate`)

- Se houver planilha do mês anterior (`prevFile`): usar o nome dela como base, substituir a referência de mês pela do `mesConferencia` e acrescentar ` (Conferir)`.
  - Regex tenta substituir padrões tipo `mês 04`, `mes 4`, `abril`, `04-2025`, `04.2025` pelo mês selecionado (nome por extenso + ano, ex.: `maio 2025`).
  - Se não encontrar padrão, apenas concatena ` - <mês por extenso> <ano> (Conferir)`.
- Sem planilha do mês anterior: `planilhas <mês por extenso> <ano> (Conferir).xlsx`.

Exemplo: `Empresa X abril 2025.xlsx` + mês 5/2025 → `Empresa X maio 2025 (Conferir).xlsx`.

### 5. Subtítulo do cabeçalho
Arquivo: `src/pages/Index.tsx` (header, linha ~374)

Adicionar embaixo do título `Conversor de Planilhas` (ou substituir a linha `ALTERDATA · CONFERÊNCIA`) o texto: **"Conversor de Planilhas de fornecedores para os Cont's"** como tagline visível. Manter compacto e responsivo (esconder em telas muito pequenas se necessário).

### 6. Animações de scroll reveal
Arquivo novo: `src/hooks/useRevealOnScroll.ts` — hook que usa `IntersectionObserver` para adicionar a classe `is-visible` quando o elemento entra na viewport.

Arquivo: `src/index.css` — adicionar utilitária:
```css
.reveal { opacity: 0; transform: translateY(24px); transition: opacity .7s ease, transform .7s ease; }
.reveal.is-visible { opacity: 1; transform: translateY(0); }
```

Arquivo: `src/pages/Index.tsx` — aplicar `className="reveal"` + `ref` do hook nos blocos principais (hero, aviso de privacidade, stepper, cada `StepCard` renderizado, card final de gerar, footer). Elementos já visíveis no primeiro paint (hero) recebem `is-visible` imediato para evitar flash.

### Notas técnicas
- Nenhuma alteração na lógica de transformação (`transformSpreadsheet.ts`, `parsePagamentosPdf.ts`).
- Processamento continua 100% local.
- Favicon gerado com o modelo `fast` (não é texto, não precisa de premium).