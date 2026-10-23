import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import {
  ApiError,
  createAdminAnnouncement,
  deleteAdminAnnouncement,
  getAdminAnnouncements,
  getAdminMetrics,
  getAdminRewardClaims,
  getAdminSyncIssues,
  getAdminUsers,
  setAdminRewardClaimFulfilled,
  updateAdminAnnouncement,
  type AdminMetrics,
  type AdminRewardClaim,
  type AdminSyncIssue,
  type AdminUser,
  type Announcement,
  type AnnouncementInput,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { webCapWidth } from '@/lib/responsive';
import { useHideTabBarWhile } from '@/lib/tab-bar-visibility';
import { useColors } from '@/lib/theme';

type Section = 'metrics' | 'users' | 'rewards' | 'sync' | 'announcements';

const SECTIONS: [Section, string][] = [
  ['metrics', 'Métricas'],
  ['users', 'Usuários'],
  ['rewards', 'Resgates'],
  ['sync', 'Sync'],
  ['announcements', 'Novidades'],
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

// Mesmo form serve pra criar e editar - "editing" presente muda o texto do
// botão e reseta os campos quando o alvo muda (ex: trocar de "Editar" num
// card pra outro sem fechar o form antes).
function AnnouncementForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: Announcement | null;
  onSubmit: (input: AnnouncementInput) => Promise<void>;
  onCancel: () => void;
}) {
  const Colors = useColors();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? '');
  const [linkUrl, setLinkUrl] = useState(editing?.linkUrl ?? '');
  const [position, setPosition] = useState(String(editing?.position ?? 0));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTitle(editing?.title ?? '');
    setBody(editing?.body ?? '');
    setImageUrl(editing?.imageUrl ?? '');
    setLinkUrl(editing?.linkUrl ?? '');
    setPosition(String(editing?.position ?? 0));
  }, [editing]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || null,
        linkUrl: linkUrl.trim() || null,
        position: Number(position) || 0,
      });
      if (!editing) {
        setTitle('');
        setBody('');
        setImageUrl('');
        setLinkUrl('');
        setPosition('0');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
      <Text className="mb-3 text-sm font-semibold text-lucrei-text">
        {editing ? 'Editar aviso' : 'Novo aviso'}
      </Text>
      <TextField label="Título" value={title} onChangeText={setTitle} compact />
      <TextField label="Texto" value={body} onChangeText={setBody} multiline numberOfLines={3} compact />
      <TextField label="Imagem (URL, opcional)" value={imageUrl} onChangeText={setImageUrl} compact />
      <TextField label="Link (URL, opcional)" value={linkUrl} onChangeText={setLinkUrl} compact />
      <TextField label="Posição" value={position} onChangeText={setPosition} keyboardType="numeric" compact />
      <View className="mt-1 flex-row gap-2">
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex-1 items-center rounded-xl bg-lucrei-gold py-2.5"
          style={{ opacity: !canSubmit || submitting ? 0.6 : 1 }}>
          {submitting ? (
            <ActivityIndicator color={Colors.onGold} />
          ) : (
            <Text className="text-sm font-semibold text-lucrei-onGold">{editing ? 'Salvar' : 'Adicionar'}</Text>
          )}
        </Pressable>
        {editing && (
          <Pressable onPress={onCancel} className="items-center justify-center rounded-xl border border-lucrei-border px-4">
            <Text className="text-sm text-lucrei-textMuted">Cancelar</Text>
          </Pressable>
        )}
      </View>
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
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

  useHideTabBarWhile(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setForbidden(false);
    Promise.all([
      getAdminMetrics(token),
      getAdminUsers(token),
      getAdminRewardClaims(token),
      getAdminSyncIssues(token),
      getAdminAnnouncements(token),
    ])
      .then(([m, u, c, i, a]) => {
        setMetrics(m);
        setUsers(u);
        setClaims(c);
        setIssues(i);
        setAnnouncements(a);
      })
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [token]);

  function reportAnnouncementError(err: unknown) {
    showAlert('Não deu certo', err instanceof ApiError ? err.message : 'Algo deu errado. Tente novamente.');
  }

  async function handleCreateAnnouncement(input: AnnouncementInput) {
    if (!token) return;
    try {
      const created = await createAdminAnnouncement(token, input);
      setAnnouncements((prev) => [...prev, created].sort((a, b) => a.position - b.position));
    } catch (err) {
      reportAnnouncementError(err);
    }
  }

  async function handleUpdateAnnouncement(id: string, input: Partial<AnnouncementInput>) {
    if (!token) return;
    try {
      const updated = await updateAdminAnnouncement(token, id, input);
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? updated : a)).sort((a, b) => a.position - b.position));
      setEditingAnnouncement(null);
    } catch (err) {
      reportAnnouncementError(err);
    }
  }

  async function handleToggleAnnouncementActive(announcement: Announcement) {
    if (!token) return;
    const next = !announcement.active;
    setAnnouncements((prev) => prev.map((a) => (a.id === announcement.id ? { ...a, active: next } : a)));
    try {
      await updateAdminAnnouncement(token, announcement.id, { active: next });
    } catch (err) {
      setAnnouncements((prev) => prev.map((a) => (a.id === announcement.id ? announcement : a)));
      reportAnnouncementError(err);
    }
  }

  async function handleDeleteAnnouncement(id: string) {
    if (!token) return;
    const prev = announcements;
    setAnnouncements((p) => p.filter((a) => a.id !== id));
    try {
      await deleteAdminAnnouncement(token, id);
    } catch (err) {
      setAnnouncements(prev);
      reportAnnouncementError(err);
    }
  }

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
        <ScrollView className="mt-5" contentContainerClassName="gap-2.5 pb-10" contentContainerStyle={webCapWidth()}>
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

          {section === 'announcements' && (
            <>
              <AnnouncementForm
                editing={editingAnnouncement}
                onCancel={() => setEditingAnnouncement(null)}
                onSubmit={(input) =>
                  editingAnnouncement
                    ? handleUpdateAnnouncement(editingAnnouncement.id, input)
                    : handleCreateAnnouncement(input)
                }
              />
              {announcements.length === 0 ? (
                <Text className="text-sm text-lucrei-textMuted">Nenhum aviso cadastrado.</Text>
              ) : (
                announcements.map((a) => (
                  <View key={a.id} className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="flex-1 text-sm font-medium text-lucrei-text">
                        {a.position} · {a.title}
                      </Text>
                      <Pressable
                        onPress={() => handleToggleAnnouncementActive(a)}
                        className="rounded-full px-2.5 py-1"
                        style={{ backgroundColor: a.active ? Colors.success : Colors.surfaceAlt }}>
                        <Text className="text-[11px] font-medium" style={{ color: a.active ? '#FFFFFF' : Colors.textMuted }}>
                          {a.active ? 'Ativo' : 'Inativo'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text className="mt-1 text-xs text-lucrei-textMuted">{a.body}</Text>
                    <View className="mt-2.5 flex-row gap-2">
                      <Pressable onPress={() => setEditingAnnouncement(a)} hitSlop={6}>
                        <Text className="text-xs font-medium text-lucrei-gold">Editar</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDeleteAnnouncement(a.id)} hitSlop={6}>
                        <Text className="text-xs font-medium" style={{ color: Colors.danger }}>
                          Excluir
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
