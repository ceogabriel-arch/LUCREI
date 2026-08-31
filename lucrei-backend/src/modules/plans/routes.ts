import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { serializeUser, userWithPlan } from './serialize-user';

const selectPlanSchema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1 },
  },
} as const;

type SelectPlanBody = { key: string };

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

      const user = await prisma.user.update({
        where: { id: request.user.sub },
        data: { planId: plan.id, subscriptionStatus: 'trialing' },
        include: userWithPlan,
      });
      return reply.send(serializeUser(user));
    }
  );

  app.post('/plans/cancel', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { subscriptionStatus: 'canceled' },
      include: userWithPlan,
    });
    return reply.send(serializeUser(user));
  });
}
