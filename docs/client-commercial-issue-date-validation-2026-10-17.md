# Emissao manual e vencimento em Financeiro > Clientes

## Objetivo e implementacao

Ao selecionar Faturado em Gerir recebimentos, a aplicacao pede agora a data
efetiva de emissao. O estado e a data so sao gravados depois de Guardar faturacao.
Cancelar ou abrir o formulario nao escreve qualquer alteracao.

O vencimento usa o prazo ja configurado no cliente e as funcoes existentes de
`shared/invoiceLifecycle.js`. Faturacao quinzenal nao equivale a prazo de
pagamento de 15 dias. A data do evento, o fecho da quinzena e o momento em que
se clica Faturado nao sao usados para inventar uma data de emissao.

Exemplos validados a 17/10/2026:

- FIC, emissao 15/10, pronto pagamento: vencimento 15/10, vencida ha 2 dias.
- FIC, emissao 15/10, pagamento a 15 dias: vencimento 30/10, dentro do prazo.
- SSH, emissao 15/10, pagamento a 30 dias: vencimento 14/11, dentro do prazo.
- No dia do vencimento mostra Vence hoje; so depois existe atraso.

A coluna Vencimento e o gestor mostram a data e uma indicacao:
Dentro do prazo, Vence hoje, Vencida ha X dias, Liquidado,
Emissao por registar ou Prazo por configurar, conforme os dados efetivos.
O alerta Pagamento em falta usa a mesma avaliacao de prazo.

## Persistencia e seguranca

A data `commercialIssueDate` fica no JSON `clientPaymentRecord` ja existente.
`commercialChanges` preserva autor, momento, data anterior e nova data.
Nao foi criada uma tabela, coluna, migracao ou fatura paralela.
Esta operacao regista a referencia comercial da emissao; nao emite uma fatura
fiscal nem altera o tratamento dos documentos efetivamente associados.

Nos eventos antigos ja Faturados, Registar emissao permite preencher a data
desconhecida. Editar emissao permite corrigi-la com auditoria. Nao sao
preenchidas datas retroativamente de forma automatica.

Uma fatura realmente emitida e associada prevalece sobre a referencia manual.
A sua data nao pode ser alterada por esta acao. Mantem-se a protecao de precos
e de faturacao antiga. As permissoes continuam a ser as existentes para atualizar
eventos e pagamentos, e as escritas mantem transacao serializavel, versao e
comparacao atomica do registo para rejeitar dados desatualizados.

Guardar a emissao nao altera o estado operacional, recebimentos, saldo, IVA,
precos, margens, regras do cliente ou criterios de arquivo. Pagamentos parciais,
liquidacao, reversoes e arquivo continuam a reutilizar os fluxos anteriores.

## Ficheiros desta alteracao

- `src/utils/clientPaymentDeadline.js` e respetivo teste: data valida e
  apresentacao de vencimento comum a tabela, alerta e gestor.
- `src/utils/clientPaymentAlert.js`: utiliza a referencia de emissao quando
  existe, preservando as restantes politicas comerciais.
- `src/pages/Accounting.jsx`: vencimento e situacao temporal na linha do evento.
- `src/components/Finance/ClientReceiptManager.jsx`: formulario, pre-visualizacao,
  registo/correcao da emissao, datas e auditoria.
- `src/index.css`: apresentacao responsiva das datas e do formulario.
- `server/services/clientPayment.js` e respetivos testes: validacao obrigatoria
  da data, metadados auditados e protecao das faturas associadas.
- `tests/finance-receipt-manager.browser.mjs`,
  `tests/client-payment-alert.browser.mjs`,
  `tests/external-finance-archive.browser.mjs`.
- Este relatorio. Alteracoes anteriores no diretorio foram preservadas.

## Testes executados

- `node --test`: **1.171 aprovados, zero falhas e zero ignorados**.
- Testes novos de calendario: FIC quinzenal, pronto pagamento vs. 15 dias,
  SSH a 30 dias, emissao desconhecida, prioridade da fatura real, prazo custom,
  vencimento hoje, mudanca de hora e ausencia de alteracoes monetarias.
- HTTP: data em falta/invalida rejeitada, criacao, correcao e limpeza manual
  auditadas, faturacao antiga protegida, fatura real nao reescrita e valores
  financeiros mantidos. Os restantes testes de permissoes, concorrencia,
  recebimentos, Staff e arquivo tambem passaram.
- Navegador a 320, 390, 768 e 1440 px, API local e SQLite descartavel:
  selecao sem escrita, cancelar sem escrita, formulario sem data inventada,
  guardar emissao, recarregar, corrigir a data e dias de atraso, completar um
  evento antigo, pagar, arquivar e reverter recebimentos.
- Navegador apenas de leitura: 14 cenarios comerciais/layout por largura,
  incluindo FIC vencida, FIC em prazo e SSH em prazo sem fatura associada.
  Tabela e gestor consistentes apos recarregar; sem erros JavaScript ou
  sobreposicao da base/IVA; fixtures sem escritas.
- Regressao de parceiros e arquivo aprovada a 320, 390 e 1440 px.
- Lint dos ficheiros envolvidos, build, verificacao PWA e `git diff --check`
  aprovados. Capturas desktop/mobile revistas.

## Limites

Sem acesso ou alteracoes a dados reais, sem migracoes e sem publicacao online.
A configuracao real do FIC e da SSH em producao nao foi consultada; os testes
usam as condicoes explicitas dos exemplos. Em eventos antigos, o utilizador
tem de indicar a data efetiva para existir um vencimento fiavel.
MariaDB em producao nao foi testada. O aviso anterior do bundle XLSX grande
permanece fora do ambito.
