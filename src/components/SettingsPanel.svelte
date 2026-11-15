<script>
  // Everything here applies as soon as it is changed. The ticker is the one
  // field that needs a decision, because typing is not choosing.
  import { onMount, tick, untrack } from 'svelte';
  import { normalizeTicker, sameAsset, MAX_COLUMNS } from '../lib/settings.js';
  import { PRESETS } from '../lib/presets.js';
  import { EXCHANGES } from '../lib/exchanges/index.js';

  let { settings, selected, canAdd, status, wake, versionLabel, updateReady,
    onClose, onSelect, onAdd, onRemove, onMove, onColumns, onCurrency, onTicker, onBrightnessPreview, onBrightness, onBurnIn, onPalette, onRetryFeed, onRetryWake, onUpdate, loadTickers } = $props();

  let panel, closeButton;
  // The rows below edit this asset; the list above chooses it.
  const asset = $derived(settings.assets[Math.min(selected, settings.assets.length - 1)]);
  const assetName = item => `${item.ticker} ${EXCHANGES[item.currency].choice}`;
  let tickerInput = $state();
  // What is being typed or dragged, before it is applied.
  let tickerText = $state('');
  // '' when fine, otherwise the message to show.
  let tickerError = $state('');
  // The coins the exchange lists, once known: for completion and for checking
  // a typed ticker. null while unknown, in which case anything is let through.
  let listed = $state(null);
  $effect(() => {
    if (!otherOpen) return;
    const currency = asset.currency;
    listed = null;
    loadTickers(currency).then((tickers) => { if (otherOpen && asset.currency === currency) listed = tickers; });
  });
  let brightness = $state(untrack(() => settings.brightness));
  // Coin is a one-line choice: the listed coins, the current coin if it is not
  // one of them, and "직접 입력…", which opens a field for any other ticker.
  const OTHER = '__other';
  const preset = $derived(PRESETS.includes(asset.ticker));
  let otherOpen = $state(false);
  // Worth a line only when something is wrong.
  const wakeTrouble = $derived(['unsupported', 'released', 'failed'].includes(wake.kind));
  // The add form: market and coin for a new asset, added only on 추가. It
  // starts in the market being edited, on the first listed coin not yet shown there.
  let adding = $state(false);
  let newCurrency = $state('KRW'), newCoin = $state(''), newText = $state(''), newError = $state('');
  let newListed = $state(null);
  const firstFree = currency => PRESETS.find(coin => !settings.assets.some(item => sameAsset(item, { currency, ticker: coin }))) ?? OTHER;
  function startAdding() {
    newCurrency = asset.currency; newCoin = firstFree(newCurrency); newText = ''; newError = '';
    adding = true;
  }
  $effect(() => {
    if (!adding || newCoin !== OTHER) return;
    const currency = newCurrency;
    newListed = null;
    loadTickers(currency).then((tickers) => { if (adding && newCurrency === currency) newListed = tickers; });
  });
  function confirmAdding() {
    let ticker = newCoin;
    if (newCoin === OTHER) {
      ticker = normalizeTicker(newText);
      if (!ticker) { newError = '영문·숫자 1~20자로 입력하세요'; return; }
      if (newListed && !newListed.includes(ticker)) { newError = `${EXCHANGES[newCurrency].listName} 시장에 없는 티커입니다`; return; }
    }
    newError = onAdd({ currency: newCurrency, ticker });
    if (!newError) adding = false;
  }
  // Another asset to edit: start clean.
  $effect(() => { selected; untrack(() => { otherOpen = false; tickerError = ''; }); });
  async function chooseCoin(select, value) {
    tickerError = '';
    if (value !== OTHER) {
      otherOpen = false;
      tickerError = onTicker(value);
      // Refused (already on the board): the choice goes back.
      if (tickerError) select.value = asset.ticker;
      return;
    }
    otherOpen = true; tickerText = '';
    await tick();
    tickerInput.focus();
  }

  function applyTicker() {
    const ticker = normalizeTicker(tickerText);
    if (!ticker) { tickerError = '영문·숫자 1~20자로 입력하세요'; return; }
    if (listed && !listed.includes(ticker)) { tickerError = `${EXCHANGES[asset.currency].listName} 시장에 없는 티커입니다`; return; }
    tickerError = onTicker(ticker);
    if (tickerError) return;
    tickerText = ticker;
    otherOpen = false;
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { onClose(true); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.querySelectorAll('input, select, button, a[href]')).filter(el => !el.disabled && el.getClientRects().length);
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
  <section class="settings-section" aria-label="시세">
    <!-- What the board shows: one asset large, or several in a grid. A row is
         chosen to edit it below. -->
    <div class="settings-group" id="asset-list" role="group" aria-label="표시할 자산">
      {#each settings.assets as item, index (item.currency + ':' + item.ticker)}
        <div class="asset-row" class:selected={index === selected}>
          <button type="button" class="asset-pick" aria-pressed={index === selected} onclick={() => onSelect(index)}>
            <span class="asset-coin">{item.ticker}</span><span class="asset-market">{EXCHANGES[item.currency].choice}</span>
          </button>
          {#if settings.assets.length > 1}
            <!-- Order: up and down. Removing: a bin, so it does not read as a handle. -->
            <button type="button" class="asset-move" aria-label="{assetName(item)} 위로" disabled={index === 0} onclick={() => onMove(index, -1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>
            </button>
            <button type="button" class="asset-move" aria-label="{assetName(item)} 아래로" disabled={index === settings.assets.length - 1} onclick={() => onMove(index, 1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
            </button>
            <button type="button" class="asset-remove" aria-label="{assetName(item)} 빼기" onclick={() => onRemove(index)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5"/></svg>
            </button>
          {/if}
        </div>
      {/each}
      {#if canAdd && !adding}
        <button type="button" id="asset-add" onclick={startAdding}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>자산 추가
        </button>
      {/if}
    </div>
    {#if adding}
      <div class="settings-group" id="asset-new" role="group" aria-label="새 자산">
        <div class="settings-row">
          <label for="new-currency">시장</label>
          <select id="new-currency" bind:value={newCurrency} onchange={() => { newError = ''; if (newCoin !== OTHER) newCoin = firstFree(newCurrency); }}>
            {#each Object.entries(EXCHANGES) as [key, exchange]}<option value={key}>{exchange.choice}</option>{/each}
          </select>
        </div>
        <div class="settings-row">
          <label for="new-coin">코인</label>
          <select id="new-coin" bind:value={newCoin} onchange={() => { newError = ''; }}>
            {#each PRESETS as preset}<option value={preset}>{preset}</option>{/each}
            <option value={OTHER}>직접 입력…</option>
          </select>
        </div>
        {#if newCoin === OTHER}
          <div class="settings-row">
            <label for="new-symbol">티커</label>
            <input type="text" id="new-symbol" placeholder="예: LINK" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
              enterkeyhint="done" list="new-ticker-list" bind:value={newText} oninput={() => { newError = ''; }}
              onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); confirmAdding(); } }} />
            <datalist id="new-ticker-list">{#each newListed || [] as ticker}<option value={ticker}></option>{/each}</datalist>
          </div>
        {/if}
        <div class="asset-new-actions">
          <button type="button" id="asset-new-cancel" onclick={() => { adding = false; }}>취소</button>
          <button type="button" id="asset-new-confirm" onclick={confirmAdding}>추가</button>
        </div>
      </div>
      <p id="asset-new-error" role="alert" hidden={!newError}>{newError}</p>
    {/if}
    <!-- The chosen asset's market and coin. Hidden while a new one is being added. -->
    {#if !adding}
    <div class="settings-group">
      <div class="settings-row">
        <label for="admin-currency">시장</label>
        <select id="admin-currency" value={asset.currency} onchange={event => { const select = event.currentTarget; tickerError = onCurrency(select.value); if (tickerError) select.value = asset.currency; }}>
          {#each Object.entries(EXCHANGES) as [key, exchange]}<option value={key}>{exchange.choice}</option>{/each}
        </select>
      </div>
      <div class="settings-row">
        <label for="admin-coin">코인</label>
        <select id="admin-coin" value={otherOpen ? OTHER : asset.ticker} onchange={event => chooseCoin(event.currentTarget, event.currentTarget.value)}>
          {#if !preset}<option value={asset.ticker}>{asset.ticker}</option>{/if}
          {#each PRESETS as preset}<option value={preset}>{preset}</option>{/each}
          <option value={OTHER}>직접 입력…</option>
        </select>
      </div>
      {#if otherOpen}
        <div class="settings-row">
          <label for="admin-symbol">티커</label>
          <div class="ticker-row">
            <input type="text" id="admin-symbol" bind:this={tickerInput} placeholder="예: LINK" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
              enterkeyhint="done" list="ticker-list" aria-describedby="admin-symbol-error" aria-invalid={tickerError ? 'true' : undefined}
              bind:value={tickerText} oninput={() => { tickerError = ''; }}
              onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); applyTicker(); } }} />
            <datalist id="ticker-list">{#each listed || [] as ticker}<option value={ticker}></option>{/each}</datalist>
            <button id="admin-symbol-apply" type="button" onclick={applyTicker}>변경</button>
          </div>
        </div>
      {/if}
    </div>
    {/if}
    {#if settings.assets.length > 1}
      <div class="settings-group">
        <div class="settings-row">
          <label for="admin-columns">가로 칸 수</label>
          <select id="admin-columns" value={String(settings.columns)} onchange={event => onColumns(Number(event.currentTarget.value))}>
            <option value="0">자동</option>
            {#each Array.from({ length: MAX_COLUMNS }, (_, n) => n + 1) as columns}<option value={String(columns)}>{columns}</option>{/each}
          </select>
        </div>
      </div>
    {/if}
    <p id="admin-symbol-error" role="alert" hidden={!tickerError}>{tickerError}</p>
    <p id="status-indicator" class={status.tone} role="status" aria-live="polite" hidden={status.tone === 'connected'}>{status.text}</p>
    <p id="overlay-msg" hidden={!status.detail}>{status.detail}</p>
    <button id="market-retry" type="button" hidden={!status.canRetry} onclick={onRetryFeed}>시세 다시 연결</button>
  </section>
  <section class="settings-section" aria-label="화면">
    <div class="settings-group">
      <div class="settings-row">
        <label for="admin-brightness">밝기</label>
        <div class="brightness-row">
          <input type="range" id="admin-brightness" min="10" max="100" step="5" bind:value={brightness}
            style:--fill="{(brightness - 10) / 90 * 100}%"
            oninput={() => onBrightnessPreview(Number(brightness))} onchange={() => onBrightness(Number(brightness))} />
          <span id="brightness-value">{brightness}%</span>
        </div>
      </div>
      <div class="settings-row">
        <label for="admin-burn-in">번인 방지</label>
        <input type="checkbox" role="switch" id="admin-burn-in" checked={settings.burnIn} onchange={event => onBurnIn(event.currentTarget.checked)} />
      </div>
      <div class="settings-row">
        <label for="admin-palette">등락 색</label>
        <select id="admin-palette" value={settings.palette} onchange={event => onPalette(event.currentTarget.value)}>
          <option value="green-red">초록 · 빨강</option>
          <option value="red-blue">빨강 · 파랑</option>
        </select>
      </div>
    </div>
    <p id="wake-lock-status" role="status" aria-live="polite" hidden={!wakeTrouble}>{wake.message}</p>
    <button id="wake-lock-retry" type="button" hidden={!wake.canRetry} onclick={onRetryWake}>화면 켜짐 유지 다시 시도</button>
    <button id="app-update" type="button" hidden={!updateReady} onclick={onUpdate}>새 버전 적용</button>
  </section>
  <footer class="settings-footer">
    <p id="app-version">{versionLabel}</p>
    <a id="admin-repo" href="https://github.com/2jiho/coinboard" target="_blank" rel="noopener noreferrer" aria-label="GitHub 저장소">
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
    </a>
  </footer>
</div>
