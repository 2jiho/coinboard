<script>
  // One price, as the board draws it: digits that roll over one by one when
  // they change, and a tint whose depth follows the size of the move. Used for
  // the single large price and for each cell of the grid.
  import { untrack } from 'svelte';
  import { priceParts } from '../lib/format.js';
  import { moveStrength } from '../lib/move.js';

  // id and textId name the single board's price; grid cells have none.
  // live: announce changes to screen readers (the single board only: six
  // prices talking at once would be noise). line and text are bound by the
  // board, which measures them to fit the price in its zone.
  let { tick, scale = 1, id = undefined, textId = undefined, live = false, line = $bindable(), text = $bindable() } = $props();

  const parts = $derived(tick ? priceParts(tick.selection.quote, tick.price) : { pieces: [{ number: '—', mark: '' }], unit: '' });
  const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

  // When the price moves, which way: changed digits roll in from that side and
  // the price is tinted with its colour for a moment. This runs before the screen
  // is updated, so new digits are born knowing their direction.
  let flash = $state(0);
  let trend = $state(0);
  // How big the move was (1 slight, 2 ordinary, 3 large): a bigger move is
  // tinted more strongly, and a large one holds its colour longer.
  let strength = $state(0);
  // The price and the text last drawn. A new price that is drawn the same
  // (64,517.30 and 64,517.10 are both "64,517") changes nothing on screen, so
  // it does not tint either; a later move is measured from the price drawn.
  let lastPrice = null, lastText = null, flashTimer;
  // The digit each window showed last (see roll, below).
  const lastShown = new Map();
  $effect.pre(() => {
    const next = tick ? tick.price : null;
    // No price (a different coin is on its way): its digits will simply appear.
    if (next === null) { clearTimeout(flashTimer); flash = 0; strength = 0; trend = 0; lastPrice = null; lastText = null; lastShown.clear(); return; }
    const text = parts.pieces.map(piece => piece.number + piece.mark).join(' ');
    if (text === lastText) return;
    if (lastPrice !== null && next !== lastPrice) {
      trend = flash = next > lastPrice ? 1 : -1;
      strength = moveStrength(lastPrice, next);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = 0; }, strength === 3 ? 1400 : 700);
    }
    lastPrice = next; lastText = text;
  });
  $effect(() => () => clearTimeout(flashTimer));

  // A changed digit changes the way Apple's apps change a number: the old
  // digit drifts a little way off, blurring and fading, while the new one
  // drifts in from the other side and sharpens. The movement goes the way the
  // price did: up when it rose, down when it fell. So a digit learns two
  // things once, when it appears, and keeps them: which way the price went,
  // and which digit it replaces. If the direction followed the current trend
  // instead, every digit would change class when the price turned round, and
  // all would move at once. The old digit is a copy laid over the new one in
  // its slot, gone when its fade ends; nothing is clipped.
  function roll(node, slot) {
    const direction = untrack(() => trend), old = lastShown.get(slot);
    lastShown.set(slot, node.textContent);
    if (!direction || old === undefined) return;
    const way = direction > 0 ? 'up' : 'down';
    node.dataset.old = old;
    node.classList.add(way);
    // The board may be drawn in another window (the pop-out): make the copy there.
    const ghost = node.ownerDocument.createElement('span');
    ghost.className = `digit-old ${way}`;
    // Drawn by CSS from data-digit, so the price's text stays what is shown.
    ghost.dataset.digit = old;
    ghost.setAttribute('aria-hidden', 'true');
    const done = () => ghost.remove();
    ghost.addEventListener('animationend', done);
    ghost.addEventListener('animationcancel', done);
    node.parentElement?.appendChild(ghost);
    // With reduced motion there is no animation to end it.
    if (ghost.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  }
</script>

<p {id} bind:this={line} class="price {tone(flash)}" data-strength={flash ? strength : null}
  aria-live={live ? 'polite' : undefined} aria-atomic={live ? 'true' : undefined}><span id={textId} class="price-text" bind:this={text} style:transform="scale({scale})">{#each parts.pieces as piece, index}{index ? ' ' : ''}{#each [...piece.number] as char, place (place)}<span class="slot">{#key char}<span class="digit" use:roll={`${index}:${place}`}>{char}</span>{/key}</span>{/each}{#if piece.mark}<span class="mark">{piece.mark}</span>{/if}{/each}</span></p>
