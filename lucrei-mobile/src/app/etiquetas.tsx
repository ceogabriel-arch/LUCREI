import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { showAlert } from '@/lib/alert';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { resizeLabelPdf } from '@/lib/labels';
import { useColors } from '@/lib/theme';

export default function EtiquetasScreen() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  const [resizing, setResizing] = useState(false);

  async function handleFileSelected(file: File) {
    if (!token) return;
    setResizing(true);
    try {
      await resizeLabelPdf(token, file);
    } catch (err) {
      showAlert('Não foi possível redimensionar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setResizing(false);
    }
  }

  // Feito na unha (sem <input> no JSX) pra não puxar tipos de DOM pra dentro
  // da árvore RN - mesmo truque já usado no export de CSV de Relatórios.
  function pickFile() {
    if (Platform.OS !== 'web' || resizing || !token) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleFileSelected(file);
    };
    input.click();
  }

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Etiquetas</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Envie o PDF de etiqueta de envio baixado da Shopee e a gente devolve pronto no tamanho 100x150mm (padrão
        10x15 das etiquetadoras térmicas), mantendo a proporção original pra não distorcer o código de barras.
      </Text>

      <View className="mt-5 gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        <View className="flex-row items-center gap-3">
          <Ionicons name="print-outline" size={22} color={Colors.gold} />
          <Text className="flex-1 text-sm text-lucrei-text">
            Aceita PDFs com várias etiquetas (uma por página) — cada página sai redimensionada pra 100x150mm.
          </Text>
        </View>

        {Platform.OS === 'web' ? (
          <Pressable
            onPress={pickFile}
            disabled={resizing || !token}
            className="flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
            style={{ opacity: resizing || !token ? 0.6 : 1 }}>
            {resizing ? (
              <ActivityIndicator size="small" color={Colors.gold} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.gold} />
            )}
            <Text className="text-sm font-medium text-lucrei-gold">
              {resizing ? 'Gerando PDF...' : 'Escolher PDF e gerar etiquetas'}
            </Text>
          </Pressable>
        ) : (
          <Text className="text-sm text-lucrei-textMuted">
            Por enquanto essa função está disponível só na versão web (app.lucreiapp.com pelo navegador).
          </Text>
        )}
      </View>
    </Screen>
  );
}
