import path from 'node:path';

import 'dotenv/config';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';

import { prisma } from './lib/prisma';
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

// Railway coloca a API atrás de um proxy - sem isso, request.ip volta sempre
// o IP interno do proxy (o mesmo pra todo mundo), o que quebraria o rate
// limit por IP abaixo.
const app = Fastify({ logger: true, trustProxy: true });

async function main() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado no .env');
  }

  await app.register(cors, { origin: true });
  await app.register(compress, { global: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET });
  // Limite geral (por IP) contra abuso/DoS; rotas de login/cadastro/reset têm
  // limites bem mais apertados registrados junto com cada rota.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => {
      const err = new Error('Muitas tentativas. Aguarde um pouco e tente de novo.') as FastifyError;
      err.statusCode = context.statusCode;
      return err;
    },
  });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
      // "tv" (token version) precisa bater com o valor atual do usuário -
      // trocar a senha incrementa tokenVersion e derruba qualquer token
      // emitido antes disso, mesmo que ele ainda não tenha expirado.
      const user = await prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { tokenVersion: true },
      });
      if (!user || user.tokenVersion !== request.user.tv) {
        return reply.status(401).send({ message: 'Sessão expirada, faça login novamente.' });
      }
    } catch (err) {
      reply.send(err);
    }
  });

  // Sem isso, qualquer exceção não tratada (ex: banco fora do ar) vaza a
  // mensagem crua do erro (stack, host do banco etc.) direto pro cliente -
  // Fastify não esconde isso sozinho por padrão.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    if (error.validation) {
      return reply.status(400).send({ message: 'Dados inválidos.' });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ message: error.message });
    }
    return reply.status(500).send({ message: 'Algo deu errado no servidor. Tente novamente em instantes.' });
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
