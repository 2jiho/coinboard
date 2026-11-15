<script>
  // The board itself: icon, coin and currency, price, change.
  // Every part has a zone of fixed size, and the whole is scaled to the screen,
  // so the board is the same size whatever the price. A price too long for its
  // zone is drawn smaller inside that zone; nothing else moves.
  import { onMount, untrack } from 'svelte';
  import { priceParts, change as formatChange, direction } from '../lib/format.js';
  import { describeMarket } from '../lib/feed.js';

  let { settings, tick, status, brightness, active } = $props();

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
  // "▼ 2.50%" is drawn as a small arrow and the number; together they read the same.
  const changeArrow = $derived(changeText.includes(' ') ? changeText.split(' ')[0] : '');
  const changeNumber = $derived(changeArrow ? changeText.slice(changeArrow.length) : changeText);
  // Names for this market come from its exchange. The board is English only;
  // Korean lives in the settings panel.
  const market = $derived(describeMarket(settings.currency, settings.ticker));
  const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

  // When the price moves, which way: changed digits roll in from that side and
  // the price is tinted with its colour for a moment. This runs before the screen
  // is updated, so new digits are born knowing their direction.
  let flash = $state(0);
  let trend = $state(0);
  let lastPrice = null, flashTimer;
  $effect.pre(() => {
    const next = tick ? tick.price : null;
    if (next === null) { clearTimeout(flashTimer); flash = 0; trend = 0; lastPrice = null; return; }
    if (lastPrice !== null && next !== lastPrice) {
      trend = flash = next > lastPrice ? 1 : -1;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = 0; }, 700);
    }
    lastPrice = next;
  });

  // A digit learns its direction once, when it appears, and keeps it. If the
  // direction were tied to the current trend instead, every digit would change
  // class when the price turned round, and all of them would move at once.
  function roll(node) {
    const direction = untrack(() => trend);
    if (direction) node.classList.add(direction > 0 ? 'up' : 'down');
  }

  let container, priceLine, priceText;
  // 1 normally; less when the price is wider than its zone.
  let priceScale = $state(1);
  function fitPrice() {
    if (!priceLine || !priceText) return;
    const zone = priceLine.clientWidth, wanted = priceText.offsetWidth;
    priceScale = wanted > zone ? zone / wanted : 1;
  }
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
    // The zones are fixed, so the board is refitted only when the screen (or the
    // orientation, which changes the zones) does; the price is refitted in its
    // zone whenever its text changes width.
    const boardObserver = new ResizeObserver(fit), priceObserver = new ResizeObserver(fitPrice);
    boardObserver.observe(container); priceObserver.observe(priceText); priceObserver.observe(priceLine);
    window.addEventListener('resize', fit);
    fit(); fitPrice();
    return () => { boardObserver.disconnect(); priceObserver.disconnect(); window.removeEventListener('resize', fit); };
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
        <p id="price-main" bind:this={priceLine} class={tone(flash)} aria-live="polite" aria-atomic="true"><span id="price-text" bind:this={priceText} style:transform="scale({priceScale})">{#each parts.pieces as piece, index}{index ? ' ' : ''}{#each [...piece.number] as char, place (place)}{#key char}<span class="digit" use:roll>{char}</span>{/key}{/each}{#if piece.mark}<span class="mark">{piece.mark}</span>{/if}{/each}</span></p>
        <p id="price-source">{market.label} · {market.pair}</p>
        <p id="board-foot">
          <span id="change" class={tone(changeDirection)} aria-live="polite" aria-atomic="true">{#if changeArrow}<span class="arrow">{changeArrow}</span>{/if}{changeNumber}</span>
          <span id="change-label">{market.changeLabel}</span>
        </p>
      </div>
    </div>
  </div>
</div>
