# Pesquisa de Colaboradores - implementacao e validacao

## Analise inicial

A pagina ja usava paginacao no servidor (normalmente 10 registos por pagina),
embora tambem suportasse respostas antigas em array. A pesquisa no backend
procurava uma expressao unica em nome, nome curto, email, telefone e NIF.
O fallback local procurava apenas no nome. Nenhuma destas variantes combinava
palavras entre campos e o contains SQLite nao garantia pesquisa sem acentos.

O modelo existente ja possui roles, notes, residenceArea, availability,
hasOwnCar, status, id e contactos. Nao foram criados campos ou categorias.
Notas e zona estao sujeitas a canViewSensitiveCollaboratorData; foi reutilizada
essa regra, sem criar permissoes ou alterar perfis de acesso.

Pesquisar apenas os dez colaboradores carregados esconderia correspondencias
noutras paginas. Por isso, a pesquisa continua no servidor e e aplicada antes
da paginacao, utilizando a mesma funcao do fallback local.

## Campos pesquisaveis

- Nome completo e nome curto, por palavras ou partes, sem diferenca de caixa
  ou acentos. Os termos nao precisam de estar consecutivos.
- Funcoes associadas, incluindo colaboradores com varias funcoes. Emp.Mesa
  reconhece empregado de mesa e Ajd.Cozinha reconhece ajudante de cozinha,
  mantendo os nomes reais dos registos.
- Notas: texto original, incluindo correspondencias no meio da nota, apenas
  para utilizadores que ja podem consultar este campo.
- Zona de residencia: residenceArea, com a mesma restricao de acesso.
- Disponibilidade: texto livre ja existente, sem inventar horarios estruturados.
- Viatura propria: o booleano existente suporta tambem termos como carro
  proprio e viatura propria. As notas nao sao reescritas nem convertidas nesse
  booleano; o filtro de viatura usa exclusivamente hasOwnCar.
- Estado: aliases portugueses dos estados active, inactive e paused.
- ID: correspondencia exata no campo identificador. Os restantes campos
  continuam a poder corresponder a um termo numerico.
- Email e telefone: preservados da pesquisa anterior. NIF continua disponivel
  apenas a quem ja pode consultar esse dado. Nao foram acrescentados IBAN,
  documentos, nascimento, seguros, alergias, vencimentos ou valores financeiros.

## Combinacao e ambiguidades

Cada criterio restringe o mesmo colaborador (AND), podendo corresponder a
campos diferentes. Rita Bar, Copa Sintra e experiencia casamentos funcionam
sem exigir uma frase consecutiva no mesmo campo.

Termos reconheciveis de funcao exigem a funcao efetivamente associada. Assim,
Bar num apelido como Barros ou numa nota nao faz uma Rita sem funcao de Bar
corresponder a Rita Bar. Uma funcao completa como Barman de Apoio nao e
substituida por Barman com uma referencia incidental a apoio nas notas.
Palavras genericas, como apoio, continuam a ser pesquisadas no texto.
Um nome completo/curto exato continua a ser encontrado se contiver uma palavra
coincidente com uma funcao, mantendo sempre os filtros explicitos selecionados.

Nao foi introduzida pesquisa aproximada por erros ortograficos, sinonimos
inventados, expressoes regulares ou um modelo de IA. As abreviaturas
reconhecidas correspondem as funcoes reais da aplicacao.

## Filtros e interface

- Funcao e estado existentes mantidos.
- Viatura separada da funcao: todas, com viatura e sem viatura. Agora pode
  combinar-se com uma funcao especifica.
- Zona como campo de texto, porque os registos existentes sao texto livre;
  visivel apenas a quem pode consultar zonas.
- A disponibilidade nao recebeu um menu de opcoes artificiais, por nao existir
  informacao estruturada fiavel para esse filtro.
- X limpa apenas a pesquisa, preservando os filtros selecionados.
- A acao Limpar filtros repoe todos os criterios.
- Contagem atualizada, estado A pesquisar e mensagem sem resultados.
- Pausa de 250 ms na pesquisa e zona para reduzir pedidos; seletores imediatos.
- Cartoes existentes preservados durante o carregamento, sem apagar e voltar
  a montar a lista a cada pedido. Pedidos antigos nao substituem os mais recentes
  gracas a protecao ja existente no useApi, que nao foi alterado nesta tarefa.
- Pesquisa/filtros novos regressam a primeira pagina; ordenacao de preferidos
  e paginacao existentes preservadas.
