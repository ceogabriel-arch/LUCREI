import type { FastifyInstance } from 'fastify';

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';
const LOGO_URL = `${PUBLIC_APP_URL}/email/logo.png`;

export async function sendPasswordResetEmail(app: FastifyInstance, to: string, resetLink: string) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    app.log.info(`[email] RESEND_API_KEY não configurado — link de redefinição para ${to}: ${resetLink}`);
    return;
  }

  const html = `<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>
  /* O Gmail (app Android/iOS) escurece o fundo sozinho no modo escuro do
     aparelho, ignorando color-scheme e até bgcolor inline. [data-ogsb] e
     [data-ogsc] são os atributos que o próprio Gmail injeta nesse processo -
     truque documentado pra sobrescrever de volta o branco original. */
  .lucrei-wrap, .lucrei-card, [data-ogsb] { background-color:#FFFFFF !important; }
  .lucrei-page { background-color:#F7F7F5 !important; }
  .lucrei-text, [data-ogsc] { color:#1a1a1a !important; }
</style>
<body class="lucrei-page" style="background-color:#F7F7F5;margin:0;padding:0;">
<table role="presentation" width="100%" bgcolor="#F7F7F5" class="lucrei-page" style="background-color:#F7F7F5;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" bgcolor="#FFFFFF" class="lucrei-card" style="background-color:#FFFFFF;max-width:480px;padding:32px 24px;border-radius:16px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
        <tr>
          <td align="center" bgcolor="#FFFFFF" class="lucrei-card" style="background-color:#FFFFFF;padding-bottom:24px;">
            <img src="${LOGO_URL}" alt="Lucrei" width="120" style="display:block;" />
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" class="lucrei-card">
            <p class="lucrei-text" style="color:#1a1a1a;">Recebemos um pedido para redefinir a senha da sua conta Lucrei.</p>
          </td>
        </tr>
        <tr>
          <td align="center" bgcolor="#FFFFFF" class="lucrei-card" style="padding:20px 0;">
            <a href="${resetLink}" style="background:#D4AF37;color:#0A0A0B;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;display:inline-block;">Criar nova senha</a>
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" class="lucrei-card">
            <p style="color:#666;font-size:13px;">Se você não pediu isso, pode ignorar este e-mail.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Lucrei <onboarding@resend.dev>',
      to,
      subject: 'Redefinir sua senha do Lucrei',
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    app.log.error(`Falha ao enviar e-mail de redefinição de senha: ${response.status} ${body}`);
  }
}
