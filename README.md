# Terminal Messenger

A small Electron MVP that wraps the Facebook Messages web UI and injects a minimal terminal-style skin.

It does **not** use private Messenger APIs, scrape messages, or implement its own Messenger protocol. Facebook handles login, sync, encryption, attachments, and sending. This app only changes the presentation layer and adds local keyboard affordances.

## What it does

- Opens `https://www.facebook.com/messages` in an app window.
- Keeps your login in a separate Electron profile: `persist:terminal-messenger`.
- Injects terminal-inspired CSS.
- Adds a command palette.
- Adds a few local shortcuts.
- Opens non-Facebook links in your normal browser.

## Install

```bash
npm install
npm start
```

The app uses `electron@latest` as a dev dependency so you can test with your current Node/npm setup.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+Shift+P` | Open command palette |
| `Ctrl/Cmd+Shift+T` | Cycle theme |
| `Ctrl/Cmd+R` | Reload |
| `Alt+Left` | Back |
| `Alt+Right` | Forward |
| `Ctrl/Cmd+Shift+I` | DevTools |
| `/` while not typing | Open command palette |

## Palette commands

```text
:help
:focus message
:focus search
:theme green
:theme amber
:theme cyan
:theme mono
:compact on
:compact off
:unread
:reload
```

## Configuration

Edit `config/app.json`:

```json
{
  "homeUrl": "https://www.facebook.com/messages",
  "theme": "green",
  "compactByDefault": true
}
```

You can swap `homeUrl` to `https://www.messenger.com/` if that works better in your region/session.

## Privacy and safety model

This is intentionally a visual wrapper. It avoids:

- private Messenger endpoints,
- automated message sending,
- background scraping,
- storing copies of conversations,
- bypassing Facebook login or security flows.

Any CSS/DOM selectors that affect Facebook's interface may break when Facebook changes the web app.

## Known limitations

Facebook uses generated class names and frequently changes markup, so the theme is best-effort. Some areas may remain partially unstyled, and commands like `:focus search` or `:unread` use heuristic selectors.

## Troubleshooting

If login or rendering gets stuck, try:

```bash
npm run clean-profile
npm start
```

If the page blocks or challenges the login, sign in through the normal browser flow shown in the app window. Do not automate login.
