<script>
  // The board itself: icon, price, source, change, and one quiet line of trouble.
  // It is laid out at a fixed design size and scaled to fill the screen.
  import { onMount } from 'svelte';
  import { price as formatPrice, change as formatChange, direction } from '../lib/format.js';

  let { settings, tick, status, notice, brightness, active } = $props();

  // How much of the screen the board may take; the rest is room to float in.
  const FILL = { width: 0.86, landscapeHeight: 0.6, portraitHeight: 0.72 };
  const EDGE = 16;

  const iconSrc = $derived(settings.ticker === 'BTC' ? './bitcoin-btc-logo.svg'
    : `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${settings.ticker.toLowerCase()}.svg`);
  let failedIcon = $state(null);
  const iconFailed = $derived(failedIcon === iconSrc);

  const priceText = $derived(tick ? formatPrice(tick.selection.currency, tick.price) : '—');
  const changeText = $derived(tick ? formatChange(tick.change) : '—');
  const changeDirection = $derived(tick ? direction(tick.change) : 0);
  const source = $derived(settings.currency === 'KRW' ? `업비트 · KRW-${settings.ticker}` : `바이낸스 · ${settings.ticker}/USDT`);
  const tone = value => value > 0 ? 'lightgreen' : value < 0 ? 'lightcoral' : 'white';

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

  let container;
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
    const portrait = window.innerHeight > window.innerWidth;
    const next = Math.min(width * FILL.width / container.offsetWidth,
      height * (portrait ? FILL.portraitHeight : FILL.landscapeHeight) / container.offsetHeight);
    if (!Number.isFinite(next) || next <= 0) return;
    scale = next;
    room = { x: Math.max(0, (width - container.offsetWidth * next) / 2 - EDGE), y: Math.max(0, (height - container.offsetHeight * next) / 2 - EDGE) };
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

  // Burn-in protection: once a minute pick a new spot anywhere in the free
  // space; the CSS transition makes the move take the whole minute.
  $effect(() => {
    if (!active) return;
    const wander = () => { gliding = true; offset = { x: (Math.random() * 2 - 1) * room.x, y: (Math.random() * 2 - 1) * room.y }; };
    const start = setTimeout(wander, 1000);
    const timer = setInterval(wander, 60000);
    return () => { clearTimeout(start); clearInterval(timer); };
  });
</script>

<div id="stage">
  <div id="drift" style:transition={gliding ? null : 'none'} style:transform="translate({offset.x}px, {offset.y}px)">
    <div id="container" bind:this={container} class:price-unavailable={status.unavailable}
      style:filter="brightness({brightness}%)" style:transform="scale({scale})">
      {#if iconFailed}
        <div id="icon-fallback">{settings.ticker.slice(0, 5)}</div>
      {:else}
        <img id="icon" src={iconSrc} alt="{settings.ticker} logo" crossorigin={iconSrc.startsWith('https:') ? 'anonymous' : undefined}
          onerror={() => { failedIcon = iconSrc; }} />
      {/if}
      <div>
        <p id="price-main" aria-live="polite" aria-atomic="true" style:color={tone(flash)}>{priceText}</p>
        <p id="price-source">{source}</p>
        {#if status.titleShown || notice}
          <div id="status-overlay">
            {#if status.titleShown}<p id="overlay-title">{status.title}</p>{/if}
            {#if notice}<p id="notice">{notice}</p>{/if}
          </div>
        {/if}
      </div>
      <div>
        <p id="change" aria-live="polite" aria-atomic="true" style:color={tone(changeDirection)}>{changeText}</p>
        <p id="change-label">{settings.currency === 'KRW' ? '전일 대비' : '24h'}</p>
      </div>
    </div>
  </div>
</div>
