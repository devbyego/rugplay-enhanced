# Rugplay Enhanced

**Rugplay Enhanced** is a premium, QoL-first userscript for `rugplay.com` — designed to feel like a clean pro dashboard (not a janky overlay).

## Highlights

- **Enhanced panel** (`Ctrl+Shift+E` or sidebar **Enhanced**) with tabs:
  - **Dashboard**: live trade feed, filters, market radar (hot coins / whale radar / stats)
  - **Alerts**: price alerts (above/below) with toasts (optional desktop notifications)
  - **Reporter**: rugpull reporter + community reports
  - **Settings**: adblock, sticky portfolio, force dark mode, compact mode, etc.
  - **Status**: built-in diagnostics for WebSocket + API health
- **Coin page tools** (next to Buy/Sell panel):
  - **Recent Transactions** (vaaq API with fallback)
  - **Risk Assessment**
  - **My Notes** (local-only)
- **Quick Search** (`Ctrl+K`)
  - Uses Rugplay search when available
  - Falls back to live-feed search + direct jump when Rugplay search is down
- **No “watching/watchlist” clutter**

## Install

1. Install a userscript manager:
   - Tampermonkey (Chrome/Edge)
   - Violentmonkey (Firefox/Chrome)
2. Install `rugplay-enhanced.user.js` in your manager.
3. Open `https://rugplay.com/` and refresh.

## Usage

- **Open panel**: `Ctrl+Shift+E` (or sidebar **Enhanced**, or `https://rugplay.com/#rugplay-enhanced`)
- **Quick Search**: `Ctrl+K`
- **Force Dark Mode**: Panel → **Settings** tab → toggle **Force Dark Mode**

## Reporter / Community Reports

Community reports are loaded from the Rugplay Enhanced API.

If the API is down, submits will **save locally** on your device so you can still use the feature tonight. The Reporter tab will show local-only reports until the API returns.

## Troubleshooting

Open the panel and go to **Status**:

- **WebSocket = 0 msgs**: Rugplay may have changed WebSocket hostnames or you’re not seeing live trades yet.
- **Enhanced API errors**: Reporter/community features may be degraded until the API is back.

## Dev / Releases

The userscript header includes:

- `@downloadURL` / `@updateURL` pointing at GitHub Releases.

Publish a Release and attach `rugplay-enhanced.user.js` so auto-update works.

