import { getSessionFromRequest, jsonResponse, ensureTables, generateSecureInviteCode, isGroupPremium } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ authenticated: false });
  }

  const user = { id: session.userId, nickname: session.nickname, avatarUrl: session.avatarUrl };

  // D1 DB가 바인딩되어 있지 않은 경우
  if (!env.DB) {
    return jsonResponse({
      authenticated: true,
      user,
      group: { id: 'local-group', name: '나의 장부', inviteCode: 'OFFLINE', premium: false }
    });
  }

  try {
    // DB 테이블 자동 점검 및 생성
    await ensureTables(env.DB);

    // 탈퇴한 계정의 남은 세션은 로그인 상태로 보지 않음
    const userRow = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(session.userId).first();
    if (!userRow) {
      return jsonResponse({ authenticated: false }, 200, {
        'Set-Cookie': 'session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      });
    }

    // 1. 사용자 소속 그룹 조회
    const memberRow = await env.DB.prepare(`
      SELECT lm.group_id, lm.role, lg.name, lg.invite_code, lg.created_by
      FROM ledger_members lm
      JOIN ledger_groups lg ON lm.group_id = lg.id
      WHERE lm.user_id = ?
      LIMIT 1
    `).bind(session.userId).first();

    let group = null;
    if (memberRow) {
      group = {
        id: memberRow.group_id,
        name: memberRow.name,
        inviteCode: memberRow.invite_code,
        role: memberRow.role,
        premium: await isGroupPremium(env.DB, memberRow.group_id)
      };
    } else {
      // 그룹이 없으면 기본 그룹 자동 생성
      const newGroupId = crypto.randomUUID();
      const inviteCode = generateSecureInviteCode();
      const groupName = `${session.nickname}의 장부`;

      try {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO ledger_groups (id, name, invite_code, created_by)
            VALUES (?, ?, ?, ?)
          `).bind(newGroupId, groupName, inviteCode, session.userId),
          env.DB.prepare(`
            INSERT INTO ledger_members (group_id, user_id, role)
            VALUES (?, ?, 'owner')
          `).bind(newGroupId, session.userId)
        ]);

        group = { id: newGroupId, name: groupName, inviteCode, role: 'owner', premium: false };
      } catch (insertErr) {
        console.warn('Group auto-creation warning:', insertErr.message);
        group = { id: 'default-group', name: groupName, inviteCode: 'MYBONGTOO', role: 'owner', premium: false };
      }
    }

    return jsonResponse({ authenticated: true, user, group });
  } catch (err) {
    console.error('me.js error:', err);
    // 에러 발생 시에도 세션이 유효하면 로그인 상태 유지 (서비스 중단 방지)
    return jsonResponse({
      authenticated: true,
      user,
      group: { id: 'fallback-group', name: '나의 장부', inviteCode: 'CONNECT', premium: false }
    });
  }
}
