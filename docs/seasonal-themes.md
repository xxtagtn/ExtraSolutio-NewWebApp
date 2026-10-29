# Temas sazonais

Escolha em Utilizador > Aparência ou O meu perfil > Aparência. A aplicação mantém
Original por omissão. Alterar o tema aplica e guarda a escolha imediatamente,
sem submeter o formulário do perfil ou alterar dados operacionais.

## Preferência Da Conta E Picagens

A preferência é guardada no servidor em `UserAppearance` e mantida em cache local
(`extrasolutio.appearance.theme:<id>`). A primeira leitura sem preferência remota
mantém a escolha local anterior; uma preferência remota já guardada prevalece após
reabrir a aplicação. As gravações são serializadas e as atualizações de fundo não
substituem uma escolha ainda em gravação. Se o servidor falhar, a aparência local
continua utilizável, mas a interface avisa que a conta e os links não foram atualizados.

Em Aparência, um administrador pode escolher **Usar o meu tema nos links de
picagem**, confirmar **Aplicar aos links**, e associar a sua conta ao tema público.
É uma configuração inicial explícita; não é escolhido silenciosamente o primeiro
administrador que inicia sessão. A partir daí, qualquer mudança do tema dessa conta
atualiza também os links já existentes. Preferências de outras contas não mudam o
tema público. A transferência para outra conta administrativa exige novamente a
confirmação explícita. O seletor ao lado do utilizador foi removido.

`UserAppearance.publicScope` tem índice único: apenas uma conta controla o tema
público. O vínculo é removido se essa conta for eliminada, sem eliminar picagens.
A migração `20261029010000_user_appearance` acrescenta apenas esta tabela e a
relação com User; não modifica eventos, colaboradores ou QR Codes.

GET/PUT autenticados em `/auth/appearance` nunca aceitam um ID de conta escolhido
pelo cliente. Só administradores podem publicar/transferir o controlo; qualquer
utilizador autenticado pode guardar a sua aparência pessoal. O payload público
expõe apenas `appearance.theme`, sem ID, nome ou email do administrador.
O modo Automático é resolvido no servidor em Europe/Lisbon. Os links públicos
usam o refrescamento existente (15 segundos ou ao focar a janela), sem mudar URLs.
As verificações dos tokens acontecem antes de consultar o tema. Uma falha na leitura
da aparência devolve Original, sem transformar uma picagem guardada num falso erro.

## Calendário automático

Datas inclusivas, sempre em Europe/Lisbon, independentemente do fuso do dispositivo:

- Halloween: 25 de outubro a 2 de novembro.
- Natal: 1 de dezembro a 6 de janeiro.
- Páscoa: Domingo de Ramos a segunda-feira de Páscoa (data gregoriana móvel).
- Restantes datas: Original.

O calendário é verificado a cada minuto, ao regressar ao separador e ao focar
a janela. A seleção manual não é alterada pelo calendário.

## Isolamento

O layout autenticado e os links de picagem válidos recebem `data-seasonal-theme`.
O login permanece inalterado. As cores semânticas globais, estados financeiros,
permissões, PDF/Excel e regras de negócio não são modificados. Os apontamentos
sazonais estão limitados ao cabeçalho, avatar, navegação e cantos vazios dos
indicadores do Dashboard. Não há animação nem decoração sobre as tabelas.
As ilustrações são ocultadas na impressão.

## Composição visual

A versão expressiva utiliza as últimas propostas aprovadas como referência,
em vez de limitar o tema a um símbolo e um canto decorativo:

- Cabeçalho com cenário de 264px em desktop, controlos separados da ilustração
  em mobile e título fiel à composição aprovada (serifado apenas no Halloween).
- Composição na base da barra lateral, sem ocupar o espaço dos links. Na versão
  recolhida não é renderizada. O menu móvel continua fixo e deslocável.
