function inferMessageDirection(messageRow) {
  const ariaLabel = messageRow.getAttribute('aria-label') ?? '';
  /* fb formats outgoing aria-labels in several variants depending on type:
     "At <time>, You: <text>" (text message), "You sent a <thing>" (media),
     "Enter, Message sent <time> by You: <text>" (button-style activator).
     incoming labels lead with the sender's name. catch all the "You" forms
     including "by You" so text messages don't fall through to position
     detection (where they sometimes get misclassified). */
  if (/\byou sent\b|\byou said\b|\bYou:\s|\bby You\b|\boutgoing\b/i.test(ariaLabel)) return 'out';

  /* fb sometimes hangs the outgoing-direction signal off a descendant
     (the bubble's clickable wrapper carries an aria-label like
     "Enter, Message sent <time> by You: ..."). check those before falling
     back to geometry. */
  const ownedYouLabel = messageRow.querySelector(
    '[aria-label*="by You" i], [aria-label*="You sent" i], [aria-label*=" You:" i]'
  );
  if (ownedYouLabel) return 'out';

  const rowRect = messageRow.getBoundingClientRect();
  if (rowRect.width === 0) return null;

  /* :scope > div used to be the bubble in older layouts, but in this build
     the first child is a header/h3 that spans the full row and would always
     classify as "centered" (i.e. incoming). prefer a presentation element
     narrower than 90% of the row - that's the actual bubble. */
  let bubbleRect = null;
  const candidates = messageRow.querySelectorAll(':scope [role="presentation"]');
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width >= rowRect.width * 0.9) continue;
    bubbleRect = rect;
    break;
  }
  if (!bubbleRect) {
    const fallback = messageRow.querySelector(':scope > div, :scope > [role="gridcell"]');
    if (!fallback) return null;
    bubbleRect = fallback.getBoundingClientRect();
    if (bubbleRect.width === 0) return null;
  }

  const rowCenter = rowRect.left + rowRect.width / 2;
  const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
  return bubbleCenter > rowCenter + OUTGOING_BUBBLE_OFFSET_PX ? 'out' : 'in';
}

/* fb has shipped two layouts: an older one where each message sits in
   [role='row'] and a newer one where it sits in [role='article'] with
   [aria-roledescription='message']. tag both so direction-scoped CSS works
   regardless of which build the user is on. */
function tagMessageDirections() {
  const messageRows = document.querySelectorAll(
    '[role="log"] [role="row"]:not([data-tm-direction]),'
    + '[role="log"] [aria-roledescription="message"]:not([data-tm-direction]),'
    + '[data-tm-thread] [aria-roledescription="message"]:not([data-tm-direction])'
  );
  for (const messageRow of messageRows) {
    const direction = inferMessageDirection(messageRow);
    if (direction) messageRow.setAttribute('data-tm-direction', direction);
  }
}

function tagSmallLogImages() {
  /* both scopes: current e2ee threads render without [role='log'], and an
     untagged image never qualifies for the media viewer's click handler
     (isClickableLogImage requires data-tm-img-size='large'). */
  const candidateImages = document.querySelectorAll(
    '[role="log"] img:not([data-tm-img-size]),'
    + ' [data-tm-thread] img:not([data-tm-img-size])'
  );
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

/* boundaries we never cross when walking up from the img - hitting one of
   these means we've reached the message row, and collapsing past it would
   hide unrelated content (sender, timestamp, reply quote, etc.). */
const IMAGE_WRAPPER_BOUNDARY_SELECTOR =
  '[role="row"], [role="article"], [aria-roledescription="message"],'
  + ' [data-tm-direction], [data-tm-has-reply]';

/* a sibling counts as "meaningful" - and blocks the walk - if it contains
   visible text or a separate media unit (img/svg/iframe). structural-only
   divs (positioning helpers, hover overlays) are safe to pass.

   video/canvas/picture are deliberately NOT blocking: fb renders GIFs as
   an <img> poster + an overlaid <video> sibling in the same slot, so we
   need to walk past the video sibling to reach the slot-keeping wrapper
   above. img/svg stay blocking because separate <img> siblings represent
   distinct media units (carousels, reactions) we shouldn't unify. */
function hasMeaningfulContent(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.hasAttribute('data-tm-img-collapse-toggle')) return false;
  const text = element.textContent;
  if (text && text.trim().length > 0) return true;
  if (element.matches('img, svg, iframe')) return true;
  if (element.querySelector('img, svg, iframe')) return true;
  return false;
}

/* a "slot keeper" is an ancestor with inline sizing that holds the image's
   layout box open even after the <img> is hidden - aspect-ratio, percentage
   padding-top/bottom (the classic aspect-ratio hack), or fixed/min height.
   we detect those via inline style only since computed styles resolve all
   units to px and lose the distinguishing signal. */
function isImageSlotKeeper(element) {
  if (!element || !element.style) return false;
  const style = element.style;
  if (style.aspectRatio && style.aspectRatio !== 'auto' && style.aspectRatio !== '') return true;
  if (style.paddingTop && /%$/.test(style.paddingTop)) return true;
  if (style.paddingBottom && /%$/.test(style.paddingBottom)) return true;
  if (style.height && style.height !== 'auto' && style.height !== '0px' && style.height !== '') return true;
  if (style.minHeight && style.minHeight !== '0' && style.minHeight !== '0px' && style.minHeight !== '') return true;
  return false;
}

/* walk up from the img collecting the highest slot-keeping ancestor whose
   siblings are all structural-only (no text, no other media). that's the
   element we'll hide - hiding only the <img> leaves any aspect-ratio
   ancestor occupying its full slot. cap at the message-row boundary so we
   never hide unrelated content (sender, timestamp, reply quote). */
function findImageWrapper(img) {
  let node = img;
  let lastSlotKeeper = null;
  while (node.parentElement && !node.parentElement.matches(IMAGE_WRAPPER_BOUNDARY_SELECTOR)) {
    const parent = node.parentElement;
    let blocked = false;
    for (const child of parent.childNodes) {
      if (child === node) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent && child.textContent.trim().length > 0) {
          blocked = true;
          break;
        }
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE && hasMeaningfulContent(child)) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    if (isImageSlotKeeper(parent)) lastSlotKeeper = parent;
    node = parent;
  }
  return lastSlotKeeper || node;
}

