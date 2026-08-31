import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PasswordField } from '@/components/password-field';
import { PremiumBackground } from '@/components/premium-background';
import { Sparkline } from '@/components/sparkline';
import { TextField } from '@/components/text-field';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { webCapWidth } from '@/lib/responsive';

const LOGO_ASPECT = 449 / 153;
const LOGO_WIDTH = 220;
const LOGO_HEIGHT = LOGO_WIDTH / LOGO_ASPECT;

const TREND = [18, 32, 27, 41, 38, 55, 49, 68, 63, 82, 76, 93];

type LoginScreenProps = {
  onNavigateToSignup: () => void;
};

export function LoginScreen({ onNavigateToSignup }: LoginScreenProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.length > 0 && password.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-lucrei-bg">
      <PremiumBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, ...webCapWidth() }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}>
          <View className="flex-1 items-center justify-center px-6">
            <View style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}>
              <Image
                source={require('../../assets/images/lucrei-logo.png')}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
              />
            </View>

            <View className="mt-2 items-center">
              <Text className="text-2xl font-bold text-lucrei-gold">+93%</Text>
              <Sparkline data={TREND} width={260} height={60} />
            </View>
          </View>

          <BlurView
            intensity={45}
            tint="dark"
            style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}
            className="border-x border-t border-lucrei-border">
            <View className="px-6 pb-8 pt-7">
              <TextField
                label="E-mail"
                placeholder="seu@email.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <PasswordField
                label="Senha"
                placeholder="Sua senha"
                value={password}
                onChangeText={setPassword}
                autoComplete="password"
              />

              <Pressable className="mb-2 self-end" hitSlop={8}>
                <Text className="text-xs font-medium text-lucrei-gold">Esqueci minha senha</Text>
              </Pressable>

              {error ? <Text className="mb-3 text-sm text-lucrei-danger">{error}</Text> : null}

              <Pressable
                onPress={handleSubmit}
                disabled={submitting || !canSubmit}
                className="mt-2 items-center rounded-2xl bg-lucrei-gold py-4"
                style={{ opacity: submitting || !canSubmit ? 0.6 : 1 }}>
                {submitting ? (
                  <ActivityIndicator color={Colors.bg} />
                ) : (
                  <Text className="text-base font-semibold text-lucrei-bg">Entrar</Text>
                )}
              </Pressable>

              <View className="mt-6 flex-row justify-center gap-1">
                <Text className="text-sm text-lucrei-textMuted">Ainda não tem conta?</Text>
                <Pressable onPress={onNavigateToSignup} hitSlop={8}>
                  <Text className="text-sm font-semibold text-lucrei-gold">Criar conta</Text>
                </Pressable>
              </View>
            </View>
          </BlurView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
