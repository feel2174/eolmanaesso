# 얼마내쏘 · 경조사 장부 (Eolmanaesso)

> **말이 없다. 한 줄을 쓴다. 돌아간다.**  
> 물가 반영 축의금 추천과 부부/가족 실시간 공유가 가능한 스마트 경조사 장부

---

## 주요 기능

1. **주고받은 경조사비 직관적 관리**
   - 낸 돈(💸) / 받은 돈(🎁) 구분 기록
   - 인물별 차액 계산 ("내가 더 냈어요", "아직 갚을 게 남았어요")
2. **소비자물가지수(CPI) 연동 물가 보정 추천**
   - 과거(예: 2018년)에 받은 축의금을 현재 물가 가치로 환산하여 적정 금액 추천
3. **부부·가족 실시간 공유 장부**
   - 6자리 초대 코드로 신랑·신부가 동일 장부를 실시간 공동 관리
4. **PWA (Progressive Web App) 지원**
   - 모바일 브라우저에서 '홈 화면에 추가' 시 앱 아이콘 설치 및 오프라인 동작 지원
5. **백업 및 복원**
   - JSON 및 향후 엑셀(CSV) 호환 지원

---

## 기술 스택

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Pretendard 폰트)
- **PWA**: Service Worker (`sw.js`), Web App Manifest (`manifest.webmanifest`)
- **Backend / Database**: Cloudflare Pages / Supabase (PostgreSQL + RLS) or Cloudflare D1