/* per-img toggle handle, used as the idempotency check on each mutation
   pass. WeakMap so a removed <img> is gc'd along with its toggle ref. */
const imageCollapseTogglesByImg = new WeakMap();
/* toggle -> wrapper ref so the click handler doesn't depend on DOM
   adjacency (fb's reconciliation can insert siblings between the toggle
   and the wrapper, breaking nextElementSibling lookup). */
const wrappersByToggle = new WeakMap();

/* fb's reconciliation can empty or replace the wrapper a toggle was
   inserted for (subtree re-render moves the img elsewhere; a fresh toggle
   is then inserted at the new wrapper). the old toggle survives as an
   orphan in a full-width parent and renders at the row's leading edge as
   a duplicate "[-] image". a toggle is live only while its bound wrapper
   still holds a large (or not-yet-sized) img or a video; anything else
   gets removed, and so does any second toggle bound to the same wrapper. */
function sweepStaleImageToggles() {
  const seenWrappers = new Set();
  for (const toggle of document.querySelectorAll('[data-tm-img-collapse-toggle]')) {
    let wrapper = wrappersByToggle.get(toggle);
    if (!wrapper || !wrapper.isConnected) wrapper = toggle.nextElementSibling;
    const holdsMedia = Boolean(wrapper && wrapper.nodeType === Node.ELEMENT_NODE && (
      wrapper.matches('img:not([data-tm-img-size="small"]), video')
      || wrapper.querySelector('img:not([data-tm-img-size="small"]), video')
    ));
    if (!holdsMedia || seenWrappers.has(wrapper)) {
      toggle.remove();
      continue;
    }
    seenWrappers.add(wrapper);
  }
}

/* insert a small terminal-style toggle immediately before each large chat
   image's wrapper so the user can collapse images (slot included) without
   losing the message context. idempotency: a WeakMap binds each <img> to
   its toggle - if the toggle is still .isConnected we skip; otherwise (fb
   reconciliation stripped it) we re-insert at the now-current wrapper.

   skipped scopes: reply-quote thumbnails (the toggle would dwarf the
   ~80px preview), reaction badges, and any image inside a dialog/menu/
   sidebar (those aren't user-shared photos in the conversation).

   for multi-image bubbles fb almost always wraps each img in its own
   slot-keeping ancestor, so findImageWrapper returns a separate wrapper
   per img and each gets its own toggle. when fb does collapse multiple
   imgs into a shared wrapper, the Map below dedupes so only one toggle
   is emitted. label reads "video" for video posters (the click promotes
   the underlying <video> into the viewer) and "image" otherwise. */
function tagImageCollapseToggles() {
  sweepStaleImageToggles();

  const candidateImages = document.querySelectorAll(
    '[role="log"] img[data-tm-img-size="large"],'
    + ' [data-tm-thread] img[data-tm-img-size="large"]'
  );

  const wrapperGroups = new Map();
  for (const img of candidateImages) {
    if (img.closest('[data-tm-has-reply], [data-tm-reply-quote]')) continue;
    if (isInsideReactionContainer(img)) continue;
    if (img.closest('[role="dialog"], [aria-modal="true"], [role="menu"], [data-tm-chat-list]')) continue;

    const wrapper = findImageWrapper(img);
    if (!wrapper.parentNode) continue;

    const existing = wrapperGroups.get(wrapper);
    if (existing) {
      existing.imgs.push(img);
    } else {
      wrapperGroups.set(wrapper, { imgs: [img], isVideoPoster: Boolean(findVideoForPosterImage(img)) });
    }
  }

  /* drop wrappers nested inside other wrappers in the same pass - fb sometimes
     renders an image with multiple <img> elements at different DOM depths (e.g.
     a blurhash placeholder + the real photo), and findImageWrapper can land
     them on different slot-keepers where one ancestors the other. without this
     each one gets its own toggle, producing the duplicate "[-] image" visible
     to the user. keep only the outermost wrapper per logical image. */
  const wrappers = [...wrapperGroups.keys()];
  for (const wrapper of wrappers) {
    for (const other of wrappers) {
      if (other === wrapper) continue;
      if (other.contains(wrapper)) {
        wrapperGroups.delete(wrapper);
        break;
      }
    }
  }

  /* same dedupe for the sibling-level variant: placeholder + real photo can
     land in two non-nested wrappers occupying the same slot. two wrappers
     whose rects overlap almost entirely are one logical image - keep the
     larger. genuinely distinct images (albums, stacks) never overlap. */
  const remaining = [...wrapperGroups.keys()].filter((wrapper) => wrapperGroups.has(wrapper));
  for (const wrapper of remaining) {
    if (!wrapperGroups.has(wrapper)) continue;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; /* collapsed - leave alone */
    for (const other of remaining) {
      if (other === wrapper || !wrapperGroups.has(other) || !wrapperGroups.has(wrapper)) continue;
      const otherRect = other.getBoundingClientRect();
      if (otherRect.width === 0 || otherRect.height === 0) continue;
      const overlapW = Math.min(rect.right, otherRect.right) - Math.max(rect.left, otherRect.left);
      const overlapH = Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top);
      if (overlapW <= 0 || overlapH <= 0) continue;
      const overlapArea = overlapW * overlapH;
      const smallerArea = Math.min(rect.width * rect.height, otherRect.width * otherRect.height);
      if (overlapArea < smallerArea * 0.8) continue;
      const loser = rect.width * rect.height >= otherRect.width * otherRect.height ? other : wrapper;
      wrapperGroups.delete(loser);
    }
  }

  for (const [wrapper, group] of wrapperGroups) {
    const firstImg = group.imgs[0];
    const existingToggle = imageCollapseTogglesByImg.get(firstImg);
    if (existingToggle && existingToggle.isConnected) continue;

    const wrapperParent = wrapper.parentNode;
    if (!wrapperParent) continue;

    const isCollapsed = wrapper.getAttribute('data-tm-img-wrapper-collapsed') === 'true'
      || firstImg.getAttribute('data-tm-img-collapsed') === 'true';
    const mediaKind = group.isVideoPoster ? 'video' : 'image';

    /* reuse an adjacent orphan toggle instead of stacking a new one. when fb
       swaps the <img> during a subtree re-render, our per-img WeakMap misses
       the fresh element and the previously inserted toggle survives as the
       wrapper's previous sibling - inserting again would produce two toggles
       for the same image. rebinding keeps the count at one. */
    const adjacent = wrapper.previousElementSibling;
    let toggle;
    if (adjacent && adjacent.matches('[data-tm-img-collapse-toggle]')) {
      toggle = adjacent;
      toggle.setAttribute('data-tm-img-collapse-kind', mediaKind);
      applyImageCollapseToggleState(toggle, isCollapsed);
    } else {
      toggle = buildImageCollapseToggle(isCollapsed, mediaKind);
      wrapperParent.insertBefore(toggle, wrapper);
    }
    wrappersByToggle.set(toggle, wrapper);
    for (const img of group.imgs) imageCollapseTogglesByImg.set(img, toggle);
  }
}

