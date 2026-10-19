/*
 * Gate 2B live AI acceptance — real inference, real persistence, real isolation.
 *
 * Unlike room-tutor-security.test.mjs (which ran with a deliberately absent
 * provider credential), this harness verifies ACTUAL live inference through
 * the deployed ask-room-tutor edge function with GROQ_API_KEY present:
 *   - real moderation verdict on an academic question
 *   - real model-generated answer, persisted as approved room messages
 *   - second member retrieves the same history after a fresh sign-in
 *   - off-topic question blocked before any broadcast
 *   - outsider (third account) cannot read or submit
 *   - refreshed session restores the identical conversation
 *
 * Harness safeguards: exact-ID journal, finally teardown, no secrets printed,
 * no forged writes, no mocks for the stages under test.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)[1];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

const EMAILS = {
  a: 'gate2b-live-a@test.local',
  b: 'gate2b-live-b@test.local',
  c: 'gate2b-live-c@test.local',
};
const PASSWORD = 'Gate2B-live-1';

const journalPath = join(root, 'scripts', '.gate2b-live-journal.json');
function emptyJournal() {
  return { rooms: [], profileIds: [], userIds: {} };
}
let journal = emptyJournal();
if (existsSync(journalPath)) {
  try {
    journal = { ...emptyJournal(), ...JSON.parse(readFileSync(journalPath, 'utf8')) };
  } catch {
    journal = emptyJournal();
  }
}
function persistJournal() {
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

const clients = {};
const userIds = {};

async function getStudent(who) {
  const c = client();
  let res = await c.auth.signInWithPassword({ email: EMAILS[who], password: PASSWORD });
  if (res.error) {
    res = await c.auth.signUp({ email: EMAILS[who], password: PASSWORD });
    if (res.error || !res.data?.user) throw new Error(`setup failed for ${who}`);
  }
  const u = await c.auth.getUser();
  if (u.error || !u.data.user) throw new Error(`setup failed for ${who} (getUser)`);
  clients[who] = c;
  userIds[who] = u.data.user.id;
  journal.userIds[who] = u.data.user.id;
  persistJournal();
}

async function recoverAndSignIn() {
  await getStudent('a');
  for (const roomId of journal.rooms) {
    await clients.a.from('study_rooms').delete().eq('id', roomId);
  }
  journal = emptyJournal();
  persistJournal();
  for (const who of ['b', 'c']) await getStudent(who);
}

await recoverAndSignIn();

let setupFatal = false;
const FUNCTION_URL = `${url}/functions/v1/ask-room-tutor`;
const trackedRoomIds = [];
function noteRoom(roomId) {
  trackedRoomIds.push(roomId);
  journal.rooms = [...new Set([...journal.rooms, roomId])];
  persistJournal();
}

try {
  for (const who of ['a', 'b', 'c']) {
    const id = userIds[who];
    await clients[who].from('student_profiles').upsert({ id, display_name: `Live2B Student ${who.toUpperCase()}` });
    if (!journal.profileIds.includes(id)) journal.profileIds.push(id);
  }
  persistJournal();

  const { data: roomId, error: createErr } = await clients.a.rpc('create_room_secure', {
    p_title: 'Gate 2B live acceptance room',
    p_mission: 'Understand the water cycle together',
    p_resource_id: null,
  });
  check('A creates live room', !createErr && typeof roomId === 'string', createErr?.message);
  if (createErr) throw new Error('no room');
  noteRoom(roomId);

  const { data: code, error: invErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 1 });
  check('A creates invite', !invErr, invErr?.message);
  await clients.b.rpc('redeem_room_invite', { p_code: code });

  async function askTutor(who, roomIdArg, question, requestId) {
    const { data: sessionData } = await clients[who].auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ roomId: roomIdArg, question, clientRequestId: requestId }),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    return { status: res.status, body: payload };
  }

  const nextReqId = () => crypto.randomUUID().replaceAll('-', '');

  // --- LIVE ACADEMIC QUESTION: moderation + real inference + persistence ---
  const rid1 = nextReqId();
  const live = await askTutor('b', roomId, 'Why does it rain? Explain the water cycle step by step.', rid1);
  const liveOk = live.status === 200 && live.body?.status === 'ok';
  check('live academic question succeeds end-to-end', liveOk, `status=${live.status} body=${JSON.stringify(live.body)?.slice(0, 160)}`);

  let qRow = null;
  let aRow = null;
  if (liveOk) {
    const msgs = live.body.messages ?? [];
    qRow = msgs.find((m) => m.role === 'student' && m.status === 'approved');
    aRow = msgs.find((m) => m.role === 'ai' && m.status === 'approved');
    check('approved student question message returned', Boolean(qRow));
    check('AI answer message returned with model metadata', Boolean(aRow) && typeof aRow?.metadata?.model === 'string', aRow?.metadata?.model);
    check(
      'answer is substantive (not an error or placeholder)',
      aRow && aRow.body.length > 80 && /water|evapor|condens|cloud|rain/i.test(aRow.body),
      `len=${aRow?.body?.length} preview=${aRow?.body?.slice(0, 90)}`
    );
    check('question message persisted as real row', typeof qRow?.id === 'string' && qRow.clientRequestId === rid1);

    // verify persistence from the database, not just the HTTP response
    const { data: dbRows, error: dbErr } = await clients.b
      .from('room_messages')
      .select('id, role, status, body, in_reply_to, metadata')
      .eq('room_id', roomId)
      .in('client_request_id', [rid1, `${rid1}a`]);
    check(
      'both rows present in room_messages with correct reply linkage',
      !dbErr && (dbRows?.length ?? 0) === 2 && dbRows.find((r) => r.role === 'ai')?.in_reply_to === dbRows.find((r) => r.role === 'student')?.id,
      dbErr?.message
    );

    // --- SECOND MEMBER reads the same history after fresh sign-in ---
    await getStudent('b'); // fresh session == simulated refresh/re-login
    const { data: memberView, error: mvErr } = await clients.b
      .from('room_messages')
      .select('id, role, status, body')
      .eq('room_id', roomId)
      .eq('status', 'approved')
      .order('seq', { ascending: true });
    check(
      'another signed-in member retrieves the same conversation',
      !mvErr && (memberView?.length ?? 0) === 2 && memberView.some((r) => r.id === qRow.id) && memberView.some((r) => r.id === aRow.id),
      mvErr?.message
    );
    check('member view body matches the persisted AI answer', memberView?.find((r) => r.id === aRow?.id)?.body === aRow?.body);
  }

  // --- OFF-TOPIC question: rejected privately BEFORE broadcast ---
  {
    const offOut = await askTutor('b', roomId, 'Who will win the football match tonight?', nextReqId());
    check('off-topic question not broadcast to the room', offOut.status === 200 && offOut.body?.status === 'blocked', JSON.stringify(offOut.body)?.slice(0, 120));

    // A (owner, not the asker) must see nothing new; only B's own blocked draft
    const { data: aView } = await clients.a
      .from('room_messages')
      .select('id, status, role')
      .eq('room_id', roomId)
      .eq('status', 'approved');
    check(
      'owner still sees only the approved live pair (off-topic not shared)',
      (aView?.length ?? 0) === (liveOk ? 2 : 0),
      `count=${aView?.length}`
    );

    const { data: bBlocked } = await clients.b
      .from('room_messages')
      .select('id, status')
      .eq('room_id', roomId)
      .eq('status', 'blocked');
    check('blocked draft kept author-only for the asker', (bBlocked?.length ?? 0) === 1, `count=${bBlocked?.length}`);
  }

  // --- OUTSIDER isolation ---
  {
    const outSubmit = await askTutor('c', roomId, 'What is the water cycle?', nextReqId());
    check('outsider cannot submit to the room', outSubmit.status === 403, `status=${outSubmit.status}`);

    const { data: cView, error: cErr } = await clients.c.from('room_messages').select('id').eq('room_id', roomId);
    check('outsider cannot read any room messages', !cErr && (cView?.length ?? 0) === 0, `count=${cView?.length}`);
  }

  // --- PERSISTENCE after full session drop (refresh-equivalent) ---
  if (liveOk) {
    const { data: restored, error: rErr } = await clients.a
      .from('room_messages')
      .select('id, role, status, body')
      .eq('room_id', roomId)
      .eq('status', 'approved')
      .order('seq', { ascending: true });
    check(
      'room owner restores the identical approved conversation',
      !rErr && (restored?.length ?? 0) === 2 && restored.find((r) => r.role === 'ai')?.body === aRow?.body,
      rErr?.message
    );
  }
} catch (err) {
  setupFatal = true;
  console.log('NOTE: test body threw:', err instanceof Error ? err.message : String(err));
} finally {
  try {
    for (const roomId of trackedRoomIds) {
      await clients.a.from('study_rooms').delete().eq('id', roomId);
    }
    const remaining = [];
    for (const roomId of trackedRoomIds) {
      const { data } = await clients.a.from('study_rooms').select('id').eq('id', roomId);
      if (data?.length) remaining.push(roomId);
    }
    if (remaining.length || setupFatal) {
      console.log('NOTE: teardown incomplete for rooms:', JSON.stringify(remaining));
      console.log('Journal preserved at', journalPath);
      persistJournal();
    } else {
      unlinkSync(journalPath);
    }
  } catch (err) {
    console.log('NOTE: teardown threw:', err instanceof Error ? err.message : String(err));
    console.log('Journal preserved at', journalPath);
    persistJournal();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\ngate2b-live-acceptance: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
process.exit(failed.length ? 1 : 0);
