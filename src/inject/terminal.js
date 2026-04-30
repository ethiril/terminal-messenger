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

/* fb blocks drag-selection in messenger using two layers of defense:
   (1) capture-phase event handlers that call event.preventDefault() on
       mousedown/selectstart/dragstart, and
   (2) inline onmousedown="return false" handlers on bubble wrappers.

   stopping propagation at the window level neutralizes (1) only when
   our listener runs first, which isn't guaranteed if fb registered on
   window at capture phase before our injection ran. and stopping
   propagation does nothing about (2), since inline handlers fire at
   target phase regardless.

   the only fully reliable counter is to neutralize preventDefault()
   itself for selection-related events when the target is inside a
   message surface. monkey-patching Event.prototype.preventDefault is
   surgical: it only no-ops the call when type+target match, and
   passes through unchanged for everything else (link clicks etc).

   we also stopImmediatePropagation as a belt-and-suspenders measure -
   useful for fb listeners that don't preventDefault but instead clear
   the selection programmatically (selection.removeAllRanges). runs in
   both terminal and vanilla mode. */
function bindSelectionUnblocker() {
  const SELECTABLE_SURFACE_SELECTOR =
    "[role='log'], [data-tm-thread], [aria-roledescription='message'],"
    + " [aria-label*='Messages in conversation'], [role='article']";
  const INTERACTIVE_TARGET_SELECTOR =
    "a, button, [role='button'], [role='link'], [role='menuitem'], img, video,"
    + " input, textarea, [contenteditable='true'], [role='textbox']";
  const NEUTRALIZED_EVENT_TYPES = new Set([
    'mousedown', 'selectstart', 'dragstart'
  ]);

  const isInsideSelectableSurface = (target) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(SELECTABLE_SURFACE_SELECTOR));
  };

  /* monkey-patch Event.prototype.preventDefault so fb's handlers can't
     stop selection from starting. only no-ops for the relevant event
     types when target is inside a message surface; everything else
     passes through to the original. covers both delegated handlers
     and inline onfoo="return false" attributes. */
  const originalPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function patchedPreventDefault() {
    if (NEUTRALIZED_EVENT_TYPES.has(this.type)) {
      const target = this.target;
      if (target instanceof Element
          && !target.closest(INTERACTIVE_TARGET_SELECTOR)
          && target.closest(SELECTABLE_SURFACE_SELECTOR)) {
        return;
      }
    }
    return originalPreventDefault.apply(this, arguments);
  };

  /* register on window at capture phase: capture dispatches window →
     document → ... in tree order, so a window-level capture listener
     fires before any of fb's handlers at document or descendants. */
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(INTERACTIVE_TARGET_SELECTOR)) return;
    if (!isInsideSelectableSurface(target)) return;
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('selectstart', (event) => {
    if (!isInsideSelectableSurface(event.target)) return;
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches('img, video, a')) return;
    if (!isInsideSelectableSurface(target)) return;
    event.stopImmediatePropagation();
  }, true);
}

function start() {
  applyDocumentTheme();
  applyWindowOpacity(settings.opacityPct);
  applyWindowMuted(settings.muted);
  bindKeyboardShortcuts();
  bindMediaViewerEvents();
  bindMessageFocusReleaser();
  bindSelectionUnblocker();
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
