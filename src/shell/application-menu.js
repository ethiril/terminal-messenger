const { Menu } = require('electron');
const { runRendererAction } = require('./renderer-bridge');

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
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
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
