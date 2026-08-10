const path = require('node:path');
/* optional-chained at every use: scripts/check-bundle.js requires this module
   outside Electron, where `app` is undefined. */
const { app } = require('electron');
const { readTextFileOrNull, isAllowedMessengerUrl } = require('./app-config');
const { SETTINGS_SCHEMA } = require('./settings-schema');

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

/* reading 14 files off disk on every SPA navigation is pure overhead in a
   packaged build, where the sources can't change under us. in development we
   keep re-reading so editing an inject module and hitting reload still picks
   the change up without restarting Electron. */
let cachedModuleSources = null;

function readInjectModuleSources() {
  if (cachedModuleSources) return cachedModuleSources;
  const moduleSources = INJECT_SCRIPT_FILES.map(readTextFileOrNull);
  if (moduleSources.some((source) => source === null)) return null;
  if (app?.isPackaged) cachedModuleSources = moduleSources;
  return moduleSources;
}

function buildInjectionScript(appConfig) {
  const moduleSources = readInjectModuleSources();
  if (moduleSources === null) return null;

  const userPreferences = JSON.stringify({
    theme: appConfig.theme
  });
  /* the inject modules can't require() shell/settings-schema.js, so hand them
     the same constants main and preload use through a prelude written ahead
     of the bundle. */
  const settingsSchema = JSON.stringify(SETTINGS_SCHEMA);

  const concatenatedModules = moduleSources.join('\n\n');
  return `window.__TERMINAL_MESSENGER_CONFIG__ = ${userPreferences};\n`
    + `window.__TERMINAL_MESSENGER_SCHEMA__ = ${settingsSchema};\n`
    + `(() => {\n${concatenatedModules}\n})();`;
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

/* on an SPA thread switch the bundle's first statement just re-applies and
   returns, so shipping ~180KB of source over the IPC boundary to get there is
   wasted work. ask the renderer to do that re-apply directly; only build and
   send the bundle when it reports itself detached. */
const REATTACH_PROBE = 'window.TerminalMessenger?.attached '
  + '? (window.TerminalMessenger.apply(), true) : false';

async function performInjection(targetWindow, appConfig) {
  if (targetWindow.isDestroyed()) return false;
  if (!isAllowedMessengerUrl(targetWindow.webContents.getURL(), appConfig.allowedHosts)) return false;

  try {
    const alreadyAttached = await targetWindow.webContents.executeJavaScript(REATTACH_PROBE, true);
    if (alreadyAttached === true) return true;
  } catch {
    /* probe failed (page mid-navigation, JS blocked) - fall through and do
       the full injection, which is the behaviour we had before the probe. */
  }

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

/* buildInjectionScript is exported for scripts/check-bundle.js: inject/terminal.js
   is only legal inside the IIFE assembled here (it uses top-level `return`), so
   per-file `node --check` can't validate it. */
module.exports = { injectTerminalLayer, buildInjectionScript };
