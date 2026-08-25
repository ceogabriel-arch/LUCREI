import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PasswordField } from '@/components/password-field';
import { TextField } from '@/components/text-field';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

type SignupScreenProps = {
  onNavigateToLogin: () => void;
};

export function SignupScreen({ onNavigateToLogin }: SignupScreenProps) {
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = name.length > 0 && email.length > 0 && passwordsMatch;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const result = await signup(name, email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-lucrei-bg">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled">
          <View className="items-center">
            <Text className="text-3xl font-bold text-lucrei-text">Criar conta</Text>
            <Text className="mt-1 text-sm text-lucrei-textMuted">Leva menos de um minuto</Text>
          </View>

          <View className="mt-8">
            <TextField label="Nome" placeholder="Seu nome" value={name} onChangeText={setName} />
            <TextField
              label="E-mail"
              placeholder="seu@email.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <PasswordField label="Senha" value={password} onChangeText={setPassword} autoComplete="password-new" />
            <PasswordField
              label="Confirmar senha"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoComplete="password-new"
            />
            {confirmPassword.length > 0 && !passwordsMatch ? (
              <Text className="-mt-2 mb-4 text-xs text-lucrei-danger">As senhas não coincidem.</Text>
            ) : null}

            {error ? <Text className="mb-3 text-sm text-lucrei-danger">{error}</Text> : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !canSubmit}
              className="mt-2 items-center rounded-2xl bg-lucrei-gold py-4"
              style={{ opacity: submitting || !canSubmit ? 0.6 : 1 }}>
              {submitting ? (
                <ActivityIndicator color={Colors.bg} />
              ) : (
                <Text className="text-base font-semibold text-lucrei-bg">Criar conta</Text>
              )}
            </Pressable>
          </View>

          <View className="mt-8 flex-row justify-center gap-1">
            <Text className="text-sm text-lucrei-textMuted">Já tem conta?</Text>
            <Pressable onPress={onNavigateToLogin} hitSlop={8}>
              <Text className="text-sm font-semibold text-lucrei-gold">Entrar</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
