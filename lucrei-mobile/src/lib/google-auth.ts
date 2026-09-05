import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
  configured = true;
}

// Retorna o idToken pra mandar pro backend validar, ou null se o usuário
// cancelou o fluxo de login.
export async function signInWithGoogle(): Promise<string | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    return null;
  }
  return response.data.idToken;
}
