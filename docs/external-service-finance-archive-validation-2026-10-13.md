# Servicos externos: Financeiro e arquivos sincronizados

## Origem do problema

- A conversao de orcamentos ja transfere custos externos, margem, IVA e referencia
  para o evento. Nao faltava Staff na conversao: esse servico nao o necessita.
- A prontidao financeira dependia do estado operacional finalizado/validado;
  externos ainda pendentes ficavam na previsao, sem o fluxo normal de Clientes.
- A conclusao operacional normal exige equipa e horarios de Staff. Sem essa
  operacao, o evento nao chegava automaticamente ao final do fluxo.
- O arquivo financeiro usa o estado financeiro pago; Eventos/Servicos usa o
  estado operacional. Eram criterios separados para o mesmo servico externo.

## Regra aplicada

Identificacao conservadora com os dados existentes: custo externo positivo,
sem funcoes/necessidades de Staff, sem rascunhos e sem alocacoes. Dados invalidos
ou alocacoes nao carregadas nao sao interpretados como ausencia de Staff.

O servico externo entra em Financeiro > Clientes desde o estado pendente.
Mantem os estados financeiros existentes. So finaliza/arquiva automaticamente
quando esta totalmente pago/recebido E o periodo operacional terminou.

Para faturas emitidas associadas, todas devem estar pagas segundo o helper de
ciclo de vida ja existente. Se nao existem faturas emitidas, aplica-se o
`billingStatus=paid` do evento. Adiantamentos, `paidAmount` isolado e pagamento
ao parceiro nao sao prova de liquidacao do cliente.

O ultimo dia ativo e o horario previsto sao respeitados, incluindo varios dias,
dias cancelados, turnos noturnos e Europe/Lisbon. Sem hora final, o ultimo dia
tem de terminar integralmente. Um pagamento antecipado nao arquiva um futuro.

Financeiro e Eventos/Servicos usam o mesmo predicado de elegibilidade. No
Financeiro, os externos sao apresentados individualmente para que um servico
futuro pago nao impeca o arquivo de outro servico ja terminado do mesmo cliente.
Nao ha duplicacao de eventos ou movimentos persistidos.

## Gravacao e consulta

- Alteracao financeira do evento e sincronizacao operacional: mesma transacao.
- Criacao/alteracao de fatura e sincronizacao dos externos associados: mesma
  transacao; inclui faturas agrupadas, sem modificar eventos Staff/mistos.
- Alteracoes concorrentes usam `updatedAt` e ausencia de alocacoes como guarda.
- Uma falha provoca rollback, sem fatura ou evento parcialmente alterados.
- Um externo pago antecipadamente e reconciliado na consulta seguinte apos
  terminar: nao foi criado um agendador de fundo.
- Os metadados `externalService.only/settled` sao derivados na API, nao campos
  novos na base; permitem a mesma classificacao com valores mascarados por perfil.
- Arquivar nao elimina dados. O evento arquivado pode ser aberto para consulta
  e mantem cliente, parceiro, custos, margem, IVA, valores, faturas e notas.
- Reabrir o estado financeiro retira o servico do arquivo. O botao manual
  "Marcar como realizado" foi removido; o fluxo visivel de conclusao dos externos
  e o pagamento/recebimento, respeitando sempre o fim do periodo do servico.

As mudancas de estado/leituras nao recalculam montantes. As edicoes habituais
dos dados do evento continuam a usar o motor de totais existente. Nao foram
alteradas formulas, regras de Staff, orcamentos, picagens ou estrutura da base.

## Verificacao

- Suite Node completa: 914 testes, zero falhas e zero testes ignorados.
- Dez testes de integracao externa com SQLite temporario e endpoints HTTP reais:
  permissao, conversao de orcamento, criado diretamente, varios dias, futuro
  pago, estados financeiros, faturas agrupadas, cancelamento e rollback.
- Teste HTTP de edicao de custos: totais persistidos/respondidos continuam iguais
  aos do motor existente; estado financeiro isolado preserva todos os valores.
- Navegador: fluxo pendente -> faturado -> pago -> ambos arquivos, futuro pago
  ativo e abertura do arquivado, em 320, 390 e 1440 px.
- Detalhe do servico: ausencia do botao manual nos estados pendente, faturado e
  pago, acoes existentes preservadas, futuro pago e consulta sem escrita, em
  320, 390 e 1440 px; validacao de horas continua disponivel para Staff/mistos.
- Regressao de validacao de horas: sete larguras, copia, edicao, gravacao,
  aceitacao Staff e validacao do cliente.
- Regressao QR/links: cooldown, duplo clique, correcao administrativa, passagem
  da meia-noite/fim do mes, saida tardia, validade e desaparecimento dos concluidos.
- ESLint, build de producao, verificacao PWA e `git diff --check` aprovados.
- O aviso de bundle XLSX acima de 500 kB permanece; nao e um erro de compilacao.

O servico real de 30/07 nao estava na base local. Foi reproduzido a partir de um
orcamento em fixtures isoladas, sem alterar eventos/pagamentos reais. Os testes
de navegador intercetam a API; nenhum envio WhatsApp/push foi executado.

O arquivo mantem a tabela responsiva preexistente, incluindo a sua rolagem
horizontal em mobile; este trabalho nao redesenha esse layout.

Nao houve publicacao online. Atualizar frontend e API em conjunto. Sem migracao.
