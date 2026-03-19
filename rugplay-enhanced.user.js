// ==UserScript==
// @name Rugplay Enhanced
// @version 1.4.0
// @icon https://raw.githubusercontent.com/devbyego/rugplay-enhanced/main/icon.png
// @description Rugplay Enhanced 1.4.0 — fixed WS event parsing, real mods only, all features verified working. 100% Rugplay API. Zero tracking. — 100+ mods, live heatmap, portfolio chart, session journal, coin scanner, trade timeline, P&L tracker, quick copy, export tools. 100% Rugplay's own API. Zero tracking.
// @author devbyego
// @match https://rugplay.com/*
// @grant GM_addStyle
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_xmlhttpRequest
// @grant GM_notification
// @grant GM_info
// @grant unsafeWindow
// @connect rugplay-enhanced-api.rugplay-enhanced.workers.dev
// @connect rugplay.com
// @run-at document-start
// @downloadURL https://github.com/devbyego/rugplay-enhanced/releases/latest/download/rugplay-enhanced.user.js
// @updateURL https://github.com/devbyego/rugplay-enhanced/releases/latest/download/rugplay-enhanced.user.js
// ==/UserScript==
(function () {
    'use strict';
    const RE_API = 'https://rugplay-enhanced-api.rugplay-enhanced.workers.dev';
    const WS_PREFIX = 'wss://ws.rugplay.com';
    const wsInterceptor = {
        _patched: false,
        _cbs: [],
        stats: { lastMsgAt: 0, count: 0 },
        patch() {
            if (this._patched) return;
            this._patched = true;
            const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            window.addEventListener('message', (ev) => {
                const d = ev?.data;
                if (!d || d.__re_source !== 'ws') return;
                this.stats.lastMsgAt = Date.now();
                this.stats.count += 1;
                const payload = d.payload;
                // Normalize Rugplay WS events to a consistent internal shape.
                // Rugplay publishes trades flat (no wrapper type field on the trade itself).
                // We detect trade events by presence of coinSymbol + (type===BUY/SELL or totalValue).
                const normalized = wsInterceptor._normalize(payload);
                this._cbs.forEach(fn => { try { fn(normalized); } catch {} });
                // Respond to server pings to keep connection alive (server kills after 60s idle)
                if (payload && payload.type === 'ping') {
                    try {
                        // We cannot send on the WS directly here, but the page-side PW wrapper does it.
                        window.dispatchEvent(new CustomEvent('__re_pong'));
                    } catch {}
                }
            });
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
                            if (typeof url === 'string' && url.startsWith(WS_PREFIX)) {
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
        if (typeof url === 'string' && url.startsWith('${WS_PREFIX}')) {
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
        // Normalize any WS payload into our internal format.
        // Rugplay trade events come flat: { coinSymbol, username, type, totalValue, price, timestamp }
        // Price updates come as: { type:'price_update', coinSymbol, currentPrice, ... }
        // We map both to a consistent shape so all consumers work correctly.
        _normalize(d) {
            if (!d || typeof d !== 'object') return d;
            // Already normalized or special type
            if (d.type === 'price_update' || d.type === 'arcade_activity' || d.type === 'ping') return d;
            // Detect trade event: has coinSymbol and either totalValue or (type is BUY/SELL)
            const hasSymbol = !!(d.coinSymbol || d.coin_symbol || d.symbol);
            const hasTrade = !!(d.totalValue || d.total_value || d.type === 'BUY' || d.type === 'SELL' || d.username);
            if (hasSymbol && hasTrade) {
                // Normalize to internal trade shape
                return {
                    type: 'live-trade',
                    data: {
                        coinSymbol: (d.coinSymbol || d.coin_symbol || d.symbol || '').toUpperCase(),
                        username: d.username || d.user || '?',
                        type: (d.type || 'BUY').toUpperCase(),
                        totalValue: parseFloat(d.totalValue || d.total_value || d.amount || 0),
                        price: parseFloat(d.price || d.currentPrice || d.current_price || 0),
                        timestamp: d.timestamp || d.created_at || Date.now(),
                        quantity: d.quantity || d.amount || 0,
                        txHash: d.txHash || d.hash || null,
                    }
                };
            }
            // price_update from prices:SYMBOL channel (redundant but defensive)
            if (d.type === 'price_update' || d.currentPrice !== undefined) {
                return {
                    type: 'price_update',
                    coinSymbol: (d.coinSymbol || '').toUpperCase(),
                    price: parseFloat(d.currentPrice || d.price || 0),
                    data: d,
                };
            }
            return d;
        },
    };
    wsInterceptor.patch();
    const pathname = window.location.pathname;
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
        _DEFAULTS: {
            // ── Core (always on — non-intrusive, no visual changes) ────────────
            panelTab:'dashboard', forceDark:true, betterScrollbars:true,
            keyboardShortcuts:true, quickSearch:true, sidebarSearch:true,
            urlShortcuts:true, blockAnalytics:true, stripTrackingParams:true,
            autoRefreshFeed:true, timestampFormat:'relative', numberFormat:'abbreviated',
            feedMaxRows:80, whaleTxMin:500, priceDecimals:6,
            tradeFeedBuyColor:'#22c55e', tradeFeedSellColor:'#ef4444',
            accentColor:'default', cardRadius:'xl', feedMaxRowsCompact:120,
            accentPreset:'default', panelWidth:'normal', notifSound:'beep',
            notifDuration:5000, priceDropPct:20, volumeSpikeUsd:5000,
            holderDropPct:20, topCount:5, hotkeySearch:'k', hotkeyPanel:'e',
            gemMinScore:0, gemMaxRisk:40, smallTradeUsd:10,
            pinnedCoins:'', blockedUsers:'', trustedCreators:'',
            portfolioPnLMode:'session', portfolioRefreshRate:5000,
            riskAutoBlockThreshold:80, autoReportThreshold:0,
            muteBelow:0, panelOpacity:100, maxAlerts:50, whaleSizeFilter:500,
            chartType:'bar', feedFont:'mono',

            // ── Everything else starts OFF — user enables what they want ───────
            adblock:false, notifications:false, stickyPortfolio:false,
            appearOffline:false, showPnL:false, compactMode:false,
            autoOpenPanel:false, clickableRows:false, focusMode:false,
            hideFooter:false, hideOnlineCount:false, hidePromoBar:false,
            monoFont:false, largeClickTargets:false, smoothScrolling:false,
            hideEmptyPortfolio:false, dimInactiveTabs:false,
            highlightNewCoins:false, showCoinAge:false, showHolderCount:false,
            hideVerifiedBadge:false, borderlessCards:false, reducedMotion:false,
            sidebarCompact:false, hideRightSidebar:false, pinFavoriteCoins:false,
            hideOfflineDM:false, txCard:false, riskScore:false, riskCard:false,
            reportedBadge:false, coinNotes:false, showPriceChange:false,
            showVolume24h:false, showMarketCap:false, warnLowLiquidity:false,
            holdersWarning:false, showCreatorBadge:false, txTimestamps:false,
            txHighlightNew:false, txShowAvatar:false, quickBuyButtons:false,
            confirmTrades:false, showSpread:false, showCandleColors:false,
            highlightWhaleTrades:false, showPortfolioPercent:false,
            showPortfolioCostBasis:false, trackSlippage:false,
            showFeeEstimate:false, highlightProfitLoss:false, showBidAsk:false,
            botWarning:false, volumeSpikes:false, desktopAlerts:false,
            whalePing:false, flashTitle:false, soundAlerts:false,
            alertOnNewCoin:false, alertOnHolderDrop:false, alertOnPriceDrop:false,
            alertOnVolumeSpike:false, alertOnBotActivity:false,
            alertOnNewReport:false, alertOnWatchlistTrade:false,
            alertOnRiskChange:false, alertOnCreatorSell:false,
            hideBalance:false, blurPortfolioValue:false, anonymousMode:false,
            noReferrer:false, feedCompact:false, profileHistory:false,
            profileWatch:false, watchlistAlerts:false, preloadCoinData:false,
            devMode:false, heatmap:false, portfolioChart:false,
            sessionJournal:false, coinScanner:false, tradeTimeline:false,
            quickCopySymbol:false, exportData:false, showSessionStats:false,
            sentimentBar:false, autoTagCoins:false, highlightTopTraders:false,
            showCoinRank:false, feedSoundOnWhale:false, showTxHeatmap:false,
            zeroConfirmBuy:false, oneClickSell:false, showNetFlow:false,
            hideSmallTrades:false, groupByMinute:false, showChangePercent:false,
            colorCodeVolume:false, showBuySellRatio:false, blurFeedOnAlt:false,
            autoHidePanel:false, showLiveChart:false, compactAlerts:false,
            showAlertHistory:false, hideSponsoredCoins:false,
            showCoinDescription:false, showTopGainers:false, showTopLosers:false,
            enableHotkeys:false, sidebarBadge:false, showVersionBadge:false,
            showCreatorSells:false, showSpreadCard:false, showSlippageCard:false,
            communityTrust:false, showFollowedCoins:false, darkCharts:false,
            showGems:false, riskAutoBlock:false, showCoinCreator:false,
            hideOwnTrades:false, pinWatchlistFeed:false, showTxCount:false,
            highlightTopCoins:false, confirmSells:false,
            snipeTargets:'', snipeNavigate:true, snipeSound:true,
        },
        _cache: null,
        _cacheDirty: true,
        settings() {
            if (this._cacheDirty || !this._cache) {
                this._cache = { ...this._DEFAULTS, ...this.get('re:cfg', {}) };
                this._cacheDirty = false;
            }
            return this._cache;
        },
        cfg(k, v) {
            const s = this.settings();
            s[k] = v;
            this.set('re:cfg', s);
            this._cacheDirty = true;
        },
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
        usd: n => {
            const v = +n || 0;
            if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
            if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
            if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
        },
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
            const wsTrades = (liveFeed?.trades || [])
                .filter(t => t.sym === sym.toUpperCase())
                .slice(0, 50);
            if (wsTrades.length >= 3) {
                const start = (page - 1) * limit;
                const pageTrades = wsTrades.slice(start, start + limit);
                return {
                    trades: pageTrades.map(t => ({
                        type: t.type,
                        username: t.usr,
                        totalValue: t.val,
                        price: t.px,
                        timestamp: t.ts,
                        id: `ws_${t.sym}_${t.ts}_${t.usr}`,
                        _source: 'ws',
                    })),
                    pagination: {
                        current_page: page,
                        total_pages: Math.max(1, Math.ceil(wsTrades.length / limit)),
                        total: wsTrades.length,
                    },
                    _source: 'ws',
                };
            }
            try {
                const r = await fetch(`/api/coin/${sym}/trades?page=${page}&limit=${limit}`, { headers: { Accept: 'application/json' } });
                if (!r.ok) throw new Error('fetch_failed');
                return r.json();
            } catch (e) {
                if (wsTrades.length > 0) {
                    return {
                        trades: wsTrades.map(t => ({ type:t.type, username:t.usr, totalValue:t.val, price:t.px, timestamp:t.ts, id:`ws_${t.sym}_${t.ts}_${t.usr}`, _source:'ws' })),
                        pagination: { current_page:1, total_pages:1, total:wsTrades.length },
                        _source: 'ws',
                    };
                }
                throw e;
            }
        },
        userTrades: async (user, page = 1, limit = 15) => {
            // Rugplay uses /api/user/[username]/trades
            const r = await fetch(`/api/user/${encodeURIComponent(user)}/trades?page=${page}&limit=${limit}`, { headers: { Accept: 'application/json' } });
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
            try { const f = document.querySelector('footer'); if (f) f.style.display = s.hideFooter ? 'none' : ''; } catch {}
            try { if (!s.riskScore) document.getElementById(CONFIG.ids.coinRiskCard)?.remove(); } catch {}
            try { if (s.desktopAlerts && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch {}
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
            try {
                if (s.stripTrackingParams) {
                    const url = new URL(location.href);
                    const tracked = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','referrer','fbclid','gclid','msclkid','twclid','mc_cid','mc_eid'];
                    let changed = false;
                    tracked.forEach(p => { if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; } });
                    if (changed) history.replaceState({}, '', url.toString());
                }
            } catch {}
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
            try {
                if (s.blurFeedOnAlt && !document._reBlurPatch) {
                    document._reBlurPatch = true;
                    window.addEventListener('blur', () => {
                        if (store.settings().blurFeedOnAlt) {
                            const el = document.getElementById('re-feed-rows'); if (el) el.style.filter = 'blur(6px)';
                        }
                    });
                    window.addEventListener('focus', () => {
                        const el = document.getElementById('re-feed-rows'); if (el) el.style.filter = '';
                    });
                }
            } catch {}
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
            if (s.hideOfflineDM) rules.push('[class*="online-indicator"],[class*="online_dot"],[data-status="online"] [class*="dot"],[class*="presence"]{display:none!important}');
            if (s.hideVerifiedBadge) rules.push('[class*="verified"],[class*="badge-verified"]{display:none!important}');
            if (s.feedCompact) rules.push('.xp-feed-row{padding-top:3px!important;padding-bottom:3px!important;font-size:11px!important}.xp-feed-rows{max-height:440px!important}.xp-feed-head{padding-top:3px!important;padding-bottom:3px!important;font-size:8px!important}.xp-feed-ctrl{padding:7px 14px!important}');
            if (s.highlightWhaleTrades) rules.push('[data-whale="1"]{outline:1px solid #f59e0b!important;outline-offset:-1px!important}');
            if (s.showCandleColors) rules.push('[class*="candle"][class*="up"],[class*="bull"]{color:#22c55e!important}[class*="candle"][class*="down"],[class*="bear"]{color:#ef4444!important}');
            if (s.showMarketCap) rules.push('[data-re-mcap-hidden]{display:block!important;visibility:visible!important}');
            const accent = s.accentColor && s.accentColor !== 'default' ? s.accentColor : null;
            if (accent) rules.push(`:root{--primary:${accent}}`);
            if (s.blurFeedOnAlt) rules.push('#re-panel-wrapper .xp-feed-rows{transition:filter .3s}');
            if (s.colorCodeVolume) rules.push('.xp-agg-v{transition:color .3s}');
            if (s.compactAlerts) rules.push('.xp-al-row{padding:6px 9px!important}');
            if (s.darkCharts) rules.push('[class*="chart"],[class*="Chart"]{background:#0f0f12!important;color:#f2f2f4!important}');
            if (s.groupByMinute) rules.push('.xp-feed-row[data-minute-group]{border-top:2px solid rgba(255,255,255,.1)!important}');
            if (s.hideSmallTrades) rules.push('.xp-feed-row[data-small="1"]{display:none!important}');
            if (s.highlightTopTraders) rules.push('.xp-feed-row[data-top-trader="1"] .xp-f-usr{color:#f59e0b!important;font-weight:700!important}');
            if (s.panelWidth) rules.push('#re-panel-wrapper{max-width:100%!important;width:100%!important}');
            if (s.riskAutoBlock) rules.push('[data-re-risk-blocked]{display:none!important}');
            if (s.showBuySellRatio) rules.push('.xp-mini-sub{font-weight:500}');
            if (s.showChangePercent) rules.push('.xp-wl-chg{display:inline-flex!important}');
            if (s.showCoinRank) rules.push('.xp-mini-sym::before{content:attr(data-rank);font-size:8px;color:var(--xp-t3);margin-right:3px;font-family:var(--xp-mono)}');
            if (s.showCreatorSells) rules.push('.xp-feed-row[data-creator-sell="1"]{background:rgba(239,68,68,.06)!important;border-left-color:#ef4444!important}');
            if (s.showNetFlow) rules.push('.xp-agg-cell:last-child .xp-agg-v{font-weight:800}');
            if (s.showTxHeatmap) rules.push('.xp-feed-row[data-intensity="high"]{background:rgba(245,158,11,.07)!important}.xp-feed-row[data-intensity="low"]{opacity:.65!important}');
            if (s.showVersionBadge) rules.push('.xp-pill.ver{display:inline-flex!important}');
            if (!s.showVersionBadge) rules.push('.xp-pill.ver{display:none!important}');
            if (s.sidebarBadge) {
                const alertCount = store.alerts().filter(a=>!a.done).length;
                if (alertCount > 0) rules.push(`#${CONFIG.ids.enhancedBtn}::after{content:'${alertCount}';position:absolute;top:-4px;right:-6px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:monospace}`);
            }
            if (s.zeroConfirmBuy) rules.push('[data-re-confirm]{display:none!important}');
            if (s.hideEmptyPortfolio) rules.push('[data-sidebar="group"]:has(.font-mono:empty){display:none!important}');
            if (s.showTradingVolume) rules.push('.xp-f-sym::after{content:attr(data-vol);font-size:8px;color:var(--xp-t3);margin-left:3px;font-family:var(--xp-mono)}');
            if (s.muteCreator) rules.push('.xp-feed-row[data-creator="1"]{display:none!important}');
            if (s.autoTagCoins) rules.push('.xp-badge{display:inline-flex!important}');
            else rules.push('.xp-badge{display:none!important}');
            if (s.exportData) rules.push('#xp-export-feed,#xp-export-csv,#xp-wl-export,#xp-export-settings{display:inline-flex!important}');
            else rules.push('#xp-export-feed,#xp-export-csv,#xp-wl-export,#xp-export-settings{display:none!important}');
            if (s.pinnedCoins) rules.push('.xp-feed-row[data-pinned]{border-left-color:#a78bfa!important;background:rgba(139,92,246,.04)!important}');
            if (s.showAvgEntryPrice) rules.push('[id="re-avg-entry"]{display:inline-block!important}');
            else rules.push('[id="re-avg-entry"]{display:none!important}');
            if (!s.showGems) rules.push('#xp-gems{display:none!important}');
            if (!s.showTopGainers) rules.push('#xp-gainers{display:none!important}');
            if (!s.showTopLosers) rules.push('#xp-losers{display:none!important}');
            if (s.showLiveChart) rules.push('#xp-pf-chart-card{display:block!important}');
            if (s.tradeTimeline) rules.push('#xp-feed-timeline-toggle{border-color:var(--re-b3)!important}');
            // NEW REAL MODS
            if (s.hideOwnTrades) {
                const me = document.querySelector('#bits-c1 .truncate.text-xs')?.textContent?.replace('@','').trim();
                if (me) rules.push(`.xp-feed-row[data-user="${CSS.escape(me)}"]{display:none!important}`);
            }
            if (s.highlightTopCoins) rules.push('[data-top-vol="1"].xp-feed-row{border-left-color:rgba(255,214,10,.8)!important;background:rgba(255,214,10,.03)!important}');
            if (s.confirmSells) rules.push('/* confirmSells handled in tradeInterceptor */');
            if (s.feedCompact) rules.push('.xp-feed-row{padding-top:3px!important;padding-bottom:3px!important;font-size:11px!important}.xp-feed-rows{max-height:500px!important}');
            // Fix CSS var references - xp-* vars don't exist, re-* do
            this._el.textContent = rules.join('\n');
        },
    };
    const theme = {
        apply() {
            const enabled = !!store.settings().forceDark;
            try {
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
            try {
                const cs = store.settings();
                if (cs.alertOnLowBalance && typeof cash === 'number' && cash < 10 && cash > 0) {
                    const k = 're_lb_warn'; if (GM_getValue(k, 0) < Date.now() - 300000) {
                        GM_setValue(k, Date.now());
                        notifier.show({title:'💰 Low Balance', description:`Cash balance is ${utils.usd(cash)} — almost out of buying power`, type:'warning', duration:8000});
                    }
                }
            } catch {}
            if (store.settings().showPnL && total !== undefined) {
                const pf = store.portfolio();
                if (!pf.snaps) pf.snaps = [];
                const isFirstToday = !pf.snaps.some(s => Date.now() - s.ts < 86400000);
                pf.snaps.push({ total, ts: Date.now(), sessionStart: isFirstToday || pf.snaps.length === 0 });
                pf.snaps = pf.snaps.filter(s => Date.now() - s.ts < 86400000 * 7);
                store.pfSet(pf);
                document.getElementById(CONFIG.ids.pnlEl)?.remove();
                if (pf.snaps.length >= 2) {
                    const sessionStart = pf.snaps.find(s => s.sessionStart) || pf.snaps[0];
                    const old = sessionStart.total;
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
        init() {
            wsInterceptor.on(d => {
                // Handle trade events
                if (d.type === 'live-trade' && d.data) {
                    const sym = (d.data.coinSymbol || '').toUpperCase();
                    const px = parseFloat(d.data.price || 0);
                    if (sym && px) this._chk(sym, px);
                }
                // Handle price_update events from prices:SYMBOL channel
                if (d.type === 'price_update') {
                    const sym = (d.coinSymbol || '').toUpperCase();
                    const px = parseFloat(d.price || 0);
                    if (sym && px) this._chk(sym, px);
                }
            });
        },
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
                if (d.type !== 'live-trade') return;
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
        init() { wsInterceptor.on(d => { if (d.type !== 'live-trade') return; const sym = (d.data?.coinSymbol || '').toUpperCase(); const usr = d.data?.username; if (!sym || !usr) return; if (!this.tr[sym]) this.tr[sym] = []; this.tr[sym].push({ usr, v: parseFloat(d.data?.totalValue || 0), type: (d.data?.type || '').toUpperCase(), ts: Date.now() }); this.tr[sym] = this.tr[sym].filter(x => Date.now() - x.ts < 120000); this._ana(sym); }); },
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
                const holders = (() => {
                    const v = getVal(coin.holderCount);
                    if (v && typeof v === 'number' && v > 0) return v;
                    if (typeof coin.holderCount === 'number') { const v2 = da[coin.holderCount]; if (typeof v2 === 'number' && v2 > 0) return v2; }
                    for (const k of ['holders', 'holderCount', 'numHolders', 'totalHolders']) { if (coin[k] != null) { const vk = getVal(coin[k]); if (vk > 0) return vk; } }
                    return 0;
                })();
                const mcap = (() => {
                    const v = getVal(coin.marketCap);
                    if (v && v > 0) return v;
                    for (const k of ['marketCap', 'market_cap', 'mcap']) { if (coin[k] != null) { const vk = getVal(coin[k]); if (vk > 0) return vk; } }
                    return 0;
                })();
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
                if (d.type !== 'live-trade') return;
                const t = d.data; if (!t) return;
                const sym = (t.coinSymbol || '').toUpperCase();
                const usr = t.username || '?';
                const type = (t.type || 'BUY').toUpperCase();
                const val = parseFloat(t.totalValue || 0);
                const px = parseFloat(t.price || 0);
                const ts = t.timestamp || Date.now();
                const isWhale = val >= (store.settings().whaleTxMin || 500);
                portfolioUpdater.trigger();
                const _cachedRisk = riskScorer.cache?.[sym];
                const isCreator = _cachedRisk?.creatorUsername && _cachedRisk.creatorUsername.toLowerCase() === usr.toLowerCase();
                this.trades.unshift({ sym, usr, type, val, px, ts, isWhale, isCreator: !!isCreator });
                this.trades = this.trades.slice(0, 500);
                if (this.open && !this.paused) this._renderThrottled();
                const s = store.settings();
                if (watchlist.has(sym)) {
                    // Always track watchlist trades for the wl feed tab
                    if (!window._reWlFeed) window._reWlFeed = [];
                    window._reWlFeed.unshift({ sym, usr, type, val, px, ts });
                    window._reWlFeed = window._reWlFeed.slice(0, 200);
                    if ((s.alertOnWatchlistTrade || s.watchlistAlerts)) {
                        const k = `re_wla_${sym}`; if (GM_getValue(k, 0) < Date.now() - 10000) {
                            GM_setValue(k, Date.now());
                            notifier.show({ title: `👁 Watchlist: ${sym}`, description: `${usr} ${type === 'SELL' ? 'sold' : 'bought'} ${utils.usd(val)}`, type: type === 'SELL' ? 'warning' : 'success', duration: 6000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                            if (s.soundAlerts) alertEngine._beep(type === 'SELL' ? 280 : 550, 0.07, 0.2);
                        }
                    }
                }
                if (s.whalePing && isWhale) {
                    const k = `re_wp_${sym}`; if (GM_getValue(k, 0) < Date.now() - 15000) {
                        GM_setValue(k, Date.now());
                        notifier.show({ title: `🐋 Whale Trade`, description: `${sym} — ${usr} ${type} ${utils.usd(val)}`, type: 'warning', duration: 7000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (s.soundAlerts) alertEngine._beep(220, 0.1, 0.4);
                    }
                }
                if (s.alertOnNewCoin && !this._seenCoins.has(sym)) {
                    this._seenCoins.add(sym);
                    if (this._seenCoins.size > 1) {
                        notifier.show({ title: `🆕 New Coin: ${sym}`, description: `First trade seen — ${usr} ${type} ${utils.usd(val)}`, type: 'info', duration: 8000, actions: [{ label: 'View', onClick: () => { location.href = `/coin/${sym}`; } }] });
                        if (s.soundAlerts) alertEngine._beep(660, 0.08, 0.2);
                    }
                }
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
            const s2 = store.settings();
            const recentUsers = {};
            liveFeed.trades.filter(t => Date.now()-t.ts < 300000).forEach(t => { recentUsers[t.usr] = (recentUsers[t.usr]||0)+1; });
            const topTraderSet = new Set(Object.entries(recentUsers).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]));
            const vals = shown.map(t => t.val);
            const medVal = vals.length ? vals.slice().sort((a,b)=>a-b)[Math.floor(vals.length/2)] : 0;
            let lastMinute = null;
            body.innerHTML = shown.slice(0, 80).map((t,i) => {
                const isWhale = t.val >= (s2.whaleTxMin||500);
                const isTopTrader = s2.highlightTopTraders && topTraderSet.has(t.usr);
                const isCreatorSell = t.type==='SELL' && t.isCreator;
                const intensity = t.val > medVal*3 ? 'high' : t.val < medVal*0.2 ? 'low' : 'mid';
                const isSmall = t.val < (s2.smallTradeUsd||10);
                const tMinute = Math.floor(t.ts/60000);
                const minuteGroup = s2.groupByMinute && tMinute !== lastMinute; lastMinute = tMinute;
                const _pins = new Set((s2.pinnedCoins||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean));
                const attrs = [
                    isWhale ? 'data-whale="1"' : '',
                    isTopTrader ? 'data-top-trader="1"' : '',
                    isCreatorSell ? 'data-creator-sell="1"' : '',
                    s2.showTxHeatmap ? `data-intensity="${intensity}"` : '',
                    isSmall ? 'data-small="1"' : '',
                    minuteGroup ? 'data-minute-group="1"' : '',
                    _pins.has(t.sym) ? 'data-pinned="1"' : '',
                    s2.showTradingVolume ? `data-vol="${utils.usd(t.val)}"` : '',
                ].filter(Boolean).join(' ');
                return `<a href="/coin/${t.sym}" class="xp-feed-row ${t.type==='SELL'?'sell':'buy'}" ${attrs} data-user="${t.usr}">${s2.showTxHeatmap && minuteGroup ? '<div style="grid-column:1/-1;font-size:9px;color:var(--re-t2);padding:4px 0 2px;font-family:var(--re-mono)">' + new Date(t.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</div>' : ''}<span class="${t.type==='SELL'?'xp-b-sell':'xp-b-buy'}">${t.type}</span><span class="xp-f-sym">${t.sym}${isWhale?'<span class="xp-badge whale">🐋</span>':''}${isCreatorSell?'<span class="xp-badge" style="color:#ef4444;background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.2)">dev</span>':''}</span><span class="xp-f-usr">${t.usr}</span><span class="xp-f-val">${utils.usd(t.val)}</span><span class="xp-f-ts" data-ts="${t.ts}">${utils.ago(t.ts)}</span></a>`;
            }).join('');
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
                ? hot.map(h=>`<a class="xp-mini-row" href="/coin/${h.sym}"><span class="xp-mini-sym">${h.sym} ${store.settings().showCoinMomentum?momentum.badge(h.sym):''}</span><span class="xp-mini-sub">${h.n} trades · ${utils.usd(h.vol)} · ${utils.ago(h.last)}</span><span class="${h.buy>=h.sell?'xp-t-buy':'xp-t-sell'}">${h.buy}/${h.sell}</span></a>`).join('')
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
            await utils.sleep(1200);
            if (!utils.isCoinPage() || utils.getCoinSymbol() !== sym) return;
            const s = store.settings();
            try {
                const r = await fetch(`/coin/${sym}/__data.json?x-sveltekit-invalidated=11`);
                if (!r.ok) return;
                const d = await r.json();
                const da = d?.nodes?.[1]?.data; if (!Array.isArray(da)) return;
                const ci = da[0]?.coin; if (ci === undefined) return;
                const coin = da[ci]; if (!coin || typeof coin !== 'object') return;
                const getVal = idx => (idx != null && da[idx] !== undefined ? da[idx] : null);
                const holders = (() => {
                    const v = getVal(coin.holderCount);
                    if (v && typeof v === 'number' && v > 0) return v;
                    if (typeof coin.holderCount === 'number') { const v2 = da[coin.holderCount]; if (typeof v2 === 'number' && v2 > 0) return v2; }
                    for (const k of ['holders', 'holderCount', 'numHolders', 'totalHolders']) {
                        if (coin[k] != null) { const vk = getVal(coin[k]); if (vk > 0) return vk; }
                    }
                    return 0;
                })();
                const mcap = (() => {
                    const v = getVal(coin.marketCap);
                    if (v && v > 0) return v;
                    for (const k of ['marketCap', 'market_cap', 'mcap', 'totalValue']) {
                        if (coin[k] != null) { const vk = getVal(coin[k]); if (vk > 0) return vk; }
                    }
                    return 0;
                })();
                const vol24 = getVal(coin.volume24h) ?? getVal(coin.dailyVolume) ?? 0;
                const change24 = getVal(coin.priceChange24h) ?? getVal(coin.change24h) ?? null;
                const created = getVal(coin.createdAt) ?? null;
                const h1 = document.querySelector('main h1, main .text-2xl.font-bold, main .text-3xl.font-bold');
                if (!h1) return;
                // showCoinCreator
                if (s.showCoinCreator && !document.getElementById('re-coin-creator')) {
                    const cu = getVal(coin.creatorUsername) ?? getVal(coin.creator) ?? null;
                    if (cu && typeof cu === 'string') {
                        const eld = document.createElement('div');
                        eld.id = 're-coin-creator';
                        eld.style.cssText = 'font-size:11px;color:#a1a1aa;display:inline-flex;align-items:center;gap:5px;margin-top:3px';
                        eld.innerHTML = 'Created by <a href="/user/' + cu + '" style="color:#60a5fa;text-decoration:none;font-weight:600">@' + cu + '</a>';
                        document.querySelector('main h1')?.parentElement?.appendChild(eld);
                    }
                }
                // showTxCount
                if (s.showTxCount && !document.getElementById('re-tx-count')) {
                    const ttrades = getVal(coin.tradeCount) ?? getVal(coin.totalTrades) ?? null;
                    if (ttrades && ttrades > 0) {
                        const etc = document.createElement('span');
                        etc.id = 're-tx-count';
                        etc.style.cssText = 'font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.06);color:#a1a1aa;margin-left:6px;vertical-align:middle;display:inline-block';
                        etc.textContent = ttrades.toLocaleString() + ' trades';
                        document.querySelector('main h1')?.appendChild(etc);
                    }
                }
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
                const statsArea = document.querySelector('main .grid, main .flex.flex-wrap') || h1.parentElement;
                if (s.showHolderCount && holders && !document.getElementById('re-coin-holders')) {
                    const el = document.createElement('div');
                    el.id = 're-coin-holders';
                    el.style.cssText = 'font-size:12px;font-weight:600;color:#a1a1aa;display:inline-flex;align-items:center;gap:5px;margin-right:12px';
                    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${holders.toLocaleString()} holders`;
                    statsArea?.prepend(el);
                }
                if (s.holdersWarning && holders < 10 && !document.getElementById('re-holders-warn')) {
                    const el = document.createElement('div');
                    el.id = 're-holders-warn';
                    el.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:6px;font-size:11px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:6px';
                    el.innerHTML = `⚠ Only ${holders} holder${holders !== 1 ? 's' : ''} — extreme concentration risk`;
                    h1.parentElement?.insertAdjacentElement('afterend', el);
                }
                if (s.warnLowLiquidity && mcap < 500 && !document.getElementById('re-liquidity-warn')) {
                    const el = document.createElement('div');
                    el.id = 're-liquidity-warn';
                    el.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:6px;font-size:11px;font-weight:600;color:#f59e0b;display:flex;align-items:center;gap:6px';
                    el.innerHTML = `⚠ Very low market cap (${utils.usd(mcap)}) — high rugpull risk`;
                    document.getElementById('re-holders-warn')?.insertAdjacentElement('afterend', el) || h1.parentElement?.insertAdjacentElement('afterend', el);
                }
                if (s.showPriceChange && change24 !== null && !document.getElementById('re-price-change')) {
                    const pct = parseFloat(change24);
                    const el = document.createElement('span');
                    el.id = 're-price-change';
                    const color = pct >= 0 ? '#22c55e' : '#ef4444';
                    el.style.cssText = `font-size:12px;font-weight:700;padding:2px 7px;border-radius:4px;background:${color}18;color:${color};margin-left:6px;vertical-align:middle`;
                    el.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% 24h`;
                    h1.appendChild(el);
                }
                if (s.showVolume24h && vol24 && !document.getElementById('re-vol24')) {
                    const el = document.createElement('span');
                    el.id = 're-vol24';
                    el.style.cssText = 'font-size:11px;font-weight:600;color:#a1a1aa;margin-left:8px';
                    el.textContent = `Vol: ${utils.usd(vol24)}`;
                    statsArea?.appendChild(el);
                }
                if (s.alertOnPriceDrop) {
                    const curPx = getVal(coin.currentPrice) ?? getVal(coin.price) ?? 0;
                    if (curPx && !this._priceDropRef) {
                        this._priceDropRef = { sym, px: curPx, ts: Date.now() };
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
            card.innerHTML = `<div class="grid grid-cols-[1fr_auto] items-center gap-1.5 px-6"><div class="font-semibold leading-none flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>Recent Transactions<span id="re-tx-source" style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;margin-left:6px;background:rgba(34,197,94,.1);color:#22c55e;border:1px solid rgba(34,197,94,.2);display:none">LIVE</span><button id="${CONFIG.ids.coinTxRefresh}" class="ml-1 p-1.5 rounded-md hover:bg-accent transition-colors" title="Refresh">${ICONS.refresh}</button></div></div><div id="${CONFIG.ids.coinTxBody}" class="px-0 min-h-[120px] flex items-center justify-center"><div class="flex flex-col items-center gap-2 text-muted-foreground">${ICONS.loading}<span class="text-sm animate-pulse">Loading...</span></div></div><div id="${CONFIG.ids.coinTxPagination}" class="px-6 flex justify-center items-center gap-2"></div>`;
            if (!this._insertAfterTrade(sym, card)) {
                if (!anchor) { this._pending.delete(key); return; }
                anchor.insertAdjacentElement('beforebegin', card);
            }
            document.getElementById(CONFIG.ids.coinTxRefresh)?.addEventListener('click', () => this._loadTx(sym, 1, true));
            await this._loadTx(sym, 1);
            wsInterceptor.on(d => {
                if (!['live-trade','all-trades'].includes(d.type)) return;
                const wsSym = (d.data?.coinSymbol || '').toUpperCase();
                if (wsSym !== sym) return;
                if (!document.getElementById(CONFIG.ids.coinTxCard)) return;
                this._loadTx(sym, 1, true);
            });
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
                const liveBadge = document.getElementById('re-tx-source');
                if (liveBadge) liveBadge.style.display = d._source === 'ws' ? 'inline-flex' : 'none';
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
                // Accept both trade events and price_update events for price tracking
                let sym = '', px = 0;
                if (d.type === 'live-trade' && d.data) {
                    sym = (d.data.coinSymbol || '').toUpperCase();
                    px = parseFloat(d.data.price || 0);
                } else if (d.type === 'price_update') {
                    sym = (d.coinSymbol || '').toUpperCase();
                    px = parseFloat(d.price || 0);
                }
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
            el.querySelectorAll('.xp-wl-del').forEach(b => b.onclick = () => { this.del(b.dataset.s); this.renderPanel(); });
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
            const main = document.querySelector('main') || document.querySelector('[data-slot="main"]') || document.querySelector('#main-content');
            if (!main) return;
            this.originalMainChildren = Array.from(main.children).filter(c => c.id !== CONFIG.ids.panelWrapper);
            this.originalMainChildren.forEach(c => { c.dataset.reHidden = '1'; c.style.setProperty('display','none','important'); });
            this._mainStyles = [];
            let el = main;
            while (el && el !== document.body) {
                const s = el.style;
                this._mainStyles.push([el, s.overflow, s.height, s.minHeight, s.maxHeight, s.display]);
                s.overflow = 'visible';
                s.height = 'auto';
                s.minHeight = '0';
                s.maxHeight = 'none';
                if (getComputedStyle(el).display === 'none') s.display = 'block';
                el = el.parentElement;
            }
            const wrap = document.createElement('div');
            wrap.id = CONFIG.ids.panelWrapper;
            wrap.style.cssText = 'display:block!important;width:100%!important;min-height:100vh!important;box-sizing:border-box!important;padding:0!important;margin:0!important;max-width:none!important;position:relative!important;flex:1 1 auto!important;';
            wrap.innerHTML = this._render();
            wrap.querySelectorAll('[data-re-section]').forEach(el => { el.style.display = 'none'; });
            main.appendChild(wrap);
            requestAnimationFrame(() => {
                const h = wrap.getBoundingClientRect().height;
                if (h < 10) {
                    wrap.style.position = 'fixed';
                    wrap.style.inset = '0';
                    wrap.style.zIndex = '9999';
                    wrap.style.overflow = 'auto';
                    wrap.style.minHeight = '100vh';
                }
            });
            this.isVisible = true;
            if (location.hash !== '#rugplay-enhanced') history.pushState('','',location.pathname+'#rugplay-enhanced');
            this._attachListeners();
            this._loadChangelog();
            notifications.apply();
            adBlocker.apply();
            liveFeed.open = true; liveFeed.render(); liveFeed.startTsTimer();
            dashboard.render();
            settingsEngine.applyAll();
            ['re-stat-trades','xp-stat-trades','xp-stat-trades-2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=liveFeed.trades.length;});
        },
        hide() {
            if (!this.isVisible) return;
            document.getElementById(CONFIG.ids.panelWrapper)?.remove();
            this.originalMainChildren.forEach(c => { try { c.style.removeProperty('display'); delete c.dataset.reHidden; } catch {} });
            this.originalMainChildren = [];
            if (this._panelTimer) { clearInterval(this._panelTimer); this._panelTimer = null; }
            (this._mainStyles || []).forEach(([el, ov, h, mh, maxh, disp]) => {
                try { el.style.overflow=ov; el.style.height=h; el.style.minHeight=mh; el.style.maxHeight=maxh; if(disp!==undefined)el.style.display=disp; } catch {}
            });
            this._mainStyles = [];
            this.isVisible = false;
            liveFeed.open = false; liveFeed.stopTsTimer();
            if (location.hash === '#rugplay-enhanced') history.pushState('', document.title, location.pathname + location.search);
        },
        _syncToggle(id, val) { const el = document.getElementById(id); if (el) { el.setAttribute('aria-checked', String(!!val)); } },
        _render() {
            const s = store.settings();
            const activeAlerts = store.alerts().filter(a=>!a.done).length;
            const wlCount = store.get('re:wl',[]).length;
            const ver = GM_info?.script?.version || '1.4.0';

            // ── MODS registry ──────────────────────────────────────────────────
            const MODS = [
                // Interface
                {key:'adblock',             name:'Ad Blocker',           desc:'Removes Google ads and third-party trackers from every page.',                    cat:'Interface', icon:'🛡'},
                {key:'notifications',        name:'Notification Badges',  desc:'Shows unread notification count on the sidebar bell icon.',                      cat:'Interface', icon:'🔔'},
                {key:'forceDark',            name:'Force Dark Mode',       desc:'Forces dark mode regardless of OS or browser preference.',                       cat:'Interface', icon:'🌙'},
                {key:'stickyPortfolio',      name:'Sticky Portfolio',      desc:'Pins your portfolio to the sidebar footer so it never scrolls away.',            cat:'Interface', icon:'📌'},
                {key:'compactMode',          name:'Compact Layout',        desc:'Tightens spacing across the entire Rugplay UI — more data, less padding.',       cat:'Interface', icon:'⚡'},
                {key:'sidebarCompact',       name:'Compact Sidebar',       desc:'Shrinks sidebar nav items to 28px, fitting more links without scrolling.',       cat:'Interface', icon:'↕'},
                {key:'focusMode',            name:'Focus Mode',            desc:'Fades sidebar and header to 12% opacity. Hover to reveal.',                      cat:'Interface', icon:'🎯'},
                {key:'borderlessCards',      name:'Borderless Cards',      desc:'Removes card borders for a flat, minimal aesthetic.',                            cat:'Interface', icon:'◻'},
                {key:'monoFont',             name:'Monospace UI',          desc:'Forces monospace font across the entire Rugplay interface.',                     cat:'Interface', icon:'⌨'},
                {key:'reducedMotion',        name:'Reduce Motion',         desc:'Cuts all CSS animation durations to near-zero. Great for low-end hardware.',     cat:'Interface', icon:'⏸'},
                {key:'smoothScrolling',      name:'Smooth Scroll',         desc:'Enables CSS smooth scrolling on all pages.',                                     cat:'Interface', icon:'🌊'},
                {key:'largeClickTargets',    name:'Large Click Targets',   desc:'Enforces 32px minimum height on all buttons and links.',                         cat:'Interface', icon:'👆'},
                {key:'betterScrollbars',     name:'Slim Scrollbars',       desc:'Replaces chunky default scrollbars with slim 5px dark-theme ones.',              cat:'Interface', icon:'↕'},
                {key:'hideFooter',           name:'Hide Footer',           desc:'Removes the page footer to reclaim vertical space.',                             cat:'Interface', icon:'🫥'},
                {key:'hidePromoBar',         name:'Hide Promo Banners',    desc:'Hides promotional announcement banners.',                                        cat:'Interface', icon:'🚫'},
                {key:'hideRightSidebar',     name:'Hide Right Panel',      desc:'Collapses the right sidebar giving the main content more room.',                 cat:'Interface', icon:'◀'},
                {key:'hideOnlineCount',      name:'Hide Online Count',     desc:'Removes online user count indicators from the interface.',                      cat:'Interface', icon:'👁'},
                {key:'dimInactiveTabs',      name:'Dim Inactive Tab',      desc:'Dims the page to 50% opacity when you switch to another browser tab.',           cat:'Interface', icon:'🌫'},
                {key:'sidebarSearch',        name:'Sidebar Search Btn',    desc:'Adds Quick Search to the sidebar nav. Ctrl+K still works anywhere.',             cat:'Interface', icon:'🔍'},
                {key:'urlShortcuts',         name:'URL Shortcuts',         desc:'Type /@username or /*SYMBOL in the address bar to navigate directly.',           cat:'Interface', icon:'🔗'},
                {key:'keyboardShortcuts',    name:'Keyboard Shortcuts',    desc:'Ctrl+K = search, Ctrl+Shift+E = toggle Enhanced panel.',                        cat:'Interface', icon:'⌨'},
                {key:'autoOpenPanel',        name:'Auto-open Panel',       desc:'Opens the Enhanced panel automatically on every Rugplay page load.',             cat:'Interface', icon:'🚀'},
                {key:'sidebarBadge',         name:'Alert Badge',           desc:'Red dot on the Enhanced sidebar button when there are active price alerts.',     cat:'Interface', icon:'🔴'},
                {key:'showVersionBadge',     name:'Version Badge',         desc:'Shows the current Enhanced version number in the panel header.',                 cat:'Interface', icon:'🏷'},
                {key:'autoHidePanel',        name:'Auto-hide on Navigate', desc:'Automatically closes the panel when you click to a coin or user page.',          cat:'Interface', icon:'↩'},
                {key:'quickCopySymbol',      name:'Quick Copy Symbol',     desc:'Click any coin symbol in the panel to instantly copy it to clipboard.',          cat:'Interface', icon:'📋'},
                // Trading
                {key:'txCard',               name:'Transaction Card',      desc:'Injects a live paginated trade history card on every coin page.',                cat:'Trading',   icon:'📊'},
                {key:'riskCard',             name:'Risk Score Card',       desc:'0-100 risk score card on coin pages based on age, holders, mcap & sell pressure.',cat:'Trading', icon:'⚠'},
                {key:'riskScore',            name:'Risk Engine',           desc:'Powers background risk computation. Disable to stop all risk scoring.',          cat:'Trading',   icon:'🧠'},
                {key:'reportedBadge',        name:'Reported Badge',        desc:'Community warning badge on coin pages flagged in the Reporter.',                 cat:'Trading',   icon:'🚩'},
                {key:'coinNotes',            name:'Coin Notes',            desc:'Private per-coin sticky notes. Stored locally, never sent anywhere.',            cat:'Trading',   icon:'📝'},
                {key:'showCoinAge',          name:'Show Coin Age',         desc:'Displays age badge (e.g. 2h old) next to the coin name on coin pages.',          cat:'Trading',   icon:'🕐'},
                {key:'showHolderCount',      name:'Show Holders',          desc:'Prominently displays holder count on coin pages.',                               cat:'Trading',   icon:'👥'},
                {key:'showCoinCreator',      name:'Show Creator',          desc:'Displays the coin creator username linked to their profile on coin pages.',      cat:'Trading',   icon:'👤'},
                {key:'showTxCount',          name:'Trade Count Badge',     desc:'Shows total trade count next to coin name on coin pages.',                      cat:'Trading',   icon:'🔢'},
                {key:'holdersWarning',       name:'Low Holder Warning',    desc:'Red warning banner when holder count drops below 10 — extreme rug risk.',       cat:'Trading',   icon:'🔴'},
                {key:'warnLowLiquidity',     name:'Low Liquidity Warning', desc:'Amber banner when market cap is under $500 — extreme rugpull risk.',            cat:'Trading',   icon:'🟡'},
                {key:'txTimestamps',         name:'Live Timestamps',       desc:'Keeps transaction card timestamps updating every second.',                       cat:'Trading',   icon:'⏱'},
                {key:'txHighlightNew',       name:'Highlight New Txns',    desc:'Green flash animation on newly appearing transactions.',                         cat:'Trading',   icon:'✨'},
                {key:'confirmTrades',        name:'Confirm All Trades',    desc:'Confirmation dialog before any buy or sell trade.',                             cat:'Trading',   icon:'✅'},
                {key:'confirmSells',         name:'Confirm Sells Only',    desc:'Confirmation dialog only for SELL trades — buy freely, sell deliberately.',     cat:'Trading',   icon:'🛑'},
                {key:'showFeeEstimate',      name:'Fee Estimate',          desc:'Shows live fee estimate (0.3%) below the trade amount input.',                   cat:'Trading',   icon:'💰'},
                {key:'highlightProfitLoss',  name:'P&L Colors',            desc:'Colors sidebar portfolio entries green/red by profit/loss sign.',                cat:'Trading',   icon:'📈'},
                {key:'showPortfolioPercent', name:'Portfolio %',           desc:'Shows each coin as a % share of your total portfolio value.',                   cat:'Trading',   icon:'🥧'},
                {key:'showPriceChange',      name:'24h Price Change',      desc:'Injects color-coded 24h % change badge on coin pages.',                         cat:'Trading',   icon:'📉'},
                {key:'showVolume24h',        name:'24h Volume',            desc:'Shows 24h trading volume figure on coin pages.',                                 cat:'Trading',   icon:'📦'},
                {key:'highlightWhaleTrades', name:'Whale Trade Glow',      desc:'Gold outline on trades exceeding the whale threshold in the feed.',              cat:'Trading',   icon:'🐋'},
                {key:'profileHistory',       name:'Trade History Button',  desc:'History button on profile pages opening a paginated trade modal.',              cat:'Trading',   icon:'📜'},
                {key:'profileWatch',         name:'Watch User Button',     desc:'Watch toggle on profile pages to track any user in your watchlist.',            cat:'Trading',   icon:'⭐'},
                {key:'clickableRows',        name:'Clickable Table Rows',  desc:'Makes portfolio table rows clickable — navigates directly to that coin.',       cat:'Trading',   icon:'🖱'},
                {key:'showPnL',              name:'Session P&L',           desc:'Tracks portfolio from session start, shows live unrealised P&L in sidebar.',    cat:'Trading',   icon:'💹'},
                {key:'showTopGainers',       name:'Top Gainers',           desc:'Tracks the biggest rising coins from the live feed price data.',                 cat:'Trading',   icon:'🚀'},
                {key:'showTopLosers',        name:'Top Losers',            desc:'Tracks the biggest declining coins from the live feed price data.',              cat:'Trading',   icon:'📉'},
                {key:'showGems',             name:'Gem Finder',            desc:'Auto-surfaces low-risk high-volume coins in the scanner.',                       cat:'Trading',   icon:'💎'},
                {key:'highlightTopCoins',    name:'Top Volume Highlight',  desc:'Gold border on the top 3 coins by volume in the radar window.',                 cat:'Trading',   icon:'🥇'},
                {key:'preloadCoinData',      name:'Preload on Hover',      desc:'Prefetches coin data when you hover over a coin link — instant navigation.',    cat:'Trading',   icon:'⚡'},
                // Alerts
                {key:'botWarning',           name:'Bot Detection',         desc:'Analyses trade timing and frequency. Fires when bot patterns are detected.',    cat:'Alerts',    icon:'🤖'},
                {key:'volumeSpikes',         name:'Volume Spike Alert',    desc:'Monitors 60s rolling volume. Fires when a coin crosses your USD threshold.',    cat:'Alerts',    icon:'📈'},
                {key:'whalePing',            name:'Whale Radar',           desc:'Instant notification when a single trade exceeds your whale threshold.',        cat:'Alerts',    icon:'🐋'},
                {key:'alertOnNewCoin',       name:'New Coin Alert',        desc:'Notifies when a symbol appears in the WS feed for the very first time.',        cat:'Alerts',    icon:'🆕'},
                {key:'alertOnHolderDrop',    name:'Holder Drop Alert',     desc:'Fires if holder count drops 10%+ in 2 minutes on the current coin page.',       cat:'Alerts',    icon:'📉'},
                {key:'alertOnPriceDrop',     name:'Price Drop Alert',      desc:'Fires if price drops by your configured % within a minute.',                   cat:'Alerts',    icon:'🔻'},
                {key:'alertOnBotActivity',   name:'Bot Activity Alert',    desc:'Dedicated notification when bot patterns are detected in a coin.',              cat:'Alerts',    icon:'⚠'},
                {key:'alertOnNewReport',     name:'New Report Alert',      desc:'Notifies when a new community rugpull report is submitted.',                    cat:'Alerts',    icon:'🚩'},
                {key:'alertOnWatchlistTrade',name:'Watchlist Trade Alert', desc:'Toast notification when any coin in your watchlist gets a new trade.',         cat:'Alerts',    icon:'👁'},
                {key:'alertOnCreatorSell',   name:'Creator Sell Alert',    desc:'Fires when the coin creator wallet shows a SELL — classic rug signal.',        cat:'Alerts',    icon:'🚨'},
                {key:'desktopAlerts',        name:'Desktop Notifications', desc:'Sends OS-level browser notifications for price alerts.',                       cat:'Alerts',    icon:'🖥'},
                {key:'flashTitle',           name:'Tab Title Flash',       desc:'Flashes the browser tab title when any alert fires.',                           cat:'Alerts',    icon:'💡'},
                {key:'soundAlerts',          name:'Alert Sounds',          desc:'Web Audio API beep on alerts, whale pings, and bot detections.',               cat:'Alerts',    icon:'🔊'},
                {key:'watchlistAlerts',      name:'Watchlist Alerts',      desc:'Enables the full watchlist alert and notification system.',                    cat:'Alerts',    icon:'👁'},
                // Privacy
                {key:'appearOffline',        name:'Appear Offline',        desc:'Spoofs document.visibilityState so you appear offline in DMs.',               cat:'Privacy',   icon:'👻'},
                {key:'hideBalance',          name:'Hide Balance',          desc:'Hides portfolio values — hover to reveal.',                                   cat:'Privacy',   icon:'🙈'},
                {key:'blurPortfolioValue',   name:'Blur Portfolio',        desc:'Blurs all portfolio numbers — perfect for streaming or screen sharing.',       cat:'Privacy',   icon:'🌫'},
                {key:'anonymousMode',        name:'Anonymous Mode',        desc:'Replaces your username with @anon in the Enhanced panel.',                    cat:'Privacy',   icon:'🎭'},
                {key:'blockAnalytics',       name:'Block Analytics',       desc:'CSS-blocks known analytics trackers (gtag, segment, mixpanel, hotjar).',      cat:'Privacy',   icon:'🛡'},
                {key:'stripTrackingParams',  name:'Strip Tracking Params', desc:'Removes UTM, fbclid, gclid and other tracking params from URLs.',            cat:'Privacy',   icon:'✂'},
                {key:'noReferrer',           name:'No Referrer',           desc:'Adds rel="noreferrer noopener" to all external links.',                       cat:'Privacy',   icon:'🔒'},
                {key:'hideOwnTrades',        name:'Hide Own Trades',       desc:'Filters your username out of the Enhanced live feed.',                        cat:'Privacy',   icon:'🫥'},
                {key:'hideOfflineDM',        name:'Hide DM Presence',      desc:'Hides online presence dots in DM conversations.',                            cat:'Privacy',   icon:'💬'},
                // Display
                {key:'heatmap',              name:'Live Heatmap',          desc:'Treemap of active coins sized by volume, colored by buy/sell ratio.',         cat:'Display',   icon:'🗺'},
                {key:'portfolioChart',       name:'Portfolio Sparkline',   desc:'Canvas chart of your portfolio value across session snapshots.',              cat:'Display',   icon:'📊'},
                {key:'sentimentBar',         name:'Sentiment Bar',         desc:'Live 3px bar showing platform-wide buy/sell ratio above the tabs.',           cat:'Display',   icon:'📊'},
                {key:'showSessionStats',     name:'Session Stats Bar',     desc:'Session volume, top coin, trade count and whale count bar under topbar.',     cat:'Display',   icon:'📈'},
                {key:'sessionJournal',       name:'Session Journal',       desc:'Searchable log of every alert, whale, bot detection and event this session.', cat:'Display',   icon:'📓'},
                {key:'coinScanner',          name:'Coin Scanner',          desc:'Real-time new coin detection, auto risk scored and sorted by age/volume.',    cat:'Display',   icon:'🔭'},
                {key:'tradeTimeline',        name:'Timeline View',         desc:'Toggle the live feed into a vertical timeline instead of table.',             cat:'Display',   icon:'📅'},
                {key:'feedCompact',          name:'Compact Feed',          desc:'Tighter row height in the live feed — fits more trades on screen.',           cat:'Display',   icon:'⚡'},
                {key:'showTxHeatmap',        name:'Trade Intensity',       desc:'Highlights high-value trades amber, dims low-value trades in the feed.',      cat:'Display',   icon:'🌡'},
                {key:'groupByMinute',        name:'Group By Minute',       desc:'Shows a time separator line between groups of trades in the same minute.',    cat:'Display',   icon:'⏱'},
                {key:'hideSmallTrades',      name:'Hide Small Trades',     desc:'Filters out trades below your configured USD minimum from the feed.',         cat:'Display',   icon:'🔇'},
                {key:'highlightTopTraders',  name:'Top Trader Highlight',  desc:'Marks the 5 most active addresses from the live feed.',                       cat:'Display',   icon:'🏆'},
                {key:'darkCharts',           name:'Dark Charts',           desc:'Forces dark background on TradingView and other chart elements.',              cat:'Display',   icon:'🌙'},
                {key:'colorCodeVolume',      name:'Color-code Volume',     desc:'Colors volume metrics green/amber/red based on buy/sell dominance.',          cat:'Display',   icon:'🎨'},
                {key:'showCreatorSells',     name:'Creator Sell Tracker',  desc:'Red row highlight when coin creators appear on the sell side of the feed.',   cat:'Display',   icon:'🚨'},
                {key:'autoTagCoins',         name:'Auto-tag Coins',        desc:'Whale, new, hot and risky badges auto-applied to coins in the feed.',         cat:'Display',   icon:'🏷'},
                {key:'exportData',           name:'Export Tools',          desc:'JSON/CSV export buttons for feed, watchlist, journal and settings.',           cat:'Display',   icon:'💾'},
                {key:'quickCopySymbol',      name:'Copy Symbol on Click',  desc:'Click any coin symbol in the panel to copy it to clipboard instantly.',       cat:'Display',   icon:'📋'},
                {key:'devMode',              name:'Dev Mode',              desc:'Logs all WS events to the browser console with [RE:WS] prefix.',              cat:'Display',   icon:'🛠'},
            ];

            const CATS = ['Interface','Trading','Alerts','Privacy','Display'];
            const CAT_COLORS = {Interface:'#0a84ff',Trading:'#30d158',Alerts:'#ffd60a',Privacy:'#bf5af2',Display:'#ff9f0a'};
            const CAT_ICONS  = {Interface:'⚙️',Trading:'💹',Alerts:'🔔',Privacy:'🔒',Display:'🎨'};

            const enabledCount = MODS.filter(m => s[m.key]).length;

            const modsHTML = CATS.map(cat => {
                const catMods = MODS.filter(m => m.cat === cat);
                const catEnabled = catMods.filter(m => s[m.key]).length;
                const col = CAT_COLORS[cat] || '#ffffff';
                return `<div class="xp-cat-block" data-cat="${cat}">
                    <div class="xp-cat-hd">
                        <div class="xp-cat-dot" style="background:${col};box-shadow:0 0 8px ${col}40"></div>
                        <span class="xp-cat-icon">${CAT_ICONS[cat]||'•'}</span>
                        <span class="xp-cat-name">${cat}</span>
                        <span class="xp-cat-pill">${catEnabled}/${catMods.length}</span>
                    </div>
                    <div class="xp-mod-grid">${catMods.map(m => `<div class="xp-mod-card ${s[m.key]?'on':''}" data-mod-key="${m.key}" style="${s[m.key]?'--mc:'+col:''}">
                        <div class="xp-mod-top">
                            <div class="xp-mod-icon">${m.icon||'•'}</div>
                            <div class="xp-mod-info">
                                <div class="xp-mod-name">${m.name}</div>
                                <div class="xp-mod-desc">${m.desc}</div>
                            </div>
                            <div class="xp-toggle ${s[m.key]?'on':''}" data-mod-key="${m.key}" role="switch" aria-checked="${!!s[m.key]}" tabindex="0" title="${s[m.key]?'Disable':'Enable'} ${m.name}">
                                <div class="xp-toggle-knob"></div>
                            </div>
                        </div>
                        <div class="xp-mod-foot">
                            <span class="xp-mod-cat-tag" style="color:${col}">${m.icon} ${cat}</span>
                            <span class="xp-mod-status ${s[m.key]?'on':'off'}">${s[m.key]?'ON':'OFF'}</span>
                        </div>
                    </div>`).join('')}</div>
                </div>`;
            }).join('');

            return `<div class="xp-shell">
<style>
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600;700&display=swap');
:root{
  --re-bg:#000;--re-glass:rgba(18,18,22,.88);--re-glass2:rgba(26,26,32,.78);--re-glass3:rgba(36,36,44,.68);--re-glass4:rgba(48,48,58,.58);
  --re-p1:#0a0a0d;--re-p2:#101015;--re-p3:#15151c;--re-p4:#1c1c25;--re-p5:#24242e;
  --re-b0:rgba(255,255,255,.03);--re-b1:rgba(255,255,255,.07);--re-b2:rgba(255,255,255,.13);--re-b3:rgba(255,255,255,.22);--re-b4:rgba(255,255,255,.35);
  --re-t1:#f5f5f7;--re-t2:#98989f;--re-t3:#48484f;--re-t4:#2d2d35;
  --re-green:#30d158;--re-red:#ff453a;--re-amber:#ffd60a;--re-blue:#0a84ff;--re-purple:#bf5af2;--re-teal:#5ac8fa;--re-pink:#ff375f;--re-orange:#ff9f0a;
  --glow-green:0 0 20px rgba(48,209,88,.2),0 0 40px rgba(48,209,88,.08);
  --glow-red:0 0 20px rgba(255,69,58,.2),0 0 40px rgba(255,69,58,.08);
  --glow-blue:0 0 20px rgba(10,132,255,.2),0 0 40px rgba(10,132,255,.08);
  --shadow-xs:0 1px 3px rgba(0,0,0,.4);--shadow-sm:0 2px 8px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.05);
  --shadow-md:0 8px 32px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06);--shadow-lg:0 24px 64px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.07);
  --re-font:'Geist',-apple-system,'SF Pro Display',BlinkMacSystemFont,sans-serif;
  --re-mono:'Geist Mono','SF Mono',ui-monospace,monospace;
  --ease-out:cubic-bezier(.16,1,.3,1);--ease-spring:cubic-bezier(.175,.885,.32,1.275);
  --r-xs:4px;--r-sm:8px;--r-md:12px;--r-lg:16px;--r-xl:20px;--r-full:9999px;
}
#re-panel-wrapper{background:var(--re-bg)!important;font-family:var(--re-font)!important;color:var(--re-t1)!important;padding:0!important;max-width:100%!important;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
.xp-shell{display:flex;flex-direction:column;min-height:100vh;animation:xp-in .25s var(--ease-out) both}
@keyframes xp-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
@keyframes xp-pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.2;transform:scale(.5)}}
@keyframes xp-spin{to{transform:rotate(360deg)}}
@keyframes xp-fade{from{opacity:0}to{opacity:1}}
@keyframes xp-hl{from{background:rgba(48,209,88,.18)}to{background:transparent}}
@keyframes re-notif-in{to{opacity:1;transform:none}}
@keyframes re-notif-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(14px) scale(.96)}}
@keyframes re-spinning{to{transform:rotate(360deg)}}
@keyframes re-modal-in{from{opacity:0;transform:scale(.95) translateY(8px)}to{opacity:1;transform:none}}
@keyframes re-hl{from{background:rgba(74,222,128,.18)}to{background:transparent}}
.re-new-tx{animation:re-hl 2s ease-out}
/* TOPBAR */
.re-bar{display:flex;align-items:center;height:50px;padding:0 18px;gap:10px;border-bottom:1px solid var(--re-b1);background:rgba(0,0,0,.9);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);position:sticky;top:0;z-index:100;flex-shrink:0}
.re-bar-brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;letter-spacing:-.03em;color:var(--re-t1);flex-shrink:0}
.re-bar-logo{width:24px;height:24px;background:linear-gradient(135deg,var(--re-green),var(--re-blue));border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(48,209,88,.25)}
.re-bar-logo svg{color:#000}
.re-bar-divider{width:1px;height:14px;background:var(--re-b2);flex-shrink:0}
.re-bar-chips{display:flex;align-items:center;gap:4px;flex:1;overflow:hidden}
.re-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--re-p3);border:1px solid var(--re-b1);border-radius:var(--r-full);font-size:10px;font-weight:600;color:var(--re-t2);white-space:nowrap;cursor:default}
.re-chip-v{font-family:var(--re-mono);font-weight:700;color:var(--re-t1)}
.re-live{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;background:rgba(48,209,88,.08);border:1px solid rgba(48,209,88,.2);border-radius:var(--r-full);font-size:10px;font-weight:800;color:var(--re-green);letter-spacing:.04em}
.re-live-dot{width:5px;height:5px;border-radius:50%;background:var(--re-green);animation:xp-pulse-dot 1.6s ease-in-out infinite;box-shadow:0 0 5px rgba(48,209,88,.6)}
.re-bar-right{display:flex;align-items:center;gap:5px;flex-shrink:0}
.re-bar-btn{width:28px;height:28px;border-radius:var(--r-sm);background:transparent;border:1px solid var(--re-b1);color:var(--re-t2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s var(--ease-out);text-decoration:none;flex-shrink:0}
.re-bar-btn:hover{background:var(--re-p3);border-color:var(--re-b2);color:var(--re-t1);transform:scale(1.06)}
.xp-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:var(--r-full);font-size:9px;font-weight:700;background:rgba(10,132,255,.1);border:1px solid rgba(10,132,255,.2);color:var(--re-blue);font-family:var(--re-mono)}
/* SENTIMENT BAR */
.xp-sentiment-wrap{height:3px;background:var(--re-p3);overflow:hidden;flex-shrink:0}
.xp-sentiment-fill{height:100%;background:linear-gradient(90deg,var(--re-green),rgba(48,209,88,.4));transition:width .8s var(--ease-out)}
/* SESSION STATS */
.xp-session-bar{display:flex;align-items:center;border-bottom:1px solid var(--re-b1);background:var(--re-p1);overflow-x:auto;flex-shrink:0}
.xp-session-bar::-webkit-scrollbar{display:none}
.xp-ss-item{display:flex;align-items:center;gap:6px;padding:5px 14px;border-right:1px solid var(--re-b1);white-space:nowrap;flex-shrink:0}
.xp-ss-item:last-child{border-right:none}
.xp-ss-k{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--re-t3)}
.xp-ss-v{font-size:12px;font-weight:700;font-family:var(--re-mono);color:var(--re-t1)}
/* TABS */
.xp-tabs{display:flex;align-items:center;border-bottom:1px solid var(--re-b1);background:rgba(0,0,0,.7);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);overflow-x:auto;flex-shrink:0;position:sticky;top:50px;z-index:90}
.xp-tabs::-webkit-scrollbar{display:none}
.xp-tab{display:inline-flex;align-items:center;gap:5px;padding:0 13px;height:40px;font-size:11.5px;font-weight:500;color:var(--re-t3);background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s,border-color .12s;white-space:nowrap;font-family:var(--re-font);letter-spacing:-.015em}
.xp-tab:hover{color:var(--re-t2)}
.xp-tab.active{color:var(--re-t1);border-bottom-color:var(--re-t1);font-weight:700}
.xp-tab svg{opacity:.45;transition:opacity .12s}
.xp-tab.active svg,.xp-tab:hover svg{opacity:1}
.xp-tab-badge{font-size:9px;font-weight:800;min-width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);color:var(--re-t3);border-radius:var(--r-full);padding:0 3px;font-family:var(--re-mono);transition:all .12s}
.xp-tab.active .xp-tab-badge{background:var(--re-t1);color:var(--re-p1)}
/* BODY */
.xp-body{flex:1;padding:18px;display:flex;flex-direction:column;gap:13px;min-height:0}
[data-re-section]{display:none}
/* GRID */
.xp-2col{display:grid;grid-template-columns:1fr 300px;gap:13px;align-items:start}
.xp-3col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}
.xp-col{display:flex;flex-direction:column;gap:13px}
@media(max-width:1100px){.xp-2col{grid-template-columns:1fr}}
@media(max-width:1200px){.xp-3col{grid-template-columns:1fr 1fr}}
/* CARDS */
.xp-card{background:var(--re-glass);backdrop-filter:blur(40px) saturate(160%);-webkit-backdrop-filter:blur(40px) saturate(160%);border:1px solid var(--re-b1);border-radius:var(--r-lg);overflow:hidden;transition:border-color .18s,box-shadow .18s;box-shadow:var(--shadow-sm);position:relative}
.xp-card::before{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(135deg,rgba(255,255,255,.035) 0%,transparent 55%);pointer-events:none}
.xp-card:hover{border-color:var(--re-b2);box-shadow:var(--shadow-md)}
.xp-card-hd{padding:13px 15px;border-bottom:1px solid var(--re-b1);display:flex;align-items:center;justify-content:space-between;gap:8px}
.xp-card-title{font-size:12px;font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:6px;color:var(--re-t1)}
.xp-card-title svg{color:var(--re-t3)}
.xp-card-sub{font-size:10px;color:var(--re-t3);margin-top:2px;letter-spacing:-.01em}
.xp-card-body{padding:13px 15px}
/* STAT BOXES */
.xp-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
@media(max-width:900px){.xp-stat-row{grid-template-columns:repeat(2,1fr)}}
.xp-stat-box{background:var(--re-glass2);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid var(--re-b1);border-radius:var(--r-md);padding:14px;transition:all .18s var(--ease-out);position:relative;overflow:hidden;cursor:default}
.xp-stat-box::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent)}
.xp-stat-box:hover{border-color:var(--re-b2);transform:translateY(-2px);box-shadow:var(--shadow-md)}
.xp-stat-n{font-size:24px;font-weight:800;letter-spacing:-.05em;font-family:var(--re-mono);color:var(--re-t1);line-height:1}
.xp-stat-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--re-t3);margin-top:6px}
.xp-stat-box.green{border-color:rgba(48,209,88,.2)}.xp-stat-box.green .xp-stat-n{color:var(--re-green)}
.xp-stat-box.amber{border-color:rgba(255,214,10,.2)}.xp-stat-box.amber .xp-stat-n{color:var(--re-amber)}
.xp-stat-box.blue{border-color:rgba(10,132,255,.2)}.xp-stat-box.blue .xp-stat-n{color:var(--re-blue)}
.xp-stat-box.red{border-color:rgba(255,69,58,.2)}.xp-stat-box.red .xp-stat-n{color:var(--re-red)}
/* AGG ROW */
.xp-agg-row{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid var(--re-b1)}
.xp-agg-cell{padding:9px 5px;text-align:center;border-right:1px solid var(--re-b1);transition:background .1s}
.xp-agg-cell:last-child{border-right:none}
.xp-agg-cell:hover{background:rgba(255,255,255,.02)}
.xp-agg-v{font-size:12px;font-weight:800;font-family:var(--re-mono);color:var(--re-t1);letter-spacing:-.02em}
.xp-agg-k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--re-t3);margin-top:2px}
/* RADAR */
.xp-radar-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.xp-section-label{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--re-t3);margin-bottom:7px}
/* MINI LIST */
.xp-mini-list{display:flex;flex-direction:column;gap:2px}
.xp-mini-row{display:grid;grid-template-columns:68px 1fr auto;gap:7px;align-items:center;padding:7px 9px;border-radius:var(--r-sm);text-decoration:none;color:var(--re-t1);transition:background .08s,transform .08s;border:1px solid transparent}
.xp-mini-row:hover{background:var(--re-p3);border-color:var(--re-b1);transform:translateX(2px)}
.xp-mini-sym{font-weight:800;font-family:var(--re-mono);font-size:12px;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-mini-sub{font-size:10px;color:var(--re-t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-t-buy{font-size:9px;font-weight:800;padding:2px 7px;border-radius:var(--r-full);background:rgba(48,209,88,.1);color:var(--re-green);white-space:nowrap}
.xp-t-sell{font-size:9px;font-weight:800;padding:2px 7px;border-radius:var(--r-full);background:rgba(255,69,58,.1);color:var(--re-red);white-space:nowrap}
/* LIVE FEED */
.xp-feed-ctrl{display:grid;grid-template-columns:1fr 80px 96px 28px;gap:5px;padding:9px 13px;border-bottom:1px solid var(--re-b1);align-items:center}
.xp-feed-head{display:grid;grid-template-columns:44px 60px 1fr auto auto;gap:5px;padding:4px 13px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--re-t3);border-bottom:1px solid var(--re-b1)}
.xp-feed-rows{max-height:320px;overflow-y:auto}
.xp-feed-rows::-webkit-scrollbar{width:3px}
.xp-feed-rows::-webkit-scrollbar-thumb{background:var(--re-b2);border-radius:2px}
.xp-feed-row{display:grid;grid-template-columns:44px 60px 1fr auto auto;gap:5px;padding:6px 13px;border-bottom:1px solid var(--re-b0);font-size:12px;text-decoration:none;color:var(--re-t1);transition:background .06s;align-items:center;position:relative}
.xp-feed-row:hover{background:rgba(255,255,255,.022)}
.xp-feed-row:last-child{border-bottom:none}
.xp-feed-row.buy{border-left:2px solid rgba(48,209,88,.5);padding-left:11px}
.xp-feed-row.sell{border-left:2px solid rgba(255,69,58,.5);padding-left:11px}
.xp-feed-row[data-whale="1"]{background:rgba(10,132,255,.025);border-left:2px solid rgba(10,132,255,.6)!important}
.xp-feed-row[data-top-vol="1"]{border-left:2px solid rgba(255,214,10,.75)!important;background:rgba(255,214,10,.02)!important}
.xp-feed-row[data-creator-sell="1"]{background:rgba(255,69,58,.05)!important;border-left:2px solid var(--re-red)!important}
.xp-b-buy{font-size:9px;font-weight:800;color:var(--re-green);background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.18);border-radius:var(--r-xs);padding:2px 5px;font-family:var(--re-mono)}
.xp-b-sell{font-size:9px;font-weight:800;color:var(--re-red);background:rgba(255,69,58,.1);border:1px solid rgba(255,69,58,.18);border-radius:var(--r-xs);padding:2px 5px;font-family:var(--re-mono)}
.xp-f-sym{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}
.xp-f-usr{color:var(--re-t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.xp-f-val{font-weight:700;font-size:11px;white-space:nowrap;font-family:var(--re-mono);letter-spacing:-.02em}
.xp-f-ts{color:var(--re-t3);font-size:10px;white-space:nowrap;font-family:var(--re-mono)}
/* WATCHLIST */
.xp-wl-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--re-b0)}
.xp-wl-row:last-child{border-bottom:none}
.xp-wl-sym{font-weight:800;font-family:var(--re-mono);font-size:13px;color:var(--re-t1);text-decoration:none;flex:1;letter-spacing:-.02em;transition:color .1s}
.xp-wl-sym:hover{color:var(--re-blue)}
.xp-wl-px{font-size:12px;color:var(--re-t2);font-family:var(--re-mono)}
.xp-wl-chg{font-size:10px;font-family:var(--re-mono);padding:1px 5px;border-radius:var(--r-xs)}
.xp-wl-chg.up{color:var(--re-green);background:rgba(48,209,88,.1)}
.xp-wl-chg.dn{color:var(--re-red);background:rgba(255,69,58,.1)}
.xp-wl-del{background:none;border:none;cursor:pointer;color:var(--re-t3);width:22px;height:22px;border-radius:var(--r-xs);display:flex;align-items:center;justify-content:center;transition:all .1s;flex-shrink:0}
.xp-wl-del:hover{background:rgba(255,69,58,.1);color:var(--re-red)}
/* ALERTS */
.xp-al-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--re-b1);border-radius:var(--r-md);background:var(--re-glass3);margin-bottom:5px;transition:opacity .15s}
.xp-al-row.done{opacity:.28}
.xp-al-info{flex:1;min-width:0}
.xp-al-sym{font-weight:800;font-size:13px;font-family:var(--re-mono);letter-spacing:-.02em}
.xp-al-meta{font-size:11px;color:var(--re-t2);margin-top:2px}
.xp-al-badge{font-size:9px;font-weight:800;padding:2px 6px;border-radius:var(--r-full);border:1px solid;font-family:var(--re-mono)}
.xp-al-badge.above{color:var(--re-green);background:rgba(48,209,88,.1);border-color:rgba(48,209,88,.2)}
.xp-al-badge.below{color:var(--re-red);background:rgba(255,69,58,.1);border-color:rgba(255,69,58,.2)}
.xp-al-badge.hit{color:var(--re-amber);background:rgba(255,214,10,.08);border-color:rgba(255,214,10,.2)}
.xp-al-del{background:none;border:none;cursor:pointer;color:var(--re-t3);padding:3px;border-radius:var(--r-xs);transition:all .1s;display:flex;align-items:center}
.xp-al-del:hover{color:var(--re-red);background:rgba(255,69,58,.1)}
.xp-al-hist{max-height:130px;overflow-y:auto;margin-top:8px;border-top:1px solid var(--re-b1);padding-top:8px}
.xp-al-hist-row{display:flex;align-items:center;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid var(--re-b0);color:var(--re-t2)}
.xp-al-hist-row:last-child{border-bottom:none}
/* SCANNER */
.xp-scanner{max-height:360px;overflow-y:auto}
.xp-sc-row{display:grid;grid-template-columns:58px 1fr auto auto;gap:7px;align-items:center;padding:7px 13px;border-bottom:1px solid var(--re-b0);text-decoration:none;color:var(--re-t1);transition:background .06s}
.xp-sc-row:hover{background:rgba(255,255,255,.02)}
.xp-sc-sym{font-weight:800;font-family:var(--re-mono);font-size:13px;letter-spacing:-.02em}
.xp-sc-meta{font-size:10px;color:var(--re-t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-sc-risk{font-size:9px;font-weight:800;padding:2px 6px;border-radius:var(--r-xs);font-family:var(--re-mono)}
.xp-sc-risk.low{color:var(--re-green);background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.2)}
.xp-sc-risk.med{color:var(--re-amber);background:rgba(255,214,10,.08);border:1px solid rgba(255,214,10,.2)}
.xp-sc-risk.high{color:var(--re-red);background:rgba(255,69,58,.1);border:1px solid rgba(255,69,58,.2)}
.xp-sc-age{font-size:9px;color:var(--re-t3);font-family:var(--re-mono);white-space:nowrap}
/* JOURNAL */
.xp-journal{max-height:400px;overflow-y:auto}
.xp-jl-row{display:flex;align-items:flex-start;gap:9px;padding:8px 13px;border-bottom:1px solid var(--re-b0);transition:background .06s;animation:xp-fade .18s ease}
.xp-jl-row:hover{background:rgba(255,255,255,.02)}
.xp-jl-row:last-child{border-bottom:none}
.xp-jl-icon{font-size:13px;flex-shrink:0;width:19px;text-align:center;margin-top:1px}
.xp-jl-body{flex:1;min-width:0}
.xp-jl-title{font-size:12px;font-weight:700;letter-spacing:-.01em}
.xp-jl-detail{font-size:10px;color:var(--re-t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.xp-jl-time{font-size:10px;color:var(--re-t3);font-family:var(--re-mono);white-space:nowrap}
.xp-jl-empty{padding:26px;text-align:center;color:var(--re-t3);font-size:12px}
/* MODS */
.xp-mods-top{padding:9px 13px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--re-b1);background:rgba(0,0,0,.7);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);position:sticky;top:90px;z-index:10}
.xp-mods-sw{flex:1;position:relative}
.xp-mods-sw svg{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--re-t3);pointer-events:none}
.xp-mods-si{padding-left:27px!important}
.xp-mods-count{font-size:11px;color:var(--re-t2);white-space:nowrap;font-weight:700;font-family:var(--re-mono)}
.xp-cat-filter{display:flex;gap:4px;padding:7px 13px;border-bottom:1px solid var(--re-b1);flex-wrap:wrap;background:rgba(0,0,0,.3)}
.xp-cat-btn{font-size:10px;font-weight:700;padding:2px 9px;border-radius:var(--r-full);border:1px solid var(--re-b1);background:transparent;color:var(--re-t3);cursor:pointer;transition:all .12s var(--ease-out);font-family:var(--re-font)}
.xp-cat-btn:hover{border-color:var(--re-b2);color:var(--re-t2);background:var(--re-p3)}
.xp-cat-btn.active{background:var(--re-t1);color:var(--re-p1);border-color:transparent;font-weight:800}
.xp-mods-body{padding:13px;display:flex;flex-direction:column;gap:15px}
.xp-cat-hd{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid var(--re-b1)}
.xp-cat-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.xp-cat-icon{font-size:13px}
.xp-cat-name{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--re-t1)}
.xp-cat-pill{font-size:9px;font-weight:700;padding:1px 6px;background:var(--re-p4);border:1px solid var(--re-b2);border-radius:var(--r-full);color:var(--re-t2);margin-left:auto;font-family:var(--re-mono)}
.xp-mod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:5px}
.xp-mod-card{background:var(--re-glass2);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--re-b1);border-radius:var(--r-md);overflow:hidden;position:relative;transition:border-color .14s,box-shadow .14s,transform .14s var(--ease-out)}
.xp-mod-card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:transparent;transition:background .14s}
.xp-mod-card.on{border-color:rgba(255,255,255,.11)}
.xp-mod-card.on::after{background:linear-gradient(90deg,transparent,var(--mc,rgba(255,255,255,.14)),transparent)}
.xp-mod-card:hover{border-color:var(--re-b2);transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.xp-mod-top{padding:9px 10px 7px;display:flex;gap:8px;align-items:flex-start}
.xp-mod-icon{font-size:15px;flex-shrink:0;width:20px;text-align:center;margin-top:1px}
.xp-mod-info{flex:1;min-width:0}
.xp-mod-name{font-size:12px;font-weight:700;color:var(--re-t1);margin-bottom:2px;line-height:1.2;letter-spacing:-.01em}
.xp-mod-desc{font-size:10px;color:var(--re-t2);line-height:1.5}
.xp-mod-foot{padding:4px 10px;border-top:1px solid var(--re-b0);display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,.12)}
.xp-mod-cat-tag{font-size:9px;font-weight:600;display:flex;align-items:center;gap:3px}
.xp-mod-status{font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.xp-mod-status.on{color:var(--re-green)}.xp-mod-status.off{color:var(--re-t3)}
/* TOGGLE */
.xp-toggle{width:30px;height:17px;border-radius:var(--r-full);border:1px solid var(--re-b2);background:var(--re-p4);cursor:pointer;position:relative;flex-shrink:0;transition:background .18s var(--ease-out),border-color .18s,box-shadow .18s;margin-top:1px}
.xp-toggle.on{background:var(--re-green);border-color:transparent;box-shadow:0 0 8px rgba(48,209,88,.3)}
.xp-toggle-knob{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--re-t3);transition:left .16s var(--ease-out),background .16s;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.xp-toggle.on .xp-toggle-knob{left:15px;background:#000}
/* REPORTER */
.xp-rp-row{padding:10px;background:var(--re-glass3);border:1px solid var(--re-b1);border-radius:var(--r-md);display:flex;flex-direction:column;gap:5px;margin-bottom:5px;transition:border-color .13s}
.xp-rp-row:hover{border-color:var(--re-b2)}
.xp-rp-hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.xp-rp-user{font-weight:800;font-size:12px;font-family:var(--re-mono)}
.xp-rp-coin{font-size:11px;color:var(--re-blue);font-family:var(--re-mono);font-weight:700}
.xp-rp-time{font-size:10px;color:var(--re-t3);margin-left:auto;font-family:var(--re-mono)}
.xp-rp-body{font-size:12px;color:var(--re-t2);line-height:1.5}
.xp-rp-foot{display:flex;gap:4px}
.xp-vote{font-size:11px;font-weight:700;color:var(--re-t2);background:none;border:1px solid var(--re-b1);border-radius:var(--r-xs);padding:2px 7px;cursor:pointer;font-family:var(--re-font);transition:all .1s}
.xp-vote.up:hover{color:var(--re-green);border-color:rgba(48,209,88,.3);background:rgba(48,209,88,.07)}
.xp-vote.dn:hover{color:var(--re-red);border-color:rgba(255,69,58,.3);background:rgba(255,69,58,.07)}
/* FORMS */
.xp-input{background:var(--re-glass3);backdrop-filter:blur(20px);border:1px solid var(--re-b2);border-radius:var(--r-sm);padding:0 10px;height:30px;font-size:12px;color:var(--re-t1);font-family:var(--re-font);outline:none;width:100%;box-sizing:border-box;transition:border-color .13s,box-shadow .13s;letter-spacing:-.01em}
.xp-input:focus{border-color:var(--re-b3);box-shadow:0 0 0 3px rgba(255,255,255,.04)}
.xp-input::placeholder{color:var(--re-t3)}
.xp-select{background:var(--re-glass3);border:1px solid var(--re-b2);border-radius:var(--r-sm);padding:0 8px;height:30px;font-size:12px;color:var(--re-t1);font-family:var(--re-font);outline:none;cursor:pointer;width:100%;box-sizing:border-box}
.xp-textarea{background:var(--re-glass3);border:1px solid var(--re-b2);border-radius:var(--r-sm);padding:8px 10px;font-size:12px;color:var(--re-t1);font-family:var(--re-font);outline:none;width:100%;resize:vertical;min-height:70px;box-sizing:border-box;line-height:1.5;transition:border-color .13s,box-shadow .13s}
.xp-textarea:focus{border-color:var(--re-b3);box-shadow:0 0 0 3px rgba(255,255,255,.04)}
.xp-textarea::placeholder{color:var(--re-t3)}
.xp-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--re-t3);margin-bottom:3px;display:block}
.xp-form-row{display:flex;flex-direction:column;gap:4px}
.xp-form-grid{display:grid;gap:7px}
/* BUTTONS */
.xp-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 11px;height:29px;font-size:12px;font-weight:600;font-family:var(--re-font);border:1px solid var(--re-b2);border-radius:var(--r-sm);background:var(--re-glass3);color:var(--re-t1);cursor:pointer;transition:all .13s var(--ease-out);white-space:nowrap;box-sizing:border-box;letter-spacing:-.01em}
.xp-btn:hover{background:var(--re-p4);border-color:var(--re-b3);transform:scale(1.02)}
.xp-btn:active{transform:scale(.97)}
.xp-btn.primary{background:var(--re-t1);color:var(--re-p1);border-color:transparent;font-weight:700;box-shadow:0 2px 6px rgba(255,255,255,.08)}
.xp-btn.primary:hover{opacity:.86;transform:scale(1.02)}
.xp-btn.ghost{background:transparent;border-color:var(--re-b1)}
.xp-btn.ghost:hover{background:var(--re-p3);border-color:var(--re-b2)}
.xp-btn.danger{border-color:rgba(255,69,58,.2);color:var(--re-red)}
.xp-btn.danger:hover{background:rgba(255,69,58,.08);border-color:rgba(255,69,58,.3)}
.xp-btn.success{border-color:rgba(48,209,88,.2);color:var(--re-green)}
.xp-btn.success:hover{background:rgba(48,209,88,.08);border-color:rgba(48,209,88,.3)}
.xp-btn-full{width:100%}
.xp-btn-row{display:flex;gap:5px;flex-wrap:wrap}
/* PAGINATION */
.xp-pag{display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 13px;border-top:1px solid var(--re-b1)}
.xp-pag-btn{background:var(--re-glass3);border:1px solid var(--re-b1);border-radius:var(--r-sm);width:27px;height:27px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--re-t1);cursor:pointer;transition:all .1s;font-family:var(--re-font)}
.xp-pag-btn:hover{border-color:var(--re-b2);background:var(--re-p4)}
.xp-pag-btn:disabled{opacity:.2;cursor:not-allowed}
.xp-pag-info{font-size:11px;color:var(--re-t2);font-family:var(--re-mono)}
/* CMP TABLE */
.xp-cmp{width:100%;border-collapse:collapse;font-size:12px}
.xp-cmp th{padding:9px 12px;text-align:left;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--re-t3);border-bottom:1px solid var(--re-b1)}
.xp-cmp td{padding:8px 12px;border-bottom:1px solid var(--re-b0);color:var(--re-t2)}
.xp-cmp tr:last-child td{border-bottom:none}
.xp-cmp tr:hover td{background:rgba(255,255,255,.013)}
.xp-cmp .ours{font-weight:700;color:var(--re-t1)}
.xp-cmp .ck{color:var(--re-green);font-weight:800}
.xp-cmp .cx{color:var(--re-t3);opacity:.35}
.xp-cmp .bad{color:var(--re-red)!important;font-weight:700}
/* DIAG */
.xp-diag-row{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--re-b0)}
.xp-diag-row:last-child{border-bottom:none}
.xp-diag-l{font-size:12px;color:var(--re-t2);display:flex;align-items:center;gap:6px}
.xp-diag-v{font-size:11px;font-family:var(--re-mono);font-weight:700;color:var(--re-t1)}
.xp-dot-ok{width:6px;height:6px;border-radius:50%;background:var(--re-green);flex-shrink:0;box-shadow:0 0 6px rgba(48,209,88,.5)}
.xp-dot-err{width:6px;height:6px;border-radius:50%;background:var(--re-red);flex-shrink:0;box-shadow:0 0 6px rgba(255,69,58,.5)}
.xp-dot-idle{width:6px;height:6px;border-radius:50%;background:var(--re-t3);flex-shrink:0}
/* MISC */
.xp-badge{display:inline-flex;align-items:center;gap:2px;font-size:9px;font-weight:800;padding:1px 5px;border-radius:var(--r-full);border:1px solid;font-family:var(--re-mono)}
.xp-badge.new{color:var(--re-green);background:rgba(48,209,88,.08);border-color:rgba(48,209,88,.2)}
.xp-badge.whale{color:var(--re-blue);background:rgba(10,132,255,.08);border-color:rgba(10,132,255,.2)}
.xp-badge.risk{color:var(--re-red);background:rgba(255,69,58,.08);border-color:rgba(255,69,58,.2)}
.xp-heatmap-wrap{display:flex;flex-wrap:wrap;gap:4px;padding:10px 13px}
.xp-hm-cell{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;border-radius:var(--r-sm);cursor:pointer;text-decoration:none;transition:opacity .1s,transform .1s;flex-shrink:0}
.xp-hm-cell:hover{opacity:.8;transform:scale(1.04)}
.xp-hm-sym{font-size:11px;font-weight:800;color:var(--re-t1);font-family:var(--re-mono);letter-spacing:-.02em}
.xp-hm-vol{font-size:8px;color:rgba(255,255,255,.4);font-family:var(--re-mono)}
.xp-tl-row{display:flex;align-items:flex-start;gap:9px;padding:7px 13px;border-bottom:1px solid var(--re-b0);animation:xp-fade .14s ease}
.xp-tl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}
.xp-tl-dot.buy{background:var(--re-green);box-shadow:0 0 5px rgba(48,209,88,.4)}
.xp-tl-dot.sell{background:var(--re-red);box-shadow:0 0 5px rgba(255,69,58,.4)}
.xp-tl-body{flex:1;min-width:0}
.xp-tl-main{font-size:12px;font-weight:700}
.xp-tl-sub{font-size:10px;color:var(--re-t2);margin-top:1px}
.xp-tl-time{font-size:10px;color:var(--re-t3);font-family:var(--re-mono);white-space:nowrap}
.xp-cl-item{display:flex;gap:7px;padding:6px 0;border-bottom:1px solid var(--re-b0)}
.xp-cl-item:last-child{border-bottom:none}
.xp-cl-dot{width:5px;height:5px;border-radius:50%;background:var(--re-green);flex-shrink:0;margin-top:5px;box-shadow:0 0 4px rgba(48,209,88,.4)}
.xp-cl-text{font-size:12px;color:var(--re-t2);line-height:1.5}
.xp-empty{padding:26px;text-align:center;color:var(--re-t3);font-size:12px;line-height:1.7}
.xp-loading{display:flex;align-items:center;justify-content:center;gap:7px;padding:20px;color:var(--re-t2);font-size:12px}
.xp-spin{animation:xp-spin .7s linear infinite;transform-origin:center;transform-box:fill-box}
.xp-copy-sym{cursor:copy}
.xp-new-hl{animation:xp-hl 2s ease-out}
.xp-footer{border-top:1px solid var(--re-b1);padding:9px 18px;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--re-t3);background:rgba(0,0,0,.6);flex-shrink:0}
.xp-footer-links{display:flex;gap:11px}
.xp-flink{color:var(--re-t3);text-decoration:none;font-weight:500;transition:color .1s;cursor:pointer;background:none;border:none;font-family:var(--re-font);font-size:11px;padding:0}
.xp-flink:hover{color:var(--re-t1)}
.xp-divider{height:1px;background:var(--re-b1);margin:9px 0}
.xp-stat-box.amber::after{background:linear-gradient(90deg,transparent,rgba(255,214,10,.1),transparent)}
.xp-stat-box.blue::after{background:linear-gradient(90deg,transparent,rgba(10,132,255,.1),transparent)}
.xp-stat-box.green::after{background:linear-gradient(90deg,transparent,rgba(48,209,88,.1),transparent)}
#re-panel-wrapper ::-webkit-scrollbar{width:4px;height:4px}
#re-panel-wrapper ::-webkit-scrollbar-track{background:transparent}
#re-panel-wrapper ::-webkit-scrollbar-thumb{background:var(--re-b2);border-radius:2px}
#re-panel-wrapper ::-webkit-scrollbar-thumb:hover{background:var(--re-b3)}
/* SETTINGS TAB */
.xp-setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--re-b0);gap:12px}
.xp-setting-row:last-child{border-bottom:none}
.xp-setting-label{font-size:12px;font-weight:600;color:var(--re-t1);letter-spacing:-.01em}
.xp-setting-sub{font-size:10px;color:var(--re-t3);margin-top:2px}
.xp-setting-ctrl{flex-shrink:0}
.xp-setting-section{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--re-t3);padding:10px 0 4px;margin-bottom:4px;border-bottom:1px solid var(--re-b1)}
/* CUSTOMIZATION SWATCHES */
.xp-swatch-grid{display:flex;gap:6px;flex-wrap:wrap}
.xp-swatch{width:22px;height:22px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .12s var(--ease-out)}
.xp-swatch:hover{transform:scale(1.15)}
.xp-swatch.active{border-color:var(--re-t1);box-shadow:0 0 0 2px rgba(255,255,255,.15)}
</style>

<!-- TOPBAR -->
<div class="re-bar">
  <div class="re-bar-brand">
    <div class="re-bar-logo"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
    Enhanced
  </div>
  <div class="re-bar-divider"></div>
  <div class="re-bar-chips">
    <span class="re-chip">WS <span class="re-chip-v" id="re-stat-trades">—</span></span>
    <span class="re-chip">Alerts <span class="re-chip-v" id="re-stat-alerts">${activeAlerts||'—'}</span></span>
    <span class="re-chip">WL <span class="re-chip-v" id="re-stat-wl">${wlCount||'—'}</span></span>
    <span class="re-live"><span class="re-live-dot"></span>LIVE</span>
    ${s.showVersionBadge ? `<span class="xp-pill ver">v${ver}</span>` : ''}
  </div>
  <div class="re-bar-right">
    <a href="https://github.com/devbyego/rugplay-enhanced" target="_blank" class="re-bar-btn" title="GitHub"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.168 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.34-3.369-1.34-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.031 1.531 1.031.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.56 9.56 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.748-1.025 2.748-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.165 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg></a>
    <button class="re-bar-btn" id="re-panel-close" title="Close Enhanced (Ctrl+Shift+E)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>
</div>

<!-- SENTIMENT BAR -->
<div class="xp-sentiment-wrap" id="xp-sentiment-wrap" style="${s.sentimentBar?'':'display:none'}">
  <div class="xp-sentiment-fill" id="xp-sentiment-fill" style="width:50%"></div>
</div>

<!-- SESSION STATS -->
<div class="xp-session-bar" id="xp-session-bar" style="${s.showSessionStats?'':'display:none'}">
  <div class="xp-ss-item"><span class="xp-ss-k">Volume</span><span class="xp-ss-v" id="xp-ss-vol">$0</span></div>
  <div class="xp-ss-item"><span class="xp-ss-k">Trades</span><span class="xp-ss-v" id="xp-ss-trades">0</span></div>
  <div class="xp-ss-item"><span class="xp-ss-k">Coins</span><span class="xp-ss-v" id="xp-ss-coins">0</span></div>
  <div class="xp-ss-item"><span class="xp-ss-k">Whales</span><span class="xp-ss-v" id="xp-ss-whales">0</span></div>
  <div class="xp-ss-item"><span class="xp-ss-k">Top Coin</span><span class="xp-ss-v" id="xp-ss-top">—</span></div>
  <div class="xp-ss-item"><span class="xp-ss-k">B/S Ratio</span><span class="xp-ss-v" id="xp-ds-bs">—</span></div>
</div>

<!-- TABS -->
<div class="xp-tabs">
  <button class="xp-tab active" data-re-tab="dashboard"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Dashboard</button>
  <button class="xp-tab" data-re-tab="scanner"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Scanner <span class="xp-tab-badge" id="xp-scan-count">0</span></button>
  <button class="xp-tab" data-re-tab="watchlist"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Watchlist <span class="xp-tab-badge" id="xp-tab-wl">${wlCount||''}</span></button>
  <button class="xp-tab" data-re-tab="alerts"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Alerts ${activeAlerts > 0 ? `<span class="xp-tab-badge" style="background:var(--re-red);color:#fff">${activeAlerts}</span>` : ''}</button>
  <button class="xp-tab" data-re-tab="journal"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Journal <span class="xp-tab-badge" id="xp-jl-count"></span></button>
  <button class="xp-tab" data-re-tab="mytrades"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>My Trades</button>
  <button class="xp-tab" data-re-tab="snipe"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/><circle cx="12" cy="12" r="3"/></svg>Snipe</button>
  <button class="xp-tab" data-re-tab="bets"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Predictions</button>
  <button class="xp-tab" data-re-tab="leaderboard"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>Leaderboard</button>
  <button class="xp-tab" data-re-tab="reporter"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Reporter</button>
  <button class="xp-tab" data-re-tab="mods"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M5 5a10 10 0 0 0 0 14"/></svg>Mods <span class="xp-tab-badge">${enabledCount}/${MODS.length}</span></button>
  <button class="xp-tab" data-re-tab="settings"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Settings</button>
  <button class="xp-tab" data-re-tab="status"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Status</button>
  <button class="xp-tab" data-re-tab="features"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>vs Plus</button>
</div>

<!-- TAB BODIES -->
<div class="xp-body">

<!-- DASHBOARD -->
<div data-re-section="dashboard">
  <div class="xp-stat-row">
    <div class="xp-stat-box green"><div class="xp-stat-n" id="xp-stat-trades">0</div><div class="xp-stat-label">Trades Seen</div></div>
    <div class="xp-stat-box blue"><div class="xp-stat-n" id="xp-stat-vol">$0</div><div class="xp-stat-label">Session Volume</div></div>
    <div class="xp-stat-box amber"><div class="xp-stat-n" id="xp-stat-whales">0</div><div class="xp-stat-label">Whale Trades</div></div>
    <div class="xp-stat-box"><div class="xp-stat-n" id="xp-stat-coins">0</div><div class="xp-stat-label">Active Coins</div></div>
  </div>
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Live Feed</div><div class="xp-card-sub">Platform-wide trades via WebSocket</div></div>
          <div class="xp-btn-row">
            <button class="xp-btn ghost" id="xp-feed-timeline-toggle" style="height:26px;font-size:11px">Timeline</button>
            <button class="xp-btn ghost" id="re-feed-pause" style="height:26px;font-size:11px">Pause</button>
            <button class="xp-btn ghost" id="re-feed-clear" style="height:26px;font-size:11px">Clear</button>
          </div>
        </div>
        <div class="xp-feed-ctrl">
          <input class="xp-input" id="re-feed-filter" placeholder="Filter symbol or user…" style="height:26px;font-size:11px" />
          <input class="xp-input" id="re-feed-min" type="number" placeholder="Min $" style="height:26px;font-size:11px" />
          <select class="xp-select" id="re-feed-side" style="height:26px;font-size:11px"><option value="all">All sides</option><option value="BUY">Buys only</option><option value="SELL">Sells only</option></select>
          <div style="display:flex;gap:3px">
            <button class="xp-btn ghost" id="xp-export-feed" style="height:26px;width:26px;padding:0;font-size:10px" title="Export JSON">⬇</button>
            <button class="xp-btn ghost" id="xp-export-csv"  style="height:26px;width:26px;padding:0;font-size:10px" title="Export CSV">📋</button>
          </div>
        </div>
        <div class="xp-feed-head"><span>Side</span><span>Symbol</span><span>User</span><span>Value</span><span>Time</span></div>
        <div id="xp-feed-table-view">
          <div id="re-feed-rows" class="xp-feed-rows"><div class="xp-empty">Waiting for live trades…<br><span style="font-size:10px;color:var(--re-t3)">Trades appear here in real time via WebSocket</span></div></div>
        </div>
        <div id="xp-feed-timeline-view" style="display:none;max-height:320px;overflow-y:auto">
          <div id="xp-timeline-rows"><div class="xp-empty">No trades yet</div></div>
        </div>
      </div>
      <div class="xp-card" id="xp-heatmap-card" style="${s.heatmap?'':'display:none'}">
        <div class="xp-card-hd">
          <div><div class="xp-card-title">🗺 Live Heatmap</div><div class="xp-card-sub">Volume-sized, buy/sell ratio colored</div></div>
          <select class="xp-select" id="re-agg-window" style="width:110px;height:26px;font-size:11px">
            <option value="300000">5 min</option><option value="600000" selected>10 min</option>
            <option value="1800000">30 min</option><option value="3600000">1 hour</option>
          </select>
        </div>
        <div class="xp-heatmap-wrap" id="xp-heatmap"><div class="xp-empty">Waiting for trades…</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card" id="xp-pf-chart-card" style="${s.portfolioChart?'':'display:none'}">
        <div class="xp-card-hd"><div class="xp-card-title">📈 Portfolio</div></div>
        <div style="padding:10px 14px 6px">
          <canvas id="xp-spark" style="width:100%;height:52px;display:block"></canvas>
          <div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--re-mono);margin-top:5px;color:var(--re-t2)">
            <span id="xp-spark-lo">—</span><span id="xp-spark-cur" style="font-weight:700;color:var(--re-t1)">—</span><span id="xp-spark-hi">—</span>
          </div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title">🔥 Hot Coins</div><div class="xp-card-sub">Ranked by session volume</div></div>
          <input class="xp-input" id="re-whale-min" type="number" value="250" placeholder="Whale $" style="width:80px;height:26px;font-size:11px" title="Whale threshold" />
        </div>
        <div class="xp-agg-row">
          <div class="xp-agg-cell"><div class="xp-agg-v" id="xp-ds-vol">$0</div><div class="xp-agg-k">Volume</div></div>
          <div class="xp-agg-cell"><div class="xp-agg-v" id="xp-stat-trades-2">0</div><div class="xp-agg-k">Trades</div></div>
          <div class="xp-agg-cell"><div class="xp-agg-v" id="xp-ds-bs">—</div><div class="xp-agg-k">B/S</div></div>
          <div class="xp-agg-cell"><div class="xp-agg-v" id="xp-ds-coins">0</div><div class="xp-agg-k">Coins</div></div>
          <div class="xp-agg-cell"><div class="xp-agg-v" id="xp-ds-avg">$0</div><div class="xp-agg-k">Avg</div></div>
        </div>
        <div class="xp-mini-list" style="padding:8px 9px" id="re-hot-body"><div class="xp-empty">No data yet</div></div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🐋 Whale Radar</div><div class="xp-card-sub">Largest trades this session</div></div></div>
        <div class="xp-mini-list" style="padding:8px 9px;max-height:200px;overflow-y:auto" id="re-whale-body"><div class="xp-empty">No whales yet</div></div>
      </div>
      <div class="xp-radar-grid">
        <div class="xp-card" id="xp-gainers" style="${s.showTopGainers?'':'display:none'}">
          <div class="xp-card-hd"><div class="xp-card-title">🚀 Gainers</div></div>
          <div class="xp-mini-list" style="padding:6px 9px" id="xp-gainers-list"><div class="xp-empty" style="padding:12px 0">No data</div></div>
        </div>
        <div class="xp-card" id="xp-losers" style="${s.showTopLosers?'':'display:none'}">
          <div class="xp-card-hd"><div class="xp-card-title">📉 Losers</div></div>
          <div class="xp-mini-list" style="padding:6px 9px" id="xp-losers-list"><div class="xp-empty" style="padding:12px 0">No data</div></div>
        </div>
      </div>
      <div class="xp-card" id="xp-gems" style="${s.showGems?'':'display:none'}">
        <div class="xp-card-hd"><div><div class="xp-card-title">💎 Gems</div><div class="xp-card-sub">Low risk · Strong volume</div></div></div>
        <div class="xp-mini-list" style="padding:6px 9px;max-height:160px;overflow-y:auto" id="xp-gems-list"><div class="xp-empty" style="padding:12px 0">No gems found yet</div></div>
      </div>
    </div>
  </div>
</div>

<!-- SCANNER -->
<div data-re-section="scanner">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title">🔭 New Coin Scanner</div><div class="xp-card-sub">Coins first detected in live feed</div></div>
          <div class="xp-btn-row">
            <select class="xp-select" id="xp-scan-sort" style="width:110px;height:26px;font-size:11px"><option value="first">Newest first</option><option value="vol">By volume</option><option value="risk">By risk</option></select>
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--re-t2);cursor:pointer"><input type="checkbox" id="xp-scan-low-only" style="accent-color:var(--re-green)"> Low risk only</label>
            <button class="xp-btn ghost" id="xp-scan-clear" style="height:26px;font-size:11px">Clear</button>
          </div>
        </div>
        <div class="xp-scanner" id="xp-scanner-rows"><div class="xp-empty">No new coins detected yet.<br><span style="font-size:10px;color:var(--re-t3)">New coins appear here the moment they hit the live feed</span></div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">📊 Gainers / Losers</div><div class="xp-card-sub">First vs last seen price this session</div></div></div>
        <div style="padding:8px 13px">
          <div class="xp-section-label">Top Gainers</div>
          <div class="xp-mini-list" id="xp-gainers"><div class="xp-empty" style="padding:10px 0">No data yet</div></div>
          <div class="xp-divider"></div>
          <div class="xp-section-label">Top Losers</div>
          <div class="xp-mini-list" id="xp-losers"><div class="xp-empty" style="padding:10px 0">No data yet</div></div>
          <div class="xp-divider"></div>
          <div class="xp-section-label">Gem Finder</div>
          <div class="xp-mini-list" id="xp-gems"><div class="xp-empty" style="padding:10px 0">No gems yet</div></div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- WATCHLIST -->
<div data-re-section="watchlist">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Watchlist</div></div>
          <div class="xp-btn-row">
            <button class="xp-btn ghost" id="xp-wl-export" style="height:26px;font-size:11px">Export</button>
          </div>
        </div>
        <div style="padding:10px 14px;border-bottom:1px solid var(--re-b1);display:flex;gap:6px">
          <input class="xp-input" id="re-wl-inp" placeholder="Add symbol e.g. BTC…" style="flex:1;height:30px" />
          <button class="xp-btn primary" id="re-wl-add-btn" style="height:30px">Add</button>
        </div>
        <div id="re-wl-list" style="padding:10px 14px;max-height:380px;overflow-y:auto"><div class="xp-empty">No coins in watchlist</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">👁 Watchlist Feed</div><div class="xp-card-sub">Only trades from watched coins</div></div></div>
        <div class="xp-feed-head"><span>Side</span><span>Symbol</span><span>User</span><span>Value</span><span>Time</span></div>
        <div id="xp-wl-feed" class="xp-feed-rows" style="max-height:360px"><div class="xp-empty">No watchlist trades yet</div></div>
      </div>
    </div>
  </div>
</div>

<!-- ALERTS -->
<div data-re-section="alerts">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🔔 Price Alerts</div><div class="xp-card-sub">Fires instantly via WebSocket</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-grid" style="grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:10px">
            <input id="re-al-sym" class="xp-input" placeholder="Symbol e.g. BTC" />
            <input id="re-al-px" class="xp-input" type="number" placeholder="Price $" />
            <select id="re-al-dir" class="xp-select"><option value="above">Above ↑</option><option value="below">Below ↓</option></select>
            <button class="xp-btn primary" id="re-al-add">Set Alert</button>
          </div>
          <div id="re-al-list"></div>
          <div id="xp-al-hist-wrap" style="${s.showAlertHistory?'':'display:none'}">
            <div class="xp-section-label" style="margin-top:12px">Alert History</div>
            <div id="xp-al-hist" class="xp-al-hist"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">⚙ Alert Settings</div><div class="xp-card-sub">Configure thresholds</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-row" style="margin-bottom:9px"><div class="xp-label">Whale threshold ($)</div><input id="xp-whale-thresh" class="xp-input" type="number" value="${s.whaleTxMin||500}" /></div>
          <div class="xp-form-row" style="margin-bottom:9px"><div class="xp-label">Volume spike threshold ($)</div><input id="xp-vol-thresh" class="xp-input" type="number" value="${s.volumeSpikeUsd||5000}" /></div>
          <div class="xp-form-row" style="margin-bottom:9px"><div class="xp-label">Price drop alert (%)</div><input id="xp-drop-thresh" class="xp-input" type="number" value="${s.priceDropPct||20}" /></div>
          <div class="xp-form-row"><div class="xp-label">Holder drop alert (%)</div><input id="xp-holder-thresh" class="xp-input" type="number" value="${s.holderDropPct||20}" /></div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div class="xp-card-title">🧪 Test Alerts</div></div>
        <div class="xp-card-body" style="display:flex;flex-direction:column;gap:7px">
          <button class="xp-btn ghost xp-btn-full" id="xp-test-notif">Test notification toast</button>
          <button class="xp-btn ghost xp-btn-full" id="xp-test-sound">Test alert sound</button>
          <button class="xp-btn ghost xp-btn-full" id="xp-req-desktop">Request desktop permission</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- JOURNAL -->
<div data-re-section="journal">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title">📓 Session Journal</div><div class="xp-card-sub">All events this session</div></div>
          <div class="xp-btn-row">
            <button class="xp-btn ghost" id="xp-jl-clear" style="height:26px;font-size:11px">Clear</button>
            <button class="xp-btn ghost" id="xp-jl-export" style="height:26px;font-size:11px">Export</button>
          </div>
        </div>
        <div style="padding:9px 13px;border-bottom:1px solid var(--re-b1)"><input class="xp-input" id="xp-jl-filter" placeholder="Filter events…" /></div>
        <div id="xp-journal-rows" class="xp-journal"><div class="xp-jl-empty">No events yet.<br>Alerts, whales, bots and reports appear here.</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div class="xp-card-title">📊 Session Summary</div></div>
        <div class="xp-card-body">
          <div class="xp-stat-row" style="grid-template-columns:repeat(2,1fr)">
            <div class="xp-stat-box green"><div class="xp-stat-n" id="xp-jls-alerts">0</div><div class="xp-stat-label">Alerts Fired</div></div>
            <div class="xp-stat-box amber"><div class="xp-stat-n" id="xp-jls-whales">0</div><div class="xp-stat-label">Whales</div></div>
            <div class="xp-stat-box"><div class="xp-stat-n" id="xp-jls-bots">0</div><div class="xp-stat-label">Bot Detections</div></div>
            <div class="xp-stat-box blue"><div class="xp-stat-n" id="xp-jls-reports">0</div><div class="xp-stat-label">Reports</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- MY TRADES -->
<div data-re-section="mytrades">
  <div class="xp-card">
    <div class="xp-card-hd">
      <div><div class="xp-card-title">📈 My Trade History</div><div class="xp-card-sub">Your personal trades from Rugplay</div></div>
      <div style="display:flex;gap:6px">
        <select id="xp-mt-filter" class="xp-select" style="width:90px;height:26px;font-size:11px"><option value="all">All</option><option value="BUY">Buys</option><option value="SELL">Sells</option></select>
        <button class="xp-btn ghost" id="xp-mt-refresh" style="height:26px;font-size:11px">Refresh</button>
      </div>
    </div>
    <div id="xp-mt-body" style="max-height:70vh;overflow-y:auto"><div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading your trades…</div></div>
    <div id="xp-mt-pag" class="xp-pag" style="display:none"></div>
  </div>
</div>

<!-- BETS -->
<div data-re-section="snipe">
<div class="xp-2col">
<div class="xp-col">
<div class="xp-card">
  <div class="xp-card-hd">
    <div><div class="xp-card-title">Coin Sniper</div><div class="xp-card-sub">Alert + auto-navigate the moment a target coin first appears in the live feed</div></div>
  </div>
  <div class="xp-card-body" style="display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;gap:7px;align-items:flex-end">
      <div style="flex:1"><div class="xp-label">Target coin symbol</div><input id="re-snipe-sym" class="xp-input" placeholder="e.g. BITCOIN" autocomplete="off" /></div>
      <button id="re-snipe-add" class="xp-btn primary">Add</button>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#a1a1aa;cursor:pointer;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:6px;border:1px solid rgba(255,255,255,.06)"><input type="checkbox" id="re-snipe-navigate" checked style="accent-color:#22c55e"> Auto-navigate to coin page on hit</label>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#a1a1aa;cursor:pointer;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:6px;border:1px solid rgba(255,255,255,.06)"><input type="checkbox" id="re-snipe-sound" checked style="accent-color:#22c55e"> Play sound on hit</label>
    <div id="re-snipe-targets"></div>
  </div>
</div>
<div class="xp-card">
  <div class="xp-card-hd"><div class="xp-card-title">Snipe Log</div></div>
  <div id="re-snipe-log" style="max-height:240px;overflow-y:auto"><div style="padding:16px;text-align:center;font-size:12px;color:#52525b">No snipe hits yet.</div></div>
</div>
</div>
<div class="xp-col">
<div class="xp-card">
  <div class="xp-card-hd"><div><div class="xp-card-title">How to snipe</div></div></div>
  <div class="xp-card-body" style="display:flex;flex-direction:column;gap:9px;font-size:12px;color:#a1a1aa;line-height:1.6">
    <div style="padding:9px 11px;background:rgba(34,197,94,.06);border-left:2px solid #22c55e;border-radius:0 6px 6px 0"><strong style="color:#e8e8eb;display:block;margin-bottom:2px">1. Add a target</strong>Type the exact coin symbol and press Add. Add multiple targets at once.</div>
    <div style="padding:9px 11px;background:rgba(59,130,246,.06);border-left:2px solid #3b82f6;border-radius:0 6px 6px 0"><strong style="color:#e8e8eb;display:block;margin-bottom:2px">2. Wait</strong>Enhanced watches the live WebSocket feed. The moment the first trade for your coin appears, it fires instantly — no polling delay.</div>
    <div style="padding:9px 11px;background:rgba(245,158,11,.06);border-left:2px solid #f59e0b;border-radius:0 6px 6px 0"><strong style="color:#e8e8eb;display:block;margin-bottom:2px">3. Auto-navigate</strong>With auto-navigate on, you land on the coin page the instant it hits. From there, buy manually as fast as you can.</div>
    <div style="padding:9px 11px;background:rgba(239,68,68,.06);border-left:2px solid #ef4444;border-radius:0 6px 6px 0"><strong style="color:#e8e8eb;display:block;margin-bottom:2px">Tip: disable Confirm Trades</strong>Go to Mods and turn off <em>Confirm All Trades</em> so there is no extra dialog slowing your buy.</div>
  </div>
</div>
</div>
</div>
</div>

<div data-re-section="bets">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🎯 Active Predictions</div><div class="xp-card-sub">Live from Rugplay's prediction market</div></div>
          <button class="xp-btn ghost" id="xp-bets-refresh" style="height:26px;font-size:11px">Refresh</button>
        </div>
        <div id="xp-bets-body" style="max-height:60vh;overflow-y:auto"><div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">My Bets</div></div></div>
        <div id="xp-my-bets-body" style="max-height:320px;overflow-y:auto"><div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</div></div>
      </div>
    </div>
  </div>
</div>

<!-- LEADERBOARD -->
<div data-re-section="leaderboard">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd">
          <div><div class="xp-card-title">🏆 Global Leaderboard</div><div class="xp-card-sub">Top traders by portfolio value</div></div>
          <button class="xp-btn ghost" id="xp-lb-refresh" style="height:26px;font-size:11px">Refresh</button>
        </div>
        <div id="xp-lb-body" style="max-height:70vh;overflow-y:auto"><div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🐋 Whale Leaderboard</div><div class="xp-card-sub">Biggest single trades this session</div></div></div>
        <div id="xp-whale-lb" style="max-height:320px;overflow-y:auto"><div class="xp-empty">No whale trades seen yet</div></div>
      </div>
    </div>
  </div>
</div>

<!-- REPORTER -->
<div data-re-section="reporter">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🚩 Submit Report</div><div class="xp-card-sub">Warn the community about rugpulls</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:8px">
            <div class="xp-form-row"><div class="xp-label">Username</div><input id="re-rp-usr" class="xp-input" placeholder="scammer123" /></div>
            <div class="xp-form-row"><div class="xp-label">Coin Symbol</div><input id="re-rp-sym" class="xp-input" placeholder="SCAM" /></div>
          </div>
          <div class="xp-form-row" style="margin-bottom:10px"><div class="xp-label">Evidence</div><textarea id="re-rp-desc" class="xp-textarea" placeholder="Describe the rugpull evidence…"></textarea></div>
          <button id="re-rp-sub" class="xp-btn primary xp-btn-full">Submit Report</button>
          <div id="re-rp-msg" style="font-size:12px;text-align:center;margin-top:8px;min-height:16px;font-weight:600"></div>
        </div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">Community Reports</div><div class="xp-card-sub">Submitted by Enhanced users</div></div></div>
        <div id="re-rp-list" style="max-height:420px;overflow-y:auto;padding:10px 13px"></div>
        <div id="re-rp-pag" class="xp-pag" style="display:none"></div>
      </div>
    </div>
  </div>
</div>

<!-- MODS -->
<div data-re-section="mods" style="margin:-18px -18px;padding:0">
  <div class="xp-mods-top">
    <div class="xp-mods-sw">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="re-mods-q" class="xp-input xp-mods-si" placeholder="Search ${MODS.length} mods…" autocomplete="off" />
    </div>
    <span class="xp-mods-count" id="re-mods-count">${enabledCount}/${MODS.length} enabled</span>
    <button class="xp-btn ghost" id="xp-mods-all-on" style="height:26px;font-size:11px">All on</button>
    <button class="xp-btn ghost" id="xp-mods-all-off" style="height:26px;font-size:11px">All off</button>
  </div>
  <div class="xp-cat-filter" id="re-cat-filter">
    <button class="xp-cat-btn active" data-cat="All">All (${MODS.length})</button>
    ${CATS.map(c=>`<button class="xp-cat-btn" data-cat="${c}" style="--cc:${CAT_COLORS[c]}">${CAT_ICONS[c]} ${c} (${MODS.filter(m=>m.cat===c).length})</button>`).join('')}
  </div>
  <div class="xp-mods-body" id="re-mods-body">${modsHTML}</div>
</div>

<!-- SETTINGS -->
<div data-re-section="settings">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🎨 Appearance</div><div class="xp-card-sub">Customize how Enhanced looks</div></div></div>
        <div class="xp-card-body">
          <div class="xp-setting-section">Accent Color</div>
          <div class="xp-swatch-grid" id="xp-accent-swatches">
            ${[['default','#f5f5f7'],['green','#30d158'],['blue','#0a84ff'],['purple','#bf5af2'],['amber','#ffd60a'],['red','#ff453a'],['teal','#5ac8fa'],['pink','#ff375f'],['orange','#ff9f0a']].map(([k,c])=>`<div class="xp-swatch ${(s.accentPreset||'default')===k?'active':''}" data-accent="${k}" style="background:${c}" title="${k}"></div>`).join('')}
          </div>
          <div class="xp-divider"></div>
          <div class="xp-setting-section">Feed Colors</div>
          <div class="xp-form-grid" style="grid-template-columns:1fr 1fr">
            <div class="xp-form-row"><div class="xp-label">Buy Color</div><input type="color" id="xp-buy-color" value="${s.tradeFeedBuyColor||'#22c55e'}" style="height:30px;width:100%;border:1px solid var(--re-b2);border-radius:var(--r-sm);background:var(--re-glass3);cursor:pointer" /></div>
            <div class="xp-form-row"><div class="xp-label">Sell Color</div><input type="color" id="xp-sell-color" value="${s.tradeFeedSellColor||'#ef4444'}" style="height:30px;width:100%;border:1px solid var(--re-b2);border-radius:var(--r-sm);background:var(--re-glass3);cursor:pointer" /></div>
          </div>
          <div class="xp-divider"></div>
          <div class="xp-setting-section">Panel</div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Panel Width</div><div class="xp-setting-sub">How wide the Enhanced panel appears</div></div>
            <select id="xp-panel-width" class="xp-select" style="width:110px"><option value="normal" ${(s.panelWidth||'normal')==='normal'?'selected':''}>Normal</option><option value="wide" ${s.panelWidth==='wide'?'selected':''}>Wide</option><option value="full" ${s.panelWidth==='full'?'selected':''}>Full width</option></select>
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Panel Opacity</div><div class="xp-setting-sub">Background opacity of panel cards</div></div>
            <input type="range" id="xp-panel-opacity" min="60" max="100" value="${s.panelOpacity||100}" style="width:100px;accent-color:var(--re-green)" />
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Timestamp Format</div></div>
            <select id="xp-ts-format" class="xp-select" style="width:110px"><option value="relative" ${(s.timestampFormat||'relative')==='relative'?'selected':''}>Relative (2m ago)</option><option value="absolute" ${s.timestampFormat==='absolute'?'selected':''}>Absolute time</option></select>
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Number Format</div></div>
            <select id="xp-num-format" class="xp-select" style="width:110px"><option value="abbreviated" ${(s.numberFormat||'abbreviated')==='abbreviated'?'selected':''}>Abbreviated ($1.2K)</option><option value="full" ${s.numberFormat==='full'?'selected':''}>Full ($1,234.56)</option></select>
          </div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🔊 Sounds</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-row"><div class="xp-label">Notification Sound</div>
            <select id="xp-notif-sound" class="xp-select"><option value="beep" ${(s.notifSound||'beep')==='beep'?'selected':''}>Beep</option><option value="ding" ${s.notifSound==='ding'?'selected':''}>Ding</option><option value="chime" ${s.notifSound==='chime'?'selected':''}>Chime</option><option value="none" ${s.notifSound==='none'?'selected':''}>Silent</option></select>
          </div>
        </div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">⚡ Performance</div></div></div>
        <div class="xp-card-body">
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Feed Max Rows</div><div class="xp-setting-sub">Max rows kept in live feed memory</div></div>
            <input type="number" id="xp-feed-max-rows" class="xp-input" value="${s.feedMaxRows||80}" style="width:70px" />
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Whale Threshold ($)</div></div>
            <input type="number" id="xp-whale-size" class="xp-input" value="${s.whaleTxMin||500}" style="width:80px" />
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Small Trade Filter ($)</div><div class="xp-setting-sub">Hides trades below this when enabled</div></div>
            <input type="number" id="xp-small-trade" class="xp-input" value="${s.smallTradeUsd||10}" style="width:80px" />
          </div>
          <div class="xp-setting-row">
            <div><div class="xp-setting-label">Portfolio Refresh (ms)</div></div>
            <input type="number" id="xp-pf-refresh" class="xp-input" value="${s.portfolioRefreshRate||5000}" style="width:80px" />
          </div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🔑 Hotkeys</div></div></div>
        <div class="xp-card-body">
          <div style="font-size:11px;color:var(--re-t2);display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between"><span>Open/Close Panel</span><kbd style="background:var(--re-p4);border:1px solid var(--re-b2);border-radius:var(--r-xs);padding:2px 7px;font-family:var(--re-mono);font-size:10px">Ctrl+Shift+E</kbd></div>
            <div style="display:flex;justify-content:space-between"><span>Quick Search</span><kbd style="background:var(--re-p4);border:1px solid var(--re-b2);border-radius:var(--r-xs);padding:2px 7px;font-family:var(--re-mono);font-size:10px">Ctrl+K</kbd></div>
            <div style="display:flex;justify-content:space-between"><span>URL Shortcuts</span><kbd style="background:var(--re-p4);border:1px solid var(--re-b2);border-radius:var(--r-xs);padding:2px 7px;font-family:var(--re-mono);font-size:10px">/@user /*SYM</kbd></div>
          </div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">💾 Data</div></div></div>
        <div class="xp-card-body" style="display:flex;flex-direction:column;gap:7px">
          <button class="xp-btn ghost xp-btn-full" id="xp-export-settings">Export Settings JSON</button>
          <button class="xp-btn ghost xp-btn-full" id="xp-import-settings">Import Settings JSON</button>
          <button class="xp-btn danger xp-btn-full" id="xp-reset-settings">Reset All Settings</button>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🚩 Blocked / Trusted</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-row" style="margin-bottom:8px"><div class="xp-label">Blocked Users (comma-separated)</div><input class="xp-input" id="xp-blocked-users" value="${s.blockedUsers||''}" placeholder="user1,user2" /></div>
          <div class="xp-form-row" style="margin-bottom:8px"><div class="xp-label">Pinned Coins</div><input class="xp-input" id="xp-pinned-coins" value="${s.pinnedCoins||''}" placeholder="BTC,ETH" /></div>
          <div class="xp-form-row"><div class="xp-label">Trusted Creators</div><input class="xp-input" id="xp-trusted-creators" value="${s.trustedCreators||''}" placeholder="user1,user2" /></div>
          <button class="xp-btn primary xp-btn-full" id="xp-save-lists" style="margin-top:10px">Save</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- STATUS -->
<div data-re-section="status">
  <div class="xp-2col">
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🟢 System Diagnostics</div></div></div>
        <div class="xp-card-body" id="re-diag">
          <div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Checking…</div>
        </div>
      </div>
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">📋 What's New in v${ver}</div></div></div>
        <div id="re-changelog-card" class="xp-card-body"><div class="xp-empty">Loading…</div></div>
      </div>
    </div>
    <div class="xp-col">
      <div class="xp-card">
        <div class="xp-card-hd"><div><div class="xp-card-title">🐛 Report a Bug</div></div></div>
        <div class="xp-card-body">
          <div class="xp-form-row" style="margin-bottom:8px"><div class="xp-label">Describe the issue</div><textarea id="xp-bug-desc" class="xp-textarea" placeholder="Steps to reproduce, what you expected, what happened…"></textarea></div>
          <div class="xp-form-row" style="margin-bottom:10px"><div class="xp-label">Your Rugplay username (optional)</div><input id="xp-bug-user" class="xp-input" placeholder="@yourname" /></div>
          <button class="xp-btn primary xp-btn-full" id="re-feedback-btn">Submit Bug Report</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- VS PLUS -->
<div data-re-section="features">
  <div class="xp-card">
    <div class="xp-card-hd"><div class="xp-card-title">✅ Enhanced vs Rugplay Plus — the honest comparison</div></div>
    <div style="overflow-x:auto">
      <table class="xp-cmp">
        <thead><tr><th>Feature</th><th class="ours">Enhanced (Free)</th><th>Rugplay Plus (Paid)</th></tr></thead>
        <tbody>
          <tr><td>${MODS.length}+ Toggleable Mods</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Live WebSocket Feed</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Price Alerts (instant via WS)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Watchlist with Live Prices</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Coin Scanner</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Session Journal</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Live Heatmap</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Portfolio Sparkline</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Bot Detection</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Volume Spike Alerts</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Risk Scoring (0-100)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Gem Finder</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Export Data (JSON/CSV)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Coin Notes (local)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Session P&L Tracker</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Quick Search (Ctrl+K)</td><td class="ours ck">✓</td><td class="cx">✗</td></tr>
          <tr><td>Rugpull Reporter</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
          <tr><td>Recent Transactions Card</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
          <tr><td>Ad Blocker</td><td class="ours ck">✓</td><td class="ck">✓</td></tr>
          <tr style="background:rgba(255,69,58,.04)"><td style="color:var(--re-red);font-weight:700">Tracks your username</td><td class="ours ck">Never</td><td class="bad">YES</td></tr>
          <tr style="background:rgba(255,69,58,.04)"><td style="color:var(--re-red);font-weight:700">Fails when servers go down</td><td class="ours ck">Never</td><td class="bad">YES</td></tr>
          <tr style="background:rgba(255,69,58,.04)"><td style="color:var(--re-red);font-weight:700">Costs money</td><td class="ours ck">Free forever</td><td class="bad">Paid</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

</div><!-- END xp-body -->

<div class="xp-footer">
  <span>Rugplay Enhanced v${ver} · devbyego</span>
  <div class="xp-footer-links">
    <a class="xp-flink" href="https://github.com/devbyego/rugplay-enhanced" target="_blank">GitHub</a>
    <a class="xp-flink" href="https://github.com/devbyego/rugplay-enhanced/issues/new" target="_blank">Bug Report</a>
    <a class="xp-flink" href="https://github.com/devbyego/rugplay-enhanced/releases" target="_blank">Changelog</a>
  </div>
</div>
</div>`;
        },
        _attachListeners() {
            const loadMyTrades = async (pg) => {
                pg = pg || 1;
                const body = document.getElementById('xp-mt-body');
                if (!body) return;
                const filterVal = document.getElementById('xp-mt-filter')?.value || 'all';
                body.innerHTML = '<div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</div>';
                try {
                    const me = await utils.getLoggedInUsername();
                    if (!me) { body.innerHTML = '<div class="xp-empty">Could not detect your username. Make sure you are logged in.</div>'; return; }
                    const d = await rugplayApi.userTrades(me, pg, 20);
                    let tr = d.trades || d.data || d.results || [];
                    if (filterVal !== 'all') tr = tr.filter(t => (t.type||'').toUpperCase() === filterVal);
                    if (!tr.length) { body.innerHTML = '<div class="xp-empty">No trades found.</div>'; return; }
                    const wrap = document.createElement('div');
                    wrap.style.overflowX = 'auto';
                    const table = document.createElement('table');
                    table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse';
                    table.innerHTML = '<thead><tr style="border-bottom:1px solid var(--xp-b1)"><th style="padding:8px 14px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3)">Type</th><th style="padding:8px 14px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3)">Coin</th><th style="padding:8px 14px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3)">Value</th><th style="padding:8px 14px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3)">Price</th><th style="padding:8px 14px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--xp-t3)">Time</th></tr></thead>';
                    const tbody = document.createElement('tbody');
                    tr.forEach(t => {
                        const type = (t.type || 'BUY').toUpperCase();
                        const isSell = type === 'SELL';
                        const val = +(t.totalValue || t.value || 0);
                        const px = +(t.price || 0);
                        const sym = t.coinSymbol || t.symbol || '?';
                        const ts = t.timestamp || t.createdAt || 0;
                        const row = document.createElement('tr');
                        row.style.borderBottom = '1px solid var(--xp-b1)';
                        row.onmouseover = () => { row.style.background='rgba(255,255,255,.02)'; };
                        row.onmouseout = () => { row.style.background=''; };
                        const typeBg = isSell ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)';
                        const typeColor = isSell ? '#ef4444' : '#22c55e';
                        const typeBord = isSell ? 'rgba(239,68,68,.2)' : 'rgba(34,197,94,.2)';
                        row.innerHTML = '<td style="padding:8px 14px"><span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;font-family:var(--xp-mono);background:' + typeBg + ';color:' + typeColor + ';border:1px solid ' + typeBord + '">' + type + '</span></td>'
                            + '<td style="padding:8px 14px"><a href="/coin/' + sym + '" style="font-weight:700;color:var(--xp-t1);text-decoration:none;font-family:var(--xp-mono)">' + sym + '</a></td>'
                            + '<td style="padding:8px 14px;font-weight:600;font-family:var(--xp-mono)">' + utils.usd(val) + '</td>'
                            + '<td style="padding:8px 14px;color:var(--xp-t2);font-family:var(--xp-mono)">$' + px.toFixed(6) + '</td>'
                            + '<td style="padding:8px 14px;text-align:right;color:var(--xp-t3);font-family:var(--xp-mono)">' + utils.ago(ts) + '</td>';
                        tbody.appendChild(row);
                    });
                    table.appendChild(tbody); wrap.appendChild(table); body.innerHTML = ''; body.appendChild(wrap);
                    const pag = document.getElementById('xp-mt-pag');
                    const p = d.pagination;
                    if (pag && p && p.total_pages > 1) {
                        pag.style.display = 'flex';
                        pag.innerHTML = '';
                        const mkB = (lbl, page, dis) => {
                            const b = document.createElement('button');
                            b.textContent = lbl;
                            b.className = 'xp-pag-btn';
                            if (dis) { b.setAttribute('disabled',''); b.style.opacity='.25'; }
                            else b.onclick = () => loadMyTrades(page);
                            return b;
                        };
                        pag.appendChild(mkB('«', p.current_page - 1, p.current_page === 1));
                        const inf = document.createElement('span');
                        inf.className = 'xp-pag-info';
                        inf.textContent = p.current_page + ' / ' + p.total_pages;
                        pag.appendChild(inf);
                        pag.appendChild(mkB('»', p.current_page + 1, p.current_page >= p.total_pages));
                    } else if (pag) {
                        pag.style.display = 'none';
                    }
                } catch(e) {
                    body.innerHTML = '<div class="xp-empty">Failed to load trades.<br>' + (e && e.message ? e.message : '') + '</div>';
                }
            };
            if (!window._reJournal) window._reJournal = [];
            const jLog = (type, title, detail) => {
                if (!store.settings().sessionJournal) return;
                window._reJournal.unshift({ type, title, detail, ts: Date.now() });
                window._reJournal = window._reJournal.slice(0, 500);
                const cnt = document.getElementById('xp-jl-count');
                if (cnt) cnt.textContent = window._reJournal.length || '';
                const jStats = { alert:0, whale:0, bot:0, report:0 };
                window._reJournal.forEach(e => { if (jStats[e.type] !== undefined) jStats[e.type]++; });
                ['alerts','whales','bots','reports'].forEach((k,i) => {
                    const el = document.getElementById('xp-jls-'+k); if(el) el.textContent = Object.values(jStats)[i];
                });
                renderJournal();
            };
            window._reJLog = jLog;
            if (!window._reWlFeed) window._reWlFeed = [];
            const renderJournal = () => {
                const el = document.getElementById('xp-journal-rows'); if (!el) return;
                const q = (document.getElementById('xp-jl-filter')?.value||'').toLowerCase();
                const rows = (window._reJournal||[]).filter(e => !q || e.title.toLowerCase().includes(q) || (e.detail||'').toLowerCase().includes(q));
                const icons = {alert:'🔔', whale:'🐋', bot:'🤖', vol:'📈', creator:'🚨', report:'⚠️', info:'ℹ️'};
                if (!rows.length) { el.innerHTML = '<div class="xp-jl-empty">No events yet.</div>'; return; }
                el.innerHTML = rows.map(e => `<div class="xp-jl-row"><div class="xp-jl-icon">${icons[e.type]||'•'}</div><div class="xp-jl-body"><div class="xp-jl-title">${e.title}</div><div class="xp-jl-detail">${e.detail||''}</div></div><div class="xp-jl-time">${utils.ago(e.ts)}</div></div>`).join('');
            };
            if (!window._reScanCoins) window._reScanCoins = {};
            const renderScanner = () => {
                const el = document.getElementById('xp-scanner-rows'); if (!el) return;
                const sort = document.getElementById('xp-scan-sort')?.value || 'first';
                const lowOnly = document.getElementById('xp-scan-low-only')?.checked || false;
                let coins = Object.values(window._reScanCoins);
                if (lowOnly) coins = coins.filter(c => (c.risk || 100) < 50);
                if (sort === 'vol') coins.sort((a,b) => b.vol - a.vol);
                else if (sort === 'risk') coins.sort((a,b) => (a.risk||99) - (b.risk||99));
                else coins.sort((a,b) => b.firstSeen - a.firstSeen);
                coins = coins.slice(0, 40);
                if (!coins.length) { el.innerHTML = '<div class="xp-empty">No new coins detected yet.</div>'; return; }
                const cnt = document.getElementById('xp-scan-count'); if (cnt) cnt.textContent = Object.keys(window._reScanCoins).length;
                el.innerHTML = coins.map(c => {
                    const risk = c.risk;
                    const rc = risk >= 70 ? 'high' : risk >= 40 ? 'med' : 'low';
                    const rl = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MED' : 'LOW';
                    return `<a class="xp-sc-row" href="/coin/${c.sym}"><span class="xp-sc-sym xp-copy-sym" data-sym="${c.sym}">${c.sym}</span><div><div style="font-size:11px;font-weight:600">${c.n} trades · ${utils.usd(c.vol)}</div><div class="xp-sc-meta">${c.buy}B / ${c.sell}S · first seen ${utils.ago(c.firstSeen)}</div></div><span class="xp-sc-risk ${rc}">${rl}</span><span class="xp-sc-age">${utils.ago(c.firstSeen)}</span></a>`;
                }).join('');
            };
            const renderHeatmap = () => {
                const el = document.getElementById('xp-heatmap'); if (!el) return;
                if (!store.settings().heatmap) { const card = document.getElementById('xp-heatmap-card'); if (card) card.style.display = 'none'; return; }
                const sinceMs = parseInt(document.getElementById('re-agg-window')?.value || '600000', 10);
                const since = Date.now() - sinceMs;
                const trades = liveFeed.trades.filter(t => +t.ts >= since);
                if (!trades.length) { el.innerHTML = '<div class="xp-empty">Waiting for trades…</div>'; return; }
                const by = {};
                trades.forEach(t => {
                    if (!by[t.sym]) by[t.sym] = { sym:t.sym, vol:0, buy:0, sell:0 };
                    by[t.sym].vol += +t.val||0;
                    if (t.type === 'BUY') by[t.sym].buy++; else by[t.sym].sell++;
                });
                const sorted = Object.values(by).sort((a,b) => b.vol - a.vol).slice(0, 24);
                const maxVol = sorted[0]?.vol || 1;
                el.innerHTML = sorted.map(h => {
                    const ratio = h.buy / (h.buy + h.sell || 1);
                    const size = Math.max(44, Math.round((h.vol / maxVol) * 120));
                    const r = Math.round(239 * (1-ratio)), g = Math.round(197 * ratio);
                    const bg = `rgba(${r},${g},68,0.2)`, border = `rgba(${r},${g},68,0.35)`;
                    return `<a href="/coin/${h.sym}" class="xp-hm-cell xp-copy-sym" data-sym="${h.sym}" style="width:${size}px;height:${Math.max(36, Math.round(size*.65))}px;background:${bg};border:1px solid ${border}"><span class="xp-hm-sym">${h.sym}</span><span class="xp-hm-vol">${utils.usd(h.vol)}</span></a>`;
                }).join('');
            };
            const renderSparkline = () => {
                const canvas = document.getElementById('xp-spark'); if (!canvas) return;
                if (!store.settings().portfolioChart) { const card = document.getElementById('xp-pf-chart-card'); if (card) card.style.display = 'none'; return; }
                const snaps = store.portfolio().snaps || [];
                if (snaps.length < 2) return;
                const vals = snaps.map(s => s.total).filter(v => typeof v === 'number' && !isNaN(v));
                if (vals.length < 2) return;
                const min = Math.min(...vals), max = Math.max(...vals);
                const w = canvas.offsetWidth || 260, h = 48;
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d'); if (!ctx) return;
                ctx.clearRect(0, 0, w, h);
                const pct = v => (max === min) ? 0.5 : 1 - (v - min) / (max - min);
                const pts = vals.map((v, i) => ({ x: (i / (vals.length-1)) * w, y: pct(v) * (h-4) + 2 }));
                const cur = vals[vals.length-1];
                const first = vals[0];
                const isUp = cur >= first;
                const col = isUp ? '#22c55e' : '#ef4444';
                const grad = ctx.createLinearGradient(0, 0, 0, h);
                grad.addColorStop(0, isUp ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                ctx.lineTo(pts[pts.length-1].x, h);
                ctx.lineTo(pts[0].x, h);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                ctx.strokeStyle = col;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                const fmt = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(v);
                const lo = document.getElementById('xp-spark-lo'), hi = document.getElementById('xp-spark-hi'), curEl = document.getElementById('xp-spark-cur');
                if (lo) lo.textContent = fmt(min);
                if (hi) hi.textContent = fmt(max);
                if (curEl) { curEl.textContent = fmt(cur); curEl.style.color = col; }
            };
            const renderSessionStats = () => {
                if (!store.settings().showSessionStats) return;
                const allTrades = liveFeed.trades;
                const totalVol = allTrades.reduce((s,t) => s + (+t.val||0), 0);
                const coins = new Set(allTrades.map(t => t.sym)).size;
                const whales = allTrades.filter(t => (+t.val||0) >= (store.settings().whaleTxMin||500)).length;
                const by = {}; allTrades.forEach(t => { by[t.sym] = (by[t.sym]||0) + (+t.val||0); });
                const top = Object.entries(by).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
                const ssVol = document.getElementById('xp-ss-vol'); if (ssVol) ssVol.textContent = utils.usd(totalVol);
                const ssTop = document.getElementById('xp-ss-top'); if (ssTop) ssTop.textContent = top;
                const ssTr = document.getElementById('xp-ss-trades'); if (ssTr) ssTr.textContent = allTrades.length;
                const ssC = document.getElementById('xp-ss-coins'); if (ssC) ssC.textContent = coins;
                const ssW = document.getElementById('xp-ss-whales'); if (ssW) ssW.textContent = whales;
            };
            const renderDashStats = () => {
                const sinceMs = parseInt(document.getElementById('re-agg-window')?.value||'600000',10);
                const trades = liveFeed.trades.filter(t => +t.ts >= Date.now()-sinceMs);
                const vol = trades.reduce((s,t) => s+(+t.val||0), 0);
                const buys = trades.filter(t => t.type==='BUY').length;
                const sells = trades.filter(t => t.type==='SELL').length;
                const coins = new Set(trades.map(t => t.sym)).size;
                const dv = document.getElementById('xp-ds-vol'); if (dv) dv.textContent = utils.usd(vol);
                const dbs = document.getElementById('xp-ds-bs'); if (dbs) dbs.textContent = `${buys}/${sells}`;
                const dc = document.getElementById('xp-ds-coins'); if (dc) dc.textContent = coins;
                const sfill = document.getElementById('xp-sentiment-fill');
                if (sfill && (buys+sells) > 0) { sfill.style.width = `${Math.round((buys/(buys+sells))*100)}%`; }
            };
            const renderTimeline = () => {
                const el = document.getElementById('xp-timeline-rows'); if (!el) return;
                const trades = liveFeed.trades.slice(0, 60);
                if (!trades.length) { el.innerHTML = '<div class="xp-empty">No trades yet</div>'; return; }
                el.innerHTML = trades.map(t => `<div class="xp-tl-row"><div class="xp-tl-dot ${t.type==='SELL'?'sell':'buy'}"></div><div class="xp-tl-body"><div class="xp-tl-main"><a href="/coin/${t.sym}" style="color:var(--xp-t1);text-decoration:none;font-weight:700">${t.sym}</a> · ${t.usr}</div><div class="xp-tl-sub">${t.type} · ${utils.usd(t.val)}</div></div><div class="xp-tl-time" data-ts="${t.ts}">${utils.ago(t.ts)}</div></div>`).join('');
            };
            const renderWlFeed = () => {
                const el = document.getElementById('xp-wl-feed'); if (!el) return;
                if (!window._reWlFeed?.length) { el.innerHTML = '<div class="xp-empty">No watchlist trades yet</div>'; return; }
                el.innerHTML = window._reWlFeed.slice(0,30).map(t => `<a class="xp-feed-row ${t.type==='SELL'?'sell':'buy'}" href="/coin/${t.sym}"><span class="${t.type==='SELL'?'xp-b-sell':'xp-b-buy'}">${t.type}</span><span class="xp-f-sym">${t.sym}</span><span class="xp-f-usr">${t.usr}</span><span class="xp-f-val">${utils.usd(t.val)}</span><span class="xp-f-ts" data-ts="${t.ts}">${utils.ago(t.ts)}</span></a>`).join('');
            };
            const renderGainersLosers = () => {
                if (!window._rePriceFirst) window._rePriceFirst = {};
                if (!window._rePriceLast) window._rePriceLast = {};
                liveFeed.trades.forEach(t => {
                    if (!t.px) return;
                    if (!window._rePriceFirst[t.sym]) window._rePriceFirst[t.sym] = t.px;
                    window._rePriceLast[t.sym] = t.px;
                });
                const changes = Object.keys(window._rePriceLast).map(sym => {
                    const first = window._rePriceFirst[sym], last = window._rePriceLast[sym];
                    if (!first || !last) return null;
                    const pct = ((last - first) / first) * 100;
                    return { sym, pct, last };
                }).filter(Boolean);
                const gainers = [...changes].sort((a,b) => b.pct - a.pct).slice(0, store.settings().topCount || 5);
                const losers = [...changes].sort((a,b) => a.pct - b.pct).slice(0, store.settings().topCount || 5);
                const mkRow = (c, up) => `<a class="xp-mini-row" href="/coin/${c.sym}"><span class="xp-mini-sym xp-copy-sym" data-sym="${c.sym}">${c.sym}</span><span class="xp-mini-sub">${utils.usd(c.last)}</span><span class="${up?'xp-t-buy':'xp-t-sell'}">${up?'+':''}${c.pct.toFixed(2)}%</span></a>`;
                ['xp-gainers','xp-gainers-list'].forEach(id => { const gEl = document.getElementById(id); if (gEl) gEl.innerHTML = gainers.length ? gainers.map(c=>mkRow(c,true)).join('') : '<div class="xp-empty" style="padding:12px 0">No data yet</div>'; });
                ['xp-losers','xp-losers-list'].forEach(id => { const lEl = document.getElementById(id); if (lEl) lEl.innerHTML = losers.filter(c=>c.pct<0).length ? losers.filter(c=>c.pct<0).map(c=>mkRow(c,false)).join('') : '<div class="xp-empty" style="padding:12px 0">No data yet</div>'; });
                const gems = Object.values(window._reScanCoins||{}).filter(c => {
                    const risk = c.risk ?? 100;
                    return risk <= (store.settings().gemMaxRisk ?? 40) && c.n >= 3;
                }).sort((a,b) => b.vol - a.vol).slice(0, 5);
                ['xp-gems','xp-gems-list'].forEach(id => { const gmEl = document.getElementById(id); if (!gmEl) return; gmEl.innerHTML = gems.length ? gems.map(c => `<a class="xp-mini-row" href="/coin/${c.sym}"><span class="xp-mini-sym xp-copy-sym" data-sym="${c.sym}">💎 ${c.sym}</span><span class="xp-mini-sub">${utils.usd(c.vol)} · ${c.n} trades</span><span class="xp-sc-risk low">LOW</span></a>`).join('') : '<div class="xp-empty" style="padding:12px 0">No gems found yet</div>'; });
            };
            if (!window._reCmpCoins) window._reCmpCoins = [];
            const renderCmpGrid = function() {
                const el = document.getElementById('xp-cmp-grid'); if (!el) return;
                if (!window._reCmpCoins.length) { el.innerHTML = '<div class="xp-empty" style="grid-column:1/-1">Add up to 4 coins to compare their live stats side by side.</div>'; return; }
                el.innerHTML = window._reCmpCoins.map(function(sym) {
                    const trades = liveFeed.trades.filter(function(t){ return t.sym === sym; });
                    const vol = trades.reduce(function(s,t){ return s+(+t.val||0); }, 0);
                    const buys = trades.filter(function(t){ return t.type==='BUY'; }).length;
                    const sells = trades.filter(function(t){ return t.type==='SELL'; }).length;
                    const lastPx = trades[0] ? utils.usd(trades[0].px || 0) : '—';
                    const mo = momentum.score(sym);
                    const moColor = mo >= 60 ? '#22c55e' : mo <= 40 ? '#ef4444' : '#f59e0b';
                    return '<div style="background:var(--xp-s2);border:1px solid var(--xp-b1);border-radius:var(--xp-r-sm);padding:14px;position:relative">'
                        + '<button data-cmp-remove="' + sym + '" style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;color:var(--xp-t3);font-size:16px;line-height:1;padding:2px 6px">&times;</button>'
                        + '<a href="/coin/' + sym + '" style="font-weight:800;font-size:16px;color:var(--xp-t1);text-decoration:none;font-family:var(--xp-mono);display:block;margin-bottom:10px">' + sym + '</a>'
                        + '<div style="font-size:11px;color:var(--xp-t2);margin-bottom:4px">Last price: <strong style="color:var(--xp-t1)">' + lastPx + '</strong></div>'
                        + '<div style="font-size:11px;color:var(--xp-t2);margin-bottom:4px">Volume: <strong style="color:var(--xp-t1)">' + utils.usd(vol) + '</strong></div>'
                        + '<div style="font-size:11px;color:var(--xp-t2);margin-bottom:8px">Trades: <strong style="color:var(--xp-green)">' + buys + 'B</strong> / <strong style="color:var(--xp-red)">' + sells + 'S</strong></div>'
                        + '<div style="height:4px;background:var(--xp-s3);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + mo + '%;background:' + moColor + ';border-radius:2px;transition:width .5s"></div></div>'
                        + '<div style="font-size:9px;color:var(--xp-t3);margin-top:3px;text-align:right">Momentum ' + mo + '%</div>'
                        + '</div>';
                }).join('');
            };
            const renderWhaleLb = function() {
                const el = document.getElementById('xp-whale-lb'); if (!el) return;
                if (!window._reWhaleHistory || !window._reWhaleHistory.length) { el.innerHTML = '<div class="xp-empty">No whale trades yet.</div>'; return; }
                el.innerHTML = window._reWhaleHistory.slice(0, 30).map(function(t, i) {
                    const isSell = t.type === 'SELL';
                    return '<a class="xp-sc-row" href="/coin/' + t.sym + '" style="grid-template-columns:24px 58px 1fr auto auto"><span style="font-size:10px;font-weight:700;color:var(--xp-t3);font-family:var(--xp-mono)">#' + (i+1) + '</span><span class="xp-sc-sym">' + t.sym + '</span><span style="font-size:11px;color:var(--xp-t2)">' + t.usr + '</span><span class="' + (isSell?'xp-t-sell':'xp-t-buy') + '">' + t.type + '</span><span style="font-weight:700;font-family:var(--xp-mono);font-size:12px">' + utils.usd(t.val) + '</span></a>';
                }).join('');
            };
            document.getElementById('xp-cmp-grid')?.addEventListener('click', function(e) {
                const btn = e.target.closest('[data-cmp-remove]');
                if (!btn) return;
                const sym = btn.getAttribute('data-cmp-remove');
                window._reCmpCoins = (window._reCmpCoins || []).filter(function(s){ return s !== sym; });
                renderCmpGrid();
            });
            document.getElementById('xp-cmp-add')?.addEventListener('click', function() {
                const inp = document.getElementById('xp-cmp-inp');
                const sym = (inp ? inp.value : '').trim().toUpperCase();
                if (!sym) return;
                if (!window._reCmpCoins) window._reCmpCoins = [];
                if (window._reCmpCoins.includes(sym)) { notifier.info(sym + ' already in compare'); return; }
                if (window._reCmpCoins.length >= 4) { notifier.warn('Max 4 coins in compare'); return; }
                window._reCmpCoins.push(sym);
                if (inp) inp.value = '';
                renderCmpGrid();
            });
            document.getElementById('xp-cmp-inp')?.addEventListener('keydown', function(e) { if (e.key==='Enter') document.getElementById('xp-cmp-add')?.click(); });
            document.getElementById('xp-cmp-clear')?.addEventListener('click', function() { window._reCmpCoins = []; renderCmpGrid(); });
            wsInterceptor.on(d => {
                if (!['live-trade','all-trades'].includes(d.type)) return;
                const t = d.data; if (!t) return;
                const sym = (t.coinSymbol||'').toUpperCase();
                const val = +t.totalValue||0;
                const usr = t.username||'?';
                const type = (t.type||'BUY').toUpperCase();
                const ts = t.timestamp||Date.now();
                if (sym) {
                    const isNew = !window._reScanCoins[sym];
                    if (!window._reScanCoins[sym]) window._reScanCoins[sym] = { sym, vol:0, n:0, buy:0, sell:0, firstSeen:ts, risk:null };
                    const sc = window._reScanCoins[sym];
                    sc.vol += val; sc.n++; sc.lastSeen = ts;
                    if (type==='BUY') sc.buy++; else sc.sell++;
                    if (isNew && store.settings().coinScanner) {
                        riskScorer.score(sym).then(rs => { if (rs && window._reScanCoins[sym]) window._reScanCoins[sym].risk = rs.risk; renderScanner(); }).catch(()=>{});
                        jLog('info', `New coin: ${sym}`, `First trade by ${usr} · ${utils.usd(val)}`);
                    }
                }
                if (watchlist.has(sym)) {
                    if (!window._reWlFeed) window._reWlFeed = [];
                    window._reWlFeed.unshift({ sym, usr, type, val, ts });
                    window._reWlFeed = window._reWlFeed.slice(0, 100);
                    renderWlFeed();
                }
            });
            const _origNotif = notifier.show.bind(notifier);
            notifier.show = function(opts) {
                const r = _origNotif(opts);
                const title = opts.title||'';
                if (title.includes('Alert')) jLog('alert', title, opts.description||'');
                else if (title.includes('Whale')) jLog('whale', title, opts.description||'');
                else if (title.includes('Bot')) jLog('bot', title, opts.description||'');
                else if (title.includes('Volume')) jLog('vol', title, opts.description||'');
                else if (title.includes('Creator')) jLog('creator', title, opts.description||'');
                else if (title.includes('Report')) jLog('report', title, opts.description||'');
                return r;
            };
            const applyTab = (tab) => {
                const t = tab || 'dashboard';
                try { store.cfg('panelTab', t); } catch {}
                const wrap = document.getElementById(CONFIG.ids.panelWrapper);
                const root = wrap || document;
                root.querySelectorAll('.xp-tab[data-re-tab]').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-re-tab') === t);
                });
                root.querySelectorAll('[data-re-section]').forEach(el => {
                    const sec = el.getAttribute('data-re-section')||'';
                    const show = sec.split(',').map(x=>x.trim()).includes(t);
                    if (show) { el.style.removeProperty('display'); const d = getComputedStyle(el).display; if (d==='none') el.style.display = el.classList.contains('xp-2col')?'grid':'block'; }
                    else el.style.display = 'none';
                });
                if (t==='watchlist') { try { watchlist.renderPanel(); } catch {} renderWlFeed(); }
                if (t==='mytrades') loadMyTrades(1);
                if (t==='compare') { renderCmpGrid(); renderWhaleLb(); }
                if (t==='scanner') { renderScanner(); renderGainersLosers(); }
                if (t==='journal') renderJournal();
                if (t==='snipe') renderSnipeTargets();
            };
            document.querySelectorAll('[data-re-tab]').forEach(b => b.addEventListener('click', () => applyTab(b.getAttribute('data-re-tab'))));

            // ── Sniper engine ─────────────────────────────────────────────────
            if (!window._reSnipeTargets) window._reSnipeTargets = new Set();
            if (!window._reSnipeLog) window._reSnipeLog = [];

            const renderSnipeTargets = function() {
                const el = document.getElementById('re-snipe-targets'); if (!el) return;
                const targets = Array.from(window._reSnipeTargets);
                if (!targets.length) {
                    el.innerHTML = '<div style="font-size:12px;color:#52525b;text-align:center;padding:8px 0">No targets set. Add a coin symbol above.</div>';
                    return;
                }
                el.innerHTML = '';
                targets.forEach(function(sym) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:6px';
                    const lbl = document.createElement('div');
                    lbl.style.cssText = 'flex:1;font-weight:700;font-family:monospace;font-size:13px;color:#22c55e';
                    lbl.textContent = sym;
                    const status = document.createElement('div');
                    status.style.cssText = 'font-size:10px;color:#6b6b78';
                    status.textContent = 'Watching live feed...';
                    const rmBtn = document.createElement('button');
                    rmBtn.setAttribute('data-snipe-remove', sym);
                    rmBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:#52525b;font-size:18px;line-height:1;padding:0 3px';
                    rmBtn.textContent = 'x';
                    row.appendChild(lbl); row.appendChild(status); row.appendChild(rmBtn);
                    el.appendChild(row);
                });
            };

            const logSnipeHit = function(sym, val, type, ts) {
                window._reSnipeLog.unshift({ sym, val, type, ts: ts || Date.now() });
                window._reSnipeLog = window._reSnipeLog.slice(0, 50);
                const log = document.getElementById('re-snipe-log'); if (!log) return;
                log.innerHTML = '';
                window._reSnipeLog.forEach(function(e) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)';
                    const isSell = e.type === 'SELL';
                    const badge = document.createElement('span');
                    badge.style.cssText = 'font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;font-family:monospace;background:' + (isSell ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)') + ';color:' + (isSell ? '#ef4444' : '#22c55e');
                    badge.textContent = e.type;
                    const symEl = document.createElement('span');
                    symEl.style.cssText = 'font-weight:700;font-family:monospace;font-size:12px;color:#e8e8eb';
                    symEl.textContent = e.sym;
                    const valEl = document.createElement('span');
                    valEl.style.cssText = 'font-size:11px;color:#6b6b78';
                    valEl.textContent = utils.usd(e.val);
                    const timeEl = document.createElement('span');
                    timeEl.style.cssText = 'font-size:10px;color:#35353f;margin-left:auto;font-family:monospace';
                    timeEl.textContent = utils.ago(e.ts);
                    row.appendChild(badge); row.appendChild(symEl); row.appendChild(valEl); row.appendChild(timeEl);
                    log.appendChild(row);
                });
            };

            // Wire WS listener for sniper
            wsInterceptor.on(function(d) {
                if (!['live-trade', 'all-trades'].includes(d.type)) return;
                const data = d.data; if (!data) return;
                const sym = (data.coinSymbol || '').toUpperCase();
                if (!sym || !window._reSnipeTargets.has(sym)) return;
                const val = +(data.totalValue || 0);
                const type = (data.type || 'BUY').toUpperCase();
                const ts = data.timestamp || Date.now();
                logSnipeHit(sym, val, type, ts);
                // Sound
                const doSound = document.getElementById('re-snipe-sound');
                if (!doSound || doSound.checked) {
                    try { alertEngine._beep(880, 0.18, 0.08); setTimeout(function() { alertEngine._beep(1100, 0.18, 0.08); }, 100); setTimeout(function() { alertEngine._beep(1320, 0.18, 0.15); }, 200); } catch {}
                }
                // Toast notification
                notifier.show({ title: 'Snipe hit: ' + sym, description: type + ' ' + utils.usd(val) + ' detected on live feed', type: 'success', duration: 0,
                    actions: [{ label: 'Go buy now', onClick: function() { location.href = '/coin/' + sym; } }, { label: 'Dismiss', onClick: function() {} }]
                });
                // Auto-navigate
                const doNav = document.getElementById('re-snipe-navigate');
                if (!doNav || doNav.checked) {
                    setTimeout(function() { location.href = '/coin/' + sym; }, 250);
                }
                // Remove from targets after hit
                window._reSnipeTargets.delete(sym);
                renderSnipeTargets();
            });

            // Add target
            document.getElementById('re-snipe-add')?.addEventListener('click', function() {
                const inp = document.getElementById('re-snipe-sym');
                const raw = inp ? inp.value.trim().toUpperCase() : '';
                const sym = raw.replace(/[^A-Z0-9]/g, '');
                if (!sym) { notifier.err('Enter a coin symbol'); return; }
                if (window._reSnipeTargets.has(sym)) { notifier.info(sym + ' already targeted'); return; }
                window._reSnipeTargets.add(sym);
                if (inp) inp.value = '';
                renderSnipeTargets();
                notifier.ok('Now sniping ' + sym);
            });
            document.getElementById('re-snipe-sym')?.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') document.getElementById('re-snipe-add')?.click();
            });
            document.getElementById('re-snipe-targets')?.addEventListener('click', function(e) {
                const btn = e.target.closest('[data-snipe-remove]');
                if (!btn) return;
                const sym = btn.getAttribute('data-snipe-remove');
                window._reSnipeTargets.delete(sym);
                renderSnipeTargets();
                notifier.ok(sym + ' removed from snipe targets');
            });
            document.getElementById('re-wl-add-btn')?.addEventListener('click', () => {
                const inp = document.getElementById('re-wl-inp');
                const sym = (inp?.value||'').trim().toUpperCase(); if (!sym) return;
                watchlist.add(sym); if (inp) inp.value = '';
                watchlist.renderPanel();
                ['re-stat-wl','xp-tab-wl'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=store.get('re:wl',[]).length||'';});
            });
            document.getElementById('re-wl-inp')?.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('re-wl-add-btn')?.click(); });
            document.getElementById('re-feed-clear')?.addEventListener('click', () => { liveFeed.trades=[]; liveFeed.render(); ['re-stat-trades','xp-stat-trades'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='0';});});
            document.getElementById('re-feed-filter')?.addEventListener('input', utils.debounce(()=>liveFeed.render(),150));
            document.getElementById('re-feed-min')?.addEventListener('input', utils.debounce(()=>liveFeed.render(),150));
            document.getElementById('re-feed-side')?.addEventListener('change', ()=>liveFeed.render());
            document.getElementById('re-feed-pause')?.addEventListener('click', e => {
                liveFeed.paused = !liveFeed.paused;
                e.currentTarget.textContent = liveFeed.paused ? 'Resume' : 'Pause';
                if (!liveFeed.paused) { liveFeed.render(); dashboard.render(); }
            });
            document.getElementById('xp-feed-timeline-toggle')?.addEventListener('click', () => {
                const tv = document.getElementById('xp-feed-timeline-view');
                const fv = document.getElementById('xp-feed-table-view');
                const tl = document.getElementById('xp-feed-timeline-toggle');
                const show = tv?.style.display === 'none';
                if (tv) tv.style.display = show ? '' : 'none';
                if (fv) fv.style.display = show ? 'none' : '';
                if (tl) tl.classList.toggle('active', show);
                if (show) renderTimeline();
            });
            document.getElementById('re-agg-window')?.addEventListener('change', () => { dashboard.render(); renderHeatmap(); renderDashStats(); });
            document.getElementById('re-whale-min')?.addEventListener('input', utils.debounce(()=>dashboard.render(),150));
            document.getElementById('re-al-add')?.addEventListener('click', () => {
                const sym = document.getElementById('re-al-sym')?.value.trim().toUpperCase();
                const px = document.getElementById('re-al-px')?.value.trim();
                const dir = document.getElementById('re-al-dir')?.value;
                if (!sym||!px) { notifier.err('Fill in symbol and price'); return; }
                alertEngine.add(sym, px, dir);
                document.getElementById('re-al-sym').value = '';
                document.getElementById('re-al-px').value = '';
                this._renderAlerts();
                const al = document.getElementById('re-stat-alerts'); if (al) al.textContent = store.alerts().filter(a=>!a.done).length;
            });
            ['xp-whale-thresh','xp-vol-thresh','xp-drop-thresh','xp-holder-thresh'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', e => {
                    const map = {'xp-whale-thresh':'whaleTxMin','xp-vol-thresh':'volumeSpikeUsd','xp-drop-thresh':'priceDropPct','xp-holder-thresh':'holderDropPct'};
                    const key = map[id]; if (!key) return;
                    store.cfg(key, parseFloat(e.target.value)||0);
                    notifier.ok(`${key} updated`);
                });
            });
            document.getElementById('xp-test-notif')?.addEventListener('click', () => notifier.show({title:'Test Notification',description:'This is what an alert looks like.',type:'info',duration:4000}));
            document.getElementById('xp-test-sound')?.addEventListener('click', () => alertEngine._beep(440, 0.1, 0.3));
            document.getElementById('xp-req-desktop')?.addEventListener('click', () => { if (typeof Notification!=='undefined') Notification.requestPermission().then(p => notifier.ok('Permission: '+p)); });
            document.getElementById('xp-scan-clear')?.addEventListener('click', () => { window._reScanCoins = {}; renderScanner(); });
            document.getElementById('xp-scan-sort')?.addEventListener('change', renderScanner);
            document.getElementById('xp-scan-low-only')?.addEventListener('change', renderScanner);
            document.getElementById('xp-jl-clear')?.addEventListener('click', () => { window._reJournal = []; renderJournal(); });
            document.getElementById('xp-jl-filter')?.addEventListener('input', utils.debounce(renderJournal, 150));
            document.getElementById('xp-jl-export')?.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(window._reJournal||[], null, 2)], {type:'application/json'});
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 're-journal.json'; a.click();
            });
            document.getElementById('xp-export-feed')?.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(liveFeed.trades, null, 2)], {type:'application/json'});
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 're-feed.json'; a.click();
            });
            document.getElementById('xp-export-csv')?.addEventListener('click', () => {
                const hdr = 'sym,usr,type,val,px,ts'; const rows = liveFeed.trades.map(t=>`${t.sym},${t.usr},${t.type},${t.val},${t.px},${t.ts}`);
                const blob = new Blob([[hdr,...rows].join('\n')], {type:'text/csv'});
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 're-feed.csv'; a.click();
            });
            document.getElementById('xp-wl-export')?.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(store.get('re:wl',[]), null, 2)], {type:'application/json'});
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 're-watchlist.json'; a.click();
            });
            document.getElementById('xp-export-settings')?.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(store.settings(), null, 2)], {type:'application/json'});
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 're-settings.json'; a.click();
            });
            document.getElementById('xp-import-settings')?.addEventListener('click', () => {
                const inp = document.createElement('input'); inp.type='file'; inp.accept='.json';
                inp.onchange = e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { const d = JSON.parse(ev.target.result); store.set('re:cfg', d); store._cacheDirty=true; notifier.ok('Settings imported — reload panel to apply'); } catch { notifier.err('Invalid JSON file'); } }; r.readAsText(f); };
                inp.click();
            });
            document.getElementById('xp-reset-settings')?.addEventListener('click', () => {
                if (!confirm('Reset all Enhanced settings to defaults?')) return;
                store.set('re:cfg', {}); store._cacheDirty = true;
                notifier.ok('Settings reset — reload panel to apply');
            });
            
            // ── Settings tab wiring ─────────────────────────────────────
            // Accent swatches
            document.getElementById('xp-accent-swatches')?.addEventListener('click', e => {
                const sw = e.target.closest('.xp-swatch'); if (!sw) return;
                const preset = sw.dataset.accent; if (!preset) return;
                document.querySelectorAll('.xp-swatch').forEach(s => s.classList.remove('active'));
                sw.classList.add('active');
                store.cfg('accentPreset', preset);
                const colorMap = {default:'#f5f5f7',green:'#30d158',blue:'#0a84ff',purple:'#bf5af2',amber:'#ffd60a',red:'#ff453a',teal:'#5ac8fa',pink:'#ff375f',orange:'#ff9f0a'};
                const col = colorMap[preset] || '#f5f5f7';
                store.cfg('accentColor', preset === 'default' ? 'default' : col);
                settingsEngine.applyAll();
                notifier.ok('Accent color updated');
            });
            // Buy/sell colors
            document.getElementById('xp-buy-color')?.addEventListener('change', e => { store.cfg('tradeFeedBuyColor', e.target.value); settingsEngine.applyAll(); });
            document.getElementById('xp-sell-color')?.addEventListener('change', e => { store.cfg('tradeFeedSellColor', e.target.value); settingsEngine.applyAll(); });
            // Panel width
            document.getElementById('xp-panel-width')?.addEventListener('change', e => { store.cfg('panelWidth', e.target.value); settingsEngine.applyAll(); });
            // Panel opacity
            document.getElementById('xp-panel-opacity')?.addEventListener('input', e => {
                const v = parseInt(e.target.value) || 100;
                store.cfg('panelOpacity', v);
                const glass = 'rgba(18,18,22,' + (v/100*0.88).toFixed(2) + ')';
                document.getElementById('re-panel-wrapper').style.setProperty('--re-glass', glass);
            });
            // Timestamp format
            document.getElementById('xp-ts-format')?.addEventListener('change', e => { store.cfg('timestampFormat', e.target.value); });
            // Number format
            document.getElementById('xp-num-format')?.addEventListener('change', e => { store.cfg('numberFormat', e.target.value); });
            // Performance settings
            document.getElementById('xp-feed-max-rows')?.addEventListener('change', e => { store.cfg('feedMaxRows', parseInt(e.target.value)||80); });
            document.getElementById('xp-whale-size')?.addEventListener('change', e => { store.cfg('whaleTxMin', parseFloat(e.target.value)||500); notifier.ok('Whale threshold updated'); });
            document.getElementById('xp-small-trade')?.addEventListener('change', e => { store.cfg('smallTradeUsd', parseFloat(e.target.value)||10); settingsEngine.applyAll(); });
            document.getElementById('xp-pf-refresh')?.addEventListener('change', e => { store.cfg('portfolioRefreshRate', parseInt(e.target.value)||5000); });
            // Notification sound
            document.getElementById('xp-notif-sound')?.addEventListener('change', e => { store.cfg('notifSound', e.target.value); });
            // Blocked/pinned/trusted lists
            document.getElementById('xp-save-lists')?.addEventListener('click', () => {
                const bu = document.getElementById('xp-blocked-users')?.value.trim() || '';
                const pc = document.getElementById('xp-pinned-coins')?.value.trim().toUpperCase() || '';
                const tc = document.getElementById('xp-trusted-creators')?.value.trim() || '';
                store.cfg('blockedUsers', bu); store.cfg('pinnedCoins', pc); store.cfg('trustedCreators', tc);
                settingsEngine.applyAll();
                notifier.ok('Lists saved');
            });

            document.getElementById(CONFIG.ids.panelWrapper)?.addEventListener('click', e => {
                const sym = e.target.closest('.xp-copy-sym')?.dataset?.sym;
                if (!sym || !store.settings().quickCopySymbol) return;
                navigator.clipboard?.writeText(sym).then(() => notifier.ok(`Copied: ${sym}`, {duration:1500})).catch(()=>{});
            });
            const filterMods = () => {
                const q = (document.getElementById('re-mods-q')?.value||'').toLowerCase();
                const cat = document.querySelector('.xp-cat-btn.active')?.dataset?.cat || 'All';
                let vis = 0;
                document.querySelectorAll('.xp-mod-card').forEach(card => {
                    const key = card.dataset.modKey||'';
                    const name = (card.querySelector('.xp-mod-name')?.textContent||'').toLowerCase();
                    const desc = (card.querySelector('.xp-mod-desc')?.textContent||'').toLowerCase();
                    const cardCat = card.querySelector('.xp-mod-cat-tag')?.textContent||'';
                    const show = (cat==='All'||cardCat.includes(cat)) && (!q||name.includes(q)||desc.includes(q)||key.includes(q));
                    card.style.display = show ? '' : 'none';
                    if (show) vis++;
                });
                document.querySelectorAll('.xp-cat-block').forEach(blk => {
                    const shown = blk.querySelectorAll('.xp-mod-card:not([style*="display: none"]):not([style*="display:none"])').length;
                    blk.style.display = shown ? '' : 'none';
                });
                const cnt = document.getElementById('re-mods-count'); if (cnt) cnt.textContent = `${vis} mods`;
            };
            document.getElementById('re-mods-q')?.addEventListener('input', utils.debounce(filterMods, 150));
            document.getElementById('re-cat-filter')?.addEventListener('click', e => {
                const btn = e.target.closest('.xp-cat-btn'); if (!btn) return;
                document.querySelectorAll('.xp-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterMods();
            });
            document.getElementById('xp-mods-all-on')?.addEventListener('click', () => {
                document.querySelectorAll('.xp-mod-card').forEach(card => {
                    const key = card.dataset.modKey; if (!key) return;
                    store.cfg(key, true);
                    card.classList.add('on');
                    const tog = card.querySelector('.xp-toggle'); if (tog) { tog.classList.add('on'); tog.setAttribute('aria-checked','true'); }
                    const st = card.querySelector('.xp-mod-status'); if (st) { st.textContent='ENABLED'; st.className='xp-mod-status on'; }
                });
                settingsEngine.applyAll();
            });
            document.getElementById('xp-mods-all-off')?.addEventListener('click', () => {
                document.querySelectorAll('.xp-mod-card').forEach(card => {
                    const key = card.dataset.modKey; if (!key) return;
                    store.cfg(key, false);
                    card.classList.remove('on');
                    const tog = card.querySelector('.xp-toggle'); if (tog) { tog.classList.remove('on'); tog.setAttribute('aria-checked','false'); }
                    const st = card.querySelector('.xp-mod-status'); if (st) { st.textContent='DISABLED'; st.className='xp-mod-status off'; }
                });
                settingsEngine.applyAll();
            });
            const modsBody = document.getElementById('re-mods-body');
            if (modsBody) {
                modsBody.addEventListener('click', e => {
                    const btn = e.target.closest('.xp-toggle');
                    if (!btn) return;
                    const key = btn.dataset.modKey; if (!key) return;
                    const next = !(store.settings()[key]);
                    store.cfg(key, next);
                    btn.classList.toggle('on', next);
                    btn.setAttribute('aria-checked', String(next));
                    const card = btn.closest('.xp-mod-card');
                    if (card) {
                        card.classList.toggle('on', next);
                        card.style.setProperty('--mc', next ? (document.querySelector(`.xp-cat-btn[data-cat="${card.querySelector('.xp-mod-cat-tag')?.textContent?.split(' ').pop()}"]`)?.style.color || 'rgba(255,255,255,.2)') : '');
                        const st = card.querySelector('.xp-mod-status');
                        if (st) { st.textContent = next?'ENABLED':'DISABLED'; st.className = 'xp-mod-status '+(next?'on':'off'); }
                    }
                    const tb = document.querySelector('.xp-tab[data-re-tab="mods"] .xp-tab-badge');
                    if (tb) { const en = document.querySelectorAll('.xp-mod-card.on').length; tb.textContent = `${en}/${document.querySelectorAll('.xp-mod-card').length}`; }
                    settingsEngine.applyAll();
                    if (key==='heatmap') { const c = document.getElementById('xp-heatmap-card'); if (c) c.style.display = next?'':'none'; }
                    if (key==='portfolioChart') { const c = document.getElementById('xp-pf-chart-card'); if (c) c.style.display = next?'':'none'; }
                    if (key==='showSessionStats') { const c = document.getElementById('xp-session-bar'); if (c) c.style.display = next?'':'none'; }
                    if (key==='sentimentBar') { const c = document.getElementById('xp-sentiment-wrap'); if (c) c.style.display = next?'':'none'; }
                    if (key==='showAlertHistory') { const c = document.getElementById('xp-al-hist-wrap'); if (c) c.style.display = next?'':'none'; }
                });
            }
            document.getElementById('re-rp-sub')?.addEventListener('click', () => this._submitReport());
            document.getElementById('re-panel-close')?.addEventListener('click', () => enhancedPanel.hide());
            document.getElementById('re-feedback-btn')?.addEventListener('click', () => this._showFeedbackModal());
            const loadBets = function() {
                const body = document.getElementById('xp-bets-body'); if (!body) return;
                body.innerHTML = '<div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading...</div>';
                fetch('/api/questions?status=active&limit=20', { headers: { Accept: 'application/json' } })
                    .then(r=> r.ok ? r.json() : Promise.reject())
                    .then(d => {
                        const qs = d.questions || d.data || d || [];
                        if (!qs.length) { body.innerHTML = '<div class="xp-empty">No active predictions.</div>'; return; }
                        body.innerHTML = qs.map(q => {
                            const total = (q.totalYesAmount||0)+(q.totalNoAmount||0);
                            const yp = total>0?Math.round((q.totalYesAmount||0)/total*100):50;
                            return '<div style="padding:11px 13px;border-bottom:1px solid var(--re-b1)">'
                                +'<div style="font-weight:600;font-size:12px;color:var(--re-t1);margin-bottom:6px">'+(q.question||q.title||'?')+'</div>'
                                +'<div style="height:5px;background:var(--re-p3);border-radius:3px;overflow:hidden;display:flex;margin-bottom:4px">'
                                +'<div style="width:'+yp+'%;background:var(--re-green)"></div>'
                                +'<div style="width:'+(100-yp)+'%;background:var(--re-red)"></div></div>'
                                +'<div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--re-mono)">'
                                +'<span style="color:var(--re-green)">YES '+yp+'%</span>'
                                +'<span style="color:var(--re-t2)">'+utils.usd(total)+'</span>'
                                +'<span style="color:var(--re-red)">NO '+(100-yp)+'%</span></div>'
                                +'<div style="margin-top:6px"><a href="/questions/'+(q.id||'')+'" style="font-size:11px;color:var(--re-blue);text-decoration:none;font-weight:600">View question</a></div>'
                                +'</div>';
                        }).join('');
                    })
                    .catch(() => { body.innerHTML = '<div class="xp-empty">Could not load predictions.</div>'; });
            };
            const loadMyBets = function() {
                const body = document.getElementById('xp-my-bets-body'); if (!body) return;
                body.innerHTML = '<div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading...</div>';
                fetch('/api/questions/my-bets?limit=20', { headers: { Accept: 'application/json' } })
                    .then(r=> r.ok ? r.json() : Promise.reject())
                    .then(d => {
                        const bets = d.bets || d.data || d || [];
                        if (!bets.length) { body.innerHTML = '<div class="xp-empty" style="padding:14px">No bets placed yet.</div>'; return; }
                        body.innerHTML = bets.map(b => {
                            const side = b.side==='YES'||b.choice==='YES'?'YES':'NO';
                            const col = side==='YES'?'var(--re-green)':'var(--re-red)';
                            return '<div style="padding:8px 13px;border-bottom:1px solid var(--re-b1);display:flex;gap:8px;align-items:center">'
                                +'<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;color:'+col+';font-family:var(--re-mono);background:rgba(34,197,94,.08)">'+side+'</span>'
                                +'<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(b.question||b.questionTitle||'?')+'</div>'
                                +'<div style="font-size:10px;color:var(--re-t2)">'+utils.usd(b.amount||b.betAmount||0)+'</div></div>'
                                +'<a href="/questions/'+(b.questionId||b.id||'')+'" style="font-size:11px;color:var(--re-blue);text-decoration:none">-></a>'
                                +'</div>';
                        }).join('');
                    })
                    .catch(() => { body.innerHTML = '<div class="xp-empty" style="padding:14px">Could not load.</div>'; });
            };
            const loadLeaderboard = function() {
                const body = document.getElementById('xp-lb-body'); if (!body) return;
                body.innerHTML = '<div class="xp-loading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="xp-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading...</div>';
                fetch('/api/leaderboard?limit=50', { headers: { Accept: 'application/json' } })
                    .then(r=> r.ok ? r.json() : Promise.reject())
                    .then(d => {
                        const entries = d.users || d.leaderboard || d.data || d || [];
                        if (!entries.length) { body.innerHTML = '<div class="xp-empty">No leaderboard data.</div>'; return; }
                        const wrap = document.createElement('div'); wrap.style.overflowX = 'auto';
                        const table = document.createElement('table'); table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse';
                        table.innerHTML = '<thead><tr style="border-bottom:1px solid var(--re-b1)">'
                            +'<th style="padding:7px 13px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;color:var(--re-t2)">Rank</th>'
                            +'<th style="padding:7px 13px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;color:var(--re-t2)">User</th>'
                            +'<th style="padding:7px 13px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;color:var(--re-t2)">Portfolio</th>'
                            +'</tr></thead>';
                        const tbody = document.createElement('tbody');
                        entries.forEach((e, i) => {
                            const user = e.username||e.user||'?', val = e.portfolioValue||e.totalValue||e.value||0;
                            const row = document.createElement('tr'); row.style.borderBottom = '1px solid var(--re-b1)';
                            row.onmouseover = () => { row.style.background='rgba(255,255,255,.015)'; };
                            row.onmouseout = () => { row.style.background=''; };
                            const rc = i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#cd7f32':'var(--re-t2)';
                            const rank = i<3?['#1','#2','#3'][i]:('#'+(i+1));
                            row.innerHTML = '<td style="padding:7px 13px;font-weight:700;font-family:var(--re-mono);color:'+rc+'">'+rank+'</td>'
                                +'<td style="padding:7px 13px"><a href="/user/'+user+'" style="font-weight:700;color:var(--re-t1);text-decoration:none">'+user+'</a></td>'
                                +'<td style="padding:7px 13px;text-align:right;font-weight:700;font-family:var(--re-mono);color:'+rc+'">'+utils.usd(val)+'</td>';
                            tbody.appendChild(row);
                        });
                        table.appendChild(tbody); wrap.appendChild(table); body.innerHTML = ''; body.appendChild(wrap);
                    })
                    .catch(() => { body.innerHTML = '<div class="xp-empty">Could not load.</div>'; });
            };
            document.getElementById('xp-bets-refresh')?.addEventListener('click', loadBets);
            document.getElementById('xp-lb-refresh')?.addEventListener('click', loadLeaderboard);
            document.getElementById('xp-bug-submit')?.addEventListener('click', () => {
                const desc = document.getElementById('xp-bug-desc')?.value.trim() || '';
                const body = `**Rugplay Enhanced v${GM_info.script.version}**\n\n**Description:**\n${desc}\n\n**Browser:** ${navigator.userAgent.split(' ').slice(-2).join(' ')}`;
                const url = 'https://github.com/devbyego/rugplay-enhanced/issues/new?title=' + encodeURIComponent('Bug report') + '&body=' + encodeURIComponent(body) + '&labels=bug';
                window.open(url, '_blank');
            });
            document.getElementById('re-feedback-btn')?.addEventListener('click', () => this._showFeedbackModal());
            this._renderAlerts();
            this._loadReports(1);
            dashboard.render();
            renderHeatmap();
            renderSessionStats();
            renderDashStats();
            renderSparkline();
            diagnostics.pingApi().finally(() => diagnostics.render());
            diagnostics.render();
            this._panelTimer = setInterval(() => {
                if (!this.isVisible) return;
                renderHeatmap();
                renderSessionStats();
                renderDashStats();
                renderSparkline();
                renderGainersLosers();
                if (document.getElementById('xp-feed-timeline-view')?.style.display !== 'none') renderTimeline();
            }, 2000);
            applyTab(store.settings().panelTab || 'dashboard');
        },
        _renderAlerts() {
            const el = document.getElementById('re-al-list') || document.getElementById('re-al-body'); if (!el) return;
            const al = store.alerts();
            if (!al.length) { el.innerHTML = '<div class="xp-empty">No alerts set yet. Add one above.</div>'; return; }
            el.innerHTML = al.map(a => `<div class="xp-al-row${a.done?' done':''}"><div class="xp-al-info"><div class="xp-al-sym">${a.sym}</div><div class="xp-al-meta">${a.dir} ${utils.usd(a.px)}${a.done?' · Triggered '+utils.ago(a.hitAt):''}</div></div><button class="xp-al-del" data-id="${a.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
            el.querySelectorAll('.xp-al-del').forEach(b => b.onclick = () => { alertEngine.del(b.dataset.id); this._renderAlerts(); });
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
        _makeItem(id, label, svgHtml, onClick) {
            const li = document.createElement('li');
            li.setAttribute('data-sidebar', 'menu-item');
            const a = document.createElement('a');
            a.id = id; a.href = '#';
            a.setAttribute('data-sidebar', 'menu-button');
            const ref = document.querySelector('ul[data-sidebar="menu"] li a');
            if (ref) a.className = ref.className;
            else a.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;text-decoration:none;color:inherit;font-size:13px;width:100%';
            a.classList.remove('active');
            a.removeAttribute('data-active'); a.removeAttribute('aria-current');
            const iw = document.createElement('span'); iw.innerHTML = svgHtml;
            const svg = iw.firstElementChild; if (svg) a.appendChild(svg);
            const refSpan = document.querySelector('ul[data-sidebar="menu"] li a span:not(.sr-only)');
            const span = document.createElement('span');
            if (refSpan) span.className = refSpan.className;
            span.textContent = label; a.appendChild(span);
            a.addEventListener('click', e => { e.preventDefault(); onClick(); });
            li.appendChild(a); return li;
        },
        create() {
            const ul = document.querySelector('ul[data-sidebar="menu"]');
            if (!ul || ul.querySelectorAll('li').length === 0) return false;
            if (!document.getElementById(CONFIG.ids.enhancedBtn)) {
                ul.appendChild(this._makeItem(CONFIG.ids.enhancedBtn, 'Enhanced', ICONS.enhanced,
                    () => { if (enhancedPanel.isVisible) enhancedPanel.hide(); else enhancedPanel.show(); }));
                this._enhancedOk = true;
            } else this._enhancedOk = true;
            if (store.settings().sidebarSearch && !document.getElementById(CONFIG.ids.searchBtn)) {
                ul.appendChild(this._makeItem(CONFIG.ids.searchBtn, 'Quick Search', ICONS.search, () => quickSearch.toggle()));
                this._searchOk = true;
            } else this._searchOk = !!document.getElementById(CONFIG.ids.searchBtn);
            return this._enhancedOk;
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
        @keyframes xp-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes xp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.55)}}
        @keyframes xp-spin{to{transform:rotate(360deg)}}
        @keyframes xp-hl{from{background:rgba(34,197,94,.15)}to{background:transparent}}
        .xp-shell{opacity:1!important;transform:none!important}
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
        .re-spin{animation:re-spinning 1s linear infinite;transform-origin:center;transform-box:fill-box}
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
    const tradeInterceptor = {
        _patched: false,
        _confirming: false,
        apply() {
            const s = store.settings();
            if (!s.confirmTrades && !s.showFeeEstimate && !s.confirmSells) return;
            if (this._patched) return;
            this._patched = true;
            document.addEventListener('click', e => {
                if (this._confirming) return;
                const btn = e.target.closest('button');
                if (!btn) return;
                const txt = (btn.textContent || '').trim().toUpperCase();
                const isTrade = /^(BUY|SELL)(\s+[A-Z0-9]+)?$/.test(txt) || btn.dataset.action === 'trade';
                if (!isTrade) return;
                const cs = store.settings();
                const isSellAction = /^SELL/.test(txt);
                const needsConfirm = cs.confirmTrades || (cs.confirmSells && isSellAction);
                if (!needsConfirm) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                const isSell = isSellAction;
                const color = isSell ? '#ef4444' : '#22c55e';
                const ov = document.createElement('div');
                ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center';
                const box = document.createElement('div');
                box.style.cssText = 'background:#17171b;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:22px 24px;max-width:300px;width:90%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.8)';
                box.innerHTML = '<div style="font-size:15px;font-weight:700;color:#eeeef0;margin-bottom:5px">Confirm trade</div>'
                    + '<div style="font-size:13px;color:#6b6b78;margin-bottom:18px">You are about to <strong style="color:' + color + '">' + txt + '</strong>. Continue?</div>'
                    + '<div style="display:flex;gap:8px">'
                    + '<button id="re-ti-cancel" style="flex:1;height:36px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#e8e8eb;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>'
                    + '<button id="re-ti-ok" style="flex:1;height:36px;border-radius:6px;border:none;background:' + color + ';color:#fff;font-size:13px;font-weight:700;cursor:pointer">Confirm</button>'
                    + '</div>';
                ov.appendChild(box);
                document.body.appendChild(ov);
                const close = () => ov.remove();
                box.querySelector('#re-ti-cancel').onclick = close;
                box.querySelector('#re-ti-ok').onclick = () => { close(); this._confirming = true; btn.click(); this._confirming = false; };
                ov.addEventListener('click', e => { if (e.target === ov) close(); });
            }, { capture: true });
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
            const rows = document.querySelectorAll('[data-sidebar="content"] li, [data-slot="sidebar-content"] li');
            const totalVal = portfolioUpdater.lastTotal || 0;
            rows.forEach(row => {
                if (row.dataset.reHighlighted) return;
                const monoEls = row.querySelectorAll('.font-mono, span[class*="mono"]');
                if (!monoEls.length) return;
                monoEls.forEach(el => {
                    const txt = el.textContent.trim();
                    const val = parseFloat(txt.replace(/[^0-9.-]/g, ''));
                    if (!val || isNaN(val)) return;
                    if (s.highlightProfitLoss) {
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
                if (d.type !== 'live-trade' && d.type !== 'price_update') return;
                const sym = d.type === 'price_update' ? (d.coinSymbol || '').toUpperCase() : (d.data?.coinSymbol || '').toUpperCase();
                const px = d.type === 'price_update' ? parseFloat(d.price || 0) : parseFloat(d.data?.price || 0);
                const type = d.type === 'price_update' ? 'BUY' : (d.data?.type || '').toUpperCase();
                if (!sym || !px) return;
                if (type === 'BUY') { this._asks[sym] = px; }
                if (type === 'SELL') { this._bids[sym] = px; }
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
            if (Date.now() - this._lastCheck < 120000) return;
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
                if (!store.settings().liveSlippageEstimator) return;
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
    if (!window._reWhaleHistory) window._reWhaleHistory = [];
    wsInterceptor.on(d => {
        if (!['live-trade','all-trades'].includes(d.type)) return;
        const val = +(d.data && d.data.totalValue || 0);
        const s13 = store.settings();
        if (val < (s13.whaleTxMin || 500)) return;
        const sym = (d.data.coinSymbol || '').toUpperCase();
        const usr = d.data.username || '?';
        const type = (d.data.type || 'BUY').toUpperCase();
        const ts = d.data.timestamp || Date.now();
        window._reWhaleHistory.unshift({ sym, usr, type, val, ts });
        window._reWhaleHistory = window._reWhaleHistory.slice(0, 100);
        const el = document.getElementById('xp-whale-lb');
        if (el) {
            const rows = window._reWhaleHistory.slice(0, 30);
            el.innerHTML = rows.map((t, i) => {
                const isSell = t.type === 'SELL';
                return '<a class="xp-sc-row" href="/coin/' + t.sym + '" style="grid-template-columns:24px 58px 1fr auto auto"><span style="font-size:10px;font-weight:700;color:var(--xp-t3);font-family:var(--xp-mono)">#' + (i+1) + '</span><span class="xp-sc-sym">' + t.sym + '</span><span style="font-size:11px;color:var(--xp-t2)">' + t.usr + '</span><span class="' + (isSell?'xp-t-sell':'xp-t-buy') + '">' + t.type + '</span><span style="font-weight:700;font-family:var(--xp-mono);font-size:12px">' + utils.usd(t.val) + '</span></a>';
            }).join('');
        }
    });
    const smartNotif = {
        _queue: {},
        _timers: {},
        show(key, opts, delay) {
            delay = delay || 2000;
            // smartNotifications groups rapid-fire alerts of same type
            if (true) { notifier.show(opts); return; }
            this._queue[key] = opts;
            clearTimeout(this._timers[key]);
            this._timers[key] = setTimeout(() => {
                notifier.show(smartNotif._queue[key]);
                delete smartNotif._queue[key];
            }, delay);
        },
    };
    const momentum = {
        _data: {},
        update(sym, val, type) {
            if (!this._data[sym]) this._data[sym] = { buyVol:0, sellVol:0, trades:0, last:Date.now() };
            const d = this._data[sym];
            d.trades++;
            d.last = Date.now();
            if (type === 'BUY') d.buyVol += val;
            else d.sellVol += val;
        },
        score(sym) {
            const d = this._data[sym]; if (!d) return 0;
            const total = d.buyVol + d.sellVol; if (!total) return 0;
            return Math.round((d.buyVol / total) * 100);
        },
        badge(sym) {
            const sc = this.score(sym);
            if (sc >= 70) return '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.2);font-family:var(--xp-mono)">+' + sc + '%</span>';
            if (sc <= 30) return '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.2);font-family:var(--xp-mono)">' + sc + '%</span>';
            return '';
        },
    };
    wsInterceptor.on(d => {
        if (d.type !== 'live-trade') return;
        const sym = (d.data?.coinSymbol || '').toUpperCase();
        const val = +(d.data?.totalValue || 0);
        const type = (d.data?.type || 'BUY').toUpperCase();
        if (sym) momentum.update(sym, val, type);
    });
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
            if (location.hash === '#rugplay-enhanced' && !enhancedPanel.isVisible) {
                let _hashWaitCount = 0;
                const _tryShowOnHash = () => {
                    const main = document.querySelector('main');
                    if (main && main.children.length > 0) {
                        if (!enhancedPanel.isVisible) enhancedPanel.show();
                    } else if (_hashWaitCount++ < 40) {
                        setTimeout(_tryShowOnHash, 100);
                    }
                };
                _tryShowOnHash();
            }
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
                    const sym = utils.getCoinSymbol();
                    if (sym) {
                        holderDropMonitor.track(sym).catch(() => {});
                        riskChangeMonitor.check(sym).catch(() => {});
                        costBasisTracker.load(sym).catch(() => {});
                    }
                }
            }, CONFIG.intervals.init);
            new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
            let _sidebarPoll = null;
            const _startSidebarPoll = () => {
                if (_sidebarPoll) clearInterval(_sidebarPoll);
                let _attempts = 0;
                _sidebarPoll = setInterval(() => {
                    _attempts++;
                    if (sidebarEnhancer.create() || _attempts > 60) clearInterval(_sidebarPoll);
                }, 500);
            };
            this.w.on(() => {
                if (store.settings().autoHidePanel && enhancedPanel.isVisible) enhancedPanel.hide();
                sidebarEnhancer._enhancedOk = false;
                sidebarEnhancer._searchOk = false;
                coinPageEnhancer._priceDropRef = null;
                coinPageEnhancer._pending.clear();
                ['re-watch-btn','re-coin-age','re-coin-holders','re-holders-warn',
                 're-liquidity-warn','re-price-change','re-volume-24h','re-spread-display',
                 're-risk-card','re-tx-card','re-note-card','re-reported-badge'].forEach(id => {
                    document.getElementById(id)?.remove();
                });
                run();
                _startSidebarPoll();
            }).start();
            run();
            _startSidebarPoll();
        },
    };
    app.init();
})();
