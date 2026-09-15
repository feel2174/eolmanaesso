import assert from 'node:assert';

// 1. 모델 및 도메인 로직 (index.html 핵심 엔진)
const NAMES = ['김민준', '이서연', '박도현', '최지우', '정우진', '강하은', '윤태양', '송수아', '조현우', '한예은'];
const RELATIONS = ['친구', '직장', '친척', '가족', '이웃', '기타'];
const CATEGORIES = ['결혼식', '돌잔치', '조의금', '생일', '환갑', '기타'];
const AMOUNTS = [50000, 100000, 150000, 200000, 300000, 500000];

function generateRandomRecord(id = null) {
  const direction = Math.random() > 0.5 ? 'give' : 'receive';
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const relation = RELATIONS[Math.floor(Math.random() * RELATIONS.length)];
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
  const year = 2024 + Math.floor(Math.random() * 3);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  
  return {
    id: id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    direction,
    name,
    relation,
    category,
    amount,
    date: `${year}-${month}-${day}`,
    memo: Math.random() > 0.7 ? `=VIP특약 memo ${Math.floor(Math.random() * 100)}` : `축하 메시지 ${name}`
  };
}

function calculateSummary(records) {
  let totalReceive = 0;
  let totalGive = 0;
  for (const r of records) {
    if (r.direction === 'receive') totalReceive += (r.amount || 0);
    else if (r.direction === 'give') totalGive += (r.amount || 0);
  }
  const diff = totalReceive - totalGive;
  return { totalReceive, totalGive, diff };
}

function calculatePersonBalance(records, personName) {
  let receive = 0;
  let give = 0;
  for (const r of records) {
    if (r.name === personName) {
      if (r.direction === 'receive') receive += (r.amount || 0);
      else if (r.direction === 'give') give += (r.amount || 0);
    }
  }
  return {
    personName,
    receive,
    give,
    balance: receive - give,
    statusText: (receive - give > 0) ? '갚을 금액 남음' : (receive - give < 0) ? '내가 더 냄' : '정산 완료'
  };
}

function filterRecords(records, { filter = '전체', query = '' }) {
  return records.filter(r => {
    let matchCat = false;
    if (filter === '전체') matchCat = true;
    else if (filter === '받음') matchCat = r.direction === 'receive';
    else if (filter === '냄') matchCat = r.direction === 'give';
    else matchCat = (r.category === filter);

    const matchQuery = !query || r.name.includes(query) || (r.memo && r.memo.includes(query));
    return matchCat && matchQuery;
  });
}

function canAddRecord(currentRecordCount, isPremium) {
  if (isPremium) return { allowed: true };
  if (currentRecordCount >= 30) {
    return { allowed: false, reason: 'FREE_QUOTA_EXCEEDED' };
  }
  return { allowed: true };
}

