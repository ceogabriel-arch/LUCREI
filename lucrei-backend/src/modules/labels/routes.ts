import type { FastifyPluginAsync } from 'fastify';

import { resizePdfToLabel } from './service';

export const labelRoutes: FastifyPluginAsync = async (app) => {
  app.post('/labels/resize', { onRequest: [app.authenticate] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: 'Envie um arquivo PDF.' });
    }
    if (file.mimetype !== 'application/pdf') {
      return reply.status(400).send({ message: 'O arquivo precisa ser um PDF.' });
    }

    const bytes = await file.toBuffer();
    let resized: Uint8Array;
    try {
      resized = await resizePdfToLabel(bytes);
    } catch {
      return reply.status(400).send({ message: 'Não foi possível ler esse PDF. Confira se o arquivo não está corrompido.' });
    }

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="etiquetas-100x150.pdf"');
    return reply.send(Buffer.from(resized));
  });
};
