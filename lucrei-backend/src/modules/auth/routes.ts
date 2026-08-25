import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';

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

type Credentials = { email: string; password: string };
type SignupBody = { name: string; email: string; password: string };

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
      const user = await prisma.user.create({ data: { name, email, passwordHash } });

      const token = app.jwt.sign({ sub: user.id });
      return reply.status(201).send({
        token,
        user: { id: user.id, name: user.name, email: user.email },
      });
    }
  );

  app.post<{ Body: Credentials }>(
    '/auth/login',
    { schema: { body: credentialsSchema } },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: 'E-mail ou senha inválidos.' });
      }

      const token = app.jwt.sign({ sub: user.id });
      return reply.send({
        token,
        user: { id: user.id, name: user.name, email: user.email },
      });
    }
  );

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) {
      return reply.status(404).send({ message: 'Usuário não encontrado.' });
    }
    return reply.send({ id: user.id, name: user.name, email: user.email });
  });
}
