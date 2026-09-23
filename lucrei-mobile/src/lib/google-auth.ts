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
  // Sem isso, o SDK nativo do Google reaproveita silenciosamente a última
  // conta que fez login nesse aparelho - mesmo depois de sair do Lucrei -
  // sem nunca mostrar o seletor de contas de novo. signOut aqui limpa esse
  // cache antes de abrir o seletor, garantindo que sempre dá pra escolher
  // outra conta. Ignora erro (ex: nenhuma sessão prévia pra limpar).
  try {
    await GoogleSignin.signOut();
  } catch {
    // Sem sessão anterior - nada a limpar, segue normalmente.
  }
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    return null;
  }
  return response.data.idToken;
}