function buildImageCollapseToggle(isCollapsed, mediaKind = 'image') {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('data-tm-img-collapse-toggle', 'true');
  toggle.setAttribute('data-tm-img-collapse-kind', mediaKind);
  applyImageCollapseToggleState(toggle, isCollapsed);
  return toggle;
}

function applyImageCollapseToggleState(toggle, isCollapsed) {
  const mediaKind = toggle.getAttribute('data-tm-img-collapse-kind') || 'image';
  toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  toggle.setAttribute('aria-label', isCollapsed ? `show ${mediaKind}` : `hide ${mediaKind}`);
  toggle.textContent = '';
  const indicator = document.createElement('span');
  indicator.className = 'tm-img-toggle-indicator';
  indicator.textContent = isCollapsed ? '[+]' : '[-]';
  const label = document.createElement('span');
  label.className = 'tm-img-toggle-label';
  label.textContent = isCollapsed ? `${mediaKind} hidden` : mediaKind;
  toggle.append(indicator, label);
}

function handleImageCollapseClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const toggle = target.closest('[data-tm-img-collapse-toggle]');
  if (!toggle) return;
  /* stopImmediatePropagation so the media-viewer's document-level click
     handler (also capture phase) can't pick this click up as anything
     else, and fb's own bubble click handlers stay quiet too. */
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  /* wrapper ref is stored at insertion time. fall back to nextElementSibling
     only if the ref is missing or detached (e.g. user re-loaded into the
     same page and the WeakMap is fresh but the DOM is reused). */
  let wrapper = wrappersByToggle.get(toggle);
  if (!wrapper || !wrapper.isConnected) wrapper = toggle.nextElementSibling;
  if (!wrapper) return;
  const img = wrapper.tagName === 'IMG' ? wrapper : wrapper.querySelector('img');
  if (!img) return;

  const isNowCollapsed = wrapper.getAttribute('data-tm-img-wrapper-collapsed') !== 'true';
  if (isNowCollapsed) {
    wrapper.setAttribute('data-tm-img-wrapper-collapsed', 'true');
    /* collapse every img the toggle covers (multi-image stacks) so the
       individual img-level state stays in sync with the wrapper. */
    for (const innerImg of wrapper.querySelectorAll('img')) {
      innerImg.setAttribute('data-tm-img-collapsed', 'true');
    }
    img.setAttribute('data-tm-img-collapsed', 'true');
  } else {
    wrapper.removeAttribute('data-tm-img-wrapper-collapsed');
    for (const innerImg of wrapper.querySelectorAll('img')) {
      innerImg.removeAttribute('data-tm-img-collapsed');
    }
    img.removeAttribute('data-tm-img-collapsed');
  }
  applyImageCollapseToggleState(toggle, isNowCollapsed);
}

let imageCollapseHandlerBound = false;
function bindImageCollapseHandler() {
  if (imageCollapseHandlerBound) return;
  imageCollapseHandlerBound = true;
  document.addEventListener('click', handleImageCollapseClick, true);
}

