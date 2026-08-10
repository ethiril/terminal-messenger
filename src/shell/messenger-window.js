const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { injectTerminalLayer } = require('./injection-bundle');
const { SETTINGS_SCHEMA } = require('./settings-schema');

const PRELOAD_SCRIPT_PATH = path.join(__dirname, '..', 'preload.js');
const FIRST_PAINT_FALLBACK_MS = 5000;

/* fb messenger leaks renderer memory over long sessions (large react tree,
   scroll-virtualised log backbuffer, retained media). reload every hour
   while the window is unfocused so we never interrupt active typing. */
const RENDERER_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/* "unfocused" is not the same as "idle": an unfocused window can still hold a
   half-typed reply or an in-progress call, and reloading throws both away.
   probe the renderer for those before refreshing; if it's busy we simply wait
   for the next interval. */
const RENDERER_IDLE_PROBE = `(() => {
  const composer = document.querySelector('[contenteditable="true"][role="textbox"], [aria-label*="Message"][contenteditable="true"]');
  const hasDraft = Boolean(composer && (composer.textContent ?? '').trim());
  const isPlayingMedia = Array.from(document.querySelectorAll('video, audio'))
    .some((element) => !element.paused && !element.ended);
  return !hasDraft && !isPlayingMedia;
})()`;

async function rendererIsSafeToReload(webContents) {
  /* audio can be playing in a frame the probe's document.querySelectorAll
     never sees (fb renders calls in nested iframes), so ask main too. */
  if (webContents.isCurrentlyAudible()) return false;
  try {
    return await webContents.executeJavaScript(RENDERER_IDLE_PROBE, true) === true;
  } catch {
    /* probe failed - the page may be mid-navigation or showing an error.
       a reload is the safe move there, not a skip. */
    return true;
  }
}

/* Chromium's default network-error page is a jarring white slab in an
   otherwise all-terminal app, and it has no way back - the user had to quit
   and relaunch. serve a themed page instead, which retries by itself the
   moment connectivity returns. */
const ABORTED_LOAD_ERROR_CODE = -3;
const LOAD_FAILURE_PAGE_MARKER = 'tm-load-failure';

function buildLoadFailurePage(homeUrl, errorDescription, activeTheme) {
  const palette = SETTINGS_SCHEMA.themePalettes[activeTheme]
    ?? SETTINGS_SCHEMA.themePalettes[SETTINGS_SCHEMA.defaultTheme];
  const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]
  ));
  return `<!doctype html>
<html class="tm-ready" data-${LOAD_FAILURE_PAGE_MARKER}>
<meta charset="utf-8">
<title>Messenger</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: ${palette.background}; color: ${palette.foreground};
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    display: flex; align-items: center; justify-content: center;
  }
  main { max-width: 46ch; padding: 0 2ch; }
  h1 { font-size: 13px; font-weight: 700; margin: 0 0 1em; }
  p { margin: 0 0 1em; opacity: 0.75; }
  code { word-break: break-all; }
  button {
    font: inherit; color: inherit; background: transparent; cursor: pointer;
    border: 1px solid currentColor; border-radius: 2px; padding: 0.4em 1.2em;
  }
  button:hover { background: rgba(128, 128, 128, 0.18); }
</style>
<main>
  <h1>&#10071; messenger: connection failed</h1>
  <p><code>${escapeHtml(errorDescription)}</code></p>
  <p>Retrying automatically when the network comes back.</p>
  <button id="retry" type="button">retry now</button>
</main>
<script>
  var home = ${JSON.stringify(homeUrl)};
  function retry() { location.href = home; }
  document.getElementById('retry').addEventListener('click', retry);
  window.addEventListener('online', retry);
</script>
</html>`;
}

function unreadCountFromTitle(updatedTitle) {
  const unreadMatch = updatedTitle?.match(/\((\d+)\)/);
  return unreadMatch ? Number(unreadMatch[1]) : 0;
}

function formatTitleWithUnreadCount(unreadCount) {
  return unreadCount > 0 ? `Messenger (${unreadCount})` : 'Messenger';
}

