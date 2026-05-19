const PALETTE_OVERLAY_ID = 'tm-command-root';
const PALETTE_HISTORY_LIMIT = 50;
const PALETTE_SUGGESTION_LIMIT = 8;

/* command registry. one entry per command, with all metadata co-located
   so the dispatcher, completion engine, and help renderer all read from
   the same place. `complete` returns candidate strings for the current
   argument slot; omit it for commands that take freeform input or no
   args. `argSpec` is the user-facing usage hint (rendered in :help and
   in the live suggestion list). */
const COMMAND_REGISTRY = [
  { name: 'help',          aliases: [],             argSpec: '',                 help: 'show this command list' },
  { name: 'search',        aliases: ['s'],          argSpec: '[query]',          help: 'open the search overlay (alias :s)' },
  { name: 'focus',         aliases: [],             argSpec: 'message|search',   help: 'focus the message composer or messenger search',
    complete: () => ['message', 'search'] },
  { name: 'goto',          aliases: ['c'],          argSpec: '<name>',           help: 'open the first chat matching <name> (alias :c)',
    complete: () => collectChatListNamesForCompletion() },
  { name: 'theme',         aliases: [],             argSpec: '<name>',           help: 'set the terminal palette',
    complete: () => VALID_THEMES },
  { name: 'ultra',         aliases: [],             argSpec: '[on|off]',         help: 'ultra terminal mode (no arg = toggle)',
    complete: () => ['on', 'off'] },
  { name: 'opacity',       aliases: [],             argSpec: '<20-100>',         help: 'window transparency, percent' },
  { name: 'mute',          aliases: [],             argSpec: '[on|off]',         help: 'mute window audio (no arg = toggle)',
    complete: () => ['on', 'off'] },
  { name: 'density',       aliases: [],             argSpec: 'compact|cozy|comfy', help: 'message log spacing',
    complete: () => VALID_DENSITIES },
  { name: 'fontsize',      aliases: ['fs'],         argSpec: '<n>|+|-',          help: 'set chat font size in px (or step ±1)',
    complete: () => ['10', '11', '12', '13', '14', '+', '-'] },
  { name: 'sent-color',    aliases: ['sentcolor'],  argSpec: '[on|off]',         help: 'color outgoing messages with the theme accent',
    complete: () => ['on', 'off'] },
  { name: 'bottom',        aliases: ['end'],        argSpec: '',                 help: 'scroll the open chat to the latest message' },
  { name: 'top',           aliases: ['home'],       argSpec: '',                 help: 'scroll the open chat to the earliest loaded message' },
  { name: 'unread',        aliases: [],             argSpec: '',                 help: 'open the first chat that looks unread' },
  { name: 'filter',        aliases: [],             argSpec: 'all|unread',       help: 'filter the chat list',
    complete: () => VALID_CHAT_FILTERS },
  { name: 'pin',           aliases: [],             argSpec: '',                 help: 'pin/unpin the cursored chat (j/k to move cursor)' },
  { name: 'mark-unread',   aliases: ['mu'],         argSpec: '',                 help: 'mark the cursored chat as unread' },
  { name: 'mute-chat',     aliases: ['mc'],         argSpec: '',                 help: 'mute/unmute notifications for the cursored chat' },
  { name: 'notifications', aliases: ['log'],        argSpec: '',                 help: 'open the in-session toast log (alias :log)' },
  { name: 'reload',        aliases: [],             argSpec: '',                 help: 'reload the page' },
  { name: 'q',             aliases: ['exit', 'clear'], argSpec: '',              help: 'close this palette (alias :exit :clear)' }
];

const ENABLE_FLAG_VALUES = ['on', 'true', '1'];
const DISABLE_FLAG_VALUES = ['off', 'false', '0'];

/* :goto / :c completion sources its candidates from the rendered chat
   list. fb's chat list is virtualised so only on-screen rows contribute -
   that's fine here, tab-complete is a hint, not an exhaustive index.
   tokens with spaces don't round-trip through the palette's
   space-delimited tokeniser, so collapse whitespace to a single space
   per name; the actual :goto lookup is a substring match. */
