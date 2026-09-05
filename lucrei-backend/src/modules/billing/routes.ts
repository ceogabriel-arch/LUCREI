import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { ensureCurrentPixCharge } from '../../lib/pix-billing';
import { formatBRL, sendPushNotification } from '../../lib/push-notifications';
import { mapMercadoPagoStatus } from '../../lib/subscription-sync';
import { getPayment, getPreapproval } from '../../mercadopago-client';

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
  return computed.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(parts.v1));
}

async function handlePreapprovalEvent(app: FastifyInstance, dataId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { provider: 'mercado_pago', providerSubscriptionId: dataId },
  });
  if (!subscription) return;

  try {
    const preapproval = await getPreapproval(dataId);
    const status = mapMercadoPagoStatus(preapproval.status);
    if (status) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status } });
      await prisma.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: status } });
    }
  } catch (err) {
    app.log.error(err);
  }
}

async function handlePaymentEvent(app: FastifyInstance, dataId: string) {
  const charge = await prisma.pixCharge.findUnique({ where: { mercadoPagoPaymentId: dataId } });
  if (!charge || charge.status === 'approved') return;

  try {
    const payment = await getPayment(dataId);
    if (payment.status !== 'approved') return;

    const subscription = await prisma.subscription.update({
      where: { id: charge.subscriptionId },
      data: { status: 'active', currentPeriodEnd: charge.periodEnd },
    });
    await prisma.pixCharge.update({ where: { id: charge.id }, data: { status: 'approved', paidAt: new Date() } });
    const user = await prisma.user.update({
      where: { id: subscription.userId },
      data: { subscriptionStatus: 'active' },
    });

    if (user.pushToken) {
      await sendPushNotification(
        user.pushToken,
        'Pagamento confirmado! 🎉',
        `Recebemos seu Pix de ${formatBRL(Number(charge.amount))}. Sua assinatura Lucrei está ativa.`
      ).catch((err) => app.log.error(err));
    }
  } catch (err) {
    app.log.error(err);
  }
}

export async function billingRoutes(app: FastifyInstance) {
  app.post<{ Body: WebhookBody; Querystring: Record<string, string> }>(
    '/billing/mercadopago/webhook',
    async (request, reply) => {
      const type = request.body?.type || request.query.type;
      const dataId = request.body?.data?.id || request.query['data.id'];

      if (!dataId || (type !== 'subscription_preapproval' && type !== 'payment')) {
        return reply.send({ received: true });
      }

      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      if (!secret) {
        app.log.error('MERCADOPAGO_WEBHOOK_SECRET não configurada — recusando webhook da Mercado Pago.');
        return reply.status(500).send({ message: 'Servidor não configurado para validar webhooks.' });
      }
      const ok = verifySignature(
        request.headers['x-signature'] as string | undefined,
        request.headers['x-request-id'] as string | undefined,
        dataId,
        secret
      );
      if (!ok) {
        return reply.status(401).send({ message: 'Assinatura inválida.' });
      }

      if (type === 'subscription_preapproval') {
        await handlePreapprovalEvent(app, dataId);
      } else {
        await handlePaymentEvent(app, dataId);
      }

      return reply.send({ received: true });
    }
  );

  app.get('/billing/pix/current', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      const pix = await ensureCurrentPixCharge(request.user.sub);
      return reply.send({ pix });
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ message: 'Não foi possível verificar o Pix agora. Tente novamente em instantes.' });
    }
  });
}
