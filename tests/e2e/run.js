// Browser checks against the built app: npm run test:e2e
// Optional real exchange smoke test: LIVE_NETWORK=1 npm run test:e2e
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const evidence = path.join(root, 'evidence');
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const NEXT_VERSION = VERSION.replace(/\d+$/, n => Number(n) + 1);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const flags = { nextWorker: false };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/coinboard/')) { res.writeHead(404); res.end(); return; }
  const name = pathname.slice('/coinboard/'.length) || 'index.html';
  const file = path.join(dist, name);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let content = fs.readFileSync(file);
  // A later release: the same files with a newer version baked into the worker.
  if (flags.nextWorker && name === 'sw.js') content = content.toString().replace(`APP_VERSION = "${VERSION}"`, `APP_VERSION = "${NEXT_VERSION}"`);
  res.setHeader('Content-Type', TYPES[path.extname(name)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(content);
});

// Scripted exchanges and wake lock: no real network, no machine-dependent grants.
async function scripted(context) {
  await context.route('https://**/*', route => route.abort());
  await context.addInitScript(() => {
    window.sockets = []; window.sent = []; window.suppressTicks = false;
    window.WebSocket = class {
      static OPEN = 1;
      constructor(url) {
        this.url = url; this.readyState = 0;
        this.market = url.includes('upbit') ? 'KRW-BTC' : url.split('/ws/')[1].split('@')[0].toUpperCase();
        window.sockets.push(this);
        setTimeout(() => {
          if (this.readyState === 3) return;
          this.readyState = 1; this.onopen?.();
          if (!url.includes('upbit')) this.emit();
          this.timer = setInterval(() => this.emit(), 1000);
        }, 0);
      }
      emit(values = {}) {
        if (this.readyState !== 1 || window.suppressTicks) return;
        const upbit = this.url.includes('upbit');
        const data = upbit ? { type: 'ticker', code: this.market, trade_price: 98000000, signed_change_rate: -0.025, timestamp: Date.now(), ...values }
          : { e: '24hrTicker', s: this.market, c: '70000.10', P: '2.5', E: Date.now(), ...values };
        this.onmessage?.({ data: upbit ? new TextEncoder().encode(JSON.stringify(data)).buffer : JSON.stringify(data) });
      }
      send(text) {
        window.sent.push(text);
        if (text === 'PING') { this.onmessage?.({ data: '{"status":"UP"}' }); return; }
        this.market = JSON.parse(text)[1].codes[0]; this.emit();
      }
      close() { this.readyState = 3; clearInterval(this.timer); this.onclose?.({ code: 1000, reason: '' }); }
    };
    window.wakeRequests = 0;
    const wakeLock = { request: async () => {
      window.wakeRequests++;
      const sentinel = new EventTarget(); sentinel.released = false;
      sentinel.release = async () => { if (sentinel.released) return; sentinel.released = true; sentinel.dispatchEvent(new Event('release')); };
      window.testSentinel = sentinel; return sentinel;
    } };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, get: () => wakeLock });
  });
}
const live = page => page.waitForFunction(() => {
  const board = document.getElementById('container');
  return board && !board.classList.contains('price-unavailable') && document.getElementById('price-main').textContent !== '—';
});
// waitForFunction treats an async predicate's Promise as truthy at once, so
// async conditions are polled from here instead.
async function until(page, predicate, arg) {
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Condition not met within 30s');
}
// The board floats slowly, so it is tapped by position, not by element.
const tapBoard = page => page.touchscreen.tap(Math.round(page.viewportSize().width / 2), Math.round(page.viewportSize().height / 2));
const text = (page, selector) => page.locator(selector).textContent();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('coinboard-settings')));
async function open(page) {
  if (await page.locator('#admin-panel').isVisible()) return;
  if (!await page.locator('#settings-toggle').isVisible()) await page.keyboard.press('Tab');
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
}
function watch(page) {
  const problems = [];
  page.on('pageerror', error => problems.push('pageerror: ' + error.message));
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) problems.push('csp: ' + message.text()); });
  return problems;
}

