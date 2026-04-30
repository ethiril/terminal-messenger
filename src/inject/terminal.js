if (window.TerminalMessenger?.attached) {
  window.TerminalMessenger.apply();
  return;
}

const userConfig = window.__TERMINAL_MESSENGER_CONFIG__ ?? {};
const settings = loadInitialSettings(userConfig);

let keyboardShortcutsBound = false;
let mutationObserverStarted = false;

function handleKeyboardShortcut(event) {
  const isPrimaryModifier = event.ctrlKey || event.metaKey;
  const pressedKey = event.key?.toLowerCase();
  if (!pressedKey) return;

  const isShiftCombo = isPrimaryModifier && event.shiftKey;

  if (isShiftCombo && pressedKey === 'p') {
    openPalette();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (isShiftCombo && pressedKey === 't') {
    toggleTheme();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (isShiftCombo && pressedKey === 'u') {
    toggleUltra();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (isShiftCombo && pressedKey === 's') {
    openSearchOverlay();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (isShiftCombo && pressedKey === 'm') {
    toggleMuted();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === '/' && !isUserTypingInto(event.target)) {
    openPalette(':');
    event.preventDefault();
  }
}

function bindKeyboardShortcuts() {
  if (keyboardShortcutsBound) return;
  keyboardShortcutsBound = true;
  document.addEventListener('keydown', handleKeyboardShortcut, true);
}

function startMutationObserver() {
  if (mutationObserverStarted || !document.body) return;
  mutationObserverStarted = true;
  new MutationObserver(scheduleApply).observe(document.body, { childList: true, subtree: true });
}

function start() {
  applyDocumentTheme();
  applyWindowOpacity(settings.opacityPct);
  applyWindowMuted(settings.muted);
  bindKeyboardShortcuts();
  bindMediaViewerEvents();
  startMutationObserver();
  startStatuslineClock();
}

window.TerminalMessenger = {
  attached: true,
  apply: applyDocumentTheme,
  openPalette,
  closePalette,
  openSearchOverlay,
  closeSearchOverlay,
  toggleTheme,
  setTheme,
  setUltra,
  toggleUltra,
  setOpacityPct,
  setMuted,
  toggleMuted,
  focusConversationInput,
  focusSearch: focusSearchInput,
  searchMessenger,
  gotoChatByName
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
