import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type PixCharge } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { webCapWidth } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

const POLL_INTERVAL_MS = 5000;

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function PixPaymentModal({
  visible,
  onClose,
  pix,
}: {
  visible: boolean;
  onClose: () => void;
  pix: PixCharge | null;
}) {
  const { state, refreshUser } = useAuth();
  const Colors = useColors();
  const [copied, setCopied] = useState(false);

  const active = state.status === 'authenticated' && state.user.subscriptionStatus === 'active';

  useEffect(() => {
    if (!visible || !pix || active) return;
    const interval = setInterval(refreshUser, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [visible, pix, active, refreshUser]);

  async function handleCopy() {
    if (!pix) return;
    await Clipboard.setStringAsync(pix.qrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '90%', ...webCapWidth() }} className="rounded-t-3xl bg-lucrei-bg">
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">Pagar com Pix</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="items-center p-6">
            {active ? (
              <View className="items-center py-6">
                <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
                <Text className="mt-4 text-lg font-semibold text-lucrei-text">Pagamento confirmado!</Text>
                <Text className="mt-1 text-center text-sm text-lucrei-textMuted">
                  Sua assinatura já está ativa.
                </Text>
                <Pressable onPress={onClose} className="mt-6 items-center rounded-xl bg-lucrei-gold px-6 py-3">
                  <Text className="text-sm font-semibold text-lucrei-onGold">Fechar</Text>
                </Pressable>
              </View>
            ) : pix ? (
              <>
                <Text className="text-2xl font-bold text-lucrei-text">{formatBRL(pix.amount)}</Text>
                <Text className="mt-1 text-xs text-lucrei-textMuted">
                  Válido até {dateTimeFormatter.format(new Date(pix.expiresAt))}
                </Text>

                <View className="mt-5 rounded-2xl border border-lucrei-border bg-white p-3">
                  <Image
                    source={{ uri: `data:image/png;base64,${pix.qrCodeBase64}` }}
                    style={{ width: 220, height: 220 }}
                    contentFit="contain"
                  />
                </View>

                <Text className="mt-5 text-center text-sm text-lucrei-textMuted">
                  Abra o app do seu banco, escaneie o QR code ou copie o código abaixo.
                </Text>

                <Pressable
                  onPress={handleCopy}
                  className="mt-4 w-full flex-row items-center justify-center gap-2 rounded-xl border border-lucrei-border bg-lucrei-surface py-3.5">
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color={copied ? Colors.success : Colors.gold}
                  />
                  <Text className="text-sm font-semibold text-lucrei-text">
                    {copied ? 'Código copiado!' : 'Copiar código Pix'}
                  </Text>
                </Pressable>

                <Text className="mt-5 text-center text-xs text-lucrei-textMuted">
                  Assim que o pagamento cair, sua assinatura é ativada automaticamente - essa tela atualiza sozinha.
                </Text>
              </>
            ) : (
              <View className="items-center py-10">
                <Text className="text-sm text-lucrei-textMuted">Nenhuma cobrança Pix pendente no momento.</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
