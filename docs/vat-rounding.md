# Arredondamento monetario do IVA

Os calculos novos usam `shared/money.js`: montantes em centimos, percentagens com
duas casas decimais e arredondamento simetrico de metade do centimo para fora de zero.
O produto da base pela taxa usa inteiros, evitando erros binarios como guardar
224,595 como 224,59. O total e sempre composto pela base e pelo IVA ja arredondados.

Caso de regressao: 93 horas x 10,50 = 976,50; IVA 23% = 224,60; total = 1201,10.
Nao existe valor por discriminar neste novo calculo.

Sao reutilizadas as taxas existentes, a independencia do IVA de Staff/deslocacoes,
o agrupamento comum de Staff/deslocacoes a mesma taxa, e os grupos fiscais dos
orcamentos. O centimo de conciliacao desses grupos e incluido na discriminacao,
nao somado como nova despesa. As bases e o IVA dos parceiros tambem reconciliam
com o respetivo total; o catering continua com 85% a 13% e 15% a 23%.
As duas parcelas de IVA do catering sao arredondadas antes da soma. Por exemplo,
430,00 produz 47,52 + 14,84 = 62,36 de IVA. Esta correcao pode mudar um centimo
nos novos calculos em relacao ao arredondamento agregado anterior.

Nao existe migracao de base de dados ou recalculo em massa. A leitura dos eventos,
faturas e recebimentos antigos nao reescreve os seus valores nem os movimentos
fiscais historicos. Os totais comerciais preservados continuam preservados.
Um servico antigo so recebe os novos totais atraves do fluxo normal de recalculo,
respeitando os bloqueios existentes de faturacao e recebimentos. Se o documento
ja foi emitido, nao se deve corrigir o seu IVA editando diretamente a base de dados.

Nao foram alterados os calculos de horas, pagamentos de Staff, margens percentuais,
taxas de IVA ou regras de recebimento. A alteracao aplica a mesma rotina ao calculo
de IVA dos eventos, parceiros, orcamentos, novos documentos e ajustes.
