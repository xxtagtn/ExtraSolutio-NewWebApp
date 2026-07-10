# Outlook Calendar Subscription Design

## Objetivo

Permitir adicionar o calendario da ExtraSolutio ao Outlook da conta `geral@extrasolutio.pt` atraves de uma subscricao iCal/Webcal, sem guardar credenciais do Outlook na aplicacao.

## Decisao

A aplicacao vai gerar um link privado `.ics` por utilizador. O Outlook subscreve esse link e consulta-o periodicamente. Quando a WebApp criar ou alterar eventos, pagamentos restantes, follow-ups ou aniversarios, o feed passa a devolver a informacao atualizada. A velocidade de atualizacao depende do Outlook.

## Componentes

- Modelo `User`: guarda `calendarFeedToken`, `calendarFeedEnabled` e `calendarFeedPreferences`.
- API autenticada:
  - `GET /api/calendar-feed/me`: devolve o estado e o URL privado.
  - `POST /api/calendar-feed/regenerate`: cria novo token e invalida o anterior.
- API publica por token:
  - `GET /api/calendar-feed/:token.ics`: devolve `text/calendar`.
- Gerador iCalendar:
  - gera eventos/servicos, incluindo eventos continuos por dia;
  - gera lembretes de restante pagamento;
  - gera follow-ups de orcamentos;
  - gera aniversarios de colaboradores;
  - escapa caracteres especiais e usa datas/horas compativeis com Outlook.
- UI no calendario:
  - painel discreto "Outlook";
  - botao para ativar/gerar link;
  - botao para copiar link;
  - botao para regenerar link.

## Seguranca

O link nao exige login porque o Outlook nao envia o token JWT da WebApp. A seguranca vem de um token aleatorio longo e revogavel. O feed nao deve expor NIF, IBAN, salarios ou dados sensiveis. Se o link for partilhado por engano, o utilizador pode regenerar o token.

## Validacao

- Testar o gerador `.ics` com eventos continuos, reminders e escaping.
- Verificar `npm run lint`.
- Verificar `npm run build`.
