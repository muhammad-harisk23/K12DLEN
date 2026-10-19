/*
# Gate 0 audit fixes — room authorization, recursion, curriculum writes

1. Purpose
   Fixes three confirmed defects found by a two-identity authorization audit:
   (a) infinite policy recursion between study_rooms and room_members,
   (b) members_insert_self allowing arbitrary self-enrollment (masked by the
       recursion bug), and
   (c) curriculum rows being updatable by authenticated clients (UPDATE
       succeeded because table-level privileges existed and no restrictive
       policy covered that path).

2. New / Modified Tables
   - `room_members`: adds nullable column `join_code_hash text` — the hashed
     invitation code presented at join time. Used by the INSERT policy to
     prove a valid, active, unexpired invitation. NULL for owner bootstrap
     rows.
   - No other table shapes change.

3. New Functions
   - `public.is_room_member(target_room_id uuid)`: SECURITY DEFINER, STABLE,
     search_path-pinned membership check. Breaks the mutual-recursion cycle
     between study_rooms and room_members policies because its internal
     SELECT on room_members runs as the definer and does not re-fire the
     caller's policies.

4. Security changes
   - REVOKE INSERT/UPDATE/DELETE on all five curriculum tables from anon and
     authenticated. Previously UPDATE on chapters succeeded for an
     authenticated user (verified defect); now impossible at the privilege
     layer regardless of future policy changes.
   - room_members INSERT: owner bootstrap on own room, OR invite-gated join
     requiring user_id = auth.uid(), role = 'member', and a matching active
     (unrevoked, unexpired) invitation hash. Arbitrary self-enrollment is
     denied.
   - room_members UPDATE: room owner only. Members cannot change their own
     role — no self-serve escalation.
   - room_members SELECT: self rows, or room owner, or membership via the
     definer helper.
   - study_rooms SELECT: owner or is_room_member() — recursion-free.

5. Notes for re-verification
   - Re-run scripts/gate0-audit.mjs after applying. Expected: owner flows
     succeed; userB self-join, escalation, forged rows, cross-user edits all
     denied; member positive controls pass.
*/

-- ============ Schema addition ============

ALTER TABLE public.room_members
  ADD COLUMN IF NOT EXISTS join_code_hash text;

-- ============ Helper: recursion-safe membership check ============

CREATE OR REPLACE FUNCTION public.is_room_member(target_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members m
    WHERE m.room_id = target_room_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_room_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_room_member(uuid) TO authenticated;

-- ============ Lock down curriculum writes at the privilege layer ============

REVOKE INSERT, UPDATE, DELETE ON public.boards FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.syllabus_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.classes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.subjects FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chapters FROM anon, authenticated;

-- ============ Room membership: invitation-gated, no self-serve escalation =

DROP POLICY IF EXISTS "members_insert_self" ON public.room_members;
CREATE POLICY "members_insert_via_invitation" ON public.room_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      -- Owner bootstrap: creating your own owner row on a room you own
      EXISTS (
        SELECT 1 FROM public.study_rooms r
        WHERE r.id = room_id AND r.owner_id = auth.uid()
      )
    )
    OR
    (
      -- Invite-gated join: caller proves a matching active invite by
      -- supplying its stored code hash.
      user_id = auth.uid()
      AND role = 'member'
      AND join_code_hash IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.room_invites i
        WHERE i.room_id = room_members.room_id
          AND i.code_hash = room_members.join_code_hash
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
      )
    )
  );

DROP POLICY IF EXISTS "members_update_self" ON public.room_members;
CREATE POLICY "members_update_owner_only" ON public.room_members
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
      WHERE r.id = room_members.room_id AND r.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members_select_own_rooms" ON public.room_members;
CREATE POLICY "members_select_via_helper" ON public.room_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.study_rooms r
      WHERE r.id = room_members.room_id AND r.owner_id = auth.uid()
    )
    OR public.is_room_member(room_members.room_id)
  );

-- ============ Study rooms: recursion-free member visibility ============

DROP POLICY IF EXISTS "rooms_select_member" ON public.study_rooms;
CREATE POLICY "rooms_select_member" ON public.study_rooms
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_room_member(id)
  );