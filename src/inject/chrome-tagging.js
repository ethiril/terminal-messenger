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
  /* early-out: after the first successful tag the placard is already
     hidden by CSS. re-scanning span/div/a across [role='main'] (often
     thousands of nodes) on every apply pass was pure overhead. */
  if (mainElement.querySelector('[data-tm-thread-intro]')) return;
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
   suppress its imagery without touching the regular chat list.

   only tag a dialog/listbox/menu if it contains MULTIPLE /t/ anchors -
   a one-off /t/ link inside an unrelated modal (e.g. thread-details with
   a single shortcut to the chat) would otherwise lose all imagery in
   that modal. results popovers always carry many anchors at once. */
function tagSearchResultsDropdown() {
  const externalChatLinks = document.querySelectorAll('a[role="link"][href*="/t/"]');
  const scopeCounts = new Map();
  const linksWithoutScope = [];
  for (const link of externalChatLinks) {
    if (link.closest('[data-tm-chat-list]')) continue;
    if (link.closest('[role="log"], [data-tm-thread]')) continue;

    const scope = link.closest('[role="dialog"], [role="listbox"], [role="menu"]');
    if (scope) {
      scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
    } else {
      linksWithoutScope.push(link);
    }
  }

  for (const [scope, count] of scopeCounts) {
    if (count < 2) continue;
    if (scope.hasAttribute('data-tm-search-results')) continue;
    scope.setAttribute('data-tm-search-results', 'true');
  }

  /* unwrapped result rows: tag the link itself, which still suppresses its
     own avatar without affecting unrelated imagery elsewhere. */
  for (const link of linksWithoutScope) {
    if (link.hasAttribute('data-tm-search-results')) continue;
    link.setAttribute('data-tm-search-results', 'true');
  }
}

/* tag the wrapper directly around the composer's contenteditable so CSS
   can render a "❯ " prompt prefix via ::before. picked the parent rather
   than the contenteditable itself because fb's "Aa" placeholder is a real
   DOM overlay (lexical-style absolute-positioned sibling), not a pseudo
   element - replacing the contenteditable's pseudo wouldn't catch it. */
function tagComposerHost() {
  const composerInput = findFirstMatchingElement(COMPOSER_INPUT_SELECTORS);
  if (!composerInput) return;
  const host = composerInput.parentElement;
  if (!host) return;
  if (host.hasAttribute('data-tm-composer-host')) return;
  document.querySelectorAll('[data-tm-composer-host]')
    .forEach((node) => node.removeAttribute('data-tm-composer-host'));
  host.setAttribute('data-tm-composer-host', 'true');
}

/* tag fb's "Aa" placeholder so CSS can shift it past the chevron column.
   it's rendered as an absolute-positioned, pointer-events:none overlay
   that ignores padding-left on the contenteditable - hence the visible
   overlap when the composer is empty. detection heuristic: any descendant
   of the composer host that isn't the textbox, has short text content,
   and has computed pointer-events:none. */
function tagComposerPlaceholder() {
  const host = document.querySelector('[data-tm-composer-host]');
  if (!host) return;
  const textbox = host.querySelector('[contenteditable="true"], [role="textbox"]');
  if (!textbox) return;

  for (const stale of host.querySelectorAll('[data-tm-composer-placeholder]')) {
    stale.removeAttribute('data-tm-composer-placeholder');
  }

  for (const candidate of host.querySelectorAll('*')) {
    if (candidate === textbox) continue;
    if (textbox.contains(candidate)) continue;
    if (candidate.contains(textbox)) continue;
    const text = (candidate.textContent ?? '').trim();
    if (text.length === 0 || text.length > 12) continue;
    const style = window.getComputedStyle(candidate);
    if (style.pointerEvents !== 'none') continue;
    candidate.setAttribute('data-tm-composer-placeholder', 'true');
  }
}

/* when the user clicks Reply on a message, fb renders a "Replying to <name>"
   preview as a sibling of the composer's textbox region - not a descendant
   - so a scope walk down from the textbox wrapper misses it entirely. fb's
   parent for the preview+textbox pair is flex-row, which places the preview
   to the LEFT of the textbox at the same y; in ultra mode the position:
   fixed composer then covers it. find the preview anywhere inside
   [role='main'] (outside the log/thread so existing in-message replies
   aren't matched), then climb to the largest wrapper that does NOT
   contain the composer input - that's the preview's branch. CSS rules
   keyed off the tag re-flow the preview ABOVE the textbox in both modes. */
