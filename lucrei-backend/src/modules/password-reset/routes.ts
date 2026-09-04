import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { sendPasswordResetEmail } from '../../lib/email';
import { prisma } from '../../lib/prisma';

const RESET_PAGE_HTML = readFileSync(path.join(__dirname, '..', '..', '..', 'pages', 'redefinir-senha.html'), 'utf-8');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const forgotPasswordSchema = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', format: 'email' },
  },
} as const;

const resetPasswordSchema = {
  type: 'object',
  required: ['token', 'newPassword'],
  properties: {
    token: { type: 'string', minLength: 1 },
    newPassword: { type: 'string', minLength: 6 },
  },
} as const;

type ForgotPasswordBody = { email: string };
type ResetPasswordBody = { token: string; newPassword: string };

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function passwordResetRoutes(app: FastifyInstance) {
  app.get('/redefinir-senha', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(RESET_PAGE_HTML);
  });

  app.post<{ Body: ForgotPasswordBody }>(
    '/auth/forgot-password',
    { schema: { body: forgotPasswordSchema } },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { email: request.body.email } });

      if (user) {
        const rawToken = randomBytes(32).toString('hex');
        await prisma.user.update({
          where: { id: user.id },
          data: {
            passwordResetTokenHash: hashToken(rawToken),
            passwordResetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });

        const resetLink = `${request.protocol}://${request.headers.host}/redefinir-senha?token=${rawToken}`;
        await sendPasswordResetEmail(app, user.email, resetLink);
      }

      return reply.send({ ok: true });
    }
  );

  app.post<{ Body: ResetPasswordBody }>(
    '/auth/reset-password',
    { schema: { body: resetPasswordSchema } },
    async (request, reply) => {
      const tokenHash = hashToken(request.body.token);
      const user = await prisma.user.findFirst({
        where: { passwordResetTokenHash: tokenHash, passwordResetTokenExpiresAt: { gt: new Date() } },
      });

      if (!user) {
        return reply.status(400).send({ message: 'Link inválido ou expirado. Solicite uma nova redefinição.' });
      }

      const passwordHash = await bcrypt.hash(request.body.newPassword, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetTokenHash: null,
          passwordResetTokenExpiresAt: null,
          tokenVersion: { increment: 1 },
        },
      });

      return reply.send({ ok: true });
    }
  );
}
