// GET /api/auth/kakao : 카카오 로그인 시작 (로그인 CSRF 방지용 state 쿠키 발급)
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const kakaoClientId = env.KAKAO_CLIENT_ID || env.KAKAO_REST_API_KEY;

  if (!kakaoClientId) {
    console.error('KAKAO_CLIENT_ID 미설정');
    return Response.redirect(`${url.origin}/?login_failed=1`, 302);
  }

  const state = crypto.randomUUID();
  const authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  authUrl.search = new URLSearchParams({
    client_id: kakaoClientId,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    state
  }).toString();

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authUrl.toString(),
      'Set-Cookie': `oauth_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    }
  });
}
