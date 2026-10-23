// "Sign in with Apple JS" - usado só na web (o fluxo nativo iOS fica em
// apple-signin-button.tsx, via expo-apple-authentication). O Services ID
// (client ID) e a Return URL aqui têm que bater com o que foi cadastrado no
// Apple Developer Portal (Identifiers > Services IDs > Lucrei Web).
const APPLE_WEB_CLIENT_ID = 'com.lucreiapp.web';
const SDK_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

type AppleAuthSignInResponse = {
  authorization: { id_token?: string };
  user?: { name?: { firstName?: string; lastName?: string } };
};

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
        signIn: () => Promise<AppleAuthSignInResponse>;
      };
    };
  }
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.AppleID) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o SDK da Apple.'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export type AppleWebCredential = { identityToken: string; fullName?: string };

// Retorna null se o usuário cancelou (fechou o popup sem autorizar).
export async function signInWithAppleWeb(): Promise<AppleWebCredential | null> {
  await loadSdk();
  window.AppleID!.auth.init({
    clientId: APPLE_WEB_CLIENT_ID,
    scope: 'name email',
    redirectURI: `${window.location.origin}/auth/apple/web-callback`,
    usePopup: true,
  });

  let response: AppleAuthSignInResponse;
  try {
    response = await window.AppleID!.auth.signIn();
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'error' in err ? String((err as { error: unknown }).error) : undefined;
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return null;
    throw err;
  }

  const identityToken = response.authorization?.id_token;
  if (!identityToken) return null;

  // Só vem preenchido na 1ª autorização dessa conta, igual ao fluxo nativo
  // (ver apple-signin-button.tsx).
  const fullName = response.user?.name
    ? [response.user.name.firstName, response.user.name.lastName].filter(Boolean).join(' ').trim() || undefined
    : undefined;

  return { identityToken, fullName };
}
