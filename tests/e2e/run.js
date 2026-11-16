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
// Most scenarios start from one Upbit asset (seed); a new board's own default
// (Binance) is checked where nothing is seeded.
async function scripted(context, { seed = true } = {}) {
  await context.route('https://**/*', route => route.abort());
  if (seed) await context.addInitScript(() => {
    try { if (!localStorage.getItem('coinboard-settings')) localStorage.setItem('coinboard-settings', JSON.stringify({ assets: [{ currency: 'KRW', ticker: 'BTC' }] })); } catch {}
  });
  await context.addInitScript(() => {
    window.sockets = []; window.sent = []; window.suppressTicks = false;
    // Markets that never answer (as a coin the exchange does not list would not).
    window.silentMarkets = [];
    // Prices by market, when a connection carries several (each coin on its
    // own gets the usual price, which the single-coin checks expect).
    const PRICES = { 'KRW-BTC': 98000000, BTCUSDT: '70000.10', 'KRW-ETH': 5000000, 'KRW-XRP': 3400, ETHUSDT: '3500.50', SOLUSDT: '180.25' };
    window.WebSocket = class {
      static OPEN = 1;
      constructor(url) {
        this.url = url; this.readyState = 0;
        // One raw stream, a combined one (several coins), or Upbit (coins named on subscribing).
        this.combined = url.includes('/stream?streams=');
        const streams = this.combined ? url.split('streams=')[1].split('/') : url.includes('upbit') ? ['krw-btc@'] : [url.split('/ws/')[1]];
        this.markets = streams.map(stream => stream.split('@')[0].toUpperCase());
        window.sockets.push(this);
        // holdOpen keeps a connection connecting until release() is called.
        this.release = () => {
          if (this.readyState === 3) return;
          this.readyState = 1; this.onopen?.();
          if (!url.includes('upbit')) this.emit();
          this.timer = setInterval(() => this.emit(), 1000);
        };
        setTimeout(() => { if (!window.holdOpen) this.release(); }, 0);
      }
      // quote(values) makes every following ticker carry those values; quote() goes back to the usual ones.
      quote(values = null) { this.fixed = values; this.emit(); }
      emit(values = {}) {
        if (this.readyState !== 1 || window.suppressTicks) return;
        values = { ...(this.fixed || {}), ...values };
        const upbit = this.url.includes('upbit');
        for (const market of this.markets) {
          if (window.silentMarkets.includes(market)) continue;
          let data = upbit ? { type: 'ticker', code: market, trade_price: (this.markets.length > 1 && PRICES[market]) || 98000000, signed_change_rate: -0.025, timestamp: Date.now(), ...values }
            : { e: '24hrTicker', s: market, c: (this.markets.length > 1 && PRICES[market]) || '70000.10', P: '2.5', E: Date.now(), ...values };
          if (this.combined) data = { stream: `${market.toLowerCase()}@ticker`, data };
          this.onmessage?.({ data: upbit ? new TextEncoder().encode(JSON.stringify(data)).buffer : JSON.stringify(data) });
        }
      }
      send(text) {
        window.sent.push(text);
        if (text === 'PING') { this.onmessage?.({ data: '{"status":"UP"}' }); return; }
        const frame = JSON.parse(text);
        // Binance: streams added or dropped on the open connection, answered { result: null, id }.
        if (frame.method) {
          const named = frame.params.map(stream => stream.split('@')[0].toUpperCase());
          this.markets = frame.method === 'SUBSCRIBE' ? [...new Set([...this.markets, ...named])] : this.markets.filter(market => !named.includes(market));
          this.onmessage?.({ data: JSON.stringify({ result: null, id: frame.id }) }); this.emit(); return;
        }
        // Upbit: a new subscription replaces the old one.
        this.markets = frame[1].codes; this.emit();
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
  // Shown, or on its way out (a fade): Tab brings it back for good.
  if (!await page.evaluate(() => document.body.classList.contains('controls-visible'))) await page.keyboard.press('Tab');
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
}
// Button groups (market, columns, colours): press one, or read which is on.
const choose = (page, group, value) => page.locator(`${group} [data-value="${value}"]`).click();
const chosen = (page, group) => page.locator(`${group} [data-state="on"]`).getAttribute('data-value');
// Remove an asset from its editor: unfold its row (if it is not), then the remove button.
async function removeAsset(page, row) {
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await page.locator('#asset-remove').click();
}
// The chosen asset's market and coin rows show once its row is tapped.
async function openEditor(page) {
  await open(page);
  if (!await page.locator('#admin-coin').isVisible()) await page.locator('.asset-pick[aria-pressed="true"]').click();
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
  assert.equal(await text(page, '#price-main'), '9800만');
  assert.equal(await text(page, '#change'), '▼ 2.50%');
  assert.equal(await text(page, '#change-label'), '1D');
  // The head line names the coin and the currency; the price line is digits only.
  assert.equal(await text(page, '#coin'), 'BTC'); assert.equal(await text(page, '#unit'), 'KRW');
  assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-BTC');
  assert.equal(await page.evaluate(() => sockets.length), 1);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  // The browser tab carries the price too.
  assert.equal(await page.title(), '9800만 | BTCKRW | Coinboard');
  // The board is set in Pretendard, shipped with the app: the same letterforms on every device.
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.locator('#price-main').evaluate(el => getComputedStyle(el).fontFamily), /^"?Pretendard"?,/);
  assert.equal(await page.evaluate(() => document.fonts.check('600 200px Pretendard', '9800만')), true, 'the font is loaded, Hangul included');
  assert.deepEqual(requests.filter(url => /\.woff2?$/.test(url)).filter(url => !url.startsWith(base)), [], 'fonts come from the app itself');
  assert.ok(requests.some(url => url.startsWith(base) && url.endsWith('.woff2')), 'a font file was loaded');
  // No words under the price: one small dot in the corner says how things are.
  assert.equal(await page.locator('#status-overlay, #overlay-title, #notice').count(), 0);
  const level = () => page.locator('#status-dot').getAttribute('data-level');
  const tip = () => text(page, '#status-tip');
  assert.equal(await level(), 'ok');
  assert.equal(await tip(), 'UPBIT · KRW-BTC\nLIVE');
  const dotBox = await page.locator('#status-dot').boundingBox();
  assert.ok(dotBox.x < 60 && dotBox.y + dotBox.height > 768 - 60, 'dot is in the bottom-left corner');
  assert.equal(await page.locator('#status-tip').isVisible(), false);
  // The exchange and market are for screen readers only; they take no room on the board.
  const sourceBox = await page.locator('#price-source').boundingBox();
  assert.ok(sourceBox.width <= 3 && sourceBox.height <= 3, 'source line is not drawn');
  // Nothing on the board itself is in Korean.
  // (억 and 만 in a won price are the one exception.)
  assert.doesNotMatch((await text(page, '#container')).replace(/[억만]/g, ''), /[가-힣]/);
  await page.screenshot({ path: path.join(evidence, 'board.png') });

  // Keyboard: Tab reveals and focuses the button, Enter opens, focus is kept inside.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  await page.keyboard.press('Shift+Tab');
  // The last stop in the panel is the link to the source repository.
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-repo');
  const repo = page.locator('#admin-repo');
  assert.equal(await repo.getAttribute('href'), 'https://github.com/2jiho/coinboard');
  assert.equal(await repo.getAttribute('target'), '_blank');
  assert.match(await repo.getAttribute('rel'), /noopener/);
  // Just the GitHub mark, with its name kept for screen readers.
  assert.equal(await repo.locator('svg').count(), 1);
  assert.equal((await repo.textContent()).trim(), '');
  assert.equal(await repo.getAttribute('aria-label'), 'GitHub 저장소');
  await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
  const mark = await repo.boundingBox();
  assert.ok(mark.width >= 44 && mark.height >= 44, 'the icon is still a full-size touch target');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-close');
  // Two small section titles, and a healthy board has nothing to report: no status lines, no extra input.
  assert.deepEqual(await page.locator('#admin-panel h3').allTextContents(), ['시세', '화면']);
  for (const quiet of ['#status-indicator', '#overlay-msg', '#wake-lock-status', '#admin-symbol', '#market-retry', '#wake-lock-retry', '#app-update']) {
    assert.equal(await page.locator(quiet).isVisible(), false, quiet + ' is hidden while all is well');
  }
  assert.equal(await page.locator('#admin-debug').count(), 0);
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
  assert.equal(await level(), 'ok');
  await page.clock.runFor(10000);
  await page.evaluate(() => { navigator.wakeLock.request = () => Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })); return testSentinel.release(); });
  await page.waitForFunction(() => document.getElementById('status-dot').dataset.level === 'warn');
  assert.equal(await tip(), 'UPBIT · KRW-BTC\nLIVE\nSCREEN MAY SLEEP');
  await page.evaluate(() => { navigator.wakeLock.request = window.realWakeRequest; });
  await page.getByRole('button', { name: '화면 켜짐 유지 다시 시도' }).click();
  await page.waitForFunction(() => wakeRequests === 3 && document.getElementById('wake-lock-status').textContent.includes('활성'));
  assert.equal(await level(), 'ok');

  // Currency applies at once and the old amount is cleared first.
  // The board is one fixed size: a shorter or longer price, or none yet, does not resize it.
  const boardSize = () => page.locator('#container').evaluate(el => el.style.transform);
  const steadySize = await boardSize();
  // Market and coin are folded away until the asset's row is tapped; a second tap folds them again.
  assert.equal(await page.locator('#admin-currency').count(), 0);
  await page.locator('.asset-pick').first().click();
  assert.equal(await page.locator('.asset-pick').first().getAttribute('aria-expanded'), 'true');
  await page.locator('.asset-pick').first().click();
  assert.equal(await page.locator('#admin-currency').count(), 0);
  await page.locator('.asset-pick').first().click();
  await page.evaluate(() => { suppressTicks = true; });
  await choose(page, '#admin-currency', 'USDT');
  assert.equal(await text(page, '#price-main'), '—');
  assert.equal(await boardSize(), steadySize, 'no price yet: same size');
  assert.equal(await page.title(), 'BTCUSDT | Coinboard');
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.equal(await text(page, '#change'), '▲ 2.50%');
  assert.equal(await text(page, '#change-label'), '24H');
  assert.equal(await boardSize(), steadySize, 'a different price: same size');
  // A much longer price than usual shrinks inside its own zone; nothing else changes size.
  const zoneOf = id => page.locator(id).evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
  const [zoneBefore, changeBefore] = [await zoneOf('#price-main'), await zoneOf('#change')];
  // The screen takes a new price at most once every three seconds.
  await page.evaluate(() => sockets.at(-1).quote({ c: '0.000012345678' }));
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '0.00001235');
  assert.equal(await boardSize(), steadySize, 'a very long price: same board size');
  await page.waitForFunction(() => document.getElementById('price-text').style.transform !== 'scale(1)');
  const longText = await zoneOf('#price-text');
  assert.ok(longText.left >= zoneBefore.left - 1 && longText.right <= zoneBefore.right + 1, 'the long price fits its zone');
  assert.ok(longText.height < zoneBefore.height * 0.9, 'and is drawn smaller to do so');
  const same = (a, b) => Math.abs(a - b) < 0.5;
  assert.ok(same((await zoneOf('#price-main')).height, zoneBefore.height), 'price zone keeps its height');
  assert.ok(same((await zoneOf('#change')).height, changeBefore.height), 'change keeps its size');
  await page.evaluate(() => sockets.at(-1).quote());
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,000');
  // A usual price goes back to full size.
  await page.waitForFunction(() => document.getElementById('price-text').style.transform === 'scale(1)');
  assert.equal(await boardSize(), steadySize, 'back to the usual size');
  assert.equal(await text(page, '#unit'), 'USDT');
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 1);

  // Binance perpetual futures: a market of its own, priced in USDT and marked PERP.
  assert.equal(await page.locator('#tag').count(), 0);
  await choose(page, '#admin-currency', 'USDT-PERP');
  await page.clock.runFor(3000); await live(page);
  assert.match(await page.evaluate(() => sockets.at(-1).url), /^wss:\/\/fstream\.binance\.com\/market\/ws\/btcusdt@ticker$/);
  assert.equal(await text(page, '#coin'), 'BTC'); assert.equal(await text(page, '#unit'), 'USDT'); assert.equal(await text(page, '#tag'), 'PERP');
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.equal(await text(page, '#price-source'), 'BINANCE FUTURES · BTC/USDT PERP');
  assert.equal(await page.title(), '70,000 | BTCUSDTPERP | Coinboard');
  assert.equal((await saved(page)).assets[0].currency, 'USDT-PERP');
  assert.equal(await boardSize(), steadySize, 'the PERP mark does not change the board size');
  // The whole choice is readable in the settings row.
  assert.ok(await page.locator('#admin-currency [data-value]').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1)), 'the market names are not cut off');
  await choose(page, '#admin-currency', 'USDT');
  await page.clock.runFor(3000); await live(page);
  assert.equal(await page.locator('#tag').count(), 0);
  // Escape closes and returns focus; the button hides again when idle.
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-toggle');
  // On iOS two quick taps must stay two taps (no double-tap zoom), and a long press presses (no text selection).
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), 'manipulation');
  assert.equal(await page.locator('#settings-toggle').evaluate(el => getComputedStyle(el).userSelect), 'none');
  // A press on the button just as it starts to fade out opens settings; it is not taken for a tap to reveal it.
  await tapBoard(page); await page.clock.fastForward(5000);
  assert.equal(await page.evaluate(() => document.body.classList.contains('controls-visible')), false);
  const fading = await page.locator('#settings-toggle').boundingBox();
  await page.touchscreen.tap(fading.x + 24, fading.y + 24);
  assert.equal(await page.locator('#admin-panel').isVisible(), true, 'pressed while fading');
  await page.keyboard.press('Escape');
  await tapBoard(page); await page.clock.fastForward(6000);
  // It fades out over 0.6 s (real time, not the test clock).
  await page.locator('#settings-toggle').waitFor({ state: 'hidden', timeout: 3000 });
  // The tap that reveals the button must not press it.
  const corner = { x: 1024 - 40, y: 768 - 40 };
  await page.touchscreen.tap(corner.x, corner.y);
  assert.equal(await page.locator('#settings-toggle').isVisible(), true);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  await page.screenshot({ path: path.join(evidence, 'board-button.png') });
  await page.touchscreen.tap(corner.x, corner.y);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
  await page.screenshot({ path: path.join(evidence, 'settings.png') });

  // The panel opens on the asset list; the asset's market and coin unfold from its row.
  assert.equal(await page.locator('#admin-coin').count(), 0);
  await page.locator('.asset-pick').first().click();
  // Any other coin: "직접 입력…" opens a field for its ticker.
  // Coin and currency are two one-line choices.
  assert.deepEqual(await page.locator('#admin-coin option').allTextContents(), ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', '직접 입력…']);
  // The market is three buttons, each naming the exchange and the currency.
  assert.deepEqual(await page.locator('#admin-currency [data-value]').evaluateAll(els => els.map(el => el.textContent.trim())), ['업비트원화', '바이낸스USDT', '바이낸스무기한']);
  assert.deepEqual(await page.locator('#admin-currency [data-value]').evaluateAll(els => els.map(el => el.getAttribute('aria-label'))), ['원화 · 업비트', 'USDT · 바이낸스', 'USDT 무기한 · 바이낸스']);
  assert.equal(await page.locator('#admin-coin').inputValue(), 'BTC');
  await page.locator('#admin-coin').selectOption('__other');
  assert.equal(await page.locator('#admin-symbol').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-symbol');
  // Invalid tickers are refused in place; nothing changes.
  for (const bad of ['bad!', '비트', '   ']) {
    await page.locator('#admin-symbol').fill(bad); await page.locator('#admin-symbol-apply').click();
    assert.equal(await page.locator('#admin-symbol-error').isVisible(), true, bad);
  }
  assert.equal(await text(page, '#admin-symbol-error'), '영문·숫자 1~20자로 입력하세요');
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  assert.equal((await saved(page)).assets[0].ticker, 'BTC');
  // Enter applies; lower case and stray spaces are tidied.
  await page.locator('#admin-symbol').fill(' eth '); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await page.locator('#admin-symbol-error').isVisible(), false);
  // ETH is on the list, so the choice shows it and the field folds away.
  assert.equal(await page.locator('#admin-coin').inputValue(), 'ETH');
  assert.equal(await page.locator('#admin-symbol').isVisible(), false);
  assert.equal((await saved(page)).assets[0].ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  // Choosing a listed coin switches to it at once.
  await page.locator('#admin-coin').selectOption('XRP');
  assert.equal(await text(page, '#price-source'), 'BINANCE · XRP/USDT');
  await page.locator('#admin-coin').selectOption('ETH');
  assert.equal((await saved(page)).assets[0].ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  // The coin's own icon ships with the app; no outside server is asked.
  await page.waitForFunction(() => { const icon = document.getElementById('icon'); return icon && icon.complete && icon.naturalWidth > 0; });
  assert.match(await page.locator('#icon').getAttribute('src'), /^\.\/coins\/eth\.svg$/);
  // Text typed but not applied is thrown away when the panel closes.
  await page.locator('#admin-coin').selectOption('__other');
  await page.locator('#admin-symbol').fill('LINK'); await page.locator('#admin-close').click();
  await openEditor(page); assert.equal(await page.locator('#admin-symbol').isVisible(), false);
  assert.equal(await page.locator('#admin-coin').inputValue(), 'ETH');
  // Brightness applies and saves without an apply button. It is a slider: from 100, ten steps of 5 down.
  const brightnessThumb = page.locator('#admin-brightness [role="slider"]');
  await brightnessThumb.focus();
  for (let step = 0; step < 10; step += 1) await page.keyboard.press('ArrowLeft');
  assert.equal(await brightnessThumb.getAttribute('aria-valuenow'), '50');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  assert.equal(await text(page, '#brightness-value'), '50%');
  assert.deepEqual(await saved(page), { assets: [{ currency: 'USDT', ticker: 'ETH' }], columns: 0, brightness: 50, burnIn: true, palette: 'green-red' });
  // Up and down colours: green and red, or the Korean red and blue.
  const colourOf = id => page.locator(id).evaluate(el => getComputedStyle(el).color);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('change')).color === 'rgb(48, 209, 88)');
  await choose(page, '#admin-palette', 'red-blue');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('change')).color === 'rgb(255, 69, 58)');
  assert.equal((await saved(page)).palette, 'red-blue');
  await choose(page, '#admin-palette', 'green-red');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('change')).color === 'rgb(48, 209, 88)');
  // Burn-in protection keeps the board near the middle; switched off, exactly in the middle.
  const drift = () => page.locator('#drift').evaluate(el => (el.style.transform.match(/-?[\d.]+(?=px)/g) || []).map(Number));
  await page.clock.runFor(62000);
  const [movedX, movedY] = await drift();
  await page.locator('#admin-burn-in').uncheck();
  // Still: no sideways offset; the vertical one only lifts the price line to the middle.
  const [stillX, stillY] = await drift();
  assert.equal(stillX, 0);
  assert.ok(Math.abs(movedX) <= 1024 * 0.03 && Math.abs(movedY - stillY) <= 768 * 0.03, `drift stays near the centre: ${movedX}, ${movedY - stillY}`);
  assert.ok(movedX !== 0 || movedY !== stillY, 'the board does move');
  assert.equal((await saved(page)).burnIn, false);
  await page.clock.runFor(62000);
  assert.deepEqual(await drift(), [stillX, stillY]);
  // With the board still, the price line sits exactly at mid-height of the screen.
  const middle = await page.locator('#price-main').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  assert.ok(Math.abs(middle.y - 384) < 1.5, `price at mid-height: ${middle.y}`);
  await page.locator('#admin-burn-in').check();
  // A tap outside the panel closes it and keeps what was applied.
  await page.touchscreen.tap(20, 20);
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  // Settings survive a reload.
  await page.reload(); await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  await open(page); await page.locator('#admin-brightness [role="slider"]').focus(); await page.keyboard.press('End');
  await page.locator('#admin-close').click();
  // Focus stays on the button after closing; a tap elsewhere lets it hide again.
  await tapBoard(page); await page.clock.fastForward(6000);
  // It fades out over 0.6 s (real time, not the test clock).
  await page.locator('#settings-toggle').waitFor({ state: 'hidden', timeout: 3000 });

  // A panel nobody is touching closes itself after two minutes.
  await open(page);
  await page.clock.runFor(110000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.locator('#admin-brightness [role="slider"]').focus(); await page.keyboard.press('Shift');
  await page.clock.runFor(110000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true, 'a key press keeps it open');
  await page.clock.runFor(11000);
  assert.equal(await page.locator('#admin-panel').count(), 0);

  // Looking at another tab does not disconnect: the price in the tab title stays live.
  const hide = hidden => page.evaluate(hidden => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const openSockets = () => page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length);
  const socketsBefore = await page.evaluate(() => sockets.length);
  await hide(true);
  assert.equal(await openSockets(), 1, 'still connected while hidden');
  await page.evaluate(() => sockets.at(-1).quote({ c: '71234.00' }));
  await page.clock.runFor(3100);
  assert.equal(await page.title(), '71,234 | ETHUSDT | Coinboard', 'the title follows the price while hidden');
  await hide(false);
  assert.equal(await page.evaluate(() => sockets.length), socketsBefore, 'coming back to a live board does not reconnect');
  await page.evaluate(() => sockets.at(-1).quote()); await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,000');

  // Leaving the page altogether does close the connection; coming back waits for a fresh price.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 0);
  await page.evaluate(() => { suppressTicks = true; window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.clock.runFor(3000);
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  await page.evaluate(() => { suppressTicks = false; sockets.at(-1).emit(); }); await live(page);
  // Silence is shown as a delay with the last price kept on screen.
  const sizeOf = () => page.locator('#container').evaluate(el => el.style.transform);
  const sizeWhenLive = await sizeOf();
  await page.evaluate(() => { suppressTicks = true; }); await page.clock.fastForward(16000);
  await page.waitForFunction(() => /DELAYED · LAST PRICE/.test(document.getElementById('status-tip').textContent));
  assert.equal(await level(), 'warn');
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  await page.locator('#settings-toggle').waitFor({ state: 'hidden', timeout: 3000 });
  // Trouble changes the dot, never the board's size.
  assert.equal(await sizeOf(), sizeWhenLive, 'board keeps its size when there is trouble');
  // Let the dot finish changing colour, and show its detail, for the picture.
  await page.touchscreen.tap(40, 768 - 40); await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(evidence, 'board-delay.png') });
  await page.touchscreen.tap(500, 300);
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(4000); await live(page);
  assert.equal(await level(), 'ok');
  // Each digit is its own piece, so only the ones that change roll over.
  const digits = () => page.locator('#price-text .digit').allTextContents();
  assert.deepEqual(await digits(), ['7', '0', ',', '0', '0', '0']);
  // Let any movement from earlier price changes finish first.
  await page.waitForFunction(() => [...document.querySelectorAll('#price-text .digit')].every(el => el.getAnimations().length === 0));
  await page.evaluate(() => { for (const el of document.querySelectorAll('#price-text .digit')) el.dataset.seen = '1'; });
  await page.evaluate(() => sockets.at(-1).quote({ c: '70010.00' }));
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,010');
  assert.deepEqual(await page.locator('#price-text .digit').evaluateAll(els => els.map(el => el.dataset.seen || 'new')), ['1', '1', '1', '1', 'new', '1']);
  assert.match(await page.locator('#price-text .digit').nth(4).getAttribute('class'), /\bup\b/);
  // The new digit pushes the old one out, so it knows which digit it replaces,
  // and each digit sits in a window that hides whatever is pushed past its edge.
  // (Digits changed earlier in this run keep the mark of that change; only the new one is of interest.)
  const pushed = () => page.locator('#price-text .digit').evaluateAll(els => els.map(el => el.dataset.seen ? '' : (el.dataset.old ?? '')));
  assert.deepEqual(await pushed(), ['', '', '', '', '0', '']);
  assert.equal(await page.locator('#price-text .slot').count(), 6);
  assert.equal(await page.locator('#price-text .digit').nth(4).evaluate(el => getComputedStyle(el, '::before').content), '"0"');
  assert.notEqual(await page.locator('#price-text .slot').nth(4).evaluate(el => getComputedStyle(el).clipPath), 'none');
  // The price rose, so the movement is upwards: the new digit rises from below.
  assert.equal(await page.locator('#price-text .digit').nth(4).evaluate(el => getComputedStyle(el).animationName), 'push-up');
  // Only that digit moves. The others carry no direction and are not animating:
  // not now, and not when the price turns round and falls.
  const moving = () => page.locator('#price-text .digit').evaluateAll(els => els.map(el => (el.dataset.seen ? 'still' : (/\b(up|down)\b/.exec(el.className) || ['still'])[0]) + (el.getAnimations().length ? '*' : '')));
  assert.deepEqual((await moving()).map(state => state.replace('*', '')), ['still', 'still', 'still', 'still', 'up', 'still']);
  assert.deepEqual((await moving()).filter(state => state.endsWith('*')).length <= 1, true, 'at most the changed digit is animating');
  await page.evaluate(() => { for (const el of document.querySelectorAll('#price-text .digit')) el.dataset.seen = '1'; });
  await page.evaluate(() => sockets.at(-1).quote({ c: '70000.10' }));
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.deepEqual(await page.locator('#price-text .digit').evaluateAll(els => els.map(el => el.dataset.seen || 'new')), ['1', '1', '1', '1', 'new', '1']);
  assert.deepEqual((await moving()).map(state => state.replace('*', '')), ['still', 'still', 'still', 'still', 'down', 'still'], 'a change of direction moves only the changed digit');
  // The price fell, so the movement is downwards: the new digit descends, pushing the old "1" down and out.
  assert.deepEqual(await pushed(), ['', '', '', '', '1', '']);
  assert.equal(await page.locator('#price-text .digit').nth(4).evaluate(el => getComputedStyle(el).animationName), 'push-down');
  assert.deepEqual((await moving()).filter(state => state.endsWith('*')).length <= 1, true);
  // The tint of the price follows the size of the move: slight, ordinary, large.
  // The clock is stepped finely so the tint is read while it is still on.
  const tintAfter = async (price, shown) => {
    await page.clock.runFor(3100);
    await page.evaluate(value => sockets.at(-1).quote({ c: value }), price);
    for (let step = 0; step < 40 && await text(page, '#price-main') !== shown; step += 1) await page.clock.runFor(100);
    assert.equal(await text(page, '#price-main'), shown);
    return page.locator('#price-main').evaluate(el => `${el.className.replace(/\bprice\b/, "").trim()} ${el.dataset.strength}`);
  };
  const colour = () => page.locator('#price-main').evaluate(el => { el.style.transition = 'none'; const c = getComputedStyle(el).color; el.style.transition = ''; return c; });
  assert.equal(await tintAfter('70005.00', '70,005'), 'up 1');   // 0.007 %
  const slight = await colour();
  assert.equal(await tintAfter('70030.00', '70,030'), 'up 2');   // 0.036 %
  const ordinary = await colour();
  assert.equal(await tintAfter('70300.00', '70,300'), 'up 3');   // 0.39 %
  const large = await colour();
  assert.equal(new Set([slight, ordinary, large]).size, 3, `three different tints: ${slight} / ${ordinary} / ${large}`);
  // A large move holds its colour longer than the others, then lets go.
  await page.clock.runFor(1000);
  assert.equal(await page.locator('#price-main').getAttribute('data-strength'), '3');
  await page.clock.runFor(600);
  assert.equal(await page.locator('#price-main').getAttribute('data-strength'), null);
  assert.equal(await tintAfter('69000.00', '69,000'), 'down 3');
  await page.evaluate(() => sockets.at(-1).quote());
  // Prices that arrive faster than that are not all drawn: the screen waits
  // out its three seconds and then shows the latest one.
  await page.clock.runFor(3100);
  await page.evaluate(() => sockets.at(-1).quote({ c: '70020.00' }));
  await page.evaluate(() => sockets.at(-1).quote({ c: '70030.00' }));
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,030');
  await page.evaluate(() => sockets.at(-1).quote({ c: '70040.00' }));
  await page.evaluate(() => sockets.at(-1).quote({ c: '70050.00' }));
  assert.equal(await text(page, '#price-main'), '70,030', 'held: less than three seconds since the last change');
  // (Exactly when the three seconds are up is covered by the unit tests.)
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,050', 'then the latest price, skipping the one in between');
  assert.equal(await page.title(), '70,050 | ETHUSDT | Coinboard', 'the tab title keeps pace with the board');
  await page.evaluate(() => sockets.at(-1).quote());
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,000');
  // Malformed prices never reach the board.
  await page.evaluate(() => sockets.at(-1).emit({ c: 'Infinity' }));
  assert.equal(await text(page, '#price-main'), '70,000');

  // A ticker the exchange never answers for.
  await openEditor(page);
  await page.evaluate(() => { suppressTicks = true; });
  await page.locator('#admin-coin').selectOption('__other');
  await page.locator('#admin-symbol').fill('NOPE'); await page.locator('#admin-symbol-apply').click();
  // A coin that is not on the list joins the choice as itself; the field folds away.
  assert.equal(await page.locator('#admin-coin').inputValue(), 'NOPE');
  assert.equal(await page.locator('#admin-coin option').first().textContent(), 'NOPE');
  assert.equal(await page.locator('#admin-symbol').isVisible(), false);
  await page.clock.runFor(40000);
  assert.match(await tip(), /\nCHECK TICKER$/); assert.equal(await level(), 'warn');
  // A coin without an icon simply has none: its ticker is already in the head line.
  assert.equal(await page.locator('#icon').count(), 0);
  assert.equal(await text(page, '#coin'), 'NOPE');
  assert.match(await text(page, '#overlay-msg'), /지원하지 않는 티커일 수 있습니다/);
  // Now there is something to report, so the status lines show.
  assert.equal(await page.locator('#status-indicator').isVisible(), true);
  assert.equal(await page.locator('#overlay-msg').isVisible(), true);
  // Being offline is the more useful thing to say than doubting the ticker.
  await context.setOffline(true);
  await page.waitForFunction(() => /\nOFFLINE/.test(document.getElementById('status-tip').textContent));
  assert.equal(await level(), 'bad');
  await context.setOffline(false);
  await page.evaluate(() => { suppressTicks = false; }); await page.clock.runFor(35000); await live(page);
  assert.equal(await level(), 'ok');
  // An exchange error stops retrying and offers a manual reconnect.
  await page.evaluate(() => sockets.at(-1).onmessage({ data: JSON.stringify({ error: { name: 'INVALID_PARAM' } }) }));
  await page.waitForFunction(() => /\nERROR/.test(document.getElementById('status-tip').textContent));
  assert.equal(await level(), 'bad');
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

  // Everything the board loads comes from its own address; the only calls out
  // are the exchanges' coin lists, asked for when the ticker field is opened.
  const LISTS = ['https://api.upbit.com/v1/market/all', 'https://api.binance.com/api/v3/ticker/price'];
  assert.deepEqual(requests.filter(url => !url.startsWith(base) && !url.startsWith('data:') && !LISTS.includes(url)), []);
  assert.ok(requests.filter(url => LISTS.includes(url)).length <= 8, 'coin lists are asked for a handful of times, not polled');
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS board: rest state, keyboard, wake lock recovery, currency/ticker, immediate settings, delay/suspect/offline/error, automatic update');
}

