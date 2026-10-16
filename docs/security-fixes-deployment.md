# Correcoes de seguranca: publicacao e verificacao

## Escopo

Estas alteracoes tratam os quatro problemas do relatorio de 15/10/2026.
Nao alteram schemas Prisma, tabelas, dados de negocio, permissoes funcionais,
calculos, estados financeiros, horarios, picagens, orcamentos ou QR Codes.
Nao executar migracoes por causa desta correcao.

O backend passa a ler o hash ja existente da palavra-passe na mesma consulta
de autenticacao que ja era feita. Isto e indispensavel para invalidar tokens
apos a mudanca de credenciais, sem criar colunas nem tabelas. O hash nunca
e devolvido ao frontend nem inserido diretamente no JWT.

## O que muda

1. Apache: o VirtualHost HTTP apenas redireciona para HTTPS, com destino fixo
   e codigo 308. O HTTPS recebe HSTS inicial de um dia, sem includeSubDomains
   ou preload. Em NODE_ENV=production a API escuta apenas em 127.0.0.1,
   conforme a arquitetura Apache local, evitando contornar o TLS pela porta
   Node. O desenvolvimento mantem o binding anterior. A parte Apache so fica
   ativa depois de atualizar a configuracao do servidor real.
2. WhatsApp: todos os POST do webhook exigem HMAC-SHA256 da Meta sobre os
   bytes originais. Assinatura ausente/invalida retorna 401, sem processamento.
   App Secret ausente retorna 503, sem bypass de desenvolvimento. O desafio
   GET continua a usar WHATSAPP_WEBHOOK_VERIFY_TOKEN. Envios, modelos,
   lembretes e regras de resposta/deduplicacao nao foram alterados.
3. Fotos: o antigo /uploads deixa de servir ficheiros. /api/uploads/collaborators
   exige JWT atual e a permissao colaboradores.view, igual ao acesso existente
   as fichas. O frontend carrega os bytes autenticados em memoria (blob), sem
   colocar tokens no URL, e liberta-os ao sair/desmontar. A API usa no-store.
   O build deixa de copiar public/uploads, mantendo logos, manifestos, icones
   e service worker. Os ficheiros persistidos nao sao movidos nem apagados.
4. Sessoes: o JWT inclui uma impressao HMAC opaca derivada do hash atual da
   palavra-passe. Tokens anteriores a uma mudanca deixam de funcionar tambem
   no refresh e nas fotografias. A pessoa que muda a propria palavra-passe
   recebe um token novo na mesma resposta; os outros dispositivos sao rejeitados
   no pedido seguinte. Mudancas de nome/foto nao invalidam a sessao.

Tokens de login emitidos pela versao antiga nao possuem esta impressao e sao
rejeitados: todos os utilizadores terao de iniciar sessao uma vez apos o deploy.
NAO alterar JWT_SECRET: a correccao nao requer a sua rotacao, que invalidaria
QR Codes/links assinados ja distribuidos.

O logout habitual continua a limpar o browser, nao constitui revogacao global
de dispositivos. Esta correcao trata a revogacao por mudanca de credenciais;
uma gestao global de sessoes exigiria um mecanismo persistente adicional.

## Preparar antes do deploy

- Rever o diff e executar testes, lint, build e verify:pwa.
- Guardar uma copia da configuracao Apache atual fora da pasta publica.
- Confirmar que o certificado atual de esgestao.ddns.net e valido.
- Adicionar WHATSAPP_APP_SECRET ao .env privado, obtido nas definicoes da
  aplicacao Meta. Nao e o Access Token nem o Webhook Verify Token.
- Nao enviar esse segredo pelo chat, Git, VITE_* ou screenshots.
- Manter WHATSAPP_AUTO_REPLY_ENABLED e WHATSAPP_REMINDER_ENABLED nos seus
  valores atuais. Nao ativar automacoes para testar esta publicacao.
- Confirmar o nome real do servico systemd e o VirtualHost TLS em uso.

## Apache existente

Nao substituir o VirtualHost TLS completo: preservar certificados, proxies,
rewrites da SPA e regras de cache do PWA.

- Substituir apenas o VirtualHost *:80 da aplicacao pelo conteudo de
  deploy/apache/esgestao-http.conf. Nao adicionar um segundo VirtualHost
  concorrente para o mesmo dominio/porto.
