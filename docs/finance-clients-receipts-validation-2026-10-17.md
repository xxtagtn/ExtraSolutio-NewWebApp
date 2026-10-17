# Financeiro > Clientes: recebimentos, estados e arquivo

## Analise e causa

O layout anterior apresentava diretamente `billingStatus`. Esse valor pode manter
`paid` depois de a validacao de horas aumentar o total, embora `paidAmount` e o
historico continuem a representar apenas o dinheiro efetivamente recebido.
O resumo por cliente contava recebimentos de faturas pagas, mas omitia pagamentos
diretos de eventos. O arquivo existente e calculado por periodo/grupo comercial;
nao e uma eliminacao nem uma copia do evento para outra tabela.

## Interface implementada

- Tabela com total, recebido, por receber, estado financeiro, vencimento,
  estado operacional e Gerir recebimentos. Os ajustes editaveis foram mantidos.
- Sem barra global "Pagamento em falta". O alerta aparece individualmente no
  evento enquanto existir saldo, incluindo a base/IVA quando conhecidos.
- Gerir recebimentos abre um modal no Financeiro, sem navegar para Eventos.
  Consulta valores, configuracao comercial, movimentos, ajuste e auditoria;
  permite registar, editar e reverter pelos mecanismos existentes.
- Reutiliza `ClientReceiptEditor`, discriminacao dos componentes pagos,
  projecao do diario, calculos fiscais e servico transacional de recebimentos.
- Guardar atualiza os dados em segundo plano, mantendo o modal e os filtros.
- O Arquivo disponibiliza a mesma gestao por evento, incluindo reversao segura.
  O antigo seletor do arquivo foi substituido pela indicacao Totalmente Pago:
  mudar uma etiqueta nao pode substituir uma correcao dos recebimentos reais.

## Estados e prioridades

1. Sinalizado: existe apenas sinalizacao efetivamente recebida e ainda ha saldo.
2. Parcialmente Pago: ha recebimentos posteriores/outras parcelas, mas falta saldo.
3. Faturado: prioridade comercial manual ou faturacao real, mesmo com saldo.
4. Totalmente Pago: total efetivamente coberto, nunca por selecao manual desta
   etiqueta. Tem prioridade sobre a escolha Faturado enquanto o saldo e zero.

A escolha manual Faturado e guardada como `commercialStatus` no JSON de
recebimentos existente, com autor, data e alteracoes comerciais. Nao altera o
estado operacional, nao emite uma fatura e nao bloqueia indevidamente a futura
validacao de horas. Uma fatura realmente emitida continua a ter as protecoes e
o fluxo de gestao existentes. O modal usa as permissoes existentes de pagamentos
e de emissao/alteracao de faturas; os endpoints verificam-nas no servidor.

O calculo do saldo reutiliza o total atual e o ajuste de faturacao pre-fatura ja
apresentado no resumo financeiro. Foi corrigida a divergencia em que esse ajuste
aparecia na tabela mas nao no saldo dos recebimentos. O ajuste nao e duplicado,
nao altera os precos guardados e nao cria uma nova formula de IVA. Faturas ja
associadas preservam a regra existente de nao reaplicar o ajuste.

Recebimentos de eventos passam a constar do resumo do cliente, sem somar o mesmo
dinheiro outra vez quando uma fatura e liquidada. O total do periodo continua a
ser o total de servicos/faturas, nao total mais recebimentos. Tambem e coberto o
caso de varias faturas pagas sobre o mesmo evento.

## Arquivo e regras comerciais

O mecanismo `splitClientBillingRows` existente continua a definir o arquivo.
Exige liquidacao real, prontidao operacional e as condicoes comerciais atuais.
Mantem os agrupamentos por evento, quinzena, mes, pre-pagamento e personalizacao,
os periodos selecionados e as datas de vencimento calculadas a partir da emissao.
Clientes sem associacao/faturacao conservam a protecao anterior. Servicos externos
futuros mantem a verificacao do fim previsto, incluindo varios dias/noite.

