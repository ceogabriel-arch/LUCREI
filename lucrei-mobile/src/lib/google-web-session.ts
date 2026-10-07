// Só faz sentido na web (native usa @react-native-google-signin/google-signin,
// que já é sign-out explícito dentro de google-auth.ts antes de cada novo
// login). Na web, o botão do Google Identity Services (ver
// google-signin-button.web.tsx) guarda a sessão ativa do navegador - sair do
// Lucrei limpava só o token do Lucrei, então o botão "Continuar com Google"
// voltava direto pra mesma conta no próximo load, sem deixar escolher outra.
// disableAutoSelect() evita o One Tap automático, mas não derruba a sessão
// guardada; revoke() é o que de fato força escolher conta de novo da próxima
// vez. Tipagem solta de propósito (não é a mesma declaração global do botão)
// pra não precisar duplicar/mesclar o `declare global` daquele arquivo.
export function forgetGoogleWebSession(email: string | null) {
  if (typeof window === 'undefined') return;
  const google = (
    window as unknown as {
      google?: {
        accounts?: {
          id?: {
            disableAutoSelect?: () => void;
            revoke?: (email: string, callback: (response: unknown) => void) => void;
          };
        };
      };
    }
  ).google;

  google?.accounts?.id?.disableAutoSelect?.();
  if (email) google?.accounts?.id?.revoke?.(email, () => {});
}
