import path from 'node:path';

import 'dotenv/config';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';

import { authRoutes } from './modules/auth/routes';
import { billingRoutes } from './modules/billing/routes';
import { legalRoutes } from './modules/legal/routes';
import { orderRoutes } from './modules/orders/routes';
import { passwordResetRoutes } from './modules/password-reset/routes';
import { plansRoutes } from './modules/plans/routes';
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
  await app.register(compress, { global: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(staticFiles, {
    root: path.join(__dirname, '..', 'public'),
    cacheControl: true,
    setHeaders: (res, filePath) => {
      // Expo web build hashes filenames under _expo/static, so those are safe to cache forever.
      if (filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`)) {
        res.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.header('Cache-Control', 'no-cache');
      }
    },
  });

  for (const route of ['pedidos', 'produtos', 'relatorios', 'configuracoes', 'shopee-connected', 'planos']) {
    app.get(`/${route}`, (_req, reply) => reply.sendFile(`${route}.html`));
  }

  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(syncRoutes);
  await app.register(productRoutes);
  await app.register(summaryRoutes);
  await app.register(orderRoutes);
  await app.register(plansRoutes);
  await app.register(legalRoutes);
  await app.register(passwordResetRoutes);
  await app.register(billingRoutes);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
