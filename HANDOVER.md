# 📖 얼마내쏘 (Eolmanaesso) - 프로젝트 인수인계 & 기술 기획서

> **"말이 없다. 한 줄을 쓴다. 돌아간다."**  
> 경조사 비용(축의금, 조의금, 돌잔치 등)을 3초 만에 기록하고, 물가 보정 추천과 부부/가족 실시간 동기화 및 프리미엄 수익화 퍼널을 갖춘 스마트 경조사 웹앱입니다.

---

## 🌐 1. 서비스 기본 정보

| 항목 | 내용 |
|---|---|
| **서비스명** | 얼마내쏘 (Eolmanaesso) |
| **운영 상태** | 상용 배포 완료 (Production Live) |
| **라이브 접속 URL** | [https://howmuch-bongtoo.pages.dev/](https://howmuch-bongtoo.pages.dev/) |
| **Git 저장소** | [https://github.com/feel2174/eolmanaesso.git](https://github.com/feel2174/eolmanaesso.git) (브랜치: `main`) |
| **인프라/호스팅** | Cloudflare Pages + Cloudflare Pages Functions |
| **데이터베이스** | Cloudflare D1 (Serverless SQLite, Binding: `DB`) |
| **소셜 로그인** | 카카오 로그인 (Kakao OAuth 2.0 REST API) |
| **라이선스 / 모델** | 부분 유료화 (Freemium: 기록 저장·백업 무료 + 부부·가족 공유 장부만 유료, 실결제는 Phase 1 예정) |

---

## 🏗️ 2. 시스템 아키텍처 및 기술 스택

```
[사용자 브라우저 / 모바일 PWA]
       │
       ▼ (HTTPS / PWA Service Worker v3: Network-First)
[Cloudflare Pages Edge CDN] ─────── static assets (HTML/CSS/JS)
       │
       ▼ (/api/* 요청)
[Cloudflare Pages Functions] (functions/api)
  ├── _auth.js        : Web Crypto HMAC-SHA256 세션 발급/검증 (Timing-Safe)
  ├── auth/kakao.js   : 카카오 OAuth 로그인 리다이렉트
  ├── auth/callback.js: 카카오 토큰 교환, 유저 프로필 추출, D1 저장, 세션 쿠키 발급
  ├── auth/me.js      : 현재 사용자 인증 세션 및 소속 장부(group) 조회
  ├── auth/logout.js  : 세션 쿠키 파기 (Max-Age=0)
  ├── records.js      : D1 연동 기록 CRUD 및 교차 테넌트(IDOR) 방어 배치 동기화
  └── group.js        : 부부/가족 8자리 초대코드 생성 및 1인 1장부 참여
       │
       ▼ (Binding: env.DB)
[Cloudflare D1 Database] (SQLite)
  ├── users           : 카카오 ID, 닉네임, 프로필 이미지 URL
  ├── ledger_groups   : 장부 ID, 이름, 8자리 고유 초대코드 (CSPRNG)
  ├── ledger_members  : 장부와 사용자의 1:N / N:M 소속 관계 (owner, member)
  └── records         : 경조사비 내역 (구분, 이름, 관계, 카테고리, 금액, 날짜, 메모)
```

### 핵심 기술 스택
1. **Frontend**:
   - 순수 바닐라 HTML5, CSS3, ES6+ JavaScript (빌드 도구 없는 초경량 고속 로딩).
   - 반응형 디자인: 375px 모바일 뷰포트 중심 최적화 + 데스크톱 카드 뷰.
   - 폰트: Pretendard Variable CDN.
   - PWA: `sw.js` (오프라인 구동 지원, 네트워크 우선 캐싱 전략), `manifest.webmanifest`.
2. **Backend**:
   - Cloudflare Pages Functions (Edge Worker 런타임).
   - Web Crypto API (`crypto.subtle`) 기반 HMAC-SHA256 암호학적 서명 세션 토큰.
   - 쿠키 보안: `HttpOnly; Secure; SameSite=Lax`.
3. **Database**:
   - Cloudflare D1 (글로벌 엣지 SQLite).
   - 자동 테이블 생성(Self-healing Schema): 테이블이 없어도 API 호출 시 안전하게 자동 생성.

---

## 📂 3. 디렉토리 및 파일 상세 구조

```
gyeongjosa/
├── index.html                   # 메인 프론트엔드 UI (화면, 모달, 비즈니스 로직, 페이월)
├── cloudSync.js                 # 클라우드 Functions API 통신 및 백그라운드 동기화 모듈
├── sw.js                        # PWA 서비스 워커 (v3: Network-First 캐시 전략)
├── manifest.webmanifest         # PWA 매니페스트 (홈 화면 추가, 앱 아이콘 정의)
├── icon.svg                     # 앱 메인 아이콘
├── d1-schema.sql                # Cloudflare D1 데이터베이스 DDL 스키마 원본
├── functions/                   # Cloudflare Pages Functions 라우팅 폴더
│   └── api/
│       ├── _auth.js             # 세션 암호화, 토큰 생성/검증, D1 자동 생성 스키마
│       ├── group.js             # 부부/가족 공유 장부 연결 (POST /api/group)
│       ├── records.js           # 장부 기록 조회/저장/삭제 (GET/POST/DELETE /api/records)
│       └── auth/
│           ├── kakao.js         # 카카오 로그인 시작 (GET /api/auth/kakao)
│           ├── callback.js      # 카카오 OAuth 콜백 및 유저 생성 (GET /api/auth/callback)
│           ├── logout.js        # 로그아웃 (POST /api/auth/logout)
│           └── me.js            # 현재 세션 및 그룹 조회 (GET /api/auth/me)
├── tests/
│   └── record-lifecycle.test.mjs# 순수 Node.js 기반 TDD 비즈니스 로직 단위 테스트
├── .dev.vars                    # (Git 제외) 로컬 환경변수 파일
├── .gitignore                   # Git 제외 목록 (.dev.vars, .wrangler/, node_modules/ 등)
└── README.md                    # 저장소 기본 소개 문서
```

---

## 💻 4. 다른 디바이스(PC/Mac/노트북)에서 개발 환경 세팅하기

새로운 컴퓨터나 작업 환경에서 이 프로젝트를 이어받아 개발할 때 아래 순서대로 진행합니다.

### 4.1. 저장소 복제 (Git Clone)
```bash
git clone https://github.com/feel2174/eolmanaesso.git
cd eolmanaesso
```

### 4.2. 필수 요구 사항
* **Node.js**: v18.0.0 이상 권장 (`node -v`)

### 4.3. 로컬 환경 변수 설정 (`.dev.vars`)
프로젝트 루트 경로에 `.dev.vars` 파일을 생성하고 카카오 API 키를 입력합니다:
```ini
# .dev.vars
KAKAO_CLIENT_ID=카카오_REST_API_키_입력
JWT_SECRET=임의의_긴_무작위_문자열_32자_이상
KAKAO_CLIENT_SECRET=카카오_시크릿코드(설정한_경우만_입력)
```

### 4.4. 로컬 개발 서버 실행
Wrangler를 사용하여 로컬에서 Cloudflare Functions 및 로컬 D1 에뮬레이터를 띄웁니다:
```bash
# 3000번 포트로 로컬 Pages Functions 서버 실행
npx wrangler pages dev . --port 3000
```
* 브라우저에서 `http://localhost:3000` 접속하여 확인.
* 변경된 코드는 저장 즉시 브라우저에 반영됩니다.

### 4.5. TDD 로직 단위 테스트 실행
```bash
node tests/record-lifecycle.test.mjs
node tests/phase0-security.test.mjs   # 인증·OAuth state·입력 검증·공유 권한·탈퇴 (실제 API 코드 import)
node tests/sync-outbox.test.mjs       # 변경 대기열 동기화 (cloudSync.js 실제 코드)
```
* 외부 의존성(Jest, Mocha 등) 없이 Node.js 내장 `assert`로 7개 핵심 시나리오가 1초 내에 검증됩니다.

---

## ☁️ 5. Cloudflare & 카카오 개발자 콘솔 연동 설정

### 5.1. Cloudflare Pages 설정
1. **프로젝트 연동**:
   - GitHub의 `feel2174/eolmanaesso` 저장소 연동.
   - Production 브랜치: `main`
   - 빌드 설정: **정적 사이트이므로 Build Command는 비워둠**, Output Directory는 `.` 또는 비워둠.
2. **D1 데이터베이스 바인딩 (⭐️필수)**:
   - **[Settings]** → **[Functions]** → **[D1 database bindings]**
   - Variable name: **`DB`**
   - D1 database: 생성한 D1 데이터베이스 선택 (예: `howmuch-db`)
3. **환경 변수 (Environment variables)**:
   - **[Settings]** → **[Environment variables]**
   - `KAKAO_CLIENT_ID`: 카카오 앱 REST API 키
   - `JWT_SECRET`: 세션 암호화용 비밀키 문자열
   - `KAKAO_CLIENT_SECRET`: (보안 코드 활성화 시)

### 5.2. 카카오 디벨로퍼스(Kakao Developers) 설정
1. **플랫폼 등록**:
   - **[앱 설정]** → **[플랫폼]** → **[Web 사이트 도메인]**:
     - `https://howmuch-bongtoo.pages.dev`
     - `http://localhost:3000` (로컬 개발용)
2. **카카오 로그인 설정**:
   - **[제품 설정]** → **[카카오 로그인]** 활성화: **ON**
   - **[Redirect URI]** 등록:
     - `https://howmuch-bongtoo.pages.dev/api/auth/callback`
     - `http://localhost:3000/api/auth/callback` (로컬 개발용)
3. **동의항목 설정**:
   - **닉네임**: 필수 동의
   - **프로필 사진**: 필수 또는 선택 동의

---

## 💎 6. 핵심 비즈니스 로직 및 기능 상세

### 6.1. 유료화(페이월) 전환 퍼널
* **무료**: 카카오 로그인, 기록 저장(건수 제한 없음), 클라우드 백업, 답례 문구, 엑셀 내보내기/가져오기.
* **유료: 부부·가족 공유 장부**
  - 권한은 **장부(그룹) 단위**로 D1 `entitlements` 테이블에 저장되고, `/api/auth/me`의 `group.premium`으로 내려감. 브라우저 localStorage는 권한 판단에 쓰지 않음.
  - 권한 있는 장부만 내 초대 코드가 보이고, `/api/group` 참여도 서버에서 권한 장부만 허용(403 `PREMIUM_REQUIRED`).
  - 초대받아 참여한 가족은 추가 결제 없이 같은 권한 사용.
* **플랜 표기**: 평생 이용권 9,900원(1회) / 결혼식 패스 5,900원(6개월, 자동 갱신 없음).
* **결제 연동 전 권한 부여 (D1 콘솔)**:
  ```sql
  -- 장부 ID 확인: SELECT lg.id, lg.name FROM ledger_groups lg JOIN ledger_members lm ON lm.group_id = lg.id JOIN users u ON u.id = lm.user_id WHERE u.nickname = '닉네임';
  INSERT INTO entitlements (group_id, plan) VALUES ('<group_id>', 'lifetime');
  INSERT INTO entitlements (group_id, plan, expires_at) VALUES ('<group_id>', 'season', datetime('now', '+6 months'));
  ```

### 6.2. 부부/가족 실시간 공유 장부
* **CSPRNG 8자리 초대코드**:
  - 숫자와 헷갈리기 쉬운 문자(0, O, 1, I)를 배제한 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` 문자셋 사용.
  - 카카오톡으로 원클릭 초대장 링크 전송 가능.
* **1인 1활성 장부 원칙**:
  - 배우자의 초대 코드를 입력하면 기존 개인 장부에서 새 부부 장부로 이동(멤버 교체를 하나의 D1 batch로 처리).
  - 혼자 쓰던 장부의 기록은 새 장부로 함께 옮김. 다른 멤버가 남는 장부의 기록은 그 장부에 둠.
  - 비로그인 상태로 초대 링크를 열면 코드를 sessionStorage에 보관하고 카카오 로그인 후 이어서 연결.
* **동기화 (cloudSync.js 변경 대기열)**:
  - 로그인 상태의 추가·수정·삭제는 localStorage `gyeongjosa_outbox`에 먼저 쌓고 서버로 전송. 실패·오프라인이면 남겨두고 25초 폴링·포커스·네트워크 복구 때 재전송.
  - 동기화는 "대기열 전송 → 서버 기록 조회 → 남은 대기 변경을 겹침" 순서라 다른 기기의 삭제가 반영되고, 오프라인 삭제가 되살아나지 않음.
  - 서버 검증에서 거절된 기록(`skippedIds`)은 이 기기에만 보관(`invalid`), 수정하면 다시 전송.
  - 새 기록 id는 `crypto.randomUUID()` (기존 숫자 id는 그대로 호환).
* **회원 탈퇴 (`POST /api/auth/withdraw`)**: 계정·멤버십 삭제, 혼자 쓰던 장부는 기록·권한·장부까지 삭제, 가족이 남은 공유 장부 기록은 유지. `KAKAO_ADMIN_KEY` 환경변수가 있으면 카카오 연결 끊기까지 처리.

### 6.3. 보안 설계 (Security Hardened)
* **HMAC-SHA256 + Timing-Safe**:
  - 세션 토큰은 `payload.signature` 형식이며, `crypto.subtle` 및 `timingSafeEqual`(상수 시간 비교)을 통해 위변조 및 타이밍 공격(CWE-208) 완벽 방어.
* **IDOR 방어 (CWE-639)**:
  - `records` 저장 및 수정 시 `WHERE records.group_id = excluded.group_id` 절을 적용하여 타인의 레코드 ID 조작 덮어쓰기를 원천 방어.
* **JWT_SECRET 필수 (CWE-798)**: 환경변수가 없으면 세션 발급·검증을 모두 거부. 소스 내 대체 키와 데모 로그인은 제거됨. 로컬 개발도 `.dev.vars`에 `JWT_SECRET` 필요.
* **OAuth state (CWE-352)**: `/api/auth/kakao`가 `oauth_state` 쿠키를 발급하고 콜백에서 비교. 실패 시 `/?login_failed=1`로 이동(오류 상세는 서버 로그에만).
* **서버 입력 검증 (CWE-20/770)**: `validateRecord`로 방향·금액·날짜·길이 검증, 요청당 최대 500건, 형식 오류 항목은 건너뛰고 `skipped`로 응답.
* **보안 헤더**: `_headers`로 CSP, HSTS, X-Frame-Options, Permissions-Policy 적용.
* **공유 기기 보호**: 로그아웃 시 로컬 기록을 클라우드에 저장한 뒤 기기에서 삭제. 다른 계정으로 로그인하면 이전 계정 로컬 기록은 섞지 않고 백업 키로만 보관.
* **CSV Formula Injection 방어 (CWE-1236)**:
  - 엑셀 내보내기 시 `=, +, -, @, \t, \r` 문자로 시작하는 셀 값에 자동으로 접두 작은따옴표(`'`)를 붙여 악성 매크로/수식 실행 방지.

---

## 🛠️ 7. 문제 해결 가이드 (Troubleshooting)

### Q1. 브라우저에서 자꾸 이전 레거시(Supabase 등) 화면이나 에러가 떠요.
* **원인**: 이전 PWA 서비스 워커(`sw.js`)가 브라우저에 정적 파일을 영구 캐싱해두었기 때문입니다.
* **해결**:
  1. 최신 `sw.js`는 `gyeongjosa-v3-pure-cloudflare` 캐시명을 사용하며 **네트워크 우선(Network-First)** 전략으로 변경되어 있습니다.
  2. 브라우저에서 `Ctrl + Shift + R` (강력 새로고침)을 하거나 모바일 브라우저 탭을 완전히 닫고 다시 접속하면 즉시 자동 정리됩니다.

### Q2. 카카오 로그인 후 `D1_ERROR: no such table: users` 에러가 떠요.
* **원인**: 새로 바인딩한 Cloudflare D1에 테이블이 아직 생성되지 않은 상태.
* **해결**:
  1. 현재 소스 코드의 [`callback.js`](file:///c:/Users/devzu/Documents/gyeongjosa/functions/api/auth/callback.js)에 `ensureTables(env.DB)`가 자동 호출되므로 다음 로그인부터는 자동으로 생성됩니다.
  2. 또는 Cloudflare 대시보드 D1 콘솔에서 [`d1-schema.sql`](file:///c:/Users/devzu/Documents/gyeongjosa/d1-schema.sql)의 SQL을 복사해 한 번 실행(Execute)해주셔도 됩니다.

### Q3. 카카오 로그인 버튼을 눌렀는데 `KOE006` 에러가 발생해요.
* **원인**: 카카오 디벨로퍼스에 등록된 Redirect URI와 실제 요청 URI가 불일치함.
* **해결**: 카카오 디벨로퍼스 [카카오 로그인] → [Redirect URI]에 `https://howmuch-bongtoo.pages.dev/api/auth/callback` 및 `http://localhost:3000/api/auth/callback`이 정확히 등록되어 있는지 확인하세요 (끝의 `/api/auth/callback` 필수).

---

## 📞 8. 담당자 및 유지보수 참고사항
* **Git 워크플로우**: `main` 브랜치에 `git push origin main` 실행 시 약 15~30초 내로 Cloudflare Pages에 자동 빌드 및 글로벌 배포됩니다.
* **비용 관리**: Cloudflare Pages(무료), Workers Functions(일 10만 건 무료), Cloudflare D1(일 500만 읽기/10만 쓰기 무료)로 일일 활성 사용자(DAU) 수만 명 수준까지 **월 인프라 비용 0원**으로 운영 가능합니다.
