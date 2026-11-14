import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type DimensionValue,
} from 'react-native';

import { MarketplaceBadge } from '@/components/marketplace-badge';
import { getMarketplaceAvailability, type MarketplaceAvailability } from '@/lib/api';
import type { Marketplace } from '@/lib/marketplace';
import { useColors } from '@/lib/theme';


const OPTIONS: { key: Marketplace; name: string; subtitle: string }[] = [
  { key: 'shopee', name: 'Shopee', subtitle: 'Pedidos, taxas e frete automáticos' },
  { key: 'mercado_livre', name: 'Mercado Livre', subtitle: 'Vendas e tarifas em tempo real' },
  { key: 'ifood', name: 'iFood', subtitle: 'Vínculo por código no Portal do Parceiro' },
  { key: 'tiktok_shop', name: 'TikTok Shop', subtitle: 'Pedidos e repasses da sua loja' },
];

// Antes de o servidor responder (ou se a consulta falhar), só o TikTok Shop
// fica cinza - é o único que ainda depende de credencial que pode não estar
// configurada; os outros três já funcionam em produção.
const DEFAULT_AVAILABILITY: MarketplaceAvailability = {
  shopee: true,
  mercado_livre: true,
  ifood: true,
  tiktok_shop: false,
};

const MENU_GAP = 8;
const ESTIMATED_MENU_HEIGHT = 360;
const SCREEN_MARGIN = 16;

type Anchor = { left: number; width: number; top?: number; bottom?: number; above: boolean };

// Um botão só ("Conectar marketplace") no lugar dos quatro botões soltos -
// abre uma lista suspensa ancorada embaixo dele (ou em cima, se não couber).
// Fica num Modal transparente pra fechar ao tocar fora / Esc no web sem
// depender de onde o botão está dentro do ScrollView da tela.
export function ConnectMarketplaceMenu({
  token,
  connecting,
  width,
  onSelect,
}: {
  token: string;
  connecting: Marketplace | null;
  width: DimensionValue;
  onSelect: (marketplace: Marketplace) => void;
}) {
  const Colors = useColors();
  const window = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [progress] = useState(() => new Animated.Value(0));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [availability, setAvailability] = useState<MarketplaceAvailability>(DEFAULT_AVAILABILITY);
  const closingRef = useRef(false);

  function animateTo(value: 0 | 1, done?: () => void) {
    Animated.timing(progress, {
      toValue: value,
      duration: value === 1 ? 180 : 120,
      easing: value === 1 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => done?.());
  }

  function openMenu() {
    closingRef.current = false;
    getMarketplaceAvailability(token)
      .then(setAvailability)
      .catch(() => setAvailability(DEFAULT_AVAILABILITY));

    triggerRef.current?.measureInWindow((x, y, w, h) => {
      const menuWidth = Math.min(Math.max(w, 300), window.width - SCREEN_MARGIN * 2);
      const left = Math.min(
        Math.max(x + w / 2 - menuWidth / 2, SCREEN_MARGIN),
        window.width - menuWidth - SCREEN_MARGIN
      );
      const fitsBelow = y + h + MENU_GAP + ESTIMATED_MENU_HEIGHT <= window.height - SCREEN_MARGIN;
      setAnchor(
        fitsBelow
          ? { left, width: menuWidth, top: y + h + MENU_GAP, above: false }
          : { left, width: menuWidth, bottom: window.height - y + MENU_GAP, above: true }
      );
      progress.setValue(0);
      setOpen(true);
      animateTo(1);
    });
  }

  function closeMenu(after?: () => void) {
    animateTo(0, () => {
      setOpen(false);
      after?.();
    });
  }

  // Trava contra duplo clique: um segundo toque durante a animação de
  // fechar interrompia a primeira, e o callback do .start() roda mesmo
  // interrompido - abria duas sessões de conexão.
  function handleSelect(marketplace: Marketplace) {
    if (closingRef.current) return;
    closingRef.current = true;
    closeMenu(() => onSelect(marketplace));
  }

  const busy = connecting !== null;
  const chevronRotation = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={() => (open ? closeMenu() : openMenu())}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, busy }}
        className="flex-row items-center justify-center gap-2 self-center rounded-full bg-lucrei-gold px-6 py-4"
        style={({ pressed }) => ({ width, opacity: busy ? 0.7 : pressed ? 0.9 : 1 })}>
        {busy ? (
          <ActivityIndicator color={Colors.onGold} />
        ) : (
          <Ionicons name="storefront-outline" size={18} color={Colors.onGold} />
        )}
        <Text className="text-sm font-semibold text-lucrei-onGold" numberOfLines={1}>
          {busy ? 'Conectando...' : 'Conectar marketplace'}
        </Text>
        {!busy && (
          <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
            <Ionicons name="chevron-down" size={16} color={Colors.onGold} />
          </Animated.View>
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => closeMenu()}>
        {/* Fundo como irmão do card (não envolvendo ele): envolvido, o leitor
            de tela juntava tudo num elemento "Fechar menu" e não chegava nas
            opções. statusBarTranslucent: sem isso, no Android edge-to-edge o
            conteúdo do Modal começa abaixo da status bar e o menu aparecia
            deslocado em relação ao y medido por measureInWindow. */}
        <View className="flex-1">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => closeMenu()}
            accessibilityRole="button"
            accessibilityLabel="Fechar menu"
          />
          {anchor && (
            <Animated.View
              style={{
                position: 'absolute',
                left: anchor.left,
                width: anchor.width,
                top: anchor.top,
                bottom: anchor.bottom,
                opacity: progress,
                transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [anchor.above ? 6 : -6, 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                ],
              }}>
              {/* Pressable vazio só pra engolir o toque dentro do card - sem
                  isso, tocar no espaço entre as linhas fechava o menu. */}
              <Pressable
                accessible={false}
                className="rounded-3xl border border-lucrei-border bg-lucrei-surface p-2"
                style={{
                  shadowColor: '#000',
                  shadowOpacity: 0.18,
                  shadowRadius: 24,
                  shadowOffset: { width: 0, height: 12 },
                  elevation: 12,
                }}>
                <Text className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-lucrei-textMuted">
                  Onde você vende?
                </Text>
                {OPTIONS.map((option) => (
                  <MarketplaceRow
                    key={option.key}
                    option={option}
                    available={availability[option.key]}
                    onPress={() => handleSelect(option.key)}
                  />
                ))}
              </Pressable>
            </Animated.View>
          )}
        </View>
      </Modal>
    </>
  );
}

