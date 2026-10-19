// Unified study-room integration test.
// Verifies room_dashboard_secure returns real playlist items + embeddable,
// and that a non-member still cannot read the lesson payload. Uses only
// anon-key clients (signUp + RLS), matching the app's real auth path.
//
// Does NOT exercise the browser — actual video playback and two-browser
// realtime delivery are UNVERIFIED.
//
// Run: node scripts/room-unified-workspace.test.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1];

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`PASS: ${name}`); }
function bad(name, detail) { fail++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

const suffix = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'RoomUnified!1' + suffix;
const emails = {
  a: `room-uni-a-${suffix}@test.local`,
  b: `room-uni-b-${suffix}@test.local`,
  c: `room-uni-c-${suffix}@test.local`,
};
const clients = {};
const userIds = {};

async function getStudent(who) {
  const email = emails[who];
  const c = client();
  let res = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error) {
    res = await c.auth.signUp({ email, password: PASSWORD });
    if (res.error || !res.data?.user) {
      throw new Error(`setup failed for ${who}: ${res.error?.message ?? 'no user'}`);
    }
  }
  const u = await c.auth.getUser();
  if (u.error || !u.data.user) throw new Error(`getUser failed for ${who}: ${u.error?.message}`);
  clients[who] = c;
  userIds[who] = u.data.user.id;
}

async function ensureProfile(who) {
  const id = userIds[who];
  await clients[who].from('student_profiles').upsert({ id, display_name: `Student ${who.toUpperCase()} ${suffix}` });
}

