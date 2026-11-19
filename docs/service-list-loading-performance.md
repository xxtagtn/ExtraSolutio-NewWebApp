# Carregamento de Eventos/Servicos - 19/11/2026

## Alteracoes

- A lista deixa de pedir sincronizacao de todos os eventos automaticos ao abrir.
  Apenas estados desatualizados originam POST. O calculo utilizado para esta
  decisao e partilhado com o servidor, incluindo os estados de validacao.
- As atualizacoes efetivas recarregam a lista em background, sem a esvaziar.
- O cabecalho usa o resumo de notificacoes existente em /services, como ja
  acontecia em Comunicacao. Deixa de repetir as leituras completas de eventos
  e colaboradores, e de carregar orcamentos e faturas para montar os avisos.
- Funcoes e modelos carregam apenas ao abrir criacao/edicao/duplicacao.
- Orcamentos sao consultados apenas ao guardar um pagamento que contenha
  uma referencia de orcamento, com dados atuais para confirmar a atualizacao.
- Mantem-se a leitura de clientes e colaboradores necessaria aos filtros e
  a inicializacao dos valores do editor. Nao foram alterados precos, regras
  financeiras, schemas, bases reais, permissoes ou a ordem dos eventos.

## Teste de volume

Chrome headless local, API simulada, larguras de 1440 e 390 px. Nao representa
medicao do servidor online nem o desempenho de um telemovel fisico.
Cada evento simulado contem o numero de alocacoes indicado.

| Ativos | Arquivados | Alocacoes/evento | Alocacoes totais | Resposta simulada | Lista pronta |
| --- | --- | --- | --- | --- | --- |
| 100 | 1000 | 32 | 35200 | 12.54 MiB | 1038-1143 ms |
| 300 | 3000 | 32 | 105600 | 37.64 MiB | 2489-2639 ms |
| 100 | 1000 | 78 | 85800 | 30.17 MiB | 1935-2151 ms |

Nos tres volumes, pesquisa, paginacao do arquivo, modelos ao abrir o editor,
notificacoes e lembretes passaram. Zero POST de sincronizacao para estados
ja atuais. No maior volume, abrir o arquivo demorou 149-150 ms e pesquisar
o ultimo evento demorou 19-20 ms. Sao medicoes pontuais, nao percentis nem
garantias de latencia em producao.

O cenario de 9 ativos/54 arquivados verifica tambem que uma transicao real
origina um POST e atualiza a lista, e que marcar um evento como pago continua
a atualizar o orcamento associado sem o carregar antecipadamente.

Reproduzir com tests/service-list-loading.browser.mjs. Aceita TEST_BASE_URL,
PLAYWRIGHT_MODULE (caminho do modulo, quando nao instalado localmente),
STRESS_ACTIVE, STRESS_ARCHIVE e STRESS_TEAM_SIZE. Valores de volume revistos:
100/1000/32, 300/3000/32 e 100/1000/78.

## Regressao

- Testes Node focados nos estados/workflow: 51 passaram.
- Suite Node geral: 1395 passaram, 1 falhou. A falha ja documentada em
  staffPaymentAdjustment.test.mjs:67 espera o ano do pagamento em vez do ano
  do servico; nao foi alterada nesta melhoria.
- Browser: pesquisa/filtros em 9 larguras; edicao/fardamento em 3 larguras;
  fluxo principal de duplicacao em 3 larguras passaram.
- O teste legado service-duplication-days.browser.mjs chegou a guardar/reabrir
  a duplicacao, mas terminou em timeout ao esperar um PUT /services/100 no
  detalhe. Esse teste de detalhe nao fica declarado como aprovado aqui.
- Build e PWA devem ser verificados antes da publicacao.

## Limite atual

O endpoint /services continua a devolver a colecao completa, para preservar
os filtros, conflitos de horario, duplicacao e calculos existentes. Nao foi
introduzida paginacao de servidor nem um payload de resumo neste trabalho.
Com milhares de eventos e ligacoes lentas, o tamanho dessa resposta e o custo
SQL ainda podem dominar o tempo total. Medir a API online e um passo separado.
