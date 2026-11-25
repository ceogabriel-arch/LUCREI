import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
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
import { getMarketplaceAvailability, type MarketplaceAvailability, type Shop } from '@/lib/api';
import type { Marketplace } from '@/lib/marketplace';
import { useColors } from '@/lib/theme';

const OPTIONS: { key: Marketplace; name: string }[] = [
  { key: 'shopee', name: 'Shopee' },
  { key: 'mercado_livre', name: 'Mercado Livre' },
  { key: 'ifood', name: 'iFood' },
  { key: 'tiktok_shop', name: 'TikTok Shop' },
  { key: 'food99', name: '99Food' },
];

// Antes de o servidor responder (ou se a consulta falhar), TikTok Shop e
// 99Food ficam cinza - são os que ainda dependem de credencial que pode não
// estar configurada; os outros três já funcionam em produção.
const DEFAULT_AVAILABILITY: MarketplaceAvailability = {
  shopee: true,
  mercado_livre: true,
  ifood: true,
  tiktok_shop: false,
  food99: false,
};

const SCREEN_MARGIN = 16;
const HUB_SIZE = 64;
const ORB_SIZE = 64;
// Espaço abaixo da órbita pro nome (e o selo "Em breve").
const LABEL_SPACE = 40;
const MAX_RADIUS = 125;
const MIN_RADIUS = 92;
const STAGGER_MS = 40;
const USE_NATIVE = Platform.OS !== 'web';

