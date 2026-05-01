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

  const labelHits = document.querySelectorAll(
    '[role="log"] [aria-label*="typing" i]:not([data-tm-typing-indicator]),'
    + '[data-tm-thread] [aria-label*="typing" i]:not([data-tm-typing-indicator]),'
    + '[role="log"] [aria-label*="is writing" i]:not([data-tm-typing-indicator]),'
    + '[data-tm-thread] [aria-label*="is writing" i]:not([data-tm-typing-indicator])'
  );
  for (const hit of labelHits) {
    hit.setAttribute('data-tm-typing-indicator', 'true');
  }

  /* fallback for fb builds that don't expose a typing aria-label: the typing
     bubble is always rendered as the last row of the log, has no visible
     text, and contains only decorative svg/img dots. restrict the heuristic
     to the final row so day-separators or read-receipt rows mid-feed don't
     accidentally get swapped for "..." */
  const logs = document.querySelectorAll('[role="log"], [data-tm-thread]');
  for (const log of logs) {
    const rows = log.querySelectorAll(':scope [role="row"]');
    const lastRow = rows[rows.length - 1];
    if (!lastRow || lastRow.hasAttribute('data-tm-typing-indicator')) continue;
    if ((lastRow.textContent ?? '').trim().length > 0) continue;
    const hasDecorative = lastRow.querySelector('svg, i[data-visualcompletion="css-img"], img');
    if (!hasDecorative) continue;
    lastRow.setAttribute('data-tm-typing-indicator', 'true');
  }
}

function isStillTypingIndicator(element) {
  const ariaLabel = (element.getAttribute('aria-label') ?? '').toLowerCase();
  if (/typing|is writing/.test(ariaLabel)) return true;
  if (!element.matches('[role="row"]')) return false;
  const text = (element.textContent ?? '').trim();
  if (text.length > 0) return false;
  return Boolean(element.querySelector('svg, i[data-visualcompletion="css-img"], img'));
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
