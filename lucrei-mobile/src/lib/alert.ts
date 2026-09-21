import { Alert, Platform } from 'react-native';

type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

// Alert.alert() do react-native-web é um no-op total (não mostra nada e
// nunca chama os callbacks dos botões) - qualquer confirmação (excluir
// conta, desconectar loja, aplicar custo em lote...) simplesmente não fazia
// nada quando usada pelo navegador. Aqui trocamos por window.alert/confirm
// no web, mantendo o Alert nativo no app.
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' } as AlertButton];
  const text = message ? `${title}\n\n${message}` : title;

  if (list.length === 1) {
    window.alert(text);
    list[0].onPress?.();
    return;
  }

  const confirmButton = list.find((b) => b.style !== 'cancel') ?? list[list.length - 1];
  const cancelButton = list.find((b) => b.style === 'cancel');

  if (window.confirm(text)) {
    confirmButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}
