const { contextBridge, ipcRenderer } = require('electron');

const STORAGE_KEY_THEME = 'terminalMessenger.theme';
const STORAGE_KEY_OPACITY = 'terminalMessenger.opacity';
const STORAGE_KEY_MUTED = 'terminalMessenger.muted';

const STORED_SETTINGS_FLAG = '--tm-stored-settings=';
const SETTINGS_SCHEMA_FLAG = '--tm-settings-schema=';

/* only used if the schema payload from main is missing or unparseable -
   shell/settings-schema.js is the real source (it derives the palette from
   terminal.css). green alone keeps early paint sane in that degraded case. */
const FALLBACK_SETTINGS_SCHEMA = {
  themes: ['green'],
  defaultTheme: 'green',
  themePalettes: { green: { background: '#050805', foreground: '#c8e8c0' } },
  minOpacityPct: 20,
  maxOpacityPct: 100
};

const EARLY_STYLE_ELEMENT_ID = 'tm-early-style';
const EARLY_REVEAL_FALLBACK_MS = 4000;

/* payloads handed in from main via additionalArguments. the sandboxed preload
   has DOM atob() but not Node's Buffer, so decode the base64 wrapper through
   atob; both payloads are ASCII-safe JSON. */
function readEncodedArgPayload(flagPrefix) {
  const flag = process.argv.find((arg) => arg.startsWith(flagPrefix));
  if (!flag) return null;
  try {
    const parsed = JSON.parse(atob(flag.slice(flagPrefix.length)));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const settingsSchema = readEncodedArgPayload(SETTINGS_SCHEMA_FLAG) ?? FALLBACK_SETTINGS_SCHEMA;
const VALID_THEMES = settingsSchema.themes;
const EARLY_THEME_PALETTES = settingsSchema.themePalettes;

/* the argv snapshot is encoded once, at window creation, so it goes stale the
   moment the user changes a setting - and an in-session reload (hourly
   refresh, cmd-R) re-runs this preload against that stale copy, reverting
   theme/density/font to their launch-time values. ask main for the live
   settings instead, keeping argv as the fallback. sendSync is acceptable
   here: preload blocks before first paint anyway and the payload is tiny. */
function readLiveStoredSettings() {
  try {
    const live = ipcRenderer.sendSync('tm:get-settings');
    if (live && typeof live === 'object') return live;
  } catch {}
  return readEncodedArgPayload(STORED_SETTINGS_FLAG) ?? {};
}

const storedSettings = readLiveStoredSettings();

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

function isUsableOpacityPct(candidate) {
  return Number.isFinite(candidate)
    && candidate >= settingsSchema.minOpacityPct
    && candidate <= settingsSchema.maxOpacityPct;
}

function readSavedOpacityPct() {
  if (isUsableOpacityPct(storedSettings.opacityPct)) return storedSettings.opacityPct;
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY_OPACITY) ?? '', 10);
    if (isUsableOpacityPct(stored)) return stored;
  } catch {}
  return settingsSchema.maxOpacityPct;
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
  const palette = EARLY_THEME_PALETTES[activeTheme]
    ?? EARLY_THEME_PALETTES[settingsSchema.defaultTheme]
    ?? FALLBACK_SETTINGS_SCHEMA.themePalettes.green;
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
  settingsSchema: JSON.parse(JSON.stringify(settingsSchema)),
  saveSettings: (partial) => ipcRenderer.invoke('tm:save-settings', partial)
});

const themeDisabled = storedSettings.themeDisabled === true;
const activeTheme = readSavedTheme() ?? settingsSchema.defaultTheme;
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
