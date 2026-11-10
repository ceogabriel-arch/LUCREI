// Mesmo mapeamento do backend (ver apple-iap.ts em lucrei-backend/src/lib) -
// "enterprise" é sob consulta e nunca vendido via IAP, por isso fica de fora.
export const PLAN_KEY_TO_APPLE_SKU: Record<string, string> = {
  start: 'com.lucreiapp.mobile.sub.start',
  start_annual: 'com.lucreiapp.mobile.sub.start_annual',
  pro: 'com.lucreiapp.mobile.sub.pro',
  pro_annual: 'com.lucreiapp.mobile.sub.pro_annual',
  master: 'com.lucreiapp.mobile.sub.master',
  master_annual: 'com.lucreiapp.mobile.sub.master_annual',
};

export const APPLE_SKUS = Object.values(PLAN_KEY_TO_APPLE_SKU);
