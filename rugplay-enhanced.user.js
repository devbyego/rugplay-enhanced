// ==UserScript==
// @name         Rugplay Enhanced
// @version      1.1.0
// @icon         https://raw.githubusercontent.com/devbyego/rugplay-enhanced/main/icon.png
// @description  The #1 Rugplay userscript: price alerts, watchlist, live feed, risk scoring, bot & volume alerts, P&L, quick search (Ctrl+K), coin notes, rugpull reporter. 100% Rugplay's own API — no third-party servers. Zero tracking.
// @author       devbyego
// @match        https://rugplay.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_info
// @grant        unsafeWindow
// @connect      rugplay-enhanced-api.rugplay-enhanced.workers.dev
// @connect      rugplay.com
// @run-at       document-start
// @downloadURL  https://github.com/devbyego/rugplay-enhanced/releases/latest/download/rugplay-enhanced.user.js
// @updateURL    https://github.com/devbyego/rugplay-enhanced/releases/latest/download/rugplay-enhanced.user.js
// ==/UserScript==

(function () {
    'use strict';

    const RE_API = 'https://rugplay-enhanced-api.rugplay-enhanced.workers.dev';

    const wsInterceptor = {
        _patched: false,
        _cbs: [],
        stats: { lastMsgAt: 0, count: 0 },
        patch() {
            if (this._patched) return;
            this._patched = true;

            const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

            // Bridge messages from page context -> userscript context
            window.addEventListener('message', (ev) => {
                const d = ev?.data;
                if (!d || d.__re_source !== 'ws') return;
                this.stats.lastMsgAt = Date.now();
                this.stats.count += 1;
                this._cbs.forEach(fn => { try { fn(d.payload); } catch {} });
            });

            // Prefer patching pageWindow.WebSocket directly (works even under CSP).
            const patchWebSocketDirect = () => {
                try {
                    const WS = pageWindow.WebSocket;
                    if (!WS || !WS.prototype || WS.prototype.__rePatched) return true;
                    const Orig = WS;
                    const self = this;
                    function PW(...a) {
                        const ws = new Orig(...a);
                        try {
                            const url = a && a[0];
                            if (typeof url === 'string' && url.startsWith('wss://ws.rugplay.com')) {
                                ws.addEventListener('message', (ev) => {
                                    try {
                                        const post = (payload) => window.postMessage({ __re_source: 'ws', payload }, '*');
                                        const parseAndPost = (txt) => {
                                            try { post(JSON.parse(txt)); }
                                            catch { post({ __re_unparsed: true }); }
                                        };
                                        if (typeof ev.data === 'string') { parseAndPost(ev.data); return; }
                                        if (ev.data instanceof ArrayBuffer) {
                                            const txt = new TextDecoder('utf-8').decode(new Uint8Array(ev.data));
                                            parseAndPost(txt);
                                            return;
                                        }
                                        if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
                                            ev.data.text().then(parseAndPost).catch(() => post({ __re_unparsed: true }));
                                            return;
                                        }
                                        post({ __re_unparsed: true });
                                    } catch {}
                                });
                            }
                        } catch {}
                        return ws;
                    }
                    PW.prototype = Orig.prototype;
                    try { Object.keys(Orig).forEach(k => { PW[k] = Orig[k]; }); } catch {}
                    pageWindow.WebSocket = PW;
                    pageWindow.WebSocket.prototype.__rePatched = true;
                    return true;
                } catch { return false; }
            };

            if (patchWebSocketDirect()) return;

            // Fallback: Patch WebSocket in *page* context via script injection (may be blocked by CSP).
            const inject = () => {
                try {
                    const s = document.createElement('script');
                    s.textContent = `(() => {
  try {
    if (window.WebSocket && window.WebSocket.prototype && window.WebSocket.prototype.__rePatched) return;
    const Orig = window.WebSocket;
    function PW(...a) {
      const ws = new Orig(...a);
      try {
        const url = a && a[0];
        if (typeof url === 'string' && url.startsWith('wss://ws.rugplay.com')) {
          ws.addEventListener('message', (ev) => {
            try {
              const post = (payload) => window.postMessage({ __re_source: 'ws', payload }, '*');
              const parseAndPost = (txt) => {
                try { post(JSON.parse(txt)); }
                catch { post({ __re_unparsed: true }); }
              };
              if (typeof ev.data === 'string') {
                parseAndPost(ev.data);
                return;
              }
              if (ev.data instanceof ArrayBuffer) {
                const txt = new TextDecoder('utf-8').decode(new Uint8Array(ev.data));
                parseAndPost(txt);
                return;
              }
              if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
                ev.data.text().then(parseAndPost).catch(() => post({ __re_unparsed: true }));
                return;
              }
              post({ __re_unparsed: true });
            } catch {}
          });
        }
      } catch {}
      return ws;
    }
    PW.prototype = Orig.prototype;
    try { Object.keys(Orig).forEach(k => { PW[k] = Orig[k]; }); } catch {}
    window.WebSocket = PW;
    window.WebSocket.prototype.__rePatched = true;
  } catch {}
})();`;
                    (document.documentElement || document.head || document.body).appendChild(s);
                    s.remove();
                } catch {}
            };

            if (document.documentElement) inject();
            else document.addEventListener('DOMContentLoaded', inject, { once: true });
        },
        on(fn) { this._cbs.push(fn); },
        off(fn) { this._cbs = this._cbs.filter(c => c !== fn); },
    };
    wsInterceptor.patch();

    const pathname = window.location.pathname;
    // urlShortcuts: check stored setting (defaults to true) before doing redirects
    const _urlShortcutsEnabled = (() => { try { const v = GM_getValue('re:cfg', null); const c = v ? JSON.parse(v) : {}; return c.urlShortcuts !== false; } catch { return true; } })();
    if (_urlShortcutsEnabled) {
        const userMatch = pathname.match(/^\/@([a-zA-Z0-9_.-]+)$/);
        if (userMatch) { window.location.replace(`https://rugplay.com/user/${userMatch[1]}`); return; }
        const coinMatch = pathname.match(/^\/\*([A-Z0-9]+)$/i);
        if (coinMatch) { window.location.replace(`https://rugplay.com/coin/${coinMatch[1].toUpperCase()}`); return; }
    }

    const store = {
        get: (k, d = null) => { const v = GM_getValue(k, null); if (v === null) return d; try { return JSON.parse(v); } catch { return v; } },
        set: (k, v) => GM_setValue(k, JSON.stringify(v)),
        settings: () => {
            const DEFAULTS = {
                // ── Interface ─────────────────────────────────────────────
                adblock:true, notifications:true, stickyPortfolio:false, appearOffline:false,
                showPnL:true, compactMode:false, forceDark:true, autoOpenPanel:false, panelTab:'dashboard',
                clickableRows:true, sidebarSearch:true, urlShortcuts:true, focusMode:false,
                hideFooter:false, hideOnlineCount:false, hidePromoBar:false, monoFont:false,
                largeClickTargets:true, smoothScrolling:true, hideEmptyPortfolio:false,
                dimInactiveTabs:false, highlightNewCoins:true, showCoinAge:true, showHolderCount:true,
                hideVerifiedBadge:false, borderlessCards:false, reducedMotion:false, sidebarCompact:false,
                hideRightSidebar:false, pinFavoriteCoins:false, hideOfflineDM:true,
                // ── Trading ───────────────────────────────────────────────
                txCard:true, riskScore:true, riskCard:true, reportedBadge:true, coinNotes:true,
                showPriceChange:true, showVolume24h:true, showMarketCap:true, warnLowLiquidity:true,
                holdersWarning:true, showCreatorBadge:true, txTimestamps:true, txHighlightNew:true,
                txShowAvatar:false, quickBuyButtons:false, confirmTrades:true, showSpread:true,
                priceDecimals:6, showCandleColors:true, highlightWhaleTrades:true, whaleTxMin:500,
                showPortfolioPercent:true, showPortfolioCostBasis:false, trackSlippage:false,
                showFeeEstimate:true, highlightProfitLoss:true, showBidAsk:false,
                // ── Detection & Alerts ────────────────────────────────────
                botWarning:true, volumeSpikes:true, desktopAlerts:false, whalePing:true,
                flashTitle:true, soundAlerts:false, alertOnNewCoin:false, alertOnHolderDrop:false,
                alertOnPriceDrop:false, priceDropPct:20, alertOnVolumeSpike:true, volumeSpikeUsd:5000,
                alertOnBotActivity:true, alertOnNewReport:false, alertOnWatchlistTrade:true,
                alertOnRiskChange:false, alertOnCreatorSell:false,
                // ── Privacy & Security ────────────────────────────────────
                hideBalance:false, blurPortfolioValue:false, anonymousMode:false,
                blockAnalytics:true, stripTrackingParams:true, noReferrer:false,
                // ── Cosmetic ──────────────────────────────────────────────
                tradeFeedBuyColor:'#22c55e', tradeFeedSellColor:'#ef4444',
                accentColor:'default', cardRadius:'xl', feedCompact:false,
                feedMaxRows:80, timestampFormat:'relative', numberFormat:'abbreviated',
                // ── Experimental ─────────────────────────────────────────
                profileHistory:true, profileWatch:true, quickSearch:true,
                watchlistAlerts:true, autoRefreshFeed:true, preloadCoinData:false,
                betterScrollbars:true, keyboardShortcuts:true, devMode:false,
            };
            return { ...DEFAULTS, ...store.get('re:cfg', {}) };
        },
        cfg: (k, v) => { const s = store.settings(); s[k] = v; store.set('re:cfg', s); },
        alerts: () => store.get('re:al', []),
        alSet: v => store.set('re:al', v),
        portfolio: () => store.get('re:pf', { snaps: [] }),
        pfSet: v => store.set('re:pf', v),
        notes: () => store.get('re:notes', {}),
        notesSet: v => store.set('re:notes', v),
        localReports: () => store.get('re:reports_local', []),
        localReportsSet: v => store.set('re:reports_local', v),
    };

    const CONFIG = {
        selectors: {
            notificationBadge: 'a[href="/notifications"] > div',
            tableSelectors: ['main table tbody', 'table tbody'],
            coinImageSelectors: ['img[alt]', 'img'],
            profileHeaderContainer: 'main > div > div > div > div > div > div.bg-card.text-card-foreground.flex.flex-col',
            loggedInUserSpan: '#bits-c1 > div.grid.flex-1.text-left.text-sm.leading-tight > span.truncate.text-xs',
            profileUsernameMeta: 'meta[property="og:title"]',
            coinPageCardContainer: 'main div.lg\\:col-span-1',
            mainContent: 'main',
            sidebarMenuList: 'ul[data-sidebar="menu"]',
            sidebarFirstItem: 'li[data-sidebar="menu-item"]:first-child',
        },
        ids: {
            enhancedBtn: 're-enhanced-btn',
            searchBtn: 're-search-btn',
            panelWrapper: 're-panel-wrapper',
            feedbackModal: 're-feedback-modal',
            reportedCreatorBadge: 're-reported-badge',
            historyModalOverlay: 're-history-overlay',
            historyModalBody: 're-history-body',
            historyModalPagination: 're-history-pagination',
            historyModalUsername: 're-history-username',
            coinTxCard: 're-tx-card',
            coinTxBody: 're-tx-body',
            coinTxPagination: 're-tx-pagination',
            coinTxRefresh: 're-tx-refresh',
            coinRiskCard: 're-risk-card',
            coinNoteCard: 're-note-card',
            profileBtns: 're-profile-btns',
            watchBtn: 're-watch-btn',
            pnlEl: 're-pnl',
        },
        intervals: {
            init: 300,
            tsUpdate: 1000,
            updateCheck: 900000,
        },
    };

    const ICONS = {
        enhanced: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"/></svg>`,
        loading: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="re-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
        history: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
        edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
        alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    };

    const utils = {
        isUserPage: () => window.location.href.includes('/user/'),
        isCoinPage: () => window.location.href.includes('/coin/'),
        getCoinSymbol: () => { const m = window.location.pathname.match(/\/coin\/([^/?#]+)/); return m ? m[1].toUpperCase() : null; },
        getUsernameFromPage: () => { const m = document.querySelector(CONFIG.selectors.profileUsernameMeta)?.getAttribute('content')?.match(/\(@([^)]+)\)/); return m?.[1]?.trim() ?? null; },
        getLoggedInUsername: async (timeout = 10000) => { let e = 0; while (e < timeout) { const el = document.querySelector(CONFIG.selectors.loggedInUserSpan); if (el?.textContent?.trim()) return el.textContent.replace('@', '').trim(); await utils.sleep(100); e += 100; } return null; },
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        debounce: (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
        ago: ts => { if (!ts) return '?'; const s = Math.floor((Date.now() - +ts) / 1000); if (s < 2) return 'just now'; if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; },
        date: ts => { if (!ts) return '?'; return new Date(+ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); },
        num: n => { n = +n || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'; return n.toFixed(4); },
        usd: n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(+n || 0),
        findElement: sels => { for (const s of sels) { try { const el = document.querySelector(s); if (el) return el; } catch {} } return null; },
        uid: () => typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36),
    };

    const api = {
        req: (method, path, body) => new Promise((res, rej) => GM_xmlhttpRequest({
            method, url: `${RE_API}${path}`,
            headers: { 'Content-Type': 'application/json' },
            data: body ? JSON.stringify(body) : undefined,
            timeout: 10000,
            onload: r => { try { res(JSON.parse(r.responseText)); } catch { rej(new Error('parse')); } },
            onerror: () => rej(new Error('network')),
            ontimeout: () => rej(new Error('timeout')),
        })),
        get: p => api.req('GET', p),
        post: (p, b) => api.req('POST', p, b),
    };

    const rugplayApi = {
        coinTrades: async (sym, page = 1, limit = 10) => {
            const r = await fetch(`/api/coin/${sym}/trades?page=${page}&limit=${limit}`, { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error('fetch_failed');
            return r.json();
        },
        userTrades: async (user, page = 1, limit = 15) => {
            const r = await fetch(`/api/user/${user}/trades?page=${page}&limit=${limit}`, { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error('fetch_failed');
            return r.json();
        },
        search: async (q) => {
            const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error('fetch_failed');
            return r.json();
        },
        portfolio: async () => {
            const r = await fetch('/api/portfolio/summary', { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error('fetch_failed');
            return r.json();
        },
    };

    class URLWatcher {
        constructor() { this.href = location.href; this.cbs = []; }
        on(fn) { this.cbs.push(fn); return this; }
        start() {
            const chk = () => { if (location.href !== this.href) { const p = this.href; this.href = location.href; this.cbs.forEach(fn => { try { fn(this.href, p); } catch {} }); } };
            setInterval(chk, 300);
            window.addEventListener('popstate', chk);
            window.addEventListener('hashchange', chk);
            return this;
        }
    }

    const notifier = {
        container: null,
        init() { if (!this.container) { this.container = document.createElement('div'); this.container.id = 're-notifier'; document.body.appendChild(this.container); } },
        show({ title, description, type = 'info', duration = 5000, actions = [] }) {
            this.init();
            const colors = { info: '#3b82f6', success: '#22c55e', warning: '#f59e0b', error: '#ef4444' };
            const icons = {
                info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
                success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
                warning: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
            };
            const n = document.createElement('div');
            n.className = 're-notif';
            n.innerHTML = `<div class="re-notif-icon" style="color:${colors[type]}">${icons[type]}</div><div class="re-notif-body">${title ? `<div class="re-notif-title">${title}</div>` : ''}<div class="re-notif-desc">${description}</div>${actions.length ? `<div class="re-notif-actions">${actions.map((a, i) => `<button class="re-notif-btn ${i === 0 ? 'primary' : 'secondary'}" data-i="${i}">${a.label}</button>`).join('')}</div>` : ''}</div><button class="re-notif-close" title="Close">${ICONS.close}</button>`;
            const kill = () => { n.classList.add('re-notif-out'); n.addEventListener('animationend', () => n.remove(), { once: true }); };
            n.querySelector('.re-notif-close').onclick = kill;
            n.querySelectorAll('.re-notif-btn').forEach(b => b.onclick = () => { actions[+b.dataset.i]?.onClick?.(); kill(); });
            this.container.appendChild(n);
            if (duration > 0) setTimeout(kill, duration);
            return n;
        },
        ok: (desc, o = {}) => notifier.show({ ...o, description: desc, type: 'success' }),
        err: (desc, o = {}) => notifier.show({ ...o, description: desc, type: 'error' }),
        warn: (desc, o = {}) => notifier.show({ ...o, description: desc, type: 'warning' }),
        info: (desc, o = {}) => notifier.show({ ...o, description: desc, type: 'info' }),
    };

    const diagnostics = {
        state: { lastApiOkAt: 0, lastApiErrAt: 0, lastApiErr: '', lastReportOkAt: 0, lastReportErrAt: 0, lastReportErr: '' },
        async pingApi() {
            try {
                const r = await api.get('/v1/update');
                if (r?.status === 'success') this.state.lastApiOkAt = Date.now();
                else throw new Error('bad_response');
            } catch (e) {
                this.state.lastApiErrAt = Date.now();
                this.state.lastApiErr = String(e?.message || e);
            }
        },
        render() {
            if (!enhancedPanel.isVisible) return;
            const el = document.getElementById('re-diag');
            if (!el) return;
            const wsAge = wsInterceptor.stats.lastMsgAt ? `${utils.ago(wsInterceptor.stats.lastMsgAt)}` : 'never';
            const apiOk = this.state.lastApiOkAt ? utils.ago(this.state.lastApiOkAt) : 'never';
            el.innerHTML = `
                <div class="re-stat-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
                    <div class="re-stat"><div class="re-stat-k">WebSocket</div><div class="re-stat-v">${wsInterceptor.stats.count ? `${wsInterceptor.stats.count} msgs` : '0 msgs'}</div><div class="re-mini-sub">last: ${wsAge}</div></div>
                    <div class="re-stat"><div class="re-stat-k">Enhanced API</div><div class="re-stat-v">${apiOk}</div><div class="re-mini-sub">${this.state.lastApiErrAt ? `err: ${utils.ago(this.state.lastApiErrAt)}${this.state.lastApiErr ? ` (${this.state.lastApiErr})` : ''}` : ''}</div></div>
                    <div class="re-stat"><div class="re-stat-k">Reports</div><div class="re-stat-v">${this.state.lastReportOkAt ? utils.ago(this.state.lastReportOkAt) : '—'}</div><div class="re-mini-sub">${this.state.lastReportErrAt ? `err: ${utils.ago(this.state.lastReportErrAt)}${this.state.lastReportErr ? ` (${this.state.lastReportErr})` : ''}` : ''}</div></div>
                </div>
            `;
        },
    };

    const notifications = {
        apply() {
            const enabled = store.settings().notifications;
            document.querySelectorAll(CONFIG.selectors.notificationBadge).forEach(b => { b.style.display = enabled ? '' : 'none'; });
        },
    };

    const adBlocker = {
        apply() {
            const enabled = store.settings().adblock;
            let el = document.getElementById('re-adblock');
            if (enabled && !el) { el = document.createElement('style'); el.id = 're-adblock'; el.textContent = `.GoogleActiveViewElement,[data-google-av-adk],[data-google-av-cxn],ins.adsbygoogle,iframe[src*="pagead2.googlesyndication.com"],iframe[src*="doubleclick.net"],div[id^="google_ads_iframe"],.ad-container,[class*="ns-"][data-nc]{display:none!important;height:0!important;width:0!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;position:absolute!important;z-index:-9999!important;}`; document.head.appendChild(el); }
            else if (!enabled && el) el.remove();
        },
    };

    const visibilitySpoof = {
        _patched: false,
        apply() {
            const enabled = !!store.settings().appearOffline;
            const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            if (!pageWindow?.document) return;
            if (!this._patched) {
                this._patched = true;
                try {
                    const doc = pageWindow.document;
                    const proto = Object.getPrototypeOf(doc);
                    const state = () => (!!store.settings().appearOffline);
                    const define = (obj, prop, getter) => {
                        try {
                            const desc = Object.getOwnPropertyDescriptor(obj, prop);
                            if (desc && desc.configurable === false) return;
                            Object.defineProperty(obj, prop, { configurable: true, get: getter });
                        } catch {}
                    };
                    define(doc, 'hidden', () => state());
                    define(proto, 'hidden', () => state());
                    define(doc, 'visibilityState', () => state() ? 'hidden' : 'visible');
                    define(proto, 'visibilityState', () => state() ? 'hidden' : 'visible');
                } catch {}
            }
            try {
                window.dispatchEvent(new CustomEvent('rpp_visibility_changed', { detail: { hidden: enabled } }));
                window.dispatchEvent(new CustomEvent('re_visibility_changed', { detail: { hidden: enabled } }));
            } catch {}
        },
    };

    const settingsEngine = {
        applyAll() {
            const s = store.settings();
            try { notifications.apply(); } catch {}
            try { adBlocker.apply(); } catch {}
            try { portfolioMover.apply(); } catch {}
            try { theme.apply(); } catch {}
            try { visibilitySpoof.apply(); } catch {}
            try { modStyles.apply(s); } catch {}

            // ── Body class flags ───────────────────────────────────────────────
            try { document.body.classList.toggle('re-compact', !!s.compactMode); } catch {}
            try { document.body.classList.toggle('re-mono', !!s.monoFont); } catch {}
            try { document.body.classList.toggle('re-focus', !!s.focusMode); } catch {}
            try { document.body.classList.toggle('re-borderless', !!s.borderlessCards); } catch {}
            try { document.body.classList.toggle('re-reduced-motion', !!s.reducedMotion); } catch {}
            try { document.body.classList.toggle('re-large-targets', !!s.largeClickTargets); } catch {}
            try { document.body.classList.toggle('re-better-scroll', !!s.betterScrollbars); } catch {}
            try { document.body.classList.toggle('re-blur-portfolio', !!s.blurPortfolioValue); } catch {}
            try { document.body.classList.toggle('re-hide-balance', !!s.hideBalance); } catch {}
            try { document.body.classList.toggle('re-sidebar-compact', !!s.sidebarCompact); } catch {}

            // ── Footer / promo bar ─────────────────────────────────────────────
            try { const f = document.querySelector('footer'); if (f) f.style.display = s.hideFooter ? 'none' : ''; } catch {}

            // ── Risk card removal ──────────────────────────────────────────────
            try { if (!s.riskScore) document.getElementById(CONFIG.ids.coinRiskCard)?.remove(); } catch {}

            // ── Desktop alert permission ───────────────────────────────────────
            try { if (s.desktopAlerts && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch {}

            // ── Anonymous mode — replace logged-in username display ────────────
            try {
                if (s.anonymousMode) {
                    document.querySelectorAll('[data-re-anon]').forEach(el => el.removeAttribute('data-re-anon'));
                    const me = document.querySelector(CONFIG.selectors.loggedInUserSpan);
                    if (me && !me.dataset.reAnonOrig) {
                        me.dataset.reAnonOrig = me.textContent;
                        me.dataset.reAnon = '1';
                        me.textContent = '@anon';
                    }
                } else {
                    document.querySelectorAll('[data-re-anon="1"]').forEach(el => {
                        if (el.dataset.reAnonOrig) { el.textContent = el.dataset.reAnonOrig; delete el.dataset.reAnonOrig; delete el.dataset.reAnon; }
                    });
                }
            } catch {}

            // ── Strip tracking params ──────────────────────────────────────────
            try {
                if (s.stripTrackingParams) {
                    const url = new URL(location.href);
                    const tracked = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','referrer','fbclid','gclid','msclkid','twclid','mc_cid','mc_eid'];
                    let changed = false;
                    tracked.forEach(p => { if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; } });
                    if (changed) history.replaceState({}, '', url.toString());
                }
            } catch {}

            // ── noReferrer — patch all external links ──────────────────────────
            try {
                if (s.noReferrer) {
                    document.querySelectorAll('a[href^="http"]:not([data-re-noreferrer])').forEach(a => {
                        a.dataset.reNoreferrer = '1';
                        const rel = new Set((a.rel || '').split(' ').filter(Boolean));
                        rel.add('noreferrer'); rel.add('noopener');
                        a.rel = [...rel].join(' ');
                    });
                }
            } catch {}

            // ── Dim inactive tabs ──────────────────────────────────────────────
            try {
                if (s.dimInactiveTabs) {
                    if (!document._reDimPatch) {
                        document._reDimPatch = true;
                        document.addEventListener('visibilitychange', () => {
                            if (!store.settings().dimInactiveTabs) return;
                            document.body.style.opacity = document.hidden ? '0.5' : '';
                        });
                    }
                } else {
                    document.body.style.opacity = '';
                }
            } catch {}

            // ── Flash tab title on alert ───────────────────────────────────────
            // (handled in alertEngine._chk via flashTitle flag — see below)

            // ── Sound alerts ───────────────────────────────────────────────────
            // (handled in alertEngine._chk via soundAlerts flag — see below)

            // ── Block analytics ────────────────────────────────────────────────
            try {
                if (s.blockAnalytics) {
                    if (!document.getElementById('re-analytics-block')) {
                        const el = document.createElement('style');
                        el.id = 're-analytics-block';
                        el.textContent = `
                            script[src*="analytics"],script[src*="gtag"],script[src*="segment"],
                            script[src*="mixpanel"],script[src*="amplitude"],script[src*="hotjar"],
                            img[src*="analytics"],img[src*="pixel"],img[src*="track"]
                            {display:none!important}
                        `;
                        document.head.appendChild(el);
                    }
                } else {
                    document.getElementById('re-analytics-block')?.remove();
                }
            } catch {}

            // ── autoRefreshFeed ────────────────────────────────────────────────
            try {
                if (s.autoRefreshFeed && !settingsEngine._feedRefreshTimer) {
                    settingsEngine._feedRefreshTimer = setInterval(() => {
                        if (!store.settings().autoRefreshFeed) { clearInterval(settingsEngine._feedRefreshTimer); settingsEngine._feedRefreshTimer = null; return; }
                        const sym = utils.getCoinSymbol();
                        if (sym) document.getElementById(CONFIG.ids.coinTxRefresh)?.click();
                    }, 15000);
                } else if (!s.autoRefreshFeed && settingsEngine._feedRefreshTimer) {
                    clearInterval(settingsEngine._feedRefreshTimer);
                    settingsEngine._feedRefreshTimer = null;
                }
            } catch {}

            // ── showPortfolioPercent ───────────────────────────────────────────
            try {
                if (s.showPortfolioPercent) {
                    const pf = store.portfolio();
                    const lastTotal = portfolioUpdater.lastTotal;
                    if (lastTotal && lastTotal > 0) {
                        document.querySelectorAll('[data-re-pf-sym]:not([data-re-pct])').forEach(row => {
                            const valEl = row.querySelector('.font-mono');
                            if (!valEl) return;
                            const val = parseFloat(valEl.textContent.replace(/[^0-9.]/g,''));
                            if (!val) return;
                            const pct = ((val / lastTotal) * 100).toFixed(1);
                            if (!row.querySelector('.re-pf-pct')) {
                                const sp = document.createElement('span');
                                sp.className = 're-pf-pct';
                                sp.style.cssText = 'font-size:10px;color:#71717a;margin-left:4px';
                                sp.textContent = pct + '%';
                                valEl.parentElement?.appendChild(sp);
                            }
                            row.dataset.rePct = '1';
                        });
                    }
                }
            } catch {}

            // ── preloadCoinData ────────────────────────────────────────────────
            try {
                if (s.preloadCoinData && !settingsEngine._preloadPatch) {
                    settingsEngine._preloadPatch = true;
                    document.addEventListener('mouseover', e => {
                        if (!store.settings().preloadCoinData) return;
                        const a = e.target.closest('a[href^="/coin/"]');
                        if (!a || a.dataset.rePreloaded) return;
                        a.dataset.rePreloaded = '1';
                        const m = a.href.match(/\/coin\/([^/?#]+)/);
                        if (m) fetch(`/api/coin/${m[1]}`, { priority: 'low' }).catch(() => {});
                    }, { passive: true });
                }
            } catch {}

            // ── devMode ────────────────────────────────────────────────────────
            try {
                if (s.devMode) {
                    if (!window._reDevMode) {
                        window._reDevMode = true;
                        console.log('%c[Rugplay Enhanced] Dev mode ON — logging WS events', 'color:#22c55e;font-weight:bold');
                        wsInterceptor.on(d => { if (store.settings().devMode) console.debug('[RE:WS]', d); });
                    }
                }
            } catch {}

            try { portfolioUpdater.reload?.(); } catch {}
        },
        _feedRefreshTimer: null,
        _preloadPatch: false,
    };

    const modStyles = {
        _el: null,
        apply(s) {
            if (!this._el) { this._el = document.createElement('style'); this._el.id = 're-mod-styles'; document.head.appendChild(this._el); }
            const rules = [];

            // ── Interface ──────────────────────────────────────────────────────
            if (s.hideFooter) rules.push('footer{display:none!important}');
            if (s.hidePromoBar) rules.push('[class*="promo"],[class*="banner"],[class*="announcement"]{display:none!important}');
            if (s.hideRightSidebar) rules.push('aside,[data-slot="right-sidebar"],[data-sidebar="sidebar"]:not(:first-of-type),[class*="right-sidebar"]{display:none!important}');
            if (s.hideOnlineCount) rules.push('[class*="online-count"],[class*="user-count"],[class*="online_count"],[title*="online"]{display:none!important}');
            if (s.borderlessCards) rules.push('.bg-card,.rounded-xl,.rounded-2xl,.rounded-lg{border:none!important;box-shadow:none!important}');
            if (s.reducedMotion) rules.push('*{animation-duration:.01ms!important;transition-duration:.01ms!important;animation-iteration-count:1!important}');
            if (s.monoFont) rules.push('body,input,textarea,select,button{font-family:ui-monospace,"SF Mono",monospace!important}');
            if (s.focusMode) rules.push('[data-sidebar],nav,header,footer{opacity:.12!important;transition:opacity .25s!important}[data-sidebar]:hover,nav:hover,header:hover,footer:hover{opacity:1!important}');
            if (s.sidebarCompact) rules.push('[data-sidebar="menu-item"]{min-height:28px!important;height:28px!important}[data-sidebar="menu-button"]{height:28px!important;font-size:12px!important;padding-top:4px!important;padding-bottom:4px!important}');
            if (s.blurPortfolioValue) rules.push('.font-mono{filter:blur(5px)!important;transition:filter .2s!important}.font-mono:hover{filter:none!important}');
            if (s.hideBalance) rules.push('.font-mono{opacity:0!important;user-select:none!important}.font-mono:hover{opacity:1!important}');
            if (s.largeClickTargets) rules.push('a,button,[role="button"]{min-height:32px!important}');
            if (s.betterScrollbars) rules.push('::-webkit-scrollbar{width:5px!important;height:5px!important}::-webkit-scrollbar-track{background:transparent!important}::-webkit-scrollbar-thumb{background:hsl(var(--border))!important;border-radius:3px!important}::-webkit-scrollbar-thumb:hover{background:hsl(var(--muted-foreground))!important}');
            if (s.smoothScrolling) rules.push('html{scroll-behavior:smooth!important}');
            if (s.highlightNewCoins) rules.push('[data-new-coin]{border-left:3px solid #22c55e!important}');
            if (s.compactMode) rules.push('.space-y-4{gap:8px!important}.space-y-6{gap:12px!important}.p-4{padding:8px!important}.p-6{padding:12px!important}.py-6{padding-top:10px!important;padding-bottom:10px!important}.gap-4{gap:8px!important}.gap-6{gap:12px!important}');
            if (s.dimInactiveTabs) rules.push('');  // applied via visibility event — handled in JS below
            if (s.hideOfflineDM) rules.push('[class*="online-indicator"],[class*="online_dot"],[data-status="online"] [class*="dot"],[class*="presence"]{display:none!important}');
            if (s.hideVerifiedBadge) rules.push('[class*="verified"],[class*="badge-verified"]{display:none!important}');

            // ── Trading / Display ──────────────────────────────────────────────
            if (s.feedCompact) rules.push('.xp-feed-row{padding-top:4px!important;padding-bottom:4px!important}.xp-feed-rows{max-height:420px!important}');
            if (s.highlightBuys) rules.push('.xp-feed-row.buy{background:rgba(34,197,94,.03)!important}');
            if (s.highlightSells) rules.push('.xp-feed-row.sell{background:rgba(239,68,68,.03)!important}');
            if (s.highlightWhaleTrades) rules.push('[data-whale="1"]{outline:1px solid #f59e0b!important;outline-offset:-1px!important}');
            if (s.showCandleColors) rules.push('[class*="candle"][class*="up"],[class*="bull"]{color:#22c55e!important}[class*="candle"][class*="down"],[class*="bear"]{color:#ef4444!important}');
            if (s.showMarketCap) rules.push('[data-re-mcap-hidden]{display:block!important;visibility:visible!important}');

            // ── Privacy ────────────────────────────────────────────────────────
            if (s.noReferrer) rules.push('a[href^="http"]{rel:noreferrer!important}');  // limited via CSS, fully applied in JS

            const accent = s.accentColor && s.accentColor !== 'default' ? s.accentColor : null;
            if (accent) rules.push(`:root{--primary:${accent}}`);

            this._el.textContent = rules.join('\n');
        },
    };

    const theme = {
        apply() {
            const enabled = !!store.settings().forceDark;
            try {
                // Rugplay uses shadcn/tailwind style variables; toggling `dark` is the safest global switch.
                document.documentElement.classList.toggle('dark', enabled);
                document.documentElement.style.colorScheme = enabled ? 'dark' : '';
            } catch {}
        },
    };

    const portfolioMover = {
        apply() {
            const enabled = store.settings().stickyPortfolio;
            const footer = document.querySelector('div[data-sidebar="footer"]');
            const content = document.querySelector('div[data-sidebar="content"]') || document.querySelector('div[data-slot="sidebar-content"]');
            if (!footer || !content) return;
            const grp = Array.from(document.querySelectorAll('div[data-sidebar="group"]')).find(g => g.querySelector('div[data-sidebar="group-label"]')?.textContent?.includes('Portfolio'));
            if (!grp) return;
            if (enabled && grp.parentElement !== footer) { grp.style.borderTop = '1px solid var(--sidebar-border)'; footer.insertBefore(grp, footer.firstChild); }
            else if (!enabled && grp.parentElement === footer) { grp.style.borderTop = ''; content.appendChild(grp); }
        },
    };

    const portfolioUpdater = {
        reloading: false, lastTs: 0, lastTotal: null,
        trigger() { const now = Date.now(); if (this.reloading || now - this.lastTs < 3000) return; this.lastTs = now; this.reload(); },
        async reload() {
            if (this.reloading) return; this.reloading = true;
            try {
                const d = await rugplayApi.portfolio();
                this.update(d);
            } catch {} finally { this.reloading = false; }
        },
        update(data) {
            const total = data.total_value ?? data.totalValue ?? data.total;
            const cash = data.cash_value ?? data.cashValue ?? data.cash;
            const coins = data.coins_value ?? data.coinsValue ?? data.coins;
            const labels = Array.from(document.querySelectorAll('span'));
            const lbl = labels.find(s => s.textContent.trim() === 'Total Value');
            if (!lbl) return;
            const wrap = lbl.closest('.space-y-2');
            if (!wrap) return;
            const spans = wrap.querySelectorAll('span.font-mono');
            const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
            if (spans[0] && total !== undefined) { spans[0].textContent = fmt(total); spans[0].style.transition = 'background .2s,transform .2s'; spans[0].style.backgroundColor = 'rgba(76,175,80,.25)'; spans[0].style.transform = 'scale(1.04)'; setTimeout(() => { spans[0].style.backgroundColor = 'transparent'; spans[0].style.transform = ''; }, 400); }
            if (spans[1] && cash !== undefined) spans[1].textContent = fmt(cash);
            if (spans[2] && coins !== undefined) spans[2].textContent = fmt(coins);
            if (store.settings().showPnL && total !== undefined) {
                const pf = store.portfolio();
                if (!pf.snaps) pf.snaps = [];
                pf.snaps.push({ total, ts: Date.now() });
                pf.snaps = pf.snaps.filter(s => Date.now() - s.ts < 86400000 * 7);
                store.pfSet(pf);
                document.getElementById(CONFIG.ids.pnlEl)?.remove();
                if (pf.snaps.length >= 2) {
                    const old = pf.snaps[0].total;
                    const diff = total - old;
                    const pct = old > 0 ? ((diff / old) * 100).toFixed(2) : '0.00';
                    const el = document.createElement('div');
                    el.id = CONFIG.ids.pnlEl;
                    el.className = `re-pnl ${diff >= 0 ? 'pos' : 'neg'}`;
                    el.textContent = `${diff >= 0 ? '+' : ''}${utils.usd(diff)} (${diff >= 0 ? '+' : ''}${pct}%) session`;
                    wrap.appendChild(el);
                }
            }
            this.lastTotal = total;
        },
    };

    const alertEngine = {
        _flashTimer: null,
        _origTitle: null,
        init() { wsInterceptor.on(d => { const sym = ((d.data?.coinSymbol || d.data?.symbol) || '').toUpperCase(); const px = parseFloat(d.data?.price || d.data?.currentPrice || 0); if (sym && px) this._chk(sym, px); }); },
        _chk(sym, px) {
            const al = store.alerts(); let ch = false;
            al.forEach(a => {
                if (a.sym !== sym || a.done) return;
                const hit = (a.dir === 'above' && px >= a.px) || (a.dir === 'below' && px <= a.px);
                if (!hit) return;
                a.done = true; a.hitAt = Date.now(); ch = true;
                notifier.show({ title: '🔔 Price Alert', description: `${sym} hit ${utils.usd(px)} — target: ${a.dir} ${utils.usd(a.px)}`, type: a.dir === 'above' ? 'success' : 'warning', duration: 0, actions: [{ label: 'View Coin', onClick: () => { location.href = `/coin/${sym}`; } }, { label: 'Dismiss', onClick: () => {} }] });
                if (store.settings().desktopAlerts && typeof GM_notification !== 'undefined' && Notification.permission === 'granted') GM_notification({ title: 'Rugplay Enhanced', text: `${sym} hit ${utils.usd(px)}`, timeout: 8000 });
                if (store.settings().flashTitle) this._flash(`🔔 ${sym} ALERT`);
                if (store.settings().soundAlerts) this._beep(880, 0.15, 0.3);
            });
            if (ch) store.alSet(al);
        },
        _flash(msg) {
            if (this._flashTimer) { clearInterval(this._flashTimer); this._flashTimer = null; document.title = this._origTitle || document.title; }
            this._origTitle = document.title;
            let on = true;
            this._flashTimer = setInterval(() => {
                document.title = on ? msg : this._origTitle;
                on = !on;
            }, 700);
            setTimeout(() => { if (this._flashTimer) { clearInterval(this._flashTimer); this._flashTimer = null; document.title = this._origTitle; } }, 10000);
        },
        _beep(freq = 660, vol = 0.1, dur = 0.25) {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(vol, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
                osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
            } catch {}
        },
        add(sym, px, dir) { const al = store.alerts(); al.push({ id: utils.uid(), sym: sym.toUpperCase(), px: parseFloat(px), dir, done: false, at: Date.now() }); store.alSet(al); notifier.ok(`Alert set: ${sym} ${dir} ${utils.usd(px)}`); },
        del: id => store.alSet(store.alerts().filter(a => a.id !== id)),
    };

    const volumeDetector = {
        hist: {},
        init() {
            wsInterceptor.on(d => {
                if (!['live-trade', 'all-trades'].includes(d.type)) return;
                const sym = (d.data?.coinSymbol || '').toUpperCase();
                const v = parseFloat(d.data?.totalValue || 0);
                if (!sym || !v) return;
                if (!this.hist[sym]) this.hist[sym] = { t: [], last: 0 };
                const h = this.hist[sym];
                h.t.push({ v, ts: Date.now() });
                h.t = h.t.filter(x => Date.now() - x.ts < 60000);
                const tot = h.t.reduce((s, x) => s + x.v, 0);
                const s = store.settings();
                if (!s.volumeSpikes && !s.alertOnVolumeSpike) return;
                const threshold = s.volumeSpikeUsd || 5000;
                if (tot > threshold && Date.now() - h.last > 30000) {
                    h.last = Date.now();
                    notifier.show({ title: '📈 Volume Spike', description: `${sym} — ${utils.usd(tot)} in the last 60s`, type: 'warning', duration: 8000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                    if (s.soundAlerts) alertEngine._beep(440, 0.08, 0.2);
                }
            });
        },
        get: sym => (volumeDetector.hist[sym]?.t || []).reduce((s, x) => s + x.v, 0),
    };

    const botDetector = {
        tr: {},
        init() { wsInterceptor.on(d => { if (!['live-trade', 'all-trades'].includes(d.type)) return; const sym = (d.data?.coinSymbol || '').toUpperCase(); const usr = d.data?.username; if (!sym || !usr) return; if (!this.tr[sym]) this.tr[sym] = []; this.tr[sym].push({ usr, v: parseFloat(d.data?.totalValue || 0), type: (d.data?.type || '').toUpperCase(), ts: Date.now() }); this.tr[sym] = this.tr[sym].filter(x => Date.now() - x.ts < 120000); this._ana(sym); }); },
        _ana(sym) {
            const tr = this.tr[sym];
            if (!tr || tr.length < 6) return;
            const s = store.settings();
            if (!s.botWarning && !s.alertOnBotActivity) return;
            const uc = {}; tr.forEach(t => { uc[t.usr] = (uc[t.usr] || 0) + 1; });
            const iv = []; for (let i = 1; i < tr.length; i++) iv.push(tr[i].ts - tr[i - 1].ts);
            const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
            const vr = iv.reduce((a, b) => a + (b - avg) ** 2, 0) / iv.length;
            if ((vr < 5000 && avg < 3000) || Object.values(uc).some(c => c >= 4)) {
                const k = `re_bw_${sym}`; if (GM_getValue(k, 0) > Date.now() - 60000) return; GM_setValue(k, Date.now());
                notifier.show({ title: '🤖 Bot Activity', description: `${sym} — suspicious trading patterns detected`, type: 'warning', duration: 10000, actions: [{ label: 'View Coin', onClick: () => { location.href = `/coin/${sym}`; } }] });
                if (s.soundAlerts) alertEngine._beep(330, 0.08, 0.3);
            }
        },
        trades: sym => botDetector.tr[sym] || [],
    };

    const riskScorer = {
        cache: {},
        async score(sym) {
            if (this.cache[sym] && Date.now() - this.cache[sym].ts < 300000) return this.cache[sym];
            try {
                const r = await fetch(`/coin/${sym}/__data.json?x-sveltekit-invalidated=11`); if (!r.ok) return null;
                const d = await r.json(); const da = d?.nodes?.[1]?.data; if (!Array.isArray(da)) return null;
                const ci = da[0]?.coin; if (ci === undefined) return null;
                const coin = da[ci]; if (!coin || typeof coin !== 'object') return null;
                const getVal = (idx) => (idx != null && da[idx] !== undefined ? da[idx] : null);
                const holders = getVal(coin.holderCount) ?? 0;
                const mcap = getVal(coin.marketCap) ?? 0;
                const created = getVal(coin.createdAt) ?? Date.now();
                const ageH = (Date.now() - new Date(created).getTime()) / 3600000;
                let risk = 0; const fac = [];
                if (ageH < 1) { risk += 30; fac.push('Under 1 hour old'); } else if (ageH < 6) { risk += 15; fac.push('Under 6 hours old'); }
                if (holders < 10) { risk += 25; fac.push('Under 10 holders'); } else if (holders < 50) { risk += 12; fac.push('Under 50 holders'); }
                if (mcap < 100) { risk += 20; fac.push('Market cap under $100'); } else if (mcap < 1000) { risk += 10; fac.push('Market cap under $1,000'); }
                const sells = botDetector.trades(sym).filter(t => t.type === 'SELL' && Date.now() - t.ts < 60000);
                if (sells.length > 5) { risk += 20; fac.push('Heavy recent selling'); }
                risk = Math.min(100, Math.max(0, risk));
                const label = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MEDIUM' : 'LOW';
                const creatorUsername = getVal(coin.creatorUsername) ?? getVal(coin.creator) ?? null;
                const result = { sym, risk, fac, label, ts: Date.now(), creatorUsername: typeof creatorUsername === 'string' ? creatorUsername : null };
                this.cache[sym] = result;
                return result;
            } catch { return null; }
        },
    };

    const reportedChecker = {
        cache: null,
        cacheTs: 0,
        TTL: 300000,
        async getReportedSet() {
            if (this.cache && Date.now() - this.cacheTs < this.TTL) return this.cache;
            try {
                const r = await api.get('/v1/reports?page=1&limit=100');
                if (r.status !== 'success' || !r.data?.reports) { this.cache = new Set(); this.cacheTs = Date.now(); return this.cache; }
                const set = new Set();
                r.data.reports.forEach(rp => {
                    if (rp.reported_username) set.add(String(rp.reported_username).toLowerCase());
                    if (rp.coin_symbol) set.add(`*${String(rp.coin_symbol).toUpperCase()}`);
                });
                this.cache = set; this.cacheTs = Date.now();
                return set;
            } catch { this.cache = new Set(); this.cacheTs = Date.now(); return this.cache; }
        },
        async isReported(creatorUsername, coinSymbol) {
            const set = await this.getReportedSet();
            if (!set) return false;
            if (creatorUsername && set.has(String(creatorUsername).toLowerCase())) return true;
            if (coinSymbol && set.has(`*${String(coinSymbol).toUpperCase()}`)) return true;
            return false;
        },
    };

    const liveFeed = {
        trades: [],
        open: false,
        tsTimer: null,
        paused: false,
        _renderT: 0,
        _seenCoins: new Set(),
        init() {
            wsInterceptor.on(d => {
                if (!['live-trade', 'all-trades'].includes(d.type)) return;
                const t = d.data; if (!t) return;
                const sym = (t.coinSymbol || '').toUpperCase();
                const usr = t.username || '?';
                const type = (t.type || 'BUY').toUpperCase();
                const val = parseFloat(t.totalValue || 0);
                const px = parseFloat(t.price || 0);
                const ts = t.timestamp || Date.now();
                const isWhale = val >= (store.settings().whaleTxMin || 500);

                portfolioUpdater.trigger();
                this.trades.unshift({ sym, usr, type, val, px, ts, isWhale });
                this.trades = this.trades.slice(0, 500);
                if (this.open && !this.paused) this._renderThrottled();

                const s = store.settings();

                // ── Watchlist trade alert ──────────────────────────────────────
                if ((s.alertOnWatchlistTrade || s.watchlistAlerts) && watchlist.has(sym)) {
                    const k = `re_wla_${sym}`; if (GM_getValue(k, 0) < Date.now() - 10000) {
                        GM_setValue(k, Date.now());
                        notifier.show({ title: `👁 Watchlist: ${sym}`, description: `${usr} ${type === 'SELL' ? 'sold' : 'bought'} ${utils.usd(val)}`, type: type === 'SELL' ? 'warning' : 'success', duration: 6000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (s.soundAlerts) alertEngine._beep(type === 'SELL' ? 280 : 550, 0.07, 0.2);
                    }
                }

                // ── Whale ping ─────────────────────────────────────────────────
                if (s.whalePing && isWhale) {
                    const k = `re_wp_${sym}`; if (GM_getValue(k, 0) < Date.now() - 15000) {
                        GM_setValue(k, Date.now());
                        notifier.show({ title: `🐋 Whale Trade`, description: `${sym} — ${usr} ${type} ${utils.usd(val)}`, type: 'warning', duration: 7000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (s.soundAlerts) alertEngine._beep(220, 0.1, 0.4);
                    }
                }

                // ── New coin alert ─────────────────────────────────────────────
                if (s.alertOnNewCoin && !this._seenCoins.has(sym)) {
                    this._seenCoins.add(sym);
                    if (this._seenCoins.size > 1) { // skip first batch on load
                        notifier.show({ title: `🆕 New Coin: ${sym}`, description: `First trade seen — ${usr} ${type} ${utils.usd(val)}`, type: 'info', duration: 8000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (s.soundAlerts) alertEngine._beep(660, 0.08, 0.2);
                    }
                }

                // ── Creator sell alert ─────────────────────────────────────────
                if (s.alertOnCreatorSell && type === 'SELL' && utils.isCoinPage()) {
                    const curSym = utils.getCoinSymbol();
                    if (curSym === sym) {
                        riskScorer.score(sym).then(sc => {
                            if (sc?.creatorUsername && sc.creatorUsername.toLowerCase() === usr.toLowerCase()) {
                                const k = `re_cs_${sym}`; if (GM_getValue(k, 0) < Date.now() - 30000) {
                                    GM_setValue(k, Date.now());
                                    notifier.show({ title: `🚨 Creator Selling!`, description: `${sym} creator (${usr}) just SOLD ${utils.usd(val)} — possible rugpull`, type: 'error', duration: 0, actions: [{ label: 'View Coin', onClick: () => { location.href = `/coin/${sym}`; } }, { label: 'Dismiss', onClick: () => {} }] });
                                    if (s.soundAlerts) { alertEngine._beep(200, 0.15, 0.5); setTimeout(() => alertEngine._beep(150, 0.15, 0.5), 300); }
                                    if (s.flashTitle) alertEngine._flash(`🚨 ${sym} CREATOR SELLING`);
                                }
                            }
                        }).catch(() => {});
                    }
                }
            });
        },
        _renderThrottled() {
            const now = Date.now();
            if (now - this._renderT < 250) return;
            this._renderT = now;
            this.render();
            dashboard.render();
            ['re-stat-trades','xp-stat-trades'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=this.trades.length;});
        },
        render() {
            const body = document.getElementById('re-feed-rows'); if (!body) return;
            const f = (document.getElementById('re-feed-filter')?.value || '').trim();
            const fU = f.toUpperCase();
            const min = parseFloat(document.getElementById('re-feed-min')?.value || '0') || 0;
            const side = document.getElementById('re-feed-side')?.value || 'all';
            const shown = this.trades.filter(t => {
                if (min && t.val < min) return false;
                if (side !== 'all' && t.type !== side) return false;
                if (!f) return true;
                return t.sym.includes(fU) || (t.usr || '').toLowerCase().includes(f.toLowerCase());
            });
            if (!shown.length) { body.innerHTML = '<div class="xp-empty">Waiting for live trades…</div>'; return; }
            body.innerHTML = shown.slice(0, 80).map(t => `<a href="/coin/${t.sym}" class="xp-feed-row ${t.type==='SELL'?'sell':'buy'}"><span class="${t.type==='SELL'?'xp-b-sell':'xp-b-buy'}">${t.type}</span><span class="xp-f-sym">${t.sym}</span><span class="xp-f-usr">${t.usr}</span><span class="xp-f-val">${utils.usd(t.val)}</span><span class="xp-f-ts" data-ts="${t.ts}">${utils.ago(t.ts)}</span></a>`).join('');
        },
        startTsTimer() { this.stopTsTimer(); this.tsTimer = setInterval(() => { document.querySelectorAll('.re-fd-t[data-ts],.xp-f-ts[data-ts]').forEach(el => { el.textContent = utils.ago(+el.dataset.ts); }); }, 1000); },
        stopTsTimer() { if (this.tsTimer) { clearInterval(this.tsTimer); this.tsTimer = null; } },
    };

    const dashboard = {
        render() {
            if (!enhancedPanel.isVisible) return;
            const hotEl = document.getElementById('re-hot-body');
            const whaleEl = document.getElementById('re-whale-body');
            const statEl = document.getElementById('re-stats-body');
            if (!hotEl || !whaleEl || !statEl) return;

            const sinceMs = parseInt(document.getElementById('re-agg-window')?.value || '600000', 10) || 600000;
            const since = Date.now() - sinceMs;
            const trades = liveFeed.trades.filter(t => +t.ts >= since);
            const by = {};
            for (const t of trades) {
                if (!t.sym) continue;
                if (!by[t.sym]) by[t.sym] = { sym: t.sym, vol: 0, n: 0, buy: 0, sell: 0, last: t.ts };
                const a = by[t.sym];
                a.vol += +t.val || 0;
                a.n += 1;
                if (t.type === 'BUY') a.buy += 1;
                if (t.type === 'SELL') a.sell += 1;
                if (+t.ts > +a.last) a.last = t.ts;
            }
            const hot = Object.values(by).sort((a, b) => b.vol - a.vol).slice(0, 10);
            hotEl.innerHTML = hot.length
                ? hot.map(h=>`<a class="xp-mini-row" href="/coin/${h.sym}"><span class="xp-mini-sym">${h.sym}</span><span class="xp-mini-sub">${h.n} trades · ${utils.usd(h.vol)} · ${utils.ago(h.last)}</span><span class="${h.buy>=h.sell?'xp-t-buy':'xp-t-sell'}">${h.buy}/${h.sell}</span></a>`).join('')
                :'<div class="xp-empty">No data yet.</div>';

            const minWhale = parseFloat(document.getElementById('re-whale-min')?.value || '250') || 250;
            const whales = trades.filter(t => (+t.val || 0) >= minWhale).slice(0, 25).sort((a, b) => (+b.val || 0) - (+a.val || 0)).slice(0, 12);
            whaleEl.innerHTML = whales.length
                ? whales.map(t=>`<a class="xp-mini-row" href="/coin/${t.sym}"><span class="xp-mini-sym">${t.sym}</span><span class="xp-mini-sub">${t.usr} · ${t.type} · ${utils.usd(t.val)} · ${utils.ago(t.ts)}</span><span class="${t.type==='SELL'?'xp-t-sell':'xp-t-buy'}">${t.type}</span></a>`).join('')
                :`<div class="xp-empty">No whales over ${utils.usd(minWhale)}.</div>`;

            const totalVol = trades.reduce((s, t) => s + (+t.val || 0), 0);
            const buys = trades.filter(t => t.type === 'BUY').length;
            const sells = trades.filter(t => t.type === 'SELL').length;
            const avg = trades.length ? totalVol / trades.length : 0;
            statEl.innerHTML = `
                <div class="xp-agg-cell"><div class="xp-agg-v">${Math.round(sinceMs/60000)}m</div><div class="xp-agg-k">Window</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">${trades.length}</div><div class="xp-agg-k">Trades</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">${utils.usd(totalVol)}</div><div class="xp-agg-k">Volume</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">${utils.usd(avg)}</div><div class="xp-agg-k">Avg</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">${buys}/${sells}</div><div class="xp-agg-k">B/S</div></div>
            `;
        },
    };

    const userTagger = {
        cache: null, cacheTs: 0,
        async load() { if (this.cache && Date.now() - this.cacheTs < 300000) return this.cache; try { const r = await api.get('/v1/tags'); if (r.status === 'success') { this.cache = r.data; this.cacheTs = Date.now(); return this.cache; } } catch {} return {}; },
        async applyTags() {
            if (!store.settings().showCreatorBadge) return;
            const tags = await this.load(); if (!tags || !Object.keys(tags).length) return;
            if (utils.isUserPage()) { const u = utils.getUsernameFromPage(); if (u) { const d = tags[u.toLowerCase()]; const el = document.querySelector('p.text-muted-foreground.text-lg'); if (el && d && !el.querySelector('.re-tag')) { const t = document.createElement('span'); t.className = 're-tag'; t.textContent = d.label || d.tag; t.style.background = d.style?.bg || '#6366f1'; t.style.color = d.style?.text || '#fff'; el.appendChild(t); } } }
            if (utils.isCoinPage()) { document.querySelectorAll('.border-b:not([data-re-tag])').forEach(el => { const sp = el.querySelector('button span.truncate'); if (!sp) return; const u = sp.textContent.replace('@', '').trim().toLowerCase(); const d = tags[u]; if (d && !el.querySelector('.re-tag')) { const t = document.createElement('span'); t.className = 're-tag'; t.textContent = d.label || d.tag; t.style.background = d.style?.bg || '#6366f1'; t.style.color = d.style?.text || '#fff'; sp.parentElement?.appendChild(t); } el.setAttribute('data-re-tag', '1'); }); }
        },
    };

    const updateChecker = {
        newer: (c, r) => { const ca = c.split('.').map(Number), ra = r.split('.').map(Number); for (let i = 0; i < Math.max(ca.length, ra.length); i++) { if ((ra[i] || 0) > (ca[i] || 0)) return true; if ((ca[i] || 0) > (ra[i] || 0)) return false; } return false; },
        async check() {
            try {
                const r = await api.get('/v1/update'); if (r.status !== 'success') return;
                const rem = r.data?.version; if (!rem || !this.newer(GM_info.script.version, rem)) return;
                let desc = `Version ${rem} is available.`;
                try { const cl = await api.get(`/v1/changelog?version=${rem}`); if (cl?.data?.changes?.length) desc = cl.data.changes.slice(0, 3).join(' · '); } catch {}
                notifier.show({ title: `Rugplay Enhanced ${rem}`, description: desc, type: 'info', duration: 0, actions: [{ label: 'Update Now', onClick: () => window.open('https://github.com/devbyego/rugplay-enhanced/releases/latest', '_blank') }, { label: 'Later', onClick: () => {} }] });
            } catch {}
        },
    };

    const tableEnhancer = {
        enhance() {
            if (!utils.isUserPage()) return;
            if (!store.settings().clickableRows) return;
            const tbody = utils.findElement(CONFIG.selectors.tableSelectors); if (!tbody) return;
            tbody.querySelectorAll('tr:not([data-re-click])').forEach(row => {
                const img = row.querySelector('img[alt]'); if (!img) return;
                const sym = img.getAttribute('alt'); if (!sym) return;
                row.setAttribute('data-re-click', '1'); row.style.cursor = 'pointer'; row.style.transition = 'background .15s';
                row.addEventListener('mouseenter', () => row.style.backgroundColor = 'rgba(255,255,255,.04)');
                row.addEventListener('mouseleave', () => row.style.backgroundColor = '');
                row.addEventListener('click', e => { if (!['A', 'BUTTON'].includes(e.target.tagName.toUpperCase())) location.href = `https://rugplay.com/coin/${sym}`; });
            });
        },
    };

    const quickSearch = {
        open: false,
        toggle() {
            let el = document.getElementById('re-search-modal');
            if (el) { el.remove(); this.open = false; return; }
            this.open = true;
            el = document.createElement('div'); el.id = 're-search-modal'; el.className = 're-search-wrap';
            el.innerHTML = `<div class="re-search-box"><div class="re-search-top"><div class="re-search-icon-wrap">${ICONS.search}</div><input id="re-sq" class="re-search-inp" placeholder="Search coins or users..." autofocus /><kbd class="re-kbd">ESC</kbd></div><div id="re-search-res" class="re-search-results"><div class="re-empty">Type to search...</div></div></div>`;
            document.body.appendChild(el);
            el.addEventListener('click', e => { if (e.target === el) { el.remove(); this.open = false; } });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('re-search-modal')?.remove(); this.open = false; } }, { once: true });
            const inp = document.getElementById('re-sq');
            const closeModal = () => { document.getElementById('re-search-modal')?.remove(); this.open = false; };
            const navigate = (raw) => {
                const q = String(raw || '').trim();
                if (!q) return;
                const qNoAt = q.startsWith('@') ? q.slice(1) : q;
                // If it looks like an UPPERCASE symbol, treat as coin; otherwise treat as user.
                const isLikelyCoin = /^[A-Z0-9]{1,12}$/.test(q);
                if (q.startsWith('@') || (!isLikelyCoin && /^[a-zA-Z0-9_.-]{2,}$/.test(qNoAt))) {
                    location.href = `/user/${encodeURIComponent(qNoAt)}`;
                } else {
                    location.href = `/coin/${encodeURIComponent(q.toUpperCase())}`;
                }
            };
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    navigate(inp.value);
                    closeModal();
                }
            });
            inp.addEventListener('input', utils.debounce(async () => {
                const q = inp.value.trim(); const res = document.getElementById('re-search-res'); if (!res) return;
                if (q.length < 2) { res.innerHTML = '<div class="re-empty">Type at least 2 characters...</div>'; return; }
                res.innerHTML = `<div class="re-empty">${ICONS.loading} Searching...</div>`;
                try {
                    const d = await rugplayApi.search(q);
                    const coins = d.coins || d.results || []; const users = d.users || [];
                    if (!coins.length && !users.length) { res.innerHTML = '<div class="re-empty">No results found</div>'; return; }
                    res.innerHTML = [
                        ...coins.slice(0, 6).map(c => `<a href="/coin/${c.symbol}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">${c.name || c.symbol}</span><span class="re-badge ${c.priceChange24h >= 0 ? 'buy' : 'sell'}" style="font-size:10px">${(c.priceChange24h || 0) >= 0 ? '+' : ''}${(c.priceChange24h || 0).toFixed(2)}%</span></div><div class="re-sr-sub">${c.symbol} · ${utils.usd(c.currentPrice || 0)}</div></a>`),
                        ...users.slice(0, 3).map(u => `<a href="/user/${u.username}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">@${u.username}</span></div><div class="re-sr-sub">User Profile</div></a>`),
                    ].join('');
                    res.querySelectorAll('a[data-re-close="1"]').forEach(a => a.addEventListener('click', closeModal, { once: true }));
                } catch {
                    // Fallback: search through observed live trades (no API needed).
                    const ql = q.toLowerCase();
                    const coinQ = q.replace(/^\*/, '').toUpperCase();
                    const userQ = (q.startsWith('@') ? q.slice(1) : q).toLowerCase();
                    const coins = Array.from(new Set(liveFeed.trades.map(t => t.sym).filter(Boolean)))
                        .filter(s => s.toLowerCase().includes(ql))
                        .slice(0, 8);
                    const users = Array.from(new Set(liveFeed.trades.map(t => t.usr).filter(Boolean)))
                        .filter(u => u.toLowerCase().includes(userQ))
                        .slice(0, 6);
                    const coinRows = coins.map(s => `<a href="/coin/${encodeURIComponent(s)}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">${s}</span></div><div class="re-sr-sub">From live feed</div></a>`);
                    const userRows = users.map(u => `<a href="/user/${encodeURIComponent(u)}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">@${u}</span></div><div class="re-sr-sub">From live feed</div></a>`);
                    res.innerHTML = `
                        <div class="re-empty re-err">Search API unavailable. Using live feed fallback.</div>
                        ${coinRows.length ? `<div class="re-empty" style="padding:10px 16px;text-align:left">Coins</div>${coinRows.join('')}` : ''}
                        ${userRows.length ? `<div class="re-empty" style="padding:10px 16px;text-align:left">Users</div>${userRows.join('')}` : ''}
                        <div class="re-empty" style="padding:10px 16px;text-align:left">Direct jump</div>
                        <a href="/coin/${encodeURIComponent(coinQ)}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">Coin: ${coinQ}</span></div><div class="re-sr-sub">Press Enter to go</div></a>
                        <a href="/user/${encodeURIComponent(q.startsWith('@') ? q.slice(1) : q)}" class="re-sr-row" data-re-close="1"><div class="re-sr-main"><span class="re-sr-name">User: @${q.startsWith('@') ? q.slice(1) : q}</span></div><div class="re-sr-sub">Press Enter to go</div></a>
                    `;
                    res.querySelectorAll('a[data-re-close="1"]').forEach(a => a.addEventListener('click', closeModal, { once: true }));
                }
            }, 300));
        },
    };

    const coinPageEnhancer = {
        tsTimer: null,
        _pending: new Set(),
        _findTradeCard(sym) {
            try {
                const s = String(sym || '').toUpperCase();
                const buttons = Array.from(document.querySelectorAll('main button'));
                const buyBtn = buttons.find(b => (b.textContent || '').trim().toUpperCase() === `BUY ${s}`);
                const sellBtn = buttons.find(b => (b.textContent || '').trim().toUpperCase() === `SELL ${s}`);
                const any = buyBtn || sellBtn || buttons.find(b => /^BUY\b/i.test((b.textContent || '').trim()));
                const card = any?.closest('div.bg-card') || any?.closest('div.rounded-xl') || any?.closest('section') || any?.closest('div');
                return card || null;
            } catch { return null; }
        },
        _insertAfterTrade(sym, cardEl) {
            const trade = this._findTradeCard(sym);
            if (!trade) return false;
            const after = document.getElementById(CONFIG.ids.coinNoteCard)
                || document.getElementById(CONFIG.ids.coinRiskCard)
                || document.getElementById(CONFIG.ids.coinTxCard)
                || trade;
            try { after.insertAdjacentElement('afterend', cardEl); return true; } catch { return false; }
        },
        async init() {
            if (!utils.isCoinPage()) { this.stopTsTimer(); return; }
            const sym = utils.getCoinSymbol(); if (!sym) return;
            const s = store.settings();
            const tasks = [];
            tasks.push(this._watchBtn(sym));
            if (s.riskScore && s.riskCard) tasks.push(this._riskCard(sym));
            if (s.reportedBadge) tasks.push(this._reportedBadge(sym));
            if (s.txCard) tasks.push(this._txCard(sym));
            if (s.coinNotes) tasks.push(this._noteCard(sym));
            tasks.push(this._coinPageMods(sym));
            await Promise.all(tasks);
        },
        async _coinPageMods(sym) {
            // Inject coin-page data enhancements that don't need their own card
            await utils.sleep(1200);
            if (!utils.isCoinPage() || utils.getCoinSymbol() !== sym) return;
            const s = store.settings();
            try {
                // Fetch coin data for age/holders/mcap display
                const r = await fetch(`/coin/${sym}/__data.json?x-sveltekit-invalidated=11`);
                if (!r.ok) return;
                const d = await r.json();
                const da = d?.nodes?.[1]?.data; if (!Array.isArray(da)) return;
                const ci = da[0]?.coin; if (ci === undefined) return;
                const coin = da[ci]; if (!coin || typeof coin !== 'object') return;
                const getVal = idx => (idx != null && da[idx] !== undefined ? da[idx] : null);
                const holders = getVal(coin.holderCount) ?? 0;
                const mcap = getVal(coin.marketCap) ?? 0;
                const vol24 = getVal(coin.volume24h) ?? getVal(coin.dailyVolume) ?? 0;
                const change24 = getVal(coin.priceChange24h) ?? getVal(coin.change24h) ?? null;
                const created = getVal(coin.createdAt) ?? null;

                // Find a good anchor — the main coin header area
                const h1 = document.querySelector('main h1, main .text-2xl.font-bold, main .text-3xl.font-bold');
                if (!h1) return;

                // ── showCoinAge ───────────────────────────────────────────────
                if (s.showCoinAge && created && !document.getElementById('re-coin-age')) {
                    const ageH = (Date.now() - new Date(created).getTime()) / 3600000;
                    const ageStr = ageH < 1 ? `${Math.round(ageH * 60)}m old` : ageH < 24 ? `${Math.round(ageH)}h old` : `${Math.round(ageH / 24)}d old`;
                    const el = document.createElement('span');
                    el.id = 're-coin-age';
                    el.style.cssText = 'font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.08);color:#a1a1aa;margin-left:8px;vertical-align:middle';
                    el.textContent = ageStr;
                    if (ageH < 1) el.style.background = 'rgba(239,68,68,.12)', el.style.color = '#ef4444';
                    else if (ageH < 6) el.style.background = 'rgba(245,158,11,.12)', el.style.color = '#f59e0b';
                    h1.appendChild(el);
                }

                // Find the stats area (near market cap)
                const statsArea = document.querySelector('main .grid, main .flex.flex-wrap') || h1.parentElement;

                // ── showHolderCount ───────────────────────────────────────────
                if (s.showHolderCount && holders && !document.getElementById('re-coin-holders')) {
                    const el = document.createElement('div');
                    el.id = 're-coin-holders';
                    el.style.cssText = 'font-size:12px;font-weight:600;color:#a1a1aa;display:inline-flex;align-items:center;gap:5px;margin-right:12px';
                    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${holders.toLocaleString()} holders`;
                    statsArea?.prepend(el);
                }

                // ── holdersWarning ────────────────────────────────────────────
                if (s.holdersWarning && holders < 10 && !document.getElementById('re-holders-warn')) {
                    const el = document.createElement('div');
                    el.id = 're-holders-warn';
                    el.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:6px;font-size:11px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:6px';
                    el.innerHTML = `⚠ Only ${holders} holder${holders !== 1 ? 's' : ''} — extreme concentration risk`;
                    h1.parentElement?.insertAdjacentElement('afterend', el);
                }

                // ── warnLowLiquidity ──────────────────────────────────────────
                if (s.warnLowLiquidity && mcap < 500 && !document.getElementById('re-liquidity-warn')) {
                    const el = document.createElement('div');
                    el.id = 're-liquidity-warn';
                    el.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:6px;font-size:11px;font-weight:600;color:#f59e0b;display:flex;align-items:center;gap:6px';
                    el.innerHTML = `⚠ Very low market cap (${utils.usd(mcap)}) — high rugpull risk`;
                    document.getElementById('re-holders-warn')?.insertAdjacentElement('afterend', el)
                        || h1.parentElement?.insertAdjacentElement('afterend', el);
                }

                // ── showPriceChange ───────────────────────────────────────────
                if (s.showPriceChange && change24 !== null && !document.getElementById('re-price-change')) {
                    const pct = parseFloat(change24);
                    const el = document.createElement('span');
                    el.id = 're-price-change';
                    const color = pct >= 0 ? '#22c55e' : '#ef4444';
                    el.style.cssText = `font-size:12px;font-weight:700;padding:2px 7px;border-radius:4px;background:${color}18;color:${color};margin-left:6px;vertical-align:middle`;
                    el.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% 24h`;
                    h1.appendChild(el);
                }

                // ── showVolume24h ─────────────────────────────────────────────
                if (s.showVolume24h && vol24 && !document.getElementById('re-vol24')) {
                    const el = document.createElement('span');
                    el.id = 're-vol24';
                    el.style.cssText = 'font-size:11px;font-weight:600;color:#a1a1aa;margin-left:8px';
                    el.textContent = `Vol: ${utils.usd(vol24)}`;
                    statsArea?.appendChild(el);
                }

                // ── alertOnPriceDrop monitoring ───────────────────────────────
                if (s.alertOnPriceDrop) {
                    const curPx = getVal(coin.currentPrice) ?? getVal(coin.price) ?? 0;
                    if (curPx && !this._priceDropRef) {
                        this._priceDropRef = { sym, px: curPx, ts: Date.now() };
                        // Monitored via WS in liveFeed — set up once
                        if (!this._priceDropWired) {
                            this._priceDropWired = true;
                            wsInterceptor.on(d => {
                                if (!store.settings().alertOnPriceDrop || !this._priceDropRef) return;
                                const wsym = (d.data?.coinSymbol || '').toUpperCase();
                                if (wsym !== this._priceDropRef.sym) return;
                                const wpx = parseFloat(d.data?.price || d.data?.currentPrice || 0);
                                if (!wpx) return;
                                const drop = ((this._priceDropRef.px - wpx) / this._priceDropRef.px) * 100;
                                const threshold = store.settings().priceDropPct || 20;
                                if (drop >= threshold && Date.now() - this._priceDropRef.ts > 30000) {
                                    this._priceDropRef.ts = Date.now();
                                    notifier.show({ title: `📉 Price Drop: ${wsym}`, description: `Down ${drop.toFixed(1)}% — was ${utils.usd(this._priceDropRef.px)}, now ${utils.usd(wpx)}`, type: 'error', duration: 10000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${wsym}`; } }] });
                                    if (store.settings().soundAlerts) alertEngine._beep(200, 0.12, 0.4);
                                }
                                this._priceDropRef.px = wpx;
                            });
                        }
                    }
                }

            } catch {}
        },
        _priceDropRef: null,
        _priceDropWired: false,
        async _watchBtn(sym) {
            if (document.getElementById(CONFIG.ids.watchBtn)) return;
            const key = `wb:${sym}`;
            if (this._pending.has(key)) return;
            this._pending.add(key);
            await utils.sleep(600);
            const h = document.querySelector('main h1, main .text-2xl.font-bold, main .text-3xl.font-bold');
            if (!h) { this._pending.delete(key); return; }
            const btn = document.createElement('button');
            btn.id = CONFIG.ids.watchBtn;
            btn.className = 're-outline-btn' + (watchlist.has(sym) ? ' active' : '');
            btn.textContent = watchlist.has(sym) ? '★ Watching' : '☆ Watch';
            btn.onclick = () => {
                if (watchlist.has(sym)) { watchlist.del(sym); btn.textContent = '☆ Watch'; btn.classList.remove('active'); }
                else { watchlist.add(sym); btn.textContent = '★ Watching'; btn.classList.add('active'); }
            };
            h.insertAdjacentElement('afterend', btn);
            this._pending.delete(key);
        },
        async _riskCard(sym) {
            if (document.getElementById(CONFIG.ids.coinRiskCard) || !store.settings().riskScore) return;
            const key = `risk:${sym}`;
            if (this._pending.has(key)) return;
            this._pending.add(key);
            await utils.sleep(900);
            const sc = await riskScorer.score(sym); if (!sc) { this._pending.delete(key); return; }
            const anchor = Array.from(document.querySelectorAll(`${CONFIG.selectors.coinPageCardContainer} > div.bg-card`)).find(c => c.textContent.includes('Top Holders'));
            const col = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e' }[sc.label];
            const card = document.createElement('div'); card.id = CONFIG.ids.coinRiskCard; card.className = 'bg-card text-card-foreground flex flex-col rounded-xl border py-6 shadow-sm gap-4';
            card.innerHTML = `<div class="grid grid-cols-[1fr_auto] items-center gap-1.5 px-6"><div class="font-semibold leading-none flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Risk Assessment</div><span style="color:${col};font-weight:700;font-size:13px;padding:2px 10px;background:${col}18;border-radius:5px">${sc.label}</span></div><div class="px-6"><div style="height:5px;background:hsl(var(--accent));border-radius:3px;overflow:hidden;margin-bottom:10px"><div style="width:${sc.risk}%;height:100%;background:${col};border-radius:3px;transition:width .5s ease"></div></div><div style="font-size:22px;font-weight:800;color:${col};margin-bottom:8px">${sc.risk}<span style="font-size:13px;font-weight:400;color:hsl(var(--muted-foreground))">/100</span></div>${sc.fac.length ? sc.fac.map(f => `<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-bottom:3px">⚠ ${f}</div>`).join('') : '<div style="font-size:12px;color:hsl(var(--muted-foreground))">No major risk factors detected</div>'}</div>`;
            if (!this._insertAfterTrade(sym, card)) {
                if (!anchor) { this._pending.delete(key); return; }
                anchor.insertAdjacentElement('beforebegin', card);
            }
            this._pending.delete(key);
        },
        async _reportedBadge(sym) {
            if (document.getElementById(CONFIG.ids.reportedCreatorBadge)) return;
            const key = `reported:${sym}`;
            if (this._pending.has(key)) return;
            this._pending.add(key);
            const sc = await riskScorer.score(sym); if (!sc?.creatorUsername) return;
            const reported = await reportedChecker.isReported(sc.creatorUsername, sym);
            if (!reported) { this._pending.delete(key); return; }
            await utils.sleep(500);
            const createdBySpan = Array.from(document.querySelectorAll('span')).find(s => s.textContent?.trim() === 'Created by');
            if (!createdBySpan?.parentElement) { this._pending.delete(key); return; }
            const badge = document.createElement('div');
            badge.id = CONFIG.ids.reportedCreatorBadge;
            badge.className = 're-reported-badge';
            badge.innerHTML = `<span class="re-reported-label">⚠ Community reported</span><div class="re-reported-tooltip">This creator or coin has been reported in Rugpull Reporter. Check the Enhanced panel for details.</div>`;
            createdBySpan.parentElement.appendChild(badge);
            this._pending.delete(key);
        },
        async _txCard(sym) {
            if (document.getElementById(CONFIG.ids.coinTxCard)) return;
            const key = `tx:${sym}`;
            if (this._pending.has(key)) return;
            this._pending.add(key);
            await utils.sleep(800);
            const anchor = Array.from(document.querySelectorAll(`${CONFIG.selectors.coinPageCardContainer} > div.bg-card`)).find(c => c.textContent.includes('Top Holders'));
            const style = document.createElement('style'); style.textContent = `@keyframes re-hl{from{background:rgba(74,222,128,.18)}to{background:transparent}}.re-new-tx{animation:re-hl 2s ease-out}`; document.head.appendChild(style);
            const card = document.createElement('div'); card.id = CONFIG.ids.coinTxCard; card.className = 'bg-card text-card-foreground flex flex-col rounded-xl border py-6 shadow-sm gap-4';
            card.innerHTML = `<div class="grid grid-cols-[1fr_auto] items-center gap-1.5 px-6"><div class="font-semibold leading-none flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>Recent Transactions<button id="${CONFIG.ids.coinTxRefresh}" class="ml-1 p-1.5 rounded-md hover:bg-accent transition-colors" title="Refresh">${ICONS.refresh}</button></div></div><div id="${CONFIG.ids.coinTxBody}" class="px-0 min-h-[120px] flex items-center justify-center"><div class="flex flex-col items-center gap-2 text-muted-foreground">${ICONS.loading}<span class="text-sm animate-pulse">Loading...</span></div></div><div id="${CONFIG.ids.coinTxPagination}" class="px-6 flex justify-center items-center gap-2"></div>`;
            if (!this._insertAfterTrade(sym, card)) {
                if (!anchor) { this._pending.delete(key); return; }
                anchor.insertAdjacentElement('beforebegin', card);
            }
            document.getElementById(CONFIG.ids.coinTxRefresh)?.addEventListener('click', () => this._loadTx(sym, 1, true));
            await this._loadTx(sym, 1);
            if (store.settings().txTimestamps) this.startTsTimer();
            this._pending.delete(key);
        },
        async _loadTx(sym, pg = 1, isRefresh = false) {
            const body = document.getElementById(CONFIG.ids.coinTxBody); if (!body) return;
            const ref = document.getElementById(CONFIG.ids.coinTxRefresh);
            if (ref) ref.querySelector('svg')?.classList.add('re-spin');
            if (!isRefresh) body.innerHTML = `<div class="flex flex-col items-center gap-2 text-muted-foreground">${ICONS.loading}<span class="text-sm animate-pulse">Loading page ${pg}...</span></div>`;
            try {
                const d = await rugplayApi.coinTrades(sym, pg, 10);
                const tr = d.trades || d.data || d.results || [];
                if (ref) ref.querySelector('svg')?.classList.remove('re-spin');
                if (!document.getElementById(CONFIG.ids.coinTxCard)) return;
                if (!tr.length) { body.innerHTML = '<div class="flex justify-center items-center p-6 text-muted-foreground text-sm">No transactions found</div>'; return; }
                const rows = tr.map(t => {
                    const type = (t.type || 'BUY').toUpperCase();
                    const isSell = type === 'SELL';
                    const cls = isSell ? 'bg-destructive hover:bg-destructive/90' : 'bg-green-600 hover:bg-green-700';
                    const ts = t.timestamp || t.createdAt || 0;
                    const id = t.id || t.txId || `${t.username || ''}_${ts}_${t.totalValue || t.value || ''}`;
                    const user = t.username || t.user || '?';
                    const val = +(t.totalValue || t.value || 0);
                    return `<tr class="hover:bg-muted/50 border-b transition-colors" data-ts="${ts}" data-id="${String(id)}"><td class="py-2 px-3 pl-6 w-[15%]"><span class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium text-white border-transparent ${cls}">${type}</span></td><td class="py-2 px-3 w-[35%]"><a href="/user/${user}" class="font-medium hover:underline">${user}</a></td><td class="py-2 px-3 w-[25%] font-mono text-sm">$${val.toFixed(2)}</td><td class="py-2 px-3 w-[25%] pr-6 text-right text-muted-foreground text-sm re-ts-el" data-ts="${ts}">${utils.ago(ts)}</td></tr>`;
                }).join('');
                if (isRefresh) {
                    const tbody = body.querySelector('tbody');
                    if (tbody) { const oldIds = new Set(Array.from(tbody.querySelectorAll('tr')).map(r => r.dataset.id)); const newIds = new Set(tr.map(t => String(t.id || ''))); tbody.querySelectorAll('tr').forEach(row => { if (!newIds.has(row.dataset.id)) row.remove(); }); const tmp = document.createElement('div'); tmp.innerHTML = `<table><tbody>${rows}</tbody></table>`; Array.from(tmp.querySelectorAll('tr')).reverse().forEach(nr => { if (!oldIds.has(nr.dataset.id)) { if (store.settings().txHighlightNew) nr.classList.add('re-new-tx'); tbody.prepend(nr); } }); while (tbody.children.length > 10) tbody.lastChild.remove(); return; }
                }
                body.innerHTML = `<div class="relative w-full overflow-x-auto"><table class="w-full caption-bottom text-sm"><thead class="[&_tr]:border-b"><tr class="border-b"><th class="h-9 px-3 pl-6 text-left font-medium text-muted-foreground">Type</th><th class="h-9 px-3 text-left font-medium text-muted-foreground">User</th><th class="h-9 px-3 text-left font-medium text-muted-foreground">Value</th><th class="h-9 px-3 pr-6 text-right font-medium text-muted-foreground">Time</th></tr></thead><tbody>${rows}</tbody></table></div>`;
                const pag = document.getElementById(CONFIG.ids.coinTxPagination);
                const p = d.pagination;
                if (pag && p && p.total_pages > 1) {
                    pag.innerHTML = '';
                    const mkBtn = (label, page, disabled = false) => { const b = document.createElement('button'); b.textContent = label; b.className = 'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium h-9 px-3 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors'; if (disabled) { b.setAttribute('disabled', ''); b.style.opacity = '.4'; } else b.onclick = () => this._loadTx(sym, page); return b; };
                    pag.appendChild(mkBtn('«', p.current_page - 1, p.current_page === 1));
                    const info = document.createElement('span'); info.className = 'text-sm text-muted-foreground'; info.textContent = `${p.current_page} / ${p.total_pages}`; pag.appendChild(info);
                    pag.appendChild(mkBtn('»', p.current_page + 1, p.current_page >= p.total_pages));
                }
            } catch { if (ref) ref.querySelector('svg')?.classList.remove('re-spin'); body.innerHTML = '<div class="flex justify-center items-center p-6 text-destructive text-sm">Failed to load transactions</div>'; }
        },
        startTsTimer() { this.stopTsTimer(); this.tsTimer = setInterval(() => { document.querySelectorAll('.re-ts-el[data-ts]').forEach(el => { el.textContent = utils.ago(+el.dataset.ts); }); }, 1000); },
        stopTsTimer() { if (this.tsTimer) { clearInterval(this.tsTimer); this.tsTimer = null; } },
        async _noteCard(sym) {
            if (document.getElementById(CONFIG.ids.coinNoteCard)) return;
            const key = `note:${sym}`;
            if (this._pending.has(key)) return;
            this._pending.add(key);
            await utils.sleep(1100);
            const anchor = Array.from(document.querySelectorAll(`${CONFIG.selectors.coinPageCardContainer} > div.bg-card`)).find(c => c.textContent.includes('Top Holders'));
            const saved = (store.notes()[sym] || '');
            const card = document.createElement('div'); card.id = CONFIG.ids.coinNoteCard; card.className = 'bg-card text-card-foreground flex flex-col rounded-xl border py-6 shadow-sm gap-4';
            card.innerHTML = `<div class="px-6"><div class="font-semibold leading-none mb-4 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>My Notes<span class="text-xs font-normal text-muted-foreground ml-auto">Local only</span></div><textarea id="re-note-ta" style="width:100%;min-height:80px;resize:vertical;background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:6px;padding:8px;font-size:13px;color:hsl(var(--foreground));outline:none;box-sizing:border-box;font-family:inherit" placeholder="Notes about this coin...">${saved}</textarea><div id="re-note-st" style="font-size:11px;color:hsl(var(--muted-foreground));text-align:right;margin-top:4px;height:14px"></div></div>`;
            if (!this._insertAfterTrade(sym, card)) {
                if (!anchor) { this._pending.delete(key); return; }
                anchor.insertAdjacentElement('beforebegin', card);
            }
            const ta = document.getElementById('re-note-ta'); const st = document.getElementById('re-note-st');
            ta.addEventListener('input', utils.debounce(() => { const n = store.notes(); if (ta.value.trim()) n[sym] = ta.value.trim(); else delete n[sym]; store.notesSet(n); st.textContent = 'Saved'; setTimeout(() => { st.textContent = ''; }, 1500); }, 600));
            this._pending.delete(key);
        },
    };

    const watchlist = {
        _prices: {},
        init() {
            wsInterceptor.on(d => {
                const sym = ((d.data?.coinSymbol || d.data?.symbol) || '').toUpperCase();
                const px = parseFloat(d.data?.price || d.data?.currentPrice || 0);
                if (!sym || !px) return;
                this._prices[sym] = px;
                const el = document.getElementById(`re-wlp-${sym}`);
                if (el) el.textContent = utils.usd(px);
            });
        },
        get: () => store.get('re:wl', []),
        set: v => store.set('re:wl', v),
        has: sym => watchlist.get().includes(String(sym).toUpperCase()),
        add(sym) { const wl = watchlist.get(); if (wl.includes(sym)) { notifier.info(`${sym} already in watchlist`); return; } wl.push(sym); watchlist.set(wl); notifier.ok(`${sym} added to watchlist`); },
        del(sym) { watchlist.set(watchlist.get().filter(s => s !== sym)); },
        renderPanel() {
            const el = document.getElementById('re-wl-panel-body'); if (!el) return;
            const wl = watchlist.get();
            if (!wl.length) { el.innerHTML = '<div class="xp-empty">Watchlist empty.<br>Add coins from any coin page.</div>'; return; }
            el.innerHTML = wl.map(s => `<div class="xp-wl-row"><a href="/coin/${s}" class="xp-wl-sym">${s}</a><span class="xp-wl-px" id="re-wlp-${s}">${this._prices[s]?utils.usd(this._prices[s]):'—'}</span><button class="xp-wl-del" data-s="${s}"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
            el.querySelectorAll('.re-wl-del').forEach(b => b.onclick = () => { this.del(b.dataset.s); this.renderPanel(); });
        },
    };

    const profileEnhancer = {
        async init() {
            if (!utils.isUserPage() || document.getElementById(CONFIG.ids.profileBtns)) return;
            const s = store.settings();
            if (!s.profileHistory && !s.profileWatch) return;
            const pu = utils.getUsernameFromPage(); if (!pu) return;
            const hdr = document.querySelector(CONFIG.selectors.profileHeaderContainer); if (!hdr) return;
            hdr.style.position = 'relative';
            const cont = document.createElement('div'); cont.id = CONFIG.ids.profileBtns;
            cont.className = 'absolute top-4 right-4 flex items-center gap-2 z-10';
            const btnCls = 'focus-visible:border-ring focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 cursor-pointer bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border h-8 gap-1.5 rounded-md px-3';
            const me = await utils.getLoggedInUsername();
            if (me?.toLowerCase() === pu.toLowerCase()) { const a = document.createElement('a'); a.href = '/settings'; a.className = btnCls; a.innerHTML = `${ICONS.edit} Edit`; cont.appendChild(a); }
            if (s.profileHistory) { const histBtn = document.createElement('button'); histBtn.className = btnCls; histBtn.innerHTML = `${ICONS.history} History`; histBtn.onclick = () => this._showHistory(pu, 1); cont.appendChild(histBtn); }
            if (s.profileWatch) {
                const wlBtn = document.createElement('button');
                wlBtn.className = btnCls;
                wlBtn.textContent = watchlist.has(pu) ? '★ Watching' : '☆ Watch';
                wlBtn.onclick = () => { if (watchlist.has(pu)) { watchlist.del(pu); wlBtn.textContent = '☆ Watch'; } else { watchlist.add(pu); wlBtn.textContent = '★ Watching'; } };
                cont.appendChild(wlBtn);
            }
            hdr.appendChild(cont);
        },
        async _showHistory(user, pg = 1) {
            let ov = document.getElementById(CONFIG.ids.historyModalOverlay);
            if (!ov) {
                ov = document.createElement('div'); ov.id = CONFIG.ids.historyModalOverlay; ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);align-items:center;justify-content:center;backdrop-filter:blur(4px)';
                ov.innerHTML = `<div style="position:relative;margin:20px;width:95%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;animation:re-modal-in .2s cubic-bezier(.16,1,.3,1) forwards" class="bg-card text-card-foreground rounded-xl border shadow-2xl overflow-hidden"><button id="re-hist-cl" style="position:absolute;right:12px;top:12px;z-index:50;padding:8px;cursor:pointer;border:none;border-radius:6px;background:none;color:hsl(var(--muted-foreground));transition:background .2s" onmouseenter="this.style.background='hsl(var(--accent))'" onmouseleave="this.style.background='none'">${ICONS.close}</button><div class="p-6 pb-3"><div class="font-bold text-xl flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6 text-primary"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>Trade History</div><p class="text-muted-foreground text-sm mt-1">Viewing history for <span id="${CONFIG.ids.historyModalUsername}" class="text-foreground font-mono"></span></p></div><div id="${CONFIG.ids.historyModalBody}" style="flex:1;overflow-y:auto;min-height:200px"></div><div id="${CONFIG.ids.historyModalPagination}" class="p-4 border-t flex justify-center items-center gap-2 bg-muted/20"></div></div>`;
                document.body.appendChild(ov);
                document.getElementById('re-hist-cl').onclick = () => { ov.style.display = 'none'; };
                ov.onclick = e => { if (e.target === ov) ov.style.display = 'none'; };
            }
            document.getElementById(CONFIG.ids.historyModalUsername).textContent = `@${user}`;
            ov.style.display = 'flex';
            const body = document.getElementById(CONFIG.ids.historyModalBody); const pag = document.getElementById(CONFIG.ids.historyModalPagination);
            pag.innerHTML = '';
            body.innerHTML = `<div class="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">${ICONS.loading}<span class="text-sm animate-pulse">Loading...</span></div>`;
            try {
                const d = await rugplayApi.userTrades(user, pg, 15);
                const tr = d.trades || d.data || d.results || [];
                if (!tr.length) { body.innerHTML = '<div class="flex items-center justify-center h-64 text-muted-foreground">No trade history found</div>'; return; }
                body.innerHTML = `<table class="w-full text-sm"><thead class="sticky top-0 bg-card z-10 border-b"><tr class="text-muted-foreground"><th class="h-10 px-4 text-left font-medium">Type</th><th class="h-10 px-4 text-left font-medium">Coin</th><th class="h-10 px-4 text-left font-medium">Qty</th><th class="h-10 px-4 text-left font-medium">Price</th><th class="h-10 px-4 text-right font-medium">Total</th><th class="h-10 px-4 text-right font-medium">Time</th></tr></thead><tbody>${tr.map(t => { const type = (t.type || 'BUY').toUpperCase(); const isSell = type === 'SELL'; const cls = isSell ? 'bg-destructive' : 'bg-green-600'; return `<tr class="hover:bg-muted/40 border-b transition-colors"><td class="p-4 align-middle"><span class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium text-white border-transparent ${cls}">${type}</span></td><td class="p-4 align-middle"><a href="/coin/${t.coinSymbol || t.symbol}" class="font-bold hover:text-primary">${t.coinSymbol || t.symbol || '?'}</a></td><td class="p-4 align-middle font-mono text-xs text-muted-foreground">${utils.num(parseFloat(t.quantity || 0))}</td><td class="p-4 align-middle font-mono text-sm">$${parseFloat(t.price || 0).toFixed(6)}</td><td class="p-4 align-middle font-mono text-sm font-bold text-right">${utils.usd(t.totalValue || 0)}</td><td class="p-4 align-middle text-sm text-muted-foreground text-right">${utils.date(t.timestamp || t.createdAt)}</td></tr>`; }).join('')}</tbody></table>`;
                const p = d.pagination;
                if (p && p.total_pages > 1) {
                    const mkBtn = (label, page, disabled = false) => { const b = document.createElement('button'); b.textContent = label; b.className = 'inline-flex items-center justify-center text-sm font-medium h-9 px-3 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors'; if (disabled) { b.setAttribute('disabled', ''); b.style.opacity = '.4'; } else b.onclick = () => this._showHistory(user, page); return b; };
                    pag.appendChild(mkBtn('«', p.current_page - 1, p.current_page === 1));
                    const info = document.createElement('span'); info.className = 'text-sm text-muted-foreground'; info.textContent = `${p.current_page} / ${p.total_pages}`; pag.appendChild(info);
                    pag.appendChild(mkBtn('»', p.current_page + 1, p.current_page >= p.total_pages));
                }
            } catch { body.innerHTML = '<div class="flex items-center justify-center h-64 text-destructive text-sm">Failed to load trade history</div>'; }
        },
    };

    const enhancedPanel = {
        isVisible: false,
        originalMainChildren: [],
        init() { window.addEventListener('hashchange', () => this.handleHashChange()); },
        handleHashChange() { const isHash = location.hash === '#rugplay-enhanced'; if (isHash && !this.isVisible) this.show(); else if (!isHash && this.isVisible) this.hide(); },
        show() {
            if (this.isVisible) return;
            const main = document.querySelector(CONFIG.selectors.mainContent); if (!main) return;
            this.originalMainChildren = Array.from(main.children).filter(c => c.id !== CONFIG.ids.panelWrapper);
            this.originalMainChildren.forEach(c => c.style.display = 'none');
            const wrap = document.createElement('div'); wrap.id = CONFIG.ids.panelWrapper; wrap.className = 'w-full max-w-6xl mx-auto p-4 md:p-8';
            wrap.style.animation = 're-fadein .25s cubic-bezier(.16,1,.3,1) forwards';
            wrap.innerHTML = this._render();
            main.appendChild(wrap);
            this.isVisible = true;
            if (location.hash !== '#rugplay-enhanced') location.hash = 'rugplay-enhanced';
            this._attachListeners();
            this._loadChangelog();
            notifications.apply();
            adBlocker.apply();
            const s = store.settings();
            // mod toggles are rendered directly from store state in _render()
            liveFeed.open = true; liveFeed.render(); liveFeed.startTsTimer();
            dashboard.render();
            settingsEngine.applyAll();
            ['re-stat-trades','xp-stat-trades'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=liveFeed.trades.length;});
        },
        hide() {
            if (!this.isVisible) return;
            document.getElementById(CONFIG.ids.panelWrapper)?.remove();
            if (this.originalMainChildren.length) {
                this.originalMainChildren.forEach(c => { try { c.style.display = ''; } catch {} });
            } else {
                const main2 = document.querySelector(CONFIG.selectors.mainContent);
                if (main2) Array.from(main2.children).forEach(c => { try { c.style.display = ''; } catch {} });
            }
            this.originalMainChildren = [];
            this.isVisible = false;
            liveFeed.open = false; liveFeed.stopTsTimer();
            if (location.hash === '#rugplay-enhanced') history.pushState('', document.title, location.pathname + location.search);
        },
        _syncToggle(id, val) { const el = document.getElementById(id); if (el) { el.setAttribute('aria-checked', String(!!val)); } },
        _render() {
            const s = store.settings();
            const activeAlerts = store.alerts().filter(a=>!a.done).length;
            const wlCount = store.get('re:wl',[]).length;

            const MODS = [
                // ══ INTERFACE ════════════════════════════════════════════════
                {key:"adblock",           name:"Ad Blocker",            desc:"Removes all Google and third-party ads injected into Rugplay pages. Cleaner experience, zero distractions.", cat:"Interface"},
                {key:"notifications",     name:"Notification Badges",   desc:"Shows unread notification count on the sidebar icon. Disable to hide the red dot entirely.", cat:"Interface"},
                {key:"stickyPortfolio",   name:"Sticky Portfolio",      desc:"Pins your portfolio widget to the very bottom of the sidebar so it is always visible no matter how far you scroll.", cat:"Interface"},
                {key:"sidebarCompact",    name:"Compact Sidebar",       desc:"Reduces the height of every sidebar nav item to 32px, fitting more items without scrolling.", cat:"Interface"},
                {key:"compactMode",       name:"Compact Page Layout",   desc:"Tightens Tailwind spacing classes across the entire Rugplay UI, similar to a dense data mode.", cat:"Interface"},
                {key:"focusMode",         name:"Focus Mode",            desc:"Fades the sidebar, nav, and header to 15% opacity so you can concentrate on the main content. Hover to reveal them.", cat:"Interface"},
                {key:"borderlessCards",   name:"Borderless Cards",      desc:"Removes all card borders and box shadows for a minimal, flat look. Pairs well with dark mode.", cat:"Interface"},
                {key:"monoFont",          name:"Monospace Font",        desc:"Forces the entire Rugplay UI into monospace font. Looks great for data-dense pages.", cat:"Interface"},
                {key:"reducedMotion",     name:"Reduce Motion",         desc:"Sets all CSS animations and transitions to 0.01ms. Useful if you find motion distracting or are on a slow machine.", cat:"Interface"},
                {key:"smoothScrolling",   name:"Smooth Scrolling",      desc:"Enables CSS smooth scrolling across the entire page. Makes navigation feel fluid.", cat:"Interface"},
                {key:"largeClickTargets", name:"Large Click Targets",   desc:"Ensures all buttons and links have a minimum height of 32px, reducing misclicks on small elements.", cat:"Interface"},
                {key:"betterScrollbars",  name:"Better Scrollbars",     desc:"Replaces the default scrollbars with slim 6px styled ones that match Rugplay dark theme.", cat:"Interface"},
                {key:"hideFooter",        name:"Hide Footer",           desc:"Hides the page footer entirely to reclaim vertical space on every page.", cat:"Interface"},
                {key:"hidePromoBar",      name:"Hide Promo Banners",    desc:"Hides promotional banners and announcement bars that appear at the top of some Rugplay pages.", cat:"Interface"},
                {key:"hideRightSidebar",  name:"Hide Right Panel",      desc:"Collapses the right-side sidebar panel on pages that have one, giving the main content more room.", cat:"Interface"},
                {key:"hideOnlineCount",   name:"Hide Online Count",     desc:"Hides user online count indicators across the platform for a less noisy experience.", cat:"Interface"},
                {key:"dimInactiveTabs",   name:"Dim Inactive Tabs",     desc:"Slightly dims content in browser tabs that are not focused, saving attention for the active one.", cat:"Interface"},
                {key:"sidebarSearch",     name:"Sidebar Quick Search",  desc:"Adds a Quick Search button to the sidebar navigation. Ctrl+K also works from anywhere.", cat:"Interface"},
                {key:"urlShortcuts",      name:"URL Shortcuts",         desc:"Lets you navigate to /@username or /*SYMBOL directly from the address bar.", cat:"Interface"},
                {key:"keyboardShortcuts", name:"Keyboard Shortcuts",    desc:"Enables all Enhanced keyboard shortcuts: Ctrl+K for quick search, Ctrl+Shift+E for the Enhanced panel.", cat:"Interface"},
                {key:"autoOpenPanel",     name:"Auto-open Panel",       desc:"Automatically opens the Enhanced panel every time you load Rugplay. Good if you live in the dashboard.", cat:"Interface"},
                // ══ TRADING ══════════════════════════════════════════════════
                {key:"txCard",            name:"Transaction Card",      desc:"Injects a Recent Transactions card on every coin page showing the last 10 trades with pagination and live refresh.", cat:"Trading"},
                {key:"riskCard",          name:"Risk Assessment Card",  desc:"Injects a Risk Assessment card on coin pages with a 0-100 score based on age, holders, market cap, and sell pressure.", cat:"Trading"},
                {key:"riskScore",         name:"Risk Scoring Engine",   desc:"Powers the background risk calculation used by the Risk Assessment Card and the Reporter badge. Disable to stop all risk computation.", cat:"Trading"},
                {key:"reportedBadge",     name:"Reported Badge",        desc:"Shows a Community reported badge on coin pages where the creator or coin symbol has been submitted to the Rugpull Reporter.", cat:"Trading"},
                {key:"coinNotes",         name:"Coin Notes",            desc:"Adds a private per-coin notes widget on every coin page. Notes are stored 100% locally in your browser, never sent anywhere.", cat:"Trading"},
                {key:"highlightNewCoins", name:"Highlight New Coins",   desc:"Adds a green left-border to coins under 1 hour old anywhere they appear in tables or feeds.", cat:"Trading"},
                {key:"showCoinAge",       name:"Show Coin Age",         desc:"Displays the age of a coin underneath the coin name on coin pages.", cat:"Trading"},
                {key:"showHolderCount",   name:"Show Holder Count",     desc:"Displays the holder count prominently on coin pages alongside the standard market cap data.", cat:"Trading"},
                {key:"showCreatorBadge",  name:"Show Creator Tag",      desc:"Shows Enhanced user tags on coin page comments and profile pages.", cat:"Trading"},
                {key:"holdersWarning",    name:"Low Holder Warning",    desc:"Shows a warning indicator on coin pages when holder count is below 10, signalling high concentration risk.", cat:"Trading"},
                {key:"warnLowLiquidity",  name:"Low Liquidity Warning", desc:"Warns when a coin market cap is under $500, indicating extremely thin liquidity and high rugpull risk.", cat:"Trading"},
                {key:"txTimestamps",      name:"Live Timestamps",       desc:"Keeps transaction timestamps in the Recent Transactions card updated live without refreshing.", cat:"Trading"},
                {key:"txHighlightNew",    name:"Highlight New Txns",    desc:"Animates newly appeared transactions with a green flash when the feed refreshes.", cat:"Trading"},
                {key:"confirmTrades",     name:"Trade Confirmation",    desc:"Adds a confirmation step before executing buy/sell trades to prevent accidental clicks.", cat:"Trading"},
                {key:"showFeeEstimate",   name:"Fee Estimate",          desc:"Shows an estimated transaction fee in USD before you confirm a trade, so you always know what you are paying.", cat:"Trading"},
                {key:"highlightProfitLoss", name:"P&L Highlight",      desc:"Colors your portfolio positions green or red based on unrealised profit/loss for instant visual reference.", cat:"Trading"},
                {key:"showPortfolioPercent", name:"Portfolio %",        desc:"Shows each coin percentage of your total portfolio value in the sidebar portfolio widget.", cat:"Trading"},
                {key:"showPriceChange",   name:"24h Price Change",      desc:"Shows the 24-hour percentage price change alongside coin names throughout the platform.", cat:"Trading"},
                {key:"showVolume24h",     name:"24h Volume",            desc:"Displays 24-hour trading volume on coin pages as an additional data point next to market cap.", cat:"Trading"},
                {key:"showMarketCap",     name:"Market Cap Display",    desc:"Ensures the market cap figure is always prominently visible on coin pages and feed rows.", cat:"Trading"},
                {key:"highlightWhaleTrades", name:"Whale Trade Glow",  desc:"Draws a gold ring around trades in the live feed and transaction card that exceed the configured whale threshold.", cat:"Trading"},
                {key:"profileHistory",    name:"Trade History Button",  desc:"Adds a History button on every user profile page that opens a full paginated trade history modal.", cat:"Trading"},
                {key:"profileWatch",      name:"Watch User Button",     desc:"Adds a Watch toggle on user profile pages so you can track them in your watchlist.", cat:"Trading"},
                {key:"clickableRows",     name:"Clickable Table Rows",  desc:"Makes every row in portfolio and holdings tables clickable — clicking anywhere on the row navigates to the coin page.", cat:"Trading"},
                {key:"showPnL",           name:"Session P&L",           desc:"Tracks your total portfolio value at session start and displays your unrealised P&L in the sidebar. Resets on refresh.", cat:"Trading"},
                // ══ ALERTS ═══════════════════════════════════════════════════
                {key:"botWarning",        name:"Bot Detection",         desc:"Analyses timing variance and repeat-trader ratio in the live WebSocket feed. Fires when bot-like patterns are detected on any coin.", cat:"Alerts"},
                {key:"volumeSpikes",      name:"Volume Spike Alert",    desc:"Monitors 60-second rolling volume per coin. Fires a warning when a single coin exceeds the configured USD threshold in one minute.", cat:"Alerts"},
                {key:"whalePing",         name:"Whale Radar Ping",      desc:"Notifies you in the Enhanced panel Whale Radar when a single trade exceeds your configured whale threshold (default $250).", cat:"Alerts"},
                {key:"alertOnWatchlistTrade", name:"Watchlist Alert",   desc:"Pops a notification whenever a coin on your watchlist sees a new trade in the live WebSocket feed.", cat:"Alerts"},
                {key:"alertOnNewCoin",    name:"New Coin Alert",        desc:"Fires a notification when a brand-new coin (under 5 minutes old) appears in the live trade feed for the first time.", cat:"Alerts"},
                {key:"alertOnHolderDrop", name:"Holder Drop Alert",     desc:"Watches for holder count decreasing rapidly on coin pages you are currently viewing. Fires if holders drop by 10%+ in 2 minutes.", cat:"Alerts"},
                {key:"alertOnVolumeSpike", name:"Volume Spike Thresh",  desc:"Alert fires when 60-second rolling volume exceeds the configured USD amount. Adjust the threshold in the volume spike setting.", cat:"Alerts"},
                {key:"alertOnBotActivity", name:"Bot Activity Alert",   desc:"Shows a notification toast when bot patterns are detected. Disable if you find it too noisy on high-activity coins.", cat:"Alerts"},
                {key:"alertOnPriceDrop",  name:"Price Drop Alert",      desc:"Fires a notification if a coin you are watching drops by more than the configured percentage within a single minute.", cat:"Alerts"},
                {key:"alertOnNewReport",  name:"New Report Alert",      desc:"Notifies you when a new rugpull report is submitted by the community to the Enhanced reporter API.", cat:"Alerts"},
                {key:"alertOnCreatorSell", name:"Creator Sell Alert",   desc:"Fires when the coin creator wallet shows a SELL transaction in the live trade feed — a classic rugpull warning sign.", cat:"Alerts"},
                {key:"desktopAlerts",     name:"Desktop Notifications", desc:"Sends browser-level push notifications for price alerts and major events. Requires notification permission.", cat:"Alerts"},
                {key:"flashTitle",        name:"Flash Tab Title",       desc:"Briefly flashes the browser tab title when a price alert fires, even if the tab is in the background.", cat:"Alerts"},
                {key:"soundAlerts",       name:"Sound Alerts",          desc:"Plays a brief audio tone when a price alert triggers. Uses the Web Audio API — no external files needed.", cat:"Alerts"},
                // ══ PRIVACY ══════════════════════════════════════════════════
                {key:"appearOffline",     name:"Appear Offline",        desc:"Spoofs document.hidden and document.visibilityState so Rugplay thinks your tab is hidden, suppressing online status in DMs.", cat:"Privacy"},
                {key:"hideBalance",       name:"Hide Balance",          desc:"Hides all balance and portfolio value numbers across Rugplay. Numbers show as dots until you hover.", cat:"Privacy"},
                {key:"blurPortfolioValue", name:"Blur Portfolio",       desc:"Blurs portfolio numbers in the sidebar until you hover over them. Good for streaming or sharing your screen.", cat:"Privacy"},
                {key:"blockAnalytics",    name:"Block Analytics",       desc:"Blocks known Rugplay analytics endpoints and tracking scripts from firing. Enhanced itself never tracks you.", cat:"Privacy"},
                {key:"stripTrackingParams", name:"Strip Tracking",      desc:"Automatically removes UTM and tracking query parameters from URLs as you navigate.", cat:"Privacy"},
                {key:"anonymousMode",     name:"Anonymous Mode",        desc:"Replaces your username display with Anon — useful for sharing screenshots without revealing your account.", cat:"Privacy"},
                {key:"noReferrer",        name:"No Referrer",           desc:"Adds rel=noreferrer to all external links you click, preventing external sites from knowing you came from Rugplay.", cat:"Privacy"},
                {key:"hideOfflineDM",     name:"Hide DM Online Status", desc:"Hides the green online dot on DM conversations so others cannot see when you were last active.", cat:"Privacy"},
                // ══ DISPLAY ══════════════════════════════════════════════════
                {key:"forceDark",         name:"Force Dark Mode",       desc:"Forces Rugplay into dark mode by toggling the dark class on the root element, even if your OS is set to light.", cat:"Display"},
                {key:"autoRefreshFeed",   name:"Auto-refresh Feed",     desc:"Keeps the live transaction feed and Recent Transactions cards updating automatically without you needing to click Refresh.", cat:"Display"},
                {key:"watchlistAlerts",   name:"Watchlist Notify",      desc:"Shows a toast notification in the corner when a coin on your watchlist has new trade activity.", cat:"Display"},
                {key:"feedCompact",       name:"Compact Feed",          desc:"Reduces the height of each row in the live trade feed from 52px to 36px, fitting around 50% more trades on screen.", cat:"Display"},
                {key:"showSpread",        name:"Show Price Spread",     desc:"Displays the bid/ask spread percentage on coin pages to help you understand entry/exit cost before trading.", cat:"Display"},
                {key:"preloadCoinData",   name:"Preload Coin Data",     desc:"On hover, starts fetching coin data in the background so the page loads instantly when you click.", cat:"Display"},
                {key:"quickSearch",       name:"Quick Search (Ctrl+K)", desc:"Enables the Ctrl+K search modal. Searches coins and users via Rugplay own API. Falls back to the live feed if the API is unavailable.", cat:"Display"},
                {key:"highlightBuys",     name:"Highlight Buys",        desc:"Adds a subtle green left border to BUY transactions throughout the live feed and transaction cards.", cat:"Display"},
                {key:"highlightSells",    name:"Highlight Sells",       desc:"Adds a subtle red left border to SELL transactions throughout the live feed and transaction cards.", cat:"Display"},
                {key:"showCandleColors",  name:"Candle Colors",         desc:"Ensures buy/sell color coding is applied consistently across all chart candles and price indicators.", cat:"Display"},
                // ══ EXPERIMENTAL ═════════════════════════════════════════════
                {key:"trackSlippage",     name:"Slippage Tracker",      desc:"[Beta] Tracks estimated slippage on your recent trades by comparing execution price to the feed price at trade time.", cat:"Experimental"},
                {key:"showBidAsk",        name:"Live Bid/Ask",          desc:"[Beta] Attempts to derive a live bid/ask spread from recent WebSocket trade data and display it on coin pages.", cat:"Experimental"},
                {key:"showPortfolioCostBasis", name:"Cost Basis",       desc:"[Beta] Estimates your average cost basis per coin from your trade history and shows unrealised P&L against it.", cat:"Experimental"},
                {key:"alertOnRiskChange", name:"Risk Change Alert",     desc:"[Beta] Fires when a coin local risk score changes by more than 10 points between checks — e.g. sudden holder drop.", cat:"Experimental"},
                {key:"devMode",           name:"Dev Mode",              desc:"[Beta] Logs Enhanced internal events to the browser console. Only useful if you are debugging or contributing to the project.", cat:"Experimental"},
            ];

            const CATS = ["Interface","Trading","Alerts","Privacy","Display","Experimental"];
            const CAT_COLORS = {Interface:"#60a5fa",Trading:"#34d399",Alerts:"#f59e0b",Privacy:"#a78bfa",Display:"#f472b6",Experimental:"#94a3b8"};
            const CAT_ICONS = {
                Interface:    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
                Trading:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
                Alerts:       '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
                Privacy:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
                Display:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
                Experimental: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 3h6l1 7H8L9 3z"/><path d="M8 10l-4.45 8.01A2 2 0 0 0 5.3 21h13.4a2 2 0 0 0 1.75-2.99L16 10"/></svg>',
            };

            const modCardHTML = (mod) => {
                const on = !!s[mod.key];
                return `<div class="xp-mod-card ${on?'on':''}" data-mod-key="${mod.key}">
                    <div class="xp-mod-top">
                        <div class="xp-mod-info">
                            <div class="xp-mod-name">${mod.name}</div>
                            <div class="xp-mod-desc">${mod.desc}</div>
                        </div>
                        <button class="xp-toggle ${on?'on':''}" data-mod-key="${mod.key}" aria-checked="${on}" role="switch" title="${on?'Enabled':'Disabled'}">
                            <span class="xp-toggle-knob"></span>
                        </button>
                    </div>
                </div>`;
            };

            const modsHTML = CATS.map(cat => {
                const catMods = MODS.filter(m => m.cat === cat);
                const enabledCount = catMods.filter(m => !!s[m.key]).length;
                const color = CAT_COLORS[cat];
                return `<div class="xp-cat-block">
                    <div class="xp-cat-hd">
                        <span class="xp-cat-dot" style="background:${color}"></span>
                        <span class="xp-cat-icon" style="color:${color}">${CAT_ICONS[cat]}</span>
                        <span class="xp-cat-name">${cat}</span>
                        <span class="xp-cat-pill">${enabledCount}/${catMods.length}</span>
                    </div>
                    <div class="xp-mod-grid">${catMods.map(modCardHTML).join('')}</div>
                </div>`;
            }).join('');

            const enabledTotal = MODS.filter(m => !!s[m.key]).length;

            return `
<style>
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap');
:root {
    --xp-bg:#09090b; --xp-s1:#111113; --xp-s2:#18181b; --xp-s3:#27272a;
    --xp-b1:rgba(255,255,255,.07); --xp-b2:rgba(255,255,255,.11); --xp-b3:rgba(255,255,255,.18);
    --xp-t1:#fafafa; --xp-t2:#a1a1aa; --xp-t3:#52525b;
    --xp-green:#22c55e; --xp-red:#ef4444; --xp-amber:#f59e0b; --xp-blue:#3b82f6;
    --xp-r:10px; --xp-r-sm:6px;
    --xp-font:'Geist',-apple-system,BlinkMacSystemFont,sans-serif;
    --xp-mono:'Geist Mono','SF Mono',ui-monospace,monospace;
}
@keyframes xp-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes xp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.65)}}
@keyframes xp-spin{to{transform:rotate(360deg)}}

/* ── Shell ── */
#re-panel-wrapper{background:var(--xp-bg)!important;padding:0!important;max-width:100%!important;min-height:100vh;font-family:var(--xp-font)!important;color:var(--xp-t1)!important;display:flex;flex-direction:column}
.xp-shell{display:flex;flex-direction:column;min-height:100vh;animation:xp-in .2s cubic-bezier(.16,1,.3,1)}

/* ── Top bar ── */
.xp-bar{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:50px;border-bottom:1px solid var(--xp-b1);background:var(--xp-bg);position:sticky;top:0;z-index:100;gap:12px;flex-shrink:0}
.xp-bar-l,.xp-bar-r{display:flex;align-items:center;gap:8px}
.xp-logo{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:-.025em;color:var(--xp-t1)}
.xp-logo-icon{width:22px;height:22px;background:var(--xp-t1);border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.xp-logo-icon svg{color:var(--xp-bg)}
.xp-sep{width:1px;height:14px;background:var(--xp-b2)}
.xp-pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:.04em;border-radius:99px;padding:2px 8px;border:1px solid}
.xp-pill.live{color:var(--xp-green);background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.18)}
.xp-pill.ver{color:var(--xp-t3);background:var(--xp-s2);border-color:var(--xp-b1);letter-spacing:.06em}
.xp-live-dot{width:5px;height:5px;border-radius:50%;background:var(--xp-green);animation:xp-pulse 1.6s ease-in-out infinite}
.xp-icon-btn{width:28px;height:28px;border-radius:var(--xp-r-sm);background:transparent;border:1px solid var(--xp-b1);color:var(--xp-t2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;text-decoration:none}
.xp-icon-btn:hover{background:var(--xp-s2);color:var(--xp-t1);border-color:var(--xp-b2)}
.xp-kbd{font-size:9px;font-family:var(--xp-mono);background:var(--xp-s2);border:1px solid var(--xp-b2);border-radius:4px;padding:2px 5px;color:var(--xp-t3)}

/* ── Chips ── */
.xp-chips{display:flex;align-items:center;gap:5px}
.xp-chip{display:flex;align-items:center;gap:5px;padding:3px 9px;background:var(--xp-s1);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);font-size:11px;transition:border-color .12s;cursor:default}
.xp-chip:hover{border-color:var(--xp-b2)}
.xp-chip-v{font-weight:700;color:var(--xp-t1);font-family:var(--xp-mono)}
.xp-chip-k{color:var(--xp-t2);font-weight:500}

/* ── Nav tabs ── */
.xp-nav{display:flex;align-items:center;gap:0;padding:0 24px;border-bottom:1px solid var(--xp-b1);background:var(--xp-bg);overflow-x:auto;flex-shrink:0}
.xp-nav::-webkit-scrollbar{display:none}
.xp-tab{display:inline-flex;align-items:center;gap:6px;padding:0 11px;height:40px;font-size:12px;font-weight:500;color:var(--xp-t2);background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s,border-color .12s;white-space:nowrap;font-family:var(--xp-font)}
.xp-tab:hover{color:var(--xp-t1)}
.xp-tab.active{color:var(--xp-t1);border-bottom-color:var(--xp-t1);font-weight:600}
.xp-tab svg{opacity:.5}
.xp-tab.active svg{opacity:1}
.xp-tab-badge{font-size:9px;font-weight:800;min-width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.09);color:var(--xp-t2);border-radius:99px;padding:0 4px}
.xp-tab.active .xp-tab-badge{background:var(--xp-t1);color:var(--xp-bg)}

/* ── Body ── */
.xp-body{flex:1;padding:20px 24px;display:flex;flex-direction:column;gap:14px}
[data-re-section]{display:none}

/* ── 2-col layout ── */
.xp-2col{display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start}
@media(max-width:1080px){.xp-2col{grid-template-columns:1fr}}
.xp-col{display:flex;flex-direction:column;gap:14px}

/* ── Stat row ── */
.xp-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:900px){.xp-stat-row{grid-template-columns:repeat(2,1fr)}}
.xp-stat-box{background:var(--xp-s1);border:1px solid var(--xp-b1);border-radius:var(--xp-r);padding:14px 16px;cursor:default;transition:border-color .15s,transform .12s}
.xp-stat-box:hover{border-color:var(--xp-b2);transform:translateY(-1px)}
.xp-stat-n{font-size:22px;font-weight:800;letter-spacing:-.04em;font-family:var(--xp-mono);color:var(--xp-t1);line-height:1}
.xp-stat-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--xp-t3);margin-top:6px}
.xp-stat-box.green{border-color:rgba(34,197,94,.15)} .xp-stat-box.green .xp-stat-n{color:var(--xp-green)}
.xp-stat-box.amber{border-color:rgba(245,158,11,.15)} .xp-stat-box.amber .xp-stat-n{color:var(--xp-amber)}

/* ── Cards ── */
.xp-card{background:var(--xp-s1);border:1px solid var(--xp-b1);border-radius:var(--xp-r);overflow:hidden;transition:border-color .15s}
.xp-card-hd{padding:12px 16px;border-bottom:1px solid var(--xp-b1);display:flex;align-items:center;justify-content:space-between;gap:10px}
.xp-card-title{font-size:12px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.xp-card-title svg{color:var(--xp-t2)}
.xp-card-sub{font-size:10px;color:var(--xp-t3);margin-top:2px}
.xp-card-body{padding:14px 16px}

/* ── Form inputs ── */
.xp-input{background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);padding:0 10px;height:30px;font-size:12px;color:var(--xp-t1);font-family:var(--xp-font);outline:none;width:100%;box-sizing:border-box;transition:border-color .12s}
.xp-input:focus{border-color:var(--xp-b3)}
.xp-input::placeholder{color:var(--xp-t3)}
.xp-select{background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);padding:0 8px;height:30px;font-size:12px;color:var(--xp-t1);font-family:var(--xp-font);outline:none;cursor:pointer;width:100%;box-sizing:border-box}
.xp-textarea{background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);padding:9px 11px;font-size:12px;color:var(--xp-t1);font-family:var(--xp-font);outline:none;width:100%;resize:vertical;min-height:80px;box-sizing:border-box;line-height:1.5;transition:border-color .12s}
.xp-textarea:focus{border-color:var(--xp-b3)}
.xp-textarea::placeholder{color:var(--xp-t3)}
.xp-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--xp-t3);margin-bottom:4px;display:block}
.xp-form-row{display:flex;flex-direction:column;gap:3px}
.xp-form-grid{display:grid;gap:8px}

/* ── Buttons ── */
.xp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;height:30px;font-size:12px;font-weight:600;font-family:var(--xp-font);border:1px solid var(--xp-b2);border-radius:var(--xp-r-sm);background:var(--xp-s2);color:var(--xp-t1);cursor:pointer;transition:all .12s;white-space:nowrap;box-sizing:border-box}
.xp-btn:hover{background:var(--xp-s3);border-color:var(--xp-b3)}
.xp-btn.primary{background:var(--xp-t1);color:var(--xp-bg);border-color:transparent}
.xp-btn.primary:hover{opacity:.86}
.xp-btn.ghost{background:transparent;border-color:var(--xp-b1)}
.xp-btn.ghost:hover{background:var(--xp-s2)}
.xp-btn.danger{border-color:rgba(239,68,68,.25);color:var(--xp-red)}
.xp-btn.danger:hover{background:rgba(239,68,68,.07)}
.xp-btn-full{width:100%}

/* ── Feed ── */
.xp-feed-ctrl{display:grid;grid-template-columns:1fr 90px 120px 30px;gap:6px;padding:10px 16px;border-bottom:1px solid var(--xp-b1);align-items:center}
.xp-feed-head{display:grid;grid-template-columns:46px 68px 1fr auto auto;gap:6px;padding:5px 16px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--xp-t3);border-bottom:1px solid var(--xp-b1)}
.xp-feed-rows{max-height:280px;overflow-y:auto}
.xp-feed-row{display:grid;grid-template-columns:46px 68px 1fr auto auto;gap:6px;padding:7px 16px;border-bottom:1px solid var(--xp-b1);font-size:12px;text-decoration:none;color:var(--xp-t1);transition:background .08s;align-items:center}
.xp-feed-row:last-child{border-bottom:none}
.xp-feed-row:hover{background:rgba(255,255,255,.02)}
.xp-feed-row.buy{border-left:2px solid var(--xp-green);padding-left:14px}
.xp-feed-row.sell{border-left:2px solid var(--xp-red);padding-left:14px}
.xp-b-buy{font-size:9px;font-weight:800;color:var(--xp-green);background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);border-radius:4px;padding:2px 5px;letter-spacing:.03em}
.xp-b-sell{font-size:9px;font-weight:800;color:var(--xp-red);background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 5px;letter-spacing:.03em}
.xp-f-sym{font-weight:700;font-family:var(--xp-mono);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-f-usr{color:var(--xp-t2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-f-val{font-weight:700;font-size:11px;font-family:var(--xp-mono);white-space:nowrap}
.xp-f-ts{color:var(--xp-t3);font-size:10px;white-space:nowrap}

/* ── Agg bar ── */
.xp-agg-row{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-bottom:1px solid var(--xp-b1)}
.xp-agg-cell{padding:10px 16px;border-right:1px solid var(--xp-b1);text-align:center}
.xp-agg-cell:last-child{border-right:none}
.xp-agg-v{font-size:13px;font-weight:800;font-family:var(--xp-mono);color:var(--xp-t1)}
.xp-agg-k{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3);margin-top:2px}

/* ── Mini rows ── */
.xp-mini-list{display:flex;flex-direction:column;gap:3px}
.xp-mini-row{display:grid;grid-template-columns:58px 1fr auto;gap:8px;align-items:center;padding:7px 8px;border-radius:var(--xp-r-sm);text-decoration:none;color:var(--xp-t1);transition:background .1s;border:1px solid transparent}
.xp-mini-row:hover{background:var(--xp-s2);border-color:var(--xp-b1)}
.xp-mini-sym{font-weight:800;font-family:var(--xp-mono);font-size:11px}
.xp-mini-sub{font-size:10px;color:var(--xp-t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-t-buy{font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;background:rgba(34,197,94,.1);color:var(--xp-green);white-space:nowrap}
.xp-t-sell{font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;background:rgba(239,68,68,.1);color:var(--xp-red);white-space:nowrap}

/* ── Radar ── */
.xp-radar-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.xp-section-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--xp-t3);margin-bottom:7px}

/* ── Watchlist ── */
.xp-wl-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--xp-b1)}
.xp-wl-row:last-child{border-bottom:none}
.xp-wl-sym{font-weight:700;font-family:var(--xp-mono);font-size:13px;color:var(--xp-t1);text-decoration:none;flex:1}
.xp-wl-sym:hover{text-decoration:underline;text-underline-offset:3px}
.xp-wl-px{font-size:12px;color:var(--xp-t2);font-family:var(--xp-mono)}
.xp-wl-del{background:none;border:none;cursor:pointer;color:var(--xp-t3);width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all .1s;flex-shrink:0}
.xp-wl-del:hover{background:rgba(239,68,68,.1);color:var(--xp-red)}

/* ── Alert rows ── */
.xp-al-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);background:var(--xp-s2);transition:opacity .15s}
.xp-al-row.done{opacity:.4}
.xp-al-info{flex:1}
.xp-al-sym{font-weight:700;font-size:12px;font-family:var(--xp-mono)}
.xp-al-meta{font-size:11px;color:var(--xp-t2);margin-top:1px}
.xp-al-del{background:none;border:none;cursor:pointer;color:var(--xp-t3);padding:3px;border-radius:4px;transition:all .1s;display:flex;align-items:center}
.xp-al-del:hover{background:rgba(239,68,68,.1);color:var(--xp-red)}

/* ── Mods ── */
.xp-mods-top{padding:12px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--xp-b1);background:var(--xp-s1);position:sticky;top:90px;z-index:10}
.xp-mods-sw{flex:1;position:relative}
.xp-mods-sw svg{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--xp-t3);pointer-events:none}
.xp-mods-si{padding-left:29px!important}
.xp-mods-count{font-size:11px;color:var(--xp-t2);white-space:nowrap;font-weight:600}
.xp-cat-filter{display:flex;gap:4px;padding:10px 16px;border-bottom:1px solid var(--xp-b1);flex-wrap:wrap}
.xp-cat-btn{font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid var(--xp-b1);background:transparent;color:var(--xp-t2);cursor:pointer;transition:all .12s;font-family:var(--xp-font)}
.xp-cat-btn:hover{border-color:var(--xp-b2);color:var(--xp-t1)}
.xp-cat-btn.active{background:var(--xp-t1);color:var(--xp-bg);border-color:transparent}
.xp-mods-body{padding:14px 16px;display:flex;flex-direction:column;gap:18px}
.xp-cat-block{}
.xp-cat-hd{display:flex;align-items:center;gap:7px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid var(--xp-b1)}
.xp-cat-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.xp-cat-icon{display:flex;align-items:center}
.xp-cat-name{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--xp-t1)}
.xp-cat-pill{font-size:9px;font-weight:700;padding:1px 6px;background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:99px;color:var(--xp-t2);margin-left:auto}
.xp-mod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:7px}
.xp-mod-card{background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);padding:11px;display:flex;flex-direction:column;gap:0;transition:border-color .15s}
.xp-mod-card.on{border-color:var(--xp-b2)}
.xp-mod-card:hover{border-color:var(--xp-b3)}
.xp-mod-top{display:flex;gap:10px;align-items:flex-start}
.xp-mod-info{flex:1;min-width:0}
.xp-mod-name{font-size:12px;font-weight:700;color:var(--xp-t1);margin-bottom:3px}
.xp-mod-desc{font-size:10px;color:var(--xp-t2);line-height:1.5}

/* ── Toggle ── */
.xp-toggle{width:34px;height:18px;border-radius:99px;border:1px solid var(--xp-b2);background:var(--xp-s3);cursor:pointer;position:relative;flex-shrink:0;transition:background .18s,border-color .18s;margin-top:1px}
.xp-toggle.on{background:var(--xp-t1);border-color:transparent}
.xp-toggle-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--xp-t3);transition:left .16s,background .16s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.xp-toggle.on .xp-toggle-knob{left:18px;background:var(--xp-bg)}

/* ── Reporter ── */
.xp-rp-row{padding:11px;background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);display:flex;flex-direction:column;gap:6px;transition:border-color .12s}
.xp-rp-row:hover{border-color:var(--xp-b2)}
.xp-rp-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.xp-rp-user{font-weight:700;font-size:12px;font-family:var(--xp-mono)}
.xp-rp-coin{font-size:11px;color:var(--xp-blue);font-family:var(--xp-mono);font-weight:600}
.xp-rp-time{font-size:10px;color:var(--xp-t3);margin-left:auto}
.xp-rp-body{font-size:12px;color:var(--xp-t2);line-height:1.5}
.xp-rp-foot{display:flex;gap:6px}
.xp-vote{font-size:11px;font-weight:600;color:var(--xp-t2);background:none;border:1px solid var(--xp-b1);border-radius:4px;padding:2px 7px;cursor:pointer;font-family:var(--xp-font);transition:all .1s}
.xp-vote.up:hover{color:var(--xp-green);border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.07)}
.xp-vote.dn:hover{color:var(--xp-red);border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.07)}

/* ── Compare table ── */
.xp-cmp{width:100%;border-collapse:collapse;font-size:12px}
.xp-cmp th{padding:9px 13px;text-align:left;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--xp-t3);border-bottom:1px solid var(--xp-b1)}
.xp-cmp td{padding:8px 13px;border-bottom:1px solid var(--xp-b1);color:var(--xp-t2)}
.xp-cmp tr:last-child td{border-bottom:none}
.xp-cmp tr:hover td{background:rgba(255,255,255,.015)}
.xp-cmp .ours{font-weight:700;color:var(--xp-t1)}
.xp-cmp .ck{color:var(--xp-green);font-weight:800}
.xp-cmp .cx{color:var(--xp-t3);opacity:.45}
.xp-cmp .bad{color:var(--xp-red)!important;font-weight:700}
.xp-cmp .warn td{background:rgba(239,68,68,.03)}

/* ── Diagnostics ── */
.xp-diag-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--xp-b1)}
.xp-diag-row:last-child{border-bottom:none}
.xp-diag-l{font-size:12px;color:var(--xp-t2);display:flex;align-items:center;gap:7px}
.xp-diag-v{font-size:11px;font-family:var(--xp-mono);font-weight:600}
.xp-dot-ok{width:6px;height:6px;border-radius:50%;background:var(--xp-green);flex-shrink:0}
.xp-dot-err{width:6px;height:6px;border-radius:50%;background:var(--xp-red);flex-shrink:0}
.xp-dot-idle{width:6px;height:6px;border-radius:50%;background:var(--xp-t3);flex-shrink:0}

