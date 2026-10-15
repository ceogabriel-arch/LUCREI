import type { FastifyInstance } from 'fastify';
import type { Plan, User } from '@prisma/client';

import {
  cancelSubscription as cancelHypercashSubscription,
  createPaymentLink,
  deactivatePaymentLink,
  getSubscriptionByPaymentLinkId,
  priceToCents,
} from '../../hypercash-client';
import { cancelLegacyMercadoPagoSubscription } from '../../lib/cancel-other-provider-subscription';
import { applyPercentOff, validateCoupon } from '../../lib/coupons';
import { sendOpsAlertEmail } from '../../lib/email';
import { prisma } from '../../lib/prisma';
import { addDays } from '../../lib/pix-billing';
import { createProratedUpgradeCharge, findActivePaidCycle } from '../../lib/plan-upgrade';
import { getSalesLimitStatus } from '../../lib/sales-usage';
import { serializeUser, userWithPlan } from './serialize-user';

const TRIAL_DAYS = 15;
const BACK_URL = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';

const selectPlanSchema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1 },
    couponCode: { type: 'string' },
  },
} as const;

type SelectPlanBody = { key: string; couponCode?: string };

const validateCouponSchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 1 },
  },
} as const;

type ValidateCouponBody = { code: string };

// Uma loja Shopee que já consumiu o teste grátis (em qualquer conta Lucrei -
// o shopeeShopId é único e persiste ao trocar de dono) não libera um novo
// período de teste, mesmo numa conta nova.
export async function resolveTrial(user: User, plan: Plan) {
  const now = new Date();

  // Teste grátis já em andamento (trialEndsAt preenchido e no futuro) -
  // trocar de plano NO MEIO do teste não pode encerrar nem reiniciar ele, só
  // reservar o que vai cobrar quando o prazo ORIGINAL acabar. Bug reportado
  // ao vivo: escolher um plano durante o teste virava 'past_due' na hora,
  // cortando o teste antes do prazo - porque trialEndsAt já preenchido
  // também dispara "alreadyUsedTrial" abaixo, uma regra pensada só pra
  // impedir REINICIAR um teste já encerrado, não pra isso.
  if (user.subscriptionStatus === 'trialing' && user.trialEndsAt && user.trialEndsAt > now) {
    const remainingDays = Math.max(1, Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    return { eligibleForTrial: true, trialEndsAt: user.trialEndsAt, trialDays: remainingDays };
  }

  const alreadyUsedTrial = Boolean(user.trialEndsAt);
  const taintedShop =
    plan.trialEligible && !alreadyUsedTrial
      ? await prisma.shop.findFirst({ where: { userId: user.id, trialConsumedAt: { not: null } } })
      : null;
  const eligibleForTrial = plan.trialEligible && !alreadyUsedTrial && !taintedShop;
  const trialEndsAt = eligibleForTrial ? addDays(now, TRIAL_DAYS) : alreadyUsedTrial ? user.trialEndsAt : null;
  return { eligibleForTrial, trialEndsAt, trialDays: eligibleForTrial ? TRIAL_DAYS : 0 };
}

async function markShopsTrialConsumed(userId: string) {
  await prisma.shop.updateMany({
    where: { userId, trialConsumedAt: null },
    data: { trialConsumedAt: new Date() },
  });
}

export async function plansRoutes(app: FastifyInstance) {
  app.get('/plans', async () => {
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    return {
      plans: plans.map((plan) => ({
        key: plan.key,
        groupKey: plan.groupKey,
        billingPeriod: plan.billingPeriod,
        trialEligible: plan.trialEligible,
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

      let couponPercentOff: number | null = null;
      let couponId: string | null = null;
      if (request.body.couponCode) {
        const validation = await validateCoupon(request.body.couponCode, request.user.sub);
        if (!validation.ok) {
          return reply.status(400).send({ message: validation.message });
        }
        couponPercentOff = validation.coupon.percentOff;
        couponId = validation.coupon.id;
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, include: { plan: true } });

      // Cliente já DENTRO de um teste grátis em andamento, escolhendo pagar
      // por conta própria - diferente de alguém assinando pela primeira vez
      // (que ainda deve só começar o teste grátis, sem cobrar nada).
      // Calculado em cima do "user" como veio do banco, antes de qualquer
      // escrita desta requisição.
      const alreadyMidTrial =
        user.subscriptionStatus === 'trialing' && user.trialEndsAt !== null && user.trialEndsAt > new Date();

      try {
        const upgradeCharge = await createProratedUpgradeCharge(user, plan);
        if (upgradeCharge) {
          return reply.send({ ...(await serializeUser(user)), checkoutUrl: upgradeCharge.checkoutUrl });
        }
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Não foi possível calcular o upgrade agora. Tente novamente em instantes.' });
      }

      if (user.plan && user.plan.id !== plan.id) {
        const activeCycle = await findActivePaidCycle(user);
        if (activeCycle) {
          return reply.status(400).send({
            message: `Seu plano atual já está pago até ${new Intl.DateTimeFormat('pt-BR').format(activeCycle.currentPeriodEnd)}. Pra não perder esse período, a troca para um plano de valor igual ou menor só é possível depois da renovação.`,
          });
        }
      }

      // Segurança pra conta que ainda tivesse uma assinatura presa na
      // Mercado Pago de antes da migração pra HyperCash.
      try {
        await cancelLegacyMercadoPagoSubscription(app, user.id);
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Não foi possível cancelar sua assinatura anterior. Tente novamente em instantes.' });
      }

      let subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, provider: 'hypercash', status: { not: 'canceled' } },
        orderBy: { createdAt: 'desc' },
      });

      let trialEndsAt = user.trialEndsAt;

      // Plano diferente do que a assinatura existente cobre - desativa o
      // link antigo (se já tinha algum gerado) e cancela a assinatura local,
      // começando do zero pro plano novo. Mesmo plano = reaproveita (retry,
      // duplo toque, ou voltando a pagar depois de past_due).
      if (subscription && user.plan?.id !== plan.id) {
        if (subscription.providerSubscriptionId) {
          try {
            await deactivatePaymentLink(subscription.providerSubscriptionId);
          } catch (err) {
            app.log.error(err);
          }
        }
        await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } });
        subscription = null;
      }

      if (!subscription) {
        const trial = await resolveTrial(user, plan);
        trialEndsAt = trial.trialEndsAt;

        subscription = await prisma.subscription.create({
          data: {
            userId: user.id,
            provider: 'hypercash',
            status: trial.eligibleForTrial ? 'trialing' : 'past_due',
            currentPeriodEnd: trial.eligibleForTrial ? trial.trialEndsAt : null,
            pendingCouponPercentOff: couponPercentOff,
          },
        });

        if (trial.eligibleForTrial) {
          await markShopsTrialConsumed(user.id);
        }
      }

      // Só entra em "teste grátis, sem cobrar nada" quando NÃO é alguém já
      // em teste escolhendo pagar - essa pessoa cai direto pra geração do
      // link de pagamento de verdade logo abaixo, com o status continuando
      // 'trialing' até o pagamento confirmar via webhook.
      if (subscription.status === 'trialing' && !alreadyMidTrial) {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { planId: plan.id, subscriptionStatus: 'trialing', trialEndsAt },
          include: userWithPlan,
        });
        return reply.send({ ...(await serializeUser(updated)), checkoutUrl: null });
      }

      // Reaproveita o link já gerado numa tentativa anterior pro MESMO plano
      // (retry/duplo toque) - exceto quando um cupom está sendo aplicado
      // AGORA, que precisa de um link novo com o valor certo (o antigo não
      // tem como ter o desconto aplicado retroativamente).
      const needsNewLink = !subscription.providerSubscriptionId || !subscription.lastInvoiceUrl || couponId !== null;

      let checkoutUrl: string | null;
      if (!needsNewLink) {
        checkoutUrl = subscription.lastInvoiceUrl;
      } else {
        if (subscription.providerSubscriptionId && couponId !== null) {
          try {
            await deactivatePaymentLink(subscription.providerSubscriptionId);
          } catch (err) {
            app.log.error(err);
          }
        }

        const effectivePercentOff = couponPercentOff ?? subscription.pendingCouponPercentOff;
        const amount = effectivePercentOff != null ? applyPercentOff(Number(plan.priceCurrent), effectivePercentOff) : Number(plan.priceCurrent);

        let link;
        try {
          link = await createPaymentLink({
            name: `Lucrei - Plano ${plan.name}`,
            priceCents: priceToCents(amount),
            isRecurring: true,
            frequency: plan.billingPeriod === 'annual' ? 'annual' : 'monthly',
            successRedirectUrl: `${BACK_URL}/planos`,
          });
          checkoutUrl = link.checkoutUrl;
        } catch (err) {
          app.log.error(err);
          // Achado ao vivo (14-15/10): a Mercado Pago ficou sem permissão de
          // cobrar e ninguém soube até um cliente tentar pagar - mesmo
          // alerta aqui, pro mesmo nunca acontecer de novo em silêncio com a
          // HyperCash.
          sendOpsAlertEmail(
            app,
            'Falha ao criar cobrança (HyperCash)',
            `userId: ${request.user.sub}\nplano: ${plan.key}\nerro: ${err instanceof Error ? err.message : String(err)}`
          ).catch(() => {});
          return reply.status(502).send({ message: 'Não foi possível configurar a cobrança agora. Tente novamente em instantes.' });
        }

        subscription = await prisma.subscription.update({
          where: { id: subscription.id },
          data: { providerSubscriptionId: link.id, lastInvoiceUrl: checkoutUrl, pendingCouponPercentOff: effectivePercentOff },
        });

        // Trava o cupom só numa cobrança de verdade gerada com sucesso -
        // nunca em só escolher o plano (cliente elegível pro teste grátis
        // nunca deveria gastar cupom nenhum).
        if (couponId) {
          await prisma.coupon.update({ where: { id: couponId }, data: { redeemedCount: { increment: 1 } } });
          await prisma.couponRedemption.create({ data: { couponId, userId: user.id } });
        }
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { planId: plan.id, subscriptionStatus: alreadyMidTrial ? 'trialing' : 'past_due', trialEndsAt },
        include: userWithPlan,
      });

      return reply.send({ ...(await serializeUser(updated)), checkoutUrl });
    }
  );

  // Prévia do desconto antes do usuário confirmar - não reserva nem gasta o
  // cupom (só /plans/select faz isso), é só validação/exibição.
  app.post<{ Body: ValidateCouponBody }>(
    '/coupons/validate',
    { onRequest: [app.authenticate], schema: { body: validateCouponSchema } },
    async (request, reply) => {
      const validation = await validateCoupon(request.body.code, request.user.sub);
      if (!validation.ok) {
        return reply.status(400).send({ message: validation.message });
      }
      return reply.send({ code: validation.coupon.code, percentOff: validation.coupon.percentOff });
    }
  );

  app.get('/plans/usage', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, include: { plan: true } });
    const status = await getSalesLimitStatus(user);
    return reply.send(status);
  });

  app.get('/plans/checkout-url', { onRequest: [app.authenticate] }, async (request, reply) => {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: request.user.sub, provider: 'hypercash' },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ checkoutUrl: subscription?.lastInvoiceUrl ?? null });
  });

  app.post('/plans/cancel', { onRequest: [app.authenticate] }, async (request, reply) => {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: request.user.sub, provider: 'hypercash', status: { not: 'canceled' } },
      orderBy: { createdAt: 'desc' },
    });

    if (subscription?.providerSubscriptionId) {
      try {
        const hcSubscription = await getSubscriptionByPaymentLinkId(subscription.providerSubscriptionId);
        if (hcSubscription) {
          await cancelHypercashSubscription(hcSubscription.id);
        }
        await deactivatePaymentLink(subscription.providerSubscriptionId);
      } catch (err) {
        app.log.error(err);
      }
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } });
    } else if (subscription) {
      // Em teste grátis (nunca gerou link de pagamento) - só cancela local.
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } });
    }

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { subscriptionStatus: 'canceled' },
      include: userWithPlan,
    });
    return reply.send(await serializeUser(user));
  });
}
