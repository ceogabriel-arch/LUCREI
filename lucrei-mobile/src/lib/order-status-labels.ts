// Status de pedido da Shopee (os mesmos valores que vêm tanto no pedido
// sincronizado quanto no push de status usado pela previsão de lucro) -
// compartilhado entre Pedidos e o detalhe da previsão de lucro no Início.
export const ORDER_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Aguardando pagamento',
  READY_TO_SHIP: 'Pronto pra envio',
  PROCESSED: 'Em processamento',
  SHIPPED: 'Enviado',
  COMPLETED: 'Concluído',
  IN_CANCEL: 'Cancelando',
  CANCELLED: 'Cancelado',
  TO_RETURN: 'Em devolução',
};
