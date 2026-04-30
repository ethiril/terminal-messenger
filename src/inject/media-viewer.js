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
  const root = ensureMediaViewerRoot();
  const img = root.querySelector('.tm-media-viewer-img');
  const title = root.querySelector('.tm-media-viewer-title');

  const src = resolveLargeImageSrc(imgElement);
  if (!src) return;

  img.src = src;
  const altText = imgElement.getAttribute('alt')?.trim();
  title.textContent = altText || 'image';
  root.classList.add('tm-media-viewer-open');
}

function closeMediaViewer() {
  const root = document.getElementById(MEDIA_VIEWER_ROOT_ID);
  if (!root) return;
  root.classList.remove('tm-media-viewer-open');
  const img = root.querySelector('.tm-media-viewer-img');
  if (img) img.removeAttribute('src');
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

function handleDocumentClick(event) {
  if (!isClickableLogImage(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  openMediaViewer(event.target);
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
