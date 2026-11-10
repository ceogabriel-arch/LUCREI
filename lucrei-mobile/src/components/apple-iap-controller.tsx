import { useCallback, useEffect, useRef } from 'react';
import { ErrorCode, useIAP, type Purchase } from 'expo-iap';

import { PLAN_KEY_TO_APPLE_SKU } from '@/lib/apple-iap';
import { ApiError, getAppleAppAccountToken, type Plan } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';

export type AppleIapHandle = {
  purchase: (plan: Plan) => void;
  restore: () => void;
};

type AppleIapControllerProps = {
  handleRef: React.RefObject<AppleIapHandle | null>;
  onPurchasingChange: (planKey: string | null) => void;
  onRestoringChange: (restoring: boolean) => void;
};

/**
 * Só é montado no iOS (ver planos.tsx) - useIAP tenta conectar numa loja
 * nativa que não existe no build web/Android desse app (só vendemos os
 * planos via Apple IAP no iOS por enquanto), então nem pode ser chamado fora
 * dele. Não renderiza nada - só expõe purchase/restore pro componente pai
 * via ref, já que o botão que dispara isso vive dentro do PlanCard.
 */
export function AppleIapController({ handleRef, onPurchasingChange, onRestoringChange }: AppleIapControllerProps) {
  const { state, completeAppleIapPurchase } = useAuth();
  // availablePurchases (estado do hook) fica desatualizado dentro do fecho
  // de restore() criado antes do restorePurchases() resolver - a ref sempre
  // reflete o valor mais recente assim que o efeito abaixo roda.
  const availablePurchasesRef = useRef<Purchase[]>([]);

  const { requestPurchase, restorePurchases, finishTransaction, availablePurchases } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      const jws = purchase.purchaseToken;
      if (!jws) {
        onPurchasingChange(null);
        showAlert('Erro', 'Compra concluída, mas sem dados pra confirmar com o servidor. Tente "Restaurar compras".');
        return;
      }
      const result = await completeAppleIapPurchase(jws);
      onPurchasingChange(null);
      if (result.ok) {
        // Só finaliza a transação (tira da fila do StoreKit) depois do
        // backend confirmar - se a confirmação falhar, deixa pendente de
        // propósito: o StoreKit reapresenta ela no próximo lançamento do
        // app, dando outra chance de confirmar em vez de perder a compra.
        await finishTransaction({ purchase, isConsumable: false });
        showAlert('Pagamento confirmado! 🎉', 'Sua assinatura Lucrei está ativa.');
      } else {
        showAlert('Não foi possível confirmar', `${result.message} Tente "Restaurar compras" ou fale com o suporte.`);
      }
    },
    onPurchaseError: (error) => {
      onPurchasingChange(null);
      if (error.code === ErrorCode.UserCancelled) return;
      showAlert('Não foi possível concluir a compra', error.message);
    },
  });

  useEffect(() => {
    availablePurchasesRef.current = availablePurchases;
  }, [availablePurchases]);

  const purchase = useCallback(
    (plan: Plan) => {
      if (state.status !== 'authenticated') return;
      const sku = PLAN_KEY_TO_APPLE_SKU[plan.key];
      if (!sku) {
        showAlert('Indisponível', 'Esse plano ainda não está disponível pela App Store.');
        return;
      }
      onPurchasingChange(plan.key);
      (async () => {
        try {
          if (state.status !== 'authenticated') return;
          const { token: appAccountToken } = await getAppleAppAccountToken(state.token);
          await requestPurchase({ request: { apple: { sku, appAccountToken } }, type: 'subs' });
          // O resultado real chega por onPurchaseSuccess/onPurchaseError
          // acima, não pelo retorno dessa chamada.
        } catch (err) {
          onPurchasingChange(null);
          showAlert('Erro', err instanceof ApiError ? err.message : 'Não foi possível iniciar a compra.');
        }
      })();
    },
    [state, requestPurchase, onPurchasingChange]
  );

  const restore = useCallback(() => {
    onRestoringChange(true);
    (async () => {
      try {
        await restorePurchases();
        const purchases = availablePurchasesRef.current.filter((p) => p.purchaseToken);
        if (purchases.length === 0) {
          showAlert('Nenhuma compra encontrada', 'Não encontramos nenhuma assinatura ativa vinculada a esse Apple ID.');
          return;
        }
        // Normalmente só existe uma assinatura ativa por vez - pega a mais
        // recente entre as restauradas por garantia.
        const latest = [...purchases].sort((a, b) => b.transactionDate - a.transactionDate)[0];
        const result = await completeAppleIapPurchase(latest.purchaseToken!);
        showAlert(
          result.ok ? 'Compra restaurada' : 'Não foi possível restaurar',
          result.ok ? 'Sua assinatura foi restaurada com sucesso.' : result.message
        );
      } catch (err) {
        showAlert('Erro', err instanceof ApiError ? err.message : 'Não foi possível restaurar suas compras.');
      } finally {
        onRestoringChange(false);
      }
    })();
  }, [restorePurchases, completeAppleIapPurchase, onRestoringChange]);

  useEffect(() => {
    handleRef.current = { purchase, restore };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, purchase, restore]);

  return null;
}
