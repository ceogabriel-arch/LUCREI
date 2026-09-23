import { useAuth } from '@/lib/auth';

export type SubscriptionAccess = {
  // true assim que o pagamento atrasa - já é o suficiente pra esconder
  // faturamento/lucro em toda tela, mesmo dentro da carência.
  isPastDue: boolean;
  // true só depois dos 7 dias de carência - backend já recusa sincronizar
  // pedido novo nesse ponto (ver checkSubscriptionAccessBlock).
  blocked: boolean;
  graceDaysLeft: number | null;
};

export function useSubscriptionAccess(): SubscriptionAccess {
  const { state } = useAuth();
  if (state.status !== 'authenticated') {
    return { isPastDue: false, blocked: false, graceDaysLeft: null };
  }
  const { user } = state;
  return {
    isPastDue: user.subscriptionStatus === 'past_due',
    blocked: user.subscriptionBlocked,
    graceDaysLeft: user.subscriptionGraceDaysLeft,
  };
}
