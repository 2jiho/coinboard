<script>
  // The board itself: icon, price, source, change, and one quiet line of trouble.
  // It is laid out at a fixed design size and scaled to fill the screen.
  import { onMount } from 'svelte';
  import { priceParts, change as formatChange, direction } from '../lib/format.js';

  let { settings, tick, status, notice, brightness, active } = $props();

  // Burn-in protection moves the board only a little: far enough to rest the
  // pixels, not far enough to look off-centre. A share of each screen side.
  const DRIFT = 0.03;

  // How much of the screen the board may take; the rest is room to float in.
  const FILL = { width: 0.86, height: 0.62 };
  const EDGE = 16;

  // Icons ship with the app in public/coins. A coin without one shows its ticker instead.
  const iconSrc = $derived(`./coins/${settings.ticker.toLowerCase()}.svg`);
  let failedIcon = $state(null);
  const iconFailed = $derived(failedIcon === iconSrc);

  const parts = $derived(tick ? priceParts(tick.selection.currency, tick.price) : { pieces: [{ number: '—', mark: '' }], unit: '' });
  const changeText = $derived(tick ? formatChange(tick.change) : '—');
  const changeDirection = $derived(tick ? direction(tick.change) : 0);
  // The day's range, and where the price sits in it (0 at the low, 100 at the high).
  const range = $derived(settings.range && tick && tick.high !== null && tick.low !== null ? {
    low: priceParts(tick.selection.currency, tick.low), high: priceParts(tick.selection.currency, tick.high),
    at: tick.high > tick.low ? Math.max(0, Math.min(100, Math.round((tick.price - tick.low) / (tick.high - tick.low) * 100))) : 50,
  } : null);
  // "▼ 2.50%" is drawn as a small arrow and the number; together they read the same.
  const changeArrow = $derived(changeText.includes(' ') ? changeText.split(' ')[0] : '');
  const changeNumber = $derived(changeArrow ? changeText.slice(changeArrow.length) : changeText);
  // The board is English only; Korean lives in the settings panel.
  const source = $derived(settings.currency === 'KRW' ? `UPBIT · KRW-${settings.ticker}` : `BINANCE · ${settings.ticker}/USDT`);
  const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

  // Flash the price green or red for half a second when it moves.
  let flash = $state(0);
  let lastPrice = null, flashTimer;
  $effect(() => {
    const next = tick ? tick.price : null;
    if (next === null) { clearTimeout(flashTimer); flash = 0; lastPrice = null; return; }
    if (lastPrice !== null && next !== lastPrice) {
      flash = next > lastPrice ? 1 : -1;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = 0; }, 500);
    }
    lastPrice = next;
  });

  let container, priceLine;
  // The price line, not the whole block, is what sits in the middle of the
  // screen: lift is how far the block must move for that to be true.
  let lift = $state(0);
  // In landscape the icon is level with the price line, not with the whole block.
  let iconDrop = $state(0);
  let scale = $state(1);
  let room = { x: 0, y: 0 };
  let offset = $state({ x: 0, y: 0 });
  // Floating is slow on purpose; a correction after a resize must be instant.
  let gliding = $state(false);
  const within = (value, limit) => Math.max(-limit, Math.min(limit, value));

  // Scale the board to the screen, and work out how far it may float.
  function fit() {
    if (!container) return;
    const style = getComputedStyle(document.documentElement);
    const inset = side => parseFloat(style.getPropertyValue('--safe-' + side)) || 0;
    const width = window.innerWidth - inset('left') - inset('right');
    const height = window.innerHeight - inset('top') - inset('bottom');
    const middle = priceLine.offsetTop + priceLine.offsetHeight / 2;
    // Height is counted from the price line outwards, since that is the centre.
    const reach = 2 * Math.max(middle, container.offsetHeight - middle);
    const next = Math.min(width * FILL.width / container.offsetWidth, height * FILL.height / reach);
    if (!Number.isFinite(next) || next <= 0) return;
    scale = next;
    lift = (container.offsetHeight / 2 - middle) * next;
    iconDrop = window.matchMedia('(orientation: portrait)').matches ? 0 : middle - container.offsetHeight / 2;
    room = { x: Math.min(width * DRIFT, Math.max(0, (width - container.offsetWidth * next) / 2 - EDGE)),
      y: Math.min(height * DRIFT, Math.max(0, (height - reach * next) / 2 - EDGE)) };
    gliding = false;
    offset = { x: within(offset.x, room.x), y: within(offset.y, room.y) };
  }
  onMount(() => {
    // The board's own size changes when the text gets longer or shorter.
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener('resize', fit);
    fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  });

  // Burn-in protection: once a minute pick a new spot close to the centre; the
  // CSS transition makes the move take the whole minute. Switched off, the
  // board sits exactly in the middle.
  $effect(() => {
    if (!settings.burnIn) { gliding = false; offset = { x: 0, y: 0 }; return; }
    if (!active) return;
    const wander = () => { gliding = true; offset = { x: (Math.random() * 2 - 1) * room.x, y: (Math.random() * 2 - 1) * room.y }; };
    const start = setTimeout(wander, 1000);
    const timer = setInterval(wander, 60000);
    return () => { clearTimeout(start); clearInterval(timer); };
  });
</script>

<!-- A price as its numbers and their 억/만 marks. -->
{#snippet amount(value)}{#each value.pieces as piece, index}{index ? ' ' : ''}{piece.number}{#if piece.mark}<span class="mark">{piece.mark}</span>{/if}{/each}{/snippet}

<div id="stage">
  <div id="drift" style:transition={gliding ? null : 'none'} style:transform="translate({offset.x}px, {offset.y + lift}px)">
    <div id="container" bind:this={container} class:price-unavailable={status.unavailable}
      style:filter="brightness({brightness}%)" style:transform="scale({scale})">
      <!-- Landscape: a large icon, then three lines. Portrait: the same, stacked. -->
      {#if !iconFailed}
        <img id="icon" src={iconSrc} alt="" style:transform="translateY({iconDrop}px)" onerror={() => { failedIcon = iconSrc; }} />
      {/if}
      <div id="board-text">
        <p id="board-head"><span id="coin">{settings.ticker}</span><span id="unit">{settings.currency}</span></p>
        <p id="price-main" bind:this={priceLine} class={tone(flash)} aria-live="polite" aria-atomic="true">{@render amount(parts)}</p>
        <p id="price-source">{source}</p>
        <p id="board-foot">
          <span id="change" class={tone(changeDirection)} aria-live="polite" aria-atomic="true">{#if changeArrow}<span class="arrow">{changeArrow}</span>{/if}{changeNumber}</span>
          <span id="change-label">{settings.currency === 'KRW' ? '1D' : '24H'}</span>
        </p>
        {#if range}
          <p id="range" aria-label="Day range">
            <span id="range-low"><span class="end">L</span>{' '}{@render amount(range.low)}</span>
            <span id="range-track"><span id="range-dot" style:left="{range.at}%"></span></span>
            <span id="range-high"><span class="end">H</span>{' '}{@render amount(range.high)}</span>
          </p>
        {/if}
        {#if status.titleShown || notice}
          <div id="status-overlay">
            {#if status.titleShown}<p id="overlay-title">{status.title}</p>{/if}
            {#if notice}<p id="notice">{notice}</p>{/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
