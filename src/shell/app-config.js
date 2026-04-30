const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT_DIRECTORY = path.join(__dirname, '..', '..');
const APP_CONFIG_PATH = path.join(APP_ROOT_DIRECTORY, 'config', 'app.json');

const FALLBACK_APP_CONFIG = Object.freeze({
  homeUrl: 'https://www.facebook.com/messages',
  allowedHosts: ['facebook.com', 'www.facebook.com', 'messenger.com', 'www.messenger.com'],
  theme: 'green',
  window: { width: 1280, height: 860 }
});

function readTextFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Could not read ${filePath}:`, error);
    return null;
  }
}

function loadAppConfig() {
  const fileContents = readTextFileOrNull(APP_CONFIG_PATH);
  if (fileContents === null) return { ...FALLBACK_APP_CONFIG };

  try {
    const userConfig = JSON.parse(fileContents);
    return { ...FALLBACK_APP_CONFIG, ...userConfig };
  } catch (error) {
    console.error(`Could not parse ${APP_CONFIG_PATH}, using defaults:`, error);
    return { ...FALLBACK_APP_CONFIG };
  }
}

function isAllowedMessengerUrl(candidateUrl, allowedHosts) {
  let parsedUrl;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return false;

  return allowedHosts.some((allowedHost) =>
    parsedUrl.hostname === allowedHost || parsedUrl.hostname.endsWith(`.${allowedHost}`)
  );
}

module.exports = {
  FALLBACK_APP_CONFIG,
  loadAppConfig,
  isAllowedMessengerUrl,
  readTextFileOrNull
};
