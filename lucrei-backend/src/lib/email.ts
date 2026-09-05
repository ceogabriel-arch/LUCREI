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
<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <img src="${LOGO_URL}" alt="Lucrei" width="120" style="display:block;margin:0 auto 24px;" />
  <p>Recebemos um pedido para redefinir a senha da sua conta Lucrei.</p>
  <p style="text-align:center;margin:28px 0;">
    <a href="${resetLink}" style="background:#A9790A;color:#0A0A0B;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;display:inline-block;">Criar nova senha</a>
  </p>
  <p style="color:#666;font-size:13px;">Se você não pediu isso, pode ignorar este e-mail.</p>
</div>`;

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
