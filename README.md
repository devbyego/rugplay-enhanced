<div align="center">

<img src="https://raw.githubusercontent.com/devbyego/rugplay-enhanced/refs/heads/main/main/icon.svg" width="200" />

# Rugplay Enhanced
**The #1 Tampermonkey userscript for [Rugplay](https://rugplay.com)**

[![Version](https://img.shields.io/badge/version-1.3.0-111111?style=flat-square&labelColor=111111&color=22c55e)](https://github.com/devbyego/rugplay-enhanced/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-111111?style=flat-square&labelColor=111111&color=ffffff)](./LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-required-111111?style=flat-square&labelColor=111111&color=ffffff)](https://www.tampermonkey.net/)

**120+ mods** · Live heatmap · Coin scanner · Price alerts · Watchlist · Risk scoring · Bot detection · Session journal · P&L tracker · Export tools

**New in 1.3.0**: Auto-Snipe Launches, Liquidity Rug Detector, Dev Wallet Tracker, Live Slippage Estimator, One-Click Max Buy/Sell

**100% Rugplay's own API** · Zero tracking · Zero third-party servers · Free forever

</div>

---

## Install

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** for your browser
2. Go to the [latest release](https://github.com/devbyego/rugplay-enhanced/releases/latest)
3. Click **rugplay-enhanced.user.js** (or drag it into Tampermonkey)
4. Click **Install**
5. Go to [rugplay.com](https://rugplay.com)
6. Click **Enhanced** in the left sidebar to open the panel

### Keyboard Shortcuts
| Shortcut       | Action                    |
|----------------|---------------------------|
| `Ctrl + Shift + E` | Toggle Enhanced panel    |
| `Ctrl + K`     | Quick search              |

---

## What's New in 1.3.0

- **Auto-Snipe Launches** — Detects and reacts to brand new coin creations
- **Liquidity Rug Detector** — Alerts when liquidity is removed from pools
- **Dev Wallet Tracker** — Highlights when coin creators sell their own bags
- **Live Slippage Estimator** — Real-time slippage display on coin pages
- **One-Click Max Buy / Max Sell** — Faster trading flow
- Significantly improved WebSocket interceptor stability
- Cleaner mod system and better SPA navigation handling

---

## Features

### Panel Tabs
- **Dashboard** — Live feed, market radar, heatmap, portfolio chart, sentiment bar
- **Scanner** — Real-time new coin detection with risk scoring, gem finder, gainers/losers
- **Watchlist** — Live prices + watchlist-only feed
- **Alerts** — Price alerts, volume spikes, bot detection, alert history
- **Journal** — Searchable session log of all events
- **Reporter** — Submit and browse community rugpull reports
- **Mods** — 120+ mods with search and category filtering
- **Status** — Diagnostics, changelog, export/import/reset

### On-Page Injections
- Risk Assessment Card (0–100 score)
- Recent Transactions Card (live + paginated)
- Private Coin Notes
- Watch + History buttons on profiles
- Community Reported badges
- Creator sell highlighting

### 120+ Mods Across 6 Categories
**Interface** — Ad blocker, compact mode, focus mode, sticky portfolio, URL shortcuts, better scrollbars, etc.  
**Trading** — Risk cards, transaction history, coin notes, P&L tracker, cost basis, clickable rows, etc.  
**Alerts** — Bot detection, volume spikes, whale radar, creator sell alerts, new coin alerts, etc.  
**Privacy** — Appear offline, hide balance, blur portfolio, block analytics, anonymous mode, etc.  
**Display** — Live heatmap, portfolio sparkline, trade timeline, sentiment bar, export tools, etc.  
**Experimental** — Slippage estimator, risk auto-block, live bid/ask, gem finder, etc.

---

## How It Works

Rugplay Enhanced directly intercepts Rugplay’s own WebSocket (`wss://ws.rugplay.com`) and listens to the same live trade, coin creation, and pool events the site uses.

- No external APIs for core functionality  
- No tracking or telemetry  
- All settings stored locally in Tampermonkey (`GM_setValue`)  
- The reporter feature optionally uses a minimal public API for community reports

---

## Privacy

- Zero tracking of your activity
- No username or session data is sent anywhere (except optional reports you choose to submit)
- All settings and notes are stored only in your browser

---

## Changelog

### v1.3.0 — Major Mod Expansion (Current)
- Added 5 real mods based on the official Rugplay simulator (outpoot/rugplay)
- Auto-Snipe Launches, Liquidity Rug Detector, Dev Wallet Tracker, Live Slippage Estimator, One-Click Max actions
- Improved WS patching reliability and SPA navigation stability

### v1.2.0 — The Intelligence Update
- 120 mods fully implemented
- New Scanner, Journal, Gem Finder, live heatmap, portfolio sparkline, sentiment bar
- Export tools, alert history, better settings persistence

### v1.0.0
- Initial release with core features

---

## Author

Built by **devbyego**

- GitHub: [@devbyego](https://github.com/devbyego)
- Discord: `devbyego`
- Rugplay: `@ego`

---

## License

MIT License — Free to use, modify, and distribute (please keep author credit).

---

**Made for the Rugplay community.**  
No paywalls. No tracking. Just pure edge.