async function board(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await scripted(context);
  const page = await context.newPage(); const problems = watch(page); const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.clock.install(); await page.goto(base); await live(page);

  // The board at rest: price only, nothing to press.
  assert.equal(await text(page, '#price-main'), '98,000,000 KRW');
  assert.equal(await text(page, '#change'), '▼ 2.50%');
  assert.equal(await text(page, '#change-label'), '1D');
  assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-BTC');
  assert.equal(await page.evaluate(() => sockets.length), 1);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.equal(await page.locator('#status-overlay').count(), 0);
  // The exchange and market are for screen readers only; they take no room on the board.
  const sourceBox = await page.locator('#price-source').boundingBox();
  assert.ok(sourceBox.width <= 1 && sourceBox.height <= 1, 'source line is not drawn');
  // Nothing on the board itself is in Korean.
  assert.doesNotMatch(await text(page, '#container'), /[가-힣]/);
  await page.screenshot({ path: path.join(evidence, 'board.png') });

  // Keyboard: Tab reveals and focuses the button, Enter opens, focus is kept inside.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-debug');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  assert.deepEqual(await page.locator('#admin-panel h3').allTextContents(), ['시세', '화면', '앱']);
  assert.equal(await text(page, '#status-indicator'), '업비트 · 실시간 연결됨');
  // The installed copy matches the page, so only one version is shown.
  await until(page, async () => !!navigator.serviceWorker.controller);
  await page.waitForFunction(label => document.getElementById('app-version').textContent === label, `버전 ${VERSION}`);
  assert.equal(await page.locator('#app-update').isVisible(), false);

  // Wake lock: a system release is recovered; a failed recovery shows under the price.
  await page.waitForFunction(() => document.getElementById('wake-lock-status').textContent.includes('활성'));
  await page.evaluate(() => { window.realWakeRequest = navigator.wakeLock.request; });
  await page.clock.runFor(10000);
  await page.evaluate(() => testSentinel.release());
  await page.waitForFunction(() => wakeRequests === 2 && document.getElementById('wake-lock-status').textContent.includes('활성'));
  assert.equal(await page.locator('#notice').count(), 0);
  await page.clock.runFor(10000);
  await page.evaluate(() => { navigator.wakeLock.request = () => Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })); return testSentinel.release(); });
  await page.waitForFunction(() => document.getElementById('notice')?.textContent === 'SCREEN MAY SLEEP');
  assert.equal(await page.locator('#overlay-title').count(), 0);
  await page.evaluate(() => { navigator.wakeLock.request = window.realWakeRequest; });
  await page.getByRole('button', { name: '화면 켜짐 유지 다시 시도' }).click();
  await page.waitForFunction(() => wakeRequests === 3 && document.getElementById('wake-lock-status').textContent.includes('활성'));
  assert.equal(await page.locator('#notice').count(), 0);

  // Currency applies at once and the old amount is cleared first.
  await page.evaluate(() => { suppressTicks = true; });
  await page.getByRole('button', { name: 'USDT · 바이낸스', exact: true }).click();
  assert.equal(await text(page, '#price-main'), '—');
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-main'), '70,000.10 USDT');
  assert.equal(await text(page, '#change'), '▲ 2.50%');
  assert.equal(await text(page, '#change-label'), '24H');
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 1);

  // Escape closes and returns focus; the button hides again when idle.
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  await tapBoard(page); await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  // The tap that reveals the button must not press it.
  const corner = { x: 1024 - 40, y: 768 - 40 };
  await page.touchscreen.tap(corner.x, corner.y);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'board-button.png') });
  await page.touchscreen.tap(corner.x, corner.y);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.screenshot({ path: path.join(evidence, 'settings.png') });

  // Invalid tickers are refused in place; nothing changes.
  for (const bad of ['bad!', '비트', '   ']) {
    await page.locator('#admin-symbol').fill(bad); await page.locator('#admin-symbol-apply').click();
    assert.equal(await page.locator('#admin-symbol-error').isVisible(), true, bad);
  }
  assert.equal(await text(page, '#admin-symbol-error'), '영문·숫자 1~20자로 입력하세요');
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  assert.equal((await saved(page)).ticker, 'BTC');
  // Enter applies; lower case and stray spaces are tidied.
  await page.locator('#admin-symbol').fill(' eth '); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await page.locator('#admin-symbol-error').isVisible(), false);
  assert.equal(await page.locator('#admin-symbol').inputValue(), 'ETH');
  assert.equal((await saved(page)).ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  // One tap on a common coin switches to it.
  await page.locator('#ticker-presets [data-ticker="XRP"]').click();
  assert.equal(await text(page, '#price-source'), 'BINANCE · XRP/USDT');
  assert.equal(await page.locator('#ticker-presets [data-ticker="XRP"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#admin-symbol').inputValue(), 'XRP');
  await page.locator('#ticker-presets [data-ticker="ETH"]').click();
  assert.equal((await saved(page)).ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  // The coin's own icon ships with the app; no outside server is asked.
  await page.waitForFunction(() => { const icon = document.getElementById('icon'); return icon && icon.complete && icon.naturalWidth > 0; });
  assert.match(await page.locator('#icon').getAttribute('src'), /^\.\/coins\/eth\.svg$/);
  // Text typed but not applied is thrown away when the panel closes.
  await page.locator('#admin-symbol').fill('SOL'); await page.locator('#admin-close').click();
  await open(page); assert.equal(await page.locator('#admin-symbol').inputValue(), 'ETH');
  // Brightness and debug apply and save without an apply button.
  await page.locator('#admin-brightness').fill('50');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  assert.equal(await text(page, '#brightness-value'), '50%');
  await page.locator('#admin-debug').check();
  assert.deepEqual(await saved(page), { ticker: 'ETH', currency: 'USDT', debug: true, brightness: 50, burnIn: true });
  // Burn-in protection keeps the board near the middle; switched off, exactly in the middle.
  const drift = () => page.locator('#drift').evaluate(el => (el.style.transform.match(/-?[\d.]+(?=px)/g) || []).map(Number));
  await page.clock.runFor(62000);
  const [driftX, driftY] = await drift();
  assert.ok(Math.abs(driftX) <= 1024 * 0.03 && Math.abs(driftY) <= 768 * 0.03, `drift stays near the centre: ${driftX}, ${driftY}`);
  assert.ok(driftX !== 0 || driftY !== 0, 'the board does move');
  await page.locator('#admin-burn-in').uncheck();
  assert.deepEqual(await drift(), [0, 0]);
  assert.equal((await saved(page)).burnIn, false);
  await page.clock.runFor(62000);
  assert.deepEqual(await drift(), [0, 0]);
  await page.locator('#admin-burn-in').check();
  // A tap outside the panel closes it and keeps what was applied.
  await page.touchscreen.tap(20, 20);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  // Settings survive a reload.
  await page.reload(); await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  await open(page); await page.locator('#admin-debug').uncheck(); await page.locator('#admin-brightness').fill('100');
  await page.locator('#admin-close').click();
  // Focus stays on the button after closing; a tap elsewhere lets it hide again.
  await tapBoard(page); await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);

  // A panel nobody is touching closes itself after two minutes.
  await open(page);
  await page.clock.runFor(110000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.locator('#admin-symbol').focus(); await page.keyboard.press('ArrowRight');
  await page.clock.runFor(110000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true, 'a key press keeps it open');
  await page.clock.runFor(11000);
  assert.equal(await page.locator('#admin-panel').count(), 0);

  // Background: sockets close; coming back waits for a fresh price.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 0);
  await page.evaluate(() => { suppressTicks = true; window.dispatchEvent(new Event('pageshow')); });
  await page.clock.runFor(3000);
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  await page.evaluate(() => { suppressTicks = false; sockets.at(-1).emit(); }); await live(page);
  // Silence is shown as a delay with the last price kept on screen.
  await page.evaluate(() => { suppressTicks = true; }); await page.clock.fastForward(16000);
  await page.waitForFunction(() => /DELAYED · LAST PRICE/.test(document.getElementById('overlay-title')?.textContent || ''));
  assert.equal(await text(page, '#price-main'), '70,000.10 USDT');
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  await page.screenshot({ path: path.join(evidence, 'board-delay.png') });
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(4000); await live(page);
  assert.equal(await page.locator('#overlay-title').count(), 0);
  // Malformed prices never reach the board.
  await page.evaluate(() => sockets.at(-1).emit({ c: 'Infinity' }));
  assert.equal(await text(page, '#price-main'), '70,000.10 USDT');

  // A ticker the exchange never answers for.
  await open(page);
  await page.evaluate(() => { suppressTicks = true; });
  await page.locator('#admin-symbol').fill('NOPE'); await page.locator('#admin-symbol-apply').click();
  await page.clock.runFor(40000);
  assert.equal(await text(page, '#overlay-title'), 'CHECK TICKER');
  // A coin without an icon shows its ticker in the icon's place.
  assert.equal(await text(page, '#icon-fallback'), 'NOPE');
  assert.match(await text(page, '#overlay-msg'), /지원하지 않는 티커일 수 있습니다/);
  // Being offline is the more useful thing to say than doubting the ticker.
  await context.setOffline(true);
  await page.waitForFunction(() => /^OFFLINE/.test(document.getElementById('overlay-title')?.textContent || ''));
  await context.setOffline(false);
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(35000); await live(page);
  assert.equal(await page.locator('#overlay-title').count(), 0);
  // An exchange error stops retrying and offers a manual reconnect.
  await page.evaluate(() => sockets.at(-1).onmessage({ data: JSON.stringify({ error: { name: 'INVALID_PARAM' } }) }));
  await page.waitForFunction(() => /^ERROR/.test(document.getElementById('overlay-title')?.textContent || ''));
  await page.getByRole('button', { name: '시세 다시 연결' }).click();
  await page.clock.runFor(3000); await live(page);

  // A new release arrives while settings are open: it waits, then applies itself.
  flags.nextWorker = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(() => document.getElementById('app-update') && !document.getElementById('app-update').hidden);
  await page.waitForFunction(label => document.getElementById('app-version').textContent === label, `버전 ${VERSION} · 설치된 사본 ${NEXT_VERSION}`);
  await page.evaluate(() => { window.beforeReload = true; });
  await page.locator('#admin-close').click();
  await page.waitForFunction(() => !window.beforeReload && !!document.getElementById('container'));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('coinboard-auto-reload')), NEXT_VERSION);
  flags.nextWorker = false;

  // Everything the board loads comes from its own address.
  assert.deepEqual(requests.filter(url => !url.startsWith(base) && !url.startsWith('data:')), []);
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS board: rest state, keyboard, wake lock recovery, currency/ticker, immediate settings, delay/suspect/offline/error, automatic update');
}