function isActionButtonLabel(label) {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (REACTION_BADGE_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return ACTION_BUTTON_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function tagActionButtons() {
  const candidates = document.querySelectorAll(
    '[role="log"] [role="row"] [role="button"], '
    + '[role="log"] [role="row"] button, '
    + '[role="log"] [aria-roledescription="message"] [role="button"], '
    + '[role="log"] [aria-roledescription="message"] button, '
    + '[data-tm-thread] [role="row"] [role="button"], '
    + '[data-tm-thread] [role="row"] button, '
    + '[data-tm-thread] [aria-roledescription="message"] [role="button"], '
    + '[data-tm-thread] [aria-roledescription="message"] button'
  );
  for (const button of candidates) {
    const label = button.getAttribute('aria-label') ?? '';
    const isReactionBadge = REACTION_BADGE_LABEL_PATTERNS.some((pattern) => pattern.test(label.trim()));

    let shouldTag = false;
    let kind = null;
    if (!isReactionBadge) {
      if (isActionButtonLabel(label)) {
        shouldTag = true;
        kind = deriveActionKind(label);
      } else if (looksLikeIconOnlyAction(button)) {
        /* fallback for buttons whose aria-label fb hides; without this they
           render inline and shake the row on hover */
        shouldTag = true;
        kind = 'more';
      }
    }

    const isTagged = button.hasAttribute('data-tm-action-button');
    if (shouldTag && !isTagged) {
      button.setAttribute('data-tm-action-button', 'true');
      button.setAttribute('data-tm-action-kind', kind);
    } else if (!shouldTag && isTagged) {
      button.removeAttribute('data-tm-action-button');
      button.removeAttribute('data-tm-action-kind');
    }
  }
}

function deriveActionKind(label) {
  const trimmed = label.trim().toLowerCase();
  if (trimmed.startsWith('reply')) return 'reply';
  if (trimmed.startsWith('forward')) return 'forward';
  if (trimmed.startsWith('more') || trimmed.startsWith('message actions')) return 'more';
  return 'react';
}

/* fb wraps message bubbles in role=button for accessibility - the text gate
   excludes those since real action buttons carry icons, not text */
function looksLikeIconOnlyAction(button) {
  if (isInsideReactionContainer(button)) return false;
  /* fb wraps the reply-preview thumbnail in role=button ("Go to replied
     message") - it's a content wrapper, never an action button, and tagging
     it dragged the whole preview into toolbar styling */
  if (button.closest('[data-tm-reply-quote]')) return false;
  const text = (button.textContent ?? '').trim();
  if (text.length > 2) return false;
  if (button.querySelector('svg, i[data-visualcompletion="css-img"]')) return true;
  /* an <img> only counts as an icon when its alt is empty/emoji-sized.
     content images and avatars carry a real alt ("Original image", the
     sender's name) and mark the button as a content wrapper. */
  const img = button.querySelector('img');
  return Boolean(img) && (img.getAttribute('alt') ?? '').trim().length <= 2;
}

/* tag the wrapper only when at least one direct child is a tagged action
   button - prevents tagging reaction-badge wrappers by accident.

   anchored upward from each tagged button: parentElement.parentElement
   covers fb's typical toolbar layout (button > flex-wrap > toolbar), with
   a short bounded walk for variants. previously this scanned every div in
   every row on every apply pass, which dominated CPU on large logs. */
function tagActionToolbarWrappers() {
  /* drop stale wrapper tags whose buttons have since been untagged (e.g.
     the reply-preview wrapper after the content-image exclusion kicked in)
     - unlike buttons, wrappers had no removal path and the tag lingered */
  for (const stale of document.querySelectorAll('[data-tm-action-toolbar]')) {
    if (!hasTaggedActionButtonChild(stale)) {
      stale.removeAttribute('data-tm-action-toolbar');
    }
  }

  const taggedButtons = document.querySelectorAll(
    '[role="log"] [data-tm-action-button], [data-tm-thread] [data-tm-action-button]'
  );
  const seen = new Set();
  for (const button of taggedButtons) {
    let candidate = button.parentElement;
    for (let depth = 0; candidate && depth < 3; depth += 1, candidate = candidate.parentElement) {
      if (seen.has(candidate)) break;
      seen.add(candidate);
      if (candidate.hasAttribute('data-tm-action-toolbar')) break;
      if (!hasTaggedActionButtonChild(candidate)) continue;
      candidate.setAttribute('data-tm-action-toolbar', 'true');
      break;
    }
  }
}

function hasTaggedActionButtonChild(wrapper) {
  for (const child of wrapper.children) {
    if (child.hasAttribute('data-tm-action-button')) return true;
  }
  return false;
}

/* fb wraps the quoted-original preview (text snippet, "Attachment" stub,
   or media thumbnail) in a "Go to replied message" button - the one stable
   anchor that distinguishes the quote from the user's new reply text. */
const REPLY_PREVIEW_ANCHOR_SELECTOR = '[aria-label*="replied message" i]';

/* a tagged quote is legitimate if it holds fb's replied-message anchor
   (the preview) or reads as the short "X replied to Y" hint line. anything
   else - most importantly the response wrapper holding the user's own
   reply text - was tagged by a heuristic that fired before fb finished
   rendering the preview, and must be released for re-tagging. */
function isValidReplyQuote(element) {
  /* the Message-actions toolbar lives only in the response cluster, and it
     is mounted in the DOM permanently (zero-height until hover). a "quote"
     holding one engulfed the user's own reply - anchor or not, release it
     so the toolbar-guarded climb in findReplyPreviewQuote can re-tag just
     the preview. */
  if (element.querySelector('[role="toolbar"]')) return false;
  if (element.querySelector(REPLY_PREVIEW_ANCHOR_SELECTOR)) return true;
  const text = (element.textContent ?? '').trim();
  return REPLY_HINT_PATTERN.test(text) && text.length <= 60;
}

/* locate the quoted-original preview among the hint wrapper's siblings via
   fb's own anchor button. climbs from the anchor up to sibling level, but
   never into a wrapper that also holds the Message-actions toolbar - that
   wrapper is the response cluster and tagging it would dim the user's own
   reply text. */
function findReplyPreviewQuote(replyBlock) {
  const parent = replyBlock.parentElement;
  if (!parent) return null;
  for (const sibling of parent.children) {
    if (sibling === replyBlock) continue;
    const anchor = sibling.querySelector(REPLY_PREVIEW_ANCHOR_SELECTOR);
    if (!anchor) continue;
    let scope = anchor;
    while (scope.parentElement && scope.parentElement !== parent) {
      const above = scope.parentElement;
      if (above.querySelector('[role="toolbar"]')) break;
      scope = above;
    }
    return scope;
  }
  return null;
}

/* idempotency check via "row already contains a tagged quote" rather than a
   scan flag: scan flags lock rows out of re-tagging when the row was first
   observed before fb finished rendering the hint text */
function tagReplyQuotes() {
  const rows = document.querySelectorAll(
    '[role="log"] [role="row"],'
    + '[role="log"] [aria-roledescription="message"],'
    + '[data-tm-thread] [role="row"],'
    + '[data-tm-thread] [aria-roledescription="message"]'
  );
  for (const row of rows) {
    let existingQuote = row.querySelector('[data-tm-reply-quote]');
    const rowAnchor = row.querySelector(REPLY_PREVIEW_ANCHOR_SELECTOR);
    if (existingQuote && rowAnchor) {
      /* self-repair: an early pass can tag the response wrapper as the
         quote (fb renders the preview text asynchronously; see the walk
         below). once fb's replied-message anchor is present we can tell
         quote from response - drop every mis-tag, then make sure the
         actual preview carries the tag (releasing a mis-tag can leave
         only the hint wrapper tagged, and the "row already has a quote"
         check would otherwise lock the preview out forever). */
      for (const quote of row.querySelectorAll('[data-tm-reply-quote]')) {
        if (!isValidReplyQuote(quote)) quote.removeAttribute('data-tm-reply-quote');
      }
      const previewTagged = [...row.querySelectorAll('[data-tm-reply-quote]')]
        .some((quote) => quote.contains(rowAnchor));
      if (!previewTagged) {
        const hintQuote = row.querySelector('[data-tm-reply-quote]');
        const preview = hintQuote ? findReplyPreviewQuote(hintQuote) : null;
        if (preview) preview.setAttribute('data-tm-reply-quote', 'true');
      }
      existingQuote = row.querySelector('[data-tm-reply-quote]');
    }
    if (existingQuote) {
      /* re-run on every pass, not just at tag time: fb re-renders the
         response subtree in place, replacing the tagged elements. both
         the hint wrapper and the media preview carry the quote tag, so
         select the media-carrying one specifically. */
      const mediaQuote = row.querySelector(
        '[data-tm-reply-quote]:has(img), [data-tm-reply-quote]:has(video), [data-tm-reply-quote]:has(picture)'
      );
      if (mediaQuote) restructureMediaReply(mediaQuote);
      continue;
    }

    const hintElement = findReplyHintElement(row);
    if (!hintElement) continue;

    row.setAttribute('data-tm-has-reply', 'true');

    const replyBlock = climbToReplyBlock(hintElement, row);
    if (!replyBlock) continue;
    replyBlock.setAttribute('data-tm-reply-quote', 'true');

    /* when the climb stopped at a wrapper that contains only the hint
       (because the original-message preview lives as a sibling to that
       wrapper rather than inside it), also tag the sibling that holds
       the quoted message. without this, only the small "Ev replied to
       you" line dimmed and the quoted body kept reading as full-strength
       message text.

       reply-to-image quotes have no text content (the preview is a bare
       <img>/<video>), so a text-only check skipped past the actual quote
       sibling and engulfed the response wrapper - which contains the
       sender avatar plus the new reply text - dimming the user's own
       words. take the first sibling that looks like a quote: media-only
       (has an image-grade <img>/<video>/<picture>) wins over text. fall
       back to text only when no media-only sibling exists. */
    const blockText = (replyBlock.textContent ?? '').trim();
    const hintText = (hintElement.textContent ?? '').trim();
    if (blockText.length > hintText.length + 4) continue;

    /* preferred path: fb's own replied-message anchor marks the preview
       unambiguously - no text/media heuristics needed. */
    const preview = findReplyPreviewQuote(replyBlock);
    if (preview) {
      preview.setAttribute('data-tm-reply-quote', 'true');
      if (preview.querySelector('img[data-tm-img-size="large"], video, picture')) {
        restructureMediaReply(preview);
      }
      continue;
    }

    /* fallback for builds/moments without the anchor button. */
    let mediaQuote = null;
    let textQuote = null;
    let candidate = replyBlock.nextElementSibling;
    while (candidate) {
      const candidateText = (candidate.textContent ?? '').trim();
      const looksLikeNewMessage = candidateText.length >= 4
        && !REPLY_HINT_PATTERN.test(candidateText);
      const hasContentMedia = candidate.querySelector(
        'img[data-tm-img-size="large"], video, picture'
      );
      /* fb only ever places the sender avatar inside the response
         wrapper, never inside a quote wrapper. presence of a small img
         lets us reject the response sibling, which the previous "first
         text-bearing sibling" rule kept catching for image replies
         (image quote has no text -> skipped -> response engulfed +
         dimmed alongside the user's actual reply). */
      const hasAvatar = candidate.querySelector('img[data-tm-img-size="small"]');
      /* the Message-actions hover toolbar only ever lives in the response
         cluster - a candidate carrying one is the user's new message, never
         the quote, regardless of what the text heuristics say. */
      const hasActionToolbar = candidate.querySelector('[role="toolbar"]');
      if (hasContentMedia && !hasActionToolbar && candidateText.length < 4) {
        mediaQuote = candidate;
        break;
      }
      if (!mediaQuote && looksLikeNewMessage && !textQuote && !hasAvatar && !hasActionToolbar) {
        textQuote = candidate;
      }
      candidate = candidate.nextElementSibling;
    }
    const quote = mediaQuote ?? textQuote;
    if (quote) {
      quote.setAttribute('data-tm-reply-quote', 'true');
      if (mediaQuote) restructureMediaReply(quote);
    }
  }
}

/* fb positions the response bubble of an image/video reply with an offset
   it computed from ITS OWN measured preview size. under the terminal theme
   the preview renders at a different size (font metrics, stripped chrome),
   so fb's offset lands the reply text overlapping the image's bottom strip
   - and native messenger's opaque bubble that would hide the overlap is
   transparent here. do NOT try to zero fb's margins/transforms wholesale:
   that offset is also what places the text below the preview at all, and
   killing it hid the reply text behind the image entirely. instead measure
   the actual rendered overlap between the media and the reply text and
   push the text down by exactly that amount.

   idempotent by re-measurement: once shifted, the next pass measures no
   overlap and does nothing. if fb re-renders and wipes the inline margin,
   the overlap reappears and gets re-fixed. the dataset accumulator caps
   total adjustment so a pathological layout (e.g. fb re-adding its offset
   on top of ours every frame) can't ratchet the text off the screen. */
/* the response text wrapper lives among the quote's siblings, but its
   position varies by build/direction: sometimes after the media preview,
   sometimes between the hint and the preview. scan ALL siblings for the
   text-bearing one (a forward-only walk missed it in this build). skips
   the hint line, our injected timestamp, and reaction badges - none of
   those are the reply body. */
function findReplyResponseElement(quote) {
  const parent = quote.parentElement;
  if (!parent) return null;
  for (const sibling of parent.children) {
    if (sibling === quote) continue;
    if (sibling.hasAttribute('data-tm-reply-quote')) continue;
    if (sibling.hasAttribute('data-tm-msg-timestamp')) continue;
    if (sibling.hasAttribute('data-tm-action-toolbar')) continue;
    if (/reaction/i.test(sibling.getAttribute('aria-label') ?? '')) continue;
    const text = (sibling.textContent ?? '').trim();
    if (text.length < 1) continue;
    if (REPLY_HINT_PATTERN.test(text)) continue;
    return sibling;
  }
  return null;
}

/* fb lays the preview + reply-text cluster out with offsets computed from
   ITS OWN measured sizes; under the terminal theme those sizes differ, so
   the text landed on the image's bottom strip. nudging individual offsets
   proved unwinnable (clearing them hid the text behind the image; margin
   corrections can ratchet when fb recomputes). instead replace the
   cluster's layout wholesale with a flex column - hint, then preview,
   then reply text - so fb's computed offsets stop mattering.

   the layout is applied as INLINE styles rather than stylesheet rules:
   a CSS attempt at this needed structural selectors (direction ancestor,
   child order) that silently missed in practice - e.g. the cluster parent
   can itself be the [data-tm-direction] element, which a descendant
   selector never matches. closest() includes the element itself, and
   inline !important beats every stylesheet rule, ours or fb's. re-applied
   every pass; setting identical values is a cheap no-op. */
function restructureMediaReply(quote) {
  const media = quote.querySelector('img, video, picture');
  if (!media) return;
  const response = findReplyResponseElement(quote);
  if (!response) return;
  const parent = quote.parentElement;
  if (!parent) return;

  response.setAttribute('data-tm-reply-response', 'true');
  parent.setAttribute('data-tm-media-reply', 'true');

  const direction = parent.closest('[data-tm-direction]')?.getAttribute('data-tm-direction') ?? 'in';
  /* skip identical writes: the mutation observer now watches style
     attributes (to catch fb wiping our inline layout), so an
     unconditional setProperty every pass would re-trigger it forever. */
  const setStyle = (element, property, value) => {
    if (element.style.getPropertyValue(property) === value
      && element.style.getPropertyPriority(property) === 'important') return;
    element.style.setProperty(property, value, 'important');
  };

  setStyle(parent, 'display', 'flex');
  setStyle(parent, 'flex-direction', 'column');
  setStyle(parent, 'align-items', direction === 'out' ? 'flex-end' : 'flex-start');
  setStyle(parent, 'gap', '3px');
  setStyle(parent, 'height', 'auto');
  setStyle(parent, 'min-height', '0');
  setStyle(parent, 'max-height', 'none');

  for (const child of parent.children) {
    /* leave fb's overlay chrome alone: the hover action toolbar and
       reaction badges are absolutely positioned by fb and must NOT be
       pulled into the flex flow - forcing them static + order:0 would pin
       them to the top of the stack, always visible. same skip list as
       findReplyResponseElement above. */
    if (child.hasAttribute('data-tm-action-toolbar')) continue;
    if (/reaction/i.test(child.getAttribute('aria-label') ?? '')) continue;

    /* collapse fb's now-purposeless spacer/offset helpers: with the manual
       layout gone, a child with no text and no visual content is dead
       vertical space in the stack. */
    if (child !== quote && child !== response
      && !(child.textContent ?? '').trim()
      && !child.querySelector('img, video, picture, svg, i[data-visualcompletion="css-img"]')) {
      setStyle(child, 'display', 'none');
      continue;
    }
    /* the response wrapper is the positioning anchor for the absolutely-
       positioned Message-actions toolbar nested inside it (terminal.css) -
       relative behaves identically to static for an un-offset flex child. */
    setStyle(child, 'position', child === response ? 'relative' : 'static');
    setStyle(child, 'transform', 'none');
    setStyle(child, 'margin', '0');
    let order = '0';
    if (child === response) order = '3';
    else if (child === quote) order = '2';
    else if (child.hasAttribute('data-tm-reply-quote')) order = '1'; /* hint wrapper */
    else if (child.hasAttribute('data-tm-msg-timestamp')) order = '4';
    setStyle(child, 'order', order);
  }

  /* fb offsets the reply text again INSIDE the response wrapper (the text
     rendered above its own wrapper's border, and the stray positioning
     kept the wrapper from shrink-wrapping the text). with the wrapper's
     flow position now owned by the flex stack, flattening its subtree is
     safe - computed-style checks so we only write where fb actually
     offsets. */
  setStyle(response, 'height', 'auto');
  for (const node of response.querySelectorAll('*')) {
    /* current fb builds nest the real Message-actions hover toolbar INSIDE
       the response wrapper. flattening it pinned the React/Reply/More
       buttons into the reply bubble's flow, where the bubble backing hid
       them. leave its positioning to fb + the stylesheet (which anchors it
       to the row edge), and strip the static pin a previous pass applied. */
    if (node.closest('[role="toolbar"]')) {
      if (node.style.getPropertyValue('position') === 'static') {
        node.style.removeProperty('position');
      }
      continue;
    }
    const computed = window.getComputedStyle(node);
    if (computed.position !== 'static') setStyle(node, 'position', 'static');
    if (computed.transform !== 'none') setStyle(node, 'transform', 'none');
    if (parseFloat(computed.marginTop) < 0) setStyle(node, 'margin-top', '0');
    if (parseFloat(computed.marginBottom) < 0) setStyle(node, 'margin-bottom', '0');
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

/* climb until the parent has a sibling-of-our-scope with substantial text
   that doesn't match the reply hint - that sibling is the new typed reply
   and we must not engulf it */
function climbToReplyBlock(hintElement, row) {
  let scope = hintElement;
  while (scope.parentElement && scope.parentElement !== row) {
    const parent = scope.parentElement;

    let parentEngulfsNewMessage = false;
    for (const sibling of parent.children) {
      if (sibling === scope) continue;
      const siblingText = (sibling.textContent ?? '').trim();
      if (siblingText.length < 4) continue;
      if (REPLY_HINT_PATTERN.test(siblingText)) continue;
      parentEngulfsNewMessage = true;
      break;
    }
    if (parentEngulfsNewMessage) break;

    scope = parent;
  }
  return scope === hintElement ? scope.parentElement ?? null : scope;
}

/* fb's typing indicator is an animated three-dot SVG inside a small bubble
   that landed in our terminal as a single-character lime swirl. tag the
   container by aria-label or by a no-text bubble whose content is purely
   decorative (img/svg/i without any visible text), so CSS can swap it for
   a literal "..." string. */
function tagTypingIndicators() {
  for (const stale of document.querySelectorAll('[data-tm-typing-indicator]')) {
    if (!isStillTypingIndicator(stale)) {
      stale.removeAttribute('data-tm-typing-indicator');
    }
  }

  /* match only typing-status phrases ("X is typing...", "is writing"), never
     a bare "typing" substring - a user message like "typing now" lands inside
     the row's aria-label and would otherwise get the row swapped for "...". */
  const labelHits = document.querySelectorAll(
    '[role="log"] [aria-label*="is typing" i]:not([data-tm-typing-indicator]),'
    + '[data-tm-thread] [aria-label*="is typing" i]:not([data-tm-typing-indicator]),'
    + '[role="log"] [aria-label*="is writing" i]:not([data-tm-typing-indicator]),'
    + '[data-tm-thread] [aria-label*="is writing" i]:not([data-tm-typing-indicator]),'
    + '[role="log"] [aria-label="Typing indicator" i]:not([data-tm-typing-indicator]),'
    + '[data-tm-thread] [aria-label="Typing indicator" i]:not([data-tm-typing-indicator])'
  );
  for (const hit of labelHits) {
    hit.setAttribute('data-tm-typing-indicator', 'true');
  }

  /* primary fallback for builds without a typing aria-label: in current
     fb messenger the typing bubble renders as
        <div role="presentation">         ← the bubble (50×17ish)
          <div role="list">               ← container of dots
            <div role="listitem"> dot </div>
            <div role="listitem"> dot </div>
            <div role="listitem"> dot </div>
     none of those carry an aria-label or live-region marker, but a no-text
     [role="list"] inside a chat log is essentially unique to this widget
     (real lists carry text; reactions/toolbar use other roles). tag the
     enclosing role="presentation" so our CSS replaces the whole bubble
     with "...", and fall back to the list itself if no presentation
     wrapper is in scope. */
  const dotLists = document.querySelectorAll(
    '[role="log"] [role="list"]:not([data-tm-typing-indicator]),'
    + ' [data-tm-thread] [role="list"]:not([data-tm-typing-indicator])'
  );
  for (const list of dotLists) {
    if ((list.textContent ?? '').trim().length > 0) continue;
    const rect = list.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0 || rect.height > 80) continue;
    const presentationWrapper = list.closest(
      '[role="log"] [role="presentation"], [data-tm-thread] [role="presentation"]'
    );
    const target = presentationWrapper && !presentationWrapper.hasAttribute('data-tm-typing-indicator')
      ? presentationWrapper
      : list;
    target.setAttribute('data-tm-typing-indicator', 'true');
  }

  /* secondary fallback: scan candidates from the bottom of the log for
     no-text rows. covers older / alternative fb builds where the typing
     slot lives in a role="row" or as a direct child of the log without
     the role="list" pattern. */
  const logs = document.querySelectorAll('[role="log"], [data-tm-thread]');
  for (const log of logs) {
    const candidates = collectTypingIndicatorCandidates(log);
    for (const candidate of candidates) {
      if (candidate.hasAttribute('data-tm-typing-indicator')) continue;
      if ((candidate.textContent ?? '').trim().length > 0) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.height === 0 || rect.height > 80) continue;
      if (rect.width === 0) continue;
      candidate.setAttribute('data-tm-typing-indicator', 'true');
    }
  }

  /* third pass for builds where the indicator is a sibling of the log
     rather than inside it. look for an aria-live region just below the
     log/thread that has no text but is rendered - matches the typing-
     status announcement pattern. */
  for (const log of logs) {
    const parent = log.parentElement;
    if (!parent) continue;
    const liveRegions = parent.querySelectorAll(
      ':scope > [aria-live="polite"]:not([data-tm-typing-indicator]),'
      + ':scope > * > [aria-live="polite"]:not([data-tm-typing-indicator])'
    );
    for (const region of liveRegions) {
      if ((region.textContent ?? '').trim().length > 0) continue;
      const rect = region.getBoundingClientRect();
      if (rect.height === 0 || rect.height > 80) continue;
      region.setAttribute('data-tm-typing-indicator', 'true');
    }
  }
}

/* gather likely typing-indicator hosts at the bottom of the log: the last
   role=row/message descendant, plus the last rendered direct child (which
   in some builds carries the indicator slot without any role markers). */
function collectTypingIndicatorCandidates(log) {
  const candidates = [];

  const rows = log.querySelectorAll(
    ':scope [role="row"], :scope [aria-roledescription="message"]'
  );
  if (rows.length > 0) candidates.push(rows[rows.length - 1]);

  for (let i = log.children.length - 1; i >= 0; i--) {
    const child = log.children[i];
    const rect = child.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (!candidates.includes(child)) candidates.push(child);
    break;
  }

  return candidates;
}

function isStillTypingIndicator(element) {
  const ariaLabel = (element.getAttribute('aria-label') ?? '').toLowerCase();
  if (/is typing|is writing|^typing indicator$/.test(ariaLabel)) return true;
  const text = (element.textContent ?? '').trim();
  if (text.length > 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.height === 0 || rect.height > 80) return false;
  if (rect.width === 0) return false;
  return true;
}

/* fb hides the per-message timestamp in a hover tooltip that we've
   killed via [role='tooltip'] { display: none }. extract the time from
   the message's aria-label and render it inline as a faint trailing
   tag, so each message carries its own wallclock. idempotent via a
   child check rather than a flag attribute - if fb's reconciliation
   strips our span, the next apply pass re-adds it. */
function tagMessageTimestamps() {
  const messages = document.querySelectorAll(
    '[role="log"] [aria-roledescription="message"],'
    + ' [data-tm-thread] [aria-roledescription="message"]'
  );
  for (const message of messages) {
    if (message.querySelector(':scope > [data-tm-msg-timestamp]')) continue;
    const time = extractMessageTime(message);
    if (!time) continue;
    const node = document.createElement('span');
    node.setAttribute('data-tm-msg-timestamp', 'true');
    /* aria-hidden because the timestamp is already encoded in the
       message's aria-label - duplicating it for assistive tech would
       just produce noise. */
    node.setAttribute('aria-hidden', 'true');
    node.textContent = time;
    message.appendChild(node);
  }
}

function extractMessageTime(message) {
  const sources = [message.getAttribute('aria-label') ?? ''];
  const inner = message.querySelector('[aria-label*=":"]');
  if (inner) sources.push(inner.getAttribute('aria-label') ?? '');
  for (const text of sources) {
    const match = text.match(/(\d{1,2}:\d{2})(?:\s*(am|pm))?/i);
    if (!match) continue;
    const base = match[1];
    const meridian = match[2]?.toLowerCase();
    return meridian ? `${base}${meridian}` : base;
  }
  return null;
}

/* extract host from the preview's href so CSS can prepend "[host] " to
   the title. uses URL parsing rather than substring slicing because fb
   wraps outbound links through a lm.facebook.com redirect with the real
   URL in a `u=` query parameter. */
function tagLinkPreviewHosts() {
  const anchors = document.querySelectorAll('[data-tm-link-preview]');
  for (const anchor of anchors) {
    let host = anchor.getAttribute('data-tm-link-host');
    if (!host) {
      const href = anchor.getAttribute('href');
      if (!href) continue;
      host = resolveLinkPreviewHost(href);
      if (host) anchor.setAttribute('data-tm-link-host', host);
    }
    /* mirror the host onto the title node so CSS `attr()` can read it
       inside the ::before pseudo - attr() only resolves on the element
       the pseudo is on, not on an ancestor. */
    if (host) {
      const titleNode = anchor.querySelector('[data-tm-link-title]');
      if (titleNode && titleNode.getAttribute('data-tm-link-host') !== host) {
        titleNode.setAttribute('data-tm-link-host', host);
      }
    }
  }
}

function resolveLinkPreviewHost(href) {
  try {
    const url = new URL(href, document.baseURI);
    /* fb wraps clicked links through l.facebook.com/l.php?u=<real-url>.
       unwrap once so the host shown matches what the user is actually
       opening, not the redirector. */
    if (/(^|\.)facebook\.com$/i.test(url.host) && url.searchParams.has('u')) {
      const inner = new URL(url.searchParams.get('u'));
      return inner.host.replace(/^www\./, '');
    }
    return url.host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/* tag fb's intra-log date/time headers so CSS can render them as
   terminal-style "──── label ────" rules. fb usually uses an <h4> or
   [role="separator"] without text on the row itself, but the label text
   ("Today at 3:00 PM", "Sunday 10:00 AM", "Yesterday 14:22") lives in a
   descendant or in the previous sibling. anchor on aria-label if present,
   otherwise on direct text content; never tag inside a real message row. */
function tagDaySeparators() {
  const logs = document.querySelectorAll('[role="log"], [data-tm-thread]');
  for (const log of logs) {
    const candidates = log.querySelectorAll(
      'h4:not([data-tm-day-separator]),'
      + ' h5:not([data-tm-day-separator]),'
      + ' [role="separator"]:not([data-tm-day-separator])'
    );
    for (const candidate of candidates) {
      if (candidate.closest('[aria-roledescription="message"], [role="row"]')) continue;

      const ariaLabel = (candidate.getAttribute('aria-label') ?? '').trim();
      const text = (candidate.textContent ?? '').trim();
      const label = ariaLabel || text;
      if (!label || label.length > 80) continue;
      if (!looksLikeDateLabel(label)) continue;

      candidate.setAttribute('data-tm-day-separator', 'true');
      /* surface label as a data attribute so CSS can render it via
         attr() when the element has no own text (some fb builds keep
         label only on aria). */
      if (!text) candidate.setAttribute('data-tm-day-label', label);
    }
  }
}

function looksLikeDateLabel(text) {
  const lower = text.toLowerCase();
  if (/^(today|yesterday)\b/.test(lower)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun)/.test(lower)) return true;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/.test(lower)) return true;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(lower)) return true;
  if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(lower)) return true;
  return false;
}

