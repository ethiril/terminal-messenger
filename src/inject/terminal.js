if (window.TerminalMessenger?.attached) {
  window.TerminalMessenger.apply();
  return;
}

const userConfig = window.__TERMINAL_MESSENGER_CONFIG__ ?? {};
const settings = loadInitialSettings(userConfig);

let keyboardShortcutsBound = false;
let mutationObserverStarted = false;
let gKeyPendingTimer = null;

/* renderer-side keyboard pipeline. mirrors the main-process handler in
   shell/messenger-window.js shortcutHandlerFor() - both fire so a stuck
   renderer doesn't lock out the keybindings. when adding/changing a
   shortcut, update BOTH or one of the two firing paths will miss. */
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
    return;
  }

  /* vim-style navigation: j/k move through the chat list, gg jumps to
     log top, G jumps to log bottom. only fire when the user is not
     typing into a field, so plain text entry stays unaffected. */
  if (isUserTypingInto(event.target)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (pressedKey === 'j' && !event.shiftKey) {
    moveChatListCursor(1);
    event.preventDefault();
    return;
  }
  if (pressedKey === 'k' && !event.shiftKey) {
    moveChatListCursor(-1);
    event.preventDefault();
    return;
  }
  if (event.key === 'Enter' && chatListCursorRow) {
    openChatListCursorTarget();
    event.preventDefault();
    return;
  }
  if (pressedKey === 'n') {
    /* vim-style step through the last search's in-thread matches.
       N (shift+n) walks backward; n walks forward. requires a prior
       :search or ⌘⇧S query - silently no-ops otherwise so the key
       doesn't surface noise on every press. */
    const stepped = stepLastMessageMatch(event.shiftKey ? -1 : 1);
    if (stepped) {
      event.preventDefault();
      return;
    }
  }
  if (pressedKey === 'g' && event.shiftKey) {
    /* shift+G - jump to bottom of the log */
    scrollLogToBottom();
    event.preventDefault();
    return;
  }
  if (pressedKey === 'g' && !event.shiftKey) {
    /* double-tap g (gg) - jump to top of the log. matches vim. */
    if (gKeyPendingTimer) {
      clearTimeout(gKeyPendingTimer);
      gKeyPendingTimer = null;
      scrollLogToTop();
    } else {
      gKeyPendingTimer = setTimeout(() => { gKeyPendingTimer = null; }, 500);
    }
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
  /* childList catches subtree swaps, but React re-renders often rewrite
     the style attribute IN PLACE (no node churn) - wiping the inline
     layout restructureMediaReply applied to media-reply rows, which then
     stayed raw (reply text overlapping the thumbnail) until an unrelated
     mutation happened to fire. watch style attributes too; filtered to
     style only, and per-pass writers skip identical values, so our own
     apply passes don't re-trigger the observer in a loop. */
  new MutationObserver(scheduleApply).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
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

    /* only relevant while focus is lingering inside a message bubble */
    const active = document.activeElement;
    if (!active || active === document.body) return;
    if (active.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
    const focusedMessage = active.closest('[aria-roledescription="message"], [role="article"]');
    if (!focusedMessage) return;

    /* keep focus for interactions that operate ON the focused message:
       clicks inside that same message (react/reply/long-press), the
       popped-out menu/reaction picker/dialog/toolbar, and text inputs.
       everything else - the log background, ANOTHER message, the chat
       list - releases the highlight. the previous exclusion list here
       included [role="button"]/[role="link"]/any message, which matches
       nearly every pixel of fb's DOM, so "click off to dismiss" almost
       never actually fired. */
    if (target.closest(
      '[role="menu"],'
      + '[role="menuitem"],'
      + '[role="dialog"],'
      + '[role="toolbar"],'
      + '[role="textbox"],'
      + 'input, textarea, [contenteditable="true"]'
    )) return;
    const targetMessage = target.closest('[aria-roledescription="message"], [role="article"]');
    if (targetMessage === focusedMessage) return;

    active.blur();
  }

  /* NOTE: an earlier iteration auto-blurred row/bubble focus the moment
     it landed (focusin listener). that FOUGHT fb's focus manager: fb
     restores the focus its state says it owns, every restore re-runs
     scroll-into-view, and the log kept snapping back to the jumped-to
     message while clicks appeared dead (fb's own click-to-release -
     data-release-focus-from="CLICK" - never saw a stable focus to
     release). so: leave fb's focus lifecycle alone and just keep the
     ring invisible via CSS; fb itself releases on the next click. */

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

/* the shell builds the right-click menu from Electron's context-menu event,
   which never fires if the page cancels the contextmenu event - and fb
   suppresses it across much of the app. window-capture runs before any
   document-level listener fb registers, so stopping propagation here keeps
   fb's handlers from ever seeing the event while the browser default (the
   shell's menu request) proceeds untouched. */
let nativeContextMenuGuardBound = false;
function bindNativeContextMenuGuard() {
  if (nativeContextMenuGuardBound) return;
  nativeContextMenuGuardBound = true;
  window.addEventListener('contextmenu', (event) => {
    event.stopImmediatePropagation();
  }, true);
}

function start() {
  applyDocumentTheme();
  applyWindowOpacity(settings.opacityPct);
  applyWindowMuted(settings.muted);
  bindKeyboardShortcuts();
  bindNativeContextMenuGuard();
  bindMediaViewerEvents();
  bindImageCollapseHandler();
  bindMessageFocusReleaser();
  bindChatListCursorRelease();
  bindManualSelectionDriver();
  startMutationObserver();
  startStatuslineClock();
  bindWindowFocusIndicator();
  bindJumpToBottomIndicator();
  bindConnectionStatus();
}

/* show a small "↓ latest" button while the user is scrolled up in the
   log. fb's chat log is replaced on thread switch so we can't capture
   the element once and bind to it - listen at the document level (with
   capture phase) and re-evaluate alongside our existing mutation-driven
   apply pass instead of polling on a wall-clock interval. that path
   already fires when fb appends a new message at the bottom while we're
   scrolled up; piggy-backing avoids a forever-running setInterval that
   forces a layout flush ten times a minute on idle.

   also tracks the composer height so the indicator sits just above the
   composer in ultra mode (where the composer is position:fixed and can
   grow with multi-line typing) without overlapping. */
function bindJumpToBottomIndicator() {
  function getOrCreateIndicator() {
    const existing = document.getElementById('tm-jump-bottom');
    if (existing) return existing;
    const indicator = document.createElement('button');
    indicator.id = 'tm-jump-bottom';
    indicator.type = 'button';
    indicator.setAttribute('aria-label', 'jump to latest message');
    indicator.textContent = '↓ latest';
    indicator.addEventListener('click', () => scrollLogToBottom());
    document.documentElement.appendChild(indicator);
    return indicator;
  }

  function evaluate() {
    const log = document.querySelector('[role="log"], [data-tm-thread]');
    if (!log) return;
    const remaining = log.scrollHeight - log.scrollTop - log.clientHeight;
    const ind = getOrCreateIndicator();
    if (remaining > 200) {
      ind.classList.add('tm-jump-bottom-visible');
    } else {
      ind.classList.remove('tm-jump-bottom-visible');
    }
    /* feed composer height into a CSS var so the indicator can anchor
       above the ultra composer regardless of typing-induced growth. */
    const composer = document.querySelector('[data-tm-ultra-composer]');
    if (composer) {
      const composerHeight = composer.getBoundingClientRect().height;
      if (Number.isFinite(composerHeight) && composerHeight > 0) {
        document.documentElement.style.setProperty('--tm-composer-height', `${Math.round(composerHeight)}px`);
      }
    }
  }

  document.addEventListener('scroll', evaluate, true);
  /* hook into the mutation-driven apply pass so we re-evaluate when new
     messages arrive while we're scrolled at the bottom. */
  jumpBottomEvaluators.push(evaluate);
}

/* shared evaluators invoked from applyDocumentTheme. defined here so the
   ordering matches the bundler concat order (terminal.js is last and
   theme-application.js calls into it via this list). */
const jumpBottomEvaluators = [];
function runJumpBottomEvaluators() {
  for (const fn of jumpBottomEvaluators) {
    try { fn(); } catch {}
  }
}

window.TerminalMessenger = {
  attached: true,
  apply: applyDocumentTheme,
  openPalette,
  closePalette,
  openSearchOverlay,
  closeSearchOverlay,
  openNotificationsOverlay,
  closeNotificationsOverlay,
  toggleTheme,
  setTheme,
  setUltra,
  toggleUltra,
  setThemeDisabled,
  toggleThemeDisabled,
  setOpacityPct,
  setMuted,
  toggleMuted,
  setDensity,
  setFontSizePx,
  bumpFontSizePx,
  setSentColor,
  toggleSentColor,
  scrollLogToBottom,
  scrollLogToTop,
  setChatListFilter,
  pinCursoredChat,
  markCursoredChatUnread,
  muteCursoredChat,
  moveChatListCursor,
  openChatListCursorTarget,
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