/* ── Misc ── */
.xp-empty{padding:24px;text-align:center;color:var(--xp-t3);font-size:12px;line-height:1.7}
.xp-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:20px;color:var(--xp-t2);font-size:12px}
.xp-spin{animation:xp-spin .8s linear infinite}
.xp-pag{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border-top:1px solid var(--xp-b1)}
.xp-pag-btn{background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--xp-t1);cursor:pointer;transition:all .1s;font-family:var(--xp-font)}
.xp-pag-btn:hover{border-color:var(--xp-b2)}
.xp-pag-btn:disabled{opacity:.3;cursor:not-allowed}
.xp-pag-info{font-size:11px;color:var(--xp-t2);font-family:var(--xp-mono)}
.xp-cl-item{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--xp-b1)}
.xp-cl-item:last-child{border-bottom:none}
.xp-cl-dot{width:5px;height:5px;border-radius:50%;background:var(--xp-t3);flex-shrink:0;margin-top:5px}
.xp-cl-text{font-size:12px;color:var(--xp-t2);line-height:1.5}
.xp-footer{border-top:1px solid var(--xp-b1);padding:10px 24px;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--xp-t3);flex-shrink:0}
.xp-footer-links{display:flex;gap:12px}
.xp-flink{color:var(--xp-t3);text-decoration:none;font-weight:500;transition:color .1s;cursor:pointer;background:none;border:none;font-family:var(--xp-font);font-size:11px;padding:0}
.xp-flink:hover{color:var(--xp-t1)}
#re-panel-wrapper ::-webkit-scrollbar{width:4px;height:4px}
#re-panel-wrapper ::-webkit-scrollbar-track{background:transparent}
#re-panel-wrapper ::-webkit-scrollbar-thumb{background:var(--xp-b2);border-radius:2px}
</style>

