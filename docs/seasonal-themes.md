# Temas sazonais

Escolha em Utilizador > Aparência ou O meu perfil > Aparência. A aplicação mantém
Original por omissão. Alterar o tema aplica e guarda a escolha imediatamente,
sem submeter o formulário do perfil ou alterar dados operacionais.

## Preferência pessoal

A preferência é local a este navegador e utilizador (`extrasolutio.appearance.theme:<id>`),
seguindo o padrão das preferências visuais existentes. Não sincroniza entre
dispositivos. Separadores do mesmo navegador sincronizam através do evento
`storage`. Se o armazenamento falhar, a escolha continua ativa na sessão e
a interface informa que não foi guardada.

## Calendário automático

Datas inclusivas, sempre em Europe/Lisbon, independentemente do fuso do dispositivo:

- Halloween: 25 de outubro a 2 de novembro.
- Natal: 1 de dezembro a 6 de janeiro.
- Páscoa: Domingo de Ramos a segunda-feira de Páscoa (data gregoriana móvel).
- Restantes datas: Original.

O calendário é verificado a cada minuto, ao regressar ao separador e ao focar
a janela. A seleção manual não é alterada pelo calendário.

## Isolamento

Apenas o layout autenticado recebe `data-seasonal-theme`. Login e links QR
permanecem inalterados. As cores semânticas globais, estados financeiros,
permissões, PDF/Excel e regras de negócio não são modificados. Os apontamentos
sazonais estão limitados ao cabeçalho, avatar, navegação ativa e seleção do tema;
sem animação nem decoração sobre as tabelas. As ilustrações são ocultadas na impressão.

O sprite PNG transparente `src/components/Appearance/seasonal-motifs.png` foi gerado
com o gerador de imagem integrado. Prompt: três células quadradas iguais, abóbora
Halloween, ramo de pinheiro com bagas e ovos de Páscoa com flores; gouache discreto,
objetos isolados sem texto e com fundo transparente. É servido localmente com hash
pelo Vite, sem pedidos a serviços externos.

## Verificação

`node --test src/utils/seasonalTheme.test.mjs`

`TEST_BASE_URL` e `PLAYWRIGHT_MODULE` podem configurar a execução de
`node tests/seasonal-theme.browser.mjs`, que usa apenas APIs simuladas.
