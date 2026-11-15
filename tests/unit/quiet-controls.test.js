import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuietControls } from '../../src/lib/quiet-controls.js';

const CONTROLS = '#settings-toggle, #admin-panel', PANEL = '#admin-panel';
function fixture() {
  const handlers = {}, removed = [], timers = new Map();
  let time = 0, id = 0;
  const state = { visible: false, panelOpen: false, outsideTaps: 0, idleCloses: 0, blurs: 0 };
  const document = {
    visibilityState: 'visible', activeElement: null,
    addEventListener: (name, cb) => { handlers[name] = cb; }, removeEventListener: name => { removed.push(name); },
  };
  // Where a tap or focus lands: on the board, on the settings button, or inside the panel.
  const place = matches => ({ closest: selector => matches.includes(selector) ? {} : null, blur() { state.blurs++; document.activeElement = null; } });
  const board = place([]), button = place([CONTROLS]), inPanel = place([CONTROLS, PANEL]);
  const controls = createQuietControls({
    document, controls: CONTROLS, panel: PANEL,
    timers: { setTimeout: (cb, ms) => { timers.set(++id, { cb, at: time + ms }); return id; }, clearTimeout: key => { timers.delete(key); } },
    defer: cb => cb(), now: () => time,
    isPanelOpen: () => state.panelOpen,
    onVisible: value => { state.visible = value; },
    onOutsideTap: () => { state.outsideTaps++; state.panelOpen = false; },
    onPanelIdle: () => { state.idleCloses++; state.panelOpen = false; },
  });
  function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].cb();
    }
    time = end;
  }
  // A tap: pointerdown, then the click the browser would send. Returns what was let through.
  function tap(target) {
    const down = { target, prevented: false, preventDefault() { this.prevented = true; } };
    handlers.pointerdown(down);
    const click = { target, detail: 1, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    handlers.click(click);
    return { downPrevented: down.prevented, clickSwallowed: click.prevented && click.stopped };
  }
  const key = name => handlers.keydown({ key: name });
  return { controls, state, document, handlers, removed, board, button, inPanel, advance, tap, key };
}

test('the tap that reveals the button does not press it; the next tap does', () => {
  const f = fixture();
  assert.deepEqual(f.tap(f.button), { downPrevented: true, clickSwallowed: true });
  assert.equal(f.state.visible, true);
  assert.deepEqual(f.tap(f.button), { downPrevented: false, clickSwallowed: false });
});
test('a keyboard click (no pointer) is never swallowed', () => {
  const f = fixture();
  f.handlers.pointerdown({ target: f.board, preventDefault() {} });
  const click = { target: f.button, detail: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  f.handlers.click(click);
  assert.equal(click.prevented, undefined);
});
test('the button hides after five idle seconds; a tap starts the wait again', () => {
  const f = fixture(); f.tap(f.board);
  f.advance(4999); assert.equal(f.state.visible, true);
  f.tap(f.board); f.advance(4999); assert.equal(f.state.visible, true);
  f.advance(1); assert.equal(f.state.visible, false);
});
test('it stays while it has focus, and a tap elsewhere lets go of it', () => {
  const f = fixture(); f.tap(f.board);
  f.document.activeElement = f.button; f.handlers.focusin({ target: f.button });
  f.advance(60000); assert.equal(f.state.visible, true);
  f.tap(f.board); assert.equal(f.state.blurs, 1);
  f.advance(5000); assert.equal(f.state.visible, false);
});
test('it stays while the panel is open; a tap outside the panel asks to close it, a tap inside does not', () => {
  const f = fixture(); f.tap(f.board); f.state.panelOpen = true; f.controls.reveal();
  f.advance(60000); assert.equal(f.state.visible, true);
  f.tap(f.inPanel); assert.equal(f.state.outsideTaps, 0);
  f.tap(f.board); assert.equal(f.state.outsideTaps, 1); assert.equal(f.state.blurs, 0);
  f.controls.settle(); f.advance(5000); assert.equal(f.state.visible, false);
});
test('Tab, Enter and Space reveal the button; other keys do not', () => {
  for (const name of ['Tab', 'Enter', ' ']) { const f = fixture(); f.key(name); assert.equal(f.state.visible, true, name); }
  const f = fixture(); f.key('a'); f.key('Escape'); assert.equal(f.state.visible, false);
});
test('a hidden page stops the countdown; coming back starts it again', () => {
  const f = fixture(); f.tap(f.board);
  f.document.visibilityState = 'hidden'; f.handlers.visibilitychange();
  f.advance(60000); assert.equal(f.state.visible, true);
  f.document.visibilityState = 'visible'; f.handlers.visibilitychange();
  f.advance(5000); assert.equal(f.state.visible, false);
});
test('an open panel nobody touches is closed after two minutes; any touch or key starts the wait again', () => {
  const f = fixture(); f.tap(f.board); f.state.panelOpen = true; f.controls.reveal(); f.controls.touch();
  f.advance(119999); assert.equal(f.state.idleCloses, 0);
  f.tap(f.inPanel); f.advance(119999); assert.equal(f.state.idleCloses, 0);
  f.key('a'); f.advance(119999); assert.equal(f.state.idleCloses, 0);
  f.handlers.input({}); f.advance(119999); assert.equal(f.state.idleCloses, 0);
  f.advance(1); assert.equal(f.state.idleCloses, 1);
});
test('with the panel closed nothing is waiting to close it', () => {
  const f = fixture(); f.tap(f.board); f.controls.touch(); f.advance(600000);
  assert.equal(f.state.idleCloses, 0);
});
test('dispose removes every listener it added', () => {
  const f = fixture(); f.controls.dispose();
  assert.deepEqual(f.removed.sort(), Object.keys(f.handlers).sort());
});
test('a press on the button as it fades out is a press, not a tap to reveal it', () => {
  const f = fixture(); f.tap(f.board);
  f.advance(5000); assert.equal(f.state.visible, false);
  f.advance(300);
  assert.deepEqual(f.tap(f.button), { downPrevented: false, clickSwallowed: false });
  assert.equal(f.state.visible, true);
});
test('once the fade is over, the next tap only reveals it again', () => {
  const f = fixture(); f.tap(f.board);
  f.advance(5000 + 600);
  assert.deepEqual(f.tap(f.button), { downPrevented: true, clickSwallowed: true });
});
test('a tap elsewhere while the button fades only reveals it', () => {
  const f = fixture(); f.tap(f.board);
  f.advance(5300);
  assert.deepEqual(f.tap(f.board), { downPrevented: true, clickSwallowed: true });
});
