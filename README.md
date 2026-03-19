<div align="center">

<img src="https://raw.githubusercontent.com/devbyego/rugplay-enhanced/main/icon.svg" width="96" />

# Rugplay Enhanced

**The #1 Tampermonkey userscript for [Rugplay](https://rugplay.com)**

[![Version](https://img.shields.io/badge/version-1.4.0-111?style=flat-square&color=ffffff&labelColor=111)](https://github.com/devbyego/rugplay-enhanced/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-111?style=flat-square&color=ffffff&labelColor=111)](./LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-required-111?style=flat-square&color=ffffff&labelColor=111)](https://www.tampermonkey.net/)

Live feed · Price alerts · Watchlist · Coin Sniper · Risk scoring · Bot detection · My Trades · Predictions · Leaderboard · Session journal · 100+ mods

Zero tracking · Zero third-party servers · All mods off by default · Free forever

</div>

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Chrome, Firefox, or Edge
2. Go to [Releases](https://github.com/devbyego/rugplay-enhanced/releases/latest)
3. Download the `.user.js` file
4. Drag it into the Tampermonkey dashboard → Install
5. Go to [rugplay.com](https://rugplay.com) — click **Enhanced** in the sidebar

**Keyboard shortcuts:** `Ctrl+Shift+E` toggle panel · `Ctrl+K` quick search

---

## Features

### Panel tabs

| Tab | What it does |
|---|---|
| Dashboard | Live WebSocket feed, market radar, live heatmap, portfolio sparkline, sentiment bar |
| Scanner | Detects new coins the moment they appear in the feed and scores them in real-time |
| Watchlist | Live prices from the feed, watchlist-only trade feed |
| Alerts | Price alerts that fire on WebSocket price data, alert history |
| Journal | Searchable session log of every alert, whale, bot detection and report |
| **Snipe** | Add target coins — auto-navigate + sound alert the instant they trade |
| My Trades | Your personal trade history from Rugplay's API |
| Predictions | Live YES/NO prediction markets with vote bars and your active bets |
| Leaderboard | Global rankings, whale leaderboard, session top coins |
| Reporter | Submit and browse community rugpull reports |
| Mods | 100+ toggleable mods — all off by default, enable what you want |
| Status | Diagnostics, changelog, export/import/reset settings |

### Coin Sniper

Type any coin symbol in the Snipe tab. Enhanced watches the live WebSocket feed around the clock. The moment that coin gets its first trade, it fires a sound alert and auto-navigates you to the coin page. For fastest execution, disable Confirm Trades in Mods.

### On-page injections (enable in Mods)

- **Transaction Card** — live paginated trade history on every coin page
- **Risk Assessment Card** — 0-100 risk score based on age, holders, market cap and sell pressure
- **Coin Notes** — private local notes on every coin page
- **Watch + History buttons** — on every user profile page
- **Reported Badge** — community warning on flagged coins
- **Fee Estimate** — shows ~0.3% fee before you trade

### 100+ mods across 6 categories

**Interface** — compact sidebar, focus mode, hide footer, smooth scrolling, auto-hide panel, quick copy symbol, URL shortcuts

**Trading** — transaction card, risk card, coin notes, P&L tracker, cost basis, watchlist, clickable portfolio rows, trade confirmation, fee estimate, holder count, coin age, creator tags

**Alerts** — whale ping, volume spike, bot detection, watchlist trade alert, creator sell alert, new coin alert, price drop alert, holder drop alert, desktop notifications, sound alerts

**Privacy** — appear offline, hide balance, blur portfolio, block analytics, strip tracking params, anonymous mode, mute creator trades

**Display** — live heatmap, portfolio sparkline, sentiment bar, trade timeline, session stats, export feed/watchlist/journal

**Experimental** — slippage tracker, live bid/ask, coin scanner, risk auto-block

---

## How it works

Rugplay Enhanced intercepts Rugplay's own WebSocket connection and listens to the same live trade stream the site uses. No third-party APIs, no external data, no tracking. Every feature runs on data Rugplay already sends to your browser.

Settings stored locally in Tampermonkey GM storage — never uploaded anywhere.

---

## Changelog

### v1.4.0 — The Sniper Update
- Coin Sniper — add a coin symbol, auto-navigate + sound the instant it trades
- Fixed: Confirm Trades on Firefox mobile — replaced window.confirm() with custom inline modal
- Fixed: confirmSells regex typo — was never detecting SELL buttons correctly
- All mods default OFF — fresh installs start clean, enable exactly what you want

### v1.3.0 — The Intelligence Update
- 3-column layout with fixed nav rail
- My Trades, Predictions, Leaderboard, Bug Report tabs
- Sidebar button rebuilt from scratch

### v1.2.0 — The Everything Update
- 100+ mods, live heatmap, coin scanner, session journal, portfolio chart, gem finder
- Export feed/watchlist/journal/settings
- Multiple bug fixes

### v1.1.0
- Full panel, price alerts, watchlist, live feed, risk scoring, bot detection

---

## Author

Built by **devbyego** · Discord: `devbyego` · Rugplay: `@ego`

MIT License
