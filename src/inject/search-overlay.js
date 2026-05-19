const SEARCH_OVERLAY_ID = 'tm-search-root';
const SEARCH_RESULT_LIMIT = 12;
const SEARCH_LABEL_TRIM = 100;
const SEARCH_TOAST_TRIM = 30;

let searchResultCursor = 0;

/* the last in-thread query and the messages we matched. kept around after
   the overlay closes so `n`/`N` outside the overlay can step forward/back
   through those same matches without re-opening the overlay. cleared on
   thread switch (DOM nodes detach). */
let lastMessageMatches = [];
let lastMessageMatchCursor = -1;
let lastMessageQuery = '';

function appendSearchHintRow(resultsElement, hintMessage) {
  const hintItem = document.createElement('li');
  hintItem.className = 'tm-search-hint';
  hintItem.textContent = hintMessage;
  resultsElement.appendChild(hintItem);
}

function appendSearchSectionHeading(resultsElement, headingText) {
  const heading = document.createElement('li');
  heading.className = 'tm-search-section';
  heading.textContent = headingText;
  resultsElement.appendChild(heading);
}

/* a single chat-list row often contains a nested link, so SEARCHABLE_ROW_SELECTOR
   yields the same chat twice. dedupe by label and keep the deepest match - that's
   the one whose click navigates correctly. */
