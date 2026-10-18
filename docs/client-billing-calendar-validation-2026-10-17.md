# Faturação, vencimentos e arquivo financeiro

Data: 17/10/2026. Implementação local, sem publicação em produção.

## Análise

- As condições comerciais já existiam em `Client`: `billingMethod`, `paymentTerm`, `paymentTermDays`, `billingCustomRule` e condições de pré-pagamento.
- Os vencimentos das faturas e do estado comercial manual usavam a emissão introduzida, sem uma referência comum ao mês/quinzena dos serviços.
- Os agrupamentos usavam sobretudo a data inicial do evento. Um serviço contínuo podia ficar integralmente na primeira quinzena/mês.
- A regra personalizada em texto livre era tratada em alguns agrupamentos como mensal, embora não constituísse uma regra executável.
- O arquivo financeiro era inferido automaticamente a partir da liquidação e conclusão operacional.
- Os recebimentos já possuíam um diário no campo JSON `clientPaymentRecord`. Foi reutilizado; não foi criado um segundo sistema de recebimentos.
- A origem de orçamento é identificável pelo marcador existente `[BUDGET_REF:...]` nas notas. Não existe uma data de adjudicação histórica garantida em todos os eventos antigos.

## Decisões Confirmadas

1. Mensal: referência no último dia do mês dos serviços, independentemente do dia posterior de tratamento do documento.
2. Eventos que atravessam períodos: repartir pelos dias efetivos de cada período.
3. Arquivos financeiros antigos: manter; os novos arquivos requerem confirmação.
4. Valores globais sem dia atribuído: repartir manualmente, sem rateio proporcional ou divisão em partes iguais.

## Regras Implementadas

- Calendário partilhado, calculado no backend e devolvido nos serviços como `clientFinance`. Financeiro, detalhe de serviço, faturas e alertas reutilizam as mesmas funções.
- Mensal: último dia do mês; quinzenal: dia 15 ou último dia do mês; por evento: preservada a referência existente de data inicial + 1 dia.
- O prazo de pagamento é acrescentado à referência, não confundido com o método de faturação. Adicionada a opção de 5 dias; preservados 15, 30, 45, imediato e prazo numérico personalizado.
- Datas calculadas por dias de calendário; o estado diário usa Europe/Lisbon e não depende do fuso do processo servidor.
- Faturação e pagamento são apresentados separadamente. Um serviço faturado pode continuar parcialmente recebido ou vencido.
- O aviso vermelho de fatura vencida depende de faturação, vencimento ultrapassado e saldo efetivo. Um saldo ainda por faturar não é apresentado como uma fatura emitida vencida.
- Datas de referência de faturas antigas são derivadas sem reescrever a sua emissão histórica durante consultas. Novas emissões periódicas utilizam a referência comercial correspondente.
- Sem condições financeiras registadas, eventos de orçamento seguem a referência 70% na adjudicação e 30% sete dias antes. As condições do cliente registado prevalecem.
- Recebimento antecipado integral é apresentado como previsto totalmente recebido enquanto o serviço não estiver concluído. Um acerto posterior conserva o dinheiro recebido e apresenta apenas o saldo adicional; não reinicia os pedidos 70/30.

## Repartição Manual

Em **Gerir recebimentos → Repartir faturação**, cada período permite indicar:

- Valor global com IVA, para parceiros, deslocações e outros valores sem data própria.
- IVA incluído nesse valor.
- Recebido atribuído ao período.

O Staff com data é distribuído pelos dias correspondentes, usando as funções existentes de horas faturáveis, tarifa e IVA. Os totais do evento continuam a ser os valores financeiros autoritativos já calculados pela aplicação.

A soma manual deve coincidir ao cêntimo com o valor global, IVA e recebimentos existentes. Não são alterados os custos ou recebimentos ao guardar esta repartição. Enquanto não for possível identificar os valores por período, a interface apresenta **Por repartir**, não um zero enganador.

A repartição é reconfirmada quando mudam totais, IVA, composição diária de Staff ou revisão dos recebimentos. Isto inclui uma redistribuição de horas entre períodos que não altere o total global. Uma sinalização antiga é materializada no diário antes de guardar metadados, para não desaparecer da consulta.

## Arquivo e Integridade

- Novos serviços financeiramente liquidados permanecem no Financeiro até **Arquivar serviço**.
- A confirmação exige serviço terminado, conclusão operacional segundo as regras existentes, total final positivo, ausência de saldo e repartição confirmada quando aplicável.
- **Restaurar serviço** devolve o registo à área financeira ativa.
- Um saldo reaberto impede que o serviço permaneça arquivado. Repor um recebimento não reutiliza silenciosamente a confirmação de arquivo anterior.
- Arquivos antigos continuam a seguir a compatibilidade anterior; não foi executada uma migração de dados em produção.
- O arquivo operacional da página Eventos conserva as regras operacionais existentes; esta confirmação diz respeito ao arquivo financeiro.
- Reutilizado o JSON existente para `financeWorkflowVersion`, `billingAllocation`, `financeArchive`, `financeChanges` e referências de novos orçamentos. Sem colunas, tabelas ou migrações novas.
- Escritas protegidas pelas permissões existentes, transações e comparação de `updatedAt`, revisão e JSON anterior. Dados desatualizados são rejeitados.
- Nenhum recebimento, custo, ajuste ou evento é eliminado por estas operações. O histórico de recebimentos e correções é mantido.

