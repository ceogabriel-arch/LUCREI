import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, connectFood99Shop, discoverFood99Shops, getFood99AuthorizeUrl } from '@/lib/api';
import { useModalPresentation } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

type DiscoveredShop = { shopId: string; shopName: string };

// Vínculo da 99Food em 2 passos, nenhum deles por redirecionamento de volta
// pro app (a 99Food não suporta isso, diferente de Shopee/ML): o lojista
// abre o site deles, autoriza a loja, e volta sozinho pro Lucrei - aqui ele
// escolhe a loja que acabou de autorizar pelo nome (mesma orientação que a
// própria 99Food dá pro fluxo de vínculo self-service).
export function Food99ConnectModal({
  token,
  onClose,
  onConnected,
}: {
  token: string;
  onClose: () => void;
  onConnected: (shopName: string) => void;
}) {
  const Colors = useColors();
  const modal = useModalPresentation();
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [step, setStep] = useState<'authorize' | 'pick'>('authorize');
  const [shops, setShops] = useState<DiscoveredShop[] | null>(null);
  const [loadingShops, setLoadingShops] = useState(false);
  const [connectingShopId, setConnectingShopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFood99AuthorizeUrl(token)
      .then((data) => setAuthorizeUrl(data.url))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o link de autorização.'))
      .finally(() => setLoadingUrl(false));
  }, [token]);

  const fetchShops = useCallback(() => {
    setLoadingShops(true);
    setError(null);
    discoverFood99Shops(token)
      .then((data) => setShops(data.shops))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Não foi possível buscar suas lojas autorizadas.'))
      .finally(() => setLoadingShops(false));
  }, [token]);

  function handleAlreadyAuthorized() {
    setStep('pick');
    fetchShops();
  }

  async function handlePick(shop: DiscoveredShop) {
    setConnectingShopId(shop.shopId);
    setError(null);
    try {
      const result = await connectFood99Shop(token, shop.shopId, shop.shopName);
      onConnected(result.shopName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar essa loja.');
    } finally {
      setConnectingShopId(null);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '90%', ...modal.panelWidthStyle }} className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">Conectar loja 99Food</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="p-6">
            {step === 'authorize' ? (
              <>
                <Text className="text-sm font-semibold text-lucrei-text">1. Autorize no site da 99Food</Text>
                <Text className="mt-1 text-sm text-lucrei-textMuted">
                  Você vai logar com a conta da sua loja e escolher qual loja autorizar pro Lucrei.
                </Text>

                {loadingUrl ? (
                  <View className="items-center py-6">
                    <ActivityIndicator color={Colors.gold} />
                  </View>
                ) : authorizeUrl ? (
                  <Pressable
                    onPress={() => Linking.openURL(authorizeUrl)}
                    className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-gold py-3.5">
                    <Ionicons name="open-outline" size={16} color={Colors.onGold} />
                    <Text className="text-sm font-semibold text-lucrei-onGold">Abrir site da 99Food</Text>
                  </Pressable>
                ) : null}

                <Text className="mt-6 text-sm font-semibold text-lucrei-text">2. Volte aqui depois de autorizar</Text>
                <Text className="mb-3 mt-1 text-sm text-lucrei-textMuted">
                  Depois de escolher e autorizar sua loja no site da 99Food, volte pro Lucrei e toque no botão abaixo.
                </Text>
                <Pressable
                  onPress={handleAlreadyAuthorized}
                  className="items-center rounded-xl border border-lucrei-border bg-lucrei-surface py-3.5">
                  <Text className="text-sm font-semibold text-lucrei-text">Já autorizei, buscar minha loja</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text className="text-sm font-semibold text-lucrei-text">Escolha a loja que você autorizou</Text>
                <Text className="mt-1 text-sm text-lucrei-textMuted">
                  Se a loja ainda não aparecer, aguarde alguns segundos e tente de novo.
                </Text>

                {loadingShops ? (
                  <View className="items-center py-6">
                    <ActivityIndicator color={Colors.gold} />
                  </View>
                ) : shops && shops.length > 0 ? (
                  <View className="mt-4 gap-2">
                    {shops.map((shop) => (
                      <Pressable
                        key={shop.shopId}
                        onPress={() => handlePick(shop)}
                        disabled={connectingShopId !== null}
                        className="flex-row items-center justify-between rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3.5"
                        style={{ opacity: connectingShopId !== null && connectingShopId !== shop.shopId ? 0.5 : 1 }}>
                        <Text className="flex-1 text-sm font-semibold text-lucrei-text" numberOfLines={1}>
                          {shop.shopName}
                        </Text>
                        {connectingShopId === shop.shopId ? (
                          <ActivityIndicator color={Colors.gold} />
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text className="mt-4 text-center text-sm text-lucrei-textMuted">
                    Nenhuma loja nova autorizada ainda.
                  </Text>
                )}

                <Pressable
                  onPress={fetchShops}
                  disabled={loadingShops}
                  className="mt-4 items-center rounded-xl border border-lucrei-border bg-lucrei-surface py-3.5"
                  style={{ opacity: loadingShops ? 0.6 : 1 }}>
                  <Text className="text-sm font-semibold text-lucrei-text">Buscar de novo</Text>
                </Pressable>
              </>
            )}

            {error ? <Text className="mt-4 text-center text-sm text-lucrei-danger">{error}</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
