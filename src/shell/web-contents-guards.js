const { BrowserWindow, Menu, clipboard, shell } = require('electron');
const { isAllowedMessengerUrl } = require('./app-config');
const { runRendererAction } = require('./renderer-bridge');

/* fb rewrites every outbound link in a message as
   `https://l.facebook.com/l.php?u=<real-url>`. those hosts match the
   `.facebook.com` allowlist, so without unwrapping them a click opened an
   in-app window that the shim then 302'd to an arbitrary site - inside a
   window sharing the fb session partition. */
const LINK_SHIM_HOSTS = new Set(['l.facebook.com', 'lm.facebook.com', 'l.messenger.com']);

/* gate shell.openExternal on http/https: a `javascript:` or custom-scheme URL
   reaching openExternal would be handed to the OS, which may pass it to a
   browser that interprets it. fb shouldn't emit such links, but our allowed-
   host rejection path is the catch-all and must stay safe. */
function safeOpenExternal(url) {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
}

/* the real destination behind an fb link shim, or null when the URL isn't a
   shim (or carries no `u` payload). */
function linkShimTarget(candidateUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return null;
  }
  if (!LINK_SHIM_HOSTS.has(parsedUrl.hostname.toLowerCase())) return null;
  const wrappedUrl = parsedUrl.searchParams.get('u');
  if (!wrappedUrl) return null;
  try {
    return new URL(wrappedUrl, parsedUrl).toString();
  } catch {
    return null;
  }
}

/* the URL that should be handed to the system browser, or null when the
   navigation may stay inside the app. */
function externalTargetFor(candidateUrl, allowedHosts) {
  const shimTarget = linkShimTarget(candidateUrl);
  if (shimTarget !== null) {
    /* a shim wrapping an in-app destination is fine to follow: it redirects
       back onto an allowed host, and will-redirect re-checks that hop. */
    return isAllowedMessengerUrl(shimTarget, allowedHosts) ? null : shimTarget;
  }
  if (isAllowedMessengerUrl(candidateUrl, allowedHosts)) return null;
  return candidateUrl;
}

function bindNavigationGuards(webContents, appConfig) {
  const allowedHosts = appConfig.allowedHosts;

  webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = externalTargetFor(url, allowedHosts);
    if (externalUrl === null) return { action: 'allow' };
    safeOpenExternal(externalUrl);
    return { action: 'deny' };
  });

  const sendOffsiteNavigationToBrowser = (event, url) => {
    const externalUrl = externalTargetFor(url, allowedHosts);
    if (externalUrl === null) return;
    event.preventDefault();
    safeOpenExternal(externalUrl);
  };
  webContents.on('will-navigate', sendOffsiteNavigationToBrowser);
  /* will-navigate does NOT fire for server-side redirects, which is exactly
     how the l.php shim leaves the allowlist in a same-tab navigation. */
  webContents.on('will-redirect', sendOffsiteNavigationToBrowser);
}

/* Electron shows NO context menu unless the app builds one, so right-click
   was dead app-wide: no spellcheck corrections, no image copy, no
   cut/copy/paste. build a minimal menu from the context-menu params.
   (the renderer side stops fb's own contextmenu handlers from cancelling
   the event - see bindNativeContextMenuGuard in inject/terminal.js.) */
function bindContextMenu(webContents) {
  webContents.on('context-menu', (_event, params) => {
    const template = [];

    for (const suggestion of (params.dictionarySuggestions ?? []).slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => webContents.replaceMisspelling(suggestion)
      });
    }
    if (params.misspelledWord) {
      template.push({
        label: 'Add to Dictionary',
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      template.push({ type: 'separator' });
    }

    if (params.mediaType === 'image') {
      /* copyImageAt grabs the decoded bitmap at the click point - works for
         e2ee blob: images whose URL can't be re-fetched. */
      template.push({
        label: 'Copy Image',
        click: () => webContents.copyImageAt(params.x, params.y)
      });
      if (params.srcURL && /^https?:/i.test(params.srcURL)) {
        template.push({
          label: 'Copy Image Address',
          click: () => clipboard.writeText(params.srcURL)
        });
      }
      template.push({ type: 'separator' });
    }

    if (params.linkURL) {
      /* show the user the destination they'll actually reach, not fb's
         redirector - and put that on the clipboard too. */
      const copyableLink = linkShimTarget(params.linkURL) ?? params.linkURL;
      template.push({
        label: 'Copy Link Address',
        click: () => clipboard.writeText(copyableLink)
      });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      );
    } else if ((params.selectionText ?? '').trim()) {
      template.push({ role: 'copy' });
    }

    while (template.length && template[template.length - 1].type === 'separator') {
      template.pop();
    }
    if (!template.length) return;
    const ownerWindow = BrowserWindow.fromWebContents(webContents);
    Menu.buildFromTemplate(template).popup(ownerWindow ? { window: ownerWindow } : {});
  });
}

