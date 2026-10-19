import { supabase } from '@/lib/supabase';
import {
  parseActiveMission,
  parseAttemptResult,
  parseFinishAttemptResult,
  parsePracticeQuestions,
  parsePracticeSummary,
  parseStartAttemptResult,
} from '@/lib/practiceCore';
import type {
  FinishAttemptResult,
  PracticeAttemptResult,
  StartAttemptResult,
} from '@/lib/practiceCore';

function rpcError(scope: string): never {
  throw new Error(`${scope} failed. Please refresh and try again.`);
}

/**
 * Start (or resume) a deliberate practice attempt for a topic. The server
 * assigns the attempt number and refuses to start a new one while another is
 * in progress, so parallel grinding is impossible.
 */
export async function startPracticeAttempt(topicSlug: string): Promise<StartAttemptResult> {
  const { data, error } = await supabase.rpc('start_practice_attempt', {
    p_topic_slug: topicSlug,
  });
  if (error) rpcError('Starting your practice attempt');
  return parseStartAttemptResult(data);
}

/** Verified questions for a topic; answer keys withheld until graded. */
export async function fetchPracticeQuestions(topicSlug: string, quizAttemptId: string | null) {
  const params: Record<string, unknown> = { p_topic_slug: topicSlug };
  if (quizAttemptId) params.p_quiz_attempt_id = quizAttemptId;
  const { data, error } = await supabase.rpc('practice_questions_for', params);
  if (error) rpcError('Loading practice questions');
  return parsePracticeQuestions(data);
}

/**
 * Submits one answer within a quiz attempt. The database grades it server
 * side. Pass skipped=true (and selectedIndex=null) for a timed-out question,
 * which is recorded as incorrect — never a fabricated answer.
 */
export async function submitPracticeAttempt(
  quizAttemptId: string,
  questionId: string,
  selectedIndex: number | null,
  skipped: boolean
): Promise<PracticeAttemptResult> {
  const { data, error } = await supabase.rpc('submit_practice_attempt', {
    p_quiz_attempt_id: quizAttemptId,
    p_question_id: questionId,
    p_selected_index: selectedIndex,
    p_skipped: skipped,
  });
  if (error) rpcError('Submitting your answer');
  return parseAttemptResult(data);
}

/** Locks and grades a whole attempt. Returns score + isPassing from that one attempt only. */
export async function finishPracticeAttempt(quizAttemptId: string): Promise<FinishAttemptResult> {
  const { data, error } = await supabase.rpc('finish_practice_attempt', {
    p_quiz_attempt_id: quizAttemptId,
  });
  if (error) rpcError('Finishing your practice attempt');
  return parseFinishAttemptResult(data);
}

/** Discards an in_progress attempt so a fresh one can be started. */
export async function abandonPracticeAttempt(quizAttemptId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('abandon_practice_attempt', {
    p_quiz_attempt_id: quizAttemptId,
  });
  if (error) rpcError('Releasing your practice attempt');
  return { status: (data ?? {}).status ?? 'error' };
}

export async function completeMission(missionId: string) {
  const { data, error } = await supabase.rpc('complete_mission_secure', {
    p_mission_id: missionId,
  });
  if (error) rpcError('Completing your mission');
  return (data ?? {}) as {
    status?: string;
    reason?: string;
    correct?: number;
    total?: number;
    attemptNumber?: number;
    completedAttempts?: number;
  };
}

export async function createMission(missionText: string, topicSlug: string, resourceId: string | null) {
  const { data, error } = await supabase
    .from('student_missions')
    .insert({ mission_text: missionText, topic_slug: topicSlug, resource_id: resourceId })
    .select('id, mission_text, topic_slug, resource_id')
    .single();
  if (error || !data) rpcError('Creating your mission');
  const row = data as Record<string, unknown>;
  return (
    parseActiveMission({
      id: row.id,
      missionText: row.mission_text,
      topicSlug: row.topic_slug,
      resourceId: row.resource_id,
    }) ?? rpcError('Creating your mission')
  );
}

export async function fetchPracticeSummary() {
  const { data, error } = await supabase.rpc('practice_summary_secure');
  if (error) rpcError('Loading your practice activity');
  return parsePracticeSummary(data);
}
