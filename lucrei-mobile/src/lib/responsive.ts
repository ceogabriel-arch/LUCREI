import { Dimensions, Platform, useWindowDimensions } from 'react-native';

export const WEB_MAX_WIDTH = 480;

// Acima disso, considera que é uma janela de desktop (o app Electron ou o
// site num navegador largo) em vez de um celular acessando pela web - só
// isso liga o menu lateral e o conteúdo mais largo. Nunca afeta nativo
// (Platform.OS !== 'web') nem uma janela estreita.
export const DESKTOP_BREAKPOINT = 900;
export const DESKTOP_CONTENT_MAX_WIDTH = 1100;

/**
 * Caps content to a phone-sized column and centers it — only on web, e só
 * abaixo do breakpoint de desktop. Native rendering (iOS/Android) é
 * completamente intocado.
 */
export function webCapWidth() {
  if (Platform.OS !== 'web') return undefined;
  const isDesktop = Dimensions.get('window').width >= DESKTOP_BREAKPOINT;
  return {
    width: '100%' as const,
    maxWidth: isDesktop ? DESKTOP_CONTENT_MAX_WIDTH : WEB_MAX_WIDTH,
    alignSelf: 'center' as const,
  };
}

export function useIsDesktopWeb() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
