// Status de pedido da Shopee (os mesmos valores que vêm tanto no pedido
// sincronizado quanto no push de status usado pela previsão de lucro) -
// compartilhado entre Pedidos e o detalhe da previsão de lucro no Início.
export const ORDER_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Aguardando pagamento',
  READY_TO_SHIP: 'Pronto pra envio',
  PROCESSED: 'Em processamento',
  SHIPPED: 'Enviado',
  TO_CONFIRM_RECEIVE: 'Aguardando confirmação de recebimento',
  COMPLETED: 'Concluído',
  IN_CANCEL: 'Cancelando',
  CANCELLED: 'Cancelado',
  TO_RETURN: 'Em devolução',
};

// Status de pedido do Mercado Livre (minúsculo, vocabulário bem diferente da
// Shopee) - usado só no detalhe da previsão de lucro, já que Pedidos busca
// direto do nosso banco (que só guarda pedido já "paid").
export const MERCADO_LIVRE_ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmado',
  payment_required: 'Aguardando pagamento',
  payment_in_process: 'Pagamento em análise',
  partially_paid: 'Pago parcialmente',
  paid: 'Pago',
  cancelled: 'Cancelado',
  invalid: 'Inválido',
};

// Status de evento de pedido da iFood - nomes ainda não confirmados contra a
// documentação oficial (exige login, ver aviso em ifood-client/index.ts no
// backend), usado só no detalhe da previsão de lucro.
export const IFOOD_ORDER_STATUS_LABELS: Record<string, string> = {
  PLACED: 'Pedido recebido',
  CONFIRMED: 'Confirmado',
  DISPATCHED: 'Saiu pra entrega',
  CONCLUDED: 'Concluído',
  CANCELLED: 'Cancelado',
};
