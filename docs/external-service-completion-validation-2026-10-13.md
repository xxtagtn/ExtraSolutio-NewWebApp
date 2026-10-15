# Finalizacao de servicos exclusivamente externos

Este documento descreve a primeira etapa, de conclusao operacional manual.
O botao "Marcar como realizado" foi posteriormente removido da interface.
A regra posterior de arquivo financeiro sincronizado esta documentada em
`external-service-finance-archive-validation-2026-10-13.md`: pagamento isolado
continua insuficiente; servico exclusivamente externo, liquidado e com periodo
terminado pode agora finalizar automaticamente.

## Causa e solucao

O fluxo operacional normal depende de uma equipa confirmada e de pelo menos um
registo de horarios Staff. Sem colaboradores, os servicos externos nao conseguem
avancar atraves da validacao de horas.

A identificacao reutiliza os dados existentes: custo externo positivo configurado,
nenhuma funcao/necessidade de Staff, nenhum rascunho de equipa e nenhuma alocacao.
Configuracoes invalidas ou alocacoes nao carregadas nao sao consideradas externas.
Nao foi criada qualquer coluna, migracao, colaborador, picagem ou validacao artificial.

No detalhe do evento, a acao **Marcar como realizado** exige confirmacao explicita.
A data isolada e o pagamento antecipado nao finalizam o evento. O fecho respeita o
ultimo dia ativo, o horario previsto e a passagem pela meia-noite, em Lisboa.

O endpoint autenticado exige `services.update` e revalida os dados numa transacao
serializavel. Atualiza apenas `status=finalized` e `statusMode=manual`; usa a versao
do evento e a ausencia de alocacoes como protecao contra alteracoes concorrentes.
Uma falha provoca rollback. O fluxo de eventos com Staff permanece inalterado.

## Casos verificados

| Caso | Resultado |
| --- | --- |
| Evento normal com Staff | Novo caminho recusado; fluxo original mantido |
| Necessidade de Staff, zero colaboradores | Nao classificado como externo; fecho recusado |
| Apenas parceiro/custo externo | Finalizacao apos confirmacao explicita |
| Staff + custo externo | Novo caminho recusado |
| Servico externo de um dia | Fecho permitido apos o periodo previsto |
| Servico externo de varios dias | Bloqueado antes do ultimo fim ativo, incluindo turno noturno |
| Servico externo pago antecipadamente | Pagamento nao finaliza; datas futuras continuam bloqueadas |
| Servico externo por faturar | Pode concluir operacionalmente sem alterar faturacao |
| Faturado, nao recebido | Pode concluir; fatura e valores preservados |
| Recebido | Pode concluir; recebimentos e valores preservados |
| Proveniente de orcamento | Conversao existente e referencia preservadas |
| Criado diretamente | Mesmo criterio e acao de finalizacao |

Verificados ainda: dias cancelados, dados malformados, cancelar a confirmacao,
falha de gravacao, repeticao da acao, falta de autenticacao/permissao, configuracao
alterada entretanto e rollback apos falha posterior ao update operacional.
Os snapshots confirmam que todos os campos nao operacionais, faturas e alocacoes
permanecem iguais; apenas o `updatedAt` tecnico muda numa finalizacao bem-sucedida.

## Execucoes finais

- Suite Node: **908 testes passados**, sem falhas nem testes ignorados.
- Interface de fecho externo: 320, 390 e 1440 px, sem overflow do novo botao.
- Validacao de horas: sete larguras, edicao, copia, gravacao e aceitacao de horarios.
- QR Codes e links: cooldown, duplo clique, saidas noturnas, viragem de mes e validade.
- ESLint, build de producao e verificacao PWA aprovados.
- Build apresenta apenas o aviso ja existente de tamanho do bundle XLSX.

O servico externo real de 30/07 nao estava presente na base local; foi reproduzido
como fixture convertida de orcamento numa base temporaria. Nenhum evento real foi
alterado. Nao foi feita publicacao online. O frontend e a API precisam ser
atualizados em conjunto; nao existe migracao de base de dados.
