import { supabase } from '@/lib/supabase';

export interface PlaylistItemMeta {
  position: number;
  video_id: string;
  title: string | null;
  available: boolean;
  duration_seconds: number | null;
}

export interface PlaylistItemChannel extends PlaylistItemMeta {
  channel_name?: string | null;
  embeddable?: boolean;
}

export interface LessonContext {
  id: string;
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
  sourceType: 'video' | 'playlist';
  youtubeId: string;
  topic: string | null;
  embeddable: boolean | null;
  playlistItems: PlaylistItemMeta[] | null;
  playlistTruncated: boolean;
}

export interface Participant {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  displayName: string | null;
}

export interface RoomDashboard {
  id: string;
  title: string;
  mission: string;
  ownerId: string;
  createdAt: string;
  lesson: LessonContext | null;
  participants: Participant[];
}

export interface RoomSummary {
  id: string;
  title: string;
  mission: string;
  ownerId: string;
  createdAt: string;
  memberCount: number;
}

/** Maps server error messages to safe, human explanations. */
export function describeRoomError(raw: string): string {
  switch (raw) {
    case 'unauthenticated':
      return 'Your session expired. Please sign in again.';
    case 'not_found':
      return 'This room could not be found.';
    case 'forbidden':
      return 'You are not a member of this room.';
    case 'invalid_code':
      return 'This invitation is invalid, expired, or has been revoked.';
    case 'rate_limited':
      return 'Too many attempts. Please wait a little and try again.';
    case 'room_full':
      return 'This room is full (8 members max).';
    case 'invalid_ttl':
      return 'Choose an invite duration between 1 and 168 hours.';
    case 'too_many_invites':
      return 'This room already has 20 active invites. Delete one first.';
    case 'owner_cannot_leave':
      return 'Owners cannot leave their own room — delete it instead.';
    case 'not_member':
      return 'You are not a member of this room.';
    case 'invalid_title':
      return 'Give the room a clear title (1-120 characters).';
    case 'invalid_mission':
      return 'The study mission must be 280 characters or fewer.';
    case 'invalid_resource':
      return 'That lesson is not in your library.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function pgMessage(error: { message: string }): string {
  return error.message.trim();
}

export async function createRoomSecure(
  title: string,
  mission: string,
  resourceId: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc('create_room_secure', {
    p_title: title,
    p_mission: mission,
    p_resource_id: resourceId,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
  return data as string;
}

export async function createRoomInviteSecure(
  roomId: string,
  ttlHours: number
): Promise<string> {
  const { data, error } = await supabase.rpc('create_room_invite_secure', {
    p_room_id: roomId,
    p_ttl_hours: ttlHours,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
  return data as string;
}

export async function redeemRoomInvite(
  code: string
): Promise<{ status: 'joined' | 'already_member'; roomId: string }> {
  const { data, error } = await supabase.rpc('redeem_room_invite', {
    p_code: code,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
  const payload = data as { status: string; roomId: string } | null;
  if (!payload || (payload.status !== 'joined' && payload.status !== 'already_member')) {
    throw new Error(describeRoomError('invalid_code'));
  }
  return { status: payload.status, roomId: payload.roomId };
}

export async function updateRoomMissionSecure(
  roomId: string,
  mission: string
): Promise<void> {
  const { error } = await supabase.rpc('update_room_mission_secure', {
    p_room_id: roomId,
    p_mission: mission,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
}

export async function leaveRoomSecure(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_room_secure', {
    p_room_id: roomId,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
}

export async function fetchRoomDashboard(roomId: string): Promise<RoomDashboard> {
  const { data, error } = await supabase.rpc('room_dashboard_secure', {
    p_room_id: roomId,
  });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
  const payload = data as RoomDashboard | null;
  if (!payload || !payload.id) throw new Error(describeRoomError('not_found'));
  return payload;
}

export async function fetchMyRooms(): Promise<RoomSummary[]> {
  const { data, error } = await supabase
    .from('study_rooms')
    .select('id, title, goal_text, owner_id, created_at, room_members(count)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(describeRoomError(pgMessage(error)));
  return (data ?? []).map(
    (row: {
      id: string;
      title: string;
      goal_text: string;
      owner_id: string;
      created_at: string;
      room_members?: { count: number }[];
    }) => ({
      id: row.id,
      title: row.title,
      mission: row.goal_text,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      memberCount: row.room_members?.[0]?.count ?? 0,
    })
  );
}

export async function deleteRoomSecure(roomId: string): Promise<void> {
  const { error } = await supabase.from('study_rooms').delete().eq('id', roomId);
  if (error) throw new Error(describeRoomError(pgMessage(error)));
}
