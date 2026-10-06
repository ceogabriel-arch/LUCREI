import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { formatBRL } from '@/lib/format';
import {
  SHOPEE_FEE_BANDS,
  breakdownForPrice,
  suggestedPriceForNet,
  targetNetFromCost,
  type ShopeeBreakdown,
  type TaxpayerType,
} from '@/lib/shopee-pricing';
import { useSelectedShop } from '@/lib/selected-shop';
import { useColors } from '@/lib/theme';

type Mode = 'calcular' | 'conferir';
type CalcMode = 'liquido' | 'custo';

// Aceita "45,00", "45.00" e "1.234,50". Vazio ou inválido vira null.
function parseBRL(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function percentLabel(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export default function PrecificadorScreen() {
  const Colors = useColors();
  const [mode, setMode] = useState<Mode>('calcular');
  const [calcMode, setCalcMode] = useState<CalcMode>('liquido');
  const [netInput, setNetInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [marginInput, setMarginInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const { selectedShop, viewingAll } = useSelectedShop();
  // A tabela segue o cadastro da loja escolhida. Em "Todas as lojas" não há
  // uma loja só, então cai no padrão CNPJ.
  const useShopTable = !viewingAll && selectedShop !== null;
  const taxpayer: TaxpayerType = useShopTable ? selectedShop.taxpayerType : 'cnpj';

  let result: ShopeeBreakdown | null = null;
  let suggestedPrice: number | null = null;

  if (mode === 'calcular') {
    const targetNet =
      calcMode === 'liquido'
        ? parseBRL(netInput)
        : (() => {
            const cost = parseBRL(costInput);
            const margin = parseBRL(marginInput);
            return cost !== null && margin !== null && cost > 0 ? targetNetFromCost(cost, margin) : null;
          })();
    suggestedPrice = targetNet !== null ? suggestedPriceForNet(targetNet, taxpayer) : null;
    result = suggestedPrice !== null ? breakdownForPrice(suggestedPrice, taxpayer) : null;
  } else {
    const price = parseBRL(priceInput);
    result = price !== null && price > 0 ? breakdownForPrice(price, taxpayer) : null;
  }

  const tabs: { key: Mode; label: string }[] = [
    { key: 'calcular', label: 'Calcular preço de venda' },
    { key: 'conferir', label: 'Conferir um preço já usado' },
  ];
  const calcTabs: { key: CalcMode; label: string }[] = [
    { key: 'liquido', label: 'Valor líquido direto' },
    { key: 'custo', label: 'Custo + margem %' },
  ];

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-8">
      <Text className="text-2xl font-bold text-lucrei-text">Precificador Shopee</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Calcula o preço certo considerando comissão + taxa fixa por faixa — não uma margem única.
      </Text>

      <View className="mt-5 flex-row gap-2 rounded-2xl border border-lucrei-border bg-lucrei-surface p-1.5">
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setMode(tab.key)}
            className="flex-1 items-center rounded-xl py-2.5"
            style={{ backgroundColor: mode === tab.key ? Colors.surfaceAlt : 'transparent' }}>
            <Text className="text-sm font-medium" style={{ color: mode === tab.key ? Colors.gold : Colors.textMuted }}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        {mode === 'calcular' ? (
          <>
            <Text className="mb-3 text-sm font-semibold text-lucrei-textMuted">O que você quer receber</Text>
            <View className="mb-4 flex-row gap-2">
              {calcTabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  onPress={() => setCalcMode(tab.key)}
                  className="flex-1 items-center rounded-xl border py-2.5"
                  style={{
                    borderColor: calcMode === tab.key ? Colors.gold : Colors.border,
                    backgroundColor: calcMode === tab.key ? Colors.surfaceAlt : 'transparent',
                  }}>
                  <Text className="text-sm font-medium" style={{ color: calcMode === tab.key ? Colors.gold : Colors.textMuted }}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {calcMode === 'liquido' ? (
              <>
                <TextField
                  label="Valor líquido desejado por item vendido (R$)"
                  placeholder="Ex: 45,00"
                  keyboardType="decimal-pad"
                  value={netInput}
                  onChangeText={setNetInput}
                />
                <Text className="text-xs text-lucrei-textMuted">
                  O subsídio Pix não é descontado de você — ele é bancado pela Shopee pra baratear o preço ao comprador,
                  então não entra nessa conta.
                </Text>
              </>
            ) : (
              <>
                <TextField
                  label="Custo do produto (R$)"
                  placeholder="Ex: 30,00"
                  keyboardType="decimal-pad"
                  value={costInput}
                  onChangeText={setCostInput}
                />
                <TextField
                  label="Margem sobre o custo (%)"
                  placeholder="Ex: 40"
                  keyboardType="decimal-pad"
                  value={marginInput}
                  onChangeText={setMarginInput}
                />
                <Text className="text-xs text-lucrei-textMuted">
                  Você quer receber o custo mais a margem. Ex: custo R$ 30 com margem 40% = R$ 42 líquidos.
                </Text>
              </>
            )}
          </>
        ) : (
          <>
            <TextField
              label="Preço de venda anunciado (R$)"
              placeholder="Ex: 59,90"
              keyboardType="decimal-pad"
              value={priceInput}
              onChangeText={setPriceInput}
            />
            <Text className="text-xs text-lucrei-textMuted">Veja quanto a Shopee desconta e quanto sobra pra você nesse preço.</Text>
          </>
        )}
      </View>

      <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        <Text className="text-sm font-semibold text-lucrei-textMuted">
          {mode === 'calcular' ? 'Preço sugerido' : 'Resultado'}
        </Text>

        {result && suggestedPrice !== null && mode === 'calcular' ? (
          <Text className="mt-2 text-center text-sm text-lucrei-textMuted">Coloque este preço no anúncio</Text>
        ) : null}
        <Text className="my-2 text-center text-4xl font-bold" style={{ color: Colors.gold }}>
          {result ? (mode === 'calcular' && suggestedPrice !== null ? formatBRL(suggestedPrice) : formatBRL(result.price)) : '—'}
        </Text>

        {result ? (
          <View className="mt-3 border-t border-lucrei-border">
            <Row label={`Comissão (${percentLabel(result.commissionRate)})`} value={`− ${formatBRL(result.commission)}`} />
            <Row label="Taxa fixa" value={`− ${formatBRL(result.fixedFee)}`} />
            <Row label="Total de taxas" value={`− ${formatBRL(result.totalFees)}`} />
            <View
              className="mt-3 flex-row items-center justify-between rounded-xl px-4 py-3"
              style={{ backgroundColor: Colors.surfaceAlt }}>
              <Text className="text-sm text-lucrei-text">Você recebe (líquido)</Text>
              <Text className="text-base font-bold" style={{ color: Colors.gold }}>
                {formatBRL(result.net)}
              </Text>
            </View>
          </View>
        ) : (
          <Text className="mt-3 text-center text-sm text-lucrei-textMuted">
            {mode === 'calcular' ? 'Preencha o valor pra ver o preço sugerido.' : 'Preencha o preço pra ver o resultado.'}
          </Text>
        )}
      </View>

      <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        <Text className="mb-3 text-sm font-semibold text-lucrei-textMuted">
          {taxpayer === 'cnpj' ? 'Tabela de referência (CNPJ, vigente desde 01/03/2026)' : 'Tabela de referência (CPF)'}
        </Text>
        <Text className="mb-3 text-xs text-lucrei-textMuted">
          {useShopTable
            ? `Usando o cadastro ${taxpayer.toUpperCase()} da loja ${selectedShop.shopName}. Troca em Configurações → Lojas conectadas.`
            : 'Em "Todas as lojas" usa a tabela de CNPJ. Escolha uma loja pra usar o cadastro dela.'}
          {taxpayer === 'cpf' ? ' Taxas de CPF levantadas em fontes de terceiros, ainda não conferidas com a Shopee.' : ''}
        </Text>
        <View className="flex-row pb-2">
          <Text className="flex-[2] text-xs text-lucrei-textMuted">Faixa</Text>
          <Text className="flex-1 text-xs text-lucrei-textMuted">Comissão</Text>
          <Text className="flex-1 text-xs text-lucrei-textMuted">Taxa fixa</Text>
          <Text className="flex-1 text-xs text-lucrei-textMuted">Subsídio Pix</Text>
        </View>
        {SHOPEE_FEE_BANDS[taxpayer].map((band) => (
          <View key={band.minPrice} className="flex-row border-t border-lucrei-border py-2.5">
            <Text className="flex-[2] text-sm text-lucrei-text">{band.label}</Text>
            <Text className="flex-1 text-sm text-lucrei-text">{percentLabel(band.commissionRate)}</Text>
            <Text className="flex-1 text-sm text-lucrei-text">{formatBRL(band.fixedFee)}</Text>
            <Text className="flex-1 text-sm text-lucrei-text">{band.pixSubsidy}</Text>
          </View>
        ))}
      </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-lucrei-border py-2.5">
      <Text className="text-sm text-lucrei-textMuted">{label}</Text>
      <Text className="text-sm text-lucrei-text">{value}</Text>
    </View>
  );
}
