import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import {
  ApiError,
  getOrphanProducts,
  getShopeeProducts,
  saveProductCost,
  saveProductCosts,
  type OrphanProduct,
  type ProductCostInput,
  type ShopeeProduct,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, type PeriodLabel, usePeriod } from '@/lib/period';
import { useSelectedShop } from '@/lib/selected-shop';
import { useColors } from '@/lib/theme';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const PROFIT_LABEL: Record<PeriodLabel, string> = {
  Hoje: 'hoje',
  '7 dias': '7d',
  '30 dias': '30d',
};

const NO_SALES_LABEL: Record<PeriodLabel, string> = {
  Hoje: 'Sem vendas hoje',
  '7 dias': 'Sem vendas nos últimos 7 dias',
  '30 dias': 'Sem vendas nos últimos 30 dias',
};

// Vale sugerir o atalho de seleção em massa só quando tem gente o
// suficiente sem custo pra editar um por um ser realmente tedioso.
const MISSING_COST_NUDGE_THRESHOLD = 3;

function originalCostText(product: ShopeeProduct) {
  return product.costPrice != null ? String(product.costPrice) : '';
}

const ProductRow = memo(function ProductRow({
  product,
  value,
  dirty,
  selected,
  disabled,
  onChangeCost,
  onToggleSelect,
  period,
}: {
  product: ShopeeProduct;
  value: string;
  dirty: boolean;
  selected: boolean;
  disabled: boolean;
  onChangeCost: (shopeeItemId: string, text: string) => void;
  onToggleSelect: (shopeeItemId: string) => void;
  period: PeriodLabel;
}) {
  const Colors = useColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl border bg-lucrei-surface p-3"
      style={{ borderColor: dirty ? Colors.gold : Colors.border, opacity: disabled ? 0.5 : 1 }}>
      <Pressable onPress={() => onToggleSelect(product.shopeeItemId)} disabled={disabled} hitSlop={8}>
        <Ionicons
          name={selected ? 'checkbox' : 'square-outline'}
          size={20}
          color={selected ? Colors.gold : Colors.textMuted}
        />
      </Pressable>

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
        <Text
          className="mt-0.5 text-xs"
          style={{
            color:
              product.profit == null
                ? Colors.textMuted
                : product.profit >= 0
                  ? Colors.success
                  : Colors.danger,
          }}>
          {product.profit != null
            ? `${product.profit >= 0 ? 'Lucro' : 'Prejuízo'} (${PROFIT_LABEL[period]}): ${formatBRL(product.profit)}`
            : product.orders > 0
              ? 'Vendeu, mas sem custo pra calcular lucro'
              : NO_SALES_LABEL[period]}
        </Text>
      </View>

      <View className="items-end gap-1">
        <Text className="text-[11px] text-lucrei-textMuted">Custo (R$)</Text>
        <TextInput
          value={value}
          onChangeText={(text) => onChangeCost(product.shopeeItemId, text)}
          editable={!disabled}
          placeholder="0,00"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          className="w-24 rounded-xl border bg-lucrei-bg px-2.5 py-2 text-right text-base text-lucrei-text"
          style={{ borderColor: dirty ? Colors.gold : Colors.border }}
        />
      </View>
    </View>
  );
});

