import { Platform, Share } from 'react-native';

import { API_URL, ApiError } from '@/lib/api';

// Endpoint devolve CSV puro (não JSON), então não dá pra usar o request()
// genérico daqui - ele sempre espera um corpo JSON.
export async function exportOrdersCsv(token: string, shopId: string, from: Date, to: Date) {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  const query = `from=${from.toISOString()}&to=${to.toISOString()}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/shops/${shopId}/orders/export?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.message ?? 'Não foi possível gerar o CSV.');
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? 'pedidos-lucrei.csv';

  if (Platform.OS === 'web') {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  // Sem expo-file-system/expo-sharing instalado, a alternativa nativa mais
  // simples (sem exigir um novo build do app) é abrir o share sheet com o
  // texto do CSV - dá pra mandar por e-mail/WhatsApp ou salvar em Arquivos
  // dependendo do app escolhido.
  const text = await response.text();
  await Share.share({ message: text, title: filename });
}
