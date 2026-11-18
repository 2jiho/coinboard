import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater } from '../../src/lib/updater.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const KEY = 'coinboard-auto-reload';
function memory() {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); } };
}
function fixture({ controlled = true, cacheVersion = '0.8.1', storage = memory(), settingsOpen = false, silentReplies = 0 } = {}) {
  const sw = {}, doc = {}, win = {}, state = { reloads: 0, updates: 0, open: settingsOpen, cacheVersion, visibility: 'visible', silentReplies, queries: 0 };
  const controller = { postMessage(message, ports) { state.queries++; if (state.silentReplies-- > 0) return; ports[0].postMessage({ type: 'APP_VERSION', cacheName: 'coinboard:/coinboard/:' + state.cacheVersion }); ports[0].close(); } };
  const serviceWorker = { controller: controlled ? controller : null,
    addEventListener: (name, cb) => { sw[name] = cb; },
    register: async () => ({ update: async () => { state.updates++; } }) };
  const document = { get visibilityState() { return state.visibility; }, addEventListener: (name, cb) => { doc[name] = cb; } };
  // label/button stand in for what the page shows from the updater's callbacks.
  const label = { textContent: '' }, button = { hidden: true }, intervals = [];
  const updater = createUpdater({ navigator: { serviceWorker }, location: { reload() { state.reloads++; } }, document, storage,
    clock: { setInterval: (cb, ms) => { intervals.push({ cb, ms }); } }, version: '0.8.0', workerUrl: './sw.js', queryTimeoutMs: 5,
    window: { addEventListener: (name, cb) => { win[name] = cb; } },
    onCacheVersion: cache => { state.cache = cache; label.textContent = '버전 0.8.0 · 캐시 ' + (cache.version || cache.state); }, onUpdateReady: () => { button.hidden = false; },
    isSettingsOpen: () => state.open });
  button.click = () => updater.reload();
  updater.start();
  return { state, label, button, storage, intervals,
    takeOver() { serviceWorker.controller = controller; sw.controllerchange(); },
    closeSettings() { state.open = false; updater.settingsClosed(); },
    visibility(value) { state.visibility = value; doc.visibilitychange(); }, online() { win.online(); } };
}
test('shows the page version and the controlling cache version', async () => {
  const f = fixture({ cacheVersion: '0.8.0' }); await settle();
  assert.equal(f.label.textContent, '버전 0.8.0 · 캐시 0.8.0');
});
test('first install (no previous controller) never reloads', async () => {
  const f = fixture({ controlled: false }); await settle(); f.takeOver(); await settle();
  assert.equal(f.state.reloads, 0); assert.equal(f.button.hidden, true);
});
test('new controller with settings closed reloads once and records the version', async () => {
  const f = fixture(); await settle(); f.takeOver(); await settle();
  assert.equal(f.state.reloads, 1); assert.equal(f.storage.getItem(KEY), '0.8.1');
});
test('settings open: shows the button and waits; reloads when the panel closes', async () => {
  const f = fixture({ settingsOpen: true }); await settle(); f.takeOver(); await settle();
  assert.equal(f.state.reloads, 0); assert.equal(f.button.hidden, false);
  f.closeSettings(); assert.equal(f.state.reloads, 1); assert.equal(f.storage.getItem(KEY), '0.8.1');
});
test('closing settings without a pending update does not reload', async () => {
  const f = fixture({ settingsOpen: true }); await settle(); f.closeSettings(); assert.equal(f.state.reloads, 0);
});
test('same version already recorded: no automatic reload, manual button works', async () => {
  const storage = memory(); storage.setItem(KEY, '0.8.1');
  const f = fixture({ storage }); await settle(); f.takeOver(); await settle();
  assert.equal(f.state.reloads, 0); assert.equal(f.button.hidden, false);
  f.button.click(); assert.equal(f.state.reloads, 1);
});
test('storage missing or throwing: no automatic reload, button shown', async () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  for (const storage of [null, throwing]) {
    const f = fixture({ storage }); await settle(); f.takeOver(); await settle();
    assert.equal(f.state.reloads, 0); assert.equal(f.button.hidden, false);
  }
});
test('checks for updates at start, every 30 seconds while visible and on becoming visible, not while hidden', async () => {
  const f = fixture(); await settle(); assert.equal(f.state.updates, 1);
  assert.equal(f.intervals.length, 1); assert.equal(f.intervals[0].ms, 30000);
  f.intervals[0].cb(); assert.equal(f.state.updates, 2);
  f.visibility('hidden'); f.intervals[0].cb(); assert.equal(f.state.updates, 2);
  f.visibility('visible'); assert.equal(f.state.updates, 3);
});
test('a new controller that serves the page\'s own version is not an update', async () => {
  // Seen right after upgrading from an old install: the worker is replaced once
  // more with identical code. There is nothing newer to load.
  const f = fixture({ cacheVersion: '0.8.0' }); await settle(); f.takeOver(); await settle();
  assert.equal(f.state.reloads, 0); assert.equal(f.button.hidden, true); assert.equal(f.storage.getItem(KEY), null);
});
test('a worker that is slow to say its version is asked again, so the update is not missed', async () => {
  const f = fixture(); await settle();
  f.state.silentReplies = 2; f.takeOver(); await settle(); await settle();
  assert.equal(f.state.reloads, 1); assert.equal(f.storage.getItem(KEY), '0.8.1');
});
test('a worker that never answers is asked three times, then left to the button', async () => {
  const f = fixture(); await settle(); const before = f.state.queries;
  f.state.silentReplies = 99; f.takeOver(); await settle(); await settle();
  assert.equal(f.state.queries - before, 3); assert.equal(f.state.reloads, 0);
  assert.equal(f.button.hidden, false); assert.deepEqual(f.state.cache, { state: 'unknown', version: null });
});
test('checks for updates when the network comes back', async () => {
  const f = fixture(); await settle(); assert.equal(f.state.updates, 1);
  f.online(); assert.equal(f.state.updates, 2);
});
test('the installed copy is reported as a state and a version, never as display text', async () => {
  const known = fixture({ cacheVersion: '0.8.0' }); await settle();
  assert.deepEqual(known.state.cache, { state: 'known', version: '0.8.0' });
  const waiting = fixture({ controlled: false }); await settle();
  assert.deepEqual(waiting.state.cache, { state: 'waiting', version: null });
});
