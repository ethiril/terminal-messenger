const TOAST_ELEMENT_ID = 'tm-toast';
const TOAST_VISIBLE_MS = 1600;
const NOTIFICATION_LOG_MAX = 100;
const NOTIFICATION_OVERLAY_ID = 'tm-notifications-root';

const notificationLog = [];

let toastHideTimer = null;

function showToast(message) {
  let toastElement = document.getElementById(TOAST_ELEMENT_ID);
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.id = TOAST_ELEMENT_ID;
    /* polite live region so screen readers announce action feedback
       (theme change, opacity, mute) without interrupting a typing flow. */
    toastElement.setAttribute('role', 'status');
    toastElement.setAttribute('aria-live', 'polite');
    toastElement.setAttribute('aria-atomic', 'true');
    document.documentElement.appendChild(toastElement);
  }

  toastElement.textContent = `$ ${message}`;
  /* re-trigger the typewriter animation on every show by toggling the
     class off → reflow → on. without the reflow the browser sees the
     class as already-applied and skips the animation restart. */
  toastElement.classList.remove('tm-toast-visible');
  void toastElement.offsetWidth;
  toastElement.classList.add('tm-toast-visible');

  pushNotificationEntry(message);

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toastElement.classList.remove('tm-toast-visible'), TOAST_VISIBLE_MS);
}

function pushNotificationEntry(message) {
  const entry = { message, timestamp: new Date() };
  notificationLog.push(entry);
  if (notificationLog.length > NOTIFICATION_LOG_MAX) {
    notificationLog.splice(0, notificationLog.length - NOTIFICATION_LOG_MAX);
  }
  refreshNotificationsPanelIfOpen();
}

function ensureNotificationsOverlay() {
  const existing = document.getElementById(NOTIFICATION_OVERLAY_ID);
  if (existing) return existing;

  const root = document.createElement('div');
  root.id = NOTIFICATION_OVERLAY_ID;
  root.innerHTML = `
    <div class="tm-notifications-backdrop" data-tm-close></div>
    <section class="tm-notifications-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger notifications">
      <div class="tm-notifications-title">~/messenger/log %</div>
      <pre class="tm-notifications-output"></pre>
      <div class="tm-notifications-hint">esc · close · :log to reopen</div>
    </section>
  `;
  document.documentElement.appendChild(root);

  root.addEventListener('click', (event) => {
    if (event.target?.hasAttribute?.('data-tm-close')) closeNotificationsOverlay();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!root.classList.contains('tm-notifications-open')) return;
    closeNotificationsOverlay();
    event.preventDefault();
  }, true);

  return root;
}

function renderNotificationLog() {
  if (notificationLog.length === 0) return '(no notifications yet)';
  return notificationLog
    .map((entry) => `${entry.timestamp.toTimeString().slice(0, 8)}  ${entry.message}`)
    .join('\n');
}

function refreshNotificationsPanelIfOpen() {
  const overlay = document.getElementById(NOTIFICATION_OVERLAY_ID);
  if (!overlay || !overlay.classList.contains('tm-notifications-open')) return;
  const output = overlay.querySelector('.tm-notifications-output');
  if (!output) return;
  output.textContent = renderNotificationLog();
  output.scrollTop = output.scrollHeight;
}

function openNotificationsOverlay() {
  const overlay = ensureNotificationsOverlay();
  overlay.classList.add('tm-notifications-open');
  setOverlayOpenFlag(true);
  refreshNotificationsPanelIfOpen();
}

function closeNotificationsOverlay() {
  const overlay = document.getElementById(NOTIFICATION_OVERLAY_ID);
  overlay?.classList.remove('tm-notifications-open');
  setOverlayOpenFlag(false);
}
