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
  writeQueryIntoReactInput(searchInput, queryText);
  showToast(`search: ${queryText || '(empty)'}`);
  return true;
}

/* fb's search box is a React controlled input. React keeps its own record of
   the last value it wrote to the node, and assigning `.value` directly leaves
   that record untouched - so React reads the subsequent input event as "no
   change" and fb never runs the search. verified live: the old direct
   assignment put the text on screen and produced zero result rows.
   write through the native prototype setter instead, which the tracker's
   instance-level override doesn't intercept. */
function writeQueryIntoReactInput(inputElement, queryText) {
  if ('value' in inputElement) {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(inputElement), 'value'
    )?.set;
    if (!nativeValueSetter) {
      inputElement.value = queryText;
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    /* clear first: re-running the same query would otherwise write an
       identical value, which React correctly ignores as a non-change. */
    nativeValueSetter.call(inputElement, '');
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    nativeValueSetter.call(inputElement, queryText);
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  /* contenteditable build: insertText fires beforeinput/input the way
     Lexical expects - the same approach shell/application-menu.js uses for
     paste. select the existing contents so we replace rather than append. */
  const contentRange = document.createRange();
  contentRange.selectNodeContents(inputElement);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(contentRange);
  document.execCommand('insertText', false, queryText);
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

/* clicking a chat row with the mouse leaves the keyboard cursor's box
   stranded on whatever row j/k last touched - the user reads it as a
   highlight they can't dismiss. on any pointerdown inside the chat list,
   drop the visual cursor and silently re-anchor to the clicked row so a
   later j/k continues from where the mouse left off rather than the top. */
let chatListCursorReleaseBound = false;
function bindChatListCursorRelease() {
  if (chatListCursorReleaseBound) return;
  chatListCursorReleaseBound = true;
  document.addEventListener('pointerdown', (event) => {
    if (!chatListCursorRow) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-tm-chat-list]')) return;
    chatListCursorRow.removeAttribute('data-tm-chat-cursor');
    const clickedRow = target.closest('[data-tm-chat-list] [role="row"]');
    chatListCursorRow = clickedRow ?? null;
  }, true);
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
  /* fb's virtualised list can detach the cursored row between the j/k
     move and the Enter press - clicking a detached node silently no-ops,
     which reads as "Enter is broken". surface it instead. */
  if (!chatListCursorRow || !document.contains(chatListCursorRow)) {
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
    const menu = document.querySelector('[role="menu"]');
    if (menu) {
      clearInterval(poll);
      const action = findActionButtonInScope(menu, actionPattern);
      if (action) {
        action.click();
        showToast(`${friendlyName} applied`);
        return;
      }
      /* clicking the action dismisses the menu for us; when we can't find it
         the menu would otherwise sit open over the chat list. */
      showToast(`${friendlyName}: not in menu`);
      dismissOpenMenu(menu);
      return;
    }
    if (attempts >= 10) clearInterval(poll);
  }, 60);
  return true;
}

/* fb closes its menus on Escape; dispatch it at the menu itself so the
   handler fb attached to the menu (or a document-level one) both see it. */
function dismissOpenMenu(menu) {
  const escapeInit = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
  menu.dispatchEvent(new KeyboardEvent('keydown', escapeInit));
  menu.dispatchEvent(new KeyboardEvent('keyup', escapeInit));
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

/* silent for the same reason as scrollLogToBottom - see the note there. */
function scrollLogToTop() {
  const log = document.querySelector('[role="log"], [data-tm-thread]');
  if (!log) return false;
  log.scrollTop = 0;
  return true;
}

/* scoped to the chat list, then fb's search-results dropdown. a
   document-wide SEARCHABLE_ROW_SELECTOR sweep used to reach message rows and
   unrelated links, so `:goto sara` could click a link inside a message that
   merely mentioned the name. */
function gotoChatByName(searchTerm) {
  if (!searchTerm) {
    showToast('usage: :goto <name>');
    return false;
  }
  const lowercaseSearch = searchTerm.toLowerCase();
  for (const row of collectGotoCandidateRows()) {
    const label = row.getAttribute('aria-label') ?? row.textContent ?? '';
    if (!label.toLowerCase().includes(lowercaseSearch)) continue;
    /* prefer the inner link: outer rows sometimes swallow the click
       without navigating (see openChatListCursorTarget). */
    (row.querySelector('a[role="link"], [role="link"]') ?? row).click();
    showToast(`opened: ${label.slice(0, 30)}`);
    return true;
  }
  showToast(`no chat matching "${searchTerm}"`);
  return false;
}

/* chat-list rows first, then the tagged search-results dropdown, so an open
   dropdown never outranks a chat the user already has in the sidebar.
   tagChatSearchResults marks both the results container and the individual
   result links, so a scope can itself be a candidate row. */
function collectGotoCandidateRows() {
  const rows = [];
  const scopes = [
    ...document.querySelectorAll('[data-tm-chat-list]'),
    ...document.querySelectorAll('[data-tm-search-results]')
  ];
  for (const scope of scopes) {
    if (scope.matches(SEARCHABLE_ROW_SELECTOR)) rows.push(scope);
    rows.push(...scope.querySelectorAll(SEARCHABLE_ROW_SELECTOR));
  }
  return rows;
}
