# Lugares cancelados que deixaram de ser necessarios

## Utilizacao

1. No separador Colaboradores, marcar a alocacao como Cancelado e guardar a equipa.
2. Na linha cancelada, usar Retirar lugar da equipa necessaria e confirmar.
3. A necessidade dessa funcao/dia baixa uma unidade: 37/38 passa a 37/37.
4. Repor lugar aumenta novamente a necessidade; a alocacao continua cancelada ate ser
   definida uma substituicao ou alterado explicitamente o seu estado.

Cancelado sem esta acao continua a representar um lugar para substituicao.
Faltas com/sem justificacao continuam a contar para a cobertura da equipa, mas nao
para horas faturaveis, validacao ou pagamentos. Nenhum colaborador ficticio e criado.

## Persistencia e integridade

A migracao aditiva `20261102010000_assignment_slot_release` acrescenta apenas
`EventAssignment.slotRelease`, nullable, com JSON versionado contendo data da decisao e
snapshot da necessidade original. Os cancelamentos existentes mantem NULL: nao existe
conversao automatica de dados historicos nem reducao retroativa das necessidades.
O snapshot permite repor a tarifa e a funcao quando era o ultimo lugar dessa funcao.
Dados financeiros do snapshot sao ocultados a utilizadores sem permissao de consulta.

POST `/api/services/:id/assignments/:assignmentId/slot` usa a permissao existente
`services.update`, verifica pertença ao evento, dia ativo, versoes e bloqueios de
faturacao, e grava necessidade + metadata + totais numa transacao serializavel.
Repetir a mesma operacao nao reduz/aumenta duas vezes a quantidade. Falhas revertem
a operacao inteira. O registo cancelado, horarios e movimentos de Staff sao mantidos.
Os totais usam os calculadores existentes; nao ha novas formulas de margem ou IVA.

Em eventos continuos, apenas lugares explicitamente retirados deixam de entrar na
contagem minima das linhas planeadas. Outros dias, funcoes, faltas e cancelamentos
que aguardam substituicao mantem as regras anteriores. Sao preservados campos locais
por guardar: a acao pede que sejam guardados antes de alterar a necessidade.

## Atualizacao

Depois do backup e com a API parada, gerar o cliente Prisma, aplicar as migracoes e
fazer build. No servidor MySQL:

```sh
npm run db:generate:mysql
npm run db:deploy:mysql
npm run build
```

Reiniciar a API apenas depois de concluir a migracao. Nao sao necessarios resets,
eliminacao de alocacoes nem recalculos globais dos eventos existentes.
