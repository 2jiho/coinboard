<script>
  // Everything here applies as soon as it is changed. The ticker is the one
  // field that needs a decision, because typing is not choosing.
  import { onMount, untrack } from 'svelte';
  import { normalizeTicker } from '../lib/settings.js';

  let { settings, status, wake, versionLabel, updateReady,
    onClose, onCurrency, onTicker, onBrightnessPreview, onBrightness, onDebug, onRetryFeed, onRetryWake, onUpdate } = $props();

  let panel, closeButton;
  // The panel starts from the saved values and then holds what is being typed.
  let tickerText = $state(untrack(() => settings.ticker));
  let tickerError = $state(false);
  let brightness = $state(untrack(() => settings.brightness));

  // Listed on both Upbit (KRW) and Binance (USDT).
  const PRESETS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA'];

  function applyTicker() {
    const ticker = normalizeTicker(tickerText);
    if (!ticker) { tickerError = true; return; }
    tickerError = false;
    tickerText = ticker;
    if (ticker !== settings.ticker) onTicker(ticker);
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { onClose(true); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.querySelectorAll('input, button')).filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  onMount(() => {
    closeButton.focus();
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });
</script>

<div id="admin-panel" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="admin-title">
  <div class="settings-header">
    <h2 id="admin-title">설정</h2>
    <button id="admin-close" bind:this={closeButton} type="button" aria-label="설정 닫기" onclick={() => onClose(true)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </div>
  <section class="settings-section" aria-labelledby="section-market">
    <h3 id="section-market">시세</h3>
    <div id="currency-controls" role="group" aria-label="표시 통화 및 거래소 선택">
      <button type="button" data-currency="KRW" aria-pressed={settings.currency === 'KRW'} aria-label="원화 · 업비트" onclick={() => onCurrency('KRW')}>원화<span>업비트</span></button>
      <button type="button" data-currency="USDT" aria-pressed={settings.currency === 'USDT'} aria-label="USDT · 바이낸스" onclick={() => onCurrency('USDT')}>USDT<span>바이낸스</span></button>
    </div>
    <div id="ticker-presets" role="group" aria-label="자주 쓰는 코인">
      {#each PRESETS as preset}
        <button type="button" data-ticker={preset} aria-pressed={settings.ticker === preset}
          onclick={() => { tickerText = preset; applyTicker(); }}>{preset}</button>
      {/each}
    </div>
    <div class="settings-row">
      <label for="admin-symbol">다른 티커</label>
      <div class="ticker-row">
        <input type="text" id="admin-symbol" placeholder="BTC" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
          enterkeyhint="done" aria-describedby="admin-symbol-error" aria-invalid={tickerError ? 'true' : undefined}
          bind:value={tickerText} oninput={() => { tickerError = false; }}
          onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); applyTicker(); } }} />
        <button id="admin-symbol-apply" type="button" onclick={applyTicker}>변경</button>
      </div>
    </div>
    <p id="admin-symbol-error" role="alert" hidden={!tickerError}>영문·숫자 1~20자로 입력하세요</p>
    <p id="status-indicator" class={status.tone} role="status" aria-live="polite">{status.text}</p>
    <p id="overlay-msg" hidden={!status.detail}>{status.detail}</p>
    <button id="market-retry" type="button" hidden={!status.canRetry} onclick={onRetryFeed}>시세 다시 연결</button>
  </section>
  <section class="settings-section" aria-labelledby="section-screen">
    <h3 id="section-screen">화면</h3>
    <div class="settings-row">
      <label for="admin-brightness">화면 밝기</label>
      <div class="brightness-row">
        <input type="range" id="admin-brightness" min="10" max="100" step="5" bind:value={brightness}
          oninput={() => onBrightnessPreview(Number(brightness))} onchange={() => onBrightness(Number(brightness))} />
        <span id="brightness-value">{brightness}%</span>
      </div>
    </div>
    <p id="wake-lock-status" role="status" aria-live="polite">{wake.message}</p>
    <button id="wake-lock-retry" type="button" hidden={!wake.canRetry} onclick={onRetryWake}>화면 켜짐 유지 다시 시도</button>
  </section>
  <section class="settings-section" aria-labelledby="section-app">
    <h3 id="section-app">앱</h3>
    <p id="app-version">{versionLabel}</p>
    <button id="app-update" type="button" hidden={!updateReady} onclick={onUpdate}>새 버전 적용</button>
    <div class="settings-row">
      <label for="admin-debug">디버그 모드</label>
      <input type="checkbox" id="admin-debug" checked={settings.debug} onchange={event => onDebug(event.currentTarget.checked)} />
    </div>
  </section>
</div>
