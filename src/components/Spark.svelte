<script>
  // A small line chart: the closing prices over the chosen period, then the
  // live price at its right end. Coloured by the move over the period: up or
  // down, in the board's own colours. Drawn as an SVG line that keeps its width.
  let { points = null, tick = null, period, label } = $props();
  const W = 100, H = 30, PAD = 2;
  const line = $derived.by(() => {
    if (!points || points.length < 2) return null;
    const all = tick ? [...points, [Math.max(Date.now(), points.at(-1)[0]), tick.price]] : points;
    const first = all[0][0], last = all.at(-1)[0], span = Math.max(1, last - first);
    let low = Infinity, high = -Infinity;
    for (const [, price] of all) { low = Math.min(low, price); high = Math.max(high, price); }
    const range = high - low || 1;
    const path = all.map(([time, price], index) => `${index ? 'L' : 'M'}${((time - first) / span * W).toFixed(2)},${(PAD + (1 - (price - low) / range) * (H - 2 * PAD)).toFixed(2)}`).join('');
    const move = all.at(-1)[1] - all[0][1];
    return { path, tone: move > 0 ? 'up' : move < 0 ? 'down' : 'flat' };
  });
</script>

{#if line}
  <!-- The chart in a faint frame; its period after it, set like the change's own 24H. -->
  <span class="spark {line.tone}" data-period={period}>
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true"><path d={line.path} /></svg>
  </span>
  <span class="spark-label change-label">{label}</span>
{/if}
