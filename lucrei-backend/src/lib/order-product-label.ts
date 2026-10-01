// Monta "2x Ração Golden 10kg + 1x Areia Sanitária" a partir dos itens do
// pedido. Compartilhado entre etiquetas e o detalhe da previsão de lucro.
export function formatOrderProductLabel(lineItems: Array<{ quantity: number; name: string }>): string | null {
  if (lineItems.length === 0) return null;
  const counted = new Map<string, number>();
  for (const li of lineItems) {
    counted.set(li.name, (counted.get(li.name) ?? 0) + li.quantity);
  }
  return [...counted.entries()].map(([name, qty]) => `${qty}x ${name}`).join(' + ');
}