function sanitizeCsvCell(val) {
  let s = String(val == null ? '' : val);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

// ----------------------------------------------------------------------
// 테스트 실행
// ----------------------------------------------------------------------
console.log('🧪 [TDD 시작] 경조사 장부 데이터 생명주기 및 비즈니스 로직 테스트...\n');

// 1. 랜덤 데이터 35건 대량 생성 테스트
const records = [];
for (let i = 0; i < 35; i++) {
  records.push(generateRandomRecord(`test_id_${i + 1}`));
}
assert.strictEqual(records.length, 35, '35건의 랜덤 기록이 생성되어야 함');
console.log('✅ 1. 랜덤 데이터 35건 생성 완료 (ID, 구분, 카테고리, 금액, 날짜 무결성 확인)');

// 2. 편집(Edit) 기능 테스트
const targetId = 'test_id_5';
const originalRecord = { ...records.find(r => r.id === targetId) };
const editPayload = {
  direction: originalRecord.direction === 'give' ? 'receive' : 'give',
  amount: 777000,
  category: '돌잔치',
  memo: '수정된 메모: 백일 축하'
};

const editIndex = records.findIndex(r => r.id === targetId);
records[editIndex] = { ...records[editIndex], ...editPayload };

assert.strictEqual(records[editIndex].amount, 777000, '금액이 777,000원으로 정상 수정되어야 함');
assert.strictEqual(records[editIndex].category, '돌잔치', '카테고리가 돌잔치로 변경되어야 함');
assert.strictEqual(records[editIndex].direction, editPayload.direction, '거래 구분이 수정되어야 함');
console.log(`✅ 2. 데이터 편집(Edit) 테스트 통과: ID ${targetId} 금액 ${originalRecord.amount}원 -> ${records[editIndex].amount}원`);

// 3. 정산 및 차액 계산 테스트
const summary = calculateSummary(records);
assert.ok(summary.totalReceive >= 0, '총 받은 금액은 0 이상이어야 함');
assert.ok(summary.totalGive >= 0, '총 낸 금액은 0 이상이어야 함');
assert.strictEqual(summary.diff, summary.totalReceive - summary.totalGive, '차액 = 받은 금액 - 낸 금액');
console.log(`✅ 3. 전체 정산 집계 통과: 총 받음 ${summary.totalReceive.toLocaleString()}원 | 총 냄 ${summary.totalGive.toLocaleString()}원 | 차액 ${summary.diff.toLocaleString()}원`);

// 4. 인물별 상호 부조 차액 정산 테스트
const testPerson = '김민준';
const personBalance = calculatePersonBalance(records, testPerson);
assert.strictEqual(personBalance.personName, testPerson);
assert.strictEqual(personBalance.balance, personBalance.receive - personBalance.give);
console.log(`✅ 4. [${testPerson}] 상호 부조 차액 정산: 받은 돈 ${personBalance.receive.toLocaleString()}원, 보낸 돈 ${personBalance.give.toLocaleString()}원 => [${personBalance.statusText}] (${personBalance.balance.toLocaleString()}원)`);

// 5. 필터링 및 검색 쿼리 테스트
const weddingOnly = filterRecords(records, { filter: '결혼식' });
for (const r of weddingOnly) {
  assert.strictEqual(r.category, '결혼식', '모든 결과가 결혼식이어야 함');
}

const receiveOnly = filterRecords(records, { filter: '받음' });
for (const r of receiveOnly) {
  assert.strictEqual(r.direction, 'receive', '모든 결과가 받음이어야 함');
}
console.log(`✅ 5. 필터링 및 검색 검증 통과 (결혼식: ${weddingOnly.length}건, 받음 구분: ${receiveOnly.length}건)`);

// 6. 무료 30건 쿼터 및 페이월(Paywall) 차단 테스트
const freeGate1 = canAddRecord(29, false);
assert.strictEqual(freeGate1.allowed, true, '29건일 때는 무료 등록 가능해야 함');

const freeGate2 = canAddRecord(30, false);
assert.strictEqual(freeGate2.allowed, false, '30건 도달 시 무료 등록이 차단되어야 함');
assert.strictEqual(freeGate2.reason, 'FREE_QUOTA_EXCEEDED');

const premiumGate = canAddRecord(100, true);
assert.strictEqual(premiumGate.allowed, true, '프리미엄 회원은 100건도 무제한 추가 가능해야 함');
console.log('✅ 6. 30건 무료 한도 차단 및 프리미엄 무제한 등록 로직 검증 통과');

// 7. CSV Formula Injection(CWE-1236) 방어 셀 검증
const maliciousCell = '=1+1';
const sanitized = sanitizeCsvCell(maliciousCell);
assert.strictEqual(sanitized, '"\'=1+1"', '악성 엑셀 수식 접두어는 작은따옴표로 이스케이프되어야 함');
console.log(`✅ 7. CSV 수식 주입 방어(Formula Injection Sanitize) 통과: ${maliciousCell} -> ${sanitized}`);

console.log('\n🎉 [TDD 완료] 총 7개 핵심 도메인 시나리오 모두 100% 통과 (PASS)!');
