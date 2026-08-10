const path = require('node:path');
const { readTextFileOrNull } = require('./app-config');

/* the single source of truth for settings constants. this module is
   main-process only; the two renderer-side consumers can't require() it, so
   they receive a serialised copy instead:
   - preload.js  → via BrowserWindow additionalArguments (see messenger-window.js)
   - inject/*.js → via the window.__TERMINAL_MESSENGER_SCHEMA__ prelude that
                   buildInjectionScript writes ahead of the bundle
   both fall back to a built-in copy if the payload is missing, so a version
   skew degrades instead of throwing. */

const TERMINAL_CSS_PATH = path.join(__dirname, '..', 'inject', 'terminal.css');
const DEFAULT_THEME = 'green';

/* used when terminal.css can't be read or parsed - keeps the app themable
   rather than themeless. normally every value below comes from the CSS. */
const FALLBACK_THEME_PALETTES = Object.freeze({
  green: { background: '#050805', foreground: '#c8e8c0' }
});

/* the palette is defined once, in terminal.css: `:root` carries green (the
   default) and each `html.tm-theme-<name>` block overrides it. parse those
   blocks instead of re-typing the hex values here - preload used to keep a
   hand-maintained copy that silently drifted from the stylesheet. */
function readThemePalettesFromCss() {
  const styleSheet = readTextFileOrNull(TERMINAL_CSS_PATH);
  if (styleSheet === null) return { ...FALLBACK_THEME_PALETTES };

  const palettes = {};
  /* anchored to line start (m flag) so compound selectors that merely begin
     with a theme class - `html.tm-theme-neon body.tm-terminal-theme ...` -
     don't get mistaken for palette blocks. */
  const blockPattern = /^(:root|html\.tm-theme-([a-z0-9-]+))\s*\{([^}]*)\}/gm;
  for (const [, , themeName, blockBody] of styleSheet.matchAll(blockPattern)) {
    const background = blockBody.match(/--tm-bg:\s*([^;]+);/)?.[1]?.trim();
    const foreground = blockBody.match(/--tm-text:\s*([^;]+);/)?.[1]?.trim();
    if (!background || !foreground) continue;
    palettes[themeName ?? DEFAULT_THEME] = { background, foreground };
  }
  if (!palettes[DEFAULT_THEME]) return { ...FALLBACK_THEME_PALETTES };
  return palettes;
}

const THEME_PALETTES = Object.freeze(readThemePalettesFromCss());

const SETTINGS_SCHEMA = Object.freeze({
  themes: Object.freeze(Object.keys(THEME_PALETTES)),
  defaultTheme: DEFAULT_THEME,
  themePalettes: THEME_PALETTES,
  densities: Object.freeze(['compact', 'cozy', 'comfy']),
  defaultDensity: 'cozy',
  chatFilters: Object.freeze(['all', 'unread']),
  defaultChatFilter: 'all',
  minOpacityPct: 20,
  maxOpacityPct: 100,
  minFontPx: 9,
  maxFontPx: 18,
  defaultFontPx: 12
});

module.exports = { SETTINGS_SCHEMA };