function tagComposerReplyPreview() {
  const composerInput = findFirstMatchingElement(COMPOSER_INPUT_SELECTORS);
  if (!composerInput) {
    document.querySelectorAll('[data-tm-composer-reply-preview]')
      .forEach((node) => node.removeAttribute('data-tm-composer-reply-preview'));
    return;
  }

  const mainElement = composerInput.closest('[role="main"]') ?? document.body;

  /* fast path: the Cancel reply button is a stable anchor (aria-label
     "Cancel reply"). prefer it over text-matching when present - localised
     fb builds may translate "Replying to" but the aria-label tends to
     stay english in this build. */
  let anchor = mainElement.querySelector('[aria-label="Cancel reply" i]');

  if (!anchor) {
    /* fallback: text scan for the "Replying to <name>" header. skip
       nodes that engulf or are inside the composer input, and skip
       anything inside the message log (those are already-sent reply
       quotes, a different feature handled by tagReplyQuotes). */
    for (const candidate of mainElement.querySelectorAll('div, span, section, aside, h3, h4, p')) {
      if (candidate === composerInput) continue;
      if (candidate.contains(composerInput)) continue;
      if (composerInput.contains(candidate)) continue;
      if (candidate.closest('[role="log"], [data-tm-thread]')) continue;
      const directText = collectDirectText(candidate);
      if (!directText) continue;
      if (directText.length > 80) continue;
      if (!/\breplying to\b/i.test(directText)) continue;
      anchor = candidate;
      break;
    }
  }

  if (!anchor) {
    /* user cancelled or never started a reply - clear any stale tag */
    document.querySelectorAll('[data-tm-composer-reply-preview]')
      .forEach((node) => node.removeAttribute('data-tm-composer-reply-preview'));
    return;
  }

  /* climb until the next step up would engulf the input. the resulting
     wrapper is the preview's whole branch (cancel button + sender label +
     quoted body), which is a sibling of the textbox region's branch. */
  let wrapper = anchor;
  while (wrapper.parentElement && !wrapper.parentElement.contains(composerInput)) {
    wrapper = wrapper.parentElement;
  }

  if (wrapper.hasAttribute('data-tm-composer-reply-preview')) return;
  document.querySelectorAll('[data-tm-composer-reply-preview]')
    .forEach((node) => node.removeAttribute('data-tm-composer-reply-preview'));
  wrapper.setAttribute('data-tm-composer-reply-preview', 'true');
}

/* mark chat-list rows that look unread so the :filter command can hide
   everything else. fb encodes unread in several places:
   - aria-label includes "unread"
   - row contains a text/numeric badge whose accessible name carries
     "unread"
   - row's preview text is rendered in bold (heuristic: an inner span
     with font-weight >= 600 via inline style)
   re-evaluated every apply pass because fb mutates rows in place when
   they go from read→unread without unmounting them. */
function tagChatListUnread() {
  const chatLists = document.querySelectorAll('[data-tm-chat-list]');
  for (const chatList of chatLists) {
    const rows = chatList.querySelectorAll('[role="row"]');
    let unreadCount = 0;
    for (const row of rows) {
      const isUnread = chatRowLooksUnread(row);
      if (isUnread) {
        row.setAttribute('data-tm-unread', 'true');
        unreadCount += 1;
      } else {
        row.removeAttribute('data-tm-unread');
      }
    }
    /* mirror the visible-unread count onto the grid so CSS can render it
       inside the filter banner via attr(). zero stays as "0" rather than
       being removed so the banner doesn't visibly flicker when the count
       drops to zero. */
    chatList.setAttribute('data-tm-unread-count', String(unreadCount));
  }
}

function chatRowLooksUnread(row) {
  const ariaLabel = (row.getAttribute('aria-label') ?? '').toLowerCase();
  if (/\bunread\b|\bnot read\b/.test(ariaLabel)) return true;
  const inner = row.querySelector('[aria-label*="unread" i], [aria-label*="not read" i]');
  if (inner) return true;
  return false;
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
