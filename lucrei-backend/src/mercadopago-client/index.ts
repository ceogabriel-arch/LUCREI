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
}) {
  return mpRequest<Preapproval>('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: params.reason,
      external_reference: params.externalReference,
      payer_email: params.payerEmail,
      back_url: params.backUrl,
      auto_recurring: {
        frequency: 1,
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
