<script>
  // Everything here applies as soon as it is changed. The ticker is the one
  // field that needs a decision, because typing is not choosing.
  import { onMount, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { normalizeTicker, sameAsset, MAX_COLUMNS } from '../lib/settings.js';
  import { PRESETS } from '../lib/presets.js';
  import { EXCHANGES } from '../lib/exchanges/index.js';
  import { m } from '../paraglide/messages.js';
  import { priceParts, change as formatChange, direction } from '../lib/format.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { NativeSelect, NativeSelectOption } from '$lib/components/ui/native-select/index.js';
  import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Cancel01Icon, Delete02Icon, PlusSignIcon, GithubIcon, DragDropVerticalIcon, Sun01Icon, Sun03Icon } from '@hugeicons/core-free-icons';

  let { settings, selected, canAdd, ticks, status, wake, versionLabel, updateReady,
    onClose, onSelect, onAdd, onRemove, onReorder, onColumns, onCurrency, onTicker, onBrightnessPreview, onBrightness, onBurnIn, onPalette, onRetryFeed, onRetryWake, onUpdate, loadTickers } = $props();

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
    // A row that was just swiped is not also tapped.
    if (swiped) return;
    if (openKey) { openKey = null; return; }
    if (index === selected && editing) { editing = false; return; }
    adding = false; onSelect(index); editing = true;
  }
  let newCurrency = $state('KRW'), newCoin = $state(''), newText = $state(''), newError = $state('');
  let newListed = $state(null);
  const firstFree = currency => PRESETS.find(coin => !settings.assets.some(item => sameAsset(item, { currency, ticker: coin }))) ?? OTHER;
  function startAdding() {
    newCurrency = asset.currency; newCoin = firstFree(newCurrency); newText = ''; newError = '';
    editing = false; adding = true; openKey = null;
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
    // Tapping the chosen market again chooses nothing: keep it.
    if (!value || value === asset.currency) { await tick(); currencyChoice = asset.currency; return; }
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

  // ---- The asset list: a card per asset, with its icon and live price ----
  const keyOf = item => `${item.currency}:${item.ticker}`;
  // Each asset's latest price, as on the board.
  const tickOf = $derived(new Map(settings.assets.map((item, index) => [keyOf(item), ticks?.[index] ?? null])));
  function priceOf(item) {
    const latest = tickOf.get(keyOf(item));
    return latest ? priceParts(latest.selection.quote, latest.price).pieces.map(piece => piece.number + piece.mark).join(' ') : '';
  }
  function changeOf(item) {
    const latest = tickOf.get(keyOf(item));
    return latest ? { text: formatChange(latest.change), tone: direction(latest.change) } : null;
  }
  let failedIcons = $state.raw(new Set());
  const iconOf = item => `./coins/${item.ticker.toLowerCase()}.svg`;
  // The rows as shown: the assets in order, except while one is being
  // dragged, when the order follows the finger and is saved on release.
  let rows = $state([]);
  let draggingId = $state(null);
  $effect(() => { const next = settings.assets.map(item => ({ id: keyOf(item), asset: item })); if (untrack(() => draggingId) === null) rows = next; });
  function commitOrder() {
    const order = rows.map(row => row.asset);
    if (order.map(keyOf).join() !== settings.assets.map(keyOf).join()) onReorder(order);
  }
  // Dragging by the handle: the row follows the finger, and the others make
  // room as it passes their middle.
  function grab(handle, id) {
    let row = null, list = null, grabOffset = 0, pointer = null;
    const follow = y => {
      const at = rows.findIndex(other => other.id === id), height = row.offsetHeight;
      const target = Math.max(0, Math.min(rows.length - 1, Math.floor((y - list.getBoundingClientRect().top) / height)));
      if (target !== at) { const next = [...rows]; const [moving] = next.splice(at, 1); next.splice(target, 0, moving); rows = next; }
      requestAnimationFrame(() => { if (row) row.style.transform = `translateY(${y - grabOffset - list.getBoundingClientRect().top - row.offsetTop}px)`; });
    };
    const down = event => {
      if (event.button > 0 || settings.assets.length < 2) return;
      event.preventDefault(); event.stopPropagation();
      row = handle.closest('.asset-row'); list = row.parentElement;
      grabOffset = event.clientY - row.getBoundingClientRect().top;
      pointer = event.pointerId; handle.setPointerCapture?.(pointer);
      openKey = null; draggingId = id;
    };
    const move = event => { if (row && event.pointerId === pointer) { event.preventDefault(); follow(event.clientY); } };
    const up = event => {
      if (!row || event.pointerId !== pointer) return;
      row.style.transform = ''; row = null; draggingId = null;
      commitOrder();
    };
    // The keyboard: up and down arrows on the handle move the row by one.
    const key = event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const at = rows.findIndex(other => other.id === id), target = at + (event.key === 'ArrowUp' ? -1 : 1);
      if (target < 0 || target >= rows.length) return;
      const next = [...rows]; const [moving] = next.splice(at, 1); next.splice(target, 0, moving); rows = next;
      commitOrder();
      tick().then(() => handle.focus());
    };
    const events = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['keydown', key]];
    for (const [name, handler] of events) handle.addEventListener(name, handler);
    return { update(next) { id = next; }, destroy() { for (const [name, handler] of events) handle.removeEventListener(name, handler); } };
  }
  // Swiping a row to the left uncovers a remove button; one row at a time.
  const SWIPE = 88;
  let openKey = $state(null), swiped = false;
  function swipe(node, params) {
    let p = params, start = null, offset = 0, horizontal = null;
    // The remove button behind is shown only while the card is moved off it,
    // so it cannot show through the list's rounded corner.
    let hideTimer;
    const place = (x, animate) => {
      node.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
      node.style.transform = x ? `translateX(${x}px)` : '';
      clearTimeout(hideTimer);
      if (x) node.parentElement.dataset.revealed = 'true';
      else if (animate) hideTimer = setTimeout(() => { node.parentElement.dataset.revealed = 'false'; }, 240);
      else node.parentElement.dataset.revealed = 'false';
    };
    place(p.open ? -SWIPE : 0, false);
    const down = event => {
      if (!p.enabled || event.button > 0 || event.target.closest('[data-drag-handle]')) return;
      start = { x: event.clientX, y: event.clientY, base: p.open ? -SWIPE : 0 }; horizontal = null; offset = start.base;
    };
    const move = event => {
      if (!start) return;
      const x = event.clientX - start.x, y = event.clientY - start.y;
      if (horizontal === null && Math.hypot(x, y) > 8) {
        horizontal = Math.abs(x) > Math.abs(y);
        if (horizontal) node.setPointerCapture?.(event.pointerId);
      }
      if (!horizontal) return;
      offset = Math.min(0, Math.max(-SWIPE * 1.5, start.base + x));
      place(offset, false);
    };
    const up = () => {
      if (!start) return;
      const wasHorizontal = horizontal; start = null;
      if (!wasHorizontal) return;
      swiped = true; setTimeout(() => { swiped = false; }, 0);
      const open = offset < -SWIPE / 2;
      p.onchange(open); place(open ? -SWIPE : 0, true);
    };
    const events = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]];
    for (const [name, handler] of events) node.addEventListener(name, handler);
    return {
      update(next) { const changed = next.open !== p.open; p = next; if (changed) place(p.open ? -SWIPE : 0, true); },
      destroy() { for (const [name, handler] of events) node.removeEventListener(name, handler); },
    };
  }
  function removeAt(index) { openKey = null; editing = false; onRemove(index); }

  // ---- Choices shown as buttons ----
  const MARKETS = [
    { key: 'KRW', name: m.market_upbit, unit: m.market_krw },
    { key: 'USDT', name: m.market_binance, unit: m.market_usdt },
    { key: 'USDT-PERP', name: m.market_binance, unit: m.market_perp },
  ];
  let columnsChoice = $state('0');
  $effect(() => { columnsChoice = String(settings.columns); });
  let paletteChoice = $state('green-red');
  $effect(() => { paletteChoice = settings.palette; });
  // The two colour pairs, as samples of themselves.
  const PALETTES = [
    { key: 'green-red', label: m.palette_green_red, up: 'text-[#30d158]', down: 'text-[#ff453a]' },
    { key: 'red-blue', label: m.palette_red_blue, up: 'text-[#ff453a]', down: 'text-[#4b8dff]' },
  ];
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

  <section class="flex flex-col gap-2.5" aria-labelledby="section-prices">
    <h3 id="section-prices" class="px-1 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{m.section_prices()}</h3>
    <!-- What the board shows: one asset large, or several in a grid. A card
         per asset with its live price; drag the handle to reorder, swipe left
         to remove, tap to edit. -->
    <div class="overflow-hidden rounded-2xl bg-card" id="asset-list" role="group" aria-label={m.asset_list()}>
      <div class="relative">
        {#each rows as row (row.id)}
          {@const item = row.asset}
          {@const index = settings.assets.findIndex(other => keyOf(other) === row.id)}
          {@const moved = changeOf(item)}
          <div class="asset-row group/row relative overflow-hidden border-b border-border last:border-b-0 data-[dragging=true]:z-10 data-[dragging=true]:overflow-visible data-[dragging=true]:rounded-xl data-[dragging=true]:shadow-2xl data-[dragging=true]:shadow-black/50" data-dragging={draggingId === row.id} animate:flip={{ duration: draggingId === row.id ? 0 : 180 }}>
            {#if settings.assets.length > 1}
              <!-- Behind the card, uncovered by a swipe. Keyboard and screen readers remove from the editor below. -->
              <button type="button" class="asset-swipe-remove invisible absolute inset-y-0 right-0 w-[88px] bg-destructive text-[15px] font-semibold text-white group-data-[revealed=true]/row:visible" tabindex="-1" aria-hidden="true" onclick={() => removeAt(index)}>{m.asset_swipe_remove()}</button>
            {/if}
            <div class="relative flex items-center bg-card pr-1 [touch-action:pan-y] data-[selected=true]:bg-[color-mix(in_oklab,var(--card),white_6%)]" data-selected={index === selected && editing}
              use:swipe={{ open: openKey === row.id, enabled: settings.assets.length > 1, onchange: open => { openKey = open ? row.id : null; } }}>
              <button type="button" class="asset-pick flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" aria-pressed={index === selected} aria-expanded={index === selected && editing} onclick={() => pick(index)}>
                {#if !failedIcons.has(iconOf(item))}
                  <img src={iconOf(item)} alt="" class="size-9 shrink-0 rounded-full" onerror={() => { failedIcons = new Set([...failedIcons, iconOf(item)]); }} />
                {:else}
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold" aria-hidden="true">{item.ticker.slice(0, 1)}</span>
                {/if}
                <span class="flex min-w-0 flex-col">
                  <span class="text-base font-semibold tracking-wide">{item.ticker}</span>
                  <span class="truncate text-[13px] text-muted-foreground">{EXCHANGES[item.currency].choice}</span>
                </span>
                <span class="ml-auto flex shrink-0 flex-col items-end tabular-nums">
                  <span class="asset-price text-[15px] font-semibold">{priceOf(item) || '—'}</span>
                  {#if moved}<span class="text-[13px] font-medium {moved.tone > 0 ? 'text-[var(--up)]' : moved.tone < 0 ? 'text-[var(--down)]' : 'text-muted-foreground'}">{moved.text}</span>{:else}<span class="text-[13px] text-muted-foreground">{m.no_price_yet()}</span>{/if}
                </span>
              </button>
              {#if settings.assets.length > 1}
                <span class="asset-handle flex size-11 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground outline-none [touch-action:none] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing" role="button" tabindex="0" data-drag-handle use:grab={row.id} aria-label={m.asset_reorder({ name: assetName(item) })}>
                  <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} class="size-5" />
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if canAdd && !adding}
        <button type="button" id="asset-add" class="flex min-h-14 w-full items-center gap-2 border-t border-border px-4 font-medium text-primary outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" onclick={startAdding}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} class="size-5" />{m.asset_add()}
        </button>
      {/if}
    </div>

    {#if adding}
      <div class="flex flex-col gap-3 rounded-2xl bg-card p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none" id="asset-new" role="group" aria-label={m.asset_new()}>
        <div class="flex flex-col gap-2">
          <span id="new-currency-label" class="px-1 text-[13px] text-muted-foreground">{m.field_market()}</span>
          <ToggleGroup type="single" spacing={1} id="new-currency" class="grid w-full gap-1 rounded-[14px] bg-black/25 p-1 grid-cols-3" bind:value={newCurrency} aria-labelledby="new-currency-label"
            onValueChange={value => { newError = ''; if (!value) { tick().then(() => { newCurrency = newCurrency || 'KRW'; }); return; } if (newCoin !== OTHER) newCoin = firstFree(value); }}>
            {#each MARKETS as market}
              <ToggleGroupItem value={market.key} data-value={market.key} aria-label={EXCHANGES[market.key].choice} class="h-auto min-h-12 flex-col gap-0 rounded-[10px] px-1 py-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground data-[state=on]:bg-white/[0.16] data-[state=on]:text-foreground data-[state=on]:shadow-sm">
                <span class="text-[14px] font-semibold">{market.name()}</span><span class="text-[12px]">{market.unit()}</span>
              </ToggleGroupItem>
            {/each}
          </ToggleGroup>
        </div>
        <div class="flex min-h-11 items-center justify-between gap-3 px-1">
          <label for="new-coin">{m.field_coin()}</label>
          <NativeSelect id="new-coin" bind:value={newCoin} onchange={() => { newError = ''; }}>
            {#each PRESETS as preset}<NativeSelectOption value={preset}>{preset}</NativeSelectOption>{/each}
            <NativeSelectOption value={OTHER}>{m.coin_other()}</NativeSelectOption>
          </NativeSelect>
        </div>
        {#if newCoin === OTHER}
          <div class="flex min-h-11 items-center justify-between gap-3 px-1">
            <label for="new-symbol">{m.field_ticker()}</label>
            <Input id="new-symbol" class="w-32 uppercase placeholder:normal-case" placeholder={m.ticker_placeholder()} maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
              enterkeyhint="done" list="new-ticker-list" bind:value={newText} oninput={() => { newError = ''; }}
              onkeydown={event => { if (event.key === 'Enter') { event.preventDefault(); confirmAdding(); } }} />
            <datalist id="new-ticker-list">{#each newListed || [] as ticker}<option value={ticker}></option>{/each}</datalist>
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-2">
          <Button id="asset-new-cancel" variant="secondary" size="lg" class="h-11 rounded-xl" onclick={() => { adding = false; }}>{m.cancel()}</Button>
          <Button id="asset-new-confirm" size="lg" class="h-11 rounded-xl font-semibold" onclick={confirmAdding}>{m.add()}</Button>
        </div>
      </div>
      <p id="asset-new-error" class="px-1 text-[13px] text-destructive" role="alert" hidden={!newError}>{newError}</p>
    {/if}

    <!-- The chosen asset's market and coin, once its row is tapped. -->
    {#if editing && !adding}
      <div class="flex flex-col gap-3 rounded-2xl bg-card p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
        <div class="flex flex-col gap-2">
          <span id="admin-currency-label" class="px-1 text-[13px] text-muted-foreground">{m.field_market()}</span>
          <ToggleGroup type="single" spacing={1} id="admin-currency" class="grid w-full gap-1 rounded-[14px] bg-black/25 p-1 grid-cols-3" bind:value={currencyChoice} aria-labelledby="admin-currency-label" onValueChange={chooseCurrency}>
            {#each MARKETS as market}
              <ToggleGroupItem value={market.key} data-value={market.key} aria-label={EXCHANGES[market.key].choice} class="h-auto min-h-12 flex-col gap-0 rounded-[10px] px-1 py-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground data-[state=on]:bg-white/[0.16] data-[state=on]:text-foreground data-[state=on]:shadow-sm">
                <span class="text-[14px] font-semibold">{market.name()}</span><span class="text-[12px]">{market.unit()}</span>
              </ToggleGroupItem>
            {/each}
          </ToggleGroup>
        </div>
        <div class="flex min-h-11 items-center justify-between gap-3 px-1">
          <label for="admin-coin">{m.field_coin()}</label>
          <NativeSelect id="admin-coin" bind:value={coinChoice} onchange={event => chooseCoin(event.currentTarget.value)}>
            {#if !preset}<NativeSelectOption value={asset.ticker}>{asset.ticker}</NativeSelectOption>{/if}
            {#each PRESETS as preset}<NativeSelectOption value={preset}>{preset}</NativeSelectOption>{/each}
            <NativeSelectOption value={OTHER}>{m.coin_other()}</NativeSelectOption>
          </NativeSelect>
        </div>
        {#if otherOpen}
          <div class="flex min-h-11 items-center justify-between gap-3 px-1">
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
        {#if settings.assets.length > 1}
          <Button id="asset-remove" variant="destructive" size="lg" class="asset-remove h-11 rounded-xl" onclick={() => removeAt(selected)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} class="size-5" />{m.asset_remove_this()}
          </Button>
        {/if}
      </div>
    {/if}
    {#if settings.assets.length > 1}
      <div class="flex flex-col gap-2 rounded-2xl bg-card p-3">
        <span id="admin-columns-label" class="px-1 text-[13px] text-muted-foreground">{m.columns()}</span>
        <ToggleGroup type="single" spacing={1} id="admin-columns" class="grid w-full gap-1 rounded-[14px] bg-black/25 p-1 grid-cols-7" bind:value={columnsChoice} aria-labelledby="admin-columns-label"
          onValueChange={value => { if (value) onColumns(Number(value)); else tick().then(() => { columnsChoice = String(settings.columns); }); }}>
          {#each ['0', '1', '2', '3', '4', '5', '6'] as columns}
            <ToggleGroupItem value={columns} data-value={columns} class="h-auto min-h-12 flex-col gap-0 rounded-[10px] px-1 py-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground data-[state=on]:bg-white/[0.16] data-[state=on]:text-foreground data-[state=on]:shadow-sm min-h-10 text-[14px] font-semibold">{columns === '0' ? m.columns_auto() : columns}</ToggleGroupItem>
          {/each}
        </ToggleGroup>
      </div>
    {/if}
    <p id="admin-symbol-error" class="px-1 text-[13px] text-destructive" role="alert" hidden={!tickerError}>{tickerError}</p>
    <p id="status-indicator" class="{status.tone} flex items-start gap-2 px-1 text-[13px] leading-normal whitespace-pre-line text-muted-foreground [&.error]:text-destructive" role="status" aria-live="polite" hidden={status.tone === 'connected'}><span class="mt-[0.45em] size-2 shrink-0 rounded-full bg-current" aria-hidden="true"></span>{status.text}</p>
    <p id="overlay-msg" class="px-1 text-[13px] leading-normal whitespace-pre-line text-muted-foreground" hidden={!status.detail}>{status.detail}</p>
    <Button id="market-retry" variant="secondary" size="lg" class="h-11 rounded-xl" hidden={!status.canRetry} onclick={onRetryFeed}>{m.reconnect()}</Button>
  </section>

  <section class="flex flex-col gap-2.5" aria-labelledby="section-display">
    <h3 id="section-display" class="px-1 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{m.section_display()}</h3>
    <div class="overflow-hidden rounded-2xl bg-card">
      <div class="flex flex-col gap-2 border-b border-border px-4 pt-3 pb-3.5">
        <div class="flex items-center justify-between">
          <span id="admin-brightness-label">{m.brightness()}</span>
          <span id="brightness-value" class="text-sm text-muted-foreground tabular-nums">{brightness}%</span>
        </div>
        <div class="flex items-center gap-3 text-muted-foreground">
          <HugeiconsIcon icon={Sun03Icon} strokeWidth={2} class="size-4 shrink-0" />
          <Slider id="admin-brightness" type="single" min={10} max={100} step={5} bind:value={brightness} aria-labelledby="admin-brightness-label"
            onValueChange={value => onBrightnessPreview(Number(value))} onValueCommit={value => onBrightness(Number(value))} />
          <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} class="size-6 shrink-0" />
        </div>
      </div>
      <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <label for="admin-burn-in">{m.burn_in()}</label>
        <Switch id="admin-burn-in" size="lg" checked={settings.burnIn} onCheckedChange={value => onBurnIn(value)} />
      </div>
      <div class="flex flex-col gap-2 px-4 pt-3 pb-3.5">
        <span id="admin-palette-label">{m.palette()}</span>
        <ToggleGroup type="single" spacing={1} id="admin-palette" class="grid w-full gap-1 rounded-[14px] bg-black/25 p-1 grid-cols-2" bind:value={paletteChoice} aria-labelledby="admin-palette-label"
          onValueChange={value => { if (value) onPalette(value); else tick().then(() => { paletteChoice = settings.palette; }); }}>
          {#each PALETTES as palette}
            <ToggleGroupItem value={palette.key} data-value={palette.key} aria-label={palette.label()} class="h-auto min-h-12 flex-col gap-0 rounded-[10px] px-1 py-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground data-[state=on]:bg-white/[0.16] data-[state=on]:text-foreground data-[state=on]:shadow-sm min-h-14 gap-0.5">
              <span class="flex items-center gap-2.5 text-[15px] font-semibold tabular-nums" aria-hidden="true"><span class={palette.up}>▲ 1.24%</span><span class={palette.down}>▼ 0.85%</span></span>
              <span class="text-[12px]">{palette.label()}</span>
            </ToggleGroupItem>
          {/each}
        </ToggleGroup>
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
