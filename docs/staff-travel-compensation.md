# Compensacao automatica de deslocacao do staff

## Regra

Em Editar Evento/Servico, a secao Horario e estado mostra o calculo automatico.
Quando existe tempo de trajeto no primeiro carro configurado, cada colaborador
confirmado recebe esse tempo uma vez por dia. Em eventos continuos, o calculo e
feito separadamente para cada dia. Turnos repartidos nao duplicam a compensacao.

- Com um carro, todos os colaboradores confirmados usam esse carro.
- Com varios carros, o primeiro carro da lista e aplicado a todos, conforme a
  regra definida para esta implementacao. Os restantes continuam a alimentar o
  calculo comercial do cliente, mas nao o calculo de deslocacao do staff.
- O valor e calculado pelo valor/hora normal da atribuicao do colaborador.
- Sem 50/50, considera-se todo o tempo; com 50/50, considera-se metade.
- Atribuicoes pendentes, faltas, cancelamentos e dias cancelados nao recebem a
  compensacao.

## Calculo

O horario do servico e as picagens mantem-se inalterados. A compensacao e somada
separadamente ao custo do staff e ao pagamento individual. O tempo de trajeto
nao altera horas de servico, faturacao ao cliente, arredondamentos ou validacao.
IVA, ajustes e adiantamentos seguem as regras de pagamento existentes.

Exemplo: 14h de servico, 2h de trajeto e valor/hora de 8,50 EUR:

| Regra | Servico | Deslocacao | Total staff antes de IVA/ajustes |
| --- | ---: | ---: | ---: |
| Sem 50/50 | 119,00 EUR | 17,00 EUR | 136,00 EUR |
| Com 50/50 | 119,00 EUR | 8,50 EUR | 127,50 EUR |

Uma atribuicao ja paga antes desta automatizacao so conserva compensacao se ja
tiver um registo historico para ela. Ao concluir um pagamento depois da
atualizacao, a aplicacao regista a viatura usada no JSON existente do evento,
para manter o valor pago e impedir alteracoes silenciosas posteriores.

## Persistencia e publicacao

Nao ha migracao, tabela ou coluna nova. A configuracao continua em
`Event.travelCars`. O normalizador comercial ignora os registos historicos de
compensacao; o calculo automatico usa o primeiro carro e as atribuicoes do evento.

Publicar frontend e API em conjunto. A API atualizada deve acompanhar o frontend
para recalcular os totais, preservar os registos de pagamentos concluidos e
manter os horarios de servico intactos.

## Testes

```sh
node --test src/utils/staffTravel.test.mjs src/utils/travelCalculator.test.mjs src/utils/staffPayment.test.mjs server/utils/eventTotals.test.mjs
```

Com Vite e Playwright disponiveis, a verificacao de interface usa apenas dados
ficticios e interceta as chamadas a API:

```sh
node tests/staffTravel.browser.mjs
```
