# ExtraSolutio WebApp

Guia de instalação e operação em produção para Linux + Apache + MariaDB.

Este projeto é composto por:

- Frontend: React, Vite e React Router.
- Backend: Node.js e Express.
- ORM/base de dados: Prisma.
- Base de dados de desenvolvimento: SQLite.
- Base de dados de produção: MySQL/MariaDB, usando `prisma/mysql/schema.prisma`.

O exemplo deste documento assume:

- Domínio: `esgestao.ddns.net`
- Diretório da aplicação: `/var/www/esgestao.ddns.net`
- Apache a servir o frontend.
- Node.js a executar a API localmente em `127.0.0.1:3001`.
- MariaDB local, sem exposição pública da porta 3306.

## 1. Pré-requisitos

Servidor recomendado:

- Debian 12/Ubuntu 22.04 ou superior.
- Node.js LTS compatível com Vite 8; usar Node.js 22 LTS ou superior.
- Apache 2.4.
- MariaDB 10.6 ou superior.
- DNS `A` de `esgestao.ddns.net` apontado para o IP público do servidor.

Instalar pacotes base:

```bash
sudo apt update
sudo apt install -y apache2 mariadb-server mariadb-client git curl ca-certificates
```

Instalar Node.js LTS. Exemplo para Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Confirmar que o Node é pelo menos a versão suportada pelo Vite instalado no projeto antes de continuar.

## 2. Criar a base de dados MariaDB

Executar o assistente de segurança e criar uma base de dados exclusiva para a aplicação:

```bash
sudo mariadb-secure-installation
sudo mariadb
```

Dentro do MariaDB:

```sql
CREATE DATABASE esgestao
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'esgestao'@'127.0.0.1'
  IDENTIFIED BY 'SUBSTITUIR_POR_UMA_PASSWORD_FORTE';

GRANT ALL PRIVILEGES ON esgestao.* TO 'esgestao'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

A password da base de dados deve ser URL-encoded quando tiver caracteres especiais. Por exemplo, `@` deve ser escrito como `%40` dentro de `DATABASE_URL`.

Não abrir a porta 3306 para a Internet. A aplicação usa `127.0.0.1` e não precisa de acesso externo à base de dados.

## 3. Colocar o projeto no servidor

Criar um utilizador de sistema sem login interativo para executar a API:

```bash
sudo useradd --system --home-dir /var/www/esgestao.ddns.net \
  --shell /usr/sbin/nologin esgestao
sudo mkdir -p /var/www/esgestao.ddns.net
sudo chown -R esgestao:esgestao /var/www/esgestao.ddns.net
```

Se o código estiver num repositório Git:

```bash
sudo -u esgestao -H git clone URL_DO_REPOSITORIO \
  /var/www/esgestao.ddns.net
```

Se for copiado de outro computador, não copiar `node_modules`, `dist`, `.env` nem bases SQLite:

```bash
sudo rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude '*.db' \
  CAMINHO_DO_PROJETO/ /var/www/esgestao.ddns.net/
sudo chown -R esgestao:esgestao /var/www/esgestao.ddns.net
```

Manter a pasta `public/uploads` entre atualizações. É aí que ficam as fotografias carregadas na aplicação.

## 4. Configurar o ambiente de produção

Criar o ficheiro de ambiente, que não deve ser versionado:

```bash
sudo -u esgestao -H nano /var/www/esgestao.ddns.net/.env
```

Conteúdo mínimo recomendado:

```dotenv
NODE_ENV=production
PORT=3001

DATABASE_URL="mysql://esgestao:PASSWORD_URL_ENCODED@127.0.0.1:3306/esgestao"

# Pelo menos 24 caracteres aleatórios. Não reutilizar este valor noutro serviço.
JWT_SECRET="GERAR_UM_SEGREDO_LONGO_E_ALEATORIO"
JWT_EXPIRES_IN="4h"

# O frontend será servido pelo mesmo domínio do Apache.
VITE_API_URL="/api"
CORS_ORIGINS="https://esgestao.ddns.net"

