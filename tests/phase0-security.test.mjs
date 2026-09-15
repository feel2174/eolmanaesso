import assert from 'node:assert';
import { validateRecord, getSessionFromRequest, createSessionToken } from '../functions/api/_auth.js';
import { onRequestGet as kakaoLogin } from '../functions/api/auth/kakao.js';
import { onRequestGet as kakaoCallback } from '../functions/api/auth/callback.js';
import { onRequestPost as postRecords } from '../functions/api/records.js';
import { onRequestPost as joinGroup } from '../functions/api/group.js';

const ENV = { JWT_SECRET: 'test-secret-0123456789abcdef', KAKAO_CLIENT_ID: 'kakao-test' };
const ORIGIN = 'https://app.test';

// 1. JWT_SECRET 없으면 토큰 발급·검증 모두 거부 (하드코딩 대체키 제거)
await assert.rejects(() => createSessionToken({ id: 'u1' }, {}), /JWT_SECRET/);
const token = await createSessionToken({ id: 'u1', kakao_id: 'k1', nickname: '테스트' }, ENV);
const authed = (path, init = {}) => new Request(ORIGIN + path, {
  ...init, headers: { Cookie: `session_token=${encodeURIComponent(token)}`, ...(init.headers || {}) }
});
assert.strictEqual((await getSessionFromRequest(authed('/'), ENV)).userId, 'u1');
assert.strictEqual(await getSessionFromRequest(authed('/'), {}), null, 'JWT_SECRET 미설정 시 세션 거부');
assert.strictEqual(await getSessionFromRequest(authed('/'), { JWT_SECRET: 'other' }), null, '다른 키로 서명된 토큰 거부');
console.log('✅ 1. JWT_SECRET 필수 · 위조 토큰 거부');

// 2. 카카오 로그인: 키 없으면 데모 세션 대신 실패, 있으면 state 쿠키 발급
const noKey = await kakaoLogin({ request: new Request(ORIGIN + '/api/auth/kakao'), env: {} });
assert.match(noKey.headers.get('Location'), /login_failed=1/);
assert.strictEqual(noKey.headers.get('Set-Cookie'), null, '데모 세션 쿠키 발급 금지');
const start = await kakaoLogin({ request: new Request(ORIGIN + '/api/auth/kakao'), env: ENV });
const state = new URL(start.headers.get('Location')).searchParams.get('state');
assert.ok(state && start.headers.get('Set-Cookie').includes(`oauth_state=${state}`));
console.log('✅ 2. 데모 로그인 제거 · OAuth state 발급');

// 3. 콜백: state 불일치면 카카오 호출 없이 실패 (로그인 CSRF 방지)
globalThis.fetch = () => { throw new Error('state 검증 전에 외부 호출 금지'); };
const forged = await kakaoCallback({
  request: new Request(`${ORIGIN}/api/auth/callback?code=c&state=attacker`, { headers: { Cookie: `oauth_state=${state}` } }),
  env: ENV
});
assert.match(forged.headers.get('Location'), /login_failed=1/);
console.log('✅ 3. OAuth state 불일치 거부');

// 4. 기록 검증: 형식 오류 거부
const good = { id: '1', direction: 'give', name: '김민수', relation: '직장', category: '결혼', amount: 100000, date: '2026-05-10', memo: '' };
assert.deepStrictEqual(validateRecord(good), good);
for (const bad of [
  { ...good, direction: 'steal' }, { ...good, amount: -1 }, { ...good, amount: 1.5 },
  { ...good, date: '2024/5/3' }, { ...good, name: '' }, { ...good, memo: 'x'.repeat(201) }, { ...good, id: 'x'.repeat(65) }
]) assert.strictEqual(validateRecord(bad), null, JSON.stringify(bad).slice(0, 60));
console.log('✅ 4. 기록 입력 검증');

// D1 최소 모의 객체: SQL 조각으로 응답 결정
function mockDb(answers) {
  const batches = [];
  const stmt = sql => ({ sql, bind: (...args) => ({ sql, args, first: async () => answers(sql, args) }) });
  return { batches, prepare: stmt, batch: async s => { batches.push(s); return []; } };
}

// 5. 기록 저장: 배치 상한 + 잘못된 항목 건너뜀
const recDb = mockDb(sql => sql.includes('ledger_members') ? { group_id: 'g1' } : null);
const tooMany = await postRecords({ request: authed('/api/records', { method: 'POST', body: JSON.stringify(Array(501).fill(good)) }), env: { ...ENV, DB: recDb } });
assert.strictEqual(tooMany.status, 400);
const mixed = await postRecords({ request: authed('/api/records', { method: 'POST', body: JSON.stringify([good, { ...good, id: '2', amount: 'abc' }]) }), env: { ...ENV, DB: recDb } });
assert.deepStrictEqual(await mixed.json(), { success: true, count: 1, skipped: 1 });
console.log('✅ 5. 배치 500건 상한 · 잘못된 항목 건너뜀');

// 6. 공유 장부 참여: 권한 없는 장부는 서버에서 차단 (유료 기능)
const joinBody = { method: 'POST', body: JSON.stringify({ inviteCode: 'ABCD2345' }) };
const target = { id: 'g2', name: '부부 장부', invite_code: 'ABCD2345' };
const freeDb = mockDb(sql => sql.includes('FROM ledger_groups') ? target : null);
const blocked = await joinGroup({ request: authed('/api/group', joinBody), env: { ...ENV, DB: freeDb } });
assert.strictEqual(blocked.status, 403);
assert.strictEqual((await blocked.json()).code, 'PREMIUM_REQUIRED');

const paidDb = mockDb(sql =>
  sql.includes('FROM ledger_groups') ? target :
  sql.includes('FROM entitlements') ? { 1: 1 } :
  sql.includes('user_id = ? LIMIT 1') ? { group_id: 'g1' } :
  sql.includes('COUNT(*)') ? { n: 1 } : null);
const joined = await joinGroup({ request: authed('/api/group', joinBody), env: { ...ENV, DB: paidDb } });
const joinedJson = await joined.json();
assert.strictEqual(joinedJson.success, true);
assert.strictEqual(joinedJson.group.inviteCode, 'ABCD2345', '클라이언트가 쓰는 camelCase 형태로 반환');
const joinBatch = paidDb.batches.at(-1).map(s => s.sql);
assert.ok(joinBatch.some(sql => sql.includes('UPDATE records SET group_id')), '혼자 쓰던 장부 기록은 새 장부로 이동');
console.log('✅ 6. 무료 장부 참여 차단 · 권한 장부 참여 시 기록 이동');

console.log('\n🎉 Phase 0 보안 테스트 통과');
