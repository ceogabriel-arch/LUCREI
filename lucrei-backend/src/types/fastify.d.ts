import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // kind/verifier: só no linkToken do vínculo iFood (modules/ifood/routes.ts).
    payload: { sub: string; returnUrl?: string; tv?: number; kind?: 'ifood_link'; verifier?: string };
    user: { sub: string; returnUrl?: string; tv?: number };
  }
}