APP_PUBLIC_URL="https://esgestao.ddns.net"
CALENDAR_FEED_PUBLIC_URL="https://esgestao.ddns.net"
APP_TIMEZONE="Europe/Lisbon"

# Opcional: WhatsApp Cloud API.
# Nunca colocar tokens reais no Git ou em screenshots.
WHATSAPP_GRAPH_VERSION="v25.0"
WHATSAPP_PHONE_NUMBER_ID=""
WHATSAPP_BUSINESS_ACCOUNT_ID=""
WHATSAPP_ACCESS_TOKEN=""
WHATSAPP_WEBHOOK_VERIFY_TOKEN=""

# WhatsApp automation is disabled by default. Keep false for manual-only operation.
WHATSAPP_REMINDER_ENABLED="false"
WHATSAPP_AUTO_REPLY_ENABLED="false"

# Proteção de login.
LOGIN_WINDOW_MINUTES=15
LOGIN_MAX_FAILURES=5

# Backups MySQL executados pelo processo Node.
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_STARTUP_DELAY_MS=60000
BACKUP_RETENTION_DAYS=14
BACKUP_DIR="/var/backups/esgestao"
MYSQLDUMP_PATH="/usr/bin/mysqldump"
```

Gerar um segredo forte:

```bash
openssl rand -base64 48
```

O servidor recusa arrancar com `NODE_ENV=production` se `JWT_SECRET` estiver ausente, for conhecido ou tiver menos de 24 caracteres.

As variáveis `VITE_*` são incorporadas no build do frontend. Sempre que forem alteradas, é necessário executar novamente `npm run build`.

Configurar permissões:

```bash
sudo chown esgestao:esgestao /var/www/esgestao.ddns.net/.env
sudo chmod 600 /var/www/esgestao.ddns.net/.env
sudo mkdir -p /var/backups/esgestao
sudo chown -R esgestao:esgestao /var/backups/esgestao
sudo chmod 750 /var/backups/esgestao
```

## 5. Instalar dependências e preparar Prisma

Executar os comandos como o utilizador da aplicação:

```bash
cd /var/www/esgestao.ddns.net
sudo -u esgestao -H npm ci
sudo -u esgestao -H npm run db:generate:mysql
sudo -u esgestao -H npm run db:deploy:mysql
sudo -u esgestao -H npm run build
```

Pontos importantes:

- Em produção usar `db:deploy:mysql`.
- Não usar `npm run db:migrate`, porque esse script aponta para o schema SQLite e é destinado ao desenvolvimento.
- Não usar `prisma db push` em produção.
- `db:deploy:mysql` aplica apenas as migrações existentes em `prisma/mysql/migrations`.

Criar ou atualizar o administrador inicial sem guardar a password no `.env`:

```bash
cd /var/www/esgestao.ddns.net
sudo -u esgestao -H env \
  ADMIN_EMAIL='admin@exemplo.pt' \
  ADMIN_NAME='Administrador' \
  ADMIN_PASSWORD='PASSWORD_FORTE_DO_ADMIN' \
  npm run user:admin
```

O script valida a força da password e faz `upsert` do utilizador pelo email.

## 6. Configurar o serviço Node com systemd

Criar o serviço:

```bash
sudo nano /etc/systemd/system/esgestao-api.service
```

Conteúdo:

```ini
[Unit]
Description=ExtraSolutio API
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=esgestao
Group=esgestao
WorkingDirectory=/var/www/esgestao.ddns.net
EnvironmentFile=/var/www/esgestao.ddns.net/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /var/www/esgestao.ddns.net/server/index.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/www/esgestao.ddns.net/public/uploads /var/backups/esgestao

[Install]
WantedBy=multi-user.target
```

Ativar e verificar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now esgestao-api
sudo systemctl status esgestao-api --no-pager
sudo journalctl -u esgestao-api -n 100 --no-pager
```

Testar a API diretamente no servidor:

```bash
curl -i http://127.0.0.1:3001/api/health
```

