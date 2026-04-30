(() => {
  if (window.TerminalMessenger?.attached) {
    window.TerminalMessenger.apply();
    return;
  }

  const STORAGE_KEYS = Object.freeze({
    theme: 'terminalMessenger.theme',
    compact: 'terminalMessenger.compact'
  });

  const VALID_THEMES = ['green', 'amber', 'cyan', 'mono'];
  const TOAST_VISIBLE_MS = 1600;
  const CLOCK_INTERVAL_MS = 1000;
  const THREAD_NAME_MAX_LENGTH = 48;

  const userConfig = window.__TERMINAL_MESSENGER_CONFIG__ ?? {};

  const settings = {
    theme: readSavedTheme() ?? normaliseTheme(userConfig.theme),
    compact: readSavedCompact() ?? Boolean(userConfig.compactByDefault)
  };

  const pasteUnblockedElements = new WeakSet();
  let applyScheduled = false;
  let toastTimer = null;
  let clockTimer = null;
  let keyboardShortcutsBound = false;
  let mutationObserverStarted = false;

  function normaliseTheme(candidateTheme) {
    return VALID_THEMES.includes(candidateTheme) ? candidateTheme : 'green';
  }

  function readSavedTheme() {
    try {
      const savedValue = localStorage.getItem(STORAGE_KEYS.theme);
      return VALID_THEMES.includes(savedValue) ? savedValue : null;
    } catch {
      return null;
    }
  }

  function readSavedCompact() {
    try {
      const savedValue = localStorage.getItem(STORAGE_KEYS.compact);
      if (savedValue === 'true') return true;
      if (savedValue === 'false') return false;
      return null;
    } catch {
      return null;
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, settings.theme);
      localStorage.setItem(STORAGE_KEYS.compact, String(settings.compact));
    } catch {
      // storage may be unavailable (private mode, quota); ignore.
    }
  }

  function getActiveThreadName() {
    const threadHeadingSelectors = [
      '[role="main"] h1',
      '[role="main"] h2',
      '[aria-label*="Conversation with"]',
      '[aria-label*="Messages in conversation with"]'
    ];

    for (const selector of threadHeadingSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const rawLabel = element.getAttribute('aria-label') ?? element.textContent ?? '';
      const cleanedLabel = rawLabel
        .replace(/^Messages in conversation with\s+/i, '')
        .replace(/^Conversation with\s+/i, '')
        .trim();

      if (cleanedLabel) return cleanedLabel.slice(0, THREAD_NAME_MAX_LENGTH);
    }

    return null;
  }

  function ensureStatuslineElement() {
    const existing = document.getElementById('tm-statusline');
    if (existing) return existing;

    const statusline = document.createElement('div');
    statusline.id = 'tm-statusline';
    statusline.innerHTML = `
      <span class="tm-prompt-arrow">❯</span>
      <span class="tm-prompt-path">~/messenger</span>
      <span class="tm-prompt-hint">/help · ⌘⇧P · ⌘⇧T</span>
      <span class="tm-prompt-clock"></span>
    `;
    document.documentElement.appendChild(statusline);
    return statusline;
  }

  function updateStatuslineContent() {
    const statusline = ensureStatuslineElement();
    const pathElement = statusline.querySelector('.tm-prompt-path');
    const clockElement = statusline.querySelector('.tm-prompt-clock');

    if (pathElement) {
      const threadName = getActiveThreadName();
      pathElement.textContent = threadName ? `~/messenger/${threadName}` : '~/messenger';
    }

    if (clockElement) {
      clockElement.textContent = new Date().toTimeString().slice(0, 8);
    }
  }

  function startStatuslineClock() {
    if (clockTimer) return;
    clockTimer = setInterval(updateStatuslineContent, CLOCK_INTERVAL_MS);
  }

  function tagActiveThread() {
    const thread = document.querySelector('[role="log"], [aria-label*="Messages in conversation"]');
    if (!thread || thread.hasAttribute('data-tm-thread')) return;

    document.querySelectorAll('[data-tm-thread]').forEach((node) => node.removeAttribute('data-tm-thread'));
    thread.setAttribute('data-tm-thread', 'true');
  }

  function unblockPasteOnInputs() {
    document.querySelectorAll('input, textarea').forEach((element) => {
      if (pasteUnblockedElements.has(element)) return;
      pasteUnblockedElements.add(element);

      element.onpaste = null;
      element.oncopy = null;
      element.oncut = null;
      element.removeAttribute('onpaste');
      element.removeAttribute('oncopy');
      element.removeAttribute('oncut');
      element.addEventListener('paste', (event) => event.stopImmediatePropagation(), true);
    });
  }

  function apply() {
    const documentRoot = document.documentElement;
    const body = document.body;
    if (!documentRoot) return;

    documentRoot.classList.add('tm-terminal-theme', 'tm-ready');
    for (const theme of VALID_THEMES) documentRoot.classList.remove(`tm-theme-${theme}`);
    documentRoot.classList.add(`tm-theme-${settings.theme}`);

    if (body) {
      body.classList.add('tm-terminal-theme');
      body.classList.toggle('tm-compact', settings.compact);

      ensureStatuslineElement();
      updateStatuslineContent();
      tagActiveThread();
      unblockPasteOnInputs();
    }
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    requestAnimationFrame(() => {
      applyScheduled = false;
      apply();
    });
  }

  function setTheme(candidateTheme) {
    settings.theme = normaliseTheme(candidateTheme);
    persistSettings();
    apply();
    showToast(`theme=${settings.theme}`);
  }

  function toggleTheme() {
    const currentIndex = VALID_THEMES.indexOf(settings.theme);
    setTheme(VALID_THEMES[(currentIndex + 1) % VALID_THEMES.length]);
  }

  function setCompact(enabled) {
    settings.compact = Boolean(enabled);
    persistSettings();
    apply();
    showToast(`compact=${settings.compact}`);
  }

  function findFirstMatchingElement(selectorList) {
    return document.querySelector(selectorList.join(','));
  }

  function focusConversationInput() {
    const messageInput = findFirstMatchingElement([
      '[contenteditable="true"][role="textbox"]',
      '[aria-label*="Message"][contenteditable="true"]',
      '[aria-label*="Aa"][contenteditable="true"]'
    ]);

    if (!messageInput) {
      showToast('message input not found');
      return false;
    }

    messageInput.focus();
    showToast('focused=message');
    return true;
  }

  function focusSearchInput() {
    const searchInput = findFirstMatchingElement([
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      '[contenteditable="true"][aria-label*="Search"]'
    ]);

    if (!searchInput) {
      showToast('search input not found');
      return false;
    }

    searchInput.focus();
    showToast('focused=search');
    return true;
  }

  function openFirstUnreadThread() {
    const candidates = document.querySelectorAll('[aria-label], [role="row"], a[role="link"]');
    for (const element of candidates) {
      const label = element.getAttribute('aria-label') ?? element.textContent ?? '';
      if (/unread/i.test(label)) {
        element.click();
        showToast('opened≈unread');
        return true;
      }
    }
    showToast('no unread item detected');
    return false;
  }

  function ensurePaletteElement() {
    const existing = document.getElementById('tm-command-root');
    if (existing) return existing;

    const paletteRoot = document.createElement('div');
    paletteRoot.id = 'tm-command-root';
    paletteRoot.innerHTML = `
      <div class="tm-command-backdrop" data-tm-close></div>
      <section class="tm-command-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger command palette">
        <div class="tm-command-title">~/messenger %</div>
        <input class="tm-command-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder=":help" />
        <div class="tm-command-hint">help · theme [green|amber|cyan|mono] · compact [on|off] · focus [message|search] · unread · reload · q</div>
        <pre class="tm-command-output"></pre>
      </section>
    `;
    document.documentElement.appendChild(paletteRoot);

    const inputElement = paletteRoot.querySelector('.tm-command-input');
    const outputElement = paletteRoot.querySelector('.tm-command-output');

    paletteRoot.addEventListener('click', (event) => {
      if (event.target?.hasAttribute?.('data-tm-close')) closePalette();
    });

    inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePalette();
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        outputElement.textContent = runCommand(inputElement.value.trim());
        inputElement.select();
        event.preventDefault();
      }
    });

    return paletteRoot;
  }

  function openPalette(seedValue = '') {
    const paletteRoot = ensurePaletteElement();
    const inputElement = paletteRoot.querySelector('.tm-command-input');

    paletteRoot.classList.add('tm-command-open');
    if (inputElement) {
      inputElement.value = seedValue;
      requestAnimationFrame(() => inputElement.focus());
    }
  }

  function closePalette() {
    const paletteRoot = document.getElementById('tm-command-root');
    paletteRoot?.classList.remove('tm-command-open');
    focusConversationInput();
  }

  const HELP_OUTPUT = [
    'commands',
    '',
    ':focus message    focus the message composer',
    ':focus search     focus messenger search',
    ':theme green|amber|cyan|mono',
    ':compact on|off   tighten / restore spacing',
    ':unread           open first unread-looking thread',
    ':reload           reload the page',
    ':q | :clear       close this palette',
    '',
    'shortcuts: ⌘⇧P palette · ⌘⇧T cycle theme · / opens palette'
  ].join('\n');

  function runCommand(rawInput) {
    const trimmedCommand = rawInput.replace(/^:/, '').trim();
    if (!trimmedCommand || trimmedCommand === 'help') return HELP_OUTPUT;

    const [commandName, ...commandArgs] = trimmedCommand.split(/\s+/);

    if (commandName === 'theme') {
      if (!commandArgs[0]) return 'usage: :theme green|amber|cyan|mono';
      setTheme(commandArgs[0]);
      return `theme=${settings.theme}`;
    }

    if (commandName === 'compact') {
      const flag = commandArgs[0];
      if (['on', 'true', '1'].includes(flag)) {
        setCompact(true);
        return 'compact=true';
      }
      if (['off', 'false', '0'].includes(flag)) {
        setCompact(false);
        return 'compact=false';
      }
      return 'usage: :compact on|off';
    }

    if (commandName === 'focus') {
      if (commandArgs[0] === 'message') return focusConversationInput() ? 'focused=message' : 'message input not found';
      if (commandArgs[0] === 'search') return focusSearchInput() ? 'focused=search' : 'search input not found';
      return 'usage: :focus message|search';
    }

    if (commandName === 'unread') {
      return openFirstUnreadThread() ? 'opened≈unread' : 'no unread item detected';
    }

    if (commandName === 'reload') {
      window.location.reload();
      return 'reloading...';
    }

    if (commandName === 'q' || commandName === 'exit' || commandName === 'clear') {
      closePalette();
      return '';
    }

    return `unknown command: ${commandName}`;
  }

  function showToast(message) {
    let toastElement = document.getElementById('tm-toast');
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'tm-toast';
      document.documentElement.appendChild(toastElement);
    }

    toastElement.textContent = `$ ${message}`;
    toastElement.classList.add('tm-toast-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('tm-toast-visible'), TOAST_VISIBLE_MS);
  }

  function isUserTypingInto(eventTarget) {
    if (!eventTarget) return false;
    return eventTarget.tagName === 'INPUT'
      || eventTarget.tagName === 'TEXTAREA'
      || eventTarget.isContentEditable === true;
  }

  function bindKeyboardShortcuts() {
    if (keyboardShortcutsBound) return;
    keyboardShortcutsBound = true;

    document.addEventListener('keydown', (event) => {
      const isPrimaryModifier = event.ctrlKey || event.metaKey;
      const pressedKey = event.key?.toLowerCase();
      if (!pressedKey) return;

      if (isPrimaryModifier && event.shiftKey && pressedKey === 'p') {
        openPalette();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isPrimaryModifier && event.shiftKey && pressedKey === 't') {
        toggleTheme();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === '/' && !isUserTypingInto(event.target)) {
        openPalette(':');
        event.preventDefault();
      }
    }, true);
  }

  function startMutationObserver() {
    if (mutationObserverStarted || !document.body) return;
    mutationObserverStarted = true;
    new MutationObserver(scheduleApply).observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    apply();
    bindKeyboardShortcuts();
    startMutationObserver();
    startStatuslineClock();
  }

  window.TerminalMessenger = {
    attached: true,
    apply,
    openPalette,
    closePalette,
    toggleTheme,
    setTheme,
    setCompact,
    focusConversationInput,
    focusSearch: focusSearchInput
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
