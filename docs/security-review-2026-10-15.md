# Revisao de seguranca limitada - ExtraSolutio

Data: 15/10/2026. Observacoes HTTP entre 16:18 e 16:22 UTC.
Alvo autorizado: https://esgestao.ddns.net/login e endpoints da mesma aplicacao.

## Escopo e limites

- Exploracao da pagina publica no navegador, sem iniciar sessao.
- Poucos pedidos HTTP/HTTPS GET e HEAD, sem varrimento de portas ou carga.
- Um POST ao webhook com corpo `{}` e assinatura deliberadamente invalida: sem mensagens, destinatarios ou estados de entrega.
- Nenhuma tentativa de palavra-passe no servidor publico; nenhum envio WhatsApp ou alteracao de dados de negocio em producao.
- Simulacoes adicionais com os routers locais, utilizador ficticio e metodos Prisma substituidos por objetos em memoria. Nao foi iniciado `server/index.js` nem os seus schedulers.
- O codigo local tem alteracoes ainda nao publicadas. Resultados locais nao demonstram, por si so, o mesmo comportamento da versao online.
- Esta analise nao certifica ausencia de outras vulnerabilidades. Autorizacao entre perfis, acessos a objetos de terceiros, XSS/SQL injection e infraestrutura nao foram auditados exaustivamente.

## 1. Alta: login servido por HTTP sem obrigar HTTPS

Confirmado online:

- GET e HEAD de `http://esgestao.ddns.net/login` responderam `200`, sem `Location`.
- O documento recebido por HTTP e identico ao login HTTPS (comparacao SHA-256 em memoria).
- O bundle publico `/assets/index-zOlXs7rF.js` configura a API como `/api` e faz o login atraves de `/auth/login`.
- A resposta HTTPS do login nao contem `Strict-Transport-Security`.

Impacto: quem abrir a pagina por HTTP pode enviar as credenciais tambem por HTTP. Um interveniente na rede pode ler ou alterar esse trafego. Nao foram submetidas credenciais para comprovar o risco.

Correcao recomendada: redirecionar HTTP para HTTPS no Apache, incluindo caminhos da API; ativar HSTS apenas depois de confirmar a configuracao HTTPS. Nao adicionar `includeSubDomains`/preload sem avaliar os outros subdominios. Nao depender apenas de um redirecionamento JavaScript ou das preferencias do navegador.

## 2. Alta: webhook WhatsApp sem autenticacao da origem no codigo revisto

Confirmado online: POST `/api/whatsapp/webhook`, corpo `{}`, cabecalho `X-Hub-Signature-256: sha256=invalid-audit-signature`, respondeu `200 OK`. Este teste vazio nao demonstra isoladamente que um evento real seja processado, mas mostra que o endpoint nao rejeita globalmente uma assinatura invalida.

Confirmado no codigo e em simulacao local:

- `server/routes/whatsapp.js:25` processa o POST sem verificar a assinatura da Meta.
- `server/routes/index.js:583` monta o webhook antes do middleware de autenticacao. Isso e normal para um webhook, desde que a assinatura seja verificada.
- Um estado de entrega ficticio, com assinatura invalida, chegou ao processador e atualizou exatamente um registo simulado para `read`.
- A verificacao GET por `WHATSAPP_WEBHOOK_VERIFY_TOKEN` nao autentica os POST posteriores.

Impacto: um emissor nao autenticado pode tentar forjar estados de entrega se conhecer um ID de mensagem. Caso as respostas automaticas estejam ativas, mensagens recebidas forjadas tambem podem acionar respostas; essa configuracao online e esse envio nao foram testados.

Correcao recomendada: validar `X-Hub-Signature-256` com HMAC-SHA256 sobre os bytes originais do corpo e o App Secret da Meta, usando comparacao em tempo constante, antes de processar qualquer evento. Rejeitar assinatura ausente/invalida. Preservar o fluxo GET de verificacao, deduplicacao e estados existentes.

## 3. Media: fotografia de colaborador acessivel sem sessao

Confirmado online apenas por HEAD, sem descarregar a imagem:

- Um URL de fotografia de colaborador ja conhecido no contexto respondeu `200`, `Content-Type: image/png`, sem token.
- A resposta inclui `Cache-Control: public, max-age=604800` (sete dias).
- `/uploads/` respondeu `404`: nao foi detetada listagem publica de diretorio.

