import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { formatBRL } from '@/lib/format';

type Tier = { threshold: number; reward: string; note?: string };

const TIERS: Tier[] = [
  { threshold: 1_000, reward: 'Mentoria de alavancagem', note: 'ou 3 meses de conta na Lucrei' },
  { threshold: 10_000, reward: 'Pulseira Lucrei' },
  { threshold: 50_000, reward: 'Caneca + boné Lucrei' },
  { threshold: 100_000, reward: 'Placa Lucrei' },
  { threshold: 500_000, reward: 'Placa + podcast Lucrei + garrafa' },
  { threshold: 1_000_000, reward: 'Placa + viagem + moletom Lucrei' },
];

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

function isUnlocked(index: number, totalProfit: number, monthsSinceSignup: number) {
  if (index === 0 && monthsSinceSignup >= 3) return true;
  return totalProfit >= TIERS[index].threshold;
}

function TierListItem({
  tier,
  unlocked,
  isNext,
}: {
  tier: Tier;
  unlocked: boolean;
  isNext: boolean;
}) {
  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl border p-3.5"
      style={{
        borderColor: isNext ? Colors.gold : Colors.border,
        backgroundColor: unlocked ? Colors.surfaceAlt : Colors.surface,
      }}>
      <View
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: unlocked ? Colors.gold : Colors.surfaceAlt }}>
        <Ionicons
          name={unlocked ? 'checkmark' : 'lock-closed'}
          size={16}
          color={unlocked ? Colors.bg : Colors.textMuted}
        />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-lucrei-text">{formatBRL(tier.threshold)} de lucro</Text>
        <Text className="mt-0.5 text-xs text-lucrei-textMuted">{tier.reward}</Text>
        {tier.note && <Text className="mt-0.5 text-xs text-lucrei-textMuted">{tier.note}</Text>}
      </View>
    </View>
  );
}

export function AchievementsCard({
  totalProfit,
  accountCreatedAt,
}: {
  totalProfit: number;
  accountCreatedAt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const monthsSinceSignup = (Date.now() - new Date(accountCreatedAt).getTime()) / MS_PER_MONTH;

  const unlockedFlags = TIERS.map((_, i) => isUnlocked(i, totalProfit, monthsSinceSignup));
  const currentIndex = unlockedFlags.lastIndexOf(true);
  const nextIndex = currentIndex + 1;
  const nextTier = nextIndex < TIERS.length ? TIERS[nextIndex] : null;

  const progress = nextTier ? Math.min(totalProfit / nextTier.threshold, 1) : 1;

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Ionicons name="trophy" size={16} color={Colors.gold} />
            <Text className="text-sm font-medium text-lucrei-text">Conquistas Lucrei</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </View>

        {currentIndex >= 0 && (
          <Text className="mt-2 text-xs text-lucrei-textMuted">
            Já garantido: <Text style={{ color: Colors.gold }}>{TIERS[currentIndex].reward}</Text>
          </Text>
        )}

        {nextTier ? (
          <>
            <View className="mt-3 h-2 overflow-hidden rounded-full bg-lucrei-surfaceAlt">
              <View
                style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: Colors.gold, borderRadius: 999 }}
              />
            </View>
            <Text className="mt-2 text-xs text-lucrei-textMuted">
              Faltam {formatBRL(Math.max(nextTier.threshold - totalProfit, 0))} de lucro pra: {nextTier.reward}
            </Text>
          </>
        ) : (
          <Text className="mt-3 text-xs text-lucrei-textMuted">Você desbloqueou todas as recompensas!</Text>
        )}
      </Pressable>

      <Modal visible={expanded} animationType="slide" transparent onRequestClose={() => setExpanded(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%' }} className="rounded-t-3xl bg-lucrei-bg">
            <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
              <Text className="text-base font-semibold text-lucrei-text">Conquistas Lucrei</Text>
              <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-2.5 p-5">
              <Text className="mb-1 text-xs text-lucrei-textMuted">
                Lucro acumulado até agora: {formatBRL(totalProfit)}
              </Text>
              {TIERS.map((tier, i) => (
                <TierListItem key={tier.threshold} tier={tier} unlocked={unlockedFlags[i]} isNext={i === nextIndex} />
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