/* this is the main-process keyboard pipeline (Electron's
   before-input-event). it duplicates inject/terminal.js handleKeyboardShortcut
   on purpose: the main-process one fires even if the renderer's JS is
   stalled or hasn't finished injecting. when adding/changing a shortcut,
   update BOTH pipelines or one of the two firing paths will silently miss. */
function shortcutHandlerFor(input) {
  /* before-input-event fires for keyUp as well as keyDown. macOS suppresses
     keyup for letter keys while cmd is held, which hides the double-fire for
     cmd-shortcuts - but alt+arrow keyup IS delivered with alt still held, so
     every back/forward navigated twice. on win/linux every ctrl-shortcut
     double-fired. filter to keyDown only. */
  if (input.type !== 'keyDown') return null;
  const pressedKey = input.key?.toLowerCase();
  if (!pressedKey) return null;

  const isPrimaryModifier = process.platform === 'darwin' ? input.meta : input.control;
  const isShift = Boolean(input.shift);
  const isAlt = Boolean(input.alt);

  if (isPrimaryModifier && !isShift && pressedKey === 'r') return (contents) => contents.reload();
  if (isPrimaryModifier && isShift && pressedKey === 'i') return (contents) => contents.toggleDevTools();
  if (isPrimaryModifier && isShift && pressedKey === 't') return (contents) => runRendererAction(contents, 'toggleTheme');
  if (isPrimaryModifier && isShift && pressedKey === 'p') return (contents) => runRendererAction(contents, 'openPalette');
  if (isPrimaryModifier && isShift && pressedKey === 'u') return (contents) => runRendererAction(contents, 'toggleUltra');
  if (isPrimaryModifier && isShift && pressedKey === 's') return (contents) => runRendererAction(contents, 'openSearchOverlay');
  if (isPrimaryModifier && isShift && pressedKey === 'm') return (contents) => runRendererAction(contents, 'toggleMuted');
  if (isPrimaryModifier && isShift && pressedKey === 'y') return (contents) => runRendererAction(contents, 'toggleThemeDisabled');
  /* history navigation is platform-specific: Cmd+[ / Cmd+] on darwin (where
     Option+Arrow belongs to the composer's word-jump), Alt+Arrow elsewhere.
     mirrored in application-menu.js - update both.
     Electron reports arrow keys as 'ArrowLeft'/'ArrowRight' (KeyboardEvent.key
     semantics); accept the bare names too in case a build reports them. */
  const wantsBack = process.platform === 'darwin'
    ? (isPrimaryModifier && !isShift && pressedKey === '[')
    : (isAlt && (pressedKey === 'arrowleft' || pressedKey === 'left'));
  const wantsForward = process.platform === 'darwin'
    ? (isPrimaryModifier && !isShift && pressedKey === ']')
    : (isAlt && (pressedKey === 'arrowright' || pressedKey === 'right'));

  if (wantsBack) return (contents) => { if (contents.canGoBack()) contents.goBack(); };
  if (wantsForward) return (contents) => { if (contents.canGoForward()) contents.goForward(); };

  return null;
}

function bindKeyboardShortcuts(webContents) {
  webContents.on('before-input-event', (event, input) => {
    const handler = shortcutHandlerFor(input);
    if (!handler) return;
    handler(webContents);
    event.preventDefault();
  });
}

/* bound from app.on('web-contents-created') so popups (calls, fb dialogs)
   get the same treatment as the main window - previously they had none of
   these listeners at all. */
function bindWebContentsGuards(webContents, appConfig) {
  bindNavigationGuards(webContents, appConfig);
  bindContextMenu(webContents);
  bindKeyboardShortcuts(webContents);
}

module.exports = {
  bindWebContentsGuards,
  externalTargetFor,
  linkShimTarget,
  safeOpenExternal,
  shortcutHandlerFor
};