<div class="xp-shell">

<!-- TOPBAR -->
<div class="xp-bar">
    <div class="xp-bar-l">
        <div class="xp-logo">
            <div class="xp-logo-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
            Enhanced
        </div>
        <div class="xp-sep"></div>
        <span class="xp-pill ver">v${GM_info.script.version}</span>
        <div class="xp-pill live"><div class="xp-live-dot"></div>LIVE</div>
    </div>
    <div class="xp-chips">
        <div class="xp-chip"><span class="xp-chip-v" id="xp-stat-trades">0</span><span class="xp-chip-k">trades</span></div>
        <div class="xp-chip"><span class="xp-chip-v" id="re-stat-alerts">${activeAlerts}</span><span class="xp-chip-k">alerts</span></div>
        <div class="xp-chip"><span class="xp-chip-v" id="re-stat-wl">${wlCount}</span><span class="xp-chip-k">watching</span></div>
        <div class="xp-chip"><span class="xp-chip-v">${enabledTotal}</span><span class="xp-chip-k">mods on</span></div>
    </div>
    <div class="xp-bar-r">
        <span class="xp-kbd">Ctrl+K</span>
        <span style="font-size:10px;color:var(--xp-t3)">search</span>
        <div class="xp-sep"></div>
        <button class="xp-icon-btn" id="re-feedback-btn" title="Feedback">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <a class="xp-icon-btn" href="https://github.com/devbyego/rugplay-enhanced" target="_blank" title="GitHub">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
        </a>
    </div>
