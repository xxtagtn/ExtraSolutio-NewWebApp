# IVA no resumo de faturacao por cliente

O resumo Financeiro > Clientes consulta `client.billingMethod`, incluindo a ficha
atual recebida em `clients`. Nao existem regras especiais pelo nome BLANK.

Para valores por faturar de clientes `monthly` e `biweekly`, as bases conhecidas
sao agrupadas por cliente, periodo do calendario comercial e taxa de IVA. O IVA
arredonda uma unica vez sobre cada base agrupada. O ano nao constitui um unico
periodo fiscal: meses e quinzenas continuam separados.

Regressao: tres servicos com bases ilustrativas 976,50 + 126,00 + 157,50 somam
1260,00. A soma dos totais individuais e 1549,81; uma fatura mensal agrupada a 23%
apura 289,80 de IVA e 1549,80 de total. O resumo usa este segundo valor, sem um
aviso adicional no detalhe do cliente. Nao grava um ajuste financeiro.

As taxas provem da discriminacao fiscal existente. Staff, deslocacoes, isencoes,
ajustes e as duas bases do catering conservam o respetivo tratamento. Quando um
periodo nao tem discriminacao suficiente, nao se adivinha uma taxa nem se faz
uma reparticao proporcional. A pendencia Por repartir continua preservada.

Os servicos por evento/custom/prepaid nao mudam. Servicos com fatura associada,
mesmo em rascunho, ou ja marcados como faturados nao sao reagrupados por esta
correcao: os respetivos valores registados continuam preservados.

Esta e uma conciliacao de IVA do apuramento por faturar. Nao altera o total
individual dos eventos, saldos individuais, arquivo, recebimentos, faturas emitidas,
IVA historico ou base de dados. O detalhe conserva os totais individuais; o
apuramento por periodo continua incluido nos totais do resumo.
