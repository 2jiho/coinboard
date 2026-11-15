<script>
  // The board itself: icon, price, source, change, and one quiet line of trouble.
  import { price as formatPrice, change as formatChange, direction } from '../lib/format.js';

  let { settings, tick, status, notice, brightness, active } = $props();

  const iconSrc = $derived(settings.ticker === 'BTC' ? './bitcoin-btc-logo.svg'
    : `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${settings.ticker.toLowerCase()}.svg`);
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

  // Burn-in protection: nudge the whole board a little once a minute.
  let container;
  let offset = $state({ x: 0, y: 0 });
  $effect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const limitX = Math.max(0, Math.floor((window.innerWidth - container.offsetWidth) * 0.05));
      const limitY = Math.max(0, Math.floor((window.innerHeight - container.offsetHeight) * 0.05));
      const step = () => Math.random() < 0.5 ? 10 : -10;
      offset = { x: Math.max(-limitX, Math.min(limitX, offset.x + step())), y: Math.max(-limitY, Math.min(limitY, offset.y + step())) };
    }, 60000);
    return () => clearInterval(timer);
  });
</script>

<div id="container" bind:this={container} class:price-unavailable={status.unavailable}
  style:filter="brightness({brightness}%)" style:transform="translate({offset.x}px, {offset.y}px)">
  {#if iconFailed}
    <div id="icon-fallback">{settings.ticker}</div>
  {:else}
    <img id="icon" src={iconSrc} alt="{settings.ticker} logo" onerror={() => { failedIcon = iconSrc; }} />
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