A resposta esperada contém:

```json
{"ok":true,"service":"extrasolutio-api"}
```

Se a API não arrancar, verificar primeiro `journalctl`. Os erros mais comuns são `DATABASE_URL` incorreto, migrações não aplicadas ou `JWT_SECRET` fraco.

## 7. Configurar o Apache

Ativar módulos necessários:

```bash
sudo a2enmod proxy proxy_http rewrite headers expires
```

Criar o VirtualHost:

```bash
sudo nano /etc/apache2/sites-available/esgestao.ddns.net.conf
```

Conteúdo:

```apache
<VirtualHost *:80>
    ServerName esgestao.ddns.net

    DocumentRoot /var/www/esgestao.ddns.net/dist

    <Directory /var/www/esgestao.ddns.net/dist>
        Options -Indexes
        AllowOverride None
        Require all granted

        RewriteEngine On
        RewriteCond %{REQUEST_URI} !^/api(?:/|$)
        RewriteCond %{REQUEST_URI} !^/uploads(?:/|$)
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /index.html [L]
    </Directory>

    # API Express no serviço Node local.
    ProxyPreserveHost On
    ProxyPass        /api/     http://127.0.0.1:3001/api/
    ProxyPassReverse /api/     http://127.0.0.1:3001/api/

    # Fotografias persistidas pelo backend em public/uploads.
    ProxyPass        /uploads/ http://127.0.0.1:3001/uploads/
    ProxyPassReverse /uploads/ http://127.0.0.1:3001/uploads/

    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    # O manifesto e o service worker devem ser sempre revalidados. Os restantes
    # assets do Vite mantêm cache forte através do hash no nome do ficheiro.
    <FilesMatch "^(manifest.*\.webmanifest|service-worker\.js)$">
        Header always set Cache-Control "no-cache, no-store, must-revalidate"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </FilesMatch>

    ErrorLog  ${APACHE_LOG_DIR}/esgestao-error.log
    CustomLog ${APACHE_LOG_DIR}/esgestao-access.log combined
</VirtualHost>
```

Ativar o site e validar a configuração:

```bash
sudo a2dissite 000-default.conf
sudo a2ensite esgestao.ddns.net.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

O `RewriteRule` é necessário para que URLs internas do React Router funcionem ao abrir uma página diretamente. As exceções de `/api` e `/uploads` evitam que o Apache devolva `index.html` no lugar das respostas do backend.

## 8. HTTPS com Let's Encrypt

Depois de o DNS estar a apontar para o servidor e o site HTTP responder:

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d esgestao.ddns.net
```

Escolher o redirecionamento de HTTP para HTTPS. Confirmar a renovação:

```bash
sudo systemctl status certbot.timer --no-pager
sudo certbot renew --dry-run
```

Depois do HTTPS, manter em `.env`:

```dotenv
CORS_ORIGINS="https://esgestao.ddns.net"
APP_PUBLIC_URL="https://esgestao.ddns.net"
CALENDAR_FEED_PUBLIC_URL="https://esgestao.ddns.net"
```

## 9. Firewall

Expor apenas SSH, HTTP e HTTPS:

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3001/tcp
sudo ufw deny 3306/tcp
sudo ufw enable
sudo ufw status verbose
```

Se o SSH usar uma porta diferente, permitir essa porta antes de ativar o firewall.

## 10. Backups MariaDB

O backend tem um agendador que cria backups MySQL quando `MYSQLDUMP_PATH` e `BACKUP_DIR` estão configurados. O primeiro backup automático ocorre aproximadamente um minuto depois do arranque e os seguintes respeitam `BACKUP_INTERVAL_HOURS`.

Testar manualmente:

```bash
sudo -u esgestao -H bash -lc \
  'cd /var/www/esgestao.ddns.net && npm run db:backup'
ls -lh /var/backups/esgestao
```

Os scripts `db:backup` e o agendador usam MariaDB quando `DATABASE_URL` começa por `mysql://`. O script `npm run db:restore` é específico para SQLite e não deve ser usado para restaurar a produção MariaDB.

