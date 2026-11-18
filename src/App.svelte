<script>
  // Wires settings, the market feed, the wake lock and the updater to the
  // board, and owns the one quiet control: the settings button.
  import { onMount, mount, unmount, tick as flushed } from 'svelte';
  import PriceBoard from './components/PriceBoard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { createSettings, sameAsset, MAX_ASSETS } from './lib/settings.js';
  import { createBoardFeed, describeMarket } from './lib/feed.js';
  import { EXCHANGES } from './lib/exchanges/index.js';
  import { createWakeLock } from './lib/wake-lock.js';
  import { createUpdater } from './lib/updater.js';
  import { describeState } from './lib/status.js';
  import { tabTitle } from './lib/format.js';
  import { createQuietControls } from './lib/quiet-controls.js';
  import { createMarketList } from './lib/markets.js';
  import { createPacer } from './lib/pace.js';
  import { createBeat } from './lib/steady.js';
  import { installOffer, isStandalone } from './lib/install.js';
  import { createHistory } from './lib/history.js';
  import { m } from './paraglide/messages.js';
  import { getLocale } from './paraglide/runtime.js';
  import { Toaster } from '$lib/components/ui/sonner/index.js';
  import { toast } from 'svelte-sonner';

  const version = __APP_VERSION__;
  // Storage can throw on access (private mode): run on defaults without it.
  function storage(name) { try { return window[name]; } catch { return null; } }
  const store = createSettings(storage('localStorage'));
  // One pacer for everything sent to an exchange: the price connection and the coin list.
  const pacer = createPacer({ now: Date.now, store: storage('sessionStorage') });
  const markets = createMarketList({ fetch: (url) => window.fetch(url), pacer });

  let settings = $state(store.get());
  let previewBrightness = $state(null);
  // Per asset, keyed by assetKey: the price on screen and the feed's state.
  let ticks = $state.raw({});
  let feedStates = $state.raw({});
  let now = $state(Date.now());
  let visible = $state(document.visibilityState === 'visible');
  let wake = $state({ kind: 'pending', message: '', canRetry: false });
  let cache = $state({ state: 'waiting', version: null });
  let updateReady = $state(false);
  let controlsVisible = $state(false);
  let panelOpen = $state(false);
  let toggleButton;
  // A new board says once how to reach settings, until the screen is first
  // touched (or a key pressed). Left alone, it goes after a while and comes back
  // next time, since nobody may have been looking.
  const HINT_KEY = 'coinboard-hint-seen';
  let hint = $state(false);
  let hintTimer;
  // Adding to the home screen: offered in settings (and in a line of the hint)
  // while the app runs in a browser tab. A browser with its own install prompt
  // hands it over before showing it; the button in settings opens it.
  const INSTALL_KEY = 'coinboard-install-dismissed';
  let installPrompt = $state.raw(null);
  let standalone = $state(isStandalone({ matchMedia: window.matchMedia?.bind(window), navigator }));
  const install = $derived(installOffer({ standalone, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, canPrompt: !!installPrompt }));
  let installDismissed = $state(false);
  try { installDismissed = storage('localStorage')?.getItem(INSTALL_KEY) === '1'; } catch { /* offered again next time */ }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
  window.addEventListener('appinstalled', () => { installPrompt = null; standalone = true; });
  function dismissInstall() {
    installDismissed = true;
    try { storage('localStorage')?.setItem(INSTALL_KEY, '1'); } catch { /* offered again next time */ }
  }
  async function runInstall() {
    const prompt = installPrompt;
    if (!prompt) return;
    // A prompt can be shown once; a declined one may come back later.
    installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* nothing to do */ }
  }
  // The small window that stays on top (desktop Chrome and Edge): the same
  // board, drawn to the small window's size, with the same prices. Opened
  // only by a press, as the browser requires.
  const pipSupported = 'documentPictureInPicture' in window;
  let pipWindow = $state.raw(null);
  async function togglePip() {
    if (pipWindow) { pipWindow.close(); return; }
    let win;
    try { win = await window.documentPictureInPicture.requestWindow({ width: 380, height: Math.min(96 + 72 * settings.assets.length, 520) }); }
    catch { return; }
    const doc = win.document;
    doc.title = 'Coinboard';
    doc.documentElement.lang = getLocale();
    // The board's own stylesheet (and the dev server's style tags), by absolute address.
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
      if (sheet.tagName === 'LINK') { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; doc.head.append(link); }
      else doc.head.append(sheet.cloneNode(true));
    }
    const app = mount(PriceBoard, { target: doc.body, props: {
      get settings() { return settings; }, get ticks() { return assetTicks; }, get statuses() { return statuses; }, get charts() { return assetCharts; },
      get brightness() { return previewBrightness ?? settings.brightness; }, get active() { return visible; }, view: win,
    } });
    win.addEventListener('pagehide', () => { unmount(app); pipWindow = null; }, { once: true });
    pipWindow = win;
  }
  // The small window follows the board's colours and its burn-in care.
  $effect(() => {
    if (!pipWindow) return;
    pipWindow.document.body.dataset.palette = settings.palette;
    pipWindow.document.body.classList.toggle('oled', settings.burnIn);
  });
  function hintSeen() {
    if (!hint) return;
    hint = false; clearTimeout(hintTimer);
    try { storage('localStorage')?.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ }
  }
  let feed, wakeLock, updater, controls, cursorTimer;
  const assetKey = asset => `${asset.currency}:${asset.ticker}`;
  // Prices can arrive several times a second and at a different moment for
  // each coin. The board changes on one beat, every three seconds at most,
  // all its places at once, each to the latest price it was sent; a place's
  // first price is shown at once.
  const beat = createBeat({ intervalMs: 3000, onValues(batch) { ticks = { ...ticks, ...Object.fromEntries(batch) }; } });

  const statuses = $derived(settings.assets.map(asset => describeState(feedStates[assetKey(asset)] ?? null, now)));
  const assetTicks = $derived(settings.assets.map(asset => ticks[assetKey(asset)] ?? null));
  // The line chart's past prices, per asset and period. Asked again every
  // minute while the board is shown; the history keeps each answer while it is fresh.
  const history = createHistory({ fetch: url => window.fetch(url) });
  let charts = $state.raw({});
  const assetCharts = $derived(settings.assets.map(asset => charts[`${assetKey(asset)}:${settings.chart}`] ?? null));
  $effect(() => {
    const period = settings.chart, assets = settings.assets;
    if (period === 'off' || !visible) return;
    const refresh = () => {
      for (const asset of assets) {
        const key = `${assetKey(asset)}:${period}`;
        history.load(asset.currency, asset.ticker, period).then(points => { if (points && charts[key] !== points) charts = { ...charts, [key]: points }; });
      }
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  });
  // The worst of all: one asset in trouble is enough to say so.
  const RANK = { ok: 0, warn: 1, bad: 2 };
  const worst = $derived(statuses.reduce((level, next) => RANK[next.level] > RANK[level] ? next.level : level, 'ok'));
  // The settings panel speaks of the asset in the most trouble (the first, when all is well).
  const status = $derived(statuses.find(next => next.level === worst) ?? statuses[0]);
  // The installed offline copy normally matches the page. Say so only when it
  // does not: that is a board still showing an older page.
  const versionLabel = $derived(cache.state === 'unsupported' ? m.version_offline_unsupported({ version })
    : cache.state === 'unknown' ? m.version_copy_unknown({ version })
    : cache.state === 'known' && cache.version !== version ? m.version_copy({ version, copy: cache.version })
    : m.version({ version }));
  // The status dot in the corner: one colour for how things are, and the detail
  // on hover or tap. English, like everything else on the board.
  // Only a lost or refused wake lock counts; a device without the feature is
  // reported in the settings panel alone.
  const wakeLost = $derived(wake.kind === 'released' || wake.kind === 'failed');
  const level = $derived(worst === 'ok' && wakeLost ? 'warn' : worst);
  // One asset: where it comes from and how it is. Several: a line each.
  const tip = $derived.by(() => {
    const markets = settings.assets.map(asset => describeMarket(asset.currency, asset.ticker));
    const lines = markets.length === 1 ? [`${markets[0].label} · ${markets[0].pair}`, statuses[0].title]
            // The same coin and currency from two exchanges: name the exchange too.
      : markets.map((market, index) => `${market.symbol}${markets.some((other, at) => at !== index && other.symbol === market.symbol) ? ` ${market.label.split(' ')[0]}` : ''} · ${statuses[index].title}`);
    return [...lines, wakeLost ? 'SCREEN MAY SLEEP' : ''].filter(Boolean).join('\n');
  });
  // A mouse shows the detail by hovering, and that is all: a click pins nothing.
  // Touch has no hover, so a tap opens it; it closes after a few seconds, on a
  // second tap, or on a tap anywhere else.
  let tipShown = $state(false);
  let tipTimer;
  function hideTip() { clearTimeout(tipTimer); tipShown = false; }
  function tapDot(event) {
    if (event.pointerType === 'mouse') return;
    if (tipShown) { hideTip(); return; }
    tipShown = true;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 4000);
  }

  // The browser tab shows the first asset's price, at the same pace as the board.
  $effect(() => { document.title = tabTitle(describeMarket(settings.assets[0].currency, settings.assets[0].ticker), assetTicks[0]); });
  $effect(() => {
    document.body.classList.toggle('controls-visible', controlsVisible);
    document.body.classList.toggle('settings-open', panelOpen);
    document.body.dataset.palette = settings.palette;
    document.body.classList.toggle('oled', settings.burnIn);
  });
  // The "N초 후" countdowns only matter while something is wrong.
  $effect(() => {
    if (!visible) return;
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });

  // A short message at the bottom of the screen (a toast).
  function showToast(message) { toast(message, { duration: 2500 }); }
  function save(patch) {
    const { saved } = store.update(patch);
    settings = store.get();
    if (!saved) showToast(m.toast_not_saved());
  }
  function applySelection() {
    // Forget prices of assets no longer shown, so one that comes back starts afresh.
    const keys = new Set(settings.assets.map(assetKey));
    for (const key of Object.keys(ticks)) if (!keys.has(key)) beat.forget(key);
    ticks = Object.fromEntries(Object.entries(ticks).filter(([key]) => keys.has(key)));
    feedStates = Object.fromEntries(Object.entries(feedStates).filter(([key]) => keys.has(key)));
    feed.select(settings.assets);
  }
  function changeAssets(assets) { save({ assets }); applySelection(); }
  const canAdd = $derived(settings.assets.length < MAX_ASSETS);
  // A new asset, chosen in the add form. '' when added, or why not.
  function addAsset(next) {
    if (settings.assets.length >= MAX_ASSETS) return '';
    if (settings.assets.some(asset => sameAsset(asset, next))) return m.asset_duplicate();
    changeAssets([...settings.assets, next]);
    return '';
  }
  // A new order, as dragged in settings.
  function reorderAssets(order) { changeAssets(order); }
  // Deleting is one tap, so it can be undone for a few seconds: the asset goes
  // back where it was, unless it has meanwhile been added again or the board is full.
  function removeAsset(index) {
    if (settings.assets.length <= 1) return;
    const removed = settings.assets[index];
    changeAssets(settings.assets.filter((_, position) => position !== index));
    toast(m.asset_removed({ name: `${removed.ticker} ${EXCHANGES[removed.currency].choice}` }), {
      duration: 5000,
      action: { label: m.undo(), onClick() {
        if (settings.assets.length >= MAX_ASSETS || settings.assets.some(asset => sameAsset(asset, removed))) return;
        const assets = [...settings.assets]; assets.splice(Math.min(index, assets.length), 0, removed);
        changeAssets(assets);
      } },
    });
  }

  function openPanel() { panelOpen = true; controls.reveal(); controls.touch(); }
  // returnFocus is false for a tap outside, which is a way of leaving.
  async function closePanel(returnFocus) {
    panelOpen = false;
    previewBrightness = null;
    controls.touch();
    await flushed();
    if (returnFocus) toggleButton.focus();
    controls.settle();
    updater.settingsClosed();
  }

  // The page's language is the reader's (from the device), for screen readers and type.
  document.documentElement.lang = getLocale();
  onMount(() => {
    feed = createBoardFeed({
      online: navigator.onLine, pacer,
      onTick(next) {
        const key = assetKey(next.selection);
        if (settings.assets.some(asset => assetKey(asset) === key)) beat.push(key, next);
      },
      onState(next) {
        const key = assetKey(next.selection);
        if (settings.assets.some(asset => assetKey(asset) === key)) feedStates = { ...feedStates, [key]: next };
      },
    });
    applySelection();
    wakeLock = createWakeLock({ navigator, document, window, onChange(next) { wake = next; } });
    updater = createUpdater({
      navigator, location: window.location, document, version, workerUrl: './sw.js',
      storage: storage('sessionStorage'), clock: { setInterval: window.setInterval.bind(window) }, window,
      isSettingsOpen: () => panelOpen,
      onCacheVersion(next) { cache = next; }, onUpdateReady() { updateReady = true; },
    });
    updater.start();

    // When the settings button shows, and what a tap outside the panel does.
    controls = createQuietControls({
      // The toasts count as part of the panel: undoing a delete there leaves it open.
      document, controls: '#settings-toggle, #admin-panel, [data-sonner-toaster]', panel: '#admin-panel, [data-sonner-toaster]',
      isPanelOpen: () => panelOpen,
      onVisible(value) { controlsVisible = value; },
      onOutsideTap() { closePanel(false); },
      onPanelIdle() { closePanel(false); },
    });

    // Being hidden (another tab in front) does not disconnect: the price in the
    // tab title stays live. Only leaving the page does. What "visible" governs
    // is the board's own activity: its countdown and its burn-in drift.
    function setVisible(value) {
      visible = value;
      // Shown again after a pagehide that no pageshow followed: switch back on.
      if (value) feed.setActive(true);
      // Back in view with a feed that is not live: reconnect now rather than
      // wait out a backoff that began while nobody was looking.
      if (value && Object.values(feedStates).some(state => state.kind !== 'live')) feed.retry();
    }
    try { hint = storage('localStorage')?.getItem(HINT_KEY) !== '1'; } catch { hint = true; }
    if (hint) hintTimer = setTimeout(() => { hint = false; }, 15000);
    const listeners = [
      [document, 'pointerdown', hintSeen, true],
      [document, 'keydown', hintSeen, true],
      [document, 'visibilitychange', () => setVisible(document.visibilityState === 'visible')],
      [document, 'pointerdown', event => { if (tipShown && !event.target.closest('#status-dot')) hideTip(); }],
      [window, 'pagehide', () => { visible = false; feed.setActive(false); }],
      // pageshow also fires when the page first loads. The feed is switched on
      // either way (a no-op when it already is, so the connection being made is
      // kept); only a page brought back from the back-forward cache (persisted)
      // has anything to catch up on.
      [window, 'pageshow', event => { feed.setActive(true); if (event.persisted) setVisible(document.visibilityState === 'visible'); }],
      [window, 'online', () => feed.setOnline(true)],
      [window, 'offline', () => feed.setOnline(false)],
      // Hide the mouse pointer on an idle fullscreen board.
      [document, 'mousemove', () => {
        document.body.style.cursor = 'auto'; clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => { document.body.style.cursor = document.fullscreenElement ? 'none' : 'auto'; }, 2000);
      }],
    ];
    for (const [target, name, handler, capture] of listeners) target.addEventListener(name, handler, capture);
    return () => {
      for (const [target, name, handler, capture] of listeners) target.removeEventListener(name, handler, capture);
      clearTimeout(cursorTimer); clearTimeout(tipTimer); clearTimeout(hintTimer);
      controls.dispose(); feed.dispose(); wakeLock.dispose(); beat.reset();
    };
  });
