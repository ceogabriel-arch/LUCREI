import Ionicons from '@expo/vector-icons/Ionicons';
import { createElement, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { showAlert } from '@/lib/alert';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { resizeLabelPdf } from '@/lib/labels';
import { fullscreenOverlayStyle } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

type Marketplace = 'shopee' | 'mercado_livre';

const MARKETPLACES: { key: Marketplace; label: string }[] = [
  { key: 'shopee', label: 'Shopee' },
  { key: 'mercado_livre', label: 'Mercado Livre' },
];

export default function EtiquetasScreen() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  // O redimensionamento em si é o mesmo pras duas (detecta a área de
  // conteúdo real do PDF, não assume nada específico de marketplace) - o
  // botão separado é só pra deixar claro que funciona pras duas etiquetas,
  // já que só rastreamos qual está carregando pra mostrar o spinner certo.
  const [resizing, setResizing] = useState<Marketplace | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  async function handleFileSelected(marketplace: Marketplace, file: File) {
    if (!token) return;
    setResizing(marketplace);
    try {
      const blob = await resizeLabelPdf(token, file);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      showAlert('Não foi possível redimensionar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setResizing(null);
    }
  }

  // Feito na unha (sem <input> no JSX) pra não puxar tipos de DOM pra dentro
  // da árvore RN - mesmo truque já usado no export de CSV de Relatórios.
  function pickFile(marketplace: Marketplace) {
    if (Platform.OS !== 'web' || resizing !== null || !token) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleFileSelected(marketplace, file);
    };
    input.click();
  }

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Etiquetas</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Envie o PDF de etiqueta de envio baixado da Shopee ou do Mercado Livre e a gente devolve pronto no tamanho
        100x150mm (padrão 10x15 das etiquetadoras térmicas), mantendo a proporção original pra não distorcer o
        código de barras.
      </Text>

      <View className="mt-5 gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        <View className="flex-row items-center gap-3">
          <Ionicons name="print-outline" size={22} color={Colors.gold} />
          <Text className="flex-1 text-sm text-lucrei-text">
            Aceita PDFs com várias etiquetas (uma por página) — cada página sai redimensionada pra 100x150mm.
          </Text>
        </View>

        {Platform.OS === 'web' ? (
          <View className="flex-row gap-2.5">
            {MARKETPLACES.map((marketplace) => (
              <Pressable
                key={marketplace.key}
                onPress={() => pickFile(marketplace.key)}
                disabled={resizing !== null || !token}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
                style={{ opacity: (resizing !== null && resizing !== marketplace.key) || !token ? 0.5 : 1 }}>
                {resizing === marketplace.key ? (
                  <ActivityIndicator size="small" color={Colors.gold} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={16} color={Colors.gold} />
                )}
                <Text className="text-sm font-medium text-lucrei-gold">
                  {resizing === marketplace.key ? 'Gerando...' : `Dimensionar ${marketplace.label}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-lucrei-textMuted">
            Por enquanto essa função está disponível só na versão web (app.lucreiapp.com pelo navegador).
          </Text>
        )}
      </View>

      {previewUrl && Platform.OS === 'web' ? (
        <View style={[fullscreenOverlayStyle, { backgroundColor: '#000' }]}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border bg-lucrei-bg px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">Etiqueta gerada</Text>
            <Pressable onPress={closePreview} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>
          {/* <iframe> não existe como componente RN - o visualizador nativo de
              PDF do navegador (com botão de imprimir) só aparece embutindo a
              URL assim, direto no DOM. */}
          {createElement('iframe', { src: previewUrl, style: { flex: 1, border: 'none' } })}
        </View>
      ) : null}
    </Screen>
  );
}
