import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// cloudSync.js를 브라우저 대신 최소 가짜 환경에서 실행
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
globalThis.document = { visibilityState: 'visible' };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.CustomEvent = class {};

// 가짜 서버: amount > 0 인 기록만 저장
const server = new Map();
let online = true;
globalThis.fetch = async (url, init = {}) => {
  if (!online) throw new Error('offline');
  const u = new URL(url, 'https://app.test');
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  if (u.pathname === '/api/auth/me') return json({ authenticated: true, user: { id: 'u1' }, group: { id: 'g1', premium: false } });
  if (u.pathname !== '/api/records') throw new Error('unexpected ' + u.pathname);
  if (init.method === 'POST') {
    const items = JSON.parse(init.body);
    const ok = items.filter(r => r.amount > 0);
    const skippedIds = items.filter(r => !(r.amount > 0)).map(r => r.id);
    ok.forEach(r => server.set(r.id, r));
    return json({ success: ok.length > 0, count: ok.length, skipped: skippedIds.length, skippedIds }, ok.length ? 200 : 400);
  }
  if (init.method === 'DELETE') {
    server.delete(u.searchParams.get('id'));
    return json({ success: true });
  }
  return json({ records: [...server.values()] });
};

const win = { addEventListener() {}, dispatchEvent() {}, location: {} };
new Function('window', readFileSync(new URL('../cloudSync.js', import.meta.url), 'utf8').replace(/^﻿/, ''))(win);
const cs = win.CloudService;

const rec = (id, extra = {}) => ({ id, direction: 'give', name: '김민수', relation: '친구', category: '결혼', amount: 50000, date: '2026-01-01', memo: '', ...extra });
const ids = recs => recs.map(r => r.id).sort();

await cs.init();
server.set('a', rec('a'));
server.set('b', rec('b'));
assert.deepStrictEqual(ids(await cs.pull()), ['a', 'b']);

// 1. 다른 기기(배우자)에서 삭제한 기록은 내 기기에서도 사라짐
server.delete('b');
assert.deepStrictEqual(ids(await cs.pull()), ['a']);
console.log('✅ 1. 다른 기기의 삭제가 반영됨');

// 2. 오프라인에서 한 삭제·추가는 대기열에 남았다가 연결되면 반영 (삭제한 기록이 되살아나지 않음)
online = false;
assert.strictEqual((await cs.queueDelete('a')).success, false);
assert.strictEqual((await cs.queueUpsert(rec('c'))).success, false);
assert.strictEqual(await cs.pull(), null, '오프라인이면 null → 로컬 유지');
assert.deepStrictEqual(cs.outboxStats(), { pending: 2, invalid: 0 });
online = true;
assert.deepStrictEqual(ids(await cs.pull()), ['c']);
assert.ok(!server.has('a') && server.has('c'));
assert.deepStrictEqual(cs.outboxStats(), { pending: 0, invalid: 0 });
console.log('✅ 2. 오프라인 변경이 복구 후 반영됨');

// 3. 서버가 거절한 기록은 사라지지 않고 이 기기에만 남음, 수정하면 다시 전송
await cs.queueUpsert(rec('bad', { amount: 0 }));
assert.deepStrictEqual(ids(await cs.pull()), ['bad', 'c']);
assert.deepStrictEqual(cs.outboxStats(), { pending: 0, invalid: 1 });
await cs.queueUpsert(rec('bad', { amount: 10000 }));
assert.ok(server.has('bad'));
assert.deepStrictEqual(cs.outboxStats(), { pending: 0, invalid: 0 });
console.log('✅ 3. 거절된 기록 로컬 보관 · 수정 후 재전송');

console.log('\n🎉 동기화 대기열 테스트 통과');
