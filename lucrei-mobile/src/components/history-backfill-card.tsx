import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ApiError, getSyncHistoryStatus, startSyncHistory } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useColors } from '@/lib/theme';

// Botão + acompanhamento de progresso do backfill de histórico (varre até 1
// ano pra trás, em blocos de 15 dias - limite da própria API da Shopee).
// Extraído do card de Relatórios pra poder aparecer também na Início
// (reportado ao vivo: a pessoa não achava esse botão, achando que os
// pedidos antigos simplesmente não apareciam no Lucrei).
export function HistoryBackfillCard({
  token,
  shopId,
  onSynced,
  prominent = false,
}: {
  token: string;
  shopId: string;
  // Chamado quando o backfill termina com sucesso, pra tela dona recarregar
  // os próprios dados (ex: o resumo do período em Relatórios).
  onSynced?: () => void;
  // Versão maior/chamativa pra Início - Relatórios continua com o link
  // discreto de sempre, já dentro de um card de relatório mais denso.
  prominent?: boolean;
}) {
  const Colors = useColors();
  const [backfilling, setBackfilling] = useState(false);
  const [backfillSynced, setBackfillSynced] = useState(0);
  const [backfillProgress, setBackfillProgress] = useState({ done: 0, total: 0 });

  const pollBackfillUntilDone = useCallback(async () => {
    setBackfilling(true);
    // O backfill roda solto no servidor por minutos - uma queda de internet
    // passageira no meio do polling (comum em rede de celular/wifi instável)
    // não pode derrubar o acompanhamento inteiro, já que o trabalho continua
    // rodando do outro lado independente da conexão do navegador. Só desiste
    // depois de várias falhas seguidas (~1min sem conseguir nem consultar).
    const MAX_CONSECUTIVE_FAILURES = 15;
    let consecutiveFailures = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 4000));
        let status;
        try {
          status = await getSyncHistoryStatus(token, shopId);
        } catch (err) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            showAlert(
              'Não foi possível acompanhar a sincronização',
              err instanceof ApiError ? err.message : 'Verifique sua internet e tente de novo.'
            );
            break;
          }
          continue;
        }
        consecutiveFailures = 0;
        setBackfillSynced(status.ordersSynced);
        setBackfillProgress({ done: status.windowsDone, total: status.windowsTotal });
        if (status.status === 'done') {
          const base =
            status.ordersSynced === 0
              ? 'Nenhum pedido novo encontrado no último ano.'
              : `${status.ordersSynced} pedido(s) do último ano foram trazidos pro Lucrei.`;
          showAlert('Histórico sincronizado', status.error ? `${base}\n\n${status.error}` : base);
          onSynced?.();
          break;
        }
        if (status.status === 'error') {
          showAlert('Não foi possível sincronizar o histórico', status.error ?? 'Tenta de novo em instantes.');
          break;
        }
      }
    } finally {
      setBackfilling(false);
    }
  }, [token, shopId, onSynced]);

  // Se a tela recarregar (ou a pessoa voltar pra essa tela) no meio de um
  // backfill que já estava rodando, volta a acompanhar em vez de deixar o
  // botão parado sem refletir o que já está acontecendo no servidor.
  useEffect(() => {
    getSyncHistoryStatus(token, shopId)
      .then((status) => {
        if (status.status === 'running') {
          setBackfillSynced(status.ordersSynced);
          setBackfillProgress({ done: status.windowsDone, total: status.windowsTotal });
          pollBackfillUntilDone();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  async function handleBackfill() {
    // Trava o botão JÁ AQUI, antes do await - senão sobra uma janela (a
    // duração da própria chamada de rede) em que o clique ainda não voltou
    // e o botão continua parecendo destravado, dando pra clicar de novo.
    setBackfilling(true);
    let status;
    try {
      status = await startSyncHistory(token, shopId);
    } catch (err) {
      setBackfilling(false);
      showAlert('Não foi possível sincronizar o histórico', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
      return;
    }
    setBackfillSynced(status.ordersSynced);
    setBackfillProgress({ done: status.windowsDone, total: status.windowsTotal });
    pollBackfillUntilDone();
  }

  if (backfilling) {
    return (
      <View
        className={prominent ? 'rounded-2xl border p-4' : 'mt-2 px-1 py-2'}
        style={prominent ? { borderColor: Colors.gold, backgroundColor: Colors.surfaceAlt } : undefined}>
        <View className="flex-row items-center justify-between">
          <Text className={prominent ? 'text-sm font-medium text-lucrei-text' : 'text-xs text-lucrei-textMuted'}>
            Buscando histórico na Shopee...
          </Text>
          <Text className="text-xs font-medium text-lucrei-text">
            {backfillProgress.total > 0 ? `${Math.round((backfillProgress.done / backfillProgress.total) * 100)}%` : ''}
          </Text>
        </View>
        <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-lucrei-surfaceAlt">
          <View
            style={{
              width: `${backfillProgress.total > 0 ? (backfillProgress.done / backfillProgress.total) * 100 : 0}%`,
              backgroundColor: Colors.gold,
            }}
            className="h-full rounded-full"
          />
        </View>
        <Text className="mt-1.5 text-xs text-lucrei-textMuted">
          {backfillSynced} {backfillSynced === 1 ? 'pedido encontrado' : 'pedidos encontrados'} até agora
        </Text>
        <Text className="mt-2 text-xs text-lucrei-textMuted">
          Pode levar bastante tempo em lojas com muitas vendas — pode sair dessa tela e voltar depois, o progresso
          continua no servidor.
        </Text>
      </View>
    );
  }

  if (prominent) {
    return (
      <Pressable
        onPress={handleBackfill}
        className="flex-row items-center gap-3 rounded-2xl border p-4"
        style={{ borderColor: Colors.gold, backgroundColor: Colors.surfaceAlt }}>
        <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: Colors.gold }}>
          <Ionicons name="time-outline" size={18} color={Colors.onGold} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-lucrei-text">Puxar pedidos antigos da Shopee</Text>
          <Text className="mt-0.5 text-xs leading-4 text-lucrei-textMuted">
            Conectar a loja só traz pedido novo daqui pra frente. Toque aqui pra buscar o último ano de vendas de
            uma vez.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </Pressable>
    );
  }

  return (
    <View className="mt-2">
      <Pressable onPress={handleBackfill} className="flex-row items-center justify-center gap-2 rounded-xl px-4 py-3">
        <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
        <Text className="text-xs text-lucrei-textMuted">Sincronizar histórico completo (último ano)</Text>
      </Pressable>
      <Text className="mt-1 text-center text-xs text-lucrei-textMuted">
        Busca pedido por pedido na Shopee - em lojas com muitas vendas pode demorar vários minutos.
      </Text>
    </View>
  );
}