(async () => {
  await getStudent('a');
  await getStudent('b');
  await getStudent('c');
  await ensureProfile('a');
  await ensureProfile('b');
  await ensureProfile('c');

  // ---- A imports a playlist resource (direct RLS insert, like the app) ----
  const playlistId = 'PLrAXtmErZgOeiKm4gsNOcdGmEwj' + suffix.slice(0, 4);
  const { data: resource, error: resErr } = await clients.a.from('user_resources').insert({
    source_type: 'playlist',
    youtube_id: playlistId,
    title: 'Algebra Basics',
    channel_name: 'MathTeacher',
    import_state: 'ready',
    metadata: {
      items: [
        { position: 0, video_id: 'dQw4w9WgXcQ', title: 'Intro to variables', channel_name: 'MathTeacher', duration_seconds: 300, available: true },
        { position: 1, video_id: '9bZkp7q19f0', title: 'Solving equations', channel_name: 'MathTeacher', duration_seconds: 450, available: true },
        { position: 2, video_id: 'XXXXXXXXXXX', title: 'Removed video', channel_name: 'MathTeacher', duration_seconds: null, available: false },
      ],
      truncated: false,
    },
  }).select('id').single();
  if (resErr) throw new Error('resource insert: ' + resErr.message);

  // ---- A creates a room linked to the playlist ----
  const { data: roomId, error: roomErr } = await clients.a.rpc('create_room_secure', {
    p_title: 'Algebra Study Room',
    p_mission: 'Master basic equations together',
    p_resource_id: resource.id,
  });
  if (roomErr) throw new Error('create_room_secure: ' + roomErr.message);

  // ---- #1 A dashboard returns real playlist items ----
  const { data: dashA, error: dashErrA } = await clients.a.rpc('room_dashboard_secure', { p_room_id: roomId });
  if (dashErrA) { bad('#1 A dashboard', dashErrA.message); throw new Error('stop'); }
  if (!dashA.lesson) { bad('#1 A dashboard has no lesson'); }
  else if (!Array.isArray(dashA.lesson.playlistItems) || dashA.lesson.playlistItems.length !== 3) {
    bad('#1 playlist items count', `got ${dashA.lesson.playlistItems?.length}`);
  } else {
    ok('#1 A dashboard returns 3 real playlist items');
    const first = dashA.lesson.playlistItems[0];
    if (first.video_id === 'dQw4w9WgXcQ' && first.title === 'Intro to variables') {
      ok('#2 playlist items carry real titles + video ids');
    } else {
      bad('#2 playlist item content', JSON.stringify(first));
    }
    if (dashA.lesson.playlistItems[2].available === false) {
      ok('#3 unavailable playlist item flagged available=false');
    } else {
      bad('#3 unavailable item not flagged', JSON.stringify(dashA.lesson.playlistItems[2]));
    }
    if (dashA.lesson.playlistTruncated === false) {
      ok('#4 playlistTruncated returned');
    } else {
      bad('#4 playlistTruncated missing');
    }
    if (dashA.lesson.sourceType === 'playlist') {
      ok('#5 lesson sourceType is playlist');
    } else {
      bad('#5 sourceType wrong: ' + dashA.lesson.sourceType);
    }
  }

  // ---- #6 Non-member C cannot read the dashboard ----
  const { data: dashC, error: dashErrC } = await clients.c.rpc('room_dashboard_secure', { p_room_id: roomId });
  if (dashErrC && /forbidden|not a member/i.test(dashErrC.message)) {
    ok('#6 non-member C denied room dashboard');
  } else if (dashC) {
    bad('#6 non-member C got dashboard (should be denied)');
  } else {
    ok('#6 non-member C denied room dashboard (via error)');
  }

  // ---- A invites B; B joins ----
  const { data: code, error: invErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 24 });
  if (invErr || !code) throw new Error('invite: ' + invErr?.message);
  const { error: redeemErr } = await clients.b.rpc('redeem_room_invite', { p_code: code });
  if (redeemErr) throw new Error('redeem: ' + redeemErr.message);

  // ---- #7 B (now member) sees the same playlist items ----
  const { data: dashB, error: dashErrB } = await clients.b.rpc('room_dashboard_secure', { p_room_id: roomId });
  if (dashErrB) { bad('#7 B dashboard', dashErrB.message); }
  else if (dashB.lesson && Array.isArray(dashB.lesson.playlistItems) && dashB.lesson.playlistItems.length === 3) {
    ok('#7 member B sees the same 3 playlist items');
    if (dashB.lesson.playlistItems[0].video_id === 'dQw4w9WgXcQ') {
      ok('#7b B sees identical playlist content (shared lesson context)');
    } else {
      bad('#7b B content differs');
    }
  } else {
    bad('#7 B cannot see playlist items');
  }

  // ---- #8 B cannot read A's private resource library directly ----
  const { data: bSeesResource } = await clients.b.from('user_resources').select('id').eq('id', resource.id);
  if (!bSeesResource || bSeesResource.length === 0) {
    ok('#8 member B cannot SELECT owner A private resource row directly');
  } else {
    bad('#8 B can read A private resource (RLS leak)');
  }

  // ---- #9 Single-video room returns embeddable ----
  const { data: vidResource, error: vidErr } = await clients.a.from('user_resources').insert({
    source_type: 'video',
    youtube_id: 'dQw4w9WgXcQ',
    title: 'Single Lesson',
    channel_name: 'MathTeacher',
    import_state: 'ready',
    metadata: { embeddable: true },
  }).select('id').single();
  if (vidErr) throw new Error('video resource insert: ' + vidErr.message);
  const { data: vidRoomId } = await clients.a.rpc('create_room_secure', {
    p_title: 'Single Video Room',
    p_mission: 'Watch one lesson',
    p_resource_id: vidResource.id,
  });
  const { data: vidDash } = await clients.a.rpc('room_dashboard_secure', { p_room_id: vidRoomId });
  if (vidDash?.lesson?.embeddable === true && vidDash?.lesson?.sourceType === 'video' && !Array.isArray(vidDash.lesson.playlistItems)) {
    ok('#9 single-video room returns embeddable=true, no playlist items');
  } else {
    bad('#9 single-video embeddable', JSON.stringify(vidDash?.lesson));
  }

  // ---- #10 C cannot read the single-video room either ----
  const { data: vidDashC, error: vidErrC } = await clients.c.rpc('room_dashboard_secure', { p_room_id: vidRoomId });
  if (vidErrC && /forbidden|not a member/i.test(vidErrC.message)) {
    ok('#10 non-member C denied single-video room dashboard');
  } else if (vidDashC) {
    bad('#10 non-member C got single-video dashboard');
  } else {
    ok('#10 non-member C denied single-video room dashboard (via error)');
  }

  // ---- Cleanup ----
  await clients.a.from('study_rooms').delete().eq('id', roomId);
  await clients.a.from('study_rooms').delete().eq('id', vidRoomId);
  await clients.a.from('user_resources').delete().eq('id', resource.id);
  await clients.a.from('user_resources').delete().eq('id', vidResource.id);
  await clients.a.from('student_profiles').delete().eq('id', userIds.a);
  await clients.b.from('student_profiles').delete().eq('id', userIds.b);
  await clients.c.from('student_profiles').delete().eq('id', userIds.c);

  console.log(`\nroom-unified-workspace: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
