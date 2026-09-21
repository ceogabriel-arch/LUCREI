import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type AuthUser,
  type PixCharge,
  type UserPlan,
  cancelPlan as apiCancelPlan,
  changePassword as apiChangePassword,
  deleteAccount as apiDeleteAccount,
  googleAuth as apiGoogleAuth,
  login as apiLogin,
  me as apiMe,
  selectPlan as apiSelectPlan,
  selectPlanPix as apiSelectPlanPix,
  signup as apiSignup,
  updateName as apiUpdateName,
} from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/token-storage';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; token: string; user: AuthUser };

type AuthResult = { ok: true } | { ok: false; message: string };
type SelectPlanResult =
  | { ok: true; checkoutUrl: string | null; trialEndsAt: string | null; pix: PixCharge | null; plan: UserPlan | null }
  | { ok: false; message: string };
type SelectPlanPixResult =
  | { ok: true; pix: PixCharge | null; plan: UserPlan | null }
  | { ok: false; message: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthResult>;
  loginWithGoogle: (idToken: string) => Promise<AuthResult>;
  signup: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  updateName: (name: string) => Promise<AuthResult>;
  changePassword: (currentPassword: string | undefined, newPassword: string) => Promise<AuthResult>;
  deleteAccount: (password?: string) => Promise<AuthResult>;
  selectPlan: (key: string) => Promise<SelectPlanResult>;
  selectPlanPix: (key: string) => Promise<SelectPlanPixResult>;
  cancelPlan: () => Promise<AuthResult>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Todo método abaixo que só precisa do token (não do objeto "user" inteiro)
  // usa essa string estável como dependência do useCallback, em vez de
  // "state" inteiro - "state" vira um objeto novo a cada setState, mesmo
  // com os mesmos dados, então dependeria dele recriava a função sempre.
  // Isso importa de verdade pro refreshUser: ele é chamado de dentro de um
  // useFocusEffect (tela de Início), que reexecuta o callback sempre que a
  // referência dele muda enquanto a tela está em foco - sem essa
  // estabilidade, refreshUser() → novo "state" → novo refreshUser → dispara
  // o useFocusEffect nele mesmo de novo → chama refreshUser() de novo, sem
  // parar.
  const token = state.status === 'authenticated' ? state.token : null;

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        setState({ status: 'unauthenticated' });
        return;
      }
      try {
        const user = await apiMe(token);
        setState({ status: 'authenticated', token, user });
      } catch {
        await clearToken();
        setState({ status: 'unauthenticated' });
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = true): Promise<AuthResult> => {
    try {
      const { token, user } = await apiLogin(email, password);
      if (rememberMe) {
        await setToken(token);
      }
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string): Promise<AuthResult> => {
    try {
      const { token, user } = await apiGoogleAuth(idToken);
      await setToken(token);
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string): Promise<AuthResult> => {
    try {
      const { token, user } = await apiSignup(name, email, password);
      await setToken(token);
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setState({ status: 'unauthenticated' });
  }, []);

  const updateName = useCallback(
    async (name: string): Promise<AuthResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const user = await apiUpdateName(token, name);
        setState({ status: 'authenticated', token, user });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [token]
  );

  const changePassword = useCallback(
    async (currentPassword: string | undefined, newPassword: string): Promise<AuthResult> => {
      if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
      try {
        const { token } = await apiChangePassword(state.token, currentPassword, newPassword);
        // Trocar a senha invalida o token anterior no backend - só re-persiste
        // se já havia um token salvo (login com "lembrar de mim" ou signup).
        if (await getToken()) {
          await setToken(token);
        }
        // Definir uma senha agora torna hasPassword true no backend - atualiza
        // localmente também, senão "Excluir conta" continuaria achando que a
        // conta não tem senha até o próximo /auth/me.
        setState({ status: 'authenticated', token, user: { ...state.user, hasPassword: true } });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [state]
  );

  const deleteAccount = useCallback(
    async (password?: string): Promise<AuthResult> => {
      if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
      try {
        await apiDeleteAccount(state.token, password);
        await clearToken();
        setState({ status: 'unauthenticated' });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [state]
  );

  const selectPlan = useCallback(
    async (key: string): Promise<SelectPlanResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const { checkoutUrl, pix, ...user } = await apiSelectPlan(token, key);
        setState({ status: 'authenticated', token, user });
        return {
          ok: true,
          checkoutUrl: checkoutUrl ?? null,
          trialEndsAt: user.trialEndsAt,
          pix: pix ?? null,
          plan: user.plan,
        };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [token]
  );

  const selectPlanPix = useCallback(
    async (key: string): Promise<SelectPlanPixResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const { pix, ...user } = await apiSelectPlanPix(token, key);
        setState({ status: 'authenticated', token, user });
        return { ok: true, pix, plan: user.plan };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [token]
  );

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const user = await apiMe(token);
      setState({ status: 'authenticated', token, user });
    } catch {
      // Silencioso - só usado pra polling em segundo plano (ex: tela de Pix
      // esperando confirmação de pagamento).
    }
  }, [token]);

  const cancelPlan = useCallback(async (): Promise<AuthResult> => {
    if (!token) return { ok: false, message: 'Não autenticado.' };
    try {
      const user = await apiCancelPlan(token);
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      loginWithGoogle,
      signup,
      logout,
      updateName,
      changePassword,
      deleteAccount,
      selectPlan,
      selectPlanPix,
      cancelPlan,
      refreshUser,
    }),
    [
      state,
      login,
      loginWithGoogle,
      signup,
      logout,
      updateName,
      changePassword,
      deleteAccount,
      selectPlan,
      selectPlanPix,
      cancelPlan,
      refreshUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de um AuthProvider');
  return ctx;
}
