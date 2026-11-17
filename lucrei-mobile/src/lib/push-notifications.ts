import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Token de push DESTE aparelho, guardado quando o _layout registra ele no
// backend - o logout (auth.tsx) usa pra desvincular só esse aparelho da
// conta. Só em memória: o registro roda de novo a cada abertura logada.
let registeredPushToken: string | null = null;

export function rememberRegisteredPushToken(pushToken: string | null) {
  registeredPushToken = pushToken;
}

export function getRegisteredPushToken(): string | null {
  return registeredPushToken;
}

// Retorna null (em vez de lançar) sempre que não dá pra registrar - simulador,
// permissão negada, ou projeto sem EAS configurado (`eas init`) ainda. Quem
// chama só decide o que fazer com o token quando ele existe.
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('Sem projectId do EAS configurado - rode "eas init" pra habilitar notificações push.');
    return null;
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (err) {
    console.warn('Falha ao obter o token de push', err);
    return null;
  }
}
