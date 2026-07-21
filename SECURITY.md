# Segurança e privacidade

## Processamento dos arquivos

As planilhas e os PDFs selecionados pelo usuário são processados localmente no navegador. O aplicativo não possui backend, banco de dados, endpoint de upload, analytics ou serviço externo para receber o conteúdo dos arquivos.

Os dados permanecem temporariamente na memória da aba enquanto ela estiver aberta. A planilha final é gerada como um arquivo local e baixada diretamente pelo navegador.

## Armazenamento local

O único dado persistido no `localStorage` é a preferência de tema (`light` ou `dark`). Planilhas, PDFs, fornecedores, notas fiscais e valores não são armazenados no navegador.

## Proteções do repositório

O `.gitignore` bloqueia formatos contábeis e documentos privados, incluindo XLSX, XLS, XLSM, CSV, PDF e arquivos compactados.

O deploy executa `npm run security:check`, que interrompe a publicação quando encontra:

- documentos privados rastreados pelo Git;
- uso não autorizado de `fetch`;
- XMLHttpRequest;
- WebSocket;
- `sendBeacon`;
- Axios;
- Supabase;
- Firebase.

## Política de conteúdo

A página usa Content Security Policy para restringir scripts, workers e conexões aos próprios arquivos publicados pelo aplicativo. Novas integrações externas devem ser revisadas antes de qualquer alteração nessa política.

## Boas práticas de uso

- Feche ou recarregue a aba após concluir o trabalho em computadores compartilhados.
- Não coloque arquivos reais dentro da pasta do projeto.
- Use pastas ignoradas, como `dados-privados/`, somente no computador local.
- Nunca envie planilhas, PDFs ou arquivos compactados manualmente para o repositório.
- Revise alterações que adicionem comunicação de rede antes de publicar.
