-- ==============================================================================
-- '얼마내쏘 · 경조사 장부' Cloudflare D1 (SQLite) 데이터베이스 스키마
-- ==============================================================================

-- 1. 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    kakao_id TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 장부 그룹 테이블 (개인 장부 또는 부부/가족 공유 장부)
CREATE TABLE IF NOT EXISTS ledger_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '우리 장부',
    invite_code TEXT UNIQUE NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 장부 멤버십 테이블 (신랑, 신부 등이 1개 장부에 소속)
CREATE TABLE IF NOT EXISTS ledger_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

-- 4. 경조사비 기록 테이블
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT,
    direction TEXT NOT NULL,
    name TEXT NOT NULL,
    relation TEXT NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    memo TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. 공유 장부(유료) 권한 테이블: 장부(그룹) 단위, expires_at NULL = 기간 제한 없음
CREATE TABLE IF NOT EXISTS entitlements (
    group_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 성능 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date DESC);
CREATE INDEX IF NOT EXISTS idx_invite_code ON ledger_groups(invite_code);
CREATE INDEX IF NOT EXISTS idx_members_user ON ledger_members(user_id);