- Dentro do VirtualHost *:443 existente incluir:

```apache
Include /var/www/esgestao.ddns.net/deploy/apache/esgestao-https-security.conf
```

- Manter o proxy /api/ para http://127.0.0.1:3001/api/. As fotografias novas
  seguem esse mesmo proxy; /uploads e bloqueado pelo LocationMatch, mesmo
  quando ha um Alias/proxy antigo ou ficheiros de um build anterior.
- Confirmar que nao ha outro Alias/document root publico a expor public/uploads.
- Ativar headers/rewrite se ainda nao estiverem ativos. Nao trocar os caminhos
  dos certificados nem mexer nos outros sitios do servidor.

Validar ANTES de recarregar:

```bash
sudo apache2ctl configtest
sudo apache2ctl -S
```

Apenas com Syntax OK, recarregar Apache. Nao foi possivel executar estes
comandos neste ambiente Windows nem aplicar a configuracao ao servidor real.

HSTS comeca por max-age=86400 para limitar impacto de configuracao. Aumentar
a duracao apenas depois de confirmar estabilidade do HTTPS e renovacao TLS.
Nao ha includeSubDomains/preload. Nao foi introduzida CSP obrigatoria: esta
nao era uma das quatro falhas, e exportacoes/impressao, estilos dinamicos,
imagens data/blob e integracoes exigem uma auditoria propria antes de a aplicar.

## Publicacao coordenada

Publicar frontend e backend na mesma janela para evitar um frontend antigo
a tentar abrir as antigas fotos sem autenticacao. Por exemplo, para o servico
e diretoria ja documentados neste projeto:

```bash
cd /var/www/esgestao.ddns.net
# Atualizar apenas para o commit revisto; preservar .env e public/uploads.
sudo -u esgestao -H npm ci
sudo -u esgestao -H npm run build
sudo -u esgestao -H npm run verify:pwa
test ! -d dist/uploads
# Apos configtest e com o App Secret ja configurado:
sudo systemctl restart esgestao-api
sudo systemctl reload apache2
```

Nao usar o procedimento generico db:deploy desta documentacao para esta
correcao: ela nao necessita de migracoes. Se houver outros commits com schema
pendentes, trata-los separadamente, nao os aplicar sem revisao.

Os hashes dos assets mudam no novo build e o service worker existente faz
network-first na navegacao. Confirmar a versao nova numa sessao privada e
atualizar as sessoes abertas. Se existir cache CDN/proxy de fotografias,
invalidar os antigos URLs. Uma copia ja descarregada por terceiros nao pode
ser recuperada retroativamente e caches antigos podem durar ate sete dias.

## Verificacao apos publicar

```bash
curl -I http://esgestao.ddns.net/login
# Esperado: 308 e Location https://esgestao.ddns.net/login
curl -I https://esgestao.ddns.net/login
# Esperado: HSTS max-age=86400, nosniff, SAMEORIGIN e referrer policy
curl -I https://esgestao.ddns.net/uploads/collaborators/ficheiro-conhecido.png
# Esperado: 403/404, nunca os bytes da imagem
curl -I https://esgestao.ddns.net/api/uploads/collaborators/ficheiro-conhecido.png
# Esperado sem sessao: 401
curl -i -X POST https://esgestao.ddns.net/api/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Hub-Signature-256: sha256=invalid' --data '{}'
# Esperado: 401; 503 significa que falta o App Secret. Nao colocar mensagens.
```

Com conta de teste, confirmar login, foto/miniatura/zoom, mudar palavra-passe,
continuidade da sessao atual e rejeicao dos tokens anteriores noutro dispositivo.
Confirmar permissoes e que os utilizadores sem acesso a colaboradores nao
recebem fotografias. Testar links/QR Codes ja emitidos sem efetuar picagens
reais de teste, e a rececao de webhooks Meta legitimos quando existir uma
notificacao real autorizada. Nao enviar templates/lembretes so para testar.

## Fontes tecnicas

- Meta: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/
- Apache: https://httpd.apache.org/docs/2.4/rewrite/remapping.html

O relatorio original permanece como fotografia do estado anterior, nao como
afirmacao de que o servidor ja recebeu estas correcoes.

## Analise e ficheiros alterados

