<div align="center">
  
<img src="https://raw.githubusercontent.com/devbyego/rugplay-enhanced/refs/heads/main/main/icon.svg" width="200" />

# Rugplay Enhanced

**The #1 Tampermonkey userscript for [Rugplay](https://rugplay.com)**

[![Version](https://img.shields.io/badge/version-1.2.0-111111?style=flat-square&labelColor=111111&color=ffffff)](https://github.com/devbyego/rugplay-enhanced/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-111111?style=flat-square&labelColor=111111&color=ffffff)](./LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-required-111111?style=flat-square&labelColor=111111&color=ffffff)](https://www.tampermonkey.net/)

120 mods · Live heatmap · Coin scanner · Price alerts · Watchlist · Risk scoring · Bot detection · Session journal · P&L tracker · Export tools

100% Rugplay's own API · Zero tracking · Zero third-party servers · Free forever

</div>

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Go to [Releases](https://github.com/devbyego/rugplay-enhanced/releases/latest)
3. Download **Rugplay Enhanced-1.20.user.js**
4. Drag it into the Tampermonkey dashboard → click Install
5. Navigate to [rugplay.com](https://rugplay.com)
6. Click **Enhanced** in the left sidebar

**Keyboard shortcuts**

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+E` | Toggle Enhanced panel |
| `Ctrl+K` | Quick search |

---

## Features

### Panel tabs

| Tab | Description |
|---|---|
| Dashboard | Live feed, market radar, heatmap, portfolio chart, sentiment bar |
| Scanner | Real-time new coin detection with risk scoring, gem finder, gainers/losers |
| Watchlist | Live prices, watchlist-only feed, quick add/remove |
| Alerts | Price alerts, configurable thresholds, alert history, test tools |
| Journal | Searchable session log of every event |
| Reporter | Submit and browse community rugpull reports |
| Mods | All 120 mods with search, category filter, all on/off |
| vs Plus | Honest feature comparison with Rugplay Plus |
| Status | Diagnostics, changelog, export/import/reset settings |

### 120 mods across 6 categories

**Interface** — Ad blocker, compact sidebar, focus mode, smooth scrolling, sticky portfolio, URL shortcuts, keyboard shortcuts, better scrollbars, and more

**Trading** — Transaction card on coin pages, risk assessment card, coin notes, watchlist, P&L tracker, trade history modal on profiles, cost basis, clickable table rows, and more

**Alerts** — Bot detection, volume spike alerts, whale radar, creator sell alert, new coin alert, holder drop alert, price drop alert, desktop notifications, sound alerts, and more

**Privacy** — Appear offline, hide balance, blur portfolio, block analytics, strip tracking params, anonymous mode, mute creator trades, and more

**Display** — Force dark mode, live heatmap, portfolio sparkline, trade timeline, sentiment bar, compact feed, session stats bar, export tools, and more

**Experimental** — Slippage tracker, live bid/ask, cost basis, coin scanner, risk auto-block, and more

### On-page injections

- **Risk Assessment Card** — 0–100 risk score on every coin page based on age, holder count, market cap and sell pressure
- **Recent Transactions Card** — live paginated trade history on every coin page
- **Coin Notes** — private local notes on every coin page
- **Watch + History buttons** — on every user profile page
- **Reported Badge** — community warning badge on flagged coins

---

## Changelog

### v1.2.0 — The Intelligence Update
- 120 mods, all implemented
- New tabs: Scanner, Journal, Watchlist Feed, Gem Finder
- Live heatmap, portfolio sparkline, sentiment bar, trade timeline
- Session stats bar, alert history, threshold configurators
- Export feed (JSON/CSV), watchlist, journal, settings
- Fixed: watchlist delete buttons, sidebar poller on SPA navigation, settings cache, hash-on-load panel, missing `</style>` tag, flex layout collapse

### v1.1.0
- Full panel redesign with XP design system
- Spread tracker, slippage tracker, cost basis tracker
- Holder drop monitor, risk change monitor
- Report poller, trade interceptor, portfolio highlighter

### v1.0.0
- Initial release
- Price alerts, watchlist, live feed, risk scoring, bot detection
- Quick search, coin notes, rugpull reporter
- Sidebar injection, keyboard shortcuts

---

## How it works

Rugplay Enhanced intercepts Rugplay's own WebSocket connection (`wss://ws.rugplay.com`) and listens to the same live trade stream the site uses. No third-party APIs, no external data sources, no tracking. Every feature runs on data Rugplay already sends to your browser.

Settings are stored in Tampermonkey's GM storage — local to your browser, never uploaded anywhere.

---

## Privacy

- No analytics collected
- No username or session data sent anywhere
- No third-party network requests except to `rugplay-enhanced-api.rugplay-enhanced.workers.dev` for the reporter feature (community-submitted rugpull reports) and update checking
- All settings stored locally in Tampermonkey GM storage

---

## Author

Built by **devbyego**

- GitHub: [@devbyego](https://github.com/devbyego)
- Discord: `devbyego`
- Rugplay: `@ego`

---

## License

MIT — do whatever you want, just don't remove the author credit.
