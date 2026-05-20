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

/* belt-and-braces companion to preload.js installClipboardUnblocker:
   strips any inline on{paste,copy,cut} handlers fb might attach to a
   freshly-rendered composer/input. the preload listener handles the
   addEventListener-style blockers; this handles the inline-attribute
   path, which propagation control can't reach. */
const pasteUnblockedElements = new WeakSet();

function unblockPasteOnInputs() {
  document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]').forEach((element) => {
    if (pasteUnblockedElements.has(element)) return;
    pasteUnblockedElements.add(element);

    element.onpaste = null;
    element.oncopy = null;
    element.oncut = null;
    element.removeAttribute('onpaste');
    element.removeAttribute('oncopy');
    element.removeAttribute('oncut');
  });
}
