const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const SETTINGS_FILE_NAME = 'user-settings.json';

const VALID_THEMES = ['green', 'amber', 'cyan', 'mono', 'mocha', 'twilight', 'neon', 'macchiato', 'frappe', 'latte'];
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;

const ALLOWED_KEYS = Object.freeze({
  theme: (value) => VALID_THEMES.includes(value),
  ultra: (value) => typeof value === 'boolean',
  themeDisabled: (value) => typeof value === 'boolean',
  muted: (value) => typeof value === 'boolean',
  opacityPct: (value) =>
    Number.isFinite(value) && value >= MIN_OPACITY_PCT && value <= MAX_OPACITY_PCT
});

function settingsFilePath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function loadStoredSettings() {
  const filePath = settingsFilePath();
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not read ${filePath}:`, error);
    }
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`Could not parse ${filePath}, ignoring:`, error);
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};

  const sanitised = {};
  for (const [key, validator] of Object.entries(ALLOWED_KEYS)) {
    if (key in parsed && validator(parsed[key])) {
      sanitised[key] = parsed[key];
    }
  }
  return sanitised;
}

/* atomic write via temp+rename so a crash mid-write can't truncate the
   settings file - the user would otherwise lose every preference at once. */
function saveStoredSettings(nextSettings) {
  const filePath = settingsFilePath();
  const sanitised = {};
  for (const [key, validator] of Object.entries(ALLOWED_KEYS)) {
    if (key in nextSettings && validator(nextSettings[key])) {
      sanitised[key] = nextSettings[key];
    }
  }
  const tempPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(sanitised, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error(`Could not write ${filePath}:`, error);
    try { fs.unlinkSync(tempPath); } catch {}
    return false;
  }
}

module.exports = {
  loadStoredSettings,
  saveStoredSettings,
  settingsFilePath
};
