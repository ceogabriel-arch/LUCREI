// expo-server-sdk é ESM-only; este projeto é CommonJS, então precisa de
// import() dinâmico em vez de um import estático no topo do arquivo.
type ExpoModule = typeof import('expo-server-sdk', { with: { 'resolution-mode': 'import' } });

let expoModulePromise: Promise<ExpoModule> | null = null;
function loadExpoModule() {
  if (!expoModulePromise) expoModulePromise = import('expo-server-sdk');
  return expoModulePromise;
}

export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const { Expo } = await loadExpoModule();
  if (!Expo.isExpoPushToken(pushToken)) return;

  const expo = new Expo();
  const [ticket] = await expo.sendPushNotificationsAsync([{ to: pushToken, sound: 'default', title, body, data }]);
  if (ticket.status === 'error') {
    throw new Error(ticket.message);
  }
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
