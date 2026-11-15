import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scope = 'https://example.test/coinboard/';
const source = fs.readFileSync(new URL('../../src/sw.js', import.meta.url), 'utf8')
  .replace('"__APP_VERSION__"', '"1.2.3"').replace('"__SHELL_FILES__"', '["index.html","assets/app-abc.js"]');
const ICON = 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg';

// stores: cache name -> Map(url -> Response). fetch: what the network answers.
function fixture(stores, fetch) {
  const handlers = {}, fetched = [];
  const caches = {
    open: async name => {
      if (!stores[name]) stores[name] = new Map();
      const store = stores[name];
      return { match: async key => store.get(key)?.clone(), put: async (key, response) => { store.set(key, response); } };
    },
  };
  vm.runInNewContext(source, {
    self: { registration: { scope }, addEventListener: (name, cb) => { handlers[name] = cb; } },
    caches, URL, Request, Response, console: { warn() {} },
    fetch: async request => { fetched.push(request.url); return fetch(request); },
  });
  function request(url, method = 'GET') {
    let result;
    handlers.fetch({ request: new Request(url, { method }), respondWith(promise) { result = promise; } });
    return result;
  }
  return { request, fetched, handlers };
}
const shell = () => ({ 'coinboard:/coinboard/:1.2.3': new Map([
  [scope + 'index.html', new Response('stored page')], [scope + 'assets/app-abc.js', new Response('stored script')]]) });

test('the page and its files are served from the installed copy without touching the network', async () => {
  const f = fixture(shell(), async () => { throw new Error('offline'); });
  for (const url of [scope, scope + 'index.html', scope + '?source=home']) assert.equal(await (await f.request(url)).text(), 'stored page');
  assert.equal(await (await f.request(scope + 'assets/app-abc.js')).text(), 'stored script');
  assert.deepEqual(f.fetched, []);
});
test('a missing copy falls back to the network', async () => {
  const f = fixture({}, async () => new Response('from network'));
  assert.equal(await (await f.request(scope + 'index.html')).text(), 'from network');
});
test('files outside the shell, other apps and non-GET requests are left alone', () => {
  const f = fixture(shell(), async () => new Response('x'));
  assert.equal(f.request(scope + 'not-in-shell.txt'), undefined);
  assert.equal(f.request('https://example.test/another-app/index.html'), undefined);
  assert.equal(f.request('https://api.upbit.com/v1/ticker'), undefined);
  assert.equal(f.request('https://cdn.jsdelivr.net/npm/something-else@1/x.js'), undefined);
  assert.equal(f.request(scope + 'index.html', 'POST'), undefined);
});
test('a coin icon is downloaded once and then kept for offline use', async () => {
  const stores = shell(); let online = true;
  const f = fixture(stores, async () => { if (!online) throw new Error('offline'); return new Response('<svg/>'); });
  assert.equal(await (await f.request(ICON)).text(), '<svg/>');
  online = false;
  assert.equal(await (await f.request(ICON)).text(), '<svg/>');
  assert.deepEqual(f.fetched, [ICON]);
  assert.equal(stores['coinboard-icons:v1'].has(ICON), true);
});
test('a coin without an icon is not remembered as broken', async () => {
  const stores = shell();
  const f = fixture(stores, async () => new Response('not found', { status: 404 }));
  assert.equal((await f.request(ICON)).status, 404);
  assert.equal(stores['coinboard-icons:v1'].has(ICON), false);
});
test('the worker reports the cache version it serves', () => {
  const f = fixture({}, async () => new Response('x')); let answer;
  f.handlers.message({ data: { type: 'GET_APP_VERSION' }, ports: [{ postMessage(value) { answer = value; } }] });
  assert.deepEqual({ ...answer }, { type: 'APP_VERSION', cacheName: 'coinboard:/coinboard/:1.2.3' });
});
