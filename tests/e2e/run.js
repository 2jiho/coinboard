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
      // quote(values) makes every following ticker carry those values; quote() goes back to the usual ones.
      quote(values = null) { this.fixed = values; this.emit(); }
      emit(values = {}) {
        if (this.readyState !== 1 || window.suppressTicks) return;
        values = { ...(this.fixed || {}), ...values };
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
  assert.equal(await page.title(), '9800만 | BTC');
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
  // A healthy board has nothing to report: no headings, no status lines, no extra input.
  assert.equal(await page.locator('#admin-panel h3').count(), 0);
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
  await page.evaluate(() => { suppressTicks = true; });
  await page.locator('#admin-currency').selectOption('USDT');
  assert.equal(await text(page, '#price-main'), '—');
  assert.equal(await boardSize(), steadySize, 'no price yet: same size');
  assert.equal(await page.title(), 'BTC | Coinboard');
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
  await page.waitForFunction(() => document.getElementById('admin-panel').getAnimations().every(animation => animation.playState === 'finished'));
  await page.screenshot({ path: path.join(evidence, 'settings.png') });

  // Any other coin: "직접 입력…" opens a field for its ticker.
  // Coin and currency are two one-line choices.
  assert.deepEqual(await page.locator('#admin-coin option').allTextContents(), ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', '직접 입력…']);
  assert.deepEqual(await page.locator('#admin-currency option').allTextContents(), ['원화 · 업비트', 'USDT · 바이낸스']);
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
  assert.equal((await saved(page)).ticker, 'BTC');
  // Enter applies; lower case and stray spaces are tidied.
  await page.locator('#admin-symbol').fill(' eth '); await page.locator('#admin-symbol').press('Enter');
  assert.equal(await page.locator('#admin-symbol-error').isVisible(), false);
  // ETH is on the list, so the choice shows it and the field folds away.
  assert.equal(await page.locator('#admin-coin').inputValue(), 'ETH');
  assert.equal(await page.locator('#admin-symbol').isVisible(), false);
  assert.equal((await saved(page)).ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  assert.equal(await text(page, '#price-source'), 'BINANCE · ETH/USDT');
  // Choosing a listed coin switches to it at once.
  await page.locator('#admin-coin').selectOption('XRP');
  assert.equal(await text(page, '#price-source'), 'BINANCE · XRP/USDT');
  await page.locator('#admin-coin').selectOption('ETH');
  assert.equal((await saved(page)).ticker, 'ETH');
  await page.clock.runFor(3000); await live(page);
  // The coin's own icon ships with the app; no outside server is asked.
  await page.waitForFunction(() => { const icon = document.getElementById('icon'); return icon && icon.complete && icon.naturalWidth > 0; });
  assert.match(await page.locator('#icon').getAttribute('src'), /^\.\/coins\/eth\.svg$/);
  // Text typed but not applied is thrown away when the panel closes.
  await page.locator('#admin-coin').selectOption('__other');
  await page.locator('#admin-symbol').fill('LINK'); await page.locator('#admin-close').click();
  await open(page); assert.equal(await page.locator('#admin-symbol').isVisible(), false);
  assert.equal(await page.locator('#admin-coin').inputValue(), 'ETH');
  // Brightness applies and saves without an apply button.
  await page.locator('#admin-brightness').fill('50');
  assert.equal(await page.locator('#container').evaluate(el => el.style.filter), 'brightness(50%)');
  assert.equal(await text(page, '#brightness-value'), '50%');
  assert.deepEqual(await saved(page), { ticker: 'ETH', currency: 'USDT', brightness: 50, burnIn: true, palette: 'green-red' });
  // Up and down colours: green and red, or the Korean red and blue.
  const colourOf = id => page.locator(id).evaluate(el => getComputedStyle(el).color);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('change')).color === 'rgb(48, 209, 88)');
  await page.locator('#admin-palette').selectOption('red-blue');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('change')).color === 'rgb(255, 69, 58)');
  assert.equal((await saved(page)).palette, 'red-blue');
  await page.locator('#admin-palette').selectOption('green-red');
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
  await open(page); await page.locator('#admin-brightness').fill('100');
  await page.locator('#admin-close').click();
  // Focus stays on the button after closing; a tap elsewhere lets it hide again.
  await tapBoard(page); await page.clock.fastForward(6000);
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);

  // A panel nobody is touching closes itself after two minutes.
  await open(page);
  await page.clock.runFor(110000);
  assert.equal(await page.locator('#admin-panel').isVisible(), true);
  await page.locator('#admin-brightness').focus(); await page.keyboard.press('Shift');
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
  const sizeOf = () => page.locator('#container').evaluate(el => el.style.transform);
  const sizeWhenLive = await sizeOf();
  await page.evaluate(() => { suppressTicks = true; }); await page.clock.fastForward(16000);
  await page.waitForFunction(() => /DELAYED · LAST PRICE/.test(document.getElementById('status-tip').textContent));
  assert.equal(await level(), 'warn');
  assert.equal(await text(page, '#price-main'), '70,000');
  assert.equal(await page.locator('#container').getAttribute('class'), 'price-unavailable');
  assert.equal(await page.locator('#settings-toggle').isVisible(), false);
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
  await page.evaluate(() => { for (const el of document.querySelectorAll('#price-text .digit')) el.dataset.seen = '1'; });
  await page.evaluate(() => sockets.at(-1).quote({ c: '70010.00' }));
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,010');
  assert.deepEqual(await page.locator('#price-text .digit').evaluateAll(els => els.map(el => el.dataset.seen || 'new')), ['1', '1', '1', '1', 'new', '1']);
  assert.match(await page.locator('#price-text .digit').nth(4).getAttribute('class'), /\bup\b/);
  // The new digit pushes the old one out, so it knows which digit it replaces,
  // and each digit sits in a window that hides whatever is pushed past its edge.
  const pushed = () => page.locator('#price-text .digit').evaluateAll(els => els.map(el => el.dataset.old ?? ''));
  assert.deepEqual(await pushed(), ['', '', '', '', '0', '']);
  assert.equal(await page.locator('#price-text .slot').count(), 6);
  assert.equal(await page.locator('#price-text .digit').nth(4).evaluate(el => getComputedStyle(el, '::before').content), '"0"');
  assert.notEqual(await page.locator('#price-text .slot').nth(4).evaluate(el => getComputedStyle(el).clipPath), 'none');
  // The price rose, so the movement is upwards: the new digit rises from below.
  assert.equal(await page.locator('#price-text .digit').nth(4).evaluate(el => getComputedStyle(el).animationName), 'push-up');
  // Only that digit moves. The others carry no direction and are not animating:
  // not now, and not when the price turns round and falls.
  const moving = () => page.locator('#price-text .digit').evaluateAll(els => els.map(el => (/\b(up|down)\b/.exec(el.className) || ['still'])[0] + (el.getAnimations().length ? '*' : '')));
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
  await page.clock.runFor(2000);
  assert.equal(await text(page, '#price-main'), '70,030', 'still held');
  await page.clock.runFor(1100);
  assert.equal(await text(page, '#price-main'), '70,050', 'then the latest price, skipping the one in between');
  assert.equal(await page.title(), '70,050 | ETH', 'the tab title keeps pace with the board');
  await page.evaluate(() => sockets.at(-1).quote());
  await page.clock.runFor(3100);
  assert.equal(await text(page, '#price-main'), '70,000');
  // Malformed prices never reach the board.
  await page.evaluate(() => sockets.at(-1).emit({ c: 'Infinity' }));
  assert.equal(await text(page, '#price-main'), '70,000');

  // A ticker the exchange never answers for.
  await open(page);
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
  assert.equal(await text(page, '#price-main'), '9800만');
  await open(page);
  await page.locator('#admin-currency').selectOption('USDT');
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
  await tapDot(); assert.equal(await shown(), true);
  await page.clock.runFor(3900); assert.equal(await shown(), true);
  await page.clock.runFor(200); assert.equal(await shown(), false, 'closes by itself');
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

  await open(page);
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
  await page.locator('#admin-currency').selectOption('USDT');
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
    await page.locator('#admin-currency').selectOption(currency);
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
  for (const scenario of [board, statusTipOnTouch, idleUpdate, lockedStorage, carriedSettings, coinList, offlineShell, layouts]) await scenario(browser, base);
  if (process.env.LIVE_NETWORK === '1') await liveExchanges(browser, base);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
