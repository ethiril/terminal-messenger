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
  if (isShiftCombo && pressedKey === 'y') {
    toggleThemeDisabled();
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

/* fb keeps DOM focus on a message bubble after the user clicks reply, and
   when the window later blurs/refocuses (or fb re-renders), the browser
   auto-scrolls the focused element into view - so the chat snaps back to
   the old message even though the user has moved on. blur message focus
   on every window blur, on every focus, AND on any pointerdown that
   doesn't land on a message/menu/dialog - that gives the user a "click
   the background to dismiss" affordance for the lingering focus state.
   inputs/contenteditables (composer + search) keep their focus normally. */
function bindMessageFocusReleaser() {
  function releaseLingeringMessageFocus() {
    const active = document.activeElement;
    if (!active || active === document.body) return;
    if (active.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
    if (active.closest('[aria-roledescription="message"], [role="article"]')) {
      active.blur();
    }
  }

  function handleBackgroundPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    /* preserve focus when the user clicks something interactive - any
       message bubble (they may want to long-press to react), the open
       toolbar/menu, the composer, or the search box */
    if (target.closest(
      '[aria-roledescription="message"],'
      + '[role="article"],'
      + '[role="menu"],'
      + '[role="menuitem"],'
      + '[role="dialog"],'
      + '[role="toolbar"],'
      + '[role="button"],'
      + '[role="link"],'
      + '[role="textbox"],'
      + 'input, textarea, [contenteditable="true"]'
    )) return;
    releaseLingeringMessageFocus();
  }

  window.addEventListener('blur', releaseLingeringMessageFocus, true);
  window.addEventListener('focus', releaseLingeringMessageFocus, true);
  document.addEventListener('pointerdown', handleBackgroundPointerDown, true);
}

function start() {
  applyDocumentTheme();
  applyWindowOpacity(settings.opacityPct);
  applyWindowMuted(settings.muted);
  bindKeyboardShortcuts();
  bindMediaViewerEvents();
  bindMessageFocusReleaser();
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
  setThemeDisabled,
  toggleThemeDisabled,
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
