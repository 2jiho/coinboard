// Notices a sudden move: the price half a percent away from where it was at
// some point in the last minute. Used to light the edge of the screen for a
// moment, so it stays quiet for a minute after each one.
export function createSurgeDetector(options = {}) {
  const windowMs = options.windowMs || 60000;
  const threshold = options.threshold || 0.5;
  const cooldownMs = options.cooldownMs || 60000;
  // One sample per second is plenty; more would only hoard prices.
  const SAMPLE_EVERY_MS = 1000;
  let samples = [], quietUntil = -Infinity;

  return {
    // Give it each price as it arrives. Returns 1 or -1 on a surge, else 0.
    push(price, now) {
      if (!Number.isFinite(price) || price <= 0) return 0;
      // While quiet, nothing is collected: when the quiet ends, measuring starts
      // afresh, so what happened meanwhile cannot set it off again at once.
      if (now < quietUntil) { samples = []; return 0; }
      while (samples.length && now - samples[0].at > windowMs) samples.shift();
      const last = samples[samples.length - 1];
      if (!last || now - last.at >= SAMPLE_EVERY_MS) samples.push({ price, at: now });
      // The furthest the price has come from anywhere in the window.
      let move = 0;
      for (const sample of samples) {
        const percent = (price - sample.price) / sample.price * 100;
        if (Math.abs(percent) > Math.abs(move)) move = percent;
      }
      if (Math.abs(move) < threshold) return 0;
      quietUntil = now + cooldownMs;
      samples = [];
      return move > 0 ? 1 : -1;
    },
    // A different coin: nothing so far counts.
    reset() { samples = []; quietUntil = -Infinity; },
    size() { return samples.length; },
  };
}
