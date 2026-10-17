# Alerta de pagamento segundo as condicoes comerciais

## Analise e causa

O alerta individual de Financeiro > Clientes e o aviso do gestor de recebimentos
usavam diretamente `clientFinancialState(...).missingPayment`, equivalente a
saldo por receber > 0. Esse indicador financeiro continua correto, mas nao
demonstrava atraso nem consultava o prazo comercial.

Foi revista a implementacao de `Accounting.jsx`, `Clients.jsx`, `clientBilling`,
`clientRules`, `prepaymentPolicy`, `pendingActions`, `balanceMetrics`,
`balanceOverviewPresentation`, `layoutNotifications`, `shared/invoiceLifecycle`
e a normalizacao de faturas em `server/routes/index.js`, incluindo testes e
historico dos ficheiros relacionados.

## Regras existentes identificadas

- Faturacao por evento, mensal, quinzenal, pre-pagamento e personalizada.
- Mensal: agrupamento e preparacao para faturar no fim do mes do servico.
- Quinzenal: dia 15 ou ultimo dia do mes, segundo a quinzena do servico.
- Personalizada: agrupamento mensal existente e descricao textual do cliente;
  o texto livre nao constitui uma formula executavel de vencimento.
- Por evento: preparacao para emitir no dia seguinte ao servico.
- Prazos de pagamento: imediato, 15, 30, 45 dias ou numero personalizado.
- Uma fatura so e emitida para este efeito se nao for rascunho, anulada ou void
  e possuir uma data de emissao valida.
- O vencimento efetivo e a data REAL de emissao + prazo do cliente. Nao e
  calculado da data do evento, do fim do periodo ou de um dueDate antigo gravado.
- No proprio dia do vencimento ainda nao existe atraso; passa a vencida no
  dia seguinte, como nas restantes areas de notificacoes e balancete.
- Pre-pagamento: a data manual do restante prevalece; na sua ausencia reutiliza
  a data do evento menos os dias configurados no cliente (padrao existente: 7).

Os testes existentes de `pendingActions` identificam explicitamente
SSH - Supreme Sport Hospitality com faturacao mensal e pagamento a 30 dias.
Nao ha uma excecao executavel pelo nome SSH: aplicam-se os campos do cliente.
Os testes tambem incluem clientes como FIC/BLACK, mas nao permitem inferir uma
configuracao comercial atual desses clientes em producao. Nao foram consultados
dados reais, nem atribuidas regras por nome.

## Correcao

Adicionado um predicado de apresentacao, `shouldShowClientPaymentAlert`, usado
na linha do evento e no gestor de recebimentos da mesma pagina:

1. Sem saldo, nao apresenta alerta.
2. Com fatura(s) emitida(s), reutiliza `invoiceLifecycleState`; so alerta se
   houver fatura efetivamente vencida e ainda aberta, alem do saldo do evento.
3. Sem emissao efetiva, faturacao mensal/quinzenal/personalizada e prazos
   comerciais diferidos nao recebem um vencimento inventado.
4. Nos restantes casos, respeita a data de pagamento restante ja existente e
   a politica existente de pre-pagamento/sinalizacao, quando aplicavel.
5. Sem regra diferida ou data aplicavel, conserva o alerta anterior dos clientes
   comuns/pronto pagamento/sem condicoes especificas. Prazo explicitamente
   configurado mas nao reconhecido nao e convertido num prazo implicito.

O saldo, a sua discriminacao fiscal disponivel e o estado financeiro continuam
a aparecer mesmo sem alerta. Apenas o aviso e a cor de alerta do saldo deixam
de assinalar indevidamente esses valores como vencidos.

## Ficheiros alterados nesta correcao

- `src/utils/clientPaymentAlert.js`: predicado novo, apenas de leitura.
- `src/utils/clientPaymentAlert.test.mjs`: 14 testes novos.
- `src/pages/Accounting.jsx`: condicao visual do aviso e destaque do saldo.
- `src/components/Finance/ClientReceiptManager.jsx`: mesma condicao no gestor.
- `tests/client-payment-alert.browser.mjs`: verificacao nova de 10 cenarios.
- `tests/finance-receipt-manager.browser.mjs`: cliente ficticio da regressao
  com pronto pagamento, explicitando o caso em que o alerta e esperado.
- Este relatorio.

As alteracoes anteriores que ja estavam no diretorio foram preservadas.

## Testes executados

- `node --test`: 1.157 aprovados, zero falhas e zero ignorados.
- Conjunto dirigido: 60 aprovados, cobrindo alerta, ciclo de faturas,
  periodos, acoes pendentes, estados financeiros e arquivo.
- Navegador, apenas respostas ficticias de leitura, a 320/390/768/1440 px:
  10 cenarios por tamanho, incluindo pronto pagamento, data acordada futura,
  SSH por faturar, SSH dentro do prazo, SSH vencida, vencimento hoje,
  faturacao quinzenal, prazo personalizado vencido, pre-pagamento em prazo
  e ajuste de horas de 18,45. Tabela e gestor usam a mesma decisao.
- Recarregar a pagina manteve a distincao SSH em prazo/vencida. Os dados das
  fixtures ficaram identicos e nao houve pedidos de escrita ou erros JavaScript.
- Regressao do gestor com API local real e SQLite descartavel nos mesmos
  quatro tamanhos: recebimentos, Faturado manual, saldo, liquidacao, arquivo,
  reversao e persistencia aprovados.
- Ajuste preservado: total 1.763,82, recebido 1.745,37, saldo 18,45.
- Lint dos ficheiros envolvidos, build, verificacao PWA e `git diff --check`
  aprovados. O aviso anterior de bundle XLSX grande permanece fora do ambito.
- Capturas de tabela desktop e gestor mobile revistas.

## Limites e integridade

Nao foram alterados esquema/migracoes, dados de clientes, regras de faturacao,
prazos, formulas de IVA, recebimentos, saldos, estados ou logica de arquivo.
Nenhuma alteracao backend foi necessaria para esta correcao.

A configuracao atual da SSH e dos restantes clientes na base de producao nao
foi validada: os testes usam as configuracoes explicitamente presentes no
codigo e fixtures. Tambem nao foi testada a instancia MariaDB online.

Sem emissao real ou prazo conhecido, a aplicacao nao tem dados para concluir
que uma fatura de um cliente com faturacao diferida venceu. Continuam a
existir os mecanismos de periodo pronto para faturar; nao foram substituidos
por alertas de pagamento nem foi iniciada uma contagem a partir do evento.

Sem publicacao online, acesso a pagamentos reais ou execucao de agendadores.