</div>

<!-- NAV TABS -->
<div class="xp-nav">
    <button class="xp-tab" data-re-tab="dashboard"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Dashboard</button>
    <button class="xp-tab" data-re-tab="watchlist"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>Watchlist<span class="xp-tab-badge" id="xp-tab-wl">${wlCount||''}</span></button>
    <button class="xp-tab" data-re-tab="alerts"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Alerts<span class="xp-tab-badge" id="xp-tab-al">${activeAlerts||''}</span></button>
    <button class="xp-tab" data-re-tab="reporter"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Reporter</button>
    <button class="xp-tab" data-re-tab="mods"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Mods<span class="xp-tab-badge">${enabledTotal}/${MODS.length}</span></button>
    <button class="xp-tab" data-re-tab="features"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Compare</button>
    <button class="xp-tab" data-re-tab="status"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Status</button>
</div>

<!-- BODY -->
<div class="xp-body">

<!-- DASHBOARD -->
<div data-re-section="dashboard">
<div class="xp-stat-row">
    <div class="xp-stat-box"><div class="xp-stat-n" id="re-stat-trades">0</div><div class="xp-stat-label">Trades Seen</div></div>
    <div class="xp-stat-box green"><div class="xp-stat-n">${activeAlerts}</div><div class="xp-stat-label">Active Alerts</div></div>
    <div class="xp-stat-box"><div class="xp-stat-n">${wlCount}</div><div class="xp-stat-label">Watchlist</div></div>
    <div class="xp-stat-box amber"><div class="xp-stat-n">${enabledTotal}</div><div class="xp-stat-label">Mods Active</div></div>
