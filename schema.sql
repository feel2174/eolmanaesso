-- ==============================================================================
-- '얼마내쏘 · 경조사 장부' Supabase 백엔드 데이터베이스 스키마
-- ==============================================================================

-- 1. 확장 기능 활성화 (UUID 생성 등)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 사용자 프로필 테이블 (auth.users와 1:1 연동)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    nickname TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 장부 그룹 테이블 (개인 장부 또는 부부/가족 공유 장부)
CREATE TABLE IF NOT EXISTS public.ledger_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT '우리 장부',
    invite_code TEXT UNIQUE NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. 장부 멤버십 테이블 (누가 어떤 장부에 속해 있는지)
CREATE TABLE IF NOT EXISTS public.ledger_members (
    group_id UUID REFERENCES public.ledger_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- 5. 경조사비 기록 테이블
CREATE TABLE IF NOT EXISTS public.records (
    id TEXT PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.ledger_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('give', 'receive')),
    name TEXT NOT NULL,
    relation TEXT NOT NULL,
    category TEXT NOT NULL,
    amount BIGINT NOT NULL DEFAULT 0,
    date DATE NOT NULL,
    memo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_records_group_id ON public.records(group_id);
CREATE INDEX IF NOT EXISTS idx_records_date ON public.records(date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_members_user ON public.ledger_members(user_id);

-- ==============================================================================
-- 6. Row Level Security (RLS) 보안 정책
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;

-- profiles 정책
CREATE POLICY "누구나 자신의 프로필 조회 가능" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "자신의 프로필만 수정 가능" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- ledger_groups 정책: 본인이 소속된 그룹만 조회 가능
CREATE POLICY "소속된 장부 그룹 조회" ON public.ledger_groups
    FOR SELECT USING (
        id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

CREATE POLICY "장부 그룹 생성" ON public.ledger_groups
    FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "장부 그룹 수정 (소속 멤버)" ON public.ledger_groups
    FOR UPDATE USING (
        id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

-- ledger_members 정책
CREATE POLICY "자신이 속한 그룹의 멤버십 조회" ON public.ledger_members
    FOR SELECT USING (
        group_id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
        OR user_id = auth.uid()
    );

CREATE POLICY "장부 멤버 추가" ON public.ledger_members
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- records 정책
CREATE POLICY "소속 장부의 기록 조회" ON public.records
    FOR SELECT USING (
        group_id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

CREATE POLICY "소속 장부에 기록 생성" ON public.records
    FOR INSERT WITH CHECK (
        group_id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

CREATE POLICY "소속 장부의 기록 수정" ON public.records
    FOR UPDATE USING (
        group_id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

CREATE POLICY "소속 장부의 기록 삭제" ON public.records
    FOR DELETE USING (
        group_id IN (SELECT group_id FROM public.ledger_members WHERE user_id = auth.uid())
    );

-- ==============================================================================
-- 7. 함수 및 트리거: 신규 가입 시 프로필 및 기본 개인 장부 자동 생성
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_group_id UUID;
    new_invite_code TEXT;
    raw_user_name TEXT;
    raw_avatar TEXT;
BEGIN
    raw_user_name := COALESCE(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'nickname',
        split_part(new.email, '@', 1),
        '사용자'
    );
    raw_avatar := COALESCE(
        new.raw_user_meta_data->>'avatar_url',
        new.raw_user_meta_data->>'picture',
        ''
    );

    INSERT INTO public.profiles (id, email, nickname, avatar_url)
    VALUES (new.id, new.email, raw_user_name, raw_avatar);

    new_invite_code := upper(substring(md5(random()::text) from 1 for 6));

    INSERT INTO public.ledger_groups (name, invite_code, created_by)
    VALUES (raw_user_name || '의 장부', new_invite_code, new.id)
    RETURNING id INTO new_group_id;

    INSERT INTO public.ledger_members (group_id, user_id, role)
    VALUES (new_group_id, new.id, 'owner');

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 8. 부부/가족 공유 초대 코드로 참여하는 보안 RPC 함수
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.join_ledger_by_invite_code(code_input TEXT)
RETURNS JSONB AS $$
DECLARE
    target_group RECORD;
    current_user_id UUID := auth.uid();
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;

    SELECT * INTO target_group
    FROM public.ledger_groups
    WHERE UPPER(invite_code) = UPPER(code_input);

    IF target_group.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '유효하지 않은 초대 코드입니다.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.ledger_members
        WHERE group_id = target_group.id AND user_id = current_user_id
    ) THEN
        RETURN jsonb_build_object(
            'success', true, 
            'group_id', target_group.id, 
            'group_name', target_group.name,
            'message', '이미 참여 중인 장부입니다.'
        );
    END IF;

    INSERT INTO public.ledger_members (group_id, user_id, role)
    VALUES (target_group.id, current_user_id, 'member');

    RETURN jsonb_build_object(
        'success', true, 
        'group_id', target_group.id, 
        'group_name', target_group.name,
        'message', target_group.name || '에 연결되었습니다.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. 실시간(Realtime) 변경 감지 복제 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE public.records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ledger_groups;