function collectChatListNamesForCompletion() {
  const rows = document.querySelectorAll('[data-tm-chat-list] [role="row"][aria-label]');
  const names = new Set();
  for (const row of rows) {
    const label = (row.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    /* fb's aria-label is verbose ("Sara, last message 12:30, unread"); take
       the first comma-separated segment which is reliably the contact name. */
    const primary = label.split(',')[0].trim();
    if (primary) names.add(primary);
  }
  return Array.from(names).slice(0, 30);
}

function parseTriStateFlag(flagValue) {
  if (!flagValue) return 'toggle';
  if (ENABLE_FLAG_VALUES.includes(flagValue)) return 'on';
  if (DISABLE_FLAG_VALUES.includes(flagValue)) return 'off';
  return null;
}

function commandLookup(name) {
  const trimmed = (name ?? '').trim().toLowerCase();
  for (const entry of COMMAND_REGISTRY) {
    if (entry.name === trimmed) return entry;
    if (entry.aliases.includes(trimmed)) return entry;
  }
  return null;
}

/* state lives on the module-level closure so it survives palette
   re-opens within a single session. cleared on page reload. */
const commandHistory = [];
let historyCursor = -1;
let suggestionCursor = 0;

function pushHistoryEntry(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return;
  if (commandHistory[commandHistory.length - 1] === trimmed) return;
  commandHistory.push(trimmed);
  if (commandHistory.length > PALETTE_HISTORY_LIMIT) {
    commandHistory.splice(0, commandHistory.length - PALETTE_HISTORY_LIMIT);
  }
  historyCursor = commandHistory.length;
}

function recallHistory(direction) {
  if (commandHistory.length === 0) return null;
  historyCursor = Math.max(0, Math.min(commandHistory.length, historyCursor + direction));
  if (historyCursor >= commandHistory.length) return '';
  return commandHistory[historyCursor];
}

function ensurePaletteElement() {
  const existing = document.getElementById(PALETTE_OVERLAY_ID);
  if (existing) return existing;

  const paletteRoot = document.createElement('div');
  paletteRoot.id = PALETTE_OVERLAY_ID;
  paletteRoot.innerHTML = `
    <div class="tm-command-backdrop" data-tm-close></div>
    <section class="tm-command-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger command palette">
      <div class="tm-command-title">~/messenger %</div>
      <input class="tm-command-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder=":help" />
      <ul class="tm-command-suggestions" role="listbox" aria-label="command suggestions"></ul>
      <pre class="tm-command-output" hidden></pre>
      <div class="tm-command-footer">
        <span>tab · complete</span>
        <span>↑↓ · history</span>
        <span>↵ · run</span>
        <span>esc · close</span>
      </div>
    </section>
  `;
  document.documentElement.appendChild(paletteRoot);

  const inputElement = paletteRoot.querySelector('.tm-command-input');
  const outputElement = paletteRoot.querySelector('.tm-command-output');
  const suggestionsElement = paletteRoot.querySelector('.tm-command-suggestions');

  paletteRoot.addEventListener('click', (event) => {
    if (event.target?.hasAttribute?.('data-tm-close')) closePalette();
  });

  inputElement.addEventListener('input', () => {
    suggestionCursor = 0;
    renderSuggestionsForInput(inputElement.value);
  });

  inputElement.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePalette();
      event.preventDefault();
      return;
    }

    if (event.key === 'Tab') {
      const handled = applyTabCompletion(inputElement);
      if (handled) {
        suggestionCursor = 0;
        renderSuggestionsForInput(inputElement.value);
      }
      event.preventDefault();
      return;
    }

    if (event.key === 'ArrowUp') {
      /* if suggestions visible, navigate them first - keeps the up
         arrow predictable when the user is browsing completions
         rather than recalling history. history takes over once the
         suggestion list is empty / dismissed. */
      const list = suggestionsElement.querySelectorAll('.tm-command-suggestion');
      if (list.length > 1) {
        suggestionCursor = Math.max(0, suggestionCursor - 1);
        highlightSuggestion(suggestionsElement);
      } else {
        const recalled = recallHistory(-1);
        if (recalled !== null) inputElement.value = recalled;
        renderSuggestionsForInput(inputElement.value);
      }
      event.preventDefault();
      return;
    }

    if (event.key === 'ArrowDown') {
      const list = suggestionsElement.querySelectorAll('.tm-command-suggestion');
      if (list.length > 1) {
        suggestionCursor = Math.min(list.length - 1, suggestionCursor + 1);
        highlightSuggestion(suggestionsElement);
      } else {
        const recalled = recallHistory(1);
        if (recalled !== null) inputElement.value = recalled;
        renderSuggestionsForInput(inputElement.value);
      }
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter') {
      const submitted = inputElement.value.trim();
      pushHistoryEntry(submitted);
      const output = runCommand(submitted);
      renderCommandOutput(outputElement, output);
      suggestionsElement.replaceChildren();
      inputElement.select();
      event.preventDefault();
    }
  });

  return paletteRoot;
}

