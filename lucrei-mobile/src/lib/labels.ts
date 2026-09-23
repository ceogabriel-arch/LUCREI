import { API_URL, ApiError } from '@/lib/api';

// Endpoint devolve um PDF puro (não JSON), então não dá pra usar o request()
// genérico daqui - ele sempre espera um corpo JSON.
// `previewWindow` precisa ser aberto (window.open) pelo chamador, no clique
// original do botão - se a gente abre aqui dentro, já é tarde demais: esse
// código só roda depois do evento "change" do <input type=file>, e o
// diálogo nativo de escolher arquivo consome o gesto do clique original,
// então navegadores tratam a chamada como pop-up não solicitado e bloqueiam.
export async function resizeLabelPdf(token: string, file: File, previewWindow?: Window | null): Promise<void> {
  if (!API_URL) {
    previewWindow?.close();
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
    previewWindow?.close();
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    previewWindow?.close();
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.message ?? 'Não foi possível redimensionar o PDF.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  if (previewWindow) {
    // O navegador abre o PDF no visualizador nativo dele, que já tem botão
    // de imprimir - não revoga a URL aqui porque a aba ainda precisa dela.
    previewWindow.location.href = url;
  } else {
    // Pop-up bloqueado (ex: Safari com bloqueio mais rígido) - cai pro
    // download direto, que sempre funciona.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etiquetas-100x150.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
