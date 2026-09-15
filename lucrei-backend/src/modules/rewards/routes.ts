import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { sendRewardClaimEmail } from '../../lib/email';

// Espelha os TIERS de achievements-card.tsx no app - precisa bater os
// mesmos patamares, senão um resgate legítimo seria recusado (ou um
// ilegítimo, aceito).
const TIERS: Record<number, string> = {
  1_000: 'Mentoria de alavancagem (ou 3 meses de conta na Lucrei)',
  10_000: 'Pulseira Lucrei',
  50_000: 'Caneca + boné Lucrei',
  100_000: 'Placa Lucrei',
  500_000: 'Placa + podcast Lucrei + garrafa',
  1_000_000: 'Placa + viagem + moletom Lucrei',
};

const FIRST_TIER_THRESHOLD = 1_000;
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

const claimSchema = {
  type: 'object',
  required: ['tierThreshold', 'fullName', 'addressLine', 'city', 'state', 'zipCode'],
  properties: {
    tierThreshold: { type: 'integer' },
    fullName: { type: 'string', minLength: 1 },
    phone: { type: 'string' },
    addressLine: { type: 'string', minLength: 1 },
    city: { type: 'string', minLength: 1 },
    state: { type: 'string', minLength: 1 },
    zipCode: { type: 'string', minLength: 1 },
  },
} as const;

type ClaimBody = {
  tierThreshold: number;
  fullName: string;
  phone?: string;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
};

export async function rewardsRoutes(app: FastifyInstance) {
  app.get('/rewards/claims', { onRequest: [app.authenticate] }, async (request, reply) => {
    const claims = await prisma.rewardClaim.findMany({
      where: { userId: request.user.sub },
      select: { tierThreshold: true },
    });
    return reply.send({ claimedTiers: claims.map((c) => c.tierThreshold) });
  });

  app.post<{ Body: ClaimBody }>(
    '/rewards/claim',
    { onRequest: [app.authenticate], schema: { body: claimSchema } },
    async (request, reply) => {
      const { tierThreshold } = request.body;
      const reward = TIERS[tierThreshold];
      if (!reward) {
        return reply.status(400).send({ message: 'Patamar de recompensa inválido.' });
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });

      const existing = await prisma.rewardClaim.findUnique({
        where: { userId_tierThreshold: { userId: user.id, tierThreshold } },
      });
      if (existing) {
        return reply.status(409).send({ message: 'Você já resgatou essa recompensa.' });
      }

      // Confere se o patamar realmente foi desbloqueado antes de aceitar o
      // resgate - lucro acumulado em todas as lojas da conta, ou (só pro
      // primeiro patamar) 3 meses de conta, igual a regra do app.
      const monthsSinceSignup = (Date.now() - user.createdAt.getTime()) / MS_PER_MONTH;
      const unlockedByAge = tierThreshold === FIRST_TIER_THRESHOLD && monthsSinceSignup >= 3;

      if (!unlockedByAge) {
        const { _sum } = await prisma.orderLineItem.aggregate({
          _sum: { profit: true },
          where: { order: { shop: { userId: user.id } } },
        });
        const totalProfit = Number(_sum.profit ?? 0);
        if (totalProfit < tierThreshold) {
          return reply.status(400).send({ message: 'Você ainda não desbloqueou essa recompensa.' });
        }
      }

      const claim = await prisma.rewardClaim.create({
        data: {
          userId: user.id,
          tierThreshold,
          fullName: request.body.fullName,
          phone: request.body.phone || null,
          addressLine: request.body.addressLine,
          city: request.body.city,
          state: request.body.state,
          zipCode: request.body.zipCode,
        },
      });

      await sendRewardClaimEmail(app, {
        userEmail: user.email,
        tierThreshold,
        reward,
        fullName: claim.fullName,
        phone: claim.phone,
        addressLine: claim.addressLine,
        city: claim.city,
        state: claim.state,
        zipCode: claim.zipCode,
      }).catch((err) => app.log.error(err));

      return reply.send({ ok: true });
    }
  );
}
