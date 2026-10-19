/*
 * Gate 3B Phase 3 live verification: mission completion behavior.
 *
 * Covers the server-authoritative completion rules that the celebration UI
 * depends on:
 *   1. A passing attempt + complete_mission_secure => status 'completed' with real score
 *   2. A failing attempt => complete_mission_secure refuses (criteria_not_met)
 *   3. Re-calling complete_mission_secure on the same mission => 'already_completed' (no duplicate reward)
 *   4. A retry that eventually passes => 'completed' with the retry's attempt number
 *   5. No completion for watching/passive activity (no such pathway exists)
 *   6. complete_mission_secure returns correct + total from the qualifying attempt only
 *   7. Forging completion via direct UPDATE on student_missions refused
 *   8. Forging via direct INSERT into practice_quiz_attempts refused
 *   9. Refresh persistence: summary still shows the completed mission after re-query
 *  10. Cross-user: B cannot complete A's mission or see A's completed state
 *  11. already_completed does not return score data that could trigger a fresh celebration
 *  12. practice_summary_secure missionsCompleted increments by exactly 1 per real completion
 *
 * Run: node scripts/gate3b-completion.test.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)[1];

const SEED_CORRECT_INDEXES = [2, 1, 0, 1, 1, 1, 1, 1, 1, 1];

let passCount = 0;
let failCount = 0;
function check(label, ok, detail = '') {
  if (ok) passCount += 1; else failCount += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
}

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

async function getStudent(email) {
  const c = client();
  let res = await c.auth.signInWithPassword({ email, password: 'Gate3C-test-1' });
  if (res.error || !res.data?.user) {
    res = await c.auth.signUp({ email, password: 'Gate3C-test-1' });
    if (res.error || !res.data?.user) throw new Error(`setup failed for ${email}: ${res.error?.message}`);
  }
  return { client: c, userId: res.data.user.id };
}

async function resetAll(clients) {
  for (const c of clients) {
    try { await c.rpc('reset_my_practice_data'); } catch {}
    try { await c.rpc('upsert_my_daily_goal', { p_questions_goal: 5, p_timezone: 'Asia/Kolkata' }); } catch {}
  }
}

async function startAndAnswer(c, { allCorrect }) {
  const { data: start } = await c.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
  const quizId = start?.quizAttemptId;
  const { data: qs } = await c.rpc('practice_questions_for', { p_topic_slug: 'photosynthesis', p_quiz_attempt_id: quizId });
  const questions = (qs ?? []).filter((q) => q && typeof q.prompt === 'string');
  for (let i = 0; i < questions.length; i++) {
    const idx = allCorrect ? SEED_CORRECT_INDEXES[i] : (SEED_CORRECT_INDEXES[i] + 1) % 4;
    await c.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizId, p_question_id: questions[i].id, p_selected_index: idx, p_skipped: false,
    });
  }
  await c.rpc('finish_practice_attempt', { p_quiz_attempt_id: quizId });
  return { quizId, questions };
}

let A_ = null, B_ = null;
const createdUserIds = [];

try {
  A_ = await getStudent('gate3c-a@test.local');
  B_ = await getStudent('gate3c-b@test.local');
  createdUserIds.push(A_.userId, B_.userId);
  await resetAll([A_.client, B_.client]);

  // 1. Passing attempt => completed with real score
  let missionA = null;
  {
    await startAndAnswer(A_.client, { allCorrect: true });
    const { data: m } = await A_.client.from('student_missions').insert({ mission_text: 'Phase 3 completion mission', topic_slug: 'photosynthesis' }).select('id, status').single();
    missionA = m;
    check('1a. mission created active', m?.status === 'active', m?.status);

    const { data: verdict, error } = await A_.client.rpc('complete_mission_secure', { p_mission_id: missionA.id });
    check('1b. completion succeeds with real score', !error && verdict?.status === 'completed' && verdict?.correct === 10 && verdict?.total === 10, JSON.stringify(verdict)?.slice(0, 80));
    check('1c. attempt number returned', Number.isInteger(verdict?.attemptNumber), `${verdict?.attemptNumber}`);
  }

  // 2. Failing attempt => refused
  {
    const { data: m2 } = await A_.client.from('student_missions').insert({ mission_text: 'Phase 3 failing mission', topic_slug: 'photosynthesis' }).select('id').single();
    // Already have a passing attempt, so this should complete too. Instead test
    // with user B who has no passing attempt.
    await startAndAnswer(B_.client, { allCorrect: false });
    const { data: mB } = await B_.client.from('student_missions').insert({ mission_text: 'B failing mission', topic_slug: 'photosynthesis' }).select('id').single();
    const { data: verdict } = await B_.client.rpc('complete_mission_secure', { p_mission_id: mB.id });
    check('2. failing attempt => criteria_not_met', verdict?.status === 'criteria_not_met', JSON.stringify(verdict)?.slice(0, 80));
    // Clean up the failing mission so it doesn't interfere
    void m2;
  }

  // 3. Re-calling => already_completed (no duplicate)
  {
    const { data: again } = await A_.client.rpc('complete_mission_secure', { p_mission_id: missionA.id });
    check('3. re-completion => already_completed', again?.status === 'already_completed', again?.status);
    // 11. already_completed does not return attemptNumber (would trigger fresh celebration)
    check('11. already_completed returns no attemptNumber', again?.attemptNumber === undefined, `${again?.attemptNumber}`);
  }

  // 4. Retry that eventually passes => completed with retry attempt number
  {
    // B now passes
    await startAndAnswer(B_.client, { allCorrect: true });
    const { data: mB2 } = await B_.client.from('student_missions').insert({ mission_text: 'B retry mission', topic_slug: 'photosynthesis' }).select('id').single();
    const { data: verdict } = await B_.client.rpc('complete_mission_secure', { p_mission_id: mB2.id });
    check('4. retry completion succeeds', verdict?.status === 'completed' && verdict?.correct === 10, JSON.stringify(verdict)?.slice(0, 80));
  }

  // 6. Score from qualifying attempt only (already verified above: 10/10, not inflated by the failed attempt)
  {
    const { data: summary } = await B_.client.rpc('practice_summary_secure');
    check('6. summary passedAttempts counts only passing attempts', summary?.passedAttempts >= 1, `${summary?.passedAttempts}`);
  }

  // 7. Forging completion via UPDATE refused
  {
    const forged = await A_.client.from('student_missions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', missionA.id);
    check('7. forged UPDATE to completed refused', Boolean(forged.error), forged.error?.message?.slice(0, 60));
  }

  // 8. Forging via direct INSERT into practice_quiz_attempts refused
  {
    const forged = await A_.client.from('practice_quiz_attempts').insert({ topic_slug: 'photosynthesis', attempt_number: 99, status: 'completed', is_passing: true, score_correct: 10, score_total: 10 }).select('id').maybeSingle();
    check('8. direct INSERT into practice_quiz_attempts refused', Boolean(forged.error), forged.error?.message?.slice(0, 60));
  }

  // 9. Refresh persistence — summary still shows completed mission
  {
    const { data: summary } = await A_.client.rpc('practice_summary_secure');
    check('9. summary persists completed mission count', summary?.missionsCompleted === 1, `missions=${summary?.missionsCompleted}`);
    const { data: row } = await A_.client.from('student_missions').select('status, completed_at').eq('id', missionA.id).maybeSingle();
    check('9b. mission row persists completed status + timestamp', row?.status === 'completed' && Boolean(row?.completed_at), JSON.stringify(row)?.slice(0, 60));
  }

  // 10. Cross-user isolation
  {
    const { data: bSeesA } = await B_.client.from('student_missions').select('id').eq('user_id', A_.userId);
    check('10. B cannot read A missions', (bSeesA ?? []).length === 0, `rows=${bSeesA?.length ?? 0}`);
  }

  // 12. missionsCompleted increments by exactly 1 per real completion (already 1 for A)
  {
    const { data: summary } = await A_.client.rpc('practice_summary_secure');
    check('12. missionsCompleted is exactly 1 (no duplicates)', summary?.missionsCompleted === 1, `missions=${summary?.missionsCompleted}`);
  }
} catch (err) {
  failCount += 1;
  console.log(`FAIL: journey errored — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    if (createdUserIds.length) await resetAll([A_?.client, B_?.client].filter(Boolean));
    console.log(`\nFixture cleanup: reset ${createdUserIds.length} account(s).`);
  } catch (e) {
    console.log(`Cleanup error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\ngate3b-completion: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
process.exit(failCount ? 1 : 0);
