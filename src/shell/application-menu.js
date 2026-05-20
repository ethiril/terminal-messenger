const { Menu, clipboard } = require('electron');
const { runRendererAction } = require('./renderer-bridge');

/* the messenger composer is a Lexical contenteditable. fb installs paste
   blockers on the paste event, and Lexical itself only updates its editor
   model from inside its own paste listener — so stopping fb's blocker
   (preload.js installClipboardUnblocker) also stops Lexical, and the
   browser-default text we insert gets wiped on the next reconcile. avoid
   the paste event entirely: feed text through Chromium's editor command
   pipeline via webContents.insertText, which fires beforeinput/input
   (which Lexical does honor) instead of paste. fall back to the native
   paste for image clipboards so screenshots still work. */
function pasteIntoFocusedWindow(focusedWindow) {
  if (!focusedWindow || focusedWindow.isDestroyed()) return;

  /* DevTools (docked or undocked) lives in its own webContents. our custom
     menu accelerator intercepts Cmd+V regardless of which webContents has
     focus, so without this guard the user can't paste into the DevTools
     console — webContents.insertText targets the page's focused editable,
     not DevTools, so the paste silently no-ops (or worse, dumps clipboard
     text into the messenger composer when it's the focused editable).
     route through the DevTools webContents' native paste when DevTools is
     focused so the console / sources panel / editors all work normally. */
  if (focusedWindow.webContents.isDevToolsFocused()) {
    const devToolsContents = focusedWindow.webContents.devToolsWebContents;
    if (devToolsContents && !devToolsContents.isDestroyed()) {
      devToolsContents.paste();
    }
    return;
  }

  const hasImageOnClipboard = clipboard.availableFormats().some(
    (format) => format.startsWith('image/')
  );
  if (hasImageOnClipboard) {
    focusedWindow.webContents.paste();
    return;
  }
  const clipboardText = clipboard.readText();
  if (!clipboardText) {
    focusedWindow.webContents.paste();
    return;
  }
  focusedWindow.webContents.insertText(clipboardText);
}

function buildApplicationMenu(appConfig) {
  const menuTemplate = [
    {
      label: 'Terminal Messenger',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: (_menuItem, focusedWindow) => pasteIntoFocusedWindow(focusedWindow)
        },
        {
          label: 'Paste and Match Style',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: (_menuItem, focusedWindow) => pasteIntoFocusedWindow(focusedWindow)
        },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'openPalette')
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'toggleTheme')
        },
        {
          label: 'Toggle Ultra Terminal Mode',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'toggleUltra')
        },
        {
          label: 'Search Chats',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'openSearchOverlay')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+H',
          click: (_menuItem, focusedWindow) => focusedWindow?.loadURL(appConfig.homeUrl)
        },
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goBack()
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goForward()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

module.exports = { buildApplicationMenu };
