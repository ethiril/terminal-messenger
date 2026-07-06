# Terminal Messenger

A small Electron MVP that wraps the Facebook Messages web UI and injects a minimal terminal-style skin.

It does **not** use private Messenger APIs, scrape messages, or implement its own Messenger protocol. Facebook handles login, sync, encryption, attachments, and sending. This app only changes the presentation layer and adds local keyboard affordances.

## What it does

- Opens `https://www.facebook.com/messages` in an app window.
- Keeps your login in a separate Electron profile: `persist:terminal-messenger`.
- Injects terminal-inspired CSS over the live UI.
- Adds a command palette and a few local shortcuts.
- Adds a top statusline with thread name, presence, flags, and clock.
- Provides an **ultra** mode (chat-only fullscreen) and a **vanilla** mode (revert to native Messenger).
- Reloads the renderer every 30 minutes while the window is unfocused, to free memory.
- Opens non-Facebook links in your normal browser.

## Run from source

```bash
npm install
npm start
```

The app uses `electron@latest` as a dev dependency so you can test with your current Node/npm setup.

## Build as a Mac app

```bash
npm run dist
cp -R "dist/mac-arm64/Messenger.app" /Applications/
```

After that, `Messenger` is launchable from Spotlight, Alfred, Raycast, etc. (Note: if you also have Meta's official Messenger desktop app installed, both bundles will share the name. Set `"productName"` in `package.json` to something like `"Messenger TUI"` to disambiguate.)

To re-install after code changes (handles a running instance + a stale copy):

```bash
osascript -e 'quit app "Messenger"' 2>/dev/null
npm run dist && rm -rf "/Applications/Messenger.app"
cp -R "dist/mac-arm64/Messenger.app" /Applications/
```

The build is unsigned. The first launch may need **right-click → Open**, or run `xattr -cr "/Applications/Messenger.app"` to clear the quarantine attribute.

### Adding a custom icon

Drop your icon into a `build/` folder at the project root:

```bash
mkdir -p build
cp /path/to/icon.icns build/icon.icns   # or build/icon.png (≥ 512×512)
```

Make sure `package.json` references it (already wired by default):

```json
"mac": { "icon": "build/icon.icns" }
```

If you use a `.png`, change the path accordingly. Re-build with `npm run dist`.

### Spotlight / Alfred not finding the app

Force a re-index of the bundle:

```bash
mdimport "/Applications/Messenger.app"
```

If Alfred still won't find it, refresh its index from **Alfred Preferences → Advanced → Rebuild macOS Metadata**.

To inspect what Spotlight thinks the bundle is:

```bash
mdls -name kMDItemDisplayName -name kMDItemKind "/Applications/Messenger.app"
```

Expect `kMDItemKind = "Application"`.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+P` | Open command palette |
| `Cmd+Shift+T` | Cycle theme (green / amber / cyan / mono) |
| `Cmd+Shift+U` | Toggle **ultra** mode (chat-only fullscreen) |
| `Cmd+Shift+Y` | Toggle **vanilla** mode (revert to native Messenger) |
| `Cmd+Shift+S` | Open search overlay |
| `Cmd+Shift+M` | Mute / unmute window audio |
| `Cmd+Shift+I` | DevTools |
| `Cmd+R` | Reload |
| `Alt+Left` / `Alt+Right` | Browser-style back / forward |
| `/` while not typing | Open command palette |

(Substitute `Ctrl` for `Cmd` on non-macOS.)

All settings — theme, ultra, vanilla, opacity, mute, density, font size — persist across reloads via a JSON file in the app's user-data directory (mirrored to `localStorage` for fast early paint).

## Palette commands

Open with `Cmd+Shift+P` (or `/` while not typing). Tab completes, ↑↓ navigate suggestions/history, ↵ runs the highlighted suggestion, and suggestions are clickable. `:help` shows the full annotated list.

```text
:help                         show the command list
:search [query]               open the search overlay (alias :s)
:focus message|search         focus the composer or messenger search
:goto <name>                  open the first chat matching <name> (alias :c)
:theme <name>                 green|amber|cyan|mono|mocha|twilight|neon|macchiato|frappe|latte
:ultra [on|off]               ultra terminal mode
:vanilla [on|off]             disable/enable the terminal skin
:opacity <20-100>             window transparency
:mute [on|off]                mute window audio
:density compact|cozy|comfy   message log spacing
:fontsize <n>|+|-             chat font size in px
:sent-color [on|off]          accent-color outgoing messages
:bottom / :top                scroll the open chat
:unread                       open the first chat that looks unread
:filter all|unread            filter the chat list
:pin / :mark-unread / :mute-chat   act on the j/k-cursored chat
:notifications                open the in-session toast log (alias :log)
:reload                       reload the page
:q                            close the palette
```

## Configuration

Edit `config/app.json`:

```json
{
  "homeUrl": "https://www.facebook.com/messages",
  "theme": "green",
  "window": { "width": 1280, "height": 860 }
}
```

You can swap `homeUrl` to `https://www.messenger.com/` if that works better in your region/session.

## Modes

- **Terminal mode** (default) — full skin: terminal palette, statusline, ultra/compact layout, message-row tagging, hover-toolbar repositioning, reply-quote dimming.
- **Ultra mode** — terminal mode + hides the chat list, header chrome, and side rails so only the active conversation + composer are on screen. Toggle with `Cmd+Shift+U`.
- **Vanilla mode** — strips every `tm-*` class from `<html>`/`<body>` and removes the statusline, restoring Facebook's native Messenger UI without unloading anything. Toggle with `Cmd+Shift+Y` (or `:vanilla` from the palette) to flip back to terminal mode.

## Privacy and safety model

This is intentionally a visual wrapper. It avoids:

- private Messenger endpoints,
- automated message sending,
- background scraping,
- storing copies of conversations,
- bypassing Facebook login or security flows.

Any CSS/DOM selectors that affect Facebook's interface may break when Facebook changes the web app.

## Known limitations

- Facebook uses generated class names and frequently changes markup, so the theme is best-effort. Some areas may remain partially unstyled, and commands like `:focus search` or `:unread` use heuristic selectors.
- The build is unsigned; macOS Gatekeeper will challenge the first launch unless you clear the quarantine attribute.
- Memory grows over long sessions because of Facebook's React tree and message backbuffer; the 30-minute background reload partially mitigates this.

## Troubleshooting

If login or rendering gets stuck, try:

```bash
npm run clean-profile
npm start
```

If the page blocks or challenges the login, sign in through the normal browser flow shown in the app window. Do not automate login.