async function gridBoard(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await scripted(context);
  const page = await context.newPage(); const problems = watch(page);
  await page.clock.install(); await page.goto(base); await live(page);
  const assets = async () => ((await saved(page))?.assets ?? [{ currency: 'KRW', ticker: 'BTC' }]).map(asset => `${asset.ticker}:${asset.currency}`);
  const cellPrices = () => page.locator('.cell .price').allTextContents();
  // The add form opens on 자산 추가 and adds on 추가; it starts on the first listed coin not shown in the market being edited.
  const addAsset = async () => { await page.locator('#asset-add').click(); await page.locator('#asset-new-confirm').click(); };
  const openUrls = () => page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).map(socket => socket.url));
  const priced = count => until(page, n => {
    const prices = [...document.querySelectorAll('.cell .price')];
    return prices.length === n && prices.every(el => el.textContent !== '—');
  }, count);

  // One asset: the single board. Settings list it, with no way to remove the last one.
  await open(page);
  assert.equal(await page.locator('#asset-list .asset-row').count(), 1);
  assert.equal(await page.locator('.asset-remove').count(), 0);
  assert.equal(await page.locator('#grid').count(), 0);
  // The add form: nothing is added until 추가; 취소 leaves things as they were.
  await page.locator('#asset-add').click();
  assert.equal(await chosen(page, '#new-currency'), 'KRW');
  assert.equal(await page.locator('#new-coin').inputValue(), 'ETH');
  assert.deepEqual(await assets(), ['BTC:KRW']);
  await page.locator('#asset-new-cancel').click();
  assert.equal(await page.locator('#asset-new').count(), 0);
  assert.deepEqual(await assets(), ['BTC:KRW']);
  // Choosing in the form, and refusing what is already shown.
  await page.locator('#asset-add').click();
  await page.locator('#new-coin').selectOption('BTC'); await page.locator('#asset-new-confirm').click();
  assert.equal(await text(page, '#asset-new-error'), '이미 표시 중인 자산입니다');
  assert.deepEqual(await assets(), ['BTC:KRW']);
  await page.locator('#asset-new-cancel').click();
  // Adding takes the first listed coin not yet shown, in the same market, and chooses it (folded until tapped).
  assert.equal(await page.locator('#admin-columns').count(), 0, 'no columns to choose for one asset');
  await addAsset();
  assert.deepEqual(await assets(), ['BTC:KRW', 'ETH:KRW']);
  assert.deepEqual(await page.locator('.asset-pick').evaluateAll(els => els.map(el => el.getAttribute('aria-pressed'))), ['false', 'true']);
  assert.equal(await page.locator('#admin-coin').count(), 0, 'no rows left open after adding');
  await page.locator('.asset-pick').nth(1).click();
  assert.equal(await page.locator('#admin-coin').inputValue(), 'ETH');
  assert.equal(await page.locator('#grid').getAttribute('data-count'), '2');
  // Upbit carries both coins on the same connection: the new coin is subscribed
  // on it, with no new connection and so none of Upbit's ten seconds between them.
  await priced(2);
  assert.deepEqual(await openUrls(), ['wss://api.upbit.com/websocket/v1']);
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.url.includes('upbit')).length), 1);
  assert.deepEqual(JSON.parse(await page.evaluate(() => sent.filter(frame => frame !== 'PING').at(-1)))[1].codes, ['KRW-BTC', 'KRW-ETH']);
  assert.deepEqual(await cellPrices(), ['9800만', '500.0만']);
  assert.deepEqual((await page.locator('.cell-head').allTextContents()).map(head => head.trim()), ['BTCKRW', 'ETHKRW']);

  // The rows below edit the chosen asset: here ETH becomes SOL on Binance futures.
  await choose(page, '#admin-currency', 'USDT-PERP');
  await page.locator('#admin-coin').selectOption('SOL');
  assert.deepEqual(await assets(), ['BTC:KRW', 'SOL:USDT-PERP']);
  // Adding again takes the market being edited. The same asset twice is refused, and the choice goes back.
  await addAsset();
  assert.deepEqual(await assets(), ['BTC:KRW', 'SOL:USDT-PERP', 'BTC:USDT-PERP']);
  await page.locator('.asset-pick').nth(2).click();
  await page.locator('#admin-coin').selectOption('SOL');
  assert.equal(await text(page, '#admin-symbol-error'), '이미 표시 중인 자산입니다');
  assert.equal(await page.locator('#admin-coin').inputValue(), 'BTC');
  assert.deepEqual(await assets(), ['BTC:KRW', 'SOL:USDT-PERP', 'BTC:USDT-PERP']);
  // Choosing another row edits that one.
  await page.locator('.asset-pick').nth(1).click();
  assert.equal(await page.locator('#admin-coin').inputValue(), 'SOL');
  assert.equal(await chosen(page, '#admin-currency'), 'USDT-PERP');
  assert.equal(await page.locator('#admin-symbol-error').isVisible(), false);

  // Mixed markets: one connection per market kind, each carrying its coins.
  await page.clock.runFor(11100); await priced(3);
  // The futures connection opened for the coin first chosen there and was
  // changed in place since, so what it carries is read from it, not from its URL.
  assert.deepEqual((await openUrls()).map(url => url.split('/market/')[0]).sort(), ['wss://api.upbit.com/websocket/v1', 'wss://fstream.binance.com']);
  assert.deepEqual(await page.evaluate(() => sockets.find(socket => socket.readyState !== 3 && socket.url.includes('fstream')).markets.slice().sort()), ['BTCUSDT', 'SOLUSDT']);
  assert.deepEqual((await page.locator('.cell-head').allTextContents()).map(head => head.trim()), ['BTCKRW', 'SOLUSDTPERP', 'BTCUSDTPERP']);
  assert.deepEqual(await cellPrices(), ['9800만', '180.3', '70,000']);
  assert.equal(await page.title(), '9800만 | BTCKRW | Coinboard', 'the tab follows the first asset');

  // Order: up and down. Prices stay and nothing reconnects; the chosen asset moves with its row.
  const socketCount = await page.evaluate(() => sockets.length);
  // Dragged by its handle, a card follows the pointer and the others make room; released, the order is saved.
  const handles = page.locator('.asset-handle');
  assert.equal(await handles.count(), 3);
  const grip = await handles.nth(1).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + step * 7);
  await page.mouse.up();
  await until(page, () => JSON.parse(localStorage.getItem('coinboard-settings')).assets.map(asset => asset.ticker + asset.currency).join() === 'BTCKRW,BTCUSDT-PERP,SOLUSDT-PERP');
  assert.deepEqual(await assets(), ['BTC:KRW', 'BTC:USDT-PERP', 'SOL:USDT-PERP']);
  assert.deepEqual(await page.locator('.asset-pick').evaluateAll(els => els.map(el => el.getAttribute('aria-pressed'))), ['false', 'false', 'true']);
  assert.deepEqual((await page.locator('.cell-head').allTextContents()).map(head => head.trim()), ['BTCKRW', 'BTCUSDTPERP', 'SOLUSDTPERP']);
  assert.deepEqual(await cellPrices(), ['9800만', '70,000', '180.3']);
  assert.equal(await page.evaluate(() => sockets.length), socketCount, 'reordering does not reconnect');
  // By keyboard: an arrow key on the handle moves the card by one.
  await handles.nth(2).focus(); await page.keyboard.press('ArrowUp');
  await until(page, () => JSON.parse(localStorage.getItem('coinboard-settings')).assets.map(asset => asset.ticker).join() === 'BTC,SOL,BTC');
  assert.deepEqual(await assets(), ['BTC:KRW', 'SOL:USDT-PERP', 'BTC:USDT-PERP']);
  // Each card shows its asset's live price and change, as on the board.
  assert.deepEqual(await page.locator('.asset-price').allTextContents(), ['9800만', '180.3', '70,000']);
  // Landscape, three: one row; every cell drawn at one size; the grid inside the screen.
  await page.keyboard.press('Escape');
  const cells = () => page.locator('.cell').evaluateAll(els => els.map(el => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width }; }));
  const pieces = () => page.locator('.cell-inner').evaluateAll(els => els.map(el => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom }; }));
  const inScreen = list => list.every(box => box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight);
  let boxes = await cells();
  assert.equal(new Set(boxes.map(box => Math.round(box.y))).size, 1, 'three in a row');
  assert.equal(new Set(boxes.map(box => Math.round(box.width))).size, 1, 'cells of one size');
  assert.ok(await page.evaluate(inScreen, await pieces()));
  // The screen is divided: three cells side by side span its width, with lines only between them.
  assert.ok(Math.abs(boxes.reduce((sum, box) => sum + box.width, 0) - 1024) < 40, 'the cells fill the screen');
  assert.deepEqual(await page.locator('.cell').evaluateAll(els => els.map(el => [el.classList.contains('line-right'), el.classList.contains('line-below')])), [[true, false], [true, false], [false, false]]);
  assert.equal(new Set(await page.locator('.cell .price-text').evaluateAll(els => els.map(el => el.style.transform))).size, 1, 'prices at one size');
  assert.equal(await page.locator('.cell .price[aria-live]').count(), 0, 'cells do not talk over each other');

  // A coin that never answers: its cell is dimmed and the dot says which; the others stay live.
  await page.evaluate(() => window.silentMarkets.push('ETHUSDT'));
  await open(page); await addAsset();
  assert.deepEqual(await assets(), ['BTC:KRW', 'SOL:USDT-PERP', 'BTC:USDT-PERP', 'ETH:USDT-PERP']);
  await page.keyboard.press('Escape');
  // Added to the open futures connection, it is first asked for again on a new
  // one (15 seconds of silence), then flagged after 15 more while the others speak.
  await page.clock.runFor(20000);
  assert.match(await text(page, '#status-tip'), /ETHUSDTPERP · WAITING$/);
  await page.clock.runFor(17000);
  assert.deepEqual(await page.locator('.cell').evaluateAll(els => els.map(el => el.classList.contains('price-unavailable'))), [false, false, false, true]);
  assert.equal(await page.locator('#status-dot').getAttribute('data-level'), 'warn');
  assert.equal(await text(page, '#status-tip'), 'BTCKRW · LIVE\nSOLUSDTPERP · LIVE\nBTCUSDTPERP · LIVE\nETHUSDTPERP · CHECK TICKER');
  // Four: two rows of two.
  boxes = await cells();
  assert.deepEqual(boxes.map(box => Math.round(box.y)).filter((y, i, all) => all.indexOf(y) === i).length, 2);
  await page.screenshot({ path: path.join(evidence, 'grid.png') });

  // Rows are always equal. Six: two rows of three in landscape, three rows of two in portrait.
  const shapeNow = () => [...document.querySelectorAll('.cell')].map(el => el.getBoundingClientRect()).reduce((sets, box) => { sets[0].add(Math.round(box.y)); sets[1].add(Math.round(box.x)); return sets; }, [new Set(), new Set()]).map(set => set.size);
  // The layout follows a resize as soon as the board has measured the screen again.
  const shape = async expected => { try { await until(page, ([want, fn]) => JSON.stringify(eval(fn)()) === JSON.stringify(want), [expected, `(${shapeNow})`]); } catch {} return page.evaluate(shapeNow); };
  await open(page);
  await addAsset(); await addAsset();
  assert.equal((await assets()).length, 6);
  await page.keyboard.press('Escape'); await page.clock.runFor(500);
  assert.deepEqual(await shape([2, 3]), [2, 3], 'rows by columns, landscape');
  await page.setViewportSize({ width: 768, height: 1024 }); await page.clock.runFor(500);
  assert.deepEqual(await shape([3, 2]), [3, 2], 'rows by columns, portrait');
  assert.ok(await page.evaluate(inScreen, await pieces()));
  await page.screenshot({ path: path.join(evidence, 'grid-portrait.png') });
  // Cells per row by hand: five in rows of three is three over two, the short row under the first two columns; one is a single column.
  await open(page);
  await removeAsset(page, page.locator('.asset-pick').last());
  await choose(page, '#admin-columns', '3');
  assert.equal((await saved(page)).columns, 3);
  await page.keyboard.press('Escape');
  // Cells in each row, top to bottom (the board may float a little above the top edge).
  const rowCounts = () => page.evaluate(() => { const rows = new Map(); for (const el of document.querySelectorAll('.cell')) { const y = Math.round(el.getBoundingClientRect().y); rows.set(y, (rows.get(y) || 0) + 1); } return [...rows].sort((a, b) => a[0] - b[0]).map(row => row[1]); });
  await until(page, () => new Set([...document.querySelectorAll('.cell')].map(el => Math.round(el.getBoundingClientRect().y))).size === 2);
  assert.deepEqual(await rowCounts(), [3, 2]);
  const fives = await cells();
  assert.deepEqual([fives[3].x, fives[4].x].map(Math.round), [fives[0].x, fives[1].x].map(Math.round), 'the short row keeps to the columns above');
  assert.deepEqual(await page.locator('.cell').evaluateAll(els => els.map(el => [el.classList.contains('line-right'), el.classList.contains('line-below')])),
    [[true, true], [true, true], [false, true], [true, false], [true, false]], 'lines run straight; the empty place is bounded by its neighbours');
  await open(page); await choose(page, '#admin-columns', '1'); await page.keyboard.press('Escape');
  assert.deepEqual(await shape([5, 1]), [5, 1]);
  await open(page); await choose(page, '#admin-columns', '0'); await addAsset(); await page.keyboard.press('Escape');
  assert.deepEqual(await shape([3, 2]), [3, 2], 'back to the board\'s own choice');
  // No equal split that suits the screen (seven): one line, a column in portrait and a row in landscape.
  await open(page); await addAsset();
  assert.equal((await assets()).length, 7);
  assert.equal(await page.locator('#asset-add').isVisible(), true, 'six is not a limit');
  await page.keyboard.press('Escape'); await page.clock.runFor(500);
  assert.deepEqual(await shape([7, 1]), [7, 1]);
  assert.ok(await page.evaluate(inScreen, await pieces()));
  await page.setViewportSize({ width: 1024, height: 768 }); await page.clock.runFor(500);
  assert.deepEqual(await shape([1, 7]), [1, 7]);
  assert.ok(await page.evaluate(inScreen, await pieces()));

  // Swiping a card to the left uncovers its remove button; a tap on it removes the asset.
  await open(page);
  const countBefore = (await assets()).length;
  const card = await page.locator('.asset-row').last().boundingBox();
  const y = card.y + card.height / 2, startX = card.x + card.width - 90;
  await page.mouse.move(startX, y); await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(startX - step * 15, y);
  await page.mouse.up();
  const uncovered = page.locator('.asset-swipe-remove').last();
  const spot = await uncovered.boundingBox();
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('asset-swipe-remove'), [spot.x + spot.width / 2, spot.y + spot.height / 2]), true, 'the remove button is uncovered');
  // A tap elsewhere in the list closes it again without removing anything; swipe again and remove.
  await page.locator('.asset-pick').first().click();
  await page.waitForTimeout(400); // the card slides back (real time)
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('asset-swipe-remove'), [spot.x + spot.width / 2, spot.y + spot.height / 2]), false, 'covered again');
  assert.equal((await assets()).length, countBefore);
  await page.mouse.move(startX, y); await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(startX - step * 15, y);
  await page.mouse.up(); await page.waitForTimeout(400);
  await uncovered.click();
  assert.equal((await assets()).length, countBefore - 1);
  await page.keyboard.press('Escape');

  // Removing down to one goes back to the single board, which picks up where it was.
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page);
  while (await page.locator('.asset-pick').count() > 1) await removeAsset(page, page.locator('.asset-pick').last());
  assert.deepEqual(await assets(), ['BTC:KRW']);
  assert.equal(await page.locator('#grid').count(), 0);
  await page.keyboard.press('Escape');
  await page.clock.runFor(11100); await live(page);
  assert.equal(await text(page, '#price-main'), '9800만');
  assert.deepEqual(await openUrls(), ['wss://api.upbit.com/websocket/v1']);

  // Settings saved before the grid open as the one asset they named.
  const old = await browser.newContext(); await scripted(old, { seed: false });
  await old.addInitScript(() => { if (!localStorage.getItem('coinboard-settings')) localStorage.setItem('coinboard-settings', JSON.stringify({ ticker: 'ETH', currency: 'USDT', brightness: 60 })); });
  const oldPage = await old.newPage(); await oldPage.goto(base); await live(oldPage);
  assert.equal(await text(oldPage, '#price-source'), 'BINANCE · ETH/USDT');
  await old.close();
  // A new board, nothing saved: Bitcoin on Binance spot.
  const fresh = await browser.newContext(); await scripted(fresh, { seed: false });
  const freshPage = await fresh.newPage(); await freshPage.goto(base); await live(freshPage);
  assert.equal(await text(freshPage, '#price-source'), 'BINANCE · BTC/USDT');
  assert.equal(await text(freshPage, '#price-main'), '70,000');
  assert.deepEqual(await freshPage.evaluate(() => sockets.map(socket => socket.url)), ['wss://stream.binance.com:443/ws/btcusdt@ticker']);
  await fresh.close();

  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS grid: add, edit, reorder by drag handle, swipe to remove, refuse duplicates, mixed markets on one connection each, uniform cells, silent coin, equal rows by orientation, one line for seven, back to one, Binance by default');
}

