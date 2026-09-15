// ==============================================================================
// '얼마내쏘' Supabase 클라이언트 및 동기화 매니저 (supabaseClient.js)
// ==============================================================================
(function(window) {
  'use strict';

  let client = null;
  let currentUser = null;
  let currentGroup = null;
  let realtimeChannel = null;
  let syncListeners = [];
  let authListeners = [];
  let recordChangeListeners = [];

  // 상태: 'local' (클라우드 미연동), 'disconnected' (미로그인), 'connecting', 'synced', 'error'
  let syncState = 'local';

  function init() {
    const cfg = window.AppConfig.get();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      setSyncState('local');
      return false;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('Supabase SDK가 로드되지 않았습니다.');
      setSyncState('error');
      return false;
    }

    try {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      // 인증 상태 변경 리스너
      client.auth.onAuthStateChange(async (event, session) => {
        currentUser = session ? session.user : null;
        if (currentUser) {
          await loadUserGroup();
          setSyncState('synced');
          setupRealtime();
        } else {
          currentGroup = null;
          teardownRealtime();
          setSyncState('disconnected');
        }
        notifyAuth(currentUser, currentGroup);
      });

      // 초기 세션 검사
      client.auth.getSession().then(async ({ data: { session } }) => {
        currentUser = session ? session.user : null;
        if (currentUser) {
          await loadUserGroup();
          setSyncState('synced');
          setupRealtime();
        } else {
          setSyncState('disconnected');
        }
        notifyAuth(currentUser, currentGroup);
      }).catch(err => {
        console.error('세션 확인 실패:', err);
        setSyncState('error');
      });

      return true;
    } catch (e) {
      console.error('Supabase 초기화 에러:', e);
      setSyncState('error');
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

  // 사용자 소속 그룹 불러오기
  async function loadUserGroup() {
    if (!client || !currentUser) return null;
    try {
      // 1. ledger_members를 통해 내가 속한 그룹 조회
      const { data, error } = await client
        .from('ledger_members')
        .select('group_id, role, ledger_groups(id, name, invite_code, created_by)')
        .eq('user_id', currentUser.id)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // 첫 번째 그룹 (기본 그룹 또는 공유 그룹)
        const g = data[0].ledger_groups;
        currentGroup = {
          id: g.id,
          name: g.name,
          inviteCode: g.invite_code,
          role: data[0].role,
          allGroups: data.map(d => ({ ...d.ledger_groups, role: d.role }))
        };
      } else {
        // 만약 트리거가 아직 안 돌았거나 그룹이 없으면 수동 생성
        currentGroup = await createPersonalGroup();
      }
      return currentGroup;
    } catch (err) {
      console.error('소속 장부 그룹 조회 실패:', err);
      return null;
    }
  }

  // 수동 개인 장부 생성 헬퍼
  async function createPersonalGroup() {
    if (!client || !currentUser) return null;
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const groupName = (currentUser.user_metadata?.full_name || '나') + '의 장부';
      
      const { data: grp, error: grpErr } = await client
        .from('ledger_groups')
        .insert({ name: groupName, invite_code: code, created_by: currentUser.id })
        .select()
        .single();
      
      if (grpErr) throw grpErr;

      await client.from('ledger_members').insert({
        group_id: grp.id,
        user_id: currentUser.id,
        role: 'owner'
      });

      currentGroup = {
        id: grp.id,
        name: grp.name,
        inviteCode: grp.invite_code,
        role: 'owner',
        allGroups: [{ ...grp, role: 'owner' }]
      };
      return currentGroup;
    } catch (e) {
      console.error('그룹 수동 생성 실패:', e);
      return null;
    }
  }

  // 실시간 구독
  function setupRealtime() {
    if (!client || !currentGroup || !window.AppConfig.get().realtimeEnabled) return;
    teardownRealtime();

    try {
      realtimeChannel = client
        .channel(`records-group-${currentGroup.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'records',
          filter: `group_id=eq.${currentGroup.id}`
        }, payload => {
          recordChangeListeners.forEach(fn => fn(payload));
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime 구독 실패:', e);
    }
  }

  function teardownRealtime() {
    if (realtimeChannel && client) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  // 로그인 (카카오 OAuth)
  async function loginWithKakao() {
    if (!client) {
      alert('먼저 설정에서 Supabase URL과 Anon Key를 입력해주세요.');
      return;
    }
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: redirectUrl }
    });
    if (error) {
      console.error('카카오 로그인 실패:', error);
      alert('카카오 로그인에 실패했습니다: ' + error.message);
    }
  }

  // 구글 로그인 대안
  async function loginWithGoogle() {
    if (!client) return;
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl }
    });
    if (error) alert('로그인 실패: ' + error.message);
  }

  // 로그아웃
  async function logout() {
    if (!client) return;
    teardownRealtime();
    await client.auth.signOut();
  }

  // 초대 코드로 부부/가족 공유 장부 연결
  async function joinByInviteCode(code) {
    if (!client || !currentUser) {
      return { success: false, message: '먼저 로그인해주세요.' };
    }
    try {
      const cleanCode = code.trim().toUpperCase();
      const { data, error } = await client.rpc('join_ledger_by_invite_code', {
        code_input: cleanCode
      });
      if (error) throw error;
      if (data && data.success) {
        await loadUserGroup();
        setupRealtime();
        notifyAuth(currentUser, currentGroup);
      }
      return data;
    } catch (err) {
      console.error('초대 코드 참여 실패:', err);
      return { success: false, message: err.message || '참여에 실패했습니다.' };
    }
  }

  // 클라우드 기록 목록 조회
  async function fetchRecords() {
    if (!client || !currentGroup) return null;
    try {
      const { data, error } = await client
        .from('records')
        .select('*')
        .eq('group_id', currentGroup.id)
        .order('date', { ascending: false });

      if (error) throw error;
      return (data || []).map(r => ({
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
      console.error('클라우드 기록 조회 실패:', e);
      return null;
    }
  }

  // 클라우드에 단건 저장 (추가/수정)
  async function saveRecord(rec) {
    if (!client || !currentGroup) return false;
    try {
      const row = {
        id: String(rec.id),
        group_id: currentGroup.id,
        user_id: currentUser ? currentUser.id : null,
        direction: rec.direction,
        name: rec.name,
        relation: rec.relation,
        category: rec.category,
        amount: Number(rec.amount) || 0,
        date: rec.date,
        memo: rec.memo || '',
        updated_at: new Date().toISOString()
      };

      const { error } = await client
        .from('records')
        .upsert(row);

      if (error) throw error;
      return true;
    } catch (e) {
      console.error('클라우드 저장 실패:', e);
      return false;
    }
  }

  // 클라우드 단건 삭제
  async function deleteRecord(recordId) {
    if (!client || !currentGroup) return false;
    try {
      const { error } = await client
        .from('records')
        .delete()
        .eq('id', String(recordId))
        .eq('group_id', currentGroup.id);

      if (error) throw error;
      return true;
    } catch (e) {
      console.error('클라우드 삭제 실패:', e);
      return false;
    }
  }

  // 로컬 기록 전체를 클라우드로 일괄 업로드 (마이그레이션)
  async function syncLocalToCloud(localRecords) {
    if (!client || !currentGroup || !localRecords || localRecords.length === 0) {
      return { success: false, count: 0 };
    }
    try {
      const rows = localRecords.map(r => ({
        id: String(r.id),
        group_id: currentGroup.id,
        user_id: currentUser.id,
        direction: r.direction,
        name: r.name,
        relation: r.relation,
        category: r.category,
        amount: Number(r.amount) || 0,
        date: r.date,
        memo: r.memo || '',
        updated_at: new Date().toISOString()
      }));

      const { error } = await client
        .from('records')
        .upsert(rows);

      if (error) throw error;
      return { success: true, count: rows.length };
    } catch (e) {
      console.error('일괄 동기화 실패:', e);
      return { success: false, message: e.message };
    }
  }

  window.CloudService = {
    init,
    loginWithKakao,
    loginWithGoogle,
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
    onAuthStateChange: fn => authListeners.push(fn),
    onRecordChange: fn => recordChangeListeners.push(fn)
  };
})(window);
