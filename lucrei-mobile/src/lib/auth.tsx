import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  type AuthUser,
  type UserPlan,
  appleAuth as apiAppleAuth,
  cancelPlan as apiCancelPlan,
  changePassword as apiChangePassword,
  clearPushToken as apiClearPushToken,
  deleteAccount as apiDeleteAccount,
  googleAuth as apiGoogleAuth,
  login as apiLogin,
  me as apiMe,
  selectPlan as apiSelectPlan,
  setUnauthorizedHandler,
  signup as apiSignup,
  updateDailyGoal as apiUpdateDailyGoal,
  updateName as apiUpdateName,
  verifyApplePurchase as apiVerifyApplePurchase,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { forgetGoogleWebSession } from '@/lib/google-web-session';
import { getRegisteredPushToken, rememberRegisteredPushToken } from '@/lib/push-notifications';
import { clearToken, getToken, setToken } from '@/lib/token-storage';

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  // Tem token salvo, mas o servidor não respondeu na abertura do app (sem
  // internet, deploy, timeout) - NÃO é sessão inválida. Mostra uma tela de
  // "sem conexão / Tentar de novo" em vez de jogar a pessoa no login.
  | { status: 'offline'; token: string }
  | { status: 'authenticated'; token: string; user: AuthUser };

