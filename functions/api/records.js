import { getSessionFromRequest, jsonResponse, ensureTables } from './_auth.js';

// GET: 소속 장부의 모든 기록 조회
export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ error: '로그인이 필요합니다.' }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ records: [] });
  }

  try {
    await ensureTables(env.DB);
    // 1. 소속 그룹 찾기
    const member = await env.DB.prepare(`
      SELECT group_id FROM ledger_members WHERE user_id = ? LIMIT 1
    `).bind(session.userId).first();

    if (!member) {
      return jsonResponse({ records: [] });
    }

    // 2. 해당 그룹의 모든 기록 조회
    const { results } = await env.DB.prepare(`
      SELECT id, direction, name, relation, category, amount, date, memo, updated_at
      FROM records
      WHERE group_id = ?
      ORDER BY date DESC, updated_at DESC
    `).bind(member.group_id).all();

    return jsonResponse({ records: results || [] });
  } catch (err) {
    console.error('records GET error:', err);
    return jsonResponse({ error: '기록 조회 중 오류가 발생했습니다.' }, 500);
  }
}

// POST: 기록 단건 추가/수정 또는 배열 일괄 동기화
export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);

  if (!session || !session.userId) {
    return jsonResponse({ error: '로그인이 필요합니다.' }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ success: true, count: 1, note: 'DB 미연결 (로컬 유지)' });
  }

  try {
    await ensureTables(env.DB);
    const body = await request.json();
    const isBatch = Array.isArray(body);
    const items = isBatch ? body : [body];

    // 소속 그룹 찾기
    const member = await env.DB.prepare(`
      SELECT group_id FROM ledger_members WHERE user_id = ? LIMIT 1
    `).bind(session.userId).first();

    if (!member) {
      return jsonResponse({ error: '소속된 장부 그룹이 없습니다.' }, 400);
    }

    const groupId = member.group_id;

    // D1 쿼리 준비 (Upsert with Group IDOR Protection)
    const stmt = env.DB.prepare(`
      INSERT INTO records (id, group_id, user_id, direction, name, relation, category, amount, date, memo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        direction = excluded.direction,
        name = excluded.name,
        relation = excluded.relation,
        category = excluded.category,
        amount = excluded.amount,
        date = excluded.date,
        memo = excluded.memo,
        updated_at = CURRENT_TIMESTAMP
      WHERE records.group_id = excluded.group_id
    `);

    const batch = items.map(it => stmt.bind(
      String(it.id),
      groupId,
      session.userId,
      it.direction || 'give',
      String(it.name || '무명').trim(),
      it.relation || '기타',
      it.category || '기타',
      Number(it.amount) || 0,
      it.date || new Date().toISOString().slice(0, 10),
      it.memo || ''
    ));

    await env.DB.batch(batch);

    return jsonResponse({ success: true, count: items.length });
  } catch (err) {
    console.error('records POST error:', err);
    return jsonResponse({ error: '기록 저장 중 오류가 발생했습니다.' }, 500);
  }
}

// DELETE: 기록 삭제
export async function onRequestDelete(context) {
  const { request, env } = context;
  const session = await getSessionFromRequest(request, env);
  const url = new URL(request.url);
  const recordId = url.searchParams.get('id');

  if (!session || !session.userId) {
    return jsonResponse({ error: '로그인이 필요합니다.' }, 401);
  }

  if (!recordId) {
    return jsonResponse({ error: '삭제할 record id가 필요합니다.' }, 400);
  }

  if (!env.DB) return jsonResponse({ success: true });

  try {
    const member = await env.DB.prepare(`
      SELECT group_id FROM ledger_members WHERE user_id = ? LIMIT 1
    `).bind(session.userId).first();

    if (!member) return jsonResponse({ error: '장부 권한 없음' }, 403);

    await env.DB.prepare(`
      DELETE FROM records WHERE id = ? AND group_id = ?
    `).bind(recordId, member.group_id).run();

    return jsonResponse({ success: true, id: recordId });
  } catch (err) {
    console.error('records DELETE error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}
