/* ─── shared selectors and small helpers used by every other inject module ─── */

const AVATAR_THRESHOLD_PX = 40;
const OUTGOING_BUBBLE_OFFSET_PX = 16;
const THREAD_NAME_MAX_LENGTH = 48;
const COMPOSER_LOOKUP_DEPTH = 8;

const COMPOSER_INPUT_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[aria-label*="Message"][contenteditable="true"]',
  '[aria-label*="Aa"][contenteditable="true"]'
];

const SEARCH_INPUT_SELECTORS = [
  'input[placeholder*="Search"]',
  'input[aria-label*="Search"]',
  '[contenteditable="true"][aria-label*="Search"]'
];

const SEARCHABLE_ROW_SELECTOR = '[role="row"], [role="listitem"], a[role="link"]';

const THREAD_HEADING_SELECTORS = [
  '[role="main"] h1',
  '[role="main"] h2',
  '[aria-label*="Conversation with"]',
  '[aria-label*="Messages in conversation with"]'
];

const PRESENCE_TEXT_PATTERNS = [
  /Active now/i,
  /Active \d+\s?[mhd]\s?ago/i,
  /Active \d+ minutes? ago/i,
  /Active \d+ hours? ago/i,
  /Active in chat/i,
  /Just opened/i
];

const REPLY_HINT_PATTERN = /\breplied to\b|\breplying to\b/i;

function findFirstMatchingElement(selectorList) {
  return document.querySelector(selectorList.join(','));
}

function isUserTypingInto(eventTarget) {
  if (!eventTarget) return false;
  return eventTarget.tagName === 'INPUT'
    || eventTarget.tagName === 'TEXTAREA'
    || eventTarget.isContentEditable === true;
}

/* ─── chat header / thread metadata ─── */

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

function getActivePresenceStatus() {
  /* prefer the tagged chat-header, fall back to searching inside [role="main"]
     but outside the message log so we still find "Active now" even when the
     header detection didn't fire (e.g. on first paint, or if facebook moved
     the heading into a flatter layout we don't recognise as a header block). */
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

function collectDirectText(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim();
}

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

  /* prefer a heading-anchored climb: the chat-header always wraps a heading
     (h1/h2/[role="heading"]) that holds the contact name, and it sits as a
     sibling-or-cousin of the log inside [role="main"]. walking up from the
     heading until we land on a direct child of main is more robust than
     walking up from the log because facebook sometimes nests the log in
     extra wrappers, leaving its previousElementSibling empty. */
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

  /* fallback: previous-sibling walk from the log, which still works for the
     simple layout cases that don't expose a [role="heading"]. */
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

/* tag wrappers around the on-hover action toolbar (More / React / Reply /
   Forward). we do this in JS rather than via CSS :has() because :has() with
   [aria-label*='React' i] also matches divs containing reaction badges
   (aria-label="Reactions" / "Like reaction"), which would silently absolute-
   position the badges out of view. tag the wrapper only when at least one
   *non-reaction* action button is a direct child. */
function tagActionToolbarWrappers() {
  const rows = document.querySelectorAll('[role="log"] [role="row"]');
  for (const row of rows) {
    const candidates = row.querySelectorAll('div:not([data-tm-action-toolbar])');
    for (const wrapper of candidates) {
      if (!hasDirectActionButton(wrapper)) continue;
      wrapper.setAttribute('data-tm-action-toolbar', 'true');
    }
  }
}

function hasDirectActionButton(wrapper) {
  for (const child of wrapper.children) {
    const role = child.getAttribute('role');
    if (role !== 'button' && child.tagName !== 'BUTTON') continue;
    const label = child.getAttribute('aria-label') ?? '';
    if (!label) continue;
    if (/reaction/i.test(label)) continue;
    if (/^(more|react|reply|forward)/i.test(label.trim())) return true;
  }
  return false;
}

/* ─── message direction inference ─── */

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

function tagMessageDirections() {
  const messageRows = document.querySelectorAll('[role="log"] [role="row"]:not([data-tm-direction])');
  for (const messageRow of messageRows) {
    const direction = inferMessageDirection(messageRow);
    if (direction) messageRow.setAttribute('data-tm-direction', direction);
  }
}

/* ─── small/large image classification (read receipts vs message photos) ─── */

function tagSmallLogImages() {
  const candidateImages = document.querySelectorAll('[role="log"] img:not([data-tm-img-size])');
  for (const imageElement of candidateImages) {
    if (isInsideReactionContainer(imageElement)) {
      imageElement.setAttribute('data-tm-img-size', 'large');
      continue;
    }

    const rect = imageElement.getBoundingClientRect();
    const naturalWidth = imageElement.naturalWidth || 0;
    const naturalHeight = imageElement.naturalHeight || 0;
    const explicitWidth = parseInt(imageElement.getAttribute('width') ?? '0', 10);
    const explicitHeight = parseInt(imageElement.getAttribute('height') ?? '0', 10);

    const widthSignals = [rect.width, naturalWidth, explicitWidth].filter((value) => value > 0);
    const heightSignals = [rect.height, naturalHeight, explicitHeight].filter((value) => value > 0);
    if (widthSignals.length === 0) continue;

    const minWidth = Math.min(...widthSignals);
    const minHeight = heightSignals.length ? Math.min(...heightSignals) : minWidth;

    const isLikelyAvatar = minWidth <= AVATAR_THRESHOLD_PX && minHeight <= AVATAR_THRESHOLD_PX;
    imageElement.setAttribute('data-tm-img-size', isLikelyAvatar ? 'small' : 'large');
  }
}

function isInsideReactionContainer(element) {
  let ancestor = element.parentElement;
  let depth = 0;
  while (ancestor && depth < 5) {
    const label = (ancestor.getAttribute('aria-label') ?? '').toLowerCase();
    if (/reaction|emoji/.test(label)) return true;
    if (ancestor.matches('[role="row"]')) break;
    ancestor = ancestor.parentElement;
    depth += 1;
  }
  return false;
}

/* ─── reply quote tagging ───
   when a row contains "X replied to you" the quoted source bubble should visually
   recede from the new typed message. fb's dom doesn't expose a clean aria-label
   for the quote subtree, so we walk up from the hint text and tag the nearest
   ancestor that wraps the entire reply preview block (hint + quoted bubble). */

function tagReplyQuotes() {
  const rows = document.querySelectorAll('[role="log"] [role="row"]:not([data-tm-reply-scanned])');
  for (const row of rows) {
    row.setAttribute('data-tm-reply-scanned', 'true');

    const hintElement = findReplyHintElement(row);
    if (!hintElement) continue;

    row.setAttribute('data-tm-has-reply', 'true');

    const replyBlock = climbToReplyBlock(hintElement, row);
    if (replyBlock) replyBlock.setAttribute('data-tm-reply-quote', 'true');
  }
}

function findReplyHintElement(row) {
  const candidates = row.querySelectorAll('span, div, a');
  for (const candidate of candidates) {
    const directText = collectDirectText(candidate);
    if (!directText) continue;
    if (directText.length > 60) continue;
    if (REPLY_HINT_PATTERN.test(directText)) return candidate;
  }
  return null;
}

function climbToReplyBlock(hintElement, row) {
  let scope = hintElement;
  while (scope.parentElement && scope.parentElement !== row) {
    const parent = scope.parentElement;
    if (parent.parentElement === row) return parent;
    scope = parent;
  }
  return scope.parentElement === row ? scope : null;
}

/* ─── ultra mode layout targets ─── */

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

/* ─── unblock paste hooks fb sets on inputs ─── */

const pasteUnblockedElements = new WeakSet();

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
