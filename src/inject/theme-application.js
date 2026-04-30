function applyDocumentTheme() {
  const documentRoot = document.documentElement;
  if (!documentRoot) return;

  documentRoot.classList.add('tm-terminal-theme', 'tm-ready');
  for (const theme of VALID_THEMES) documentRoot.classList.remove(`tm-theme-${theme}`);
  documentRoot.classList.add(`tm-theme-${settings.theme}`);

  const body = document.body;
  if (!body) return;

  body.classList.add('tm-terminal-theme');
  body.classList.toggle('tm-ultra', settings.ultra);
  /* statusline is appended to <html>, so the platform class has to live there
     too - the previous body-only flag never matched #tm-statusline */
  if (/Mac|iPhone|iPad/i.test(navigator.platform ?? '')) {
    body.classList.add('tm-platform-darwin');
    documentRoot.classList.add('tm-platform-darwin');
  }

  ensureStatuslineElement();
  tagActiveThread();
  tagChatHeader();
  tagChatList();
  tagSearchResultsDropdown();
  tagThreadIntroCard();
  tagMessageDirections();
  tagSmallLogImages();
  tagReplyQuotes();
  tagLinkPreviews();
  tagTypingIndicators();
  tagActionButtons();
  tagActionToolbarWrappers();
  tagUltraLayoutTargets();
  unblockPasteOnInputs();
  updateStatuslineContent();
}

let applyScheduled = false;
function scheduleApply() {
  if (applyScheduled) return;
  applyScheduled = true;
  requestAnimationFrame(() => {
    applyScheduled = false;
    applyDocumentTheme();
  });
}

function setTheme(candidateTheme) {
  settings.theme = normaliseTheme(candidateTheme);
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`theme=${settings.theme}`);
}

function toggleTheme() {
  const currentIndex = VALID_THEMES.indexOf(settings.theme);
  setTheme(VALID_THEMES[(currentIndex + 1) % VALID_THEMES.length]);
}

function setUltra(enabled) {
  settings.ultra = Boolean(enabled);
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`ultra=${settings.ultra}`);
}

function toggleUltra() {
  setUltra(!settings.ultra);
}

function setOpacityPct(rawPct) {
  const clampedPct = clampOpacityPct(rawPct);
  settings.opacityPct = clampedPct;
  persistSettings(settings);
  applyWindowOpacity(clampedPct);
  showToast(`opacity=${clampedPct}%`);
  return clampedPct;
}

function applyWindowOpacity(pct) {
  const bridge = window.terminalMessengerBridge;
  if (!bridge?.setWindowOpacityPct) return;
  bridge.setWindowOpacityPct(pct).catch((error) => {
    console.error('Could not set window opacity:', error);
  });
}

function setMuted(muted) {
  const desired = Boolean(muted);
  settings.muted = desired;
  persistSettings(settings);
  applyWindowMuted(desired);
  showToast(`mute=${desired}`);
}

function toggleMuted() {
  setMuted(!settings.muted);
}

function applyWindowMuted(muted) {
  const bridge = window.terminalMessengerBridge;
  if (!bridge?.setWindowMuted) return;
  bridge.setWindowMuted(muted).catch((error) => {
    console.error('Could not set window mute:', error);
  });
}