/* the window title only communicates unread count while the window is
   visible; the dock/taskbar badge survives hiding and minimising. no-op on
   Windows, where Electron has no badge API. */
function updateUnreadBadge(unreadCount) {
  if (process.platform === 'win32') return;
  try {
    app.setBadgeCount(unreadCount);
  } catch {}
}

function createMessengerWindow(appConfig, sessionPartition, storedSettings = {}) {
  const windowSize = appConfig.window ?? {};
  /* additionalArguments lands in process.argv inside the sandboxed preload,
     which can't require() local modules. encoded as base64 so the JSON
     survives the command-line tokeniser (quotes, spaces) intact.
     the schema is static, so argv is its only transport; the settings
     snapshot is only a fallback - it's frozen at window-creation time, so
     preload asks main for the live values first (see tm:get-settings). */
  const encodedSettings = Buffer.from(JSON.stringify(storedSettings), 'utf8').toString('base64');
  const encodedSchema = Buffer.from(JSON.stringify(SETTINGS_SCHEMA), 'utf8').toString('base64');
  const messengerWindow = new BrowserWindow({
    width: windowSize.width ?? 1280,
    height: windowSize.height ?? 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Messenger',
    backgroundColor: '#050805',
    autoHideMenuBar: true,
    show: false,
    /* drop the macOS gray title bar; statusline takes over as drag handle */
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      partition: sessionPartition,
      preload: PRELOAD_SCRIPT_PATH,
      additionalArguments: [
        `--tm-stored-settings=${encodedSettings}`,
        `--tm-settings-schema=${encodedSchema}`
      ]
    }
  });

  let firstPaintShown = false;
  function showOnceReady() {
    if (firstPaintShown || messengerWindow.isDestroyed()) return;
    firstPaintShown = true;
    messengerWindow.show();
  }
  setTimeout(showOnceReady, FIRST_PAINT_FALLBACK_MS);

  /* navigation guards, context menu and the shortcut pipeline are bound in
     main.js via app.on('web-contents-created') so popups get them too. */

  messengerWindow.on('page-title-updated', (event, updatedTitle) => {
    event.preventDefault();
    const unreadCount = unreadCountFromTitle(updatedTitle);
    messengerWindow.setTitle(formatTitleWithUnreadCount(unreadCount));
    updateUnreadBadge(unreadCount);
  });

  messengerWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    /* subframe failures are fb's own business, and ERR_ABORTED is what a
       superseded navigation reports - neither means the app is offline. */
    if (!isMainFrame) return;
    if (errorCode === ABORTED_LOAD_ERROR_CODE) return;
    if (failedUrl?.startsWith('data:')) return;
    showOnceReady();
    const activeTheme = storedSettings.theme ?? SETTINGS_SCHEMA.defaultTheme;
    const failurePage = buildLoadFailurePage(appConfig.homeUrl, errorDescription, activeTheme);
    messengerWindow.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(failurePage)}`
    );
  });

  messengerWindow.webContents.on('dom-ready', async () => {
    const injectionSucceeded = await injectTerminalLayer(messengerWindow, appConfig);
    if (injectionSucceeded) showOnceReady();
  });
  messengerWindow.webContents.on('did-navigate-in-page', () => injectTerminalLayer(messengerWindow, appConfig));
  messengerWindow.webContents.on('did-finish-load', async () => {
    await injectTerminalLayer(messengerWindow, appConfig);
    showOnceReady();
  });

  const refreshInterval = setInterval(async () => {
    if (messengerWindow.isDestroyed()) return;
    if (messengerWindow.isFocused()) return;
    if (!await rendererIsSafeToReload(messengerWindow.webContents)) return;
    if (messengerWindow.isDestroyed() || messengerWindow.isFocused()) return;
    messengerWindow.webContents.reload();
  }, RENDERER_REFRESH_INTERVAL_MS);
  messengerWindow.on('closed', () => clearInterval(refreshInterval));

  messengerWindow.loadURL(appConfig.homeUrl);
  return messengerWindow;
}

module.exports = { createMessengerWindow };
