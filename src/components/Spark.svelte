<script module>
  let made = 0;
</script>
<script>
  import { direction } from '../lib/format.js';
  // The chart behind the board: the closing prices over the chosen period, then
  // the live price at its right end, as a faint line over a fading fill.
  // Coloured up or down as the change shown above it, in the board's own
  // colours. It fills whatever box its parent gives it (the lower part of a
  // cell, or of the screen), and its line keeps one width however it is stretched.
  // The share of the height kept free below the line's lowest point; the fill fades on into it.
  const FLOOR = 0.06;
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
    const x = (time) => (time - first) / span * W;
    const y = (price) => PAD + (1 - (price - low) / range) * (H * (1 - FLOOR) - PAD);
    const coords = all.map(([time, price]) => `${x(time).toFixed(2)},${y(price).toFixed(2)}`);
    // Coloured as the change beside the price is, so the two never disagree;
    // by the period's own move only while there is no live price yet.
    const move = tick && Number.isFinite(tick.change) ? direction(tick.change) : all.at(-1)[1] - all[0][1];
    const path = 'M' + coords.join('L');
    return { path, area: `${path}L${W},${H}L0,${H}Z`, tone: move > 0 ? 'up' : move < 0 ? 'down' : 'flat' };
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
    <span class="spark-label change-label">{label}</span>
  </div>
{/if}
