# Pagamento parcial e liquidacao do cliente

## Causa

O card Pagamento do cliente fica no detalhe do servico, acessivel pelo Financeiro.
A data `remainingPaymentDate` e uma previsao e nao confirma qualquer recebimento.
Ao selecionar Pago, o formulario antigo assumia o total recebido, substituia a
data efetiva pela data de hoje e enviava a data prevista como null. A interface
tambem deixava de mostrar o restante pagamento depois da liquidacao.

A edicao geral do evento enviava `signaledAt=null` e `remainingPaymentDate=null`
para pagamentos ja pagos, podendo apagar novamente o historico preservado.

## Estrutura reutilizada

Sem campos, tabelas ou migracoes novas:

- `signaledAmount`: sinalizacao inicial.
- `signaledAt`: data da sinalizacao.
- `paidAmount`: total cumulativo recebido, nao apenas a ultima parcela.
- `remainingPaymentDate`: data prevista do restante pagamento.
- `billingPaymentDate`: data efetiva do recebimento final.
- Restante recebido: `paidAmount - signaledAmount`, apresentado sem duplicar
  valores ou criar um segundo movimento financeiro.

O botao Registar pagamento restante prepara a liquidacao. O utilizador confirma
o montante e a data efetiva e guarda. Tambem pode selecionar Pago diretamente.
O formulario/API valida que a sinalizacao mais o restante recebido correspondem
exatamente ao total, com precisao de centimos. Uma data prevista nao substitui a
data efetiva, nem liquida automaticamente quando chega ou passa.

A gravacao guarda valores absolutos: repetir Guardar nao soma novamente a parcela.
A validacao da API e realizada sobre o evento atual na transacao de gravacao;
valores/data invalidos sao recusados sem alterar o evento. O seletor Pago existente
do Financeiro continua a confirmar liquidacao total, registando agora tambem o
total cumulativo e preservando a sinalizacao e a data prevista.

O historico continua visivel depois de Pago, incluindo valor inicial, data inicial,
valor restante recebido, data efetiva, previsao original, total recebido e saldo.
A edicao geral do evento pago preserva os campos de sinalizacao e previsao; nao
substitui a data efetiva guardada.

## Compatibilidade e limites

Pagamentos antigos marcados Pago podem ter `paidAmount=0` ou apenas a sinalizacao
nesse campo, porque os seletores anteriores alteravam somente o estado. A consulta
mantem a semantica antiga de liquidacao nesses casos, sem reescrever o registo.
O restante e inferido pelo estado historico; datas nao registadas permanecem vazias.
Nao se inventam datas nem se recupera informacao que tenha sido apagada anteriormente.

Um valor cumulativo explicitamente registado entre a sinalizacao e o total nao e
ocultado: o saldo em falta permanece visivel e uma nova liquidacao incoerente e
recusada. As regras de faturacao e a autoridade das faturas emitidas permanecem
inalteradas. Este formulario nao cria um historico ilimitado de parcelas; reutiliza
o modelo existente de sinalizacao inicial e recebimento final.

Os recebimentos nao recalculam valores de servicos, custos, margens ou IVA. Os
fluxos normais de edicao continuam a utilizar o motor financeiro existente. A
finalizacao/arquivo de externos continua dependente da liquidacao E fim do periodo.
Nenhuma alteracao foi aplicada em lote a pagamentos existentes ou a bases reais.

## Testes

- Suite Node completa: 927 testes passados, zero falhas e zero ignorados.
- Oito testes unitarios: previsao vencida, 252/157,50/94,50, liquidacao, repeticao,
  datas diferentes, edicao coerente, centimos, sem sinalizacao, legados e fatura
  paga contabilizada uma unica vez.
- Cinco testes HTTP numa base SQLite temporaria: gravar parcial/liquidar/reabrir,
  rejeitar montantes/data incoerentes sem escrita, legados sem alteracao na consulta,
  seletor Pago existente e arquivo externo sem alterar valores do servico.
- Navegador com API simulada: 320, 390, 768 e 1440 px; previsao pendente, confirmacao
  de recebimento, data obrigatoria, montante incorreto, reabertura, guardar repetido,
  historico visivel, legados e ausencia de overflow.
- Edicao geral de um evento pago: sinalizacao, data inicial e prevista preservadas;
  data efetiva anterior mantida.
- Regressao dos arquivos: ambos sincronizados e externo futuro pago mantido ativo,
  em 320, 390 e 1440 px.
- ESLint, build, PWA e `git diff --check` aprovados. Aviso de bundle XLSX acima de
  500 kB permanece, sem erro de compilacao.

Nao foi feita publicacao online. Atualizar frontend e API em conjunto, sem migracao.
