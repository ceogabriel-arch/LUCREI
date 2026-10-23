import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { requireAdmin } from '../../lib/require-admin';

const createSchema = {
  type: 'object',
  required: ['title', 'body'],
  properties: {
    title: { type: 'string', minLength: 1 },
    body: { type: 'string', minLength: 1 },
    imageUrl: { type: 'string' },
    linkUrl: { type: 'string' },
    active: { type: 'boolean' },
    position: { type: 'integer' },
  },
} as const;

type CreateBody = {
  title: string;
  body: string;
  imageUrl?: string;
  linkUrl?: string;
  active?: boolean;
  position?: number;
};

const updateSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    body: { type: 'string', minLength: 1 },
    imageUrl: { type: ['string', 'null'] },
    linkUrl: { type: ['string', 'null'] },
    active: { type: 'boolean' },
    position: { type: 'integer' },
  },
} as const;

type UpdateBody = Partial<{
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  active: boolean;
  position: number;
}>;

export async function announcementsRoutes(app: FastifyInstance) {
  // Painel "Novidades" na tela Início - só os ativos, mais antigo primeiro
  // dentro de cada posição (ties por createdAt, estável mesmo sem posição
  // definida).
  app.get('/announcements', { onRequest: [app.authenticate] }, async () => {
    const announcements = await prisma.announcement.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
    return announcements;
  });

  app.get('/admin/announcements', { onRequest: [app.authenticate, requireAdmin] }, async () => {
    return prisma.announcement.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'desc' }] });
  });

  app.post<{ Body: CreateBody }>(
    '/admin/announcements',
    { onRequest: [app.authenticate, requireAdmin], schema: { body: createSchema } },
    async (request, reply) => {
      const announcement = await prisma.announcement.create({ data: request.body });
      return reply.status(201).send(announcement);
    }
  );

  app.patch<{ Params: { id: string }; Body: UpdateBody }>(
    '/admin/announcements/:id',
    { onRequest: [app.authenticate, requireAdmin], schema: { body: updateSchema } },
    async (request, reply) => {
      const existing = await prisma.announcement.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ message: 'Aviso não encontrado.' });

      const updated = await prisma.announcement.update({ where: { id: existing.id }, data: request.body });
      return reply.send(updated);
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/announcements/:id',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const existing = await prisma.announcement.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ message: 'Aviso não encontrado.' });

      await prisma.announcement.delete({ where: { id: existing.id } });
      return reply.status(204).send();
    }
  );
}
