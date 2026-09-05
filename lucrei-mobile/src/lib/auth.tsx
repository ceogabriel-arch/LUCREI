import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import {
  ApiError,
  type AuthUser,
  cancelPlan as apiCancelPlan,
  changePassword as apiChangePassword,
  deleteAccount as apiDeleteAccount,
  googleAuth as apiGoogleAuth,
  login as apiLogin,
  me as apiMe,
  selectPlan as apiSelectPlan,
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
  | { ok: true; checkoutUrl: string | null; trialEndsAt: string | null }
  | { ok: false; message: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthResult>;
  loginWithGoogle: (idToken: string) => Promise<AuthResult>;
  signup: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  updateName: (name: string) => Promise<AuthResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  deleteAccount: (password: string) => Promise<AuthResult>;
  selectPlan: (key: string) => Promise<SelectPlanResult>;
  cancelPlan: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

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

  async function login(email: string, password: string, rememberMe = true): Promise<AuthResult> {
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
  }

  async function loginWithGoogle(idToken: string): Promise<AuthResult> {
    try {
      const { token, user } = await apiGoogleAuth(idToken);
      await setToken(token);
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function signup(name: string, email: string, password: string): Promise<AuthResult> {
    try {
      const { token, user } = await apiSignup(name, email, password);
      await setToken(token);
      setState({ status: 'authenticated', token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function logout() {
    await clearToken();
    setState({ status: 'unauthenticated' });
  }

  async function updateName(name: string): Promise<AuthResult> {
    if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
    try {
      const user = await apiUpdateName(state.token, name);
      setState({ status: 'authenticated', token: state.token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
    if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
    try {
      const { token } = await apiChangePassword(state.token, currentPassword, newPassword);
      // Trocar a senha invalida o token anterior no backend - só re-persiste
      // se já havia um token salvo (login com "lembrar de mim" ou signup).
      if (await getToken()) {
        await setToken(token);
      }
      setState({ status: 'authenticated', token, user: state.user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function deleteAccount(password: string): Promise<AuthResult> {
    if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
    try {
      await apiDeleteAccount(state.token, password);
      await clearToken();
      setState({ status: 'unauthenticated' });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function selectPlan(key: string): Promise<SelectPlanResult> {
    if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
    try {
      const { checkoutUrl, ...user } = await apiSelectPlan(state.token, key);
      setState({ status: 'authenticated', token: state.token, user });
      return { ok: true, checkoutUrl, trialEndsAt: user.trialEndsAt };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  async function cancelPlan(): Promise<AuthResult> {
    if (state.status !== 'authenticated') return { ok: false, message: 'Não autenticado.' };
    try {
      const user = await apiCancelPlan(state.token);
      setState({ status: 'authenticated', token: state.token, user });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
    }
  }

  return (
    <AuthContext.Provider
      value={{
        state,
        login,
        loginWithGoogle,
        signup,
        logout,
        updateName,
        changePassword,
        deleteAccount,
        selectPlan,
        cancelPlan,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de um AuthProvider');
  return ctx;
}
