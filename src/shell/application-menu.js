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

const IS_MAC = process.platform === 'darwin';

/* on darwin, Option+Left/Right is the system-wide word-jump the user expects
   while typing in the composer - claiming it for history navigation broke
   text editing app-wide. use the platform-native Cmd+[ / Cmd+] there and keep
   Alt+Arrow on win/linux where it IS the platform convention.
   mirrored in web-contents-guards.js shortcutHandlerFor - update both. */
const HISTORY_BACK_ACCELERATOR = IS_MAC ? 'Cmd+[' : 'Alt+Left';
const HISTORY_FORWARD_ACCELERATOR = IS_MAC ? 'Cmd+]' : 'Alt+Right';

/* the macOS app-menu roles below don't exist on other platforms, where they
   would render as dead entries. */
function buildAppMenuSubmenu() {
  if (!IS_MAC) {
    return [
      { role: 'about' },
      { type: 'separator' },
      { role: 'quit' }
    ];
  }
  return [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
  ];
}

function buildApplicationMenu(appConfig) {
  const menuTemplate = [
    {
      label: 'Terminal Messenger',
      /* `hide` restores Cmd+H to its macOS-universal meaning; Home moved to
         Shift+Cmd+H, which it had been shadowing. */
      submenu: buildAppMenuSubmenu()
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
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow?.webContents, 'openPalette')
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow?.webContents, 'toggleTheme')
        },
        {
          label: 'Toggle Ultra Terminal Mode',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow?.webContents, 'toggleUltra')
        },
        {
          label: 'Search Chats',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow?.webContents, 'openSearchOverlay')
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
          accelerator: 'CmdOrCtrl+Shift+H',
          click: (_menuItem, focusedWindow) => focusedWindow?.loadURL(appConfig.homeUrl)
        },
        {
          label: 'Back',
          accelerator: HISTORY_BACK_ACCELERATOR,
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goBack()
        },
        {
          label: 'Forward',
          accelerator: HISTORY_FORWARD_ACCELERATOR,
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goForward()
        }
      ]
    },
    /* restores Cmd+W (close), Cmd+M (minimize), zoom and window cycling -
       without this menu those keys did nothing at all. */
    { role: 'windowMenu' }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

module.exports = { buildApplicationMenu };