// The page's own load events (pageshow, visibilitychange) must not cut a
// connection that is still being made: that wastes one of Upbit's requests
// and leaves the board waiting out the next eleven seconds.
async function firstConnection(browser, base) {
  const context = await browser.newContext(); await scripted(context);
  await context.addInitScript(() => { window.holdOpen = true; });
  const page = await context.newPage(); await page.clock.install(); await page.goto(base);
  await page.waitForFunction(() => sockets.length === 1);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => sockets.map(socket => socket.readyState)), [0], 'still connecting, not cut');
  await page.evaluate(() => { window.holdOpen = false; sockets[0].release(); });
  await live(page);
  assert.equal(await page.evaluate(() => sockets.length), 1);
  // Hidden with pagehide and shown again with no pageshow after it (as a
  // device may do when switching apps): the feed comes back on.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.clock.runFor(11100); await live(page);
  assert.equal(await page.evaluate(() => sockets.filter(socket => socket.readyState !== 3).length), 1);
  await context.close();
  console.log('PASS first connection: loading the page does not cut the connection being made; shown again, it reconnects');
}

// A device in English: the settings speak English, nothing Korean is left, and
// won is written in millions. A Korean device keeps 억 and 만.
async function english(browser, base) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1024, height: 768 }, hasTouch: true });
  await scripted(context);
  const page = await context.newPage(); const problems = watch(page);
  await page.goto(base); await live(page);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await text(page, '#price-main'), '98.00M');
  assert.equal(await page.title(), '98.00M | BTCKRW | Coinboard');
  await openEditor(page);
  const hangul = /[가-힣]/;
  // Everything a reader or a screen reader meets in the panel.
  const words = () => page.locator('#admin-panel').evaluate(panel => [panel.innerText,
    ...[...panel.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')),
    ...[...panel.querySelectorAll('[placeholder]')].map(el => el.getAttribute('placeholder')),
    ...[...panel.querySelectorAll('option')].map(el => el.textContent)].join('\n'));
  assert.doesNotMatch(await words(), hangul);
  assert.equal(await text(page, '#admin-title'), 'Settings');
  assert.deepEqual(await page.locator('#admin-currency [data-value]').evaluateAll(els => els.map(el => el.getAttribute('aria-label'))), ['Upbit · KRW', 'Binance · USDT', 'Binance · USDT Perpetual']);
  assert.equal(await page.locator('#settings-toggle').getAttribute('aria-label'), 'Open settings');
  // The add form, the columns row and a refusal, in English too.
  await page.locator('#asset-add').click();
  await choose(page, '#new-currency', 'USDT-PERP');
  await page.locator('#new-coin').selectOption('__other');
  assert.doesNotMatch(await words(), hangul);
  await choose(page, '#new-currency', 'KRW'); await page.locator('#new-coin').selectOption('BTC');
  await page.locator('#asset-new-confirm').click();
  assert.equal(await text(page, '#asset-new-error'), 'This asset is already on the board.');
  await choose(page, '#new-currency', 'USDT-PERP'); await page.locator('#new-coin').selectOption('BTC'); await page.locator('#asset-new-confirm').click();
  assert.equal(await page.locator('#admin-columns').count(), 1);
  assert.doesNotMatch(await words(), hangul);
  // English is longer: every choice is still readable in its row.
  await page.locator('.asset-pick').nth(1).click();
  assert.ok(await page.locator('#admin-coin').evaluate(el => el.scrollWidth <= el.clientWidth + 1), '#admin-coin is not cut off');
  for (const id of ['#admin-currency', '#admin-columns', '#admin-palette']) {
    assert.ok(await page.locator(`${id} [data-value]`).evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1)), `${id} is not cut off`);
  }
  await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
  await page.locator('#admin-panel').screenshot({ path: path.join(evidence, 'settings-en.png') });
  assert.deepEqual(problems, []);
  await context.close();
  // The Korean device, for contrast.
  const korean = await browser.newContext(); await scripted(korean);
  const koPage = await korean.newPage(); await koPage.goto(base); await live(koPage);
  assert.equal(await koPage.evaluate(() => document.documentElement.lang), 'ko');
  assert.equal(await text(koPage, '#price-main'), '9800만');
  await korean.close();
  console.log('PASS english: settings in English with nothing Korean left, nothing cut off, won in millions; Korean keeps 억 and 만');
}

