import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { ApiError, type AuthUser, login as apiLogin, me as apiMe, signup as apiSignup } from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/token-storage';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; token: string; user: AuthUser };

type AuthResult = { ok: true } | { ok: false; message: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
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

  async function login(email: string, password: string): Promise<AuthResult> {
    try {
      const { token, user } = await apiLogin(email, password);
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

  return <AuthContext.Provider value={{ state, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de um AuthProvider');
  return ctx;
}
