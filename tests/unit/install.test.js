import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installOffer, isStandalone } from '../../src/lib/install.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

test('nothing is offered to an app already opened from the home screen', () => {
  assert.equal(installOffer({ standalone: true, userAgent: IPHONE }), null);
  assert.equal(installOffer({ standalone: true, userAgent: ANDROID, canPrompt: true }), null);
});
test('iPhone and iPad (which calls itself a Mac, but has touch) get the steps', () => {
  assert.equal(installOffer({ standalone: false, userAgent: IPHONE, maxTouchPoints: 5 }), 'ios');
  assert.equal(installOffer({ standalone: false, userAgent: IPAD, maxTouchPoints: 5 }), 'ios');
  // A real Mac has no touch: no steps for it.
  assert.equal(installOffer({ standalone: false, userAgent: IPAD, maxTouchPoints: 0 }), null);
});
test('a browser with its own install prompt gets an install button; others get nothing', () => {
  assert.equal(installOffer({ standalone: false, userAgent: ANDROID, canPrompt: true }), 'prompt');
  assert.equal(installOffer({ standalone: false, userAgent: ANDROID, canPrompt: false }), null);
});
test('standalone is read from the display mode or from iOS', () => {
  const media = modes => query => ({ matches: modes.includes(query) });
  assert.equal(isStandalone({ matchMedia: media(['(display-mode: standalone)']), navigator: {} }), true);
  assert.equal(isStandalone({ matchMedia: media(['(display-mode: fullscreen)']), navigator: {} }), true);
  assert.equal(isStandalone({ matchMedia: media([]), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: media([]), navigator: {} }), false);
  assert.equal(isStandalone({ matchMedia: () => { throw new Error('no'); }, navigator: {} }), false);
});