Para uma cópia adicional independente do processo Node, criar `/root/.my.cnf`:

```ini
[client]
user=esgestao
password=SUBSTITUIR
host=127.0.0.1
```

Proteger o ficheiro:

```bash
sudo chmod 600 /root/.my.cnf
```

Exemplo de dump manual comprimido:

```bash
sudo mkdir -p /var/backups/esgestao-manual
sudo mysqldump --defaults-extra-file=/root/.my.cnf \
  --single-transaction --routines --triggers --events esgestao \
  | gzip | sudo tee "/var/backups/esgestao-manual/esgestao_$(date +%F_%H-%M).sql.gz" >/dev/null
```

Restaurar exige uma janela de manutenção. Fazer sempre um backup novo antes:

```bash
gunzip -c /var/backups/esgestao-manual/FICHEIRO.sql.gz \
  | sudo mariadb --defaults-extra-file=/root/.my.cnf esgestao
sudo systemctl restart esgestao-api
```

Não considerar um backup concluído até testar uma reposição numa base de dados separada. Manter pelo menos uma cópia fora deste servidor.

## 11. Atualizações futuras

Procedimento recomendado:

```bash
cd /var/www/esgestao.ddns.net

# 1. Backup antes de alterar código ou schema.
sudo -u esgestao -H npm run db:backup

# 2. Atualizar código.
sudo -u esgestao -H git pull --ff-only

# 3. Instalar exatamente as dependências do lockfile.
sudo -u esgestao -H npm ci
sudo -u esgestao -H npm run db:generate:mysql

# 4. Aplicar migrações MySQL e gerar frontend.
sudo systemctl stop esgestao-api
sudo -u esgestao -H npm run db:deploy:mysql
sudo -u esgestao -H npm run build
sudo -u esgestao -H npm run verify:pwa

# 5. Voltar a disponibilizar a API.
sudo systemctl start esgestao-api
sudo systemctl status esgestao-api --no-pager
```

Depois da atualização:

```bash
curl -fsS https://esgestao.ddns.net/api/health
curl -fsSI https://esgestao.ddns.net/manifest-v6.webmanifest
curl -fsSI https://esgestao.ddns.net/pwa-icons/icon-512-maskable-v6.png
sudo journalctl -u esgestao-api -n 100 --no-pager
```

Se a aplicação for copiada por `rsync`, preservar `public/uploads` e o `.env`. Nunca usar `rsync --delete` sem as exclusões adequadas.

## 12. Checklist de validação

### Infraestrutura

- [ ] DNS resolve `esgestao.ddns.net` para o servidor correto.
- [ ] MariaDB está ativo e a base `esgestao` foi criada com `utf8mb4`.
- [ ] Porta 3306 não está exposta publicamente.
- [ ] Node.js LTS instalado.
- [ ] Serviço `esgestao-api` ativo e configurado para iniciar no boot.
- [ ] Apache passa `apache2ctl configtest`.
- [ ] HTTPS e renovação Let's Encrypt configurados.

### Aplicação

- [ ] `/api/health` devolve `ok: true`.
- [ ] Login funciona sem refresh manual.
- [ ] Criar e editar cliente, colaborador, orçamento e evento.
- [ ] Fotografias de colaboradores continuam acessíveis depois de reiniciar a API.
- [ ] Migrações MySQL aplicadas com `db:deploy:mysql`.
- [ ] Exportações Excel/PDF funcionam.
- [ ] `npm run verify:pwa` confirma o manifesto e os ícones no `dist`.
- [ ] O manifesto v5 e o ícone maskable v5 respondem com HTTP 200 e o tipo de conteúdo correto.
- [ ] Validação de horas e Financeiro mostram os dados da MariaDB.
- [ ] Se usado, o feed de calendário gera URL HTTPS.
- [ ] Se usado, o WhatsApp tem as variáveis e webhook configurados para o domínio HTTPS.

### Segurança e recuperação