- Grinalda na margem exterior da navegação e pequenos detalhes nos cantos dos KPIs.
- A seleção no perfil continua disponível em todos os tamanhos de ecrã;
  não existe um seletor extra junto ao utilizador.
- Nos links de picagem, o cenário compacto fica acima do nome e do serviço,
  com um apontamento no rodapé. Os botões de entrada/saída mantêm as cores e regras.
- A grinalda lateral utiliza células completas, sem recortar uma faixa de 15px;
  os links têm margem de segurança e a composição inferior fica dentro da coluna.

`SeasonalArtwork.jsx` e as regras em `SeasonalAppearance.css` recortam os cenários
dentro das suas áreas. Todas as ilustrações têm `pointer-events: none` e são
decorativas para leitores de ecrã. As proporções e posições são adaptadas em mobile.

Foram gerados três atlas transparentes com a ferramenta de imagem integrada,
usando cada imagem aprovada como referência, sem gerar texto ou controlos:

- `halloween-scene.png`: abóboras esculpidas, lanternas, folhas, lua, casa e teias.
- `christmas-scene.png`: aldeia de madeira, pinheiros, luzes, presentes e ornamentos.
- `easter-scene.png`: ovos decorados, flores, folhas e fitas pastel.

Prompt comum: atlas 2:1, metade superior com cenário panorâmico contínuo; metade
inferior com quatro células quadradas para a composição lateral, grinalda, detalhe
de KPI e uma célula vazia. Fundo alfa transparente, sem UI nem texto, mantendo a
composição e os materiais das imagens aprovadas. Os recortes CSS evitam contaminação
entre células. O sprite anterior `seasonal-motifs.png` é reutilizado apenas nos
seletores do perfil.

As imagens são servidas localmente com hash pelo Vite, sem pedidos externos.
O tema Original não renderiza os cenários nem altera as dimensões do cabeçalho.

## Verificação

`node --test src/utils/seasonalTheme.test.mjs`

`TEST_BASE_URL` e `PLAYWRIGHT_MODULE` podem configurar a execução de
`node tests/seasonal-theme.browser.mjs`, que usa apenas APIs simuladas.
Os testes cobrem 320, 390, 768, 1024, 1280, 1440 e 1900px, carregamento e
transparência dos atlas, persistência, isolamento entre contas, calendário,
cliques no menu, navegação recolhida, impressão e preservação de formulários.
As capturas são feitas depois de descodificar a imagem para não confundir uma
imagem ainda a carregar com o resultado final.

`node --test server/services/userAppearance.test.mjs` cobre HTTP autenticado,
permissões, persistência, transferência de controlo, os três tipos de QR e as
regras originais de picagem numa base SQLite temporária.
`node tests/qr-seasonal-theme.browser.mjs` cobre os quatro temas, os três tipos
de links, atualizações sem mudar URLs, entrada/saída, cooldown e decoração
responsiva em 320, 390 e 1440px com APIs simuladas.

## Publicação

Esta atualização exige a migração MySQL `20261029010000_user_appearance`, geração
do cliente Prisma, build do frontend e reinício da API. Não foi aplicada qualquer
migração à base de dados real durante o desenvolvimento. O esquema MySQL foi
validado; os testes de persistência e migração foram executados em SQLite isolado.

Na primeira utilização, o administrador responsável confirma em Aparência
**Usar o meu tema nos links de picagem > Aplicar aos links**. A preferência
atualmente selecionada é guardada e passa a controlar os links. A confirmação
não é repetida nas mudanças de tema seguintes.

Validação local: 1.295 testes automatizados aprovados, testes de browser dos temas
do painel em sete larguras e dos três tipos de link em três larguras, lint, build
e verificação PWA aprovados. A geração normal do Prisma no Windows encontrou
um motor DLL em uso (EPERM na substituição do ficheiro). O cliente já atualizado
expõe o novo modelo e todos os testes reais de API/BD passaram com esse motor;
não foi interrompido nenhum processo existente para libertar o ficheiro.