O codigo em `server/index.js:23` serve `/uploads` com `express.static` sem autenticacao. O nome dificil de adivinhar reduz descoberta casual, mas nao revoga acesso quando o URL e conhecido ou partilhado.

Impacto: se estas fotografias sao privadas, quem possuir o URL consegue consulta-las mesmo sem permissao ou depois de terminar sessao. Nao ha prova de acesso publico a documentos fiscais, IBAN ou outros dados atraves desta verificacao.

Correcao recomendada: decidir explicitamente se as fotografias sao publicas. Caso nao sejam, servi-las por endpoint autorizado ou por URLs assinados de curta duracao, com politica de cache adequada. Proteger tambem o caminho estatico antigo no proxy, nao apenas criar um novo endpoint.

## 4. Media: mudar a palavra-passe nao revoga um token existente

Confirmado apenas em simulacao do codigo local, com conta ficticia em memoria:

| Passo | Resultado |
| --- | --- |
| Login ficticio | 200 |
| Alterar a palavra-passe ficticia | 200 |
| Consultar `/auth/me` com o token anterior | 200 |
| Renovar sessao com o token anterior em `/auth/refresh` | 200 |

`server/routes/auth.js:177` altera o hash da palavra-passe; `server/middleware/auth.js:15` verifica o JWT e a existencia do utilizador, sem versao de sessao ou invalidacao por alteracao de credenciais. O logout no frontend remove apenas o estado local.

Impacto: se um token for roubado, mudar a palavra-passe pode nao expulsar quem o tem. A renovacao permite prolongar esse acesso enquanto o token apresentado estiver valido. Nao foi testado com contas ou tokens reais online.

Correcao recomendada: invalidacao verificavel no servidor, por versao de credenciais/sessao ou registos de sessoes revogaveis, aplicada tambem ao refresh. Avaliar migracao e compatibilidade antes de implementar.

## Reforcos adicionais

- Nao foi encontrado `Content-Security-Policy` na resposta do login. O token esta guardado em `localStorage` no bundle publico: uma eventual XSS teria maior impacto. Nao foi encontrada nem demonstrada uma XSS nesta revisao. Uma CSP precisa ser ajustada e testada com a app/PWA; nao colar uma politica generica que bloqueie funcionalidades.
- A resposta divulga `Apache/2.4.68 (Debian)` e a API `X-Powered-By: Express`. Reduzir identificacao e um reforco de baixa prioridade; a versao divulgada nao prova uma vulnerabilidade conhecida.
- O codigo local escreve `DATABASE_URL` no log de arranque (`server/index.js:58`). Remover ou mascarar essa informacao se a string incluir credenciais. Nao foram consultadas credenciais reais nem comprovada exposicao publica dos logs.
- Existe limitacao de falhas de login no codigo local (por combinacao IP/email). Nao foi testada por tentativas repetidas no site; a sua presenca nao prova protecao contra todos os tipos de abuso.

## Verificacoes favoraveis

- HTTPS respondeu sem desativar validacao do certificado.
- Sem sessao: `/api/auth/me`, `/api/clients`, `/api/services`, `/api/collaborators`, `/api/invoices`, `/api/users` e `/api/backups` responderam `401`, `Token em falta.`
- `/api/auth/me` com token malformado respondeu `401`, `Token invalido.`
- O login inclui `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` e `Referrer-Policy: strict-origin-when-cross-origin`.
- Um GET a `/api/health` com Origin externo nao devolveu `Access-Control-Allow-Origin` a autorizar essa origem. Nao foi detetada permissao CORS ampla nesse pedido.
- `/.env`, `/.git/HEAD` e o caminho `.js.map` verificado devolveram o mesmo HTML do login. O `200` e fallback da SPA, nao prova de exposicao desses ficheiros. Os corpos foram comparados sem publicar conteudos sensiveis.
- O JavaScript publico consultado nao tem referencia `sourceMappingURL`. Ver JavaScript/HTML no navegador e esperado numa aplicacao frontend e nao constitui, por si so, fuga de segredos.

## Prioridades

1. Obrigar HTTPS e preparar HSTS.
2. Autenticar os POST do webhook WhatsApp pela assinatura Meta.
3. Rever acesso e cache das fotografias privadas.
4. Implementar revogacao de sessoes na mudanca de credenciais.
5. Afinar CSP e evitar segredos nos logs.

Nao foram alterados codigo funcional, base de dados, configuracao do servidor ou publicacao online. Apenas foi criado este relatorio local.