async function idleUpdate(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await scripted(context);
  const page = await context.newPage(); const problems = watch(page);
  await page.goto(base); await live(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => { window.beforeReload = true; });
  flags.nextWorker = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForFunction(() => !window.beforeReload && !!document.getElementById('container'));
  await live(page);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('coinboard-auto-reload')), NEXT_VERSION);
  flags.nextWorker = false;
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS idle update: a board nobody is touching reloads itself once for a new release');
}

async function lockedStorage(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await scripted(context);
  await context.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  const page = await context.newPage(); const problems = watch(page);
  await page.goto(base); await live(page);
  assert.equal(await text(page, '#price-main'), '98,000,000 KRW');
  await open(page);
  await page.getByRole('button', { name: 'USDT · 바이낸스', exact: true }).click();
  assert.match(await text(page, '#toast'), /저장하지 못했습니다/);
  await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS locked storage: defaults, live price, unsaved change applies for the session');
}

async function carriedSettings(browser, base) {
  const context = await browser.newContext(); await scripted(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem('coinboard-settings')) localStorage.setItem('btc-kiosk-settings', JSON.stringify({ ticker: 'ETH', currency: 'USDT', debug: false, brightness: 60 }));
  });
  const page = await context.newPage(); await page.goto(base); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(60%)');
  await context.close();
  console.log('PASS carried settings: settings saved by btc-price-kiosk are picked up');
}

