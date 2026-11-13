# Segurança e privacidade

## Processamento e descarte no aplicativo

As planilhas e os PDFs selecionados no site são processados no navegador. O projeto não implementa backend, banco de dados, endpoint de upload, analytics ou serviço externo para receber o conteúdo desses arquivos.

Durante a leitura e a preparação dos resultados, os dados ficam temporariamente na memória da aba. A conferência limpa o estado da tela após iniciar o download. Na folha, a tela oferece o botão **Limpar dados**, cancela a leitura em andamento ao limpar ou sair e limpa o estado depois de iniciar os dois downloads. Se apenas um dos arquivos for baixado, a tela mantém os dados até que a pessoa limpe ou saia.

O processamento dos PDFs usa recursos de leitura que são encerrados ao final ou no cancelamento. URLs temporárias dos arquivos gerados são revogadas após o início do download. Essas medidas removem referências mantidas pelo aplicativo; JavaScript não garante a sobrescrita imediata de todas as cópias em memória, cache ou arquivos temporários sob controle do navegador ou sistema operacional.

O arquivo original selecionado continua onde estava no computador. Os arquivos baixados são salvos pelo navegador no computador e não são removidos pelo aplicativo. O histórico de downloads, outras cópias, extensões e backups também dependem das configurações do navegador e do sistema. Arquivos enviados em conversas ou a outros serviços seguem as regras desses serviços, fora do controle do site.

## Armazenamento local e rede

No código do aplicativo, a preferência de tema (`light` ou `dark`) é persistida no `localStorage`; dados contábeis e arquivos não devem ser gravados em `localStorage`, `sessionStorage`, IndexedDB ou Cache Storage. A política de conteúdo do GitHub Pages restringe conexões à própria origem; o código atual não implementa envio dos arquivos. A configuração do Netlify é distinta e não se aplica ao GitHub Pages.

## Proteções do repositório

O `.gitignore` bloqueia formatos contábeis e documentos privados. A publicação executa `npm run security:check`, que verifica documentos rastreados e padrões conhecidos de comunicação. Essa verificação é preventiva, não prova uma ausência absoluta de riscos ou de persistência fora do aplicativo.

Em computadores compartilhados, use **Limpar dados**, feche a aba ao terminar e cuide dos arquivos baixados e das cópias originais de acordo com sua necessidade.
