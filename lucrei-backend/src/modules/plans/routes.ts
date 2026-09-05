import type { FastifyInstance } from 'fastify';

import * as mercadopago from '../../mercadopago-client';
import { prisma } from '../../lib/prisma';
import { serializeUser, userWithPlan } from './serialize-user';

const TRIAL_DAYS = 15;
// Só o plano de entrada dá período de teste grátis; os demais cobram
// a partir da primeira cobrança.
const TRIAL_ELIGIBLE_PLAN_KEY = 'start';
const BACK_URL = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';

const selectPlanSchema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1 },
  },
} as const;

type SelectPlanBody = { key: string };

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function plansRoutes(app: FastifyInstance) {
  app.get('/plans', async () => {
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    return {
      plans: plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        salesLimit: plan.salesLimit,
        integrationsLimit: plan.integrationsLimit,
        priceOriginal: plan.priceOriginal !== null ? Number(plan.priceOriginal) : null,
        priceCurrent: plan.priceCurrent !== null ? Number(plan.priceCurrent) : null,
      })),
    };
  });

  app.post<{ Body: SelectPlanBody }>(
    '/plans/select',
    { onRequest: [app.authenticate], schema: { body: selectPlanSchema } },
    async (request, reply) => {
      const plan = await prisma.plan.findUnique({ where: { key: request.body.key } });
      if (!plan) {
        return reply.status(404).send({ message: 'Plano não encontrado.' });
      }
      if (plan.priceCurrent === null) {
        return reply.status(400).send({ message: 'Este plano é sob consulta. Fale com nosso time de vendas.' });
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });

      const existingSubscription = await prisma.subscription.findFirst({
        where: { userId: user.id, provider: 'mercado_pago' },
        orderBy: { createdAt: 'desc' },
      });

      let checkoutUrl: string | null = null;
      // Preservado por padrão - no caminho de upgrade (assinatura já existe),
      // o trial (se houver) já foi travado na Mercado Pago na criação
      // original e não muda por trocar de plano.
      let trialEndsAt = user.trialEndsAt;

      try {
        const description = `Lucrei - Plano ${plan.name}`;

        if (existingSubscription?.providerSubscriptionId && existingSubscription.status !== 'canceled') {
          await mercadopago.updatePreapprovalValue(
            existingSubscription.providerSubscriptionId,
            Number(plan.priceCurrent)
          );
          checkoutUrl = existingSubscription.lastInvoiceUrl;

          await prisma.subscription.update({
            where: { id: existingSubscription.id },
            data: { status: 'trialing' },
          });
        } else {
          // Uma loja Shopee que já consumiu o teste grátis (em qualquer conta
          // Lucrei - o shopeeShopId é único e persiste ao trocar de dono) não
          // libera um novo período de teste, mesmo numa conta nova.
          const taintedShop = plan.key === TRIAL_ELIGIBLE_PLAN_KEY && !trialEndsAt
            ? await prisma.shop.findFirst({ where: { userId: user.id, trialConsumedAt: { not: null } } })
            : null;
          const eligibleForTrial = plan.key === TRIAL_ELIGIBLE_PLAN_KEY && !taintedShop;
          const trialDays = eligibleForTrial ? TRIAL_DAYS : 0;
          if (eligibleForTrial && !trialEndsAt) {
            trialEndsAt = addDays(new Date(), TRIAL_DAYS);
          } else if (!eligibleForTrial) {
            trialEndsAt = null;
          }
          const preapproval = await mercadopago.createPreapproval({
            reason: description,
            payerEmail: user.email,
            value: Number(plan.priceCurrent),
            trialDays,
            externalReference: user.id,
            backUrl: `${BACK_URL}/planos`,
          });
          checkoutUrl = preapproval.init_point;

          await prisma.subscription.create({
            data: {
              userId: user.id,
              provider: 'mercado_pago',
              providerSubscriptionId: preapproval.id,
              status: 'trialing',
              currentPeriodEnd: trialEndsAt,
              lastInvoiceUrl: checkoutUrl,
            },
          });

          if (trialDays > 0) {
            await prisma.shop.updateMany({
              where: { userId: user.id, trialConsumedAt: null },
              data: { trialConsumedAt: new Date() },
            });
          }
        }
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Não foi possível configurar a cobrança agora. Tente novamente em instantes.' });
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { planId: plan.id, subscriptionStatus: 'trialing', trialEndsAt },
        include: userWithPlan,
      });

      return reply.send({ ...serializeUser(updated), checkoutUrl });
    }
  );

  app.get('/plans/checkout-url', { onRequest: [app.authenticate] }, async (request, reply) => {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: request.user.sub, provider: 'mercado_pago' },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ checkoutUrl: subscription?.lastInvoiceUrl ?? null });
  });

  app.post('/plans/cancel', { onRequest: [app.authenticate] }, async (request, reply) => {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: request.user.sub, provider: 'mercado_pago', status: { not: 'canceled' } },
      orderBy: { createdAt: 'desc' },
    });

    if (subscription?.providerSubscriptionId) {
      try {
        await mercadopago.cancelPreapproval(subscription.providerSubscriptionId);
      } catch (err) {
        app.log.error(err);
      }
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } });
    }

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { subscriptionStatus: 'canceled' },
      include: userWithPlan,
    });
    return reply.send(serializeUser(user));
  });
}
