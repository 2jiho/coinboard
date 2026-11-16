<script>
  // Everything here applies as soon as it is changed. The ticker is the one
  // field that needs a decision, because typing is not choosing.
  import { onMount, tick, untrack } from 'svelte';
  import { normalizeTicker, sameAsset, MAX_COLUMNS } from '../lib/settings.js';
  import { PRESETS } from '../lib/presets.js';
  import { EXCHANGES } from '../lib/exchanges/index.js';
  import { m } from '../paraglide/messages.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { NativeSelect, NativeSelectOption } from '$lib/components/ui/native-select/index.js';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Cancel01Icon, ArrowUp01Icon, ArrowDown01Icon, Delete02Icon, PlusSignIcon, GithubIcon } from '@hugeicons/core-free-icons';

  let { settings, selected, canAdd, status, wake, versionLabel, updateReady,
    onClose, onSelect, onAdd, onRemove, onMove, onColumns, onCurrency, onTicker, onBrightnessPreview, onBrightness, onBurnIn, onPalette, onRetryFeed, onRetryWake, onUpdate, loadTickers } = $props();

  let panel;
  // The rows below edit this asset; the list above chooses it.
  const asset = $derived(settings.assets[Math.min(selected, settings.assets.length - 1)]);
  const assetName = item => `${item.ticker} ${EXCHANGES[item.currency].choice}`;
  let tickerInput = $state(null);
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
  // The chosen asset's market and coin are shown only after its row is tapped;
  // tapping it again folds them away.
  let editing = $state(false);
  function pick(index) {
    if (index === selected && editing) { editing = false; return; }
    adding = false; onSelect(index); editing = true;
  }
  let newCurrency = $state('KRW'), newCoin = $state(''), newText = $state(''), newError = $state('');
  let newListed = $state(null);
  const firstFree = currency => PRESETS.find(coin => !settings.assets.some(item => sameAsset(item, { currency, ticker: coin }))) ?? OTHER;
  function startAdding() {
    newCurrency = asset.currency; newCoin = firstFree(newCurrency); newText = ''; newError = '';
    editing = false; adding = true;
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
      if (!ticker) { newError = m.ticker_invalid(); return; }
      if (newListed && !newListed.includes(ticker)) { newError = m.ticker_not_listed({ market: EXCHANGES[newCurrency].listName }); return; }
    }
    newError = onAdd({ currency: newCurrency, ticker });
    if (!newError) adding = false;
  }
  // Another asset to edit: start clean.
  $effect(() => { selected; untrack(() => { otherOpen = false; tickerError = ''; }); });
  // What the market and coin choices show. They follow the asset, and a
  // refused choice (already on the board) goes back to it.
  let currencyChoice = $state(''), coinChoice = $state('');
  $effect(() => { currencyChoice = asset.currency; });
  $effect(() => { coinChoice = otherOpen ? OTHER : asset.ticker; });
  async function chooseCurrency(value) {
    tickerError = onCurrency(value);
    if (tickerError) { await tick(); currencyChoice = asset.currency; }
  }
  async function chooseCoin(value) {
    tickerError = '';
    if (value !== OTHER) {
      otherOpen = false;
      tickerError = onTicker(value);
      if (tickerError) { await tick(); coinChoice = asset.ticker; }
      return;
    }
    otherOpen = true; tickerText = '';
    await tick();
    tickerInput?.focus();
  }

  function applyTicker() {
    const ticker = normalizeTicker(tickerText);
    if (!ticker) { tickerError = m.ticker_invalid(); return; }
    if (listed && !listed.includes(ticker)) { tickerError = m.ticker_not_listed({ market: EXCHANGES[asset.currency].listName }); return; }
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
    // The close button is a component: find its element in the panel.
    panel.querySelector('#admin-close')?.focus();
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });
</script>