| Falha e causa | Alteracoes principais |
| --- | --- |
| HTTP servia o mesmo login e API relativa, sem obrigar TLS | deploy/apache/esgestao-http.conf; deploy/apache/esgestao-https-security.conf; server/index.js (binding de producao); README.md |
| POST do webhook era processado antes de autenticar a origem | server/security/whatsappSignature.js; server/routes/whatsapp.js; server/index.js (captura dos bytes originais); .env.example |
| express.static e copia do publicDir expunham fotografias | server/routes/privateUploads.js; server/routes/index.js; server/index.js; scripts/privatePublicAssets.js; vite.config.js |
| img nao envia o Authorization usado pela API | src/components/UI/CollaboratorImage.jsx; src/utils/privatePhotos.js; src/utils/api.js; src/utils/collaboratorDetails.js; src/pages/Collaborators.jsx |
| JWT validava apenas assinatura/expiracao/utilizador, mesmo apos alterar password | server/security/sessionTokens.js; server/middleware/auth.js; server/routes/auth.js; src/hooks/useAuth.jsx; src/pages/Profile.jsx |

Foram tambem ajustadas apenas as credenciais das fixtures em quatro suites
financeiras, para usarem o mesmo emissor seguro de tokens. Um teste que avanca
meses no calendario recebeu um TTL de teste compativel, sem alterar o TTL de
producao. Nao foram alteradas as regras nem as assercoes dos calculos.

Foi removido o log de DATABASE_URL no arranque para nao escrever eventuais
credenciais da base de dados nos logs. Nao foi lido nem alterado o .env real.

## Resultados locais de 15/10/2026

- Suite Node completa: **1074 testes, 1074 passaram, 0 falhas**. Log local:
  node_modules/.cache/security-final-tests.log.
- Suite especifica de seguranca: 10 testes passaram, incluindo assinatura
  ausente/invalida/corpo alterado, assinatura valida, falta de App Secret,
  desafio GET, permissoes de fotos, HEAD, miniaturas, travessia de caminhos,
  revogacao apos mudar password, refresh, tokens antigos/expirados/adulterados,
  exclusao de uploads do build e bloqueio dos caminhos de desenvolvimento.
- Chrome, 390 e 1440px: fotos e miniaturas autenticadas, zoom, ausencia de
  fallback publico em 403 e utilizacao do token novo depois de mudar password.
- Chrome, sessao: login, inatividade de 60 minutos, renovacao, 401 concorrentes,
  ausencia de logout indevido em 403, logout entre separadores e sem erros JS.
- Chrome, financeiro em 320/390/768/1440px: pagamento antecipado, validacao de
  horas, saldo adicional, recebimento separado, historico e excesso recebido.
- npm run lint: passou sem erros/avisos.
- npm run build: passou. Mantem o aviso anterior sobre o chunk XLSX >500 kB;
  nao foi feita uma refatoracao de bundles nesta tarefa.
- npm run verify:pwa: passou; manifestos, icones e service worker preservados.
- Confirmado que dist/uploads nao existe depois do build final.
- HEAD no Vite local, URL normal, codificado e /@fs: todos retornam 404 para
  fotografias privadas. Nenhuma fotografia real foi descarregada nestes testes.
- git diff --check: passou; schemas Prisma, package.json e lockfile inalterados.

As primeiras execucoes identificaram uma fixture com token expirado ao avancar
o relogio e uma fixture do navegador com formato de listagem incorreto. Foram
corrigidas e as suites repetidas. A verificacao adicional /@fs revelou o acesso
alternativo de desenvolvimento, que foi bloqueado e recebeu teste de regressao.

### Limites

Nao foi feito deploy, alterado o Apache online, iniciado o servidor com os seus
schedulers, enviado WhatsApp, alteradas contas reais ou executadas migracoes
na base de dados da aplicacao. Os testes usam simulacoes ou bases temporarias.

Nao foi possivel executar apache2ctl neste Windows nem confirmar o App Secret
da Meta em producao. A sintaxe da configuracao deve passar por configtest no
servidor antes do reload; HTTPS/HSTS e um webhook real assinado ainda precisam
de verificacao apos a publicacao. Nao se afirma que as falhas online ja estejam
resolvidas por existirem estas alteracoes locais.
