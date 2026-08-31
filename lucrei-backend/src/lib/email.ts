import type { FastifyInstance } from 'fastify';

export async function sendPasswordResetEmail(app: FastifyInstance, to: string, resetLink: string) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    app.log.info(`[email] RESEND_API_KEY não configurado — link de redefinição para ${to}: ${resetLink}`);
    return;
  }

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
      html: `<p>Recebemos um pedido para redefinir a senha da sua conta Lucrei.</p><p><a href="${resetLink}">Clique aqui para criar uma nova senha</a></p><p>Se você não pediu isso, pode ignorar este e-mail.</p>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    app.log.error(`Falha ao enviar e-mail de redefinição de senha: ${response.status} ${body}`);
  }
}
