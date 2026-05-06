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
        <button class="tm-media-viewer-close" type="button" data-tm-media-action="close">close [esc]</button>
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
  });

  return root;
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

  img.src = src;
  img.classList.remove('tm-media-viewer-hidden');
  const altText = imgElement.getAttribute('alt')?.trim();
  title.textContent = altText || 'image';
  root.classList.add('tm-media-viewer-open');
}

function openVideoInViewer(videoElement) {
  if (!videoElement || !videoElement.isConnected) return;
  /* if a different video is already mounted in the viewer, restore it
     before swapping in the new one. */
  if (viewerVideoState && viewerVideoState.video !== videoElement) {
    restoreMovedVideo();
  }
  const root = ensureMediaViewerRoot();
  const img = root.querySelector('.tm-media-viewer-img');
  const slot = root.querySelector('.tm-media-viewer-video-slot');
  const title = root.querySelector('.tm-media-viewer-title');

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
  if (wasPaused) video.pause();

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

  const slot = document.querySelector(`#${MEDIA_VIEWER_ROOT_ID} .tm-media-viewer-video-slot`);
  if (slot) slot.setAttribute('data-tm-media-empty', 'true');
}

function closeMediaViewer() {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (!root) return;
  root.classList.remove('tm-media-viewer-open');
  const img = root.querySelector('.tm-media-viewer-img');
  if (img) img.removeAttribute('src');
  restoreMovedVideo();
}

/* fb's videos use MSE blob URLs that can't be re-bound to a different
   <video>, so extracting and replaying in our viewer is a dead end - the
   user saw an empty viewer window. instead leave fb's video element where
   it is and just (a) expose native browser controls, (b) let it scale up
   to a sensible max size. clicks pass through to fb's normal play/pause
   toggle. inline-watching is the path of least surprise here. */
function ensureLogVideoControls() {
  const videos = document.querySelectorAll(
    '[role="log"] video:not([data-tm-video-controls]),'
    + ' [data-tm-thread] video:not([data-tm-video-controls])'
  );
  for (const video of videos) {
    video.setAttribute('data-tm-video-controls', 'true');
    video.controls = true;
    video.setAttribute('controlslist', 'nodownload');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
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

/* fb's native controls bar carries the scrubber, mute, and fullscreen
   buttons - clicks on those should pass through to the browser's video
   handler, not yank the video into our viewer mid-interaction. only
   intercept clicks on the video's own surface. */
function isVideoControlsClick(target, video) {
  if (!(target instanceof Element)) return false;
  if (target === video) return false;
  /* anything inside the video element's shadow DOM (controls bar) is
     fielded by the browser and never reaches `target` as a normal
     descendant - so a non-VIDEO target landing on the video means an
     overlay (poster, play button) sitting in front of it. */
  return false;
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const logScope = target.closest('[role="log"], [data-tm-thread]');
  if (!logScope) return;

  /* direct click on a <video> in a chat: open our viewer with the live
     element moved in. clicks on the native controls bar happen inside
     the shadow DOM and never bubble out as `target === video`, so we
     only catch clicks on the visible playback surface. */
  if (target.tagName === 'VIDEO') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openVideoInViewer(target);
    return;
  }

  /* clicks on a poster image / play overlay - resolve the underlying
     <video> and route the same way. */
  if (isClickableLogImage(target)) {
    const posterVideo = findVideoForPosterImage(target);
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

function handleEscapeKey(event) {
  if (event.key !== 'Escape') return;
  if (!isMediaViewerOpen()) return;
  closeMediaViewer();
  event.preventDefault();
  event.stopPropagation();
}

function bindMediaViewerEvents() {
  if (mediaViewerBound) return;
  mediaViewerBound = true;
  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('keydown', handleEscapeKey, true);
}
