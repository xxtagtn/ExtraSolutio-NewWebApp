# Atualizacao de dependencias de 18/11/2026

## Alteracoes

- Correcoes de seguranca no lockfile, incluindo body-parser, proxy-addr,
  qs, shell-quote e ferramentas de build. Nao foi usado npm audit fix --force.
- React Router 7.18.6: elimina os avisos que ainda afetavam a serie 6.
  Mantem-se BrowserRouter e as rotas declarativas, sem adotar SSR ou framework.
- Importacao Excel com SheetJS 0.20.3, obtido no canal oficial do fabricante.
  A versao antiga 0.18.5 do registo npm deixa de ser utilizada.
- Exportacoes formatadas continuam a usar xlsx-js-style, sem mudar o layout.
- Prisma e cliente mantidos em 6.19.3, com a dependencia de @prisma/config
  deepmerge-ts substituida especificamente por 8.0.2. Nao ha migracao para
  Prisma 7/8 nem alteracoes aos schemas ou dados.
- allowScripts autoriza apenas os tres pacotes Prisma, na versao revista
  6.19.3, para instalacoes com npm 12. Nao autorizar globalmente todos os scripts.

## Publicacao

Publicar package.json e package-lock.json do mesmo commit. A configuracao
allowScripts faz parte do repositorio: nao e preciso voltar a aprovar os tres
pacotes manualmente, enquanto estas versoes forem mantidas.

Se anteriormente foi executado npm install-scripts approve no servidor,
verificar primeiro `git diff -- package.json`. Preservar alteracoes legitimas;
nao usar reset --hard nem descartar o ficheiro para resolver um conflito.

Antes de iniciar, confirmar o backup e a disponibilidade dos tarballs npm e
de https://cdn.sheetjs.com. O lockfile fixa o URL e a integridade do SheetJS.
Esta correcao, por si so, nao exige migracoes. Se houver outras alteracoes de
schema no commit publicado, seguir o procedimento de migracoes dessas alteracoes.

Executar os passos individualmente e parar se algum falhar:

```bash
cd /var/www/esgestao.ddns.net
sudo -u esgestao -H npm run db:backup
sudo systemctl stop esgestao-api
sudo -u esgestao -H git pull --ff-only
sudo -u esgestao -H npm ci
sudo -u esgestao -H chmod u+x node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
sudo -u esgestao -H npm run db:generate:mysql
sudo -u esgestao -H npm run build
sudo -u esgestao -H npm run verify:pwa
sudo systemctl start esgestao-api
sudo systemctl is-active esgestao-api
curl -fsS http://127.0.0.1:3001/api/health
sudo -u esgestao -H npm audit
sudo -u esgestao -H npm audit --omit=dev
```

Se houver falha, guardar a mensagem e nao iniciar uma versao parcialmente
publicada. Repor uma versao completa e conhecida pelo procedimento de rollback
do servidor; nao apagar a base, os uploads ou o .env.

## Verificacoes locais

- `npm audit` e `npm audit --omit=dev`.
- Suite Node de regras, API, seguranca e Excel.
- `node --test tests/dependency-toolchain.test.mjs`: valida e gera clientes
  SQLite/MySQL em diretorias temporarias, sem ligar a bases reais; verifica
  a leitura dos formatos XLSX, XLS e CSV.
- Navegacao, formularios e links de picagem em browser com API simulada.
- `npm run build` e `npm run verify:pwa`.

## Reinicio local apos atualizar dependencias

Parar a stack de desenvolvimento ANTES de instalar/atualizar dependencias.
Nao manter servidores Vite de versoes diferentes a usar a mesma cache
node_modules/.vite. Depois da instalacao, iniciar a API e o frontend novamente;
para regenerar a cache do frontend, usar `npm run dev:web -- --force`.
Atualizar tambem os separadores que estavam abertos no browser.

O teste `tests/dependency-pages.browser.mjs` verifica a navegacao SPA entre
Eventos/Servicos e Balancete (com graficos), o regresso e o refresh, sem
escrever dados reais. Usa TEST_BASE_URL, por omissao http://localhost:5173.

Zero avisos e uma fotografia da auditoria no momento da verificacao, nao uma
garantia de ausencia de vulnerabilidades futuras. A publicacao no servidor
e a verificacao MySQL real sao passos separados dos testes locais.

## Resultados de 18/11/2026

- Auditoria completa: 0 vulnerabilidades. Auditoria de producao: 0.
- Build e verificacao PWA passaram.
- Teste adicional do toolchain: 2 passaram, incluindo validacao e geracao dos
  dois clientes Prisma e leitura de XLSX, XLS e CSV.
- Suite geral: 1393 passaram de 1394. A falha em
  server/services/staffPaymentAdjustment.test.mjs:67 espera o ano do pagamento,
  mas staffAnalysisYears usa o ano do servico. A mesma entrada devolveu [2026]
  no codigo HEAD anterior e no atual, em vez do [2026, 2027] esperado pelo teste.
  Nao foram alteradas regras financeiras nem esse teste nesta correcao.
- Browser com API simulada: pesquisa/filtros/paginacao em 9 larguras (320 a
  1920 px), seguranca de sessao em 2 larguras, fardamento/picagens em 3 larguras
  e exportacao Excel com 32 colaboradores em 2 larguras passaram.

## Fontes

- https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- https://github.com/advisories/GHSA-ggr8-5vv4-36mx
- https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
- https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/