<div id="admin-panel" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="admin-title"
  class="fixed left-1/2 top-[max(48px,calc(var(--safe-top)+16px))] z-[2000] flex max-h-[calc(100dvh-max(48px,calc(var(--safe-top)+16px))-var(--safe-bottom)-16px)] w-[min(400px,calc(100vw-var(--safe-left)-var(--safe-right)-32px))] -translate-x-1/2 flex-col gap-5 overflow-y-auto overscroll-contain rounded-[28px] border border-white/10 bg-background/80 px-4 pb-5 text-left text-[15px] text-foreground shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200 motion-reduce:animate-none">
  <!-- The header stays in view while the sheet scrolls. -->
  <div class="sticky top-0 z-10 -mx-4 flex items-center justify-between bg-gradient-to-b from-background from-70% to-transparent px-4 pb-2 pt-4">
    <h2 id="admin-title" class="text-[22px] font-bold tracking-tight">{m.settings_title()}</h2>
    <Button id="admin-close" variant="secondary" size="icon" class="size-11 rounded-full bg-white/10 text-muted-foreground hover:bg-white/15" aria-label={m.settings_close()} onclick={() => onClose(true)}>
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} class="size-5" />
    </Button>
  </div>

  <section class="flex flex-col gap-3" aria-label={m.section_prices()}>
    <!-- What the board shows: one asset large, or several in a grid. A row is
         chosen to edit it below. -->
    <div class="overflow-hidden rounded-2xl bg-card" id="asset-list" role="group" aria-label={m.asset_list()}>
      {#each settings.assets as item, index (item.currency + ':' + item.ticker)}
        <div class="asset-row flex min-h-14 items-center gap-1 border-b border-border pr-2 transition-colors last:border-b-0 data-[selected=true]:bg-white/[0.06]" data-selected={index === selected && editing}>
          <button type="button" class="asset-pick flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={index === selected} aria-expanded={index === selected && editing} onclick={() => pick(index)}>
            <span class="shrink-0 text-base font-semibold tracking-wide">{item.ticker}</span>
            <span class="truncate text-[13px] text-muted-foreground">{EXCHANGES[item.currency].choice}</span>
          </button>
          {#if settings.assets.length > 1}
            <!-- Order: up and down. Removing: a bin, so it does not read as a handle. -->
            <Button variant="ghost" size="icon" class="asset-move size-10 rounded-full text-muted-foreground disabled:opacity-25" aria-label={m.asset_move_up({ name: assetName(item) })} disabled={index === 0} onclick={() => onMove(index, -1)}>
              <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} class="size-5" />
            </Button>
            <Button variant="ghost" size="icon" class="asset-move size-10 rounded-full text-muted-foreground disabled:opacity-25" aria-label={m.asset_move_down({ name: assetName(item) })} disabled={index === settings.assets.length - 1} onclick={() => onMove(index, 1)}>
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} class="size-5" />
            </Button>
            <Button variant="ghost" size="icon" class="asset-remove size-10 rounded-full text-destructive hover:bg-destructive/15 hover:text-destructive" aria-label={m.asset_remove({ name: assetName(item) })} onclick={() => onRemove(index)}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} class="size-5" />
            </Button>
          {/if}
        </div>
      {/each}
      {#if canAdd && !adding}
        <button type="button" id="asset-add" class="flex min-h-14 w-full items-center gap-2 border-t border-border px-4 font-medium text-primary outline-none transition-colors first:border-t-0 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring" onclick={startAdding}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} class="size-5" />{m.asset_add()}
        </button>
      {/if}
    </div>

    {#if adding}
      <div class="overflow-hidden rounded-2xl bg-card animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none" id="asset-new" role="group" aria-label={m.asset_new()}>
        <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
          <label for="new-currency">{m.field_market()}</label>
          <NativeSelect id="new-currency" class="max-w-[70%]" bind:value={newCurrency} onchange={() => { newError = ''; if (newCoin !== OTHER) newCoin = firstFree(newCurrency); }}>
            {#each Object.entries(EXCHANGES) as [key, exchange]}<NativeSelectOption value={key}>{exchange.choice}</NativeSelectOption>{/each}
          </NativeSelect>
        </div>
        <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
          <label for="new-coin">{m.field_coin()}</label>
          <NativeSelect id="new-coin" bind:value={newCoin} onchange={() => { newError = ''; }}>
            {#each PRESETS as preset}<NativeSelectOption value={preset}>{preset}</NativeSelectOption>{/each}
            <NativeSelectOption value={OTHER}>{m.coin_other()}</NativeSelectOption>
          </NativeSelect>
        </div>
        {#if newCoin === OTHER}
          <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
            <label for="new-symbol">{m.field_ticker()}</label>
            <Input id="new-symbol" class="w-32 uppercase placeholder:normal-case" placeholder={m.ticker_placeholder()} maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
              enterkeyhint="done" list="new-ticker-list" bind:value={newText} oninput={() => { newError = ''; }}
              onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); confirmAdding(); } }} />
            <datalist id="new-ticker-list">{#each newListed || [] as ticker}<option value={ticker}></option>{/each}</datalist>
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-2 p-3">
          <Button id="asset-new-cancel" variant="secondary" size="lg" class="h-11 rounded-xl" onclick={() => { adding = false; }}>{m.cancel()}</Button>
          <Button id="asset-new-confirm" size="lg" class="h-11 rounded-xl font-semibold" onclick={confirmAdding}>{m.add()}</Button>
        </div>
      </div>
      <p id="asset-new-error" class="px-1 text-[13px] text-destructive" role="alert" hidden={!newError}>{newError}</p>
    {/if}

    <!-- The chosen asset's market and coin, once its row is tapped. -->
    {#if editing && !adding}
      <div class="overflow-hidden rounded-2xl bg-card animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
        <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
          <label for="admin-currency">{m.field_market()}</label>
          <NativeSelect id="admin-currency" class="max-w-[70%]" bind:value={currencyChoice} onchange={event => chooseCurrency(event.currentTarget.value)}>
            {#each Object.entries(EXCHANGES) as [key, exchange]}<NativeSelectOption value={key}>{exchange.choice}</NativeSelectOption>{/each}
          </NativeSelect>
        </div>
        <div class="flex min-h-14 items-center justify-between gap-3 px-4">
          <label for="admin-coin">{m.field_coin()}</label>
          <NativeSelect id="admin-coin" bind:value={coinChoice} onchange={event => chooseCoin(event.currentTarget.value)}>
            {#if !preset}<NativeSelectOption value={asset.ticker}>{asset.ticker}</NativeSelectOption>{/if}
            {#each PRESETS as preset}<NativeSelectOption value={preset}>{preset}</NativeSelectOption>{/each}
            <NativeSelectOption value={OTHER}>{m.coin_other()}</NativeSelectOption>
          </NativeSelect>
        </div>
        {#if otherOpen}
          <div class="flex min-h-14 items-center justify-between gap-3 border-t border-border px-4">
            <label for="admin-symbol">{m.field_ticker()}</label>
            <div class="flex items-center gap-2">
              <Input id="admin-symbol" bind:ref={tickerInput} class="w-28 uppercase placeholder:normal-case" placeholder={m.ticker_placeholder()} maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
                enterkeyhint="done" list="ticker-list" aria-describedby="admin-symbol-error" aria-invalid={tickerError ? 'true' : undefined}
                bind:value={tickerText} oninput={() => { tickerError = ''; }}
                onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); applyTicker(); } }} />
              <datalist id="ticker-list">{#each listed || [] as ticker}<option value={ticker}></option>{/each}</datalist>
              <Button id="admin-symbol-apply" variant="secondary" class="rounded-xl" onclick={applyTicker}>{m.ticker_apply()}</Button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
    {#if settings.assets.length > 1}
      <div class="overflow-hidden rounded-2xl bg-card">
        <div class="flex min-h-14 items-center justify-between gap-3 px-4">
          <label for="admin-columns">{m.columns()}</label>
          <NativeSelect id="admin-columns" value={String(settings.columns)} onchange={event => onColumns(Number(event.currentTarget.value))}>
            <NativeSelectOption value="0">{m.columns_auto()}</NativeSelectOption>
            {#each Array.from({ length: MAX_COLUMNS }, (_, n) => n + 1) as columns}<NativeSelectOption value={String(columns)}>{columns}</NativeSelectOption>{/each}
          </NativeSelect>
        </div>
      </div>
    {/if}
    <p id="admin-symbol-error" class="px-1 text-[13px] text-destructive" role="alert" hidden={!tickerError}>{tickerError}</p>
    <p id="status-indicator" class="{status.tone} flex items-start gap-2 px-1 text-[13px] leading-normal whitespace-pre-line text-muted-foreground [&.error]:text-destructive" role="status" aria-live="polite" hidden={status.tone === 'connected'}><span class="mt-[0.45em] size-2 shrink-0 rounded-full bg-current" aria-hidden="true"></span>{status.text}</p>
    <p id="overlay-msg" class="px-1 text-[13px] leading-normal whitespace-pre-line text-muted-foreground" hidden={!status.detail}>{status.detail}</p>
    <Button id="market-retry" variant="secondary" size="lg" class="h-11 rounded-xl" hidden={!status.canRetry} onclick={onRetryFeed}>{m.reconnect()}</Button>
  </section>

  <section class="flex flex-col gap-3" aria-label={m.section_display()}>
    <div class="overflow-hidden rounded-2xl bg-card">
      <div class="flex min-h-14 items-center justify-between gap-4 border-b border-border px-4">
        <span id="admin-brightness-label">{m.brightness()}</span>
        <div class="flex flex-1 items-center justify-end gap-3">
          <Slider id="admin-brightness" type="single" min={10} max={100} step={5} class="max-w-40" bind:value={brightness} aria-labelledby="admin-brightness-label"
            onValueChange={value => onBrightnessPreview(Number(value))} onValueCommit={value => onBrightness(Number(value))} />
          <span id="brightness-value" class="w-11 text-right text-sm text-muted-foreground tabular-nums">{brightness}%</span>
        </div>
      </div>
      <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <label for="admin-burn-in">{m.burn_in()}</label>
        <Switch id="admin-burn-in" size="lg" checked={settings.burnIn} onCheckedChange={value => onBurnIn(value)} />
      </div>
      <div class="flex min-h-14 items-center justify-between gap-3 px-4">
        <label for="admin-palette">{m.palette()}</label>
        <NativeSelect id="admin-palette" value={settings.palette} onchange={event => onPalette(event.currentTarget.value)}>
          <NativeSelectOption value="green-red">{m.palette_green_red()}</NativeSelectOption>
          <NativeSelectOption value="red-blue">{m.palette_red_blue()}</NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
    <p id="wake-lock-status" class="px-1 text-[13px] leading-normal text-muted-foreground" role="status" aria-live="polite" hidden={!wakeTrouble}>{wake.message}</p>
    <Button id="wake-lock-retry" variant="secondary" size="lg" class="h-11 rounded-xl" hidden={!wake.canRetry} onclick={onRetryWake}>{m.wake_retry()}</Button>
    <Button id="app-update" size="lg" class="h-11 rounded-xl font-semibold" hidden={!updateReady} onclick={onUpdate}>{m.update_now()}</Button>
  </section>

  <footer class="flex items-center justify-between px-1">
    <p id="app-version" class="text-[13px] text-muted-foreground tabular-nums">{versionLabel}</p>
    <a id="admin-repo" class="-mr-2 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" href="https://github.com/2jiho/coinboard" target="_blank" rel="noopener noreferrer" aria-label={m.repo_link()}>
      <HugeiconsIcon icon={GithubIcon} strokeWidth={1.8} class="size-6" />
    </a>
  </footer>
</div>
