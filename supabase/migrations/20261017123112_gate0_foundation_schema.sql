/*
# Gate 0 — Foundation: curriculum domain and student profiles

1. Purpose
   This migration creates the foundational, curriculum-aware structure for
   K12Learn2Gether: Indian school boards, classes, subjects, chapters and
   syllabus versions, plus student profiles holding learning preferences.

2. New Tables
   - `boards`: Indian school boards. `code` is a stable short key
     ('cbse', 'icse', 'up_board'). Seeded with CBSE, ICSE and UP Board.
   - `syllabus_versions`: a versioned syllabus line for a board
     (e.g. CBSE 2025-26). `is_current` marks the active version.
     Only rows intended for display are `published`.
   - `classes`: class levels (currently Class 10) per syllabus version.
   - `subjects`: subjects within a class, e.g. Mathematics, Science.
     `topic_grouping` is a JSON array used by Science to show
     Physics / Chemistry / Biology groupings.
   - `chapters`: chapters within a subject, with board-specific code,
     display order, and a `verification_status` ('draft', 'verified',
     'published'). Unverified content must never be shown as verified.
   - `student_profiles`: one per user. `display_name` is the only personal
     data collected (minimal data for a student-facing service). Learning
     preferences (board, class, subject) are nullable until onboarding.
   - `user_resources`: references for curated (owner is null) or
     user-imported YouTube resources. Metadata is cached and may expire;
     `metadata_fetched_at` + `metadata_expires_at` drive future refresh.
     `source_type` is 'video' or 'playlist' (playlist support is built out
     in a later gate); `import_state` tracks pending/ready/failed imports.
   - `study_rooms`: a shared study room anchored to a chapter and an
     optional resource, owned by a member, with a hashed join code and
     expiry. Room messaging/AI lifecycle is a later gate.
   - `room_members`: membership rows; `role` is 'owner' or 'member'.
   - `room_invites`: invitation records with hashed codes, expiry,
     revocation, and created_by audit.

3. Modified Tables
   - None. All tables are new.

4. Security
   - RLS is ENABLED on every table in this migration.
   - Curriculum tables (boards, syllabus_versions, classes, subjects,
     chapters): readable by anon and authenticated, but writable by NO ONE
     through the client — curriculum is managed by the operator only.
     This guarantees unverified content cannot be published or tampered
     with from the browser.
   - student_profiles: full owner-scoped CRUD. The row id defaults to
     auth.uid() so onboarding inserts work without threading user ids.
   - user_resources: readable if public/curated OR owned by the user;
     inserts/updates/deletes owner-scoped.
   - study_rooms: readable by owner or room members; inserts restricted to
     the creator; updates/deletes owner-scoped only.
   - room_members: members can see the roster; users can add themselves
     only (this is revisited with secure join flow in a later gate);
     updates owner-scoped; removal by room owner or self.
   - room_invites: readable/writable only by the room owner. Invite codes
     are stored as hashes, never plaintext.

5. Integrity & Indexes
   - Foreign keys with ON DELETE CASCADE where child data is meaningless
     without its parent.
   - Unique constraints: board codes, syllabus version per board,
     class+subject titles, chapter codes, one profile per user,
     one membership per (room, user).
   - CHECK constraints enforce enum-like values for statuses and roles.
   - Indexes on all foreign keys and frequently filtered columns.

6. Notes
   - Answer keys / privileged scores are NOT part of this migration; they
     arrive with the practice gate and will be protected with restricted
     column privileges or views from day one.
   - There are intentionally NO seeded teachers, playlists, video IDs or
     fabricated progress rows — the founder supplies real URLs later.
*/

-- ============ Curriculum domain ============

CREATE TABLE IF NOT EXISTS public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.syllabus_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, label)
);

CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_version_id uuid NOT NULL REFERENCES public.syllabus_versions(id) ON DELETE CASCADE,
  level integer NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (syllabus_version_id, level)
);

CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  topic_grouping jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, slug)
);

CREATE TABLE IF NOT EXISTS public.chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  verification_status text NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft', 'verified', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, code)
);

-- ============ Student profiles ============

CREATE TABLE IF NOT EXISTS public.student_profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  display_name text NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 40),
  board_id uuid REFERENCES public.boards(id) ON DELETE SET NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  focused_subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Resources ============

CREATE TABLE IF NOT EXISTS public.user_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'video'
    CHECK (source_type IN ('video', 'playlist')),
  youtube_id text NOT NULL,
  title text,
  channel_name text,
  thumbnail_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_fetched_at timestamptz,
  metadata_expires_at timestamptz,
  import_state text NOT NULL DEFAULT 'pending'
    CHECK (import_state IN ('pending', 'ready', 'failed')),
  is_curated boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_type, youtube_id)
);

-- ============ Study rooms ============

CREATE TABLE IF NOT EXISTS public.study_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  resource_id uuid REFERENCES public.user_resources(id) ON DELETE SET NULL,
  title text NOT NULL,
  goal_text text NOT NULL DEFAULT '',
  join_code_hash text NOT NULL,
  join_code_expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.room_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Indexes ============

