/*
 * Pure practice-session logic, shared between the UI and node tests.
 * No Supabase imports — everything here is deterministic and testable.
 */

export interface PracticeQuestion {
  id: string;
  prompt: string;
  options: string[];
  displayOrder: number;
  attempted: boolean;
  selectedIndex?: number | null;
  skipped?: boolean;
  isCorrect?: boolean;
  correctIndex?: number;
  explanation?: string;
}

/** Validates the raw jsonb returned by practice_questions_for before binding. */
export function parsePracticeQuestions(raw: unknown): PracticeQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PracticeQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const prompt = typeof r.prompt === 'string' ? r.prompt : '';
    const options = Array.isArray(r.options)
      ? r.options.filter((o): o is string => typeof o === 'string')
      : [];
    if (!id || !prompt || options.length === 0) continue;
    const q: PracticeQuestion = {
      id,
      prompt,
      options,
      displayOrder: Number.isFinite(Number(r.displayOrder)) ? Number(r.displayOrder) : 0,
      attempted: r.attempted === true,
    };
    if (q.attempted) {
      q.selectedIndex =
        r.selectedIndex === null || r.selectedIndex === undefined
          ? null
          : Number.isInteger(r.selectedIndex)
            ? (r.selectedIndex as number)
            : undefined;
      q.skipped = r.skipped === true;
      q.isCorrect = r.isCorrect === true;
      q.correctIndex = Number.isInteger(r.correctIndex) ? (r.correctIndex as number) : undefined;
      q.explanation = typeof r.explanation === 'string' ? r.explanation : undefined;
    }
    out.push(q);
  }
  return out;
}

export interface PracticeAttemptResult {
  status:
    | 'graded'
    | 'already_answered'
    | 'attempt_closed'
    | 'unauthenticated'
    | 'invalid_selection'
    | 'not_found';
  selectedIndex: number | null;
  skipped: boolean | null;
  isCorrect: boolean | null;
  correctIndex: number | null;
  explanation: string | null;
}

export function parseAttemptResult(raw: unknown): PracticeAttemptResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status;
  const known: PracticeAttemptResult['status'] =
    status === 'graded' ||
    status === 'already_answered' ||
    status === 'attempt_closed' ||
    status === 'unauthenticated' ||
    status === 'invalid_selection' ||
    status === 'not_found'
      ? status
      : 'not_found';
  return {
    status: known,
    selectedIndex:
      r.selectedIndex === null || r.selectedIndex === undefined
        ? null
        : Number.isInteger(r.selectedIndex)
          ? (r.selectedIndex as number)
          : null,
    skipped: typeof r.skipped === 'boolean' ? r.skipped : null,
    isCorrect: typeof r.isCorrect === 'boolean' ? r.isCorrect : null,
    correctIndex: Number.isInteger(r.correctIndex) ? (r.correctIndex as number) : null,
    explanation: typeof r.explanation === 'string' ? r.explanation : null,
  };
}

export interface StartAttemptResult {
  status: 'started' | 'in_progress_exists' | 'unauthenticated' | 'invalid_topic';
  quizAttemptId: string | null;
  attemptNumber: number | null;
}

export function parseStartAttemptResult(raw: unknown): StartAttemptResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status;
  const known: StartAttemptResult['status'] =
    status === 'started' || status === 'in_progress_exists' || status === 'unauthenticated' || status === 'invalid_topic'
      ? status
      : 'unauthenticated';
  return {
    status: known,
    quizAttemptId: typeof r.quizAttemptId === 'string' ? r.quizAttemptId : null,
    attemptNumber: Number.isInteger(r.attemptNumber) ? (r.attemptNumber as number) : null,
  };
}

export interface FinishAttemptResult {
  status: 'completed' | 'already_finished' | 'attempt_closed' | 'criteria_not_met' | 'no_practice_set' | 'unauthenticated' | 'not_found';
  correct: number | null;
  total: number | null;
  isPassing: boolean | null;
  reason?: string;
}

export function parseFinishAttemptResult(raw: unknown): FinishAttemptResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status;
  const known: FinishAttemptResult['status'] =
    status === 'completed' ||
    status === 'already_finished' ||
    status === 'attempt_closed' ||
    status === 'criteria_not_met' ||
    status === 'no_practice_set' ||
    status === 'unauthenticated' ||
    status === 'not_found'
      ? status
      : 'not_found';
  return {
    status: known,
    correct: Number.isInteger(r.correct) ? (r.correct as number) : null,
    total: Number.isInteger(r.total) ? (r.total as number) : null,
    isPassing: typeof r.isPassing === 'boolean' ? r.isPassing : null,
    reason: typeof r.reason === 'string' ? r.reason : undefined,
  };
}

export const PASS_THRESHOLD = 0.8;

