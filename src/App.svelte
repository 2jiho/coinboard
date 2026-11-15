<script>
  // Wires settings, the market feed, the wake lock and the updater to the
  // board, and owns the one quiet control: the settings button.
  import { onMount, tick as flushed } from 'svelte';
  import PriceBoard from './components/PriceBoard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { createSettings } from './lib/settings.js';
  import { createMarketFeed, describeMarket } from './lib/feed.js';
  import { createWakeLock } from './lib/wake-lock.js';
  import { createUpdater } from './lib/updater.js';
  import { describeState } from './lib/status.js';
  import { createQuietControls } from './lib/quiet-controls.js';
  import { createMarketList } from './lib/markets.js';

  const version = __APP_VERSION__;
  // Storage can throw on access (private mode): run on defaults without it.
  function storage(name) { try { return window[name]; } catch { return null; } }
  const store = createSettings(storage('localStorage'));
  const markets = createMarketList({ fetch: (url) => window.fetch(url) });

  let settings = $state(store.get());
  let previewBrightness = $state(null);
  let tick = $state(null);
  let feedState = $state(null);
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

  const status = $derived(describeState(feedState, now));
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
  const level = $derived(status.level === 'ok' && wakeLost ? 'warn' : status.level);
  const tip = $derived.by(() => {
    const market = describeMarket(settings.currency, settings.ticker);
    return [`${market.label} · ${market.pair}`, status.title, wakeLost ? 'SCREEN MAY SLEEP' : ''].filter(Boolean).join('\n');
  });
  // Touch has no hover: a tap on the dot shows the detail for a few seconds.
  let tipShown = $state(false);
  let tipTimer;
  function showTip() {
    tipShown = true;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { tipShown = false; }, 4000);
  }

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
    // Clear the old amount before another source is connected.
    tick = null;
    feed.select(settings.currency, settings.ticker);
  }
  function changeSelection(patch) { save(patch); applySelection(); }

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
    feed = createMarketFeed({
      active: visible, online: navigator.onLine,
      onTick(next) { if (next.selection.currency === settings.currency && next.selection.ticker === settings.ticker) tick = next; },
      onState(next) { feedState = next; },
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

    function setVisible(value) { visible = value; feed.setActive(value); }
    const listeners = [
      [document, 'visibilitychange', () => setVisible(document.visibilityState === 'visible')],
      [window, 'pagehide', () => setVisible(false)],
      [window, 'pageshow', () => setVisible(document.visibilityState === 'visible')],
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
      controls.dispose(); feed.dispose(); wakeLock.dispose();
    };
  });
</script>

{#if panelOpen}
  <div id="scrim"></div>
  <SettingsPanel {settings} {status} {wake} {versionLabel} {updateReady}
    onClose={closePanel}
    onCurrency={currency => { if (currency !== settings.currency) changeSelection({ currency }); }}
    onTicker={ticker => changeSelection({ ticker })}
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
<div id="status-dot" data-level={level} class:show={tipShown} role="img" aria-label={tip} onpointerdown={showTip}><span id="status-tip">{tip}</span></div>
<PriceBoard {settings} {tick} {status} brightness={previewBrightness ?? settings.brightness} active={visible} />
