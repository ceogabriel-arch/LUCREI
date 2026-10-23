import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from './prisma';

// Sem tabela de "role" no banco - é só pra uma pessoa (o próprio fundador)
// por enquanto, então uma lista de e-mails na variável de ambiente já
// resolve sem precisar de migração nem de UI pra gerenciar permissão.
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0) {
    return reply.status(403).send({ message: 'Admin não configurado.' });
  }
  const user = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { email: true } });
  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
    return reply.status(403).send({ message: 'Sem acesso.' });
  }
}
