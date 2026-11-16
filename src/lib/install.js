// Whether to offer adding the app to the home screen, and how. Knows nothing
// of the DOM: the page passes in what it can read.
//
// - Opened from the home screen (or installed): nothing to offer.
// - iPhone and iPad: no browser lets a page install itself, so the steps are
//   shown (Share, then Add to Home Screen). iPadOS reports itself as a Mac;
//   a Mac with a touch screen is an iPad.
// - A browser that offered its own install prompt (Chrome, Edge, Android):
//   an install button that opens it.
// - Anything else: nothing, there being no good way to install there.
export function installOffer({ standalone, userAgent = "", maxTouchPoints = 0, canPrompt = false }) {
  if (standalone) return null;
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return "ios";
  if (canPrompt) return "prompt";
  return null;
}

// Whether the page is running as an installed app: display-mode standalone
// or fullscreen (from the manifest), or iOS's own flag for a home screen web app.
export function isStandalone({ matchMedia, navigator }) {
  const mode = (query) => { try { return !!matchMedia?.(query).matches; } catch { return false; } };
  return mode("(display-mode: standalone)") || mode("(display-mode: fullscreen)") || navigator?.standalone === true;
}
