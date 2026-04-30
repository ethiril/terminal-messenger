function tagActiveThread() {
  const thread = document.querySelector('[role="log"], [aria-label*="Messages in conversation"]');
  if (!thread || thread.hasAttribute('data-tm-thread')) return;

  document.querySelectorAll('[data-tm-thread]').forEach((node) => node.removeAttribute('data-tm-thread'));
  thread.setAttribute('data-tm-thread', 'true');
}

function tagChatHeader() {
  const messageLog = document.querySelector('[role="log"]');
  if (!messageLog) return;

  const mainElement = messageLog.closest('[role="main"]');
  if (!mainElement) return;

  /* heading-anchored climb is more robust than walking up from the log
     directly: fb sometimes wraps the log in extra nesting that leaves the
     log's previousElementSibling empty. */
  let headerCandidate = null;
  const headingCandidates = mainElement.querySelectorAll('h1, h2, [role="heading"]');
  for (const heading of headingCandidates) {
    if (messageLog.contains(heading)) continue;
    let walker = heading;
    while (walker.parentElement && walker.parentElement !== mainElement) {
      walker = walker.parentElement;
    }
    if (walker.parentElement === mainElement && !walker.contains(messageLog)) {
      headerCandidate = walker;
      break;
    }
  }

  if (!headerCandidate) {
    let logChild = messageLog;
    while (logChild.parentElement && logChild.parentElement !== mainElement) {
      logChild = logChild.parentElement;
    }
    let sibling = logChild.previousElementSibling;
    while (sibling && (sibling.textContent ?? '').trim().length === 0) {
      sibling = sibling.previousElementSibling;
    }
    headerCandidate = sibling;
  }

  if (!headerCandidate) return;

  if (!headerCandidate.hasAttribute('data-tm-chat-header')) {
    document.querySelectorAll('[data-tm-chat-header]').forEach((node) => node.removeAttribute('data-tm-chat-header'));
    headerCandidate.setAttribute('data-tm-chat-header', 'true');
  }
}

/* fb injects a "<contact> · Active now" placard at the top of the log AND
   sometimes as a sibling above it. presence is already in the statusline so
   we hide the placard - but we have to scope the climb so it doesn't engulf
   the log itself or any message rows. */
function tagThreadIntroCard() {
  const mainElement = document.querySelector('[role="main"]');
  if (!mainElement) return;
  const messageLog = mainElement.querySelector('[role="log"]');

  const candidates = mainElement.querySelectorAll('span, div, a');
  for (const candidate of candidates) {
    if (candidate.closest('[role="row"]')) continue;
    if (candidate.closest('[data-tm-thread-intro]')) continue;

    const directText = collectDirectText(candidate);
    if (!directText) continue;
    const matchesPresence = PRESENCE_TEXT_PATTERNS.some((pattern) => pattern.test(directText));
    if (!matchesPresence) continue;

    let scope = candidate;
    while (scope.parentElement && scope.parentElement !== mainElement) {
      const parent = scope.parentElement;
      if (parent.querySelector('[role="row"]')) break;
      if (messageLog && parent.contains(messageLog)) break;
      scope = parent;
    }

    if (!scope.hasAttribute('data-tm-thread-intro')) {
      scope.setAttribute('data-tm-thread-intro', 'true');
    }
  }
}

/* CSS used to scope chat-list avatars via [role='grid']:not([role='log']),
   but the descendant combinator reaches into log rows when fb wraps the log
   inside another grid - that bug rendered timestamps as 18×18 squares with
   text wrapping vertically. tagging the chat-list grid in JS is exact. */
function tagChatList() {
  const grids = document.querySelectorAll('[role="grid"]');
  for (const grid of grids) {
    if (grid.matches('[role="log"]')) continue;
    if (grid.querySelector('[role="log"]')) continue;
    if (grid.hasAttribute('data-tm-chat-list')) continue;
    if (!grid.querySelector('[role="row"], [role="listitem"]')) continue;
    grid.setAttribute('data-tm-chat-list', 'true');
  }
}

/* fb's native search dropdown renders chat-result rows outside the
   [data-tm-chat-list] grid, so chat-list avatar styling never reaches them
   and the natural-size avatars come through as broken letter-blocks. find
   any container holding such "external" chat anchors and tag it so CSS can
   suppress its imagery without touching the regular chat list. */
function tagSearchResultsDropdown() {
  const externalChatLinks = document.querySelectorAll('a[role="link"][href*="/t/"]');
  for (const link of externalChatLinks) {
    if (link.closest('[data-tm-chat-list]')) continue;
    if (link.closest('[role="log"], [data-tm-thread]')) continue;

    /* prefer tagging the popover so a single attribute covers every result
       row; fall back to the link itself when fb renders results without a
       popover wrapper, which still hides each row's avatar individually. */
    const scope = link.closest('[role="dialog"], [role="listbox"], [role="menu"]') ?? link;
    if (scope.hasAttribute('data-tm-search-results')) continue;
    scope.setAttribute('data-tm-search-results', 'true');
  }
}

function tagUltraLayoutTargets() {
  const messageLog = document.querySelector('[role="log"]');
  if (messageLog && !messageLog.hasAttribute('data-tm-ultra-log')) {
    messageLog.setAttribute('data-tm-ultra-log', 'true');
  }

  const composerInput = findFirstMatchingElement(COMPOSER_INPUT_SELECTORS);
  if (!composerInput) return;

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

function getActiveThreadName() {
  for (const selector of THREAD_HEADING_SELECTORS) {
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

/* fall back to scanning [role='main'] outside the log when the tagged header
   isn't ready yet (first paint, or fb moved the heading into a flatter
   layout we don't recognise as a header block). */
function getActivePresenceStatus() {
  const messageLog = document.querySelector('[role="log"]');
  const taggedHeader = document.querySelector('[data-tm-chat-header]');
  const mainElement = messageLog?.closest('[role="main"]') ?? null;
  const searchScope = taggedHeader ?? mainElement;
  if (!searchScope) return null;

  const candidates = searchScope.querySelectorAll('span, div, a');
  for (const candidate of candidates) {
    if (messageLog && messageLog.contains(candidate)) continue;
    const directText = collectDirectText(candidate);
    if (!directText) continue;

    for (const pattern of PRESENCE_TEXT_PATTERNS) {
      const match = directText.match(pattern);
      if (match) return match[0].replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}
