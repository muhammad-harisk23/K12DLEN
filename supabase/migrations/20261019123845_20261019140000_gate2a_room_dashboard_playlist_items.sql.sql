/*
# Unified Study Room — room_dashboard_secure returns playlist items + embeddable

## Summary
Updates the existing SECURITY DEFINER function `room_dashboard_secure()` so
the unified study room can render a real playlist (ordered videos, titles,
durations, availability, per-item embeddable) and correctly handle single
videos whose owner disabled embedding. The function previously returned
only the resource row's top-level columns (title, channel, source_type,
youtube_id, topic) — the room page had no playlist items and no
embeddable signal, so room-linked playlists could not display their
videos or switch between them.

## Changes
1. `room_dashboard_secure()` now also returns, inside the `lesson` object:
   - `playlistItems`: array of { position, video_id, title, channel_name,
     duration_seconds, available } for playlist resources, pulled from the
     resource's `metadata.items` jsonb. Null for single-video resources.
   - `playlistTruncated`: boolean from `metadata.truncated`. False for
     single-video resources.
   - `embeddable`: for single-video resources, the per-video embeddable
     flag from `metadata.embeddable` (null when unknown). For playlists,
     null (per-item availability is already on each item).
2. Only fields already present on the resource row are projected; no new
   columns, no new tables. The resource's `metadata` jsonb is authored by
   the youtube-import edge function and is read-only here.

## Security
- Function remains SECURITY DEFINER, search_path = public, extensions.
- Membership check (`is_room_member`) is unchanged — only members receive
  the lesson payload.
- The resource row is read via the function's owner privileges, but only
  for the room's linked `resource_id`. A member of a room can already see
  that room's linked lesson; this change exposes the SAME resource's
  playlist metadata (titles, durations, availability) that a member is
  already authorized to view in the room context. It does NOT grant
  unrestricted access to another student's private resource library —
  only the one resource the room owner linked.
- No new grants. No RLS policy changes. No new tables.

## No data loss
No columns dropped, renamed, or retyped. No tables dropped. Purely
additive projection inside an existing function.
*/

CREATE OR REPLACE FUNCTION public.room_dashboard_secure(p_room_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_room record;
  v_resource record;
  v_lesson json;
  v_participants json;
  v_playlist_items json;
  v_playlist_truncated boolean := false;
  v_embeddable boolean := null;
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
    SELECT * INTO v_resource
      FROM public.user_resources
      WHERE id = v_room.resource_id;

    IF v_resource.source_type = 'playlist' THEN
      v_playlist_items := (v_resource.metadata -> 'items')::json;
      v_playlist_truncated := COALESCE(
        ((v_resource.metadata ->> 'truncated')::boolean), false
      );
    ELSE
      -- Single video: per-video embeddable lives in metadata.embeddable.
      IF (v_resource.metadata ? 'embeddable') THEN
        v_embeddable := (v_resource.metadata ->> 'embeddable')::boolean;
      END IF;
    END IF;

    SELECT json_build_object(
      'id', v_resource.id,
      'title', v_resource.title,
      'channel', v_resource.channel_name,
      'thumbnailUrl', v_resource.thumbnail_url,
      'sourceType', v_resource.source_type,
      'youtubeId', v_resource.youtube_id,
      'topic', v_resource.topic,
      'playlistItems', v_playlist_items,
      'playlistTruncated', v_playlist_truncated,
      'embeddable', v_embeddable
    ) INTO v_lesson;
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
