import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

const LEGAL_DIR = path.join(__dirname, '..', '..', '..', 'legal');

const TERMS_HTML = readFileSync(path.join(LEGAL_DIR, 'termos-de-uso.html'), 'utf-8');
const PRIVACY_HTML = readFileSync(path.join(LEGAL_DIR, 'politica-de-privacidade.html'), 'utf-8');

export async function legalRoutes(app: FastifyInstance) {
  app.get('/termos', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(TERMS_HTML);
  });

  app.get('/privacidade', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(PRIVACY_HTML);
  });
}
