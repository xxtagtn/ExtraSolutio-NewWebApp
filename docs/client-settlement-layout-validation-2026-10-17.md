# Financeiro > Clientes: alinhamento e liquidacao para arquivo

## Causas encontradas

- A discriminacao base + IVA so tinha `display: block` quando a celula estava
  em alerta. Ao omitir corretamente o alerta dentro do prazo, o texto tornava-se
  inline e sobrepunha o estado Faturado. A tabela tambem herdava `nowrap`.
- Eventos antigos com `billingStatus: invoiced`, sem fatura associada, eram
  bloqueados juntamente com faturas reais. No gestor nao existia uma fatura
  para marcar paga nem era permitido acrescentar um recebimento.
- O estado Finalizado da imagem ja era operacionalmente correto; faltava
  liquidar o saldo, nao voltar a finalizar o evento.

## Correcao

- Celula Por receber com classe permanente, valor principal em bloco e
  discriminacao fiscal numa linha inferior, com quebra controlada e mais espaco.
- Ajustados os espacos dos cabecalhos Vencimento e Estado do evento. Mantida a
  organizacao responsiva de duas colunas no mobile.
- No gestor, Liquidar saldo abre o formulario de recebimento ja existente com
  o saldo por receber preenchido, tipo Restante recebido e data efetiva editavel.
  Nao escreve dinheiro apenas por abrir ou selecionar o comando.
- Recebimentos parciais continuam disponiveis pelo comando existente.
- Para faturacao antiga sem fatura associada, a rota transacional existente
  passa a aceitar novos recebimentos. Mantem a evidencia `legacyInvoiced` no
  historico, sem desbloquear precos ou correcoes protegidas.
- Faturado permanece enquanto o recebimento e parcial; Totalmente Pago exige
  a liquidacao real. Nao e uma opcao manual que dispense registar o dinheiro.
- Faturas efetivamente emitidas continuam a impedir recebimentos paralelos no
  evento. O gestor mostra Marcar fatura como paga, com confirmacao explicita,
  reutilizando a atualizacao de faturas e eventos ja existente.
- Arquivo continua a usar os criterios existentes. Pagar nao conclui horarios,
  Staff ou validacoes em falta. Um evento ja finalizado e liquidado e arquivado;
  um evento operacionalmente incompleto permanece ativo.

## Ficheiros desta alteracao

- `src/pages/Accounting.jsx`
- `src/index.css`
- `src/components/Finance/ClientReceiptManager.jsx`
- `src/components/Finance/ClientReceiptEditor.jsx` (rotulo acessivel do tipo)
- `src/utils/clientPayment.js`
- `src/utils/clientFinancialState.js`
- `server/services/clientPayment.js`
- `server/services/clientPayment.test.mjs`
- `src/utils/clientFinancialState.test.mjs`
- `tests/finance-receipt-manager.browser.mjs`
- `tests/client-payment-alert.browser.mjs`
- Este relatorio.

Alteracoes anteriores no diretorio foram preservadas, sem reversoes.

## Verificacao

- Suite Node completa: **1.161 aprovados, zero falhas e zero ignorados**.
- Testes HTTP novos: faturacao antiga recebe 100 + 195,20 num total 295,20;
  conserva IVA, precos e operacao; preserva o bloqueio de edicao de precos;
  rejeita repeticao desatualizada; arquiva apenas quando finalizado e pago.
- Teste HTTP adicional: pagamento integral de evento com Staff em execucao
  nao altera o estado operacional nem permite arquivo prematuro.
- Navegador com API local e SQLite descartavel a 320, 390, 768 e 1440 px:
  liquidacao antiga de 295,20, um unico movimento do tipo restante, persistencia
  depois de recarregar, arquivo, pagamento de fatura emitida pelo caminho
  proprio, sinalizacao, pagamentos parciais, reversao, estado manual e saldos.
- Navegador apenas de leitura, 11 cenarios por largura: regras comerciais
  anteriores preservadas e medicao dos retangulos reais do texto base/IVA para
  garantir que fica abaixo do valor e dentro da sua celula.
- Capturas desktop/mobile revistas. Sem erros JavaScript nas suites.
- Lint dos ficheiros envolvidos, build, PWA e `git diff --check` aprovados.

## Integridade e limites

Sem alteracoes ao esquema da base de dados, migracoes ou dados reais. Precos,
margens, IVA, regras dos clientes, Staff, validacao de horas, prazos e regras de
arquivo nao foram alterados. Mantidas permissoes, transacao serializavel,
verificacao de versao e diario de recebimentos. Nao existe um arquivo destrutivo.

O evento real FIC Restaurante EXTRAS nao foi consultado nem liquidado por estes
testes. Foi reproduzido com dados ficticios de 295,20 e IVA de 55,20.
Sem acesso a MariaDB de producao, sem publicacao online e sem agendadores.
O aviso anterior do bundle XLSX grande permanece fora do ambito.
