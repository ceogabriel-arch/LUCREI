import type { Plan, User } from '@prisma/client';

import { getSalesLimitStatus } from './sales-usage';
import { getSubscriptionAccessStatus } from './subscription-access';

// Conta sem acesso (pagamento atrasado além da carência, limite de vendas
// estourado além da carência, ou teste grátis vencido) não devia continuar
// recebendo notificação de lucro - a pessoa nem consegue ver os dados reais
// (ficam borrados no app), a notificação só confunde. O teste grátis é o
// caso mais sutil: subscriptionStatus só vira 'past_due' de fato na próxima
// vez que o app abre a tela de fatura (ver ensureCurrentPixCharge) - sem
// checar trialEndsAt aqui direto, quem nunca abre aquela tela depois do
// teste acabar continuaria "trialing" pro resto da vida e recebendo
// notificação. Compartilhado entre pedido-concluído e meta-batida - mesma
// regra de acesso nos dois.
export async function isAccountNotifiable(owner: User & { plan: Plan | null }): Promise<boolean> {
  if (owner.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt <= new Date()) {
    return false;
  }

  const subscriptionAccess = await getSubscriptionAccessStatus(owner);
  if (subscriptionAccess.blocked) return false;

  const salesLimit = await getSalesLimitStatus(owner);
  if (salesLimit.blocked) return false;

  return true;
}
