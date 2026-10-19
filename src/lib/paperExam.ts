import { supabase } from '@/lib/supabase';

export type ExamMode = 'practice' | 'timed';
export type AttemptStatus = 'in_progress' | 'submitted' | 'expired';
export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'fill_blank' | 'true_false' | 'unknown';
export type AnswerKeySource = 'none' | 'student' | 'extracted';

export interface PaperExam {
  id: string;
  owner_id: string;
  upload_id: string;
  title: string;
  mode: ExamMode;
  duration_minutes: number;
  instructions: string | null;
  total_marks: number;
  question_count: number;
  created_at: string;
}

export interface ExamQuestionSnapshot {
  id: string;
  exam_id: string;
  position: number;
  question_type: QuestionType;
  question_text: string;
  options: string[] | null;
  marks: number | null;
  answer_key: string | null;
  answer_key_source: AnswerKeySource;
  has_figure: boolean;
  figure_note: string | null;
}

export interface ExamAnswer {
  selected_index: number | null;
  answer_text: string | null;
  marked_for_review: boolean;
  is_correct: boolean | null;
  graded: boolean;
}

export interface ExamAttempt {
  id: string;
  exam_id: string;
  status: AttemptStatus;
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  time_used_seconds: number | null;
  score_correct: number | null;
  score_total: number | null;
  graded_count: number | null;
  ungraded_count: number | null;
}

export interface AttemptBundle {
  attempt: ExamAttempt;
  exam: PaperExam;
  questions: (ExamQuestionSnapshot & { answer: ExamAnswer | null })[];
}

export class ExamError extends Error {
  constructor(message: string, public code: string = 'exam_error') {
    super(message);
  }
}

function rpcError(scope: string) {
  return (e: { message?: string }) => {
    throw new ExamError(e.message ?? 'Request failed.', scope);
  };
}

/** Create an exam from confirmed questions. */
export async function createPaperExam(params: {
  uploadId: string;
  title: string;
  questionIds: string[];
  mode: ExamMode;
  durationMinutes: number;
  instructions?: string;
}): Promise<string> {
  if (params.questionIds.length === 0) throw new ExamError('Select at least one question.', 'no_questions');
  if (params.mode === 'timed' && (params.durationMinutes < 1 || params.durationMinutes > 300)) {
    throw new ExamError('Duration must be between 1 and 300 minutes.', 'bad_duration');
  }

  const { data, error } = await supabase.rpc('create_paper_exam', {
    p_upload_id: params.uploadId,
    p_title: params.title,
    p_question_ids: params.questionIds,
    p_mode: params.mode,
    p_duration_minutes: params.durationMinutes,
    p_instructions: params.instructions ?? null,
  });

  if (error) throw new ExamError(error.message, 'create_failed');
  if (!data) throw new ExamError('Could not create the exam.', 'create_failed');
  return data as string;
}

/** Start (or resume) an exam attempt. */
export async function startPaperExam(examId: string): Promise<{
  attemptId: string;
  status: AttemptStatus;
  startedAt: string;
  expiresAt: string | null;
}> {
  const { data, error } = await supabase.rpc('start_paper_exam', { p_exam_id: examId });
  if (error) throw new ExamError(error.message, 'start_failed');
  if (!data || data.length === 0) throw new ExamError('Could not start the exam.', 'start_failed');
  const row = data[0];
  return {
    attemptId: row.out_attempt_id,
    status: row.out_status as AttemptStatus,
    startedAt: row.out_started_at,
    expiresAt: row.out_expires_at,
  };
}

/** Save an answer during an attempt. */
export async function saveExamAnswer(params: {
  attemptId: string;
  examQuestionId: string;
  selectedIndex?: number | null;
  answerText?: string | null;
  markedForReview?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('save_paper_exam_answer', {
    p_attempt_id: params.attemptId,
    p_exam_question_id: params.examQuestionId,
    p_selected_index: params.selectedIndex ?? null,
    p_answer_text: params.answerText ?? null,
    p_marked_for_review: params.markedForReview ?? false,
  });
  if (error) throw new ExamError(error.message, 'save_failed');
}

/** Submit an exam attempt. */
export async function submitPaperExam(attemptId: string): Promise<{
  status: AttemptStatus;
  scoreCorrect: number;
  scoreTotal: number;
  gradedCount: number;
  ungradedCount: number;
  timeUsedSeconds: number;
}> {
  const { data, error } = await supabase.rpc('submit_paper_exam', { p_attempt_id: attemptId });
  if (error) throw new ExamError(error.message, 'submit_failed');
  if (!data || data.length === 0) throw new ExamError('Could not submit the exam.', 'submit_failed');
  const row = data[0];
  return {
    status: row.out_status as AttemptStatus,
    scoreCorrect: row.out_score_correct,
    scoreTotal: row.out_score_total,
    gradedCount: row.out_graded_count,
    ungradedCount: row.out_ungraded_count,
    timeUsedSeconds: row.out_time_used_seconds,
  };
}

/** Get the full attempt bundle (attempt + exam + questions + answers). */
export async function getPaperExamAttempt(attemptId: string): Promise<AttemptBundle> {
  const { data, error } = await supabase.rpc('get_paper_exam_attempt', { p_attempt_id: attemptId });
  if (error) throw new ExamError(error.message, 'fetch_failed');
  if (!data) throw new ExamError('Attempt not found.', 'not_found');
  return data as AttemptBundle;
}

/** Fetch all exams for the current user. */
export async function fetchPaperExams(): Promise<PaperExam[]> {
  const { data, error } = await supabase
    .from('paper_exams')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) rpcError('fetch_exams')(error);
  return (data ?? []) as PaperExam[];
}

/** Fetch exams for a specific upload. */
export async function fetchExamsForUpload(uploadId: string): Promise<PaperExam[]> {
  const { data, error } = await supabase
    .from('paper_exams')
    .select('*')
    .eq('upload_id', uploadId)
    .order('created_at', { ascending: false });
  if (error) rpcError('fetch_exams')(error);
  return (data ?? []) as PaperExam[];
}

/** Fetch all attempts for the current user. */
export async function fetchExamAttempts(): Promise<ExamAttempt[]> {
  const { data, error } = await supabase
    .from('paper_exam_attempts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) rpcError('fetch_attempts')(error);
  return (data ?? []) as ExamAttempt[];
}

/** Fetch attempts for a specific exam. */
export async function fetchAttemptsForExam(examId: string): Promise<ExamAttempt[]> {
  const { data, error } = await supabase
    .from('paper_exam_attempts')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: false });
  if (error) rpcError('fetch_attempts')(error);
  return (data ?? []) as ExamAttempt[];
}

/** Format seconds as MM:SS or HH:MM:SS. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
