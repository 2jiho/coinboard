<script>
  // Wires settings, the market feed, the wake lock and the updater to the
  // board, and owns the one quiet control: the settings button.
  import { onMount, tick as flushed } from 'svelte';
  import PriceBoard from './components/PriceBoard.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { createSettings } from './lib/settings.js';
  import { createMarketFeed } from './lib/feed.js';
  import { createWakeLock } from './lib/wake-lock.js';
  import { createUpdater } from './lib/updater.js';
  import { describeState } from './lib/status.js';

  const version = __APP_VERSION__;
  const CONTROLS = '#settings-toggle, #admin-panel';
  // Storage can throw on access (private mode): run on defaults without it.
  function storage(name) { try { return window[name]; } catch { return null; } }
  const store = createSettings(storage('localStorage'));

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
  let feed, wakeLock, updater, toastTimer, controlsTimer, cursorTimer, panelTimer, revealOnlyClick = false;
  const PANEL_IDLE_MS = 120000;

  const status = $derived(describeState(feedState, now));
  // The installed offline copy normally matches the page. Say so only when it
  // does not: that is a board still showing an older page.
  const versionLabel = $derived(cache.state === 'unsupported' ? `버전 ${version} · 오프라인 실행 미지원`
    : cache.state === 'unknown' ? `버전 ${version} · 설치된 사본 확인 불가`
    : cache.state === 'known' && cache.version !== version ? `버전 ${version} · 설치된 사본 ${cache.version}`
    : `버전 ${version}`);
  // Only a lost or refused lock is worth a line on the board; a device without
  // the feature is reported in the settings panel alone.
  const notice = $derived(wake.kind === 'released' || wake.kind === 'failed' ? 'SCREEN MAY SLEEP' : '');

  $effect(() => {
    document.body.classList.toggle('controls-visible', controlsVisible);
    document.body.classList.toggle('settings-open', panelOpen);
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

  function controlsInUse() {
    return panelOpen || !!(document.activeElement && document.activeElement.closest(CONTROLS));
  }
  function scheduleControlsHide() {
    clearTimeout(controlsTimer); controlsTimer = null;
    if (document.visibilityState !== 'visible' || controlsInUse()) return;
    controlsTimer = setTimeout(() => {
      controlsTimer = null;
      if (!controlsInUse()) controlsVisible = false;
    }, 5000);
  }
  function revealControls() { controlsVisible = true; scheduleControlsHide(); }
  // A panel left open would hold back automatic updates and leave the board
  // half covered, so it closes itself after two minutes without a touch.
  function keepPanel() {
    clearTimeout(panelTimer);
    if (panelOpen) panelTimer = setTimeout(() => closePanel(false), PANEL_IDLE_MS);
  }
  function openPanel() { panelOpen = true; revealControls(); keepPanel(); }
  // returnFocus is false for a tap outside, which is a way of leaving.
  async function closePanel(returnFocus) {
    panelOpen = false;
    clearTimeout(panelTimer);
    previewBrightness = null;
    await flushed();
    if (returnFocus) toggleButton.focus();
    scheduleControlsHide();
    updater.settingsClosed();
  }

  onMount(() => {
    feed = createMarketFeed({
      active: visible, online: navigator.onLine,
      onTick(next) { if (next.selection.currency === settings.currency && next.selection.ticker === settings.ticker) tick = next; },
      onState(next) { feedState = next; },
      onError(error) { if (settings.debug) console.warn('시세 메시지 오류:', error); },
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

    function setVisible(value) { visible = value; feed.setActive(value); }
    const listeners = [
      [document, 'pointerdown', event => {
        keepPanel();
        revealOnlyClick = !controlsVisible;
        // Revealing beneath a finger must not activate the newly visible button
        // on pointerup/click or leave it focused after that first tap.
        if (revealOnlyClick) event.preventDefault();
        if (panelOpen && !event.target.closest('#admin-panel')) closePanel(false);
        else if (!event.target.closest(CONTROLS) && controlsInUse() && !panelOpen) document.activeElement.blur();
        revealControls();
      }],
      [document, 'click', event => {
        if (revealOnlyClick && event.detail > 0) { revealOnlyClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
      }, true],
      [document, 'pointercancel', () => { revealOnlyClick = false; }],
      [document, 'keydown', event => { keepPanel(); if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') revealControls(); }, true],
      [document, 'input', keepPanel, true],
      [document, 'focusin', event => { if (event.target.closest(CONTROLS)) revealControls(); }],
      [document, 'focusout', () => { queueMicrotask(scheduleControlsHide); }],
      [document, 'visibilitychange', () => {
        setVisible(document.visibilityState === 'visible');
        if (visible) scheduleControlsHide(); else { clearTimeout(controlsTimer); controlsTimer = null; }
      }],
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
      clearTimeout(toastTimer); clearTimeout(controlsTimer); clearTimeout(cursorTimer); clearTimeout(panelTimer);
      feed.dispose(); wakeLock.dispose();
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
    onDebug={debug => save({ debug })}
    onRetryFeed={() => feed.retry()}
    onRetryWake={() => wakeLock.retry()}
    onUpdate={() => updater.reload()} />
{/if}
<button id="settings-toggle" bind:this={toggleButton} type="button" aria-label="설정 열기" aria-controls="admin-panel" aria-expanded={panelOpen} onclick={openPanel}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.5-2 .9L4.4 6 2 10l1.9 1.8v.4L2 14l2.4 4 2.4-.4 2 .9.7 2.5h5l.7-2.5 2-.9 2.4.4L22 14l-1.9-1.8v-.4L22 10l-2.4-4-2.4.4-2-.9-.7-2.5z"/><circle cx="12" cy="12" r="3"/></svg>
</button>
<div id="toast" class:show={!!toast} role="status">{toast}</div>
<PriceBoard {settings} {tick} {status} {notice} brightness={previewBrightness ?? settings.brightness} active={visible} />
