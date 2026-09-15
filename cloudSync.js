// ==============================================================================
// '얼마내쏘' Cloudflare Pages Functions 클라이언트 (cloudSync.js)
// ==============================================================================
(function(window) {
  'use strict';

  const OUTBOX_KEY = 'gyeongjosa_outbox';

  let currentUser = null;
  let currentGroup = null;
  let syncState = 'local'; // 'local' | 'connecting' | 'synced' | 'disconnected'
  let syncListeners = [];
  let authListeners = [];
  let pollTimer = null;
  let flushing = null;

  async function init() {
    setSyncState('connecting');
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        setSyncState('local');
        notifyAuth(null, null);
        return false;
      }
      const data = await res.json();
      if (data.authenticated) {
        currentUser = data.user;
        currentGroup = data.group;
        setSyncState('synced');
        notifyAuth(currentUser, currentGroup);
        startPolling();
        return true;
      } else {
        currentUser = null;
        currentGroup = null;
        setSyncState('local');
        notifyAuth(null, null);
        return false;
      }
    } catch (e) {
      console.log('클라우드 미연결 또는 로컬 모드 동작:', e.message);
      setSyncState('local');
      notifyAuth(null, null);
      return false;
    }
  }

  function setSyncState(st) {
    syncState = st;
    syncListeners.forEach(fn => fn(syncState));
  }

  function notifyAuth(user, group) {
    authListeners.forEach(fn => fn(user, group));
  }

  // 실시간 부부 공유 감지를 위한 가벼운 폴링 (25초 간격, 포커스·네트워크 복구 시 즉시)
  function startPolling() {
    stopPolling();
    const requestPull = () => {
      if (currentUser && document.visibilityState === 'visible') {
        window.dispatchEvent(new CustomEvent('cloud-sync-pull'));
      }
    };
    pollTimer = setInterval(requestPull, 25000);
    window.addEventListener('focus', requestPull);
    window.addEventListener('online', requestPull);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // 로그인 (카카오)
  function loginWithKakao() {
    window.location.href = '/api/auth/kakao';
  }

  // 로그아웃
  async function logout() {
    stopPolling();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    currentUser = null;
    currentGroup = null;
    setSyncState('local');
    notifyAuth(null, null);
    window.location.reload();
  }

  // 회원 탈퇴 (서버 계정·장부 삭제)
  async function withdraw() {
    if (!currentUser) return false;
    try {
      const res = await fetch('/api/auth/withdraw', { method: 'POST' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // 클라우드 기록 목록 조회
  async function fetchRecords() {
    if (!currentUser) return null;
    try {
      const res = await fetch('/api/records');
      if (!res.ok) return null;
      const data = await res.json();
      return (data.records || []).map(r => ({
        id: String(r.id),
        direction: r.direction,
        name: r.name,
        relation: r.relation,
        category: r.category,
        amount: Number(r.amount),
        date: r.date,
        memo: r.memo || ''
      }));
    } catch (e) {
      return null;
    }
  }

  // ===== 변경 대기열(outbox) =====
  // 로그인 상태의 추가·수정·삭제를 기기에 먼저 기록한 뒤 서버로 보냄.
  // 오프라인이거나 전송에 실패하면 대기열에 남아 다음 동기화 때 다시 보냄.
  // 항목: { op: 'upsert', rec } | { op: 'delete' } | { op: 'invalid', rec } (서버 검증 거절 → 이 기기에만 보관)
  function readOutbox() {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeOutbox(box) {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(box));
  }

  // 전송한 항목을 대기열에서 제거 (전송 중 다시 바뀐 항목은 남김). 거절된 기록은 invalid로 표시.
  function settleSent(sent, rejectedIds = []) {
    const box = readOutbox();
    const rejected = new Set(rejectedIds);
    for (const [id, entry] of sent) {
      if (!box[id] || JSON.stringify(box[id]) !== JSON.stringify(entry)) continue;
      if (rejected.has(id)) box[id] = { op: 'invalid', rec: entry.rec };
      else delete box[id];
    }
    writeOutbox(box);
  }

  function queueUpsert(recs) {
    const box = readOutbox();
    [].concat(recs).forEach(rec => { box[String(rec.id)] = { op: 'upsert', rec }; });
    writeOutbox(box);
    return flush();
  }

  function queueDelete(id) {
    const box = readOutbox();
    box[String(id)] = { op: 'delete' };
    writeOutbox(box);
    return flush();
  }

  function flush() {
    if (!currentUser) return Promise.resolve({ success: false });
    if (!flushing) flushing = sendOutbox().finally(() => { flushing = null; });
    return flushing;
  }

  async function sendOutbox() {
    try {
      for (;;) {
        const pending = Object.entries(readOutbox()).filter(([, e]) => e.op !== 'invalid');
        if (pending.length === 0) break;

        const upserts = pending.filter(([, e]) => e.op === 'upsert').slice(0, 500);
        if (upserts.length) {
          const res = await fetch('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(upserts.map(([, e]) => e.rec))
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok && !(res.status === 400 && data.skippedIds)) throw new Error(`records POST ${res.status}`);
          settleSent(upserts, data.skippedIds);
          continue;
        }

        const [id, entry] = pending[0];
        const res = await fetch(`/api/records?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`records DELETE ${res.status}`);
        settleSent([[id, entry]]);
      }
      setSyncState('synced');
      return { success: true };
    } catch (e) {
      setSyncState('disconnected');
      return { success: false };
    }
  }

  // 대기열을 먼저 보낸 뒤, 서버 기록에 아직 남은 변경을 겹쳐 반환 (다른 기기의 삭제까지 반영).
  // 전송 실패·오프라인이면 null → 호출 측은 로컬 기록을 그대로 유지.
  async function pull() {
    if (!currentUser) return null;
    if (!(await flush()).success) return null;
    const server = await fetchRecords();
    if (!server) return null;
    const map = new Map(server.map(r => [r.id, r]));
    for (const [id, e] of Object.entries(readOutbox())) {
      if (e.op === 'delete') map.delete(id);
      else map.set(id, e.rec);
    }
    return Array.from(map.values());
  }

  function outboxStats() {
    const entries = Object.values(readOutbox());
    const invalid = entries.filter(e => e.op === 'invalid').length;
    return { pending: entries.length - invalid, invalid };
  }

  function clearOutbox() {
    localStorage.removeItem(OUTBOX_KEY);
  }

  // 초대 코드로 부부 공유 장부 합치기
  async function joinByInviteCode(code) {
    if (!currentUser) return { success: false, message: '먼저 로그인해주세요.' };
    try {
      const res = await fetch('/api/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code })
      });
      const data = await res.json();
      if (data.success && data.group) {
        currentGroup = data.group;
        notifyAuth(currentUser, currentGroup);
      }
      return data;
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  window.CloudService = {
    init,
    loginWithKakao,
    logout,
    withdraw,
    joinByInviteCode,
    fetchRecords,
    queueUpsert,
    queueDelete,
    flush,
    pull,
    outboxStats,
    clearOutbox,
    getUser: () => currentUser,
    getGroup: () => currentGroup,
    getSyncState: () => syncState,
    onSyncStatusChange: fn => syncListeners.push(fn),
    onAuthStateChange: fn => authListeners.push(fn)
  };
})(window);
