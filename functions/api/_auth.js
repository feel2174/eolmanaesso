// ==============================================================================
// Cloudflare Pages Functions: 인증 및 JWT 유틸리티 (_auth.js)
// ==============================================================================

const DEFAULT_SECRET = 'howmuch-bongtoo-jwt-secret-key-2026';

function base64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
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

// 쿠키에서 세션 토큰 추출 및 HMAC 검증
export async function getSessionFromRequest(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session_token=([^;]+)/);
  if (!match) return null;
  
  try {
    const raw = decodeURIComponent(match[1]);
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [payloadBase64, providedSig] = parts;
    if (!payloadBase64 || !providedSig) return null;
    
    const secret = (env && env.JWT_SECRET) || DEFAULT_SECRET;
    const expectedSig = await hmacSha256(secret, payloadBase64);
    if (providedSig !== expectedSig) {
      console.warn('세션 토큰 서명 불일치 (위조 시도)');
      return null;
    }
    
    const payloadJson = base64DecodeUnicode(payloadBase64);
    const payload = JSON.parse(payloadJson);
    
    // 만료일 검사 (30일)
    if (payload.exp && Date.now() > payload.exp) return null;
    
    return payload;
  } catch (e) {
    return null;
  }
}

// 세션 토큰 생성 (HMAC-SHA256 암호학적 서명)
export async function createSessionToken(user, env) {
  const payload = {
    userId: user.id,
    kakaoId: user.kakao_id,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30일
  };
  
  const secret = (env && env.JWT_SECRET) || DEFAULT_SECRET;
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
let tablesInitialized = false;
export async function ensureTables(db) {
  if (!db || tablesInitialized) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        kakao_id TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ledger_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '우리 장부',
        invite_code TEXT UNIQUE NOT NULL,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ledger_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS records (
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
      );
    `);
    tablesInitialized = true;
  } catch (e) {
    console.warn('ensureTables warning:', e.message);
  }
}
