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
  const text = (button.textContent ?? '').trim();
  if (text.length > 2) return false;
  const hasIcon = button.querySelector('svg, i[data-visualcompletion="css-img"], img');
  return Boolean(hasIcon);
}

/* tag the wrapper only when at least one direct child is a tagged action
   button - prevents tagging reaction-badge wrappers by accident */
function tagActionToolbarWrappers() {
  const rows = document.querySelectorAll('[role="log"] [role="row"], [data-tm-thread] [role="row"]');
  for (const row of rows) {
    const wrappers = row.querySelectorAll('div:not([data-tm-action-toolbar])');
    for (const wrapper of wrappers) {
      if (!hasTaggedActionButtonChild(wrapper)) continue;
      wrapper.setAttribute('data-tm-action-toolbar', 'true');
    }
  }
}

function hasTaggedActionButtonChild(wrapper) {
  for (const child of wrapper.children) {
    if (child.hasAttribute('data-tm-action-button')) return true;
  }
  return false;
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
    if (row.querySelector('[data-tm-reply-quote]')) continue;

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
      if (hasContentMedia && candidateText.length < 4) {
        mediaQuote = candidate;
        break;
      }
      if (!mediaQuote && looksLikeNewMessage && !textQuote && !hasAvatar) {
        textQuote = candidate;
      }
      candidate = candidate.nextElementSibling;
    }
    const quote = mediaQuote ?? textQuote;
    if (quote) quote.setAttribute('data-tm-reply-quote', 'true');
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
