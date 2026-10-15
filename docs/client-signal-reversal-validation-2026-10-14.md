# Sinalizacoes em Eventos > Custos e referencias comerciais

## Causa

Os campos da sinalizacao ja eram editaveis no card Pagamento do cliente do detalhe
do evento, mas faltava uma operacao explicita para anular uma sinalizacao. Mudar
para Pendente preservava o recebido para nao apagar o historico, por isso nao era
uma reversao. Faltava ainda proteger a API contra a eliminacao de pagamentos
posteriores ao alterar a sinalizacao.

Os blocos de referencia 70%/30% tinham sido ligados tambem a Financeiro > Clientes.
Foram retirados das linhas e do resumo dessa pagina, sem retirar dados de pagamentos.

## Alteracao

- Editar o valor, data da sinalizacao e data prevista no separador Custos continua
  a usar os campos e o endpoint existentes. Saldo atualizado imediatamente no
  formulario e valores gravados de forma cumulativa, sem duplicar recebimentos.
- Nova acao Reverter sinalizacao apenas no card do evento, com confirmacao explicita.
- Endpoint autenticado exige `services.update` e revalida o evento e todas as
  faturas associadas, incluindo agrupadas, numa transacao serializavel.
- Guarda a versao `updatedAt` da consulta e usa update condicional. Uma configuracao
  entretanto alterada e recusada; falha posterior a escrita provoca rollback.
- Anula apenas sinalizacao, valor recebido dessa sinalizacao e data inicial.
  Mantem total, IVA, custos, margem, previsao, notas, operacao e alocacoes.
- Reversao bloqueada para Pago, data efetiva de liquidacao, recebido posterior,
  fatura emitida paga ou montantes incoerentes. Pagamentos ja recebidos nao sao
  anulados nem reduzidos implicitamente.
- A gravacao generica tambem protege o valor e a data da sinalizacao quando existem
  recebimentos posteriores; nao e possivel contornar a guarda apagando esses campos.
- Um recebimento adicional num pagamento parcial e preservado ao editar as datas;
  o saldo continua a considerar esse montante e a reversao e bloqueada.

Nao existe historico persistido do estado anterior a Sinalizacao. Sem criar campos
ou inventar estados, a reposicao usa a evidencia existente: Faturado se ha fatura
emitida em aberto, ou se o estado atual ja era Faturado; caso contrario, Pendente.
Os valores de faturas e as regras de faturacao nao sao alterados.

Os valores de referencia permanecem em Eventos/Servicos > evento > Custos, separados
dos recebimentos reais. Reutilizam o calculo 70%/30%, com complemento em centimos,
e acompanham o total atual. Nao aparecem em Financeiro > Clientes ou no seu modal.

## Testes

- Suite Node: 940 testes passados, zero falhas e zero ignorados.
- Edicao 175,50 -> 157,50 EUR num total de 252 EUR: saldo 94,50 EUR, novas datas
  persistidas e valores do evento inalterados.
- Reversao para Pendente/saldo 252 EUR; fatura aberta repoe Faturado sem mudar a fatura.
- Bloqueios de liquidacao, legados Pago, recebimento posterior, data efetiva,
  fatura paga direta/agrupada, valores incoerentes e tentativa por PUT generico.
- Autenticacao/permissao, consulta desatualizada, conflito de versao, filtro exato
  de IDs de faturas agrupadas e rollback apos falha de readback.
- Navegador, API simulada, 320/390/768/1440 px: editar, corrigir datas, cancelar
  confirmacao, falha de gravacao, reverter, consultar Financeiro e proteger historico.
- Referencias apenas nos eventos, quatro totais obrigatorios, total alterado,
  estados distintos e ausencia do bloco em Financeiro/modal, nas mesmas larguras.
- Regressao da liquidacao, guardar repetido, historico, legados e edicao geral.
- ESLint, build, PWA e `git diff --check` aprovados. Aviso preexistente de bundle
  XLSX acima de 500 kB, sem falha de compilacao.

Sem migracao, sem alteracoes de dados reais e sem publicacao online. Frontend e API
devem ser atualizados em conjunto.
