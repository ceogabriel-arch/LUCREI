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

// Toggle CNPJ / CPF da loja escolhida no Precificador. Salva na hora ao
// trocar e avisa o pai com onChange, pra tabela de taxas mudar sem esperar a
// lista de lojas recarregar.
export function ShopTaxpayerToggle({
  shop,
  value,
  onChange,
}: {
  shop: Shop;
  value: TaxpayerType;
  onChange: (next: TaxpayerType) => void;
}) {
  const { state } = useAuth();
  const Colors = useColors();
  const { toast, opacity, show } = useToast();
  const [saving, setSaving] = useState(false);

  async function handleSelect(next: TaxpayerType) {
    if (next === value || saving || state.status !== 'authenticated') return;
    const previous = value;
    onChange(next);
    setSaving(true);
    try {
      await updateShopTaxpayerType(state.token, shop.id, next);
      show({ title: 'Cadastro salvo', message: `Tabela de ${next.toUpperCase()} aplicada na loja ${shop.shopName}.`, tone: 'success' });
    } catch {
      onChange(previous);
      show({ title: 'Não foi possível salvar', message: 'Tenta de novo em instantes.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-1.5 text-xs text-lucrei-textMuted">Cadastro da loja na Shopee</Text>
      <View className="flex-row gap-1 rounded-lg border border-lucrei-border bg-lucrei-bg p-1">
        {OPTIONS.map((option) => {
          const active = value === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => handleSelect(option.key)}
              disabled={saving}
              className="flex-1 items-center rounded-md py-2"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-sm font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
