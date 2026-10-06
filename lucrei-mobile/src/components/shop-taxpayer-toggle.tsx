import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ToastBanner, useToast } from '@/components/toast';
import { updateShopTaxpayerType, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

type TaxpayerType = Shop['taxpayerType'];

const OPTIONS: { key: TaxpayerType; label: string }[] = [
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'cpf', label: 'CPF' },
];

// Toggle CNPJ / CPF dentro de cada loja em "Lojas conectadas". Salva na hora
// ao trocar - não tem botão de confirmar, porque é uma escolha binária e o
// Precificador já mostra qual tabela está usando.
export function ShopTaxpayerToggle({ shop }: { shop: Shop }) {
  const { state } = useAuth();
  const Colors = useColors();
  const { toast, opacity, show } = useToast();
  const [current, setCurrent] = useState<TaxpayerType>(shop.taxpayerType);
  const [saving, setSaving] = useState(false);

  async function handleSelect(next: TaxpayerType) {
    if (next === current || saving || state.status !== 'authenticated') return;
    const previous = current;
    setCurrent(next);
    setSaving(true);
    try {
      await updateShopTaxpayerType(state.token, shop.id, next);
      show({ title: 'Tipo de cadastro salvo', message: `Precificador usando a tabela de ${next.toUpperCase()}.`, tone: 'success' });
    } catch {
      setCurrent(previous);
      show({ title: 'Não foi possível salvar', message: 'Tenta de novo em instantes.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mt-2.5 border-t border-lucrei-border pt-2.5">
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-1.5 text-[11px] text-lucrei-textMuted">Tipo de cadastro na Shopee (tabela de taxas do Precificador)</Text>
      <View className="flex-row gap-1 rounded-lg border border-lucrei-border bg-lucrei-bg p-1">
        {OPTIONS.map((option) => {
          const active = current === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => handleSelect(option.key)}
              disabled={saving}
              className="flex-1 items-center rounded-md py-1.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-xs font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
