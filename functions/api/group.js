import { getSessionFromRequest, jsonResponse } from './_auth.js';

// POST: 초대 코드로 부부/가족 공유 장부 연결
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ success: false, message: '로그인이 필요합니다.' }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, message: '클라우드 DB가 아직 연결되지 않았습니다.' });
  }

  try {
    const { inviteCode } = await request.json();
    const cleanCode = (inviteCode || '').trim().toUpperCase();

    if (!cleanCode) {
      return jsonResponse({ success: false, message: '초대 코드를 입력해주세요.' }, 400);
    }

    // 1. 해당 초대 코드의 그룹 찾기
    const targetGroup = await env.DB.prepare(`
      SELECT id, name, invite_code FROM ledger_groups WHERE UPPER(invite_code) = ?
    `).bind(cleanCode).first();

    if (!targetGroup) {
      return jsonResponse({ success: false, message: '유효하지 않은 초대 코드입니다.' });
    }

    // 2. 이미 속해 있는지 확인
    const isMember = await env.DB.prepare(`
      SELECT 1 FROM ledger_members WHERE group_id = ? AND user_id = ?
    `).bind(targetGroup.id, session.userId).first();

    if (isMember) {
      return jsonResponse({ success: true, message: '이미 연결되어 있는 장부입니다.', group: targetGroup });
    }

    // 3. 기존 개인 그룹의 멤버십을 교체하거나 신규 등록
    await env.DB.prepare(`
      INSERT OR REPLACE INTO ledger_members (group_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', CURRENT_TIMESTAMP)
    `).bind(targetGroup.id, session.userId).run();

    return jsonResponse({
      success: true,
      message: `'${targetGroup.name}'에 연결되었습니다!`,
      group: targetGroup
    });
  } catch (err) {
    console.error('group/join error:', err);
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}
