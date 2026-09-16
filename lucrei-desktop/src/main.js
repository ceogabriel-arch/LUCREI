const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const APP_URL = 'https://app.lucreiapp.com/';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
// Mesma cor de fundo do app (lucrei-bg) - evita o flash branco do Electron
// enquanto a página ainda está carregando.
const BACKGROUND_COLOR = '#0A0A0B';

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    title: 'Lucrei',
    backgroundColor: BACKGROUND_COLOR,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    // Só mostra a janela quando o conteúdo já está pronto pra desenhar -
    // sem isso aparece um flash em branco do Electron antes da página
    // carregar de verdade.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.loadURL(APP_URL);

  // Se o app não carregar (sem internet, backend fora do ar), mostra uma
  // tela de erro com a cara do Lucrei em vez da tela padrão feia do
  // Chromium ("Não é possível acessar este site"). ERR_ABORTED (-3) é
  // disparado em navegações canceladas normalmente (ex: trocar de página
  // rápido demais) - não é uma falha de verdade, ignora.
  win.webContents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL.startsWith('file://')) return;
    win.loadFile(OFFLINE_PAGE);
  });

  // Links externos (ex: "Falar com vendas" via mailto:) abrem no app padrão
  // do sistema em vez de dentro do Electron. Tudo o mais (login com Google,
  // OAuth da Shopee) precisa continuar abrindo como popup de verdade, porque
  // é assim que o fluxo já funciona no navegador normal.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        backgroundColor: BACKGROUND_COLOR,
        autoHideMenuBar: true,
      },
    };
  });

  return win;
}

app.whenReady().then(() => {
  // Sem isso, o Alt abre um menu genérico do Electron (File/Edit/View,
  // DevTools etc.) que não tem nada a ver com o Lucrei.
  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