- Layout limitado ao card Colaboradores, com controlos responsivos e sem
  alteracao do design dos cartoes ou das outras paginas.

## Implementacao e desempenho

O banco filtra primeiro funcao, estado e viatura. Quando existe texto ou zona,
e feita uma leitura candidata apenas de campos relevantes, sem fotografias,
IBAN, dados medicos ou valores financeiros. Os campos sensiveis de pesquisa
so entram nessa leitura quando o utilizador tem a permissao existente.

A normalizacao JavaScript permite o mesmo tratamento de acentos em SQLite e
MariaDB sem alterar schemas ou depender de colacoes particulares. Os IDs
correspondentes sao paginados; so essa pagina e depois hidratada com a
projecao ja existente. Nao ha consulta por pessoa nem duplicados por funcao.
Sem texto/zona, permanece a consulta paginada normal e a contagem no banco.

Nao ha cache persistente de pesquisa: editar notas/zonas altera as
correspondencias do pedido seguinte. Foram mantidos os mecanismos existentes
de cache/revalidacao do frontend e a sua invalidacao apos escritas autorizadas.

Limitacao: a leitura candidata e linear no numero de colaboradores que passam
os filtros estruturados. E leve e nao carrega fotos/fichas completas, mas nao
substitui um indice de full-text para instalacoes com volumes muito elevados.
Essa evolucao exigiria avaliacao separada, respeitando a restricao de nao
alterar a base de dados nesta tarefa.

## Ficheiros desta alteracao

- src/utils/collaboratorFilters.js: normalizacao e correspondencia partilhada.
- src/utils/collaboratorFilters.test.mjs: testes unitarios e casos de ambiguidade.
- server/routes/collaborators.js: pesquisa autorizada antes da paginacao.
- server/routes/collaboratorsSearch.test.mjs: API real e base SQLite temporaria.
- src/pages/Collaborators.jsx: controlos, debounce, limpeza e estado da lista.
- src/index.css: estilos estritamente delimitados ao card Colaboradores.
- tests/collaborator-search.browser.mjs: regressao Chrome em quatro tamanhos.
- Este relatorio.

As alteracoes de seguranca anteriores que ja estavam no workspace foram
preservadas, nao revertidas nem consideradas parte desta mudanca de pesquisa.

## Testes

Suite especifica: 20 testes unitarios/HTTP passaram, incluindo nome completo,
parte do nome, acentos, funcoes reais/abreviaturas, notas, zona, termos em campos
diferentes, filtros simultaneos, limpeza textual, vazio, sem duplicados, paginas,
preferidos, permissoes, projecao minima e leitura apos editar uma nota.

A API foi testada com Prisma/SQLite e autenticao reais numa base temporaria.
Notas, zona e NIF ocultos nao influenciam resultados ou contagens; o filtro
de zona sem acesso retorna 403. Sem sessao retorna 401 e sem permissao de
colaboradores retorna 403. Os dados da fixture permanecem identicos depois
das pesquisas; nao foram alterados registos reais.

Chrome em 320, 390, 768 e 1440px: combinacoes, filtros, limpeza separada,
estado vazio, contagem, primeira pagina apos pesquisa, paginacao sem repeticoes,
debounce sem um pedido por tecla, manutencao dos cartoes e resposta antiga
atrasada sem substituir a pesquisa mais recente. Verificados textos sem corte
e ausencia de overflow horizontal. Perfil restrito nao ve o filtro de zona
nem o placeholder de notas. Zero pedidos de escrita e zero erros JavaScript.

Capturas de fixtures, nao de dados reais:
node_modules/.cache/collaborator-search/filters-{320,390,768,1440}.png.

Validacao geral: 1092 testes Node passaram, sem falhas; npm run lint,
npm run build e npm run verify:pwa passaram. Mantem-se o aviso anterior do
chunk XLSX superior a 500 kB. Log: node_modules/.cache/collaborator-search-final-tests.log.

## Limites e publicacao

Nao foi testada uma instancia MariaDB real nem o volume de producao. Nao houve
acesso de escrita a dados reais, migracoes, alteracoes ao schema, bibliotecas
novas, mudancas de autenticacao/permissoes ou de calculos financeiros.

Nao publicado online. Frontend e backend devem ser atualizados em conjunto.
As configuracoes de seguranca pendentes da tarefa anterior continuam a exigir
o procedimento separado em docs/security-fixes-deployment.md; esta melhoria
de pesquisa nao elimina nem substitui esses passos.
