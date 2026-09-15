import { createSessionToken } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const redirectUri = `${url.origin}/api/auth/callback`;

  const kakaoClientId = env.KAKAO_CLIENT_ID || env.KAKAO_REST_API_KEY;
  const kakaoClientSecret = env.KAKAO_CLIENT_SECRET || '';

  if (!code || !kakaoClientId) {
    return Response.redirect(`${url.origin}/?login_failed=1`, 302);
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
    const kakaoId = String(userData.id);
    const nickname = userData.kakao_account?.profile?.nickname || '사용자';
    const avatarUrl = userData.kakao_account?.profile?.profile_image_url || '';

    let userId = `kakao_${kakaoId}`;

    // 3. D1 DB가 있으면 저장
    if (env.DB) {
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

    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${url.origin}/`,
        'Set-Cookie': `session_token=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
      }
    });
  } catch (err) {
    console.error('카카오 로그인 콜백 에러:', err);
    return new Response(`로그인 처리 중 오류 발생: ${err.message}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
