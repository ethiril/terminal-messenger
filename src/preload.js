const { contextBridge, ipcRenderer } = require('electron');

const STORAGE_KEY_THEME = 'terminalMessenger.theme';
const STORAGE_KEY_OPACITY = 'terminalMessenger.opacity';
const STORAGE_KEY_MUTED = 'terminalMessenger.muted';
/* keep in sync with shell/settings-store.js VALID_THEMES and
   inject/settings.js VALID_THEMES. preload runs in a sandboxed renderer
   and can't require() arbitrary local modules, so this list is duplicated
   on purpose. */
const VALID_THEMES = ['green', 'amber', 'cyan', 'mono', 'mocha', 'twilight', 'neon', 'macchiato', 'frappe', 'latte'];
const STORED_SETTINGS_FLAG = '--tm-stored-settings=';

const EARLY_THEME_PALETTES = {
  green: { background: '#050805', foreground: '#c8e8c0' },
  amber: { background: '#0a0700', foreground: '#f5d99a' },
  cyan: { background: '#02080d', foreground: '#c0e8f5' },
  mono: { background: '#080808', foreground: '#d8d8d8' },
  mocha: { background: '#1e1e2e', foreground: '#cdd6f4' },
  twilight: { background: '#1c1f2e', foreground: '#dfcef5' },
  neon: { background: '#0a0518', foreground: '#d4c8ff' },
  macchiato: { background: '#24273a', foreground: '#cad3f5' },
  frappe: { background: '#303446', foreground: '#c6d0f5' },
  latte: { background: '#eff1f5', foreground: '#4c4f69' }
};

const EARLY_STYLE_ELEMENT_ID = 'tm-early-style';
const EARLY_REVEAL_FALLBACK_MS = 4000;

/* settings handed in from main via additionalArguments — survive even if
   Electron's localStorage gets purged (logout, partition reset, etc).
   the sandboxed preload has DOM atob() but not Node's Buffer, so decode
   the base64 wrapper through atob. settings keys are ASCII-safe. */
function readStoredSettingsFromArgs() {
  const flag = process.argv.find((arg) => arg.startsWith(STORED_SETTINGS_FLAG));
  if (!flag) return {};
  try {
    const encoded = flag.slice(STORED_SETTINGS_FLAG.length);
    const decoded = atob(encoded);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const storedSettings = readStoredSettingsFromArgs();

/* fb installs paste/copy/cut blockers on the composer that call
   preventDefault, killing the browser's default clipboard behavior.
   preload runs before any page script, so a window-capture listener
   registered here fires before fb's, and overwriting preventDefault on
   the event instance neuters fb's blocker even when it runs later — a
   later preventDefault() call lands on our no-op.

   we do NOT stop propagation here: Lexical (the composer's editor) has
   its own paste listener that reads clipboardData and updates the
   editor model, and fb has a separate image-paste handler that uploads
   pasted screenshots. an earlier version called stopImmediatePropagation
   to silence the blocker, but it also silenced those legitimate
   handlers — text pasted into the composer got wiped on Lexical's next
   reconcile, and image paste did nothing. text paste is now routed via
   shell/application-menu.js pasteIntoFocusedWindow → webContents.insertText
   (which fires beforeinput, not paste, sidestepping all of this);
   image paste falls back to webContents.paste, which needs fb's image
   handler to actually fire. */
function installClipboardUnblocker() {
  function isEditableTarget(target) {
    if (!target) return false;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
    if (target.isContentEditable === true) return true;
    if (typeof target.closest !== 'function') return false;
    return Boolean(target.closest('input, textarea, [contenteditable="true"], [role="textbox"]'));
  }

  function neutralizeClipboardEvent(event) {
    if (!isEditableTarget(event.target)) return;
    event.preventDefault = () => {};
  }

  for (const eventType of ['paste', 'copy', 'cut']) {
    window.addEventListener(eventType, neutralizeClipboardEvent, true);
  }
}

installClipboardUnblocker();

function readSavedTheme() {
  if (VALID_THEMES.includes(storedSettings.theme)) return storedSettings.theme;
  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
    return VALID_THEMES.includes(savedTheme) ? savedTheme : null;
  } catch {
    return null;
  }
}

function readSavedOpacityPct() {
  if (Number.isFinite(storedSettings.opacityPct)
      && storedSettings.opacityPct >= 20 && storedSettings.opacityPct <= 100) {
    return storedSettings.opacityPct;
  }
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY_OPACITY) ?? '', 10);
    if (Number.isFinite(stored) && stored >= 20 && stored <= 100) return stored;
  } catch {}
  return 100;
}

