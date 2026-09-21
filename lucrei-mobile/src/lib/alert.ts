export type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

export type AlertState = { title: string; message?: string; buttons: AlertButton[] };

// showAlert() é chamado de qualquer lugar (fora de componentes React às
// vezes), então não pode depender de um hook - guarda quem está "escutando"
// (o AlertHost, montado uma vez em _layout.tsx) e delega pra ele.
let handler: ((state: AlertState) => void) | null = null;

export function registerAlertHandler(fn: ((state: AlertState) => void) | null) {
  handler = fn;
}

// Substitui tanto o Alert.alert nativo (feio/inconsistente com o resto do
// app) quanto window.alert/confirm no web (Alert.alert é um no-op ali) por
// um modal com a cara do Lucrei, igual nas duas plataformas.
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' } as AlertButton];
  if (handler) {
    handler({ title, message, buttons: list });
    return;
  }
  // AlertHost ainda não montou (não devia acontecer em uso normal) - melhor
  // um alert feio do que a mensagem sumir sem o usuário nunca ver.
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message ? `${title}\n\n${message}` : title);
  }
}
