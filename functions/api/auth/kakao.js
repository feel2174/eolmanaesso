import { createSessionToken } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const kakaoClientId = env.KAKAO_CLIENT_ID || env.KAKAO_REST_API_KEY;

  // 1. 카카오 공식 키가 설정되어 있는 경우 정상 OAuth 리다이렉트
  if (kakaoClientId) {
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${kakaoClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    return Response.redirect(kakaoAuthUrl, 302);
  }

  // 2. 카카오 키 설정 전이어도 즉시 테스트 가능한 데모 카카오 로그인 자동 생성
  const mockUser = {
    id: 'user_kakao_demo',
    kakao_id: 'demo_kakao_12345',
    nickname: '카카오 사용자',
    avatar_url: 'https://k.kakaocdn.net/dn/dpk9l1/btqmGhA2lKL/70EA45abQtKOWflKiUK5K1/img_110x110.jpg'
  };

  // D1 DB가 있으면 유저 생성
  if (env.DB) {
    try {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, kakao_id, nickname, avatar_url)
        VALUES (?, ?, ?, ?)
      `).bind(mockUser.id, mockUser.kakao_id, mockUser.nickname, mockUser.avatar_url).run();
    } catch (e) {
      console.warn('D1 mock user insert error:', e);
    }
  }

  const sessionToken = createSessionToken(mockUser, env);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${url.origin}/`,
      'Set-Cookie': `session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
    }
  });
}