</div>
<div class="xp-2col">
    <div class="xp-col">
        <div class="xp-card">
            <div class="xp-card-hd">
                <div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>Live Feed</div><div class="xp-card-sub">Platform-wide trades via WebSocket</div></div>
                <button id="re-feed-pause" class="xp-btn ghost" style="height:26px;font-size:11px">Pause</button>
            </div>
            <div class="xp-feed-ctrl">
                <input id="re-feed-filter" class="xp-input" placeholder="Filter coin or user..." />
                <input id="re-feed-min" class="xp-input" type="number" min="0" step="25" placeholder="Min $" />
                <select id="re-feed-side" class="xp-select"><option value="all">All</option><option value="BUY">Buys</option><option value="SELL">Sells</option></select>
                <button class="xp-icon-btn" id="re-feed-clear" title="Clear feed"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
            </div>
            <div class="xp-feed-head"><span>TYPE</span><span>COIN</span><span>USER</span><span>VALUE</span><span>TIME</span></div>
            <div id="re-feed-rows" class="xp-feed-rows"></div>
        </div>
    </div>
    <div class="xp-col">
        <div class="xp-card">
            <div class="xp-card-hd">
                <div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>Market Radar</div><div class="xp-card-sub">Hot coins and whale activity</div></div>
                <div style="display:flex;gap:5px">
                    <select id="re-agg-window" class="xp-select" style="width:58px;height:26px;font-size:11px"><option value="300000">5m</option><option value="600000" selected>10m</option><option value="1800000">30m</option></select>
                    <input id="re-whale-min" class="xp-input" style="width:66px;height:26px;font-size:11px" type="number" min="0" step="50" value="250" placeholder="$" />
                </div>
            </div>
            <div class="xp-agg-row" id="re-stats-body">
                <div class="xp-agg-cell"><div class="xp-agg-v">—</div><div class="xp-agg-k">Window</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">0</div><div class="xp-agg-k">Trades</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">—</div><div class="xp-agg-k">Volume</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">—</div><div class="xp-agg-k">Avg</div></div>
                <div class="xp-agg-cell"><div class="xp-agg-v">0/0</div><div class="xp-agg-k">B/S</div></div>
            </div>
            <div class="xp-card-body">
                <div class="xp-radar-grid">
                    <div><div class="xp-section-label">Hot Coins</div><div id="re-hot-body" class="xp-mini-list"></div></div>
                    <div><div class="xp-section-label">Whale Radar</div><div id="re-whale-body" class="xp-mini-list"></div></div>
                </div>
            </div>
        </div>
    </div>
