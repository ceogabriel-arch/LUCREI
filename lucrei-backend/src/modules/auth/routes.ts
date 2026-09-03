import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { reconcileMercadoPagoSubscription } from '../../lib/subscription-sync';
import { serializeUser, userWithPlan } from '../plans/serialize-user';

const credentialsSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 6 },
  },
} as const;

const signupSchema = {
  type: 'object',
  required: ['name', 'email', 'password'],
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 6 },
  },
} as const;

const updateNameSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
  },
} as const;

const changePasswordSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  properties: {
    currentPassword: { type: 'string', minLength: 1 },
    newPassword: { type: 'string', minLength: 6 },
  },
} as const;

type Credentials = { email: string; password: string };
type SignupBody = { name: string; email: string; password: string };
type UpdateNameBody = { name: string };
type ChangePasswordBody = { currentPassword: string; newPassword: string };

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: SignupBody }>(
    '/auth/signup',
    { schema: { body: signupSchema } },
    async (request, reply) => {
      const { name, email, password } = request.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ message: 'E-mail já cadastrado.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { name, email, passwordHash },
        include: userWithPlan,
      });

      const token = app.jwt.sign({ sub: user.id });
      return reply.status(201).send({ token, user: serializeUser(user) });
    }
  );

  app.post<{ Body: Credentials }>(
    '/auth/login',
    { schema: { body: credentialsSchema } },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await prisma.user.findUnique({ where: { email }, include: userWithPlan });
      if (!user) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const token = app.jwt.sign({ sub: user.id });
      return reply.send({ token, user: serializeUser(user) });
    }
  );

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    await reconcileMercadoPagoSubscription(request.user.sub);
    const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: userWithPlan });
    if (!user) {
      return reply.status(404).send({ message: 'Usuário não encontrado.' });
    }
    return reply.send(serializeUser(user));
  });

  app.patch<{ Body: UpdateNameBody }>(
    '/auth/me',
    { onRequest: [app.authenticate], schema: { body: updateNameSchema } },
    async (request, reply) => {
      const user = await prisma.user.update({
        where: { id: request.user.sub },
        data: { name: request.body.name },
        include: userWithPlan,
      });
      return reply.send(serializeUser(user));
    }
  );

  app.post<{ Body: ChangePasswordBody }>(
    '/auth/change-password',
    { onRequest: [app.authenticate], schema: { body: changePasswordSchema } },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user) {
        return reply.status(404).send({ message: 'Usuário não encontrado.' });
      }

      const valid = await bcrypt.compare(request.body.currentPassword, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: 'Senha atual incorreta.' });
      }

      const passwordHash = await bcrypt.hash(request.body.newPassword, 10);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

      return reply.send({ ok: true });
    }
  );
}
