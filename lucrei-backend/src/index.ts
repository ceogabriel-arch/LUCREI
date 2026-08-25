import 'dotenv/config';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

import { authRoutes } from './modules/auth/routes';
import { orderRoutes } from './modules/orders/routes';
import { productRoutes } from './modules/products/routes';
import { shopRoutes } from './modules/shops/routes';
import { summaryRoutes } from './modules/summary/routes';
import { syncRoutes } from './modules/sync/routes';

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
  await app.register(syncRoutes);
  await app.register(productRoutes);
  await app.register(summaryRoutes);
  await app.register(orderRoutes);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
