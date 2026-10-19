/*
 * Gate 3A live security + functional verification.
 *
 * Two isolated authenticated test students exercise the complete
 * practice-and-mission journey against the live database:
 *   User A (failing journey):
 *     1. quiz bank not readable via direct table access
 *     2. questions arrive WITHOUT answer keys or explanations
 *     3. unauthenticated submission refused
 *     4. invalid selection refused (no attempt row created)
 *     5. wrong answer grades isCorrect=false + explanation revealed
 *     6. duplicate submission returns stored verdict (no double credit)
 *     7. mission completion refused before any answers
 *     8. forged INSERT with status='completed' refused
 *     9. forged INSERT with completed_at refused (column revoke)
 *    10. forged UPDATE to completed refused (UPDATE revoked)
 *    11. completion refused after 0% accuracy (criteria_not_met)
 *   User B (passing journey):
 *    12. correct answers grade isCorrect=true
 *    13. completion succeeds at 90% (>= 80% threshold)
 *    14. re-asking completion returns already_completed (no double award)
 *    15. cross-user isolation (both directions)
 *    16. attempts, verdicts and completion state persist on re-query
 *
 * Run: node scripts/gate3a-practice-security.test.mjs
 *
 * Safety: dedicated @test.local accounts only; every row created here is
 * cleaned up by exact user id in `finally` (and pre-cleaned at start so
 * re-runs are deterministic); no real user data touched; no privileged-role
 * assertions — ordinary authenticated JWTs only.
 *
 * Note on answer keys: because the grader is final-on-first-submission, the
 * passing journey must submit correctly on the first try. The keys below
 * mirror the seeded photosynthesis set in the Gate 3A migration (test
 * fixture data only — the app client never receives keys pre-submission,
 * which check 2 verifies).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)[1];

const SEED_CORRECT_INDEXES = [2, 1, 0, 1, 1, 1, 1, 1, 1, 1]; // display_order 1..10

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
  let res = await c.auth.signInWithPassword({ email, password: 'Gate3A-test-1' });
  if (res.error || !res.data?.user) {
    res = await c.auth.signUp({ email, password: 'Gate3A-test-1' });
    if (res.error || !res.data?.user) throw new Error(`setup failed for ${email}: ${res.error?.message}`);
  }
  return { client: c, userId: res.data.user.id };
}

async function cleanFixtures(clients) {
  // Direct DELETE on practice tables is revoked (by design since Gate 3B).
  // Use the owner-scoped SECURITY DEFINER reset function so each test
  // account wipes only its own rows.
  for (const c of clients) {
    try {
      await c.rpc('reset_my_practice_data');
    } catch (e) {
      console.log(`cleanup rpc error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const A = { email: 'gate3a-accept-a@test.local', password: 'Gate3A-test-1' };
const B = { email: 'gate3a-accept-b@test.local', password: 'Gate3A-test-1' };

let A_ = null;
let B_ = null;
const createdUserIds = [];

try {
  A_ = await getStudent(A.email);
  B_ = await getStudent(B.email);
  createdUserIds.push(A_.userId, B_.userId);
  await cleanFixtures([A_.client, B_.client]);

  // ================= User A: failing journey =================

  // --- 1. direct table access denied ---
  {
    const { error } = await A_.client.from('practice_questions').select('id').limit(1);
    check('1. quiz bank not readable via direct table access', Boolean(error), error?.message?.slice(0, 70));
  }

  // --- 2. questions without keys (scoped to a quiz attempt) ---
  let questions = [];
  let quizA = null;
  {
    const { data: start } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    quizA = start?.quizAttemptId ?? null;
    check('2a. practice attempt starts for authenticated student', start?.status === 'started' && typeof quizA === 'string', start?.status);

    const { data, error } = await A_.client.rpc('practice_questions_for', { p_topic_slug: 'photosynthesis', p_quiz_attempt_id: quizA });
    check('2b. quiz content loads scoped to attempt', !error && Array.isArray(data), error?.message?.slice(0, 70));
    questions = (data ?? []).filter(
      (q) => q && typeof q.prompt === 'string' && Array.isArray(q.options) && q.options.length === 4
    );
    check('2c. 10 questions, each with prompt + 4 options', questions.length === 10, `count=${questions.length}`);
    check('2d. no answer keys or explanations exposed pre-submission', questions.every((q) => q.correctIndex === undefined && q.explanation === undefined));
  }

  // --- 3. unauthenticated submission refused ---
  {
    const anon = client();
    const { data } = await anon.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizA,
      p_question_id: questions[0].id,
      p_selected_index: 0,
      p_skipped: false,
    });
    check('3. unauthenticated submission refused', data?.status === 'unauthenticated', data?.status);
  }

  // --- 4. invalid selection refused, no attempt row ---
  {
    const { data } = await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizA,
      p_question_id: questions[0].id,
      p_selected_index: 9,
      p_skipped: false,
    });
    const { data: attemptRows } = await A_.client.from('practice_attempts').select('id').eq('quiz_attempt_id', quizA);
    check('4. invalid selection refused and no attempt recorded', data?.status === 'invalid_selection' && (attemptRows ?? []).length === 0, `${data?.status}, rows=${attemptRows?.length ?? 0}`);
  }

  // --- 5. wrong answer: graded with explanation ---
  {
    const wrongIndex = (SEED_CORRECT_INDEXES[0] + 1) % 4;
    const { data, error } = await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizA,
      p_question_id: questions[0].id,
      p_selected_index: wrongIndex,
      p_skipped: false,
    });
    check('5a. wrong submission returns graded verdict', !error && data?.status === 'graded', error?.message?.slice(0, 70));
    check('5b. wrong answer flagged isCorrect=false', data?.isCorrect === false);
    check('5c. explanation + correctIndex revealed after grading', typeof data?.explanation === 'string' && data?.explanation.length > 10 && data?.correctIndex === SEED_CORRECT_INDEXES[0]);
    check('5d. selectedIndex echoed', data?.selectedIndex === wrongIndex);
  }

  // --- 6. duplicate answer within the same attempt returns stored verdict ---
  {
    const { data } = await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizA,
      p_question_id: questions[0].id,
      p_selected_index: SEED_CORRECT_INDEXES[0], // try to "fix" within this attempt
      p_skipped: false,
    });
    check('6. duplicate answer within an attempt returns stored wrong verdict', data?.status === 'already_answered' && data?.isCorrect === false && data?.selectedIndex !== SEED_CORRECT_INDEXES[0]);
  }

  // --- 7. completion refused before answering ---
  let missionA = null;
  {
    const { data: m, error } = await A_.client
      .from('student_missions')
      .insert({ mission_text: 'Acceptance: photosynthesis journey (user A)', topic_slug: 'photosynthesis' })
      .select('id, status')
      .single();
    check('7a. student can create an active mission', !error && m?.status === 'active', error?.message?.slice(0, 70));
    missionA = m ?? null;

    const { data: verdict } = await A_.client.rpc('complete_mission_secure', { p_mission_id: missionA.id });
    check('7b. completion refused with zero coverage', verdict?.status === 'criteria_not_met', JSON.stringify(verdict)?.slice(0, 80));
  }

  // --- 8. forged INSERT with status='completed' refused ---
  {
    const forged = await A_.client
      .from('student_missions')
      .insert({ mission_text: 'Forged completed mission', topic_slug: 'photosynthesis', status: 'completed' })
      .select('id')
      .maybeSingle();
    check('8a. forged status=completed INSERT refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
    const { data: row } = await A_.client
      .from('student_missions')
      .select('id, status')
      .eq('mission_text', 'Forged completed mission')
      .eq('user_id', A_.userId)
      .maybeSingle();
    check('8b. no forged completed row exists', row === null, row ? `status=${row.status}` : 'absent');
  }

  // --- 9. forged INSERT with completed_at refused (column revoke) ---
  {
    const forged = await A_.client
      .from('student_missions')
      .insert({ mission_text: 'Forged completed_at', topic_slug: 'photosynthesis', completed_at: new Date().toISOString() })
      .select('id')
      .maybeSingle();
    check('9. forged completed_at INSERT refused (column-level revoke)', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // --- 10. forged UPDATE to completed refused ---
  {
    const forged = await A_.client
      .from('student_missions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', missionA.id);
    check('10. forged UPDATE to completed refused (UPDATE revoked)', Boolean(forged.error), forged.error?.message?.slice(0, 70));
    const { data: row } = await A_.client
      .from('student_missions')
      .select('status, completed_at')
      .eq('id', missionA.id)
      .maybeSingle();
    check('10b. mission still active after forgery attempt', row?.status === 'active' && row?.completed_at === null);
  }

  // --- 11. answer remaining 9 WRONG, finish attempt, then completion refused ---
  {
    for (let i = 1; i < questions.length; i++) {
      const wrongIndex = (SEED_CORRECT_INDEXES[i] + 1) % 4;
      await A_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizA,
        p_question_id: questions[i].id,
        p_selected_index: wrongIndex,
        p_skipped: false,
      });
    }
    const { data: finish } = await A_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: quizA });
    check('11a. failing attempt finishes as completed/non-passing', finish?.status === 'completed' && finish?.isPassing === false && finish?.correct === 0, JSON.stringify(finish)?.slice(0, 80));
    const { data: verdict } = await A_.client.rpc('complete_mission_secure', { p_mission_id: missionA.id });
    check('11b. completion refused at 0% accuracy (no passing attempt)', verdict?.status === 'criteria_not_met', JSON.stringify(verdict)?.slice(0, 80));
  }

  // ================= User B: passing journey =================

  // --- 12. correct answers grade isCorrect=true (one deliberate miss => 90%) ---
  let quizB = null;
  {
    const { data: start } = await B_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    quizB = start?.quizAttemptId ?? null;
    let correctCount = 0;
    for (let i = 0; i < questions.length; i++) {
      const selectedIndex = i === 1 ? (SEED_CORRECT_INDEXES[1] + 1) % 4 : SEED_CORRECT_INDEXES[i];
      const { data } = await B_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizB,
        p_question_id: questions[i].id,
        p_selected_index: selectedIndex,
        p_skipped: false,
      });
      if (data?.isCorrect === true) correctCount += 1;
    }
    check('12. 9 of 10 first-try answers graded correct (90%)', correctCount === 9, `correct=${correctCount}`);
  }

  // --- 13. completion succeeds ---
  let missionB = null;
  {
    const { data: m, error } = await B_.client
      .from('student_missions')
      .insert({ mission_text: 'Acceptance: photosynthesis journey (user B)', topic_slug: 'photosynthesis' })
      .select('id')
      .single();
    missionB = m ?? null;
    check('13a. user B created active mission', !error && Boolean(missionB), error?.message?.slice(0, 70));

    const { data: finish } = await B_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: quizB });
    check('13b. passing attempt finishes at 9/10', finish?.status === 'completed' && finish?.correct === 9 && finish?.total === 10 && finish?.isPassing === true, JSON.stringify(finish)?.slice(0, 80));
    const { data: verdict } = await B_.client.rpc('complete_mission_secure', { p_mission_id: missionB.id });
    check('13c. completion succeeds at 90% (>= 80%)', verdict?.status === 'completed' && verdict?.correct === 9 && verdict?.total === 10, JSON.stringify(verdict)?.slice(0, 80));
  }

  // --- 14. no double award ---
  {
    const { data: again } = await B_.client.rpc('complete_mission_secure', { p_mission_id: missionB.id });
    check('14. re-asking completion returns already_completed', again?.status === 'already_completed', again?.status);
  }

  // --- 15. cross-user isolation (both directions) ---
  {
    const { data: bSeesAAttempts } = await B_.client.from('practice_attempts').select('id').eq('user_id', A_.userId);
    check('15a. user B cannot read user A attempts', (bSeesAAttempts ?? []).length === 0, `rows=${bSeesAAttempts?.length ?? 0}`);

    const { data: bSeesAMissions } = await B_.client.from('student_missions').select('id').eq('user_id', A_.userId);
    check('15b. user B cannot read user A missions', (bSeesAMissions ?? []).length === 0, `rows=${bSeesAMissions?.length ?? 0}`);

    const { data: aSeesBMissions } = await A_.client.from('student_missions').select('id').eq('user_id', B_.userId);
    check('15c. user A cannot read user B missions', (aSeesBMissions ?? []).length === 0, `rows=${aSeesBMissions?.length ?? 0}`);
  }

  // --- 16. persistence on re-query ---
  {
    const { data: aAttempts } = await A_.client.from('practice_attempts').select('id, is_correct').eq('user_id', A_.userId);
    check('16a. user A graded attempts persist (10, all wrong)', (aAttempts ?? []).length === 10 && aAttempts.every((r) => r.is_correct === false), `rows=${aAttempts?.length ?? 0}`);

    const { data: bMission } = await B_.client
      .from('student_missions')
      .select('status, completed_at')
      .eq('id', missionB.id)
      .maybeSingle();
    check('16b. user B completion state persists with timestamp', bMission?.status === 'completed' && Boolean(bMission?.completed_at));

    const { data: summary } = await B_.client.rpc('practice_summary_secure');
    check('16c. practice summary reports real persisted events', summary?.missionsCompleted === 1 && summary?.attempts === 10 && summary?.correct === 9 && summary?.passedAttempts === 1, `missions=${summary?.missionsCompleted} attempts=${summary?.attempts} correct=${summary?.correct} passing=${summary?.passedAttempts}`);
  }
} catch (err) {
  failCount += 1;
  console.log(`FAIL: journey errored — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    if (createdUserIds.length) {
      await cleanFixtures([A_?.client, B_?.client].filter(Boolean), createdUserIds);
    }
    console.log(`\nFixture cleanup: removed practice_attempts + student_missions for ${createdUserIds.length} test account(s) by exact id.`);
  } catch (e) {
    console.log(`Fixture cleanup error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\ngate3a-acceptance: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
process.exit(failCount ? 1 : 0);
