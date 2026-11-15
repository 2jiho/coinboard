import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater } from '../../src/lib/updater.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const KEY = 'coinboard-auto-reload';
function memory() {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => { data.set(key, String(value)); } };
}
function fixture({ controlled = true, cacheVersion = '0.8.1', storage = memory(), settingsOpen = false } = {}) {
  const sw = {}, doc = {}, state = { reloads: 0, updates: 0, open: settingsOpen, cacheVersion, visibility: 'visible' };
  const controller = { postMessage(message, ports) { ports[0].postMessage({ type: 'APP_VERSION', cacheName: 'coinboard:/coinboard/:' + state.cacheVersion }); ports[0].close(); } };
  const serviceWorker = { controller: controlled ? controller : null,
    addEventListener: (name, cb) => { sw[name] = cb; },
    register: async () => ({ update: async () => { state.updates++; } }) };
  const document = { get visibilityState() { return state.visibility; }, addEventListener: (name, cb) => { doc[name] = cb; } };
  // label/button stand in for what the page shows from the updater's callbacks.
  const label = { textContent: '' }, button = { hidden: true }, intervals = [];
  const updater = createUpdater({ navigator: { serviceWorker }, location: { reload() { state.reloads++; } }, document, storage,
    clock: { setInterval: (cb, ms) => { intervals.push({ cb, ms }); } }, version: '0.8.0', workerUrl: './sw.js',
    onCacheVersion: text => { label.textContent = '버전 0.8.0 · 캐시 ' + text; }, onUpdateReady: () => { button.hidden = false; },
    isSettingsOpen: () => state.open });
  button.click = () => updater.reload();
  updater.start();
  return { state, label, button, storage, intervals,
    takeOver() { serviceWorker.controller = controller; sw.controllerchange(); },
    closeSettings() { state.open = false; updater.settingsClosed(); },
    visibility(value) { state.visibility = value; doc.visibilitychange(); } };
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
test('checks for updates at start, hourly while visible and on becoming visible, not while hidden', async () => {
  const f = fixture(); await settle(); assert.equal(f.state.updates, 1);
  assert.equal(f.intervals.length, 1); assert.equal(f.intervals[0].ms, 3600000);
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
