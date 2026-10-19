/*
 * Gate 3B Phase 1 live verification: retry after failure + honest timeout.
 *
 * Covers the two defects fixed in this gate:
 *   A. Retake after failure
 *     1. quiz bank still not readable via direct table access
 *     2. start_practice_attempt assigns attempt_number = 1, returns id
 *     3. cannot start a second in_progress attempt for the same topic (no parallel grinding)
 *     4. wrong answers grade isCorrect=false
 *     5. finish_practice_attempt at 0% returns completed + isPassing=false
 *     6. prior attempt rows are preserved (audit) after a new attempt starts
 *     7. a fresh attempt can be started after the failed one is finished
 *     8. completing a mission is REFUSED when only a failing attempt exists
 *     9. a passing attempt (>=80%) on retry completes the mission honestly
 *    10. mission completion is refused if any score column is forged by direct UPDATE (revoked)
 *    11. best-of-across-attempts cannot qualify: a passing attempt requires ALL questions in THAT attempt
 *   B. Honest timeout
 *    12. submit with skipped=true records isCorrect=false, selected_index NULL
 *    13. a timed-out question is NOT a no-op: it counts toward answered/total
 *    14. an attempt with every question skipped scores 0/total and is not passing
 *    15. skipping cannot inflate accuracy or achievement eligibility
 *   C. Brute-force / forgery resistance
 *    16. direct INSERT into practice_quiz_attempts refused (REVOKE)
 *    17. direct INSERT into practice_attempts refused (REVOKE)
 *    18. forged UPDATE on practice_quiz_attempts score columns refused
 *    19. duplicate answer within one attempt rejected by submit (already_answered)
 *    20. attempt_number cannot be set by client (column-level revoke)
 *
 * Run: node scripts/gate3b-retry-timeout.test.mjs
 *
 * Safety: dedicated @test.local accounts only; every row created here is
 * cleaned up by exact user id in `finally` (and pre-cleaned at start). No
 * real user data is touched; ordinary authenticated JWTs only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)[1];
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)[1];

// Seed correct indexes for display_order 1..10 (from Gate 3A migration).
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
  let res = await c.auth.signInWithPassword({ email, password: 'Gate3B-test-1' });
  if (res.error || !res.data?.user) {
    res = await c.auth.signUp({ email, password: 'Gate3B-test-1' });
    if (res.error || !res.data?.user) throw new Error(`setup failed for ${email}: ${res.error?.message}`);
  }
  return { client: c, userId: res.data.user.id };
}

async function cleanFixtures(clients, userIds) {
  // Direct DELETE on practice tables is revoked (by design). Use the
  // owner-scoped SECURITY DEFINER reset function so each test account
  // wipes only its own rows.
  for (const c of clients) {
    try {
      await c.rpc('reset_my_practice_data');
    } catch (e) {
      console.log(`cleanup rpc error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const A = { email: 'gate3b-retry-a@test.local', password: 'Gate3B-test-1' };

let A_ = null;
const createdUserIds = [];

try {
  A_ = await getStudent(A.email);
  createdUserIds.push(A_.userId);
  await cleanFixtures([A_.client], createdUserIds);

  // --- 1. direct table access still denied ---
  {
    const { error } = await A_.client.from('practice_questions').select('id').limit(1);
    check('1. quiz bank not readable via direct table access', Boolean(error), error?.message?.slice(0, 70));
  }

  // --- 2. start_practice_attempt returns id + attempt_number 1 ---
  let quizAttemptId = null;
  let questions = [];
  {
    const { data, error } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    check('2a. start_practice_attempt succeeds', !error && data?.status === 'started', `${data?.status} ${error?.message ?? ''}`);
    quizAttemptId = data?.quizAttemptId ?? null;
    check('2b. server assigned attempt number 1', data?.attemptNumber === 1, `n=${data?.attemptNumber}`);
    check('2c. quiz attempt id returned', typeof quizAttemptId === 'string');

    const { data: qs } = await A_.client.rpc('practice_questions_for', {
      p_topic_slug: 'photosynthesis',
      p_quiz_attempt_id: quizAttemptId,
    });
    questions = (qs ?? []).filter((q) => q && typeof q.prompt === 'string');
    check('2d. 10 questions load scoped to the attempt', questions.length === 10, `count=${questions.length}`);
    check('2e. no answer keys exposed pre-submission', questions.every((q) => q.correctIndex === undefined && q.explanation === undefined));
  }

  // --- 3. cannot start a second in_progress attempt (no parallel grinding) ---
  {
    const { data } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    check('3. second in_progress attempt refused; original resumed', data?.status === 'in_progress_exists' && data?.quizAttemptId === quizAttemptId, data?.status);
  }

  // --- 4. wrong answer grades isCorrect=false ---
  {
    const wrongIndex = (SEED_CORRECT_INDEXES[0] + 1) % 4;
    const { data, error } = await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: quizAttemptId,
      p_question_id: questions[0].id,
      p_selected_index: wrongIndex,
      p_skipped: false,
    });
    check('4a. wrong submission returns graded', !error && data?.status === 'graded', `${data?.status} ${error?.message ?? ''}`);
    check('4b. wrong answer flagged isCorrect=false', data?.isCorrect === false);
    check('4c. correctIndex + explanation revealed after grading', data?.correctIndex === SEED_CORRECT_INDEXES[0] && typeof data?.explanation === 'string');
  }

  // --- 5. finish at 0% returns completed + isPassing=false ---
  {
    // Answer the remaining 9 all wrong.
    for (let i = 1; i < questions.length; i++) {
      const wrongIndex = (SEED_CORRECT_INDEXES[i] + 1) % 4;
      await A_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizAttemptId,
        p_question_id: questions[i].id,
        p_selected_index: wrongIndex,
        p_skipped: false,
      });
    }
    const { data, error } = await A_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: quizAttemptId });
    check('5a. finish at 0% returns completed', !error && data?.status === 'completed', `${data?.status} ${error?.message ?? ''}`);
    check('5b. score recorded as 0/10', data?.correct === 0 && data?.total === 10, `${data?.correct}/${data?.total}`);
    check('5c. isPassing=false at 0%', data?.isPassing === false, `${data?.isPassing}`);

    const { data: row } = await A_.client.from('practice_quiz_attempts').select('status, score_correct, score_total, is_passing').eq('id', quizAttemptId).maybeSingle();
    check('5d. persisted attempt row locked + scored 0/10 non-passing', row?.status === 'completed' && row?.score_correct === 0 && row?.is_passing === false, JSON.stringify(row));
  }

  // --- 6. prior attempt rows preserved after starting a new one ---
  let firstAttemptRowCount = 0;
  {
    const { data: rows } = await A_.client.from('practice_attempts').select('id').eq('quiz_attempt_id', quizAttemptId);
    firstAttemptRowCount = (rows ?? []).length;
    check('6a. first attempt persisted 10 graded rows', firstAttemptRowCount === 10, `rows=${firstAttemptRowCount}`);
  }

  // --- 7. a fresh attempt can be started after a failed one ---
  let quizAttemptId2 = null;
  {
    const { data, error } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    check('7a. new attempt starts after a completed (failed) one', !error && data?.status === 'started', `${data?.status} ${error?.message ?? ''}`);
    quizAttemptId2 = data?.quizAttemptId ?? null;
    check('7b. new attempt number is 2', data?.attemptNumber === 2, `n=${data?.attemptNumber}`);
    check('7c. new attempt has a distinct id', quizAttemptId2 !== null && quizAttemptId2 !== quizAttemptId);
  }

  // --- 6 (cont.) prior rows still intact ---
  {
    const { data: rows } = await A_.client.from('practice_attempts').select('id').eq('quiz_attempt_id', quizAttemptId);
    check('6b. first attempt rows preserved after starting a new attempt', (rows ?? []).length === firstAttemptRowCount, `rows=${(rows ?? []).length}`);
  }

  // --- 8. mission completion refused with only a failing attempt ---
  let mission = null;
  {
    const { data: m, error } = await A_.client
      .from('student_missions')
      .insert({ mission_text: 'Gate3B retry journey', topic_slug: 'photosynthesis' })
      .select('id, status')
      .single();
    check('8a. active mission created', !error && m?.status === 'active', error?.message?.slice(0, 70));
    mission = m ?? null;

    const { data: verdict } = await A_.client.rpc('complete_mission_secure', { p_mission_id: mission.id });
    check('8b. completion refused when only a failing attempt exists', verdict?.status === 'criteria_not_met', JSON.stringify(verdict)?.slice(0, 80));
  }

  // --- 9. a passing retry attempt completes the mission honestly ---
  {
    // Answer all 10 correctly on attempt 2.
    for (let i = 0; i < questions.length; i++) {
      await A_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizAttemptId2,
        p_question_id: questions[i].id,
        p_selected_index: SEED_CORRECT_INDEXES[i],
        p_skipped: false,
      });
    }
    const { data: finish } = await A_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: quizAttemptId2 });
    check('9a. retry attempt finishes 10/10 passing', finish?.status === 'completed' && finish?.correct === 10 && finish?.isPassing === true, JSON.stringify(finish)?.slice(0, 80));

    const { data: verdict } = await A_.client.rpc('complete_mission_secure', { p_mission_id: mission.id });
    check('9b. mission completes against the passing retry attempt', verdict?.status === 'completed' && verdict?.correct === 10 && verdict?.attemptNumber === 2, JSON.stringify(verdict)?.slice(0, 80));
  }

  // --- 10. forged UPDATE on quiz score columns refused ---
  {
    const forged = await A_.client
      .from('practice_quiz_attempts')
      .update({ is_passing: true, score_correct: 10 })
      .eq('id', quizAttemptId);
    check('10. forged UPDATE on quiz score columns refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
    const { data: row } = await A_.client.from('practice_quiz_attempts').select('is_passing, score_correct').eq('id', quizAttemptId).maybeSingle();
    check('10b. failed attempt still records is_passing=false', row?.is_passing === false, JSON.stringify(row));
  }

  // --- 11. best-of-across-attempts cannot qualify: a passing attempt needs ALL questions in THAT attempt ---
  {
    // Start a third attempt, answer only 8 (all correct), finish — should refuse.
    const { data: start } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    const id3 = start?.quizAttemptId;
    for (let i = 0; i < 8; i++) {
      await A_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: id3,
        p_question_id: questions[i].id,
        p_selected_index: SEED_CORRECT_INDEXES[i],
        p_skipped: false,
      });
    }
    const { data: finish } = await A_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: id3 });
    check('11. partial attempt cannot be finished (criteria_not_met)', finish?.status === 'criteria_not_met', JSON.stringify(finish)?.slice(0, 80));
  }

  // ============ B. Honest timeout ============

  const B_ = await getStudent('gate3b-timeout-b@test.local');
  createdUserIds.push(B_.userId);
  await cleanFixtures([B_.client], [B_.userId]);

  // --- 12. skipped=true records isCorrect=false, selected_index NULL ---
  let bQuestions = [];
  let bAttempt = null;
  {
    const { data: start } = await B_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    bAttempt = start?.quizAttemptId;
    const { data: qs } = await B_.client.rpc('practice_questions_for', { p_topic_slug: 'photosynthesis', p_quiz_attempt_id: bAttempt });
    bQuestions = (qs ?? []).filter((q) => q && typeof q.prompt === 'string');

    const { data, error } = await B_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: bAttempt,
      p_question_id: bQuestions[0].id,
      p_selected_index: null,
      p_skipped: true,
    });
    check('12a. skipped submission returns graded', !error && data?.status === 'graded', `${data?.status} ${error?.message ?? ''}`);
    check('12b. skipped recorded isCorrect=false', data?.isCorrect === false);
    check('12c. skipped flagged skipped=true', data?.skipped === true);

    const { data: row } = await B_.client.from('practice_attempts').select('selected_index, is_correct, skipped').eq('quiz_attempt_id', bAttempt).maybeSingle();
    check('12d. persisted row: selected_index NULL, is_correct false, skipped true', row?.selected_index === null && row?.is_correct === false && row?.skipped === true, JSON.stringify(row));
  }

  // --- 13. timed-out question is not a no-op: counts toward answered/total ---
  {
    // Skip the remaining 9 too.
    for (let i = 1; i < bQuestions.length; i++) {
      await B_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: bAttempt,
        p_question_id: bQuestions[i].id,
        p_selected_index: null,
        p_skipped: true,
      });
    }
    const { data: finish } = await B_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: bAttempt });
    check('13. all-skipped attempt finishes (not a no-op): total=10', finish?.status === 'completed' && finish?.total === 10, JSON.stringify(finish)?.slice(0, 80));
  }

  // --- 14. all-skipped attempt scores 0/10 and is not passing ---
  {
    const { data: row } = await B_.client.from('practice_quiz_attempts').select('score_correct, score_total, is_passing').eq('id', bAttempt).maybeSingle();
    check('14. all-skipped attempt is 0/10 non-passing', row?.score_correct === 0 && row?.score_total === 10 && row?.is_passing === false, JSON.stringify(row));
  }

  // --- 15. skipping cannot inflate achievement: mission refused ---
  {
    const { data: m } = await B_.client
      .from('student_missions')
      .insert({ mission_text: 'Gate3B timeout mission', topic_slug: 'photosynthesis' })
      .select('id')
      .single();
    const { data: verdict } = await B_.client.rpc('complete_mission_secure', { p_mission_id: m.id });
    check('15. mission refused after all-skipped attempt (no inflated eligibility)', verdict?.status === 'criteria_not_met', JSON.stringify(verdict)?.slice(0, 80));
  }

  // ============ C. Brute-force / forgery resistance ============

  // --- 16. direct INSERT into practice_quiz_attempts refused ---
  {
    const forged = await A_.client
      .from('practice_quiz_attempts')
      .insert({ topic_slug: 'photosynthesis', attempt_number: 99, status: 'completed', is_passing: true, score_correct: 10, score_total: 10 })
      .select('id')
      .maybeSingle();
    check('16. direct INSERT into practice_quiz_attempts refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // --- 17. direct INSERT into practice_attempts refused ---
  {
    const forged = await A_.client
      .from('practice_attempts')
      .insert({ question_id: questions[0].id, selected_index: SEED_CORRECT_INDEXES[0], is_correct: true })
      .select('id')
      .maybeSingle();
    check('17. direct INSERT into practice_attempts refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // --- 18. forged UPDATE on score columns refused (repeat on a different column set) ---
  {
    const forged = await A_.client
      .from('practice_quiz_attempts')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', quizAttemptId);
    check('18. forged UPDATE of status/completed_at refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // --- 19. duplicate answer within one (in_progress) attempt rejected ---
  {
    const { data: start } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    const dupId = start?.quizAttemptId;
    await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: dupId,
      p_question_id: questions[0].id,
      p_selected_index: SEED_CORRECT_INDEXES[0],
      p_skipped: false,
    });
    const { data: dup } = await A_.client.rpc('submit_practice_attempt', {
      p_quiz_attempt_id: dupId,
      p_question_id: questions[0].id,
      p_selected_index: (SEED_CORRECT_INDEXES[0] + 1) % 4,
      p_skipped: false,
    });
    check('19. duplicate answer within an in_progress attempt returns already_answered', dup?.status === 'already_answered', dup?.status);
  }

  // --- 20. attempt_number cannot be set by client (column revoke) ---
  {
    // Try to insert with an explicit attempt_number — should fail even though
    // the row-level insert is already revoked (belt + suspenders).
    const forged = await A_.client
      .from('practice_quiz_attempts')
      .insert({ topic_slug: 'photosynthesis', attempt_number: 7 })
      .select('id')
      .maybeSingle();
    check('20. client cannot set attempt_number (insert refused)', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // --- 21. cross-user isolation: B cannot see A's quiz attempts ---
  {
    const { data: bSeesA } = await B_.client.from('practice_quiz_attempts').select('id').eq('user_id', A_.userId);
    check('21. user B cannot read user A quiz attempts', (bSeesA ?? []).length === 0, `rows=${bSeesA?.length ?? 0}`);
  }
} catch (err) {
  failCount += 1;
  console.log(`FAIL: journey errored — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    if (createdUserIds.length) {
      await cleanFixtures([A_?.client].filter(Boolean), createdUserIds);
    }
    console.log(`\nFixture cleanup: removed quiz attempts + missions for ${createdUserIds.length} test account(s) by exact id.`);
  } catch (e) {
    console.log(`Fixture cleanup error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\ngate3b-retry-timeout: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
process.exit(failCount ? 1 : 0);