function OrphanProductRow({
  orphan,
  value,
  nameValue,
  onChangeCost,
  onChangeName,
  onSave,
  saving,
}: {
  orphan: OrphanProduct;
  value: string;
  nameValue: string;
  onChangeCost: (text: string) => void;
  onChangeName: (text: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const Colors = useColors();
  const canSave = nameValue.trim().length > 0 && value.trim().length > 0;
  return (
    <View className="gap-2 rounded-2xl border border-lucrei-border bg-lucrei-surface p-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          {orphan.name ? (
            <Text className="text-sm font-medium text-lucrei-text" numberOfLines={1}>
              {orphan.name}
            </Text>
          ) : (
            <TextInput
              value={nameValue}
              onChangeText={onChangeName}
              placeholder="Nome do produto (não veio da Shopee)"
              placeholderTextColor={Colors.textMuted}
              className="rounded-xl border border-lucrei-border bg-lucrei-bg px-3 py-2 text-sm text-lucrei-text"
            />
          )}
          <Text className="mt-1 text-xs text-lucrei-textMuted">
            {orphan.ordersAffected} {orphan.ordersAffected === 1 ? 'pedido afetado' : 'pedidos afetados'} · ID{' '}
            {orphan.shopeeItemId}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={value}
          onChangeText={onChangeCost}
          placeholder="Custo (R$)"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-bg px-3 py-2 text-sm text-lucrei-text"
        />
        <Pressable
          onPress={onSave}
          disabled={!canSave || saving}
          className="rounded-xl bg-lucrei-gold px-4 py-2.5"
          style={{ opacity: !canSave || saving ? 0.4 : 1 }}>
          {saving ? (
            <ActivityIndicator size="small" color={Colors.onGold} />
          ) : (
            <Text className="text-xs font-semibold text-lucrei-onGold">Salvar</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// Produtos que saíram do catálogo da Shopee depois de já terem sido
// vendidos - a busca normal de Produtos só traz o catálogo atual, então
// esses itens nunca apareciam pra cadastrar custo, ficando "sem custo" pra
// sempre nos relatórios sem nenhum jeito de corrigir.
function OrphanProductsSection({ token, shopId }: { token: string; shopId: string }) {
  const Colors = useColors();
  const [orphans, setOrphans] = useState<OrphanProduct[] | null>(null);
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { orphans } = await getOrphanProducts(token, shopId);
      setOrphans(orphans);
    } catch {
      setOrphans([]);
    }
  }, [token, shopId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSave(orphan: OrphanProduct) {
    const name = (orphan.name ?? nameEdits[orphan.shopeeItemId] ?? '').trim();
    const parsed = Number((costEdits[orphan.shopeeItemId] ?? '').replace(',', '.'));
    if (!name || Number.isNaN(parsed) || parsed < 0) return;

    setSavingId(orphan.shopeeItemId);
    try {
      await saveProductCost(token, shopId, orphan.shopeeItemId, name, parsed);
      setOrphans((prev) => prev?.filter((o) => o.shopeeItemId !== orphan.shopeeItemId) ?? null);
    } catch (err) {
      showAlert('Erro', err instanceof ApiError ? err.message : 'Não foi possível salvar o custo.');
    } finally {
      setSavingId(null);
    }
  }

  if (orphans === null) {
    return (
      <View className="mt-6 items-center">
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }

  if (orphans.length === 0) {
    return (
      <Text className="mt-6 text-sm text-lucrei-textMuted">
        Nenhum produto sem cadastro por aqui — todos os itens vendidos batem com algum produto do catálogo.
      </Text>
    );
  }

  return (
    <>
      <Text className="mt-4 text-sm text-lucrei-textMuted">
        Esses produtos foram vendidos mas não existem mais no catálogo da Shopee (provavelmente excluídos) — por
        isso não aparecem na aba Catálogo. Cadastre o custo aqui pra eles entrarem no seu lucro.
      </Text>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="mt-3 gap-3 pb-4">
        {orphans.map((orphan) => (
          <OrphanProductRow
            key={orphan.shopeeItemId}
            orphan={orphan}
            value={costEdits[orphan.shopeeItemId] ?? ''}
            nameValue={nameEdits[orphan.shopeeItemId] ?? ''}
            onChangeCost={(text) => setCostEdits((prev) => ({ ...prev, [orphan.shopeeItemId]: text }))}
            onChangeName={(text) => setNameEdits((prev) => ({ ...prev, [orphan.shopeeItemId]: text }))}
            onSave={() => handleSave(orphan)}
            saving={savingId === orphan.shopeeItemId}
          />
        ))}
      </ScrollView>
    </>
  );
}

export default function ProdutosScreen() {
  const { state } = useAuth();
  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados), o que fazia
  // "load" ser recriado e a lista recarregar de novo sem necessidade.
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  const { selectedShop, loaded: shopsLoaded } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [products, setProducts] = useState<ShopeeProduct[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCost, setBulkCost] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'catalog' | 'orphans'>('catalog');

  const filteredProducts = useMemo(
    () =>
      products
        .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products, search]
  );

  const allFilteredSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => selected.has(p.shopeeItemId));

  const missingCostProducts = products.filter((p) => p.costPrice == null);

  const pendingChanges = useMemo(
    () =>
      products
        .map((product) => {
          const text = edits[product.shopeeItemId];
          if (text === undefined || text === originalCostText(product)) return null;
          return { product, text };
        })
        .filter((entry): entry is { product: ShopeeProduct; text: string } => entry !== null),
    [products, edits]
  );

  const load = useCallback(
    async (force = false) => {
      if (!token || !shopsLoaded) return;
      if (!selectedShop) {
        setLoadState('no-shop');
        return;
      }
      setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
      try {
        const { products } = await getShopeeProducts(token, selectedShop.id, PERIOD_TO_API[period], force);
        setProducts(products);
        setEdits({});
        setSelected(new Set());
        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    },
    [token, shopsLoaded, selectedShop, period]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    // force: true - "puxar pra atualizar" deve trazer dado fresco da Shopee,
    // ignorando o cache de catálogo (que existe só pra evitar refazer a
    // cadeia de chamadas à Shopee toda vez que a tela ganha foco de novo).
    await load(true);
    setRefreshing(false);
  }

  function handleSelectMissingCost() {
    setSelected(new Set(missingCostProducts.map((p) => p.shopeeItemId)));
  }

  // Precisa ser estável (useCallback) - senão o React.memo do ProductRow não
  // adianta nada, já que a prop onChangeCost/onToggleSelect mudaria de
  // referência a cada tecla digitada em QUALQUER linha, forçando a lista
  // inteira a re-renderizar de novo mesmo assim.
  const handleChangeCost = useCallback((shopeeItemId: string, text: string) => {
    setEdits((prev) => ({ ...prev, [shopeeItemId]: text }));
  }, []);

  const handleToggleSelect = useCallback((shopeeItemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shopeeItemId)) next.delete(shopeeItemId);
      else next.add(shopeeItemId);
      return next;
    });
  }, []);

  function handleToggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of filteredProducts) next.delete(p.shopeeItemId);
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...filteredProducts.map((p) => p.shopeeItemId)]));
    }
  }

  function applyBulkCostToSelected(parsed: number) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = String(parsed);
      return next;
    });
    setSelected(new Set());
    setBulkCost('');
  }

  function handleApplyBulkCost() {
    if (selected.size === 0) return;
    const parsed = Number(bulkCost.replace(',', '.'));
    if (!bulkCost.trim() || Number.isNaN(parsed) || parsed < 0) {
      showAlert('Custo inválido', 'Digite um valor numérico válido pra aplicar aos produtos selecionados.');
      return;
    }

    const selectedProducts = products.filter((p) => selected.has(p.shopeeItemId));
    const aboveSalePrice = selectedProducts.filter((p) => p.price != null && parsed > p.price);

    if (aboveSalePrice.length > 0) {
      showAlert(
        'Custo maior que o preço de venda',
        aboveSalePrice.length === 1
          ? `${formatBRL(parsed)} é maior que o preço de venda de "${aboveSalePrice[0].name}" (${formatBRL(aboveSalePrice[0].price!)}). Isso dá prejuízo nesse item. Aplicar assim mesmo?`
          : `${formatBRL(parsed)} é maior que o preço de venda de ${aboveSalePrice.length} produtos selecionados. Isso dá prejuízo nesses itens. Aplicar assim mesmo?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Aplicar assim mesmo', style: 'destructive', onPress: () => applyBulkCostToSelected(parsed) },
        ]
      );
      return;
    }

    applyBulkCostToSelected(parsed);
  }

  async function handleSaveAll() {
    if (pendingChanges.length === 0 || state.status !== 'authenticated' || !selectedShop) return;

    const items: ProductCostInput[] = [];
    const invalidNames: string[] = [];
    for (const { product, text } of pendingChanges) {
      const parsed = Number(text.replace(',', '.'));
      if (!text.trim() || Number.isNaN(parsed) || parsed < 0) {
        invalidNames.push(product.name);
        continue;
      }
      items.push({ shopeeItemId: product.shopeeItemId, name: product.name, costPrice: parsed });
    }

    if (invalidNames.length > 0) {
      showAlert(
        'Custo inválido',
        `Corrija o custo de: ${invalidNames.slice(0, 3).join(', ')}${invalidNames.length > 3 ? '...' : ''}`
      );
      return;
    }

    setSaving(true);
    try {
      await saveProductCosts(state.token, selectedShop.id, items);
      const itemByShopeeId = new Map(items.map((i) => [i.shopeeItemId, i]));
      setProducts((prev) =>
        prev.map((p) => {
          const item = itemByShopeeId.get(p.shopeeItemId);
          return item ? { ...p, costPrice: item.costPrice } : p;
        })
      );
      setEdits((prev) => {
        const next = { ...prev };
        for (const item of items) delete next[item.shopeeItemId];
        return next;
      });
    } catch (err) {
      showAlert('Erro', err instanceof ApiError ? err.message : 'Não foi possível salvar os custos.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Produtos</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Informe o custo de cada produto e salve tudo de uma vez pra calcularmos seu lucro real.
      </Text>

      <View className="mt-5 flex-row self-start rounded-full bg-lucrei-surface p-1">
        <Pressable
          onPress={() => setViewMode('catalog')}
          className="rounded-full px-3.5 py-1.5"
          style={{ backgroundColor: viewMode === 'catalog' ? Colors.gold : 'transparent' }}>
          <Text
            className="text-xs font-medium"
            style={{ color: viewMode === 'catalog' ? Colors.onGold : Colors.textMuted }}>
            Catálogo
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode('orphans')}
          className="rounded-full px-3.5 py-1.5"
          style={{ backgroundColor: viewMode === 'orphans' ? Colors.gold : 'transparent' }}>
          <Text
            className="text-xs font-medium"
            style={{ color: viewMode === 'orphans' ? Colors.onGold : Colors.textMuted }}>
            Sem cadastro
          </Text>
        </Pressable>
      </View>

      {viewMode === 'orphans' && token && selectedShop && (
        <OrphanProductsSection token={token} shopId={selectedShop.id} />
      )}

      {viewMode === 'catalog' && (
        <>
      <View className="mt-5 flex-row self-start rounded-full bg-lucrei-surface p-1">
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className="rounded-full px-3.5 py-1.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-xs font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
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
          <Pressable onPress={() => load()} className="rounded-xl bg-lucrei-surface px-4 py-2">
            <Text className="text-sm text-lucrei-gold">Tentar de novo</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'ready' && selectedShop && (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar produto pelo nome..."
            placeholderTextColor={Colors.textMuted}
            className="mt-4 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
          />

          {selected.size === 0 && missingCostProducts.length >= MISSING_COST_NUDGE_THRESHOLD && (
            <View className="mt-3 flex-row items-center gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-3">
              <Text className="flex-1 text-xs text-lucrei-textMuted">
                {missingCostProducts.length} produtos sem custo cadastrado — selecionar todos pra aplicar um valor de
                uma vez?
              </Text>
              <Pressable onPress={handleSelectMissingCost} className="rounded-xl bg-lucrei-surfaceAlt px-3 py-2">
                <Text className="text-xs font-bold text-lucrei-gold">Selecionar</Text>
              </Pressable>
            </View>
          )}

          {filteredProducts.length > 0 && (
            <Pressable
              onPress={handleToggleSelectAll}
              disabled={saving}
              className="mt-3 flex-row items-center gap-2 self-start"
              hitSlop={8}>
              <Ionicons
                name={allFilteredSelected ? 'checkbox' : 'square-outline'}
                size={18}
                color={allFilteredSelected ? Colors.gold : Colors.textMuted}
              />
              <Text className="text-xs text-lucrei-textMuted">Selecionar todos</Text>
            </Pressable>
          )}

          {selected.size > 0 && (
            <View className="mt-3 gap-2 rounded-2xl border border-lucrei-gold bg-lucrei-surface p-3">
              <View className="flex-row items-center gap-2">
                <Text className="text-xs text-lucrei-text">
                  {selected.size === 1 ? '1 selecionado' : `${selected.size} selecionados`}
                </Text>
                <TextInput
                  value={bulkCost}
                  onChangeText={setBulkCost}
                  editable={!saving}
                  placeholder="Custo (R$)"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-bg px-3 py-2 text-sm text-lucrei-text"
                />
                <Pressable onPress={handleApplyBulkCost} disabled={saving} className="rounded-xl bg-lucrei-gold px-3 py-2">
                  <Text className="text-xs font-bold text-lucrei-onGold">Aplicar</Text>
                </Pressable>
              </View>
              <Text className="text-[11px] text-lucrei-textMuted">
                Aplicar só preenche o campo de cada produto — role até o fim e toque em “Salvar tudo” pra confirmar.
              </Text>
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerClassName="mt-4 gap-3 pb-4"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.gold} />
            }>
            {products.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum produto ativo encontrado na sua loja.</Text>
            ) : filteredProducts.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum produto encontrado pra "{search}".</Text>
            ) : (
              filteredProducts.map((product) => {
                const value = edits[product.shopeeItemId] ?? originalCostText(product);
                const dirty = value !== originalCostText(product);
                return (
                  <ProductRow
                    key={product.shopeeItemId}
                    product={product}
                    value={value}
                    dirty={dirty}
                    selected={selected.has(product.shopeeItemId)}
                    disabled={saving}
                    onChangeCost={handleChangeCost}
                    onToggleSelect={handleToggleSelect}
                    period={period}
                  />
                );
              })
            )}
          </ScrollView>

          {pendingChanges.length > 0 && (
            <View className="flex-row items-center gap-3 rounded-2xl border border-lucrei-gold bg-lucrei-surface p-3">
              <Text className="flex-1 text-sm text-lucrei-text">
                {saving
                  ? `Salvando ${pendingChanges.length === 1 ? '1 custo' : `${pendingChanges.length} custos`}...`
                  : pendingChanges.length === 1
                    ? '1 custo alterado'
                    : `${pendingChanges.length} custos alterados`}
              </Text>
              <Pressable
                onPress={handleSaveAll}
                disabled={saving}
                className="items-center justify-center rounded-xl bg-lucrei-gold px-4 py-2.5"
                style={{ opacity: saving ? 0.6 : 1 }}>
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.onGold} />
                ) : (
                  <Text className="text-sm font-bold text-lucrei-onGold">Salvar tudo</Text>
                )}
              </Pressable>
            </View>
          )}
        </>
      )}
      </>
      )}
    </Screen>
  );
}
