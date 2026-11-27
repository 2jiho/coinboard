// The board's controls (the settings button and the buttons beside it) stay out
// of sight. This decides when they are shown, keeps the tap that reveals them
// from pressing one, and closes a settings panel that has been left open.
export function createQuietControls(options) {
  const { document, isPanelOpen, onVisible, onOutsideTap, onPanelIdle } = options;
  // CSS selectors: everything that counts as a control, and the panel alone.
  const controls = options.controls, panel = options.panel;
  const timers = options.timers || { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const defer = options.defer || queueMicrotask;
  const now = options.now || Date.now;
  const HIDE_AFTER_MS = 5000;
  // The button fades out over this long (app.css) and can still be pressed
  // meanwhile; a press on it then is meant, not a tap to reveal it.
  const FADE_MS = 600;
  // A panel left open would hold back automatic updates and leave the board
  // half covered.
  const PANEL_IDLE_MS = 120000;
  let visible = false, hideTimer = null, idleTimer = null, revealOnlyClick = false, hiddenAt = -Infinity;

  // In use: the panel is open, or a control has the keyboard's focus. The focus
  // a press leaves on a button (Chrome does) holds nothing, or the buttons would
  // stay lit on an untouched board after every press.
  function inUse() {
    const active = document.activeElement;
    return isPanelOpen() || !!(active && active.closest(controls) && active.matches(":focus-visible"));
  }
  function setVisible(value) {
    if (value === visible) return;
    visible = value;
    if (!value) hiddenAt = now();
    onVisible(value);
  }
  // Start (or restart) the countdown to hiding the button.
  function settle() {
    timers.clearTimeout(hideTimer); hideTimer = null;
    if (document.visibilityState !== "visible" || inUse()) return;
    hideTimer = timers.setTimeout(() => {
      hideTimer = null;
      if (!inUse()) setVisible(false);
    }, HIDE_AFTER_MS);
  }
  function reveal() { setVisible(true); settle(); }
  // Any sign of life restarts the wait before an open panel closes itself.
  function touch() {
    timers.clearTimeout(idleTimer); idleTimer = null;
    if (isPanelOpen()) idleTimer = timers.setTimeout(() => { idleTimer = null; onPanelIdle(); }, PANEL_IDLE_MS);
  }

  const listeners = [
    ["pointerdown", (event) => {
      touch();
      const fading = now() - hiddenAt < FADE_MS && !!event.target.closest(controls);
      revealOnlyClick = !visible && !fading;
      // Revealing beneath a finger must not activate the newly visible button
      // on pointerup/click or leave it focused after that first tap.
      if (revealOnlyClick) event.preventDefault();
      if (isPanelOpen() && !event.target.closest(panel)) onOutsideTap();
      else if (!event.target.closest(controls) && inUse() && !isPanelOpen()) document.activeElement.blur();
      reveal();
    }],
    // detail > 0 means a pointer made this click; keyboard clicks pass.
    ["click", (event) => {
      if (revealOnlyClick && event.detail > 0) { revealOnlyClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true],
    ["pointercancel", () => { revealOnlyClick = false; }],
    ["keydown", (event) => { touch(); if (event.key === "Tab" || event.key === "Enter" || event.key === " ") reveal(); }, true],
    ["input", touch, true],
    ["focusin", (event) => { if (event.target.closest(controls)) reveal(); }],
    // Focus has not arrived at its new home yet when focusout fires.
    ["focusout", () => { defer(settle); }],
    ["visibilitychange", () => {
      if (document.visibilityState === "visible") settle();
      else { timers.clearTimeout(hideTimer); hideTimer = null; }
    }],
  ];
  for (const [name, handler, capture] of listeners) document.addEventListener(name, handler, capture);

  return {
    reveal, settle, touch,
    dispose() {
      for (const [name, handler, capture] of listeners) document.removeEventListener(name, handler, capture);
      timers.clearTimeout(hideTimer); timers.clearTimeout(idleTimer);
    },
  };
}
