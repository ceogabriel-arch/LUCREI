import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

const LEGAL_DIR = path.join(__dirname, '..', '..', '..', 'legal');

const TERMS_HTML = readFileSync(path.join(LEGAL_DIR, 'termos-de-uso.html'), 'utf-8');
const PRIVACY_HTML = readFileSync(path.join(LEGAL_DIR, 'politica-de-privacidade.html'), 'utf-8');
const ACCOUNT_DELETION_HTML = readFileSync(path.join(LEGAL_DIR, 'exclusao-de-conta.html'), 'utf-8');
const ABOUT_HTML = readFileSync(path.join(LEGAL_DIR, 'sobre.html'), 'utf-8');
const SHOPEE_CONNECT_HELP_HTML = readFileSync(path.join(LEGAL_DIR, 'como-conectar-shopee.html'), 'utf-8');

// Prova de dono do domínio pro Android App Links (Play Console > "Adicionar
// domínio") - gerado por eles mesmos com o fingerprint certo do certificado
// que assina o app. Rota explícita (não dentro de public/) porque
// @fastify/static ignora dotfiles/dotfolders por padrão (send com
// dotfiles: 'ignore') - um arquivo em public/.well-known nunca seria servido.
const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: {
      namespace: 'android_app',
      package_name: 'com.lucreiapp.mobile',
      sha256_cert_fingerprints: [
        'F3:6B:B8:DC:33:E5:F3:FF:0E:9F:9E:EA:19:5D:02:3D:E8:E8:26:34:34:EE:ED:88:05:AF:A7:E5:BA:6B:47:63',
        '07:E4:66:51:67:02:92:4B:1F:88:DE:C7:7B:BE:EC:C3:FE:E6:88:D7:72:C7:C3:17:98:9F:EC:3A:AE:9D:DF:F4',
        '8D:EF:27:5A:8E:56:5C:A2:C2:08:E8:D1:66:72:98:67:0F:E9:66:E7:9D:6D:46:7D:93:8E:D4:FD:44:3C:4C:17',
      ],
    },
  },
];

export async function legalRoutes(app: FastifyInstance) {
  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    reply.type('application/json').send(ASSET_LINKS);
  });

  app.get('/termos', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(TERMS_HTML);
  });

  app.get('/privacidade', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(PRIVACY_HTML);
  });

  app.get('/exclusao-de-conta', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(ACCOUNT_DELETION_HTML);
  });

  app.get('/sobre', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(ABOUT_HTML);
  });

  app.get('/como-conectar-shopee', async (_req, reply) => {
    reply.type('text/html; charset=utf-8').send(SHOPEE_CONNECT_HELP_HTML);
  });
}