## Ficheiros

| Área | Ficheiros |
| --- | --- |
| Calendário e prazos | `shared/clientBillingCalendar.js`, `shared/clientPaymentTerms.js`, `shared/invoiceLifecycle.js` |
| Estado financeiro comum | `src/utils/clientFinanceSnapshot.js`, `src/utils/clientPaymentDeadline.js`, `src/utils/clientPaymentAlert.js` |
| Persistência e API | `server/services/clientFinancialMetadata.js`, `server/services/invoiceBilling.js`, `server/services/clientPayment.js`, `server/services/clientPaymentRecord.js`, `server/routes/index.js`, `server/utils/listPayloads.js` |
| Integração existente | `server/services/eventWorkflow.js`, `server/services/notificationOverview.js`, `src/utils/pendingActions.js`, `src/utils/layoutNotifications.js` |
| Agrupamentos e resumo | `src/utils/clientBilling.js`, `src/utils/clientFinancialSummary.js` |
| Interface | `src/components/Finance/ClientBillingPeriods.jsx`, `src/components/Finance/ClientReceiptManager.jsx`, `src/pages/Accounting.jsx`, `src/pages/ServiceDetail.jsx`, `src/index.css` |
| Opção/rótulo 5 dias | `src/pages/Clients.jsx`, `src/pages/Budgets.jsx`, `src/pages/Services.jsx` |
| Testes | `shared/clientBillingCalendar.test.mjs`, `src/utils/clientFinanceSnapshot.test.mjs`, `src/utils/clientPaymentDeadline.test.mjs`, `src/utils/clientPaymentAlert.test.mjs`, `src/utils/clientReceiptTax.test.mjs`, `server/services/clientPayment.test.mjs`, `server/services/eventCostRegression.test.mjs`, `tests/finance-receipt-manager.browser.mjs`, `tests/external-finance-archive.browser.mjs` |

## Testes Executados

- `node --test`: **1.199 aprovados, 0 falhas**. Inclui os casos A-M do pedido, Staff, parceiros, IVA, recebimentos, alterações concorrentes, permissões e rollback.
- Matriz de calendário: mensal + 15/30 dias, ambas as quinzenas, por evento + 5 dias, imediato, personalizado, fevereiro normal/bissexto, meses de 30/31 dias e dezembro/janeiro.
- Orçamento 70/30, pré-pagamento integral, acerto posterior, pagamento parcial vencido, pagamento integral e manutenção dos recebimentos.
- Repartição de evento 14-18 por dias, passagem outubro/novembro, valores globais manuais, somas inválidas, períodos duplicados/estranhos, persistência e invalidação de repartições antigas.
- Arquivo explícito, restauração, bloqueio com saldo/futuro, reversão e novo recebimento sem rearquivo automático.
- Reexecução de 22 testes de calendário/vencimento com `TZ=America/Los_Angeles`: **22 aprovados**.
- `tests/finance-receipt-manager.browser.mjs`: aprovado em **320, 390, 768 e 1440 px**, com API real isolada e SQLite temporário. Inclui repartição manual, recebimentos, faturação, arquivo, reversão e persistência.
- `tests/external-finance-archive.browser.mjs`: aprovado em **320, 390 e 1440 px**, apenas com dados em memória. Consulta de arquivo e proteção de serviços futuros verificadas.
- Capturas de ecrã inspecionadas em desktop e mobile; corrigidas repetição de datas, texto sem quebra e sobreposição do botão flutuante no formulário.
- Sem erros JavaScript de página detetados pelos testes de navegador.
- `npm run lint`: aprovado.
- `npm run build`: aprovado. Mantém o aviso de chunk grande da biblioteca XLSX; não foi alterado o empacotamento geral.
- `npm run verify:pwa`: aprovado.
- `git diff --check`: aprovado; apenas avisos informativos de conversão LF/CRLF do Git.

Log dos testes: `node_modules/.cache/client-billing-revision-tests.log`.
Capturas: `node_modules/.cache/finance-receipt-manager/` e `node_modules/.cache/external-finance-archive/`.

## Limitações e Preservação

- Condições personalizadas em texto livre não são interpretadas como regras automáticas. Sem referência ou prazo suficientes, a data fica por configurar.
- Uma fatura que abrange vários períodos e não possui referência inequívoca exige confirmação do período; não é escolhida uma data arbitrária.
- Para orçamentos antigos sem data de adjudicação, não foi inventada uma data histórica. A data dos 30% continua a ser calculável pela data do serviço.
- A repartição não emite documentos fiscais novos nem cria recebimentos adicionais. O estado comercial manual continua a pertencer ao serviço existente.
- Não foram consultados nem alterados os dados reais de FIC, SSH ou de outros clientes. A validação utiliza configurações existentes do modelo e cenários sintéticos isolados, não uma auditoria da base de produção.
- Não foram iniciados o servidor principal, schedulers, WhatsApp ou envio de notificações. Nenhum teste enviou mensagens reais.
- Não foram alteradas fórmulas de margens, custos, IVA, pagamentos de Staff, picagens, QR Codes, links ou validação de horas. Não foi executada qualquer migração nem publicação.

Frontend Vite local: `http://127.0.0.1:5187`. A utilização normal depende da API habitual da aplicação; os servidores usados pelos testes são temporários e foram encerrados.
