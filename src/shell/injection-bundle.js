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

/* insertCSS appends a fresh copy of the stylesheet on every call and
   injectTerminalLayer fires on dom-ready, did-finish-load AND every
   did-navigate-in-page - messenger is an SPA, so thread switches would
   otherwise stack duplicate 2700-line stylesheets all session. mark the
   document once the CSS is in; the marker naturally resets on real
   navigations because the DOM is rebuilt. */
const CSS_INJECTED_MARKER = 'data-tm-css-injected';

/* serialise per-window so a dom-ready/did-finish-load pair racing on first
   load can't both observe "no marker" and double-insert. */
const injectionChains = new WeakMap();

function injectTerminalLayer(targetWindow, appConfig) {
  const previousRun = injectionChains.get(targetWindow) ?? Promise.resolve(false);
  /* swallow a rejected predecessor so one unexpected failure (e.g. the
     webContents dying mid-call) can't poison every later injection. */
  const nextRun = previousRun
    .catch(() => false)
    .then(() => performInjection(targetWindow, appConfig));
  injectionChains.set(targetWindow, nextRun);
  return nextRun;
}

async function performInjection(targetWindow, appConfig) {
  if (targetWindow.isDestroyed()) return false;
  if (!isAllowedMessengerUrl(targetWindow.webContents.getURL(), appConfig.allowedHosts)) return false;

  const injectionScript = buildInjectionScript(appConfig);
  if (injectionScript === null) return false;

  try {
    const cssAlreadyInjected = await targetWindow.webContents.executeJavaScript(
      `document.documentElement.hasAttribute('${CSS_INJECTED_MARKER}')`, true
    );
    if (!cssAlreadyInjected) {
      const terminalCss = readTextFileOrNull(TERMINAL_CSS_PATH);
      if (terminalCss === null) return false;
      await targetWindow.webContents.insertCSS(terminalCss, { cssOrigin: 'user' });
      await targetWindow.webContents.executeJavaScript(
        `document.documentElement.setAttribute('${CSS_INJECTED_MARKER}', 'true')`, true
      );
    }
    await targetWindow.webContents.executeJavaScript(injectionScript, true);
    return true;
  } catch (error) {
    console.error('Failed to inject terminal layer:', error);
    return false;
  }
}

module.exports = { injectTerminalLayer };