</div>
</div>

<!-- WATCHLIST -->
<div data-re-section="watchlist">
<div class="xp-card">
    <div class="xp-card-hd"><div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>Watchlist</div><div class="xp-card-sub">Live prices via WebSocket</div></div></div>
    <div class="xp-card-body">
        <div style="display:flex;gap:7px;margin-bottom:12px">
            <input id="re-wl-inp" class="xp-input" placeholder="Add coin symbol, e.g. BTC" style="flex:1"/>
            <button id="re-wl-add-btn" class="xp-btn primary">Add</button>
        </div>
        <div id="re-wl-panel-body"></div>
    </div>
</div>
</div>

<!-- ALERTS -->
<div data-re-section="alerts">
<div class="xp-2col">
    <div class="xp-col">
        <div class="xp-card">
            <div class="xp-card-hd"><div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Price Alerts</div><div class="xp-card-sub">Fires instantly on WebSocket price data</div></div></div>
            <div class="xp-card-body">
                <div class="xp-form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:8px">
                    <div class="xp-form-row"><label class="xp-label">Coin Symbol</label><input id="re-al-sym" class="xp-input" placeholder="DOGE" /></div>
                    <div class="xp-form-row"><label class="xp-label">Target Price (USD)</label><input id="re-al-px" class="xp-input" type="number" step="any" min="0" placeholder="0.00" /></div>
                </div>
                <div class="xp-form-row" style="margin-bottom:10px"><label class="xp-label">Trigger</label><select id="re-al-dir" class="xp-select"><option value="above">Notify when above</option><option value="below">Notify when below</option></select></div>
                <button id="re-al-add" class="xp-btn primary xp-btn-full" style="height:32px;margin-bottom:12px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Set Alert</button>
                <div id="re-al-body" style="display:flex;flex-direction:column;gap:5px"></div>
            </div>
        </div>
    </div>
    <div class="xp-col">
        <div class="xp-card" style="border-color:rgba(245,158,11,.14)">
            <div class="xp-card-body">
                <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--xp-amber);margin-bottom:9px">Tips</div>
                <div style="font-size:12px;color:var(--xp-t2);line-height:1.7;display:flex;flex-direction:column;gap:5px">
                    <div>Alerts fire with zero delay via WebSocket</div>
                    <div>Enable Desktop Notifications in Mods for browser popups</div>
                    <div>Set alerts before leaving — never miss a pump</div>
                    <div>Pair with Bot Detection for early rug warnings</div>
                </div>
            </div>
        </div>
    </div>
</div>
</div>

<!-- REPORTER -->
<div data-re-section="reporter">
<div class="xp-2col">
    <div class="xp-col">
        <div class="xp-card">
            <div class="xp-card-hd"><div><div class="xp-card-title"><div class="xp-live-dot" style="background:var(--xp-red)"></div>File a Report</div><div class="xp-card-sub">Warn the community via the Enhanced network</div></div></div>
            <div class="xp-card-body">
                <div class="xp-form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:8px">
                    <div class="xp-form-row"><label class="xp-label">Username</label><input id="re-rp-usr" class="xp-input" placeholder="scammer123" /></div>
                    <div class="xp-form-row"><label class="xp-label">Coin Symbol</label><input id="re-rp-sym" class="xp-input" placeholder="SCAM" /></div>
                </div>
                <div class="xp-form-row" style="margin-bottom:10px"><label class="xp-label">Evidence</label><textarea id="re-rp-desc" class="xp-textarea" placeholder="Describe the rugpull with as much detail as possible..." rows="4"></textarea></div>
                <button id="re-rp-sub" class="xp-btn primary xp-btn-full" style="height:34px">Submit Report</button>
                <div id="re-rp-msg" style="font-size:12px;text-align:center;margin-top:7px;min-height:16px;font-weight:600"></div>
            </div>
        </div>
    </div>
    <div class="xp-col">
        <div class="xp-card">
            <div class="xp-card-hd"><div class="xp-card-title">Community Reports</div></div>
            <div id="re-rp-list" style="max-height:360px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:7px"></div>
            <div id="re-rp-pag" class="xp-pag"></div>
        </div>
    </div>
