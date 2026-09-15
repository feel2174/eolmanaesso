import { getSessionFromRequest, jsonResponse, ensureTables } from '../_auth.js';

// POST /api/auth/withdraw : 회원 탈퇴
// - 계정과 장부 멤버십 삭제
// - 혼자 쓰던 장부는 기록·권한·장부까지 삭제, 다른 가족이 남은 공유 장부의 기록은 유지
// - KAKAO_ADMIN_KEY가 설정되어 있으면 카카오 연결 끊기까지 처리
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ success: false, message: '로그인이 필요합니다.' }, 401);
  }
  if (!env.DB) {
    return jsonResponse({ success: false, message: '클라우드 DB가 연결되지 않았습니다.' }, 503);
  }

  try {
    await ensureTables(env.DB);

    const member = await env.DB.prepare(`
      SELECT group_id FROM ledger_members WHERE user_id = ? LIMIT 1
    `).bind(session.userId).first();

    const stmts = [
      env.DB.prepare(`DELETE FROM ledger_members WHERE user_id = ?`).bind(session.userId),
      env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(session.userId)
    ];

    if (member) {
      const { n } = await env.DB.prepare(`
        SELECT COUNT(*) AS n FROM ledger_members WHERE group_id = ?
      `).bind(member.group_id).first();
      if (n === 1) {
        stmts.push(
          env.DB.prepare(`DELETE FROM records WHERE group_id = ?`).bind(member.group_id),
          env.DB.prepare(`DELETE FROM entitlements WHERE group_id = ?`).bind(member.group_id),
          env.DB.prepare(`DELETE FROM ledger_groups WHERE id = ?`).bind(member.group_id)
        );
      }
    }

    await env.DB.batch(stmts);

    if (env.KAKAO_ADMIN_KEY && session.kakaoId) {
      try {
        const res = await fetch('https://kapi.kakao.com/v1/user/unlink', {
          method: 'POST',
          headers: {
            Authorization: `KakaoAK ${env.KAKAO_ADMIN_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
          },
          body: new URLSearchParams({ target_id_type: 'user_id', target_id: session.kakaoId }).toString()
        });
        if (!res.ok) console.error('카카오 연결 끊기 실패:', res.status);
      } catch (e) {
        console.error('카카오 연결 끊기 에러:', e);
      }
    }

    return jsonResponse({ success: true }, 200, {
      'Set-Cookie': 'session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    });
  } catch (err) {
    console.error('withdraw error:', err);
    return jsonResponse({ success: false, message: '탈퇴 처리 중 오류가 발생했습니다.' }, 500);
  }
}