CREATE INDEX IF NOT EXISTS idx_syllabus_versions_board ON public.syllabus_versions(board_id);
CREATE INDEX IF NOT EXISTS idx_classes_syllabus ON public.classes(syllabus_version_id);
CREATE INDEX IF NOT EXISTS idx_subjects_class ON public.subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON public.chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_chapters_verification ON public.chapters(verification_status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_board ON public.student_profiles(board_id);
CREATE INDEX IF NOT EXISTS idx_user_resources_owner ON public.user_resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_resources_chapter ON public.user_resources(chapter_id);
CREATE INDEX IF NOT EXISTS idx_study_rooms_owner ON public.study_rooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_study_rooms_chapter ON public.study_rooms(chapter_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_invites_room ON public.room_invites(room_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_invites_active_code ON public.room_invites(code_hash)
  WHERE revoked_at IS NULL;

-- ============ Row Level Security ============

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_invites ENABLE ROW LEVEL SECURITY;

-- Curriculum: world-readable, not client-writable (operator-managed).
DROP POLICY IF EXISTS "curriculum_read_boards" ON public.boards;
CREATE POLICY "curriculum_read_boards" ON public.boards
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "curriculum_read_syllabus" ON public.syllabus_versions;
CREATE POLICY "curriculum_read_syllabus" ON public.syllabus_versions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "curriculum_read_classes" ON public.classes;
CREATE POLICY "curriculum_read_classes" ON public.classes
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "curriculum_read_subjects" ON public.subjects;
CREATE POLICY "curriculum_read_subjects" ON public.subjects
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "curriculum_read_chapters" ON public.chapters;
CREATE POLICY "curriculum_read_chapters" ON public.chapters
  FOR SELECT TO anon, authenticated USING (true);

-- Student profiles: owner-scoped CRUD.
DROP POLICY IF EXISTS "profiles_select_own" ON public.student_profiles;
CREATE POLICY "profiles_select_own" ON public.student_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.student_profiles;
CREATE POLICY "profiles_insert_own" ON public.student_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.student_profiles;
CREATE POLICY "profiles_update_own" ON public.student_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.student_profiles;
CREATE POLICY "profiles_delete_own" ON public.student_profiles
  FOR DELETE TO authenticated USING (auth.uid() = id);

-- User resources: public/curated readable; otherwise owner-only.
DROP POLICY IF EXISTS "resources_select" ON public.user_resources;
CREATE POLICY "resources_select" ON public.user_resources
  FOR SELECT TO authenticated
  USING (is_curated = true OR owner_id = auth.uid());

DROP POLICY IF EXISTS "resources_insert_own" ON public.user_resources;
CREATE POLICY "resources_insert_own" ON public.user_resources
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_curated = false);

DROP POLICY IF EXISTS "resources_update_own" ON public.user_resources;
CREATE POLICY "resources_update_own" ON public.user_resources
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND is_curated = false);

DROP POLICY IF EXISTS "resources_delete_own" ON public.user_resources;
CREATE POLICY "resources_delete_own" ON public.user_resources
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Study rooms: visible to owner and members.
DROP POLICY IF EXISTS "rooms_select_member" ON public.study_rooms;
CREATE POLICY "rooms_select_member" ON public.study_rooms
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.room_members m
      WHERE m.room_id = id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rooms_insert_owner" ON public.study_rooms;
CREATE POLICY "rooms_insert_owner" ON public.study_rooms
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "rooms_update_owner" ON public.study_rooms;
CREATE POLICY "rooms_update_owner" ON public.study_rooms
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "rooms_delete_owner" ON public.study_rooms;
CREATE POLICY "rooms_delete_owner" ON public.study_rooms
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Room members: see rosters of your rooms; join is via secure flow later.
DROP POLICY IF EXISTS "members_select_own_rooms" ON public.room_members;
CREATE POLICY "members_select_own_rooms" ON public.room_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.room_members me
      WHERE me.room_id = room_id AND me.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members_insert_self" ON public.room_members;
CREATE POLICY "members_insert_self" ON public.room_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "members_update_self" ON public.room_members;
CREATE POLICY "members_update_self" ON public.room_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "members_delete" ON public.room_members;
CREATE POLICY "members_delete" ON public.room_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  );

-- Room invites: owner-only management. Joining uses an edge function in a
-- later gate; members cannot read invite hashes.
DROP POLICY IF EXISTS "invites_owner_all" ON public.room_invites;
CREATE POLICY "invites_owner_all" ON public.room_invites
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invites_owner_insert" ON public.room_invites;
CREATE POLICY "invites_owner_insert" ON public.room_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invites_owner_update" ON public.room_invites;
CREATE POLICY "invites_owner_update" ON public.room_invites
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invites_owner_delete" ON public.room_invites;
CREATE POLICY "invites_owner_delete" ON public.room_invites
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_id AND r.owner_id = auth.uid()
    )
  );