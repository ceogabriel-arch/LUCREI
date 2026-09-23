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

const AUTH_MAX_WIDTH = 440;

/**
 * Teto de largura do bloco de duas colunas (painel de marca + formulário)
 * das telas de login/cadastro no desktop. Sem isso, cada metade da tela
 * fica gigante em monitores bem largos, e centralizar o conteúdo dentro de
 * cada metade independente deixa os dois blocos (logo à esquerda, form à
 * direita) longe um do outro - dá uma sensação de "tudo muito separado"
 * em vez de um layout desenhado pra tela larga.
 */
export const AUTH_SPLIT_MAX_WIDTH = 1280;

/**
 * Login/cadastro usavam webCapWidth(), que no desktop libera até
 * DESKTOP_CONTENT_MAX_WIDTH (1100px) - certo pro conteúdo do app depois de
 * logado, mas um formulário de 2-3 campos esticado até 1100px de largura
 * fica com cara de tela de celular só que enorme, não de tela feita pra
 * desktop. Um formulário de auth fica compacto e centralizado em qualquer
 * largura de tela, igual a maioria dos sites - por isso um teto fixo, sem
 * variar por breakpoint.
 */
export function authCapWidth() {
  if (Platform.OS !== 'web') return undefined;
  return {
    width: '100%' as const,
    maxWidth: AUTH_MAX_WIDTH,
    alignSelf: 'center' as const,
  };
}

/**
 * Os modais que não usam o <Modal> nativo do RN (renderizados como overlay
 * normal na árvore, pra contornar o resize do teclado no Android - ver
 * comentário onde são usados) cobrem a tela com position:'absolute'. Na
 * web isso ancora no topo do DOCUMENTO, não da JANELA visível - se a
 * página em volta estiver rolada, o overlay e o diálogo aparecem
 * deslocados e sem escurecer a tela toda. 'fixed' resolve isso; em nativo
 * (iOS/Android) continua 'absolute' como sempre foi.
 */
export const fullscreenOverlayStyle = {
  position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  // Sem isso, na web esse overlay pode acabar pintado atrás de outro
  // conteúdo da tela mesmo cobrindo a área toda - dependendo da ordem/
  // contexto de empilhamento do que está por baixo. z-index alto garante
  // que ele sempre fica por cima, como um modal de verdade deve ficar.
  ...(Platform.OS === 'web' ? { zIndex: 1000 } : null),
};

const MODAL_DESKTOP_WIDTH = 480;

/**
 * Todos os modais do app são "bottom sheets" (colados embaixo, só cantos de
 * cima arredondados) - certo pra celular, mas numa janela larga de desktop
 * isso vira uma folha esticada colada no rodapé de uma tela gigante, muito
 * feio. No desktop, vira um diálogo flutuante centralizado de verdade.
 */
export function useModalPresentation() {
  const isDesktop = useIsDesktopWeb();
  return isDesktop
    ? {
        isDesktop,
        // 'items-center justify-center' sozinho não bastava: o painel
        // (bg-lucrei-bg, quase preto) e o fundo escurecido por trás dele
        // (também quase preto depois do bg-black/60) ficavam com tons
        // praticamente idênticos - o diálogo não se destacava do overlay,
        // parecia grudado/misturado com a lista por baixo. Fundo mais
        // escuro (/75) + borda no painel resolvem isso.
        overlayClassName: 'items-center justify-center',
        overlayBgClassName: 'bg-black/75',
        panelClassName: 'rounded-3xl border border-lucrei-border',
        panelWidthStyle: { width: '100%' as const, maxWidth: MODAL_DESKTOP_WIDTH, alignSelf: 'center' as const },
      }
    : {
        isDesktop,
        overlayClassName: 'justify-end',
        overlayBgClassName: 'bg-black/60',
        panelClassName: 'rounded-t-3xl',
        panelWidthStyle: webCapWidth(),
      };
}
