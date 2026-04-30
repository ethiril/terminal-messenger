(() => {
  if (window.TerminalMessenger?.attached) {
    window.TerminalMessenger.apply();
    return;
  }

  const STORAGE_KEYS = Object.freeze({
    theme: 'terminalMessenger.theme',
    compact: 'terminalMessenger.compact',
    ultra: 'terminalMessenger.ultra'
  });

  const VALID_THEMES = ['green', 'amber', 'cyan', 'mono'];
  const TOAST_VISIBLE_MS = 1600;
  const CLOCK_INTERVAL_MS = 1000;
  const THREAD_NAME_MAX_LENGTH = 48;
  const OUTGOING_BUBBLE_OFFSET_PX = 16;

  const userConfig = window.__TERMINAL_MESSENGER_CONFIG__ ?? {};

  const settings = {
    theme: readSavedTheme() ?? normaliseTheme(userConfig.theme),
    compact: readSavedCompact() ?? Boolean(userConfig.compactByDefault),
    ultra: readSavedBoolean(STORAGE_KEYS.ultra) ?? false
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
    return readSavedBoolean(STORAGE_KEYS.compact);
  }

  function readSavedBoolean(storageKey) {
    try {
      const savedValue = localStorage.getItem(storageKey);
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
      localStorage.setItem(STORAGE_KEYS.ultra, String(settings.ultra));
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

  function tagMessageDirections() {
    const messageRows = document.querySelectorAll('[role="log"] [role="row"]:not([data-tm-direction])');
    for (const messageRow of messageRows) {
      const direction = inferMessageDirection(messageRow);
      if (direction) messageRow.setAttribute('data-tm-direction', direction);
    }
  }

  function inferMessageDirection(messageRow) {
    const ariaLabel = messageRow.getAttribute('aria-label') ?? '';
    if (/you sent|you said|outgoing/i.test(ariaLabel)) return 'out';

    const rowRect = messageRow.getBoundingClientRect();
    if (rowRect.width === 0) return null;

    const bubbleElement = messageRow.querySelector(':scope > div, :scope > [role="gridcell"]');
    if (!bubbleElement) return null;

    const bubbleRect = bubbleElement.getBoundingClientRect();
    if (bubbleRect.width === 0) return null;

    const rowCenter = rowRect.left + rowRect.width / 2;
    const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
    return bubbleCenter > rowCenter + OUTGOING_BUBBLE_OFFSET_PX ? 'out' : 'in';
  }

  function tagSmallLogImages() {
    const AVATAR_THRESHOLD_PX = 40;
    const candidateImages = document.querySelectorAll('[role="log"] img:not([data-tm-img-size])');
    for (const imageElement of candidateImages) {
      const rect = imageElement.getBoundingClientRect();
      if (rect.width === 0) continue;
      const isLikelyAvatar = rect.width <= AVATAR_THRESHOLD_PX && rect.height <= AVATAR_THRESHOLD_PX;
      imageElement.setAttribute('data-tm-img-size', isLikelyAvatar ? 'small' : 'large');
    }
  }

  function tagUltraLayoutTargets() {
    const messageLog = document.querySelector('[role="log"]');
    if (messageLog && !messageLog.hasAttribute('data-tm-ultra-log')) {
      messageLog.setAttribute('data-tm-ultra-log', 'true');
    }

    const composerInput = findFirstMatchingElement([
      '[contenteditable="true"][role="textbox"]',
      '[aria-label*="Message"][contenteditable="true"]',
      '[aria-label*="Aa"][contenteditable="true"]'
    ]);
    if (!composerInput) return;

    const COMPOSER_LOOKUP_DEPTH = 8;
    let composerContainer = composerInput.parentElement;
    for (let depth = 0; depth < COMPOSER_LOOKUP_DEPTH && composerContainer; depth += 1) {
      if (composerContainer === document.body) break;
      if (composerContainer.querySelector('[aria-label*="Send"]')) break;
      composerContainer = composerContainer.parentElement;
    }

    if (composerContainer && !composerContainer.hasAttribute('data-tm-ultra-composer')) {
      composerContainer.setAttribute('data-tm-ultra-composer', 'true');
    }
  }

  function gotoChatByName(searchTerm) {
    if (!searchTerm) {
      showToast('usage: :goto <name>');
      return false;
    }
    const lowercaseSearch = searchTerm.toLowerCase();
    const candidateRows = document.querySelectorAll('[role="row"], [role="listitem"], a[role="link"]');
    for (const row of candidateRows) {
      const label = row.getAttribute('aria-label') ?? row.textContent ?? '';
      if (label.toLowerCase().includes(lowercaseSearch)) {
        row.click();
        showToast(`opened: ${label.slice(0, 30)}`);
        return true;
      }
    }
    showToast(`no chat matching "${searchTerm}"`);
    return false;
  }

  const SEARCH_RESULT_LIMIT = 12;
  const SEARCH_LABEL_TRIM = 80;

  function findSearchableRows() {
    return document.querySelectorAll('[role="row"], [role="listitem"], a[role="link"]');
  }

  function ensureSearchOverlay() {
    const existing = document.getElementById('tm-search-root');
    if (existing) return existing;

    const searchRoot = document.createElement('div');
    searchRoot.id = 'tm-search-root';
    searchRoot.innerHTML = `
      <div class="tm-search-backdrop" data-tm-close></div>
      <section class="tm-search-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger search">
        <div class="tm-search-title">~/messenger search %</div>
        <input class="tm-search-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="type a name…" />
        <ul class="tm-search-results" role="listbox"></ul>
      </section>
    `;
    document.documentElement.appendChild(searchRoot);

    const inputElement = searchRoot.querySelector('.tm-search-input');
    const resultsElement = searchRoot.querySelector('.tm-search-results');

    searchRoot.addEventListener('click', (event) => {
      if (event.target?.hasAttribute?.('data-tm-close')) closeSearchOverlay();
    });

    inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeSearchOverlay();
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        const firstResult = resultsElement.querySelector('[data-tm-result-index]');
        firstResult?.click();
        event.preventDefault();
      }
    });

    inputElement.addEventListener('input', () => refreshSearchResults(inputElement.value));

    return searchRoot;
  }

  function refreshSearchResults(queryText) {
    const searchRoot = document.getElementById('tm-search-root');
    if (!searchRoot) return;

    const resultsElement = searchRoot.querySelector('.tm-search-results');
    resultsElement.replaceChildren();

    const trimmedQuery = queryText.trim();
    if (!trimmedQuery) {
      const hintItem = document.createElement('li');
      hintItem.className = 'tm-search-hint';
      hintItem.textContent = 'type to search chats…';
      resultsElement.appendChild(hintItem);
      return;
    }

    const lowercaseQuery = trimmedQuery.toLowerCase();
    const matchedResults = [];

    for (const candidate of findSearchableRows()) {
      const label = (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim();
      if (!label) continue;
      if (!label.toLowerCase().includes(lowercaseQuery)) continue;

      matchedResults.push({ label, target: candidate });
      if (matchedResults.length >= SEARCH_RESULT_LIMIT) break;
    }

    if (matchedResults.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'tm-search-hint';
      emptyItem.textContent = 'no matches';
      resultsElement.appendChild(emptyItem);
      return;
    }

    matchedResults.forEach((result, index) => {
      const resultItem = document.createElement('li');
      resultItem.className = 'tm-search-result';
      resultItem.setAttribute('data-tm-result-index', String(index));
      resultItem.textContent = result.label.slice(0, SEARCH_LABEL_TRIM);
      resultItem.addEventListener('click', () => {
        result.target.click();
        showToast(`opened: ${result.label.slice(0, 30)}`);
        closeSearchOverlay();
      });
      resultsElement.appendChild(resultItem);
    });
  }

  function openSearchOverlay(seedValue = '') {
    const searchRoot = ensureSearchOverlay();
    searchRoot.classList.add('tm-search-open');
    const inputElement = searchRoot.querySelector('.tm-search-input');
    if (inputElement) {
      inputElement.value = seedValue;
      refreshSearchResults(seedValue);
      requestAnimationFrame(() => inputElement.focus());
    }
  }

  function closeSearchOverlay() {
    const searchRoot = document.getElementById('tm-search-root');
    searchRoot?.classList.remove('tm-search-open');
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
      body.classList.toggle('tm-ultra', settings.ultra);

      ensureStatuslineElement();
      updateStatuslineContent();
      tagActiveThread();
      tagMessageDirections();
      tagSmallLogImages();
      tagUltraLayoutTargets();
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

  function setUltra(enabled) {
    settings.ultra = Boolean(enabled);
    persistSettings();
    apply();
    showToast(`ultra=${settings.ultra}`);
  }

  function toggleUltra() {
    setUltra(!settings.ultra);
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

  function getSearchInputElement() {
    return findFirstMatchingElement([
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      '[contenteditable="true"][aria-label*="Search"]'
    ]);
  }

  function focusSearchInput() {
    const searchInput = getSearchInputElement();
    if (!searchInput) {
      showToast('search input not found');
      return false;
    }
    searchInput.focus();
    showToast('focused=search');
    return true;
  }

  function searchMessenger(queryText) {
    if (settings.ultra) setUltra(false);

    const searchInput = getSearchInputElement();
    if (!searchInput) {
      showToast('search input not found');
      return false;
    }

    searchInput.focus();
    if ('value' in searchInput) {
      searchInput.value = queryText;
    } else {
      searchInput.textContent = queryText;
    }
    searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    showToast(`search: ${queryText || '(empty)'}`);
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
    ':s [query]        open the search overlay (live results)',
    ':focus message    focus the message composer',
    ':focus search     focus messenger search',
    ':search <query>   focus search and seed the query',
    ':goto <name>      open the first chat matching <name> (alias: :c)',
    ':theme green|amber|cyan|mono',
    ':compact [on|off] tighten / restore spacing (no arg = toggle)',
    ':ultra  [on|off]  ultra terminal mode (no arg = toggle)',
    ':unread           open first unread-looking thread',
    ':reload           reload the page',
    ':q | :clear       close this palette',
    '',
    'shortcuts: ⌘⇧P palette · ⌘⇧S search · ⌘⇧T theme · ⌘⇧U ultra · / opens palette'
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
      if (!flag) {
        setCompact(!settings.compact);
        return `compact=${settings.compact}`;
      }
      if (['on', 'true', '1'].includes(flag)) {
        setCompact(true);
        return 'compact=true';
      }
      if (['off', 'false', '0'].includes(flag)) {
        setCompact(false);
        return 'compact=false';
      }
      return 'usage: :compact [on|off]';
    }

    if (commandName === 'ultra') {
      const flag = commandArgs[0];
      if (!flag) {
        toggleUltra();
        return `ultra=${settings.ultra}`;
      }
      if (['on', 'true', '1'].includes(flag)) {
        setUltra(true);
        return 'ultra=true';
      }
      if (['off', 'false', '0'].includes(flag)) {
        setUltra(false);
        return 'ultra=false';
      }
      return 'usage: :ultra [on|off]';
    }

    if (commandName === 'search') {
      const queryText = commandArgs.join(' ');
      const succeeded = searchMessenger(queryText);
      return succeeded ? `search: ${queryText || '(empty)'}` : 'search input not found';
    }

    if (commandName === 'goto' || commandName === 'c') {
      const targetName = commandArgs.join(' ');
      return gotoChatByName(targetName) ? `opened: ${targetName}` : `no chat matching "${targetName}"`;
    }

    if (commandName === 's') {
      closePalette();
      openSearchOverlay(commandArgs.join(' '));
      return '';
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
      if (isPrimaryModifier && event.shiftKey && pressedKey === 'u') {
        toggleUltra();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isPrimaryModifier && event.shiftKey && pressedKey === 's') {
        openSearchOverlay();
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
    openSearchOverlay,
    closeSearchOverlay,
    toggleTheme,
    setTheme,
    setCompact,
    setUltra,
    toggleUltra,
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
})();
