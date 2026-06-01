# ExtraSolutio.pt - WebApp de Gestao de Staff para Eventos

Aplicacao web para gestao de colaboradores, clientes, eventos/servicos,
contabilidade e faturacao da ExtraSolutio.pt.

## Decisoes Tecnicas Atualizadas

| Camada | Tecnologia | Nota |
| --- | --- | --- |
| Frontend | Vite + React | SPA rapida e simples de evoluir |
| Styling | CSS proprio | Design system controlado sem framework pesado |
| Routing | React Router | Navegacao interna da aplicacao |
| Backend | Node.js + Express | API REST modular |
| ORM/DB | Prisma + SQLite em desenvolvimento | SQLite e o alvo principal local |
| Producao DB | MySQL | Schemas e migrations mantidos em arvore propria |
| Auth | JWT + bcrypt | Login API-first |
| PDFs | jsPDF no frontend, utilitario server-side preparado | Exportacao de faturas |

## Regra de Base de Dados

O desenvolvimento deve correr em SQLite, mas toda a modelacao deve ser
compatibilizada com MySQL:

- evitar enums Prisma enquanto SQLite for o motor local; usar `String` com
  validacao na aplicacao;
- usar `Decimal` para valores monetarios, nunca `Float`;
- manter `prisma/sqlite/schema.prisma` e `prisma/mysql/schema.prisma`;
- manter migrations separadas por motor em `prisma/sqlite/migrations` e
  `prisma/mysql/migrations`;
- testar alteracoes de schema nos dois ficheiros antes de promover para
  producao.

## Modulos Principais

1. Dashboard: KPIs, proximos eventos, receitas, alertas.
2. Colaboradores: CRUD, dados fiscais, disponibilidade, historico, pagamentos.
3. Clientes: CRUD, dados fiscais, contactos, historico de eventos.
4. Eventos/Servicos: planeamento, estados, staff alocado, custos e receitas.
5. Contabilidade: receitas, despesas, pagamentos e fluxo de caixa.
6. Faturacao: faturas sequenciais, itens, IVA, estados e PDF.

## Estrutura

```text
server/                 API Express
src/                    Frontend React
prisma/sqlite/          Schema e migrations SQLite
prisma/mysql/           Schema e migrations MySQL
public/                 Assets publicos
```

## Scripts Principais

- `npm run dev`: frontend Vite.
- `npm run api`: API Express.
- `npm run dev:all`: frontend e API em paralelo.
- `npm run db:generate`: gera Prisma Client para SQLite.
- `npm run db:migrate`: aplica migrations SQLite.
- `npm run db:generate:mysql`: gera Prisma Client para MySQL.
- `npm run db:deploy:mysql`: aplica migrations MySQL em ambiente de producao.

## Ordem de Execucao

1. Fundacao do projeto, layout, API e schemas.
2. CRUDs principais com validacao partilhada.
3. Eventos, alocacao de staff e calculos financeiros.
4. Faturacao, PDFs e contabilidade.
5. Testes, seed data, responsividade e hardening de producao.