</div>
</div>

<!-- MODS -->
<div data-re-section="mods" style="margin:-20px -24px;padding:0">
    <div class="xp-mods-top">
        <div class="xp-mods-sw">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="re-mods-search" class="xp-input xp-mods-si" placeholder="Search mods..." autocomplete="off" style="height:30px" />
        </div>
        <span class="xp-mods-count" id="re-mods-count">${MODS.length} mods</span>
        <button id="re-mods-all-on" class="xp-btn" style="height:28px;font-size:11px">All on</button>
        <button id="re-mods-all-off" class="xp-btn danger" style="height:28px;font-size:11px">All off</button>
    </div>
    <div class="xp-cat-filter" id="re-mods-filter-row">
        <button class="xp-cat-btn active" data-cat="All">All</button>
        ${CATS.map(c => '<button class="xp-cat-btn" data-cat="' + c + '">' + c + '</button>').join('')}
    </div>
    <div class="xp-mods-body" id="re-mods-body">${modsHTML}</div>
</div>

<!-- COMPARE -->
<div data-re-section="features">
<div class="xp-card">
    <div class="xp-card-hd"><div><div class="xp-card-title">Enhanced vs Rugplay Plus</div><div class="xp-card-sub">Every advantage, including the ones they do not want you to know</div></div></div>
    <div style="overflow-x:auto">
        <table class="xp-cmp">
            <thead><tr><th style="width:44%">Feature</th><th class="ours">Enhanced (Free)</th><th>Rugplay Plus (Paid)</th></tr></thead>
            <tbody>
                <tr><td>Price Alerts</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Live Watchlist</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>50+ Toggleable Mods</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Local Risk Scoring</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Market Radar / Hot Coins</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Bot Detection</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Volume Spike Alerts</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Session P&amp;L Tracker</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Coin Notes (local)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Quick Search (Ctrl+K)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Watch buttons on pages</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Privacy mods (blur, hide balance)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
                <tr><td>Rugpull Reporter</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
                <tr><td>Live Transaction Card</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
                <tr><td>User Tags</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
                <tr><td>Trade History Modal</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
                <tr><td>Ad Blocker</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
                <tr class="warn"><td class="bad">Silently tracks your username</td><td class="ours ck">Never</td><td class="bad">YES</td></tr>
                <tr class="warn"><td class="bad">Breaks when their API goes down</td><td class="ours ck">Never</td><td class="bad">YES</td></tr>
            </tbody>
        </table>
    </div>
</div>
</div>

<!-- STATUS -->
<div data-re-section="status">
<div class="xp-2col">
    <div class="xp-col">
        <div class="xp-card"><div class="xp-card-hd"><div class="xp-card-title">System Diagnostics</div></div><div class="xp-card-body"><div id="re-diag"></div></div></div>
    </div>
    <div class="xp-col">
        <div id="re-changelog-card" class="xp-card"><div class="xp-card-hd"><div class="xp-card-title">What's New</div></div><div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading...</div></div>
    </div>
</div>
</div>

</div><!-- /xp-body -->

<div class="xp-footer">
    <span>Rugplay Enhanced v${GM_info.script.version} · by <a href="https://github.com/devbyego/rugplay-enhanced" target="_blank" class="xp-flink">devbyego</a></span>
    <div class="xp-footer-links">
        <a href="https://github.com/devbyego/rugplay-enhanced" target="_blank" class="xp-flink">GitHub</a>
        <button id="re-feedback-btn-footer" class="xp-flink">Feedback</button>
    </div>
</div>

