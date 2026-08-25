import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { ApiError, getShopeeProducts, getShops, saveProductCost, type Shop, type ShopeeProduct } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const PERIODS = ['Hoje', '7 dias', '30 dias'] as const;
const PERIOD_TO_API: Record<(typeof PERIODS)[number], 'today' | '7d' | '30d'> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
};

const PROFIT_LABEL: Record<(typeof PERIODS)[number], string> = {
  Hoje: 'hoje',
  '7 dias': '7d',
  '30 dias': '30d',
};

const NO_SALES_LABEL: Record<(typeof PERIODS)[number], string> = {
  Hoje: 'Sem vendas hoje',
  '7 dias': 'Sem vendas nos últimos 7 dias',
  '30 dias': 'Sem vendas nos últimos 30 dias',
};

function ProductRow({
  product,
  token,
  shopId,
  period,
  onSaved,
}: {
  product: ShopeeProduct;
  token: string;
  shopId: string;
  period: (typeof PERIODS)[number];
  onSaved: (shopeeItemId: string, costPrice: number) => void;
}) {
  const [cost, setCost] = useState(product.costPrice != null ? String(product.costPrice) : '');
  const [saving, setSaving] = useState(false);

  const dirty = cost !== (product.costPrice != null ? String(product.costPrice) : '');

  async function handleSave() {
    const parsed = Number(cost.replace(',', '.'));
    if (!cost || Number.isNaN(parsed) || parsed < 0) {
      Alert.alert('Custo inválido', 'Digite um valor numérico válido.');
      return;
    }
    setSaving(true);
    try {
      await saveProductCost(token, shopId, product.shopeeItemId, product.name, parsed);
      onSaved(product.shopeeItemId, parsed);
    } catch (err) {
      Alert.alert('Erro', err instanceof ApiError ? err.message : 'Não foi possível salvar o custo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-3">
      {product.image ? (
        <Image source={{ uri: product.image }} style={{ width: 48, height: 48, borderRadius: 10 }} />
      ) : (
        <View className="h-12 w-12 items-center justify-center rounded-[10px] bg-lucrei-surfaceAlt" />
      )}

      <View className="flex-1">
        <Text className="text-sm font-medium text-lucrei-text" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="mt-0.5 text-xs text-lucrei-textMuted">
          {product.price != null ? `Preço: ${formatBRL(product.price)}` : 'Sem preço informado'}
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: product.profit != null ? Colors.success : Colors.textMuted }}>
          {product.profit != null
            ? `Lucro (${PROFIT_LABEL[period]}): ${formatBRL(product.profit)}`
            : product.orders > 0
              ? 'Vendeu, mas sem custo pra calcular lucro'
              : NO_SALES_LABEL[period]}
        </Text>
      </View>

      <View className="flex-row items-center gap-2">
        <TextInput
          value={cost}
          onChangeText={setCost}
          placeholder="Custo"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          className="w-20 rounded-xl border border-lucrei-border bg-lucrei-bg px-2.5 py-2 text-sm text-lucrei-text"
        />
        <Pressable
          onPress={handleSave}
          disabled={saving || !dirty}
          className="h-9 w-9 items-center justify-center rounded-xl bg-lucrei-gold"
          style={{ opacity: saving || !dirty ? 0.4 : 1 }}>
          {saving ? (
            <ActivityIndicator size="small" color={Colors.bg} />
          ) : (
            <Text className="text-base font-bold text-lucrei-bg">✓</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function ProdutosScreen() {
  const { state } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<ShopeeProduct[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 dias');

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const load = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const { shops } = await getShops(state.token);
      if (shops.length === 0) {
        setLoadState('no-shop');
        return;
      }
      setShop(shops[0]);
      const { products } = await getShopeeProducts(state.token, shops[0].id, PERIOD_TO_API[period]);
      setProducts(products);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [state, period]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handleSaved(shopeeItemId: string, costPrice: number) {
    setProducts((prev) => prev.map((p) => (p.shopeeItemId === shopeeItemId ? { ...p, costPrice } : p)));
  }

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Produtos</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Informe o custo de cada produto pra calcularmos seu lucro real.
      </Text>

      <View className="mt-5 flex-row self-start rounded-full bg-lucrei-surface p-1">
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className="rounded-full px-3.5 py-1.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-xs font-medium" style={{ color: active ? Colors.bg : Colors.textMuted }}>
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loadState === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {loadState === 'no-shop' && (
        <Text className="mt-8 text-sm text-lucrei-textMuted">
          Conecte uma loja Shopee na tela Início pra ver seus produtos aqui.
        </Text>
      )}

      {loadState === 'error' && (
        <View className="mt-8 items-center gap-3">
          <Text className="text-sm text-lucrei-textMuted">Não foi possível carregar seus produtos.</Text>
          <Pressable onPress={load} className="rounded-xl bg-lucrei-surface px-4 py-2">
            <Text className="text-sm text-lucrei-gold">Tentar de novo</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'ready' && shop && (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar produto pelo nome..."
            placeholderTextColor={Colors.textMuted}
            className="mt-4 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
          />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="mt-4 gap-3 pb-8">
            {products.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum produto ativo encontrado na sua loja.</Text>
            ) : filteredProducts.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum produto encontrado pra "{search}".</Text>
            ) : (
              filteredProducts.map((product) => (
                <ProductRow
                  key={product.shopeeItemId}
                  product={product}
                  token={state.status === 'authenticated' ? state.token : ''}
                  shopId={shop.id}
                  period={period}
                  onSaved={handleSaved}
                />
              ))
            )}
          </ScrollView>
        </>
      )}
    </Screen>
  );
}