function renderCommandOutput(outputElement, output) {
  if (!output) {
    outputElement.replaceChildren();
    outputElement.setAttribute('hidden', '');
    return;
  }
  /* :help returns a structured token stream so we can paint argument
     specs differently from descriptions. plain string outputs from
     other commands skip the syntax pass and render verbatim. */
  outputElement.removeAttribute('hidden');
  if (Array.isArray(output)) {
    outputElement.replaceChildren();
    for (const line of output) outputElement.appendChild(buildHelpLineNode(line));
    return;
  }
  outputElement.textContent = output;
}

function buildHelpLineNode(line) {
  const lineNode = document.createElement('div');
  lineNode.className = 'tm-help-line';
  if (line.type === 'heading') {
    lineNode.classList.add('tm-help-heading');
    lineNode.textContent = line.text;
    return lineNode;
  }
  if (line.type === 'blank') {
    lineNode.innerHTML = '&nbsp;';
    return lineNode;
  }
  if (line.type === 'footer') {
    lineNode.classList.add('tm-help-footer');
    lineNode.textContent = line.text;
    return lineNode;
  }
  /* command line: ":name  argSpec  help" with each field independently
     coloured. fixed-width columns are faked with padding+inline-block
     so we don't need a table. */
  const nameNode = document.createElement('span');
  nameNode.className = 'tm-help-name';
  nameNode.textContent = `:${line.name}`;

  const argsNode = document.createElement('span');
  argsNode.className = 'tm-help-args';
  argsNode.textContent = line.argSpec ? `  ${line.argSpec}` : '';

  const helpNode = document.createElement('span');
  helpNode.className = 'tm-help-desc';
  helpNode.textContent = `  ${line.help}`;

  lineNode.append(nameNode, argsNode, helpNode);
  return lineNode;
}

function buildHelpOutput() {
  const lines = [];
  lines.push({ type: 'heading', text: 'commands' });
  lines.push({ type: 'blank' });
  for (const entry of COMMAND_REGISTRY) {
    lines.push({ type: 'command', name: entry.name, argSpec: entry.argSpec, help: entry.help });
  }
  lines.push({ type: 'blank' });
  lines.push({ type: 'footer', text: 'tab complete · ↑↓ history · ↵ run · esc close · / opens palette' });
  return lines;
}

/* split input into (tokenBeforeCursor, completedToken?). everything is
   parsed as space-delimited; quoting is intentionally not supported -
   the only command that takes a freeform name (`:goto`) reads
   everything after the first space, so no quoting is needed in practice. */
function parseInputTokens(rawInput) {
  const cleaned = rawInput.replace(/^:/, '');
  const tokens = cleaned.split(/\s+/);
  const trailingSpace = /\s$/.test(cleaned);
  return { tokens, trailingSpace };
}

function candidatesForInput(rawInput) {
  const { tokens, trailingSpace } = parseInputTokens(rawInput);
  if (tokens.length === 0 || (tokens.length === 1 && !trailingSpace)) {
    /* completing the command name itself */
    const prefix = tokens[0] ?? '';
    return COMMAND_REGISTRY
      .filter((entry) => entry.name.startsWith(prefix) || entry.aliases.some((alias) => alias.startsWith(prefix)))
      .map((entry) => ({ kind: 'command', value: entry.name, entry }));
  }

  /* completing an argument */
  const commandName = tokens[0];
  const entry = commandLookup(commandName);
  if (!entry || typeof entry.complete !== 'function') return [];

  const argPrefix = trailingSpace ? '' : (tokens[tokens.length - 1] ?? '');
  const candidates = entry.complete().filter((candidate) => candidate.startsWith(argPrefix));
  return candidates.map((value) => ({ kind: 'arg', value, entry }));
}

