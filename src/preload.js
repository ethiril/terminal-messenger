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
