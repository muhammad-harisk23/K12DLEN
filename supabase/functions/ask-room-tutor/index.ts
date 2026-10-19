// ask-room-tutor edge function — Gate 2B shared academic AI for study rooms.
//
// POST { roomId, question, clientRequestId }
// Auth: requires a valid Supabase user JWT (verify_jwt = true).
// Pipeline: authenticate -> verify membership -> validate -> prefilter ->
// LLM moderation (fail-closed) -> build grounded prompt -> provider call
// -> output safety checks -> persist approved pair (or author-only blocked
// draft) -> realtime delivers approved rows to members.
//
// Secrets: GROQ_API_KEY is read from server-side env only; never returned
// or logged. Idempotency via (room_id, sender_id, client_request_id).
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { GroqProvider } from './providerAdapter.ts';
import {
  MAX_ANSWER_LEN,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_LEN,
  MODERATOR_SYSTEM_PROMPT,
  TUTOR_SYSTEM_PROMPT,
  buildUserPrompt,
  isProfanityHit,
  looksLikeInjection,
  preModerate,
} from './tutorLogic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Rate limits
const PER_USER_HOUR = 20;
const PER_ROOM_HOUR = 60;

const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoomMessageRow {
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

function toClient(row: RoomMessageRow) {
  return {
    id: row.id,
    seq: Number(row.seq),
    roomId: row.room_id,
    senderId: row.sender_id,
    role: row.role,
    status: row.status,
    body: row.body,
    inReplyTo: row.in_reply_to,
    clientRequestId: row.client_request_id,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

async function logOutcome(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  userId: string,
  outcome: string
): Promise<void> {
  const { error } = await admin.from('room_ai_request_log').insert({ room_id: roomId, user_id: userId, outcome });
  if (error) console.error('request log insert failed', error.message);
}

async function countRequests(
  admin: ReturnType<typeof createClient>,
  column: 'user_id' | 'room_id',
  value: string
): Promise<number> {
  const windowStart = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await admin
    .from('room_ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .gte('created_at', windowStart);
  if (error) {
    console.error('rate count failed', error.message);
    return 0; // fail open on our own logging failure, not on provider limits
  }
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return json(405, { error: 'Method not allowed.' });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(401, { error: 'Sign in to ask the study tutor.' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // --- 1. Authenticate ---
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return json(401, { error: 'Sign in to ask the study tutor.' });
    }
    const userId = userData.user.id;

    // --- 2. Input validation ---
    let body: {
      roomId?: unknown;
      question?: unknown;
      clientRequestId?: unknown;
      videoTitle?: unknown;
      videoId?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Invalid request body.' });
    }
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const question = typeof body.question === 'string' ? body.question : '';
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : '';
    // Optional student-selected video context for grounded answers. The
    // videoId is a YouTube id (11 chars, [A-Za-z0-9_-]); the title is free
    // text we cap at 160 chars. Both are surfaced to the LLM as metadata
    // only — never claimed as watched content.
    const videoIdRaw = typeof body.videoId === 'string' ? body.videoId.trim() : '';
    const videoTitleRaw = typeof body.videoTitle === 'string' ? body.videoTitle.trim() : '';
    const currentVideoId = /^[A-Za-z0-9_-]{6,20}$/.test(videoIdRaw) ? videoIdRaw : null;
    const currentVideoTitle = videoTitleRaw.length > 0 && videoTitleRaw.length <= 160 ? videoTitleRaw : null;
    if (!UUID_RE.test(roomId)) return json(400, { error: 'Invalid room.' });
    if (!REQUEST_ID_RE.test(clientRequestId)) return json(400, { error: 'Invalid request identifier.' });

    // --- 3. Membership verification (server-side) ---
    const { data: membership, error: memberError } = await admin
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memberError) {
      console.error('membership check failed', memberError.message);
      return json(500, { error: 'Could not verify the room. Please try again.' });
    }
    if (!membership) {
      return json(403, { error: 'You are not a member of this room.' });
    }

    // --- 4. Idempotency: same key returns the stored result, no new inference ---
    const { data: existing } = await admin
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .eq('sender_id', userId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (existing) {
      const row = existing as RoomMessageRow;
      if (row.status === 'blocked') {
        return json(200, {
          status: 'blocked',
          reason: 'This question was not shared with the room.',
          blocked: true,
          messages: [toClient(row)],
        });
      }
      const { data: reply } = await admin
        .from('room_messages')
        .select('*')
        .eq('in_reply_to', row.id)
        .maybeSingle();
      const messages = reply ? [toClient(row), toClient(reply as RoomMessageRow)] : [toClient(row)];
      return json(200, { status: 'ok', messages });
    }

    // --- 5. Question bounds ---
    const trimmed = question.trim();
    if (!trimmed) return json(400, { error: 'Ask a question first.' });
    if (trimmed.length > MAX_QUESTION_LEN) {
      return json(400, { error: `Questions are limited to ${MAX_QUESTION_LEN} characters.` });
    }

    // --- 6. Rate limits (per user + per room, rolling hour) ---
    const [userCount, roomCount] = await Promise.all([
      countRequests(admin, 'user_id', userId),
      countRequests(admin, 'room_id', roomId),
    ]);
    if (userCount >= PER_USER_HOUR || roomCount >= PER_ROOM_HOUR) {
      await logOutcome(admin, roomId, userId, 'rate_limited');
      return json(429, { error: 'The tutor is busy right now. Try again a little later.' });
    }
    await logOutcome(admin, roomId, userId, 'attempted');

    // --- 7. Grounded context from server-side data ---
    const { data: room } = await admin
      .from('study_rooms')
      .select('title, goal_text, chapter_id, resource_id')
      .eq('id', roomId)
      .maybeSingle();
    if (!room) return json(404, { error: 'This room could not be found.' });

    let subjectName: string | null = null;
    let lessonTitle: string | null = null;
    let lessonChannel: string | null = null;
    let lessonType: 'video' | 'playlist' | null = null;

    if (room.chapter_id) {
      const { data: chapterRow } = await admin
        .from('chapters')
        .select('title, subjects!inner(name)')
        .eq('id', room.chapter_id)
        .maybeSingle();
      const ch = chapterRow as { title: string; subjects: { name: string } } | null;
      if (ch) subjectName = [ch.subjects?.name, ch.title].filter(Boolean).join(' — ') || null;
    }
    if (room.resource_id) {
      const { data: res } = await admin
        .from('user_resources')
        .select('title, channel_name, source_type')
        .eq('id', room.resource_id)
        .maybeSingle();
      if (res) {
        lessonTitle = res.title ?? null;
        lessonChannel = res.channel_name ?? null;
        lessonType = res.source_type === 'playlist' ? 'playlist' : 'video';
      }
    }

    const { data: historyRows } = await admin
      .from('room_messages')
      .select('role, body')
      .eq('room_id', roomId)
      .eq('status', 'approved')
      .order('seq', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES);
    const history = (historyRows ?? [] as { role: 'student' | 'ai'; body: string }[])
      .reverse()
      .map((r: { role: 'student' | 'ai'; body: string }) => ({ role: r.role, body: r.body }));

    // --- 8. Moderation BEFORE broadcast ---
    const verdict = preModerate(trimmed);
    if (!verdict.allowed) {
      await persistBlocked(admin, roomId, userId, clientRequestId, trimmed, verdict.label);
      return json(200, { status: 'blocked', reason: verdict.reason ?? 'This question cannot be shared.', blocked: true });
    }
    if (isProfanityHit(trimmed) || looksLikeInjection(trimmed)) {
      await persistBlocked(admin, roomId, userId, clientRequestId, trimmed, looksLikeInjection(trimmed) ? 'injection' : 'profanity');
      return json(200, { status: 'blocked', reason: 'This question cannot be shared with the room.', blocked: true });
    }

    const groqKey = Deno.env.get('GROQ_API_KEY');
    let moderationLabel = 'llm_moderator';
    if (groqKey) {
      const moderator = new GroqProvider(groqKey, 'openai/gpt-oss-20b', 12000, 0);
      const modResult = await moderator.generateAnswer({
        systemPrompt: MODERATOR_SYSTEM_PROMPT,
        userPrompt: `SUBJECT: ${subjectName ?? 'unknown'}\nMISSION: ${(room.goal_text ?? '').slice(0, 280)}\nSUBMITTED TEXT: ${trimmed}`,
        maxTokens: 1024,
        timeoutMs: 12000,
      });
      let verdict2: { allowed: boolean; label: string; reason: string | null } | null = null;
      if (modResult.kind === 'generated') {
        verdict2 = parseVerdict(modResult.text);
      }
      if (!verdict2) {
        // Fail closed: moderation unavailable/inconclusive -> do not broadcast.
        await persistBlocked(admin, roomId, userId, clientRequestId, trimmed, 'moderation_unavailable');
        return json(200, {
          status: 'blocked',
          reason: 'We could not review this question right now, so it was not shared. Try again shortly.',
          blocked: true,
          retryable: true,
        });
      }
      if (!verdict2.allowed) {
        await persistBlocked(admin, roomId, userId, clientRequestId, trimmed, verdict2.label);
        return json(200, { status: 'blocked', reason: 'A study room keeps questions on school topics.', blocked: true });
      }
      moderationLabel = verdict2.label;
    } else {
      // No provider configured: fail closed rather than broadcast unreviewed.
      await persistBlocked(admin, roomId, userId, clientRequestId, trimmed, 'provider_unconfigured');
      return json(200, {
        status: 'blocked',
        reason: 'The AI tutor is not available yet. Your question was not shared.',
        blocked: true,
      });
    }

    // --- 9. Provider call ---
    const provider = new GroqProvider(groqKey!, 'openai/gpt-oss-20b', 20000, 1);
    const result = await provider.generateAnswer({
      systemPrompt: TUTOR_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        mission: room.goal_text ?? '',
        subjectName,
        lessonTitle,
        lessonChannel,
        lessonType,
        currentVideoTitle,
        currentVideoId,
        history,
        question: trimmed,
      }),
      maxTokens: 2000,
      timeoutMs: 20000,
    });

    if (result.kind === 'unavailable') {
      await logOutcome(admin, roomId, userId, 'provider_error');
      return json(503, {
        error: result.temporary
          ? 'The tutor is temporarily unavailable. Your earlier conversation is safe — try again shortly.'
          : 'The tutor is at its usage limit for now. Your conversation is safe — try again later.',
        retryAfter: result.retryAfterSeconds,
      });
    }
    if (result.kind === 'error') {
      await logOutcome(admin, roomId, userId, 'provider_error');
      return json(502, { error: 'The tutor could not answer right now. Your conversation is safe.' });
    }

    // --- 10. Output safety validation before publication ---
    const answer = result.text;
    if (answer.length > MAX_ANSWER_LEN || isProfanityHit(answer) || looksLikeInjection(answer)) {
      await logOutcome(admin, roomId, userId, 'output_rejected');
      return json(502, { error: 'The tutor produced an unsafe answer. Please rephrase and try again.' });
    }

    // --- 11. Persist approved pair (service role; clients cannot write here) ---
    const { data: questionRow, error: qErr } = await admin
      .from('room_messages')
      .insert({
        room_id: roomId,
        sender_id: userId,
        role: 'student',
        status: 'approved',
        body: trimmed,
        client_request_id: clientRequestId,
        context: { subject: subjectName, lessonTitle, lessonType, videoTitle: currentVideoTitle, videoId: currentVideoId },
        metadata: { model: result.model, moderationLabel },
      })
      .select('*')
      .single();
    if (qErr || !questionRow) {
      console.error('question persist failed', qErr?.message);
      // Idempotency race: another identical request won the insert.
      const { data: raced } = await admin
        .from('room_messages')
        .select('*')
        .eq('room_id', roomId)
        .eq('sender_id', userId)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      if (raced) {
        const racedRow = raced as RoomMessageRow;
        const { data: racedReply } = await admin
          .from('room_messages')
          .select('*')
          .eq('in_reply_to', racedRow.id)
          .maybeSingle();
        const messages = racedReply ? [toClient(racedRow), toClient(racedReply as RoomMessageRow)] : [toClient(racedRow)];
        return json(200, { status: 'ok', messages });
      }
      return json(500, { error: 'Could not save the conversation. Please try again.' });
    }

    // Answer row uses a derived request id: the idempotency unique index is
    // (room_id, sender_id, client_request_id), which the question row already
    // occupies under the client-supplied key.
    const answerRequestId = `${clientRequestId}a`;
    const { data: answerRow, error: aErr } = await admin
      .from('room_messages')
      .insert({
        room_id: roomId,
        sender_id: userId,
        role: 'ai',
        status: 'approved',
        body: answer,
        in_reply_to: (questionRow as RoomMessageRow).id,
        client_request_id: answerRequestId,
        metadata: { model: result.model },
      })
      .select('*')
      .single();
    if (aErr || !answerRow) {
      console.error('answer persist failed', aErr?.message);
      await logOutcome(admin, roomId, userId, 'provider_error');
      return json(500, { error: 'Could not save the answer. Please try again.' });
    }

    await logOutcome(admin, roomId, userId, 'succeeded');
    return json(200, {
      status: 'ok',
      messages: [toClient(questionRow as RoomMessageRow), toClient(answerRow as RoomMessageRow)],
    });
  } catch (err) {
    console.error('ask-room-tutor failed', err instanceof Error ? err.message : String(err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
});

async function persistBlocked(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  userId: string,
  clientRequestId: string,
  body: string,
  label: string
): Promise<void> {
  const { error } = await admin.from('room_messages').insert({
    room_id: roomId,
    sender_id: userId,
    role: 'student',
    status: 'blocked',
    body,
    client_request_id: clientRequestId,
    metadata: { moderationLabel: label },
  });
  if (error) console.error('blocked draft persist failed', error.message);
}

function parseVerdict(text: string): { allowed: boolean; label: string; reason: string | null } | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { allowed?: unknown; label?: unknown };
    if (typeof parsed.allowed !== 'boolean') return null;
    const label = typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim().slice(0, 40) : 'moderator';
    return parsed.allowed
      ? { allowed: true, label, reason: null }
      : { allowed: false, label: `mod:${label}`, reason: 'A study room keeps questions on school topics.' };
  } catch {
    return null;
  }
}
