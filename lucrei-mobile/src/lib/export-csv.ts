import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Share } from 'react-native';
import * as Sharing from 'expo-sharing';

import { API_URL, ApiError, type Period } from '@/lib/api';

type ExportFormat = 'csv' | 'xlsx';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function fetchExport(path: string, token: string, errorLabel: string) {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.message ?? `Não foi possível gerar o ${errorLabel}.`);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  return { response, filename: filenameMatch?.[1] ?? null };
}

// Export em lote (checkbox da lista em relatorios.tsx) manda a lista de itens
// no corpo em vez de query string - os outros exports usam GET porque o
// filtro cabe numa URL, mas aqui pode ter dezenas de produtos marcados.
async function fetchExportPost(path: string, token: string, body: unknown, errorLabel: string) {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    throw new ApiError(responseBody?.message ?? `Não foi possível gerar o ${errorLabel}.`);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  return { response, filename: filenameMatch?.[1] ?? null };
}

// .xlsx é binário - no web basta um link de download, mas no nativo precisa
// gravar em arquivo (base64) e abrir pelo share sheet, diferente do CSV que
// dá pra compartilhar como texto puro direto.
async function downloadBinaryFile(response: Response, filename: string, mimeType: string) {
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

  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: filename });
  } else {
    await Share.share({ url: fileUri, title: filename });
  }
}

// shopId null = "Todas as lojas" (/orders/export, sem loja específica).
export async function exportOrders(token: string, shopId: string | null, from: Date, to: Date, format: ExportFormat = 'csv') {
  const query = `from=${from.toISOString()}&to=${to.toISOString()}&format=${format}`;
  const path = shopId ? `/shops/${shopId}/orders/export` : '/orders/export';
  const { response, filename } = await fetchExport(`${path}?${query}`, token, format === 'xlsx' ? 'Excel' : 'CSV');

  if (format === 'xlsx') {
    await downloadBinaryFile(response, filename ?? 'pedidos-lucrei.xlsx', XLSX_CONTENT_TYPE);
    return;
  }

  if (Platform.OS === 'web') {
    await downloadBinaryFile(response, filename ?? 'pedidos-lucrei.csv', 'text/csv');
    return;
  }

  // Sem formato binário envolvido, a alternativa nativa mais simples (sem
  // exigir um novo build do app) é abrir o share sheet com o texto do CSV -
  // dá pra mandar por e-mail/WhatsApp ou salvar em Arquivos dependendo do
  // app escolhido.
  const text = await response.text();
  await Share.share({ message: text, title: filename ?? 'pedidos-lucrei.csv' });
}

// Resumo (faturamento/lucro/quantidade) de 1 produto só, no period escolhido
// no card "Relatório por produto" em relatorios.tsx - mesmo period, só que
// como planilha pra baixar/compartilhar. name identifica o produto pro
// backend quando a loja é Shopee (get_order_detail não expõe item_id pra
// bater com pedido ainda pendente, só o nome).
export async function exportProductExcel(token: string, shopId: string, itemId: string, period: Period, name?: string) {
  const query = `period=${period}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
  const { response, filename } = await fetchExport(
    `/shops/${shopId}/products/${encodeURIComponent(itemId)}/export?${query}`,
    token,
    'Excel'
  );
  await downloadBinaryFile(response, filename ?? 'produto-lucrei.xlsx', XLSX_CONTENT_TYPE);
}

// Export em lote dos produtos marcados no checkbox - uma planilha só com
// todos juntos (coluna "Produto" identifica de qual item cada linha é),
// podendo vir de lojas diferentes no modo "Todas as lojas".
export async function exportProductsExcel(
  token: string,
  items: { shopId: string; itemId: string; name?: string }[],
  period: Period
) {
  const { response, filename } = await fetchExportPost('/products/export', token, { items, period }, 'Excel');
  await downloadBinaryFile(response, filename ?? 'produtos-lucrei.xlsx', XLSX_CONTENT_TYPE);
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
