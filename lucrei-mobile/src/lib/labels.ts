import { API_URL, ApiError } from '@/lib/api';

// Endpoint devolve um PDF puro (não JSON), então não dá pra usar o request()
// genérico daqui - ele sempre espera um corpo JSON.
export async function resizeLabelPdf(token: string, file: File): Promise<void> {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  // Abre a aba já aqui, ainda no mesmo gesto de clique do usuário - se
  // esperar o fetch terminar pra chamar window.open, o navegador entende
  // que não foi mais uma ação direta do usuário e bloqueia como pop-up.
  const previewWindow = window.open('', '_blank');
  previewWindow?.document.write(
    '<title>Gerando etiqueta...</title><body style="font-family:sans-serif;padding:40px;color:#555">Gerando etiqueta, aguarde...</body>',
  );

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