type AuthResult = { ok: true } | { ok: false; message: string };
type SelectPlanResult =
  | { ok: true; checkoutUrl: string | null; upgradeAmount: number | null; trialEndsAt: string | null; plan: UserPlan | null }
  | { ok: false; message: string };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthResult>;
  loginWithGoogle: (idToken: string) => Promise<AuthResult>;
  loginWithApple: (identityToken: string, fullName?: string) => Promise<AuthResult>;
  signup: (name: string, email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  // Tenta de novo restaurar a sessão salva a partir do estado 'offline'.
  retryRestore: () => Promise<void>;
  updateName: (name: string) => Promise<AuthResult>;
  updateDailyGoal: (dailyProfitGoal: number | null) => Promise<AuthResult>;
  changePassword: (currentPassword: string | undefined, newPassword: string) => Promise<AuthResult>;
  deleteAccount: (password?: string) => Promise<AuthResult>;
  selectPlan: (key: string, couponCode?: string) => Promise<SelectPlanResult>;
  cancelPlan: () => Promise<AuthResult>;
  completeAppleIapPurchase: (signedTransactionInfo: string) => Promise<AuthResult>;
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
  const email = state.status === 'authenticated' ? state.user.email : null;
  // Sempre o token mais recente, pra refreshUser conferir depois de um
  // await se ainda é válido aplicar o resultado (ver comentário lá).
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const restoreSession = useCallback(async (token: string) => {
    // Reclamado ao vivo: "toda hora tem que ficar pondo a senha". Causa:
    // qualquer falha aqui (rede instável, deploy do backend, um 500
    // passageiro) derrubava a sessão igual a um token inválido de verdade -
    // só um 401 de verdade (token/tokenVersion realmente inválidos)
    // justifica apagar o token salvo. Pras demais falhas, tenta mais
    // algumas vezes (rede/servidor costuma voltar em segundos) antes de
    // desistir - e mesmo desistindo, mantém o token salvo pra próxima
    // abertura do app tentar de novo sozinha, em vez de pedir senha à toa.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const user = await apiMe(token);
        setState({ status: 'authenticated', token, user });
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearToken();
          setState({ status: 'unauthenticated' });
          return;
        }
        if (attempt === 3) {
          // Antes caía em 'unauthenticated' aqui - quem abria o app sem
          // internet via a tela de login e achava que tinha sido
          // deslogado (o token continuava salvo, mas nada dizia isso).
          setState({ status: 'offline', token });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        setState({ status: 'unauthenticated' });
        return;
      }
      await restoreSession(token);
    })();
  }, [restoreSession]);

  const retryRestore = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setState({ status: 'unauthenticated' });
      return;
    }
    await restoreSession(token);
  }, [restoreSession]);

  // 401 em qualquer requisição autenticada (ver setUnauthorizedHandler em
  // api.ts). Sem isso, trocar a senha em outro aparelho (tokenVersion novo
  // no backend) deixava este aqui "logado mas quebrado": toda tela dava erro
  // e nada mandava pro login. Várias rotas devolvem 401 por motivo de
  // negócio (senha atual errada, compra Apple inválida), então confere com
  // /auth/me antes de derrubar a sessão - só 401 ali é token inválido de
  // verdade. Falha de rede/timeout (status undefined) nunca derruba nada.
  const checkingUnauthorizedRef = useRef(false);
  useEffect(() => {
    setUnauthorizedHandler(async (usedToken) => {
      // Token antigo (ex: requisição que saiu antes de changePassword trocar
      // o token) - não diz nada sobre a sessão atual.
      if (usedToken !== tokenRef.current || checkingUnauthorizedRef.current) return;
      checkingUnauthorizedRef.current = true;
      try {
        await apiMe(usedToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && tokenRef.current === usedToken) {
          await clearToken();
          rememberRegisteredPushToken(null);
          setState({ status: 'unauthenticated' });
          showAlert('Sessão expirada', 'Sua sessão expirou (por exemplo, a senha foi trocada). Entre de novo.');
        }
      } finally {
        checkingUnauthorizedRef.current = false;
      }
    });
    return () => setUnauthorizedHandler(null);
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

  const loginWithApple = useCallback(async (identityToken: string, fullName?: string): Promise<AuthResult> => {
    try {
      const { token, user } = await apiAppleAuth(identityToken, fullName);
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
    // Antes de limpar o token do Lucrei - ver google-web-session.ts pra
    // entender por que isso é necessário na web (o SDK nativo do Google já
    // se resolve sozinho em signInWithGoogle, não precisa disso aqui).
    forgetGoogleWebSession(email);
    // Desvincula o push DESTE aparelho da conta antes de apagar o token -
    // sem isso o celular continuava recebendo as vendas da conta anterior
    // depois de sair. Best-effort e com teto de tempo: sem internet, sair
    // da conta não pode travar esperando o servidor.
    const pushToken = getRegisteredPushToken();
    if (token && pushToken) {
      await Promise.race([
        apiClearPushToken(token, pushToken).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    rememberRegisteredPushToken(null);
    await clearToken();
    setState({ status: 'unauthenticated' });
  }, [email, token]);

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

  const updateDailyGoal = useCallback(
    async (dailyProfitGoal: number | null): Promise<AuthResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const user = await apiUpdateDailyGoal(token, dailyProfitGoal);
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
    async (key: string, couponCode?: string): Promise<SelectPlanResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const { checkoutUrl, upgradeAmount, ...user } = await apiSelectPlan(token, key, couponCode);
        setState({ status: 'authenticated', token, user });
        return {
          ok: true,
          checkoutUrl: checkoutUrl ?? null,
          upgradeAmount: upgradeAmount ?? null,
          trialEndsAt: user.trialEndsAt,
          plan: user.plan,
        };
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
      // Reportado ao vivo: apertar "Sair da conta" enquanto essa chamada
      // (disparada em segundo plano pelo useFocusEffect da Início) ainda
      // estava em voo fazia o resultado chegar DEPOIS do logout e
      // sobrescrever o estado "deslogado" de volta pra "logado", usando o
      // token antigo (o JWT em si continua válido até expirar - logout só
      // limpa o storage local, não revoga o token no servidor). Sem isso
      // persistir (localStorage já estava limpo), mas a tela ficava presa
      // de volta no dashboard até atualizar a página. Confere se esse
      // ainda é o token corrente antes de aplicar o resultado.
      if (tokenRef.current !== token) return;
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

  const completeAppleIapPurchase = useCallback(
    async (signedTransactionInfo: string): Promise<AuthResult> => {
      if (!token) return { ok: false, message: 'Não autenticado.' };
      try {
        const user = await apiVerifyApplePurchase(token, signedTransactionInfo);
        setState({ status: 'authenticated', token, user });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof ApiError ? err.message : 'Algo deu errado.' };
      }
    },
    [token]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      loginWithGoogle,
      loginWithApple,
      signup,
      logout,
      retryRestore,
      updateName,
      updateDailyGoal,
      changePassword,
      deleteAccount,
      selectPlan,
      cancelPlan,
      completeAppleIapPurchase,
      refreshUser,
    }),
    [
      state,
      login,
      loginWithGoogle,
      loginWithApple,
      signup,
      logout,
      retryRestore,
      updateName,
      updateDailyGoal,
      changePassword,
      deleteAccount,
      selectPlan,
      cancelPlan,
      completeAppleIapPurchase,
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
