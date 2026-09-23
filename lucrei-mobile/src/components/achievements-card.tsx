import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { claimReward, getClaimedRewardTiers, ApiError } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { TextField } from '@/components/text-field';
import { formatBRL } from '@/lib/format';
import { useModalPresentation } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

type Tier = { threshold: number; reward: string; icon: IconName; note?: string };

const TIERS: Tier[] = [
  {
    threshold: 1_000,
    reward: 'Mentoria de alavancagem',
    icon: 'school',
    note: 'ou por já ser cliente Lucrei há 3 meses',
  },
  { threshold: 10_000, reward: 'Pulseira Lucrei', icon: 'gift' },
  { threshold: 50_000, reward: 'Caneca + boné Lucrei', icon: 'cafe' },
  { threshold: 100_000, reward: 'Placa Lucrei', icon: 'ribbon' },
  { threshold: 500_000, reward: 'Placa + podcast Lucrei + garrafa', icon: 'mic' },
  { threshold: 1_000_000, reward: 'Placa + viagem + moletom Lucrei', icon: 'airplane' },
];

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

function isUnlocked(index: number, totalProfit: number, monthsSinceSignup: number) {
  if (index === 0 && monthsSinceSignup >= 3) return true;
  return totalProfit >= TIERS[index].threshold;
}

