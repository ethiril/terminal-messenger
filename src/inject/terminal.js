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

/* fb blocks drag-selection in messenger by calling preventDefault on
   mousedown through a path we can't reliably intercept. their bundle
   runs during HTML parsing, before our dom-ready injection - if their
   code stashes a reference to Event.prototype.preventDefault at module
   load and calls it directly, any later monkey-patch we install is
   bypassed. inline onmousedown="return false" handlers go through a
   c++ path that sets the defaultPrevented flag without re-entering JS
   either. neutralizing inline attributes catches some bubbles but
   leaves React-installed handlers intact.

   instead of fighting the blockers, drive selection ourselves via the
   Selection API. preventDefault on mousedown only stops the browser's
   built-in selection mechanism; programmatic Selection.setBaseAndExtent
   works regardless of what fb did. CSS already permits user-select:text
   on message surfaces (terminal.css), which is all the API needs.

   double-click → word, triple-click → line, both via Selection.modify
   (chromium-supported, non-standard but reliable here since this is an
   electron app pinned to a chromium build). */
function bindManualSelectionDriver() {
  const SELECTABLE_SURFACE_SELECTOR =
    "[role='log'], [data-tm-thread], [aria-roledescription='message'],"
    + " [aria-label*='Messages in conversation']";
  /* skip natively-editable surfaces - they have their own selection
     behavior we'd interfere with. NOT excluding [role='button']: fb
     wraps message bubbles in role=button, so excluding would skip
     selection on bubbles themselves. real button clicks still fire
     because we never stopPropagation - we only set selection alongside
     normal click dispatch. */
  const NATIVELY_EDITABLE_SELECTOR =
    "input, textarea, [contenteditable='true'], [role='textbox']";

  let dragOriginPoint = null;

  function caretRangeAt(x, y) {
    if (typeof document.caretRangeFromPoint === 'function') {
      return document.caretRangeFromPoint(x, y);
    }
    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(x, y);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.setEnd(position.offsetNode, position.offset);
      return range;
    }
    return null;
  }

  function applyDragSelection(originX, originY, currentX, currentY) {
    const startRange = caretRangeAt(originX, originY);
    const endRange = caretRangeAt(currentX, currentY);
    if (!startRange || !endRange) return;
    const selection = window.getSelection();
    if (!selection) return;
    try {
      /* setBaseAndExtent handles forward + backward direction in one
         call. throws if either node detached - swallow and continue
         since fb may re-render mid-drag. */
      selection.setBaseAndExtent(
        startRange.startContainer, startRange.startOffset,
        endRange.startContainer, endRange.startOffset
      );
    } catch {}
  }

  function selectExpansion(x, y, granularity) {
    const range = caretRangeAt(x, y);
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    if (typeof selection.modify !== 'function') return;
    selection.modify('move', 'backward', granularity);
    selection.modify('extend', 'forward', granularity);
  }

  function shouldDriveSelection(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(NATIVELY_EDITABLE_SELECTOR)) return false;
    return Boolean(target.closest(SELECTABLE_SURFACE_SELECTOR));
  }

  /* register on window at capture phase: runs before any listener
     deeper in the tree, so we always see the event even if fb stops
     propagation at document or below. */
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (!shouldDriveSelection(event.target)) return;

    /* event.detail counts consecutive clicks within the browser's
       double-click interval. 3+ → line, 2 → word, 1 → start drag. */
    if (event.detail >= 3) {
      selectExpansion(event.clientX, event.clientY, 'lineboundary');
      dragOriginPoint = null;
      return;
    }
    if (event.detail === 2) {
      selectExpansion(event.clientX, event.clientY, 'word');
      dragOriginPoint = null;
      return;
    }

    dragOriginPoint = { x: event.clientX, y: event.clientY };
    /* clear prior selection - matches the browser's native click-to-
       deselect behavior, which fb's preventDefault has been blocking. */
    window.getSelection()?.removeAllRanges();
  }, true);

  window.addEventListener('mousemove', (event) => {
    if (!dragOriginPoint) return;
    /* event.buttons is a bitmask; bit 0 = primary button. if the user
       released outside the window we never see mouseup, so falling
       through here resets state. */
    if ((event.buttons & 1) === 0) {
      dragOriginPoint = null;
      return;
    }
    applyDragSelection(
      dragOriginPoint.x, dragOriginPoint.y,
      event.clientX, event.clientY
    );
  }, true);

  window.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return;
    dragOriginPoint = null;
  }, true);
}

function start() {
  applyDocumentTheme();
  applyWindowOpacity(settings.opacityPct);
  applyWindowMuted(settings.muted);
  bindKeyboardShortcuts();
  bindMediaViewerEvents();
  bindMessageFocusReleaser();
  bindManualSelectionDriver();
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
