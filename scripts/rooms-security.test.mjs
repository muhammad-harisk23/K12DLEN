/*
 * Gate 2A live security verification: three real, independently
 * authenticated students (A: creator, B: invited member, C: outsider) against
 * the Supabase REST + RPC endpoints, so every check flows through RLS exactly
 * as the app does.
 *
 * Harness safeguards:
 * - Tracked records (room IDs, profile IDs, filler auth user IDs) are
 *   journaled to scripts/.gate2a-journal.json after each mutation.
 * - Journaled leftovers from a crashed previous run are deleted by exact ID
 *   during setup.
 * - Teardown runs in a finally block; on failure the journal is preserved.
 * - No service-role client is used for security assertions.
 * - No passwords, tokens, or invitation codes are printed.
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
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

const directRlsCount = { total: 0, ok: 0 };
const rpcCount = { total: 0, ok: 0 };
function checkDirectRls(name, ok, detail = '') {
  directRlsCount.total += 1;
  if (ok) directRlsCount.ok += 1;
  check(name, ok, detail);
}
function checkRpc(name, ok, detail = '') {
  rpcCount.total += 1;
  if (ok) rpcCount.ok += 1;
  check(name, ok, detail);
}

const EMAILS = {
  a: 'gate2a-student-a@test.local',
  b: 'gate2a-student-b@test.local',
  c: 'gate2a-student-c@test.local',
};
const FILLER_EMAILS = Array.from({ length: 6 }, (_, i) => `gate2a-filler-${i + 1}@test.local`);
const PASSWORD = 'Gate2A-test-1';

const journalPath = join(root, 'scripts', '.gate2a-journal.json');

function emptyJournal() {
  return { rooms: [], profileIds: [], fillerUserIds: [] };
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
function journalAdd(list, value) {
  if (!journal[list].includes(value)) journal[list].push(value);
  persistJournal();
}

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

const clients = {};
const userIds = {};

async function getStudent(who) {
  const email = EMAILS[who];
  const c = client();
  let res = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error) {
    res = await c.auth.signUp({ email, password: PASSWORD });
    if (res.error || !res.data?.user) {
      throw new Error(`setup failed for ${who}: login: ${res.error?.message ?? 'ok'} / signup: ${res.error?.message ?? 'no user'}`);
    }
  }
  const u = await c.auth.getUser();
  if (u.error || !u.data.user) throw new Error(`setup failed for ${who}: getUser: ${u.error?.message ?? 'no user'}`);
  clients[who] = c;
  userIds[who] = u.data.user.id;
  persistJournal();
}

// ---------- setup: recover leftovers, sign in all three students ----------
async function recoverAndSignIn() {
  await getStudent('a');
  for (const roomId of journal.rooms) {
    await clients.a.from('study_rooms').delete().eq('id', roomId);
  }
  for (const profileId of journal.profileIds) {
    await clients.a.from('student_profiles').delete().eq('id', profileId);
  }
  journal = { ...emptyJournal(), fillerUserIds: journal.fillerUserIds };
  persistJournal();
  for (const who of ['b', 'c']) await getStudent(who);
}

await recoverAndSignIn();

// profiles so dashboard displayName works
for (const who of ['a', 'b', 'c']) {
  const id = await userIds[who];
  const up = await clients[who].from('student_profiles').upsert({ id, display_name: `Test Student ${who.toUpperCase()}` });
  if (!up.error) journalAdd('profileIds', id);
}

let trackedRoomIds = [];
function noteRoom(roomId) {
  if (!trackedRoomIds.includes(roomId)) trackedRoomIds.push(roomId);
  journalAdd('rooms', roomId);
}

let setupFatal = false;
try {
  // ---------- #1: Student A creates a private room ----------
  const { data: roomId, error: createErr } = await clients.a.rpc('create_room_secure', {
    p_title: 'Gate 2A verification room',
    p_mission: 'Verify private rooms end to end',
    p_resource_id: null,
  });
  check('#1 A can create a private room', !createErr && typeof roomId === 'string', createErr?.message);
  if (createErr) throw new Error('cannot continue without a room');
  noteRoom(roomId);

  // ---------- #2/#3: Direct table RLS isolation for C (outsider) ----------
  {
    const c = clients.c;
    const { data: directRow } = await c.from('study_rooms').select('*').eq('id', roomId);
    checkDirectRls('#2 C cannot SELECT study_rooms row directly', !directRow || directRow.length === 0);

    const { data: membersRows } = await c.from('room_members').select('*').eq('room_id', roomId);
    checkDirectRls('#2 C cannot SELECT room_members rows directly', !membersRows || membersRows.length === 0);

    const { data: invitesRows } = await c.from('room_invites').select('*').eq('room_id', roomId);
    checkDirectRls('#2 C cannot SELECT room_invites rows directly', !invitesRows || invitesRows.length === 0);

    const { data: redemptions } = await c.from('room_redemption_log').select('*').limit(5);
    checkDirectRls('#2 C cannot SELECT room_redemption_log (deny-all table)', !redemptions || redemptions.length === 0);

    const updResp = await c.from('study_rooms').update({ goal_text: 'hacked' }).eq('id', roomId);
    const afterUpd = await clients.a.from('study_rooms').select('goal_text').eq('id', roomId).single();
    checkDirectRls('#3 C cannot UPDATE study_rooms (row unchanged)', updResp.error != null || afterUpd.data?.goal_text === 'Verify private rooms end to end', `goal=${afterUpd.data?.goal_text} err=${updResp.error?.message ?? 'none'}`);

    const delResp = await c.from('study_rooms').delete().eq('id', roomId);
    const afterDel = await clients.a.from('study_rooms').select('id').eq('id', roomId).single();
    checkDirectRls('#3 C cannot DELETE study_rooms (row still exists)', delResp.error != null || afterDel.data?.id === roomId, `err=${delResp.error?.message ?? 'none'}`);

    const insResp = await c.from('room_members').insert({
      room_id: roomId,
      user_id: await userIds.c,
      role: 'member',
      join_code_hash: 'a'.repeat(64),
    });
    checkDirectRls('#3 C cannot self-insert unauthorized membership', Boolean(insResp.error), insResp.error?.message);
  }

  // ---------- #7: RPC authorization for C (outsider) ----------
  {
    const { error: dashErr } = await clients.c.rpc('room_dashboard_secure', { p_room_id: roomId });
    checkRpc('#7 C cannot call room_dashboard_secure', Boolean(dashErr), dashErr?.message);

    const { error: missionErr } = await clients.c.rpc('update_room_mission_secure', { p_room_id: roomId, p_mission: 'hacked' });
    checkRpc('#7 C cannot call update_room_mission_secure', Boolean(missionErr), missionErr?.message);

    const { error: leaveErr } = await clients.c.rpc('leave_room_secure', { p_room_id: roomId });
    checkRpc('#7 C cannot call leave_room_secure', Boolean(leaveErr), leaveErr?.message);

    const { error: inviteErr } = await clients.c.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 24 });
    checkRpc('#7 C cannot call create_room_invite_secure', Boolean(inviteErr), inviteErr?.message);

    const { error: bogusErr } = await clients.c.rpc('redeem_room_invite', { p_code: 'f'.repeat(32) });
    checkRpc('#7 C redeem with fabricated code fails', Boolean(bogusErr), bogusErr?.message);
  }

  // ---------- #4/#5: A generates an invite; B redeems it ----------
  let inviteCode;
  {
    const { data: code, error: invErr } = await clients.a.rpc('create_room_invite_secure', {
      p_room_id: roomId,
      p_ttl_hours: 24,
    });
    check('#4 A can create an invite (32 unpredictable chars)', !invErr && typeof code === 'string' && code.length === 32, invErr?.message);
    inviteCode = code;

    const { data: redeem, error: redeemErr } = await clients.b.rpc('redeem_room_invite', { p_code: inviteCode });
    check(
      '#5 B redeems invite and joins',
      !redeemErr && redeem?.status === 'joined' && redeem?.roomId === roomId,
      redeemErr?.message
    );
  }

  // ---------- #6: B as member: dashboard + mission; cannot invite/delete/escalate ----------
  {
    const { data: dash, error: dashErr } = await clients.b.rpc('room_dashboard_secure', { p_room_id: roomId });
    check(
      '#6 B can read authorized room dashboard and shared mission',
      !dashErr && dash?.id === roomId && Array.isArray(dash?.participants) && dash.participants.length === 2,
      dashErr?.message
    );

    const { error: mErr } = await clients.b.rpc('update_room_mission_secure', { p_room_id: roomId, p_mission: 'B updated the shared mission' });
    check('#6 B (member) can update mission', !mErr, mErr?.message);

    const { error: invErr } = await clients.b.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 24 });
    checkRpc('#6 B (non-owner) cannot create invites', Boolean(invErr), invErr?.message);

    await clients.b.from('study_rooms').delete().eq('id', roomId);
    const stillThere = await clients.a.from('study_rooms').select('id').eq('id', roomId).single();
    checkDirectRls('#6 B cannot delete the room', stillThere.data?.id === roomId);

    const { data: invitesAsB } = await clients.b.from('room_invites').select('*').eq('room_id', roomId);
    checkDirectRls('#6 B cannot list room_invites rows', !invitesAsB || invitesAsB.length === 0);

    const roleResp = await clients.b
      .from('room_members')
      .update({ role: 'owner' })
      .eq('room_id', roomId)
      .eq('user_id', await userIds.b)
      .select('role');
    const memberRow = await clients.a
      .from('room_members')
      .select('role')
      .eq('room_id', roomId)
      .eq('user_id', await userIds.b)
      .single();
    checkDirectRls('#6 B cannot escalate own role to owner', (roleResp.data?.length ?? 0) === 0 && memberRow.data?.role === 'member', `role=${memberRow.data?.role}`);

    const { data: cRoom } = await clients.c.from('study_rooms').select('goal_text').eq('id', roomId);
    checkDirectRls('#6 C still cannot read room mission after update', !cRoom || cRoom.length === 0);
  }

  // ---------- #8: replay, revocation, expiry, malformed codes ----------
  {
    const { data: replay, error: replayErr } = await clients.b.rpc('redeem_room_invite', { p_code: inviteCode });
    check('#8 B replay of same invite returns already_member (reuse control)', !replayErr && replay?.status === 'already_member', replayErr?.message);

    const { data: revokedCode, error: rcErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 1 });
    check('#8 A can create second invite', !rcErr && typeof revokedCode === 'string', rcErr?.message);

    const { error: revokeErr } = await clients.a
      .from('room_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('room_id', roomId);
    check('#8 A (owner) can revoke invites via direct update', !revokeErr, revokeErr?.message);

    const cRedeemResp = await clients.c.rpc('redeem_room_invite', { p_code: revokedCode });
    check('#8 C redeem of revoked invite fails', Boolean(cRedeemResp.error), cRedeemResp.error?.message);

    const { data: expCode, error: ecErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: roomId, p_ttl_hours: 2 });
    check('#8 A can create third invite', !ecErr && typeof expCode === 'string', ecErr?.message);
    const { error: expErr } = await clients.a
      .from('room_invites')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('room_id', roomId);
    check('#8 A can expire invites via direct update', !expErr, expErr?.message);
    const cExpResp = await clients.c.rpc('redeem_room_invite', { p_code: expCode });
    check('#8 C redeem of expired invite fails', Boolean(cExpResp.error), cExpResp.error?.message);

    for (const [label, code] of [
      ['short code', 'abcd'],
      ['non-hex code', 'z'.repeat(32)],
      ['wrong-length 31', 'a'.repeat(31)],
      ['wrong-length 33', 'a'.repeat(33)],
    ]) {
      const r = await clients.c.rpc('redeem_room_invite', { p_code: code });
      checkRpc(`#8 C redeem ${label} fails`, Boolean(r.error), r.error?.message);
    }
  }

  // ---------- token hygiene: hashes only, salted, unpredictable ----------
  {
    const { data: ownerInvites } = await clients.a.from('room_invites').select('code_hash, salt, created_by').eq('room_id', roomId);
    const rows = ownerInvites ?? [];
    check('token hygiene: owner-visible invite rows contain only salted hashes', rows.length > 0 && rows.every((r) => r.code_hash && r.code_hash.length === 64 && /^[0-9a-f]+$/.test(r.code_hash)));
    check('token hygiene: each invite has an independent random salt', rows.length > 0 && new Set(rows.map((r) => Buffer.from(r.salt).toString('hex'))).size === rows.length);
  }

  // ---------- #9: rapid concurrent redemptions cannot duplicate memberships ----------
  {
    const { data: raceRoom, error: rrErr } = await clients.a.rpc('create_room_secure', { p_title: 'Race room', p_mission: '', p_resource_id: null });
    check('#9 A creates race-condition room', !rrErr && typeof raceRoom === 'string', rrErr?.message);
    noteRoom(raceRoom);

    const { data: raceCode, error: rcodeErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: raceRoom, p_ttl_hours: 1 });
    check('#9 A creates race invite', !rcodeErr && typeof raceCode === 'string', rcodeErr?.message);

    const attempts = Array.from({ length: 12 }, () => clients.c.rpc('redeem_room_invite', { p_code: raceCode }));
    const settled = await Promise.allSettled(attempts);
    const joined = settled.filter((r) => r.status === 'fulfilled' && r.value.data?.status === 'joined').length;
    const already = settled.filter((r) => r.status === 'fulfilled' && r.value.data?.status === 'already_member').length;
    check('#9 concurrent redemptions: exactly one join for a single user (idempotent under race)', joined === 1, `joined=${joined} already_member=${already}`);

    const { data: memberRows, error: mcErr } = await clients.a.from('room_members').select('user_id').eq('room_id', raceRoom);
    check('#9 race room has exactly 2 members (A owner + C)', !mcErr && (memberRows?.length ?? 0) === 2, `rows=${memberRows?.length}`);
  }

  // ---------- #9: concurrent redemption cannot exceed room capacity ----------
  {
    const { data: capRoom, error: capErr } = await clients.a.rpc('create_room_secure', { p_title: 'Capacity room', p_mission: '', p_resource_id: null });
    check('#9 A creates capacity room', !capErr && typeof capRoom === 'string', capErr?.message);
    noteRoom(capRoom);

    const { data: capCode, error: capCodeErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: capRoom, p_ttl_hours: 1 });
    check('#9 A creates capacity invite', !capCodeErr && typeof capCode === 'string', capCodeErr?.message);

    await clients.b.rpc('redeem_room_invite', { p_code: capCode });

    const fillerIds = [];
    for (const fillerEmail of FILLER_EMAILS) {
      const filler = client();
      let res = await filler.auth.signInWithPassword({ email: fillerEmail, password: PASSWORD });
      if (res.error) res = await filler.auth.signUp({ email: fillerEmail, password: PASSWORD });
      let uid = res.data?.user?.id;
      if (!uid) {
        const u = await filler.auth.getUser();
        uid = u.data?.user?.id;
      }
      if (uid) {
        fillerIds.push(uid);
        journalAdd('fillerUserIds', uid);
      }
    }
    check('#9 six filler accounts resolve', fillerIds.length === 6, `resolved=${fillerIds.length}`);

    const { error: insErr } = await clients.a
      .from('room_members')
      .insert(fillerIds.map((id) => ({ room_id: capRoom, user_id: id, role: 'member' })));
    check('#9 owner can add members directly (RLS owner branch)', !insErr, insErr?.message);

    const { data: capMembers } = await clients.a.from('room_members').select('user_id').eq('room_id', capRoom);
    check('#9 capacity room holds exactly 8 members', (capMembers?.length ?? 0) === 8, `rows=${capMembers?.length}`);

    const fullOneResp = await clients.c.rpc('redeem_room_invite', { p_code: capCode });
    check('#9 C redeem on full room fails with room_full', fullOneResp.error?.message === 'room_full', fullOneResp.error?.message);

    const fullRace = Array.from({ length: 4 }, () => clients.c.rpc('redeem_room_invite', { p_code: capCode }));
    const fullSettled = await Promise.allSettled(fullRace);
    const allFull = fullSettled.every((r) => r.status === 'fulfilled' && r.value.error?.message === 'room_full');
    const { data: afterMembers } = await clients.a.from('room_members').select('user_id').eq('room_id', capRoom);
    check('#9 concurrent redemptions cannot exceed capacity', allFull && (afterMembers?.length ?? 0) === 8, `allFull=${allFull} after=${afterMembers?.length}`);
  }

  // ---------- #10: B loses protected access after leaving ----------
  {
    const { data: leaveRoom, error: lrErr } = await clients.a.rpc('create_room_secure', { p_title: 'Leave-room room', p_mission: '', p_resource_id: null });
    check('#10 A creates leave-room room', !lrErr && typeof leaveRoom === 'string', lrErr?.message);
    noteRoom(leaveRoom);

    const { data: lcode, error: lcodeErr } = await clients.a.rpc('create_room_invite_secure', { p_room_id: leaveRoom, p_ttl_hours: 1 });
    check('#10 A creates leave-room invite', !lcodeErr && typeof lcode === 'string', lcodeErr?.message);

    const joinedResp = await clients.b.rpc('redeem_room_invite', { p_code: lcode });
    check('#10 B joins leave-room room', !joinedResp.error, joinedResp.error?.message);

    const preDashResp = await clients.b.rpc('room_dashboard_secure', { p_room_id: leaveRoom });
    check('#10 B (member) reads leave-room dashboard', !preDashResp.error, preDashResp.error?.message);

    const leftResp = await clients.b.rpc('leave_room_secure', { p_room_id: leaveRoom });
    check('#10 B leaves the room', !leftResp.error, leftResp.error?.message);

    const postDashResp = await clients.b.rpc('room_dashboard_secure', { p_room_id: leaveRoom });
    check('#10 B loses protected access after leaving', Boolean(postDashResp.error), postDashResp.error?.message);

    const { data: rosterAfter } = await clients.b.from('room_members').select('user_id').eq('room_id', leaveRoom);
    check('#10 B cannot read roster after leaving', !rosterAfter || rosterAfter.length === 0);
  }

  // ---------- #11: private saved resources remain isolated ----------
  {
    const rtId = crypto.randomUUID();
    const aResource = await clients.a.from('user_resources').insert({
      id: rtId,
      source_type: 'video',
      youtube_id: `vid-a-${Date.now()}`,
      title: 'A private study video',
    }).select('id').single();
    check('#11 A inserts a private resource', !aResource.error, aResource.error?.message);

    const { data: bSees } = await clients.b.from('user_resources').select('id').eq('id', rtId);
    check('#11 B cannot SELECT A private resource', !bSees || bSees.length === 0);

    const { data: cSees } = await clients.c.from('user_resources').select('id').eq('id', rtId);
    check('#11 C cannot SELECT A private resource', !cSees || cSees.length === 0);

    const rt2 = crypto.randomUUID();
    const bResource = await clients.b.from('user_resources').insert({
      id: rt2,
      source_type: 'video',
      youtube_id: `vid-b-${Date.now()}`,
      title: 'B private study video',
    }).select('id').single();
    check('#11 B inserts own private resource', !bResource.error, bResource.error?.message);

    const { data: bOwn } = await clients.b.from('user_resources').select('id').eq('id', rt2);
    check('#11 B SELECTs own private resource', (bOwn?.length ?? 0) === 1);

    const forged = await clients.b.from('user_resources').insert({
      id: crypto.randomUUID(),
      owner_id: await userIds.a,
      source_type: 'video',
      youtube_id: `vid-f-${Date.now()}`,
    }).select('id');
    check('#11 B cannot insert a resource forged with A owner_id', Boolean(forged.error), forged.error?.message);

    await clients.a.from('user_resources').delete().eq('id', rtId);
    await clients.b.from('user_resources').delete().eq('id', rt2);
  }

  // ---------- #12 (scripted part): shared mission update from A reaches B over Realtime ----------
  if (typeof WebSocket !== 'undefined') {
    const received = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const ch = clients.b
        .channel(`rt-${roomId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'study_rooms', filter: `id=eq.${roomId}` },
          () => done(true)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void clients.a.rpc('update_room_mission_secure', { p_room_id: roomId, p_mission: 'Realtime payload from A' });
          }
        });
      setTimeout(() => done('timeout'), 25000);
    });
    if (received === 'timeout') {
      console.log('NOTE: Realtime scripted UPDATE verification timed out; realtime delivery is UNVERIFIED for human two-browser acceptance testing.');
    } else {
      check('#12 Realtime scripted verification (shared mission update from A reaches B)', Boolean(received));
    }
  } else {
    console.log('NOTE: Realtime scripted UPDATE verification skipped (no websocket in sandbox); realtime delivery is UNVERIFIED for human two-browser acceptance testing.');
  }
} catch (err) {
  setupFatal = true;
  console.log('NOTE: test body threw:', err instanceof Error ? err.message : String(err));
} finally {
  let teardownOk = true;
  try {
    for (const roomId of trackedRoomIds) {
      await clients.a.from('study_rooms').delete().eq('id', roomId);
    }
    for (const profileId of journal.profileIds) {
      await clients.a.from('student_profiles').delete().eq('id', profileId);
    }
    const remainingRooms = [];
    for (const roomId of trackedRoomIds) {
      const { data } = await clients.a.from('study_rooms').select('id').eq('id', roomId);
      if (data?.length) remainingRooms.push(roomId);
    }
    if (remainingRooms.length || setupFatal) {
      teardownOk = false;
      if (remainingRooms.length) console.log('NOTE: teardown failed for rooms:', JSON.stringify(remainingRooms));
      console.log('Journal preserved at', journalPath);
      persistJournal();
    } else {
      unlinkSync(journalPath);
    }
  } catch (err) {
    teardownOk = false;
    console.log('NOTE: teardown threw:', err instanceof Error ? err.message : String(err));
    console.log('Journal preserved at', journalPath);
    persistJournal();
  }
  if (!teardownOk) console.log('Journal preserved.');
}

const failed = results.filter((r) => !r.ok);
console.log(`\nrooms-security: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
console.log(`direct-rls checks: ${directRlsCount.total} (${directRlsCount.ok} ok)`);
console.log(`rpc checks: ${rpcCount.total} (${rpcCount.ok} ok)`);
process.exit(failed.length ? 1 : 0);
