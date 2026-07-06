/* fb's lightbox is a body-level portal without role=dialog/aria-modal so our
   universal img-hide swallows the image. simpler than reverse-engineering
   fb's portal CSS: intercept the click in capture phase and render our own
   lightbox attached to <html> so body-scoped rules don't reach it. */

const MEDIA_VIEWER_ROOT_ID = 'tm-media-viewer-root';

let mediaViewerBound = false;

function ensureMediaViewerRoot() {
  const existing = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (existing) return existing;

  const root = document.createElement('div');
  root.id = MEDIA_VIEWER_ROOT_ID;
  root.innerHTML = `
    <div class="tm-media-viewer-backdrop" data-tm-media-action="close"></div>
    <div class="tm-media-viewer-frame">
      <div class="tm-media-viewer-header">
        <span class="tm-media-viewer-title">image</span>
        <span class="tm-media-viewer-status" data-tm-media-status></span>
        <span class="tm-media-viewer-actions">
          <button class="tm-media-viewer-prev" type="button" data-tm-media-action="prev" aria-label="previous">‹ prev</button>
          <button class="tm-media-viewer-next" type="button" data-tm-media-action="next" aria-label="next">next ›</button>
          <button class="tm-media-viewer-copy" type="button" data-tm-media-action="copy" aria-label="copy image url">copy</button>
          <button class="tm-media-viewer-close" type="button" data-tm-media-action="close">close [esc]</button>
        </span>
      </div>
      <div class="tm-media-viewer-body">
        <img class="tm-media-viewer-img" alt="">
        <div class="tm-media-viewer-video-slot" data-tm-media-empty="true"></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);

  root.addEventListener('click', (event) => {
    const target = event.target;
    const action = target instanceof Element ? target.getAttribute('data-tm-media-action') : null;
    if (action === 'close') closeMediaViewer();
    else if (action === 'prev') stepMediaViewer(-1);
    else if (action === 'next') stepMediaViewer(1);
    else if (action === 'copy') copyMediaViewerImageUrl();
  });

  const img = root.querySelector('.tm-media-viewer-img');
  if (img) {
    img.addEventListener('load', () => setMediaViewerStatus(''));
    img.addEventListener('error', () => setMediaViewerStatus('failed to load'));
  }

  return root;
}

function setMediaViewerStatus(message) {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (!root) return;
  const statusNode = root.querySelector('[data-tm-media-status]');
  if (statusNode) statusNode.textContent = message;
}

/* track which <img> opened the viewer so we can advance to its siblings
   inside the same row/article. videos use the live-reparent path and don't
   participate in arrow nav (each video's lifecycle is tied to fb's slot). */
let currentViewerImage = null;

function collectSiblingImages(seedImage) {
  if (!seedImage) return [];
  const scope = seedImage.closest('[aria-roledescription="message"], [role="row"], [role="article"]');
  if (!scope) return [seedImage];
  const candidates = scope.querySelectorAll('img[data-tm-img-size="large"]');
  const result = [];
  for (const candidate of candidates) {
    if (!isClickableLogImage(candidate)) continue;
    result.push(candidate);
  }
  return result.length ? result : [seedImage];
}

function stepMediaViewer(direction) {
  if (!currentViewerImage) return;
  const siblings = collectSiblingImages(currentViewerImage);
  if (siblings.length < 2) return;
  const currentIndex = siblings.indexOf(currentViewerImage);
  const nextIndex = (currentIndex + direction + siblings.length) % siblings.length;
  openMediaViewer(siblings[nextIndex]);
}

function copyMediaViewerImageUrl() {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (!root) return;
  const img = root.querySelector('.tm-media-viewer-img');
  const src = img?.getAttribute('src');
  if (!src) { showToast('no image to copy'); return; }
  /* navigator.clipboard.writeText returns a promise; if denied, fall back
     to copying via a hidden textarea + execCommand for older flows. */
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(src).then(
      () => showToast('copied image url'),
      () => showToast('clipboard blocked')
    );
    return;
  }
  showToast('clipboard unavailable');
}

/* fb's video element is bound to a MediaSource/blob URL that can't be
   transplanted by setting `src` on a different element. instead, MOVE the
   live video node into our viewer (its MSE pipeline survives reparenting)
   and put it back where it was on close. */
let viewerVideoState = null;

function resolveLargeImageSrc(imgElement) {
  const srcset = imgElement.getAttribute('srcset') ?? '';
  if (srcset) {
    let bestUrl = null;
    let bestWidth = 0;
    for (const entry of srcset.split(',')) {
      const [url, descriptor] = entry.trim().split(/\s+/);
      if (!url) continue;
      const width = descriptor ? parseInt(descriptor.replace(/[^0-9]/g, ''), 10) : 0;
      if (width >= bestWidth) {
        bestUrl = url;
        bestWidth = width;
      }
    }
    if (bestUrl) return bestUrl;
  }
  return imgElement.currentSrc || imgElement.src || '';
}

function openMediaViewer(imgElement) {
  restoreMovedVideo();
  const root = ensureMediaViewerRoot();
  const img = root.querySelector('.tm-media-viewer-img');
  const title = root.querySelector('.tm-media-viewer-title');

  const src = resolveLargeImageSrc(imgElement);
  if (!src) return;

  currentViewerImage = imgElement;
  /* show "loading…" until the image's load event clears it. cleared on
     error too so the user isn't left staring at a half-rendered viewer. */
  setMediaViewerStatus('loading…');
  img.src = src;
  img.classList.remove('tm-media-viewer-hidden');
  const altText = imgElement.getAttribute('alt')?.trim();
  title.textContent = altText || 'image';

  /* show prev/next only when the row holds multiple large images */
  const siblings = collectSiblingImages(imgElement);
  const hasSiblings = siblings.length > 1;
  root.querySelector('.tm-media-viewer-prev')?.toggleAttribute('hidden', !hasSiblings);
  root.querySelector('.tm-media-viewer-next')?.toggleAttribute('hidden', !hasSiblings);
  root.querySelector('.tm-media-viewer-copy')?.removeAttribute('hidden');

  root.classList.add('tm-media-viewer-open');
}

function openVideoInViewer(videoElement) {
  if (!videoElement || !videoElement.isConnected) return;
  /* if a different video is already mounted in the viewer, restore it
     before swapping in the new one. */
  if (viewerVideoState && viewerVideoState.video !== videoElement) {
    restoreMovedVideo();
  }
  currentViewerImage = null;
  const root = ensureMediaViewerRoot();
  const img = root.querySelector('.tm-media-viewer-img');
  const slot = root.querySelector('.tm-media-viewer-video-slot');
  const title = root.querySelector('.tm-media-viewer-title');

  setMediaViewerStatus('');
  /* prev/next/copy don't apply to videos */
  root.querySelector('.tm-media-viewer-prev')?.setAttribute('hidden', '');
  root.querySelector('.tm-media-viewer-next')?.setAttribute('hidden', '');
  root.querySelector('.tm-media-viewer-copy')?.setAttribute('hidden', '');

  img.removeAttribute('src');
  img.classList.add('tm-media-viewer-hidden');

  if (!viewerVideoState || viewerVideoState.video !== videoElement) {
    viewerVideoState = {
      video: videoElement,
      parent: videoElement.parentNode,
      nextSibling: videoElement.nextSibling,
      controls: videoElement.controls,
      muted: videoElement.muted,
      currentTime: videoElement.currentTime,
      wasPaused: videoElement.paused
    };
    slot.appendChild(videoElement);
    slot.removeAttribute('data-tm-media-empty');
  }

  videoElement.classList.add('tm-media-viewer-active-video');
  videoElement.controls = true;
  videoElement.setAttribute('controlslist', 'nodownload');
  videoElement.play().catch(() => {});

  title.textContent = videoElement.getAttribute('aria-label')?.trim() || 'video';
  root.classList.add('tm-media-viewer-open');
}

/* put the live video node back where fb originally rendered it, so the
   message bubble's <video> reference doesn't go stale and the chat doesn't
   end up with a hole. only re-attach if the original parent is still in
   the document - on a navigation/reload the message subtree may be gone,
   in which case the video can be discarded. */
function restoreMovedVideo() {
  if (!viewerVideoState) return;
  const { video, parent, nextSibling, controls, muted, currentTime, wasPaused } = viewerVideoState;
  viewerVideoState = null;

  video.classList.remove('tm-media-viewer-active-video');
  video.controls = controls;
  video.muted = muted;

  if (parent && parent.isConnected) {
    try {
      parent.insertBefore(video, nextSibling && nextSibling.isConnected ? nextSibling : null);
    } catch {
      /* sibling no longer attached: append to parent as a fallback */
      try { parent.appendChild(video); } catch {}
    }
    /* re-seek after attach: webkit sometimes resets currentTime on
       reparent. swallow errors if the video has unloaded. */
    try { video.currentTime = currentTime; } catch {}
  }

  /* mirror the original play/pause state. without the else-play branch, a
     video the user had playing inline would silently stay paused after the
     viewer closed - they'd think we broke playback. */
  if (wasPaused) video.pause();
  else video.play().catch(() => {});

  const slot = document.querySelector(`#${MEDIA_VIEWER_ROOT_ID} .tm-media-viewer-video-slot`);
  if (slot) slot.setAttribute('data-tm-media-empty', 'true');
}

