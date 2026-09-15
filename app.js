// ==============================================================================
// '얼마내쏘' 앱 로직 (app.js): CSP script-src 'self' 적용을 위해 index.html 인라인 스크립트에서 분리
// ==============================================================================

// 레거시 Supabase 설정 및 클라이언트 권한 플래그 정리 (구 캐시는 sw.js activate에서 정리)
try {
  ['gyeongjosa_config', 'supabase.auth.token', 'supabase_config', 'is_premium'].forEach(k => localStorage.removeItem(k));
} catch (e) {}

(function(){
  'use strict';

  const STORAGE_KEY = 'gyeongjosa_records';
  const RELATIONS = ['직장','친구','친척','기타'];
  const CATEGORIES = ['결혼','돌·백일','장례','출산','개업','기타'];

  // 연도별 소비자물가지수(CPI, 2020=100 기준, 근사값). 매년 갱신 권장.
  const CPI = {
    2005:74.4, 2006:76.0, 2007:77.9, 2008:81.6, 2009:83.9,
    2010:86.4, 2011:89.8, 2012:91.8, 2013:93.0, 2014:94.2,
    2015:94.9, 2016:95.8, 2017:97.7, 2018:99.1, 2019:99.5,
    2020:100.0, 2021:102.5, 2022:107.7, 2023:111.6, 2024:114.2,
    2025:116.5, 2026:118.8
  };
  const CPI_YEARS = Object.keys(CPI).map(Number).sort((a,b)=>a-b);
  const CPI_MIN = CPI_YEARS[0];
  const CPI_MAX = CPI_YEARS[CPI_YEARS.length-1];
  function cpiFor(y){
    const yy = Math.max(CPI_MIN, Math.min(CPI_MAX, y));
    return CPI[yy];
  }
  function curCpiYear(){ return Math.min(new Date().getFullYear(), CPI_MAX); }
  // 원금(amount)을 기록연도(year) 기준에서 올해 가치로 환산 → 가까운 만원으로 반올림
  function recommend(amount, year){
    const cur = curCpiYear();
    if(!year || year >= cur) return null;         // 올해/미래 기록은 추천 안 함
    const base = cpiFor(year), now = cpiFor(cur);
    if(!base || !now) return null;
    const raw = amount * now / base;
    const rounded = Math.round(raw/10000)*10000;  // 만원 단위 반올림
    if(rounded <= 0) return null;
    return { rounded, raw, curYear: cur };
  }

  // ===== 상태 =====
  let records = load();
  let activeFilter = '전체';
  let searchTerm = '';
  let editingId = null;         // null이면 추가, 값 있으면 수정
  let form = { direction:'give', name:'', relation:'', category:'', amount:0, date:'', memo:'' };
  let pendingConfirm = null;    // 확인 다이얼로그에서 [확인] 시 실행할 동작

  // ===== 유틸 =====
  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(r => ({ ...r, date: normalizeDate(r.date) })) : [];
    }catch(e){ return []; }
  }
  // 2024/5/3, 2024.05.03 → 2024-05-03 (해석할 수 없으면 원본 유지)
  function normalizeDate(s){
    const m = String(s||'').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : s;
  }
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
  function comma(n){
    return (n||0).toLocaleString('ko-KR');
  }
  function todayStr(){
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off*60000).toISOString().slice(0,10);
  }
  function fmtDate(s){
    if(!s) return '';
    const [y,m,d] = s.split('-');
    return `${y}.${m}.${d}`;
  }
  function esc(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(()=>t.classList.remove('show'), 1800);
  }
  // 클립보드 복사 (권한 거부·미지원 브라우저는 선택 복사로 대체)
  function copyText(text, okMsg){
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try{ ok = document.execCommand('copy'); }catch(e){}
      ta.remove();
      toast(ok ? okMsg : '복사하지 못했어요. 길게 눌러 직접 복사해주세요');
    };
    if(navigator.clipboard && window.isSecureContext){
      navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback);
    }else{
      fallback();
    }
  }

  // ===== 목록 렌더 =====
  const listEl = document.getElementById('list');
  const summaryEl = document.getElementById('summary');

  function filteredRecords(){
    let list = records.slice();
    if(searchTerm){
      const q = searchTerm.toLowerCase();
      list = list.filter(r => (r.name||'').toLowerCase().includes(q));
    }
    if(activeFilter !== '전체'){
      list = list.filter(r => r.category === activeFilter);
    }
    // 최신순: 날짜 desc, 같으면 id desc
    list.sort((a,b)=>{
      if(a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (Number(b.id) || 0) - (Number(a.id) || 0); // UUID id는 0 → 기존 순서 유지
    });
    return list;
  }

  function renderSummary(){
    if(!searchTerm){ summaryEl.classList.remove('show'); return; }
    // 검색어에 해당하는 인물의 기록으로 요약 (필터칩 무시하고 사람 기준)
    const q = searchTerm.toLowerCase();
    const personRecs = records.filter(r => (r.name||'').toLowerCase().includes(q));
    let recv = 0, give = 0;
    personRecs.forEach(r=>{
      if(r.direction === 'receive') recv += r.amount;
      else give += r.amount;
    });
    const diff = recv - give; // 받은 - 낸
    document.getElementById('sumReceive').textContent = comma(recv);
    document.getElementById('sumGive').textContent = comma(give);
    const diffEl = document.getElementById('sumDiff');
    diffEl.textContent = (diff>0?'+':'') + comma(diff);
    diffEl.className = 'val ' + (diff>0?'diff-pos':(diff<0?'diff-neg':''));

    const msg = document.getElementById('sumMsg');
    if(personRecs.length === 0){
      msg.textContent = '기록이 없어요';
      msg.className = 'summary-msg';
    } else if(diff < 0){
      // 받은 - 낸 < 0 → 내가 더 냈음
      msg.textContent = '내가 더 냈어요';
      msg.className = 'summary-msg pos';
    } else if(diff > 0){
      // 받은 게 더 많음 → 아직 갚을 게 남음
      msg.textContent = '아직 갚을 게 남았어요';
      msg.className = 'summary-msg neg';
    } else {
      msg.textContent = '딱 맞게 주고받았어요';
      msg.className = 'summary-msg';
    }
    summaryEl.classList.add('show');
  }

  function cardHTML(r){
    const dirClass = r.direction === 'receive' ? 'receive' : 'give';
    const sign = r.direction === 'receive' ? '+' : '-';
    const memoHTML = r.memo ? `<span class="dot">·</span><span>${esc(r.memo)}</span>` : '';
    return `
      <div class="rec-card" data-id="${esc(r.id)}">
        <div class="rec-main">
          <div class="rec-top">
            <span class="rec-name">${esc(r.name||'무명')}</span>
            ${r.relation ? `<span class="badge">${esc(r.relation)}</span>` : ''}
          </div>
          <div class="rec-sub">
            <span>${esc(r.category||'기타')}</span>
            <span class="dot">·</span>
            <span>${fmtDate(r.date)}</span>
            ${memoHTML}
          </div>
        </div>
        <div class="rec-right">
          <span class="rec-amount ${dirClass}">${sign}${comma(r.amount)}</span>
          <button class="del-btn" data-del="${esc(r.id)}" aria-label="삭제">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`;
  }

  function renderEmpty(){
    listEl.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📖</div>
        <h2>아직 기록이 없어요</h2>
        <p>주고받은 경조사비를 기록해두면<br>다음에 챙길 때 헷갈리지 않아요.</p>
        <div class="empty-label">이렇게 기록돼요</div>
        <div class="rec-card">
          <div class="rec-main">
            <div class="rec-top"><span class="rec-name">신비한고양이</span><span class="badge">친구</span></div>
            <div class="rec-sub"><span>결혼</span><span class="dot">·</span><span>2026.05.10</span></div>
          </div>
          <div class="rec-right"><span class="rec-amount give">-100,000</span></div>
        </div>
        <div class="rec-card">
          <div class="rec-main">
            <div class="rec-top"><span class="rec-name">노랑이</span><span class="badge">직장</span></div>
            <div class="rec-sub"><span>돌·백일</span><span class="dot">·</span><span>2026.04.02</span></div>
          </div>
          <div class="rec-right"><span class="rec-amount receive">+50,000</span></div>
        </div>
        <button class="empty-cta" id="emptyCta"><span>+ 기록 추가</span></button>
      </div>`;
    document.getElementById('emptyCta').addEventListener('click', openAdd);
  }

  function render(){
    updatePremiumUI();
    renderFilterChips();
    if(records.length === 0){
      summaryEl.classList.remove('show');
      renderEmpty();
      return;
    }
    renderSummary();
    const list = filteredRecords();
    if(list.length === 0){
      listEl.innerHTML = `<div class="no-result">${searchTerm ? '검색 결과가 없어요' : '해당 종류의 기록이 없어요'}</div>`;
      return;
    }
    listEl.innerHTML = list.map(cardHTML).join('');
  }

  // 필터 칩
  const filterChipsEl = document.getElementById('filterChips');
  function renderFilterChips(){
    const items = ['전체', ...CATEGORIES];
    filterChipsEl.innerHTML = items.map(c =>
      `<button class="chip ${c===activeFilter?'active':''}" data-filter="${esc(c)}">${esc(c)}</button>`
    ).join('');
  }

  // ===== 이벤트: 목록 영역 =====
  filterChipsEl.addEventListener('click', e=>{
    const chip = e.target.closest('[data-filter]');
    if(!chip) return;
    activeFilter = chip.dataset.filter;
    render();
  });

  listEl.addEventListener('click', e=>{
    const del = e.target.closest('[data-del]');
    if(del){
      e.stopPropagation();
      const delId = del.dataset.del;
      const rec = records.find(r=>r.id===delId);
      askConfirm('삭제할까요?', rec ? `${rec.name||'이'} 님의 기록(${comma(rec.amount)}원)을 삭제합니다.` : '이 기록을 삭제합니다.', '삭제', () => {
        records = records.filter(r=>r.id!==delId);
        save(); render(); toast('삭제했어요');
        if(window.CloudService && window.CloudService.getUser()) window.CloudService.queueDelete(delId);
      });
      return;
    }
    const card = e.target.closest('.rec-card[data-id]');
    if(card){ openEdit(card.dataset.id); }
  });

  // ===== 검색 =====
  const searchEl = document.getElementById('search');
  const searchClear = document.getElementById('searchClear');
  searchEl.addEventListener('input', ()=>{
    searchTerm = searchEl.value.trim();
    searchClear.classList.toggle('show', searchEl.value.length>0);
    render();
  });
  searchClear.addEventListener('click', ()=>{
    searchEl.value=''; searchTerm=''; searchClear.classList.remove('show'); render(); searchEl.focus();
  });

  // ===== 확인 다이얼로그 (삭제·탈퇴 공용) =====
  function askConfirm(title, msg, okText, onOk){
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmOk').textContent = okText;
    pendingConfirm = onOk;
    document.getElementById('confirmScrim').classList.add('show');
  }
  document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
  document.getElementById('confirmScrim').addEventListener('click', e=>{
    if(e.target.id==='confirmScrim') closeConfirm();
  });
  document.getElementById('confirmOk').addEventListener('click', ()=>{
    const onOk = pendingConfirm;
    closeConfirm();
    if(onOk) onOk();
  });
  function closeConfirm(){
    pendingConfirm=null;
    document.getElementById('confirmScrim').classList.remove('show');
  }

  // ===== 드롭다운 메뉴 =====
  const dropdown = document.getElementById('dropdown');
  document.getElementById('menuBtn').addEventListener('click', e=>{
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });
  document.addEventListener('click', e=>{
    if(!dropdown.contains(e.target) && e.target.id!=='menuBtn'){
      dropdown.classList.remove('show');
    }
  });

  // ===== 입력 시트 =====
  const scrim = document.getElementById('scrim');
  const sheet = document.getElementById('sheet');
  const relGroup = document.getElementById('relGroup');
  const catGroup = document.getElementById('catGroup');
  const fName = document.getElementById('fName');
  const fAmount = document.getElementById('fAmount');
  const fDate = document.getElementById('fDate');
  const fMemo = document.getElementById('fMemo');
  const acList = document.getElementById('acList');
  const recoBox = document.getElementById('recoBox');
  let pendingReco = null;

  // 물가 반영 추천 박스 렌더
  // - 수정 시트: 이 기록 기준 → 같은 사람의 새 기록으로 추가
  // - 추가 시트: 같은 이름의 지난 기록(받은 기록 우선) 기준 → 금액만 채움
  function showReco(r){
    const year = Number((r.date||'').slice(0,4));
    const rec = recommend(r.amount, year);
    if(!rec){ hideReco(); return; }
    const rawMan = (rec.raw/10000).toFixed(1).replace(/\.0$/,'');
    const roundMan = rec.rounded/10000;
    const verb = r.direction === 'receive' ? '받은' : '낸';
    recoBox.innerHTML =
      `<div class="reco-head"><span>💡 ${rec.curYear}년 물가 기준 추천</span>`+
      `<span class="reco-amt">${roundMan}만원</span></div>`+
      `<div class="reco-sub">${year}년 ${verb} ${comma(r.amount)}원 → 현재 가치 약 ${rawMan}만원 · 만원 단위 반올림</div>`+
      `<button class="reco-add" type="button">${editingId ? '＋ 이 금액으로 새 기록 추가' : '이 금액 적용'}</button>`;
    recoBox.style.display='block';
    pendingReco = { name:r.name, relation:r.relation, amount:rec.rounded };
  }
  function hideReco(){
    recoBox.style.display='none';
    pendingReco = null;
  }
  // 추가 시트에서 아는 이름을 입력하면 그 사람과의 지난 기록으로 추천
  function updateAddReco(){
    if(editingId) return;
    const name = form.name.trim();
    const past = name ? records.filter(r => r.name === name).sort((a,b) => a.date < b.date ? 1 : -1) : [];
    const base = past.find(r => r.direction === 'receive') || past[0];
    if(base) showReco(base); else hideReco();
  }
  recoBox.addEventListener('click', e=>{
    if(!e.target.closest('.reco-add')) return;
    const p = pendingReco;
    if(!p) return;
    if(editingId){
      // 같은 사람·관계 + 추천액으로 새 기록 작성 (오늘 날짜, '냈어요')
      editingId = null;
      form = { direction:'give', name:p.name||'', relation:p.relation||'', category:'', amount:p.amount, date:todayStr(), memo:'' };
      document.getElementById('sheetTitle').textContent = '기록 추가';
      document.getElementById('saveBtn').textContent = '저장하기';
      toast('추천 금액을 채웠어요 · 행사 종류를 골라주세요');
    }else{
      form = { ...form, direction:'give', relation: form.relation || p.relation || '', amount:p.amount };
      toast('추천 금액을 채웠어요');
    }
    hideReco();
    syncForm();
    sheet.scrollTop = 0;
  });

  // 칩 그룹 생성
  relGroup.innerHTML = RELATIONS.map(r=>`<button class="sel-chip" data-rel="${esc(r)}">${esc(r)}</button>`).join('');
  catGroup.innerHTML = CATEGORIES.map(c=>`<button class="sel-chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');

  function syncForm(){
    // 방향
    document.querySelectorAll('.dir-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.dir===form.direction);
    });
    // 관계
    relGroup.querySelectorAll('.sel-chip').forEach(b=>{
      b.classList.toggle('active', b.dataset.rel===form.relation);
    });
    // 카테고리
    catGroup.querySelectorAll('.sel-chip').forEach(b=>{
      b.classList.toggle('active', b.dataset.cat===form.category);
    });
    fName.value = form.name;
    fAmount.value = form.amount ? comma(form.amount) : '';
    fDate.value = form.date;
    fMemo.value = form.memo;
    validate();
  }

  function openAdd(){
    editingId = null;
    form = { direction:'give', name:'', relation:'', category:'', amount:0, date:todayStr(), memo:'' };
    document.getElementById('sheetTitle').textContent = '기록 추가';
    document.getElementById('saveBtn').textContent = '저장하기';
    recoBox.style.display='none';
    pendingReco = null;
    syncForm();
    openSheet();
  }
  function openEdit(id){
    const r = records.find(x=>x.id===id);
    if(!r) return;
    editingId = id;
    form = {
      direction:r.direction, name:r.name, relation:r.relation,
      category:r.category, amount:r.amount, date:r.date, memo:r.memo||''
    };
    document.getElementById('sheetTitle').textContent = '기록 수정';
    document.getElementById('saveBtn').textContent = '수정 완료';
    syncForm();
    showReco(r);
    openSheet();
  }
  function openSheet(){
    scrim.classList.add('show');
    sheet.classList.add('show');
    document.body.style.overflow='hidden';
  }
  function closeSheet(){
    scrim.classList.remove('show');
    sheet.classList.remove('show');
    acList.classList.remove('show');
    document.body.style.overflow='';
  }

  document.getElementById('fab').addEventListener('click', openAdd);
  document.getElementById('sheetClose').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);

  // 방향 토글
  document.querySelector('.dir-toggle').addEventListener('click', e=>{
    const b = e.target.closest('[data-dir]');
    if(!b) return;
    form.direction = b.dataset.dir;
    syncForm();
  });
  // 관계
  relGroup.addEventListener('click', e=>{
    const b = e.target.closest('[data-rel]');
    if(!b) return;
    form.relation = form.relation===b.dataset.rel ? '' : b.dataset.rel;
    syncForm();
  });
  // 카테고리
  catGroup.addEventListener('click', e=>{
    const b = e.target.closest('[data-cat]');
    if(!b) return;
    form.category = form.category===b.dataset.cat ? '' : b.dataset.cat;
    syncForm();
  });

  // 이름 + 자동완성
  fName.addEventListener('input', ()=>{
    form.name = fName.value;
    renderAutocomplete();
    updateAddReco();
    validate();
  });
  fName.addEventListener('focus', renderAutocomplete);
  fName.addEventListener('blur', ()=> setTimeout(()=>acList.classList.remove('show'), 150));
  function renderAutocomplete(){
    const q = fName.value.trim().toLowerCase();
    const names = [...new Set(records.map(r=>r.name).filter(Boolean))];
    const matches = names.filter(n => n.toLowerCase().includes(q) && n.toLowerCase()!==q).slice(0,5);
    if(q==='' || matches.length===0){ acList.classList.remove('show'); acList.innerHTML=''; return; }
    acList.innerHTML = matches.map(n=>`<div class="ac-item" data-name="${esc(n)}">${esc(n)}</div>`).join('');
    acList.classList.add('show');
  }
  acList.addEventListener('mousedown', e=>{
    const it = e.target.closest('[data-name]');
    if(!it) return;
    form.name = it.dataset.name;
    fName.value = form.name;
    acList.classList.remove('show');
    updateAddReco();
    validate();
  });

  // 금액: 천단위 콤마
  fAmount.addEventListener('input', ()=>{
    const digits = fAmount.value.replace(/[^\d]/g,'').slice(0,12);
    form.amount = digits ? parseInt(digits,10) : 0;
    fAmount.value = digits ? comma(form.amount) : '';
    validate();
  });
  // 빠른 금액
  document.querySelector('.quick-amt').addEventListener('click', e=>{
    const b = e.target.closest('[data-amt]');
    if(!b) return;
    form.amount = parseInt(b.dataset.amt,10);
    fAmount.value = comma(form.amount);
    validate();
  });
  // 날짜, 메모
  fDate.addEventListener('input', ()=>{ form.date = fDate.value; validate(); });
  fMemo.addEventListener('input', ()=>{ form.memo = fMemo.value; });

  // 유효성: 버튼은 누를 수 있게 두고, 누르면 빠진 항목을 알려줌
  const saveBtn = document.getElementById('saveBtn');
  function missingFields(){
    return [[form.name.trim(), '이름'], [form.relation, '관계'], [form.category, '행사 종류'], [form.amount > 0, '금액'], [form.date, '날짜']]
      .filter(([ok]) => !ok).map(([, label]) => label);
  }
  function validate(){
    const ok = missingFields().length === 0;
    saveBtn.classList.toggle('is-invalid', !ok);
    return ok;
  }

  // 저장
  saveBtn.addEventListener('click', ()=>{
    if(!validate()){ toast(`${missingFields().join(' · ')} 항목을 입력해주세요`); return; }
    let targetRec = null;
    if(editingId){
      const idx = records.findIndex(r=>r.id===editingId);
      if(idx>-1){
        records[idx] = { ...records[idx],
          direction:form.direction, name:form.name.trim(), relation:form.relation,
          category:form.category, amount:form.amount, date:form.date, memo:form.memo.trim()
        };
        targetRec = records[idx];
      }
      toast('수정했어요');
    }else{
      targetRec = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        relation: form.relation,
        category: form.category,
        direction: form.direction,
        amount: form.amount,
        date: form.date,
        memo: form.memo.trim()
      };
      records.push(targetRec);
      toast('기록했어요');
    }
    save();
    closeSheet();
    render();
    if(targetRec && window.CloudService && window.CloudService.getUser()){
      window.CloudService.queueUpsert(targetRec);
    }
  });

  // ===== 사용자 인증 및 공유 연동 UI =====
  const userBtn = document.getElementById('userBtn');
  const userAvatar = document.getElementById('userAvatar');
  const menuUserCard = document.getElementById('menuUserCard');
  const menuUserAvatar = document.getElementById('menuUserAvatar');
  const menuUserName = document.getElementById('menuUserName');
  const menuUserGroup = document.getElementById('menuUserGroup');
  const loginKakaoBtn = document.getElementById('loginKakaoBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const withdrawBtn = document.getElementById('withdrawBtn');
  const shareLedgerBtn = document.getElementById('shareLedgerBtn');

  // 모달 엘리먼트
  const shareModal = document.getElementById('shareModal');
  const myInviteCode = document.getElementById('myInviteCode');
  const copyInviteCodeBtn = document.getElementById('copyInviteCodeBtn');
  const shareInviteKakaoBtn = document.getElementById('shareInviteKakaoBtn');
  const joinCodeInput = document.getElementById('joinCodeInput');
  const joinGroupBtn = document.getElementById('joinGroupBtn');
  const closeShareModalBtn = document.getElementById('closeShareModalBtn');

  // 기본 프로필 아바타 (귀여운 카카오 옐로우/브라운 테마 SVG)
  const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%23FEE500'/%3E%3Cpath d='M20 20a6 6 0 100-12 6 6 0 000 12zm0 4c-6.67 0-12 3.58-12 8v1a1 1 0 001 1h22a1 1 0 001-1v-1c0-4.42-5.33-8-12-8z' fill='%233C1E1E'/%3E%3C/svg%3E";

  // 인증 및 소속 그룹 상태 갱신
  function updateAuthUI(user, group){
    if(user){
      const name = user.nickname || '사용자';
      let avatar = user.avatarUrl || user.avatar_url || '';
      if(avatar && avatar.startsWith('http://')){
        avatar = avatar.replace('http://', 'https://');
      }
      
      menuUserName.textContent = name;
      menuUserGroup.textContent = group ? `📖 ${group.name}` : '📖 개인 장부';
      
      const effectiveAvatar = avatar || DEFAULT_AVATAR;
      userAvatar.src = effectiveAvatar;
      userAvatar.onerror = () => { userAvatar.src = DEFAULT_AVATAR; };
      menuUserAvatar.src = effectiveAvatar;
      menuUserAvatar.onerror = () => { menuUserAvatar.src = DEFAULT_AVATAR; };

      userBtn.style.display = 'flex';
      menuUserCard.style.display = 'flex';

      loginKakaoBtn.style.display = 'none';
      logoutBtn.style.display = 'flex';
      withdrawBtn.style.display = 'flex';
      shareLedgerBtn.style.display = 'flex';
      if(group && group.inviteCode){ myInviteCode.textContent = group.inviteCode; }
    } else {
      userBtn.style.display = 'none';
      menuUserCard.style.display = 'none';
      loginKakaoBtn.style.display = 'flex';
      logoutBtn.style.display = 'none';
      withdrawBtn.style.display = 'none';
      shareLedgerBtn.style.display = 'none';
      myInviteCode.textContent = '------';
    }
  }

  // 서버 기록 기준으로 로컬을 맞춤 (대기 중 변경을 먼저 전송, 오프라인·실패 시 로컬 유지)
  async function pullFromCloud(){
    const merged = await window.CloudService.pull();
    if(!merged) return false;
    if(JSON.stringify(merged) !== JSON.stringify(records)){
      records = merged;
      save();
      render();
    }
    return true;
  }
  // 이 기기에 남은 장부 흔적 삭제 (로그아웃·탈퇴)
  function clearLocalLedger(){
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OWNER_KEY);
    window.CloudService.clearOutbox();
  }

  // 클라우드 서비스 이벤트 등록
  const OWNER_KEY = 'gyeongjosa_owner';         // 이 기기 로컬 기록의 주인 계정 (계정 간 섞임 방지)
  const PENDING_INVITE_KEY = 'pending_invite';  // 로그인하러 다녀오는 동안 초대 코드 보관
  if(window.CloudService){
    window.CloudService.onAuthStateChange(async (user, group) => {
      updateAuthUI(user, group);
      render();
      if(!user || !group) return;

      const owner = localStorage.getItem(OWNER_KEY);
      if(owner && owner !== user.id){
        // 다른 계정이 남긴 로컬 기록·대기열은 현재 계정 장부에 올리지 않고 백업만 남김
        if(records.length) localStorage.setItem(`${STORAGE_KEY}_backup_${owner}`, JSON.stringify(records));
        records = [];
        save();
        window.CloudService.clearOutbox();
      }
      if(owner !== user.id){
        // 이 기기에서 처음 로그인: 로그인 전에 쓴 기록을 클라우드 장부로 올림
        localStorage.setItem(OWNER_KEY, user.id);
        if(records.length) await window.CloudService.queueUpsert(records);
      }

      await pullFromCloud();
      const { invalid } = window.CloudService.outboxStats();
      if(invalid) toast(`형식이 맞지 않는 기록 ${invalid}건은 이 기기에만 저장돼요`);
    });

    // 클라우드 초기화 실행
    window.CloudService.init();
  }

  userBtn.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('show'); });
  loginKakaoBtn.addEventListener('click', () => {
    dropdown.classList.remove('show');
    window.CloudService.loginWithKakao();
  });
  logoutBtn.addEventListener('click', async () => {
    dropdown.classList.remove('show');
    // 대기 중인 변경을 먼저 클라우드에 보낸 뒤 이 기기에서 지움 (공유 기기에서 장부 노출 방지)
    const sent = await window.CloudService.flush();
    const { pending, invalid } = window.CloudService.outboxStats();
    if(!sent.success || pending || invalid){
      toast(invalid
        ? `형식 오류로 저장되지 않은 기록 ${invalid}건이 있어요. 수정하거나 엑셀로 내보낸 뒤 다시 시도해주세요`
        : '클라우드 저장에 실패해 로그아웃을 멈췄어요');
      return;
    }
    clearLocalLedger();
    await window.CloudService.logout();
  });
  withdrawBtn.addEventListener('click', () => {
    dropdown.classList.remove('show');
    askConfirm('회원 탈퇴할까요?',
      '계정과 클라우드 장부 기록이 삭제되고 되돌릴 수 없어요. 가족과 함께 쓰는 공유 장부의 기록은 남은 가족에게 유지돼요. 필요하면 먼저 엑셀로 내보내 주세요.',
      '탈퇴',
      async () => {
        if(!(await window.CloudService.withdraw())){
          toast('탈퇴 처리에 실패했어요. 잠시 후 다시 시도해주세요');
          return;
        }
        clearLocalLedger();
        window.location.reload();
      });
  });

  // ===== 공유 장부(유료) 상태 및 페이월 모달 컨트롤러 =====
  // 권한은 서버(/api/auth/me)가 내려주는 장부 단위 권한으로만 판단
  function isPremium(){
    const grp = window.CloudService ? window.CloudService.getGroup() : null;
    return !!(grp && grp.premium);
  }

  const premiumModal = document.getElementById('premiumModal');
  const premiumModalTitle = document.getElementById('premiumModalTitle');
  const premiumModalSubtitle = document.getElementById('premiumModalSubtitle');
  const closePremiumModalBtn = document.getElementById('closePremiumModalBtn');
  const buyPremiumBtn = document.getElementById('buyPremiumBtn');
  const buyBtnText = document.getElementById('buyBtnText');
  const premiumGuarantee = document.getElementById('premiumGuarantee');
  const premiumHeaderBtn = document.getElementById('premiumHeaderBtn');
  const haveInviteBtn = document.getElementById('haveInviteBtn');
  const planLifetime = document.getElementById('planLifetime');
  const planSeason = document.getElementById('planSeason');

  const PLAN_COPY = {
    lifetime: { cta: '9,900원으로 공유 장부 시작하기', note: '1회 결제 · 서비스 운영 기간 동안 추가 결제 없음' },
    season: { cta: '5,900원으로 6개월 시작하기', note: '6개월 이용 · 자동 갱신 없음' }
  };

  function updatePremiumUI(){
    premiumHeaderBtn.textContent = isPremium() ? '💑 공유 중' : '💑 부부 공유';
    premiumHeaderBtn.classList.toggle('active-vip', isPremium());
  }

  function openPremiumModal(title, subtitle){
    premiumModalTitle.textContent = title || '부부·가족 공유 장부';
    premiumModalSubtitle.textContent = subtitle || '배우자·가족과 한 장부를 실시간으로 함께 기록해요.';
    premiumModal.classList.add('show');
  }
  function closePremiumModal(){
    premiumModal.classList.remove('show');
  }

  function selectPlan(plan){
    planLifetime.classList.toggle('active', plan === 'lifetime');
    planSeason.classList.toggle('active', plan === 'season');
    buyBtnText.textContent = PLAN_COPY[plan].cta;
    premiumGuarantee.textContent = PLAN_COPY[plan].note;
  }
  planLifetime.addEventListener('click', () => selectPlan('lifetime'));
  planSeason.addEventListener('click', () => selectPlan('season'));

  // ponytail: 실결제 연동(Phase 1) 전까지 안내만 표시. 권한은 D1 entitlements 테이블에 직접 부여.
  buyPremiumBtn.addEventListener('click', () => toast('결제는 곧 열려요. 조금만 기다려주세요'));
  closePremiumModalBtn.addEventListener('click', closePremiumModal);
  premiumModal.addEventListener('click', e => { if(e.target === premiumModal) closePremiumModal(); });
  premiumHeaderBtn.addEventListener('click', () => {
    if(isPremium()) openShareModal();
    else openPremiumModal();
  });
  haveInviteBtn.addEventListener('click', () => { closePremiumModal(); openShareModal(); });

  // ===== 감사 답례 카톡 문구 모달 컨트롤러 =====
  const thankyouBtn = document.getElementById('thankyouBtn');
  const thankyouModal = document.getElementById('thankyouModal');
  const closeThankyouModalBtn = document.getElementById('closeThankyouModalBtn');
  const thankyouTabs = document.getElementById('thankyouTabs');
  const thankyouAudience = document.getElementById('thankyouAudience');
  const thankyouText = document.getElementById('thankyouText');
  const copyThankyouBtn = document.getElementById('copyThankyouBtn');

  let currentEventType = 'wedding';
  let currentAudience = 'friend';

  const THANKYOU_TEMPLATES = {
    wedding: {
      friend: '바쁜 주말 시간 내어 제 결혼식에 참석해 축하해줘서 진심으로 고마워!\n보내준 따뜻한 응원과 축복 마음에 깊이 간직하며 예쁘고 행복하게 잘 살게. 조만간 밥 한번 먹자! 😊',
      work: '안녕하십니까. 바쁘신 일정 중에도 제 결혼식에 참석해 주시고, 따뜻한 축하와 격려를 보내주셔서 머리 숙여 감사드립니다.\n보내주신 큰 축복 잊지 않고 서로 아끼며 성실하게 살아가겠습니다. 늘 건강과 평안이 가득하시길 기원합니다.',
      elder: '어르신(친척), 바쁘신 와중에도 저희 결혼식에 발걸음해 주시고 귀한 축복을 베풀어 주셔서 진심으로 감사드립니다.\n가르침과 축복 마음에 새겨 화목하고 건강한 가정 꾸려가겠습니다. 항상 건강하시길 기원합니다.'
    },
    baby: {
      friend: '우리 아기 첫 생일 돌잔치에 와줘서 정말 고마워!\n축하해준 덕분에 뜻깊고 행복한 날 보냈어. 받은 사랑만큼 바르고 건강하게 잘 키울게! 조만간 또 보자!',
      work: '안녕하십니까. 바쁘신 중에도 저희 아이 첫 돌을 축하해 주시고 자리를 빛내주셔서 깊이 감사드립니다.\n보내주신 따뜻한 축하와 성원 잊지 않고 바르고 건강하게 키우겠습니다. 가정에 늘 행복이 깃드시길 기원합니다.',
      elder: '어르신, 저희 아이 첫돌을 맞아 귀한 시간 내어주시고 큰 사랑과 축복을 전해주셔서 감사드립니다.\n어르신의 은혜와 가르침 잊지 않고 건강하고 슬기롭게 잘 키우겠습니다. 늘 평안하시길 바랍니다.'
    },
    condolence: {
      friend: '슬픔 속에서도 먼 길 마다하지 않고 찾아와 위로해줘서 큰 힘이 되었어.\n따뜻한 위로와 격려 덕분에 무사히 장례를 마칠 수 있었어. 깊은 마음에 진심으로 감사하며 곧 연락할게.',
      work: '삼가 인사 말씀 올립니다. 공사다망하신 중에도 따뜻한 조문과 위로의 말씀을 전해주셔서 큰 힘과 위로가 되었습니다.\n덕분에 장례를 무탈하게 모실 수 있었습니다. 깊이 감사드리며, 댁내에 평안과 건강이 늘 함께하시기를 기원합니다.',
      elder: '삼가 인사드립니다. 슬픔을 함께 나눠주시고 귀한 발걸음으로 따뜻한 위로를 베풀어 주셔서 깊이 감사드립니다.\n보내주신 온정 덕에 무사히 장례를 마쳤습니다. 건강 유의하시고 늘 평안하시길 진심으로 기원합니다.'
    }
  };

  function updateThankyouText(){
    if(!thankyouText) return;
    const text = (THANKYOU_TEMPLATES[currentEventType] && THANKYOU_TEMPLATES[currentEventType][currentAudience]) || '';
    thankyouText.value = text;
  }

  if(thankyouBtn){
    thankyouBtn.addEventListener('click', () => {
      dropdown.classList.remove('show');
      updateThankyouText();
      thankyouModal.classList.add('show');
    });
  }
  if(closeThankyouModalBtn) closeThankyouModalBtn.addEventListener('click', () => thankyouModal.classList.remove('show'));
  if(thankyouModal) thankyouModal.addEventListener('click', e => { if(e.target === thankyouModal) thankyouModal.classList.remove('show'); });

  if(thankyouTabs){
    thankyouTabs.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if(!btn) return;
      thankyouTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEventType = btn.dataset.type;
      updateThankyouText();
    });
  }

  if(thankyouAudience){
    thankyouAudience.addEventListener('click', e => {
      const btn = e.target.closest('.aud-chip');
      if(!btn) return;
      thankyouAudience.querySelectorAll('.aud-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAudience = btn.dataset.aud;
      updateThankyouText();
    });
  }

  if(copyThankyouBtn){
    copyThankyouBtn.addEventListener('click', () => {
      if(!thankyouText.value) return;
      copyText(thankyouText.value, '카톡 감사 문구를 복사했어요!');
    });
  }

  // 공유 모달: 내 초대 코드는 공유 장부 권한이 있을 때만, 초대받은 장부 참여는 누구나
  const myInviteSection = document.getElementById('myInviteSection');
  function openShareModal(){
    const grp = window.CloudService ? window.CloudService.getGroup() : null;
    myInviteSection.style.display = isPremium() ? '' : 'none';
    if(grp && grp.inviteCode) myInviteCode.textContent = grp.inviteCode;
    shareModal.classList.add('show');
  }
  function closeShareModal(){
    shareModal.classList.remove('show');
    sessionStorage.removeItem(PENDING_INVITE_KEY);
  }
  shareLedgerBtn.addEventListener('click', () => {
    dropdown.classList.remove('show');
    if(isPremium()) openShareModal();
    else openPremiumModal();
  });
  closeShareModalBtn.addEventListener('click', closeShareModal);
  shareModal.addEventListener('click', e => { if(e.target === shareModal) closeShareModal(); });

  // 초대 코드 복사
  copyInviteCodeBtn.addEventListener('click', () => {
    const code = myInviteCode.textContent;
    if(!code || code === '------') return;
    copyText(code, '초대 코드를 복사했어요');
  });
  // 초대장 보내기: 모바일은 공유 시트(카톡 선택), 미지원 브라우저는 복사
  shareInviteKakaoBtn.addEventListener('click', () => {
    const code = myInviteCode.textContent;
    if(!code || code === '------') return;
    const url = `${window.location.origin}/?invite=${code}`;
    const text = `[얼마내쏘 · 부부 공유 장부 초대]\n함께 경조사비를 관리해요!\n초대 코드: ${code}`;
    const copyInvite = () => copyText(`${text}\n접속하기: ${url}`, '초대장 링크를 복사했어요 (카톡에 붙여넣기)');
    if(navigator.share){
      navigator.share({ title: '얼마내쏘 공유 장부 초대', text, url }).catch(err => {
        if(err.name !== 'AbortError') copyInvite();
      });
    }else{
      copyInvite();
    }
  });

  // 초대 코드로 장부 참여
  joinGroupBtn.addEventListener('click', async () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if(!code){ toast('초대 코드를 입력해주세요'); return; }
    if(!window.CloudService.getUser()){
      // 로그인하고 돌아오면 초대 모달을 다시 열어 이어서 연결
      sessionStorage.setItem(PENDING_INVITE_KEY, code);
      toast('카카오 로그인 후 이어서 연결해요');
      setTimeout(() => window.CloudService.loginWithKakao(), 600);
      return;
    }
    joinGroupBtn.disabled = true;
    joinGroupBtn.textContent = '연결 중...';
    const res = await window.CloudService.joinByInviteCode(code);
    if(res && res.success){
      // 이 기기의 기록을 새 장부로 올린 뒤 장부 기록 기준으로 맞춤 (전송 실패 시 로컬 유지)
      await window.CloudService.queueUpsert(records);
      await pullFromCloud();
      render();
      toast(res.message || '장부에 연결되었습니다');
      closeShareModal();
      joinCodeInput.value = '';
    } else {
      toast(res ? res.message : '연결에 실패했습니다');
    }
    joinGroupBtn.disabled = false;
    joinGroupBtn.textContent = '장부 연결 및 합치기';
  });


  // ===== 엑셀 파일로 내보내기 (수식 인젝션 방어 적용) =====
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const importCsvBtn = document.getElementById('importCsvBtn');
  const importCsvFile = document.getElementById('importCsvFile');

  function sanitizeCsvCell(val) {
    let s = String(val == null ? '' : val);
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return `"${s.replace(/"/g, '""')}"`;
  }

  exportCsvBtn.addEventListener('click', () => {
    dropdown.classList.remove('show');
    let exportRows = records;
    let isSample = false;
    if(!exportRows || exportRows.length === 0){
      isSample = true;
      exportRows = [
        { direction: 'give', name: '홍길동', relation: '친구', category: '결혼식', amount: 100000, date: todayStr(), memo: '축의금 예시' },
        { direction: 'receive', name: '김영희', relation: '직장', category: '돌잔치', amount: 50000, date: todayStr(), memo: '축하금 예시' }
      ];
    }
    const headers = ['구분', '이름', '관계', '행사종류', '금액', '날짜', '메모'];
    const rows = exportRows.map(r => [
      r.direction === 'receive' ? '받음' : '냄',
      sanitizeCsvCell(r.name),
      sanitizeCsvCell(r.relation),
      sanitizeCsvCell(r.category),
      r.amount || 0,
      sanitizeCsvCell(r.date),
      sanitizeCsvCell(r.memo)
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isSample ? `얼마내쏘_엑셀_서식_예시.csv` : `얼마내쏘_경조사장부_${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(isSample ? '기록이 없어 엑셀 예시 양식을 다운로드했어요' : '엑셀 파일로 내보냈어요');
  });

  // ===== 엑셀 파일 불러오기 =====
  importCsvBtn.addEventListener('click', () => {
    dropdown.classList.remove('show');
    importCsvFile.click();
  });

  function parseCSVLine(text) {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuote && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (c === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  importCsvFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target.result;
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if(lines.length < 2) throw new Error('데이터가 부족합니다');
        
        const imported = [];
        const clip = (s, n) => String(s).slice(0, n); // 서버 검증 길이 제한에 맞춤
        // 첫 줄(헤더) 건너뛰고 파싱
        for(let i = 1; i < lines.length; i++){
          // 내보내기 때 붙인 수식 방어용 ' 접두어 제거
          const cols = parseCSVLine(lines[i]).map(c => c.replace(/^'(?=[=+\-@\t\r])/, ''));
          if(cols.length >= 5){
            const dir = cols[0] === '받음' || cols[0].toLowerCase() === 'receive' ? 'receive' : 'give';
            const name = cols[1];
            const rel = cols[2] || '기타';
            const cat = cols[3] || '기타';
            const amt = parseInt(cols[4].replace(/[^\d]/g, ''), 10) || 0;
            const dt = cols[5] ? normalizeDate(cols[5]) : todayStr();
            const memo = cols[6] || '';

            if(name && amt > 0 && amt <= 1e12 && /^\d{4}-\d{2}-\d{2}$/.test(dt)){
              imported.push({
                id: crypto.randomUUID(),
                direction: dir,
                name: clip(name, 50),
                relation: clip(rel, 20),
                category: clip(cat, 20),
                amount: amt,
                date: dt,
                memo: clip(memo, 200)
              });
            }
          }
        }
        records.push(...imported);
        save();
        render();
        toast(`${imported.length}건의 기록을 엑셀에서 불러왔어요`);
        if(imported.length && window.CloudService && window.CloudService.getUser()){
          window.CloudService.queueUpsert(imported);
        }
      } catch(err) {
        toast('엑셀 파일 불러오기에 실패했습니다: ' + err.message);
      }
      importCsvFile.value = '';
    };
    reader.readAsText(file, 'utf-8');
  });

  // 백그라운드 동기화 이벤트 (폴링·포커스·네트워크 복구)
  window.addEventListener('cloud-sync-pull', () => {
    if(window.CloudService && window.CloudService.getUser()) pullFromCloud();
  });

  // 카카오톡 인앱 브라우저는 기본 브라우저와 저장소가 분리되므로 외부 브라우저로 열도록 안내
  if(/KAKAOTALK/i.test(navigator.userAgent)){
    document.getElementById('inappOpen').href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
    document.getElementById('inappBanner').style.display = 'flex';
  }

  // URL 파라미터 처리 (?invite=CODE, ?login_failed=1) 후 주소창에서 제거
  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.has('invite') || urlParams.has('login_failed')){
    history.replaceState(null, '', window.location.pathname);
  }
  if(urlParams.has('login_failed')){
    setTimeout(() => toast('카카오 로그인에 실패했어요. 다시 시도해주세요'), 300);
  }
  const inviteParam = (urlParams.get('invite') || sessionStorage.getItem(PENDING_INVITE_KEY) || '').toUpperCase();
  if(inviteParam){
    sessionStorage.setItem(PENDING_INVITE_KEY, inviteParam);
    joinCodeInput.value = inviteParam;
    setTimeout(() => {
      openShareModal();
      toast('초대 코드가 입력되었어요. 연결을 눌러주세요');
    }, 500);
  }

  // 초기 렌더
  fDate.value = todayStr();
  render();

  // PWA 서비스 워커 등록 (최신 버전 강제 업데이트)
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js?v=20260915_p1').then(reg => {
        reg.update();
      }).catch(err => console.log('SW 등록 생략:', err));
    });
  }
})();
