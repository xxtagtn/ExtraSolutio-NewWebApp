# Horas Mínimas por Cliente

## Regras

- Cada cliente pode ter um número decimal opcional de horas mínimas.
- O mínimo aplica-se individualmente a cada colaborador, dia e turno.
- As horas reais resultam dos horários validados para o cliente.
- As horas faturáveis são `MAX(horas reais, horas mínimas)`.
- Pagamentos ao staff continuam a usar horas reais/pagáveis, sem aplicar o mínimo do cliente.
- Eventos abertos acompanham alterações ao mínimo do cliente.
- Eventos finalizados preservam o mínimo que estava em vigor no momento da finalização.

## Persistência

- `Client.minimumHours`: condição comercial atual.
- `Event.minimumHoursSnapshot`: condição aplicada ao evento.
- `Event.realHours`: soma das horas reais dos colaboradores.
- `Event.billableHours`: soma das horas faturáveis.
- `EventAssignment.clientRealHours`: horas reais do colaborador naquele dia/turno.
- `EventAssignment.clientBillableHours`: horas faturáveis do colaborador naquele dia/turno.

## Cálculo

Cada atribuição representa um colaborador num dia/turno. O cálculo é feito nessa unidade:

```text
clientBillableHours = MAX(clientRealHours, event.minimumHoursSnapshot)
```

As receitas do evento, Financeiro, relatórios e documentos usam `clientBillableHours`. Os custos de staff continuam a usar `staffPayableHours`.

## Compatibilidade

Serão criadas migrations equivalentes para SQLite e MySQL. Os novos campos terão valor inicial zero, preservando o comportamento dos dados existentes.
