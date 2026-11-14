import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/text-field';
import { ApiError } from '@/lib/api';
import { finishIfoodLink, startIfoodLink, type IfoodLink } from '@/lib/ifood';
import { useModalPresentation } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

// Vínculo da iFood em 2 passos (não tem login por redirecionamento como
// Shopee/ML): mostra o código de vínculo pro lojista digitar no Portal do
// Parceiro, depois recebe o código de autorização que o portal devolve.
// Montado só enquanto aberto (ver index.tsx) - cada abertura gera um código
// novo, já que o anterior vence em 10 minutos.
export function IfoodConnectModal({
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
  const [link, setLink] = useState<IfoodLink | null>(null);
  const [loadingLink, setLoadingLink] = useState(true);
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchLink = useCallback(
    () =>
      startIfoodLink(token)
        .then((data) => {
          setLink(data);
          setError(null);
        })
        .catch((err) => {
          setLink(null);
          setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o código.');
        })
        .finally(() => setLoadingLink(false)),
    [token]
  );

  useEffect(() => {
    fetchLink();
  }, [fetchLink]);

  function generateLink() {
    setLoadingLink(true);
    setAuthorizationCode('');
    fetchLink();
  }

  async function handleCopy() {
    if (!link) return;
    await Clipboard.setStringAsync(link.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleConnect() {
    if (!link || !authorizationCode.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await finishIfoodLink(token, link.linkToken, authorizationCode);
      onConnected(result.shopName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '90%', ...modal.panelWidthStyle }} className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">Conectar loja iFood</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerClassName="p-6" keyboardShouldPersistTaps="handled">
            <Text className="text-sm font-semibold text-lucrei-text">1. Digite este código no Portal do Parceiro</Text>
            <Text className="mt-1 text-sm text-lucrei-textMuted">
              No Portal do Parceiro iFood, vá em Integrações e toque em &quot;Ativar integração por código&quot;.
            </Text>

            {loadingLink ? (
              <View className="items-center py-6">
                <ActivityIndicator color={Colors.gold} />
              </View>
            ) : link ? (
              <>
                <Pressable
                  onPress={handleCopy}
                  className="mt-4 flex-row items-center justify-center gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface py-4">
                  <Text className="text-2xl font-bold tracking-widest text-lucrei-text">{link.userCode}</Text>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? Colors.success : Colors.gold} />
                </Pressable>
                <Text className="mt-2 text-center text-xs text-lucrei-textMuted">
                  Vale {Math.round(link.expiresIn / 60)} minutos.{' '}
                  <Text onPress={generateLink} className="text-xs font-semibold text-lucrei-gold">
                    Gerar outro
                  </Text>
                </Text>

                <Pressable
                  onPress={() => Linking.openURL(link.verificationUrl)}
                  className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-gold py-3.5">
                  <Ionicons name="open-outline" size={16} color={Colors.onGold} />
                  <Text className="text-sm font-semibold text-lucrei-onGold">Abrir Portal do Parceiro</Text>
                </Pressable>

                <Text className="mt-6 text-sm font-semibold text-lucrei-text">2. Cole o código de autorização</Text>
                <Text className="mb-3 mt-1 text-sm text-lucrei-textMuted">
                  Depois de autorizar, o portal mostra um código de autorização. Ele vale 5 minutos.
                </Text>
                <TextField
                  label="Código de autorização"
                  value={authorizationCode}
                  onChangeText={setAuthorizationCode}
                  placeholder="XXXX-XXXX"
                  autoCapitalize="characters"
                  autoCorrect={false}
                />

                <Pressable
                  onPress={handleConnect}
                  disabled={submitting || !authorizationCode.trim()}
                  className="items-center rounded-xl bg-lucrei-gold py-3.5"
                  style={{ opacity: submitting || !authorizationCode.trim() ? 0.6 : 1 }}>
                  {submitting ? (
                    <ActivityIndicator color={Colors.onGold} />
                  ) : (
                    <Text className="text-sm font-semibold text-lucrei-onGold">Conectar</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            {error ? <Text className="mt-4 text-center text-sm text-lucrei-danger">{error}</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