function TierBadge({
  tier,
  unlocked,
  isNext,
  size = 30,
}: {
  tier: Tier;
  unlocked: boolean;
  isNext: boolean;
  size?: number;
}) {
  const Colors = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: unlocked ? Colors.gold : Colors.surfaceAlt,
        borderWidth: isNext ? 2 : 0,
        borderColor: Colors.gold,
      }}>
      <Ionicons
        name={unlocked ? tier.icon : 'lock-closed'}
        size={size * 0.48}
        color={unlocked ? Colors.onGold : Colors.textMuted}
      />
      {unlocked && (
        <View
          className="absolute -bottom-0.5 -right-0.5 items-center justify-center rounded-full"
          style={{ width: 14, height: 14, backgroundColor: Colors.success }}>
          <Ionicons name="checkmark" size={9} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

function TierListItem({
  tier,
  unlocked,
  isNext,
  claimed,
  onClaim,
}: {
  tier: Tier;
  unlocked: boolean;
  isNext: boolean;
  claimed: boolean;
  onClaim: () => void;
}) {
  const Colors = useColors();
  return (
    <View
      className="rounded-2xl border p-3.5"
      style={{
        borderColor: isNext ? Colors.gold : Colors.border,
        backgroundColor: unlocked ? Colors.surfaceAlt : Colors.surface,
      }}>
      <View className="flex-row items-center gap-3">
        <TierBadge tier={tier} unlocked={unlocked} isNext={isNext} size={38} />
        <View className="flex-1">
          <Text className="text-sm font-medium text-lucrei-text">{formatBRL(tier.threshold)} de lucro</Text>
          <Text className="mt-0.5 text-xs text-lucrei-textMuted">{tier.reward}</Text>
          {tier.note && <Text className="mt-0.5 text-xs text-lucrei-textMuted">{tier.note}</Text>}
        </View>
      </View>
      {unlocked && (
        <Pressable
          onPress={claimed ? undefined : onClaim}
          disabled={claimed}
          className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl py-2"
          style={{ backgroundColor: claimed ? 'transparent' : Colors.gold }}>
          {claimed ? (
            <>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              <Text className="text-xs font-medium" style={{ color: Colors.success }}>
                Resgate enviado
              </Text>
            </>
          ) : (
            <Text className="text-xs font-semibold text-lucrei-onGold">Resgatar recompensa</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

type ClaimFormState = {
  fullName: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
};

const EMPTY_CLAIM_FORM: ClaimFormState = {
  fullName: '',
  phone: '',
  addressLine: '',
  city: '',
  state: '',
  zipCode: '',
};

function ClaimFormModal({
  tier,
  onClose,
  onSubmitted,
}: {
  tier: Tier | null;
  onClose: () => void;
  onSubmitted: (threshold: number) => void;
}) {
  const { state: authState } = useAuth();
  const Colors = useColors();
  const modal = useModalPresentation();
  const [form, setForm] = useState<ClaimFormState>(EMPTY_CLAIM_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tier) setForm(EMPTY_CLAIM_FORM);
  }, [tier]);

  const canSubmit =
    form.fullName.trim().length > 0 &&
    form.addressLine.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.state.trim().length > 0 &&
    form.zipCode.trim().length > 0;

  async function handleSubmit() {
    if (!tier || authState.status !== 'authenticated' || !canSubmit) return;
    setSubmitting(true);
    try {
      await claimReward(authState.token, {
        tierThreshold: tier.threshold,
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        zipCode: form.zipCode.trim(),
      });
      onSubmitted(tier.threshold);
      onClose();
      showAlert('Resgate enviado!', 'Recebemos seu pedido. Nosso time entra em contato pra combinar o envio.');
    } catch (err) {
      showAlert('Não foi possível enviar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={tier != null} animationType="slide" transparent onRequestClose={onClose}>
      <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
        <SafeAreaView
          edges={['bottom']}
          style={{ maxHeight: '90%', ...modal.panelWidthStyle }}
          className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <View>
              <Text className="text-base font-semibold text-lucrei-text">Resgatar recompensa</Text>
              {tier && <Text className="text-xs text-lucrei-textMuted">{tier.reward}</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="p-5">
            <Text className="mb-4 text-xs leading-5 text-lucrei-textMuted">
              Preenche o endereço pra onde a gente manda sua recompensa. Nosso time entra em contato pra combinar
              os detalhes do envio.
            </Text>
            <TextField label="Nome completo" value={form.fullName} onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))} />
            <TextField
              label="Telefone (opcional)"
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              keyboardType="phone-pad"
            />
            <TextField
              label="Endereço (rua, número, complemento)"
              value={form.addressLine}
              onChangeText={(v) => setForm((f) => ({ ...f, addressLine: v }))}
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField label="Cidade" value={form.city} onChangeText={(v) => setForm((f) => ({ ...f, city: v }))} />
              </View>
              <View style={{ width: 90 }}>
                <TextField
                  label="UF"
                  value={form.state}
                  onChangeText={(v) => setForm((f) => ({ ...f, state: v.toUpperCase().slice(0, 2) }))}
                  autoCapitalize="characters"
                  maxLength={2}
                />
              </View>
            </View>
            <TextField
              label="CEP"
              value={form.zipCode}
              onChangeText={(v) => setForm((f) => ({ ...f, zipCode: v }))}
              keyboardType="number-pad"
            />
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              className="mt-2 items-center rounded-xl bg-lucrei-gold py-3.5"
              style={{ opacity: !canSubmit || submitting ? 0.5 : 1 }}>
              {submitting ? (
                <ActivityIndicator color={Colors.onGold} />
              ) : (
                <Text className="text-sm font-semibold text-lucrei-onGold">Enviar resgate</Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function AchievementsCard({
  totalProfit,
  accountCreatedAt,
}: {
  totalProfit: number;
  accountCreatedAt: string;
}) {
  const { state: authState } = useAuth();
  const Colors = useColors();
  const modal = useModalPresentation();
  const [expanded, setExpanded] = useState(false);
  const [claimedTiers, setClaimedTiers] = useState<number[]>([]);
  const [claimingTier, setClaimingTier] = useState<Tier | null>(null);
  const monthsSinceSignup = (Date.now() - new Date(accountCreatedAt).getTime()) / MS_PER_MONTH;
  // Token em vez do objeto "authState" inteiro: refreshUser() troca "state"
  // por um objeto novo a cada chamada (mesmo com os mesmos dados) - depender
  // dele aqui refazia essa busca de novo toda vez que a tela Início ganhava
  // foco, mesmo sem o login ter mudado.
  const token = authState.status === 'authenticated' ? authState.token : null;

  useEffect(() => {
    if (!token) return;
    getClaimedRewardTiers(token)
      .then((r) => setClaimedTiers(r.claimedTiers))
      .catch(() => {});
  }, [token]);

  const unlockedFlags = TIERS.map((_, i) => isUnlocked(i, totalProfit, monthsSinceSignup));
  const currentIndex = unlockedFlags.lastIndexOf(true);
  const nextIndex = currentIndex + 1;
  const nextTier = nextIndex < TIERS.length ? TIERS[nextIndex] : null;

  const prevThreshold = currentIndex >= 0 ? TIERS[currentIndex].threshold : 0;
  const progress = nextTier
    ? Math.min(Math.max(totalProfit - prevThreshold, 0) / (nextTier.threshold - prevThreshold), 1)
    : 1;

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        className="mt-4 rounded-3xl border border-lucrei-border bg-lucrei-surface">
        <View className="p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: Colors.gold }}>
                <Ionicons name="trophy" size={14} color={Colors.onGold} />
              </View>
              <Text className="text-sm font-semibold text-lucrei-text">Conquistas Lucrei</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </View>

          <View className="mt-4 flex-row items-center justify-between">
            {TIERS.map((tier, i) => (
              <TierBadge key={tier.threshold} tier={tier} unlocked={unlockedFlags[i]} isNext={i === nextIndex} />
            ))}
          </View>

          {nextTier ? (
            <>
              <View className="mt-4 flex-row items-center gap-2">
                <Ionicons name={nextTier.icon} size={14} color={Colors.gold} />
                <Text className="flex-1 text-sm font-medium text-lucrei-text" numberOfLines={1}>
                  {nextTier.reward}
                </Text>
              </View>
              <View className="mt-2 h-2.5 overflow-hidden rounded-full bg-lucrei-bg">
                <LinearGradient
                  colors={[Colors.goldDim, Colors.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 999 }}
                />
              </View>
              <Text className="mt-2 text-xs text-lucrei-textMuted">
                Faltam <Text style={{ color: Colors.gold, fontWeight: '600' }}>{formatBRL(Math.max(nextTier.threshold - totalProfit, 0))}</Text> de lucro
              </Text>
            </>
          ) : (
            <Text className="mt-4 text-sm font-medium" style={{ color: Colors.gold }}>
              Você desbloqueou todas as recompensas!
            </Text>
          )}
        </View>
      </Pressable>

      <Modal visible={expanded} animationType="slide" transparent onRequestClose={() => setExpanded(false)}>
        <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
          <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%', ...modal.panelWidthStyle }} className={`${modal.panelClassName} bg-lucrei-bg`}>
            <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
              <Text className="text-base font-semibold text-lucrei-text">Conquistas Lucrei</Text>
              <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-2.5 p-5">
              <Text className="mb-1 text-xs text-lucrei-textMuted">
                Lucro acumulado até agora: <Text style={{ color: Colors.gold }}>{formatBRL(totalProfit)}</Text>
              </Text>
              <View className="mb-1 flex-row items-start gap-2 rounded-xl p-3" style={{ backgroundColor: Colors.surfaceAlt }}>
                <Ionicons name="information-circle" size={16} color={Colors.textMuted} />
                <Text className="flex-1 text-xs leading-5 text-lucrei-textMuted">
                  Só contam pedidos feitos depois que você conectou a loja no Lucrei, e só depois que o pedido fica
                  "Concluído" na Shopee (é quando o lucro fica confirmado de verdade).
                </Text>
              </View>
              <View className="mb-1 flex-row items-start gap-2 rounded-xl p-3" style={{ backgroundColor: Colors.surfaceAlt }}>
                <Ionicons name="information-circle" size={16} color={Colors.textMuted} />
                <Text className="flex-1 text-xs leading-5 text-lucrei-textMuted">
                  Se a sincronização travar por limite do plano, seu lucro para de contar pras conquistas depois de
                  7 dias, até você fazer upgrade.
                </Text>
              </View>
              {TIERS.map((tier, i) => (
                <TierListItem
                  key={tier.threshold}
                  tier={tier}
                  unlocked={unlockedFlags[i]}
                  isNext={i === nextIndex}
                  claimed={claimedTiers.includes(tier.threshold)}
                  onClaim={() => setClaimingTier(tier)}
                />
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      <ClaimFormModal
        tier={claimingTier}
        onClose={() => setClaimingTier(null)}
        onSubmitted={(threshold) => setClaimedTiers((prev) => [...prev, threshold])}
      />
    </>
  );
}
