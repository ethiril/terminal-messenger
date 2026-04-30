function focusConversationInput() {
  const messageInput = findFirstMatchingElement(COMPOSER_INPUT_SELECTORS);
  if (!messageInput) {
    showToast('message input not found');
    return false;
  }
  messageInput.focus();
  showToast('focused=message');
  return true;
}

function getSearchInputElement() {
  return findFirstMatchingElement(SEARCH_INPUT_SELECTORS);
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

function gotoChatByName(searchTerm) {
  if (!searchTerm) {
    showToast('usage: :goto <name>');
    return false;
  }
  const lowercaseSearch = searchTerm.toLowerCase();
  const candidateRows = document.querySelectorAll(SEARCHABLE_ROW_SELECTOR);
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
