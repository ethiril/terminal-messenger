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

/* fb wraps message bubbles in elements that carry inline
   onmousedown="return false" / ondragstart="return false" handlers.
   inline `return false` calls into the engine's preventDefault path,
   which on chromium can bypass our Event.prototype.preventDefault
   monkey-patch (the binding sets defaultPrevented through the C++
   side without re-entering JS). stripping the attributes + nulling
   the matching DOM-level handler properties is the only fully
   reliable way to keep drag-selection alive on bubbles.

   no WeakSet cache: fb re-renders bubbles and may re-install the
   handlers, so each apply pass has to re-check. queries are gated by
   attribute selectors so they only walk elements that still need
   stripping - cheap even on big threads. */
function unblockSelectionOnMessages() {
  const ROOT_SELECTOR =
    "[role='log'], [data-tm-thread], [aria-label*='Messages in conversation']";
  const BLOCKER_SELECTOR =
    '[onmousedown], [onselectstart], [ondragstart], [unselectable]';

  const stripBlockers = (element) => {
    element.onmousedown = null;
    element.onselectstart = null;
    element.ondragstart = null;
    element.removeAttribute('onmousedown');
    element.removeAttribute('onselectstart');
    element.removeAttribute('ondragstart');
    element.removeAttribute('unselectable');
  };

  document.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
    if (root.matches(BLOCKER_SELECTOR)) stripBlockers(root);
    root.querySelectorAll(BLOCKER_SELECTOR).forEach(stripBlockers);
  });
}