async function help(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true }); await scripted(context);
  const page = await context.newPage(); const problems = watch(page);
  await page.goto(base); await live(page);
  // A new board says once how to reach settings.
  const hint = page.locator('#first-hint');
  await hint.waitFor();
  assert.equal(await hint.textContent(), '화면을 탭하면 설정 버튼이 나타납니다');
  assert.equal(await hint.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  // It takes no tap: the first tap brings up the settings button as ever, and the hint goes for good.
  await tapBoard(page);
  await hint.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('controls-visible')), true);
  await page.reload(); await live(page);
  await page.waitForTimeout(1500);
  assert.equal(await hint.count(), 0);
  // Left untouched, it goes by itself but comes back next time.
  const fresh = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await scripted(fresh);
  await fresh.addInitScript(() => { const later = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => later(fn, ms === 15000 ? 300 : ms, ...rest); });
  const other = await fresh.newPage(); await other.goto(base);
  await other.locator('#first-hint').waitFor({ state: 'detached' });
  assert.equal(await other.evaluate(() => localStorage.getItem('coinboard-hint-seen')), null);
  await fresh.close();

  // Help, from the settings panel and back.
  await open(page);
  await page.locator('#help-open').click();
  assert.equal(await text(page, '#admin-title'), '사용법');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'help-back');
  assert.equal(await page.locator('#help section').count(), 5);
  assert.equal(await page.locator('#asset-list').count(), 0);
  assert.equal(await page.locator('#help-guide').getAttribute('href'), 'https://github.com/2jiho/coinboard/blob/main/docs/guide.ko.md');
  assert.ok(await page.locator('#admin-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'help is not cut off');
  await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
  await page.locator('#admin-panel').screenshot({ path: path.join(evidence, 'help-ko.png') });
  await page.locator('#help-back').click();
  assert.equal(await text(page, '#admin-title'), '설정');
  assert.equal(await page.locator('#asset-list').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'help-open');
  // Escape still closes the panel from help.
  await page.locator('#help-open').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#admin-panel').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();

  // In English, with nothing Korean left.
  const en = await browser.newContext({ locale: 'en-US', viewport: { width: 1024, height: 768 } }); await scripted(en);
  const enPage = await en.newPage(); await enPage.goto(base); await live(enPage);
  assert.equal(await enPage.locator('#first-hint').textContent(), 'Tap the screen for settings');
  await open(enPage); await enPage.locator('#help-open').click();
  assert.equal(await text(enPage, '#admin-title'), 'Help');
  assert.doesNotMatch(await enPage.locator('#admin-panel').evaluate(panel => [panel.innerText, ...[...panel.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label'))].join('\n')), /[가-힣]/);
  assert.equal(await enPage.locator('#help-guide').getAttribute('href'), 'https://github.com/2jiho/coinboard/blob/main/docs/guide.md');
  await en.close();
  console.log('PASS help: a new board says once how to reach settings, without taking the tap; help in settings and back, in Korean and English');
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
  // Nothing can be read, so the board starts on its default: Bitcoin on Binance spot.
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.equal(await text(page, '#price-source'), 'BINANCE · BTC/USDT');
  await openEditor(page);
  await choose(page, '#admin-currency', 'KRW');
  assert.match(await page.locator('[data-sonner-toast]').first().textContent(), /저장하지 못했습니다/);
  await live(page);
  assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-BTC');
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS locked storage: defaults, live price, unsaved change applies for the session');
}

async function statusTipOnTouch(browser, base) {
  // A tablet: touch only, nothing can hover.
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }); await scripted(context);
  const page = await context.newPage(); const problems = watch(page);
  await page.clock.install(); await page.goto(base); await live(page);
  assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'this context cannot hover');
  const shown = () => page.locator('#status-tip').isVisible();
  const dot = await page.locator('#status-dot').boundingBox();
  const tapDot = () => page.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2);
  assert.equal(await shown(), false);
  // A tap opens the detail; it closes by itself after a few seconds.
  // (The test clock also moves with real time, so the checks keep a margin around the four seconds.)
  await tapDot(); assert.equal(await shown(), true);
  await page.clock.runFor(3000); assert.equal(await shown(), true);
  await page.clock.runFor(1200); assert.equal(await shown(), false, 'closes by itself');
  // A second tap closes it at once.
  await tapDot(); assert.equal(await shown(), true);
  await tapDot(); assert.equal(await shown(), false, 'second tap closes');
  // So does a tap anywhere else.
  await tapDot(); assert.equal(await shown(), true);
  await page.touchscreen.tap(600, 200); assert.equal(await shown(), false, 'tap elsewhere closes');
  // And it does not come back on its own.
  await page.clock.runFor(10000); assert.equal(await shown(), false);
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS status detail on touch: tap opens; closes by itself, on a second tap, or on a tap elsewhere');
}

async function coinList(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await scripted(context);
  let asked = 0;
  await context.route('https://api.upbit.com/v1/market/all', route => {
    asked++;
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ market: 'KRW-BTC' }, { market: 'KRW-ETH' }, { market: 'KRW-LINK' }, { market: 'BTC-ETH' }]) });
  });
  const page = await context.newPage(); const problems = watch(page);
  await page.goto(base); await live(page);
  assert.equal(asked, 0, 'the list is not fetched until someone wants to type a ticker');
  // This context has a mouse and no touch.
  // The status detail shows while the mouse is over the dot, not otherwise.
  assert.equal(await page.locator('#status-tip').isVisible(), false);
  await page.locator('#status-dot').hover();
  assert.equal(await page.locator('#status-tip').isVisible(), true);
  await page.mouse.move(500, 300);
  assert.equal(await page.locator('#status-tip').isVisible(), false);
  // With a mouse, hovering is the whole of it: a click does not pin the detail open.
  await page.locator('#status-dot').click();
  await page.mouse.move(500, 300);
  assert.equal(await page.locator('#status-tip').isVisible(), false, 'a mouse click leaves nothing behind');

  await openEditor(page);
  await page.locator('#admin-coin').selectOption('__other');
  // The field completes from the coins the exchange really lists.
  await page.waitForFunction(() => document.querySelectorAll('#ticker-list option').length === 3);
  assert.deepEqual(await page.locator('#ticker-list option').evaluateAll(options => options.map(option => option.value)), ['BTC', 'ETH', 'LINK']);
  assert.equal(await page.locator('#admin-symbol').getAttribute('list'), 'ticker-list');
  // A ticker the exchange does not list is refused at once, with the reason.
  await page.locator('#admin-symbol').fill('nope'); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await text(page, '#admin-symbol-error'), '업비트 원화 시장에 없는 티커입니다');
  assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-BTC');
  // One it does list is applied.
  await page.locator('#admin-symbol').fill('link'); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await text(page, '#price-source'), 'UPBIT · KRW-LINK');
  assert.equal(await page.locator('#admin-coin').inputValue(), 'LINK');
  // Opening the field again does not ask the exchange again.
  await page.locator('#admin-coin').selectOption('__other');
  await page.waitForFunction(() => document.querySelectorAll('#ticker-list option').length === 3);
  assert.equal(asked, 1);
  // The other exchange's list could not be had (blocked here): any ticker is let through, as before.
  await choose(page, '#admin-currency', 'USDT');
  await page.locator('#admin-coin').selectOption('__other');
  await page.locator('#admin-symbol').fill('nope'); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await text(page, '#price-source'), 'BINANCE · NOPE/USDT');
  assert.deepEqual(problems, []);
  await context.close();
  console.log('PASS coin list: completion and checking from the exchange, fetched once on demand, optional when unavailable');
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
    await page.waitForFunction(() => document.getElementById('status-dot').dataset.level === 'bad' && /\nOFFLINE/.test(document.getElementById('status-tip').textContent));
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
    const face = await page.locator('#container').boundingBox();
    assert.ok(face.x >= 0 && face.y >= 0 && face.x + face.width <= s.width && face.y + face.height <= s.height, s.name + ' board on screen');
    // Height is counted from the price line outwards, since that line is what is centred.
    const reach = await page.evaluate(() => { const b = document.getElementById('container').getBoundingClientRect(), p = document.getElementById('price-main').getBoundingClientRect(); const mid = p.top + p.height / 2; return 2 * Math.max(mid - b.top, b.bottom - mid); });
    const fills = Math.max(face.width / (area.width * 0.86), reach / (area.height * 0.62));
    assert.ok(fills > 0.98 && fills < 1.02, s.name + ' board fills the screen: ' + fills);
    // Head, price and change are always stacked, with the price the largest line.
    const box = id => page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, midX: r.left + r.width / 2, midY: r.top + r.height / 2, height: r.height }; }, id);
    const [head, priceLine, foot, icon] = [await box('board-head'), await box('price-main'), await box('board-foot'), await box('icon')];
    assert.ok(head.top < priceLine.top && priceLine.top < foot.top, s.name + ' stacked');
    assert.ok(priceLine.height > head.height * 1.8 && priceLine.height > foot.height * 1.8, s.name + ' price dominates');
    if (s.height > s.width) {
      // Portrait: the icon sits on top and everything is centred.
      assert.ok(icon.top < head.top, s.name + ' icon on top');
      for (const row of [icon, head, foot, await box('price-text')]) assert.ok(Math.abs(row.midX - priceLine.midX) < 2, s.name + ' centred');
      assert.ok(Math.abs(priceLine.midX - (s.left + (s.width - s.left - s.right) / 2)) <= s.width * 0.03 + 2, s.name + ' centred on the screen');
    } else {
      // Landscape: a large icon to the left, level with the price; the text lines share a left edge.
      assert.ok(icon.right < priceLine.left, s.name + ' icon to the left');
      assert.ok(Math.abs(icon.midY - priceLine.midY) < 2, s.name + ' icon level with the price');
      // The icon is as tall as the digits: 152 of the 232 design pixels the price zone is high.
      assert.ok(Math.abs(icon.height / priceLine.height - 152 / 232) < 0.02, s.name + ' icon matches the digits in height');
      assert.ok(Math.abs(head.left - priceLine.left) < 2 && Math.abs(foot.left - priceLine.left) < 2, s.name + ' text left-aligned');
      const digits = await box('price-text');
      assert.ok(Math.abs(digits.left - head.left) < 2, s.name + ' digits start at the same left edge');
    }
    // The price line is at mid-height of the usable screen.
    assert.ok(Math.abs(priceLine.midY - (s.top + (s.height - s.top - s.bottom) / 2)) <= s.height * 0.03 + 2, s.name + ' price at mid-height');
    if (['ipad-portrait', 'ipad-landscape', 'phone'].includes(s.name)) await page.screenshot({ path: path.join(evidence, `board-${s.name}.png`) });
    await tapBoard(page);
    const toggle = await page.locator('#settings-toggle').boundingBox();
    assert.equal(toggle.width, 48); assert.equal(toggle.height, 48);
    assert.equal(toggle.y + toggle.height, s.height - s.bottom - 16, s.name + ' button bottom');
    assert.equal(toggle.x + toggle.width, s.width - s.right - 16, s.name + ' button right');
    await page.locator('#settings-toggle').tap();
    // The worst case for height: every optional button showing.
    await page.evaluate(() => { for (const id of ['wake-lock-retry', 'app-update', 'market-retry']) document.getElementById(id).hidden = false; });
    await page.locator('.asset-pick').first().click();
    await page.locator('#admin-coin').selectOption('__other');
    // Measure the sheet where it comes to rest, not partway through its entrance.
    await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
    const dialog = await page.locator('#admin-panel').boundingBox();
    const inside = box => {
      assert.ok(box.x >= s.left + 15, s.name + ' left'); assert.ok(box.x + box.width <= s.width - s.right - 15, s.name + ' right');
      assert.ok(box.y >= Math.max(48, s.top + 16) - 1, s.name + ' top'); assert.ok(box.y + box.height <= s.height - s.bottom - 15, s.name + ' bottom');
    };
    inside(dialog);
    await page.locator('#admin-repo').scrollIntoViewIfNeeded();
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
    await choose(page, '#admin-currency', currency);
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
// Most scenarios read the Korean settings, so a Korean device is the default;
// the English scenario asks for its own language.
const newContext = browser.newContext.bind(browser);
browser.newContext = (options = {}) => newContext({ locale: 'ko-KR', ...options });
try {
  for (const scenario of [board, english, help, firstConnection, gridBoard, statusTipOnTouch, idleUpdate, lockedStorage, coinList, offlineShell, layouts]) await scenario(browser, base);
  if (process.env.LIVE_NETWORK === '1') await liveExchanges(browser, base);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
