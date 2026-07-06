function applyDocumentTheme() {
  const documentRoot = document.documentElement;
  if (!documentRoot) return;

  /* the preload's anti-flash style has done its job by the time we're
     applying real classes. drop it: its unconditional `body { visibility:
     hidden }` rule (revealed only by html.tm-ready) would otherwise blank
     the entire page when vanilla mode strips .tm-ready below. */
  document.getElementById('tm-early-style')?.remove();

  /* vanilla-mode escape hatch: when settings.themeDisabled is true, strip
     every terminal-mode class from <html>/<body> and bail before any of
     the JS-based tagging runs. all of the CSS selectors are scoped under
     .tm-terminal-theme, so removing the body class is enough to fully
     restore fb's native messenger UI.

     keep the statusline element around but collapse it to a 6px
     transparent strip - the macOS window uses titleBarStyle:'hiddenInset'
     so without an in-page drag region the user can't move the window at
     all in vanilla mode. the strip remains -webkit-app-region:drag via
     the existing #tm-statusline rule + the [data-tm-vanilla] override
     blanks its visual content and clears its content. */
  if (settings.themeDisabled) {
    documentRoot.classList.remove('tm-terminal-theme', 'tm-ready');
    for (const theme of VALID_THEMES) documentRoot.classList.remove(`tm-theme-${theme}`);

    const body = document.body;
    if (body) {
      body.classList.remove('tm-terminal-theme', 'tm-ultra');
    }

    /* keep the platform-darwin marker on <html> so the vanilla-mode drag
       strip can be sized differently on macOS (taller, to cover the
       traffic-light row) than on win/linux. */
    if (/Mac|iPhone|iPad/i.test(navigator.platform ?? '')) {
      documentRoot.classList.add('tm-platform-darwin');
    } else {
      documentRoot.classList.remove('tm-platform-darwin');
      if (body) body.classList.remove('tm-platform-darwin');
    }

    const statusline = ensureStatuslineElement();
    statusline.setAttribute('data-tm-vanilla', 'true');
    statusline.innerHTML = '';
    return;
  }

  /* re-establish full statusline content when leaving vanilla mode */
  const existingStatusline = document.getElementById('tm-statusline');
  if (existingStatusline?.hasAttribute('data-tm-vanilla')) {
    existingStatusline.removeAttribute('data-tm-vanilla');
    existingStatusline.remove();
  }

  documentRoot.classList.add('tm-terminal-theme', 'tm-ready');
  for (const theme of VALID_THEMES) documentRoot.classList.remove(`tm-theme-${theme}`);
  documentRoot.classList.add(`tm-theme-${settings.theme}`);

  documentRoot.style.setProperty('--tm-font-size', `${settings.fontSizePx}px`);
  documentRoot.setAttribute('data-tm-density', settings.density);
  documentRoot.setAttribute('data-tm-filter', settings.chatListFilter);

  const body = document.body;
  if (!body) return;

  body.classList.add('tm-terminal-theme');
  body.classList.toggle('tm-ultra', settings.ultra);
  body.classList.toggle('tm-sent-color', settings.sentColor);
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
  tagImageCollapseToggles();
  tagLinkPreviews();
  tagTypingIndicators();
  tagActionButtons();
  tagActionToolbarWrappers();
  tagUltraLayoutTargets();
  tagComposerHost();
  tagComposerPlaceholder();
  tagComposerReplyPreview();
  tagDaySeparators();
  tagMessageTimestamps();
  tagLinkPreviewHosts();
  tagChatListUnread();
  ensureLogVideoControls();
  unblockPasteOnInputs();
  updateStatuslineContent();
  /* piggy-back on the apply pass to re-evaluate the jump-to-bottom
     indicator and ultra composer height. avoids a forever-running poll. */
  if (typeof runJumpBottomEvaluators === 'function') runJumpBottomEvaluators();
}

/* throttle re-application: fb mutates the DOM tens of times per second
   when a thread is scrolling or a message is in flight. an unguarded
   rAF schedule means applyDocumentTheme runs once per frame (~60Hz),
   which is fine for visible work but burns the CPU on every chat-list
   shuffle. cap to ~10x/s by enforcing a minimum interval between runs;
   still rAF-aligned for paint timing. */
let applyScheduled = false;
let lastApplyAt = 0;
const MIN_APPLY_INTERVAL_MS = 100;

function scheduleApply() {
  if (applyScheduled) return;
  applyScheduled = true;
  const now = performance.now();
  const elapsed = now - lastApplyAt;
  const wait = elapsed >= MIN_APPLY_INTERVAL_MS ? 0 : (MIN_APPLY_INTERVAL_MS - elapsed);
  setTimeout(() => {
    requestAnimationFrame(() => {
      applyScheduled = false;
      lastApplyAt = performance.now();
      applyDocumentTheme();
    });
  }, wait);
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

function setThemeDisabled(disabled) {
  settings.themeDisabled = Boolean(disabled);
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`mode=${settings.themeDisabled ? 'vanilla' : 'terminal'}`);
}

function toggleThemeDisabled() {
  setThemeDisabled(!settings.themeDisabled);
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

function setDensity(candidate) {
  settings.density = normaliseDensity(candidate);
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`density=${settings.density}`);
  return settings.density;
}

function setFontSizePx(rawPx) {
  const clamped = clampFontPx(rawPx);
  settings.fontSizePx = clamped;
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`fontsize=${clamped}`);
  return clamped;
}

function bumpFontSizePx(delta) {
  return setFontSizePx((settings.fontSizePx ?? DEFAULT_FONT_PX) + delta);
}

function setSentColor(enabled) {
  settings.sentColor = Boolean(enabled);
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`sent-color=${settings.sentColor}`);
  return settings.sentColor;
}

function toggleSentColor() {
  return setSentColor(!settings.sentColor);
}

function setChatListFilter(candidate) {
  const normalised = normaliseChatFilter(candidate);
  settings.chatListFilter = normalised;
  persistSettings(settings);
  applyDocumentTheme();
  showToast(`filter=${normalised}`);
  return normalised;
}

function scrollLogToBottom() {
  const log = document.querySelector('[role="log"], [data-tm-thread]');
  if (!log) {
    showToast('no log to scroll');
    return false;
  }
  log.scrollTop = log.scrollHeight;
  showToast('scrolled=bottom');
  return true;
}
