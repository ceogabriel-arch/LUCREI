const BASE_URL = 'https://api.mercadopago.com';

function accessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurada.');
  }
  return token;
}

async function mpRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken()}`,
      ...init.headers,
    },
  });

  const body: any = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || body?.error || `Erro Mercado Pago (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export type Preapproval = {
  id: string;
  init_point: string;
  status: string;
};

export function createPreapproval(params: {
  reason: string;
  payerEmail: string;
  value: number;
  trialDays: number;
  externalReference: string;
  backUrl: string;
  frequencyMonths?: number;
}) {
  return mpRequest<Preapproval>('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: params.reason,
      external_reference: params.externalReference,
      payer_email: params.payerEmail,
      back_url: params.backUrl,
      auto_recurring: {
        frequency: params.frequencyMonths ?? 1,
        frequency_type: 'months',
        transaction_amount: params.value,
        currency_id: 'BRL',
        ...(params.trialDays > 0
          ? { free_trial: { frequency: params.trialDays, frequency_type: 'days' } }
          : {}),
      },
    }),
  });
}

export function updatePreapprovalValue(id: string, value: number) {
  return mpRequest<Preapproval>(`/preapproval/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ auto_recurring: { transaction_amount: value } }),
  });
}

export function cancelPreapproval(id: string) {
  return mpRequest<Preapproval>(`/preapproval/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
}

export function getPreapproval(id: string) {
  return mpRequest<Preapproval>(`/preapproval/${id}`);
}

export type PixPayment = {
  id: number;
  status: string;
  status_detail: string;
  date_of_expiration: string;
  point_of_interaction: {
    transaction_data: {
      qr_code: string;
      qr_code_base64: string;
    };
  };
};

export function createPixPayment(params: {
  amount: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  expiresInMinutes: number;
  // Precisa ser estável entre tentativas do MESMO cobrança lógica (ex: nossa
  // gravação no banco falhar depois do Mercado Pago já ter criado o
  // pagamento, e a chamada ser repetida) - senão o Mercado Pago não tem como
  // saber que é uma repetição e cria um segundo Pix real. Não pode ser só o
  // externalReference puro porque isso é estável entre CICLOS diferentes
  // (ex: mesma assinatura, mês que vem) e acabaria colando o pagamento novo
  // no de um ciclo antigo.
  idempotencyKey: string;
}) {
  const expiresAt = new Date(Date.now() + params.expiresInMinutes * 60 * 1000);
  return mpRequest<PixPayment>('/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': params.idempotencyKey },
    body: JSON.stringify({
      transaction_amount: params.amount,
      description: params.description,
      payment_method_id: 'pix',
      payer: { email: params.payerEmail },
      external_reference: params.externalReference,
      date_of_expiration: expiresAt.toISOString(),
    }),
  });
}

// Chave de idempotência determinística: estável o bastante pra deduplicar
// uma repetição da mesma tentativa de cobrança (ex: retry depois de um
// timeout), mas muda a cada dia - como o Pix expira em 24h, isso garante que
// pedir a cobrança de novo depois de expirada gera um QR code novo em vez de
// devolver pra sempre o mesmo pagamento (já vencido) de uma tentativa antiga.
export function pixIdempotencyKey(...parts: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  return [...parts, today].join('-');
}

export function getPayment(id: string) {
  return mpRequest<PixPayment & { status: string }>(`/v1/payments/${id}`);
}
