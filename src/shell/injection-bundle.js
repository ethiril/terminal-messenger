const path = require('node:path');
const { readTextFileOrNull, isAllowedMessengerUrl } = require('./app-config');

const TERMINAL_INJECT_DIRECTORY = path.join(__dirname, '..', 'inject');
const TERMINAL_CSS_PATH = path.join(TERMINAL_INJECT_DIRECTORY, 'terminal.css');

/* concatenation order matters: selectors → helpers → tagging → consumers */
const INJECT_SCRIPT_FILES = [
  'settings.js',
  'selectors.js',
  'dom-helpers.js',
  'chrome-tagging.js',
  'message-tagging.js',
  'messenger-actions.js',
  'statusline.js',
  'toast.js',
  'search-overlay.js',
  'command-palette.js',
  'media-viewer.js',
  'theme-application.js',
  'terminal.js'
].map((fileName) => path.join(TERMINAL_INJECT_DIRECTORY, fileName));

function buildInjectionScript(appConfig) {
  const moduleSources = INJECT_SCRIPT_FILES.map(readTextFileOrNull);
  if (moduleSources.some((source) => source === null)) return null;

  const userPreferences = JSON.stringify({
    theme: appConfig.theme
  });

  const concatenatedModules = moduleSources.join('\n\n');
  return `window.__TERMINAL_MESSENGER_CONFIG__ = ${userPreferences};\n(() => {\n${concatenatedModules}\n})();`;
}

async function injectTerminalLayer(targetWindow, appConfig) {
  if (targetWindow.isDestroyed()) return false;
  if (!isAllowedMessengerUrl(targetWindow.webContents.getURL(), appConfig.allowedHosts)) return false;

  const terminalCss = readTextFileOrNull(TERMINAL_CSS_PATH);
  if (terminalCss === null) return false;

  const injectionScript = buildInjectionScript(appConfig);
  if (injectionScript === null) return false;

  try {
    await targetWindow.webContents.insertCSS(terminalCss, { cssOrigin: 'user' });
    await targetWindow.webContents.executeJavaScript(injectionScript, true);
    return true;
  } catch (error) {
    console.error('Failed to inject terminal layer:', error);
    return false;
  }
}

module.exports = { injectTerminalLayer };