async function offlineShell(browser, base) {
  const context = await browser.newContext(); await scripted(context);
  const page = await context.newPage(); await page.goto(base); await live(page);
  await until(page, async version => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !!navigator.serviceWorker.controller && registration.active?.state === 'activated' && !registration.installing &&
      (await caches.keys()).some(key => key.endsWith(':' + version));
  }, VERSION);
  const cached = await page.evaluate(async version => {
    const name = (await caches.keys()).find(key => key.endsWith(':' + version));
    return (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname.replace('/coinboard/', ''));
  }, VERSION);
  const built = fs.readdirSync(dist, { recursive: true }).map(file => String(file).split(path.sep).join('/'))
    .filter(file => fs.statSync(path.join(dist, file)).isFile() && file !== 'sw.js')
    // Of the coin icons, only the preset coins are installed up front.
    .filter(file => !file.startsWith('coins/') || ['btc', 'eth', 'xrp', 'sol', 'doge', 'ada'].includes(path.basename(file, '.svg')));
  assert.deepEqual(cached.sort(), built.sort());
  await context.setOffline(true);
  for (const entry of ['', 'index.html', '?source=home']) {
    await page.goto(base + entry);
    await page.waitForFunction(() => /^OFFLINE/.test(document.getElementById('overlay-title')?.textContent || ''));
    assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-BTC');
    assert.equal(await text(page, '#price-main'), '—');
  }
  await context.close();
  console.log('PASS offline shell: every built file is cached; the board opens offline and holds no cached price');
}