function closeMediaViewer() {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (!root) return;
  root.classList.remove('tm-media-viewer-open');
  const img = root.querySelector('.tm-media-viewer-img');
  if (img) img.removeAttribute('src');
  currentViewerImage = null;
  setMediaViewerStatus('');
  restoreMovedVideo();
}

/* GIFs and stickers: fb renders them as <video loop> (no audio track)
   and vanilla messenger auto-plays them inline. our universal preload
   tweak below was wiping the autoplay-friendly defaults - GIFs ended up
   paused on their poster frame with a controls bar overlay. detect the
   GIF/sticker pattern via the loop attribute fb sets (regular videos
   don't carry it) and force autoplay+muted+playsinline so chromium's
   autoplay policy lets them through. no controls on a GIF - it's meant
   to read as a moving image, not a video. */
function isGifLikeVideo(video) {
  return video.hasAttribute('loop') || video.loop;
}

/* regular videos deliberately get NO inline controls: shadow-DOM control
   clicks retarget to the <video> element, so a click on an inline pause
   button is indistinguishable from a click on the playback surface - the
   user pressed pause and the video jumped into the viewer instead. the
   viewer is the only place a regular video plays with controls; inline it
   shows its poster and a click promotes it. */
function ensureLogVideoControls() {
  const videos = document.querySelectorAll(
    '[role="log"] video:not([data-tm-video-controls]),'
    + ' [data-tm-thread] video:not([data-tm-video-controls])'
  );
  for (const video of videos) {
    video.setAttribute('data-tm-video-controls', 'true');
    video.setAttribute('playsinline', '');

    const isGifLike = isGifLikeVideo(video);
    if (isGifLike) {
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.controls = false;
      video.removeAttribute('controls');
      video.setAttribute('preload', 'auto');
      /* chromium pauses fb's <video> on initial mount when its autoplay
         policy can't yet confirm the document has user interaction.
         force a play() call now - returns a promise that rejects silently
         if blocked, which is fine: a user click anywhere on the page
         later will unlock playback and fb's own observer kicks it in. */
      const playResult = video.play();
      if (playResult && typeof playResult.then === 'function') {
        playResult.catch(() => {});
      }
    } else {
      /* controls only exist inside the viewer; see comment above. an
         earlier pass may have left controls on - strip them. */
      video.controls = false;
      video.removeAttribute('controls');
      video.setAttribute('controlslist', 'nodownload');
      video.setAttribute('preload', 'metadata');
    }
  }
}

