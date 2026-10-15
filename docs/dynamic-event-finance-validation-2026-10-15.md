# Atualizacao dinamica de horas e totais financeiros

## Diagnostico do caso FIC Restaurante - FIXOS, 16/10/2026

Foi consultado o registo correspondente na base SQLite local, em modo apenas de leitura (evento 79). Nao foi consultada nem alterada a base online.

- As 37 horas vinham de `clientRealHours` antigos nas tres linhas: 14 + 9 + 14.
- Os horarios Staff atuais eram 18:00-00:00, 17:30-02:20 e 17:30-02:20. As regras atuais de arredondamento produzem 6 + 9 + 9 = 24 horas.
- Nao existiam horarios Cliente nem horarios finais validados nestas linhas. O estado era `staff_accepted`.
- As 24 horas estavam persistidas no agregado do evento, mas tambem resultavam corretamente dos horarios atuais. Nao eram um snapshot incorreto a substituir por 37.
- `clientRealHours()` dava prioridade ao numero antigo; `clientChargeHours()` ja dava prioridade aos horarios Staff completos. Esta diferenca explicava 37 reais versus 24 faturaveis.
- A fonte da faturacao continua a ser: par final validado, par Cliente, par Staff, duracao explicita compativel e horario previsto/fallback. O minimo de faturacao continua separado das horas reais e pagaveis.
- CRUD de atribuicoes, atualizacao em massa, importacao e finalizacao ja recalculavam totais. Faltava ligar as picagens publicas ao mesmo recalculo. Havia tambem caches numericas e calculos feitos antes de limpar uma validacao antiga.
- `reload()` nao devolvia a promessa do pedido; `await reload()` nao esperava pelos novos dados. Uma resposta anterior podia ainda sobrepor a mais recente.

## Correcao

1. `src/utils/assignmentDerivedHours.js`: recalcula apenas derivados das fontes atuais, sem alimentar os calculos com a sua propria cache. Um horario incompleto nao e persistido como horas executadas. Deteta alteracoes efetivas nos campos de horario.
2. `src/utils/serviceFinance.js`: quando existe Staff aceite com horario completo e sem horario Cliente/final, ignora a antiga cache numerica Cliente. Mantem os fallbacks numericos legados nos restantes casos.
3. `server/routes/index.js`: cria/atualiza os derivados ao guardar alteracoes de horarios. Reutiliza os hooks existentes de recalculo, incluindo alteracoes em massa.
4. `server/services/eventWorkflow.js`: reconcilia caches obsoletas de Staff aceite antes do calculo existente, dentro da mesma transacao. Nao modifica validacoes nem os seus estados.
5. `server/services/eventFinancialReconciliation.js`: repara e persiste agregados inconsistentes ao consultar eventos com horas registadas, relendo as fontes dentro de transacao serializavel. Nao reescreve eventos sem alteracoes; repete uma vez em caso de conflito transacional. Respeita snapshots pagos/faturados e faturas emitidas, inclusive faturas agrupadas.
6. `server/services/qrAttendance.js`, `qrDailyAttendance.js`, `qrMonthlyPunching.js` e `server/routes/qrCheckins.js`: atualizam derivados na saida e ligam as picagens publicas ao recalculo existente na mesma transacao. Janela, cooldown, selecao de servico e protecao de duplo clique mantidos.
7. `server/utils/timeValidationExcelImport.js` e `src/pages/TimeValidation.jsx`: calculam as horas novas depois de excluir a validacao antiga que sera invalidada pela alteracao.
8. `server/utils/eventTotals.js`: o custo Staff usa `staffPaymentHours()`, ja utilizado no Financeiro Staff. Nao usa o minimo faturavel nem introduz uma segunda formula de pagamento. Tres expectativas antigas de testes foram atualizadas para confirmar a igualdade com os pagamentos Staff existentes.
9. `src/hooks/useApi.js`, `src/pages/ServiceDetail.jsx`, `src/pages/Accounting.jsx`: `reload()` passa a ser aguardavel; respostas ultrapassadas nao substituem dados/cache mais recentes. Custos e Financeiro reconsultam ao regressar ao separador/janela, sem recarregamento manual.

Nao houve migracao, novo campo, alteracao de precos, IVA, markup de parceiros, tolerancias ou arredondamentos. Custo interno e venda ao Cliente continuam separados. Faturas emitidas e pagamentos nao sao reabertos nem alterados pela reconciliacao.

## Resultados do caso de regressao

Reproduzido numa base descartavel com as tres linhas e caches antigas:

