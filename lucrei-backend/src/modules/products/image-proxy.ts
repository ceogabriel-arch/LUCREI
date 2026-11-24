import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';

// Shopee/Mercado Livre devolvem a imagem original do produto (muitas vezes
// várias centenas de KB) pra uma miniatura de 48x48 no app - essa rota baixa
// a imagem uma vez, redimensiona pro tamanho real usado na UI e devolve um
// arquivo bem menor, com cache both-sides (aqui em memória + Cache-Control
// pro cliente). Só reencaminha hosts de CDN conhecidos dos marketplaces,
// nunca um proxy aberto pra qualquer URL (risco de SSRF) - se uma imagem real
// vier de um host fora dessa lista, ajustar aqui.
const ALLOWED_IMAGE_HOST_SUFFIXES = ['susercontent.com', 'shopeemobile.com', 'mlstatic.com'];
const PROXY_SIZE = 160; // cobre a miniatura de 48dp até ~3.3x de densidade de tela
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const imageCache = new Map<string, { expiresAt: number; body: Buffer }>();

function isAllowedImageHost(hostname: string): boolean {
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export async function productImageProxyRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { url?: string } }>('/products/image-proxy', async (request, reply) => {
    const { url } = request.query;
    if (!url) return reply.status(400).send({ message: 'url é obrigatório.' });

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return reply.status(400).send({ message: 'url inválida.' });
    }
    if (parsed.protocol !== 'https:' || !isAllowedImageHost(parsed.hostname)) {
      return reply.status(400).send({ message: 'Host de imagem não permitido.' });
    }

    const cached = imageCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      return reply.send(cached.body);
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return reply.status(502).send({ message: 'Falha ao buscar imagem original.' });
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        return reply.status(502).send({ message: 'Resposta não é uma imagem.' });
      }

      const original = Buffer.from(await res.arrayBuffer());
      if (original.byteLength > MAX_SOURCE_BYTES) {
        return reply.status(502).send({ message: 'Imagem original grande demais.' });
      }

      const resized = await sharp(original)
        .resize(PROXY_SIZE, PROXY_SIZE, { fit: 'cover' })
        .webp({ quality: 72 })
        .toBuffer();

      if (imageCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = imageCache.keys().next().value;
        if (oldestKey !== undefined) imageCache.delete(oldestKey);
      }
      imageCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body: resized });

      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      return reply.send(resized);
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ message: 'Falha ao processar imagem.' });
    }
  });
}

export function toProxiedImageUrl(originalUrl: string | null): string | null {
  if (!originalUrl) return null;
  const base = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';
  return `${base}/products/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}
