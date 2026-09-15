import { createSessionToken, ensureTables, getCookie, timingSafeEqual } from '../_auth.js';

const CLEAR_STATE_COOKIE = 'oauth_state=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

function loginFailed(origin) {
  return new Response(null, {
    status: 302,
    headers: { 'Location': `${origin}/?login_failed=1`, 'Set-Cookie': CLEAR_STATE_COOKIE }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const redirectUri = `${url.origin}/api/auth/callback`;

  const kakaoClientId = env.KAKAO_CLIENT_ID || env.KAKAO_REST_API_KEY;
  const kakaoClientSecret = env.KAKAO_CLIENT_SECRET || '';

  if (!code || !kakaoClientId || !state || !timingSafeEqual(state, getCookie(request, 'oauth_state'))) {
    return loginFailed(url.origin);
  }

  try {
    // 1. 카카오 토큰 교환
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: kakaoClientId,
      redirect_uri: redirectUri,
      code: code
    });
    if (kakaoClientSecret) tokenParams.append('client_secret', kakaoClientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenParams.toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('카카오 토큰 발급 실패: ' + JSON.stringify(tokenData));

    // 2. 카카오 유저 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    if (!userData.id) throw new Error(`카카오 사용자 조회 실패 (${userRes.status})`);
    const kakaoId = String(userData.id);
    const nickname = userData.kakao_account?.profile?.nickname || userData.properties?.nickname || '사용자';
    let avatarUrl = userData.kakao_account?.profile?.profile_image_url
                 || userData.kakao_account?.profile?.thumbnail_image_url
                 || userData.properties?.profile_image
                 || userData.properties?.thumbnail_image
                 || '';
    if (avatarUrl && avatarUrl.startsWith('http://')) {
      avatarUrl = avatarUrl.replace('http://', 'https://');
    }

    let userId = `kakao_${kakaoId}`;

    // 3. D1 DB가 있으면 저장 (테이블 자동 초기화 보장)
    if (env.DB) {
      await ensureTables(env.DB);
      const existingUser = await env.DB.prepare('SELECT id FROM users WHERE kakao_id = ?').bind(kakaoId).first();
      if (existingUser) {
        userId = existingUser.id;
        await env.DB.prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE id = ?').bind(nickname, avatarUrl, userId).run();
      } else {
        userId = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO users (id, kakao_id, nickname, avatar_url) VALUES (?, ?, ?, ?)').bind(userId, kakaoId, nickname, avatarUrl).run();
      }
    }

    // 4. 세션 토큰 생성 및 쿠키 설정 후 메인으로 리다이렉트
    const sessionToken = await createSessionToken({ id: userId, kakao_id: kakaoId, nickname, avatar_url: avatarUrl }, env);

    const headers = new Headers({ 'Location': `${url.origin}/` });
    headers.append('Set-Cookie', `session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
    headers.append('Set-Cookie', CLEAR_STATE_COOKIE);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    // 상세 원인은 서버 로그에만 남기고 사용자에게는 노출하지 않음
    console.error('카카오 로그인 콜백 에러:', err);
    return loginFailed(url.origin);
  }
}
