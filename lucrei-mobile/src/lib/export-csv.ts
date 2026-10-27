import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Share } from 'react-native';
import * as Sharing from 'expo-sharing';

import { API_URL, ApiError } from '@/lib/api';

type ExportFormat = 'csv' | 'xlsx';

const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

// Endpoint devolve o arquivo puro (CSV ou .xlsx), não JSON, então não dá pra
// usar o request() genérico daqui - ele sempre espera um corpo JSON. shopId
// null = "Todas as lojas" (/orders/export, sem loja específica).
export async function exportOrders(token: string, shopId: string | null, from: Date, to: Date, format: ExportFormat = 'csv') {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  const query = `from=${from.toISOString()}&to=${to.toISOString()}&format=${format}`;
  const path = shopId ? `/shops/${shopId}/orders/export` : '/orders/export';
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.message ?? `Não foi possível gerar o ${format === 'xlsx' ? 'Excel' : 'CSV'}.`);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? `pedidos-lucrei.${format}`;

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

  if (format === 'xlsx') {
    // .xlsx é binário - precisa gravar em arquivo (base64) e abrir pelo share
    // sheet nativo, diferente do CSV abaixo que dá pra compartilhar como texto.
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const fileUri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, { mimeType: EXPORT_CONTENT_TYPE.xlsx, dialogTitle: filename });
    } else {
      await Share.share({ url: fileUri, title: filename });
    }
    return;
  }

  // Sem formato binário envolvido, a alternativa nativa mais simples (sem
  // exigir um novo build do app) é abrir o share sheet com o texto do CSV -
  // dá pra mandar por e-mail/WhatsApp ou salvar em Arquivos dependendo do
  // app escolhido.
  const text = await response.text();
  await Share.share({ message: text, title: filename });
}

// Hermes (runtime nativo do RN) não garante `btoa` global - monta o base64
// na mão a partir dos bytes crus pra não depender dele nem do Buffer (Node).
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    result += BASE64_CHARS[(triple >> 18) & 0x3f];
    result += BASE64_CHARS[(triple >> 12) & 0x3f];
    result += b1 !== undefined ? BASE64_CHARS[(triple >> 6) & 0x3f] : '=';
    result += b2 !== undefined ? BASE64_CHARS[triple & 0x3f] : '=';
  }
  return result;
}

export async function exportOrdersCsv(token: string, shopId: string | null, from: Date, to: Date) {
  return exportOrders(token, shopId, from, to, 'csv');
}

export async function exportOrdersExcel(token: string, shopId: string | null, from: Date, to: Date) {
  return exportOrders(token, shopId, from, to, 'xlsx');
}