export function accuracy(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return correct / total;
}

export function passesCompletion(correct: number, total: number): boolean {
  const acc = accuracy(correct, total);
  return acc !== null && acc >= PASS_THRESHOLD;
}

/** Per-question countdown length, in seconds. */
export const PER_QUESTION_SECONDS = 30;

/** m:ss clock for the visible countdown. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface MissionSummary {
  id: string;
  missionText: string;
  topicSlug: string;
  resourceId: string | null;
}

export function parseActiveMission(raw: unknown): MissionSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.missionText !== 'string') return null;
  return {
    id: r.id,
    missionText: r.missionText,
    topicSlug: typeof r.topicSlug === 'string' ? r.topicSlug : '',
    resourceId: typeof r.resourceId === 'string' ? r.resourceId : null,
  };
}

export interface MistakeItem {
  questionId: string;
  prompt: string;
  options: string[];
  selectedIndex: number | null;
  skipped: boolean;
  correctIndex: number;
  explanation: string;
  topicSlug: string;
  topicLabel: string;
  subjectName: string;
  submittedAt: string;
}

export interface QuizAttemptRef {
  topicSlug: string;
  attemptNumber: number;
  correct: number | null;
  total: number | null;
  isPassing: boolean | null;
  status: string;
  completedAt: string | null;
}

export interface PracticeSummary {
  missionsCompleted: number;
  missionsActive: number;
  activeMission: MissionSummary | null;
  attempts: number;
  correct: number;
  quizAttempts: number;
  passedAttempts: number;
  bestPassingAttempt: QuizAttemptRef | null;
  lastAttempt: QuizAttemptRef | null;
  mistakes: MistakeItem[];
  activeDays: string[];
}

function parseMistakes(raw: unknown): MistakeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MistakeItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.questionId !== 'string' ||
      typeof r.prompt !== 'string' ||
      !Array.isArray(r.options) ||
      typeof r.correctIndex !== 'number' ||
      typeof r.explanation !== 'string'
    ) {
      continue;
    }
    out.push({
      questionId: r.questionId,
      prompt: r.prompt,
      options: r.options.filter((o): o is string => typeof o === 'string'),
      selectedIndex:
        r.selectedIndex === null || r.selectedIndex === undefined
          ? null
          : Number.isInteger(r.selectedIndex)
            ? (r.selectedIndex as number)
            : null,
      skipped: r.skipped === true,
      correctIndex: r.correctIndex,
      explanation: r.explanation,
      topicSlug: typeof r.topicSlug === 'string' ? r.topicSlug : '',
      topicLabel: typeof r.topicLabel === 'string' ? r.topicLabel : '',
      subjectName: typeof r.subjectName === 'string' ? r.subjectName : '',
      submittedAt: typeof r.submittedAt === 'string' ? r.submittedAt : '',
    });
  }
  return out;
}

function parseQuizAttemptRef(raw: unknown): QuizAttemptRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.topicSlug !== 'string' || !Number.isInteger(r.attemptNumber)) return null;
  return {
    topicSlug: r.topicSlug,
    attemptNumber: r.attemptNumber as number,
    correct: Number.isInteger(r.correct) ? (r.correct as number) : null,
    total: Number.isInteger(r.total) ? (r.total as number) : null,
    isPassing: typeof r.isPassing === 'boolean' ? r.isPassing : null,
    status: typeof r.status === 'string' ? r.status : '',
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
  };
}

export function parsePracticeSummary(raw: unknown): PracticeSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    missionsCompleted: Number.isInteger(r.missionsCompleted) ? (r.missionsCompleted as number) : 0,
    missionsActive: Number.isInteger(r.missionsActive) ? (r.missionsActive as number) : 0,
    activeMission: parseActiveMission(r.activeMission),
    attempts: Number.isInteger(r.attempts) ? (r.attempts as number) : 0,
    correct: Number.isInteger(r.correct) ? (r.correct as number) : 0,
    quizAttempts: Number.isInteger(r.quizAttempts) ? (r.quizAttempts as number) : 0,
    passedAttempts: Number.isInteger(r.passedAttempts) ? (r.passedAttempts as number) : 0,
    bestPassingAttempt: parseQuizAttemptRef(r.bestPassingAttempt),
    lastAttempt: parseQuizAttemptRef(r.lastAttempt),
    mistakes: parseMistakes(r.mistakes),
    activeDays: Array.isArray(r.activeDays)
      ? r.activeDays.filter((d): d is string => typeof d === 'string')
      : [],
  };
}

/** The one practice set we ship reviewed content for. */
export const AVAILABLE_SETS = [
  {
    slug: 'photosynthesis',
    label: 'Photosynthesis',
    subject: 'Biology',
    blurb: 'How plants turn light, water and carbon dioxide into food.',
  },
] as const;
