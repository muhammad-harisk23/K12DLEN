/*
# Gate 2A fix 2 — correct search_path quoting

1. Purpose
   'SET search_path TO ''public, extensions''' was parsed as one schema
   named "public, extensions". Re-apply all Gate 2A functions using
   `SET search_path = public, extensions` (correct unquoted form).
   No data changes.
*/

CREATE OR REPLACE FUNCTION public.create_room_secure(
  p_title text,
  p_mission text,
  p_resource_id uuid DEFAULT NULL,
  p_chapter_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_room_id uuid;
  v_salt bytea;
  v_join_hash text;
  v_resource_owner uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR char_length(btrim(p_title)) > 120 THEN
    RAISE EXCEPTION 'invalid_title';
  END IF;
  IF p_mission IS NOT NULL AND char_length(btrim(p_mission)) > 280 THEN
    RAISE EXCEPTION 'invalid_mission';
  END IF;

  IF p_resource_id IS NOT NULL THEN
    SELECT owner_id INTO v_resource_owner
    FROM public.user_resources
    WHERE id = p_resource_id;
    IF v_resource_owner IS NULL OR v_resource_owner <> v_owner THEN
      RAISE EXCEPTION 'invalid_resource';
    END IF;
  END IF;

  v_salt := gen_random_bytes(16);
  v_join_hash := encode(digest(v_salt || encode(gen_random_bytes(16), 'hex'), 'sha256'), 'hex');

  INSERT INTO public.study_rooms (owner_id, chapter_id, resource_id, title, goal_text, join_code_hash, join_code_expires_at)
  VALUES (v_owner, p_chapter_id, p_resource_id, btrim(p_title), coalesce(btrim(p_mission), ''), v_join_hash, now() + interval '7 days')
  RETURNING id INTO v_room_id;

  INSERT INTO public.room_members (room_id, user_id, role)
  VALUES (v_room_id, v_owner, 'owner');

  RETURN v_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_invite_secure(
  p_room_id uuid,
  p_ttl_hours int
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_room_owner uuid;
  v_raw text;
  v_salt bytea;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT owner_id INTO v_room_owner FROM public.study_rooms WHERE id = p_room_id;
  IF v_room_owner IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_room_owner <> v_owner THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_ttl_hours IS NULL OR p_ttl_hours < 1 OR p_ttl_hours > 168 THEN
    RAISE EXCEPTION 'invalid_ttl';
  END IF;

  IF (SELECT count(*) FROM public.room_invites
      WHERE room_id = p_room_id
        AND revoked_at IS NULL
        AND expires_at > now()) >= 20 THEN
    RAISE EXCEPTION 'too_many_invites';
  END IF;

  v_raw := encode(gen_random_bytes(16), 'hex');
  v_salt := gen_random_bytes(16);

  INSERT INTO public.room_invites (room_id, code_hash, salt, expires_at, created_by)
  VALUES (
    p_room_id,
    encode(digest(v_salt || v_raw, 'sha256'), 'hex'),
    v_salt,
    now() + make_interval(hours => p_ttl_hours),
    v_owner
  );

  RETURN v_raw;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_room_invite(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_code text;
  v_invite record;
  v_member_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF (SELECT count(*) FROM public.room_redemption_log
      WHERE user_id = v_user AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO public.room_redemption_log (user_id) VALUES (v_user);

  v_code := btrim(coalesce(p_code, ''));
  IF v_code = '' OR char_length(v_code) <> 32 OR v_code !~ '^[0-9a-f]+$' THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT i.* INTO v_invite
  FROM public.room_invites i
  WHERE i.code_hash = encode(digest(i.salt || v_code, 'sha256'), 'hex')
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.room_members
  WHERE room_id = v_invite.room_id;

  IF v_member_count >= 8 THEN
    RAISE EXCEPTION 'room_full';
  END IF;

  BEGIN
    INSERT INTO public.room_members (room_id, user_id, role, join_code_hash)
    VALUES (v_invite.room_id, v_user, 'member', v_invite.code_hash);
    RETURN json_build_object('status', 'joined', 'roomId', v_invite.room_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('status', 'already_member', 'roomId', v_invite.room_id);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_room_mission_secure(
  p_room_id uuid,
  p_mission text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_mission IS NOT NULL AND char_length(btrim(p_mission)) > 280 THEN
    RAISE EXCEPTION 'invalid_mission';
  END IF;

  UPDATE public.study_rooms
  SET goal_text = coalesce(btrim(p_mission), '')
  WHERE id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_room_secure(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  SELECT role INTO v_role FROM public.room_members
  WHERE room_id = p_room_id AND user_id = auth.uid();

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'owner_cannot_leave';
  END IF;

  DELETE FROM public.room_members
  WHERE room_id = p_room_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.room_dashboard_secure(p_room_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_room record;
  v_lesson json;
  v_participants json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_room FROM public.study_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_room.resource_id IS NOT NULL THEN
    SELECT json_build_object(
      'id', r.id,
      'title', r.title,
      'channel', r.channel_name,
      'thumbnailUrl', r.thumbnail_url,
      'sourceType', r.source_type,
      'youtubeId', r.youtube_id,
      'topic', r.topic
    ) INTO v_lesson
    FROM public.user_resources r
    WHERE r.id = v_room.resource_id;
  END IF;

  SELECT coalesce(json_agg(json_build_object(
    'userId', m.user_id,
    'role', m.role,
    'joinedAt', m.joined_at,
    'displayName', p.display_name
  ) ORDER BY m.joined_at), '[]'::json)
  INTO v_participants
  FROM public.room_members m
  LEFT JOIN public.student_profiles p ON p.id = m.user_id
  WHERE m.room_id = p_room_id;

  RETURN json_build_object(
    'id', v_room.id,
    'title', v_room.title,
    'mission', v_room.goal_text,
    'ownerId', v_room.owner_id,
    'createdAt', v_room.created_at,
    'lesson', v_lesson,
    'participants', v_participants
  );
END;
$$;
