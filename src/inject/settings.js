/* settings constants live in three places by necessity:
   - shell/settings-store.js (node main process, validates disk writes)
   - preload.js (sandboxed renderer, early-paint theme/opacity)
   - this file (renderer, runtime UI)
   when adding a theme / density / etc, update all three or values silently
   round-trip through the sanitiser as defaults. */
const STORAGE_KEYS = Object.freeze({
  theme: 'terminalMessenger.theme',
  ultra: 'terminalMessenger.ultra',
  opacity: 'terminalMessenger.opacity',
  muted: 'terminalMessenger.muted',
  themeDisabled: 'terminalMessenger.themeDisabled',
  density: 'terminalMessenger.density',
  fontSizePx: 'terminalMessenger.fontSizePx',
  sentColor: 'terminalMessenger.sentColor',
  chatListFilter: 'terminalMessenger.chatListFilter'
});

const VALID_CHAT_FILTERS = ['all', 'unread'];
const DEFAULT_CHAT_FILTER = 'all';

function normaliseChatFilter(candidate) {
  return VALID_CHAT_FILTERS.includes(candidate) ? candidate : DEFAULT_CHAT_FILTER;
}

const VALID_THEMES = ['green', 'amber', 'cyan', 'mono', 'mocha', 'twilight', 'neon', 'macchiato', 'frappe', 'latte'];
const DEFAULT_THEME = 'green';
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;

const VALID_DENSITIES = ['compact', 'cozy', 'comfy'];
const DEFAULT_DENSITY = 'cozy';
const MIN_FONT_PX = 9;
const MAX_FONT_PX = 18;
const DEFAULT_FONT_PX = 12;

function normaliseDensity(candidate) {
  return VALID_DENSITIES.includes(candidate) ? candidate : DEFAULT_DENSITY;
}

function clampFontPx(rawPx) {
  const numeric = Number(rawPx);
  if (!Number.isFinite(numeric)) return DEFAULT_FONT_PX;
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.round(numeric)));
}

function normaliseTheme(candidateTheme) {
  return VALID_THEMES.includes(candidateTheme) ? candidateTheme : DEFAULT_THEME;
}

function clampOpacityPct(rawPct) {
  const numeric = Number(rawPct);
  if (!Number.isFinite(numeric)) return MAX_OPACITY_PCT;
  return Math.min(MAX_OPACITY_PCT, Math.max(MIN_OPACITY_PCT, Math.round(numeric)));
}

function readStoredString(storageKey) {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function readStoredBoolean(storageKey) {
  const storedValue = readStoredString(storageKey);
  if (storedValue === 'true') return true;
  if (storedValue === 'false') return false;
  return null;
}

function readStoredOpacityPct() {
  const storedValue = parseInt(readStoredString(STORAGE_KEYS.opacity) ?? '', 10);
  if (Number.isFinite(storedValue) && storedValue >= MIN_OPACITY_PCT && storedValue <= MAX_OPACITY_PCT) {
    return storedValue;
  }
  return null;
}

/* settings come from three places, in priority order:
   1. file-backed userData/user-settings.json (handed in via the bridge)
   2. localStorage (legacy / fast cache for early-paint)
   3. config/app.json + hard-coded defaults
   the file wins because it survives partition resets and explicit cache
   clears - localStorage on a `persist:` partition can still be wiped. */
function loadInitialSettings(userConfig) {
  const fileSettings = (window.terminalMessengerBridge?.savedSettings) ?? {};

  const savedTheme = fileSettings.theme ?? readStoredString(STORAGE_KEYS.theme);
  const savedUltra = typeof fileSettings.ultra === 'boolean'
    ? fileSettings.ultra
    : readStoredBoolean(STORAGE_KEYS.ultra);
  const savedOpacity = Number.isFinite(fileSettings.opacityPct)
    ? fileSettings.opacityPct
    : readStoredOpacityPct();
  const savedMuted = typeof fileSettings.muted === 'boolean'
    ? fileSettings.muted
    : readStoredBoolean(STORAGE_KEYS.muted);
  const savedDisabled = typeof fileSettings.themeDisabled === 'boolean'
    ? fileSettings.themeDisabled
    : readStoredBoolean(STORAGE_KEYS.themeDisabled);
  const savedDensity = typeof fileSettings.density === 'string'
    ? fileSettings.density
    : readStoredString(STORAGE_KEYS.density);
  const savedFontPx = Number.isFinite(fileSettings.fontSizePx)
    ? fileSettings.fontSizePx
    : parseInt(readStoredString(STORAGE_KEYS.fontSizePx) ?? '', 10);
  const savedSentColor = typeof fileSettings.sentColor === 'boolean'
    ? fileSettings.sentColor
    : readStoredBoolean(STORAGE_KEYS.sentColor);
  const savedChatFilter = typeof fileSettings.chatListFilter === 'string'
    ? fileSettings.chatListFilter
    : readStoredString(STORAGE_KEYS.chatListFilter);

  return {
    theme: VALID_THEMES.includes(savedTheme) ? savedTheme : normaliseTheme(userConfig.theme),
    ultra: savedUltra ?? false,
    opacityPct: savedOpacity ?? MAX_OPACITY_PCT,
    muted: savedMuted ?? false,
    themeDisabled: savedDisabled ?? false,
    density: normaliseDensity(savedDensity),
    fontSizePx: clampFontPx(savedFontPx),
    sentColor: savedSentColor ?? true,
    chatListFilter: normaliseChatFilter(savedChatFilter)
  };
}

function persistSettings(settings) {
  /* localStorage stays as a synchronous mirror so preload's early-paint can
     still read theme/opacity without waiting on disk. the JSON file (via
     bridge.saveSettings) is the durable source of truth across sessions. */
  try {
    localStorage.setItem(STORAGE_KEYS.theme, settings.theme);
    localStorage.setItem(STORAGE_KEYS.ultra, String(settings.ultra));
    localStorage.setItem(STORAGE_KEYS.opacity, String(settings.opacityPct));
    localStorage.setItem(STORAGE_KEYS.muted, String(settings.muted));
    localStorage.setItem(STORAGE_KEYS.themeDisabled, String(settings.themeDisabled));
    localStorage.setItem(STORAGE_KEYS.density, settings.density);
    localStorage.setItem(STORAGE_KEYS.fontSizePx, String(settings.fontSizePx));
    localStorage.setItem(STORAGE_KEYS.sentColor, String(settings.sentColor));
    localStorage.setItem(STORAGE_KEYS.chatListFilter, settings.chatListFilter);
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded); ignore.
  }

  const bridge = window.terminalMessengerBridge;
  if (bridge?.saveSettings) {
    bridge.saveSettings({
      theme: settings.theme,
      ultra: settings.ultra,
      opacityPct: settings.opacityPct,
      muted: settings.muted,
      themeDisabled: settings.themeDisabled,
      density: settings.density,
      fontSizePx: settings.fontSizePx,
      sentColor: settings.sentColor,
      chatListFilter: settings.chatListFilter
    }).catch((error) => {
      console.error('Could not persist settings:', error);
    });
  }
}
