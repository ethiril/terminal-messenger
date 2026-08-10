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
- Reloads the renderer roughly hourly while the window is unfocused and idle (no draft in the composer, no audio/video playing), to free memory.
- Opens non-Facebook links in your normal browser, including links Facebook wraps through its `l.facebook.com` redirector.
- Supports Messenger voice/video calls: mic and camera are granted only to pages served from an allowed host.

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
| `Cmd+Shift+H` | Back to the messages home page |
| `Cmd+[` / `Cmd+]` | Browser-style back / forward (macOS) |
| `Alt+Left` / `Alt+Right` | Browser-style back / forward (Windows / Linux) |
| `/` while not typing | Open command palette |

(Substitute `Ctrl` for `Cmd` on non-macOS.)

On macOS, history navigation deliberately uses `Cmd+[` / `Cmd+]` rather than
`Alt+Arrow`, which belongs to the composer's word-by-word cursor movement.

### Vim-style keys

Active when you are not typing in a text field:

| Key | Action |
|---|---|
| `j` / `k` | Move the chat-list cursor down / up |
| `Enter` | Open the cursored chat |
| `G` | Jump to the newest message in the open chat |
| `gg` | Jump to the oldest loaded message |
| `n` / `N` | Step forward / back through the last in-thread search matches |

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
  "allowedHosts": ["facebook.com", "messenger.com"],
  "theme": "green",
  "window": { "width": 1280, "height": 860 }
}
```

You can swap `homeUrl` to `https://www.messenger.com/` if that works better in your region/session.

`allowedHosts` is the navigation allowlist: subdomains are matched too, and anything outside it opens in your normal browser instead of inside the app window.

## Modes

- **Terminal mode** (default) — full skin: terminal palette, statusline, ultra/compact layout, message-row tagging, hover-toolbar repositioning, reply-quote dimming.
- **Ultra mode** — terminal mode + hides the chat list, header chrome, and side rails so only the active conversation + composer are on screen. Toggle with `Cmd+Shift+U`.
- **Vanilla mode** — strips every `tm-*` class from `<html>`/`<body>` and removes the statusline, restoring Facebook's native Messenger UI without unloading anything. Toggle with `Cmd+Shift+Y` (or `:vanilla` from the palette) to flip back to terminal mode.

## Development

### Debug eval bridge

Styling this app means checking work against Facebook's live DOM, which is generated markup that changes without notice. The debug eval bridge makes that loop runnable from a terminal instead of by hand in DevTools.

Set `TM_DEBUG_EVAL_FILE` to a scratch path and start the app:

```bash
mkdir -p .tm-debug
TM_DEBUG_EVAL_FILE=.tm-debug/eval.js npm start
```

The app then asks, in a dialog, whether to enable the bridge. Nothing is evaluated unless you accept. Once accepted, writing JavaScript to that file runs it in the Messenger renderer and produces:

- `.tm-debug/eval.js.out` — the return value, JSON-stringified when it isn't a string, or `ERROR: <message>` if the command threw,
- `.tm-debug/eval.js.png` — a screenshot of the window taken after the command ran.

```bash
echo 'document.querySelectorAll(".tm-statusline").length' > .tm-debug/eval.js
cat .tm-debug/eval.js.out
```

Notes:

- **Each write must be self-contained.** The file is polled and each change runs as one independent command, so state doesn't carry between writes. Facebook also re-anchors its virtualised message list between commands, which means a selector resolved in one write may be stale by the next — resolve and use it in the same command.
- **Consent is per launch and is not remembered.** Quitting the app turns the bridge off; the next launch asks again. There is no persisted opt-in by design.
- **The artifacts contain your conversations.** `.out` dumps and `.png` screenshots are captures of a logged-in session, written unencrypted. `.tm-debug/` is gitignored for this reason — keep the path inside it.
- Set no env var and the bridge does not exist: the poll timer is never created, so a normal build and a normal `npm start` carry none of this.

## Privacy and safety model

This is intentionally a visual wrapper. It avoids:

- private Messenger endpoints,
- automated message sending,
- background scraping,
- storing copies of conversations,
- bypassing Facebook login or security flows.

The one deliberate exception is the [debug eval bridge](#debug-eval-bridge), which does read the live DOM and write screenshots to disk. It is development tooling, off by default, and gated behind both an environment variable and an explicit dialog — but it is a real code path into a logged-in session, so it is called out here rather than buried.

Any CSS/DOM selectors that affect Facebook's interface may break when Facebook changes the web app.

## Known limitations

- Facebook uses generated class names and frequently changes markup, so the theme is best-effort. Some areas may remain partially unstyled, and commands like `:focus search` or `:unread` use heuristic selectors.
- The build is unsigned; macOS Gatekeeper will challenge the first launch unless you clear the quarantine attribute.
- Memory grows over long sessions because of Facebook's React tree and message backbuffer; the hourly background reload partially mitigates this. The reload is skipped while the window is focused, while a draft is in the composer, or while audio/video is playing, so it can be delayed well past the hour mark.

## Troubleshooting

If login or rendering gets stuck, try:

```bash
npm run clean-profile
npm start
```

If the page blocks or challenges the login, sign in through the normal browser flow shown in the app window. Do not automate login.
