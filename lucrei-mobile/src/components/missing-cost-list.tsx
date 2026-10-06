import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { ApiError, saveProductCost, saveProductCosts, type ShopeeProduct } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useColors } from '@/lib/theme';

// Substitui o texto fixo "N item(ns) sem custo cadastrado" por uma lista
// suspensa com cada item e um campo pra já cadastrar o custo ali mesmo, sem
// precisar ir até Produtos - pedido pelo usuário pra agilizar o fluxo mais
// comum de "ué, por que o lucro não bate" (resposta: falta custo cadastrado).
export function MissingCostList({
  token,
  items,
  onSaved,
}: {
  token: string;
  // Já filtrado pra só os itens vendidos no período sem costPrice - ver
  // chamada em index.tsx/relatorios.tsx. shopId obrigatório em cada item
  // (vem preenchido manualmente no modo "Todas as lojas", automaticamente
  // implícito numa loja única - ver os dois call sites).
  items: (ShopeeProduct & { shopId: string })[];
  onSaved: () => void;
}) {
  const Colors = useColors();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  if (items.length === 0) return null;

  function parseCost(raw: string): number | null {
    const normalized = raw.replace(',', '.').trim();
    const cost = Number(normalized);
    if (!normalized || Number.isNaN(cost) || cost < 0) return null;
    return cost;
  }

  async function handleSave(item: ShopeeProduct & { shopId: string }) {
    const cost = parseCost(drafts[item.shopeeItemId] ?? '');
    if (cost === null) {
      showAlert('Valor inválido', 'Digite um custo válido (ex: 12.50).');
      return;
    }
    setSavingId(item.shopeeItemId);
    try {
      await saveProductCost(token, item.shopId, item.shopeeItemId, item.name, cost);
      setDrafts((d) => {
        const next = { ...d };
        delete next[item.shopeeItemId];
        return next;
      });
      onSaved();
    } catch (err) {
      showAlert('Não foi possível salvar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setSavingId(null);
    }
  }

  // Aplica o MESMO custo pra todos os itens da lista de uma vez - pedido
  // pelo usuário pra lojas com muito item parecido (ex: mesma fantasia em
  // tamanhos diferentes), onde editar um por um é repetitivo. Agrupa por
  // loja porque saveProductCosts é uma chamada por loja só (modo "Todas as
  // lojas" pode ter item de lojas diferentes na mesma lista).
  async function handleBulkSave() {
    const cost = parseCost(bulkDraft);
    if (cost === null) {
      showAlert('Valor inválido', 'Digite um custo válido (ex: 12.50).');
      return;
    }
    setBulkSaving(true);
    try {
      const byShop = new Map<string, (ShopeeProduct & { shopId: string })[]>();
      for (const item of items) {
        const list = byShop.get(item.shopId) ?? [];
        list.push(item);
        byShop.set(item.shopId, list);
      }
      await Promise.all(
        Array.from(byShop.entries()).map(([shopId, shopItems]) =>
          saveProductCosts(
            token,
            shopId,
            shopItems.map((i) => ({ shopeeItemId: i.shopeeItemId, name: i.name, costPrice: cost }))
          )
        )
      );
      setBulkDraft('');
      setDrafts({});
      onSaved();
    } catch (err) {
      showAlert('Não foi possível salvar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <View className="mt-2">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-1.5" hitSlop={6}>
        <Text className="text-xs text-lucrei-textMuted">
          {items.length} item(ns) sem custo cadastrado, não entram nesse total.
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={Colors.textMuted} />
      </Pressable>

      {open && (
        <View className="mt-2 gap-2">
          {items.length > 1 && (
            <View className="flex-row items-center gap-2 rounded-xl border border-dashed border-lucrei-border px-3 py-2">
              <Text className="flex-1 text-xs text-lucrei-textMuted">Mesmo custo pra todos ({items.length})</Text>
              <TextInput
                value={bulkDraft}
                onChangeText={setBulkDraft}
                placeholder="Custo R$"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                className="w-20 rounded-lg border border-lucrei-border bg-lucrei-surface px-2 py-1.5 text-xs text-lucrei-text"
              />
              <Pressable
                onPressIn={handleBulkSave}
                disabled={bulkSaving}
                className="rounded-lg px-2.5 py-1.5"
                style={{ backgroundColor: Colors.gold, opacity: bulkSaving ? 0.6 : 1 }}>
                {bulkSaving ? (
                  <ActivityIndicator size="small" color={Colors.onGold} />
                ) : (
                  <Text className="text-xs font-semibold" style={{ color: Colors.onGold }}>
                    Aplicar a todos
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {items.map((item) => (
            <View
              key={`${item.shopId}-${item.shopeeItemId}`}
              className="flex-row items-center gap-2 rounded-xl border border-lucrei-border bg-lucrei-surfaceAlt px-3 py-2">
              <Text className="flex-1 text-xs text-lucrei-text" numberOfLines={1}>
                {item.name}
              </Text>
              <TextInput
                value={drafts[item.shopeeItemId] ?? ''}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [item.shopeeItemId]: v }))}
                placeholder="Custo R$"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                className="w-20 rounded-lg border border-lucrei-border bg-lucrei-surface px-2 py-1.5 text-xs text-lucrei-text"
              />
              <Pressable
                // onPressIn (não onPress): no RN Web, clicar num botão logo
                // depois de digitar no TextInput ao lado às vezes só tira o
                // foco do campo no primeiro clique (blur engole o evento) e
                // só o segundo clique de fato dispara - reportado ao vivo
                // ("aperto 2x seguida funciona"). onPressIn dispara no
                // toque/clique inicial, antes do blur atrapalhar.
                onPressIn={() => handleSave(item)}
                disabled={savingId === item.shopeeItemId}
                className="rounded-lg px-2.5 py-1.5"
                style={{ backgroundColor: Colors.gold, opacity: savingId === item.shopeeItemId ? 0.6 : 1 }}>
                {savingId === item.shopeeItemId ? (
                  <ActivityIndicator size="small" color={Colors.onGold} />
                ) : (
                  <Text className="text-xs font-semibold" style={{ color: Colors.onGold }}>
                    Salvar
                  </Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
