// Tabela de taxas da Shopee (CNPJ, vigente desde 01/03/2026). Cada faixa vale
// de `minPrice` até o começo da próxima. O subsídio Pix não entra nas contas:
// ela é bancada pela Shopee pro comprador, não sai do vendedor - `label` e
// `pixSubsidy` existem só pra tabela de referência na tela.
type ShopeeFeeBand = {
  minPrice: number;
  label: string;
  commissionRate: number;
  fixedFee: number;
  pixSubsidy: string;
};

export const SHOPEE_FEE_BANDS: ShopeeFeeBand[] = [
  { minPrice: 0, label: 'Até R$ 79,99', commissionRate: 0.2, fixedFee: 4, pixSubsidy: '—' },
  { minPrice: 80, label: 'R$ 80 a R$ 99,99', commissionRate: 0.14, fixedFee: 16, pixSubsidy: '5%' },
  { minPrice: 100, label: 'R$ 100 a R$ 199,99', commissionRate: 0.14, fixedFee: 20, pixSubsidy: '5%' },
  { minPrice: 200, label: 'R$ 200 a R$ 499,99', commissionRate: 0.14, fixedFee: 26, pixSubsidy: '5%' },
  { minPrice: 500, label: 'Acima de R$ 500', commissionRate: 0.14, fixedFee: 26, pixSubsidy: '8%' },
];

export type ShopeeBreakdown = {
  price: number;
  commissionRate: number;
  commission: number;
  fixedFee: number;
  totalFees: number;
  net: number;
};

function bandIndexFor(price: number): number {
  let index = 0;
  for (let i = 0; i < SHOPEE_FEE_BANDS.length; i++) {
    if (price >= SHOPEE_FEE_BANDS[i].minPrice) index = i;
  }
  return index;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Quanto o vendedor recebe (líquido) quando o anúncio está em `price`.
export function breakdownForPrice(price: number): ShopeeBreakdown {
  const band = SHOPEE_FEE_BANDS[bandIndexFor(price)];
  const commission = roundCents(price * band.commissionRate);
  const totalFees = roundCents(commission + band.fixedFee);
  return {
    price: roundCents(price),
    commissionRate: band.commissionRate,
    commission,
    fixedFee: band.fixedFee,
    totalFees,
    net: roundCents(price - totalFees),
  };
}

// Menor preço de anúncio que deixa o vendedor com pelo menos `targetNet`.
// Em cada faixa, resolve P - (comissão·P + taxa fixa) = líquido isolando P e
// só aceita a solução que cai dentro da própria faixa. Pega o menor candidato
// válido porque o líquido não é monotônico na virada de faixa (ex: a comissão
// cai de 20% pra 14% em R$ 80, então um preço um pouco maior pode dar mais).
export function suggestedPriceForNet(targetNet: number): number | null {
  if (!(targetNet > 0)) return null;

  let best: number | null = null;
  for (let i = 0; i < SHOPEE_FEE_BANDS.length; i++) {
    const band = SHOPEE_FEE_BANDS[i];
    const upper = SHOPEE_FEE_BANDS[i + 1]?.minPrice ?? Infinity;
    const solved = (targetNet + band.fixedFee) / (1 - band.commissionRate);
    if (solved >= upper) continue;
    const candidate = Math.max(solved, band.minPrice);
    if (best === null || candidate < best) best = candidate;
  }
  if (best === null) return null;

  // Arredonda pra cima no centavo pra nunca ficar abaixo do líquido pedido.
  return Math.ceil(best * 100 - 1e-9) / 100;
}

// "Custo + margem %": o líquido desejado é o custo mais a margem sobre ele.
export function targetNetFromCost(cost: number, marginPercent: number): number {
  return roundCents(cost * (1 + marginPercent / 100));
}
