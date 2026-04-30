const STORAGE_KEYS = Object.freeze({
  theme: 'terminalMessenger.theme',
  ultra: 'terminalMessenger.ultra',
  opacity: 'terminalMessenger.opacity',
  muted: 'terminalMessenger.muted',
  themeDisabled: 'terminalMessenger.themeDisabled'
});

const VALID_THEMES = ['green', 'amber', 'cyan', 'mono'];
const DEFAULT_THEME = 'green';
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;

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

function loadInitialSettings(userConfig) {
  const savedTheme = readStoredString(STORAGE_KEYS.theme);
  const savedUltra = readStoredBoolean(STORAGE_KEYS.ultra);
  const savedOpacity = readStoredOpacityPct();
  const savedMuted = readStoredBoolean(STORAGE_KEYS.muted);
  const savedDisabled = readStoredBoolean(STORAGE_KEYS.themeDisabled);

  return {
    theme: VALID_THEMES.includes(savedTheme) ? savedTheme : normaliseTheme(userConfig.theme),
    ultra: savedUltra ?? false,
    opacityPct: savedOpacity ?? MAX_OPACITY_PCT,
    muted: savedMuted ?? false,
    themeDisabled: savedDisabled ?? false
  };
}

function persistSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.theme, settings.theme);
    localStorage.setItem(STORAGE_KEYS.ultra, String(settings.ultra));
    localStorage.setItem(STORAGE_KEYS.opacity, String(settings.opacityPct));
    localStorage.setItem(STORAGE_KEYS.muted, String(settings.muted));
    localStorage.setItem(STORAGE_KEYS.themeDisabled, String(settings.themeDisabled));
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded); ignore.
  }
}
