const STATUSLINE_ELEMENT_ID = 'tm-statusline';
const STATUSLINE_CLOCK_INTERVAL_MS = 1000;

function ensureStatuslineElement() {
  const existing = document.getElementById(STATUSLINE_ELEMENT_ID);
  if (existing) return existing;

  const statusline = document.createElement('div');
  statusline.id = STATUSLINE_ELEMENT_ID;
  /* statusline duplicates info already exposed in the window title bar
     (active thread, unread count) and via direct manipulation toasts.
     hide it from screen readers so they don't announce every tick. */
  statusline.setAttribute('aria-hidden', 'true');
  statusline.setAttribute('role', 'presentation');
  /* segments are grouped left / right by .tm-prompt-spacer so the
     clock + status pills always anchor to the trailing edge regardless
     of how long the active-thread path becomes. */
  statusline.innerHTML = `
    <span class="tm-prompt-segment tm-prompt-segment-left">
      <span class="tm-prompt-arrow">❯</span>
      <span class="tm-prompt-path">~/messenger</span>
      <span class="tm-prompt-presence"></span>
    </span>
    <span class="tm-prompt-hint">/help · ⌘⇧S search · ⌘⇧P · ⌘⇧T · ⌘⇧U · ⌘⇧M · ⌘⇧Y vanilla</span>
    <span class="tm-prompt-spacer"></span>
    <span class="tm-prompt-segment tm-prompt-segment-right">
      <span class="tm-prompt-net"></span>
      <span class="tm-prompt-unread"></span>
      <span class="tm-prompt-flags"></span>
      <span class="tm-prompt-clock"></span>
    </span>
  `;
  document.documentElement.appendChild(statusline);
  return statusline;
}

function buildFlagSummary() {
  /* surface every non-default toggle so the user can tell at a glance
     why the chat looks the way it does (e.g. "density was off-spec from
     a misclick"). only include flags whose state diverges from the
     default - the bracket strip would otherwise read like noise. */
  const fragments = [];
  if (settings.ultra) fragments.push('ultra');
  if (settings.muted) fragments.push('muted');
  if (settings.opacityPct !== 100) fragments.push(`α${settings.opacityPct}`);
  if (settings.density && settings.density !== 'cozy') fragments.push(settings.density);
  if (settings.chatListFilter && settings.chatListFilter !== 'all') {
    fragments.push(`filter=${settings.chatListFilter}`);
  }
  return fragments.length ? `[${fragments.join(' ')}]` : '';
}

/* unread count lives in document.title as "Messenger (N)" - parse rather
   than count DOM rows because fb's chat list is virtualised and rows
   beyond the viewport never carry the "unread" aria-label. */
function readUnreadCountFromTitle() {
  const match = (document.title ?? '').match(/\((\d+)\)/);
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/* the clock changes every second; the rest (thread name, presence, flags,
   unread, online state) only changes on mutation / settings updates.
   split them so the 1Hz tick costs effectively nothing on idle. */
function updateStatuslineClock() {
  if (settings.themeDisabled) return;
  const statusline = document.getElementById(STATUSLINE_ELEMENT_ID);
  if (!statusline) return;
  const clockElement = statusline.querySelector('.tm-prompt-clock');
  if (clockElement) clockElement.textContent = new Date().toTimeString().slice(0, 8);
}

function updateStatuslineContent() {
  /* vanilla mode keeps the statusline in the DOM as a 6px transparent
     drag strip (so the window stays movable - macOS titleBarStyle is
     'hiddenInset' and there's no other in-page drag handle). don't touch
     it here: applyDocumentTheme owns the vanilla-mode statusline state,
     and the 1Hz clock tick has nothing to update when content is empty. */
  if (settings.themeDisabled) return;

  const statusline = ensureStatuslineElement();
  const pathElement = statusline.querySelector('.tm-prompt-path');
  const presenceElement = statusline.querySelector('.tm-prompt-presence');
  const flagsElement = statusline.querySelector('.tm-prompt-flags');
  const unreadElement = statusline.querySelector('.tm-prompt-unread');
  const netElement = statusline.querySelector('.tm-prompt-net');

  if (netElement) {
    netElement.textContent = navigator.onLine ? '' : '[offline]';
  }

  if (pathElement) {
    const threadName = getActiveThreadName();
    pathElement.textContent = threadName ? `~/messenger/${threadName}` : '~/messenger';
  }

  if (presenceElement) {
    const presence = getActivePresenceStatus();
    presenceElement.textContent = presence ? `· ${presence.toLowerCase()}` : '';
  }

  if (flagsElement) {
    flagsElement.textContent = buildFlagSummary();
  }

  if (unreadElement) {
    const unread = readUnreadCountFromTitle();
    unreadElement.textContent = unread > 0 ? `[${unread} unread]` : '';
  }

  updateStatuslineClock();
}

let statuslineClockTimer = null;
function startStatuslineClock() {
  if (statuslineClockTimer) return;
  statuslineClockTimer = setInterval(updateStatuslineClock, STATUSLINE_CLOCK_INTERVAL_MS);
}

/* track window focus so the prompt arrow blinks while we're in the
   background - mirrors a real shell's behavior where the cursor blinks
   only on the focused window. setAttribute on <html> so CSS can drive
   the animation via :root[data-tm-blurred]. */
let windowFocusListenersBound = false;
function bindWindowFocusIndicator() {
  if (windowFocusListenersBound) return;
  windowFocusListenersBound = true;

  function applyFocusState() {
    if (document.hasFocus()) {
      document.documentElement.removeAttribute('data-tm-blurred');
    } else {
      document.documentElement.setAttribute('data-tm-blurred', 'true');
    }
  }

  window.addEventListener('focus', applyFocusState, true);
  window.addEventListener('blur', applyFocusState, true);
  applyFocusState();
}

/* online/offline state mirrors browser-level network events. fires
   updateStatuslineContent immediately so the [offline] tag appears the
   instant the OS drops the link, rather than on the next 1Hz tick. */
let connectionListenersBound = false;
function bindConnectionStatus() {
  if (connectionListenersBound) return;
  connectionListenersBound = true;
  const refresh = () => updateStatuslineContent();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
}

/* CSS hides .tm-prompt-hint when [data-tm-overlay-open] is set on <html>
   so the keybinding hint vacates space while the user is interacting
   with the palette or search overlay. */
function setOverlayOpenFlag(isOpen) {
  if (isOpen) {
    document.documentElement.setAttribute('data-tm-overlay-open', 'true');
  } else {
    document.documentElement.removeAttribute('data-tm-overlay-open');
  }
}
