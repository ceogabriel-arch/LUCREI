import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text } from 'react-native';

import { useColors } from '@/lib/theme';

// Só existe no app nativo iOS (API da Apple, nem renderiza em Android/web) -
// exigido pela própria Apple pra aprovar o app na revisão, já que o Lucrei
// oferece login social de terceiro (Google).
export function AppleSignInButton({
  onCredential,
  onError,
}: {
  onCredential: (identityToken: string, fullName: string | undefined) => void;
  onError: (message: string) => void;
}) {
  const Colors = useColors();
  const [submitting, setSubmitting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);

  if (Platform.OS !== 'ios' || !available) return null;

  async function handlePress() {
    setSubmitting(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        onError('Não foi possível entrar com a Apple agora.');
        return;
      }
      // Só vem preenchido na 1ª autorização dessa conta - a Apple nunca
      // reenvia de novo depois (ver backend, /auth/apple).
      const fullName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ').trim() || undefined
        : undefined;
      onCredential(credential.identityToken, fullName);
    } catch (err) {
      // Cancelar o diálogo não é erro de verdade - só volta sem mostrar nada.
      const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;
      if (code === 'ERR_REQUEST_CANCELED') return;
      Sentry.captureException(err, { tags: { flow: 'apple_sign_in', apple_error_code: code } });
      onError('Não foi possível entrar com a Apple agora.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={submitting}
      className="mt-3 flex-row items-center justify-center gap-2 rounded-2xl border border-lucrei-border bg-lucrei-surface py-4"
      style={{ opacity: submitting ? 0.6 : 1 }}>
      {submitting ? (
        <ActivityIndicator color={Colors.text} />
      ) : (
        <>
          <Ionicons name="logo-apple" size={20} color={Colors.text} />
          <Text className="text-base font-semibold text-lucrei-text">Continuar com Apple</Text>
        </>
      )}
    </Pressable>
  );
}
