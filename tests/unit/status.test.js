import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeState } from '../../src/lib/status.js';
const selection = { currency: 'KRW', ticker: 'BTC', exchange: '업비트' };
const last = { price: 98000000, receivedAt: 1000, selection };
test('no state yet: nothing to say, price shown as unavailable', () => {
  const s = describeState(null, 0); assert.equal(s.text, ''); assert.equal(s.titleShown, false); assert.equal(s.unavailable, true);
});
test('live: connected, no title, no detail', () => {
  const s = describeState({ kind: 'live', reason: '', selection, last }, 2000);
  assert.equal(s.text, '업비트 · 실시간 연결됨'); assert.equal(s.tone, 'connected');
  assert.equal(s.unavailable, false); assert.equal(s.titleShown, false); assert.equal(s.detail, '');
});
test('backoff counts down and keeps the last price in view', () => {
  const s = describeState({ kind: 'backoff', reason: '시세 업데이트 지연', retryAt: 9000, selection, last }, 6000);
  assert.equal(s.text, '업비트 · 시세 업데이트 지연 · 재연결 3초 후'); assert.equal(s.tone, 'error');
  assert.equal(s.title, '시세 지연 · 마지막 가격'); assert.equal(s.titleShown, true);
  assert.equal(s.detail, '마지막 시세: ₩98,000,000 · 5초 전\n시세 업데이트 지연');
});
test('first connection shows no title until something is wrong', () => {
  assert.equal(describeState({ kind: 'connecting', reason: '', selection, last: null }, 0).titleShown, false);
  const s = describeState({ kind: 'offline', reason: '네트워크 연결을 확인하세요', selection, last: null }, 0);
  assert.equal(s.titleShown, true); assert.equal(s.title, '오프라인'); assert.match(s.detail, /아직 수신한 시세가 없습니다/);
});
test('exchange error offers a retry', () => {
  const s = describeState({ kind: 'error', reason: '거래소 오류: INVALID_PARAM', selection, last: null }, 0);
  assert.equal(s.title, '시세 오류'); assert.equal(s.canRetry, true);
});
test('a suspect ticker is named while reconnecting, but offline and errors keep their own title', () => {
  const suspect = { reason: '시세 수신 시간 초과', retryAt: 5000, selection, last: null, tickerSuspect: true };
  const s = describeState({ ...suspect, kind: 'backoff' }, 0);
  assert.equal(s.title, '티커 확인 필요'); assert.equal(s.titleShown, true); assert.match(s.detail, /지원하지 않는 티커일 수 있습니다/);
  assert.equal(describeState({ ...suspect, kind: 'offline' }, 0).title, '오프라인');
  assert.equal(describeState({ ...suspect, kind: 'error' }, 0).title, '시세 오류');
});
