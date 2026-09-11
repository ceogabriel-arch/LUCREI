import { prisma } from './prisma';
import { sendPushNotification } from './push-notifications';
import type { User } from '@prisma/client';

// Avisa a conta quando faltar esse tanto de dias ou menos pro teste grátis acabar.
const WARNING_WINDOW_DAYS = 3;

export async function warnIfTrialEndingSoon(app: { log: { error: (err: unknown) => void } }, user: User) {
  if (user.subscriptionStatus !== 'trialing' || !user.trialEndsAt || user.trialEndingWarnedAt) return;

  const now = new Date();
  const msRemaining = user.trialEndsAt.getTime() - now.getTime();
  if (msRemaining <= 0 || msRemaining > WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000) return;

  await prisma.user.update({ where: { id: user.id }, data: { trialEndingWarnedAt: now } });
  if (!user.pushToken) return;

  const daysLeft = Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  await sendPushNotification(
    user.pushToken,
    'Seu teste grátis está acabando ⏳',
    daysLeft === 1
      ? 'Seu teste grátis termina amanhã. Escolha um plano pra não perder o acesso ao Lucrei.'
      : `Faltam ${daysLeft} dias pro fim do seu teste grátis. Escolha um plano pra não perder o acesso ao Lucrei.`
  ).catch((err) => app.log.error(err));
}
