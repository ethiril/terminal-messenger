(() => {
  const CONFIG = window.__TERMINAL_MESSENGER_CONFIG__ || {};
  const THEMES = ['green', 'amber', 'cyan', 'mono'];
  const STORAGE_KEYS = {
    theme: 'terminalMessenger.theme',
    compact: 'terminalMessenger.compact'
  };

  if (window.TerminalMessenger?.version === '0.1.0') {
    window.TerminalMessenger.apply?.();
    return;
  }

  const state = {
    theme: localStorage.getItem(STORAGE_KEYS.theme) || CONFIG.theme || 'green',
    compact: localStorage.getItem(STORAGE_KEYS.compact) ?? (CONFIG.compactByDefault ? 'true' : 'false')
  };

  function normaliseTheme(theme) {
    return THEMES.includes(theme) ? theme : 'green';
  }

  function apply() {
    const body = document.body;
    if (!body) return;

    body.classList.add('tm-terminal-theme');
    body.classList.toggle('tm-compact', state.compact === 'true');

    for (const theme of THEMES) body.classList.remove(`tm-theme-${theme}`);
    body.classList.add(`tm-theme-${normaliseTheme(state.theme)}`);
  }

  function setTheme(theme) {
    state.theme = normaliseTheme(theme);
    localStorage.setItem(STORAGE_KEYS.theme, state.theme);
    apply();
    toast(`theme=${state.theme}`);
  }

  function toggleTheme() {
    const current = THEMES.indexOf(normaliseTheme(state.theme));
    setTheme(THEMES[(current + 1) % THEMES.length]);
  }

  function setCompact(enabled) {
    state.compact = enabled ? 'true' : 'false';
    localStorage.setItem(STORAGE_KEYS.compact, state.compact);
    apply();
    toast(`compact=${state.compact}`);
  }

  function getConversationInput() {
    const candidates = [
      '[contenteditable="true"][role="textbox"]',
      '[aria-label*="Message"][contenteditable="true"]',
      '[aria-label*="Aa"][contenteditable="true"]'
    ];
    return document.querySelector(candidates.join(','));
  }

  function getSearchInput() {
    const candidates = [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      '[contenteditable="true"][aria-label*="Search"]'
    ];
    return document.querySelector(candidates.join(','));
  }

  function focusConversationInput() {
    const input = getConversationInput();
    if (input) {
      input.focus();
      toast('focused=message');
    } else {
      toast('message input not found');
    }
  }

  function focusSearch() {
    const input = getSearchInput();
    if (input) {
      input.focus();
      toast('focused=search');
    } else {
      toast('search input not found');
    }
  }

  function clickFirstUnreadLikeItem() {
    const candidates = Array.from(document.querySelectorAll('[aria-label], [role="row"], a[role="link"]'));
    const match = candidates.find((element) => /unread/i.test(element.getAttribute('aria-label') || element.textContent || ''));
    if (match) {
      match.click();
      toast('opened≈unread');
    } else {
      toast('no unread item detected');
    }
  }

  function ensurePalette() {
    let root = document.getElementById('tm-command-root');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'tm-command-root';
    root.innerHTML = `
      <div class="tm-command-backdrop" data-tm-close></div>
      <section class="tm-command-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger command palette">
        <div class="tm-command-title">Terminal Messenger</div>
        <input class="tm-command-input" autocomplete="off" autocorrect="off" spellcheck="false" placeholder=":help" />
        <div class="tm-command-hint">Commands: help · theme green|amber|cyan|mono · compact on|off · focus message|search · unread · reload</div>
        <pre class="tm-command-output"></pre>
      </section>
    `;
    document.documentElement.appendChild(root);

    const input = root.querySelector('.tm-command-input');
    const output = root.querySelector('.tm-command-output');

    root.addEventListener('click', (event) => {
      if (event.target?.hasAttribute?.('data-tm-close')) closePalette();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePalette();
        event.preventDefault();
        return;
      }

      if (event.key === 'Enter') {
        const result = runCommand(input.value.trim());
        output.textContent = result;
        input.select();
        event.preventDefault();
      }
    });

    return root;
  }

  function openPalette(seed = '') {
    const root = ensurePalette();
    const input = root.querySelector('.tm-command-input');
    root.classList.add('tm-command-open');
    input.value = seed;
    requestAnimationFrame(() => input.focus());
  }

  function closePalette() {
    const root = document.getElementById('tm-command-root');
    root?.classList.remove('tm-command-open');
    focusConversationInput();
  }

  function runCommand(raw) {
    const command = raw.replace(/^:/, '').trim();
    if (!command || command === 'help') {
      return [
        'Terminal Messenger commands',
        '',
        ':focus message    focus the message composer',
        ':focus search     focus Messenger search',
        ':theme green      use green terminal accent',
        ':theme amber      use amber terminal accent',
        ':theme cyan       use cyan terminal accent',
        ':theme mono       use grayscale terminal accent',
        ':compact on       hide some page chrome and tighten spacing',
        ':compact off      restore roomier spacing',
        ':unread           try opening the first unread-looking thread',
        ':reload           reload Facebook Messages',
        '',
        'Shortcuts: Ctrl/Cmd+Shift+P opens this palette. Ctrl/Cmd+Shift+T cycles theme.'
      ].join('\n');
    }

    const [name, ...args] = command.split(/\s+/);

    if (name === 'theme') {
      setTheme(args[0]);
      return `theme=${state.theme}`;
    }

    if (name === 'compact') {
      if (['on', 'true', '1'].includes(args[0])) setCompact(true);
      else if (['off', 'false', '0'].includes(args[0])) setCompact(false);
      else return 'usage: :compact on|off';
      return `compact=${state.compact}`;
    }

    if (name === 'focus') {
      if (args[0] === 'message') {
        focusConversationInput();
        return 'focused=message';
      }
      if (args[0] === 'search') {
        focusSearch();
        return 'focused=search';
      }
      return 'usage: :focus message|search';
    }

    if (name === 'unread') {
      clickFirstUnreadLikeItem();
      return 'opened≈unread';
    }

    if (name === 'reload') {
      window.location.reload();
      return 'reloading...';
    }

    return `unknown command: ${name}`;
  }

  let toastTimer = null;
  function toast(message) {
    let element = document.getElementById('tm-toast');
    if (!element) {
      element = document.createElement('div');
      element.id = 'tm-toast';
      document.documentElement.appendChild(element);
    }
    element.textContent = `$ ${message}`;
    element.classList.add('tm-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('tm-toast-visible'), 1800);
  }

  function bindKeyboard() {
    if (window.__terminalMessengerKeysBound) return;
    window.__terminalMessengerKeysBound = true;

    document.addEventListener('keydown', (event) => {
      const ctrlOrCmd = event.ctrlKey || event.metaKey;
      const target = event.target;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

      if (ctrlOrCmd && event.shiftKey && event.key.toLowerCase() === 'p') {
        openPalette();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (ctrlOrCmd && event.shiftKey && event.key.toLowerCase() === 't') {
        toggleTheme();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!isTyping && event.key === '/') {
        openPalette(':');
        event.preventDefault();
      }
    }, true);
  }

  const observer = new MutationObserver(() => apply());
  function start() {
    apply();
    bindKeyboard();
    if (document.body && !window.__terminalMessengerObserverStarted) {
      window.__terminalMessengerObserverStarted = true;
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.TerminalMessenger = {
    version: '0.1.0',
    apply,
    openPalette,
    closePalette,
    toggleTheme,
    setTheme,
    setCompact,
    focusConversationInput,
    focusSearch
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