- [ ] `.env` tem permissões `600` e não está no repositório.
- [ ] `JWT_SECRET` tem pelo menos 24 caracteres aleatórios.
- [ ] Password do administrador não é a password de exemplo.
- [ ] `npm run db:backup` cria um dump MariaDB válido.
- [ ] Foi testada uma restauração numa base separada.
- [ ] Existe uma cópia de backup fora do servidor.

## 13. Problemas frequentes

### Prisma apresenta `P1013: invalid port number`

Este erro normalmente indica que a `DATABASE_URL` está mal formada. Em produção, a estrutura deve ser exatamente:

```dotenv
DATABASE_URL="mysql://UTILIZADOR:PASSWORD@127.0.0.1:3306/esgestao"
```

Não repetir a porta, por exemplo `:3306:3306`, e não deixar espaços ou quebras de linha no valor.

Se a password tiver caracteres especiais, deve ser URL-encoded. Exemplos: `@` vira `%40`, `#` vira `%23`, `:` vira `%3A`, `/` vira `%2F`, `%` vira `%25` e um espaço vira `%20`.

Exemplo: uma password `Minha@Senha#2026` deve aparecer na URL como:

```dotenv
DATABASE_URL="mysql://esgestao:Minha%40Senha%232026@127.0.0.1:3306/esgestao"
```

Uma alternativa simples é gerar uma password hexadecimal, que não precisa de encoding:

```bash
openssl rand -hex 24
```

Depois de corrigir o `.env`, validar a ligação antes de aplicar migrações:

```bash
cd /var/www/esgestao.ddns.net
sudo -u esgestao -H npx prisma validate --schema prisma/mysql/schema.prisma
sudo -u esgestao -H npm run db:deploy:mysql
sudo systemctl restart esgestao-api
sudo journalctl -u esgestao-api -n 50 --no-pager
```

### A página abre, mas os pedidos dão 404 ou a lista fica vazia

Confirmar que o build foi feito com `VITE_API_URL="/api"`, que o Apache tem `ProxyPass /api/` e que a API está ativa:

```bash
sudo systemctl status esgestao-api --no-pager
curl -i http://127.0.0.1:3001/api/health
sudo apache2ctl -S
```

### Depois de reiniciar, as fotografias desapareceram

As fotografias estão em `public/uploads`. Confirmar que essa pasta não foi apagada pelo processo de atualização e que o serviço tem permissão de escrita:

```bash
sudo -u esgestao test -w /var/www/esgestao.ddns.net/public/uploads
```

### A API recusa arrancar em produção

Verificar `JWT_SECRET`, `DATABASE_URL` e o log do serviço:

```bash
sudo journalctl -u esgestao-api -n 100 --no-pager
```

### A migração falha

Parar e não apagar ficheiros de migração. Fazer backup, validar credenciais MariaDB, confirmar que o schema usado é `prisma/mysql/schema.prisma` e executar:

```bash
sudo -u esgestao -H npm run db:deploy:mysql
```

Não trocar para `db:push` como solução de emergência sem uma cópia e uma revisão do schema.

### O backup automático aparece como `skipped`

Confirmar:

```bash
command -v mysqldump
grep -E '^(DATABASE_URL|MYSQLDUMP_PATH|BACKUP_)' /var/www/esgestao.ddns.net/.env
sudo journalctl -u esgestao-api -n 100 --no-pager | grep backup
```

`MYSQLDUMP_PATH` deve apontar para o caminho real devolvido por `command -v mysqldump`.

## 14. Notas importantes

- O frontend é estático depois de `npm run build`; o processo Node só serve a API e os uploads.
- O Apache deve ser o único serviço público da aplicação.
- Nunca colocar tokens WhatsApp, passwords ou `JWT_SECRET` no Git, screenshots, logs ou ficheiros JavaScript do frontend.
- Alterações de schema devem ser feitas através de migrações Prisma MySQL, revistas e testadas antes de produção.
- Antes de qualquer deploy, criar e verificar um backup restaurável.
