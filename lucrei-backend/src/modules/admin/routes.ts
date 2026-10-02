import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from '../../lib/prisma';

// Sem tabela de "role" no banco - é só pra uma pessoa (o próprio fundador)
// por enquanto, então uma lista de e-mails na variável de ambiente já
// resolve sem precisar de migração nem de UI pra gerenciar permissão.
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0) {
    return reply.status(403).send({ message: 'Admin não configurado.' });
  }
  const user = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { email: true } });
  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
    return reply.status(403).send({ message: 'Sem acesso.' });
  }
}

// Sincronização "travada" não tem um erro pra pegar - é AUSÊNCIA de
// conclusão. syncStartedAt/historyBackfillStartedAt funcionam como "último
// sinal de vida" (o backfill reescreve a cada bloco de 15 dias processado -
// ver sync/service.ts), então ficar velho demais parado em 'running' é o
// sinal real de travamento, não só demora normal.
const STUCK_SYNC_MINUTES = 20;
const STUCK_BACKFILL_MINUTES = 30;

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/users', { onRequest: [app.authenticate, requireAdmin] }, async () => {
    const users = await prisma.user.findMany({
      include: { plan: true, _count: { select: { shops: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      subscriptionStatus: u.subscriptionStatus,
      planName: u.plan?.name ?? null,
      shopsCount: u._count.shops,
      createdAt: u.createdAt,
      trialEndsAt: u.trialEndsAt,
    }));
  });

  app.get('/admin/reward-claims', { onRequest: [app.authenticate, requireAdmin] }, async () => {
    const claims = await prisma.rewardClaim.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return claims.map((c) => ({
      id: c.id,
      userEmail: c.user.email,
      tierThreshold: c.tierThreshold,
      fullName: c.fullName,
      phone: c.phone,
      addressLine: c.addressLine,
      city: c.city,
      state: c.state,
      zipCode: c.zipCode,
      createdAt: c.createdAt,
      fulfilledAt: c.fulfilledAt,
    }));
  });

  app.patch<{ Params: { id: string }; Body: { fulfilled: boolean } }>(
    '/admin/reward-claims/:id',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const claim = await prisma.rewardClaim.findUnique({ where: { id: request.params.id } });
      if (!claim) return reply.status(404).send({ message: 'Resgate não encontrado.' });

      const updated = await prisma.rewardClaim.update({
        where: { id: claim.id },
        data: { fulfilledAt: request.body.fulfilled ? new Date() : null },
      });
      return { id: updated.id, fulfilledAt: updated.fulfilledAt };
    }
  );

  app.get('/admin/sync-issues', { onRequest: [app.authenticate, requireAdmin] }, async () => {
    const now = Date.now();
    const shops = await prisma.shop.findMany({
      where: { status: 'active' },
      include: { user: { select: { email: true } } },
    });

    return shops
      .filter((s) => {
        if (s.syncStatus === 'error' || s.historyBackfillStatus === 'error') return true;
        if (s.syncStatus === 'running' && s.syncStartedAt) {
          if (now - s.syncStartedAt.getTime() > STUCK_SYNC_MINUTES * 60_000) return true;
        }
        if (s.historyBackfillStatus === 'running' && s.historyBackfillStartedAt) {
          if (now - s.historyBackfillStartedAt.getTime() > STUCK_BACKFILL_MINUTES * 60_000) return true;
        }
        return false;
      })
      .map((s) => ({
        shopId: s.id,
        shopName: s.shopName,
        provider: s.provider,
        userEmail: s.user.email,
        syncStatus: s.syncStatus,
        syncError: s.syncError,
        syncStartedAt: s.syncStartedAt,
        historyBackfillStatus: s.historyBackfillStatus,
        historyBackfillError: s.historyBackfillError,
        historyBackfillStartedAt: s.historyBackfillStartedAt,
      }));
  });

  app.get('/admin/metrics', { onRequest: [app.authenticate, requireAdmin] }, async () => {
    const [totalUsers, usersByStatus, shopsByProvider, activeUsersWithPlan] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['subscriptionStatus'], _count: true }),
      prisma.shop.groupBy({ by: ['provider'], where: { status: 'active' }, _count: true }),
      prisma.user.findMany({ where: { subscriptionStatus: 'active' }, include: { plan: true } }),
    ]);

    // Plano anual conta como 1/12 do valor pra comparar com os mensais numa
    // mesma base "por mês" - senão um plano anual de R$1000 pareceria 10x
    // mais "receita mensal" que realmente é.
    const mrrEstimate = activeUsersWithPlan.reduce((sum, u) => {
      if (!u.plan?.priceCurrent) return sum;
      const price = Number(u.plan.priceCurrent);
      return sum + (u.plan.billingPeriod === 'annual' ? price / 12 : price);
    }, 0);

    return {
      totalUsers,
      usersByStatus: usersByStatus.map((s) => ({ status: s.subscriptionStatus, count: s._count })),
      activeSubscriptions: activeUsersWithPlan.length,
      mrrEstimate: Math.round(mrrEstimate * 100) / 100,
      shopsByProvider: shopsByProvider.map((s) => ({ provider: s.provider, count: s._count })),
    };
  });
}