function applyTabCompletion(inputElement) {
  const candidates = candidatesForInput(inputElement.value);
  if (candidates.length === 0) return false;

  if (candidates.length === 1) {
    const { tokens, trailingSpace } = parseInputTokens(inputElement.value);
    const next = candidates[0].value;
    if (candidates[0].kind === 'command') {
      inputElement.value = `:${next} `;
    } else {
      const head = trailingSpace ? tokens : tokens.slice(0, -1);
      inputElement.value = `:${head.join(' ')} ${next} `;
    }
    return true;
  }

  /* multiple candidates: complete to the longest common prefix and
     surface the candidate list for the user to choose. */
  const commonPrefix = longestCommonPrefix(candidates.map((c) => c.value));
  if (commonPrefix) {
    const { tokens, trailingSpace } = parseInputTokens(inputElement.value);
    if (candidates[0].kind === 'command') {
      inputElement.value = `:${commonPrefix}`;
    } else {
      const head = trailingSpace ? tokens : tokens.slice(0, -1);
      inputElement.value = `:${head.join(' ')} ${commonPrefix}`;
    }
  }
  return true;
}

function longestCommonPrefix(strings) {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (const value of strings) {
    while (!value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

function renderSuggestionsForInput(rawInput) {
  const paletteRoot = document.getElementById(PALETTE_OVERLAY_ID);
  if (!paletteRoot) return;
  const suggestionsElement = paletteRoot.querySelector('.tm-command-suggestions');
  if (!suggestionsElement) return;
  suggestionsElement.replaceChildren();

  const candidates = candidatesForInput(rawInput);
  if (candidates.length === 0) return;

  const visible = candidates.slice(0, PALETTE_SUGGESTION_LIMIT);
  for (const candidate of visible) {
    const item = document.createElement('li');
    item.className = 'tm-command-suggestion';
    item.setAttribute('role', 'option');
    const nameNode = document.createElement('span');
    nameNode.className = 'tm-command-suggestion-name';
    nameNode.textContent = candidate.kind === 'command' ? `:${candidate.value}` : candidate.value;
    const helpNode = document.createElement('span');
    helpNode.className = 'tm-command-suggestion-help';
    if (candidate.kind === 'command') {
      const argSpec = candidate.entry.argSpec ? `  ${candidate.entry.argSpec}` : '';
      helpNode.textContent = `${argSpec}  ${candidate.entry.help}`;
    } else {
      helpNode.textContent = '';
    }
    item.append(nameNode, helpNode);
    suggestionsElement.appendChild(item);
  }
  suggestionCursor = Math.min(suggestionCursor, visible.length - 1);
  highlightSuggestion(suggestionsElement);
}

function highlightSuggestion(suggestionsElement) {
  const items = suggestionsElement.querySelectorAll('.tm-command-suggestion');
  items.forEach((item, index) => {
    item.classList.toggle('tm-command-suggestion-active', index === suggestionCursor);
  });
}

function openPalette(seedValue = '') {
  const paletteRoot = ensurePaletteElement();
  paletteRoot.classList.add('tm-command-open');
  setOverlayOpenFlag(true);

  const inputElement = paletteRoot.querySelector('.tm-command-input');
  if (!inputElement) return;
  inputElement.value = seedValue;
  historyCursor = commandHistory.length;
  suggestionCursor = 0;
  renderSuggestionsForInput(seedValue);
  /* clear stale output from a previous palette session - keeps the
     panel compact when the user just wants to fire a fresh command. */
  const outputElement = paletteRoot.querySelector('.tm-command-output');
  renderCommandOutput(outputElement, '');
  requestAnimationFrame(() => inputElement.focus());
}

function closePalette() {
  const paletteRoot = document.getElementById(PALETTE_OVERLAY_ID);
  paletteRoot?.classList.remove('tm-command-open');
  setOverlayOpenFlag(false);
  focusConversationInput();
}

function runThemeCommand(commandArgs) {
  if (!commandArgs[0]) return `usage: :theme ${VALID_THEMES.join('|')}`;
  setTheme(commandArgs[0]);
  return `theme=${settings.theme}`;
}

function runOpacityCommand(commandArgs) {
  if (!commandArgs[0]) return `opacity=${settings.opacityPct}% (usage: :opacity <20-100>)`;
  const stripped = commandArgs[0].replace(/%$/, '');
  let requestedPct = parseFloat(stripped);
  if (!Number.isFinite(requestedPct)) return 'usage: :opacity <20-100>';
  /* accept css-style fractional input ("0.98") - if the value contains a
     decimal point and falls in [0,1], treat it as a 0-1 fraction and
     scale to percent. inputs without a decimal stay as percent values. */
  if (stripped.includes('.') && requestedPct >= 0 && requestedPct <= 1) {
    requestedPct *= 100;
  }
  const appliedPct = setOpacityPct(requestedPct);
  return `opacity=${appliedPct}%`;
}

function runToggleableCommand(commandArgs, settingName, applySetting) {
  const flag = parseTriStateFlag(commandArgs[0]);
  if (flag === null) return `usage: :${settingName} [on|off]`;
  if (flag === 'toggle') applySetting(!settings[settingName]);
  else applySetting(flag === 'on');
  return `${settingName}=${settings[settingName]}`;
}

function runFocusCommand(commandArgs) {
  if (commandArgs[0] === 'message') return focusConversationInput() ? 'focused=message' : 'message input not found';
  if (commandArgs[0] === 'search') return focusSearchInput() ? 'focused=search' : 'search input not found';
  return 'usage: :focus message|search';
}

function runDensityCommand(commandArgs) {
  if (!commandArgs[0]) return `density=${settings.density} (usage: :density compact|cozy|comfy)`;
  if (!VALID_DENSITIES.includes(commandArgs[0])) return 'usage: :density compact|cozy|comfy';
  return `density=${setDensity(commandArgs[0])}`;
}

function runFontSizeCommand(commandArgs) {
  if (!commandArgs[0]) return `fontsize=${settings.fontSizePx}px (usage: :fontsize <n>|+|-)`;
  if (commandArgs[0] === '+') return `fontsize=${bumpFontSizePx(1)}px`;
  if (commandArgs[0] === '-') return `fontsize=${bumpFontSizePx(-1)}px`;
  const parsed = parseInt(commandArgs[0], 10);
  if (!Number.isFinite(parsed)) return 'usage: :fontsize <n>|+|-';
  return `fontsize=${setFontSizePx(parsed)}px`;
}

function runCommand(rawInput) {
  const trimmedCommand = rawInput.replace(/^:/, '').trim();
  if (!trimmedCommand || trimmedCommand === 'help') return buildHelpOutput();

  const [commandName, ...commandArgs] = trimmedCommand.split(/\s+/);
  const entry = commandLookup(commandName);
  if (!entry) return `unknown command: ${commandName}`;

  switch (entry.name) {
    case 'theme':         return runThemeCommand(commandArgs);
    case 'ultra':         return runToggleableCommand(commandArgs, 'ultra', setUltra);
    case 'opacity':       return runOpacityCommand(commandArgs);
    case 'mute':          return runToggleableCommand(commandArgs, 'muted', setMuted);
    case 'density':       return runDensityCommand(commandArgs);
    case 'fontsize':      return runFontSizeCommand(commandArgs);
    case 'sent-color':    return runToggleableCommand(commandArgs, 'sentColor', setSentColor);
    case 'bottom':        return scrollLogToBottom() ? '' : 'no log';
    case 'top':           return scrollLogToTop() ? '' : 'no log';
    case 'filter': {
      if (!commandArgs[0]) return `filter=${settings.chatListFilter} (usage: :filter all|unread)`;
      if (!VALID_CHAT_FILTERS.includes(commandArgs[0])) return 'usage: :filter all|unread';
      return `filter=${setChatListFilter(commandArgs[0])}`;
    }
    case 'pin':           return pinCursoredChat() ? '' : '';
    case 'mark-unread':   return markCursoredChatUnread() ? '' : '';
    case 'mute-chat':     return muteCursoredChat() ? '' : '';
    case 'goto': {
      const targetName = commandArgs.join(' ');
      return gotoChatByName(targetName) ? `opened: ${targetName}` : `no chat matching "${targetName}"`;
    }
    case 'search':
      closePalette();
      openSearchOverlay(commandArgs.join(' '));
      return '';
    case 'focus':         return runFocusCommand(commandArgs);
    case 'unread':        return openFirstUnreadThread() ? 'opened≈unread' : 'no unread item detected';
    case 'notifications':
      openNotificationsOverlay();
      return '';
    case 'reload':
      window.location.reload();
      return 'reloading...';
    case 'q':
      closePalette();
      return '';
    case 'help':
    default:
      return buildHelpOutput();
  }
}
