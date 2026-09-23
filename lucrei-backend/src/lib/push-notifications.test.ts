import { describe, expect, it, vi } from 'vitest';

const { isExpoPushTokenMock, sendPushNotificationsAsyncMock } = vi.hoisted(() => ({
  isExpoPushTokenMock: vi.fn(),
  sendPushNotificationsAsyncMock: vi.fn(),
}));

vi.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken = isExpoPushTokenMock;
    sendPushNotificationsAsync = sendPushNotificationsAsyncMock;
  },
}));

import { sendPushNotification } from './push-notifications';

describe('sendPushNotification', () => {
  it('throws instead of silently no-op-ing when the token format is invalid', async () => {
    isExpoPushTokenMock.mockReturnValue(false);
    await expect(sendPushNotification('bad-token', 'Título', 'Corpo')).rejects.toThrow(/formato inválido/);
    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it('throws when Expo returns an error ticket', async () => {
    isExpoPushTokenMock.mockReturnValue(true);
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: 'error', message: 'DeviceNotRegistered' }]);
    await expect(sendPushNotification('ExponentPushToken[abc]', 'Título', 'Corpo')).rejects.toThrow(
      'DeviceNotRegistered'
    );
  });

  it('resolves without throwing on a successful ticket', async () => {
    isExpoPushTokenMock.mockReturnValue(true);
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: 'ok' }]);
    await expect(sendPushNotification('ExponentPushToken[abc]', 'Título', 'Corpo')).resolves.toBeUndefined();
  });
});
