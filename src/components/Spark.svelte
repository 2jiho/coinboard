<script module>
  let made = 0;
</script>
<script>
  import { untrack } from 'svelte';
  import { direction, priceParts } from '../lib/format.js';
  import { moveStrength } from '../lib/move.js';
  // The chart behind the board: the closing prices over the chosen period, then
  // the live price at its right end, as a faint line over a fading fill, with
  // a small point on the live price.
  // Coloured up or down as the change shown above it, in the board's own
  // colours. It fills whatever box its parent gives it (the lower part of a
  // cell, or of the screen), and its line keeps one width however it is stretched.
  // The share of the height kept free below the line's lowest point; the fill fades on into it.
  const FLOOR = 0.06;
  // The live price is drawn this far in from the right edge, so its point and
  // the ring it sends out are not cut by the screen; the line runs on, level, to the edge.
  const END = 0.05;
  let { points = null, tick = null, period, label } = $props();
  const W = 100, H = 30, PAD = 1;
  const fade = `spark-fade-${++made}`;
  const line = $derived.by(() => {
    if (!points || points.length < 2) return null;
    const all = tick ? [...points, [Math.max(Date.now(), points.at(-1)[0]), tick.price]] : points;
    const first = all[0][0], last = all.at(-1)[0], span = Math.max(1, last - first);
    let low = Infinity, high = -Infinity;
    for (const [, price] of all) { low = Math.min(low, price); high = Math.max(high, price); }
    const range = high - low || 1;
    const x = (time) => (time - first) / span * (1 - END) * W;
    const y = (price) => PAD + (1 - (price - low) / range) * (H * (1 - FLOOR) - PAD);
    const coords = all.map(([time, price]) => `${x(time).toFixed(2)},${y(price).toFixed(2)}`);
    // Coloured as the change beside the price is, so the two never disagree;
    // by the period's own move only while there is no live price yet.
    const move = tick && Number.isFinite(tick.change) ? direction(tick.change) : all.at(-1)[1] - all[0][1];
    const endY = y(all.at(-1)[1]);
    const path = `M${coords.join('L')}L${W},${endY.toFixed(2)}`;
    return { path, area: `${path}L${W},${H}L0,${H}Z`, tone: move > 0 ? 'up' : move < 0 ? 'down' : 'flat',
      end: { x: (1 - END) * 100, y: endY / H * 100 } };
  });

  // When the price shown moves, the chart's last point sends out a ring, in
  // the colour of that move; the bigger the move (as for the price's tint:
  // slight, ordinary, large), the wider and longer the ring. A new price that
  // is drawn the same as the last (64,517.30 and 64,517.10) sends none.
  let pulse = $state(null), pulses = 0, lastPrice = null, lastText = null;
  $effect(() => {
    const price = tick?.price;
    if (!Number.isFinite(price)) { lastPrice = lastText = null; return; }
    const text = priceParts(tick.selection.quote, price).pieces.map(piece => piece.number + piece.mark).join(' ');
    if (text === lastText) return;
    const strength = moveStrength(lastPrice, price);
    if (strength && untrack(() => line)) pulse = { id: ++pulses, way: price > lastPrice ? 'up' : 'down', strength };
    lastPrice = price; lastText = text;
  });
</script>

{#if line}
  <div class="spark {line.tone}" data-period={period} aria-hidden="true">
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="currentColor" stop-opacity="0.16" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="spark-area" d={line.area} fill="url(#{fade})" />
      <path class="spark-line" d={line.path} />
    </svg>
    <span class="spark-point" style:left="{line.end.x}%" style:top="{line.end.y}%"></span>
    {#if pulse}
      {#key pulse.id}
        <span class="spark-ring {pulse.way}" data-strength={pulse.strength} style:left="{line.end.x}%" style:top="{line.end.y}%"></span>
      {/key}
    {/if}
    <span class="spark-label change-label">{label}</span>
  </div>
{/if}
