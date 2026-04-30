const STATUSLINE_ELEMENT_ID = 'tm-statusline';
const STATUSLINE_CLOCK_INTERVAL_MS = 1000;

function ensureStatuslineElement() {
  const existing = document.getElementById(STATUSLINE_ELEMENT_ID);
  if (existing) return existing;

  const statusline = document.createElement('div');
  statusline.id = STATUSLINE_ELEMENT_ID;
  statusline.innerHTML = `
    <span class="tm-prompt-arrow">❯</span>
    <span class="tm-prompt-path">~/messenger</span>
    <span class="tm-prompt-presence"></span>
    <span class="tm-prompt-hint">/help · ⌘⇧S search · ⌘⇧P · ⌘⇧T · ⌘⇧U · ⌘⇧M</span>
    <span class="tm-prompt-flags"></span>
    <span class="tm-prompt-clock"></span>
  `;
  document.documentElement.appendChild(statusline);
  return statusline;
}

function buildFlagSummary() {
  const fragments = [];
  if (settings.ultra) fragments.push('ultra');
  if (settings.muted) fragments.push('muted');
  if (settings.opacityPct !== 100) fragments.push(`α${settings.opacityPct}`);
  return fragments.length ? `[${fragments.join(' ')}]` : '';
}

function updateStatuslineContent() {
  const statusline = ensureStatuslineElement();
  const pathElement = statusline.querySelector('.tm-prompt-path');
  const presenceElement = statusline.querySelector('.tm-prompt-presence');
  const flagsElement = statusline.querySelector('.tm-prompt-flags');
  const clockElement = statusline.querySelector('.tm-prompt-clock');

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

  if (clockElement) {
    clockElement.textContent = new Date().toTimeString().slice(0, 8);
  }
}

let statuslineClockTimer = null;
function startStatuslineClock() {
  if (statuslineClockTimer) return;
  statuslineClockTimer = setInterval(updateStatuslineContent, STATUSLINE_CLOCK_INTERVAL_MS);
}
