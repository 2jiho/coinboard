<script>
  // Wires settings, the market feed, the wake lock and the updater to the
  // board, and owns the one quiet control: the settings button.
  import { onMount, tick as flushed } from 'svelte';
  import PriceBoard from './components/PriceBoard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { createSettings, sameAsset, MAX_ASSETS } from './lib/settings.js';
  import { createBoardFeed, describeMarket } from './lib/feed.js';
  import { createWakeLock } from './lib/wake-lock.js';
  import { createUpdater } from './lib/updater.js';
  import { describeState } from './lib/status.js';
  import { tabTitle } from './lib/format.js';
  import { createQuietControls } from './lib/quiet-controls.js';
  import { createMarketList } from './lib/markets.js';
  import { createPacer } from './lib/pace.js';
  import { createSteady } from './lib/steady.js';

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
  // The asset the settings panel is editing.
  let selected = $state(0);
  let now = $state(Date.now());
  let visible = $state(document.visibilityState === 'visible');
  let wake = $state({ kind: 'pending', message: '', canRetry: false });
  let cache = $state({ state: 'waiting', version: null });
  let updateReady = $state(false);
  let controlsVisible = $state(false);
  let panelOpen = $state(false);
  let toast = $state('');
  let toggleButton;
  let feed, wakeLock, updater, controls, toastTimer, cursorTimer;
  const assetKey = asset => `${asset.currency}:${asset.ticker}`;
  // Prices can arrive several times a second. Each asset's place on the screen
  // takes one at most every three seconds, the latest, so the digits are not
  // forever in motion.
  const displays = new Map();
  function displayFor(key) {
    let display = displays.get(key);
    if (!display) {
      display = createSteady({ intervalMs: 3000, onValue(next) { ticks = { ...ticks, [key]: next }; } });
      displays.set(key, display);
    }
    return display;
  }

  const statuses = $derived(settings.assets.map(asset => describeState(feedStates[assetKey(asset)] ?? null, now)));
  const assetTicks = $derived(settings.assets.map(asset => ticks[assetKey(asset)] ?? null));
  // The settings panel speaks of the asset it is editing.
  const status = $derived(statuses[Math.min(selected, statuses.length - 1)]);
  // The worst of all: one asset in trouble is enough to say so.
  const RANK = { ok: 0, warn: 1, bad: 2 };
  const worst = $derived(statuses.reduce((level, next) => RANK[next.level] > RANK[level] ? next.level : level, 'ok'));
  // The installed offline copy normally matches the page. Say so only when it
  // does not: that is a board still showing an older page.
  const versionLabel = $derived(cache.state === 'unsupported' ? `버전 ${version} · 오프라인 실행 미지원`
    : cache.state === 'unknown' ? `버전 ${version} · 설치된 사본 확인 불가`
    : cache.state === 'known' && cache.version !== version ? `버전 ${version} · 설치된 사본 ${cache.version}`
    : `버전 ${version}`);
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
      : markets.map((market, index) => `${market.symbol} · ${statuses[index].title}`);
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
  });
  // The "N초 후" countdowns only matter while something is wrong.
  $effect(() => {
    if (!visible) return;
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });

  function showToast(message) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; }, 2000);
  }
  function save(patch) {
    const { saved } = store.update(patch);
    settings = store.get();
    if (!saved) showToast('설정을 저장하지 못했습니다. 이번 실행에만 적용됩니다.');
  }
  function applySelection() {
    // Forget prices of assets no longer shown, so one that comes back starts afresh.
    const keys = new Set(settings.assets.map(assetKey));
    for (const [key, display] of displays) if (!keys.has(key)) { display.reset(); displays.delete(key); }
    ticks = Object.fromEntries(Object.entries(ticks).filter(([key]) => keys.has(key)));
    feedStates = Object.fromEntries(Object.entries(feedStates).filter(([key]) => keys.has(key)));
    selected = Math.min(selected, settings.assets.length - 1);
    feed.select(settings.assets);
  }
  function changeAssets(assets) { save({ assets }); applySelection(); }
  // Change the asset being edited. '' when done, or why not.
  function changeAsset(patch) {
    const next = { ...settings.assets[selected], ...patch };
    if (settings.assets.some((asset, index) => index !== selected && sameAsset(asset, next))) return '이미 표시 중인 자산입니다';
    changeAssets(settings.assets.map((asset, index) => index === selected ? next : asset));
    return '';
  }
  const canAdd = $derived(settings.assets.length < MAX_ASSETS);
  // A new asset, chosen in the add form. '' when added, or why not.
  function addAsset(next) {
    if (settings.assets.length >= MAX_ASSETS) return '';
    if (settings.assets.some(asset => sameAsset(asset, next))) return '이미 표시 중인 자산입니다';
    changeAssets([...settings.assets, next]);
    selected = settings.assets.length - 1;
    return '';
  }
  // Move an asset up (-1) or down (+1); the one being edited stays chosen.
  function moveAsset(index, step) {
    const target = index + step;
    if (target < 0 || target >= settings.assets.length) return;
    const assets = [...settings.assets];
    [assets[index], assets[target]] = [assets[target], assets[index]];
    if (selected === index) selected = target; else if (selected === target) selected = index;
    changeAssets(assets);
  }
  function removeAsset(index) {
    if (settings.assets.length <= 1) return;
    if (selected >= index && selected > 0) selected -= 1;
    changeAssets(settings.assets.filter((_, position) => position !== index));
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

  onMount(() => {
    feed = createBoardFeed({
      online: navigator.onLine, pacer,
      onTick(next) {
        const key = assetKey(next.selection);
        if (settings.assets.some(asset => assetKey(asset) === key)) displayFor(key).push(next);
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
      document, controls: '#settings-toggle, #admin-panel', panel: '#admin-panel',
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
      // Back in view with a feed that is not live: reconnect now rather than
      // wait out a backoff that began while nobody was looking.
      if (value && Object.values(feedStates).some(state => state.kind !== 'live')) feed.retry();
    }
    const listeners = [
      [document, 'visibilitychange', () => setVisible(document.visibilityState === 'visible')],
      [document, 'pointerdown', event => { if (tipShown && !event.target.closest('#status-dot')) hideTip(); }],
      [window, 'pagehide', () => { visible = false; feed.setActive(false); }],
      [window, 'pageshow', () => { feed.setActive(true); setVisible(document.visibilityState === 'visible'); }],
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
      clearTimeout(toastTimer); clearTimeout(cursorTimer); clearTimeout(tipTimer);
      controls.dispose(); feed.dispose(); wakeLock.dispose(); for (const display of displays.values()) display.reset();
    };
  });
</script>

{#if panelOpen}
  <div id="scrim"></div>
  <SettingsPanel {settings} {selected} {canAdd} {status} {wake} {versionLabel} {updateReady}
    onClose={closePanel}
    onSelect={index => { selected = index; }}
    onAdd={addAsset}
    onColumns={columns => save({ columns })}
    onRemove={removeAsset}
    onMove={moveAsset}
    onCurrency={currency => currency === settings.assets[selected].currency ? '' : changeAsset({ currency })}
    onTicker={ticker => ticker === settings.assets[selected].ticker ? '' : changeAsset({ ticker })}
    onBrightnessPreview={value => { previewBrightness = value; }}
    onBrightness={value => { previewBrightness = null; save({ brightness: value }); }}
    onBurnIn={burnIn => save({ burnIn })}
    onPalette={palette => save({ palette })}
    onRetryFeed={() => feed.retry()}
    onRetryWake={() => wakeLock.retry()}
    onUpdate={() => updater.reload()}
    loadTickers={currency => markets.load(currency)} />
{/if}
<button id="settings-toggle" bind:this={toggleButton} type="button" aria-label="설정 열기" aria-controls="admin-panel" aria-expanded={panelOpen} onclick={openPanel}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.5-2 .9L4.4 6 2 10l1.9 1.8v.4L2 14l2.4 4 2.4-.4 2 .9.7 2.5h5l.7-2.5 2-.9 2.4.4L22 14l-1.9-1.8v-.4L22 10l-2.4-4-2.4.4-2-.9-.7-2.5z"/><circle cx="12" cy="12" r="3"/></svg>
</button>
<div id="toast" class:show={!!toast} role="status">{toast}</div>
<div id="status-dot" data-level={level} class:show={tipShown} role="img" aria-label={tip} onpointerdown={tapDot}><span id="status-tip">{tip}</span></div>
<PriceBoard {settings} ticks={assetTicks} {statuses} brightness={previewBrightness ?? settings.brightness} active={visible} />
