import { getSessionFromRequest, jsonResponse, ensureTables, isGroupPremium } from './_auth.js';

const INVITE_CODE_RE = /^[23456789A-HJ-NP-Z]{8}$/;

// POST: 초대 코드로 부부/가족 공유 장부 연결 (초대한 장부가 공유 장부 권한을 가진 경우만)
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ success: false, message: '로그인이 필요합니다.' }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, message: '클라우드 DB가 아직 연결되지 않았습니다.' });
  }

  try {
    await ensureTables(env.DB);
    const body = await request.json().catch(() => ({}));
    const cleanCode = String((body && body.inviteCode) || '').trim().toUpperCase();

    if (!INVITE_CODE_RE.test(cleanCode)) {
      return jsonResponse({ success: false, message: '초대 코드 8자리를 확인해주세요.' }, 400);
    }

    // 1. 해당 초대 코드의 그룹 찾기
    const targetGroup = await env.DB.prepare(`
      SELECT id, name, invite_code FROM ledger_groups WHERE invite_code = ?
    `).bind(cleanCode).first();

    if (!targetGroup) {
      return jsonResponse({ success: false, message: '유효하지 않은 초대 코드입니다.' });
    }

    const premium = await isGroupPremium(env.DB, targetGroup.id);
    const group = { id: targetGroup.id, name: targetGroup.name, inviteCode: targetGroup.invite_code, premium };

    // 2. 이미 속해 있는지 확인
    const isMember = await env.DB.prepare(`
      SELECT 1 FROM ledger_members WHERE group_id = ? AND user_id = ?
    `).bind(targetGroup.id, session.userId).first();

    if (isMember) {
      return jsonResponse({ success: true, message: '이미 연결되어 있는 장부입니다.', group });
    }

    // 3. 공유 장부는 유료 기능: 초대한 장부에 권한이 있어야 참여 가능
    if (!premium) {
      return jsonResponse({
        success: false,
        code: 'PREMIUM_REQUIRED',
        message: '초대한 분의 장부가 아직 공유 장부로 전환되지 않았어요.'
      }, 403);
    }

    // 4. 기존 그룹 탈퇴 후 새 그룹 등록 (1인 1활성 장부). 혼자 쓰던 장부의 기록은 함께 옮김.
    const prev = await env.DB.prepare(`
      SELECT group_id FROM ledger_members WHERE user_id = ? LIMIT 1
    `).bind(session.userId).first();

    const stmts = [
      env.DB.prepare(`DELETE FROM ledger_members WHERE user_id = ?`).bind(session.userId),
      env.DB.prepare(`
        INSERT INTO ledger_members (group_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', CURRENT_TIMESTAMP)
      `).bind(targetGroup.id, session.userId)
    ];

    if (prev) {
      const { n } = await env.DB.prepare(`
        SELECT COUNT(*) AS n FROM ledger_members WHERE group_id = ?
      `).bind(prev.group_id).first();
      // 다른 멤버가 남아 있는 장부의 기록은 그 장부에 그대로 둔다
      if (n === 1) {
        stmts.push(env.DB.prepare(`
          UPDATE records SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?
        `).bind(targetGroup.id, prev.group_id));
      }
    }

    // D1 batch는 하나의 트랜잭션으로 실행됨
    await env.DB.batch(stmts);

    return jsonResponse({
      success: true,
      message: `'${targetGroup.name}'에 연결되었습니다!`,
      group
    });
  } catch (err) {
    console.error('group/join error:', err);
    return jsonResponse({ success: false, message: '장부 연결 처리 중 오류가 발생했습니다.' }, 500);
  }
}
