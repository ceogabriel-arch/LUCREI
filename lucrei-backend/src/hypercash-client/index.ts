const BASE_URL = 'https://api-hypercash.fly.dev';
const DEFAULT_TIMEOUT_MS = 15_000;

function accessToken() {
  const token = process.env.HYPERCASH_API_KEY;
  if (!token) {
    throw new Error('HYPERCASH_API_KEY não configurada.');
  }
  return token;
}

export class HypercashError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HypercashError';
    this.status = status;
  }
}

// Mesmo padrão do cliente da Mercado Pago (timeout + erro tipado com status).
async function hcRequest<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // Confirmado ao vivo: essa API usa "Authorization: Bearer <chave>",
        // não Basic (diferente da API de transações avulsas em
        // api.hypercashbrasil.com.br, que usa Basic com "x:" + secret key).
        Authorization: `Bearer ${accessToken()}`,
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HypercashError('A HyperCash demorou demais pra responder.', 0);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    const message = body?.message || `Erro HyperCash (${res.status})`;
    throw new HypercashError(message, res.status);
  }
  return (body?.data ?? body) as T;
}

// Base de todo valor na nossa aplicação é reais com decimal (Plan.priceCurrent)
// - só a chamada pra HyperCash precisa em centavos (confirmado ao vivo pelo
// evento de teste real: "amount":9990 = R$99,90).
export function priceToCents(amount: number): number {
  return Math.round(amount * 100);
}

export type PaymentLink = {
  id: string;
  checkoutUrl: string | null;
  active: boolean;
  productId: string | null;
};

export type HypercashFrequency = 'monthly' | 'annual';

function toHypercashFrequency(frequency: HypercashFrequency) {
  return frequency === 'annual' ? 'annual' : 'monthly';
}

// Logo oficial (fundo escuro, igual o app) - já pública (usada nos
// e-mails), reaproveitada aqui pra não deixar a página de checkout da
// HyperCash sem nenhuma imagem (reportado ao vivo: aparecia em branco).
const LOGO_URL = 'https://app.lucreiapp.com/email/logo.png';

// Criar um payment-link gera um Produto por trás automaticamente (sem
// imagem nenhuma, por isso a página de checkout aparecia sem foto) - não
// tem como mandar a imagem já na criação do link (campo não existe nesse
// endpoint), só depois, direto no Produto que ele mesmo gerou.
async function setProductImage(productId: string | null) {
  if (!productId) return;
  try {
    await hcRequest(`/v1/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ image: LOGO_URL }),
    });
  } catch {
    // Não falha a criação do link por causa disso - checkout funciona
    // igual, só sem a imagem.
  }
}

export async function createPaymentLink(params: {
  name: string;
  priceCents: number;
  isRecurring: boolean;
  frequency?: HypercashFrequency;
  successRedirectUrl: string;
}) {
  const link = await hcRequest<PaymentLink>('/v1/payment-links', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      availablePaymentMethods: ['credit_card', 'pix'],
      price: params.priceCents,
      isRecurring: params.isRecurring,
      // totalCycles ausente/null = recorrência infinita (até cancelar) -
      // comportamento que já queremos pro plano mensal/anual.
      ...(params.isRecurring ? { frequency: toHypercashFrequency(params.frequency ?? 'monthly') } : {}),
      successRedirectUrl: params.successRedirectUrl,
    }),
  });
  await setProductImage(link.productId);
  return link;
}

// Usado só pro upgrade proporcional (cobrança avulsa, não recorrente) - ver
// lib/plan-upgrade.ts.
export function createOneTimePaymentLink(params: { name: string; priceCents: number; successRedirectUrl: string }) {
  return createPaymentLink({ ...params, isRecurring: false });
}

// Desativa o link (ninguém mais consegue pagar por ele) - não cancela uma
// assinatura já ativa criada a partir dele, isso é cancelSubscription.
export function deactivatePaymentLink(id: string) {
  return hcRequest<PaymentLink>(`/v1/payment-links/${id}/toggle-status`, { method: 'POST' });
}

export type HypercashSubscription = {
  id: string;
  status: 'active' | 'paused' | 'cancelled' | 'expired' | 'payment_failed';
  paymentLinkId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
};

export function getSubscription(id: string) {
  return hcRequest<HypercashSubscription>(`/v1/subscriptions/${id}`);
}

// A assinatura de verdade só existe na HyperCash depois do 1º pagamento -
// antes disso só existe o payment-link. Em vez de trocar o id guardado no
// nosso banco de "link" pra "assinatura" assim que o 1º pagamento confirma
// (mais um estado pra sincronizar e errar), guardamos sempre o id do link
// (conhecido na hora da criação, estável pra sempre) e resolvemos a
// assinatura de verdade por esse filtro sempre que precisamos agir nela
// (cancelar, reconciliar).
export async function getSubscriptionByPaymentLinkId(paymentLinkId: string): Promise<HypercashSubscription | null> {
  const list = await hcRequest<HypercashSubscription[]>(
    `/v1/subscriptions?paymentLinkId=${encodeURIComponent(paymentLinkId)}&limit=1`
  );
  return list[0] ?? null;
}

export function cancelSubscription(id: string) {
  return hcRequest<{ id: string; cancelledAt: string }>(`/v1/subscriptions/${id}`, { method: 'DELETE' });
}