async function layouts(browser, base) {
  const context = await browser.newContext({ hasTouch: true }); await scripted(context);
  const page = await context.newPage(); await page.clock.install(); await page.goto(base); await live(page);
  const records = [];
  for (const s of [
    { name: 'ipad-portrait', width: 768, height: 1024, top: 24, right: 0, bottom: 20, left: 0 },
    { name: 'ipad-landscape', width: 1024, height: 768, top: 24, right: 24, bottom: 20, left: 24 },
    { name: 'asymmetric', width: 1194, height: 834, top: 32, right: 16, bottom: 21, left: 44 },
    { name: 'ipad-portrait-zero', width: 768, height: 1024, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'ipad-landscape-zero', width: 1024, height: 768, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'desktop-zero', width: 1440, height: 900, top: 0, right: 0, bottom: 0, left: 0 },
    { name: 'phone', width: 390, height: 844, top: 44, right: 0, bottom: 34, left: 0 },
    { name: 'short-landscape', width: 1024, height: 360, top: 0, right: 24, bottom: 20, left: 24 },
  ]) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.evaluate(s => { for (const side of ['top', 'right', 'bottom', 'left']) document.documentElement.style.setProperty('--safe-' + side, s[side] + 'px');
      // On a device the insets change with a rotation, which also fires resize.
      window.dispatchEvent(new Event('resize')); }, s);
    // The board fills the screen in one direction and never leaves it.
    await page.waitForFunction(() => document.getElementById('container').style.transform.startsWith('scale('));
    const area = { width: s.width - s.left - s.right, height: s.height - s.top - s.bottom };
    const portrait = s.height > s.width;
    const face = await page.locator('#container').boundingBox();
    assert.ok(face.x >= 0 && face.y >= 0 && face.x + face.width <= s.width && face.y + face.height <= s.height, s.name + ' board on screen');
    const fills = Math.max(face.width / (area.width * 0.86), face.height / (area.height * (portrait ? 0.72 : 0.6)));
    assert.ok(fills > 0.98 && fills < 1.02, s.name + ' board fills the screen: ' + fills);
    assert.equal(await page.locator('#container').evaluate(el => getComputedStyle(el).flexDirection), portrait ? 'column' : 'row', s.name + ' orientation');
    if (['ipad-portrait', 'ipad-landscape', 'phone'].includes(s.name)) await page.screenshot({ path: path.join(evidence, `board-${s.name}.png`) });
    await tapBoard(page);
    const toggle = await page.locator('#settings-toggle').boundingBox();
    assert.equal(toggle.width, 48); assert.equal(toggle.height, 48);
    assert.equal(toggle.y + toggle.height, s.height - s.bottom - 16, s.name + ' button bottom');
    assert.equal(toggle.x + toggle.width, s.width - s.right - 16, s.name + ' button right');
    await page.locator('#settings-toggle').tap();
    // The worst case for height: every optional button showing.
    await page.evaluate(() => { for (const id of ['wake-lock-retry', 'app-update', 'market-retry']) document.getElementById(id).hidden = false; });
    // Measure the sheet where it comes to rest, not partway through its entrance.
    await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
    const dialog = await page.locator('#admin-panel').boundingBox();
    const inside = box => {
      assert.ok(box.x >= s.left + 15, s.name + ' left'); assert.ok(box.x + box.width <= s.width - s.right - 15, s.name + ' right');
      assert.ok(box.y >= Math.max(48, s.top + 16) - 1, s.name + ' top'); assert.ok(box.y + box.height <= s.height - s.bottom - 15, s.name + ' bottom');
    };
    inside(dialog);
    await page.locator('#admin-debug').scrollIntoViewIfNeeded();
    inside(await page.locator('#admin-close').boundingBox());
    if (s.name.startsWith('ipad-') && !s.name.endsWith('zero')) await page.screenshot({ path: path.join(evidence, `settings-${s.name}.png`) });
    records.push({ ...s, toggle, dialog });
    await page.locator('#admin-close').tap();
    assert.equal(await page.locator('#admin-panel').count(), 0);
    await page.clock.fastForward(6000);
  }
  fs.writeFileSync(path.join(evidence, 'layouts.json'), JSON.stringify(records, null, 2));
  await context.close();
  console.log('PASS layout: 8 sizes and safe-area sets; board scaled to fill and stacked in portrait, 48px button in the corner, panel inside the safe area, close button reachable after scrolling');
}

async function liveExchanges(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage(); await page.goto(base);
  await page.keyboard.press('Tab'); await page.locator('#settings-toggle').click();
  for (const currency of ['KRW', 'USDT']) {
    await page.locator(`[data-currency="${currency}"]`).click();
    try {
      await page.waitForFunction(() => document.getElementById('status-indicator').className === 'connected', null, { timeout: 25000 });
      console.log('LIVE PASS', currency, await text(page, '#price-main'), await text(page, '#price-source'));
      if (currency === 'KRW') {
        await page.waitForTimeout(32000);
        assert.equal(await page.locator('#status-indicator').getAttribute('class'), 'connected');
        console.log('LIVE PASS KRW: still connected after 30 seconds');
      }
    } catch { console.log('LIVE NOT VERIFIED', currency, await text(page, '#status-indicator')); }
  }
  await context.close();
}

fs.mkdirSync(evidence, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://localhost:${server.address().port}/coinboard/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  for (const scenario of [board, idleUpdate, lockedStorage, carriedSettings, offlineShell, layouts]) await scenario(browser, base);
  if (process.env.LIVE_NETWORK === '1') await liveExchanges(browser, base);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