</script>

{#if panelOpen}
  <div id="scrim"></div>
  <SettingsPanel {settings} {canAdd} {install} {installDismissed} {pipSupported} pipOpen={!!pipWindow} onPip={togglePip} onInstall={runInstall} onDismissInstall={dismissInstall} ticks={assetTicks} {status} {wake} {versionLabel} {updateReady}
    onClose={closePanel}
    onAdd={addAsset}
    onColumns={columns => save({ columns })}
    onRemove={removeAsset}
    onReorder={reorderAssets}
    onBrightnessPreview={value => { previewBrightness = value; }}
    onBrightness={value => { previewBrightness = null; save({ brightness: value }); }}
    onBurnIn={burnIn => save({ burnIn })}
    onPalette={palette => save({ palette })}
    onChart={chart => save({ chart })}
    onRetryFeed={() => feed.retry()}
    onRetryWake={() => wakeLock.retry()}
    onUpdate={() => updater.reload()}
    loadTickers={currency => markets.load(currency)} />
{/if}
<button id="settings-toggle" bind:this={toggleButton} type="button" aria-label={m.settings_open()} aria-controls="admin-panel" aria-expanded={panelOpen} onclick={openPanel}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.5-2 .9L4.4 6 2 10l1.9 1.8v.4L2 14l2.4 4 2.4-.4 2 .9.7 2.5h5l.7-2.5 2-.9 2.4.4L22 14l-1.9-1.8v-.4L22 10l-2.4-4-2.4.4-2-.9-.7-2.5z"/><circle cx="12" cy="12" r="3"/></svg>
</button>
<Toaster position="bottom-center" />
{#if hint}<p id="first-hint" role="status">{m.help_hint()}{#if install}<span class="hint-more">{m.help_hint_install()}</span>{/if}</p>{/if}
<div id="status-dot" data-level={level} class:show={tipShown} class:quiet={settings.burnIn && level === 'ok' && !tipShown && !controlsVisible && !panelOpen} role="img" aria-label={tip} onpointerdown={tapDot}><span id="status-tip">{tip}</span></div>
<PriceBoard {settings} ticks={assetTicks} charts={assetCharts} {statuses} brightness={previewBrightness ?? settings.brightness} active={visible} />
