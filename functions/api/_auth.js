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

// 쿠키에서 세션 토큰 추출
export function getSessionFromRequest(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session_token=([^;]+)/);
  if (!match) return null;
  
  try {
    const raw = decodeURIComponent(match[1]);
    const [payloadBase64, signature] = raw.split('.');
    if (!payloadBase64) return null;
    
    const payloadJson = base64DecodeUnicode(payloadBase64);
    const payload = JSON.parse(payloadJson);
    
    // 만료일 검사 (30일)
    if (payload.exp && Date.now() > payload.exp) return null;
    
    return payload;
  } catch (e) {
    return null;
  }
}

// 세션 토큰 생성 (Base64 인코딩)
export function createSessionToken(user, env) {
  const payload = {
    userId: user.id,
    kakaoId: user.kakao_id,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30일
  };
  
  const payloadBase64 = base64EncodeUnicode(JSON.stringify(payload));
  // 간단 서명 토큰
  return `${payloadBase64}.signed`;
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
