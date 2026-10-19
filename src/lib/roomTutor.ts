import { supabase } from '@/lib/supabase';
import type { TutorMessage } from '@/lib/tutorCore';

const PAGE_SIZE = 30;

export class RoomTutorError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'rate_limited' | 'unavailable' | 'error'
  ) {
    super(message);
  }
}

interface ApiMessage {
  id: string;
  seq: number;
  room_id: string;
  sender_id: string;
  role: 'student' | 'ai';
  status: 'approved' | 'blocked';
  body: string;
  in_reply_to: string | null;
  client_request_id: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

function toTutorMessage(row: ApiMessage | Record<string, unknown>): TutorMessage {
  const r = row as ApiMessage;
  return {
    id: String(r.id),
    seq: Number(r.seq),
    roomId: String(r.room_id),
    senderId: String(r.sender_id),
    role: r.role === 'ai' ? 'ai' : 'student',
    status: r.status === 'blocked' ? 'blocked' : 'approved',
    body: String(r.body ?? ''),
    inReplyTo: r.in_reply_to,
    clientRequestId: String(r.client_request_id),
    createdAt: String(r.created_at),
    metadata: (r.metadata as TutorMessage['metadata']) ?? {},
  };
}

/** Newest page of approved + own messages for a room (ordered by seq). */
export async function fetchTutorMessages(roomId: string): Promise<{
  messages: TutorMessage[];
  hasMore: boolean;
}> {
  const { data, error } = await supabase
    .from('room_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('seq', { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (error) throw new RoomTutorError('Could not load the conversation.', 'error');
  const rows = (data ?? []) as ApiMessage[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { messages: page.reverse().map(toTutorMessage), hasMore };
}

/** Older page before a given seq for pagination. */
export async function fetchOlderTutorMessages(
  roomId: string,
  beforeSeq: number
): Promise<{ messages: TutorMessage[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from('room_messages')
    .select('*')
    .eq('room_id', roomId)
    .lt('seq', beforeSeq)
    .order('seq', { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (error) throw new RoomTutorError('Could not load earlier messages.', 'error');
  const rows = (data ?? []) as ApiMessage[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { messages: page.reverse().map(toTutorMessage), hasMore };
}

export interface AskTutorOk {
  status: 'ok';
  messages: TutorMessage[];
}
export interface AskTutorBlocked {
  status: 'blocked';
  reason: string;
}
export type AskTutorResult = AskTutorOk | AskTutorBlocked;

export async function askRoomTutor(params: {
  roomId: string;
  question: string;
  clientRequestId: string;
  /** Title of the video the student is currently watching (for AI context). */
  videoTitle?: string | null;
  /** YouTube id of the current video (for AI context attribution). */
  videoId?: string | null;
}): Promise<AskTutorResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new RoomTutorError('Sign in to ask the study tutor.', 'error');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-room-tutor`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      roomId: params.roomId,
      question: params.question,
      clientRequestId: params.clientRequestId,
      videoTitle: params.videoTitle ?? null,
      videoId: params.videoId ?? null,
    }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new RoomTutorError('The tutor service responded unexpectedly.', 'error');
  }
  const body = payload as { status?: string; messages?: ApiMessage[]; error?: string; reason?: string };

  if (res.status === 429) {
    throw new RoomTutorError(body.error ?? 'The tutor is busy. Try again shortly.', 'rate_limited');
  }
  if (res.status === 503 || res.status === 502) {
    throw new RoomTutorError(body.error ?? 'The tutor is unavailable. Your conversation is safe.', 'unavailable');
  }
  if (!res.ok) {
    throw new RoomTutorError(body.error ?? 'Something went wrong. Please try again.', 'error');
  }
  if (body.status === 'blocked') {
    return { status: 'blocked', reason: body.reason ?? 'This question cannot be shared.' };
  }
  if (body.status === 'ok' && Array.isArray(body.messages)) {
    return { status: 'ok', messages: body.messages.map(toTutorMessage) };
  }
  throw new RoomTutorError('The tutor service responded unexpectedly.', 'error');
}
