import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthBrandPanel } from '@/components/auth-brand-panel';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { PasswordField } from '@/components/password-field';
import { Sparkline } from '@/components/sparkline';
import { TextField } from '@/components/text-field';
import { requestPasswordReset } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AUTH_SPLIT_MAX_WIDTH, authCapWidth, fullscreenOverlayStyle, useIsDesktopWeb, useModalPresentation } from '@/lib/responsive';
import { useAppTheme } from '@/lib/theme';

const LOGO_LIGHT = require('../../assets/images/lucrei-logo-light.png');
const LOGO_DARK = require('../../assets/images/lucrei-logo.png');

const LOGO_ASPECT = 449 / 153;

const TREND = [18, 32, 27, 41, 38, 55, 49, 68, 63, 82, 76, 93];

type LoginScreenProps = {
  onNavigateToSignup: () => void;
};

function ForgotPasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: Colors } = useAppTheme();
  const modal = useModalPresentation();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (email.length === 0) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Resposta genérica independente de erro, pra não revelar se o e-mail existe.
    }
    setSubmitting(false);
    setSent(true);
  }

  function handleClose() {
    setEmail('');
    setSent(false);
    onClose();
  }

  // Um <Modal> nativo é uma janela Android separada que não participa do
  // resize da Activity quando o teclado abre (é por isso que o
  // KeyboardAvoidingView não tinha efeito nenhum aqui dentro, mesmo com
  // behavior="height"). Em vez de lutar contra isso, renderiza como um
  // overlay normal dentro da própria árvore da tela - assim ele herda o
  // mesmo resize nativo que já funciona no formulário de login principal.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View
      style={fullscreenOverlayStyle}
      className={`${modal.overlayClassName} ${modal.overlayBgClassName}`}>
      <KeyboardAvoidingView behavior="padding">
        <SafeAreaView edges={['bottom']} style={modal.panelWidthStyle} className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">Esqueci minha senha</Text>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View className="p-5">
            {sent ? (
              <Text className="text-sm leading-5 text-lucrei-textMuted">
                Se esse e-mail estiver cadastrado, você vai receber um link pra criar uma nova senha em instantes.
              </Text>
            ) : (
              <>
                <Text className="mb-4 text-sm leading-5 text-lucrei-textMuted">
                  Informe o e-mail da sua conta. Vamos te enviar um link pra criar uma nova senha.
                </Text>
                <TextField
                  label="E-mail"
                  placeholder="seu@email.com"
                  autoCapitalize="none"
                  autoComplete="off"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
                <Pressable
                  onPress={handleSend}
                  disabled={submitting || email.length === 0}
                  className="mt-1 items-center rounded-2xl bg-lucrei-gold py-4"
                  style={{ opacity: submitting || email.length === 0 ? 0.6 : 1 }}>
                  {submitting ? (
                    <ActivityIndicator color={Colors.onGold} />
                  ) : (
                    <Text className="text-base font-semibold text-lucrei-onGold">Enviar link</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

export function LoginScreen({ onNavigateToSignup }: LoginScreenProps) {
  const { login, loginWithGoogle } = useAuth();
  const { scheme, colors: Colors } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const isDesktop = useIsDesktopWeb();
  const logoWidth = 180;
  const logoHeight = logoWidth / LOGO_ASPECT;

  const canSubmit = email.length > 0 && password.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const result = await login(email, password, rememberMe);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
    }
  }

  async function handleGoogleIdToken(idToken: string) {
    setError(null);
    const result = await loginWithGoogle(idToken);
    if (!result.ok) setError(result.message);
  }

  return (
    <SafeAreaView className="flex-1 bg-lucrei-bg" style={isDesktop ? { backgroundColor: '#0A0A0B' } : undefined}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View
          className={isDesktop ? 'flex-1 flex-row' : 'flex-1'}
          style={isDesktop ? { maxWidth: AUTH_SPLIT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : undefined}>
          {isDesktop ? <AuthBrandPanel variant="login" /> : null}

          <ScrollView
            className={isDesktop ? 'flex-1' : undefined}
            contentContainerClassName={
              isDesktop ? 'flex-grow justify-start px-6 pb-10 pt-28' : 'flex-grow justify-center px-6 py-10'
            }
            contentContainerStyle={authCapWidth()}
            keyboardShouldPersistTaps="handled">
            {isDesktop ? null : (
              <View className="items-center">
                <View style={{ width: logoWidth, height: logoHeight }}>
                  <Image
                    source={scheme === 'dark' ? LOGO_DARK : LOGO_LIGHT}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                  />
                </View>
                <View className="mt-2 items-center">
                  <Text className="text-2xl font-bold text-lucrei-gold">+93%</Text>
                  <Sparkline data={TREND} width={260} height={60} />
                </View>
              </View>
            )}

            <View
              className={`rounded-2xl border border-lucrei-border bg-lucrei-surface ${isDesktop ? 'p-7' : 'p-5 mt-8'}`}>
            <TextField
              label="E-mail"
              placeholder="seu@email.com"
              autoCapitalize="none"
              autoComplete="off"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <PasswordField
              label="Senha"
              placeholder="Sua senha"
              value={password}
              onChangeText={setPassword}
              autoComplete="off"
            />

            <View className="mb-2 flex-row items-center justify-between">
              <Pressable onPress={() => setRememberMe((v) => !v)} className="flex-row items-center gap-2" hitSlop={8}>
                <Ionicons
                  name={rememberMe ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={rememberMe ? Colors.gold : Colors.textMuted}
                />
                <Text className="text-sm text-lucrei-textMuted">Lembrar de mim</Text>
              </Pressable>

              <Pressable onPress={() => setForgotPasswordVisible(true)} hitSlop={8}>
                <Text className="text-sm font-medium text-lucrei-gold">Esqueci minha senha</Text>
              </Pressable>
            </View>

            {error ? <Text className="mb-3 text-sm text-lucrei-danger">{error}</Text> : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !canSubmit}
              className="mt-2 items-center rounded-2xl bg-lucrei-gold py-4"
              style={{ opacity: submitting || !canSubmit ? 0.6 : 1 }}>
              {submitting ? (
                <ActivityIndicator color={Colors.onGold} />
              ) : (
                <Text className="text-base font-semibold text-lucrei-onGold">Entrar</Text>
              )}
            </Pressable>
          </View>

          <View className="mt-5 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-lucrei-border" />
            <Text className="text-sm text-lucrei-textMuted">ou</Text>
            <View className="h-px flex-1 bg-lucrei-border" />
          </View>

          <GoogleSignInButton onIdToken={handleGoogleIdToken} onError={setError} />

          <View className="mt-8 flex-row justify-center gap-1">
            <Text className="text-base text-lucrei-textMuted">Ainda não tem conta?</Text>
            <Pressable onPress={onNavigateToSignup} hitSlop={8}>
              <Text className="text-base font-semibold text-lucrei-gold">Criar conta</Text>
            </Pressable>
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <ForgotPasswordModal visible={forgotPasswordVisible} onClose={() => setForgotPasswordVisible(false)} />
    </SafeAreaView>
  );
}
