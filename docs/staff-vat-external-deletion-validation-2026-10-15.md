# IVA do Staff e eliminacao de parceiros

## Analise inicial

O motor existente ja aplicava `vatRateSnapshot` a venda de servicos proprios (Staff e deslocacoes), somando depois o IVA calculado por cada parceiro. A taxa normalmente era zero nos eventos criados diretamente e nao existia um controlo visivel no formulario. Assim, aparecia apenas o IVA dos parceiros.

A venda do Staff ja era calculada pelas horas faturaveis e tarifas Cliente. O custo interno e os pagamentos Staff sao componentes diferentes e nao foram usados como base de IVA de venda.

Reutilizar a taxa global no novo checkbox tambem alteraria o IVA das deslocacoes. Para cumprir a separacao pedida, foi necessario um unico campo opcional, `Event.staffVatRateSnapshot`, com migracoes aditivas SQLite/MySQL. `NULL` herda a regra antiga; um valor explicito 0/23 controla apenas o Staff. Nao foram recalculados historicos durante a migracao.

Os orcamentos ja possuem a taxa dos servicos proprios. A conversao passa a transportar essa configuracao para o novo campo, preservando a taxa existente para deslocacoes. Os parceiros mantem os seus modos de IVA e margens atuais.

## Implementacao

- `src/utils/eventSalesTax.js`: fonte partilhada para taxa efetiva e IVA separado de Staff, deslocacoes e parceiros. Preserva a expressao anterior nos casos herdados, incluindo o arredondamento final do motor existente.
- `server/utils/eventTotals.js`: reutiliza essa funcao com a VENDA do Staff, nunca com o custo/hora interno. Mantem horas, tarifas, minimos, custos, ajustes e pagamentos.
- `src/components/Finance/StaffVatControl.jsx` e `src/pages/Services.jsx`: controlo na criacao (Evento/Servico) e edicao (Financeiro), com preview imediato e persistencia ao guardar. Desativar IVA nao recupera a antiga cache de imposto. A alteracao financeira nao transforma a sinalizacao num novo pagamento percentual.
- `src/utils/eventCostSummary.js` e `src/pages/ServiceDetail.jsx`: detalhe discreto do IVA de Staff e parceiros, e deslocacoes quando aplicavel. O detalhe so aparece quando reconcilia com o imposto guardado.
- `server/routes/crud.js`, `server/routes/index.js` e `server/utils/eventInvoiceProtection.js`: validacao da configuracao, mascaramento dos campos financeiros e manutencao das protecoes existentes. Configuracoes financeiras sao recalculadas em transacao serializavel, com verificacao de versao.
- `src/utils/budgetConversion.js` e `src/utils/serviceDuplication.js`: transporte da configuracao na conversao/duplicacao, sem copiar recebimentos ou alterar o calculo do orcamento.
- `src/utils/externalCostEditing.js` e `server/services/externalCostEditing.js`: remocao pelo identificador do custo no evento correto, com recalculo e remocao atomicos. A rota e `DELETE /services/:id/external-costs/:costId` e exige permissao de edicao e `updatedAt`.
- `server/services/eventFinancialChange.js`: verifica totais monetarios suportados, precos suficientes e recebimentos existentes. Impede reduzir o total para abaixo do ja recebido. Ao eliminar o ultimo parceiro, impede apagar snapshots com componentes nao discriminadas.
- `ServiceDetail.jsx` e `ExternalCostsEditor.jsx`: confirmacao antes de eliminar; cancelar nao envia pedidos; guarda contra duplo clique; erros mantem o registo visivel. As acoes mobile de fundo ficam ocultas enquanto o dialogo relacionado esta aberto.
- `src/index.css`: estilos locais para o controlo fiscal, detalhe e acoes de parceiros.

Eliminar um parceiro nao altera o estado operacional do evento nem cria Staff ficticio. Nao foi adicionada uma regra de conclusao por pagamento.

## Exemplos confirmados

| Componente | Staff com IVA | Staff sem acrescimo de IVA |
| --- | --- | --- |
| Venda Staff, 28h x 10 EUR | 280,00 | 280,00 |
| IVA Staff | 64,40 | 0,00 |
| Venda parceiro | 430,00 | 430,00 |
| IVA parceiro | 98,90 | 98,90 |
| Venda sem IVA | 710,00 | 710,00 |
| IVA de venda | 163,30 | 98,90 |
| Receita com IVA | 873,30 | 808,90 |

O custo Staff continua 224,00 neste exemplo (28h x 8 EUR), e nao recebe IVA de venda. Com uma sinalizacao ja recebida de 100,00, o valor em falta passa a 773,30; eliminando o parceiro, passa a 244,40, sem mudar o valor recebido.

## Protecoes

