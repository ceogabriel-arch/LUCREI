import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { ToastBanner, useToast } from '@/components/toast';
import { updateShopTaxRate, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

function formatRateInput(value: number) {
  return value.toFixed(2).replace('.', ',');
}

// Compartilhado entre Configurações (dentro de cada loja em "Lojas
// conectadas") e Produtos (perto do topo, onde o vendedor já está mexendo em
// custo - reclamado ao vivo que a % não aparecia lá, só em Configurações).
// Mesmo componente, dois lugares, pra não duplicar a lógica de salvar.
export function ShopTaxRateField({ shop, compact = false }: { shop: Shop; compact?: boolean }) {
  const { state } = useAuth();
  const Colors = useColors();
  const [rate, setRate] = useState(shop.taxRatePercent != null ? formatRateInput(shop.taxRatePercent) : '');
  const [saving, setSaving] = useState(false);
  const { toast, opacity, show } = useToast();

  const parsed = rate.trim() === '' ? null : Number(rate.replace(',', '.'));
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 100);
  const dirty = !invalid && parsed !== shop.taxRatePercent;

  async function handleSave() {
    if (state.status !== 'authenticated') return;
    setSaving(true);
    try {
      await updateShopTaxRate(state.token, shop.id, parsed);
      show({ title: 'Alíquota salva', message: 'Vale a partir da próxima sincronização.', tone: 'success' });
    } catch {
      show({ title: 'Não foi possível salvar', message: 'Tenta de novo em instantes.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (compact) {
    return (
      <View>
        <ToastBanner toast={toast} opacity={opacity} />
        <View className="flex-row items-center gap-1.5 rounded-full bg-lucrei-surface py-1 pl-3 pr-1.5">
          <Text className="text-xs font-medium text-lucrei-textMuted">Imposto</Text>
          <TextInput
            value={rate}
            onChangeText={setRate}
            placeholder="0,00"
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
            className="w-14 text-xs text-lucrei-text"
          />
          <Text className="text-xs text-lucrei-textMuted">%</Text>
          <Pressable
            onPress={handleSave}
            disabled={!dirty || saving}
            className="h-6 w-6 items-center justify-center rounded-full bg-lucrei-gold"
            style={{ opacity: !dirty || saving ? 0.4 : 1 }}>
            {saving ? (
              <ActivityIndicator size="small" color={Colors.onGold} />
            ) : (
              <Ionicons name="checkmark" size={13} color={Colors.onGold} />
            )}
          </Pressable>
        </View>
        {invalid && <Text className="mt-1 text-[11px] text-lucrei-danger">Valor entre 0 e 100.</Text>}
      </View>
    );
  }

  return (
    <View className="mt-2.5 border-t border-lucrei-border pt-2.5">
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-1.5 text-[11px] text-lucrei-textMuted">
        Alíquota de imposto (%){shop.provider === 'mercado_livre' ? ' — ainda não usada no cálculo do Mercado Livre' : ''}
      </Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={rate}
          onChangeText={setRate}
          placeholder="0,00"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          className="flex-1 rounded-lg border border-lucrei-border bg-lucrei-bg px-3 py-2 text-sm text-lucrei-text"
        />
        <Pressable
          onPress={handleSave}
          disabled={!dirty || saving}
          className="h-9 w-9 items-center justify-center rounded-lg bg-lucrei-gold"
          style={{ opacity: !dirty || saving ? 0.4 : 1 }}>
          {saving ? (
            <ActivityIndicator size="small" color={Colors.onGold} />
          ) : (
            <Ionicons name="checkmark" size={16} color={Colors.onGold} />
          )}
        </Pressable>
      </View>
      {invalid && <Text className="mt-1.5 text-[11px] text-lucrei-danger">Digite um valor entre 0 e 100, ou deixe em branco.</Text>}
    </View>
  );
}
