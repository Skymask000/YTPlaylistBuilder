# Privacy Policy — YT Playlist Builder

**Last updated:** 2026-09-05

## Summary

YT Playlist Builder is a Chrome/Edge browser extension that turns a pasted list of songs into a YouTube playlist on the user's own YouTube account. It runs entirely in the user's browser and communicates only with Google's own services (Google Sign-In and the YouTube Data API v3). It has no third-party servers, no analytics, no telemetry, and does not collect, transmit, or share personal data with anyone other than Google (which the user is already signed in to).

## Data the extension accesses

To function, the extension needs limited access to the user's Google account, granted via Google's OAuth 2.0 consent flow. The user sees Google's standard consent screen listing exactly what access is being granted, and can revoke it at any time from https://myaccount.google.com/permissions.

Specifically, the extension uses one OAuth scope:

- `https://www.googleapis.com/auth/youtube` — full YouTube account access.

Within that scope, the extension only performs the following operations on the user's behalf:

- **Read the list of playlists the user owns** (to populate the "Add to existing playlist" dropdown).
- **Read the user's channel name and avatar** (to display which account is currently signed in).
- **Create a new playlist** (only when the user chooses "Create new" and clicks "Add all").
- **Add videos to a playlist** (only when the user clicks "Add all" — the extension inserts one item per checked row).

The extension does NOT read the user's watch history, subscriptions, comments, or any other YouTube data. It does NOT modify or delete anything the user did not explicitly request through the popup UI. It does NOT read or modify data belonging to any account other than the signed-in one.

## Data the extension stores

All data is stored locally in the browser using Chrome's built-in `chrome.storage.local` API. Nothing is transmitted to any server other than Google's own OAuth and YouTube API endpoints.

Stored data:

- **OAuth access token** — a short-lived credential (typically valid for ~1 hour) received from Google after successful sign-in. Used to make API calls to YouTube on the user's behalf. Cached to avoid re-prompting on every action.
- **Signed-in account identity** — the YouTube channel name and avatar URL for the currently signed-in account, so the popup can display "signed in as [channel name]" without re-fetching every time.
- **In-progress run state** — the pasted song list, the search results (per-song matched title/channel/video ID), the selection state of each row, and the insertion progress. Persisted so runs survive popup close, browser restart, and (in the case of insert-phase interruptions) can be resumed from where they left off.

The user can clear all locally stored data at any time by:
- Clicking **Sign out** in the popup (clears the OAuth token and account identity).
- Clicking **Reset** at the bottom of the popup (clears the in-progress run state).
- Removing the extension from `chrome://extensions/` (clears everything).

## Data the extension does NOT collect or transmit

- No browsing history
- No YouTube watch history, subscription list, or comments
- No IP addresses
- No cookies
- No usage analytics or telemetry
- No crash reports
- No personally identifiable information beyond what's needed for the OAuth flow itself (which is between the user and Google, not the extension developer)

## Third parties

The extension makes network requests to only two categories of endpoint:

- **Google Sign-In** (`accounts.google.com`) — via `chrome.identity.launchWebAuthFlow`. Standard OAuth 2.0.
- **YouTube Data API v3** (`www.googleapis.com/youtube/v3/*`) — for the API operations listed above.

No requests are made to any developer-controlled server, third-party analytics service, or other external system.

## YouTube search results scraping

To find candidate videos for each song without consuming YouTube Data API quota, the extension fetches the public YouTube search results page (`https://www.youtube.com/results?search_query=...`) and parses the video metadata from the returned HTML. This is a read-only, unauthenticated request — no user data is sent, no cookies are attached beyond what the browser sends by default to youtube.com. The response is not stored or transmitted anywhere; only the parsed video IDs and titles are used to populate the match table in the popup.

## Changes to this policy

Any change to this policy will be reflected in this file (with an updated "Last updated" date) and noted in the extension's version notes on the Chrome Web Store.

## Contact

skymask000@gmail.com

## Source code

Full source: https://github.com/Skymask000/YTPlaylistBuilder