Uma fatura paga nao dispensa a prontidao operacional de Staff. O arquivo passa
a incluir eventos faturados quando elegiveis, sem copiar nem apagar o original.
Se uma reversao ou aumento do total deixar saldo, a mesma classificacao calculada
retira o evento do arquivo e volta a disponibiliza-lo na area ativa. Uma escolha
manual Faturado e preservada nesse processo.

Nao foram inventadas excecoes por nome de cliente. Regras personalizadas em texto
livre nao sao reinterpretadas como novas regras executaveis.

## Ficheiros desta alteracao

- `src/pages/Accounting.jsx`, `src/pages/ServiceDetail.jsx`, `src/index.css`.
- `src/components/Finance/ClientReceiptManager.jsx` (novo) e
  `src/components/Finance/ClientReceiptEditor.jsx` (formulario reutilizado).
- `src/utils/clientFinancialState.js` (novo), `src/utils/clientPaymentTotal.js`
  (novo), `src/utils/clientBilling.js`, `src/utils/clientFinancialSummary.js`,
  `src/utils/clientPayment.js`, `src/utils/clientPaymentRecord.js`,
  `src/utils/clientPaymentAdjustment.js`.
- `server/routes/index.js`, `server/services/clientPayment.js`,
  `server/services/clientPaymentRecord.js`, `server/services/clientReceiptMovements.js`.
- `src/utils/clientFinancialState.test.mjs` (novo),
  `server/services/clientPayment.test.mjs`,
  `server/services/externalServiceWorkflow.test.mjs`,
  `tests/finance-receipt-manager.browser.mjs` (novo),
  `tests/external-finance-archive.browser.mjs`,
  `tests/client-signal-reversal.browser.mjs`.

Alteracoes anteriores nao relacionadas que ja estavam no diretorio foram
preservadas; nao houve limpeza nem reversao desse trabalho.

## Verificacao executada

- Suite Node completa: **1.143 testes aprovados, zero falhas ou testes ignorados**.
- Novo teste de navegador com API real local e SQLite descartavel, nos tamanhos
  320, 390, 768 e 1440 px: saldo real, Faturado manual, pagamento parcial,
  liquidacao, duplo clique, arquivo, reversao, retorno a Clientes, persistencia,
  ausencia da barra global e comandos contidos na linha.
- Exemplo validado: total 1.763,82; recebido 1.745,37; saldo 18,45;
  decomposicao do ajuste 15,00 + 3,45 de IVA. Registar 10 deixa 8,45;
  registar 8,45 liquida; reverter essa parcela volta a deixar 8,45.
- Testes HTTP: sinalizacao, recebimentos parciais/finais, estado manual sem
  dinheiro ficticio, data efetiva, formato monetario portugues, permissoes,
  faturas emitidas, dados desatualizados e submissao duplicada.
- Regressao de navegador: `receipt-movements`, `advance-payment`,
  `client-payment`, `client-adjustment`, `payment-scroll`, `event-cost-summary`,
  `external-cost-editing`, `staff-vat-delete`, `dynamic-event-finance`,
  `external-finance-archive`, `client-signal-reversal`,
  `client-payment-reference` (todos `.browser.mjs`).
- Capturas desktop/mobile revistas; sem erros JavaScript nas suites.
- Lint, build de producao, verificacao PWA e verificacao de espacos executados.

## Limites e integridade

Sem alteracao ao esquema da base de dados, migracoes ou manipulacao de dados
reais. Sem publicacao online, API de producao ou agendadores de notificacoes.
Os testes usam bases descartaveis ou pedidos intercetados, nunca pagamentos reais.
MariaDB em producao nao foi validada. O aviso anterior de bundle XLSX grande
mantem-se fora do ambito. Dados fiscais antigos sem discriminacao fiavel nao
recebem uma taxa inventada: mantem o mecanismo de discriminacao explicita.

Precos, margem, IVA, custos externos, horarios, pagamentos de Staff e configuracao
dos clientes nao sao reescritos por uma alteracao de estado comercial. Auditoria
e recebimentos originais sao preservados; novos recebimentos so surgem por acao
explicita confirmada. Pre-visualizacao local: http://127.0.0.1:5187.
