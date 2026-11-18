<script module>
  let made = 0;
</script>
<script>
  // The chart behind the board: the closing prices over the chosen period, then
  // the live price at its right end, as a faint line over a fading fill.
  // Coloured by the move over the period: up or down, in the board's own
  // colours. It fills whatever box its parent gives it (the lower part of a
  // cell, or of the screen), and its line keeps one width however it is stretched.
  // floor: the share of the height kept free below the line's lowest point
  // (the fill fades on into it); inset: the share of the width kept free at
  // each end (the fill runs on, level, to the edges). So a box reaching past
  // the screen's edge, or floating with burn-in protection, never cuts the line.
  let { points = null, tick = null, period, label, floor = 0.1, inset = 0 } = $props();
  const W = 100, H = 30, PAD = 1;
  const fade = `spark-fade-${++made}`;
  const line = $derived.by(() => {
    if (!points || points.length < 2) return null;
    const all = tick ? [...points, [Math.max(Date.now(), points.at(-1)[0]), tick.price]] : points;
    const first = all[0][0], last = all.at(-1)[0], span = Math.max(1, last - first);
    let low = Infinity, high = -Infinity;
    for (const [, price] of all) { low = Math.min(low, price); high = Math.max(high, price); }
    const range = high - low || 1;
    const x = (time) => (inset + (time - first) / span * (1 - 2 * inset)) * W;
    const y = (price) => PAD + (1 - (price - low) / range) * (H * (1 - floor) - PAD);
    const coords = all.map(([time, price]) => `${x(time).toFixed(2)},${y(price).toFixed(2)}`);
    const path = 'M' + coords.join('L');
    const start = y(all[0][1]).toFixed(2), end = y(all.at(-1)[1]).toFixed(2);
    const move = all.at(-1)[1] - all[0][1];
    return { path, area: `M0,${start}L${coords.join('L')}L${W},${end}L${W},${H}L0,${H}Z`, tone: move > 0 ? 'up' : move < 0 ? 'down' : 'flat' };
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
    <span class="spark-label change-label" style:right="{inset * 100}%">{label}</span>
  </div>
{/if}
