export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const kakaoClientId = env.KAKAO_CLIENT_ID || env.KAKAO_REST_API_KEY;

  if (!kakaoClientId) {
    // 카카오 키가 설정되지 않은 경우 데모 로그인 안내
    return new Response(`
      <!DOCTYPE html>
      <html lang="ko">
      <head><meta charset="utf-8"><title>카카오 설정 안내</title></head>
      <body style="font-family:sans-serif;padding:30px;line-height:1.6;max-width:500px;margin:0 auto;text-align:center;">
        <h2>💬 카카오 로그인 안내</h2>
        <p>Cloudflare Pages 환경 변수(Environment Variables)에<br><b>KAKAO_CLIENT_ID</b>가 설정되어 있지 않습니다.</p>
        <p style="background:#f5f5f5;padding:12px;border-radius:10px;font-size:13px;text-align:left;">
          <b>설정 방법:</b><br>
          1. <a href="https://developers.kakao.com" target="_blank">Kakao Developers</a>에서 앱 생성<br>
          2. REST API 키를 Cloudflare Pages 설정의 [Environment Variables]에 <code>KAKAO_CLIENT_ID</code>로 등록<br>
          3. Redirect URI에 <code>${redirectUri}</code> 등록
        </p>
        <button onclick="location.href='/?demo_login=1'" style="background:#FEE500;border:none;padding:12px 24px;border-radius:12px;font-weight:bold;cursor:pointer;margin-top:10px;">
          체험용 데모 계정으로 로그인하기
        </button>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${kakaoClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  return Response.redirect(kakaoAuthUrl, 302);
}
