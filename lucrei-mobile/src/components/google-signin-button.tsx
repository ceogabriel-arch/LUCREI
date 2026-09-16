import Ionicons from '@expo/vector-icons/Ionicons';
import * as Sentry from '@sentry/react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { signInWithGoogle } from '@/lib/google-auth';
import { useColors } from '@/lib/theme';

export function GoogleSignInButton({
  onIdToken,
  onError,
}: {
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  const Colors = useColors();
  const [submitting, setSubmitting] = useState(false);

  async function handlePress() {
    setSubmitting(true);
    try {
      const idToken = await signInWithGoogle();
      if (idToken) onIdToken(idToken);
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;
      Sentry.captureException(err, { tags: { flow: 'google_sign_in', google_error_code: code } });
      onError('Não foi possível entrar com o Google agora.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={submitting}
      className="mt-5 flex-row items-center justify-center gap-2 rounded-2xl border border-lucrei-border bg-lucrei-surface py-4"
      style={{ opacity: submitting ? 0.6 : 1 }}>
      {submitting ? (
        <ActivityIndicator color={Colors.text} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={Colors.text} />
          <Text className="text-base font-semibold text-lucrei-text">Continuar com Google</Text>
        </>
      )}
    </Pressable>
  );
}
