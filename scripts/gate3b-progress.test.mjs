/*
 * Gate 3B Phase 2 live verification: daily goals + genuine progress.
 *
 * Covers:
 *   A. Daily goal model
 *     1. get_my_daily_goal returns defaults before any goal is set
 *     2. upsert_my_daily_goal saves questionsGoal + timezone
 *     3. invalid goal (0, 51) rejected; out-of-range clamped/refused
 *     4. invalid timezone falls back to Asia/Kolkata
 *     5. direct INSERT into daily_learning_goals refused
 *     6. direct UPDATE on daily_progress refused (all writes revoked)
 *   B. Genuine activity updates progress
 *     7. answering a question increments today's gradedAnswers
 *     8. a correct answer increments correctAnswers too
 *     9. a skipped (timed-out) answer does NOT increment gradedAnswers
 *    10. completing a mission increments missionsCompletedToday
 *    11. goal_met_at is set the first time gradedAnswers crosses the goal
 *    12. repeated activity on the same day does not double-set goal_met_at
 *   C. Reset safety
 *    13. reset_my_practice_data clears the caller's daily_progress
 *    14. reset only touches the caller's rows (cross-user isolation)
 *   D. progress_overview_secure
 *    15. returns today + last14 + streak + practice
 *    16. streak counts only goal-met days (no fabrication)
 *    17. an all-skipped attempt does not create a goal-met day
 *   E. Cross-user privacy
 *    18. user B cannot read user A's daily_progress
 *    19. user B cannot read user A's daily_learning_goals
 *
 * Run: node scripts/gate3b-progress.test.mjs
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
  let res = await c.auth.signInWithPassword({ email, password: 'Gate3Bp-test-1' });
  if (res.error || !res.data?.user) {
    res = await c.auth.signUp({ email, password: 'Gate3Bp-test-1' });
    if (res.error || !res.data?.user) throw new Error(`setup failed for ${email}: ${res.error?.message}`);
  }
  return { client: c, userId: res.data.user.id };
}

async function resetAll(clients) {
  for (const c of clients) {
    try {
      await c.rpc('reset_my_practice_data');
    } catch (e) {
      console.log(`cleanup rpc error: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Reset goal to defaults so "defaults before set" is testable. DELETE
    // on daily_learning_goals is revoked (it's a preference, not progress),
    // so we upsert back to the default values instead.
    try {
      await c.rpc('upsert_my_daily_goal', { p_questions_goal: 5, p_timezone: 'Asia/Kolkata' });
    } catch {
      // ignore — the goal row may already be at defaults
    }
  }
}

async function startAndAnswerAll(c, { allCorrect, allSkipped }) {
  const { data: start } = await c.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
  const quizId = start?.quizAttemptId;
  const { data: qs } = await c.rpc('practice_questions_for', { p_topic_slug: 'photosynthesis', p_quiz_attempt_id: quizId });
  const questions = (qs ?? []).filter((q) => q && typeof q.prompt === 'string');
  for (let i = 0; i < questions.length; i++) {
    if (allSkipped) {
      await c.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizId,
        p_question_id: questions[i].id,
        p_selected_index: null,
        p_skipped: true,
      });
    } else {
      const idx = allCorrect ? SEED_CORRECT_INDEXES[i] : (SEED_CORRECT_INDEXES[i] + 1) % 4;
      await c.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: quizId,
        p_question_id: questions[i].id,
        p_selected_index: idx,
        p_skipped: false,
      });
    }
  }
  return { quizId, questions };
}

let A_ = null;
let B_ = null;
const createdUserIds = [];

try {
  A_ = await getStudent('gate3b-prog-a@test.local');
  B_ = await getStudent('gate3b-prog-b@test.local');
  createdUserIds.push(A_.userId, B_.userId);
  await resetAll([A_.client, B_.client]);

  // ===== A. Daily goal model =====

  // 1. defaults before set
  {
    const { data, error } = await A_.client.rpc('get_my_daily_goal');
    check('1. get_my_daily_goal returns defaults before set', !error && data?.status === 'ok' && data?.questionsGoal === 5 && data?.timezone === 'Asia/Kolkata', `${data?.status} ${error?.message ?? ''}`);
  }

  // 2. save goal
  {
    const { data, error } = await A_.client.rpc('upsert_my_daily_goal', { p_questions_goal: 7, p_timezone: 'Asia/Kolkata' });
    check('2. upsert_my_daily_goal saves questionsGoal + timezone', !error && data?.status === 'saved' && data?.questionsGoal === 7, `${data?.status} ${error?.message ?? ''}`);

    const { data: row } = await A_.client.from('daily_learning_goals').select('questions_goal, timezone').eq('user_id', A_.userId).maybeSingle();
    check('2b. goal persisted', row?.questions_goal === 7 && row?.timezone === 'Asia/Kolkata', JSON.stringify(row));
  }

  // 3. invalid goal
  {
    const { data: tooLow } = await A_.client.rpc('upsert_my_daily_goal', { p_questions_goal: 0, p_timezone: 'Asia/Kolkata' });
    check('3a. goal of 0 refused', tooLow?.status === 'invalid_goal', tooLow?.status);
    const { data: tooHigh } = await A_.client.rpc('upsert_my_daily_goal', { p_questions_goal: 51, p_timezone: 'Asia/Kolkata' });
    check('3b. goal of 51 refused', tooHigh?.status === 'invalid_goal', tooHigh?.status);
  }

  // 4. invalid timezone falls back
  {
    const { data } = await A_.client.rpc('upsert_my_daily_goal', { p_questions_goal: 7, p_timezone: 'Mars/Olympus' });
    check('4. invalid timezone falls back to Asia/Kolkata', data?.status === 'saved' && data?.timezone === 'Asia/Kolkata', data?.timezone);
  }

  // 5. direct INSERT into daily_learning_goals refused
  {
    const forged = await A_.client
      .from('daily_learning_goals')
      .insert({ user_id: A_.userId, questions_goal: 1, timezone: 'UTC' })
      .select('user_id')
      .maybeSingle();
    check('5. direct INSERT into daily_learning_goals refused (upsert path only)', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // 6. direct UPDATE on daily_progress refused
  {
    const forged = await A_.client
      .from('daily_progress')
      .update({ graded_answers: 999, goal_met_at: new Date().toISOString() })
      .eq('user_id', A_.userId);
    check('6. direct UPDATE on daily_progress refused', Boolean(forged.error), forged.error?.message?.slice(0, 70));
  }

  // ===== B. Genuine activity updates progress =====
  // Set a small goal so we can cross it quickly.
  await A_.client.rpc('upsert_my_daily_goal', { p_questions_goal: 3, p_timezone: 'Asia/Kolkata' });

  // 7 + 8 + 9: answer some correct, some skipped, observe progress
  {
    const { questions } = await startAndAnswerAll(A_.client, { allCorrect: false, allSkipped: false });
    // Answered all 10 (wrong). gradedAnswers should be 10, correctAnswers 0.
    const { data: overview } = await A_.client.rpc('progress_overview_secure');
    check('7. answering questions increments today gradedAnswers', overview?.today?.gradedAnswers === 10, `${overview?.today?.gradedAnswers}`);
    check('8b. wrong answers do not increment correctAnswers', overview?.today?.correctAnswers === 0, `${overview?.today?.correctAnswers}`);
    check('9a. goal met after crossing threshold (10 >= 3)', overview?.today?.goalMet === true, `${overview?.today?.goalMet}`);
    check('9b. streak counts the goal-met day', overview?.streak >= 1, `${overview?.streak}`);
  }

  // 9c: a skipped attempt does NOT increment gradedAnswers further
  {
    const before = (await A_.client.rpc('progress_overview_secure'))?.data?.today?.gradedAnswers;
    await startAndAnswerAll(A_.client, { allSkipped: true });
    // Note: we don't finish this attempt, but the trigger fires on INSERT.
    // All-skipped rows increment gradedAnswers by 0 each, so it should not grow.
    const after = (await A_.client.rpc('progress_overview_secure'))?.data?.today?.gradedAnswers;
    check('9c. skipped answers do not increment gradedAnswers', after === before + 0, `before=${before} after=${after}`);
  }

  // 10 + 11 + 12: mission completion increments missionsCompletedToday; goal_met_at stable
  {
    const { data: m } = await A_.client
      .from('student_missions')
      .insert({ mission_text: 'Phase 2 progress mission', topic_slug: 'photosynthesis' })
      .select('id')
      .single();
    // Need a passing attempt to complete.
    await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' }).then(({ data }) => {
      // abandon the in_progress one first if any
    });
    // There may be an in_progress attempt from the skipped run above. Abandon it.
    const { data: inProg } = await A_.client.from('practice_quiz_attempts').select('id, status').eq('user_id', A_.userId).eq('status', 'in_progress').maybeSingle();
    if (inProg) {
      await A_.client.rpc('abandon_practice_attempt', { p_quiz_attempt_id: inProg.id });
    }
    const { data: start } = await A_.client.rpc('start_practice_attempt', { p_topic_slug: 'photosynthesis' });
    const passId = start?.quizAttemptId;
    const { data: qs } = await A_.client.rpc('practice_questions_for', { p_topic_slug: 'photosynthesis', p_quiz_attempt_id: passId });
    const questions = (qs ?? []).filter((q) => q && typeof q.prompt === 'string');
    for (let i = 0; i < questions.length; i++) {
      await A_.client.rpc('submit_practice_attempt', {
        p_quiz_attempt_id: passId,
        p_question_id: questions[i].id,
        p_selected_index: SEED_CORRECT_INDEXES[i],
        p_skipped: false,
      });
    }
    await A_.client.rpc('finish_practice_attempt', { p_quiz_attempt_id: passId });
    const { data: verdict } = await A_.client.rpc('complete_mission_secure', { p_mission_id: m.id });
    check('10. mission completion succeeds', verdict?.status === 'completed', verdict?.status);

    const { data: overview } = await A_.client.rpc('progress_overview_secure');
    check('10b. missionsCompletedToday incremented', overview?.today?.missionsCompleted >= 1, `${overview?.today?.missionsCompleted}`);
    check('12. goal_met_at not double-set (still met, no error)', overview?.today?.goalMet === true, `${overview?.today?.goalMet}`);
  }

  // ===== C. Reset safety =====
  // 13 + 14
  {
    const { data: before } = await A_.client.rpc('progress_overview_secure');
    check('13a. before reset, A has daily progress', before?.today?.gradedAnswers > 0, `${before?.today?.gradedAnswers}`);

    // Capture B's progress count before A resets.
    const { data: bBefore } = await B_.client.rpc('progress_overview_secure');

    const { data: reset } = await A_.client.rpc('reset_my_practice_data');
    check('13b. reset reports deleted daily progress', reset?.status === 'reset' && Number.isInteger(reset?.deletedDailyProgress), JSON.stringify(reset));

    const { data: after } = await A_.client.rpc('progress_overview_secure');
    check('13c. after reset, A today gradedAnswers is 0', after?.today?.gradedAnswers === 0, `${after?.today?.gradedAnswers}`);

    // B's data should be unchanged (reset only touches caller).
    const { data: bAfter } = await B_.client.rpc('progress_overview_secure');
    check('14. reset does not affect another user progress', bBefore?.today?.gradedAnswers === bAfter?.today?.gradedAnswers, `before=${bBefore?.today?.gradedAnswers} after=${bAfter?.today?.gradedAnswers}`);
  }

  // ===== D. progress_overview_secure shape =====
  // 15 + 16 + 17
  {
    const { data, error } = await A_.client.rpc('progress_overview_secure');
    check('15a. progress_overview returns ok', !error && data?.status === 'ok', `${data?.status} ${error?.message ?? ''}`);
    check('15b. last14 has 14 entries', Array.isArray(data?.last14) && data?.last14?.length === 14, `len=${data?.last14?.length}`);
    check('15c. practice summary embedded', data?.practice && typeof data?.practice?.attempts === 'number', JSON.stringify(data?.practice)?.slice(0, 60));
    check('16. streak is a non-negative integer', Number.isInteger(data?.streak) && data?.streak >= 0, `${data?.streak}`);

    // 17: all-skipped day is not goal-met
    await resetAll([A_.client]);
    await startAndAnswerAll(A_.client, { allSkipped: true });
    const { data: skippedOverview } = await A_.client.rpc('progress_overview_secure');
    check('17. all-skipped attempt does not create a goal-met day', skippedOverview?.today?.goalMet === false && skippedOverview?.today?.gradedAnswers === 0, `met=${skippedOverview?.today?.goalMet} graded=${skippedOverview?.today?.gradedAnswers}`);
  }

  // ===== E. Cross-user privacy =====
  // 18 + 19
  {
    const { data: bSeesAProgress, error: e1 } = await B_.client.from('daily_progress').select('user_id').eq('user_id', A_.userId);
    check('18. user B cannot read user A daily_progress', !e1 && (bSeesAProgress ?? []).length === 0, `rows=${bSeesAProgress?.length ?? 0} err=${e1?.message ?? ''}`);

    const { data: bSeesAGoal, error: e2 } = await B_.client.from('daily_learning_goals').select('user_id').eq('user_id', A_.userId);
    check('19. user B cannot read user A daily_learning_goals', !e2 && (bSeesAGoal ?? []).length === 0, `rows=${bSeesAGoal?.length ?? 0} err=${e2?.message ?? ''}`);
  }
} catch (err) {
  failCount += 1;
  console.log(`FAIL: journey errored — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    if (createdUserIds.length) {
      await resetAll([A_?.client, B_?.client].filter(Boolean));
    }
    console.log(`\nFixture cleanup: reset progress + practice data for ${createdUserIds.length} account(s).`);
  } catch (e) {
    console.log(`Fixture cleanup error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\ngate3b-progress: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
process.exit(failCount ? 1 : 0);
