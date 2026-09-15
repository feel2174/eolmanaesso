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