// Ângulos em graus, 0 = direita, negativo = pra cima. Gerados a partir da
// quantidade de opções (em vez de array fixo) pra não descompassar o número
// de ícones do número de ângulos sempre que um marketplace for adicionado -
// já aconteceu de esquecer de atualizar um array fixo desses.
function evenAngles(start: number, end: number, count: number): number[] {
  if (count <= 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}
// Começa em -90 - 180/N e dá uma volta completa (passo 360/N) - escolhido
// porque com N=4 (o total antes da 99Food) reproduz exatamente os ângulos
// fixos de antes, [-135,-45,45,135] (um "X"): a fórmula só generaliza o
// padrão que já existia, não muda o visual de quem já via 4 ícones.
const ANGLES_FULL = evenAngles(-90 - 180 / OPTIONS.length, -90 - 180 / OPTIONS.length + (360 * (OPTIONS.length - 1)) / OPTIONS.length, OPTIONS.length);
const ANGLES_UP = evenAngles(-165, -15, OPTIONS.length);
const ANGLES_DOWN = evenAngles(15, 165, OPTIONS.length);

type Layout = { cx: number; cy: number; radius: number; angles: number[] };

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Escolhe raio, arco e centro pra que hub + órbitas + nomes caibam na tela
// com 16px de margem: anel completo (4 diagonais) quando sobra espaço em cima
// e embaixo, só o arco de cima quando o botão está perto do rodapé, só o de
// baixo quando está perto do topo. O centro é "empurrado" pra dentro quando
// o botão fica muito encostado na borda.
function computeLayout(x: number, y: number, w: number, h: number, screenW: number, screenH: number): Layout {
  const triggerCx = x + w / 2;
  const triggerCy = y + h / 2;
  const half = ORB_SIZE / 2;
  const radius = Math.max(
    MIN_RADIUS,
    Math.min(MAX_RADIUS, (screenW - SCREEN_MARGIN * 2) / 2 - half - 8, (screenH - SCREEN_MARGIN * 2) / 2 - half - LABEL_SPACE)
  );

  const needUp = radius + half + SCREEN_MARGIN;
  const needDown = radius + half + LABEL_SPACE + SCREEN_MARGIN;
  const roomUp = triggerCy;
  const roomDown = screenH - triggerCy;

  let angles = ANGLES_FULL;
  if (roomDown < needDown && roomUp >= needUp) angles = ANGLES_UP;
  else if (roomUp < needUp && roomDown >= needDown) angles = ANGLES_DOWN;

  // Extensão real do conjunto a partir do centro, pra prender o centro na tela.
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const xs = angles.map((a) => Math.cos(rad(a)) * radius);
  const ys = angles.map((a) => Math.sin(rad(a)) * radius);
  const minX = Math.min(...xs, -HUB_SIZE / 2) - half - 16;
  const maxX = Math.max(...xs, HUB_SIZE / 2) + half + 16;
  const minY = Math.min(...ys, -HUB_SIZE / 2) - half;
  const maxY = Math.max(...ys, HUB_SIZE / 2) + half + LABEL_SPACE;

  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return {
    cx: clamp(triggerCx, SCREEN_MARGIN - minX, screenW - SCREEN_MARGIN - maxX),
    cy: clamp(triggerCy, SCREEN_MARGIN - minY, screenH - SCREEN_MARGIN - maxY),
    radius,
    angles,
  };
}

// Um botão só ("Conectar marketplace") no lugar dos quatro botões soltos -
// abre um menu radial: um "hub" dourado aparece sobre o botão e os
// marketplaces explodem em órbitas ao redor dele. Fica num Modal
// transparente pra fechar ao tocar fora / Esc no web sem depender de onde o
// botão está dentro do ScrollView da tela.
export function ConnectMarketplaceMenu({
  token,
  connecting,
  width,
  shops,
  integrationsLimit,
  onSelect,
}: {
  token: string;
  connecting: Marketplace | null;
  width: DimensionValue;
  // Pra mostrar "quantas lojas já conectadas / quantas o plano permite" em
  // cada marketplace - o limite é por marketplace, não no total (ver
  // checagem em shops/routes.ts, mercadolivre/routes.ts etc).
  shops: Shop[];
  integrationsLimit: number | null;
  onSelect: (marketplace: Marketplace) => void;
}) {
  const Colors = useColors();
  const window = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [hub] = useState(() => new Animated.Value(0));
  const [orbs] = useState(() => OPTIONS.map(() => new Animated.Value(0)));
  const [spin] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [availability, setAvailability] = useState<MarketplaceAvailability>(DEFAULT_AVAILABILITY);
  const closingRef = useRef(false);

  function startLoops() {
    spin.setValue(0);
    pulse.setValue(0);
    loopsRef.current = [
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: USE_NATIVE })),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: USE_NATIVE }),
          Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: USE_NATIVE }),
        ])
      ),
    ];
    loopsRef.current.forEach((loop) => loop.start());
  }

  function stopLoops() {
    loopsRef.current.forEach((loop) => loop.stop());
    loopsRef.current = [];
  }

  // Nada de animação contínua rodando depois que a tela sai.
  useEffect(() => stopLoops, []);

  function openMenu() {
    closingRef.current = false;
    getMarketplaceAvailability(token)
      .then(setAvailability)
      .catch(() => setAvailability(DEFAULT_AVAILABILITY));

    triggerRef.current?.measureInWindow((x, y, w, h) => {
      setLayout(computeLayout(x, y, w, h, window.width, window.height));
      hub.setValue(0);
      orbs.forEach((v) => v.setValue(0));
      setOpen(true);
      startLoops();
      Animated.parallel([
        Animated.spring(hub, { toValue: 1, friction: 6, tension: 120, useNativeDriver: USE_NATIVE }),
        Animated.stagger(
          STAGGER_MS,
          orbs.map((v) => Animated.spring(v, { toValue: 1, friction: 6, tension: 90, useNativeDriver: USE_NATIVE }))
        ),
      ]).start();
    });
  }

  function closeMenu(after?: () => void) {
    Animated.parallel([
      Animated.stagger(
        STAGGER_MS / 2,
        [...orbs].reverse().map((v) =>
          Animated.timing(v, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: USE_NATIVE })
        )
      ),
      Animated.timing(hub, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: USE_NATIVE }),
    ]).start(() => {
      stopLoops();
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
  const chevronRotation = hub.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

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
        {/* Fundo como irmão das órbitas (não envolvendo elas): envolvido, o
            leitor de tela juntava tudo num elemento "Fechar menu" e não
            chegava nas opções. statusBarTranslucent: sem isso, no Android
            edge-to-edge o conteúdo do Modal começa abaixo da status bar e o
            menu aparecia deslocado em relação ao y medido por measureInWindow. */}
        <View className="flex-1">
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0, 0, 0, 0.6)', opacity: hub },
              Platform.OS === 'web' ? ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as object) : null,
            ]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => closeMenu()}
              accessibilityRole="button"
              accessibilityLabel="Fechar menu"
            />
          </Animated.View>

          {layout && (
            <RadialRing
              layout={layout}
              hub={hub}
              orbs={orbs}
              spin={spin}
              pulse={pulse}
              availability={availability}
              shops={shops}
              integrationsLimit={integrationsLimit}
              onClose={() => closeMenu()}
              onSelect={handleSelect}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

function RadialRing({
  layout,
  hub,
  orbs,
  spin,
  pulse,
  availability,
  shops,
  integrationsLimit,
  onClose,
  onSelect,
}: {
  layout: Layout;
  hub: Animated.Value;
  orbs: Animated.Value[];
  spin: Animated.Value;
  pulse: Animated.Value;
  availability: MarketplaceAvailability;
  shops: Shop[];
  integrationsLimit: number | null;
  onClose: () => void;
  onSelect: (marketplace: Marketplace) => void;
}) {
  const Colors = useColors();
  const { cx, cy, radius, angles } = layout;
  const ringSize = radius * 2;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const hubScale = Animated.multiply(
    hub.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] })
  );
  const ringScale = hub.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const glow = hexToRgba(Colors.gold, 0.55);

  return (
    <>
      {/* Trilho do anel: um círculo fino fixo + um tracejado girando devagar
          por cima, que dá o "brilho" em movimento. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - radius,
          top: cy - radius,
          width: ringSize,
          height: ringSize,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: hexToRgba(Colors.gold, 0.25),
          opacity: hub,
          transform: [{ scale: ringScale }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - radius,
          top: cy - radius,
          width: ringSize,
          height: ringSize,
          borderRadius: radius,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: hexToRgba(Colors.gold, 0.7),
          opacity: hub,
          transform: [{ scale: ringScale }, { rotate }],
        }}
      />

      {OPTIONS.map((option, i) => {
        const rad = (angles[i] * Math.PI) / 180;
        const dx = Math.cos(rad) * radius;
        const dy = Math.sin(rad) * radius;
        const v = orbs[i];
        return (
          <Animated.View
            key={option.key}
            style={{
              position: 'absolute',
              left: cx - ORB_SIZE / 2 - 24,
              top: cy - ORB_SIZE / 2,
              width: ORB_SIZE + 48,
              alignItems: 'center',
              opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
              transform: [
                { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
                { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
              ],
            }}>
            <Orb
              option={option}
              available={availability[option.key]}
              connectedCount={shops.filter((s) => s.provider === option.key && s.status === 'active').length}
              integrationsLimit={integrationsLimit}
              glow={glow}
              onPress={() => onSelect(option.key)}
            />
          </Animated.View>
        );
      })}

      {/* Hub central: aparece exatamente sobre o botão, com um X que gira ao
          entrar - tocar nele fecha o menu. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: cx - HUB_SIZE / 2,
          top: cy - HUB_SIZE / 2,
          width: HUB_SIZE,
          height: HUB_SIZE,
          opacity: hub,
          transform: [{ scale: hubScale }],
        }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar menu de marketplaces"
          className="h-full w-full items-center justify-center rounded-full bg-lucrei-gold"
          style={{
            shadowColor: Colors.gold,
            shadowOpacity: 0.6,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 0 },
            elevation: 14,
            ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 6px ${hexToRgba(Colors.gold, 0.18)}, 0 0 32px ${glow}`, cursor: 'pointer' } as object) : null),
          }}>
          <Animated.View
            style={{ transform: [{ rotate: hub.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) }] }}>
            <Ionicons name="close" size={28} color={Colors.onGold} />
          </Animated.View>
        </Pressable>
      </Animated.View>
    </>
  );
}

function Orb({
  option,
  available,
  connectedCount,
  integrationsLimit,
  glow,
  onPress,
}: {
  option: (typeof OPTIONS)[number];
  available: boolean;
  connectedCount: number;
  integrationsLimit: number | null;
  glow: string;
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
      className="items-center"
      style={({ pressed }) => ({
        opacity: available ? 1 : 0.45,
        transform: [{ scale: active ? 1.12 : available && pressed ? 0.94 : 1 }],
        ...(Platform.OS === 'web'
          ? ({
              transition: 'transform 160ms ease',
              cursor: available ? 'pointer' : 'not-allowed',
              filter: available ? undefined : 'grayscale(1)',
            } as object)
          : null),
      })}>
      <View
        className="items-center justify-center rounded-full bg-lucrei-surface"
        style={{
          width: ORB_SIZE,
          height: ORB_SIZE,
          borderWidth: 2,
          borderColor: available ? Colors.gold : Colors.border,
          shadowColor: Colors.gold,
          shadowOpacity: active ? 0.7 : available ? 0.25 : 0,
          shadowRadius: active ? 20 : 10,
          shadowOffset: { width: 0, height: 0 },
          elevation: available ? 8 : 0,
          ...(Platform.OS === 'web'
            ? ({
                boxShadow: active
                  ? `0 0 0 4px ${hexToRgba(Colors.gold, 0.25)}, 0 0 28px ${glow}`
                  : available
                    ? `0 0 14px ${hexToRgba(Colors.gold, 0.22)}`
                    : 'none',
                transition: 'box-shadow 160ms ease',
              } as object)
            : null),
        }}>
        <MarketplaceBadge provider={option.key} size={30} />
        {available && (
          // Lojas conectadas / limite do plano pra ESTE marketplace - o
          // limite é por marketplace, não no total (ver integrationsLimit
          // em shops/routes.ts etc), então cada ícone mostra sua própria
          // conta. "∞" quando o plano não tem limite (integrationsLimit null).
          <View
            pointerEvents="none"
            className="absolute -right-1 -top-1 items-center justify-center rounded-full border"
            style={{
              minWidth: 22,
              height: 18,
              paddingHorizontal: 4,
              backgroundColor: connectedCount > 0 ? Colors.gold : Colors.surface,
              borderColor: Colors.gold,
            }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: connectedCount > 0 ? Colors.onGold : Colors.gold }}>
              {connectedCount}/{integrationsLimit ?? '∞'}
            </Text>
          </View>
        )}
      </View>
      <Text
        className="mt-1.5 text-center text-xs font-semibold"
        style={{ color: active ? Colors.gold : '#FFFFFF' }}
        numberOfLines={1}>
        {option.name}
      </Text>
      {!available && (
        <View className="mt-1 rounded-full border border-white/20 bg-black/40 px-2 py-0.5">
          <Text className="text-[9px] font-semibold uppercase tracking-wide text-white/80">Em breve</Text>
        </View>
      )}
    </Pressable>
  );
}