function MarketplaceRow({
  option,
  available,
  onPress,
}: {
  option: (typeof OPTIONS)[number];
  available: boolean;
  onPress: () => void;
}) {
  const Colors = useColors();
  const [hovered, setHovered] = useState(false);
  const active = available && hovered;

  return (
    <Pressable
      onPress={onPress}
      disabled={!available}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      accessibilityLabel={available ? `Conectar ${option.name}` : `${option.name} - em breve`}
      className={`mt-1 flex-row items-center gap-3 rounded-2xl px-3 py-3 ${active ? 'bg-lucrei-gold/10' : ''}`}
      style={({ pressed }) => ({
        opacity: available ? 1 : 0.45,
        backgroundColor: available && pressed ? 'rgba(212, 175, 55, 0.18)' : undefined,
        transform: [{ translateX: active ? 2 : 0 }, { scale: active ? 1.01 : 1 }],
        ...(Platform.OS === 'web' ? ({ transition: 'transform 140ms ease, background-color 140ms ease', cursor: available ? 'pointer' : 'not-allowed' } as object) : null),
      })}>
      <View
        className={`h-11 w-11 items-center justify-center rounded-2xl border ${active ? 'border-lucrei-gold/40' : 'border-lucrei-border'} bg-lucrei-surfaceAlt`}>
        <MarketplaceBadge provider={option.key} size={24} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-lucrei-text" numberOfLines={1}>
          {option.name}
        </Text>
        <Text className="mt-0.5 text-xs text-lucrei-textMuted" numberOfLines={1}>
          {option.subtitle}
        </Text>
      </View>
      {available ? (
        <Ionicons name="chevron-forward" size={16} color={active ? Colors.gold : Colors.textMuted} />
      ) : (
        <View className="rounded-full border border-lucrei-border bg-lucrei-surfaceAlt px-2.5 py-1">
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-lucrei-textMuted">Em breve</Text>
        </View>
      )}
    </Pressable>
  );
}
