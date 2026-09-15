// ==============================================================================
// '얼마내쏘' Cloudflare Pages Functions 클라이언트 (cloudSync.js)
// ==============================================================================
(function(window) {
  'use strict';

  let currentUser = null;
  let currentGroup = null;
  let syncState = 'local'; // 'local' | 'connecting' | 'synced' | 'disconnected'
  let syncListeners = [];
  let authListeners = [];
  let pollTimer = null;

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

  // 실시간 부부 공유 감지를 위한 가벼운 폴링 (30초 간격, 포커스 시 즉시)
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (syncState === 'synced' && document.visibilityState === 'visible') {
        window.dispatchEvent(new CustomEvent('cloud-sync-pull'));
      }
    }, 25000);

    window.addEventListener('focus', () => {
      if (syncState === 'synced') {
        window.dispatchEvent(new CustomEvent('cloud-sync-pull'));
      }
    });
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

  // 클라우드에 단건 저장
  async function saveRecord(rec) {
    if (!currentUser) return false;
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // 클라우드 단건 삭제
  async function deleteRecord(recordId) {
    if (!currentUser) return false;
    try {
      const res = await fetch(`/api/records?id=${encodeURIComponent(recordId)}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // 로컬 기록 전체 일괄 업로드
  async function syncLocalToCloud(localRecords) {
    if (!currentUser || !localRecords || localRecords.length === 0) {
      return { success: false, count: 0 };
    }
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localRecords)
      });
      const data = await res.json();
      return { success: res.ok, count: localRecords.length, ...data };
    } catch (e) {
      return { success: false, message: e.message };
    }
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
    joinByInviteCode,
    fetchRecords,
    saveRecord,
    deleteRecord,
    syncLocalToCloud,
    getUser: () => currentUser,
    getGroup: () => currentGroup,
    getSyncState: () => syncState,
    onSyncStatusChange: fn => syncListeners.push(fn),
    onAuthStateChange: fn => authListeners.push(fn)
  };
})(window);