| Medida | Resultado |
| --- | --- |
| Horas reais / faturaveis, sem horario Cliente diferente | 24 / 24 |
| Custo Staff a 8 EUR/h | 192,00 EUR |
| Staff cobrado ao Cliente a 10 EUR/h | 240,00 EUR |
| Custo parceiro | 450,00 EUR |
| Parceiro cobrado ao Cliente, acrescimo atual de 10% | 495,00 EUR |
| IVA do parceiro a 23%; Staff isento neste exemplo | 113,85 EUR |
| Receita com IVA | 848,85 EUR |
| Despesas, sem IVA de venda | 642,00 EUR |
| Margem, apos excluir IVA de venda | 93,00 EUR |

GET de detalhe e listagem devolvem os mesmos totais persistidos. Uma segunda consulta nao volta a escrever o evento. A base local original permaneceu sem alteracoes manuais; a reconciliacao fica ativa com o novo backend.

## Cobertura dos 20 cenarios pedidos

`server/services/eventCostRegression.test.mjs` usa Express, rotas reais e Prisma/SQLite descartavel. Verifica a base ANTES de GET para nao mascarar um hook de escrita em falta.

1. Adicionar colaborador: 6 -> 12 horas e custos/venda atualizados.
2. Remover colaborador: 12 -> 6 horas na fase de validacao; nao deixa horas residuais.
3. Substituir colaborador: uma atribuicao, sem duplicacao de horas/preco Cliente.
4. Alterar entrada prevista: 6 -> 7 horas, sem horas executadas.
5. Alterar saida prevista: 6 -> 8 horas, sem horas executadas.
6. Alterar entrada realizada: atualiza derivados e agregados.
7. Terminar mais tarde: 6 -> 8 horas.
8. Terminar mais cedo: 6 -> 5 horas.
9. Alterar antes de validar com numeros antigos no pedido: usa as fontes atuais.
10. Alterar depois de validar, pelo fluxo existente de reabertura: 7,5 -> 8 horas.
11. Copiar Staff para Cliente pela rota bulk: mesmos totais persistidos.
12. Importar Cliente: preview ignora horario final antigo; commit persiste 7,5 horas e limpa validacao antiga.
13. Corrigir Cliente manualmente: Staff 8 horas e Cliente 7,5 horas continuam distintos.
14. Validar/finalizar: preserva os totais atuais.
15. Reabrir, alterar e voltar a validar: recalcula novamente.
16. Adicionar Staff depois da criacao: reflete a nova linha sem recriar o evento.
17. Staff e parceiro: custo 450, venda 495 e IVA do parceiro mantidos.
18. Funcoes/precos diferentes: aplica tarifas Cliente 10/14 e Staff 8/9 separadamente.
19. Ajuste Staff antes de IVA Staff: resultado igual a Financeiro Staff, sem alterar venda Cliente.
20. IVA: atualiza IVA Staff vendido e preserva a taxa independente do parceiro.

Cobertura adicional: minimo de faturacao 4,5 horas versus 2 horas reais/pagaveis; reparacao persistida de historicos inconsistentes; protecao de faturas emitidas/pagamentos; picagem e recalculo atomicos; rollback da picagem e log quando o recalculo falha; fallbacks numericos legados; horas zero; resposta GET antiga versus nova.

## Verificacoes executadas

- `node --test --test-reporter=spec`: **1011 testes passaram, 0 falhas**.
- `npm run lint`: passou, sem avisos.
- `npm run build`: passou. Mantem o aviso de tamanho do chunk Excel/XLSX; nao e erro de compilacao.
- `npm run verify:pwa`: passou.
- `git diff --check`: passou; apenas avisos locais Git de conversao LF/CRLF.
- Chrome, `tests/dynamic-event-finance.browser.mjs`: mobile 390 e desktop 1440; guardar horarios -> Custos -> Financeiro, reconsulta ao focar, cache/resposta antiga e correcao Cliente previamente validada.
- Chrome, `tests/event-cost-summary.browser.mjs`: 320, 390, 768 e 1440; custos/venda, IVA, Financeiro Cliente e pagamentos Staff.
- Chrome, `tests/time-validation-mobile.browser.mjs`: 320, 360, 390, 430, 760, 1024 e 1440; guardar, aceitar, copiar e validar.
- Chrome, `tests/client-payment.browser.mjs`, `client-payment-reference.browser.mjs`, `client-signal-reversal.browser.mjs`, `external-cost-editing.browser.mjs`: passaram em 320, 390, 768 e 1440.
- Chrome com SQLite descartavel, `tests/qr-daily.e2e.mjs`: passou; diarios e mensais, viragem da meia-noite/mes, saida tardia, cooldown, duplo clique, servicos sobrepostos e reabertura administrativa.

## Limites

Nao foi feita publicacao online nem alterada a base real nos testes. O ambiente MySQL e os dados de producao nao foram executados nesta verificacao; a persistencia foi validada em SQLite isolado. Testes de navegador financeiros intercetam os pedidos API; a persistencia correspondente e testada separadamente com rotas reais. A atualizacao entre janelas ocorre ao recuperar o foco, nao atraves de WebSocket.
