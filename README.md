# YT Playlist Builder

Chrome/Edge extension. Paste a list of songs → get a YouTube playlist.

## What it does

Give it any of these formats and it turns them into a real YouTube playlist:

**Flat `Artist - Song` per line:**
```
Black Sabbath - Iron Man
Metallica - One
Rammstein - Du Hast
```

**Numbered blocks (artist header + songs under it):**
```
1. Black Sabbath

Iron Man
War Pigs
Paranoid

2. Metallica

One
Master of Puppets
```

For each song, the extension searches YouTube (scraping the public results page — no quota cost), picks the best match using channel-preference heuristics (prefers the artist's own channel, then `- Topic` and VEVO), then adds each match to a new or existing playlist on your YouTube account via the YouTube Data API v3.

## Features

- **Multi-account support.** Sign out, Add account (Google's account picker), current-account display with avatar + channel name.
- **Background execution.** Search and insert keep running after the popup closes. Reopen the popup any time to see current progress.
- **Per-row selection.** Every match gets a checkbox. Uncheck rows you don't want; the insert phase skips them.
- **Match confidence.** Rows marked *low confidence* usually indicate the artist's channel returned a wrong song (e.g. an album version instead of the title track). Review before adding.
- **Throttle-safe.** Randomized delays between search requests + retry-on-block logic. Handles YouTube's rate-limiting gracefully.
- **Resumable inserts.** If insertion is interrupted (popup closed, network hiccup, quota exceeded), progress is persisted — reopen and it picks up where it left off.
- **Create new or add to existing.** Pick a target playlist from your existing ones, or create a new one with your chosen privacy (unlisted / public / private).
- **Quota-conscious.** Search phase is free (HTML scraping). A 72-song run costs ~3,650 quota units — well under the daily 10,000 limit.

## Install

**From the Chrome Web Store:** (link forthcoming when v0.2.0 is published)

**Load unpacked for development:**

1. Clone this repo:
   ```
   git clone https://github.com/Skymask000/YTPlaylistBuilder.git
   ```
2. Open `chrome://extensions/` (or `edge://extensions/`).
3. Toggle **Developer mode**.
4. Click **Load unpacked** → select the cloned folder.
5. Pin the extension icon to your toolbar for easy access.

**OAuth setup (self-hosters only — the CWS build has this pre-configured):**

The extension uses `chrome.identity.launchWebAuthFlow` with a Web application OAuth client. To run it yourself:

1. Enable **YouTube Data API v3** in Google Cloud Console.
2. Create an OAuth Web application client.
3. Add `https://<your-extension-id>.chromiumapp.org/` as an authorized redirect URI (trailing slash matters). Your extension ID is visible on the extension card at `chrome://extensions/`.
4. Copy the client ID into `manifest.json` → `oauth2.client_id`.
5. Reload the extension.

Under Google Auth Platform → Audience, set testing mode and add your Gmail as a test user until you go through Google's verification for production use.

## Privacy

- No analytics, no telemetry, no crash reports.
- Zero servers — the extension has no backend of any kind.
- All settings and in-progress run state stored via `chrome.storage.local`. Nothing is transmitted anywhere except Google's own OAuth + YouTube Data API endpoints.
- Signed-in account credentials are handled by Chrome's `chrome.identity` API; the extension only receives and caches a short-lived access token.

## Tech stack

- Chrome/Edge Manifest V3 extension
- Vanilla JavaScript ES modules — no framework, no bundler, no build step
- Node's built-in `--test` runner for unit tests
- Service worker for background execution
- Chrome storage API for state persistence
- YouTube Data API v3 (playlists + playlistItems + channels endpoints)
- Public YouTube search results scraping (no `search.list` API — keeps quota comfortable)

## Development

```
npm test   # 21/21 unit tests
```

Load unpacked in Chrome/Edge and use the popup to test end-to-end. Manual verification is the primary QA cycle for extension-facing behavior.

## License

Not specified yet.
