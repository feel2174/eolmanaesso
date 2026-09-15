// ==============================================================================
// Cloudflare Pages Functions: 인증 및 공용 유틸리티 (_auth.js)
// ==============================================================================

function base64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  }
  return mismatch === 0;
}

async function hmacSha256(keyStr, dataStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(dataStr));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// 쿠키에서 세션 토큰 추출 및 HMAC 검증 (JWT_SECRET 미설정 시 모든 세션 거부)
export async function getSessionFromRequest(request, env) {
  const secret = env && env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET 미설정: 세션을 검증할 수 없습니다.');
    return null;
  }
  const raw = getCookie(request, 'session_token');
  if (!raw) return null;

  try {
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [payloadBase64, providedSig] = parts;
    if (!payloadBase64 || !providedSig) return null;

    const expectedSig = await hmacSha256(secret, payloadBase64);
    if (!timingSafeEqual(providedSig, expectedSig)) {
      console.warn('세션 토큰 서명 불일치 (위조 시도)');
      return null;
    }

    const payload = JSON.parse(base64DecodeUnicode(payloadBase64));

    // 만료일 검사 (30일)
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

// 세션 토큰 생성 (HMAC-SHA256 암호학적 서명)
export async function createSessionToken(user, env) {
  const secret = env && env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');

  const payload = {
    userId: user.id,
    kakaoId: user.kakao_id,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30일
  };

  const payloadBase64 = base64EncodeUnicode(JSON.stringify(payload));
  const signature = await hmacSha256(secret, payloadBase64);
  return `${payloadBase64}.${signature}`;
}

// 암호학적으로 안전한 8자리 장부 초대 코드 생성 (CSPRNG)
export function generateSecureInviteCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => chars[b % chars.length]).join('');
}

// 공유 장부(유료) 권한: 장부(그룹) 단위. 결제 연동 전까지는 D1 콘솔에서 직접 부여.
export async function isGroupPremium(db, groupId) {
  if (!db || !groupId) return false;
  const row = await db.prepare(`
    SELECT 1 FROM entitlements
    WHERE group_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).bind(groupId).first();
  return !!row;
}

// 기록 1건 서버 검증. 유효하면 정규화된 객체, 아니면 null.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function validateRecord(it) {
  if (!it || typeof it !== 'object') return null;
  const id = String(it.id ?? '');
  const name = String(it.name ?? '').trim();
  const relation = String(it.relation || '기타').trim();
  const category = String(it.category || '기타').trim();
  const memo = String(it.memo ?? '').trim();
  const amount = Number(it.amount);

  if (!id || id.length > 64) return null;
  if (it.direction !== 'give' && it.direction !== 'receive') return null;
  if (!name || name.length > 50 || relation.length > 20 || category.length > 20 || memo.length > 200) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e12) return null;
  if (typeof it.date !== 'string' || !DATE_RE.test(it.date)) return null;

  return { id, direction: it.direction, name, relation, category, amount, date: it.date, memo };
}

// 응답 헬퍼
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

// D1 데이터베이스 테이블 자동 생성 (Self-healing Schema)
// ponytail: 런타임 CREATE IF NOT EXISTS. 컬럼 변경이 생기면 wrangler d1 migrations로 전환 (Phase 1)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    kakao_id TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '우리 장부',
    invite_code TEXT UNIQUE NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT,
    direction TEXT NOT NULL,
    name TEXT NOT NULL,
    relation TEXT NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    memo TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS entitlements (
    group_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_members_user ON ledger_members(user_id)`
];

let tablesInitialized = false;
export async function ensureTables(db) {
  if (!db || tablesInitialized) return;
  try {
    await db.batch(SCHEMA.map(sql => db.prepare(sql)));
    tablesInitialized = true;
  } catch (e) {
    console.warn('ensureTables warning:', e.message);
  }
}
