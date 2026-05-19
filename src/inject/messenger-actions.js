/* no toasts here on success: focusConversationInput is also called when
   the palette closes (silent intent), and palette `:focus message/search`
   already renders its own output text. failures stay silent too - the
   user can see whether the caret landed in the field. */
function focusConversationInput() {
  const messageInput = findFirstMatchingElement(COMPOSER_INPUT_SELECTORS);
  if (!messageInput) return false;
  messageInput.focus();
  return true;
}

function getSearchInputElement() {
  return findFirstMatchingElement(SEARCH_INPUT_SELECTORS);
}

function focusSearchInput() {
  const searchInput = getSearchInputElement();
  if (!searchInput) return false;
  searchInput.focus();
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

/* called from palette `:unread`, which renders its own output text.
   keeping a toast here would duplicate it - the palette stays visible
   longer than the 1.6s toast and is the better feedback surface. */
function openFirstUnreadThread() {
  const candidates = document.querySelectorAll('[aria-label], [role="row"], a[role="link"]');
  for (const element of candidates) {
    const label = element.getAttribute('aria-label') ?? element.textContent ?? '';
    if (/unread/i.test(label)) {
      element.click();
      return true;
    }
  }
  return false;
}

/* keyboard cursor through the chat list (vim-style j/k). state lives
   here rather than on a DOM attribute alone because fb's virtualised
   chat list re-renders rows on scroll and we want the cursor to
   re-anchor on the next match rather than reset to the top each time. */
let chatListCursorRow = null;

function getChatListRows() {
  return Array.from(document.querySelectorAll(
    '[data-tm-chat-list] [role="row"][aria-label], '
    + '[data-tm-chat-list] [role="row"]:has([aria-label])'
  ));
}

function getActiveChatListIndex(rows) {
  if (!chatListCursorRow) return -1;
  if (!document.contains(chatListCursorRow)) return -1;
  return rows.indexOf(chatListCursorRow);
}

function setChatListCursor(row) {
  if (chatListCursorRow && chatListCursorRow !== row) {
    chatListCursorRow.removeAttribute('data-tm-chat-cursor');
  }
  chatListCursorRow = row;
  if (row) {
    row.setAttribute('data-tm-chat-cursor', 'true');
    row.scrollIntoView({ block: 'nearest' });
  }
}

function moveChatListCursor(direction) {
  const rows = getChatListRows();
  if (rows.length === 0) {
    showToast('no chat list');
    return false;
  }
  const currentIndex = getActiveChatListIndex(rows);
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = direction > 0 ? 0 : rows.length - 1;
  } else {
    nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
  }
  setChatListCursor(rows[nextIndex]);
  return true;
}

function openChatListCursorTarget() {
  if (!chatListCursorRow) {
    showToast('no chat selected');
    return false;
  }
  /* prefer clicking the inner [role='link'] when present - the row
     itself sometimes intercepts clicks without navigating. */
  const link = chatListCursorRow.querySelector('a[role="link"], [role="link"]');
  (link ?? chatListCursorRow).click();
  return true;
}

/* trigger an action on the currently-cursored chat-list row. fb places
   pin / mark-unread / mute buttons inside the row as hover-revealed
   children; we click them by aria-label match. when fb has collapsed
   them into a "More" overflow menu, we open that menu first and then
   click the action in the menu - simpler approaches missed actions
   that aren't direct row children. returns true on success. */
function triggerChatRowAction(actionPattern, friendlyName) {
  if (!chatListCursorRow) {
    showToast('no chat selected (try j/k first)');
    return false;
  }
  const direct = findActionButtonInScope(chatListCursorRow, actionPattern);
  if (direct) {
    direct.click();
    showToast(`${friendlyName} applied`);
    return true;
  }
  const more = chatListCursorRow.querySelector('[aria-label*="More" i][role="button"]');
  if (!more) {
    showToast(`${friendlyName}: action not visible`);
    return false;
  }
  more.click();
  /* fb mounts the menu asynchronously; poll briefly for it. */
  let attempts = 0;
  const poll = setInterval(() => {
    attempts += 1;
    const menu = document.querySelector('[role="menu"]:not([data-tm-handled])');
    if (menu) {
      menu.setAttribute('data-tm-handled', 'true');
      const action = findActionButtonInScope(menu, actionPattern);
      if (action) {
        action.click();
        showToast(`${friendlyName} applied`);
      } else {
        showToast(`${friendlyName}: not in menu`);
      }
      menu.removeAttribute('data-tm-handled');
      clearInterval(poll);
      return;
    }
    if (attempts >= 10) clearInterval(poll);
  }, 60);
  return true;
}

function findActionButtonInScope(scope, pattern) {
  const candidates = scope.querySelectorAll('[role="button"], [role="menuitem"], button');
  for (const candidate of candidates) {
    const label = (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim();
    if (pattern.test(label)) return candidate;
  }
  return null;
}

function pinCursoredChat() {
  return triggerChatRowAction(/^pin\b|^unpin\b/i, 'pin');
}

function markCursoredChatUnread() {
  return triggerChatRowAction(/mark as unread|mark unread/i, 'mark-unread');
}

function muteCursoredChat() {
  return triggerChatRowAction(/^mute\b|^unmute\b/i, 'mute');
}

function scrollLogToTop() {
  const log = document.querySelector('[role="log"], [data-tm-thread]');
  if (!log) {
    showToast('no log');
    return false;
  }
  log.scrollTop = 0;
  showToast('scrolled=top');
  return true;
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
