import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

import { prisma } from './prisma';

const BUNDLE_ID = 'com.lucreiapp.mobile';

// Mesma lista que o plano real (ver Plan no schema) - "enterprise" é sob
// consulta e nunca vendido via IAP, por isso não entra aqui.
export const APPLE_PRODUCT_TO_PLAN_KEY: Record<string, string> = {
  'com.lucreiapp.mobile.sub.start': 'start',
  'com.lucreiapp.mobile.sub.start_annual': 'start_annual',
  'com.lucreiapp.mobile.sub.pro': 'pro',
  'com.lucreiapp.mobile.sub.pro_annual': 'pro_annual',
  'com.lucreiapp.mobile.sub.master': 'master',
  'com.lucreiapp.mobile.sub.master_annual': 'master_annual',
};

export const PLAN_KEY_TO_APPLE_PRODUCT: Record<string, string> = Object.fromEntries(
  Object.entries(APPLE_PRODUCT_TO_PLAN_KEY).map(([productId, planKey]) => [planKey, productId])
);

function getEnvironment(): Environment {
  return process.env.APPLE_IAP_ENV === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

function getAppAppleId(): number | undefined {
  const raw = process.env.APPLE_APP_APPLE_ID;
  return raw ? Number(raw) : undefined;
}

const verifierPromises = new Map<Environment, Promise<SignedDataVerifier>>();

// A Apple não publica as raízes num JWKS consultável (diferente do Sign in
// with Apple, ver auth/routes.ts) - são certificados baixados uma vez de
// apple.com/certificateauthority e guardados no repo (ver apple-certs/).
function getVerifierFor(environment: Environment): Promise<SignedDataVerifier> {
  let promise = verifierPromises.get(environment);
  if (!promise) {
    promise = (async () => {
      const certPath = path.join(__dirname, 'apple-certs', 'AppleRootCA-G3.cer');
      const rootCert = fs.readFileSync(certPath);
      return new SignedDataVerifier([rootCert], environment === Environment.PRODUCTION, environment, BUNDLE_ID, getAppAppleId());
    })();
    verifierPromises.set(environment, promise);
  }
  return promise;
}

export function getSignedDataVerifier(): Promise<SignedDataVerifier> {
  return getVerifierFor(getEnvironment());
}

// TestFlight e a App Review da Apple SEMPRE compram no Sandbox, mesmo num
// build/app configurado como Production (é assim que a própria Apple testa
// apps "de verdade" antes de aprovar) - um verifier configurado só pra
// Production rejeita essa transação com INVALID_ENVIRONMENT. Por isso toda
// verificação tenta primeiro no ambiente configurado e, só nesse erro
// específico, tenta de novo no outro ambiente, em vez de falhar na hora
// (foi exatamente isso que reprovou o app na App Review - guideline 2.1(b)).
function otherEnvironment(environment: Environment): Environment {
  return environment === Environment.PRODUCTION ? Environment.SANDBOX : Environment.PRODUCTION;
}

function isInvalidEnvironment(err: unknown): boolean {
  return err instanceof VerificationException && err.status === VerificationStatus.INVALID_ENVIRONMENT;
}

export async function verifyAppleTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload> {
  const primary = getEnvironment();
  try {
    return await (await getVerifierFor(primary)).verifyAndDecodeTransaction(signedTransactionInfo);
  } catch (err) {
    if (!isInvalidEnvironment(err)) throw err;
    return (await getVerifierFor(otherEnvironment(primary))).verifyAndDecodeTransaction(signedTransactionInfo);
  }
}

export async function verifyAppleNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  const primary = getEnvironment();
  try {
    return await (await getVerifierFor(primary)).verifyAndDecodeNotification(signedPayload);
  } catch (err) {
    if (!isInvalidEnvironment(err)) throw err;
    return (await getVerifierFor(otherEnvironment(primary))).verifyAndDecodeNotification(signedPayload);
  }
}

let apiClient: AppStoreServerAPIClient | null = null;

// Só usado pra reconciliação (getAllSubscriptionStatuses) - a verificação de
// compra em si (verify-purchase/webhook) não depende disso, só do verifier acima.
export function getAppStoreServerAPIClient(): AppStoreServerAPIClient {
  if (!apiClient) {
    const issuerId = process.env.APPLE_ISSUER_ID;
    const keyId = process.env.APPLE_KEY_ID;
    // .p8 colado no .env como uma linha só, com \n literal no lugar das
    // quebras de linha de verdade - convenção comum pra chave PEM em env var.
    const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!issuerId || !keyId || !privateKey) {
      throw new Error('Credenciais da App Store Server API não configuradas (APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY).');
    }
    apiClient = new AppStoreServerAPIClient(privateKey, keyId, issuerId, BUNDLE_ID, getEnvironment());
  }
  return apiClient;
}

// Mesmo princípio de mapHypercashStatus (subscription-sync.ts): usa o status
// que a própria Apple manda como fonte da verdade, em vez de decidir a
// partir do nome do evento/notificationType.
export function mapAppleStatus(status: Status): 'active' | 'past_due' | 'canceled' {
  if (status === Status.ACTIVE) return 'active';
  if (status === Status.BILLING_RETRY || status === Status.BILLING_GRACE_PERIOD) return 'past_due';
  return 'canceled'; // EXPIRED ou REVOKED
}

export function planKeyForAppleProduct(productId: string | undefined): string | null {
  if (!productId) return null;
  return APPLE_PRODUCT_TO_PLAN_KEY[productId] ?? null;
}

// Gerado uma única vez por conta e reaproveitado em toda compra Apple dela -
// é o valor que vai como appAccountToken pro StoreKit (ver /billing/apple/app-account-token)
// e que volta em toda transação/notificação, permitindo achar a conta certa
// sem depender da ordem de chegada entre a compra no app e o webhook.
export async function getOrCreateAppleAppAccountToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.appleAppAccountToken) return user.appleAppAccountToken;

  const token = crypto.randomUUID();
  await prisma.user.update({ where: { id: userId }, data: { appleAppAccountToken: token } });
  return token;
}

export function expiresDateToDate(expiresDate: number | undefined): Date | null {
  return expiresDate ? new Date(expiresDate) : null;
}

export type { JWSTransactionDecodedPayload };