- Faturacao emitida, inclusive faturas agrupadas: bloqueada pelas regras anteriores.
- Eventos faturados/pagos: configuracao e eliminacao bloqueadas.
- Evento operacionalmente finalizado, mas sem faturacao fechada: mantem a possibilidade anterior de editar dados financeiros; nao foi criado um bloqueio novo por estar no arquivo.
- Recebimentos parciais: preserva montantes/datas e impede um total inferior ao recebido. Nao cria devolucoes, creditos ou altera estados automaticamente.
- Custos com identidade desconhecida, versao antiga, dados malformados ou precos insuficientes: nao elimina nem deixa totais antigos ao lado de dados novos.
- Falha apos a escrita: rollback do custo e dos totais na mesma transacao.

## Testes

Suite completa: **1029 testes passaram, 0 falhas**, com Express/Prisma e SQLite descartavel para as rotas financeiras.

Cobertura dos 20 casos pedidos:

1. Staff com IVA; 2. Staff sem IVA; 3. parceiro com IVA; 4. ambos com IVA; 5. Staff sem IVA/parceiro com IVA; 6. Staff com IVA/parceiro isento; 7. varios parceiros com taxas/modos diferentes: `eventSalesTax.test.mjs`.
8. Alterar horas faturaveis; 9. alterar tarifa Cliente; 10. ativar IVA; 11. desativar IVA: `eventCostRegression.test.mjs`, verificando totais persistidos antes de GET.
12. Adicionar; 13. editar; 14. eliminar parceiros: testes HTTP de custos externos e respetivos testes de navegador.
15. Cancelar confirmacao: navegador, sem pedidos nem alteracoes de dados.
16. Orcamento convertido: teste HTTP com 28h a 10 EUR e parceiro de 430 EUR, com/sem IVA Staff.
17. Fatura emitida direta/agrupada e estados pagos: bloqueios HTTP e controlo desativado no navegador.
18. Sinalizacao: montantes preservados; reducoes abaixo do recebido bloqueadas, incluindo gravacao pelo formulario normal.
19. Financeiro Clientes, valor em falta e 70%/30%: testes de backend e navegador.
20. Financeiro Staff: tarifas, horarios e valores pagaveis mantidos; regressao do resumo financeiro em quatro viewports.

Verificacoes adicionais: rate herdado/customizado, IVA de deslocacoes independente, eliminação do ultimo parceiro em evento de varios dias/orcamento, custos alheios ao evento, versao antiga, permissoes, duplo clique, falha de escrita e rollback, snapshots nao discriminados, cache e respostas antigas.

Chrome com API intercetada:

- `tests/staff-vat-delete.browser.mjs`: passou a 320/390/768/1440 px; criacao, edicao, preview, persistencia simulada, dialogo, cancelamento, falha, duplo clique, Financeiro e bloqueio de pagos.
- `tests/event-cost-summary.browser.mjs`: passou a 320/390/768/1440 px.
- `tests/external-cost-editing.browser.mjs`: passou a 320/390/768/1440 px.
- `tests/client-payment.browser.mjs`: passou a 320/390/768/1440 px.
- `tests/dynamic-event-finance.browser.mjs`: passou a 390/1440 px.
- `tests/service-duplication.browser.mjs`: passou em desktop/mobile/compacto.

Lint sem avisos, build de producao e verificacao PWA passaram. Mantem-se o aviso de tamanho do chunk XLSX. O esquema MySQL passou `prisma validate`; nao foi testada uma instancia MySQL real.

## Migracao e limites

Migracao nova: `20261015010000_event_staff_vat`. Acrescenta apenas uma coluna DECIMAL nullable. Na base local, foi criada copia consistente por `node:sqlite backup`, aplicada apenas esta migracao e registada por `prisma migrate resolve`. A migracao antiga de notificacoes que estava pendente nao foi aplicada nesta tarefa.

Backup local: `node_modules/.cache/staff-vat-migration/before-staff-vat-1792030945360.db`. Comparacao em modo de leitura confirmou os **31 eventos preservados campo a campo**, excluindo a nova coluna; todos mantiveram o novo campo a NULL.

A geracao Prisma local atualizou os metadados e o runtime foi validado pelos testes HTTP, mas o comando normal termina com EPERM ao substituir `query_engine-windows.dll.node`, que esta em uso por um processo local. Nao foi parado esse processo. A tentativa sem motor nao foi mantida: o cliente voltou a ser gerado no modo normal, com o motor local existente. Uma regeneracao totalmente limpa no Windows requer fechar temporariamente o processo que mantem esse ficheiro aberto.

Nao houve publicacao online, acesso ao MySQL de producao ou alteracao de valores financeiros reais durante os testes.

Antes de publicar no servidor, fazer backup e verificar/aplicar as migracoes MySQL, gerar o cliente MySQL, compilar e reiniciar a API pelo procedimento habitual. A API nova nao deve arrancar antes de a coluna existir:

```sh
npx prisma migrate status --schema prisma/mysql/schema.prisma
npm run db:deploy:mysql
npm run db:generate:mysql
npm run build
```

Estes comandos de servidor sao instrucoes de publicacao; nao foram executados contra producao nesta tarefa.
