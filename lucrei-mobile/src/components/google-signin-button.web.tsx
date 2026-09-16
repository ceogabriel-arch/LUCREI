import * as Sentry from '@sentry/react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

// @react-native-google-signin/google-signin não tem implementação real de web
// (o arquivo .web.ts da lib é só um stub que sempre lança "not implemented" -
// suporte a web é pago, só pra sponsors). Por isso a web usa o SDK oficial do
// Google (Google Identity Services) direto, renderizando o botão de verdade
// deles - o próprio botão do Google é servido dentro de um iframe, então não
// dá pra estilizar nem "clicar por script" nele por fora, tem que ser
// renderizado visível mesmo.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o script do Google.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function GoogleSignInButton({
  onIdToken,
  onError,
}: {
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<View>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!clientId) {
      onError('Login com Google não está configurado.');
      return;
    }

    loadGisScript()
      .then(() => {
        if (cancelled) return;
        window.google!.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) {
              onIdToken(response.credential);
            } else {
              Sentry.captureMessage('Callback do Google sem credential', { tags: { flow: 'google_sign_in_web' } });
              onError('Não foi possível entrar com o Google agora.');
            }
          },
        });
        setReady(true);
      })
      .catch((err) => {
        Sentry.captureException(err, { tags: { flow: 'google_sign_in_web' } });
        onError('Não foi possível carregar o login do Google agora.');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const node = containerRef.current as unknown as HTMLElement;
    node.innerHTML = '';
    window.google!.accounts.id.renderButton(node, {
      type: 'standard',
      // 'outline' força fundo branco sempre - 'filled_black' é o único tema
      // do Google que combina com o resto do app no modo escuro.
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'center',
      width: 360,
    });
  }, [ready]);

  return <View ref={containerRef} className="mt-5 items-center" style={{ minHeight: 44 }} />;
}
