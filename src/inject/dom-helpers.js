function findFirstMatchingElement(selectorList) {
  return document.querySelector(selectorList.join(','));
}

function isUserTypingInto(eventTarget) {
  if (!eventTarget) return false;
  return eventTarget.tagName === 'INPUT'
    || eventTarget.tagName === 'TEXTAREA'
    || eventTarget.isContentEditable === true;
}

function collectDirectText(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim();
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

/* fb attaches paste/copy/cut blockers to the composer; users want their own
   clipboard back. WeakSet keeps re-runs across mutations cheap. */
const pasteUnblockedElements = new WeakSet();

function unblockPasteOnInputs() {
  /* include contenteditable: the message composer is a contenteditable,
     and fb sometimes attaches paste blockers there too. without this,
     pasting into the very field where you most want to paste is blocked. */
  document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]').forEach((element) => {
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