</div>`;
        },
        _attachListeners() {
            const applyTab = (tab) => {
                const t = tab || 'dashboard';
                store.cfg('panelTab', t);
                // Match both old .re-tab and new .xp-tab buttons
                document.querySelectorAll('.re-tab[data-re-tab], .xp-tab[data-re-tab]').forEach(b => {
                    b.classList.toggle('active', b.dataset.reTab === t);
                });
                document.querySelectorAll('[data-re-section]').forEach(el => {
                    const sec = el.getAttribute('data-re-section');
                    const secs = sec ? sec.split(',').map(x => x.trim()) : [];
                    const show = secs.includes(t) || secs.includes('*');
                    // Use explicit 'block'/'flex' instead of '' so CSS display:none is actually overridden
                    el.style.display = show ? (el.classList.contains('xp-2col') ? 'grid' : 'block') : 'none';
                });
                if (t === 'watchlist') watchlist.renderPanel();
            };
            document.querySelectorAll('.re-tab[data-re-tab], .xp-tab[data-re-tab]').forEach(b => b.addEventListener('click', () => applyTab(b.dataset.reTab)));
            document.getElementById('re-wl-add-btn')?.addEventListener('click', () => {
                const inp = document.getElementById('re-wl-inp');
                const sym = (inp?.value || '').trim().toUpperCase();
                if (!sym) return;
                watchlist.add(sym);
                if (inp) inp.value = '';
                watchlist.renderPanel();
                ['re-stat-wl','xp-tab-wl'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=store.get('re:wl',[]).length||'';});
            });
            document.getElementById('re-feed-clear')?.addEventListener('click', () => { liveFeed.trades=[]; liveFeed.render(); ['re-stat-trades','xp-stat-trades'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='0';}); });
            document.getElementById('re-feed-filter')?.addEventListener('input', utils.debounce(() => liveFeed.render(), 150));
            document.getElementById('re-feed-min')?.addEventListener('input', utils.debounce(() => liveFeed.render(), 150));
            document.getElementById('re-feed-side')?.addEventListener('change', () => liveFeed.render());
            document.getElementById('re-feed-pause')?.addEventListener('click', (e) => {
                liveFeed.paused = !liveFeed.paused;
                e.currentTarget.textContent = liveFeed.paused ? 'Resume' : 'Pause';
                if (!liveFeed.paused) { liveFeed.render(); dashboard.render(); }
            });
            document.getElementById('re-agg-window')?.addEventListener('change', () => dashboard.render());
            document.getElementById('re-whale-min')?.addEventListener('input', utils.debounce(() => dashboard.render(), 150));
            document.getElementById('re-al-add')?.addEventListener('click', () => { const sym = document.getElementById('re-al-sym')?.value.trim().toUpperCase(); const px = document.getElementById('re-al-px')?.value.trim(); const dir = document.getElementById('re-al-dir')?.value; if (!sym || !px) { notifier.err('Fill in symbol and price'); return; } alertEngine.add(sym, px, dir); document.getElementById('re-al-sym').value = ''; document.getElementById('re-al-px').value = ''; this._renderAlerts(); });
            document.getElementById('re-rp-sub')?.addEventListener('click', () => this._submitReport());
            document.getElementById('re-feedback-btn')?.addEventListener('click', () => this._showFeedbackModal());
            document.getElementById('re-feedback-btn-footer')?.addEventListener('click', () => this._showFeedbackModal());
            this._renderAlerts();
            this._loadReports(1);
            dashboard.render();
            diagnostics.pingApi().finally(() => diagnostics.render());
            diagnostics.render();
            applyTab(store.settings().panelTab || 'dashboard');

            // ── MOD CARD TOGGLES (event delegation on the mods body) ────────
            const modsBody = document.getElementById('re-mods-body');
            if (modsBody) {
                modsBody.addEventListener('click', e => {
                    const btn = e.target.closest('.xp-toggle,.re-mod-toggle');
                    if (!btn) return;
                    const key = btn.dataset.modKey;
                    if (!key) return;
                    const cur = !!store.settings()[key];
                    const next = !cur;
                    store.cfg(key, next);
                    // Update toggle button state
                    btn.classList.toggle('on', next);
                    btn.setAttribute('aria-checked', String(next));
                    const card = btn.closest('.xp-mod-card,.re-mod-card');
                    if (card) {
                        card.classList.toggle('on', next);
                        card.classList.toggle('off', !next);
                        const statusEl = card.querySelector('.re-mod-status');
                        if (statusEl) { statusEl.textContent = next ? 'ENABLED' : 'DISABLED'; statusEl.className = 're-mod-status ' + (next ? 'on' : 'off'); }
                    }
                    // Update header count
                    const s2 = store.settings();
                    const allMods = modsBody.querySelectorAll('.xp-toggle,.re-mod-toggle');
                    const enabledCount = Array.from(allMods).filter(b => b.classList.contains('on')).length;
                    const countEl = document.querySelector('.re-tab[data-re-tab="mods"] .re-tab-count');
                    if (countEl) countEl.textContent = enabledCount + '/' + allMods.length;
                    settingsEngine.applyAll();
                });
            }

            // ── MODS SEARCH ─────────────────────────────────────────────────
            const modsSearch = document.getElementById('re-mods-search');
            const modsCount = document.getElementById('re-mods-count');
            const filterMods = () => {
                const q = (modsSearch?.value || '').toLowerCase();
                const activeCat = document.querySelector('.re-mods-filter-btn.active')?.dataset.cat || 'All';
                let visible = 0;
                document.querySelectorAll('.xp-mod-card,.re-mod-card').forEach(card => {
                    const key = card.dataset.modKey;
                    const name = (card.querySelector('.re-mod-name')?.textContent || '').toLowerCase();
                    const desc = (card.querySelector('.re-mod-desc')?.textContent || '').toLowerCase();
                    const cat = (card.querySelector('.re-mod-cat-tag')?.textContent || '');
                    const matchQ = !q || name.includes(q) || desc.includes(q) || key.toLowerCase().includes(q);
                    const matchCat = activeCat === 'All' || cat === activeCat;
                    const show = matchQ && matchCat;
                    card.style.display = show ? '' : 'none';
                    if (show) visible++;
                });
                // Hide empty category headers
                document.querySelectorAll('.xp-cat-block,.re-mod-category').forEach(cat => {
                    const visibleCards = cat.querySelectorAll('.re-mod-card:not([style*="display: none"]):not([style*="display:none"])');
                    cat.style.display = visibleCards.length ? '' : 'none';
                });
                if (modsCount) modsCount.textContent = visible + ' mod' + (visible !== 1 ? 's' : '');
            };
            modsSearch?.addEventListener('input', utils.debounce(filterMods, 150));

            // ── MODS CATEGORY FILTER ────────────────────────────────────────
            document.getElementById('re-mods-filter-row')?.addEventListener('click', e => {
                const btn = e.target.closest('.re-mods-filter-btn');
                if (!btn) return;
                document.querySelectorAll('.re-mods-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterMods();
            });

            // ── ALL ON / ALL OFF ────────────────────────────────────────────
            document.getElementById('re-mods-all-on')?.addEventListener('click', () => {
                document.querySelectorAll('.xp-toggle,.re-mod-toggle').forEach(btn => {
                    const key = btn.dataset.modKey;
                    if (!key) return;
                    store.cfg(key, true);
                    btn.classList.add('on'); btn.setAttribute('aria-checked', 'true');
                    const card = btn.closest('.re-mod-card');
                    if (card) { card.classList.add('on'); card.classList.remove('off'); const s = card.querySelector('.re-mod-status'); if (s) { s.textContent='ENABLED'; s.className='re-mod-status on'; } }
                });
                settingsEngine.applyAll();
            });
            document.getElementById('re-mods-all-off')?.addEventListener('click', () => {
                document.querySelectorAll('.xp-toggle,.re-mod-toggle').forEach(btn => {
                    const key = btn.dataset.modKey;
                    if (!key) return;
                    store.cfg(key, false);
                    btn.classList.remove('on'); btn.setAttribute('aria-checked', 'false');
                    const card = btn.closest('.re-mod-card');
                    if (card) { card.classList.remove('on'); card.classList.add('off'); const s = card.querySelector('.re-mod-status'); if (s) { s.textContent='DISABLED'; s.className='re-mod-status off'; } }
                });
                settingsEngine.applyAll();
            });
        },
        _renderAlerts() {
            const el = document.getElementById('re-al-body'); if (!el) return;
            const al = store.alerts();
            if (!al.length) { el.innerHTML = '<div class="xp-empty">No alerts set yet. Add one above.</div>'; return; }
            el.innerHTML = al.map(a => `<div class="xp-al-row${a.done?' done':''}"><div class="xp-al-info"><div class="xp-al-sym">${a.sym}</div><div class="xp-al-meta">${a.dir} ${utils.usd(a.px)}${a.done?' · Triggered '+utils.ago(a.hitAt):''}</div></div><button class="xp-al-del" data-id="${a.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
            el.querySelectorAll('.re-al-del').forEach(b => b.onclick = () => { alertEngine.del(b.dataset.id); this._renderAlerts(); });
        },
        async _loadReports(pg = 1) {
            const list = document.getElementById('re-rp-list'); if (!list) return;
            list.innerHTML = `<div class="flex items-center justify-center p-6 text-muted-foreground gap-2">${ICONS.loading}<span class="text-sm animate-pulse">Loading...</span></div>`;
            try {
                const r = await api.get(`/v1/reports?page=${pg}&limit=8`); if (r.status !== 'success') throw 0;
                const rpts = r.data?.reports || [];
                if (!rpts.length) { list.innerHTML = '<p class="text-muted-foreground text-sm text-center p-6">No reports yet.</p>'; return; }
                list.innerHTML = rpts.map(rp=>`<div class="xp-rp-row" data-id="${rp.id}"><div class="xp-rp-hd"><span class="xp-rp-user">${rp.reported_username}</span><span class="xp-rp-coin">*${rp.coin_symbol}</span><span class="xp-rp-time">${utils.ago(rp.created_at)}</span></div><p class="xp-rp-body">${rp.description}</p><div class="xp-rp-foot"><button class="xp-vote up re-vote" data-id="${rp.id}" data-t="upvote">▲ ${rp.upvotes||0}</button><button class="xp-vote dn re-vote" data-id="${rp.id}" data-t="downvote">▼ ${rp.downvotes||0}</button></div></div>`).join('');
                list.querySelectorAll('.re-vote').forEach(b => b.onclick = async () => { try { await api.post('/v1/reports/vote', { id: b.dataset.id, type: b.dataset.t }); notifier.ok('Vote recorded'); this._loadReports(pg); } catch { notifier.err('Already voted or failed'); } });
                const pag = document.getElementById('re-rp-pag'); const p = r.data?.pagination;
                if (pag && p && p.total_pages > 1) { pag.innerHTML = ''; const mkBtn = (lbl, page, dis = false) => { const b = document.createElement('button'); b.textContent = lbl; b.className = 'inline-flex items-center justify-center text-sm font-medium h-9 px-3 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors'; if (dis) { b.setAttribute('disabled', ''); b.style.opacity = '.4'; } else b.onclick = () => this._loadReports(page); return b; }; pag.classList.add('flex', 'justify-center', 'items-center', 'gap-2'); pag.appendChild(mkBtn('«', p.current_page - 1, p.current_page === 1)); const inf = document.createElement('span'); inf.className = 'text-sm text-muted-foreground'; inf.textContent = `${p.current_page} / ${p.total_pages}`; pag.appendChild(inf); pag.appendChild(mkBtn('»', p.current_page + 1, p.current_page >= p.total_pages)); }
                diagnostics.state.lastReportOkAt = Date.now();
                diagnostics.render();
            } catch (e) {
                diagnostics.state.lastReportErrAt = Date.now();
                diagnostics.state.lastReportErr = String(e?.message || e);
                diagnostics.render();
                const local = store.localReports().slice().reverse();
                if (local.length) {
                    list.innerHTML = `
                        <div class="p-4 text-xs text-muted-foreground">Enhanced API is down. Showing <b>local-only</b> reports saved on your device.</div>
                        ${local.slice(0, 20).map(rp => `<div class="bg-muted/40 border border-border rounded-lg p-3"><div class="flex items-center gap-2 mb-1"><span class="font-semibold text-sm">${rp.username}</span><span class="text-primary font-mono text-xs">*${rp.coinSymbol}</span><span class="text-xs text-muted-foreground ml-auto">local · ${utils.ago(rp.createdAt)}</span></div><p class="text-sm text-muted-foreground mb-2">${rp.description}</p></div>`).join('')}
                        <div class="p-4 text-center text-sm"><button id="re-rp-retry" class="re-panel-btn" style="max-width:220px;margin:0 auto">Retry API</button></div>
                    `;
                    document.getElementById('re-rp-retry')?.addEventListener('click', () => this._loadReports(pg), { once: true });
                    return;
                }
                list.innerHTML = `<div class="p-6 text-center text-sm"><div class="text-destructive font-semibold mb-2">Failed to load reports</div><div class="text-muted-foreground mb-4">Check the Status tab — your Enhanced API may be down.</div><button id="re-rp-retry" class="re-panel-btn" style="max-width:220px;margin:0 auto">Retry</button></div>`;
                document.getElementById('re-rp-retry')?.addEventListener('click', () => this._loadReports(pg), { once: true });
            }
        },
        async _submitReport() {
            const usr = document.getElementById('re-rp-usr')?.value.trim();
            const sym = document.getElementById('re-rp-sym')?.value.trim().toUpperCase();
            const desc = document.getElementById('re-rp-desc')?.value.trim();
            const msg = document.getElementById('re-rp-msg'); if (!msg) return;
            if (!usr || !sym || !desc) { msg.textContent = 'All fields are required'; msg.style.color = 'hsl(var(--destructive))'; return; }
            msg.textContent = 'Submitting...'; msg.style.color = 'hsl(var(--muted-foreground))';
            try {
                const r = await api.post('/v1/reports/submit', { username: usr, coinSymbol: sym, description: desc });
                if (r.status === 'success') {
                    diagnostics.state.lastReportOkAt = Date.now();
                    msg.textContent = 'Report submitted — pending review'; msg.style.color = '#22c55e';
                    document.getElementById('re-rp-usr').value = ''; document.getElementById('re-rp-sym').value = ''; document.getElementById('re-rp-desc').value = '';
                    this._loadReports(1);
                    diagnostics.render();
                }
                else { msg.textContent = r.message || 'Submission failed'; msg.style.color = 'hsl(var(--destructive))'; }
            } catch (e) {
                diagnostics.state.lastReportErrAt = Date.now();
                diagnostics.state.lastReportErr = String(e?.message || e);
                // Local fallback so the feature still "works" tonight even if backend is down.
                const lr = store.localReports();
                lr.push({ id: utils.uid(), username: usr, coinSymbol: sym, description: desc, createdAt: Date.now() });
                store.localReportsSet(lr.slice(-200));
                msg.textContent = 'API down — saved locally (see Community Reports)'; msg.style.color = '#f59e0b';
                this._loadReports(1);
                diagnostics.render();
            }
        },
        _loadChangelog() {
            const card = document.getElementById('re-changelog-card'); if (!card) return;
            api.get(`/v1/changelog?version=${GM_info.script.version}`).then(r => {
                if (r.status === 'success' && r.data) {
                    card.innerHTML = `<div class="xp-card-hd"><div class="xp-card-title">What\'s New in v${r.data.version}</div><span style="font-size:10px;color:#52525b">${new Date(r.data.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span></div><div style="padding:12px 14px;display:flex;flex-direction:column;gap:0">${r.data.changes.map(c=>'<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="width:5px;height:5px;border-radius:50%;background:#52525b;flex-shrink:0;margin-top:5px"></span><span style="font-size:12px;color:#a1a1aa;line-height:1.5">'+c+'</span></div>').join('')}</div>`;
                } else { card.innerHTML = '<div class="xp-empty">No changelog available</div>'; }
            }).catch(() => { card.innerHTML = '<div class="xp-empty" style="color:#ef4444">Failed to load changelog</div>'; });
        },
        _showFeedbackModal() {
            let ov = document.getElementById(CONFIG.ids.feedbackModal);
            if (!ov) {
                ov = document.createElement('div');
                ov.id = CONFIG.ids.feedbackModal;
                ov.className = 're-feedback-overlay';
                ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.7);align-items:center;justify-content:center;backdrop-filter:blur(4px)';
                ov.innerHTML = `<div class="re-feedback-box bg-card text-card-foreground rounded-xl border shadow-2xl overflow-hidden" style="width:90%;max-width:440px;animation:re-modal-in .2s cubic-bezier(.16,1,.3,1) forwards"><div class="p-6"><h2 class="font-bold text-lg mb-2">Send Feedback</h2><p class="text-sm text-muted-foreground mb-4">Bug report or feature idea? Open GitHub Issues with your message pre-filled.</p><textarea id="re-feedback-ta" rows="4" class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-4" placeholder="Describe your feedback..."></textarea><div class="flex gap-2"><button id="re-feedback-open" class="re-panel-btn flex-1">Open GitHub Issues</button><button id="re-feedback-cancel" class="re-panel-btn flex-1" style="background:hsl(var(--accent))!important;color:hsl(var(--accent-foreground))!important">Cancel</button></div></div></div>`;
                document.body.appendChild(ov);
                ov.addEventListener('click', e => { if (e.target === ov) this._hideFeedbackModal(); });
                document.getElementById('re-feedback-open').onclick = () => { const ta = document.getElementById('re-feedback-ta'); const body = (ta?.value || '').trim() || 'No description provided'; const url = `https://github.com/devbyego/rugplay-enhanced/issues/new?title=${encodeURIComponent('Feedback: ')}&body=${encodeURIComponent(`**Rugplay Enhanced v${GM_info.script.version}**\n\n${body}`)}`; window.open(url, '_blank'); this._hideFeedbackModal(); };
                document.getElementById('re-feedback-cancel').onclick = () => this._hideFeedbackModal();
            }
            ov.style.display = 'flex';
            const ta = document.getElementById('re-feedback-ta'); if (ta) { ta.value = ''; ta.focus(); }
        },
        _hideFeedbackModal() {
            const ov = document.getElementById(CONFIG.ids.feedbackModal);
            if (ov) ov.style.display = 'none';
        },
    };

    const ICONS_TOGGLE = {
        on: `<svg class="w-6 h-6" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12Zm13.707-1.293a1 1 0 0 0-1.414-1.414L11 12.586l-1.793-1.793a1 1 0 0 0-1.414 1.414l2.5 2.5a1 1 0 0 0 1.414 0l4-4Z" clip-rule="evenodd"/></svg>`,
        off: `<svg class="w-6 h-6" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.757 12h8.486M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>`,
    };

    const sidebarEnhancer = {
        _enhancedOk: false,
        _searchOk: false,

        // Find the sidebar menu list using every selector Rugplay has ever used
        _getMenuList() {
            return document.querySelector('ul[data-sidebar="menu"]')
                || document.querySelector('nav ul')
                || document.querySelector('[data-sidebar="content"] ul')
                || null;
        },

        // Find the first real nav item that has both an <a> and a <span> inside
        _getFirstItem(menuList) {
            if (!menuList) return null;
            const items = menuList.querySelectorAll('li[data-sidebar="menu-item"], li');
            for (const li of items) {
                const a = li.querySelector('a');
                const span = li.querySelector('span');
                if (a && span && span.textContent.trim()) return li;
            }
            return null;
        },

        // Replace the SVG inside an <a> element with new SVG HTML
        _replaceSvg(a, svgHtml) {
            const existing = a.querySelector('svg');
            if (existing) {
                // Use insertAdjacentHTML instead of outerHTML to reliably replace
                const tmp = document.createElement('span');
                tmp.innerHTML = svgHtml;
                const newSvg = tmp.firstElementChild;
                if (newSvg) existing.replaceWith(newSvg);
            } else {
                // Prepend the SVG if none exists
                const tmp = document.createElement('span');
                tmp.innerHTML = svgHtml;
                const newSvg = tmp.firstElementChild;
                if (newSvg) a.prepend(newSvg);
            }
        },

        create() {
            const menuList = this._getMenuList();
            if (!menuList) return false;

            const firstItem = this._getFirstItem(menuList);
            if (!firstItem) return false;

            // ── Inject "Enhanced" button ────────────────────────────────────
            const existingEnhBtn = document.getElementById(CONFIG.ids.enhancedBtn);
            if (!this._enhancedOk && !existingEnhBtn) {
                try {
                    const li = firstItem.cloneNode(true);
                    // Remove any active/current indicators from the clone
                    li.querySelectorAll('[data-active],[aria-current],[class*="active"]').forEach(el => {
                        el.removeAttribute('data-active');
                        el.removeAttribute('aria-current');
                    });
                    const btn = li.querySelector('a');
                    if (!btn) return false;
                    btn.id = CONFIG.ids.enhancedBtn;
                    btn.href = '#rugplay-enhanced';
                    btn.removeAttribute('data-active');
                    btn.removeAttribute('aria-current');
                    this._replaceSvg(btn, ICONS.enhanced);
                    const span = Array.from(btn.querySelectorAll('span')).find(s => !s.classList.contains('sr-only') && !/sr-?only|screen-?reader/i.test(s.className)) || btn.querySelector('span');
                    if (span) span.textContent = 'Enhanced';
                    btn.addEventListener('click', e => {
                        e.preventDefault();
                        if (enhancedPanel.isVisible) enhancedPanel.hide();
                        else enhancedPanel.show();
                    });
                    firstItem.insertAdjacentElement('afterend', li);
                    this._enhancedOk = true;
                } catch(err) {
                    return false;
                }
            } else if (existingEnhBtn && menuList.contains(existingEnhBtn)) {
                this._enhancedOk = true;
            }

            // ── Inject "Quick Search" button ────────────────────────────────
            const existingSearchBtn = document.getElementById(CONFIG.ids.searchBtn);
            if (!store.settings().sidebarSearch) {
                // If disabled, remove button if it exists and mark as not injected
                if (existingSearchBtn) { existingSearchBtn.closest('li')?.remove(); }
                this._searchOk = false;
                return this._enhancedOk;
            }
            if (!this._searchOk && !existingSearchBtn) {
                try {
                    const li2 = firstItem.cloneNode(true);
                    li2.querySelectorAll('[data-active],[aria-current]').forEach(el => {
                        el.removeAttribute('data-active');
                        el.removeAttribute('aria-current');
                    });
                    const btn2 = li2.querySelector('a');
                    if (!btn2) return false;
                    btn2.id = CONFIG.ids.searchBtn;
                    btn2.href = '#';
                    btn2.removeAttribute('data-active');
                    btn2.removeAttribute('aria-current');
                    this._replaceSvg(btn2, ICONS.search);
                    const span2 = Array.from(btn2.querySelectorAll('span')).find(s => !s.classList.contains('sr-only') && !/sr-?only|screen-?reader/i.test(s.className)) || btn2.querySelector('span');
                    if (span2) span2.textContent = 'Quick Search';
                    btn2.addEventListener('click', e => { e.preventDefault(); quickSearch.toggle(); });
                    menuList.appendChild(li2);
                    this._searchOk = true;
                } catch(err) {
                    return false;
                }
            } else if (existingSearchBtn && menuList.contains(existingSearchBtn)) {
                this._searchOk = true;
            }

            return this._enhancedOk && this._searchOk;
        },
    };

    const analytics = {
        async run() {
            const sk = 're:ls'; if (Date.now() - GM_getValue(sk, 0) < 14400000) return; GM_setValue(sk, Date.now());
            try { await api.post('/v1/analytics', { event: 'active_session', version: GM_info.script.version }); } catch {}
            const ik = 're:inst'; if (!GM_getValue(ik, false)) { try { await api.post('/v1/analytics', { event: 'install', version: GM_info.script.version }); } catch {} GM_setValue(ik, true); }
        },
    };

    GM_addStyle(`
        @keyframes re-notif-in{to{opacity:1;transform:none}}
        @keyframes re-notif-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(14px) scale(.96)}}
        @keyframes re-spinning{to{transform:rotate(360deg)}}
        @keyframes re-modal-in{from{opacity:0;transform:scale(.95) translateY(8px)}to{opacity:1;transform:none}}
        @keyframes re-hl{from{background:rgba(74,222,128,.18)}to{background:transparent}}
        .re-new-tx{animation:re-hl 2s ease-out}
        #re-notifier{position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;width:340px}
        .re-notif{background:#111113;color:#fafafa;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);display:flex;align-items:flex-start;padding:13px;gap:11px;position:relative;opacity:0;transform:translateY(14px) scale(.96);animation:re-notif-in .2s cubic-bezier(.16,1,.3,1) forwards;pointer-events:all}
        .re-notif-out{animation:re-notif-out .16s ease-in forwards}
        .re-notif-icon{flex-shrink:0;margin-top:1px}
        .re-notif-body{flex:1}
        .re-notif-title{font-weight:700;font-size:13px;margin-bottom:3px;letter-spacing:-.01em}
        .re-notif-desc{font-size:12px;color:#a1a1aa;line-height:1.4}
        .re-notif-close{position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:#52525b;padding:3px 5px;border-radius:4px;font-size:11px}
        .re-notif-close:hover{background:rgba(255,255,255,.06)}
        .re-notif-actions{display:flex;gap:6px;margin-top:9px}
        .re-notif-btn{border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s}
        .re-notif-btn.primary{background:#fafafa;color:#09090b}
        .re-notif-btn.secondary{background:rgba(255,255,255,.08);color:#fafafa}
        .re-notif-btn:hover{opacity:.82}
        .re-spin{animation:re-spinning 1s linear infinite}
        .re-tag{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-left:6px;vertical-align:middle}
        .re-pnl{font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;margin-top:3px;display:inline-block}
        .re-pnl.pos{background:rgba(34,197,94,.12);color:#22c55e}
        .re-pnl.neg{background:rgba(239,68,68,.12);color:#ef4444}
        .re-outline-btn{background:transparent;color:hsl(var(--foreground));border:1px solid hsl(var(--border));border-radius:6px;padding:4px 12px;font-size:12px;font-weight:500;cursor:pointer;margin-left:10px;font-family:inherit;vertical-align:middle;transition:background .15s}
        .re-outline-btn:hover,.re-outline-btn.active{background:hsl(var(--accent))}
        .re-reported-badge{position:relative;display:inline-flex;margin-left:8px;vertical-align:middle}
        .re-reported-label{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:help;color:#f87171;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3)}
        .re-reported-tooltip{visibility:hidden;width:260px;background:hsl(var(--card));color:hsl(var(--card-foreground));text-align:left;border:1px solid hsl(var(--border));border-radius:10px;padding:10px;position:absolute;z-index:10000;bottom:100%;left:50%;margin-left:-130px;margin-bottom:6px;opacity:0;transition:opacity .2s,visibility .2s;font-size:12px;line-height:1.4;pointer-events:none}
        .re-reported-badge:hover .re-reported-tooltip{visibility:visible;opacity:1}
        .re-search-wrap{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:999999;display:flex;align-items:flex-start;justify-content:center;padding-top:13vh;backdrop-filter:blur(8px)}
        .re-search-box{width:90%;max-width:540px;background:#111113;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.55)}
        .re-search-top{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid rgba(255,255,255,.07)}
        .re-search-icon-wrap{color:#52525b;flex-shrink:0}
        .re-search-inp{flex:1;background:none;border:none;outline:none;font-size:15px;color:#fafafa;font-family:inherit}
        .re-search-results{max-height:300px;overflow-y:auto}
        .re-sr-row{display:flex;flex-direction:column;padding:10px 15px;border-bottom:1px solid rgba(255,255,255,.06);text-decoration:none;transition:background .1s}
        .re-sr-row:hover{background:rgba(255,255,255,.04)}
        .re-sr-main{display:flex;align-items:center;gap:8px;margin-bottom:2px}
        .re-sr-name{font-weight:600;font-size:13px;color:#fafafa}
        .re-sr-sub{font-size:12px;color:#71717a}
        .re-err{color:#ef4444!important}
        .re-badge{display:inline-flex;align-items:center;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase}
        .re-badge.buy{background:rgba(34,197,94,.12);color:#22c55e}
        .re-badge.sell{background:rgba(239,68,68,.12);color:#ef4444}
        body.re-compact .space-y-4{gap:8px!important}
        body.re-compact .p-4{padding:8px!important}
        body.re-compact .p-6{padding:12px!important}
    `);

    // ── Remaining mod implementations ────────────────────────────────────────

    const tradeInterceptor = {
        _patched: false,
        _feeEl: null,
        apply() {
            const s = store.settings();
            if (!s.confirmTrades && !s.showFeeEstimate) return;
            if (this._patched) return;
            this._patched = true;

            // Watch for buy/sell button clicks via event delegation
            document.addEventListener('click', e => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const txt = (btn.textContent || '').trim().toUpperCase();
                const isTrade = /^(BUY|SELL)\s+[A-Z0-9]+$/.test(txt) || btn.classList.toString().includes('trade') || btn.dataset.action === 'trade';
                if (!isTrade) return;

                const cs = store.settings();
                if (cs.confirmTrades) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const msg = `Confirm ${txt}?`;
                    if (!window.confirm(msg)) return;
                    // Re-fire without interception by temporarily removing listener
                    this._patched = false;
                    btn.click();
                    this._patched = true;
                }
            }, { capture: true });

            // Show fee estimate near amount input
            if (s.showFeeEstimate) {
                const tryInject = () => {
                    const amtInput = document.querySelector('input[placeholder*="amount"],input[placeholder*="Amount"],input[type="number"][min="0"]');
                    if (!amtInput || document.getElementById('re-fee-est')) return;
                    const el = document.createElement('div');
                    el.id = 're-fee-est';
                    el.style.cssText = 'font-size:11px;color:#a1a1aa;margin-top:4px;padding:3px 8px;background:rgba(255,255,255,.04);border-radius:4px;display:inline-block';
                    el.textContent = 'Fee: ~0.3%';
                    amtInput.parentElement?.insertAdjacentElement('afterend', el);
                    amtInput.addEventListener('input', () => {
                        const v = parseFloat(amtInput.value) || 0;
                        const fee = v * 0.003;
                        el.textContent = v > 0 ? `Est. fee: ~${utils.usd(fee)} (0.3%)` : 'Fee: ~0.3%';
                    });
                };
                new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
                tryInject();
            }
        },
    };

    const portfolioHighlighter = {
        _lastApplied: 0,
        apply() {
            const s = store.settings();
            if (!s.highlightProfitLoss && !s.showPortfolioPercent) return;
            if (Date.now() - this._lastApplied < 2000) return;
            this._lastApplied = Date.now();

            // Find portfolio rows — Rugplay renders coins in sidebar as list items
            const rows = document.querySelectorAll('[data-sidebar="content"] li, [data-slot="sidebar-content"] li');
            const totalVal = portfolioUpdater.lastTotal || 0;

            rows.forEach(row => {
                if (row.dataset.reHighlighted) return;
                const monoEls = row.querySelectorAll('.font-mono, span[class*="mono"]');
                if (!monoEls.length) return;

                // Try to find a value and determine if it's profit/loss
                monoEls.forEach(el => {
                    const txt = el.textContent.trim();
                    const val = parseFloat(txt.replace(/[^0-9.-]/g, ''));
                    if (!val || isNaN(val)) return;

                    if (s.highlightProfitLoss) {
                        // Color based on sign of value — portfolio gains are positive
                        if (txt.startsWith('+') || txt.startsWith('▲')) {
                            el.style.color = '#22c55e';
                        } else if (txt.startsWith('-') || txt.startsWith('▼')) {
                            el.style.color = '#ef4444';
                        }
                    }

                    if (s.showPortfolioPercent && totalVal > 0 && val > 0) {
                        if (!el.nextElementSibling?.classList.contains('re-pf-pct')) {
                            const sp = document.createElement('span');
                            sp.className = 're-pf-pct';
                            sp.style.cssText = 'font-size:10px;color:#52525b;margin-left:4px;font-family:ui-monospace,monospace';
                            sp.textContent = ((val / totalVal) * 100).toFixed(1) + '%';
                            el.insertAdjacentElement('afterend', sp);
                        }
                    }
                });
                row.dataset.reHighlighted = '1';
            });
        },
    };

    const spreadTracker = {
        _asks: {}, _bids: {},
        init() {
            wsInterceptor.on(d => {
                if (!['live-trade','all-trades'].includes(d.type)) return;
                const sym = (d.data?.coinSymbol || '').toUpperCase();
                const px = parseFloat(d.data?.price || 0);
                const type = (d.data?.type || '').toUpperCase();
                if (!sym || !px) return;
                if (type === 'BUY') { this._asks[sym] = px; }
                if (type === 'SELL') { this._bids[sym] = px; }

                // Inject spread display on coin page
                const s = store.settings();
                if (!utils.isCoinPage() || utils.getCoinSymbol() !== sym) return;
                if ((s.showSpread || s.showBidAsk) && !document.getElementById('re-spread')) {
                    const bid = this._bids[sym] || 0;
                    const ask = this._asks[sym] || 0;
                    if (bid && ask && ask >= bid) {
                        const spreadPct = ((ask - bid) / bid * 100).toFixed(2);
                        const el = document.createElement('div');
                        el.id = 're-spread';
                        el.style.cssText = 'font-size:11px;color:#a1a1aa;padding:3px 8px;background:rgba(255,255,255,.05);border-radius:4px;display:inline-flex;gap:10px;margin-top:4px';
                        el.innerHTML = s.showBidAsk
                            ? `<span style="color:#22c55e">Bid: ${utils.usd(bid)}</span><span style="color:#ef4444">Ask: ${utils.usd(ask)}</span><span>Spread: ${spreadPct}%</span>`
                            : `Spread: ${spreadPct}%`;
                        document.querySelector('main h1')?.parentElement?.appendChild(el);
                    }
                } else if (document.getElementById('re-spread')) {
                    // Update existing
                    const bid = this._bids[sym] || 0;
                    const ask = this._asks[sym] || 0;
                    if (bid && ask && ask >= bid) {
                        const spreadPct = ((ask - bid) / bid * 100).toFixed(2);
                        const el = document.getElementById('re-spread');
                        const s2 = store.settings();
                        el.innerHTML = s2.showBidAsk
                            ? `<span style="color:#22c55e">Bid: ${utils.usd(bid)}</span><span style="color:#ef4444">Ask: ${utils.usd(ask)}</span><span>Spread: ${spreadPct}%</span>`
                            : `Spread: ${spreadPct}%`;
                    }
                }
            });
        },
    };

    const reportPoller = {
        _lastCount: -1,
        _lastCheck: 0,
        async poll() {
            if (!store.settings().alertOnNewReport) return;
            if (Date.now() - this._lastCheck < 120000) return; // check every 2 min
            this._lastCheck = Date.now();
            try {
                const r = await api.get('/v1/reports?page=1&limit=1');
                if (r.status !== 'success') return;
                const count = r.data?.pagination?.total_items || 0;
                if (this._lastCount >= 0 && count > this._lastCount) {
                    const rp = r.data?.reports?.[0];
                    const desc = rp ? `${rp.reported_username} / *${rp.coin_symbol}` : 'New report submitted';
                    notifier.show({ title: '🚩 New Rugpull Report', description: desc, type: 'warning', duration: 10000, actions: [{ label: 'View', onClick: () => { enhancedPanel.show(); } }] });
                    if (store.settings().soundAlerts) alertEngine._beep(400, 0.08, 0.25);
                }
                this._lastCount = count;
            } catch {}
        },
    };

    const riskChangeMonitor = {
        _cache: {},
        async check(sym) {
            if (!store.settings().alertOnRiskChange) return;
            const sc = await riskScorer.score(sym).catch(() => null);
            if (!sc) return;
            const prev = this._cache[sym];
            this._cache[sym] = sc.risk;
            if (prev !== undefined && Math.abs(sc.risk - prev) >= 10) {
                const dir = sc.risk > prev ? 'increased' : 'decreased';
                notifier.show({ title: `⚠ Risk Change: ${sym}`, description: `Risk score ${dir} from ${prev} → ${sc.risk} (${sc.label})`, type: sc.risk > prev ? 'error' : 'success', duration: 10000, actions: [{ label: 'View Coin', onClick: () => { location.href = `/coin/${sym}`; } }] });
            }
        },
    };

    const holderDropMonitor = {
        _holders: {},
        _times: {},
        async track(sym) {
            if (!store.settings().alertOnHolderDrop) return;
            try {
                const r = await fetch(`/coin/${sym}/__data.json?x-sveltekit-invalidated=11`);
                if (!r.ok) return;
                const d = await r.json();
                const da = d?.nodes?.[1]?.data; if (!Array.isArray(da)) return;
                const ci = da[0]?.coin; if (ci === undefined) return;
                const coin = da[ci];
                const getVal = idx => (idx != null && da[idx] !== undefined ? da[idx] : null);
                const holders = getVal(coin?.holderCount) ?? 0;
                if (!holders) return;
                const prev = this._holders[sym];
                this._holders[sym] = holders;
                if (prev && holders < prev) {
                    const drop = ((prev - holders) / prev) * 100;
                    if (drop >= 10 && Date.now() - (this._times[sym] || 0) > 60000) {
                        this._times[sym] = Date.now();
                        notifier.show({ title: `📉 Holder Drop: ${sym}`, description: `Holders dropped ${drop.toFixed(1)}% (${prev} → ${holders})`, type: 'error', duration: 10000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (store.settings().soundAlerts) alertEngine._beep(250, 0.1, 0.35);
                    }
                }
            } catch {}
        },
    };

    const slippageTracker = {
        _trades: [],
        init() {
            wsInterceptor.on(d => {
                if (!store.settings().trackSlippage) return;
                if (!['live-trade','all-trades'].includes(d.type)) return;
                const sym = (d.data?.coinSymbol || '').toUpperCase();
                if (!utils.isCoinPage() || utils.getCoinSymbol() !== sym) return;
                const px = parseFloat(d.data?.price || 0);
                const expectedPx = spreadTracker._asks[sym] || spreadTracker._bids[sym] || px;
                if (!px || !expectedPx) return;
                const slip = Math.abs((px - expectedPx) / expectedPx * 100);
                this._trades.push({ sym, px, expectedPx, slip, ts: Date.now() });
                this._trades = this._trades.slice(-50);
                this._updateDisplay(sym);
            });
        },
        _updateDisplay(sym) {
            if (!document.getElementById('re-slippage')) {
                const el = document.createElement('div');
                el.id = 're-slippage';
                el.style.cssText = 'font-size:11px;color:#a1a1aa;padding:3px 8px;background:rgba(255,255,255,.05);border-radius:4px;margin-top:4px;display:inline-block';
                document.querySelector('main h1')?.parentElement?.appendChild(el);
            }
            const recent = this._trades.filter(t => t.sym === sym && Date.now() - t.ts < 60000);
            const avgSlip = recent.length ? (recent.reduce((a,b) => a + b.slip, 0) / recent.length).toFixed(3) : '—';
            const el = document.getElementById('re-slippage');
            if (el) el.textContent = `Avg slippage (1m): ${avgSlip}%`;
        },
    };

    const costBasisTracker = {
        _cache: {},
        async load(sym) {
            if (!store.settings().showPortfolioCostBasis) return;
            if (this._cache[sym] && Date.now() - this._cache[sym].ts < 300000) return this._cache[sym];
            try {
                const me = await utils.getLoggedInUsername(); if (!me) return;
                const d = await rugplayApi.userTrades(me, 1, 50);
                const trades = d.trades || d.data || [];
                const coinTrades = trades.filter(t => (t.coinSymbol || t.symbol || '').toUpperCase() === sym.toUpperCase());
                if (!coinTrades.length) return;
                let totalCost = 0, totalQty = 0;
                coinTrades.forEach(t => {
                    const qty = parseFloat(t.quantity || 0);
                    const val = parseFloat(t.totalValue || t.value || 0);
                    if ((t.type || '').toUpperCase() === 'BUY') { totalCost += val; totalQty += qty; }
                });
                if (!totalQty) return;
                const costBasis = totalCost / totalQty;
                this._cache[sym] = { costBasis, totalCost, totalQty, ts: Date.now() };

                // Inject on coin page
                if (utils.isCoinPage() && utils.getCoinSymbol() === sym && !document.getElementById('re-cost-basis')) {
                    const el = document.createElement('div');
                    el.id = 're-cost-basis';
                    el.style.cssText = 'font-size:11px;color:#a1a1aa;padding:3px 8px;background:rgba(255,255,255,.05);border-radius:4px;margin-top:4px;display:inline-block';
                    el.textContent = `Your avg cost: ${utils.usd(costBasis)} (${utils.num(totalQty)} held)`;
                    document.querySelector('main h1')?.parentElement?.appendChild(el);
                }
                return this._cache[sym];
            } catch {}
        },
    };

    const app = {
        w: new URLWatcher(),
        async init() {
            wsInterceptor.patch();
            alertEngine.init();
            volumeDetector.init();
            botDetector.init();
            liveFeed.init();
            watchlist.init();
            enhancedPanel.init();
            spreadTracker.init();
            slippageTracker.init();
            if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
            settingsEngine.applyAll();
            tradeInterceptor.apply();
            document.addEventListener('keydown', e => {
                const s = store.settings();
                if (s.keyboardShortcuts) {
                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'k') {
                        e.preventDefault();
                        if (s.quickSearch) quickSearch.toggle();
                    }
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'e') {
                        e.preventDefault();
                        if (!enhancedPanel.isVisible) enhancedPanel.show();
                        else enhancedPanel.hide();
                    }
                }
            }, { capture: true });
            if (store.settings().autoOpenPanel) {
                setTimeout(() => { try { enhancedPanel.show(); } catch {} }, 700);
            }
            analytics.run().catch(() => {});
            setTimeout(() => updateChecker.check().catch(() => {}), 4000);
            setInterval(() => updateChecker.check().catch(() => {}), CONFIG.intervals.updateCheck);

            // Report poller — every 2 minutes
            setInterval(() => reportPoller.poll().catch(() => {}), 120000);
            reportPoller.poll().catch(() => {});

            const run = utils.debounce(async () => {
                sidebarEnhancer.create();
                notifications.apply();
                adBlocker.apply();
                portfolioMover.apply();
                tradeInterceptor.apply();
                portfolioHighlighter.apply();
                enhancedPanel.handleHashChange();
                await userTagger.applyTags().catch(() => {});
                if (!enhancedPanel.isVisible) {
                    tableEnhancer.enhance();
                    await profileEnhancer.init().catch(() => {});
                    await coinPageEnhancer.init().catch(() => {});
                    // Per-coin monitors for holder drop, risk change, cost basis
                    const sym = utils.getCoinSymbol();
                    if (sym) {
                        holderDropMonitor.track(sym).catch(() => {});
                        riskChangeMonitor.check(sym).catch(() => {});
                        costBasisTracker.load(sym).catch(() => {});
                    }
                }
            }, CONFIG.intervals.init);
            new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
            this.w.on(() => {
                sidebarEnhancer._enhancedOk = false;
                sidebarEnhancer._searchOk = false;
                coinPageEnhancer._priceDropRef = null;
                run();
            }).start();
            run();

            // Dedicated sidebar poller
            let _sidebarAttempts = 0;
            const _sidebarPoll = setInterval(() => {
                _sidebarAttempts++;
                const ok = sidebarEnhancer.create();
                if (ok || _sidebarAttempts > 60) clearInterval(_sidebarPoll);
            }, 500);
        },
    };

    app.init();
})();
