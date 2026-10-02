import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  getAdminMetrics,
  getAdminRewardClaims,
  getAdminSyncIssues,
  getAdminUsers,
  setAdminRewardClaimFulfilled,
  type AdminMetrics,
  type AdminRewardClaim,
  type AdminSyncIssue,
  type AdminUser,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

type Section = 'metrics' | 'users' | 'rewards' | 'sync';

const SECTIONS: [Section, string][] = [
  ['metrics', 'Métricas'],
  ['users', 'Usuários'],
  ['rewards', 'Resgates'],
  ['sync', 'Sync'],
];

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
      <Text className="text-sm text-lucrei-textMuted">{label}</Text>
      <Text className="text-sm font-semibold text-lucrei-text">{value}</Text>
    </View>
  );
}

// Rota solta (não aparece na barra de navegação - ver app-tabs.tsx) só pra
// quem o backend reconhece via ADMIN_EMAILS. O app nem tenta esconder isso
// com base em quem está logado - a segurança de verdade é a checagem no
// servidor; aqui só trata o 403 de forma amigável em vez de tela quebrada.
export default function AdminScreen() {
  const { state } = useAuth();
  const Colors = useColors();
  const token = state.status === 'authenticated' ? state.token : null;
  const [section, setSection] = useState<Section>('metrics');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [claims, setClaims] = useState<AdminRewardClaim[]>([]);
  const [issues, setIssues] = useState<AdminSyncIssue[]>([]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setForbidden(false);
    Promise.all([getAdminMetrics(token), getAdminUsers(token), getAdminRewardClaims(token), getAdminSyncIssues(token)])
      .then(([m, u, c, i]) => {
        setMetrics(m);
        setUsers(u);
        setClaims(c);
        setIssues(i);
      })
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function toggleFulfilled(claim: AdminRewardClaim) {
    if (!token) return;
    const next = !claim.fulfilledAt;
    const nowIso = new Date().toISOString();
    setClaims((prev) => prev.map((c) => (c.id === claim.id ? { ...c, fulfilledAt: next ? nowIso : null } : c)));
    try {
      await setAdminRewardClaimFulfilled(token, claim.id, next);
    } catch {
      setClaims((prev) => prev.map((c) => (c.id === claim.id ? claim : c)));
    }
  }

  if (!token) {
    return (
      <Screen>
        <Text className="text-sm text-lucrei-textMuted">Faça login pra continuar.</Text>
      </Screen>
    );
  }

  if (forbidden) {
    return (
      <Screen>
        <Text className="text-base font-semibold text-lucrei-text">Sem acesso</Text>
        <Text className="mt-2 text-sm text-lucrei-textMuted">Essa conta não tem permissão de admin.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Admin</Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {SECTIONS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setSection(key)}
            className="rounded-full px-3.5 py-1.5"
            style={{ backgroundColor: section === key ? Colors.gold : Colors.surface }}>
            <Text className="text-xs font-medium" style={{ color: section === key ? Colors.onGold : Colors.textMuted }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      ) : (
        <ScrollView className="mt-5" contentContainerClassName="gap-2.5 pb-10">
          {section === 'metrics' && metrics && (
            <>
              <MetricRow label="Total de contas" value={String(metrics.totalUsers)} />
              <MetricRow label="Assinaturas ativas" value={String(metrics.activeSubscriptions)} />
              <MetricRow label="MRR estimado" value={formatBRL(metrics.mrrEstimate)} />
              {metrics.usersByStatus.map((s) => (
                <MetricRow key={s.status} label={`Contas: ${s.status}`} value={String(s.count)} />
              ))}
              {metrics.shopsByProvider.map((s) => (
                <MetricRow key={s.provider} label={`Lojas: ${s.provider}`} value={String(s.count)} />
              ))}
            </>
          )}

          {section === 'users' &&
            (users.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhuma conta.</Text>
            ) : (
              users.map((u) => (
                <View key={u.id} className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
                  <Text className="text-sm font-medium text-lucrei-text">{u.email}</Text>
                  <Text className="mt-1 text-xs text-lucrei-textMuted">
                    {u.name ?? '(sem nome)'} · {u.subscriptionStatus} · {u.planName ?? 'sem plano'} · {u.shopsCount} loja(s)
                  </Text>
                  <Text className="mt-1 text-[11px] text-lucrei-textMuted">
                    entrou em {dateFormatter.format(new Date(u.createdAt))}
                  </Text>
                </View>
              ))
            ))}

          {section === 'rewards' &&
            (claims.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum resgate.</Text>
            ) : (
              claims.map((c) => (
                <View key={c.id} className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 text-sm font-medium text-lucrei-text">
                      {formatBRL(c.tierThreshold)} · {c.userEmail}
                    </Text>
                    <Pressable
                      onPress={() => toggleFulfilled(c)}
                      className="rounded-full px-2.5 py-1"
                      style={{ backgroundColor: c.fulfilledAt ? Colors.success : Colors.surfaceAlt }}>
                      <Text className="text-[11px] font-medium" style={{ color: c.fulfilledAt ? '#FFFFFF' : Colors.textMuted }}>
                        {c.fulfilledAt ? 'Enviado' : 'Pendente'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text className="mt-1 text-xs text-lucrei-textMuted">{c.fullName} · {c.phone ?? 'sem telefone'}</Text>
                  <Text className="mt-1 text-xs text-lucrei-textMuted">
                    {c.addressLine}, {c.city} - {c.state}, {c.zipCode}
                  </Text>
                </View>
              ))
            ))}

          {section === 'sync' &&
            (issues.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum problema de sincronização agora.</Text>
            ) : (
              issues.map((i) => (
                <View
                  key={i.shopId}
                  className="rounded-xl border p-3.5"
                  style={{ borderColor: Colors.danger, backgroundColor: Colors.surface }}>
                  <Text className="text-sm font-medium text-lucrei-text">
                    {i.shopName} ({i.provider === 'mercado_livre' ? 'ML' : 'Shopee'}) · {i.userEmail}
                  </Text>
                  <Text className="mt-1 text-xs text-lucrei-textMuted">
                    sync: {i.syncStatus ?? '—'}
                    {i.syncError ? ` (${i.syncError})` : ''}
                  </Text>
                  <Text className="mt-1 text-xs text-lucrei-textMuted">
                    backfill: {i.historyBackfillStatus ?? '—'}
                    {i.historyBackfillError ? ` (${i.historyBackfillError})` : ''}
                  </Text>
                </View>
              ))
            ))}
        </ScrollView>
      )}
    </Screen>
  );
}
