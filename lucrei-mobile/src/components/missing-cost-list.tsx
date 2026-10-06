import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { ApiError, saveProductCost, type ShopeeProduct } from '@/lib/api';
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
  // implícito numa loja só - ver os dois call sites).
  items: (ShopeeProduct & { shopId: string })[];
  onSaved: () => void;
}) {
  const Colors = useColors();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function handleSave(item: ShopeeProduct & { shopId: string }) {
    const raw = (drafts[item.shopeeItemId] ?? '').replace(',', '.').trim();
    const cost = Number(raw);
    if (!raw || Number.isNaN(cost) || cost < 0) {
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
                onPress={() => handleSave(item)}
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
