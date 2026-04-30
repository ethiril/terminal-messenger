const { contextBridge, ipcRenderer } = require('electron');

const STORAGE_KEY_THEME = 'terminalMessenger.theme';
const STORAGE_KEY_OPACITY = 'terminalMessenger.opacity';
const VALID_THEMES = ['green', 'amber', 'cyan', 'mono', 'mocha', 'neon', 'macchiato', 'frappe', 'latte'];

const EARLY_THEME_PALETTES = {
  green: { background: '#050805', foreground: '#c8e8c0' },
  amber: { background: '#0a0700', foreground: '#f5d99a' },
  cyan: { background: '#02080d', foreground: '#c0e8f5' },
  mono: { background: '#080808', foreground: '#d8d8d8' },
  mocha: { background: '#1e1e2e', foreground: '#cdd6f4' },
  neon: { background: '#0a0518', foreground: '#d4c8ff' },
  macchiato: { background: '#24273a', foreground: '#cad3f5' },
  frappe: { background: '#303446', foreground: '#c6d0f5' },
  latte: { background: '#eff1f5', foreground: '#4c4f69' }
};

const EARLY_STYLE_ELEMENT_ID = 'tm-early-style';

function readSavedTheme() {
  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
    return VALID_THEMES.includes(savedTheme) ? savedTheme : null;
  } catch {
    return null;
  }
}

function readSavedOpacityPct() {
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY_OPACITY) ?? '', 10);
    if (Number.isFinite(stored) && stored >= 20 && stored <= 100) return stored;
  } catch {}
  return 100;
}

function applyEarlyThemeClass(activeTheme) {
  const documentRoot = document.documentElement;
  if (!documentRoot) return;

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
  toggleWindowMuted: () => ipcRenderer.invoke('tm:toggle-muted')
});

const activeTheme = readSavedTheme() ?? 'green';
applyEarlyThemeClass(activeTheme);
attachEarlyStyleWhenHeadExists(buildEarlyStyleElement(activeTheme));

/* re-apply persisted opacity early so the window doesn't flash to 100% then dim. */
const savedOpacity = readSavedOpacityPct();
if (savedOpacity !== 100) {
  ipcRenderer.invoke('tm:set-opacity', savedOpacity).catch(() => {});
}

/* re-apply persisted mute state so the window starts muted if we were muted. */
function readSavedMuted() {
  try {
    return localStorage.getItem('terminalMessenger.muted') === 'true';
  } catch {
    return false;
  }
}
if (readSavedMuted()) {
  ipcRenderer.invoke('tm:set-muted', true).catch(() => {});
}
