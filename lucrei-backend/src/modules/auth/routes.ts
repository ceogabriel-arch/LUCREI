import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';

import { prisma } from '../../lib/prisma';
import { reconcileMercadoPagoSubscription } from '../../lib/subscription-sync';
import * as mercadopago from '../../mercadopago-client';
import { serializeUser, userWithPlan } from '../plans/serialize-user';

const deleteAccountSchema = {
  type: 'object',
  required: ['password'],
  properties: {
    password: { type: 'string', minLength: 1 },
  },
} as const;

type DeleteAccountBody = { password: string };

const googleAuthSchema = {
  type: 'object',
  required: ['idToken'],
  properties: {
    idToken: { type: 'string', minLength: 1 },
  },
} as const;

type GoogleAuthBody = { idToken: string };

const googleClient = new OAuth2Client();
const GOOGLE_AUDIENCES = [
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_WEB_CLIENT_ID,
].filter((id): id is string => Boolean(id));

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

const pushTokenSchema = {
  type: 'object',
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 1 },
  },
} as const;

type Credentials = { email: string; password: string };
type SignupBody = { name: string; email: string; password: string };
type UpdateNameBody = { name: string };
type ChangePasswordBody = { currentPassword: string; newPassword: string };
type PushTokenBody = { token: string };

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: SignupBody }>(
    '/auth/signup',
    { schema: { body: signupSchema } },
    async (request, reply) => {
      const { name, password } = request.body;
      const email = request.body.email.trim().toLowerCase();

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ message: 'E-mail já cadastrado.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { name, email, passwordHash },
        include: userWithPlan,
      });

      const token = app.jwt.sign({ sub: user.id, tv: user.tokenVersion });
      return reply.status(201).send({ token, user: serializeUser(user) });
    }
  );

  app.post<{ Body: Credentials }>(
    '/auth/login',
    { schema: { body: credentialsSchema } },
    async (request, reply) => {
      const { password } = request.body;
      const email = request.body.email.trim().toLowerCase();

      const user = await prisma.user.findUnique({ where: { email }, include: userWithPlan });
      if (!user) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const token = app.jwt.sign({ sub: user.id, tv: user.tokenVersion });
      return reply.send({ token, user: serializeUser(user) });
    }
  );

  app.post<{ Body: GoogleAuthBody }>(
    '/auth/google',
    { schema: { body: googleAuthSchema } },
    async (request, reply) => {
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: request.body.idToken,
          audience: GOOGLE_AUDIENCES,
        });
        payload = ticket.getPayload();
      } catch (err) {
        app.log.error(err);
        return reply.status(401).send({ message: 'Token do Google inválido.' });
      }

      if (!payload?.sub || !payload.email) {
        return reply.status(401).send({ message: 'Token do Google inválido.' });
      }

      const googleId = payload.sub;
      const email = payload.email.trim().toLowerCase();

      let user = await prisma.user.findUnique({ where: { googleId }, include: userWithPlan });

      if (!user) {
        // Já existe conta com esse e-mail criada por senha - vincula em vez
        // de criar duplicada.
        const existing = await prisma.user.findUnique({ where: { email }, include: userWithPlan });
        if (existing) {
          user = await prisma.user.update({ where: { id: existing.id }, data: { googleId }, include: userWithPlan });
        } else {
          const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
          user = await prisma.user.create({
            data: { email, name: payload.name || email, passwordHash, googleId },
            include: userWithPlan,
          });
        }
      }

      const token = app.jwt.sign({ sub: user.id, tv: user.tokenVersion });
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

  app.post<{ Body: PushTokenBody }>(
    '/auth/push-token',
    { onRequest: [app.authenticate], schema: { body: pushTokenSchema } },
    async (request, reply) => {
      await prisma.user.update({
        where: { id: request.user.sub },
        data: { pushToken: request.body.token },
      });
      return reply.send({ ok: true });
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
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });

      // Derruba qualquer outro token emitido antes da troca (ex: um token
      // vazado); reemite um novo token válido pra não deslogar quem trocou.
      const token = app.jwt.sign({ sub: updated.id, tv: updated.tokenVersion });
      return reply.send({ ok: true, token });
    }
  );

  app.delete<{ Body: DeleteAccountBody }>(
    '/auth/me',
    { onRequest: [app.authenticate], schema: { body: deleteAccountSchema } },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user) {
        return reply.status(404).send({ message: 'Usuário não encontrado.' });
      }

      const valid = await bcrypt.compare(request.body.password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: 'Senha incorreta.' });
      }

      const subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, provider: 'mercado_pago', status: { not: 'canceled' } },
        orderBy: { createdAt: 'desc' },
      });
      if (subscription?.providerSubscriptionId) {
        try {
          await mercadopago.cancelPreapproval(subscription.providerSubscriptionId);
        } catch (err) {
          app.log.error(err);
        }
      }

      // Cascata no schema apaga lojas, tokens, pedidos, produtos e
      // assinaturas junto - não precisa apagar cada tabela na mão.
      await prisma.user.delete({ where: { id: user.id } });

      return reply.send({ ok: true });
    }
  );
}
