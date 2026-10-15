# Valores de referencia 70% / 30%

Este relatorio descreve a apresentacao inicial. A alteracao posterior manteve as
referencias apenas em Eventos > Custos e removeu-as do Financeiro. Ver
`client-signal-reversal-validation-2026-10-14.md` para a regra atual e novos testes.

## Analise e causa

O historico consultado identifica `prepaymentDepositAmount` nos commits 5de1725
e ecb2279. O calculo continua em `src/utils/prepaymentPolicy.js`, usado pelo painel
Pre-pagamento de Eventos/Servicos, condicionado ao cliente com `billingMethod=prepaid`.
Pode respeitar percentagens comerciais diferentes, que permanecem inalteradas.

No codigo atual de Financeiro > Clientes e Pagamento do cliente nao existia uma
apresentacao explicita dos dois montantes de referencia. O formulario de pagamentos
mostra a sinalizacao e os recebimentos reais, que nao sao necessariamente 70%/30%.
No historico pesquisado desses locais nao foi identificado um bloco literal 70%/30%
removido. A correcao liga o calculo existente a uma vista de consulta reutilizavel,
em vez de duplicar uma politica financeira ou mudar o valor sinalizado.

## Implementacao

- `prepaymentReferenceAmounts` reutiliza `prepaymentDepositAmount` com 70% fixos,
  trabalhando em centimos. A parcela de 30% e o complemento do total arredondado.
  Assim, 70% + 30% fecha exatamente o total, incluindo casos de meio centimo.
- A funcao original e as regras configuradas dos clientes nao foram alteradas.
- `ClientPaymentReference` e um bloco apenas de leitura, com Total, 70% e 30%.
- Aparece nas linhas de servico de Financeiro > Clientes, no resumo do evento e
  no card Pagamento do cliente acessivel pelo detalhe do servico.
- Usa o total atualmente apresentado em cada superficie: `displayValue` na
  consulta financeira, incluindo os ajustes existentes, e `totalRevenue` no card
  de pagamento. Nao altera qualquer calculo de faturacao ou IVA.
- Os valores sao calculados a cada renderizacao, sem snapshots persistidos.
  O resumo do evento usa o registo atual da lista quando os dados sao atualizados.
- Os valores de referencia nao preenchem inputs, nao geram pedidos API e nao
  alteram estados, datas, sinalizacao, total recebido ou saldo em falta.
- Nao existem migracoes, campos novos ou alteracoes de pagamentos na base.

## Resultados

| Total | 70% | 30% |
| --- | --- | --- |
| 100,00 EUR | 70,00 EUR | 30,00 EUR |
| 252,00 EUR | 176,40 EUR | 75,60 EUR |
| 790,00 EUR | 553,00 EUR | 237,00 EUR |
| 1.000,00 EUR | 700,00 EUR | 300,00 EUR |

- 930 testes Node passaram, sem falhas ou testes ignorados.
- Testado cada valor entre 0 e 100.000 centimos, inclusive: arredondamento correto
  da parcela de 70% e soma das parcelas igual ao total em centimos.
- Casos adicionais: 0,01, 0,05, 2,15 e 6,55 EUR; formatos monetarios portugueses;
  alteracao do total e politica comercial de 50% mantida independente.
- Navegador: 320, 390, 768 e 1440 px; Financeiro, resumo, detalhe do pagamento,
  novo total consultado, quatro estados financeiros, sem escrita ou overflow do bloco.
- Regressao do formulario de pagamentos nas mesmas quatro larguras: sinalizacao,
  liquidacao, validacao, guardar repetidamente, historico, legados e edicao geral.
- ESLint, build de producao, PWA e `git diff --check` aprovados. O aviso de bundle
  XLSX acima de 500 kB permanece e nao impede a compilacao.

Nao houve publicacao online nem alteracoes de dados reais.
