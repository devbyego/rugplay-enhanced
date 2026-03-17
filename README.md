<div align="center">

# Rugplay Enhanced 🚀

**Premium QoL userscript for [rugplay.com](https://rugplay.com)**  
Turns the site into a clean, pro-level trading dashboard — no clutter, no tracking, only Rugplay's own API.

[![Latest Release](https://img.shields.io/github/v/release/devbyego/RugplayEnhanced?color=green&label=latest&style=flat-square)](https://github.com/devbyego/RugplayEnhanced/releases/latest)
[![License](https://img.shields.io/github/license/devbyego/RugplayEnhanced?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/devbyego/RugplayEnhanced?style=flat-square&color=yellow)](https://github.com/devbyego/RugplayEnhanced/stargazers)
[![Open Issues](https://img.shields.io/github/issues/devbyego/RugplayEnhanced?style=flat-square&color=red)](https://github.com/devbyego/RugplayEnhanced/issues)

</div>

## ✨ Core Features

- **Enhanced Dashboard** (open with `Ctrl+Shift+E` or sidebar button)
  - Live trade feed with filters (coin/user/value/side)
  - Market radar: hot coins, whale alerts, session stats
  - Price alerts with desktop notifications
  - Rugpull reporter + community-voted reports
  - Built-in diagnostics (WebSocket + API health)
- **Coin Page Power-Ups**
  - Recent transactions history (via vaaq.dev fallback)
  - Risk scoring (LOW/MEDIUM/HIGH) with factors
  - Private local coin notes
- **Quick Search** (`Ctrl+K`) — fast coin/user lookup
- **Quality-of-Life Toggles**
  - Ad blocker
  - Force dark mode
  - Compact UI
  - Sticky portfolio in sidebar
  - Appear offline
  - Volume spike & bot pattern warnings
- **Zero external tracking** — everything stays client-side or uses Rugplay's own data

## 📥 Installation (30 seconds)

1. Install a userscript manager  
   • [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Edge / Firefox)  
   • [Violentmonkey](https://violentmonkey.github.io/) (recommended for Firefox)

2. Click this one-click install link:  
   [![Install from GitHub](https://img.shields.io/badge/Install-v1.0.0-brightgreen?style=for-the-badge&logo=github)](https://github.com/devbyego/RugplayEnhanced/releases/latest/download/rugplay-enhanced.user.js)

3. Open https://rugplay.com → the script activates automatically

Auto-updates are built-in via the `@updateURL` in the script.

## ⌨️ Keyboard Shortcuts

| Action              | Shortcut          | Alternative                     |
|---------------------|-------------------|---------------------------------|
| Open Enhanced Panel | `Ctrl + Shift + E`| Sidebar → "Enhanced" or `#rugplay-enhanced` URL |
| Quick Search        | `Ctrl + K`        | —                               |

## ⚠️ Reporter & API Notes

Community reports come from a lightweight backend API.  
If it's temporarily down:
- Reports save **locally** on your device
- You can still submit and view your own reports
- The **Status** tab shows real-time health checks

## 🛠️ Troubleshooting

Open the **Enhanced** panel → **Status** tab:

- **WebSocket: 0 messages** → Rugplay might have changed endpoints, or no live trades yet
- **Enhanced API errors** → Reporter/community features limited until restored

## 🖼️ Screenshots

(Add your screenshots here – upload to repo or use imgur/raw links)

<details>
<summary>Enhanced Dashboard (click to expand)</summary>

![Dashboard screenshot](https://via.placeholder.com/800x500?text=Enhanced+Dashboard+Preview)  
Live feed, filters, hot coins, whale radar, stats

</details>

<details>
<summary>Coin Page Enhancements</summary>

![Coin page screenshot](https://via.placeholder.com/800x500?text=Coin+Page+with+Risk+Score+and+Notes)  
Risk card, recent txs, personal notes

</details>

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Commit your changes (`git commit -m 'Add amazing thing'`)
4. Push to the branch (`git push origin feature/amazing-thing`)
5. Open a Pull Request

Bug reports, feature ideas, and UI tweaks are very welcome!

## 📜 License

MIT License — see [LICENSE](LICENSE) file.

Made with ❤️ by [devbyego](https://github.com/devbyego)  
Feedback? → [Open an issue](https://github.com/devbyego/RugplayEnhanced/issues/new)
