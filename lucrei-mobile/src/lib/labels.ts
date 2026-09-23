import { API_URL, ApiError } from '@/lib/api';

// Endpoint devolve um PDF puro (não JSON), então não dá pra usar o request()
// genérico daqui - ele sempre espera um corpo JSON.
//
// Devolve o blob em vez de já abrir aba/baixar - navegadores só permitem UMA
// ação que dependa do gesto de clique por vez, e esse clique já foi gasto no
// <input type=file>.click() que abre o seletor de arquivo. Chamar
// window.open() depois (no clique original ou no "change" do input) trava
// um dos dois: ou o seletor de arquivo nem abre, ou a aba nova é bloqueada
// como pop-up. Quem chama mostra o PDF embutido na própria página (iframe),
// que não esbarra nessa restrição.
export async function resizeLabelPdf(token: string, file: File): Promise<Blob> {
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

  return response.blob();
}
