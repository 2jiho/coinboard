<script>
  // Wires settings, the market feed, the wake lock and the updater to the
  // board, and owns the one quiet control: the settings button.
  import { onMount, mount, unmount, untrack, tick as flushed } from 'svelte';
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
  import { createHistory, extend } from './lib/history.js';
  import { createSwipeBrightness } from './lib/swipe-brightness.js';
  import { m } from './paraglide/messages.js';
  import { getLocale } from './paraglide/runtime.js';
  import { Toaster } from '$lib/components/ui/sonner/index.js';
  import { toast } from 'svelte-sonner';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { PictureInPictureOnIcon, PictureInPictureExitIcon, MonitorIcon, MonitorOffIcon, RefreshIcon } from '@hugeicons/core-free-icons';

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
  // Brightness by swiping the board up or down: the level shown while the
  // finger moves, and whether the indicator is up.
  let swipeLevel = $state(null), swipeShown = $state(false), swipeHideTimer;
  // In steps of 5, as video players do.
  const BRIGHTNESS_MIN = 10, BRIGHTNESS_MAX = 100, BRIGHTNESS_STEP = 5;
  const hudLevel = $derived(swipeLevel ?? settings.brightness);
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
  let pipOpening = false;
  async function togglePip() {
    if (pipWindow) { pipWindow.close(); return; }
    // A second press while the window is being opened does nothing.
    if (pipOpening) return;
    pipOpening = true;
    let win;
    try { win = await window.documentPictureInPicture.requestWindow({ width: 380, height: Math.min(96 + 72 * settings.assets.length, 520) }); }
    catch { return; }
    finally { pipOpening = false; }
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
    win.addEventListener('pagehide', () => { unmount(app); if (pipWindow === win) pipWindow = null; }, { once: true });
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
  // The line chart's past prices, per asset and period. Candles are asked for
  // once the price connections have started (so a chart never takes the first
  // turn from a price), taking turns with them (the pacer), and then rarely:
  // in between, each new price drawn carries the chart along (extend).
  const history = createHistory({ fetch: (url, init) => window.fetch(url, init), pacer });
  let charts = $state.raw({});
  let chartsReady = $state(false);
  const assetCharts = $derived(settings.assets.map(asset => charts[`${assetKey(asset)}:${settings.period}`] ?? null));
  // The candles each chart was last drawn from: a newer answer replaces the chart; the same one leaves it be.
  const drawnFrom = new Map();
  $effect(() => {
    const period = settings.period, assets = settings.assets;
    // The pop-out window keeps its chart current while this tab is behind others.
    if (!settings.chart || !chartsReady || !(visible || pipWindow)) return;
    const refresh = () => {
      for (const asset of assets) {
        const key = `${assetKey(asset)}:${period}`;
        history.load(asset.currency, asset.ticker, period).then(points => {
          if (!points || drawnFrom.get(key) === points) return;
          drawnFrom.set(key, points);
          const tick = ticks[assetKey(asset)];
          charts = { ...charts, [key]: tick ? extend(points, tick.receivedAt, tick.price, period) : points };
        });
      }
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  });
  // Each price drawn moves its chart's latest candle (or starts the next).
  $effect(() => {
    const period = settings.period;
    if (!settings.chart) return;
    // Read without tracking: this effect follows the prices, not the charts it writes.
    const current = untrack(() => charts);
    let next = current;
    for (const asset of settings.assets) {
      const key = `${assetKey(asset)}:${period}`, tick = ticks[assetKey(asset)];
      if (!tick || !current[key]) continue;
      const extended = extend(current[key], tick.receivedAt, tick.price, period);
      if (extended !== current[key]) next = { ...next, [key]: extended };
    }
    if (next !== current) charts = next;
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
  // Only a lost or refused wake lock counts; a device without the feature, or
  // keeping the screen on switched off, is told by its own button.
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

  // Keeping the screen on, as its button beside the settings button says it:
  // on (and how it is going), switched off, or in trouble.
  const WAKE_STATES = { active: m.wake_state_active, pending: m.wake_state_pending, waiting: m.wake_state_waiting, released: m.wake_state_off, failed: m.wake_state_off, unsupported: m.wake_state_unsupported, off: m.wake_state_disabled };
  const wakeTrouble = $derived(settings.keepAwake && (wake.kind === 'released' || wake.kind === 'failed'));
  const wakeName = $derived(wakeTrouble ? m.wake_retry() : `${m.wake_label()} · ${(WAKE_STATES[wake.kind] ?? m.wake_state_pending)()}`);
  // A press switches it on or off. In trouble it tries again instead, and says
  // why it stopped; where the browser cannot keep the screen on, it says so.
  // The press's own pointerdown already asks again (wake-lock.js), so the
  // state is read as it was when the finger came down.
  let wakeAtPress = null;
  function pressWake(event) {
    const before = event.detail > 0 && wakeAtPress ? wakeAtPress : { kind: wake.kind, message: wake.message };
    wakeAtPress = null;
    if (before.kind === 'unsupported') { showToast(before.message); return; }
    if (settings.keepAwake && (before.kind === 'released' || before.kind === 'failed')) { wakeLock.retry(); showToast(before.message); return; }
    const keepAwake = !settings.keepAwake;
    save({ keepAwake });
    wakeLock.setEnabled(keepAwake);
    showToast(keepAwake ? m.wake_on() : m.wake_off());
  }

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
    // The price connections have taken their first turn: charts may ask now.
    chartsReady = true;
    wakeLock = createWakeLock({ navigator, document, window, enabled: settings.keepAwake, onChange(next) { wake = next; } });
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
      document, controls: '#board-controls, #admin-panel, [data-sonner-toaster]', panel: '#admin-panel, [data-sonner-toaster]',
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
    // iOS zooms on a pinch whatever touch-action says; refuse its gesture.
    const noPinch = event => event.preventDefault();
    for (const name of ['gesturestart', 'gesturechange']) document.addEventListener(name, noPinch, { passive: false });
    // A finger drawn up the board brightens it, down dims it (the controls and an open panel keep their own touches).
    let swipeBase = settings.brightness;
    const swiper = createSwipeBrightness({
      target: document, ignore: '#board-controls, #admin-panel, #scrim, [data-sonner-toaster], #status-dot',
      height: () => window.innerHeight,
      onStart() { clearTimeout(swipeHideTimer); swipeBase = settings.brightness; swipeLevel = swipeBase; swipeShown = true; },
      onChange(share) {
        const raw = swipeBase + share * (BRIGHTNESS_MAX - BRIGHTNESS_MIN);
        swipeLevel = Math.max(BRIGHTNESS_MIN, Math.min(BRIGHTNESS_MAX, Math.round(raw / BRIGHTNESS_STEP) * BRIGHTNESS_STEP));
        previewBrightness = swipeLevel;
      },
      onEnd() {
        previewBrightness = null;
        if (swipeLevel !== settings.brightness) save({ brightness: swipeLevel });
        swipeHideTimer = setTimeout(() => { swipeShown = false; }, 900);
      },
      onCancel() { previewBrightness = null; swipeLevel = settings.brightness; swipeHideTimer = setTimeout(() => { swipeShown = false; }, 300); },
    });
    return () => {
      swiper.dispose(); clearTimeout(swipeHideTimer);
      for (const name of ['gesturestart', 'gesturechange']) document.removeEventListener(name, noPinch);
      for (const [target, name, handler, capture] of listeners) target.removeEventListener(name, handler, capture);
      clearTimeout(cursorTimer); clearTimeout(tipTimer); clearTimeout(hintTimer);
      controls.dispose(); feed.dispose(); wakeLock.dispose(); beat.reset();
    };
  });
</script>

{#if panelOpen}
  <div id="scrim"></div>
  <SettingsPanel {settings} {canAdd} {install} {installDismissed} onInstall={runInstall} onDismissInstall={dismissInstall} ticks={assetTicks} {status} {versionLabel}
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
    onPeriod={period => save({ period })}
    onClock={clock => save({ clock })}
    onRetryFeed={() => feed.retry()}
    loadTickers={currency => markets.load(currency)} />
{/if}
<!-- The quiet controls, shown together on a tap: what is not a setting sits beside the settings button. -->
<div id="board-controls">
  {#if updateReady}
    <button id="app-update" class="board-button" type="button" aria-label={m.update_now()} title={m.update_now()} onclick={() => updater.reload()}>
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.8} />
    </button>
  {/if}
  {#if pipSupported}
    <button id="pip-toggle" class="board-button" type="button" aria-label={pipWindow ? m.pip_close() : m.pip_open()} title={pipWindow ? m.pip_close() : m.pip_open()} aria-pressed={!!pipWindow} onclick={togglePip}>
      <HugeiconsIcon icon={pipWindow ? PictureInPictureExitIcon : PictureInPictureOnIcon} strokeWidth={1.8} />
    </button>
  {/if}
  <button id="wake-toggle" class="board-button" type="button" data-kind={wake.kind} aria-pressed={settings.keepAwake} aria-label={wakeName} title={wakeName}
    onpointerdown={() => { wakeAtPress = { kind: wake.kind, message: wake.message }; }} onclick={pressWake}>
    <HugeiconsIcon icon={settings.keepAwake ? MonitorIcon : MonitorOffIcon} strokeWidth={1.8} />
  </button>
  <button id="settings-toggle" class="board-button" bind:this={toggleButton} type="button" aria-label={m.settings_open()} title={m.settings_open()} aria-controls="admin-panel" aria-expanded={panelOpen} onclick={openPanel}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.5-2 .9L4.4 6 2 10l1.9 1.8v.4L2 14l2.4 4 2.4-.4 2 .9.7 2.5h5l.7-2.5 2-.9 2.4.4L22 14l-1.9-1.8v-.4L22 10l-2.4-4-2.4.4-2-.9-.7-2.5z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</div>
<Toaster position="bottom-center" />
{#if hint}<p id="first-hint" role="status">{m.help_hint()}{#if install}<span class="hint-more">{m.help_hint_install()}</span>{/if}</p>{/if}
<!-- The brightness while swiping, as video players show it: a sun and the level
     in the middle, on a soft shade of their own, so the board shows the brightness
     it will keep. Never dimmed with the board. -->
<div id="brightness-hud" class:show={swipeShown} aria-hidden="true" style:--level={hudLevel / 100}>
  <div class="hud-body">
    <svg class="hud-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <g class="hud-rays"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></g>
    </svg>
    <span class="hud-value">{hudLevel}<small>%</small></span>
  </div>
</div>
<div id="status-dot" data-level={level} class:show={tipShown} class:quiet={settings.burnIn && level === 'ok' && !tipShown && !controlsVisible && !panelOpen} role="img" aria-label={tip} onpointerdown={tapDot}><span id="status-tip">{tip}</span></div>
<PriceBoard {settings} ticks={assetTicks} charts={assetCharts} {statuses} brightness={previewBrightness ?? settings.brightness} active={visible} />
