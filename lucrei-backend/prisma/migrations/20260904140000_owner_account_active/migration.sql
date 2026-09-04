-- Marca a conta do dono do produto como ativa no plano Empresarial, sem
-- passar pela Mercado Pago (é a própria conta usada pra testar o app).
UPDATE "User"
SET "subscriptionStatus" = 'active',
    "planId" = (SELECT "id" FROM "Plan" WHERE "key" = 'enterprise')
WHERE "email" = 'filipe.coorp55@gmail.com';
