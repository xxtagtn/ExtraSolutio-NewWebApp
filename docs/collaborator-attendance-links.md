# Links fixos de picagem

## Comportamento

- Comunicacao > Links de picagem lista colaboradores ativos, mesmo sem servicos ou horarios.
- A tabela mostra Nome, Servicos confirmados e Acao. A contagem corresponde a atribuicoes
  confirmadas do mes civil atual em Europe/Lisbon (inclui servicos ja concluidos), sem
  faltas, dias/eventos cancelados ou acessos revogados. O mes e identificado no cabecalho.
- A quantidade por pagina (10, 25, 50 ou 100) fica guardada neste navegador por utilizador,
  incluindo depois de recarregar a pagina ou voltar ao separador. Sem preferencia valida,
  usa 25. Se o armazenamento estiver bloqueado, a selecao atual continua a funcionar.
- Copiar cria o link apenas se ainda nao existir. O endereco nao muda entre meses.
- A Comunicacao tem apenas Mensagens e Links de picagem. O separador QR Codes / Link
  e as opcoes de gerar imagens, ver, imprimir ou descarregar QR foram retirados da interface.
- O link mostra os servicos confirmados do mes atual e reutiliza a selecao de turnos,
  janelas, revisoes, cooldown, auditoria, calculos e comprovativo de saida existentes.
- A passagem de mes/ano e automatica, incluindo o turno noturno elegivel do ultimo dia.
- Sem servicos: resposta normal com lista vazia, nao expiracao.
- Apenas colaboradores com estado `active` podem consultar/picar. `inactive`, `paused`,
  eliminados e tokens desconhecidos/substituidos devolvem o mesmo 404 sem identidade.
- Uma pagina aberta verifica novamente em foco e a cada 15 segundos. Qualquer POST
  verifica o acesso no servidor e novamente dentro da transacao antes de escrever.
  Um ecra ja desenhado nao pode ser apagado remotamente enquanto estiver offline,
  mas nunca autoriza novas picagens sem verificacao online.
- Reativar recupera o mesmo link. Gerar novo link invalida o anterior e exige reenvio.
- Os links diarios/mensais ja enviados nao sao convertidos em acessos permanentes.
  Mantem as regras de validade existentes e tambem bloqueiam colaboradores inativos.
  Deve enviar-se uma vez o novo link `/qr/link/:token` a cada colaborador.

## Persistencia e seguranca

Tabela aditiva `CollaboratorAttendanceLink`: uma linha por colaborador, token aleatorio
de 256 bits, datas de criacao/atualizacao e chave estrangeira com cascade na eliminacao.
Nenhum dado financeiro, atribuicao ou registo de picagem e migrado ou eliminado.
Nao existem tokens previsiveis baseados apenas no ID nem novos dados pessoais publicos.
Gestao protegida pela autenticacao e permissao `communication.manageQrCodes` existentes.
Respostas publicas sem cache e com Referrer-Policy no-referrer.

Rotas:
- GET `/api/qr-codes/links`: pesquisa/paginacao de nomes ativos, sem emitir tokens.
- POST `/api/qr-codes/links/:collaboratorId`: obter/criar; `replace: true` substitui.
- GET `/api/qr-check/link/:token`: servicos disponiveis.
- POST `/api/qr-check/link/:token/check-in` e `/check-out`: fluxo transacional existente.

## Atualizacao

Depois do backup, atualizacao de codigo e instalacao de dependencias, com a API parada:

```sh
npm run db:generate:mysql
npm run db:deploy:mysql
npm run build
```

Voltar a iniciar `esgestao-api`. A migracao necessaria e
`20261031010000_collaborator_attendance_link`. Em SQLite usar `db:generate` e `db:deploy`.
Nao executar comandos de reset ou apagar recebimentos para aplicar esta funcionalidade.
