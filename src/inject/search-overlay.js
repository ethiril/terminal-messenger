const SEARCH_OVERLAY_ID = 'tm-search-root';
const SEARCH_RESULT_LIMIT = 12;
const SEARCH_LABEL_TRIM = 80;
const SEARCH_TOAST_TRIM = 30;

function appendSearchHintRow(resultsElement, hintMessage) {
  const hintItem = document.createElement('li');
  hintItem.className = 'tm-search-hint';
  hintItem.textContent = hintMessage;
  resultsElement.appendChild(hintItem);
}

function findChatMatchesForQuery(lowercaseQuery) {
  /* SEARCHABLE_ROW_SELECTOR matches [role="row"], [role="listitem"] and
     a[role="link"]. a single chat list row often contains a nested link
     element, so the same chat shows up twice (once for the row, once for the
     link). dedupe by normalised label and skip ancestors whose descendant we
     already accepted - keep the deepest match because it's the one that
     navigates correctly when clicked. */
  const matches = [];
  const seenLabels = new Set();
  const candidateRows = document.querySelectorAll(SEARCHABLE_ROW_SELECTOR);
  for (const candidate of candidateRows) {
    const label = (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim();
    if (!label || !label.toLowerCase().includes(lowercaseQuery)) continue;
    const normalisedLabel = label.toLowerCase();
    if (seenLabels.has(normalisedLabel)) continue;
    seenLabels.add(normalisedLabel);
    matches.push({ label, target: candidate });
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
  const searchRoot = document.getElementById(SEARCH_OVERLAY_ID);
  if (!searchRoot) return;

  const resultsElement = searchRoot.querySelector('.tm-search-results');
  resultsElement.replaceChildren();

  const trimmedQuery = queryText.trim();
  if (!trimmedQuery) {
    appendSearchHintRow(resultsElement, 'type to search chats…');
    return;
  }

  const matchedResults = findChatMatchesForQuery(trimmedQuery.toLowerCase());

  if (matchedResults.length === 0) {
    appendSearchHintRow(resultsElement, 'no matches');
    return;
  }

  matchedResults.forEach((result, index) => {
    const resultItem = document.createElement('li');
    resultItem.className = 'tm-search-result';
    resultItem.setAttribute('data-tm-result-index', String(index));
    resultItem.textContent = result.label.slice(0, SEARCH_LABEL_TRIM);
    resultItem.addEventListener('click', () => {
      result.target.click();
      showToast(`opened: ${result.label.slice(0, SEARCH_TOAST_TRIM)}`);
      closeSearchOverlay();
    });
    resultsElement.appendChild(resultItem);
  });
}

function openSearchOverlay(seedValue = '') {
  const searchRoot = ensureSearchOverlay();
  searchRoot.classList.add('tm-search-open');

  const inputElement = searchRoot.querySelector('.tm-search-input');
  if (!inputElement) return;

  inputElement.value = seedValue;
  refreshSearchResults(seedValue);
  requestAnimationFrame(() => inputElement.focus());
}

function closeSearchOverlay() {
  const searchRoot = document.getElementById(SEARCH_OVERLAY_ID);
  searchRoot?.classList.remove('tm-search-open');
}
