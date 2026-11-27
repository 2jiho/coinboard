import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock } from '../../src/lib/wake-lock.js';
import { overwriteGetLocale } from '../../src/paraglide/runtime.js';
// These checks read the Korean text; English is checked in i18n.test.js.
overwriteGetLocale(() => 'ko');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(request, supported = true, visible = true, enabled = true) {
  const events = {}, windowEvents = {}, kinds = [], clock = { time: 1800000000000 };
  // status/retry stand in for what the page shows from onChange.
  const status = {}, retry = { hidden: true };
  const document = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (name, cb) => { events[name] = cb; }, removeEventListener() {},
  };
  const wakeLock = createWakeLock({
    document, navigator: supported ? { wakeLock: { request } } : {},
    window: { isSecureContext: true, addEventListener: (name, cb) => { windowEvents[name] = cb; }, removeEventListener() {} },
    now: () => clock.time, enabled,
    onChange: state => { kinds.push(state.kind); status.textContent = state.message; retry.hidden = !state.canRetry; },
  });
  return { status, retry, kinds, clock, tap: () => events.pointerdown(), click: () => wakeLock.retry(), page: name => windowEvents[name](), setEnabled: value => wakeLock.setEnabled(value),
    visibility(state) { document.visibilityState = state; events.visibilitychange(); } };
}
function lock() {
  let handler;
  return { released: false, releases: 0,
    addEventListener(name, cb) { handler = cb; },
    async release() { this.releases++; this.released = true; if (handler) handler(); },
  };
}
test('system release while visible retries once automatically', async () => {
  let calls = 0; const locks = [];
  const f = fixture(async () => { calls++; const l = lock(); locks.push(l); return l; });
  await flush(); assert.match(f.status.textContent, /활성/); assert.equal(f.kinds.at(-1), 'active');
  f.clock.time += 60000; await locks[0].release(); await flush();
  assert.equal(calls, 2); assert.match(f.status.textContent, /활성/); assert.equal(f.kinds.at(-1), 'active');
  assert.equal(f.retry.hidden, true);
});
test('a lock released again right after the automatic retry does not loop', async () => {
  let calls = 0; const locks = [];
  const f = fixture(async () => { calls++; const l = lock(); locks.push(l); return l; });
  await flush(); f.clock.time += 60000; await locks[0].release(); await flush(); assert.equal(calls, 2);
  f.clock.time += 1000; await locks[1].release(); await flush(); await flush();
  assert.equal(calls, 2); assert.equal(f.kinds.at(-1), 'released'); assert.equal(f.retry.hidden, false);
  await f.click(); await flush(); assert.equal(calls, 3); assert.equal(f.kinds.at(-1), 'active');
  await f.click(); assert.equal(calls, 3);
});
test('a lock that held for a while is retried again on its next system release', async () => {
  let calls = 0; const locks = [];
  const f = fixture(async () => { calls++; const l = lock(); locks.push(l); return l; });
  await flush(); f.clock.time += 60000; await locks[0].release(); await flush();
  f.clock.time += 3600000; await locks[1].release(); await flush();
  assert.equal(calls, 3); assert.equal(f.kinds.at(-1), 'active');
});
test('a failed automatic retry reports failure and the next tap requests again', async () => {
  let calls = 0, deny = false; const first = lock();
  const f = fixture(async () => { calls++; if (deny) throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' }); return calls === 1 ? first : lock(); });
  await flush(); deny = true; f.clock.time += 60000; await first.release(); await flush(); await flush();
  assert.equal(calls, 2); assert.equal(f.kinds.at(-1), 'failed'); assert.equal(f.retry.hidden, false);
  deny = false; f.tap(); await flush(); assert.equal(calls, 3); assert.equal(f.kinds.at(-1), 'active');
  f.tap(); await flush(); assert.equal(calls, 3);
});
test('taps while hidden or unsupported never request', async () => {
  let calls = 0;
  const hidden = fixture(async () => { calls++; return lock(); }, true, false); hidden.tap(); await flush(); assert.equal(calls, 0);
  const unsupported = fixture(null, false); await flush(); unsupported.tap(); await flush();
  assert.equal(unsupported.kinds.at(-1), 'unsupported');
});
test('initial denial and synchronous failure permit explicit retry only', async () => {
  for (const synchronous of [false, true]) {
    let calls = 0;
    const f = fixture(() => {
      calls++; const error = Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
      if (synchronous) throw error;
      return Promise.reject(error);
    });
    await flush(); assert.match(f.status.textContent, /NotAllowedError/);
    await flush(); assert.equal(calls, 1);
    await f.click(); assert.equal(calls, 2);
  }
});
test('pending acquisition deduplicates clicks and disposes stale hide/show lock', async () => {
  let resolve, calls = 0; const fresh = lock(), stale = lock();
  const f = fixture(() => { calls++; return calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(fresh); });
  await flush(); f.click(); f.click(); assert.equal(calls, 1);
  f.visibility('hidden'); f.visibility('visible');
  resolve(stale); await flush();
  assert.equal(stale.releases, 1); assert.equal(calls, 2); assert.match(f.status.textContent, /활성/);
  f.visibility('hidden'); await flush(); assert.equal(fresh.releases, 1);
});
test('hidden launch, pageshow restoration and duplicate lifecycle events', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return lock(); }, true, false);
  await flush(); assert.equal(calls, 0);
  f.visibility('visible'); f.page('pageshow'); await flush(); assert.equal(calls, 1);
  f.page('pagehide'); f.visibility('hidden'); f.visibility('visible'); f.page('pageshow');
  await flush(); assert.equal(calls, 2);
});
test('unsupported API and already released sentinel show truthful status', async () => {
  const unsupported = fixture(null, false); await flush();
  assert.match(unsupported.status.textContent, /미지원/); assert.equal(unsupported.retry.hidden, true);
  const released = lock(); released.released = true;
  const f = fixture(async () => released); await flush();
  assert.match(f.status.textContent, /해제됨/); assert.equal(f.retry.hidden, false);
});
test('release rejection is handled during suspension', async () => {
  const l = lock(); l.release = () => Promise.reject(new Error('release denied'));
  const f = fixture(async () => l); await flush(); f.visibility('hidden'); await flush();
  assert.match(f.status.textContent, /대기/);
});
test('switched off from the start, the screen is left to the device: nothing is asked for', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return lock(); }, true, true, false);
  await flush(); f.tap(); f.visibility('hidden'); f.visibility('visible'); await f.click(); await flush();
  assert.equal(calls, 0); assert.equal(f.kinds.at(-1), 'off'); assert.equal(f.retry.hidden, true);
  assert.match(f.status.textContent, /꺼짐/);
});
test('switched off, the lock is let go and not taken again until switched on', async () => {
  let calls = 0; const locks = [];
  const f = fixture(async () => { calls++; const l = lock(); locks.push(l); return l; });
  await flush(); assert.equal(f.kinds.at(-1), 'active');
  f.setEnabled(false); await flush();
  assert.equal(locks[0].releases, 1); assert.equal(f.kinds.at(-1), 'off');
  f.visibility('hidden'); assert.equal(f.kinds.at(-1), 'off', 'hidden while off is still off');
  f.visibility('visible'); f.tap(); await f.click(); await flush();
  assert.equal(calls, 1, 'nothing asked for while off'); assert.equal(f.kinds.at(-1), 'off');
  f.setEnabled(true); await flush();
  assert.equal(calls, 2); assert.equal(f.kinds.at(-1), 'active');
  f.setEnabled(true); await flush();
  assert.equal(calls, 2, 'switching on what is on asks for nothing');
});
test('switched off while a request is on its way, the lock it brings is let go', async () => {
  let resolve; const l = lock();
  const f = fixture(() => new Promise(r => { resolve = r; }));
  await flush(); f.setEnabled(false); resolve(l); await flush(); await flush();
  assert.equal(l.releases, 1); assert.equal(f.kinds.at(-1), 'off');
});
