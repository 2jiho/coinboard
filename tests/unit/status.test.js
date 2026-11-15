import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeState } from '../../src/lib/status.js';
const selection = { currency: 'KRW', quote: 'KRW', ticker: 'BTC', exchange: '업비트' };
const last = { price: 98000000, receivedAt: 1000, selection };
test('no state yet: nothing to say, price shown as unavailable', () => {
  const s = describeState(null, 0); assert.equal(s.text, ''); assert.equal(s.unavailable, true);
});
test('live: connected, no title, no detail', () => {
  const s = describeState({ kind: 'live', reason: '', selection, last }, 2000);
  assert.equal(s.text, '업비트 · 실시간 연결됨'); assert.equal(s.tone, 'connected');
  assert.equal(s.unavailable, false); assert.equal(s.detail, '');
});
test('backoff counts down and keeps the last price in view', () => {
  const s = describeState({ kind: 'backoff', cause: 'stale', reason: '시세 업데이트 지연', retryAt: 9000, selection, last }, 6000);
  assert.equal(s.text, '업비트 · 시세 업데이트 지연 · 재연결 3초 후'); assert.equal(s.tone, 'error');
  assert.equal(s.title, 'DELAYED · LAST PRICE');
  assert.equal(s.detail, '마지막 시세: 9800만 KRW · 5초 전\n시세 업데이트 지연');
});
test('first connection shows no title until something is wrong', () => {
 
  const s = describeState({ kind: 'offline', reason: '네트워크 연결을 확인하세요', selection, last: null }, 0);
  assert.equal(s.title, 'OFFLINE'); assert.match(s.detail, /아직 수신한 시세가 없습니다/);
});
test('exchange error offers a retry', () => {
  const s = describeState({ kind: 'error', reason: '거래소 오류: INVALID_PARAM', selection, last: null }, 0);
  assert.equal(s.title, 'ERROR'); assert.equal(s.canRetry, true);
});
test('a suspect ticker is named while reconnecting, but offline and errors keep their own title', () => {
  const suspect = { reason: '시세 수신 시간 초과', retryAt: 5000, selection, last: null, tickerSuspect: true };
  const s = describeState({ ...suspect, kind: 'backoff' }, 0);
  assert.equal(s.title, 'CHECK TICKER'); assert.match(s.detail, /지원하지 않는 티커일 수 있습니다/);
  assert.equal(describeState({ ...suspect, kind: 'offline' }, 0).title, 'OFFLINE');
  assert.equal(describeState({ ...suspect, kind: 'error' }, 0).title, 'ERROR');
});
test('what the board shows is in English; the settings line stays in Korean', () => {
  const waiting = describeState({ kind: 'paused', reason: '', selection, last }, 2000);
  assert.equal(waiting.title, 'WAITING · LAST PRICE'); assert.equal(waiting.text, '업비트 · 백그라운드 대기');
  for (const kind of ['backoff', 'error', 'offline', 'paused', 'connecting', 'waiting']) {
    const title = describeState({ kind, reason: '시세 수신 시간 초과', retryAt: 1, selection, last, tickerSuspect: true }, 0).title;
    assert.doesNotMatch(title, /[가-힣]/, kind);
  }
});
test('DELAYED is decided by the cause, not by the wording of the reason', () => {
  const state = { kind: 'backoff', retryAt: 9000, selection, last: null };
  assert.equal(describeState({ ...state, cause: 'stale', reason: 'anything at all' }, 0).title, 'DELAYED');
  assert.equal(describeState({ ...state, cause: 'timeout', reason: '시세 업데이트 지연' }, 0).title, 'WAITING');
});
test('level sums the state up as one of three colours', () => {
  const state = { reason: '', retryAt: 1, selection, last: null };
  assert.equal(describeState({ ...state, kind: 'live' }, 0).level, 'ok');
  for (const kind of ['connecting', 'waiting', 'backoff', 'paused']) assert.equal(describeState({ ...state, kind }, 0).level, 'warn', kind);
  for (const kind of ['error', 'offline']) assert.equal(describeState({ ...state, kind }, 0).level, 'bad', kind);
  assert.equal(describeState(null, 0).level, 'warn');
});
test('the board line for a healthy feed is LIVE', () => {
  assert.equal(describeState({ kind: 'live', reason: '', selection, last }, 0).title, 'LIVE');
});
test('a futures price is written as a USDT amount', () => {
  const perp = { currency: 'USDT-PERP', quote: 'USDT', ticker: 'BTC', exchange: '바이낸스 선물' };
  const s = describeState({ kind: 'offline', reason: '', selection: perp, last: { price: 70111.5, receivedAt: 0, selection: perp } }, 4000);
  assert.match(s.detail, /^마지막 시세: 70,112 USDT · 4초 전/); assert.equal(s.text, '바이낸스 선물 · 오프라인');
});
