<script>
  // Everything here applies as soon as it is changed. The ticker is the one
  // field that needs a decision, because typing is not choosing.
  import { onMount, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { normalizeTicker, sameAsset } from '../lib/settings.js';
  import { PRESETS } from '../lib/presets.js';
  import { EXCHANGES, MARKET_GROUPS } from '../lib/exchanges/index.js';
  import { m } from '../paraglide/messages.js';
  import { priceParts, change as formatChange, direction } from '../lib/format.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from '$lib/components/ui/native-select/index.js';
  import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Share03Icon, AddSquareIcon, Download04Icon, PictureInPictureOnIcon, PictureInPictureExitIcon } from '@hugeicons/core-free-icons';
  import { Cancel01Icon, Delete02Icon, PlusSignIcon, GithubIcon, DragDropVerticalIcon, Sun01Icon, Sun03Icon, HelpCircleIcon, ArrowLeft01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';

  let { settings, canAdd, ticks, status, wake, versionLabel, updateReady, install = null, installDismissed = false,
    onInstall = () => {}, onDismissInstall = () => {}, pipSupported = false, pipOpen = false, onPip = () => {}, onClose, onAdd, onRemove, onReorder, onColumns, onBrightnessPreview, onBrightness, onBurnIn, onPalette, onChart = () => {}, onRetryFeed, onRetryWake, onUpdate, loadTickers } = $props();

  let panel;
  const assetName = item => `${item.ticker} ${EXCHANGES[item.currency].choice}`;
  let brightness = $state(untrack(() => settings.brightness));
  // The new asset's coin is a one-line choice: the listed coins, and
  // "직접 입력…", which opens a field for any other ticker.
  const OTHER = '__other';
  // The screen-on state in a word, with the colour of the status dot.
  const WAKE = {
    active: { label: m.wake_state_active, color: 'bg-[#30d158]' },
    pending: { label: m.wake_state_pending, color: 'bg-muted-foreground' },
    waiting: { label: m.wake_state_waiting, color: 'bg-muted-foreground' },
    released: { label: m.wake_state_off, color: 'bg-[#ffd60a]' },
    failed: { label: m.wake_state_off, color: 'bg-[#ffd60a]' },
    unsupported: { label: m.wake_state_unsupported, color: 'bg-muted-foreground' },
  };
  // Worth a line only when something is wrong.
  const wakeTrouble = $derived(['unsupported', 'released', 'failed'].includes(wake.kind));
  // The add form: market and coin for a new asset, added only on 추가. It
  // starts in the market of the last asset, on the first listed coin not yet
  // shown there. An asset is not edited: another coin is added, and the old one deleted.
  let adding = $state(false);
  let newCurrency = $state('KRW'), newCoin = $state(''), newText = $state(''), newError = $state('');
  let newListed = $state(null);
  const firstFree = currency => PRESETS.find(coin => !settings.assets.some(item => sameAsset(item, { currency, ticker: coin }))) ?? OTHER;
  function startAdding() {
    newCurrency = settings.assets.at(-1).currency; newCoin = firstFree(newCurrency); newText = ''; newError = '';
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
      if (!ticker) { newError = m.ticker_invalid(); return; }
      if (newListed && !newListed.includes(ticker)) { newError = m.ticker_not_listed({ market: EXCHANGES[newCurrency].listName }); return; }
    }
    newError = onAdd({ currency: newCurrency, ticker });
    if (!newError) adding = false;
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
      draggingId = id;
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


  // ---- Choices shown as buttons ----
  const GROUP_LABELS = { KRW: m.group_krw, USDT: m.group_usdt, USD: m.group_usd };
  let columnsChoice = $state('0');
  $effect(() => { columnsChoice = String(settings.columns); });
  let paletteChoice = $state('green-red');
  $effect(() => { paletteChoice = settings.palette; });
  // The line chart beside the change: off, or its period.
  const CHARTS = [['off', m.chart_off], ['15m', m.chart_15m], ['1h', m.chart_1h], ['1d', m.chart_1d], ['1w', m.chart_1w], ['1M', m.chart_1M]];
  let chartChoice = $state('1d');
  $effect(() => { chartChoice = settings.chart; });
  // The two colour pairs, as samples of themselves.
  const PALETTES = [
    { key: 'green-red', label: m.palette_green_red, up: 'text-[#30d158]', down: 'text-[#ff453a]' },
    { key: 'red-blue', label: m.palette_red_blue, up: 'text-[#ff453a]', down: 'text-[#4b8dff]' },
  ];
  // ---- Help ----
  // A short guide in place of the settings, and back. Focus goes to the way back
  // and returns to the help button, so a keyboard does not lose its place.
  let helpOpen = $state(false);
  async function showHelp(open) {
    helpOpen = open;
    await tick();
    panel.scrollTop = 0;
    panel.querySelector(open ? '#help-back' : '#help-open')?.focus();
  }
  const STATUS_COLORS = [
    { color: 'bg-[#30d158]', label: m.help_status_ok },
    { color: 'bg-[#ffd60a]', label: m.help_status_warn },
    { color: 'bg-[#ff453a]', label: m.help_status_bad },
  ];
  const HELP = [
    { title: m.help_settings_title, body: m.help_settings_body },
    { title: m.help_status_title, body: m.help_status_body, colors: true },
    { title: m.help_assets_title, body: m.help_assets_body },
    { title: m.help_reading_title, body: m.help_reading_body },
    { title: m.help_keep_title, body: m.help_keep_body, install: true },
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
    <div class="flex items-center gap-1">
      {#if helpOpen}
        <Button id="help-back" variant="ghost" size="icon" class="-ml-2 size-11 rounded-full text-muted-foreground hover:bg-white/10" aria-label={m.help_back()} onclick={() => showHelp(false)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} class="size-6" />
        </Button>
      {/if}
      <h2 id="admin-title" class="text-[22px] font-bold tracking-tight">{helpOpen ? m.help_title() : m.settings_title()}</h2>
    </div>
    <Button id="admin-close" variant="secondary" size="icon" class="size-11 rounded-full bg-white/10 text-muted-foreground hover:bg-white/15" aria-label={m.settings_close()} onclick={() => onClose(true)}>
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} class="size-5" />
    </Button>
  </div>

  <!-- How to add it to the home screen: the browser's own install, or the steps on iPhone and iPad. -->
  {#snippet installWays(id)}
    {#if install === 'prompt'}
      <Button id={id + '-button'} size="lg" class="h-11 rounded-xl font-semibold" onclick={onInstall}>
        <HugeiconsIcon icon={Download04Icon} strokeWidth={2} class="size-5" />{m.install_button()}
      </Button>
    {:else if install === 'ios'}
      <ol id={id + '-steps'} class="flex flex-col gap-2 text-[15px]">
        <li class="flex items-center gap-3"><span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#0a84ff]"><HugeiconsIcon icon={Share03Icon} strokeWidth={2} class="size-5" /></span>{m.install_ios_1()}</li>
        <li class="flex items-center gap-3"><span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10"><HugeiconsIcon icon={AddSquareIcon} strokeWidth={2} class="size-5" /></span>{m.install_ios_2()}</li>
        <li class="flex items-center gap-3"><span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[13px] font-semibold">3</span>{m.install_ios_3()}</li>
      </ol>
    {/if}
  {/snippet}

  {#if helpOpen}
  <div id="help" class="flex flex-col gap-2.5 break-keep">
    {#each HELP as item}
      <section class="flex flex-col gap-2 rounded-2xl bg-card px-4 py-3.5">
        <h3 class="text-base font-semibold">{item.title()}</h3>
        <p class="text-[15px] leading-relaxed text-muted-foreground">{item.body()}</p>
        {#if item.install && install}{@render installWays('help-install')}{/if}
        {#if item.colors}
          <ul class="flex flex-col gap-1.5 pt-0.5">
            {#each STATUS_COLORS as status}
              <li class="flex items-center gap-2.5 text-[14px]"><span class="size-2.5 shrink-0 rounded-full {status.color}" aria-hidden="true"></span>{status.label()}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
    <a id="help-guide" class="flex min-h-12 items-center justify-between rounded-2xl bg-card px-4 text-[15px] font-semibold transition-colors hover:bg-[color-mix(in_oklab,var(--card),white_6%)] focus-visible:outline-2 focus-visible:outline-ring" href={m.help_guide_url()} target="_blank" rel="noopener noreferrer">
      {m.help_guide()}
      <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} class="size-5 text-muted-foreground" />
    </a>
  </div>
  {:else}
  {#if install && !installDismissed}
    <section id="install" class="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3.5 break-keep" aria-labelledby="install-title">
      <div class="flex items-start justify-between gap-3">
        <!-- The icon it will have on the home screen. -->
        <img src="./favicon.svg" alt="" class="install-icon size-12 shrink-0" />
        <div class="flex flex-1 flex-col gap-1">
          <h3 id="install-title" class="text-base font-semibold">{m.install_title()}</h3>
          <p class="text-[14px] leading-relaxed text-muted-foreground">{m.install_body()}</p>
        </div>
        <button id="install-dismiss" type="button" class="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label={m.install_dismiss()} onclick={onDismissInstall}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} class="size-5" />
        </button>
      </div>
      {@render installWays('install')}
    </section>
  {/if}
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
            <div class="relative flex items-center bg-card pr-1">
              <div class="asset-info flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2">
                {#if !failedIcons.has(iconOf(item))}
                  <img src={iconOf(item)} alt="" class="size-9 shrink-0 rounded-full" onerror={() => { failedIcons = new Set([...failedIcons, iconOf(item)]); }} />
                {:else}
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold" aria-hidden="true">{item.ticker.slice(0, 1)}</span>
                {/if}
                <span class="flex min-w-0 flex-col">
                  <span class="asset-ticker text-base font-semibold tracking-wide">{item.ticker}</span>
                  <span class="truncate text-[13px] text-muted-foreground">{EXCHANGES[item.currency].choice}</span>
                </span>
                <span class="ml-auto flex shrink-0 flex-col items-end tabular-nums">
                  <span class="asset-price text-[15px] font-semibold">{priceOf(item) || '—'}</span>
                  {#if moved}<span class="text-[13px] font-medium {moved.tone > 0 ? 'text-[var(--up)]' : moved.tone < 0 ? 'text-[var(--down)]' : 'text-muted-foreground'}">{moved.text}</span>{:else}<span class="text-[13px] text-muted-foreground">{m.no_price_yet()}</span>{/if}
                </span>
              </div>
              {#if settings.assets.length > 1}
                <!-- Deleting is one tap; the toast that follows can undo it. The last asset stays. -->
                <button type="button" class="asset-delete flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring" aria-label={m.asset_remove({ name: assetName(item) })} onclick={() => onRemove(index)}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} class="size-5" />
                </button>
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
        <!-- Markets as a list, by the currency prices are in: room for any number of exchanges. -->
        <div class="flex min-h-11 items-center justify-between gap-3 px-1">
          <label for="new-currency">{m.field_market()}</label>
          <NativeSelect id="new-currency" bind:value={newCurrency} onchange={() => { newError = ''; if (newCoin !== OTHER) newCoin = firstFree(newCurrency); }}>
            {#each MARKET_GROUPS as group}
              <NativeSelectOptGroup label={GROUP_LABELS[group.quote]()}>
                {#each group.keys as key}<NativeSelectOption value={key}>{EXCHANGES[key].choice}</NativeSelectOption>{/each}
              </NativeSelectOptGroup>
            {/each}
          </NativeSelect>
        </div>
        <div class="flex min-h-11 items-center justify-between gap-3 px-1">
          <label for="new-coin">{m.field_coin()}</label>
          <NativeSelect id="new-coin" bind:value={newCoin} onchange={async () => { newError = ''; if (newCoin === OTHER) { await tick(); panel.querySelector('#new-symbol')?.focus(); } }}>
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
        <div class="flex flex-col gap-0.5 py-2.5">
          <label for="admin-burn-in">{m.burn_in()}</label>
          <span id="burn-in-hint" class="text-[13px] leading-snug text-muted-foreground">{m.burn_in_hint()}</span>
        </div>
        <Switch id="admin-burn-in" size="lg" checked={settings.burnIn} onCheckedChange={value => onBurnIn(value)} aria-describedby="burn-in-hint" />
      </div>
      <!-- Whether the screen is being kept on, always: green while it is. -->
      <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <span id="wake-label">{m.wake_label()}</span>
        <span id="wake-state" class="flex items-center gap-2 text-[15px] text-muted-foreground" data-kind={wake.kind} role="status" aria-labelledby="wake-label wake-state">
          <span class="size-2 shrink-0 rounded-full {WAKE[wake.kind]?.color ?? 'bg-muted-foreground'}" aria-hidden="true"></span>{(WAKE[wake.kind]?.label ?? m.wake_state_pending)()}
        </span>
      </div>
      <div class="flex flex-col gap-2 border-b border-border px-4 pt-3 pb-3.5">
        <span id="admin-chart-label">{m.chart()}</span>
        <ToggleGroup type="single" spacing={1} id="admin-chart" class="grid w-full gap-1 rounded-[14px] bg-black/25 p-1 grid-cols-6" bind:value={chartChoice} aria-labelledby="admin-chart-label"
          onValueChange={value => { if (value) onChart(value); else tick().then(() => { chartChoice = settings.chart; }); }}>
          {#each CHARTS as [value, label]}
            <ToggleGroupItem {value} data-value={value} class="h-auto min-h-10 rounded-[10px] px-0.5 py-1.5 text-[14px] font-semibold text-muted-foreground hover:bg-white/[0.06] hover:text-foreground data-[state=on]:bg-white/[0.16] data-[state=on]:text-foreground data-[state=on]:shadow-sm">{label()}</ToggleGroupItem>
          {/each}
        </ToggleGroup>
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
    {#if pipSupported}
      <!-- A small window on top of other windows; desktop Chrome and Edge only. -->
      <Button id="pip-toggle" variant="secondary" size="lg" class="h-12 justify-start gap-3 rounded-2xl bg-card px-4 text-[15px] font-normal hover:bg-[color-mix(in_oklab,var(--card),white_6%)]" aria-describedby="pip-hint" onclick={onPip}>
        <HugeiconsIcon icon={pipOpen ? PictureInPictureExitIcon : PictureInPictureOnIcon} strokeWidth={1.8} class="size-5 text-muted-foreground" />{pipOpen ? m.pip_close() : m.pip_open()}
      </Button>
      <p id="pip-hint" class="-mt-1 px-1 text-[13px] leading-snug text-muted-foreground">{m.pip_hint()}</p>
    {/if}
    <p id="wake-lock-status" class="px-1 text-[13px] leading-normal text-muted-foreground" role="status" aria-live="polite" hidden={!wakeTrouble}>{wake.message}</p>
    <Button id="wake-lock-retry" variant="secondary" size="lg" class="h-11 rounded-xl" hidden={!wake.canRetry} onclick={onRetryWake}>{m.wake_retry()}</Button>
    <Button id="app-update" size="lg" class="h-11 rounded-xl font-semibold" hidden={!updateReady} onclick={onUpdate}>{m.update_now()}</Button>
  </section>

  <footer class="flex items-center justify-between px-1">
    <div class="flex items-center gap-2.5">
      <img src="./favicon.svg" alt="" class="app-icon size-7 shrink-0" />
      <div class="flex flex-col leading-tight">
        <span class="text-[14px] font-semibold">Coinboard</span>
        <p id="app-version" class="text-[12px] text-muted-foreground tabular-nums">{versionLabel}</p>
      </div>
    </div>
    <div class="-mr-2 flex items-center">
    <button id="help-open" type="button" class="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label={m.help_open()} onclick={() => showHelp(true)}>
      <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={1.8} class="size-6" />
    </button>
    <a id="admin-repo" class="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" href="https://github.com/2jiho/coinboard" target="_blank" rel="noopener noreferrer" aria-label={m.repo_link()}>
      <HugeiconsIcon icon={GithubIcon} strokeWidth={1.8} class="size-6" />
    </a>
    </div>
  </footer>
  {/if}
</div>