function findChatMatchesForQuery(lowercaseQuery) {
  const matches = [];
  const seenLabels = new Set();
  const candidateRows = document.querySelectorAll(SEARCHABLE_ROW_SELECTOR);
  for (const candidate of candidateRows) {
    const label = (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim();
    if (!label || !label.toLowerCase().includes(lowercaseQuery)) continue;
    /* exclude matches inside the message log - those are messages, not
       chats, and would otherwise pollute the chat result section. */
    if (candidate.closest('[role="log"], [data-tm-thread]')) continue;
    const normalisedLabel = label.toLowerCase();
    if (seenLabels.has(normalisedLabel)) continue;
    seenLabels.add(normalisedLabel);
    matches.push({ label, target: candidate, kind: 'chat' });
    if (matches.length >= SEARCH_RESULT_LIMIT) break;
  }
  return matches;
}

/* search messages in the currently open thread by exact substring. fb's
   chat log is virtualised: only the visible window of messages lives in
   the DOM. matches limited to what's been loaded - the user can scroll
   up to bring older messages into the DOM and re-search. */
function findMessageMatchesForQuery(lowercaseQuery) {
  const matches = [];
  const messages = document.querySelectorAll(
    '[role="log"] [aria-roledescription="message"], [data-tm-thread] [aria-roledescription="message"]'
  );
  for (const message of messages) {
    const text = (message.textContent ?? '').trim();
    if (!text) continue;
    if (!text.toLowerCase().includes(lowercaseQuery)) continue;
    matches.push({
      label: text.slice(0, SEARCH_LABEL_TRIM),
      target: message,
      kind: 'message'
    });
    if (matches.length >= SEARCH_RESULT_LIMIT) break;
  }
  return matches;
}

function ensureSearchOverlay() {
  const existing = document.getElementById(SEARCH_OVERLAY_ID);
  if (existing) return existing;

  const searchRoot = document.createElement('div');
  searchRoot.id = SEARCH_OVERLAY_ID;
  searchRoot.innerHTML = `
    <div class="tm-search-backdrop" data-tm-close></div>
    <section class="tm-search-panel" role="dialog" aria-modal="true" aria-label="Terminal Messenger search">
      <div class="tm-search-title">~/messenger search %</div>
      <input class="tm-search-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="type a name or message…" />
      <ul class="tm-search-results" role="listbox"></ul>
      <div class="tm-search-footer">
        <span>↵ · open</span>
        <span>↑↓ · navigate</span>
        <span>esc · close</span>
      </div>
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
    if (event.key === 'ArrowDown') {
      moveSearchResultCursor(1);
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp') {
      moveSearchResultCursor(-1);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      const active = resultsElement.querySelector('.tm-search-result.tm-search-active')
        ?? resultsElement.querySelector('.tm-search-result');
      active?.click();
      event.preventDefault();
    }
  });

  inputElement.addEventListener('input', () => {
    searchResultCursor = 0;
    refreshSearchResults(inputElement.value);
  });

  return searchRoot;
}

function moveSearchResultCursor(direction) {
  const searchRoot = document.getElementById(SEARCH_OVERLAY_ID);
  if (!searchRoot) return;
  const results = searchRoot.querySelectorAll('.tm-search-result');
  if (results.length === 0) return;
  searchResultCursor = (searchResultCursor + direction + results.length) % results.length;
  applySearchActiveCursor(results);
}

function applySearchActiveCursor(results) {
  results.forEach((result, index) => {
    result.classList.toggle('tm-search-active', index === searchResultCursor);
    if (index === searchResultCursor) {
      result.scrollIntoView({ block: 'nearest' });
    }
  });
}

function buildResultRow(result, index) {
  const resultItem = document.createElement('li');
  resultItem.className = 'tm-search-result';
  resultItem.setAttribute('data-tm-result-index', String(index));
  resultItem.setAttribute('data-tm-result-kind', result.kind);
  resultItem.textContent = result.label.slice(0, SEARCH_LABEL_TRIM);
  resultItem.addEventListener('click', () => {
    if (result.kind === 'message') {
      result.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flashMessageMatch(result.target);
      /* remember which match the user picked so n/N continues from here
         rather than restarting at index 0 after the overlay closes. */
      lastMessageMatchCursor = lastMessageMatches.indexOf(result.target);
      showToast(`jumped: ${result.label.slice(0, SEARCH_TOAST_TRIM)}`);
    } else {
      result.target.click();
      showToast(`opened: ${result.label.slice(0, SEARCH_TOAST_TRIM)}`);
    }
    closeSearchOverlay();
  });
  return resultItem;
}

/* outside-overlay step through the in-thread matches collected by the last
   refresh. returns false when there's nothing to step through (user hasn't
   searched yet or the cached matches are stale because fb re-rendered the
   log). on stale matches the caller usually shows a hint. */
function stepLastMessageMatch(direction) {
  const liveMatches = lastMessageMatches.filter((node) => node && node.isConnected);
  if (liveMatches.length === 0) return false;
  if (liveMatches.length !== lastMessageMatches.length) {
    lastMessageMatches = liveMatches;
    if (lastMessageMatchCursor >= liveMatches.length) lastMessageMatchCursor = -1;
  }
  const total = lastMessageMatches.length;
  const nextCursor = lastMessageMatchCursor < 0
    ? (direction > 0 ? 0 : total - 1)
    : (lastMessageMatchCursor + direction + total) % total;
  lastMessageMatchCursor = nextCursor;
  const target = lastMessageMatches[nextCursor];
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flashMessageMatch(target);
  showToast(`match ${nextCursor + 1}/${total}: ${lastMessageQuery}`);
  return true;
}

/* brief highlight pulse so the user can locate the match after a jump
   - the chat log is dense and the match might otherwise be lost. */
function flashMessageMatch(messageElement) {
  messageElement.setAttribute('data-tm-search-flash', 'true');
  setTimeout(() => messageElement.removeAttribute('data-tm-search-flash'), 1400);
}

function refreshSearchResults(queryText) {
  const searchRoot = document.getElementById(SEARCH_OVERLAY_ID);
  if (!searchRoot) return;

  const resultsElement = searchRoot.querySelector('.tm-search-results');
  resultsElement.replaceChildren();

  const trimmedQuery = queryText.trim();
  if (!trimmedQuery) {
    appendSearchHintRow(resultsElement, 'type to search chats and messages…');
    return;
  }

  const lowercaseQuery = trimmedQuery.toLowerCase();
  const chatMatches = findChatMatchesForQuery(lowercaseQuery);
  const messageMatches = findMessageMatchesForQuery(lowercaseQuery);

  /* cache in-thread matches so n/N can step through them after close */
  lastMessageQuery = trimmedQuery;
  lastMessageMatches = messageMatches.map((m) => m.target);
  lastMessageMatchCursor = -1;

  if (chatMatches.length === 0 && messageMatches.length === 0) {
    appendSearchHintRow(resultsElement, 'no matches');
    return;
  }

  let runningIndex = 0;
  if (chatMatches.length > 0) {
    appendSearchSectionHeading(resultsElement, 'chats');
    for (const result of chatMatches) {
      resultsElement.appendChild(buildResultRow(result, runningIndex));
      runningIndex += 1;
    }
  }
  if (messageMatches.length > 0) {
    appendSearchSectionHeading(resultsElement, 'messages in this chat');
    for (const result of messageMatches) {
      resultsElement.appendChild(buildResultRow(result, runningIndex));
      runningIndex += 1;
    }
  }

  const results = resultsElement.querySelectorAll('.tm-search-result');
  searchResultCursor = Math.min(searchResultCursor, results.length - 1);
  if (searchResultCursor < 0) searchResultCursor = 0;
  applySearchActiveCursor(results);
}

function openSearchOverlay(seedValue = '') {
  const searchRoot = ensureSearchOverlay();
  searchRoot.classList.add('tm-search-open');
  setOverlayOpenFlag(true);

  const inputElement = searchRoot.querySelector('.tm-search-input');
  if (!inputElement) return;

  inputElement.value = seedValue;
  searchResultCursor = 0;
  refreshSearchResults(seedValue);
  requestAnimationFrame(() => inputElement.focus());
}

function closeSearchOverlay() {
  const searchRoot = document.getElementById(SEARCH_OVERLAY_ID);
  searchRoot?.classList.remove('tm-search-open');
  setOverlayOpenFlag(false);
}
