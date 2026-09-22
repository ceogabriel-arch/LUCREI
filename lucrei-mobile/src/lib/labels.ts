import { API_URL, ApiError } from '@/lib/api';

// Endpoint devolve um PDF puro (não JSON), então não dá pra usar o request()
// genérico daqui - ele sempre espera um corpo JSON.
export async function resizeLabelPdf(token: string, file: File): Promise<void> {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  const form = new FormData();
  form.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/labels/resize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.message ?? 'Não foi possível redimensionar o PDF.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'etiquetas-100x150.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
