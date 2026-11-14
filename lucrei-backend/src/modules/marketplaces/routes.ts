import type { FastifyInstance } from 'fastify';

// Quais marketplaces têm credencial configurada neste servidor - o app usa
// pra deixar cinza ("Em breve") o que ainda não dá pra conectar, em vez de
// mostrar um botão que só falharia com "credenciais não configuradas".
// Sem banco: só lê variável de ambiente, barato pra chamar a cada abertura
// do menu "Conectar marketplace".
export async function marketplacesRoutes(app: FastifyInstance) {
  app.get('/marketplaces/availability', { onRequest: [app.authenticate] }, async () => ({
    shopee: true,
    mercado_livre: true,
    ifood: Boolean(process.env.IFOOD_CLIENT_ID && process.env.IFOOD_CLIENT_SECRET),
    tiktok_shop: Boolean(
      process.env.TIKTOKSHOP_APP_KEY && process.env.TIKTOKSHOP_APP_SECRET && process.env.TIKTOKSHOP_SERVICE_ID
    ),
  }));
}
