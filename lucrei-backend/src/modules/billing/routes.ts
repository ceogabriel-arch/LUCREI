import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { getPreapproval } from '../../mercadopago-client';

type WebhookBody = {
  type?: string;
  data?: { id?: string };
};

function verifySignature(xSignature: string | undefined, xRequestId: string | undefined, dataId: string, secret: string) {
  if (!xSignature || !xRequestId) return false;

  const parts: Record<string, string> = {};
  for (const part of xSignature.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key && value) parts[key] = value;
  }
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${parts.ts};`;
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return computed === parts.v1;
}

function mapStatus(mpStatus: string): 'active' | 'past_due' | 'canceled' | null {
  if (mpStatus === 'authorized') return 'active';
  if (mpStatus === 'paused') return 'past_due';
  if (mpStatus === 'cancelled') return 'canceled';
  return null;
}

export async function billingRoutes(app: FastifyInstance) {
  app.post<{ Body: WebhookBody; Querystring: Record<string, string> }>(
    '/billing/mercadopago/webhook',
    async (request, reply) => {
      const type = request.body?.type || request.query.type;
      const dataId = request.body?.data?.id || request.query['data.id'];

      if (!dataId || type !== 'subscription_preapproval') {
        return reply.send({ received: true });
      }

      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      if (secret) {
        const ok = verifySignature(
          request.headers['x-signature'] as string | undefined,
          request.headers['x-request-id'] as string | undefined,
          dataId,
          secret
        );
        if (!ok) {
          return reply.status(401).send({ message: 'Assinatura inválida.' });
        }
      }

      const subscription = await prisma.subscription.findFirst({
        where: { provider: 'mercado_pago', providerSubscriptionId: dataId },
      });
      if (!subscription) {
        return reply.send({ received: true });
      }

      try {
        const preapproval = await getPreapproval(dataId);
        const status = mapStatus(preapproval.status);
        if (status) {
          await prisma.subscription.update({ where: { id: subscription.id }, data: { status } });
          await prisma.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: status } });
        }
      } catch (err) {
        app.log.error(err);
      }

      return reply.send({ received: true });
    }
  );
}