function tagLinkPreviews() {
  const anchors = document.querySelectorAll(
    '[role="log"] a[href]:not([data-tm-link-preview-scanned]), '
    + '[data-tm-thread] a[href]:not([data-tm-link-preview-scanned])'
  );
  for (const anchor of anchors) {
    anchor.setAttribute('data-tm-link-preview-scanned', 'true');
    if (looksLikeLinkPreview(anchor)) {
      anchor.setAttribute('data-tm-link-preview', 'true');
      tagLinkPreviewParts(anchor);
    }
  }
}

/* a card-style preview either embeds a thumbnail or stacks multiple
   text-bearing children. plain inline links have neither and stay un-tagged
   so they don't get a card frame. */
function looksLikeLinkPreview(anchor) {
  if (anchor.querySelector('img')) return true;

  let textBlockChildCount = 0;
  for (const child of anchor.children) {
    if (child.tagName === 'IMG') continue;
    const text = (child.textContent ?? '').trim();
    if (text.length > 0) textBlockChildCount += 1;
    if (textBlockChildCount >= 2) return true;
  }
  return false;
}

/* fb stacks the title + description as separate text-bearing blocks below
   the thumbnail image, but our universal styling renders them at the same
   weight/colour with no break - so "title (HD)Check out my..." runs into
   one wall of text. walk the descendants in document order, treat the
   first block-with-text as the title (bold/normal colour) and any
   subsequent blocks as description (muted), so the card reads with the
   same hierarchy as fb's native render. skips any subtree that contains
   an image to avoid tagging the thumbnail's hidden alt-text wrapper. */
function tagLinkPreviewParts(anchor) {
  const seenContainers = new WeakSet();
  let textBlockIndex = 0;
  for (const block of anchor.querySelectorAll('div, span')) {
    if (block.querySelector('img, picture, video, canvas')) continue;
    const text = (block.textContent ?? '').trim();
    if (text.length === 0) continue;
    /* only tag the outermost text-bearing wrapper - descending into nested
       spans would tag the same string multiple times and double-style it */
    if (Array.from(seenContainers).some((container) => container.contains(block))) continue;
    seenContainers.add(block);

    if (textBlockIndex === 0) {
      block.setAttribute('data-tm-link-title', 'true');
    } else {
      block.setAttribute('data-tm-link-desc', 'true');
    }
    textBlockIndex += 1;
    if (textBlockIndex >= 4) break;
  }
}