function readSavedMuted() {
  if (typeof storedSettings.muted === 'boolean') return storedSettings.muted;
  try {
    return localStorage.getItem(STORAGE_KEY_MUTED) === 'true';
  } catch {
    return false;
  }
}

function applyEarlyThemeClass(activeTheme, themeDisabled) {
  const documentRoot = document.documentElement;
  if (!documentRoot) return;
  if (themeDisabled) return;

  documentRoot.classList.add('tm-terminal-theme', `tm-theme-${activeTheme}`);
}

function buildEarlyStyleElement(activeTheme) {
  const palette = EARLY_THEME_PALETTES[activeTheme];
  const styleElement = document.createElement('style');
  styleElement.id = EARLY_STYLE_ELEMENT_ID;
  styleElement.textContent = `
    html, body {
      background: ${palette.background} !important;
      color: ${palette.foreground} !important;
    }
    body {
      visibility: hidden;
    }
    html.tm-ready body {
      visibility: visible;
    }
  `;
  return styleElement;
}

function attachEarlyStyleWhenHeadExists(styleElement) {
  if (document.head) {
    document.head.appendChild(styleElement);
    return;
  }

  const headWatcher = new MutationObserver(() => {
    if (!document.head) return;
    if (document.getElementById(EARLY_STYLE_ELEMENT_ID)) {
      headWatcher.disconnect();
      return;
    }
    document.head.appendChild(styleElement);
    headWatcher.disconnect();
  });

  headWatcher.observe(document.documentElement, { childList: true, subtree: true });
}

contextBridge.exposeInMainWorld('terminalMessengerBridge', {
  setWindowOpacityPct: (pct) => ipcRenderer.invoke('tm:set-opacity', pct),
  setWindowMuted: (muted) => ipcRenderer.invoke('tm:set-muted', muted),
  toggleWindowMuted: () => ipcRenderer.invoke('tm:toggle-muted'),
  /* clone so renderer-side mutations can't mutate this preload's copy */
  savedSettings: JSON.parse(JSON.stringify(storedSettings)),
  saveSettings: (partial) => ipcRenderer.invoke('tm:save-settings', partial)
});

const themeDisabled = storedSettings.themeDisabled === true;
const activeTheme = readSavedTheme() ?? 'green';
applyEarlyThemeClass(activeTheme, themeDisabled);
if (!themeDisabled) {
  attachEarlyStyleWhenHeadExists(buildEarlyStyleElement(activeTheme));
  /* safety valve: the early style keeps <body> hidden until the injection
     bundle adds .tm-ready. if injection never runs (load error page, an
     fb-side exception, executeJavaScript failure) the user would stare at
     a blank window forever - reveal after a grace period regardless. */
  setTimeout(() => {
    document.documentElement?.classList.add('tm-ready');
  }, EARLY_REVEAL_FALLBACK_MS);
}

/* re-apply persisted opacity early so the window doesn't flash to 100% then dim. */
const savedOpacity = readSavedOpacityPct();
if (savedOpacity !== 100) {
  ipcRenderer.invoke('tm:set-opacity', savedOpacity).catch(() => {});
}

/* re-apply persisted mute state so the window starts muted if we were muted. */
if (readSavedMuted()) {
  ipcRenderer.invoke('tm:set-muted', true).catch(() => {});
}
