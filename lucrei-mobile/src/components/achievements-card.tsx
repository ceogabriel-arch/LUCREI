import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatBRL } from '@/lib/format';
import { webCapWidth } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

type Tier = { threshold: number; reward: string; icon: IconName; note?: string };

const TIERS: Tier[] = [
  { threshold: 1_000, reward: 'Mentoria de alavancagem', icon: 'school', note: 'ou 3 meses de conta na Lucrei' },
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

function TierListItem({ tier, unlocked, isNext }: { tier: Tier; unlocked: boolean; isNext: boolean }) {
  const Colors = useColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl border p-3.5"
      style={{
        borderColor: isNext ? Colors.gold : Colors.border,
        backgroundColor: unlocked ? Colors.surfaceAlt : Colors.surface,
      }}>
      <TierBadge tier={tier} unlocked={unlocked} isNext={isNext} size={38} />
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
  const Colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const monthsSinceSignup = (Date.now() - new Date(accountCreatedAt).getTime()) / MS_PER_MONTH;

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
        <View className="flex-1 justify-end bg-black/60">
          <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%', ...webCapWidth() }} className="rounded-t-3xl bg-lucrei-bg">
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