function isMediaViewerOpen() {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  return Boolean(root && root.classList.contains('tm-media-viewer-open'));
}

function isClickableLogImage(target) {
  if (!(target instanceof Element)) return false;
  if (target.tagName !== 'IMG') return false;
  if (target.getAttribute('data-tm-img-size') !== 'large') return false;
  if (!target.closest('[role="log"], [data-tm-thread]')) return false;
  if (target.closest('[aria-label*="reaction" i]')) return false;
  if (target.closest('[aria-label*="Reactions" i]')) return false;
  /* link-preview thumbnails live inside an anchor whose click should
     navigate to the linked page - swallowing it into the image viewer
     made link cards feel dead. shared photos aren't anchor-wrapped in
     this build, so scoping on the tag keeps photo clicks with us. */
  if (target.closest('[data-tm-link-preview]')) return false;
  return true;
}

/* a video poster is the static thumbnail fb shows while the underlying
   <video> element is hidden. find the video so we can promote it into
   our viewer regardless of whether the user clicked the poster, the
   play-button overlay, or the message wrapper. */
function findVideoForPosterImage(imgElement) {
  const wrapper = imgElement.closest(
    '[role="button"], [aria-roledescription="message"], [aria-label*="video" i]'
  );
  if (!wrapper) return null;
  return wrapper.querySelector('video');
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const logScope = target.closest('[role="log"], [data-tm-thread]');
  if (!logScope) return;

  /* direct click on a <video> in a chat: open our viewer with the live
     element moved in. GIFs/stickers (fb renders them as <video loop>)
     stay inline - they read as moving images, and reparenting them into
     the viewer interrupted their autoplay loop for no benefit.

     note: clicks on a native controls bar are retargeted out of the
     shadow DOM to the <video> element itself, so a controls click IS
     indistinguishable from a surface click here. inline videos therefore
     carry no controls (see ensureLogVideoControls) - any click promotes
     the video into the viewer, which owns the controls. */
  if (target.tagName === 'VIDEO') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    /* swallow GIF clicks entirely rather than letting them through:
       fb's own click handler would open its lightbox, which our theme
       breaks (body-level portal, see file header). the GIF just keeps
       looping inline. */
    if (isGifLikeVideo(target)) return;
    openVideoInViewer(target);
    return;
  }

  /* clicks on a poster image / play overlay - resolve the underlying
     <video> and route the same way. */
  if (isClickableLogImage(target)) {
    const posterVideo = findVideoForPosterImage(target);
    if (posterVideo && isGifLikeVideo(posterVideo)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (posterVideo) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openVideoInViewer(posterVideo);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openMediaViewer(target);
  }
}

function handleViewerKeyboard(event) {
  if (!isMediaViewerOpen()) return;
  if (event.key === 'Escape') {
    closeMediaViewer();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  /* arrow nav only meaningful when an image is the active subject - videos
     keep their fb-owned controls and shouldn't be hijacked by arrow keys. */
  if (!currentViewerImage) return;
  if (event.key === 'ArrowLeft') {
    stepMediaViewer(-1);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === 'ArrowRight') {
    stepMediaViewer(1);
    event.preventDefault();
    event.stopPropagation();
  }
}

function bindMediaViewerEvents() {
  if (mediaViewerBound) return;
  mediaViewerBound = true;
  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('keydown', handleViewerKeyboard, true);
}
