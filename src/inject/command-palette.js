const PALETTE_OVERLAY_ID = 'tm-command-root';

const HELP_OUTPUT = [
  'commands',
  '',
  ':search [query]   open the search overlay (live results, alias: :s)',
  ':focus message    focus the message composer',
  ':focus search     focus messenger native search',
  ':goto <name>      open the first chat matching <name> (alias: :c)',
  ':theme green|amber|cyan|mono',
  ':ultra  [on|off]  ultra terminal mode (no arg = toggle)',
  ':opacity <20-100> window transparency, in percent',
  ':mute   [on|off]  mute window audio (no arg = toggle)',
  ':unread           open first unread-looking thread',
  ':reload           reload the page',
  ':q | :clear       close this palette',
  '',
  'shortcuts: ⌘⇧P palette · ⌘⇧S search · ⌘⇧T theme · ⌘⇧U ultra · ⌘⇧M mute · / opens palette'
].join('\n');

const ENABLE_FLAG_VALUES = ['on', 'true', '1'];
const DISABLE_FLAG_VALUES = ['off', 'false', '0'];

function parseTriStateFlag(flagValue) {
  if (!flagValue) return 'toggle';
  if (ENABLE_FLAG_VALUES.includes(flagValue)) return 'on';
  if (DISABLE_FLAG_VALUES.includes(flagValue)) return 'off';
  return null;
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
      <div class="tm-command-hint">help · search · theme [green|amber|cyan|mono] · ultra [on|off] · opacity &lt;20-100&gt; · mute · focus [message|search] · unread · reload · q</div>
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
  paletteRoot.classList.add('tm-command-open');

  const inputElement = paletteRoot.querySelector('.tm-command-input');
  if (!inputElement) return;
  inputElement.value = seedValue;
  requestAnimationFrame(() => inputElement.focus());
}

function closePalette() {
  const paletteRoot = document.getElementById(PALETTE_OVERLAY_ID);
  paletteRoot?.classList.remove('tm-command-open');
  focusConversationInput();
}

function runThemeCommand(commandArgs) {
  if (!commandArgs[0]) return 'usage: :theme green|amber|cyan|mono';
  setTheme(commandArgs[0]);
  return `theme=${settings.theme}`;
}

function runOpacityCommand(commandArgs) {
  if (!commandArgs[0]) return `opacity=${settings.opacityPct}% (usage: :opacity <20-100>)`;
  const requestedPct = parseInt(commandArgs[0].replace(/%$/, ''), 10);
  if (!Number.isFinite(requestedPct)) return 'usage: :opacity <20-100>';
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

function runCommand(rawInput) {
  const trimmedCommand = rawInput.replace(/^:/, '').trim();
  if (!trimmedCommand || trimmedCommand === 'help') return HELP_OUTPUT;

  const [commandName, ...commandArgs] = trimmedCommand.split(/\s+/);

  if (commandName === 'theme') return runThemeCommand(commandArgs);
  if (commandName === 'ultra') return runToggleableCommand(commandArgs, 'ultra', setUltra);
  if (commandName === 'opacity') return runOpacityCommand(commandArgs);
  if (commandName === 'mute') return runToggleableCommand(commandArgs, 'muted', setMuted);

  if (commandName === 'goto' || commandName === 'c') {
    const targetName = commandArgs.join(' ');
    return gotoChatByName(targetName) ? `opened: ${targetName}` : `no chat matching "${targetName}"`;
  }

  if (commandName === 'search' || commandName === 's') {
    closePalette();
    openSearchOverlay(commandArgs.join(' '));
    return '';
  }

  if (commandName === 'focus') return runFocusCommand(commandArgs);
  if (commandName === 'unread') return openFirstUnreadThread() ? 'opened≈unread' : 'no unread item detected';

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
