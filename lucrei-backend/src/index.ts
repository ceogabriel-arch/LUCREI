import 'dotenv/config';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

import { authRoutes } from './modules/auth/routes';
import { shopRoutes } from './modules/shops/routes';

const app = Fastify({ logger: true });

async function main() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado no .env');
  }

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(shopRoutes);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
